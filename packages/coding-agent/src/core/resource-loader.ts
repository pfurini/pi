import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import chalk from "chalk";
import { CONFIG_DIR_NAME } from "../config.ts";
import { loadThemeFromPath, type Theme } from "../modes/interactive/theme/theme.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";

export type { ResourceCollision, ResourceDiagnostic } from "./diagnostics.ts";

import { canonicalizePath, isLocalPath, resolvePath } from "../utils/paths.ts";
import { stripBom } from "../utils/text.ts";
import { adaptPromptTemplates, type LoadedCommand, loadCommandsFromDir } from "./commands/loader.ts";
import { createEventBus, type EventBus } from "./event-bus.ts";
import {
	clearExtensionCache,
	createExtensionRuntime,
	loadExtensionFromFactory,
	loadExtensionsCached,
} from "./extensions/loader.ts";
import type { Extension, ExtensionRuntime, InlineExtension, LoadExtensionsResult } from "./extensions/types.ts";
import { findGitPaths } from "./footer-data-provider.ts";
import {
	DefaultPackageManager,
	isEnabledByOverrides,
	type PathMetadata,
	type ResolvedResource,
	resourcePrecedenceRank,
} from "./package-manager.ts";
import type { PromptTemplate } from "./prompt-templates.ts";
import { loadPromptTemplates } from "./prompt-templates.ts";
import { SettingsManager } from "./settings-manager.ts";
import { type LoadedSkill, normalizeSkillInput, type SkillInput } from "./skills/frontmatter.ts";
import { findNestedSkillRootCandidates, scanNestedSkillRoot } from "./skills/nested-discovery.ts";
import {
	ResourceWatcher,
	type ResourceWatchFactory,
	type WatchedResourceRoot,
	type WatchTimers,
} from "./skills/resource-watch.ts";
import { getSkillSetController, type SkillSetController } from "./skills/skill-set-events.ts";
import { loadSkills } from "./skills.ts";
import { createSourceInfo, type SourceInfo } from "./source-info.ts";
import { resetTimings } from "./timings.ts";

export interface ResourceExtensionPaths {
	skillPaths?: Array<{ path: string; metadata: PathMetadata }>;
	promptPaths?: Array<{ path: string; metadata: PathMetadata }>;
	themePaths?: Array<{ path: string; metadata: PathMetadata }>;
}

export interface ResourceLoaderReloadOptions {
	resolveProjectTrust?: (input: { extensionsResult: LoadExtensionsResult }) => Promise<boolean>;
}

/** A retained skill-discovery root (c4d): the scan input plus the directory the watcher covers. */
export interface ScannedSkillRoot {
	/** Scan input for loadSkills: the root directory or a direct skill file. */
	scanPath: string;
	/** Directory the watcher covers (the root itself, or a direct skill file's parent). */
	dir: string;
	/** Set when the configured entry is a direct skill file: watch events filter to it. */
	file?: string;
	/** Trust/source metadata from the package manager (or the loader's CLI/nested defaults). */
	metadata?: PathMetadata;
	/**
	 * Settings override patterns that governed this root's leaves at resolve time.
	 * A root re-scan re-evaluates them so a leaf created mid-session is filtered the
	 * same way `/reload` would filter it (the disabled-leaf snapshot only knows leaves
	 * that already existed).
	 */
	overrides?: { patterns: string[]; baseDir: string };
}

/** Session-facing notification emitted by the loader's watch/discovery machinery (c4d). */
export type ResourceLoaderChangeEvent =
	| { kind: "refresh" }
	| { kind: "watcher-health"; health: ResourceDiagnostic | undefined }
	| { kind: "diagnostic"; diagnostic: ResourceDiagnostic };

export interface ResourceLoader {
	getExtensions(): LoadExtensionsResult;
	getSkills(): { skills: SkillInput[]; diagnostics: ResourceDiagnostic[] };
	getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
	/** A.7 command snapshot (native commands + adapted templates). Optional so lightweight test doubles can omit it. The snapshot is immutable: consumers must not mutate the returned array. */
	getCommands?(): { commands: readonly LoadedCommand[]; diagnostics: ResourceDiagnostic[] };
	getThemes(): { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
	getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
	getSystemPrompt(): string | undefined;
	getSystemPromptSource(): { path: string } | undefined;
	getAppendSystemPrompt(): string[];
	getAppendSystemPromptSources(): Array<{ path: string }>;
	extendResources(paths: ResourceExtensionPaths): void;
	/** Shared event bus backing the A.9 extension seams (skill-set, rewrite maps). Optional so lightweight test doubles can omit it. */
	getEventBus?(): EventBus;
	reload(options?: ResourceLoaderReloadOptions): Promise<void>;
	/** The authoritative scanned skill-root set (c4d): what the watcher watches and nested discovery checks against. */
	getScannedSkillRoots?(): readonly ScannedSkillRoot[];
	/**
	 * Register a per-session change reaction (c4d). Returns an unsubscribe. Registration
	 * synchronously replays the current watcher-health when degraded (late-subscriber safe).
	 */
	onResourceChange?(listener: (event: ResourceLoaderChangeEvent) => void): () => void;
	/** Light skills+commands refresh (c4d): re-scan and publish, no extension/settings reload. */
	refreshSkillsAndCommands?(): void;
	/** A.6 nested/monorepo discovery (c4d): register unscanned skill roots above a tool-touched file. */
	discoverNestedSkillRoots?(touchedFile: string): void;
	/** Release watchers and pending timers (c4d). Idempotent; caller-owned loaders are never disposed by sessions. */
	dispose?(): void;
}

/** Precedence rank of a scanned root, matching the resolved-leaf order (temporary/CLI first). */
function skillRootPrecedenceRank(root: ScannedSkillRoot): number {
	if (root.metadata === undefined) return 0;
	if (root.metadata.scope === "temporary") return -1;
	return resourcePrecedenceRank(root.metadata);
}

/**
 * Coalescing compares the whole published state, not just the resource array: a
 * refresh can leave the winner set byte-identical while producing a new diagnostic
 * (a newly added skill that *loses* a name collision is the motivating case), and
 * that diagnostic is the only signal the user gets.
 */
function diagnosticsSignature(diagnostics: readonly ResourceDiagnostic[]): string {
	return diagnostics.map((d) => `${d.type}|${d.path ?? ""}|${d.message}`).join("\n");
}

/** Semantic equality for the c4d coalescing refresh: duplicate states assign but never publish/notify. */
function skillsSemanticallyEqual(a: readonly LoadedSkill[], b: readonly LoadedSkill[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const x = a[i]!;
		const y = b[i]!;
		if (
			x.id !== y.id ||
			x.name !== y.name ||
			x.listingName !== y.listingName ||
			x.description !== y.description ||
			x.filePath !== y.filePath ||
			x.disableModelInvocation !== y.disableModelInvocation ||
			x.userInvocable !== y.userInvocable ||
			x.sourceInfo.source !== y.sourceInfo.source ||
			x.sourceInfo.scope !== y.sourceInfo.scope ||
			x.sourceInfo.baseDir !== y.sourceInfo.baseDir ||
			JSON.stringify(x.frontmatter) !== JSON.stringify(y.frontmatter)
		) {
			return false;
		}
	}
	return true;
}

/** Semantic equality for the c4d coalescing refresh's command snapshot. */
function commandsSemanticallyEqual(a: readonly LoadedCommand[], b: readonly LoadedCommand[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const x = a[i]!;
		const y = b[i]!;
		if (
			x.kind !== y.kind ||
			x.name !== y.name ||
			x.description !== y.description ||
			x.body !== y.body ||
			x.filePath !== y.filePath ||
			x.disableModelInvocation !== y.disableModelInvocation ||
			x.userInvocable !== y.userInvocable ||
			// Mirror skillsSemanticallyEqual: a command's `argument-hint` (carried
			// outside `frontmatter` for adapted templates) and any other frontmatter
			// edit must not be coalesced away, or a live edit never reaches the listing.
			x.argumentHint !== y.argumentHint ||
			JSON.stringify(x.frontmatter) !== JSON.stringify(y.frontmatter)
		) {
			return false;
		}
	}
	return true;
}

function resolvePromptInput(input: string | undefined, description: string): string | undefined {
	if (!input) {
		return undefined;
	}

	if (existsSync(input)) {
		try {
			return stripBom(readFileSync(input, "utf-8"));
		} catch (error) {
			console.error(chalk.yellow(`Warning: Could not read ${description} file ${input}: ${error}`));
			return input;
		}
	}

	return input;
}

function loadContextFileFromDir(dir: string): { path: string; content: string } | null {
	const candidates = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
	for (const filename of candidates) {
		const filePath = join(dir, filename);
		if (existsSync(filePath)) {
			try {
				if (!statSync(filePath).isFile()) {
					continue;
				}
				return {
					path: filePath,
					content: stripBom(readFileSync(filePath, "utf-8")),
				};
			} catch (error) {
				console.error(chalk.yellow(`Warning: Could not read ${filePath}: ${error}`));
			}
		}
	}
	return null;
}

/**
 * The main repo's context file that a nested linked worktree's own copy shadows: both
 * occupy the same logical repository scope, so loading both applies that context twice. Returns
 * undefined when nothing is shadowed, leaving normal ancestor inheritance alone.
 *
 * Returned canonicalized (realpath), because `git worktree add` writes the `.git`
 * file's `gitdir:` target in realpath form while cwd may still be symlinked
 * (macOS `/tmp` -> `/private/tmp`).
 */
function findShadowedContextFile(cwd: string): string | undefined {
	const gitPaths = findGitPaths(cwd);
	if (!gitPaths) return undefined;
	const commonGitDir = canonicalizePath(gitPaths.commonGitDir);
	const worktreeRoot = canonicalizePath(gitPaths.repoDir);
	const mainRepoRoot = dirname(commonGitDir);
	// False for an ordinary repo, where the two are the same dir, and for a sibling
	// worktree (`git worktree add ../feat`), whose main repo is not an ancestor.
	if (!worktreeRoot.startsWith(`${mainRepoRoot}${sep}`)) return undefined;
	// dirname of the common git dir is the main worktree root only when that dir is
	// itself checked out from the same repo. In a bare layout (`proj/.bare` +
	// `proj/main`) it is just the directory holding `.bare`, which tracks nothing; a
	// submodule's gitdir has no `commondir`, so it lands under `.git/modules`.
	if (canonicalizePath(join(mainRepoRoot, ".git")) !== commonGitDir) return undefined;
	const worktreeContextFile = loadContextFileFromDir(worktreeRoot);
	return worktreeContextFile ? join(mainRepoRoot, basename(worktreeContextFile.path)) : undefined;
}

export function loadProjectContextFiles(options: {
	cwd: string;
	agentDir: string;
}): Array<{ path: string; content: string }> {
	const resolvedCwd = resolvePath(options.cwd);
	const resolvedAgentDir = resolvePath(options.agentDir);

	const contextFiles: Array<{ path: string; content: string }> = [];
	const seenPaths = new Set<string>();

	const globalContext = loadContextFileFromDir(resolvedAgentDir);
	if (globalContext) {
		contextFiles.push(globalContext);
		seenPaths.add(globalContext.path);
	}

	const ancestorContextFiles: Array<{ path: string; content: string }> = [];

	const shadowedContextFile = findShadowedContextFile(resolvedCwd);
	let currentDir = resolvedCwd;

	while (true) {
		const contextFile = loadContextFileFromDir(currentDir);
		const isShadowed =
			shadowedContextFile !== undefined && canonicalizePath(contextFile?.path ?? "") === shadowedContextFile;
		if (contextFile && !isShadowed && !seenPaths.has(contextFile.path)) {
			ancestorContextFiles.unshift(contextFile);
			seenPaths.add(contextFile.path);
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}

	contextFiles.push(...ancestorContextFiles);

	return contextFiles;
}

export interface DefaultResourceLoaderOptions {
	cwd: string;
	agentDir: string;
	settingsManager?: SettingsManager;
	eventBus?: EventBus;
	additionalExtensionPaths?: string[];
	additionalSkillPaths?: string[];
	additionalPromptTemplatePaths?: string[];
	additionalThemePaths?: string[];
	extensionFactories?: InlineExtension[];
	noExtensions?: boolean;
	noSkills?: boolean;
	noPromptTemplates?: boolean;
	noThemes?: boolean;
	noContextFiles?: boolean;
	systemPrompt?: string;
	appendSystemPrompt?: string[];
	extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult;
	skillsOverride?: (base: { skills: LoadedSkill[]; diagnostics: ResourceDiagnostic[] }) => {
		skills: SkillInput[];
		diagnostics: ResourceDiagnostic[];
	};
	promptsOverride?: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => {
		prompts: PromptTemplate[];
		diagnostics: ResourceDiagnostic[];
	};
	themesOverride?: (base: { themes: Theme[]; diagnostics: ResourceDiagnostic[] }) => {
		themes: Theme[];
		diagnostics: ResourceDiagnostic[];
	};
	agentsFilesOverride?: (base: { agentsFiles: Array<{ path: string; content: string }> }) => {
		agentsFiles: Array<{ path: string; content: string }>;
	};
	systemPromptOverride?: (base: string | undefined) => string | undefined;
	appendSystemPromptOverride?: (base: string[]) => string[];
	/** c4d watcher test seams: injected watch factory/timers/intervals drive fs events deterministically. */
	watchOptions?: {
		watch?: ResourceWatchFactory;
		timers?: WatchTimers;
		debounceMs?: number;
		retryDelayMs?: number;
	};
}

export class DefaultResourceLoader implements ResourceLoader {
	private cwd: string;
	private agentDir: string;
	private settingsManager: SettingsManager;
	private eventBus: EventBus;
	private skillSetController: SkillSetController;
	private packageManager: DefaultPackageManager;
	private additionalExtensionPaths: string[];
	private additionalSkillPaths: string[];
	private additionalPromptTemplatePaths: string[];
	private additionalThemePaths: string[];
	private extensionFactories: InlineExtension[];
	private noExtensions: boolean;
	private noSkills: boolean;
	private noPromptTemplates: boolean;
	private noThemes: boolean;
	private noContextFiles: boolean;
	private systemPromptSource?: string;
	private appendSystemPromptSource?: string[];
	private extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult;
	private skillsOverride?: (base: { skills: LoadedSkill[]; diagnostics: ResourceDiagnostic[] }) => {
		skills: SkillInput[];
		diagnostics: ResourceDiagnostic[];
	};
	private promptsOverride?: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => {
		prompts: PromptTemplate[];
		diagnostics: ResourceDiagnostic[];
	};
	private themesOverride?: (base: { themes: Theme[]; diagnostics: ResourceDiagnostic[] }) => {
		themes: Theme[];
		diagnostics: ResourceDiagnostic[];
	};
	private agentsFilesOverride?: (base: { agentsFiles: Array<{ path: string; content: string }> }) => {
		agentsFiles: Array<{ path: string; content: string }>;
	};
	private systemPromptOverride?: (base: string | undefined) => string | undefined;
	private appendSystemPromptOverride?: (base: string[]) => string[];

	private extensionsResult: LoadExtensionsResult;
	private skills: LoadedSkill[];
	private skillDiagnostics: ResourceDiagnostic[];
	private prompts: PromptTemplate[];
	private promptDiagnostics: ResourceDiagnostic[];
	private commands: LoadedCommand[];
	private commandDiagnostics: ResourceDiagnostic[];
	private themes: Theme[];
	private themeDiagnostics: ResourceDiagnostic[];
	private agentsFiles: Array<{ path: string; content: string }>;
	private systemPrompt?: string;
	private systemPromptSourcePath?: string;
	private appendSystemPrompt: string[];
	private appendSystemPromptSourcePaths: string[];
	private lastSkillPaths: string[];
	private extensionSkillSourceInfos: Map<string, SourceInfo>;
	private extensionPromptSourceInfos: Map<string, SourceInfo>;
	private extensionThemeSourceInfos: Map<string, SourceInfo>;
	private resourceMetadataByPath: Map<string, PathMetadata>;
	private lastPromptPaths: string[];
	private lastThemePaths: string[];
	private loaded: boolean;
	/** c4d: retained scanned skill roots from the last reload (package-manager accessor + additionalSkillPaths). */
	private skillDiscoveryRootEntries: ScannedSkillRoot[];
	/** c4d: nested roots registered by tool-touch discovery, keyed by canonical root; persist across reload until trust is revoked. */
	private nestedSkillRoots: Map<string, { root: string; qualifier: string }>;
	/** c4d: last emitted scan-error per unregistered nested root, so per-tool-call retries do not re-warn identically. */
	private failedNestedScanErrors = new Map<string, string>();
	/** c4d: canonical leaf paths the last resolve() resolved as disabled; root re-scans must not resurrect them. */
	private disabledSkillLeafPaths: Set<string>;
	/** c4d: the loader-owned watcher; created lazily at the end of the first reload. */
	private resourceWatcher: ResourceWatcher | undefined;
	private watcherHealth: ResourceDiagnostic | undefined;
	private readonly resourceChangeListeners: Set<(event: ResourceLoaderChangeEvent) => void>;
	private disposed: boolean;
	private readonly watchOptions: DefaultResourceLoaderOptions["watchOptions"];
	constructor(options: DefaultResourceLoaderOptions) {
		this.cwd = resolvePath(options.cwd);
		this.agentDir = resolvePath(options.agentDir);
		this.settingsManager = options.settingsManager ?? SettingsManager.create(this.cwd, this.agentDir);
		this.eventBus = options.eventBus ?? createEventBus();
		this.skillSetController = getSkillSetController(this.eventBus);
		this.packageManager = new DefaultPackageManager({
			cwd: this.cwd,
			agentDir: this.agentDir,
			settingsManager: this.settingsManager,
		});
		this.additionalExtensionPaths = options.additionalExtensionPaths ?? [];
		this.additionalSkillPaths = options.additionalSkillPaths ?? [];
		this.additionalPromptTemplatePaths = options.additionalPromptTemplatePaths ?? [];
		this.additionalThemePaths = options.additionalThemePaths ?? [];
		this.extensionFactories = options.extensionFactories ?? [];
		this.noExtensions = options.noExtensions ?? false;
		this.noSkills = options.noSkills ?? false;
		this.noPromptTemplates = options.noPromptTemplates ?? false;
		this.noThemes = options.noThemes ?? false;
		this.noContextFiles = options.noContextFiles ?? false;
		this.systemPromptSource = options.systemPrompt;
		this.appendSystemPromptSource = options.appendSystemPrompt;
		this.extensionsOverride = options.extensionsOverride;
		this.skillsOverride = options.skillsOverride;
		this.promptsOverride = options.promptsOverride;
		this.themesOverride = options.themesOverride;
		this.agentsFilesOverride = options.agentsFilesOverride;
		this.systemPromptOverride = options.systemPromptOverride;
		this.appendSystemPromptOverride = options.appendSystemPromptOverride;

		this.extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
		this.skills = [];
		this.skillDiagnostics = [];
		this.prompts = [];
		this.promptDiagnostics = [];
		this.commands = [];
		this.commandDiagnostics = [];
		this.themes = [];
		this.themeDiagnostics = [];
		this.agentsFiles = [];
		this.appendSystemPrompt = [];
		this.appendSystemPromptSourcePaths = [];
		this.lastSkillPaths = [];
		this.extensionSkillSourceInfos = new Map();
		this.extensionPromptSourceInfos = new Map();
		this.extensionThemeSourceInfos = new Map();
		this.resourceMetadataByPath = new Map();
		this.lastPromptPaths = [];
		this.lastThemePaths = [];
		this.loaded = false;
		this.skillDiscoveryRootEntries = [];
		this.nestedSkillRoots = new Map();
		this.disabledSkillLeafPaths = new Set();
		this.resourceWatcher = undefined;
		this.watcherHealth = undefined;
		this.resourceChangeListeners = new Set();
		this.disposed = false;
		this.watchOptions = options.watchOptions;
	}

	getExtensions(): LoadExtensionsResult {
		return this.extensionsResult;
	}

	getSkills(): { skills: LoadedSkill[]; diagnostics: ResourceDiagnostic[] } {
		return { skills: this.skills, diagnostics: this.skillDiagnostics };
	}

	getEventBus(): EventBus {
		return this.eventBus;
	}

	/** The authoritative scanned skill-root set (c4d): retained roots, extension-registered paths, nested roots. */
	getScannedSkillRoots(): readonly ScannedSkillRoot[] {
		const roots: ScannedSkillRoot[] = [...this.skillDiscoveryRootEntries];
		for (const path of this.extensionSkillSourceInfos.keys()) {
			roots.push(this.toScannedSkillRoot(path));
		}
		for (const nested of this.nestedSkillRoots.values()) {
			roots.push({ scanPath: nested.root, dir: nested.root });
		}
		return roots;
	}

	/**
	 * Register a per-session change reaction (c4d). Registration synchronously replays
	 * the current degraded watcher-health so a failure raised before any listener bound
	 * is not lost; every callback runs under per-subscriber exception isolation.
	 */
	onResourceChange(listener: (event: ResourceLoaderChangeEvent) => void): () => void {
		this.resourceChangeListeners.add(listener);
		if (this.watcherHealth !== undefined) {
			try {
				listener({ kind: "watcher-health", health: this.watcherHealth });
			} catch {
				// Per-subscriber isolation: a throwing listener never blocks registration.
			}
		}
		return () => {
			this.resourceChangeListeners.delete(listener);
		};
	}

	/**
	 * Light skills+commands refresh (c4d): re-scan the retained roots plus the last
	 * resolved leaf set and rebuild the trust-gated command snapshot — no extension
	 * reload, no settings reload, no session lifecycle events. No-op semantic states
	 * are coalesced (state is assigned but nothing publishes or notifies).
	 */
	refreshSkillsAndCommands(): void {
		if (this.disposed || !this.loaded) return;
		const skillsCommitted = this.updateSkillsFromPaths(this.computeSkillScanInputs(), this.resourceMetadataByPath, {
			coalesce: true,
		});
		const commandsCommitted = this.updateCommands(this.resourceMetadataByPath, { coalesce: true });
		if (skillsCommitted || commandsCommitted) {
			this.notifyResourceChange({ kind: "refresh" });
		}
	}

	/**
	 * A.6 nested/monorepo discovery (c4d), trust-gated exactly like cwd's own project
	 * roots. Registration is a staged transaction: the root is probed and scanned off
	 * to the side, and any scan failure emits one diagnostic with zero A.9/resource
	 * publications and without marking the root scanned (a later touch retries).
	 */
	discoverNestedSkillRoots(touchedFile: string): void {
		if (this.disposed || !this.loaded) return;
		if (this.noSkills) return;
		if (!this.settingsManager.isProjectTrusted()) return;
		const scanned = new Set(this.getScannedSkillRoots().map((root) => canonicalizePath(root.dir)));
		const candidates = findNestedSkillRootCandidates({
			touchedFile,
			cwd: this.cwd,
			isAlreadyScanned: (canonicalRoot) => scanned.has(canonicalRoot),
		});
		for (const candidate of candidates) {
			const canonical = canonicalizePath(candidate.root);
			if (this.nestedSkillRoots.has(canonical)) continue;
			const scan = scanNestedSkillRoot(candidate.root);
			if (scan.error !== undefined) {
				// A failed root stays unregistered so a later touch retries, and touches fire
				// after every single-file tool call — so emit only when the failure is new or
				// its message changed, matching the watcher's one-per-episode dedup.
				if (this.failedNestedScanErrors.get(canonical) !== scan.error) {
					this.failedNestedScanErrors.set(canonical, scan.error);
					this.notifyResourceChange({
						kind: "diagnostic",
						diagnostic: {
							type: "warning",
							message: `nested skill root could not be scanned: ${scan.error}`,
							path: candidate.root,
						},
					});
				}
				continue;
			}
			this.failedNestedScanErrors.delete(canonical);
			this.nestedSkillRoots.set(canonical, candidate);
			try {
				this.refreshSkillsAndCommands();
			} catch {
				// Contained: the root is registered and watched, so the next watcher
				// cycle re-attempts the publish (converges without a tool touch).
			}
			this.syncWatcher();
		}
	}

	/** c4d: dispose the watcher and listeners. Idempotent. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.resourceWatcher?.dispose();
		this.resourceWatcher = undefined;
		this.resourceChangeListeners.clear();
	}

	getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
		return { prompts: this.prompts, diagnostics: this.promptDiagnostics };
	}

	getCommands(): { commands: readonly LoadedCommand[]; diagnostics: ResourceDiagnostic[] } {
		return { commands: this.commands, diagnostics: this.commandDiagnostics };
	}

	getThemes(): { themes: Theme[]; diagnostics: ResourceDiagnostic[] } {
		return { themes: this.themes, diagnostics: this.themeDiagnostics };
	}

	getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> } {
		return { agentsFiles: this.agentsFiles };
	}

	getSystemPrompt(): string | undefined {
		return this.systemPrompt;
	}

	getSystemPromptSource(): { path: string } | undefined {
		return this.systemPromptSourcePath ? { path: this.systemPromptSourcePath } : undefined;
	}

	getAppendSystemPrompt(): string[] {
		return this.appendSystemPrompt;
	}

	getAppendSystemPromptSources(): Array<{ path: string }> {
		return this.appendSystemPromptSourcePaths.map((path) => ({ path }));
	}

	extendResources(paths: ResourceExtensionPaths): void {
		if (this.disposed) return;
		const skillPaths = this.normalizeExtensionPaths(paths.skillPaths ?? []);
		const promptPaths = this.normalizeExtensionPaths(paths.promptPaths ?? []);
		const themePaths = this.normalizeExtensionPaths(paths.themePaths ?? []);

		for (const entry of skillPaths) {
			this.extensionSkillSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
		}
		for (const entry of promptPaths) {
			this.extensionPromptSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
		}
		for (const entry of themePaths) {
			this.extensionThemeSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
		}

		if (skillPaths.length > 0) {
			this.lastSkillPaths = this.mergePaths(
				this.lastSkillPaths,
				skillPaths.map((entry) => entry.path),
			);
			this.updateSkillsFromPaths(this.computeSkillScanInputs(), this.resourceMetadataByPath);
			// New extension-registered roots join the watched set.
			this.syncWatcher();
		}

		if (promptPaths.length > 0) {
			this.lastPromptPaths = this.mergePaths(
				this.lastPromptPaths,
				promptPaths.map((entry) => entry.path),
			);
			this.updatePromptsFromPaths(this.lastPromptPaths, this.resourceMetadataByPath);
			// Keep the grandfathered-command snapshot in sync with extension-added prompts.
			this.updateCommands(this.resourceMetadataByPath);
		}

		if (themePaths.length > 0) {
			this.lastThemePaths = this.mergePaths(
				this.lastThemePaths,
				themePaths.map((entry) => entry.path),
			);
			this.updateThemesFromPaths(this.lastThemePaths, this.resourceMetadataByPath);
		}
	}

	async loadProjectTrustExtensions(): Promise<LoadExtensionsResult> {
		// Force untrusted project settings for the bootstrap pass. This keeps project-local
		// extensions/packages out while still loading user/global and temporary CLI extensions.
		this.settingsManager.setProjectTrusted(false);
		await this.settingsManager.reload();
		return this.loadCurrentExtensionSet({ includeInlineFactories: true });
	}

	async reload(options?: ResourceLoaderReloadOptions): Promise<void> {
		resetTimings("extensions");

		if (this.loaded) {
			clearExtensionCache();
		}

		let preTrustExtensions: LoadExtensionsResult | undefined;
		if (options?.resolveProjectTrust) {
			preTrustExtensions = await this.loadProjectTrustExtensions();
			const projectTrusted = await options.resolveProjectTrust({ extensionsResult: preTrustExtensions });
			this.settingsManager.setProjectTrusted(projectTrusted);
		}

		// reload() preserves SettingsManager.projectTrusted and reloads settings for that trust state.
		await this.settingsManager.reload();
		// Nested roots are trust-gated exactly like cwd's own project roots (A.6): a trust
		// revocation drops them; rediscovery requires trust and a fresh tool touch.
		if (!this.settingsManager.isProjectTrusted()) {
			this.nestedSkillRoots.clear();
		}
		const resolvedPaths = await this.packageManager.resolve();
		// Retain the scanned skill roots independently of the resolved leaves (c4d): an
		// empty or not-yet-existing root stays watchable, and a root re-scan discovers
		// siblings created after startup. Disabled leaves are remembered so a root
		// re-scan does not resurrect what a settings pattern disabled.
		this.skillDiscoveryRootEntries = this.packageManager
			.getSkillDiscoveryRoots()
			.map(({ root, metadata, overrides }) => this.toScannedSkillRoot(root, metadata, overrides))
			// Roots scan in the same precedence order the resolved leaves scan in, so a
			// root re-scan cannot change collision winners: temporary (CLI) sources first,
			// then project-local, project-auto, user-local, user-auto, package.
			.sort((a, b) => skillRootPrecedenceRank(a) - skillRootPrecedenceRank(b));
		for (const p of this.additionalSkillPaths) {
			// CLI `--skill` paths scan last, exactly as mergePaths appends them today. They
			// carry NO metadata: prefix-labeling their leaves would shadow the loaded
			// skill's own sourceInfo (and any skillsOverride-provided one).
			this.skillDiscoveryRootEntries.push(this.toScannedSkillRoot(this.resolveResourcePath(p)));
		}
		this.disabledSkillLeafPaths = new Set(
			resolvedPaths.skills
				.filter((resource) => !resource.enabled)
				.map((resource) => canonicalizePath(resource.path)),
		);
		const cliExtensionPaths = await this.packageManager.resolveExtensionSources(this.additionalExtensionPaths, {
			temporary: true,
		});
		// Kept on the instance so post-reload passes (extendResources) can still resolve package metadata.
		this.resourceMetadataByPath = new Map();
		const metadataByPath = this.resourceMetadataByPath;

		this.extensionSkillSourceInfos = new Map();
		this.extensionPromptSourceInfos = new Map();
		this.extensionThemeSourceInfos = new Map();

		// Helper to extract enabled paths and store metadata
		const getEnabledResources = (resources: ResolvedResource[]): ResolvedResource[] => {
			for (const r of resources) {
				if (!metadataByPath.has(r.path)) {
					metadataByPath.set(r.path, r.metadata);
				}
			}
			return resources.filter((r) => r.enabled);
		};

		const getEnabledPaths = (resources: ResolvedResource[]): string[] =>
			getEnabledResources(resources).map((r) => r.path);
		const enabledExtensions = getEnabledPaths(resolvedPaths.extensions);
		const enabledSkillResources = getEnabledResources(resolvedPaths.skills);
		const enabledPrompts = getEnabledPaths(resolvedPaths.prompts);
		const enabledThemes = getEnabledPaths(resolvedPaths.themes);

		const enabledSkills = enabledSkillResources.map((resource) => this.mapSkillPath(resource, metadataByPath));

		// Add CLI paths metadata
		for (const r of cliExtensionPaths.extensions) {
			if (!metadataByPath.has(r.path)) {
				metadataByPath.set(r.path, { source: "cli", scope: "temporary", origin: "top-level" });
			}
		}
		for (const r of cliExtensionPaths.skills) {
			if (!metadataByPath.has(r.path)) {
				metadataByPath.set(r.path, { source: "cli", scope: "temporary", origin: "top-level" });
			}
		}

		const cliEnabledExtensions = getEnabledPaths(cliExtensionPaths.extensions);
		const cliEnabledSkills = getEnabledPaths(cliExtensionPaths.skills);
		const cliEnabledPrompts = getEnabledPaths(cliExtensionPaths.prompts);
		const cliEnabledThemes = getEnabledPaths(cliExtensionPaths.themes);

		const extensionPaths = this.noExtensions
			? cliEnabledExtensions
			: this.mergePaths(cliEnabledExtensions, enabledExtensions);

		const extensionsResult = await this.loadFinalExtensionSet(extensionPaths, preTrustExtensions);
		for (const p of this.additionalExtensionPaths) {
			if (isLocalPath(p)) {
				const resolved = this.resolveResourcePath(p);
				if (!existsSync(resolved)) {
					extensionsResult.errors.push({ path: resolved, error: `Extension path does not exist: ${resolved}` });
				}
			}
		}
		this.extensionsResult = this.extensionsOverride ? this.extensionsOverride(extensionsResult) : extensionsResult;
		this.applyExtensionSourceInfo(this.extensionsResult.extensions, metadataByPath);

		const skillPaths = this.noSkills
			? this.mergePaths(cliEnabledSkills, this.additionalSkillPaths)
			: this.mergePaths([...cliEnabledSkills, ...enabledSkills], this.additionalSkillPaths);

		this.lastSkillPaths = skillPaths;
		// Scan from the retained roots plus the resolved leaves (and any nested roots
		// registered during this reload's awaits) so a watcher refresh and a full reload
		// compute the same snapshot and converge after a race.
		this.updateSkillsFromPaths(this.computeSkillScanInputs(), metadataByPath);
		for (const p of this.additionalSkillPaths) {
			if (isLocalPath(p)) {
				const resolved = this.resolveResourcePath(p);
				if (!existsSync(resolved) && !this.skillDiagnostics.some((d) => d.path === resolved)) {
					this.skillDiagnostics.push({ type: "error", message: "Skill path does not exist", path: resolved });
				}
			}
		}

		const promptPaths = this.noPromptTemplates
			? this.mergePaths(cliEnabledPrompts, this.additionalPromptTemplatePaths)
			: this.mergePaths([...cliEnabledPrompts, ...enabledPrompts], this.additionalPromptTemplatePaths);

		this.lastPromptPaths = promptPaths;
		this.updatePromptsFromPaths(promptPaths, metadataByPath);
		for (const p of this.additionalPromptTemplatePaths) {
			if (isLocalPath(p)) {
				const resolved = this.resolveResourcePath(p);
				if (!existsSync(resolved) && !this.promptDiagnostics.some((d) => d.path === resolved)) {
					this.promptDiagnostics.push({
						type: "error",
						message: "Prompt template path does not exist",
						path: resolved,
					});
				}
			}
		}

		// Commands depend on the resolved prompt set and project trust, both settled above.
		this.updateCommands(metadataByPath);

		const themePaths = this.noThemes
			? this.mergePaths(cliEnabledThemes, this.additionalThemePaths)
			: this.mergePaths([...cliEnabledThemes, ...enabledThemes], this.additionalThemePaths);

		this.lastThemePaths = themePaths;
		this.updateThemesFromPaths(themePaths, metadataByPath);
		for (const p of this.additionalThemePaths) {
			const resolved = this.resolveResourcePath(p);
			if (!existsSync(resolved) && !this.themeDiagnostics.some((d) => d.path === resolved)) {
				this.themeDiagnostics.push({ type: "error", message: "Theme path does not exist", path: resolved });
			}
		}

		const agentsFiles = {
			agentsFiles: this.noContextFiles
				? []
				: loadProjectContextFiles({
						cwd: this.cwd,
						agentDir: this.agentDir,
					}),
		};
		const resolvedAgentsFiles = this.agentsFilesOverride ? this.agentsFilesOverride(agentsFiles) : agentsFiles;
		this.agentsFiles = resolvedAgentsFiles.agentsFiles;

		const systemPromptSource = this.systemPromptSource ?? this.discoverSystemPromptFile();
		const baseSystemPrompt = resolvePromptInput(systemPromptSource, "system prompt");
		this.systemPrompt = this.systemPromptOverride ? this.systemPromptOverride(baseSystemPrompt) : baseSystemPrompt;
		this.systemPromptSourcePath =
			systemPromptSource && existsSync(systemPromptSource) ? resolvePath(systemPromptSource) : undefined;

		let appendSources = this.appendSystemPromptSource;
		if (!appendSources) {
			const discoveredAppendSystemPromptFile = this.discoverAppendSystemPromptFile();
			appendSources = discoveredAppendSystemPromptFile ? [discoveredAppendSystemPromptFile] : [];
		}
		const baseAppend = appendSources
			.map((s) => resolvePromptInput(s, "append system prompt"))
			.filter((s): s is string => s !== undefined);
		this.appendSystemPrompt = this.appendSystemPromptOverride
			? this.appendSystemPromptOverride(baseAppend)
			: baseAppend;
		this.appendSystemPromptSourcePaths = appendSources
			.filter((source) => existsSync(source))
			.map((source) => resolvePath(source));
		this.loaded = true;
		// Start (or re-sync) live watching only after the initial load completes.
		this.syncWatcher();
	}
	private async loadCurrentExtensionSet(options: { includeInlineFactories: boolean }): Promise<LoadExtensionsResult> {
		const resolvedPaths = await this.packageManager.resolve();
		const cliExtensionPaths = await this.packageManager.resolveExtensionSources(this.additionalExtensionPaths, {
			temporary: true,
		});
		const enabledExtensions = resolvedPaths.extensions.filter((r) => r.enabled).map((r) => r.path);
		const cliEnabledExtensions = cliExtensionPaths.extensions.filter((r) => r.enabled).map((r) => r.path);
		const extensionPaths = this.noExtensions
			? cliEnabledExtensions
			: this.mergePaths(cliEnabledExtensions, enabledExtensions);
		const extensionsResult = await loadExtensionsCached(extensionPaths, this.cwd, this.agentDir, this.eventBus);
		if (!options.includeInlineFactories) {
			return extensionsResult;
		}

		const inlineExtensions = await this.loadExtensionFactories(extensionsResult.runtime);
		extensionsResult.extensions.push(...inlineExtensions.extensions);
		extensionsResult.errors.push(...inlineExtensions.errors);
		return extensionsResult;
	}

	private resolveExtensionLoadPath(path: string): string {
		return resolvePath(path, this.cwd, { normalizeUnicodeSpaces: true });
	}

	private async loadFinalExtensionSet(
		extensionPaths: string[],
		preTrustExtensions: LoadExtensionsResult | undefined,
	): Promise<LoadExtensionsResult> {
		if (!preTrustExtensions) {
			const extensionsResult = await loadExtensionsCached(extensionPaths, this.cwd, this.agentDir, this.eventBus);
			const inlineExtensions = await this.loadExtensionFactories(extensionsResult.runtime);
			extensionsResult.extensions.push(...inlineExtensions.extensions);
			extensionsResult.errors.push(...inlineExtensions.errors);
			this.addExtensionConflictDiagnostics(extensionsResult);
			return extensionsResult;
		}

		const preloadedByPath = new Map(
			preTrustExtensions.extensions
				.filter((extension) => !extension.path.startsWith("<inline:"))
				.map((extension) => [extension.resolvedPath, extension]),
		);
		const failedPreloadPaths = new Set(
			preTrustExtensions.errors.map((error) => this.resolveExtensionLoadPath(error.path)),
		);
		const remainingPaths = extensionPaths.filter((path) => {
			const resolvedPath = this.resolveExtensionLoadPath(path);
			return !preloadedByPath.has(resolvedPath) && !failedPreloadPaths.has(resolvedPath);
		});
		const remainingExtensions = await loadExtensionsCached(
			remainingPaths,
			this.cwd,
			this.agentDir,
			this.eventBus,
			preTrustExtensions.runtime,
		);
		const loadedByPath = new Map(preloadedByPath);
		for (const extension of remainingExtensions.extensions) {
			loadedByPath.set(extension.resolvedPath, extension);
		}

		const inlineExtensions = preTrustExtensions.extensions.filter((extension) =>
			extension.path.startsWith("<inline:"),
		);
		const orderedExtensions = extensionPaths
			.map((path) => loadedByPath.get(this.resolveExtensionLoadPath(path)))
			.filter((extension): extension is Extension => extension !== undefined);
		orderedExtensions.push(...inlineExtensions);

		const extensionsResult: LoadExtensionsResult = {
			extensions: orderedExtensions,
			errors: [...preTrustExtensions.errors, ...remainingExtensions.errors],
			runtime: preTrustExtensions.runtime,
		};
		this.addExtensionConflictDiagnostics(extensionsResult);
		return extensionsResult;
	}

	private addExtensionConflictDiagnostics(extensionsResult: LoadExtensionsResult): void {
		// Detect extension conflicts (tools, commands, flags with same names from different extensions)
		// Keep all extensions loaded. Conflicts are reported as diagnostics, and precedence is handled by load order.
		const conflicts = this.detectExtensionConflicts(extensionsResult.extensions);
		for (const conflict of conflicts) {
			extensionsResult.errors.push({ path: conflict.path, error: conflict.message });
		}
	}

	private mapSkillPath(resource: ResolvedResource, metadataByPath: Map<string, PathMetadata>): string {
		if (resource.metadata.source !== "auto" && resource.metadata.origin !== "package") {
			return resource.path;
		}
		try {
			const stats = statSync(resource.path);
			if (!stats.isDirectory()) {
				return resource.path;
			}
		} catch {
			return resource.path;
		}
		const skillFile = join(resource.path, "SKILL.md");
		if (existsSync(skillFile)) {
			if (!metadataByPath.has(skillFile)) {
				metadataByPath.set(skillFile, resource.metadata);
			}
			return skillFile;
		}
		return resource.path;
	}

	private normalizeExtensionPaths(
		entries: Array<{ path: string; metadata: PathMetadata }>,
	): Array<{ path: string; metadata: PathMetadata }> {
		return entries.map((entry) => {
			const metadata = entry.metadata.baseDir
				? { ...entry.metadata, baseDir: this.resolveResourcePath(entry.metadata.baseDir) }
				: entry.metadata;
			return {
				path: this.resolveResourcePath(entry.path),
				metadata,
			};
		});
	}

	/**
	 * Rebuild the skills snapshot from scan inputs. Computes the candidate fully before
	 * assigning and publishes synchronously after assignment, so a `skills:changed`
	 * subscriber always reads a complete loader state (no torn read). With `coalesce`
	 * (the watcher/nested light refresh) a duplicate semantic state is assigned without
	 * publishing or notifying. Returns whether a publish happened.
	 */
	private updateSkillsFromPaths(
		skillPaths: string[],
		metadataByPath?: Map<string, PathMetadata>,
		options?: { coalesce?: boolean },
	): boolean {
		let skillsResult: { skills: LoadedSkill[]; diagnostics: ResourceDiagnostic[] };
		if (this.noSkills && skillPaths.length === 0) {
			skillsResult = { skills: [], diagnostics: [] };
		} else {
			skillsResult = loadSkills({
				cwd: this.cwd,
				agentDir: this.agentDir,
				skillPaths,
				includeDefaults: false,
				qualifiedRoots: [...this.nestedSkillRoots.values()],
			});
		}
		// Root re-scans rediscover leaves a settings pattern disabled at resolve time; drop them
		// again. The path snapshot only covers leaves that existed at resolve time, so a leaf
		// created mid-session is re-evaluated against its root's retained override patterns —
		// otherwise the light refresh would publish what `/reload` filters out.
		if (this.disabledSkillLeafPaths.size > 0 || this.skillDiscoveryRootEntries.some((root) => root.overrides)) {
			skillsResult = {
				skills: skillsResult.skills.filter((skill) => {
					const canonical = canonicalizePath(skill.filePath);
					if (this.disabledSkillLeafPaths.has(canonical)) return false;
					const governing = this.governingSkillRoot(canonical);
					if (!governing?.overrides) return true;
					return isEnabledByOverrides(skill.filePath, governing.overrides.patterns, governing.overrides.baseDir);
				}),
				diagnostics: skillsResult.diagnostics,
			};
		}
		const resolvedSkills = this.skillsOverride ? this.skillsOverride(skillsResult) : skillsResult;
		const normalizationDiagnostics: ResourceDiagnostic[] = [];
		const augmentedMetadata = this.augmentMetadataWithRoots(metadataByPath);
		const nextSkills = resolvedSkills.skills.map((skill) => {
			const withSourceInfo: SkillInput = {
				...skill,
				sourceInfo:
					this.findSourceInfoForPath(skill.filePath, this.extensionSkillSourceInfos, augmentedMetadata) ??
					skill.sourceInfo ??
					this.getDefaultSourceInfoForPath(skill.filePath),
			};
			const normalized = normalizeSkillInput(withSourceInfo);
			normalizationDiagnostics.push(...normalized.diagnostics);
			return normalized.skill;
		});
		const nextDiagnostics = [...resolvedSkills.diagnostics, ...normalizationDiagnostics];
		if (
			options?.coalesce &&
			skillsSemanticallyEqual(nextSkills, this.skills) &&
			diagnosticsSignature(nextDiagnostics) === diagnosticsSignature(this.skillDiagnostics)
		) {
			this.skills = nextSkills;
			this.skillDiagnostics = nextDiagnostics;
			return false;
		}
		this.skills = nextSkills;
		this.skillDiagnostics = nextDiagnostics;
		// Publish the effective set (post-override, post-source-info, post-normalization) so
		// `getSkills()` and A.9 extension payloads describe the same skills.
		this.skillSetController.publish(this.skills);
		return true;
	}

	private updatePromptsFromPaths(promptPaths: string[], metadataByPath?: Map<string, PathMetadata>): void {
		let promptsResult: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
		if (this.noPromptTemplates && promptPaths.length === 0) {
			promptsResult = { prompts: [], diagnostics: [] };
		} else {
			const allPrompts = loadPromptTemplates({
				cwd: this.cwd,
				agentDir: this.agentDir,
				promptPaths,
				includeDefaults: false,
			});
			promptsResult = this.dedupePrompts(allPrompts);
		}
		const resolvedPrompts = this.promptsOverride ? this.promptsOverride(promptsResult) : promptsResult;
		this.prompts = resolvedPrompts.prompts.map((prompt) => ({
			...prompt,
			sourceInfo:
				this.findSourceInfoForPath(prompt.filePath, this.extensionPromptSourceInfos, metadataByPath) ??
				prompt.sourceInfo ??
				this.getDefaultSourceInfoForPath(prompt.filePath),
		}));
		this.promptDiagnostics = resolvedPrompts.diagnostics;
	}

	/**
	 * Rebuild the atomic command snapshot (A.7): user commands (always),
	 * project commands (only while the project is trusted), and the final
	 * resolved prompt templates adapted as grandfathered command sources. Called
	 * after prompts are resolved so a trust change or `/reload` refreshes the
	 * whole set at once; project commands disappear when trust is revoked.
	 */
	private updateCommands(metadataByPath?: Map<string, PathMetadata>, options?: { coalesce?: boolean }): boolean {
		const commands: LoadedCommand[] = [];
		const diagnostics: ResourceDiagnostic[] = [];
		const sourceFor = (filePath: string): SourceInfo =>
			this.findSourceInfoForPath(filePath, undefined, metadataByPath) ?? this.getDefaultSourceInfoForPath(filePath);

		const userResult = loadCommandsFromDir(join(this.agentDir, "commands"), sourceFor);
		commands.push(...userResult.commands);
		diagnostics.push(...userResult.diagnostics);

		if (this.settingsManager.isProjectTrusted()) {
			const projectResult = loadCommandsFromDir(join(this.cwd, CONFIG_DIR_NAME, "commands"), sourceFor);
			commands.push(...projectResult.commands);
			diagnostics.push(...projectResult.diagnostics);
		}

		const adapted = adaptPromptTemplates(this.prompts);
		commands.push(...adapted.commands);
		diagnostics.push(...adapted.diagnostics);

		if (
			options?.coalesce &&
			commandsSemanticallyEqual(commands, this.commands) &&
			diagnosticsSignature(diagnostics) === diagnosticsSignature(this.commandDiagnostics)
		) {
			// Semantically identical: keep the fresh objects (matching the skills
			// branch's `this.skills = nextSkills`) but publish/notify nothing.
			this.commands = commands;
			this.commandDiagnostics = diagnostics;
			return false;
		}
		this.commands = commands;
		this.commandDiagnostics = diagnostics;
		return true;
	}

	private updateThemesFromPaths(themePaths: string[], metadataByPath?: Map<string, PathMetadata>): void {
		let themesResult: { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
		if (this.noThemes && themePaths.length === 0) {
			themesResult = { themes: [], diagnostics: [] };
		} else {
			const loaded = this.loadThemes(themePaths, false);
			const deduped = this.dedupeThemes(loaded.themes);
			themesResult = { themes: deduped.themes, diagnostics: [...loaded.diagnostics, ...deduped.diagnostics] };
		}
		const resolvedThemes = this.themesOverride ? this.themesOverride(themesResult) : themesResult;
		this.themes = resolvedThemes.themes.map((theme) => {
			const sourcePath = theme.sourcePath;
			theme.sourceInfo = sourcePath
				? (this.findSourceInfoForPath(sourcePath, this.extensionThemeSourceInfos, metadataByPath) ??
					theme.sourceInfo ??
					this.getDefaultSourceInfoForPath(sourcePath))
				: theme.sourceInfo;
			return theme;
		});
		this.themeDiagnostics = resolvedThemes.diagnostics;
	}

	private applyExtensionSourceInfo(extensions: Extension[], metadataByPath: Map<string, PathMetadata>): void {
		for (const extension of extensions) {
			extension.sourceInfo =
				this.findSourceInfoForPath(extension.path, undefined, metadataByPath) ??
				this.getDefaultSourceInfoForPath(extension.path);
			for (const command of extension.commands.values()) {
				command.sourceInfo = extension.sourceInfo;
			}
			for (const tool of extension.tools.values()) {
				tool.sourceInfo = extension.sourceInfo;
			}
		}
	}

	private findSourceInfoForPath(
		resourcePath: string,
		extraSourceInfos?: Map<string, SourceInfo>,
		metadataByPath?: Map<string, PathMetadata>,
	): SourceInfo | undefined {
		if (!resourcePath) {
			return undefined;
		}

		if (resourcePath.startsWith("<")) {
			return this.getDefaultSourceInfoForPath(resourcePath);
		}

		const normalizedResourcePath = resolve(resourcePath);
		if (extraSourceInfos) {
			for (const [sourcePath, sourceInfo] of extraSourceInfos.entries()) {
				const normalizedSourcePath = resolve(sourcePath);
				if (
					normalizedResourcePath === normalizedSourcePath ||
					normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
				) {
					return { ...sourceInfo, path: resourcePath };
				}
			}
		}

		if (metadataByPath) {
			const exact = metadataByPath.get(normalizedResourcePath) ?? metadataByPath.get(resourcePath);
			if (exact) {
				return createSourceInfo(resourcePath, exact);
			}

			for (const [sourcePath, metadata] of metadataByPath.entries()) {
				const normalizedSourcePath = resolve(sourcePath);
				if (
					normalizedResourcePath === normalizedSourcePath ||
					normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
				) {
					return createSourceInfo(resourcePath, metadata);
				}
			}
		}

		return undefined;
	}

	private getDefaultSourceInfoForPath(filePath: string): SourceInfo {
		if (filePath.startsWith("<") && filePath.endsWith(">")) {
			return {
				path: filePath,
				source: filePath.slice(1, -1).split(":")[0] || "temporary",
				scope: "temporary",
				origin: "top-level",
			};
		}

		const normalizedPath = resolve(filePath);
		const agentRoots = [
			join(this.agentDir, "skills"),
			join(this.agentDir, "prompts"),
			join(this.agentDir, "commands"),
			join(this.agentDir, "themes"),
			join(this.agentDir, "extensions"),
		];
		const projectRoots = [
			join(this.cwd, CONFIG_DIR_NAME, "skills"),
			join(this.cwd, CONFIG_DIR_NAME, "prompts"),
			join(this.cwd, CONFIG_DIR_NAME, "commands"),
			join(this.cwd, CONFIG_DIR_NAME, "themes"),
			join(this.cwd, CONFIG_DIR_NAME, "extensions"),
		];

		for (const root of agentRoots) {
			if (this.isUnderPath(normalizedPath, root)) {
				return { path: filePath, source: "local", scope: "user", origin: "top-level", baseDir: root };
			}
		}

		for (const root of projectRoots) {
			if (this.isUnderPath(normalizedPath, root)) {
				return { path: filePath, source: "local", scope: "project", origin: "top-level", baseDir: root };
			}
		}

		return {
			path: filePath,
			source: "local",
			scope: "temporary",
			origin: "top-level",
			baseDir: statSync(normalizedPath).isDirectory() ? normalizedPath : resolve(normalizedPath, ".."),
		};
	}

	private mergePaths(primary: string[], additional: string[]): string[] {
		const merged: string[] = [];
		const seen = new Set<string>();

		for (const p of [...primary, ...additional]) {
			const resolved = this.resolveResourcePath(p);
			const canonicalPath = canonicalizePath(resolved);
			if (seen.has(canonicalPath)) continue;
			seen.add(canonicalPath);
			merged.push(resolved);
		}

		return merged;
	}

	private resolveResourcePath(p: string): string {
		return resolvePath(p, this.cwd, { trim: true });
	}

	/**
	 * The retained root that governs a leaf: the longest matching root directory, so a
	 * nested root's own patterns win over an ancestor's.
	 */
	private governingSkillRoot(canonicalLeafPath: string): ScannedSkillRoot | undefined {
		let best: ScannedSkillRoot | undefined;
		let bestLength = -1;
		for (const root of this.skillDiscoveryRootEntries) {
			const dir = canonicalizePath(root.dir);
			if (canonicalLeafPath !== dir && !canonicalLeafPath.startsWith(`${dir}/`)) continue;
			if (dir.length > bestLength) {
				best = root;
				bestLength = dir.length;
			}
		}
		return best;
	}

	/** Normalize a configured skill path (dir or direct file) into a scanned-root entry (c4d). */
	private toScannedSkillRoot(
		path: string,
		metadata?: PathMetadata,
		overrides?: ScannedSkillRoot["overrides"],
	): ScannedSkillRoot {
		let isFile = false;
		try {
			isFile = statSync(path).isFile();
		} catch {
			// A not-yet-existing `.md` path is a direct skill file watched via its parent.
			isFile = path.endsWith(".md");
		}
		const extra = { ...(metadata && { metadata }), ...(overrides && { overrides }) };
		if (isFile) {
			return { scanPath: path, dir: dirname(path), file: path, ...extra };
		}
		return { scanPath: path, dir: path, ...extra };
	}

	/**
	 * The scan inputs every skills build shares (reload and light refresh alike, so a
	 * reload/refresh race converges): retained roots that exist, the last resolved leaf
	 * set (enable-filtered at resolve time, incl. CLI and extension paths), and the
	 * registered nested roots. Reading the nested set at call time is what lets a full
	 * reload() pick up a root registered during its awaits.
	 */
	private computeSkillScanInputs(): string[] {
		const inputs: string[] = [];
		const seen = new Set<string>();
		const add = (path: string) => {
			const canonical = canonicalizePath(path);
			if (seen.has(canonical)) return;
			seen.add(canonical);
			inputs.push(path);
		};
		if (!this.noSkills) {
			for (const entry of this.skillDiscoveryRootEntries) {
				if (existsSync(entry.scanPath)) add(entry.scanPath);
			}
		}
		for (const path of this.lastSkillPaths) {
			add(path);
		}
		for (const nested of this.nestedSkillRoots.values()) {
			if (existsSync(nested.root)) add(nested.root);
		}
		return inputs;
	}

	/** Root metadata joins the leaf map so a not-yet-resolved sibling under a known root keeps the root's trust/source labeling. */
	private augmentMetadataWithRoots(metadataByPath?: Map<string, PathMetadata>): Map<string, PathMetadata> | undefined {
		if (
			metadataByPath === undefined &&
			this.skillDiscoveryRootEntries.length === 0 &&
			this.nestedSkillRoots.size === 0
		) {
			return undefined;
		}
		const augmented = new Map(metadataByPath ?? []);
		for (const entry of this.skillDiscoveryRootEntries) {
			if (entry.metadata && !augmented.has(entry.scanPath)) {
				augmented.set(entry.scanPath, entry.metadata);
			}
		}
		for (const nested of this.nestedSkillRoots.values()) {
			if (!augmented.has(nested.root)) {
				augmented.set(nested.root, {
					source: "local",
					scope: "project",
					origin: "top-level",
					baseDir: dirname(dirname(nested.root)),
				});
			}
		}
		return augmented;
	}

	/** Watcher root set (c4d): every scanned skill root plus both command roots. */
	private computeWatchRoots(): WatchedResourceRoot[] {
		const roots: WatchedResourceRoot[] = [];
		for (const root of this.getScannedSkillRoots()) {
			roots.push({ dir: root.dir, ...(root.file && { file: root.file }) });
		}
		roots.push({ dir: join(this.agentDir, "commands") });
		if (this.settingsManager.isProjectTrusted()) {
			roots.push({ dir: join(this.cwd, CONFIG_DIR_NAME, "commands") });
		}
		return roots;
	}

	/** Create the watcher lazily and re-sync its root set (initial load, reload, nested registration). */
	private syncWatcher(): void {
		if (this.disposed) return;
		if (!this.resourceWatcher) {
			this.resourceWatcher = new ResourceWatcher({
				onRefreshNeeded: () => this.refreshSkillsAndCommands(),
				onHealthChange: (health) => this.setWatcherHealth(health),
				...(this.watchOptions?.watch && { watch: this.watchOptions.watch }),
				...(this.watchOptions?.timers && { timers: this.watchOptions.timers }),
				...(this.watchOptions?.debounceMs !== undefined && { debounceMs: this.watchOptions.debounceMs }),
				...(this.watchOptions?.retryDelayMs !== undefined && { retryDelayMs: this.watchOptions.retryDelayMs }),
			});
		}
		this.resourceWatcher.setRoots(this.computeWatchRoots());
	}

	private setWatcherHealth(health: ResourceDiagnostic | undefined): void {
		this.watcherHealth = health;
		this.notifyResourceChange({ kind: "watcher-health", health });
	}

	private notifyResourceChange(event: ResourceLoaderChangeEvent): void {
		for (const listener of this.resourceChangeListeners) {
			try {
				listener(event);
			} catch {
				// Per-subscriber isolation: one throwing session listener never blocks the rest.
			}
		}
	}

	private loadThemes(
		paths: string[],
		includeDefaults: boolean = true,
	): {
		themes: Theme[];
		diagnostics: ResourceDiagnostic[];
	} {
		const themes: Theme[] = [];
		const diagnostics: ResourceDiagnostic[] = [];
		if (includeDefaults) {
			const defaultDirs = [join(this.agentDir, "themes"), join(this.cwd, CONFIG_DIR_NAME, "themes")];

			for (const dir of defaultDirs) {
				this.loadThemesFromDir(dir, themes, diagnostics);
			}
		}

		for (const p of paths) {
			const resolved = this.resolveResourcePath(p);
			if (!existsSync(resolved)) {
				diagnostics.push({ type: "warning", message: "theme path does not exist", path: resolved });
				continue;
			}

			try {
				const stats = statSync(resolved);
				if (stats.isDirectory()) {
					this.loadThemesFromDir(resolved, themes, diagnostics);
				} else if (stats.isFile() && resolved.endsWith(".json")) {
					this.loadThemeFromFile(resolved, themes, diagnostics);
				} else {
					diagnostics.push({ type: "warning", message: "theme path is not a json file", path: resolved });
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "failed to read theme path";
				diagnostics.push({ type: "warning", message, path: resolved });
			}
		}

		return { themes, diagnostics };
	}

	private loadThemesFromDir(dir: string, themes: Theme[], diagnostics: ResourceDiagnostic[]): void {
		if (!existsSync(dir)) {
			return;
		}

		try {
			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				let isFile = entry.isFile();
				if (entry.isSymbolicLink()) {
					try {
						isFile = statSync(join(dir, entry.name)).isFile();
					} catch {
						continue;
					}
				}
				if (!isFile) {
					continue;
				}
				if (!entry.name.endsWith(".json")) {
					continue;
				}
				this.loadThemeFromFile(join(dir, entry.name), themes, diagnostics);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "failed to read theme directory";
			diagnostics.push({ type: "warning", message, path: dir });
		}
	}

	private loadThemeFromFile(filePath: string, themes: Theme[], diagnostics: ResourceDiagnostic[]): void {
		try {
			themes.push(loadThemeFromPath(filePath));
		} catch (error) {
			const message = error instanceof Error ? error.message : "failed to load theme";
			diagnostics.push({ type: "warning", message, path: filePath });
		}
	}

	private async loadExtensionFactories(runtime: ExtensionRuntime): Promise<{
		extensions: Extension[];
		errors: Array<{ path: string; error: string }>;
	}> {
		const extensions: Extension[] = [];
		const errors: Array<{ path: string; error: string }> = [];

		for (const [index, input] of this.extensionFactories.entries()) {
			const isNamed = typeof input !== "function";
			const factory = isNamed ? input.factory : input;
			const extensionPath = `<inline:${isNamed ? input.name : index + 1}>`;
			try {
				const extension = await loadExtensionFromFactory(
					factory,
					this.cwd,
					this.agentDir,
					this.eventBus,
					runtime,
					extensionPath,
				);
				extension.hidden = isNamed && input.hidden;
				extensions.push(extension);
			} catch (error) {
				const message = error instanceof Error ? error.message : "failed to load extension";
				errors.push({ path: extensionPath, error: message });
			}
		}

		return { extensions, errors };
	}

	private dedupePrompts(prompts: PromptTemplate[]): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
		const seen = new Map<string, PromptTemplate>();
		const diagnostics: ResourceDiagnostic[] = [];

		for (const prompt of prompts) {
			const existing = seen.get(prompt.name);
			if (existing) {
				diagnostics.push({
					type: "collision",
					message: `name "/${prompt.name}" collision`,
					path: prompt.filePath,
					collision: {
						resourceType: "prompt",
						name: prompt.name,
						winnerPath: existing.filePath,
						loserPath: prompt.filePath,
					},
				});
			} else {
				seen.set(prompt.name, prompt);
			}
		}

		return { prompts: Array.from(seen.values()), diagnostics };
	}

	private dedupeThemes(themes: Theme[]): { themes: Theme[]; diagnostics: ResourceDiagnostic[] } {
		const seen = new Map<string, Theme>();
		const diagnostics: ResourceDiagnostic[] = [];

		for (const t of themes) {
			const name = t.name ?? "unnamed";
			const existing = seen.get(name);
			if (existing) {
				diagnostics.push({
					type: "collision",
					message: `name "${name}" collision`,
					path: t.sourcePath,
					collision: {
						resourceType: "theme",
						name,
						winnerPath: existing.sourcePath ?? "<builtin>",
						loserPath: t.sourcePath ?? "<builtin>",
					},
				});
			} else {
				seen.set(name, t);
			}
		}

		return { themes: Array.from(seen.values()), diagnostics };
	}

	private discoverSystemPromptFile(): string | undefined {
		const projectPath = join(this.cwd, CONFIG_DIR_NAME, "SYSTEM.md");
		if (this.settingsManager.isProjectTrusted() && existsSync(projectPath)) {
			return projectPath;
		}

		const globalPath = join(this.agentDir, "SYSTEM.md");
		if (existsSync(globalPath)) {
			return globalPath;
		}

		return undefined;
	}

	private discoverAppendSystemPromptFile(): string | undefined {
		const projectPath = join(this.cwd, CONFIG_DIR_NAME, "APPEND_SYSTEM.md");
		if (this.settingsManager.isProjectTrusted() && existsSync(projectPath)) {
			return projectPath;
		}

		const globalPath = join(this.agentDir, "APPEND_SYSTEM.md");
		if (existsSync(globalPath)) {
			return globalPath;
		}

		return undefined;
	}

	private isUnderPath(target: string, root: string): boolean {
		const normalizedRoot = resolve(root);
		if (target === normalizedRoot) {
			return true;
		}
		const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
		return target.startsWith(prefix);
	}

	private detectExtensionConflicts(extensions: Extension[]): Array<{ path: string; message: string }> {
		const conflicts: Array<{ path: string; message: string }> = [];

		// Track which extension registered each tool and flag
		const toolOwners = new Map<string, string>();
		const flagOwners = new Map<string, string>();

		for (const ext of extensions) {
			// Check tools
			for (const toolName of ext.tools.keys()) {
				const existingOwner = toolOwners.get(toolName);
				if (existingOwner && existingOwner !== ext.path) {
					conflicts.push({
						path: ext.path,
						message: `Tool "${toolName}" conflicts with ${existingOwner}`,
					});
				} else {
					toolOwners.set(toolName, ext.path);
				}
			}

			// Check flags
			for (const flagName of ext.flags.keys()) {
				const existingOwner = flagOwners.get(flagName);
				if (existingOwner && existingOwner !== ext.path) {
					conflicts.push({
						path: ext.path,
						message: `Flag "--${flagName}" conflicts with ${existingOwner}`,
					});
				} else {
					flagOwners.set(flagName, ext.path);
				}
			}
		}

		return conflicts;
	}
}

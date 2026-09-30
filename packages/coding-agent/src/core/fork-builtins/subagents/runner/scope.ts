/**
 * Fork-owned: what a child session may load and call (D22, plan Section 2.1 "Subagent tools in
 * children" and "Tool-scoping workaround"). pi-subagents `src/agent-runner.ts` at 79a7c42 is the
 * behavior reference for extension selection and `ext:` narrowing.
 *
 * - `tools:` names Pi's tools, fork base tools and any other tool the parent's live registry knows.
 *   Omitted, or `*`, it selects Pi's seven coding tools. A name nobody knows warns.
 * - A fork base tool reaches a child only when `tools:` names it; otherwise it joins `excludeTools`.
 * - `Agent`, `get_subagent_result` and `steer_subagent` reach a child only as injected nested tools.
 * - `extensions:`, `exclude_extensions:` and `isolated` decide which extensions load, inline
 *   built-ins such as `<inline:tokensave>` included; `ext:` selectors narrow which of their tools
 *   stay active, re-applied as tools register late. `disallowed_tools` wins over everything.
 *
 * Children leave `allowedToolNames` unset, because it is fixed at construction and would drop
 * tools that extensions register later; scope goes through `excludeTools` and the active set.
 */
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentSession } from "../../../agent-session.ts";
import type { LoadExtensionsResult } from "../../../extensions/types.ts";
import type { DefaultResourceLoader } from "../../../resource-loader.ts";
import { allToolNames } from "../../../tools/index.ts";
import type { AgentDefinition } from "../definitions/types.ts";
import { AGENT_TOOL_NAME, GET_RESULT_TOOL_NAME, STEER_TOOL_NAME } from "../names.ts";

/** The subagent tools a child receives only as its owner's injected nested tools (T6). */
export const SUBAGENT_TOOL_NAMES: readonly string[] = [AGENT_TOOL_NAME, GET_RESULT_TOOL_NAME, STEER_TOOL_NAME];

/** What an omitted `tools:` or `*` selects: pi-subagents' seven built-ins. */
export const DEFAULT_CHILD_TOOLS: readonly string[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];

/** Every tool Pi itself registers; a child is denied each one its `tools:` does not select. */
export const PI_TOOL_NAMES: readonly string[] = [...allToolNames];

export interface ToolScopeInput {
	definition: AgentDefinition;
	isolated: boolean;
	/** Tool names the parent's live registry holds. */
	knownToolNames: ReadonlySet<string>;
	/** The fork base tools a session registers (`forkBaseToolNames`). */
	forkBaseToolNames: readonly string[];
	/** Names of the tools injected as `customTools` (T6's nested tools). */
	injectedToolNames: readonly string[];
	/** Memory access the agent's memory block grants: read-write adds read, write and edit; read-only adds read. */
	memory?: "read-write" | "read-only";
}

export interface ToolScope {
	/** Plain tool names the child keeps active. */
	selected: ReadonlySet<string>;
	/** Names removed from the child's registry. */
	excludeTools: string[];
	/** Extension names the `ext:` selectors keep; empty means every loaded extension's tools. */
	extNames: ReadonlySet<string>;
	/** Per extension, the only tools `ext:<extension>/<tool>` keeps. */
	narrowing: ReadonlyMap<string, ReadonlySet<string>>;
	disallowed: ReadonlySet<string>;
	/** Injected tools the child keeps active whatever else applies. */
	readmit: ReadonlySet<string>;
	warnings: ScopeWarning[];
}

/** A scoping problem, reported on the child's activity and never fatal: a subagent spawns mid-task. */
export interface ScopeWarning {
	type: "tools-error" | "extension-error";
	message: string;
}

/** Whether the agent can write, which decides its memory access (pi-subagents `src/memory.ts`). */
export function hasWriteTools(definition: AgentDefinition): boolean {
	const selected = selectedPlainTools(definition.tools);
	const denied = new Set(definition.disallowedTools ?? []);
	return ["write", "edit"].some((name) => selected.has(name) && !denied.has(name));
}

/** The plain tool names `tools:` selects: `*` and an omitted list mean Pi's seven coding tools; `ext:` selectors are left out. */
export function selectedPlainTools(tools: readonly string[] | undefined): Set<string> {
	const entries = tools ?? ["*"];
	const selected = new Set<string>();
	for (const entry of entries) {
		if (entry === "*") for (const name of DEFAULT_CHILD_TOOLS) selected.add(name);
		else if (!entry.startsWith("ext:")) selected.add(entry);
	}
	return selected;
}

export function resolveToolScope(input: ToolScopeInput): ToolScope {
	const { definition } = input;
	const warnings: ScopeWarning[] = [];
	const selected = selectedPlainTools(definition.tools);
	if (input.memory === "read-write") for (const name of ["read", "write", "edit"]) selected.add(name);
	if (input.memory === "read-only") selected.add("read");
	const disallowed = new Set(definition.disallowedTools ?? []);
	const injected = new Set(input.injectedToolNames);

	for (const name of definition.tools ?? []) {
		if (name === "*" || name.startsWith("ext:")) continue;
		if (SUBAGENT_TOOL_NAMES.includes(name)) {
			warnings.push({
				type: "tools-error",
				message: `agent "${definition.name}" names "${name}" in tools:, but a subagent receives it only through allowed_subagents`,
			});
		} else if (!input.knownToolNames.has(name) && !PI_TOOL_NAMES.includes(name)) {
			warnings.push({
				type: "tools-error",
				message: `tool "${name}" requested by agent "${definition.name}" is not a known tool`,
			});
		}
	}

	const exclude = new Set<string>();
	for (const name of SUBAGENT_TOOL_NAMES) if (!injected.has(name)) exclude.add(name);
	for (const name of input.forkBaseToolNames) if (!selected.has(name) && !injected.has(name)) exclude.add(name);
	for (const name of PI_TOOL_NAMES) if (!selected.has(name)) exclude.add(name);
	for (const name of disallowed) exclude.add(name);

	const { extNames, narrowing } = parseExtSelectors(input.isolated ? [] : (definition.tools ?? []));
	return {
		selected,
		excludeTools: [...exclude],
		extNames,
		narrowing,
		disallowed,
		readmit: new Set([...injected].filter((name) => !disallowed.has(name))),
		warnings,
	};
}

/** `ext:foo` keeps every tool of `foo`; `ext:foo/bar` narrows `foo` to `bar`. Extension names are case-insensitive. */
function parseExtSelectors(entries: readonly string[]): {
	extNames: Set<string>;
	narrowing: Map<string, Set<string>>;
} {
	const extNames = new Set<string>();
	const narrowing = new Map<string, Set<string>>();
	for (const entry of entries) {
		if (!entry.startsWith("ext:")) continue;
		const body = entry.slice("ext:".length);
		const slash = body.indexOf("/");
		const name = (slash === -1 ? body : body.slice(0, slash)).trim().toLowerCase();
		if (!name) continue;
		extNames.add(name);
		const tool = slash === -1 ? "" : body.slice(slash + 1).trim();
		if (!tool) continue;
		const tools = narrowing.get(name) ?? new Set<string>();
		tools.add(tool);
		narrowing.set(name, tools);
	}
	return { extNames, narrowing };
}

/**
 * The names an extension answers to, lowercased: `<inline:name>` answers to `name`; a path
 * extension to its file name (its directory for an `index` entry) and to the short name of the
 * package whose `pi.extensions` declares it.
 */
export function extensionNames(path: string): string[] {
	const inline = /^<inline:(.+)>$/.exec(path);
	if (inline) return [inline[1].toLowerCase()];
	const base = basename(path);
	const canonical = (
		base === "index.ts" || base === "index.js" ? basename(dirname(path)) : base.replace(/\.(ts|js)$/, "")
	).toLowerCase();
	const pkg = declaringPackageName(path);
	return pkg && pkg !== canonical ? [canonical, pkg] : [canonical];
}

/** The unscoped name of the package that owns `path` and lists it in `pi.extensions`. Never climbs past `node_modules`. */
function declaringPackageName(path: string): string | undefined {
	const entry = resolve(path);
	let dir = dirname(path);
	for (;;) {
		if (basename(dir) === "node_modules") return undefined;
		let manifest: { name?: unknown; pi?: { extensions?: unknown } };
		try {
			manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
		} catch {
			const parent = dirname(dir);
			if (parent === dir) return undefined;
			dir = parent;
			continue;
		}
		const entries = manifest.pi?.extensions;
		if (
			typeof manifest.name === "string" &&
			Array.isArray(entries) &&
			entries.some((item) => typeof item === "string" && resolve(dir, item) === entry)
		) {
			const name = manifest.name;
			return (name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name).toLowerCase();
		}
		return undefined;
	}
}

export interface ExtensionPlan {
	noExtensions: boolean;
	additionalExtensionPaths: string[];
	extensionsOverride: (base: LoadExtensionsResult) => LoadExtensionsResult;
	/** Warnings about requested, excluded and selected extensions, read after the loader's reload. */
	check(loader: DefaultResourceLoader): ScopeWarning[];
}

/** The real path, symlinks resolved and in the disk's own case; the path itself when it does not exist. */
function realOrSelf(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		return path;
	}
}

function isInside(path: string, root: string): boolean {
	const rel = relative(root, path);
	// A directory named like `..helpers` is inside; only `..` itself or a `../` prefix leaves the root.
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Which extensions a child loads. `false` or `isolated` loads none: `noExtensions` skips path
 * extensions and the override drops the inline built-ins, which load under `noExtensions` too
 * (ADR-0009). A list keeps the named ones (a path entry loads that file; `*` keeps all), and
 * `exclude_extensions` wins. The override sees inline built-ins because they load first. In an
 * untrusted project, a path that resolves inside the project is refused: an explicit path bypasses
 * the loader's own trust gate.
 */
export function resolveExtensionPlan(
	definition: AgentDefinition,
	isolated: boolean,
	cwd: string,
	projectTrusted: boolean,
): ExtensionPlan {
	const agent = definition.name;
	const extensions = isolated ? false : definition.extensions;
	const exclude = new Set(isolated ? [] : (definition.excludeExtensions ?? []).map((name) => name.toLowerCase()));
	const { extNames } = parseExtSelectors(isolated ? [] : (definition.tools ?? []));
	const keep = new Set<string>();
	const paths: string[] = [];
	const refused: string[] = [];
	let wildcard = extensions === true;
	for (const entry of Array.isArray(extensions) ? extensions : []) {
		if (entry === "*") {
			wildcard = true;
			continue;
		}
		if (!entry.includes("/") && !entry.includes("\\") && !entry.startsWith("~")) {
			keep.add(entry.toLowerCase());
			continue;
		}
		const expanded = entry === "~" || entry.startsWith("~/") ? join(homedir(), entry.slice(1)) : entry;
		const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
		if (!projectTrusted && isInside(realOrSelf(absolute), realOrSelf(cwd))) {
			refused.push(entry);
			continue;
		}
		paths.push(absolute);
		for (const name of extensionNames(absolute)) keep.add(name);
	}
	let discovered = new Set<string>();
	return {
		noExtensions: extensions === false,
		additionalExtensionPaths: paths,
		extensionsOverride: (base) => {
			discovered = new Set(base.extensions.flatMap((extension) => extensionNames(extension.path)));
			return {
				...base,
				extensions: base.extensions.filter((extension) => {
					const names = extensionNames(extension.path);
					if (names.some((name) => exclude.has(name))) return false;
					return wildcard || names.some((name) => keep.has(name));
				}),
			};
		},
		check(loader) {
			const messages = refused.map(
				(entry) =>
					`extension path "${entry}" for agent "${agent}" is inside an untrusted project; it was not loaded`,
			);
			if (exclude.size > 0 && extensions === false) {
				messages.push(`exclude_extensions has no effect for agent "${agent}": extensions: false loads nothing`);
			}
			for (const name of exclude) {
				if (extensions !== false && !discovered.has(name)) {
					messages.push(
						`exclude_extensions: "${name}" for agent "${agent}" did not match any discovered extension`,
					);
				}
			}
			const surviving = new Set(
				loader.getExtensions().extensions.flatMap((extension) => extensionNames(extension.path)),
			);
			for (const name of keep) {
				if (surviving.has(name)) continue;
				messages.push(
					exclude.has(name)
						? `extension "${name}" is in both extensions: and exclude_extensions: for agent "${agent}"; the exclusion wins`
						: `extension "${name}" requested by agent "${agent}" was not loaded`,
				);
			}
			for (const name of extNames) {
				if (surviving.has(name)) continue;
				messages.push(
					`ext:${name} referenced by agent "${agent}", but extension "${name}" is not loaded (check extensions: and exclude_extensions:)`,
				);
			}
			return messages.map((message) => ({ type: "extension-error", message }));
		},
	};
}

/**
 * Keeps the child's active set inside its scope as extensions register tools. Re-narrows now and
 * after every turn, and blocks a call to an out-of-scope tool, which covers a tool registered
 * inside a turn before the next re-narrow. The block also sits in the pre-lookup gate, which calls
 * other tools make through ctx.executeTool() pass too; those can reach `codemode` and `deferred`
 * tools the active set leaves out. Returns the re-narrow for the runner to call before each prompt.
 * The listeners die with the session.
 */
export function installToolScope(session: AgentSession, loader: DefaultResourceLoader, scope: ToolScope): () => void {
	const inScope = (): Set<string> => {
		const keep = new Set([...scope.selected].filter((name) => !scope.disallowed.has(name)));
		for (const extension of loader.getExtensions().extensions) {
			const names = extensionNames(extension.path);
			if (scope.extNames.size > 0 && !names.some((name) => scope.extNames.has(name))) continue;
			const narrowed = names.map((name) => scope.narrowing.get(name)).find(Boolean);
			for (const tool of extension.tools.keys()) {
				if (narrowed && !narrowed.has(tool)) continue;
				if (!scope.disallowed.has(tool)) keep.add(tool);
			}
		}
		for (const name of SUBAGENT_TOOL_NAMES) keep.delete(name);
		for (const name of scope.readmit) keep.add(name);
		return keep;
	};
	const renarrow = () => {
		const allowed = inScope();
		const next = session
			.getAllTools()
			.map((tool) => tool.name)
			.filter((name) => allowed.has(name));
		const current = session.getActiveToolNames();
		if (next.length !== current.length || next.some((name, index) => name !== current[index])) {
			session.setActiveToolsByName(next);
		}
	};
	renarrow();
	session.subscribe((event) => {
		if (event.type === "turn_end") renarrow();
	});
	const outOfScope = (name: string) => `Tool "${name}" is not available to this subagent.`;
	const previous = session.agent.beforeToolCall;
	session.agent.beforeToolCall = async (context, signal) => {
		if (!inScope().has(context.toolCall.name)) {
			return { block: true, reason: outOfScope(context.toolCall.name) };
		}
		return previous?.(context, signal);
	};
	// Only registered tools: an unknown name keeps its not-found result and redirect (ADR-0006).
	const previousDisallowed = session.agent.isToolCallDisallowed;
	session.agent.isToolCallDisallowed = (name) =>
		session.getToolDefinition(name) && !inScope().has(name) ? outOfScope(name) : previousDisallowed?.(name);
	return renarrow;
}

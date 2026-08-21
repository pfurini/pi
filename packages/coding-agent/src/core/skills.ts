import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import ignore from "ignore";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.ts";
import { parseFrontmatter } from "../utils/frontmatter.ts";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import {
	type LoadedSkill,
	normalizeSkillInput,
	type SkillFrontmatter,
	validateSkillDescription,
} from "./skills/frontmatter.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.ts";

export type { LoadedSkill, Skill, SkillFrontmatter, SkillInput } from "./skills/frontmatter.ts";
export {
	extractSkillListingBlock,
	formatSkillsForPrompt,
	SKILL_LISTING_END_DELIMITER,
	SKILL_LISTING_START_DELIMITER,
	SKILL_LISTING_VERSION,
} from "./skills/listing.ts";

const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];

type IgnoreMatcher = ReturnType<typeof ignore>;

function isClaudeOwnedPath(path: string): boolean {
	return canonicalizePath(path)
		.split(/[\\/]+/)
		.some((segment) => segment === ".claude");
}

function isolationDiagnostic(path: string): ResourceDiagnostic {
	return { type: "warning", message: "skill path is inside a Claude Code-owned .claude directory", path };
}

function toPosixPath(p: string): string {
	return p.split(sep).join("/");
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("#") && !trimmed.startsWith("\\#")) return null;

	let pattern = line;
	let negated = false;

	if (pattern.startsWith("!")) {
		negated = true;
		pattern = pattern.slice(1);
	} else if (pattern.startsWith("\\!")) {
		pattern = pattern.slice(1);
	}

	if (pattern.startsWith("/")) {
		pattern = pattern.slice(1);
	}

	const prefixed = prefix ? `${prefix}${pattern}` : pattern;
	return negated ? `!${prefixed}` : prefixed;
}

function addIgnoreRules(ig: IgnoreMatcher, dir: string, rootDir: string, diagnostics: ResourceDiagnostic[]): void {
	const relativeDir = relative(rootDir, dir);
	const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : "";

	for (const filename of IGNORE_FILE_NAMES) {
		const ignorePath = join(dir, filename);
		if (isClaudeOwnedPath(ignorePath)) {
			diagnostics.push(isolationDiagnostic(ignorePath));
			continue;
		}
		if (!existsSync(ignorePath)) continue;
		try {
			const content = readFileSync(ignorePath, "utf-8");
			const patterns = content
				.split(/\r?\n/)
				.map((line) => prefixIgnorePattern(line, prefix))
				.filter((line): line is string => Boolean(line));
			if (patterns.length > 0) {
				ig.add(patterns);
			}
		} catch {}
	}
}

export interface LoadSkillsResult {
	skills: LoadedSkill[];
	diagnostics: ResourceDiagnostic[];
}

export interface LoadSkillsFromDirOptions {
	/** Directory to scan for skills */
	dir: string;
	/** Source identifier for these skills */
	source: string;
	/**
	 * Traversal-failure signal (c4d nested registration): invoked when a directory
	 * cannot be read. Without it a traversal failure is indistinguishable from a
	 * valid empty result (the scan is best-effort by default).
	 */
	onTraversalError?: (path: string, error: unknown) => void;
}
function createSkillSourceInfo(filePath: string, baseDir: string, source: string): SourceInfo {
	switch (source) {
		case "user":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				scope: "user",
				baseDir,
			});
		case "project":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				scope: "project",
				baseDir,
			});
		case "path":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				baseDir,
			});
		default:
			return createSyntheticSourceInfo(filePath, { source, baseDir });
	}
}

/**
 * Load skills from a directory.
 *
 * Discovery rules:
 * - if a directory contains SKILL.md, treat it as a skill root and do not recurse further
 * - otherwise, load direct .md children in the root
 * - recurse into subdirectories to find SKILL.md
 */
export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult {
	const { dir, source } = options;
	return loadSkillsFromDirInternal(dir, source, true, undefined, undefined, options.onTraversalError);
}

function loadSkillsFromDirInternal(
	dir: string,
	source: string,
	includeRootFiles: boolean,
	ignoreMatcher?: IgnoreMatcher,
	rootDir?: string,
	onTraversalError?: (path: string, error: unknown) => void,
): LoadSkillsResult {
	const skills: LoadedSkill[] = [];
	const diagnostics: ResourceDiagnostic[] = [];

	if (isClaudeOwnedPath(dir)) {
		diagnostics.push(isolationDiagnostic(dir));
		return { skills, diagnostics };
	}
	if (!existsSync(dir)) {
		return { skills, diagnostics };
	}

	const root = rootDir ?? dir;
	const ig = ignoreMatcher ?? ignore();
	addIgnoreRules(ig, dir, root, diagnostics);

	try {
		const entries = readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.name !== "SKILL.md") {
				continue;
			}

			const fullPath = join(dir, entry.name);
			if (isClaudeOwnedPath(fullPath)) {
				diagnostics.push(isolationDiagnostic(fullPath));
				continue;
			}
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					isFile = statSync(fullPath).isFile();
				} catch {
					continue;
				}
			}

			const relPath = toPosixPath(relative(root, fullPath));
			if (!isFile || ig.ignores(relPath)) {
				continue;
			}

			const result = loadSkillFromFile(fullPath, source);
			if (result.skill) {
				skills.push(result.skill);
			}
			diagnostics.push(...result.diagnostics);
			return { skills, diagnostics };
		}

		for (const entry of entries) {
			if (entry.name === "SKILL.md") {
				continue;
			}
			const fullPath = join(dir, entry.name);
			if (isClaudeOwnedPath(fullPath)) {
				diagnostics.push(isolationDiagnostic(fullPath));
				continue;
			}
			if (entry.name.startsWith(".")) {
				continue;
			}

			// Skip node_modules to avoid scanning dependencies
			if (entry.name === "node_modules") {
				continue;
			}

			// For symlinks, check if they point to a directory and follow them
			let isDirectory = entry.isDirectory();
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isDirectory = stats.isDirectory();
					isFile = stats.isFile();
				} catch {
					// Broken symlink, skip it
					continue;
				}
			}

			const relPath = toPosixPath(relative(root, fullPath));
			const ignorePath = isDirectory ? `${relPath}/` : relPath;
			if (ig.ignores(ignorePath)) {
				continue;
			}

			if (isDirectory) {
				const subResult = loadSkillsFromDirInternal(fullPath, source, false, ig, root, onTraversalError);
				skills.push(...subResult.skills);
				diagnostics.push(...subResult.diagnostics);
				continue;
			}

			if (!isFile || !includeRootFiles || !entry.name.endsWith(".md")) {
				continue;
			}

			const result = loadSkillFromFile(fullPath, source);
			if (result.skill) {
				skills.push(result.skill);
			}
			diagnostics.push(...result.diagnostics);
		}
	} catch (error) {
		// Best-effort by default; the c4d nested-registration path observes this via onTraversalError.
		onTraversalError?.(dir, error);
	}

	return { skills, diagnostics };
}

function loadSkillFromFile(
	filePath: string,
	source: string,
): { skill: LoadedSkill | null; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];
	if (isClaudeOwnedPath(filePath)) {
		diagnostics.push(isolationDiagnostic(filePath));
		return { skill: null, diagnostics };
	}
	try {
		const rawContent = readFileSync(filePath, "utf-8");
		const { frontmatter } = parseFrontmatter<SkillFrontmatter>(rawContent);
		const skillDir = dirname(filePath);
		const parentDirName = basename(skillDir);
		const description = typeof frontmatter.description === "string" ? frontmatter.description : undefined;
		if (!description || description.trim() === "") {
			for (const error of validateSkillDescription(description)) {
				diagnostics.push({ type: "warning", message: error, path: filePath });
			}
			return { skill: null, diagnostics };
		}

		const name =
			typeof frontmatter.name === "string" && frontmatter.name.trim() !== "" ? frontmatter.name : parentDirName;
		const normalized = normalizeSkillInput({
			name,
			description,
			filePath,
			baseDir: skillDir,
			sourceInfo: createSkillSourceInfo(filePath, skillDir, source),
			disableModelInvocation: false,
			frontmatter,
		});
		diagnostics.push(...normalized.diagnostics);
		return { skill: normalized.skill, diagnostics };
	} catch (error) {
		const message = error instanceof Error ? error.message : "failed to parse skill file";
		diagnostics.push({ type: "warning", message, path: filePath });
		return { skill: null, diagnostics };
	}
}

export interface LoadSkillsOptions {
	/** Working directory for project-local skills. */
	cwd: string;
	/** Agent config directory for global skills. */
	agentDir: string;
	/** Explicit skill paths (files or directories) */
	skillPaths: string[];
	/** Include default skills directories. */
	includeDefaults: boolean;
	/**
	 * A.6 nested roots (c4d): a skill loaded from under one of these roots whose
	 * bare name collides is NOT dropped; it is kept under the dir-qualified
	 * listingName `<qualifier>:<name>` while the incumbent keeps the bare name.
	 * A still-colliding qualified name falls back to loser-drop + diagnostic.
	 */
	qualifiedRoots?: readonly QualifiedSkillRoot[];
}

/** A nested skill-discovery root whose colliding skills get the A.6 dir-qualified name. */
export interface QualifiedSkillRoot {
	/** Absolute root directory (compared canonicalized). */
	root: string;
	/** Root-relative qualifier, posixified (A.6: `apps/web` → `apps/web:deploy`). */
	qualifier: string;
}
/**
 * Load skills from all configured locations.
 * Returns skills and any validation diagnostics.
 */
export function loadSkills(options: LoadSkillsOptions): LoadSkillsResult {
	const { agentDir, skillPaths, includeDefaults } = options;

	// Resolve agentDir - if not provided, use default from config
	const resolvedCwd = resolvePath(options.cwd);
	const resolvedAgentDir = resolvePath(agentDir ?? getAgentDir());

	const skillMap = new Map<string, LoadedSkill>();
	const realPathSet = new Set<string>();
	const takenListingNames = new Set<string>();
	const allDiagnostics: ResourceDiagnostic[] = [];
	const collisionDiagnostics: ResourceDiagnostic[] = [];

	const qualifiedRoots = (options.qualifiedRoots ?? []).map((qualifiedRoot) => ({
		canonicalRoot: canonicalizePath(qualifiedRoot.root),
		qualifier: qualifiedRoot.qualifier,
	}));
	const qualifierFor = (skill: LoadedSkill): string | undefined => {
		const filePath = canonicalizePath(skill.filePath);
		for (const { canonicalRoot, qualifier } of qualifiedRoots) {
			if (filePath === canonicalRoot || filePath.startsWith(`${canonicalRoot}${sep}`)) {
				return qualifier;
			}
		}
		return undefined;
	};

	function addSkills(result: LoadSkillsResult) {
		allDiagnostics.push(...result.diagnostics);
		for (const skill of result.skills) {
			// Resolve symlinks to detect duplicate files
			const realPath = canonicalizePath(skill.filePath);

			// Skip silently if we've already loaded this exact file (via symlink)
			if (realPathSet.has(realPath)) {
				continue;
			}

			const dropLoser = () => {
				const existing = skillMap.get(skill.name);
				collisionDiagnostics.push({
					type: "collision",
					message: `name "${skill.name}" collision`,
					path: skill.filePath,
					collision: {
						resourceType: "skill",
						name: skill.name,
						winnerPath: existing?.filePath ?? skill.filePath,
						loserPath: skill.filePath,
					},
				});
			};

			const existing = skillMap.get(skill.name);
			if (existing) {
				// A.6 nested collision (c4d): a skill from a qualified nested root is kept
				// under its dir-qualified listingName; the incumbent keeps the bare name.
				const qualifier = qualifierFor(skill);
				const qualifiedName = qualifier ? `${qualifier}:${skill.name}` : undefined;
				if (qualifiedName !== undefined && !takenListingNames.has(qualifiedName)) {
					const qualifiedSkill: LoadedSkill = { ...skill, listingName: qualifiedName };
					skillMap.set(qualifiedName, qualifiedSkill);
					takenListingNames.add(qualifiedName);
					realPathSet.add(realPath);
				} else {
					dropLoser();
				}
			} else {
				skillMap.set(skill.name, skill);
				takenListingNames.add(skill.listingName);
				realPathSet.add(realPath);
			}
		}
	}
	if (includeDefaults) {
		addSkills(loadSkillsFromDirInternal(join(resolvedAgentDir, "skills"), "user", true));
		addSkills(loadSkillsFromDirInternal(resolve(resolvedCwd, CONFIG_DIR_NAME, "skills"), "project", true));
	}

	const userSkillsDir = join(resolvedAgentDir, "skills");
	const projectSkillsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "skills");

	const isUnderPath = (target: string, root: string): boolean => {
		const normalizedRoot = resolve(root);
		if (target === normalizedRoot) {
			return true;
		}
		const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
		return target.startsWith(prefix);
	};

	const getSource = (resolvedPath: string): "user" | "project" | "path" => {
		if (!includeDefaults) {
			if (isUnderPath(resolvedPath, userSkillsDir)) return "user";
			if (isUnderPath(resolvedPath, projectSkillsDir)) return "project";
		}
		return "path";
	};

	for (const rawPath of skillPaths) {
		const resolvedPath = resolvePath(rawPath, resolvedCwd, { trim: true });
		if (isClaudeOwnedPath(resolvedPath)) {
			allDiagnostics.push(isolationDiagnostic(resolvedPath));
			continue;
		}
		if (!existsSync(resolvedPath)) {
			allDiagnostics.push({ type: "warning", message: "skill path does not exist", path: resolvedPath });
			continue;
		}

		try {
			const stats = statSync(resolvedPath);
			const source = getSource(resolvedPath);
			if (stats.isDirectory()) {
				addSkills(loadSkillsFromDirInternal(resolvedPath, source, true));
			} else if (stats.isFile() && resolvedPath.endsWith(".md")) {
				const result = loadSkillFromFile(resolvedPath, source);
				if (result.skill) {
					addSkills({ skills: [result.skill], diagnostics: result.diagnostics });
				} else {
					allDiagnostics.push(...result.diagnostics);
				}
			} else {
				allDiagnostics.push({ type: "warning", message: "skill path is not a markdown file", path: resolvedPath });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "failed to read skill path";
			allDiagnostics.push({ type: "warning", message, path: resolvedPath });
		}
	}

	return {
		skills: Array.from(skillMap.values()),
		diagnostics: [...allDiagnostics, ...collisionDiagnostics],
	};
}

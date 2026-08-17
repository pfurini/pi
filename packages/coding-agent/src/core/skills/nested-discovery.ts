import { readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalizePath } from "../../utils/paths.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import { loadSkillsFromDir } from "../skills.ts";
import type { LoadedSkill } from "./frontmatter.ts";

/**
 * A.6 nested/monorepo discovery (c4d): a tool-touched file whose ancestor
 * directories (between the session cwd and the file) contain a `.pi/skills/`
 * or `.agents/skills/` root not already scanned makes that root a discovery
 * candidate. Pure path logic lives here (ADR-0003); the loader owns
 * registration and publication.
 */

export interface NestedSkillRootCandidate {
	/** Absolute `.pi/skills` or `.agents/skills` root directory. */
	root: string;
	/** A.6 dir qualifier: the root's containing package dir relative to cwd, posixified (`apps/web`). */
	qualifier: string;
}

export interface NestedRootScanResult {
	skills: LoadedSkill[];
	diagnostics: ResourceDiagnostic[];
	/** Set when the root could not be fully scanned (unreadable/disappeared/partially readable). */
	error?: string;
}

function toPosix(path: string): string {
	return path.split(sep).join("/");
}

function hasClaudeSegment(path: string): boolean {
	return path.split(/[\\/]+/).some((segment) => segment === ".claude");
}

/** A.6 qualifier derivation: strip `.pi/skills` / `.agents/skills`, relativize to cwd, posixify. */
export function deriveNestedQualifier(root: string, cwd: string): string {
	const packageDir = dirname(dirname(root));
	const rel = toPosix(relative(cwd, packageDir));
	return rel === "" ? basename(packageDir) : rel;
}

/**
 * Return unscanned nested skill roots between cwd and the touched file (never above cwd,
 * never under `.claude/`). A root that does not exist on disk is not a candidate — the
 * watcher's nearest-ancestor coverage and later touches handle roots created afterwards.
 */
export function findNestedSkillRootCandidates(input: {
	touchedFile: string;
	cwd: string;
	isAlreadyScanned: (canonicalRoot: string) => boolean;
}): NestedSkillRootCandidate[] {
	const cwd = resolve(input.cwd);
	const file = isAbsolute(input.touchedFile) ? resolve(input.touchedFile) : resolve(cwd, input.touchedFile);
	if (hasClaudeSegment(file)) {
		return [];
	}

	const candidates: NestedSkillRootCandidate[] = [];
	let dir = dirname(file);
	while (dir !== cwd && dir.startsWith(`${cwd}${sep}`)) {
		for (const container of [".pi", ".agents"]) {
			const root = join(dir, container, "skills");
			if (hasClaudeSegment(root)) {
				continue;
			}
			let isDirectory = false;
			try {
				isDirectory = statSync(root).isDirectory();
			} catch {
				isDirectory = false;
			}
			if (!isDirectory) {
				continue;
			}
			if (input.isAlreadyScanned(canonicalizePath(root))) {
				continue;
			}
			candidates.push({ root, qualifier: deriveNestedQualifier(root, cwd) });
		}
		dir = dirname(dir);
	}
	return candidates;
}

/**
 * Scan a nested root with an explicit error signal. `loadSkillsFromDir` is best-effort
 * (a traversal failure returns an ordinary empty result), so registration probes the root
 * before AND after the scan and collects traversal errors: any failure yields `error` and
 * the caller must publish nothing and leave the root unregistered (a later touch retries).
 */
export function scanNestedSkillRoot(root: string): NestedRootScanResult {
	const probe = (): string | undefined => {
		try {
			readdirSync(root);
			return undefined;
		} catch (error) {
			return error instanceof Error ? error.message : "failed to read nested skill root";
		}
	};

	const probeError = probe();
	if (probeError !== undefined) {
		return { skills: [], diagnostics: [], error: probeError };
	}

	const traversalErrors: string[] = [];
	const result = loadSkillsFromDir({
		dir: root,
		source: "project",
		onTraversalError: (path, error) => {
			traversalErrors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
		},
	});

	const commitProbeError = probe();
	if (commitProbeError !== undefined) {
		return { skills: [], diagnostics: [], error: commitProbeError };
	}
	if (traversalErrors.length > 0) {
		return {
			skills: [],
			diagnostics: result.diagnostics,
			error: `partially readable nested skill root: ${traversalErrors.join("; ")}`,
		};
	}
	return { skills: result.skills, diagnostics: result.diagnostics };
}

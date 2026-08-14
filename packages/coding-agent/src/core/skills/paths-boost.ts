import { isAbsolute, relative } from "node:path";
import { minimatch } from "minimatch";
import type { LoadedSkill } from "./frontmatter.ts";

export interface SkillPathsBoostResult {
	ordered: LoadedSkill[];
	exemptIds: Set<string>;
}

function toPosix(path: string): string {
	return path.replace(/\\/g, "/");
}

export function byListingName(a: LoadedSkill, b: LoadedSkill): number {
	return a.listingName.localeCompare(b.listingName);
}

function normalizePathList(value: unknown): string[] {
	if (typeof value === "string") {
		return [value];
	}
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((entry): entry is string => typeof entry === "string");
}

function safeMinimatch(target: string, pattern: string): boolean {
	try {
		return minimatch(target, pattern, { nocase: true });
	} catch {
		return false;
	}
}

interface NormalizedTouchedPath {
	relPosix: string;
	absPosix: string;
}

function normalizeTouchedPath(touchedPath: string, cwd: string): NormalizedTouchedPath {
	const absoluteTouched = isAbsolute(touchedPath) ? touchedPath : `${cwd}/${touchedPath}`;
	return { relPosix: toPosix(relative(cwd, absoluteTouched)), absPosix: toPosix(absoluteTouched) };
}

function patternsMatchTouched(patterns: string[], touched: readonly NormalizedTouchedPath[]): boolean {
	for (const pattern of patterns) {
		const normalizedPattern = toPosix(pattern);
		for (const { relPosix, absPosix } of touched) {
			if (safeMinimatch(relPosix, normalizedPattern) || safeMinimatch(absPosix, normalizedPattern)) {
				return true;
			}
		}
	}
	return false;
}

/** Return the file path a successful tool call touched, or undefined for non-file-touch tools. */
export function skillPathTouchFromToolCall(toolName: string, args: unknown): string | undefined {
	if (toolName !== "read" && toolName !== "edit" && toolName !== "write") {
		return undefined;
	}
	if (typeof args !== "object" || args === null) {
		return undefined;
	}
	const path = (args as Record<string, unknown>).path;
	return typeof path === "string" ? path : undefined;
}

/**
 * Boost skills whose `paths` glob matches a recently tool-touched file to the front of the
 * listing (A.6). Total and non-throwing: malformed `paths` or oversized glob patterns are
 * skipped rather than failing the whole listing build.
 */
export function boostSkillsByPaths(
	skills: readonly LoadedSkill[],
	touchedPaths: readonly string[],
	cwd: string,
): SkillPathsBoostResult {
	const boosted: LoadedSkill[] = [];
	const rest: LoadedSkill[] = [];
	const exemptIds = new Set<string>();
	const normalizedTouched = touchedPaths.map((touchedPath) => normalizeTouchedPath(touchedPath, cwd));

	for (const skill of skills) {
		const patterns = normalizePathList(skill.frontmatter.paths);
		const isBoosted = patterns.length > 0 && patternsMatchTouched(patterns, normalizedTouched);
		if (isBoosted) {
			boosted.push(skill);
			exemptIds.add(skill.id);
		} else {
			rest.push(skill);
		}
	}

	boosted.sort(byListingName);
	rest.sort(byListingName);

	return { ordered: [...boosted, ...rest], exemptIds };
}

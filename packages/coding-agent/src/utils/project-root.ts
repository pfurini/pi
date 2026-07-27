import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Directory entries that mark the root of a checkout. `.git` is matched with
 * existsSync rather than a directory check on purpose: in a worktree or a
 * submodule it is a file pointing at the real git dir, and both are roots.
 */
export const PROJECT_ROOT_MARKERS = [".git", ".hg", ".svn", ".jj"] as const;

/**
 * Nearest ancestor of `startDir` (inclusive) that looks like a project root, or
 * null when there is none. Walks to the filesystem root, so callers that need a
 * boundary must use the return value as one - a null result means "no project
 * here", not "use /".
 */
export function findProjectRoot(startDir: string, markers: readonly string[] = PROJECT_ROOT_MARKERS): string | null {
	let current = resolve(startDir);
	while (true) {
		for (const marker of markers) {
			if (existsSync(join(current, marker))) return current;
		}
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

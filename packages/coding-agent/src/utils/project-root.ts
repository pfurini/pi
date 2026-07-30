import { lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Directory entries that mark the root of a checkout. */
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
			try {
				// lstat, not existsSync: the marker only has to exist as a directory
				// entry. In a worktree or submodule `.git` is a file, and when it is a
				// symlink to a gitdir that has moved or lives on an unmounted volume,
				// existsSync follows the link and reports false - which walks past a
				// real project root and puts ancestor instructions back in the prompt.
				lstatSync(join(current, marker));
				return current;
			} catch {
				// no such entry; try the next marker
			}
		}
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

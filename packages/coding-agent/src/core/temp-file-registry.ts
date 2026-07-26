import { unlinkSync } from "node:fs";

/**
 * Ceiling on a full-output temp file. Without one, a runaway command writes its entire output to
 * tmpdir at disk speed: nothing about a fast disk prevents that, it just fills faster. Matches the
 * per-stream spill cap execCommand applies for the same reason.
 */
export const DEFAULT_MAX_TEMP_FILE_BYTES = 64 * 1024 * 1024;

/**
 * Temp files pi writes for output that did not fit in memory (pi.exec spills, full bash output)
 * outlive the call that produced them on purpose: the caller, and often the model, still wants to
 * read them. Nothing else deletes them, so a long session would otherwise leave tmpdir growing for
 * the life of the machine.
 *
 * Registered paths are unlinked when the process exits normally. Only paths this process created
 * are ever removed, never a tmpdir glob, so a concurrent pi keeps its own live files. An abnormal
 * termination (SIGKILL, power loss) still leaves them behind.
 */
const registeredPaths = new Set<string>();
let exitCleanupRegistered = false;

export function registerTempFile(path: string): void {
	registeredPaths.add(path);
	if (exitCleanupRegistered) return;
	exitCleanupRegistered = true;
	process.on("exit", () => {
		for (const registeredPath of registeredPaths) {
			try {
				unlinkSync(registeredPath);
			} catch {
				// Best effort: the file may already be gone, or the caller may have moved it.
			}
		}
		registeredPaths.clear();
	});
}

/** Stop tracking a path that has already been removed. */
export function forgetTempFile(path: string): void {
	registeredPaths.delete(path);
}

/** Test-only view of what would be cleaned up at exit. */
export function getRegisteredTempFiles(): string[] {
	return [...registeredPaths];
}

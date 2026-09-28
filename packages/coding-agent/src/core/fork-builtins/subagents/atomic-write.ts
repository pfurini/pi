/**
 * Fork-owned: whole-file replacement for the files the subagents module writes (plan P27): the
 * project `settings.json` and, from the `/agents` menu, agent files. A reader sees the old file or
 * the new one, never a truncated one, and a failed write changes nothing.
 */
import { closeSync, openSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";

/**
 * Writes `text` to `<target>.<pid>.tmp` in the target's directory, then renames it over `target`.
 * The temporary file is created exclusively (`wx`), so a path another file or a symlink already
 * holds refuses the write and stays untouched. A failed write or rename leaves `target` unchanged
 * and removes only the temporary file this call created. An existing target's permission bits carry
 * over to the new file.
 */
export function writeFileAtomically(target: string, text: string): void {
	const temporary = `${target}.${process.pid}.tmp`;
	const mode = statSync(target, { throwIfNoEntry: false })?.mode;
	let fd: number;
	try {
		fd = openSync(temporary, "wx", mode === undefined ? 0o666 : mode & 0o777);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new Error(`Refusing to write ${target}: the temporary path ${temporary} already exists.`);
		}
		throw error;
	}
	let renamed = false;
	try {
		try {
			writeFileSync(fd, text, "utf8");
		} finally {
			closeSync(fd);
		}
		renameSync(temporary, target);
		renamed = true;
	} finally {
		if (!renamed) rmSync(temporary, { force: true });
	}
}

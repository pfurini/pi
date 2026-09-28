// Fork-owned: whole-file replacement for subagent files (plan T3, P27). A failed write leaves the
// target as it was and no temporary file, and a temporary path another file holds is never touched.
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeFileAtomically } from "../../../src/core/fork-builtins/subagents/atomic-write.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		chmodSync(root, 0o755);
		rmSync(root, { recursive: true, force: true });
	}
});

function scratch(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-subagent-atomic-"));
	roots.push(root);
	return root;
}

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("writeFileAtomically", () => {
	it("replaces an existing file whole and keeps its permission bits", () => {
		const root = scratch();
		const target = join(root, "agent.md");
		writeFileSync(target, "old");
		chmodSync(target, 0o600);
		const before = statSync(target).ino;
		writeFileAtomically(target, "new");
		expect(readFileSync(target, "utf8")).toBe("new");
		expect(statSync(target).ino).not.toBe(before);
		expect(statSync(target).mode & 0o777).toBe(0o600);
		expect(readdirSync(root)).toEqual(["agent.md"]);
	});

	it("leaves the target and no temporary file when the directory is read-only", () => {
		const root = scratch();
		const target = join(root, "agent.md");
		writeFileSync(target, "old");
		const hash = sha(target);
		chmodSync(root, 0o555);
		expect(() => writeFileAtomically(target, "new")).toThrow();
		chmodSync(root, 0o755);
		expect(sha(target)).toBe(hash);
		expect(readdirSync(root)).toEqual(["agent.md"]);
	});

	it("leaves the target and no temporary file when the rename fails", () => {
		const root = scratch();
		// A directory at the target path makes the rename of a file over it fail.
		const target = join(root, "agent.md");
		mkdirSync(target);
		writeFileSync(join(target, "inside"), "kept");
		expect(() => writeFileAtomically(target, "new")).toThrow();
		expect(statSync(target).isDirectory()).toBe(true);
		expect(readFileSync(join(target, "inside"), "utf8")).toBe("kept");
		expect(readdirSync(root)).toEqual(["agent.md"]);
	});

	it("refuses when its temporary path exists, and neither overwrites nor deletes what is there", () => {
		const root = scratch();
		const target = join(root, "agent.md");
		writeFileSync(target, "old");
		const hash = sha(target);
		const temporary = `${target}.${process.pid}.tmp`;
		writeFileSync(temporary, "someone else's");
		expect(() => writeFileAtomically(target, "new")).toThrow(`the temporary path ${temporary} already exists`);
		expect(readFileSync(temporary, "utf8")).toBe("someone else's");
		expect(sha(target)).toBe(hash);

		rmSync(temporary);
		const outside = join(scratch(), "outside.txt");
		writeFileSync(outside, "outside");
		const outsideHash = sha(outside);
		symlinkSync(outside, temporary);
		expect(() => writeFileAtomically(target, "new")).toThrow("already exists");
		expect(lstatSync(temporary).isSymbolicLink()).toBe(true);
		expect(readlinkSync(temporary)).toBe(outside);
		expect(sha(outside)).toBe(outsideHash);
		expect(sha(target)).toBe(hash);

		// A dangling link is refused the same way.
		rmSync(outside);
		expect(() => writeFileAtomically(target, "new")).toThrow("already exists");
		expect(existsSync(outside)).toBe(false);
		expect(lstatSync(temporary).isSymbolicLink()).toBe(true);
	});
});

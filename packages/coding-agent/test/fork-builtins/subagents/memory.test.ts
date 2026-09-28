// Fork-owned: persistent agent memory (plan T3; symlinked ancestors, phase 2 T4). Old pi-subagents test at
// 79a7c42 this covers: memory. The legacy ~/.pi/agent-memory fallback (memory-legacy-fallback) is dropped on purpose.
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	memoryDir,
	readOnlyMemoryBlock,
	readWriteMemoryBlock,
} from "../../../src/core/fork-builtins/subagents/runner/memory.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(): { cwd: string; agentDir: string } {
	const root = mkdtempSync(join(tmpdir(), "pi-sn-memory-"));
	roots.push(root);
	return { cwd: join(root, "project"), agentDir: join(root, "agent") };
}

describe("agent memory", () => {
	it("places each scope's directory and refuses a name that could leave it", () => {
		const { cwd, agentDir } = temp();
		expect(memoryDir("keeper", "user", cwd, agentDir)).toBe(join(agentDir, "agent-memory", "keeper"));
		expect(memoryDir("keeper", "project", cwd, agentDir)).toBe(join(cwd, ".pi", "agent-memory", "keeper"));
		expect(memoryDir("keeper", "local", cwd, agentDir)).toBe(join(cwd, ".pi", "agent-memory-local", "keeper"));
		for (const bad of ["../escape", ".hidden", "a/b", "", "x".repeat(129)]) {
			expect(() => memoryDir(bad, "project", cwd, agentDir)).toThrow("Unsafe agent name");
		}
	});

	it("creates the read-write directory and shows MEMORY.md, truncated at 200 lines", () => {
		const { cwd, agentDir } = temp();
		const empty = readWriteMemoryBlock("keeper", "project", cwd, agentDir);
		const dir = join(cwd, ".pi", "agent-memory", "keeper");
		expect(existsSync(dir)).toBe(true);
		expect(empty).toContain(`No MEMORY.md exists yet. Create one at ${join(dir, "MEMORY.md")}`);
		expect(empty).toContain("You have Read, Write, and Edit tools available");
		writeFileSync(join(dir, "MEMORY.md"), Array.from({ length: 250 }, (_, index) => `line ${index}`).join("\n"));
		const full = readWriteMemoryBlock("keeper", "project", cwd, agentDir);
		expect(full).toContain("## Current MEMORY.md\nline 0\n");
		expect(full).toContain("line 199\n... (truncated at 200 lines)");
		expect(full).not.toContain("line 200");
	});

	it("gives a read-only block without creating the directory", () => {
		const { cwd, agentDir } = temp();
		const block = readOnlyMemoryBlock("looker", "user", cwd, agentDir);
		expect(block.startsWith("# Agent Memory (read-only)")).toBe(true);
		expect(block).toContain("No memory is available yet.");
		expect(existsSync(join(agentDir, "agent-memory", "looker"))).toBe(false);
		mkdirSync(join(agentDir, "agent-memory", "looker"), { recursive: true });
		writeFileSync(join(agentDir, "agent-memory", "looker", "MEMORY.md"), "shared fact");
		expect(readOnlyMemoryBlock("looker", "user", cwd, agentDir)).toContain("## Current MEMORY.md\nshared fact");
	});

	it("refuses a symlinked memory directory and ignores a symlinked MEMORY.md", () => {
		const { cwd, agentDir } = temp();
		const elsewhere = join(cwd, "elsewhere");
		mkdirSync(elsewhere, { recursive: true });
		writeFileSync(join(elsewhere, "MEMORY.md"), "secret");
		mkdirSync(join(cwd, ".pi", "agent-memory"), { recursive: true });
		symlinkSync(elsewhere, join(cwd, ".pi", "agent-memory", "keeper"));
		expect(() => readWriteMemoryBlock("keeper", "project", cwd, agentDir)).toThrow("symlinked memory directory");
		expect(readOnlyMemoryBlock("keeper", "project", cwd, agentDir)).not.toContain("secret");
		const real = join(cwd, ".pi", "agent-memory", "other");
		mkdirSync(real, { recursive: true });
		symlinkSync(join(elsewhere, "MEMORY.md"), join(real, "MEMORY.md"));
		expect(readOnlyMemoryBlock("other", "project", cwd, agentDir)).not.toContain("secret");
	});

	/** Each scope with the component between its root and the memory directory that a test makes a link. */
	const linkedAncestors = (cwd: string, agentDir: string) =>
		[
			{ scope: "user", link: join(agentDir, "agent-memory"), inside: ["keeper"] },
			{ scope: "project", link: join(cwd, ".pi"), inside: ["agent-memory", "keeper"] },
			{ scope: "local", link: join(cwd, ".pi", "agent-memory-local"), inside: ["keeper"] },
		] as const;

	it("refuses read-write memory behind a symlinked ancestor, naming the link, and creates nothing there", () => {
		for (const scope of ["user", "project", "local"] as const) {
			const { cwd, agentDir } = temp();
			const [layout] = linkedAncestors(cwd, agentDir).filter((candidate) => candidate.scope === scope);
			const target = mkdtempSync(join(tmpdir(), "pi-sn-memory-target-"));
			roots.push(target);
			mkdirSync(join(layout.link, ".."), { recursive: true });
			symlinkSync(target, layout.link);
			expect(() => readWriteMemoryBlock("keeper", scope, cwd, agentDir), scope).toThrow(
				`Refusing to use subagent memory behind a symlink: ${layout.link}`,
			);
			expect(readdirSync(target), scope).toEqual([]);
		}
	});

	it("gives a read-only agent none of the memory behind a symlinked ancestor", () => {
		for (const scope of ["user", "project", "local"] as const) {
			const { cwd, agentDir } = temp();
			const [layout] = linkedAncestors(cwd, agentDir).filter((candidate) => candidate.scope === scope);
			const target = mkdtempSync(join(tmpdir(), "pi-sn-memory-target-"));
			roots.push(target);
			mkdirSync(join(target, ...layout.inside), { recursive: true });
			writeFileSync(join(target, ...layout.inside, "MEMORY.md"), "secret behind the link");
			mkdirSync(join(layout.link, ".."), { recursive: true });
			symlinkSync(target, layout.link);
			const block = readOnlyMemoryBlock("keeper", scope, cwd, agentDir);
			expect(block, scope).toContain("No memory is available yet.");
			expect(block, scope).not.toContain("secret behind the link");
		}
	});

	it("gives a read-only agent an empty block when a memory directory cannot be read", () => {
		const { cwd, agentDir } = temp();
		const memory = join(agentDir, "agent-memory");
		mkdirSync(join(memory, "keeper"), { recursive: true });
		writeFileSync(join(memory, "keeper", "MEMORY.md"), "unreachable");
		chmodSync(memory, 0o000);
		try {
			expect(readOnlyMemoryBlock("keeper", "user", cwd, agentDir)).toContain("No memory is available yet.");
		} finally {
			chmodSync(memory, 0o755);
		}
	});

	it("works under a scope root that is itself a symlink", () => {
		const root = mkdtempSync(join(tmpdir(), "pi-sn-memory-root-"));
		roots.push(root);
		const realAgentDir = join(root, "real-agent");
		const realCwd = join(root, "real-project");
		mkdirSync(realAgentDir);
		mkdirSync(realCwd);
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		symlinkSync(realAgentDir, agentDir);
		symlinkSync(realCwd, cwd);
		for (const scope of ["user", "project", "local"] as const) {
			const block = readWriteMemoryBlock("keeper", scope, cwd, agentDir);
			const dir = memoryDir("keeper", scope, cwd, agentDir);
			expect(block, scope).toContain(`persistent memory directory at: ${dir}/`);
			writeFileSync(join(dir, "MEMORY.md"), `${scope} fact`);
			expect(readOnlyMemoryBlock("keeper", scope, cwd, agentDir), scope).toContain(
				`## Current MEMORY.md\n${scope} fact`,
			);
		}
		expect(existsSync(join(realAgentDir, "agent-memory", "keeper", "MEMORY.md"))).toBe(true);
		expect(existsSync(join(realCwd, ".pi", "agent-memory-local", "keeper", "MEMORY.md"))).toBe(true);
	});
});

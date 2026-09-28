/**
 * Fork-owned: persistent agent memory (pi-subagents `src/memory.ts` at 79a7c42, without the legacy
 * `~/.pi/agent-memory` fallback). Scopes: `user` is `<agentDir>/agent-memory/<name>/`, `project`
 * is `<cwd>/.pi/agent-memory/<name>/`, `local` is `<cwd>/.pi/agent-memory-local/<name>/`. An agent
 * that can write gets a read-write block and a created directory; any other gets a read-only block.
 *
 * Memory refuses a symlink at every path component below its scope root, `MEMORY.md` included
 * (P14, F15): the agent directory for `user`, the project directory for `project` and `local`. A
 * read-write agent then fails to start, naming the link; a read-only agent gets no memory content.
 * The scope root itself may be a symlink.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, type Stats } from "node:fs";
import { join, relative, sep } from "node:path";
import type { MemoryScope } from "../definitions/types.ts";

const MAX_MEMORY_LINES = 200;

/** The memory directory of an agent; refuses a name that could leave it. */
export function memoryDir(agentName: string, scope: MemoryScope, cwd: string, agentDir: string): string {
	if (agentName.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(agentName)) {
		throw new Error(`Unsafe agent name for a memory directory: "${agentName}"`);
	}
	if (scope === "user") return join(agentDir, "agent-memory", agentName);
	return join(cwd, ".pi", scope === "project" ? "agent-memory" : "agent-memory-local", agentName);
}

/**
 * The first symlink among the existing path components from below the scope root down to
 * `<dir>/MEMORY.md`, or undefined. Checking stops at the first missing or unreadable component:
 * nothing below it can be reached, and the caller then finds no memory there.
 */
function symlinkBelowRoot(dir: string, scope: MemoryScope, cwd: string, agentDir: string): string | undefined {
	const root = scope === "user" ? agentDir : cwd;
	let path = root;
	for (const part of [...relative(root, dir).split(sep), "MEMORY.md"]) {
		path = join(path, part);
		let stat: Stats | undefined;
		try {
			stat = lstatSync(path, { throwIfNoEntry: false });
		} catch {
			return undefined;
		}
		if (!stat) return undefined;
		if (stat.isSymbolicLink()) return path;
	}
	return undefined;
}

/** The first 200 lines of `MEMORY.md`, or undefined when it is absent. The caller refused symlinks. */
function readMemoryIndex(dir: string): string | undefined {
	const file = join(dir, "MEMORY.md");
	if (!existsSync(file)) return undefined;
	let content: string;
	try {
		content = readFileSync(file, "utf-8");
	} catch {
		return undefined;
	}
	const lines = content.split("\n");
	return lines.length > MAX_MEMORY_LINES
		? `${lines.slice(0, MAX_MEMORY_LINES).join("\n")}\n... (truncated at 200 lines)`
		: content;
}

/** The read-write block. Creates the directory, so the agent can write at once. */
export function readWriteMemoryBlock(agentName: string, scope: MemoryScope, cwd: string, agentDir: string): string {
	const dir = memoryDir(agentName, scope, cwd, agentDir);
	const link = symlinkBelowRoot(dir, scope, cwd, agentDir);
	// Refused before anything is created, so nothing lands in the link's target.
	if (link === dir) throw new Error(`Refusing to use a symlinked memory directory: ${dir}`);
	if (link) throw new Error(`Refusing to use subagent memory behind a symlink: ${link}`);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const existing = readMemoryIndex(dir);
	return `# Agent Memory

You have a persistent memory directory at: ${dir}/
Memory scope: ${scope}

This memory persists across sessions. Use it to build up knowledge over time.${
		existing
			? `\n\n## Current MEMORY.md\n${existing}`
			: `\n\nNo MEMORY.md exists yet. Create one at ${join(dir, "MEMORY.md")} to start building persistent memory.`
	}

## Memory Instructions
- MEMORY.md is an index file — keep it concise (under 200 lines). Lines after 200 are truncated.
- Store detailed memories in separate files within ${dir}/ and link to them from MEMORY.md.
- Each memory file should use this frontmatter format:
  \`\`\`markdown
  ---
  name: <memory name>
  description: <one-line description>
  type: <user|feedback|project|reference>
  ---
  <memory content>
  \`\`\`
- Update or remove memories that become outdated. Check for existing memories before creating duplicates.
- You have Read, Write, and Edit tools available for managing memory files.`;
}

/** The read-only block. Creates nothing: the agent can only consume memories others wrote. A symlinked path gives none. */
export function readOnlyMemoryBlock(agentName: string, scope: MemoryScope, cwd: string, agentDir: string): string {
	const dir = memoryDir(agentName, scope, cwd, agentDir);
	const existing = symlinkBelowRoot(dir, scope, cwd, agentDir) ? undefined : readMemoryIndex(dir);
	return `# Agent Memory (read-only)

Memory scope: ${scope}
You have read-only access to memory. You can reference existing memories but cannot create or modify them.${
		existing
			? `\n\n## Current MEMORY.md\n${existing}`
			: "\n\nNo memory is available yet. Other agents or sessions with write access can create memories for you to consume."
	}`;
}

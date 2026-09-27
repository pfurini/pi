// Fork-owned: a child's system prompt, preloaded skills, parent context and environment (plan T3).
// Old pi-subagents tests at 79a7c42 this covers: prompts, context, env.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "../../../src/core/fork-builtins/subagents/definitions/types.ts";
import {
	buildChildSystemPrompt,
	buildParentContext,
	detectEnvironment,
	preloadSkills,
} from "../../../src/core/fork-builtins/subagents/runner/prompt.ts";
import type { SessionEntry } from "../../../src/core/session-manager.ts";
import type { Skill } from "../../../src/core/skills/frontmatter.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-sn-prompt-"));
	roots.push(root);
	return root;
}

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
	return {
		name: "auditor",
		description: "auditor",
		extensions: true,
		skills: true,
		systemPrompt: "Audit the code.",
		promptMode: "replace",
		enabled: true,
		hidden: false,
		source: { kind: "default" },
		...overrides,
	};
}

const env = { isGitRepo: true, branch: "main", platform: "darwin" };

describe("child system prompt", () => {
	it("builds replace mode from the header, the environment and the agent's prompt, without the parent's", () => {
		const prompt = buildChildSystemPrompt(agent(), "/work", env, "PARENT PROMPT", {});
		expect(prompt).toBe(
			'<active_agent name="auditor"/>\n\nYou are a pi coding agent sub-agent.\nYou have been invoked to handle a specific task autonomously.\n\n# Environment\nWorking directory: /work\nGit repository: yes\nBranch: main\nPlatform: darwin\n\nAudit the code.',
		);
	});

	it("builds append mode on the parent's prompt as a verbatim prefix, or a generic base without one", () => {
		const prompt = buildChildSystemPrompt(agent({ promptMode: "append" }), "/work", env, "PARENT PROMPT", {});
		expect(prompt.startsWith("PARENT PROMPT\n\n<sub_agent_context>")).toBe(true);
		expect(prompt).toContain('<active_agent name="auditor"/>');
		expect(prompt.endsWith("<agent_instructions>\nAudit the code.\n</agent_instructions>")).toBe(true);
		const bare = buildChildSystemPrompt(
			agent({ promptMode: "append", systemPrompt: "" }),
			"/work",
			env,
			undefined,
			{},
		);
		expect(bare.startsWith("# Role\nYou are a general-purpose coding agent")).toBe(true);
		expect(bare).not.toContain("<agent_instructions>");
	});

	it("adds the worktree block, the memory block and the preloaded skills", () => {
		const prompt = buildChildSystemPrompt(agent(), "/copy", { ...env, isGitRepo: false }, undefined, {
			worktreeBase: "/main",
			memoryBlock: "# Agent Memory\nmemory text",
			skillBlocks: [{ name: "style", content: "Use tabs." }],
		});
		expect(prompt).toContain("Not a git repository");
		expect(prompt).toContain(
			"<worktree_isolation>\nYour working directory is an isolated git worktree copy of /main.",
		);
		expect(prompt.endsWith("# Agent Memory\nmemory text\n\n# Preloaded Skill: style\nUse tabs.")).toBe(true);
	});
});

describe("preloaded skills", () => {
	it("reads the named skills' bodies without frontmatter and reports the missing ones", () => {
		const root = temp();
		writeFileSync(join(root, "SKILL.md"), "---\nname: style\ndescription: d\n---\n\nUse tabs.\n");
		const skill = { name: "style", listingName: "team:style", filePath: join(root, "SKILL.md") } as Skill;
		expect(preloadSkills(["STYLE", "team:style", "ghost"], [skill])).toEqual({
			blocks: [
				{ name: "style", content: "Use tabs." },
				{ name: "style", content: "Use tabs." },
			],
			missing: ["ghost"],
		});
	});
});

describe("parent context", () => {
	it("renders user and assistant text and compaction summaries, and skips tool results", () => {
		const entries = [
			{ type: "message", message: { role: "user", content: "hello" } },
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "hi" },
						{ type: "toolCall", name: "read" },
					],
				},
			},
			{ type: "message", message: { role: "toolResult", content: [{ type: "text", text: "FILE CONTENT" }] } },
			{ type: "compaction", summary: "earlier work" },
		] as unknown as SessionEntry[];
		const context = buildParentContext(entries);
		expect(context).toContain("[User]: hello\n\n[Assistant]: hi\n\n[Summary]: earlier work");
		expect(context).not.toContain("FILE CONTENT");
		expect(context.endsWith("---\n# Your Task (below)\n")).toBe(true);
		expect(buildParentContext([])).toBe("");
	});
});

describe("environment", () => {
	it("reports a git repository with its branch, and a plain directory as none", async () => {
		const plain = temp();
		expect(await detectEnvironment(plain)).toEqual({ isGitRepo: false, branch: "", platform: process.platform });
		const repo = temp();
		execFileSync("git", ["init", "-q", "-b", "trunk"], { cwd: repo });
		expect(await detectEnvironment(repo)).toEqual({ isGitRepo: true, branch: "trunk", platform: process.platform });
	});
});

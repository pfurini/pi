/**
 * Fork-owned: a child's system prompt and first message (pi-subagents `src/prompts.ts`,
 * `src/context.ts` and `src/env.ts` at 79a7c42).
 *
 * - `replace` mode: an active-agent tag, a sub-agent header with the environment block, then the
 *   agent's prompt. The parent's prompt is absent.
 * - `append` mode: the parent's prompt verbatim first (a cacheable shared prefix), a sub-agent
 *   bridge, the tag and the environment block, then the agent's prompt as `<agent_instructions>`.
 * - Both end with the memory block and the preloaded skills. Skills come from the parent
 *   session's loaded skills, not from a scan of skill directories.
 * - `inherit_context` prepends a text rendering of the parent's conversation to the task.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { stripFrontmatter } from "../../../../utils/frontmatter.ts";
import type { SessionEntry } from "../../../session-manager.ts";
import type { Skill } from "../../../skills/frontmatter.ts";
import type { AgentDefinition } from "../definitions/types.ts";

const execFileAsync = promisify(execFile);

export interface EnvironmentInfo {
	isGitRepo: boolean;
	branch: string;
	platform: string;
}

export async function detectEnvironment(cwd: string): Promise<EnvironmentInfo> {
	const git = async (args: string[]) =>
		(await execFileAsync("git", args, { cwd, timeout: 5000, encoding: "utf8" })).stdout.trim();
	let isGitRepo = false;
	let branch = "";
	try {
		isGitRepo = (await git(["rev-parse", "--is-inside-work-tree"])) === "true";
		if (isGitRepo) branch = await git(["branch", "--show-current"]);
	} catch {
		// Not a repository, or git is missing: the block says so.
	}
	return { isGitRepo, branch, platform: process.platform };
}

export interface PromptExtras {
	memoryBlock?: string;
	skillBlocks?: Array<{ name: string; content: string }>;
	/** The directory a worktree copy was made from; the prompt tells the agent to stay in the copy. */
	worktreeBase?: string;
}

const GENERIC_BASE = `# Role
You are a general-purpose coding agent for complex, multi-step tasks.
You have full access to read, write, edit files, and execute commands.
Do what has been asked; nothing more, nothing less.`;

const SUB_AGENT_BRIDGE = `<sub_agent_context>
You are operating as a sub-agent invoked to handle a specific task.
- Use the read tool instead of cat/head/tail
- Use the edit tool instead of sed/awk
- Use the write tool instead of echo/heredoc
- Use the find tool instead of bash find/ls for file search
- Use the grep tool instead of bash grep/rg for content search
- Make independent tool calls in parallel
- Use absolute file paths
- Do not use emojis
- Be concise but complete
</sub_agent_context>`;

export function buildChildSystemPrompt(
	definition: AgentDefinition,
	cwd: string,
	env: EnvironmentInfo,
	parentSystemPrompt: string | undefined,
	extras: PromptExtras,
): string {
	const tag = `<active_agent name="${definition.name}"/>\n\n`;
	const envBlock = `# Environment
Working directory: ${cwd}
${env.isGitRepo ? `Git repository: yes\nBranch: ${env.branch}` : "Not a git repository"}
Platform: ${env.platform}`;
	const worktreeBlock = extras.worktreeBase
		? `\n\n<worktree_isolation>
Your working directory is an isolated git worktree copy of ${extras.worktreeBase}.
Work only inside it — never in ${extras.worktreeBase}, even if other instructions name that path as your working directory.
</worktree_isolation>`
		: "";
	const sections: string[] = [];
	if (extras.memoryBlock) sections.push(extras.memoryBlock);
	for (const skill of extras.skillBlocks ?? []) sections.push(`\n# Preloaded Skill: ${skill.name}\n${skill.content}`);
	const suffix = sections.length > 0 ? `\n\n${sections.join("\n")}` : "";

	if (definition.promptMode === "append") {
		const instructions = definition.systemPrompt.trim()
			? `\n\n<agent_instructions>\n${definition.systemPrompt}\n</agent_instructions>`
			: "";
		return `${parentSystemPrompt || GENERIC_BASE}\n\n${SUB_AGENT_BRIDGE}\n\n${tag}${envBlock}${worktreeBlock}${instructions}${suffix}`;
	}
	const header = `You are a pi coding agent sub-agent.
You have been invoked to handle a specific task autonomously.

${envBlock}`;
	return `${tag}${header}${worktreeBlock}\n\n${definition.systemPrompt}${suffix}`;
}

/** The named skills' bodies, from the parent's loaded skills. Names match case-insensitively. */
export function preloadSkills(
	names: readonly string[],
	skills: readonly Skill[],
): { blocks: Array<{ name: string; content: string }>; missing: string[] } {
	const blocks: Array<{ name: string; content: string }> = [];
	const missing: string[] = [];
	for (const name of names) {
		const skill = skills.find(
			(candidate) =>
				candidate.name.toLowerCase() === name.toLowerCase() ||
				candidate.listingName?.toLowerCase() === name.toLowerCase(),
		);
		let content: string | undefined;
		try {
			content = skill ? stripFrontmatter(readFileSync(skill.filePath, "utf-8")).trim() : undefined;
		} catch {
			content = undefined;
		}
		if (content === undefined) missing.push(name);
		else blocks.push({ name: skill?.name ?? name, content });
	}
	return { blocks, missing };
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

/** The parent's conversation as text: user and assistant turns and compaction summaries, without tool results. */
export function buildParentContext(entries: readonly SessionEntry[]): string {
	const parts: string[] = [];
	for (const entry of entries) {
		if (entry.type === "message") {
			const message = entry.message;
			if (message.role !== "user" && message.role !== "assistant") continue;
			const text = textOf(message.content).trim();
			if (text) parts.push(`[${message.role === "user" ? "User" : "Assistant"}]: ${text}`);
		} else if (entry.type === "compaction" && entry.summary) {
			parts.push(`[Summary]: ${entry.summary}`);
		}
	}
	if (parts.length === 0) return "";
	return `# Parent Conversation Context
The following is the conversation history from the parent session that spawned you.
Use this context to understand what has been discussed and decided so far.

${parts.join("\n\n")}

---
# Your Task (below)
`;
}

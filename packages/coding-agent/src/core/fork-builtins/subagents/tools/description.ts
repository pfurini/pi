/**
 * Fork-owned: the `Agent` tool's description (plan T5). pi-subagents `src/index.ts:1561-1760` and
 * `formatToolsSuffix` (`:260-290`) at 79a7c42 are the behavior reference.
 *
 * `toolDescriptionMode` picks one of three texts. `full` is the default. `compact` states the same
 * load-bearing facts in fewer tokens. `custom` reads a template: `<cwd>/.pi/agent-tool-description.md`
 * when the project is trusted, then `<agentDir>/agent-tool-description.md`. A missing or empty
 * template falls back to `full` with a warning. Placeholders are `{{typeList}}`,
 * `{{compactTypeList}}`, `{{agentDir}}` and `{{isolationGuideline}}`; any other one stays as written
 * and warns. Scheduling is dropped (D17), so `{{scheduleGuideline}}` is unknown.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripBom } from "../../../../utils/text.ts";
import { type AgentRegistry, listedAgents } from "../definitions/registry.ts";
import type { AgentDefinition } from "../definitions/types.ts";
import { DEFAULT_CHILD_TOOLS, SUBAGENT_TOOL_NAMES, selectedPlainTools } from "../runner/scope.ts";
import type { SubagentSettings } from "../settings/settings.ts";

export interface AgentToolDescriptionInput {
	registry: AgentRegistry;
	settings: SubagentSettings;
	/** The session agent directory, where global agents and the global template live. */
	agentDir: string;
	/** The session's working directory, where the project template lives. */
	cwd: string;
	projectTrusted: boolean;
	warn(message: string): void;
}

/**
 * The tools an agent gets, as the type list states them. Absent `tools:` and `*` both read `*`.
 * `none` is kept for an agent that can call nothing: an empty plain list that loads no extension.
 */
export function formatToolsSuffix(definition: AgentDefinition): string {
	if (!definition.tools) return "*";
	const names = [...selectedPlainTools(definition.tools)].filter((name) => !SUBAGENT_TOOL_NAMES.includes(name));
	if (names.length === 0) {
		return definition.isolated || definition.extensions === false ? "none" : "no built-ins, extension tools only";
	}
	const isDefault =
		names.length === DEFAULT_CHILD_TOOLS.length && DEFAULT_CHILD_TOOLS.every((name) => names.includes(name));
	return isDefault ? "*" : names.join(", ");
}

/** `anthropic/claude-haiku-4-5-20251001` reads `claude-haiku-4-5`. */
function modelLabel(model: string): string {
	return model.slice(model.lastIndexOf("/") + 1).replace(/-\d{8}$/, "");
}

function firstSentence(text: string): string {
	const match = text.match(/^.*?[.!?](?=\s|$)/s);
	return (match ? match[0] : text).replace(/\s+/g, " ").trim();
}

function typeList(registry: AgentRegistry): string {
	return listedAgents(registry)
		.map(([name, definition]) => {
			const model = definition.model ? ` (${modelLabel(definition.model)})` : "";
			return `- ${name}: ${definition.description || name}${model} (Tools: ${formatToolsSuffix(definition)})`;
		})
		.join("\n");
}

function compactTypeList(registry: AgentRegistry): string {
	return listedAgents(registry)
		.map(
			([name, definition]) =>
				`- ${name}: ${firstSentence(definition.description || name)} (Tools: ${formatToolsSuffix(definition)})`,
		)
		.join("\n");
}

function isolationGuideline(settings: SubagentSettings): string {
	return settings.worktreeIsolation
		? `\n- Use isolation: "worktree" to give the agent its own git worktree (safe parallel file modifications); leave it unset, or pass "off", for none. The worktree is removed when the agent finishes; if it made changes, they are committed to a branch and the branch is named in the result.`
		: "";
}

function compactDescription(input: AgentToolDescriptionInput): string {
	const isolation = input.settings.worktreeIsolation
		? `\n- isolation: "worktree" gives the agent its own git worktree (removed on completion); changes land on a branch named in the result.`
		: "";
	return `Launch an autonomous agent for complex, multi-step tasks. (Claude Code skills may call this the Task tool.) Agent types:
${compactTypeList(input.registry)}

Custom agents: .pi/agents/<name>.md (project) or ${input.agentDir}/agents/<name>.md (global).

Notes:
- description: 3-5 words (shown in UI). Prompts must be self-contained — the agent has not seen this conversation.
- Parallel work: one message, multiple Agent calls — they run concurrently.
- Subagents run in the background by default; you'll be notified when one completes. Pass run_in_background: false only when your very next action depends on the result and nothing else could usefully happen while it runs. Never fabricate or predict a pending agent's results — if the user asks before the notification arrives, say it's still running.
- The result is not shown to the user — summarize it for them. Verify an agent's claimed code changes before reporting work done.
- resume continues a previous agent by ID; steer_subagent messages a running one.${isolation}`;
}

function fullDescription(input: AgentToolDescriptionInput): string {
	return `Launch a new agent to handle complex, multi-step tasks autonomously. Each agent type has specific capabilities and tools available to it. (Claude Code skills may call this the Task tool.)

Available agent types and the tools they have access to:
${typeList(input.registry)}

Custom agents can be defined in .pi/agents/<name>.md (project) or ${input.agentDir}/agents/<name>.md (global) — they are picked up automatically. Project-level agents override global ones. Creating a .md file with the same name as a default agent overrides it.

When using the Agent tool, specify a subagent_type parameter to select which agent type to use.

## When not to use

If the target is already known, use a direct tool — \`read\` for a known path, \`grep\`/\`find\` for a specific symbol or string. Reserve this tool for open-ended questions that span the codebase, or tasks that match an available agent type.

## Usage notes

- Always include a short (3-5 word) description summarizing what the agent will do (shown in UI).
- When you launch multiple agents for independent work, send them in a single message with multiple tool uses so they run concurrently. If the user specifies that they want you to run agents "in parallel", you MUST send a single message with multiple Agent tool use content blocks.
- When the agent is done, it returns a single message back to you. The result is not visible to the user — to show the user, send a text message with a concise summary.
- Trust but verify: an agent's summary describes what it intended to do, not necessarily what it did. When an agent writes or edits code, check the actual changes before reporting the work as done.
- Agents run in the background by default. When an agent runs in the background, you will be automatically notified when it completes — do NOT sleep, poll, or proactively check on its progress. Continue with other work or respond to the user instead.
- **Foreground vs background**: Pass \`run_in_background: false\` only when your very next action depends on the agent's result and nothing else could usefully happen while it runs — e.g., a research agent whose finding gates the edit you're about to make. Otherwise let it run in the background (the default) — this includes fire-and-forget work, independent investigations, and anything where the user might hand you something else in the meantime. Wanting the result "next" is not enough on its own.
- **Don't race**: after launching a background agent, you know nothing about its results. Never fabricate or predict them in any format — not as prose, summary, or structured output. The completion notification arrives in a later turn; it is never something you write yourself. If the user asks before it lands, say the agent is still running — give status, not a guess.
- Use resume with an agent ID to continue a previous agent's work. A new (non-resume) Agent call starts a fresh agent with no memory of prior runs, so the prompt must be self-contained.
- Use steer_subagent to send mid-run messages to a running background agent.
- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, etc.), since it is not aware of the user's intent.
- If an agent's description says it should be used proactively, try to use it without the user having to ask for it first.
- Use model to specify a different model (as "provider/modelId", or fuzzy e.g. "haiku", "sonnet").
- Use thinking to control extended thinking level.
- Use inherit_context if the agent needs the parent conversation history.${isolationGuideline(input.settings)}

## Writing the prompt

Brief the agent like a smart colleague who just walked into the room — it hasn't seen this conversation, doesn't know what you've tried, doesn't understand why this task matters.
- Explain what you're trying to accomplish and why.
- Describe what you've already learned or ruled out.
- Give enough context about the surrounding problem that the agent can make judgment calls rather than just following a narrow instruction.
- If you need a short response, say so ("report in under 200 words").
- Lookups: hand over the exact command. Investigations: hand over the question — prescribed steps become dead weight when the premise is wrong.

Terse command-style prompts produce shallow, generic work.

**Never delegate understanding.** Don't write "based on your findings, fix the bug" or "based on the research, implement it." Those phrases push synthesis onto the agent instead of doing it yourself. Write prompts that prove you understood: include file paths, line numbers, what specifically to change.`;
}

/** The first non-empty template: the project's when trusted, then the agent directory's. */
function loadCustomTemplate(input: AgentToolDescriptionInput): string | undefined {
	const paths = [
		...(input.projectTrusted ? [join(input.cwd, ".pi", "agent-tool-description.md")] : []),
		join(input.agentDir, "agent-tool-description.md"),
	];
	for (const path of paths) {
		if (!existsSync(path)) continue;
		let text: string;
		try {
			text = stripBom(readFileSync(path, "utf8")).trim();
		} catch (error) {
			input.warn(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		if (text) return text;
		input.warn(`${path} is empty; it is ignored.`);
	}
	return undefined;
}

function renderTemplate(template: string, input: AgentToolDescriptionInput): string {
	const values: Record<string, () => string> = {
		typeList: () => typeList(input.registry),
		compactTypeList: () => compactTypeList(input.registry),
		agentDir: () => input.agentDir,
		isolationGuideline: () => isolationGuideline(input.settings),
	};
	// A replacement callback, so `$&` in an agent description stays literal.
	return template.replace(/\{\{(\w+)\}\}/g, (raw, name: string) => {
		if (Object.hasOwn(values, name)) return values[name]();
		input.warn(`agent-tool-description.md: unknown placeholder ${raw} is left as written.`);
		return raw;
	});
}

export function buildAgentToolDescription(input: AgentToolDescriptionInput): string {
	const mode = input.settings.toolDescriptionMode;
	if (mode === "compact") return compactDescription(input);
	if (mode === "custom") {
		const template = loadCustomTemplate(input);
		if (template) return renderTemplate(template, input);
		input.warn(
			'toolDescriptionMode is "custom", but no agent-tool-description.md was found; the full description is used.',
		);
	}
	return fullDescription(input);
}

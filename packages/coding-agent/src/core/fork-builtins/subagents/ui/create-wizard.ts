/**
 * Fork-owned: the `/agents` create wizard (plan T14). pi-subagents `src/index.ts:3451-3636` at
 * 79a7c42 is the behavior reference, except for the generate path (R16, D40).
 *
 * The menu asks for the location; the wizard asks for the method, collects the answers and returns
 * the file to write, or nothing. The manual path asks for a name, a description, tools, a model and
 * a thinking level, and takes the system prompt from the editor. The generate path sends one
 * completion to the session's current model: no tools, a system prompt that asks for the whole
 * agent file, and the user's description as the only message; no message joins the session. The
 * reply is refused, with a warning naming each reason, unless the agent-file parser reads it as
 * a valid definition with the chosen name (P21).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { parseFrontmatter } from "../../../../utils/frontmatter.ts";
import type { ExtensionUIContext } from "../../../extensions/types.ts";
import type { ModelRuntime } from "../../../model-runtime.ts";
import { type AgentFileLocation, buildNewAgentFile } from "../definitions/files.ts";
import { parseAgentFile } from "../definitions/frontmatter.ts";

/** What the wizard needs from the command's context and the session. */
export interface CreateWizardEnvironment {
	ui: Pick<ExtensionUIContext, "select" | "input" | "confirm" | "editor" | "notify">;
	/** The session's current model, which the generate path asks. */
	model(): Model<Api> | undefined;
	/** The session's scoped models, which the manual path offers (P20). */
	scopedModels(): readonly { model: Model<Api> }[];
	modelRuntime: Pick<ModelRuntime, "completeSimple">;
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const READ_ONLY_TOOLS = "read, bash, grep, find, ls";

const GENERATE_PROMPT = `You write agent definition files for Pi subagents. The user describes the agent they want. Reply with the complete file and nothing else: no explanation and no code fence.

The file is YAML frontmatter between two lines of ---, then the agent's system prompt as the body:

---
description: <one line shown in the UI>
tools: <comma-separated built-in tools from read, bash, edit, write, grep, find, ls; "none" for no tools; omit for all tools>
model: <optional "provider/modelId"; omit to inherit the parent's model>
thinking: <optional thinking level: ${THINKING_LEVELS.join(", ")}; omit to inherit>
max_turns: <optional turn limit, a non-negative integer; omit for no limit>
prompt_mode: <replace (the body is the whole system prompt) or append (the body is added to the default prompt); default replace>
extensions: <true, false or comma-separated extension names; default true>
skills: <true, false or comma-separated skill names; default true>
disallowed_tools: <optional comma-separated tool names to block>
inherit_context: <true to fork the parent conversation into the agent; default false>
isolated: <true for built-in tools only, no extension tools; default false>
memory: <optional user, project or local persistent memory>
---

<the agent's system prompt>

Rules:
- Use only the keys above, spelled exactly as shown.
- Do not write a name key: the file name is the agent's name.
- For read-only work (review, analysis) use tools: ${READ_ONLY_TOOLS}. Add edit and write only for agents that change files.
- Include only the keys whose value differs from the default.`;

/** Asks for a name, and refuses one that is no plain file name: no space, `:` or path separator. */
async function askName(env: CreateWizardEnvironment): Promise<string | undefined> {
	const name = (await env.ui.input("Agent name (the file name, no spaces)"))?.trim();
	if (!name) return undefined;
	if (/[\s:/\\]/.test(name)) {
		env.ui.notify(`Agent names cannot contain spaces, ":" or path separators: "${name}"`, "warning");
		return undefined;
	}
	return name;
}

/** The target path, or undefined when the file exists and the user keeps it. */
async function targetPath(env: CreateWizardEnvironment, directory: string, name: string): Promise<string | undefined> {
	const path = join(directory, `${name}.md`);
	if (existsSync(path) && !(await env.ui.confirm("Overwrite", `${path} already exists. Overwrite?`))) return undefined;
	return path;
}

/** Runs the wizard; returns the file to write, or undefined when it was cancelled or refused. */
export async function runCreateWizard(
	env: CreateWizardEnvironment,
	directory: string,
	location: AgentFileLocation,
): Promise<{ path: string; text: string } | undefined> {
	const method = await env.ui.select("Creation method", ["Generate from a description", "Manual configuration"]);
	if (!method) return undefined;
	return method.startsWith("Generate") ? generate(env, directory, location) : manual(env, directory);
}

async function manual(
	env: CreateWizardEnvironment,
	directory: string,
): Promise<{ path: string; text: string } | undefined> {
	const name = await askName(env);
	if (!name) return undefined;
	const description = await env.ui.input("Description (one line)");
	if (!description) return undefined;

	const toolChoice = await env.ui.select("Tools", ["all", "none", `read-only (${READ_ONLY_TOOLS})`, "custom..."]);
	if (!toolChoice) return undefined;
	let tools = toolChoice;
	if (toolChoice.startsWith("read-only")) tools = READ_ONLY_TOOLS;
	else if (toolChoice === "custom...") {
		const typed = await env.ui.input("Tools (comma-separated)", READ_ONLY_TOOLS);
		if (!typed) return undefined;
		tools = typed;
	}

	const scoped = env.scopedModels().map(({ model }) => `${model.provider}/${model.id}`);
	const modelChoice = await env.ui.select("Model", ["inherit (parent model)", ...scoped, "custom..."]);
	if (!modelChoice) return undefined;
	let model: string | undefined;
	if (modelChoice === "custom...") model = (await env.ui.input("Model (provider/model)"))?.trim() || undefined;
	else if (!modelChoice.startsWith("inherit")) model = modelChoice;

	const thinking = await env.ui.select("Thinking level", ["inherit", ...THINKING_LEVELS]);
	if (!thinking) return undefined;
	const systemPrompt = await env.ui.editor("System prompt", "");
	if (systemPrompt === undefined) return undefined;

	const path = await targetPath(env, directory, name);
	if (!path) return undefined;
	const text = buildNewAgentFile({
		description,
		tools,
		model,
		thinking: thinking === "inherit" ? undefined : thinking,
		systemPrompt,
	});
	return { path, text };
}

/** The reply's text, without a code fence the model wrapped the file in. */
function replyText(reply: AssistantMessage): string {
	const text = reply.content
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("")
		.trim();
	const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(text);
	return `${(fenced ? fenced[1] : text).trim()}\n`;
}

/** Why the generated text is no valid agent file named `name`; empty when it is. */
function refusals(text: string, path: string, location: AgentFileLocation, name: string): string[] {
	const source = { kind: location === "personal" ? "global" : "project", sourcePath: path } as const;
	const parsed = parseAgentFile(text, source);
	if (!parsed.definition)
		return [parsed.errorKind === "parse" ? `cannot be parsed: ${parsed.error}` : `${parsed.error}`];
	const reasons: string[] = [];
	const description = parseFrontmatter<Record<string, unknown>>(text).frontmatter.description;
	if (typeof description !== "string" || !description.trim()) reasons.push("has no description:");
	for (const invalid of parsed.invalidValues) reasons.push(`has an invalid value for ${invalid}`);
	for (const key of parsed.unknownKeys) reasons.push(`has the unknown key "${key}"`);
	if (parsed.definition.name !== name)
		reasons.push(`names the agent "${parsed.definition.name}" instead of "${name}"`);
	return reasons;
}

async function generate(
	env: CreateWizardEnvironment,
	directory: string,
	location: AgentFileLocation,
): Promise<{ path: string; text: string } | undefined> {
	const description = await env.ui.input("Describe what this agent should do");
	if (!description) return undefined;
	const name = await askName(env);
	if (!name) return undefined;
	const existed = existsSync(join(directory, `${name}.md`));
	const path = await targetPath(env, directory, name);
	if (!path) return undefined;
	const model = env.model();
	if (!model) {
		env.ui.notify("No model is selected to generate the agent with.", "warning");
		return undefined;
	}

	env.ui.notify("Generating agent definition...", "info");
	// One request with no tools: the model can only answer, and the wizard alone writes (R16).
	const context: Context = {
		systemPrompt: GENERATE_PROMPT,
		messages: [{ role: "user", content: description, timestamp: Date.now() }],
	};
	let reply: AssistantMessage;
	try {
		reply = await env.modelRuntime.completeSimple(model, context);
	} catch (error) {
		env.ui.notify(`Generation failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
		return undefined;
	}
	if (reply.stopReason === "error" || reply.stopReason === "aborted") {
		env.ui.notify(`Generation failed: ${reply.errorMessage ?? reply.stopReason}`, "warning");
		return undefined;
	}
	// Another session may have created the file while the model answered: it needs the confirm too.
	if (!existed && existsSync(path) && !(await env.ui.confirm("Overwrite", `${path} already exists. Overwrite?`))) {
		return undefined;
	}
	const text = replyText(reply);
	const reasons = refusals(text, path, location, name);
	if (reasons.length > 0) {
		env.ui.notify(`Nothing written: the generated agent file ${reasons.join("; ")}.`, "warning");
		return undefined;
	}
	return { path, text };
}

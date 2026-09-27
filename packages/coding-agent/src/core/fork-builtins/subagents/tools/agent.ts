/**
 * Fork-owned: the `Agent` base tool (plan T5). pi-subagents `src/index.ts` at 79a7c42 (`buildAgentTool`,
 * `:1776-2470`) is the behavior reference.
 *
 * The description and the schema are built from the session's settings and agents the first time
 * the tool registry reads them, which happens after registration: registration reads nothing from
 * the session. Each `/reload` rebuilds the base tools, so both follow it. The schema offers
 * `isolation` only while `worktreeIsolation` is on.
 *
 * A spawn the service refuses (an unknown type under `fallbackSubagent: none`, a refused model)
 * returns a text result naming the reason. A foreground spawn waits for the agent, and the call's
 * abort signal stops it. A background spawn returns its id at once and notifies on completion.
 */
import { type TSchema, Type } from "typebox";
import type { AgentSession } from "../../../agent-session.ts";
import type { ToolDefinition } from "../../../extensions/types.ts";
import { type AgentRegistry, buildAgentRegistry, listedAgentTypes } from "../definitions/registry.ts";
import type { SubagentRecord } from "../service/records.ts";
import {
	loadAgentRegistry,
	notFound,
	reportSubagentWarning,
	requireService,
	type SubagentService,
	type SubagentSessionContext,
	sessionCwd,
} from "../service/service.ts";
import { THINKING_LEVELS } from "../settings/models.ts";
import { readSubagentSettings } from "../settings/settings.ts";
import {
	displayName,
	errorText,
	foregroundOutcomeNote,
	formatCost,
	formatMs,
	formatTokens,
	partialOutputSuffix,
	textResult,
} from "./common.ts";
import { buildAgentToolDescription } from "./description.ts";
import { AGENT_TOOL_NAME } from "./names.ts";

/** The arguments Pi validates against the schema `parameters` returns. */
interface AgentToolParams {
	prompt: string;
	description: string;
	name?: string;
	subagent_type: string;
	model?: string;
	thinking?: string;
	max_turns?: number;
	run_in_background?: boolean;
	resume?: string;
	isolated?: boolean;
	inherit_context?: boolean;
	isolation?: "off" | "worktree";
}

function agentParameters(types: string[], agentDir: string, worktreeIsolation: boolean): TSchema {
	return Type.Object({
		prompt: Type.String({ description: "The task for the agent to perform." }),
		description: Type.String({ description: "A short (3-5 word) description of the task (shown in UI)." }),
		name: Type.Optional(
			Type.String({
				description:
					'Optional memorable name for this agent, e.g. "auth-audit", so it can be addressed by steer_subagent / get_subagent_result. Letters, digits, `_` and `-`. Worth setting when several agents of the same type run at once; omit for one-off work. The agent stays reachable by its type either way.',
			}),
		),
		subagent_type: Type.String({
			description: `The type of specialized agent to use. Available types: ${types.join(", ")}. Custom agents from .pi/agents/*.md (project) or ${agentDir}/agents/*.md (global) are also available.`,
		}),
		model: Type.Optional(
			Type.String({
				description:
					'Optional model override. Accepts "provider/modelId" or fuzzy name (e.g. "haiku", "sonnet"). Omit to use the agent type\'s default.',
			}),
		),
		thinking: Type.Optional(
			Type.String({ description: `Thinking level: ${THINKING_LEVELS.join(", ")}. Overrides agent default.` }),
		),
		max_turns: Type.Optional(
			Type.Number({
				description: "Maximum number of agentic turns before stopping. Omit for unlimited (default).",
				minimum: 1,
			}),
		),
		run_in_background: Type.Optional(
			Type.Boolean({
				description:
					"Defaults to true — the agent runs detached, returning its ID immediately, and you are notified on completion. Set false only when your very next action depends on the result; the call then blocks and returns the agent's full output inline.",
			}),
		),
		resume: Type.Optional(
			Type.String({
				description:
					"Optional agent ID to resume from. Continues from previous context. Resumes detached like any other spawn; pass run_in_background: false to block and get the result inline. An agent can only be resumed once its current run has finished — use steer_subagent to reach one mid-run.",
			}),
		),
		isolated: Type.Optional(
			Type.Boolean({ description: "If true, agent gets no extension/MCP tools — only built-in tools." }),
		),
		inherit_context: Type.Optional(
			Type.Boolean({
				description: "If true, fork parent conversation into the agent. Default: false (fresh context).",
			}),
		),
		...(worktreeIsolation && {
			isolation: Type.Optional(
				Type.Union([Type.Literal("off"), Type.Literal("worktree")], {
					description:
						'Isolation mode. Default "off". "off" runs the agent in the current checkout, the same as omitting the field. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo (a copy cannot see uncommitted or staged changes in the main checkout).',
				}),
			),
		}),
	});
}

/** The description and the schema, from the session's current settings and agents. */
function buildSurface(
	session: AgentSession,
	context: SubagentSessionContext,
): { description: string; parameters: TSchema } {
	const warn = (message: string) => reportSubagentWarning(session, message);
	const { settings, warnings } = readSubagentSettings(session.settingsManager);
	const cwd = sessionCwd(session);
	let loaded: { registry: AgentRegistry; warnings: string[] };
	try {
		loaded = loadAgentRegistry({ session, agentDir: context.agentDir, eventBus: context.eventBus, cwd, settings });
	} catch (error) {
		// `strictAgentFiles` fails a spawn, never the session that builds this description.
		loaded = {
			registry: buildAgentRegistry({ userAgents: new Map(), disableDefaultAgents: settings.disableDefaultAgents }),
			warnings: [`The Agent tool lists only the default agents: ${errorText(error)}`],
		};
	}
	for (const message of [...warnings, ...loaded.warnings]) warn(message);
	return {
		description: buildAgentToolDescription({
			registry: loaded.registry,
			settings,
			agentDir: context.agentDir,
			cwd,
			projectTrusted: session.settingsManager.isProjectTrusted(),
			warn,
		}),
		parameters: agentParameters(listedAgentTypes(loaded.registry), context.agentDir, settings.worktreeIsolation),
	};
}

/** What a background spawn or resume returns: the id and how to follow up. */
function launchedText(record: SubagentRecord, verb: "started" | "resumed", maxConcurrent: number): string {
	const queued = record.status === "queued";
	return [
		`Agent ${queued ? "queued" : verb} in background.`,
		`Agent ID: ${record.id}`,
		`Type: ${displayName(record)}`,
		`Description: ${record.description}`,
		...(record.transcriptPath ? [`Output file: ${record.transcriptPath}`] : []),
		...(queued ? [`Position: queued (max ${maxConcurrent} concurrent)`] : []),
		"",
		"You will be notified when this agent completes.",
		"Use get_subagent_result to retrieve full results, or steer_subagent to send it messages.",
	].join("\n");
}

/** What a foreground run returns: its whole output, with a note for any outcome short of completion. */
function finishedText(record: SubagentRecord, showCost: boolean): string {
	if (record.status === "error")
		return `Agent failed: ${record.error ?? "unknown error"}${partialOutputSuffix(record)}`;
	const stats = [`${record.toolUses} tool uses`];
	const tokens = formatTokens(record);
	if (tokens) stats.push(tokens);
	const cost = showCost ? formatCost(record.usage.cost.total) : "";
	if (cost) stats.push(cost);
	const duration = (record.completedAt ?? Date.now()) - record.startedAt;
	return `Agent completed in ${formatMs(duration)} (${stats.join(", ")})${foregroundOutcomeNote(record.status)}.\n\n${
		record.result?.trim() || "No output."
	}`;
}

/**
 * Resumes a finished agent. Its agent file's `run_in_background` decides first, then the call's,
 * then `backgroundByDefault`. Only a foreground resume takes the call's abort signal.
 */
async function resume(
	service: SubagentService,
	args: AgentToolParams,
	ref: string,
	toolCallId: string,
	signal: AbortSignal | undefined,
) {
	const existing = service.get(ref);
	if (!existing) return textResult(service, notFound(ref));
	const background =
		existing.definition.runInBackground ?? args.run_in_background ?? service.reloadSettings().backgroundByDefault;
	let record: SubagentRecord;
	try {
		record = service.resume(ref, args.prompt, { background, signal: background ? undefined : signal, toolCallId });
	} catch (error) {
		return textResult(service, errorText(error));
	}
	if (background) return textResult(service, launchedText(record, "resumed", service.settings.maxConcurrent));
	await service.waitForResult(record.id);
	return textResult(service, finishedText(record, service.settings.showCost));
}

export function createAgentToolDefinition(session: AgentSession, context: SubagentSessionContext): ToolDefinition {
	let surface: { description: string; parameters: TSchema } | undefined;
	const built = () => {
		surface ??= buildSurface(session, context);
		return surface;
	};
	return {
		name: AGENT_TOOL_NAME,
		label: "Agent",
		get description() {
			return built().description;
		},
		promptSnippet: "Launch autonomous sub-agents for complex multi-step tasks",
		promptGuidelines: [
			"Use Agent with specialized agents when the task matches an agent type's description. Subagents are valuable for parallelizing independent queries or for protecting the main context window from excessive results, but should not be used excessively when not needed. Importantly, avoid duplicating work that subagents are already doing — if you delegate research to a subagent, do not also perform the same searches yourself.",
			"For broad codebase exploration or research, spawn Agent with an appropriate subagent_type (e.g. Explore). Otherwise use direct tools (read, grep, find) when the target is already known.",
			"When an agent runs in the background, you will be notified on completion — do not poll or sleep waiting for it. Continue with other work instead.",
			"Trust but verify: an agent's summary describes intent, not outcome. When an agent writes or edits code, check the actual changes before reporting work as done.",
		],
		get parameters() {
			return built().parameters;
		},

		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const args = params as AgentToolParams;
			const service = requireService(session);
			if (args.resume) return resume(service, args, args.resume, toolCallId, signal);
			let record: SubagentRecord;
			try {
				record = await service.spawn({
					type: args.subagent_type,
					prompt: args.prompt,
					description: args.description,
					name: args.name,
					params: args,
					cwd: ctx.cwd,
					signal,
					toolCallId,
				});
			} catch (error) {
				return textResult(service, errorText(error));
			}
			const note =
				record.fellBackFrom === undefined
					? ""
					: `Note: Unknown agent type "${record.fellBackFrom}" — using ${record.type}.\n\n`;
			if (record.isBackground) {
				return textResult(
					service,
					`${note}${launchedText(record, "started", service.settings.maxConcurrent)}\nDo not duplicate this agent's work.`,
				);
			}
			await service.waitForResult(record.id);
			return textResult(service, note + finishedText(record, service.settings.showCost));
		},
	};
}

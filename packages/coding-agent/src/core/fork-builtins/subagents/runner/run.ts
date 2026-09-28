/**
 * Fork-owned: builds, runs and tears down one child session (plan T3; pi-subagents
 * `src/agent-runner.ts` and `src/agent-manager.ts` at 79a7c42 are the behavior reference).
 *
 * `createChild` stores the child's lineage for its loader's event bus, builds a
 * `DefaultResourceLoader` with the agent's extension plan and system prompt, and creates the
 * session from the parent's model runtime. The runner owns that loader: a startup failure
 * disposes it, and so does `teardownChild`. `runTurn` prompts the child with a graceful turn
 * limit and reports the final text, the run's usage and its status.
 */

import { join, resolve } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { ENV_SESSION_DIR, expandTildePath } from "../../../../config.ts";
import type { AgentSession } from "../../../agent-session.ts";
import type { ToolDefinition } from "../../../extensions/types.ts";
import { DefaultResourceLoader } from "../../../resource-loader.ts";
import { createAgentSession } from "../../../sdk.ts";
import { getDefaultSessionDir, SessionManager } from "../../../session-manager.ts";
import { SettingsManager } from "../../../settings-manager.ts";
import type { AgentDefinition } from "../definitions/types.ts";
import { addUsage, emptyUsage } from "../service/usage.ts";
import { type ChildLineage, setLineage } from "./lineage.ts";
import { readOnlyMemoryBlock, readWriteMemoryBlock } from "./memory.ts";
import { buildChildSystemPrompt, buildParentContext, detectEnvironment, preloadSkills } from "./prompt.ts";
import { hasWriteTools, installToolScope, resolveExtensionPlan, resolveToolScope, type ScopeWarning } from "./scope.ts";
import { type TranscriptWriter, transcriptPath, writeTranscript } from "./transcript.ts";

/** The bound on a child's `session_shutdown` handlers at teardown. */
export const CHILD_SHUTDOWN_TIMEOUT_MS = 3000;

/** The wrap-up message a run receives once, at its turn limit. */
export const TURN_LIMIT_STEER =
	"You have reached your turn limit. Wrap up immediately — provide your final answer now.";

/** Subagent sessions live one level below the session directory a person's sessions use, out of `/resume` and `--continue`. */
const SUBAGENT_SESSION_DIR = ".subagents";

export type ChildActivity =
	| { type: "tool_start" | "tool_end"; toolName: string }
	| ScopeWarning
	| { type: "skills-error"; message: string };

export interface ChildRequest {
	parent: AgentSession;
	/**
	 * The session a nested child inherits its conversation (`inherit_context`) and appended system
	 * prompt from: the agent that delegated. Absent for a top-level child, which inherits from `parent`.
	 */
	inheritFrom?: AgentSession;
	agentDir: string;
	definition: AgentDefinition;
	/** The child's working directory: the parent's, a caller's, or a worktree copy. */
	cwd: string;
	/** Where `.pi` configuration is discovered; defaults to `cwd`. */
	configCwd?: string;
	/** Set when `cwd` is a worktree copy of this directory. */
	worktreeBase?: string;
	model?: Model<Api>;
	thinking?: AgentDefinition["thinking"];
	/** The spawn's effective `isolated`; an agent file's `isolated: true` isolates the child either way. */
	isolated: boolean;
	/** Persist the session file: `persist_session`, else `rememberAgents` for a top-level agent. */
	persist: boolean;
	/** Reopen this session file instead of starting an empty conversation. */
	resumeSessionFile?: string;
	sessionName: string;
	/** The fork base tools the parent registers; the child receives only those `tools:` names. */
	forkBaseToolNames: readonly string[];
	/** T6's nested tools; their names stay out of `excludeTools`. */
	customTools?: ToolDefinition[];
	/** Who owns the child; the runner adds the agent's `allowed_subagents` and the effective isolation. */
	lineage: Pick<ChildLineage, "owner" | "parentRecord" | "depth">;
	/** Write the `.output` transcript, filed under `configCwd`; `output_transcript:` in the agent file wins over `enabled`. */
	transcript: { enabled: boolean; agentId: string; rootSessionId: string };
	onActivity?: (activity: ChildActivity) => void;
}

export interface Child {
	readonly session: AgentSession;
	readonly loader: DefaultResourceLoader;
	readonly transcriptPath?: string;
	/** @internal Re-narrows the active tools; `runTurn` calls it before each prompt. */
	readonly renarrow: () => void;
	/** @internal */
	readonly report: (activity: ChildActivity) => void;
	/** @internal */
	readonly transcript?: TranscriptWriter;
	/** @internal Set by the first `teardownChild`. */
	teardown?: Promise<void>;
}

/** `session_dir:` verbatim (relative to the project, so never inside a worktree copy), else `.subagents/` below the parent's session directory or Pi's default. */
function childSessionDir(request: ChildRequest, settingsManager: SettingsManager): string {
	const configured = request.definition.sessionDir;
	if (configured) return resolve(request.configCwd ?? request.cwd, expandTildePath(configured));
	const envDir = process.env[ENV_SESSION_DIR];
	const base =
		request.parent.sessionManager.getSessionDir() ||
		(envDir ? expandTildePath(envDir) : undefined) ||
		settingsManager.getSessionDir() ||
		getDefaultSessionDir(request.cwd, request.agentDir);
	return join(base, SUBAGENT_SESSION_DIR);
}

export async function createChild(request: ChildRequest): Promise<Child> {
	const { parent, definition } = request;
	const configCwd = request.configCwd ?? request.cwd;
	const report = (activity: ChildActivity) => request.onActivity?.(activity);
	const isolated = request.isolated || definition.isolated === true;

	// Project and local memory live in the project; like its other files, they reach the prompt only when trusted.
	const memoryScope =
		definition.memory === "user" || parent.settingsManager.isProjectTrusted() ? definition.memory : undefined;
	if (definition.memory && !memoryScope) {
		report({
			type: "tools-error",
			message: `memory: ${definition.memory} for agent "${definition.name}" is off in an untrusted project`,
		});
	}
	const memory = memoryScope ? (hasWriteTools(definition) ? "read-write" : "read-only") : undefined;
	const memoryBlock = memoryScope
		? (memory === "read-write" ? readWriteMemoryBlock : readOnlyMemoryBlock)(
				definition.name,
				memoryScope,
				configCwd,
				request.agentDir,
			)
		: undefined;
	const skills = isolated ? false : definition.skills;
	let skillBlocks: Array<{ name: string; content: string }> | undefined;
	if (Array.isArray(skills)) {
		const preloaded = preloadSkills(skills, parent.resourceLoader.getSkills().skills);
		skillBlocks = preloaded.blocks;
		for (const name of preloaded.missing) {
			report({
				type: "skills-error",
				message: `skill "${name}" requested by agent "${definition.name}" was not found`,
			});
		}
	}
	const env = await detectEnvironment(request.cwd);
	const systemPrompt = buildChildSystemPrompt(
		definition,
		request.cwd,
		env,
		definition.promptMode === "append" ? (request.inheritFrom ?? parent).systemPrompt : undefined,
		{ memoryBlock, skillBlocks, worktreeBase: request.worktreeBase },
	);
	const scope = resolveToolScope({
		definition,
		isolated,
		knownToolNames: new Set(parent.getAllTools().map((tool) => tool.name)),
		forkBaseToolNames: request.forkBaseToolNames,
		injectedToolNames: (request.customTools ?? []).map((tool) => tool.name),
		memory,
	});
	const plan = resolveExtensionPlan(definition, isolated, configCwd, parent.settingsManager.isProjectTrusted());
	// A child shares the parent's repository, so its project trust follows the parent's.
	const settingsManager = SettingsManager.create(configCwd, request.agentDir, {
		projectTrusted: parent.settingsManager.isProjectTrusted(),
	});
	const loader = new DefaultResourceLoader({
		cwd: configCwd,
		agentDir: request.agentDir,
		settingsManager,
		noExtensions: plan.noExtensions,
		additionalExtensionPaths: plan.additionalExtensionPaths,
		extensionsOverride: plan.extensionsOverride,
		noSkills: skills === false || Array.isArray(skills),
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPromptOverride: () => systemPrompt,
		appendSystemPromptOverride: () => [],
	});
	setLineage(loader.getEventBus(), { ...request.lineage, allowedSubagents: definition.allowedSubagents, isolated });

	let session: AgentSession | undefined;
	try {
		await loader.reload();
		for (const warning of [...scope.warnings, ...plan.check(loader)]) report(warning);
		const sessionManager = request.resumeSessionFile
			? SessionManager.open(request.resumeSessionFile, childSessionDir(request, settingsManager))
			: request.persist
				? SessionManager.create(request.cwd, childSessionDir(request, settingsManager), {
						parentSession: parent.sessionFile,
					})
				: SessionManager.inMemory(request.cwd);
		({ session } = await createAgentSession({
			cwd: request.cwd,
			agentDir: request.agentDir,
			modelRuntime: parent.modelRuntime,
			model: request.model,
			thinkingLevel: request.thinking,
			sessionManager,
			settingsManager,
			resourceLoader: loader,
			excludeTools: scope.excludeTools,
			customTools: request.customTools,
		}));
		session.setSessionName(request.sessionName);
		await session.bindExtensions({
			onError: (error) => report({ type: "extension-error", message: `${error.extensionPath}: ${error.error}` }),
		});
		const renarrow = installToolScope(session, loader, scope);
		session.subscribe((event) => {
			if (event.type === "tool_execution_start") report({ type: "tool_start", toolName: event.toolName });
			if (event.type === "tool_execution_end") report({ type: "tool_end", toolName: event.toolName });
		});
		const enabled = definition.outputTranscript ?? request.transcript.enabled;
		const path = enabled
			? transcriptPath(configCwd, request.transcript.rootSessionId, request.transcript.agentId)
			: undefined;
		const transcript = path
			? writeTranscript(session, path, request.transcript.agentId, request.cwd, session.messages.length)
			: undefined;
		return { session, loader, transcriptPath: path, renarrow, report, transcript };
	} catch (error) {
		session?.dispose();
		loader.dispose();
		throw error;
	}
}

export interface TurnRequest {
	prompt: string;
	/** Turns before the wrap-up message; absent or 0 means unlimited. */
	maxTurns?: number;
	/** Turns allowed after the wrap-up message before a hard abort. */
	graceTurns: number;
	signal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
	onTurnEnd?: (turns: number) => void;
	onCompaction?: (info: { reason: "manual" | "threshold" | "overflow"; tokensBefore: number }) => void;
}

export type TurnStatus = "completed" | "steered" | "aborted" | "error";

export interface TurnOutcome {
	status: TurnStatus;
	/** The run's final assistant text; the partial answer when it stopped early. */
	text: string;
	error?: string;
	/** Usage summed over the run's assistant messages. */
	usage: Usage;
	turns: number;
}

function assistantText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

/** Prompts the child once and reports how the run ended. A thrown prompt is an `error` outcome, never a rejection. */
export async function runTurn(child: Child, turn: TurnRequest): Promise<TurnOutcome> {
	const { session } = child;
	const usage = emptyUsage();
	const maxTurns = turn.maxTurns && turn.maxTurns > 0 ? turn.maxTurns : undefined;
	let turns = 0;
	let steered = false;
	let hardAborted = false;
	const unsubscribe = session.subscribe((event) => {
		if (event.type === "turn_end") {
			turns++;
			turn.onTurnEnd?.(turns);
			if (maxTurns !== undefined && !steered && turns >= maxTurns) {
				steered = true;
				// The agent's own queue, not `session.steer`: that awaits input handlers, and this listener is not awaited.
				session.agent.steer({
					role: "user",
					content: [{ type: "text", text: TURN_LIMIT_STEER }],
					timestamp: Date.now(),
				});
			} else if (
				maxTurns !== undefined &&
				steered &&
				turns >= maxTurns + turn.graceTurns &&
				event.toolResults.length > 0
			) {
				// Only a turn that called tools continues; one that answered finishes as `steered` on its own.
				hardAborted = true;
				void session.abort();
			}
		}
		if (event.type === "message_end" && event.message.role === "assistant") {
			addUsage(usage, event.message.usage);
			turn.onUsage?.(event.message.usage);
		}
		if (event.type === "compaction_end" && !event.aborted && event.result) {
			turn.onCompaction?.({ reason: event.reason, tokensBefore: event.result.tokensBefore });
		}
	});
	if (turn.signal?.aborted) {
		unsubscribe();
		return { status: "aborted", text: "", error: "The run was cancelled before it started.", usage, turns };
	}
	const onAbort = () => void session.abort();
	turn.signal?.addEventListener("abort", onAbort, { once: true });
	const start = session.messages.length;
	let thrown: string | undefined;
	try {
		child.renarrow();
		await session.prompt(turn.prompt);
	} catch (error) {
		thrown = error instanceof Error ? error.message : String(error);
	} finally {
		unsubscribe();
		turn.signal?.removeEventListener("abort", onAbort);
		child.transcript?.flush();
	}

	const produced = session.messages.slice(start).filter((message) => message.role === "assistant");
	const last = produced.at(-1);
	const text =
		[...produced]
			.reverse()
			.map((message) => assistantText(message.content))
			.find(Boolean) ?? "";
	let status: TurnStatus;
	let error: string | undefined;
	if (thrown !== undefined) {
		status = "error";
		error = thrown;
	} else if (hardAborted || last?.stopReason === "aborted") {
		status = "aborted";
		if (hardAborted) error = "The agent exceeded its turn limit.";
	} else if (last?.stopReason === "error") {
		status = "error";
		error = last.errorMessage?.trim() || "provider error with no output";
	} else if (last?.stopReason === "length" && !assistantText(last.content)) {
		status = "error";
		error = "The run hit the output token limit before producing any text.";
	} else {
		status = steered ? "steered" : "completed";
	}
	return { status, text, error, usage, turns };
}

/**
 * Builds the child and runs its first turn. `inheritContext` prepends the parent's conversation.
 * A startup failure is an `error` outcome with the cause; the child's loader is already disposed.
 */
export async function spawnChild(
	request: ChildRequest,
	turn: TurnRequest & { inheritContext: boolean },
	onChild?: (child: Child) => void,
): Promise<TurnOutcome & { child?: Child }> {
	let child: Child;
	try {
		child = await createChild(request);
	} catch (error) {
		return {
			status: "error",
			text: "",
			error: error instanceof Error ? error.message : String(error),
			usage: emptyUsage(),
			turns: 0,
		};
	}
	onChild?.(child);
	const source = request.inheritFrom ?? request.parent;
	const context = turn.inheritContext ? buildParentContext(source.sessionManager.getBranch()) : "";
	return { ...(await runTurn(child, { ...turn, prompt: context + turn.prompt })), child };
}

/**
 * Ends a child (plan Section 2.1 "Child teardown"). Starts `abort()` without awaiting it, because
 * it waits for idle with no deadline, then gives the child's `session_shutdown` handlers 3 s. In
 * a `finally`, it disposes the session and then the loader. A rejected abort, shutdown emission or
 * disposal becomes an `extension-error` activity; it never rejects. Idempotent.
 */
export function teardownChild(child: Child): Promise<void> {
	child.teardown ??= (async () => {
		const failed = (what: string) => (error: unknown) =>
			child.report({
				type: "extension-error",
				message: `${what} failed at teardown: ${error instanceof Error ? error.message : String(error)}`,
			});
		child.session.abort().catch(failed("abort"));
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				child.session.emitShutdownOnce({ type: "session_shutdown", reason: "quit" }),
				new Promise<void>((resolve) => {
					// Unref'd: a hung handler must not hold the process open past its own exit.
					timer = setTimeout(resolve, CHILD_SHUTDOWN_TIMEOUT_MS);
					timer.unref?.();
				}),
			]);
		} catch (error) {
			failed("session_shutdown")(error);
		} finally {
			clearTimeout(timer);
			child.transcript?.stop();
			try {
				// A throwing session-resource cleanup must not keep the loader's watchers alive.
				child.session.dispose();
			} catch (error) {
				failed("dispose")(error);
			} finally {
				child.loader.dispose();
			}
		}
	})();
	return child.teardown;
}

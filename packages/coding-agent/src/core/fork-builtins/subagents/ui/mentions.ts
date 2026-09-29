/**
 * Fork-owned: agent mentions at the prompt (pi-subagents `src/index.ts:1043-1270` at 79a7c42).
 * `@handle message` addresses an agent instead of the main model. The handle names the agent across
 * its life: a running or queued agent is steered, a finished one resumed, an evicted one reopened
 * from its session file, and an agent type with no instance started. Starting follows
 * `agentMentions`: `model` lets a clone of the conversation write the agent's prompt
 * (`../tools/mention-clone.ts`), `direct` starts the agent with the typed message, and `off` leaves
 * every prompt to the main model.
 *
 * Mentions act only in the interactive TUI (D44). In print, JSON and RPC mode the hook passes every
 * prompt on unchanged. The hook never waits for an agent: it claims the prompt at once and reports
 * each outcome through a notification.
 */
import { existsSync } from "node:fs";
import type { AgentSession } from "../../../agent-session.ts";
import type { ExtensionContext, InputEvent, InputEventResult } from "../../../extensions/types.ts";
import { listedAgents } from "../definitions/registry.ts";
import { describeMention, parseMention, resolveHandleToType, stripAgentPrefix } from "../service/mentions.ts";
import { handleBase, isReservedHandle, isTerminal, type SubagentView } from "../service/records.ts";
import type { MentionTarget, SubagentService } from "../service/service.ts";
import { errorText } from "../tools/common.ts";
import { runMentionClone } from "../tools/mention-clone.ts";

/** What the input hook works with; `signal` aborts at the session's end. */
export interface MentionEnv {
	session: AgentSession;
	service: SubagentService;
	signal: AbortSignal;
}

const CONTINUE: InputEventResult = { action: "continue" };

/**
 * The `input` handler. Returns `continue` for anything that is no agent mention, `transform` for
 * `@main`, and `handled` once it started the mention's action.
 */
export function handleMentionInput(
	event: InputEvent,
	ctx: ExtensionContext,
	env: MentionEnv | undefined,
): InputEventResult {
	// The factory builds `env` in TUI mode only (D44), so print, JSON and RPC prompts pass on here.
	if (!env || event.source === "extension") return CONTINUE;
	const { service } = env;
	const mode = service.reloadSettings().agentMentions;
	if (mode === "off") return CONTINUE;
	const mention = parseMention(event.text);
	if (!mention) return CONTINUE;
	if (isReservedHandle(mention.handle)) {
		return { action: "transform", text: mention.message, ...(event.images && { images: event.images }) };
	}
	// The handle as typed first, so an agent really named `agent-foo` wins over `@agent-` + `foo`.
	const unwrapped = stripAgentPrefix(mention.handle);
	const target = service.resolveMention(mention.handle) ?? (unwrapped && service.resolveMention(unwrapped));
	const notify = (message: string, type: "info" | "warning" | "error") => {
		// The session may end before an outcome arrives; its context is then gone.
		if (!env.signal.aborted) ctx.ui.notify(message, type);
	};
	if (target && dispatchExisting(target, mention.message, env, notify)) return { action: "handled" };
	const types = listedAgents(service.registry).map(([name]) => name);
	const type =
		resolveHandleToType(mention.handle, types) ?? (unwrapped ? resolveHandleToType(unwrapped, types) : undefined);
	if (!type) return CONTINUE;
	void start(type, mention.message, mode, env, notify);
	return { action: "handled" };
}

type Notify = (message: string, type: "info" | "warning" | "error") => void;

/**
 * Steers, resumes or reopens the agent a handle names. False for a live agent that never reached a
 * session, which a mention starts afresh, as pi-subagents did.
 */
function dispatchExisting(target: MentionTarget, message: string, env: MentionEnv, notify: Notify): boolean {
	const { service } = env;
	if (target.kind === "tombstone") {
		const { entry } = target;
		const name = `@${entry.alias ?? entry.handle}`;
		if (!existsSync(entry.sessionFile)) {
			service.dropTombstone(entry.handle);
			notify(`Could not resume ${name}: its session is gone.`, "warning");
			return true;
		}
		// One rejection path for the reopen and its worktree start, so either failure is reported once.
		void service
			.reopen(entry, message)
			.then((view) => service.worktreeStarted(view))
			.then(
				() => notify(`Resuming ${name}`, "info"),
				(error: unknown) => notify(`Could not resume ${name}: ${errorText(error)}`, "warning"),
			);
		return true;
	}
	const { view } = target;
	const name = `@${view.alias ?? view.handle ?? view.id}`;
	if (!isTerminal(view)) {
		void service.steer(view.id, message).then((outcome) => {
			if (outcome.kind === "delivered" || outcome.kind === "queued") notify(`Sent to ${name}`, "info");
			else
				notify(
					`Could not send to ${name}: ${outcome.kind === "failed" ? outcome.error : outcome.reason}`,
					"warning",
				);
		});
		return true;
	}
	// A finished agent resumes in its child session; one that never reached a session starts afresh.
	if (!service.conversation(view.id)) return false;
	try {
		service.resume(view.id, message, { background: true });
		notify(`Resuming ${name}`, "info");
	} catch (error) {
		notify(`Could not resume ${name}: ${errorText(error)}`, "warning");
	}
	return true;
}

/** Starts an agent of `type`: through the clone in `model` mode, falling back to a direct start. */
async function start(type: string, message: string, mode: "model" | "direct", env: MentionEnv, notify: Notify) {
	const { service } = env;
	const name = `@${handleBase(type)}`;
	let fallback: string | undefined;
	try {
		let view: SubagentView | undefined;
		if (mode === "model") {
			notify(`Prompting ${name}…`, "info");
			const cloned = await runMentionClone(env.session, service, type, message, env.signal);
			if (env.signal.aborted) return;
			if (cloned.ok) view = cloned.view;
			else fallback = cloned.error;
		}
		view ??= await service.spawnListed({
			type,
			prompt: message,
			description: describeMention(message),
			mode: "detached-background",
		});
		await service.worktreeStarted(view);
		if (mode === "direct") notify(`Started ${name}`, "info");
		else if (fallback !== undefined) notify(`Started ${name} directly: ${fallback}`, "warning");
	} catch (error) {
		notify(`Could not start ${name}: ${errorText(error)}`, "error");
	}
}

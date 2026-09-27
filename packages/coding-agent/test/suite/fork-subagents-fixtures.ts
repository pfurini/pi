/**
 * Fork-owned: faux-provider fixtures the subagent suite tests share. A router response lets the
 * faux provider answer the parent and every child regardless of order: a child's request carries
 * `<active_agent`, and its first user message names its task.
 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import {
	type AssistantMessage,
	type Context,
	fauxAssistantMessage,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import type { AgentSession } from "../../src/core/agent-session.ts";
import { NOTIFICATION_CUSTOM_TYPE } from "../../src/core/fork-builtins/subagents/service/notifications.ts";
import type { Harness } from "./harness.ts";

export type Behavior = (
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessage | Promise<AssistantMessage>;

export function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	return Array.isArray(content)
		? content.map((part) => (part?.type === "text" ? part.text : "")).join("")
		: JSON.stringify(content ?? "");
}

/**
 * Answers every request: a child by its task keyword and turn index, the parent through `parent`.
 * The last behavior of a script repeats; a task with no script answers `reply to <first task>`.
 */
export function router(
	script: Record<string, Behavior[]>,
	parent: Behavior = () => fauxAssistantMessage("noted"),
): Behavior {
	return (context, options) => {
		if (!getCurrentSystemPrompt(context.messages).includes("<active_agent")) return parent(context, options);
		// The newest user message that names a task wins, so a resume can bring its own script.
		const users = context.messages
			.filter((message) => message.role === "user")
			.map((message) => textOf(message.content));
		const task = users[0] ?? "";
		const key = users
			.reverse()
			.map((text) => Object.keys(script).find((candidate) => text.includes(candidate)))
			.find((candidate) => candidate !== undefined);
		const turn = context.messages.filter((message) => message.role === "assistant").length;
		const steps = key ? script[key] : undefined;
		return steps
			? steps[Math.min(turn, steps.length - 1)](context, options)
			: fauxAssistantMessage(`reply to ${task}`);
	};
}

/** A response held until `release()`, or answered empty when the request is aborted. */
export function held(reply: () => AssistantMessage = () => fauxAssistantMessage("released")) {
	let release!: () => void;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	let requests = 0;
	const behavior: Behavior = (_context, options) => {
		requests++;
		return new Promise<AssistantMessage>((resolve) => {
			void released.then(() => resolve(reply()));
			options?.signal?.addEventListener("abort", () => resolve(fauxAssistantMessage("")), { once: true });
		});
	};
	return { behavior, release, requests: () => requests };
}

export const say =
	(text: string): Behavior =>
	() =>
		fauxAssistantMessage(text);

/** The subagent notifications the session holds, as text. */
export function notices(session: AgentSession): string[] {
	return session.messages
		.filter((message) => message.role === "custom" && message.customType === NOTIFICATION_CUSTOM_TYPE)
		.map((message) => textOf(message.role === "custom" ? message.content : ""));
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let calls = 0;

/** Runs an active tool as the agent loop would, with the session's extension context. */
export async function call(
	harness: Harness,
	name: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<AgentToolResult<unknown>> {
	const tool = harness.session.agent.state.tools.find((candidate) => candidate.name === name);
	if (!tool) throw new Error(`${name} is not active`);
	return tool.execute(`call-${++calls}`, args, signal);
}

export const text = (result: AgentToolResult<unknown>) => textOf(result.content);

/** The id a background spawn's result names. */
export function agentId(result: AgentToolResult<unknown>): string {
	const id = /^Agent ID: (\S+)$/m.exec(text(result))?.[1];
	if (!id) throw new Error(`no agent id in: ${text(result)}`);
	return id;
}

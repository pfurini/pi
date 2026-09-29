/**
 * Fork-owned: the `@handle message` grammar of agent mentions (pi-subagents `src/mention.ts` at
 * 79a7c42, which follows Claude Code). Suggestions fire on `@` at the start of the input or after
 * whitespace. A send is recognized only at the start of the input, with a message after the handle.
 * A bare `@handle`, a file path such as `@src/a.ts` and a mention inside a sentence stay the main
 * model's.
 */
import { handleBase, isReservedHandle } from "./records.ts";

/** Suggestion trigger: `@` at a token boundary plus the partial handle typed so far. */
export const MENTION_TRIGGER = /(^|[\s。、？！])@([\w-]*)$/;

const MENTION_SEND = /^@([\w-]+)\s+([\s\S]+)$/;

/** Splits `@handle message`; null when the text is no send. */
export function parseMention(text: string): { handle: string; message: string } | null {
	const match = MENTION_SEND.exec(text);
	if (!match) return null;
	const message = match[2].trim();
	return message ? { handle: match[1], message } : null;
}

/** The type a handle was derived from, among `types`; undefined for the reserved handle. */
export function resolveHandleToType(handle: string, types: readonly string[]): string | undefined {
	const wanted = handle.toLowerCase();
	if (isReservedHandle(wanted)) return undefined;
	return types.find((type) => handleBase(type) === wanted);
}

/** `@agent-<name>`, Claude Code's manual spelling, unwrapped; undefined without the prefix. */
export function stripAgentPrefix(handle: string): string | undefined {
	return /^agent-(.+)$/i.exec(handle)?.[1] || undefined;
}

/** A mention's message as an agent's short description: its first line, at most 40 characters. */
export function describeMention(message: string): string {
	const oneLine = message.split("\n", 1)[0].replace(/\s+/g, " ").trim();
	return oneLine.length > 40 ? `${oneLine.slice(0, 39).trimEnd()}…` : oneLine;
}

/** Claude Code's `agent_mention` reminder, byte for byte, with pi's `Agent` tool standing in for Task. */
export function agentMentionReminder(type: string): string {
	return `<system-reminder>\nThe user has expressed a desire to invoke the agent "${type}". Please invoke the agent appropriately, passing in the required context to it. \n</system-reminder>`;
}

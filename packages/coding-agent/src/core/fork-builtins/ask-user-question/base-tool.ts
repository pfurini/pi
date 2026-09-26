/**
 * Fork-owned: the two places `AgentSession` touches the `ask_user_question` base tool.
 * `agent-session.ts` keeps one-line call sites into this module (ADR-0003).
 *
 * - `addAskUserQuestionBaseTool` registers the definition next to `read`, unless
 *   `PI_FORK_BUILTINS=off` or the caller already supplied a tool of that name. Like the
 *   `skill` tool, it stays registered when an SDK caller passes its own base tools, so
 *   allow, exclude and active rules can still select it.
 * - `askUserQuestionDefaultActive` makes it active by default when it is registered.
 *
 * Nothing hides the tool when the session has no UI: a session nobody watches yet may
 * gain a client later. A call that finds no UI returns the `no_ui` result.
 */
import type { ToolDefinition } from "../../extensions/types.ts";
import { forkBuiltinsEnabled } from "../../fork-builtins.ts";
import {
	ASK_USER_QUESTION_TOOL_NAME,
	type AskUserQuestionToolOptions,
	createAskUserQuestionToolDefinition,
} from "./ask-user-question.ts";

export function addAskUserQuestionBaseTool(
	definitions: Map<string, ToolDefinition>,
	options: AskUserQuestionToolOptions,
): void {
	if (!forkBuiltinsEnabled() || definitions.has(ASK_USER_QUESTION_TOOL_NAME)) return;
	definitions.set(ASK_USER_QUESTION_TOOL_NAME, createAskUserQuestionToolDefinition(options));
}

export function askUserQuestionDefaultActive(definitions: ReadonlyMap<string, ToolDefinition>): string[] {
	return definitions.has(ASK_USER_QUESTION_TOOL_NAME) ? [ASK_USER_QUESTION_TOOL_NAME] : [];
}

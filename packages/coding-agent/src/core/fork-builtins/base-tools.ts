/**
 * Fork-owned: the base tools the fork adds to every `AgentSession` (ADR-0009).
 * `agent-session.ts` keeps thin call sites into this module (ADR-0003).
 *
 * - `addForkBaseTools` registers `ask_user_question` and `vcc_recall` next to `read`.
 *   `PI_FORK_BUILTINS=off` registers neither. A caller's base tool of the same name stays.
 * - `forkBaseToolNames` names the registered fork tools. `AgentSession` activates them
 *   wherever it activates every extension tool: at construction and on `/reload`.
 * - `forkBaseToolsNeverCarried` names the fork tools a restored transcript never added.
 *   A resumed session and a tree navigation activate them.
 *
 * The rule: a fork base tool is active unless the allowlist or the exclude list removes it.
 * `--no-builtin-tools`, a `defaultTools` setting and a caller's `baseToolsOverride` turn off
 * Pi's own tools. Those act on files and the shell, and these two tools do neither, so they
 * stay active, as extension tools do. A deactivation lasts until `/reload`. A resumed session
 * or a tree navigation keeps it when the transcript recorded the removal. It activates a tool
 * the transcript never carried, such as one that did not exist when the transcript was written.
 */
import type { SystemMessage, TranscriptMessages } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "../extensions/types.ts";
import {
	ASK_USER_QUESTION_TOOL_NAME,
	type AskUserQuestionToolOptions,
	createAskUserQuestionToolDefinition,
} from "./ask-user-question/ask-user-question.ts";
import { forkBuiltinsEnabled } from "./switch.ts";
import { createRecallToolDefinition, VCC_RECALL_TOOL_NAME } from "./vcc-recall/recall.ts";

/** What the fork's base tools need from the session. */
export type ForkBaseToolOptions = AskUserQuestionToolOptions;

/** The definitions this module created, so activation never touches a caller's tool of the same name. */
const forkOwned = new WeakSet<ToolDefinition>();

function addOwned(definitions: Map<string, ToolDefinition>, name: string, create: () => ToolDefinition): void {
	if (definitions.has(name)) return;
	const definition = create();
	forkOwned.add(definition);
	definitions.set(name, definition);
}

export function addForkBaseTools(definitions: Map<string, ToolDefinition>, options: ForkBaseToolOptions): void {
	if (!forkBuiltinsEnabled()) return;
	addOwned(definitions, ASK_USER_QUESTION_TOOL_NAME, () => createAskUserQuestionToolDefinition(options));
	addOwned(definitions, VCC_RECALL_TOOL_NAME, createRecallToolDefinition);
}

export function forkBaseToolNames(definitions: ReadonlyMap<string, ToolDefinition>): string[] {
	return [...definitions].filter(([, definition]) => forkOwned.has(definition)).map(([name]) => name);
}

/** The registered fork tools that no system message of `messages` ever added. A removal the transcript recorded keeps a tool off. */
export function forkBaseToolsNeverCarried(
	definitions: ReadonlyMap<string, ToolDefinition>,
	registry: { has(name: string): boolean },
	messages: TranscriptMessages,
): string[] {
	const carried = new Set<string>();
	for (const message of messages) {
		if (message.role !== "system") continue;
		for (const tool of (message as SystemMessage).toolsAdded ?? []) carried.add(tool.name);
	}
	return forkBaseToolNames(definitions).filter((name) => registry.has(name) && !carried.has(name));
}

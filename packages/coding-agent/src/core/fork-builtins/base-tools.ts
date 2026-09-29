/**
 * Fork-owned: the base tools the fork adds to every `AgentSession` (ADR-0009).
 * `agent-session.ts` keeps thin call sites into this module (ADR-0003).
 *
 * - `addForkBaseTools` registers `ask_user_question`, `vcc_recall`, `Agent`, `get_subagent_result`,
 *   `steer_subagent` and the task tools next to `read`. `PI_FORK_BUILTINS=off` registers none of
 *   them. A caller's base tool of the same name stays. It also stores the session's subagent record and
 *   registers the session for its task service, reading nothing from the session: both services are
 *   built on first use. With an event bus, it installs the `subagents:*` adapter on it.
 * - `forkBaseToolNames` names the registered fork tools. `AgentSession` activates them
 *   wherever it activates every extension tool: at construction and on `/reload`.
 * - `forkBaseToolsNeverCarried` names the fork tools a restored transcript never added.
 *   A resumed session and a tree navigation activate them.
 *
 * The rule: a fork base tool is active unless the allowlist or the exclude list removes it.
 * `--no-builtin-tools`, a `defaultTools` setting and a caller's `baseToolsOverride` turn off
 * Pi's own tools. Those act on files and the shell, and these tools do neither, so they
 * stay active, as extension tools do. A deactivation lasts until `/reload`. A resumed session
 * or a tree navigation keeps it when the transcript recorded the removal. It activates a tool
 * the transcript never carried, such as one that did not exist when the transcript was written.
 */
import type { SystemMessage, TranscriptMessages } from "@earendil-works/pi-ai";
import type { AgentSession } from "../agent-session.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import {
	ASK_USER_QUESTION_TOOL_NAME,
	type AskUserQuestionToolOptions,
	createAskUserQuestionToolDefinition,
} from "./ask-user-question/ask-user-question.ts";
import { bridgeServiceEvents } from "./subagents/adapter/events.ts";
import { installSubagentAdapter } from "./subagents/adapter/install.ts";
import { AGENT_TOOL_NAME, GET_RESULT_TOOL_NAME, STEER_TOOL_NAME } from "./subagents/names.ts";
import { lineageForBus } from "./subagents/runner/lineage.ts";
import { registerSubagentSession } from "./subagents/service/sessions.ts";
import { createAgentToolDefinition } from "./subagents/tools/agent.ts";
import { createNestedToolDefinitions } from "./subagents/tools/nested.ts";
import { createResultToolDefinition } from "./subagents/tools/result.ts";
import { createSteerToolDefinition } from "./subagents/tools/steer.ts";
import { withAgentToolRenderers } from "./subagents/ui/tool-renderers.ts";
import { forkBuiltinsEnabled } from "./switch.ts";
import { registerTaskSession } from "./tasks/service/sessions.ts";
import { TASK_TOOL_FACTORIES } from "./tasks/tools/tools.ts";
import { createRecallToolDefinition, VCC_RECALL_TOOL_NAME } from "./vcc-recall/recall.ts";

/** What the fork's base tools need from the session. */
export interface ForkBaseToolOptions extends AskUserQuestionToolOptions {
	/** The session the tools belong to. Registration stores it and reads none of its properties. */
	session: AgentSession;
}

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
	// A child session finds its owner through its loader's bus (plan Section 2.1 "Child lineage").
	const subagents = registerSubagentSession(options.session, {
		agentDir: options.agentDir,
		eventBus: options.eventBus,
		lineage: lineageForBus(options.eventBus),
		forkBaseToolNames: () => forkBaseToolNames(definitions),
		// The wiring layer injects what the headless service must not import (F14).
		createNestedTools: createNestedToolDefinitions,
		onServiceCreated: bridgeServiceEvents,
	});
	// The renderers live with the presentation (ui/); the tool definition stays headless.
	addOwned(definitions, AGENT_TOOL_NAME, () =>
		withAgentToolRenderers(createAgentToolDefinition(options.session, subagents), options.session),
	);
	addOwned(definitions, GET_RESULT_TOOL_NAME, () => createResultToolDefinition(options.session));
	addOwned(definitions, STEER_TOOL_NAME, () => createSteerToolDefinition(options.session));
	registerTaskSession(options.session);
	for (const [name, create] of TASK_TOOL_FACTORIES) addOwned(definitions, name, () => create(options.session));
	if (options.eventBus) installSubagentAdapter(options.session, options.eventBus);
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

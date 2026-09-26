/**
 * Fork-owned: the prompt preparation a run gets before the agent loop starts. A typed prompt
 * and a run an extension starts with `sendMessage(..., { triggerTurn: true })` on an idle
 * session share it, so both send the same prompt (upstream issue 5581). Without it, the
 * triggered run's first request replays the transcript's prompt, which is empty in a new
 * session, and every later turn drops the sections extensions set.
 *
 * `agent-session.ts` keeps only thin call sites into this module and supplies its state
 * through `RunPreparationHost` (ADR-0003).
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, SystemMessage } from "@earendil-works/pi-ai/compat";
import type { ExtensionRunner } from "./extensions/runner.ts";
import type { CustomMessage } from "./messages.ts";
import type { NormalizedBuildSystemPromptOptions } from "./system-prompt.ts";

/** The session state that preparing a run reads and writes. */
export interface RunPreparationHost {
	emitBeforeAgentStart: ExtensionRunner["emitBeforeAgentStart"];
	baseSystemPromptOptions(): NormalizedBuildSystemPromptOptions;
	activeToolNames(): string[];
	/** Resizes the prompt images in `messages` for the model the handlers selected. */
	normalizeImages(messages: AgentMessage[], images: ImageContent[] | undefined): Promise<void>;
	/** Applies the run's options and records them; returns the system prompt and tool delta, if any. */
	applyRunOptions(options: NormalizedBuildSystemPromptOptions): SystemMessage | undefined;
}

/** The extra session state a run that did not come through `prompt()` needs. */
export interface TriggeredRunHost extends RunPreparationHost {
	refreshSkillListing(): void;
	isAbortRequested(): boolean;
	appendCustomMessage(message: CustomMessage): void;
	flushPendingCustomMessages(): void;
}

/**
 * Fire `before_agent_start`, apply what its handlers changed, add the custom messages they
 * returned to `messages`, and put the system prompt and tool delta first.
 */
export async function prepareRunPrompt(
	host: RunPreparationHost,
	messages: AgentMessage[],
	promptText: string,
	images: ImageContent[] | undefined,
): Promise<void> {
	const baseOptions = host.baseSystemPromptOptions();
	const selectedToolsBefore = baseOptions.selectedTools;
	const result = await host.emitBeforeAgentStart(promptText, images, baseOptions);
	const handlerEditedTools =
		result.systemPromptOptions.selectedTools.length !== selectedToolsBefore.length ||
		result.systemPromptOptions.selectedTools.some((name, index) => name !== selectedToolsBefore[index]);
	if (!handlerEditedTools) result.systemPromptOptions.selectedTools = host.activeToolNames();
	await host.normalizeImages(messages, images);

	for (const msg of result.messages) {
		messages.push({
			role: "custom",
			customType: msg.customType,
			content: msg.content ?? [],
			display: msg.display,
			details: msg.details,
			timestamp: Date.now(),
		});
	}
	const updateMessage = host.applyRunOptions(result.systemPromptOptions);
	if (updateMessage) messages.unshift(updateMessage);
}

/**
 * Prepare a run that did not come through `prompt()`, such as a custom message an extension
 * sends with `triggerTurn` on an idle session. `promptText` is the text `before_agent_start`
 * reports as the prompt.
 *
 * The caller claims the run first, so a message that arrives while `before_agent_start`
 * handlers run is queued into this run instead of starting a second one, which the agent
 * would refuse. Returns the messages to run, or `undefined` when the run was aborted during
 * preparation; a failed preparation rethrows. A run that never starts still records its
 * custom messages.
 */
export async function prepareTriggeredRun(
	host: TriggeredRunHost,
	messages: AgentMessage | AgentMessage[],
	promptText: string,
): Promise<AgentMessage[] | undefined> {
	const prepared = Array.isArray(messages) ? [...messages] : [messages];
	let started = false;
	try {
		host.refreshSkillListing();
		await prepareRunPrompt(host, prepared, promptText, undefined);
		started = !host.isAbortRequested();
	} finally {
		if (!started) {
			for (const message of prepared) {
				if (message.role === "custom") host.appendCustomMessage(message);
			}
		}
	}
	if (!started) return undefined;
	// A context message a handler sent was queued, because the run is already claimed.
	// A typed prompt appends it before the first request, so this run does too.
	host.flushPendingCustomMessages();
	return prepared;
}

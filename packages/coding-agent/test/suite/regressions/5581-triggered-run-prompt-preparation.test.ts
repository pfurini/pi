import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	fauxAssistantMessage,
	fauxToolCall,
	getCurrentSystemPrompt,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.ts";

// Regression tests for https://github.com/earendil-works/pi/issues/5581: a run an
// extension starts with `sendMessage(..., { triggerTurn: true })` on an idle session
// skipped the preparation a typed prompt gets. Its first request replayed the
// transcript's prompt, which is empty in a new session, and every later turn dropped
// the sections extensions set, recording their removal in the transcript.

/** The section text a handler sets, and the tagged form Pi renders and records. */
const SECTION_TEXT = "from before_agent_start";
const SECTION = `<probe>\n${SECTION_TEXT}\n</probe>`;

/** One provider request: the system prompt it carried and its serialized conversation. */
interface RequestRecord {
	systemPrompt: string;
	conversation: string;
}

function recordInto(requests: RequestRecord[], message: AssistantMessage) {
	return (context: TranscriptContext): AssistantMessage => {
		requests.push({
			systemPrompt: getCurrentSystemPrompt(context.messages),
			conversation: JSON.stringify(context.messages.filter((entry) => entry.role !== "system")),
		});
		return message;
	};
}

function wake(content: string) {
	return { customType: "wake", content, display: true };
}

/** A gate a handler waits on, and the signal that the handler reached it. */
function gate() {
	let release!: () => void;
	let entered!: () => void;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	const reached = new Promise<void>((resolve) => {
		entered = resolve;
	});
	return { release, entered, released, reached };
}

const echoTool: AgentTool = {
	name: "echo",
	label: "Echo",
	description: "Echo text back",
	parameters: Type.Object({}),
	execute: async () => ({ content: [{ type: "text", text: "echoed" }], details: {} }),
};

describe("#5581 runs an extension starts on an idle session", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("prepares the first run of a new session like a typed prompt", async () => {
		const prompts: string[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", (event) => {
						prompts.push(event.prompt);
						event.systemPromptOptions.sections.probe = SECTION_TEXT;
					});
				},
			],
		});
		harnesses.push(harness);
		const requests: RequestRecord[] = [];
		harness.setResponses([recordInto(requests, fauxAssistantMessage("done"))]);

		await harness.session.sendCustomMessage(wake("a background job finished"), { triggerTurn: true });

		expect(prompts).toEqual(["a background job finished"]);
		expect(requests).toHaveLength(1);
		expect(requests[0]!.systemPrompt).toContain("You are an expert coding assistant");
		expect(requests[0]!.systemPrompt).toContain(SECTION);
	});

	it("keeps extension sections on every turn and records no removal", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", (event) => {
						event.systemPromptOptions.sections.probe = SECTION_TEXT;
					});
				},
			],
		});
		harnesses.push(harness);
		const requests: RequestRecord[] = [];
		const call = fauxAssistantMessage(fauxToolCall("echo", {}), { stopReason: "toolUse" });
		harness.setResponses([
			recordInto(requests, fauxAssistantMessage("typed run")),
			recordInto(requests, call),
			recordInto(requests, fauxAssistantMessage("triggered run")),
		]);

		await harness.session.prompt("first");
		await harness.session.sendCustomMessage(wake("a background job finished"), { triggerTurn: true });

		expect(requests).toHaveLength(3);
		for (const request of requests) {
			expect(request.systemPrompt.split(SECTION)).toHaveLength(2);
		}
		expect(new Set(requests.map((request) => request.systemPrompt)).size).toBe(1);
		const probeValues = harness.sessionManager
			.getEntries()
			.flatMap((entry) =>
				entry.type === "message" && entry.message.role === "system" && entry.message.sections
					? [entry.message.sections]
					: [],
			)
			.filter((sections) => "probe" in sections)
			.map((sections) => sections.probe);
		expect(probeValues).toEqual([SECTION]);
	});

	it("adds the custom message a before_agent_start handler returns", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", () => ({
						message: { customType: "context", content: "handler context", display: false },
					}));
				},
			],
		});
		harnesses.push(harness);
		const requests: RequestRecord[] = [];
		harness.setResponses([recordInto(requests, fauxAssistantMessage("done"))]);

		await harness.session.sendCustomMessage(wake("a background job finished"), { triggerTurn: true });

		expect(requests[0]!.conversation).toContain("a background job finished");
		expect(requests[0]!.conversation).toContain("handler context");
	});

	it("sends context a before_agent_start handler queues in the first request", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", () => {
						pi.sendMessage(
							{ customType: "context", content: "queued context", display: false },
							{ triggerTurn: false },
						);
					});
				},
			],
		});
		harnesses.push(harness);
		const requests: RequestRecord[] = [];
		harness.setResponses([recordInto(requests, fauxAssistantMessage("done"))]);

		await harness.session.sendCustomMessage(wake("a background job finished"), { triggerTurn: true });

		expect(requests).toHaveLength(1);
		expect(requests[0]!.conversation).toContain("queued context");
	});

	it("prepares a run an agent_settled handler starts", async () => {
		const prompts: string[] = [];
		let triggered = false;
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", (event) => {
						prompts.push(event.prompt);
						event.systemPromptOptions.sections.probe = SECTION_TEXT;
					});
					pi.on("agent_settled", () => {
						if (triggered) return;
						triggered = true;
						pi.sendMessage(wake("start later"), { triggerTurn: true });
					});
				},
			],
		});
		harnesses.push(harness);
		const requests: RequestRecord[] = [];
		harness.setResponses([
			recordInto(requests, fauxAssistantMessage("first")),
			recordInto(requests, fauxAssistantMessage("second")),
		]);

		await harness.session.prompt("start");

		expect(prompts).toEqual(["start", "start later"]);
		expect(requests).toHaveLength(2);
		expect(requests[1]!.systemPrompt).toContain(SECTION);
	});

	it("queues a message sent while before_agent_start handlers run into the same run", async () => {
		const handler = gate();
		let calls = 0;
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", async () => {
						calls += 1;
						if (calls > 1) return;
						handler.entered();
						await handler.released;
					});
				},
			],
		});
		harnesses.push(harness);
		const requests: RequestRecord[] = [];
		harness.setResponses([
			recordInto(requests, fauxAssistantMessage("first")),
			recordInto(requests, fauxAssistantMessage("second")),
		]);

		const first = harness.session.sendCustomMessage(wake("first job finished"), { triggerTurn: true });
		await handler.reached;
		expect(harness.session.isStreaming).toBe(true);
		const second = harness.session.sendCustomMessage(wake("second job finished"), { triggerTurn: true });
		handler.release();
		await Promise.all([first, second]);

		expect(calls).toBe(1);
		expect(requests.some((request) => request.conversation.includes("second job finished"))).toBe(true);
		const delivered = harness.session.messages.filter((message) => message.role === "custom");
		expect(delivered.map((message) => message.content)).toEqual(["first job finished", "second job finished"]);
	});

	it("records the message when the run is aborted before it starts", async () => {
		const handler = gate();
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", async () => {
						handler.entered();
						await handler.released;
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("never sent")]);

		const run = harness.session.sendCustomMessage(wake("a background job finished"), { triggerTurn: true });
		await handler.reached;
		const aborting = harness.session.abort();
		handler.release();
		await Promise.all([run, aborting]);

		expect(harness.getPendingResponseCount()).toBe(1);
		expect(harness.session.isIdle).toBe(true);
		const recorded = harness.session.messages.filter((message) => message.role === "custom");
		expect(recorded.map((message) => message.content)).toEqual(["a background job finished"]);
	});

	it("records the message and settles when preparation fails", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", (event) => {
						event.systemPromptOptions.sections["Not A Name"] = "refused";
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("never sent")]);

		await expect(
			harness.session.sendCustomMessage(wake("a background job finished"), { triggerTurn: true }),
		).rejects.toThrow("Invalid system prompt section name");

		expect(harness.getPendingResponseCount()).toBe(1);
		expect(harness.session.isIdle).toBe(true);
		const recorded = harness.session.messages.filter((message) => message.role === "custom");
		expect(recorded.map((message) => message.content)).toEqual(["a background job finished"]);
	});
});

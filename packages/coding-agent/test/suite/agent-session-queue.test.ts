import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ResourceLoader } from "../../src/index.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, getAssistantTexts, getMessageText, getUserTexts, type Harness } from "./harness.ts";

async function createWaitingHarness(
	options: {
		tools?: AgentTool[];
		extensionFactories?: Harness["session"]["extensionRunner"] extends never
			? never
			: Array<(pi: ExtensionAPI) => void>;
	} = {},
): Promise<{
	harness: Harness;
	releaseToolExecution: () => void;
	promptPromise: Promise<void>;
	waitForToolStart: Promise<void>;
}> {
	let releaseToolExecution: (() => void) | undefined;
	const toolRelease = new Promise<void>((resolve) => {
		releaseToolExecution = resolve;
	});
	const waitTool: AgentTool = {
		name: "wait",
		label: "Wait",
		description: "Wait for release",
		parameters: Type.Object({}),
		execute: async () => {
			await toolRelease;
			return {
				content: [{ type: "text", text: "released" }],
				details: {},
			};
		},
	};
	const harness = await createHarness({
		tools: [waitTool, ...(options.tools ?? [])],
		extensionFactories: options.extensionFactories,
	});

	const waitForToolStart = new Promise<void>((resolve) => {
		const unsubscribe = harness.session.subscribe((event) => {
			if (event.type === "tool_execution_start" && event.toolName === "wait") {
				unsubscribe();
				resolve();
			}
		});
	});

	return {
		harness,
		releaseToolExecution: () => releaseToolExecution?.(),
		promptPromise: harness.session.prompt("start"),
		waitForToolStart,
	};
}

describe("AgentSession queue characterization", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("dispatches extension commands immediately when prompted while idle", async () => {
		const commandRuns: string[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.registerCommand("testcmd", {
						description: "Test command",
						handler: async (args) => {
							commandRuns.push(args);
						},
					});
				},
			],
		});
		harnesses.push(harness);

		await harness.session.prompt("/testcmd hello world");

		expect(commandRuns).toEqual(["hello world"]);
		expect(harness.getPendingResponseCount()).toBe(0);
		expect(harness.session.messages).toEqual([]);
	});

	it("delivers extension-origin steering messages before the next LLM call", async () => {
		let extensionApi: ExtensionAPI | undefined;
		const waiting = await createWaitingHarness({
			extensionFactories: [
				(pi) => {
					extensionApi = pi;
				},
			],
		});
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			(context) => {
				const sawSteer = context.messages.some(
					(message) => message.role === "user" && getMessageText(message) === "steer now",
				);
				return fauxAssistantMessage(sawSteer ? "saw steer" : "missing steer");
			},
		]);

		await waitForToolStart;
		await new Promise((resolve) => setTimeout(resolve, 0));

		extensionApi?.sendUserMessage("steer now", { deliverAs: "steer" });
		releaseToolExecution();
		await promptPromise;

		expect(getUserTexts(harness)).toEqual(["start", "steer now"]);
		expect(getAssistantTexts(harness)).toContain("saw steer");
	});

	it("delivers follow-up messages only after the current run finishes", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);
		const assistantSeenBeforeFollowUp: string[] = [];

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			(context) => {
				assistantSeenBeforeFollowUp.push(
					...context.messages
						.filter((message) => message.role === "assistant")
						.map((message) =>
							message.content
								.filter((part): part is { type: "text"; text: string } => part.type === "text")
								.map((part) => part.text)
								.join("\n"),
						),
				);
				return fauxAssistantMessage("follow-up response");
			},
		]);

		await waitForToolStart;
		await harness.session.followUp("after current run");
		releaseToolExecution();
		await promptPromise;

		expect(getUserTexts(harness)).toEqual(["start", "after current run"]);
		expect(assistantSeenBeforeFollowUp).toContain("");
		expect(getAssistantTexts(harness)).toContain("follow-up response");
	});

	it("delivers multiple steering messages in order in one-at-a-time mode", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("handled steer 1"),
			fauxAssistantMessage("handled steer 2"),
		]);

		await waitForToolStart;
		await harness.session.steer("steer 1");
		await harness.session.steer("steer 2");
		releaseToolExecution();
		await promptPromise;

		expect(getUserTexts(harness)).toEqual(["start", "steer 1", "steer 2"]);
		expect(getAssistantTexts(harness)).toEqual(["", "handled steer 1", "handled steer 2"]);
	});

	it("delivers multiple follow-up messages in order in one-at-a-time mode", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("original turn complete"),
			fauxAssistantMessage("handled follow-up 1"),
			fauxAssistantMessage("handled follow-up 2"),
		]);

		await waitForToolStart;
		await harness.session.followUp("follow-up 1");
		await harness.session.followUp("follow-up 2");
		releaseToolExecution();
		await promptPromise;

		expect(getUserTexts(harness)).toEqual(["start", "follow-up 1", "follow-up 2"]);
		expect(getAssistantTexts(harness)).toEqual([
			"",
			"original turn complete",
			"handled follow-up 1",
			"handled follow-up 2",
		]);
	});

	it("delivers all steering messages in one batch in all mode", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);
		harness.session.setSteeringMode("all");
		let batchedUserMessages: string[] = [];

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			(context) => {
				batchedUserMessages = context.messages
					.filter((message) => message.role === "user")
					.map((message) => getMessageText(message));
				return fauxAssistantMessage("batched steer response");
			},
		]);

		await waitForToolStart;
		await harness.session.steer("steer 1");
		await harness.session.steer("steer 2");
		releaseToolExecution();
		await promptPromise;

		expect(batchedUserMessages).toEqual(["start", "steer 1", "steer 2"]);
		expect(getAssistantTexts(harness)).toEqual(["", "batched steer response"]);
	});

	it("delivers all follow-up messages in one batch in all mode", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);
		harness.session.setFollowUpMode("all");
		let batchedUserMessages: string[] = [];

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("original turn complete"),
			(context) => {
				batchedUserMessages = context.messages
					.filter((message) => message.role === "user")
					.map((message) => getMessageText(message));
				return fauxAssistantMessage("batched follow-up response");
			},
		]);

		await waitForToolStart;
		await harness.session.followUp("follow-up 1");
		await harness.session.followUp("follow-up 2");
		releaseToolExecution();
		await promptPromise;

		expect(batchedUserMessages).toEqual(["start", "follow-up 1", "follow-up 2"]);
		expect(getAssistantTexts(harness)).toEqual(["", "original turn complete", "batched follow-up response"]);
	});

	it("queues custom messages with deliverAs steer while streaming", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);
		let sawCustomMessage = false;

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			(context) => {
				sawCustomMessage = context.messages.some(
					(message) =>
						message.role === "user" &&
						typeof message.content !== "string" &&
						message.content.some((part) => part.type === "text" && part.text === "steer custom"),
				);
				return fauxAssistantMessage("done");
			},
		]);

		await waitForToolStart;
		await harness.session.sendCustomMessage(
			{ customType: "queue-test", content: "steer custom", display: true, details: { value: 1 } },
			{ deliverAs: "steer" },
		);
		releaseToolExecution();
		await promptPromise;

		expect(sawCustomMessage).toBe(true);
		expect(
			harness.session.messages.some((message) => message.role === "custom" && message.customType === "queue-test"),
		).toBe(true);
	});

	it("queues custom messages with deliverAs followUp while streaming", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);
		let sawCustomMessage = false;

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("original turn complete"),
			(context) => {
				sawCustomMessage = context.messages.some(
					(message) =>
						message.role === "user" &&
						typeof message.content !== "string" &&
						message.content.some((part) => part.type === "text" && part.text === "follow-up custom"),
				);
				return fauxAssistantMessage("done");
			},
		]);

		await waitForToolStart;
		await harness.session.sendCustomMessage(
			{ customType: "queue-test", content: "follow-up custom", display: true, details: { value: 1 } },
			{ deliverAs: "followUp" },
		);
		releaseToolExecution();
		await promptPromise;

		expect(sawCustomMessage).toBe(true);
		expect(
			harness.session.messages.some((message) => message.role === "custom" && message.customType === "queue-test"),
		).toBe(true);
	});

	it("injects nextTurn custom messages into the next prompt", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		let sawCustomMessage = false;

		await harness.session.sendCustomMessage(
			{ customType: "next-turn", content: "carry this", display: true, details: {} },
			{ deliverAs: "nextTurn" },
		);

		harness.setResponses([
			(context) => {
				sawCustomMessage = context.messages.some(
					(message) =>
						message.role === "user" &&
						typeof message.content !== "string" &&
						message.content.some((part) => part.type === "text" && part.text === "carry this"),
				);
				return fauxAssistantMessage("done");
			},
		]);

		await harness.session.prompt("normal prompt");

		expect(sawCustomMessage).toBe(true);
		expect(harness.session.messages.map((message) => message.role)).toEqual(["user", "custom", "assistant"]);
	});

	it("updates pendingMessageCount and removes queued text before message_start is emitted", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);
		const countsAtQueuedMessageStart: number[] = [];

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		harness.session.subscribe((event) => {
			if (
				event.type === "message_start" &&
				event.message.role === "user" &&
				getMessageText(event.message) === "queued"
			) {
				countsAtQueuedMessageStart.push(harness.session.pendingMessageCount);
			}
		});

		await waitForToolStart;
		await harness.session.steer("queued");
		expect(harness.session.pendingMessageCount).toBe(1);
		releaseToolExecution();
		await promptPromise;

		expect(countsAtQueuedMessageStart).toEqual([0]);
		expect(harness.session.pendingMessageCount).toBe(0);
	});

	it("throws when queueing an extension command with steer", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.registerCommand("testcmd", {
						description: "Test command",
						handler: async () => {},
					});
				},
			],
		});
		harnesses.push(harness);

		await expect(harness.session.steer("/testcmd queued")).rejects.toThrow(
			'Extension command "/testcmd" cannot be queued. Use prompt() or execute the command when not streaming.',
		);
	});

	it("throws when queueing an extension command with followUp", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.registerCommand("testcmd", {
						description: "Test command",
						handler: async () => {},
					});
				},
			],
		});
		harnesses.push(harness);

		await expect(harness.session.followUp("/testcmd queued")).rejects.toThrow(
			'Extension command "/testcmd" cannot be queued. Use prompt() or execute the command when not streaming.',
		);
	});

	it("delivers follow-ups queued during agent_end", async () => {
		let sent = false;
		const harness = await createHarness({
			extensionFactories: [
				(pi: ExtensionAPI) => {
					pi.on("agent_end", async () => {
						if (sent) return;
						sent = true;
						pi.sendUserMessage("conflict report", { deliverAs: "followUp" });
					});
				},
			],
		});
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("reply"), fauxAssistantMessage("follow-up reply")]);

		await harness.session.prompt("hello");
		await harness.session.agent.waitForIdle();

		expect(getUserTexts(harness)).toEqual(["hello", "conflict report"]);
	});
});

describe("AgentSession skill invocation queueing (C1c)", () => {
	const queueTempDirs: string[] = [];
	const skillHarnesses: Harness[] = [];

	afterEach(() => {
		while (skillHarnesses.length > 0) {
			skillHarnesses.pop()?.cleanup();
		}
		while (queueTempDirs.length > 0) {
			rmSync(queueTempDirs.pop() as string, { recursive: true, force: true });
		}
	});

	function createSkillResourceLoader(tempDir: string): ResourceLoader {
		const skillPath = join(tempDir, "SKILL.md");
		writeFileSync(skillPath, "# Queue Skill\n\nQueued skill body.");
		return {
			...createTestResourceLoader(),
			getSkills: () => ({
				skills: [
					{
						name: "test",
						description: "Queue skill",
						filePath: skillPath,
						disableModelInvocation: false,
						baseDir: tempDir,
						sourceInfo: createSyntheticSourceInfo(skillPath, {
							source: "local",
							scope: "project",
							origin: "top-level",
							baseDir: tempDir,
						}),
					},
				],
				diagnostics: [],
			}),
		};
	}

	async function createSkillWaitingHarness(): Promise<{
		harness: Harness;
		releaseToolExecution: () => void;
		promptPromise: Promise<void>;
		waitForToolStart: Promise<void>;
	}> {
		const tempDir = join(tmpdir(), `pi-skill-queue-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		queueTempDirs.push(tempDir);
		let releaseToolExecution: (() => void) | undefined;
		const toolRelease = new Promise<void>((resolve) => {
			releaseToolExecution = resolve;
		});
		const waitTool: AgentTool = {
			name: "wait",
			label: "Wait",
			description: "Wait for release",
			parameters: Type.Object({}),
			execute: async () => {
				await toolRelease;
				return { content: [{ type: "text", text: "released" }], details: {} };
			},
		};
		const harness = await createHarness({ tools: [waitTool], resourceLoader: createSkillResourceLoader(tempDir) });
		skillHarnesses.push(harness);
		const waitForToolStart = new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "tool_execution_start" && event.toolName === "wait") {
					unsubscribe();
					resolve();
				}
			});
		});
		return {
			harness,
			releaseToolExecution: () => releaseToolExecution?.(),
			promptPromise: harness.session.prompt("start"),
			waitForToolStart,
		};
	}

	it("queues a steer skill invocation as a structured record rendered on consumption", async () => {
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = await createSkillWaitingHarness();
		let activeAtConsumption = -1;

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			(context) => {
				// Consumed (rendered + activated) before this next request.
				activeAtConsumption = harness.session.skillRuntime.getActiveInvocations().length;
				const delivered = context.messages.some(
					(message) =>
						message.role === "user" && getMessageText(message).includes('<skill name="test" args="queued args">'),
				);
				return fauxAssistantMessage(delivered ? "saw skill block" : "missing skill block");
			},
		]);

		await waitForToolStart;
		await harness.session.steer("/skill:test queued args");

		// Queue time: literal display text, one pending message, NO activation/render yet.
		expect(harness.session.pendingMessageCount).toBe(1);
		expect(harness.session.skillRuntime.getActiveInvocations()).toHaveLength(0);
		const queueUpdate = harness.eventsOfType("queue_update").at(-1);
		expect(queueUpdate?.steering).toEqual(["/skill:test queued args"]);

		releaseToolExecution();
		await promptPromise;

		expect(activeAtConsumption).toBe(1);
		expect(getAssistantTexts(harness)).toContain("saw skill block");
		expect(harness.session.pendingMessageCount).toBe(0);
		// Turn expired after the run settled.
		expect(harness.session.skillRuntime.getActiveInvocations()).toHaveLength(0);
	});

	it("queues a follow-up skill invocation delivered after the run finishes", async () => {
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = await createSkillWaitingHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("first turn done"),
			(context) => {
				const delivered = context.messages.some(
					(message) =>
						message.role === "user" && getMessageText(message).includes('<skill name="test" args="later">'),
				);
				return fauxAssistantMessage(delivered ? "saw follow-up block" : "missing follow-up block");
			},
		]);

		await waitForToolStart;
		await harness.session.followUp("/skill:test later");
		expect(harness.session.pendingMessageCount).toBe(1);
		releaseToolExecution();
		await promptPromise;

		expect(getAssistantTexts(harness)).toContain("saw follow-up block");
		expect(harness.session.pendingMessageCount).toBe(0);
	});

	it("converts multiple queued skills in one batch in all mode", async () => {
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = await createSkillWaitingHarness();
		harness.session.setSteeringMode("all");
		let deliveredBlocks: string[] = [];

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			(context) => {
				deliveredBlocks = context.messages
					.filter((message) => message.role === "user")
					.map((message) => getMessageText(message))
					.filter((text) => text.includes("<skill"));
				return fauxAssistantMessage("batched");
			},
		]);

		await waitForToolStart;
		await harness.session.steer("/skill:test one");
		await harness.session.steer("/skill:test two");
		releaseToolExecution();
		await promptPromise;

		expect(deliveredBlocks).toHaveLength(2);
		expect(deliveredBlocks[0]).toContain('args="one"');
		expect(deliveredBlocks[1]).toContain('args="two"');
	});

	it("keeps images attached to the delivered user message", async () => {
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = await createSkillWaitingHarness();
		let sawImage = false;

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			(context) => {
				const skillMessage = context.messages.find(
					(message) => message.role === "user" && getMessageText(message).includes("<skill"),
				);
				sawImage =
					skillMessage?.role === "user" &&
					Array.isArray(skillMessage.content) &&
					skillMessage.content.some((part) => part.type === "image");
				return fauxAssistantMessage("done");
			},
		]);

		await waitForToolStart;
		await harness.session.steer("/skill:test with image", [
			{ type: "image", mimeType: "image/png", data: "ZmFrZQ==" },
		]);
		releaseToolExecution();
		await promptPromise;

		expect(sawImage).toBe(true);
	});

	it("delivers a queued invocation as an unflattened synthetic pair for flagged models", async () => {
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = await createSkillWaitingHarness();
		harness.session.agent.state.model = { ...harness.getModel(), syntheticToolResultReplay: true };

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await waitForToolStart;
		await harness.session.steer("/skill:test via queue");
		releaseToolExecution();
		await promptPromise;

		const roles = harness.session.messages.map((message) => message.role);
		expect(roles).toEqual(["user", "assistant", "toolResult", "assistant", "toolResult", "assistant"]);
		const pairAssistant = harness.session.messages[3];
		const pairResult = harness.session.messages[4];
		expect(pairAssistant).toMatchObject({ role: "assistant", stopReason: "toolUse" });
		expect(pairResult).toMatchObject({ role: "toolResult", toolName: "skill" });
		expect(getMessageText(pairResult!)).toContain("Queued skill body.");
	});

	it("keeps an unknown queued skill literal through the queue", async () => {
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = await createSkillWaitingHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await waitForToolStart;
		await harness.session.steer("/skill:unknown stuff");
		releaseToolExecution();
		await promptPromise;

		expect(getUserTexts(harness)).toEqual(["start", "/skill:unknown stuff"]);
	});
});

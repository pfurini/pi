/**
 * C1c render parity: direct prompt, queued steer, queued follow-up, and the
 * genuine `skill` tool call all go through the SAME C1b renderer and persist
 * structured B.12 metadata. Table-driven over invocation path × transport;
 * metadata assertions read only entry fields (no XML recovery).
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionMessageEntry } from "../../src/core/session-manager.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ResourceLoader } from "../../src/index.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const tempDirs: string[] = [];
const harnesses: Harness[] = [];

afterEach(() => {
	while (harnesses.length > 0) {
		harnesses.pop()?.cleanup();
	}
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop() as string, { recursive: true, force: true });
	}
});

const SKILL_BODY = "# Parity\n\nParity rendered body.";

function createParityLoader(tempDir: string): ResourceLoader {
	const skillPath = join(tempDir, "SKILL.md");
	writeFileSync(skillPath, SKILL_BODY);
	return {
		...createTestResourceLoader(),
		getSkills: () => ({
			skills: [
				{
					name: "test",
					description: "Parity skill",
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

interface ParityRun {
	harness: Harness;
	/** Text carrying the rendered skill content (block text or tool result text). */
	deliveredText: string;
	entries: SessionMessageEntry[];
}

function messageEntries(harness: Harness): SessionMessageEntry[] {
	return harness.sessionManager.getEntries().filter((entry) => entry.type === "message");
}

function makeTempDir(): string {
	const tempDir = join(tmpdir(), `pi-parity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	tempDirs.push(tempDir);
	return tempDir;
}

function flagModel(harness: Harness): void {
	harness.session.agent.state.model = { ...harness.getModel(), syntheticToolResultReplay: true };
}

function findDeliveredText(harness: Harness): string {
	const skillResult = harness.session.messages.find(
		(message) => message.role === "toolResult" && message.toolName === "skill",
	);
	if (skillResult) {
		return getMessageText(skillResult);
	}
	const blockMessage = harness.session.messages.find(
		(message) => message.role === "user" && getMessageText(message).includes('<skill name="test"'),
	);
	return blockMessage ? getMessageText(blockMessage) : "";
}

async function runDirect(transport: "block" | "synthetic"): Promise<ParityRun> {
	const tempDir = makeTempDir();
	const harness = await createHarness({ resourceLoader: createParityLoader(tempDir) });
	harnesses.push(harness);
	if (transport === "synthetic") flagModel(harness);
	harness.setResponses([fauxAssistantMessage("ok")]);
	await harness.session.prompt("/skill:test parity args");
	return { harness, deliveredText: findDeliveredText(harness), entries: messageEntries(harness) };
}

async function runQueued(queue: "steer" | "followUp", transport: "block" | "synthetic"): Promise<ParityRun> {
	const tempDir = makeTempDir();
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
	const harness = await createHarness({ tools: [waitTool], resourceLoader: createParityLoader(tempDir) });
	harnesses.push(harness);
	if (transport === "synthetic") flagModel(harness);
	harness.setResponses([
		fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
		fauxAssistantMessage("after wait"),
		fauxAssistantMessage("after queue"),
	]);
	const promptPromise = harness.session.prompt("start");
	const waitForToolStart = new Promise<void>((resolve) => {
		const unsubscribe = harness.session.subscribe((event) => {
			if (event.type === "tool_execution_start" && event.toolName === "wait") {
				unsubscribe();
				resolve();
			}
		});
	});
	await waitForToolStart;
	if (queue === "steer") {
		await harness.session.steer("/skill:test parity args");
	} else {
		await harness.session.followUp("/skill:test parity args");
	}
	releaseToolExecution?.();
	await promptPromise;
	return { harness, deliveredText: findDeliveredText(harness), entries: messageEntries(harness) };
}

async function runGenuineTool(_transport: "block" | "synthetic"): Promise<ParityRun> {
	// Genuine model tool calls return rendered content as their real tool result
	// on any provider (A.4); the transport selection does not apply to them.
	const tempDir = makeTempDir();
	const harness = await createHarness({ resourceLoader: createParityLoader(tempDir) });
	harnesses.push(harness);
	harness.setResponses([
		fauxAssistantMessage([fauxToolCall("skill", { name: "test", args: "parity args" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("ok"),
	]);
	await harness.session.prompt("invoke the skill");
	return { harness, deliveredText: findDeliveredText(harness), entries: messageEntries(harness) };
}

const PATHS = {
	direct: (transport: "block" | "synthetic") => runDirect(transport),
	steer: (transport: "block" | "synthetic") => runQueued("steer", transport),
	followUp: (transport: "block" | "synthetic") => runQueued("followUp", transport),
	genuineTool: (transport: "block" | "synthetic") => runGenuineTool(transport),
} as const;

describe("skill render parity across invocation paths and transports", () => {
	for (const [pathName, run] of Object.entries(PATHS)) {
		// Genuine model tool calls ignore the transport argument (see runGenuineTool):
		// running both labels would execute the identical test body twice.
		const transports = pathName === "genuineTool" ? (["block"] as const) : (["block", "synthetic"] as const);
		for (const transport of transports) {
			it(`${pathName} × ${transport}: one renderer output, structured metadata`, async () => {
				const run1 = await run(transport);

				// Exactly one delivery artifact carrying the exact rendered body.
				expect(run1.deliveredText).toContain("Parity rendered body.");
				expect(run1.deliveredText).toContain(`Base directory for this skill: `);
				expect(run1.deliveredText).toContain("ARGUMENTS: parity args");

				// Structured B.12 metadata persisted; assertions read entry fields only.
				const withInvocations = run1.entries.filter((entry) => entry.invocations !== undefined);
				expect(withInvocations.length).toBeGreaterThan(0);
				expect(withInvocations[0].invocations?.[0]).toMatchObject({ name: "test", args: "parity args" });
				expect(withInvocations[0].invocations?.[0].skillId).toBeTruthy();

				if (transport === "synthetic" && pathName !== "genuineTool") {
					// Synthetic pair: two entries sharing one entry-level pairId.
					const pairEntries = run1.entries.filter((entry) => entry.pairId !== undefined);
					expect(pairEntries).toHaveLength(2);
					expect(pairEntries[0].pairId).toBe(pairEntries[1].pairId);
					expect(pairEntries[0].message.role).toBe("assistant");
					expect(pairEntries[1].message.role).toBe("toolResult");
				} else {
					expect(run1.entries.every((entry) => entry.pairId === undefined)).toBe(true);
				}

				// Cross-path equivalence: identical body once the run-specific
				// base-dir preamble (each run renders in its own temp dir) is normalized.
				if (pathName !== "direct") {
					const baseline = await runDirect(transport);
					// Normalize the run-specific base-dir preamble and unwrap the
					// A.4 block: the rendered BODY is the cross-path invariant
					// (genuine/synthetic results carry it bare).
					const bodyOf = (text: string) => {
						const normalized = text.replace(
							/Base directory for this skill: \S+/g,
							"Base directory for this skill: <dir>",
						);
						const match = normalized.match(/^<skill name="[^"]*" args="[^"]*">\n([\s\S]*)\n<\/skill>$/);
						return match ? match[1] : normalized;
					};
					expect(bodyOf(run1.deliveredText)).toBe(bodyOf(baseline.deliveredText));
				}
			});
		}
	}

	it("queued invocation metadata activates only when consumed", async () => {
		const tempDir = makeTempDir();
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
		const harness = await createHarness({ tools: [waitTool], resourceLoader: createParityLoader(tempDir) });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		const promptPromise = harness.session.prompt("start");
		const waitForToolStart = new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "tool_execution_start" && event.toolName === "wait") {
					unsubscribe();
					resolve();
				}
			});
		});
		await waitForToolStart;
		await harness.session.steer("/skill:test delayed");

		// Queued: not yet rendered, not yet activated, not yet persisted.
		expect(harness.session.skillRuntime.getActiveInvocations()).toHaveLength(0);
		expect(messageEntries(harness).filter((entry) => entry.invocations !== undefined)).toHaveLength(0);

		releaseToolExecution?.();
		await promptPromise;

		expect(messageEntries(harness).some((entry) => entry.invocations?.[0]?.args === "delayed")).toBe(true);
	});
});

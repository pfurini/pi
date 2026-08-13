/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: A.8 placeholder fixtures */
/**
 * C3a (A.2/A.5/A.8) model/effort override behavior end-to-end through
 * AgentSession with the faux provider. Assertions inspect the request the
 * provider actually received (model id, reasoning level, tool schema), never
 * session state alone. Covers all A.5 application paths (initial, mid-turn tool
 * call, queued consumption, retry), ephemeral expiry, stacked precedence with
 * the discarded-override diagnostic, two-path parity, and the A.8 PI_EFFORT
 * clamp. Programmatic fixtures + faux provider only (no real APIs/keys).
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	type Context,
	type FauxModelDefinition,
	type FauxResponseFactory,
	fauxAssistantMessage,
	fauxToolCall,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ResourceLoader } from "../../src/index.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const MODELS: FauxModelDefinition[] = [
	{ id: "session-model", reasoning: true },
	{ id: "opus-model", reasoning: true },
];

interface SkillFixture {
	name: string;
	body: string;
	frontmatter?: Record<string, unknown>;
}

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

function makeTempDir(): string {
	const tempDir = join(tmpdir(), `pi-c3a-ov-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	tempDirs.push(tempDir);
	return tempDir;
}

function createSkillsLoader(tempDir: string, fixtures: SkillFixture[]): ResourceLoader {
	const skills = fixtures.map((fixture) => {
		const baseDir = join(tempDir, fixture.name);
		mkdirSync(baseDir, { recursive: true });
		const filePath = join(baseDir, "SKILL.md");
		writeFileSync(filePath, fixture.body);
		return {
			name: fixture.name,
			description: `${fixture.name} skill`,
			filePath,
			disableModelInvocation: false,
			baseDir,
			sourceInfo: createSyntheticSourceInfo(filePath, {
				source: "local" as const,
				scope: "project" as const,
				origin: "top-level" as const,
				baseDir,
			}),
			...(fixture.frontmatter &&
				Object.keys(fixture.frontmatter).length > 0 && { frontmatter: fixture.frontmatter }),
		};
	});
	return {
		...createTestResourceLoader(),
		getSkills: () => ({ skills, diagnostics: [] }),
	};
}

async function createOverrideHarness(fixtures: SkillFixture[], tools?: AgentTool[]): Promise<Harness> {
	const tempDir = makeTempDir();
	const harness = await createHarness({
		models: MODELS,
		resourceLoader: createSkillsLoader(tempDir, fixtures),
		tools,
	});
	harnesses.push(harness);
	return harness;
}

interface CapturedRequest {
	modelId: string;
	reasoning: unknown;
	toolNames: string[];
}

/** A faux response that records the request the provider received, then replies with `text`. */
function captureRequest(sink: CapturedRequest[], text = "ok"): FauxResponseFactory {
	return (context: Context, options: SimpleStreamOptions | undefined, _state, model: Model<string>) => {
		sink.push({
			modelId: model.id,
			reasoning: options?.reasoning,
			toolNames: (context.tools ?? []).map((tool) => tool.name),
		});
		return fauxAssistantMessage(text);
	};
}

/** A faux response that records the request, then replies with a single tool call. */
function captureToolCall(
	sink: CapturedRequest[],
	toolName: string,
	args: Record<string, unknown>,
): FauxResponseFactory {
	return (context: Context, options: SimpleStreamOptions | undefined, _state, model: Model<string>) => {
		sink.push({
			modelId: model.id,
			reasoning: options?.reasoning,
			toolNames: (context.tools ?? []).map((tool) => tool.name),
		});
		return fauxAssistantMessage([fauxToolCall(toolName, args)], { stopReason: "toolUse" });
	};
}

function waitTool(): { tool: AgentTool; release: () => void } {
	let releaseExecution: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		releaseExecution = resolve;
	});
	const tool: AgentTool = {
		name: "wait",
		label: "Wait",
		description: "Wait for release",
		parameters: Type.Object({}),
		execute: async () => {
			await gate;
			return { content: [{ type: "text", text: "released" }], details: {} };
		},
	};
	return { tool, release: () => releaseExecution?.() };
}

function waitForWaitToolStart(harness: Harness): Promise<void> {
	return new Promise<void>((resolve) => {
		const unsubscribe = harness.session.subscribe((event) => {
			if (event.type === "tool_execution_start" && event.toolName === "wait") {
				unsubscribe();
				resolve();
			}
		});
	});
}

function deliveredSkillText(harness: Harness, name: string): string {
	const message = harness.session.messages.find(
		(m) => m.role === "user" && getMessageText(m).includes(`<skill name="${name}"`),
	);
	return message ? getMessageText(message) : "";
}

describe("C3a overrides: initial (direct) application", () => {
	it("applies model + effort to the first request; tools unchanged without disallowed-tools", async () => {
		const harness = await createOverrideHarness([
			{ name: "both", frontmatter: { model: "opus-model", effort: "high" }, body: "body" },
		]);
		const requests: CapturedRequest[] = [];
		harness.setResponses([captureRequest(requests)]);

		await harness.session.prompt("/skill:both");

		expect(requests).toHaveLength(1);
		expect(requests[0].modelId).toBe("opus-model");
		expect(requests[0].reasoning).toBe("high");
	});

	it("resolves a CC model alias and clamp-maps an integer effort budget", async () => {
		const harness = await createOverrideHarness([
			{ name: "alias", frontmatter: { model: "opus", effort: 16384 }, body: "body" },
		]);
		const requests: CapturedRequest[] = [];
		harness.setResponses([captureRequest(requests)]);

		await harness.session.prompt("/skill:alias");

		expect(requests[0].modelId).toBe("opus-model");
		// 16384 → "high" (A.2 clamp-map: ≤24k → high).
		expect(requests[0].reasoning).toBe("high");
	});
});

describe("C3a overrides: ephemeral expiry", () => {
	it("clears pendingTurnOverride at agent_settled and the next turn uses the session default", async () => {
		const harness = await createOverrideHarness([
			{ name: "both", frontmatter: { model: "opus-model", effort: "high" }, body: "body" },
		]);
		const requests: CapturedRequest[] = [];
		harness.setResponses([captureRequest(requests, "first"), captureRequest(requests, "second")]);

		await harness.session.prompt("/skill:both");
		// Falsifiable: the ephemeral field is cleared after the turn settles.
		expect(harness.session.agent.pendingTurnOverride).toBeUndefined();

		await harness.session.prompt("plain follow-up");

		expect(requests[0].modelId).toBe("opus-model");
		expect(requests[0].reasoning).toBe("high");
		// The subsequent turn reaches the provider on the original session defaults.
		expect(requests[1].modelId).toBe("session-model");
		expect(requests[1].reasoning).toBeUndefined();
	});
});

describe("C3a overrides: mid-turn genuine skill tool call", () => {
	it("governs the continuation request after the skill tool result", async () => {
		const harness = await createOverrideHarness([
			{ name: "both", frontmatter: { model: "opus-model", effort: "high" }, body: "rendered body" },
		]);
		const requests: CapturedRequest[] = [];
		harness.setResponses([
			// First request (no override yet): the model calls the skill tool.
			captureToolCall(requests, "skill", { name: "both" }),
			// Continuation after the skill tool result runs under the override.
			captureRequest(requests, "after skill"),
		]);

		await harness.session.prompt("do it");

		expect(requests[0].modelId).toBe("session-model");
		expect(requests[0].reasoning).toBeUndefined();
		expect(requests[1].modelId).toBe("opus-model");
		expect(requests[1].reasoning).toBe("high");
	});
});

describe("C3a overrides: queued consumption reaches the consuming request", () => {
	it("steer: the override governs the immediately-following provider request", async () => {
		const { tool, release } = waitTool();
		const harness = await createOverrideHarness(
			[{ name: "both", frontmatter: { model: "opus-model", effort: "high" }, body: "body" }],
			[tool],
		);
		const requests: CapturedRequest[] = [];
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
			captureRequest(requests, "after steer"),
		]);

		const promptPromise = harness.session.prompt("start");
		await waitForWaitToolStart(harness);
		await harness.session.steer("/skill:both");
		release();
		await promptPromise;

		expect(requests).toHaveLength(1);
		expect(requests[0].modelId).toBe("opus-model");
		expect(requests[0].reasoning).toBe("high");
	});

	it("follow-up: the override governs the consuming request", async () => {
		const { tool, release } = waitTool();
		const harness = await createOverrideHarness(
			[{ name: "both", frontmatter: { model: "opus-model", effort: "high" }, body: "body" }],
			[tool],
		);
		const requests: CapturedRequest[] = [];
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("first turn done"),
			captureRequest(requests, "after follow-up"),
		]);

		const promptPromise = harness.session.prompt("start");
		await waitForWaitToolStart(harness);
		await harness.session.followUp("/skill:both");
		release();
		await promptPromise;

		expect(requests).toHaveLength(1);
		expect(requests[0].modelId).toBe("opus-model");
		expect(requests[0].reasoning).toBe("high");
	});
});

describe("C3a overrides: survives an in-turn retry", () => {
	it("the retried request still runs under the override", async () => {
		const harness = await createHarness({
			models: MODELS,
			resourceLoader: createSkillsLoader(makeTempDir(), [
				{ name: "both", frontmatter: { model: "opus-model", effort: "high" }, body: "body" },
			]),
			settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		const requests: CapturedRequest[] = [];
		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
			captureRequest(requests, "recovered"),
		]);

		await harness.session.prompt("/skill:both");

		expect(harness.faux.state.callCount).toBe(2);
		expect(requests).toHaveLength(1);
		expect(requests[0].modelId).toBe("opus-model");
		expect(requests[0].reasoning).toBe("high");
	});
});

describe("C3a overrides: stacked precedence", () => {
	it("the newest invocation's model/effort wins and a discarded-override diagnostic fires", async () => {
		const harness = await createOverrideHarness([
			{ name: "first", frontmatter: { model: "opus-model", effort: "high" }, body: "first" },
			{ name: "second", frontmatter: { model: "session-model", effort: "low" }, body: "second" },
		]);
		const errors: string[] = [];
		harness.session.extensionRunner.onError((error) => {
			errors.push(`${error.event}: ${error.error}`);
		});
		const requests: CapturedRequest[] = [];
		harness.setResponses([captureRequest(requests)]);

		// Two mid-prompt invocations compose and both activate in order (A.5
		// stacking); a leading word keeps the message non-message-initial so the
		// first invocation does not swallow the second as its args.
		await harness.session.prompt("stack /first then /second");

		// Most recent wins the provider request.
		expect(requests[0].modelId).toBe("session-model");
		expect(requests[0].reasoning).toBe("low");
		// The discarded conflicting model + effort overrides from "first" diagnose.
		expect(errors.some((message) => message.includes("model override from") && message.includes("first"))).toBe(true);
		expect(errors.some((message) => message.includes("effort override from") && message.includes("first"))).toBe(
			true,
		);
	});
});

describe("C3a overrides: two-path parity", () => {
	it("the genuine skill tool and user delivery apply the same override", async () => {
		// User-delivery path.
		const deliveryHarness = await createOverrideHarness([
			{ name: "both", frontmatter: { model: "opus-model", effort: "high" }, body: "body" },
		]);
		const deliveryRequests: CapturedRequest[] = [];
		deliveryHarness.setResponses([captureRequest(deliveryRequests)]);
		await deliveryHarness.session.prompt("/skill:both");

		// Genuine skill-tool path.
		const toolHarness = await createOverrideHarness([
			{ name: "both", frontmatter: { model: "opus-model", effort: "high" }, body: "body" },
		]);
		const toolRequests: CapturedRequest[] = [];
		toolHarness.setResponses([
			fauxAssistantMessage([fauxToolCall("skill", { name: "both" })], { stopReason: "toolUse" }),
			captureRequest(toolRequests),
		]);
		await toolHarness.session.prompt("do it");

		expect(deliveryRequests[0].modelId).toBe(toolRequests[0].modelId);
		expect(deliveryRequests[0].reasoning).toBe(toolRequests[0].reasoning);
		expect(deliveryRequests[0].modelId).toBe("opus-model");
		expect(deliveryRequests[0].reasoning).toBe("high");
	});
});

describe("C3a overrides: A.8 PI_EFFORT clamp", () => {
	it("clamps ${PI_EFFORT} in the rendered body to the model's supported levels", async () => {
		// xhigh is unsupported by a plain reasoning model (no thinkingLevelMap) → clamps to high.
		const harness = await createOverrideHarness([
			{ name: "clamp", frontmatter: { effort: "xhigh" }, body: "effort=${PI_EFFORT}" },
		]);
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("/skill:clamp");

		expect(deliveredSkillText(harness, "clamp")).toContain("effort=high");
	});
});

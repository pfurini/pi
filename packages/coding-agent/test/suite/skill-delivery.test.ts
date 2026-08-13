/**
 * C1c skill delivery tests (A.1/A.4): message-block construction and escaping,
 * synthetic pair construction and transport selection, the genuine `skill`
 * tool, notification-only synthetic events, pair immutability, queue
 * consumption, failure fallback, and B.12 entry metadata.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { convertToLlm } from "../../src/core/messages.ts";
import type { SessionMessageEntry } from "../../src/core/session-manager.ts";
import {
	buildSkillDelivery,
	buildSkillMessageBlock,
	buildSkillSyntheticPair,
	downgradeToMessageBlock,
	selectSkillTransport,
	sliceSkillInvocationSegments,
} from "../../src/core/skills/delivery.ts";
import type { RenderedSkillInvocation } from "../../src/core/skills/render.ts";
import type { SkillInvocationMetadata } from "../../src/core/skills/runtime.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ExtensionAPI } from "../../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, getMessageText, type Harness, type HarnessOptions } from "./harness.ts";

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

// ============================================================================
// Fixtures
// ============================================================================

function metadataFor(overrides: Partial<SkillInvocationMetadata> = {}): SkillInvocationMetadata {
	return {
		invocationId: "inv-1",
		skillId: "/skills/test/SKILL.md",
		name: "test",
		baseDir: "/skills/test",
		filePath: "/skills/test/SKILL.md",
		args: "",
		...overrides,
	};
}

function renderedFor(
	overrides: Partial<SkillInvocationMetadata> = {},
	body = "Rendered body.",
): RenderedSkillInvocation {
	return { invocation: metadataFor(overrides), body, diagnostics: [] };
}

function flaggedModel(base: Model<string>): Model<string> {
	return { ...base, syntheticToolResultReplay: true };
}

function flagModel(harness: Harness): void {
	harness.session.agent.state.model = flaggedModel(harness.session.agent.state.model as Model<string>);
}

async function createSkillHarness(options: {
	body?: string;
	frontmatter?: Record<string, unknown>;
	name?: string;
	extensionFactories?: Array<(pi: ExtensionAPI) => void>;
	settings?: HarnessOptions["settings"];
}): Promise<{ harness: Harness; tempDir: string; skillPath: string }> {
	const tempDir = join(tmpdir(), `pi-skill-delivery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	tempDirs.push(tempDir);
	const skillPath = join(tempDir, "SKILL.md");
	writeFileSync(skillPath, options.body ?? "# Test Skill\n\nUse the skill body.");
	const frontmatter = options.frontmatter ?? {};
	const skill = {
		name: options.name ?? "test",
		description: "Test skill",
		filePath: skillPath,
		disableModelInvocation: false,
		baseDir: tempDir,
		sourceInfo: createSyntheticSourceInfo(skillPath, {
			source: "local",
			scope: "project",
			origin: "top-level",
			baseDir: tempDir,
		}),
		...(Object.keys(frontmatter).length > 0 && { frontmatter }),
	};
	// Wire extension factories INTO the resource loader: createHarness only
	// connects its own extensionsResult when it creates the loader itself.
	const extensionsResult = options.extensionFactories
		? await createTestExtensionsResult(options.extensionFactories, tempDir)
		: undefined;
	const resourceLoader = {
		...createTestResourceLoader(extensionsResult ? { extensionsResult } : undefined),
		getSkills: () => ({ skills: [skill], diagnostics: [] }),
	};
	const harness = await createHarness({ resourceLoader, settings: options.settings });
	harnesses.push(harness);
	return { harness, tempDir, skillPath };
}

function messageEntries(harness: Harness): SessionMessageEntry[] {
	return harness.sessionManager.getEntries().filter((entry) => entry.type === "message");
}

// ============================================================================
// Unit: message block and synthetic pair construction (A.4)
// ============================================================================

describe("buildSkillMessageBlock", () => {
	it("wraps the body verbatim with XML-escaped name/args attributes and no location", () => {
		const block = buildSkillMessageBlock(
			metadataFor({ name: 'a"b<c>&d', args: 'x"<&>y' }),
			'Body <verbatim> "&" chars',
		);
		expect(block.text).toBe(
			'<skill name="a&quot;b&lt;c&gt;&amp;d" args="x&quot;&lt;&amp;&gt;y">\nBody <verbatim> "&" chars\n</skill>',
		);
		expect(block.invocation).toEqual({
			skillId: "/skills/test/SKILL.md",
			name: 'a"b<c>&d',
			args: 'x"<&>y',
			blockStart: 0,
			blockEnd: block.text.length,
		});
	});

	it("encodes empty args consistently", () => {
		const block = buildSkillMessageBlock(metadataFor(), "body");
		expect(block.text).toContain('args=""');
		expect(downgradeToMessageBlock(renderedFor({}, "body")).text).toBe(block.text);
	});
});

describe("buildSkillSyntheticPair", () => {
	it("builds the A.4 pair: one skill toolCall, zeroed usage, toolUse, correlated result", () => {
		const model = { id: "m", provider: "anthropic", api: "anthropic-messages" } as Model<any>;
		const pair = buildSkillSyntheticPair(renderedFor({ args: "a b" }, "Body text"), model);

		expect(pair.pairId).toBeTruthy();
		expect(pair.assistant.role).toBe("assistant");
		expect(pair.assistant.content).toEqual([
			{ type: "toolCall", id: pair.toolResult.toolCallId, name: "skill", arguments: { name: "test", args: "a b" } },
		]);
		expect(pair.toolResult.toolCallId).toMatch(/^skill_/);
		expect(pair.assistant.usage.totalTokens).toBe(0);
		expect(pair.assistant.stopReason).toBe("toolUse");
		expect(pair.assistant.provider).toBe("anthropic");
		expect(pair.assistant.model).toBe("m");
		expect(pair.toolResult).toMatchObject({ role: "toolResult", toolName: "skill", isError: false });
		expect(pair.toolResult.content).toEqual([{ type: "text", text: "Body text" }]);
	});
});

describe("selectSkillTransport", () => {
	const flagged = { provider: "anthropic", syntheticToolResultReplay: true } as const;
	const unflagged = { provider: "anthropic" } as const;

	it("selects the synthetic pair only for flagged, non-excluded models without the force setting", () => {
		expect(selectSkillTransport(flagged, { forceMessageBlock: false })).toBe("synthetic-pair");
		expect(selectSkillTransport(unflagged, { forceMessageBlock: false })).toBe("message-block");
		expect(
			selectSkillTransport(
				{ provider: "claude-bridge", syntheticToolResultReplay: true },
				{ forceMessageBlock: false },
			),
		).toBe("message-block");
		expect(selectSkillTransport(flagged, { forceMessageBlock: true })).toBe("message-block");
		expect(selectSkillTransport(undefined, { forceMessageBlock: false })).toBe("message-block");
	});
});

describe("buildSkillDelivery", () => {
	it("keeps images on a user-facing message ahead of the synthetic pair", () => {
		const model = { id: "m", provider: "anthropic", api: "anthropic-messages" } as Model<any>;
		const image = { type: "image" as const, data: "ZmFrZQ==", mimeType: "image/png" };
		const delivery = buildSkillDelivery(renderedFor(), "synthetic-pair", { model, images: [image] });
		expect(delivery.messages).toHaveLength(3);
		expect(delivery.messages[0]).toMatchObject({ role: "user", content: [image] });
		expect(delivery.messages[1]).toMatchObject({ role: "assistant" });
		expect(delivery.messages[2]).toMatchObject({ role: "toolResult" });
		// Entry metadata lives on the map, never as enumerable message properties.
		for (const message of delivery.messages) {
			expect(Object.keys(message as object)).not.toContain("pairId");
		}
		expect(delivery.textForm).toContain('<skill name="test"');
	});
});

describe("sliceSkillInvocationSegments", () => {
	it("slices multiple blocks in document order with astral Unicode offsets", () => {
		const text = `pre 💡 <skill name="a" args="">BODY-A</skill> mid <skill name="b" args="x">BODY-B</skill> post`;
		const startA = text.indexOf("<skill");
		const endA = text.indexOf("</skill>", startA) + "</skill>".length;
		const startB = text.indexOf("<skill", endA);
		const endB = text.indexOf("</skill>", startB) + "</skill>".length;
		const segments = sliceSkillInvocationSegments(text, [
			{ skillId: "1", name: "a", args: "", blockStart: startA, blockEnd: endA },
			{ skillId: "2", name: "b", args: "x", blockStart: startB, blockEnd: endB },
		]);
		expect(segments).toEqual([
			{ type: "text", text: "pre 💡 " },
			{
				type: "block",
				invocation: { skillId: "1", name: "a", args: "", blockStart: startA, blockEnd: endA },
				content: '<skill name="a" args="">BODY-A</skill>',
			},
			{ type: "text", text: " mid " },
			{
				type: "block",
				invocation: { skillId: "2", name: "b", args: "x", blockStart: startB, blockEnd: endB },
				content: '<skill name="b" args="x">BODY-B</skill>',
			},
			{ type: "text", text: " post" },
		]);
	});

	it("rejects malformed metadata", () => {
		const inv = { skillId: "1", name: "a", args: "" };
		expect(sliceSkillInvocationSegments("text", [{ ...inv, blockStart: 2, blockEnd: 99 }])).toBeUndefined();
		expect(sliceSkillInvocationSegments("text", [{ ...inv, blockStart: 3, blockEnd: 1 }])).toBeUndefined();
		expect(sliceSkillInvocationSegments("text", [{ ...inv, blockStart: -1, blockEnd: 2 }])).toBeUndefined();
		expect(sliceSkillInvocationSegments("text", [{ ...inv, blockStart: 1.5, blockEnd: 2 }])).toBeUndefined();
		expect(
			sliceSkillInvocationSegments("text", [
				{ ...inv, blockStart: 1, blockEnd: 3 },
				{ ...inv, blockStart: 2, blockEnd: 4 },
			]),
		).toBeUndefined();
	});

	it("treats an empty array as no blocks", () => {
		expect(sliceSkillInvocationSegments("plain", [])).toEqual([{ type: "text", text: "plain" }]);
	});
});

// ============================================================================
// Session-level: delivery transports, events, persistence (A.1/A.4/B.12)
// ============================================================================

describe("skill delivery through AgentSession", () => {
	it("delivers a direct invocation as a message block with B.12 entry metadata", async () => {
		const { harness } = await createSkillHarness({});
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("/skill:test explain this");

		const userMessage = harness.session.messages.find((message) => message.role === "user");
		const text = userMessage ? getMessageText(userMessage) : "";
		expect(text).toContain('<skill name="test" args="explain this">');
		expect(text).toContain("Use the skill body.");
		expect(text).not.toContain("location=");

		const entry = messageEntries(harness).find((e) => e.message.role === "user");
		expect(entry?.invocations).toEqual([
			{
				skillId: expect.any(String),
				name: "test",
				args: "explain this",
				blockStart: 0,
				blockEnd: text.length,
			},
		]);
	});

	it("delivers a flagged-model invocation as a synthetic pair with one notification-only synthetic event", async () => {
		const syntheticEvents: Array<Record<string, unknown>> = [];
		const toolCallEvents: unknown[] = [];
		const { harness } = await createSkillHarness({
			extensionFactories: [
				(pi: ExtensionAPI) => {
					pi.on("tool_result", (event) => {
						if (event.synthetic) syntheticEvents.push(event as unknown as Record<string, unknown>);
					});
					pi.on("tool_call", (event) => {
						toolCallEvents.push(event);
					});
				},
			],
		});
		flagModel(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("/skill:test do it");

		const roles = harness.session.messages.map((message) => message.role);
		expect(roles).toEqual(["assistant", "toolResult", "assistant"]);
		const [pairAssistant, pairResult] = harness.session.messages;
		expect(pairAssistant).toMatchObject({ role: "assistant", stopReason: "toolUse" });
		expect(pairResult).toMatchObject({ role: "toolResult", toolName: "skill", isError: false });
		expect(getMessageText(pairResult)).toContain("Use the skill body.");

		// A.4: no vetoable tool_call, exactly one synthetic tool_result notification.
		expect(toolCallEvents).toEqual([]);
		expect(syntheticEvents).toHaveLength(1);
		expect(syntheticEvents[0]).toMatchObject({
			toolName: "skill",
			isError: false,
			synthetic: true,
			input: { name: "test", args: "do it" },
		});

		// B.12: both entries persist, correlated by an entry-level pairId.
		const entries = messageEntries(harness);
		const assistantEntry = entries.find((e) => e.message.role === "assistant" && e.pairId);
		const resultEntry = entries.find((e) => e.message.role === "toolResult");
		expect(assistantEntry?.pairId).toBeTruthy();
		expect(resultEntry?.pairId).toBe(assistantEntry?.pairId);
		expect(resultEntry?.parentId).toBe(assistantEntry?.id);
		expect(resultEntry?.invocations?.[0]).toMatchObject({ name: "test", args: "do it" });

		// C1a wire contract: no persistence metadata leaks into the provider payload.
		const wire = JSON.stringify(await convertToLlm(harness.session.messages));
		expect(wire).not.toContain("pairId");
		expect(wire).not.toContain("invocations");
	});

	it("forces the message block when forceSkillMessageBlock is set, even for a flagged model", async () => {
		const { harness } = await createSkillHarness({ settings: { forceSkillMessageBlock: true } });
		flagModel(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("/skill:test go");

		expect(harness.session.messages[0]?.role).toBe("user");
		expect(getMessageText(harness.session.messages[0]!)).toContain('<skill name="test" args="go">');
		expect(messageEntries(harness).every((e) => e.pairId === undefined)).toBe(true);
	});

	it("keeps render failures literal and emits a diagnostic", async () => {
		const { harness, skillPath } = await createSkillHarness({});
		rmSync(skillPath); // render's readFile will fail
		const errors: string[] = [];
		harness.session.extensionRunner.onError((error) => {
			errors.push(`${error.event}: ${error.error}`);
		});
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("/skill:test literal fallback");

		const userMessage = harness.session.messages.find((message) => message.role === "user");
		expect(userMessage ? getMessageText(userMessage) : "").toBe("/skill:test literal fallback");
		expect(errors.some((error) => error.startsWith("skill_expansion:"))).toBe(true);
	});
});

describe("genuine skill tool calls (A.1)", () => {
	it("returns rendered content through the normal tool lifecycle", async () => {
		const toolResults: Array<Record<string, unknown>> = [];
		const { harness } = await createSkillHarness({
			extensionFactories: [
				(pi: ExtensionAPI) => {
					pi.on("tool_result", (event) => {
						toolResults.push(event as unknown as Record<string, unknown>);
					});
				},
			],
		});

		// The skill tool is registered and active like a built-in.
		expect(harness.session.getActiveToolNames()).toContain("skill");
		expect(harness.session.systemPrompt).toContain("Use the skill tool to invoke a skill");

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("skill", { name: "test", args: "via tool" })], { stopReason: "toolUse" }),
			(context) => {
				const result = context.messages.find((message) => message.role === "toolResult");
				return fauxAssistantMessage(result ? `got: ${getMessageText(result).slice(0, 40)}` : "no result");
			},
		]);

		await harness.session.prompt("use the skill");

		const toolResult = harness.session.messages.find((message) => message.role === "toolResult");
		expect(toolResult).toMatchObject({ toolName: "skill", isError: false });
		expect(getMessageText(toolResult!)).toContain("Use the skill body.");

		// Genuine path: normal tool events, not flagged synthetic.
		expect(toolResults).toHaveLength(1);
		expect(toolResults[0]).toMatchObject({ toolName: "skill", isError: false });
		expect(toolResults[0].synthetic).toBeUndefined();

		// B.12 metadata persists on the genuine tool result entry too.
		const resultEntry = messageEntries(harness).find((e) => e.message.role === "toolResult");
		expect(resultEntry?.invocations?.[0]).toMatchObject({ name: "test", args: "via tool" });

		const lastAssistant = getMessageText(harness.session.messages[harness.session.messages.length - 1]!);
		expect(lastAssistant).toContain("got:");
	});

	it("returns an error naming valid alternatives for unknown or hidden skills", async () => {
		const { harness } = await createSkillHarness({});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("skill", { name: "nonexistent" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("recovered"),
		]);

		await harness.session.prompt("use a skill");

		const toolResult = harness.session.messages.find((message) => message.role === "toolResult");
		expect(toolResult).toMatchObject({ toolName: "skill", isError: true });
		expect(getMessageText(toolResult!)).toContain("nonexistent");
		expect(getMessageText(toolResult!)).toContain("test");
	});

	it("defaults omitted genuine-tool args to an empty string in rendered metadata", async () => {
		const { harness } = await createSkillHarness({});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("skill", { name: "test" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("use the skill");

		const resultEntry = messageEntries(harness).find((e) => e.message.role === "toolResult");
		expect(resultEntry?.invocations?.[0]).toMatchObject({ name: "test", args: "" });
		const toolResult = harness.session.messages.find((message) => message.role === "toolResult");
		expect(getMessageText(toolResult!)).toContain("Use the skill body.");
	});
});

describe("synthetic pair immutability (A.4)", () => {
	it("ignores mutating tool_result handlers and same-role message_end replacements", async () => {
		const { harness } = await createSkillHarness({
			extensionFactories: [
				(pi: ExtensionAPI) => {
					pi.on("tool_result", (event) => {
						if (event.synthetic) {
							// Mutate the handler's snapshot AND return modified content;
							// neither may reach the authoritative persisted result.
							event.content = [{ type: "text", text: "MUTATED" }];
							return { content: [{ type: "text", text: "MUTATED" }] };
						}
						return undefined;
					});
					pi.on("message_end", (event) => {
						if (event.message.role === "assistant") {
							return {
								message: {
									...event.message,
									content: [{ type: "text", text: "REPLACED" }],
								},
							};
						}
						return undefined;
					});
				},
			],
		});
		flagModel(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("/skill:test immutable");

		const pairResult = harness.session.messages.find((message) => message.role === "toolResult");
		expect(getMessageText(pairResult!)).toContain("Use the skill body.");
		expect(getMessageText(pairResult!)).not.toContain("MUTATED");
		const pairAssistant = harness.session.messages[0];
		expect(pairAssistant?.role).toBe("assistant");
		expect(JSON.stringify(pairAssistant)).not.toContain("REPLACED");

		// The persisted entries match the immutable messages.
		const resultEntry = messageEntries(harness).find((e) => e.message.role === "toolResult");
		expect(getMessageText(resultEntry!.message)).toContain("Use the skill body.");
	});

	it("snapshots the details payload so a synthetic tool_result handler cannot mutate it", async () => {
		const { harness } = await createSkillHarness({
			extensionFactories: [
				(pi: ExtensionAPI) => {
					pi.on("tool_result", (event) => {
						if (event.synthetic) {
							const details = (event as { details?: { invocation?: { name?: string } } }).details;
							if (details?.invocation) details.invocation.name = "HACKED";
						}
						return undefined;
					});
				},
			],
		});
		flagModel(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("/skill:test details");

		const resultEntry = messageEntries(harness).find((e) => e.message.role === "toolResult");
		const details = (resultEntry?.message as { details?: { invocation?: { name?: string } } }).details;
		expect(details?.invocation?.name).toBe("test");
	});
});

/**
 * C3a (A.2) `disallowed-tools` enforcement end-to-end through AgentSession with
 * the faux provider: schema removal from the first and subsequent requests, the
 * pre-lookup `isToolCallDisallowed` policy block that names the tool even after
 * schema removal, the stacked union, same-batch sibling exemption (parallel and
 * sequential), redirect resolution (defaults + a custom settings map), CSV and
 * `Tool(pattern)` diagnostics, and the pre-run rollback. Programmatic fixtures +
 * faux provider only (no real APIs/keys).
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	type Context,
	type FauxResponseFactory,
	fauxAssistantMessage,
	fauxToolCall,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { Settings } from "../../src/core/settings-manager.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ExtensionAPI, ResourceLoader } from "../../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

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
	const tempDir = join(tmpdir(), `pi-c3a-dt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	tempDirs.push(tempDir);
	return tempDir;
}

function createSkillsLoader(tempDir: string, fixtures: SkillFixture[]): Pick<ResourceLoader, "getSkills"> {
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
	return { getSkills: () => ({ skills, diagnostics: [] }) };
}

function passthroughTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `${name} tool`,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: `${name} ran` }], details: {} }),
	};
}

async function createDisallowHarness(
	fixtures: SkillFixture[],
	tools: AgentTool[],
	options: { settings?: Partial<Settings>; extensionFactories?: Array<(pi: ExtensionAPI) => void> } = {},
): Promise<Harness> {
	const tempDir = makeTempDir();
	const skillsLoader = createSkillsLoader(tempDir, fixtures);
	const extensionsResult = options.extensionFactories
		? await createTestExtensionsResult(options.extensionFactories, tempDir)
		: undefined;
	const resourceLoader: ResourceLoader = {
		...createTestResourceLoader(extensionsResult ? { extensionsResult } : undefined),
		getSkills: skillsLoader.getSkills,
	};
	const harness = await createHarness({ resourceLoader, tools, settings: options.settings });
	harnesses.push(harness);
	return harness;
}

interface CapturedRequest {
	toolNames: string[];
}

function captureRequest(sink: CapturedRequest[], text = "ok"): FauxResponseFactory {
	return (context: Context, _options: SimpleStreamOptions | undefined, _state, _model: Model<string>) => {
		sink.push({ toolNames: (context.tools ?? []).map((tool) => tool.name) });
		return fauxAssistantMessage(text);
	};
}

function toolResultFor(harness: Harness, toolName: string): { isError?: boolean; text: string } | undefined {
	const message = harness.session.messages.find((m) => m.role === "toolResult" && m.toolName === toolName);
	if (!message || message.role !== "toolResult") {
		return undefined;
	}
	return { isError: message.isError, text: getMessageText(message) };
}

describe("C3a disallowed-tools: schema removal", () => {
	it("removes a disallowed tool from the first request while keeping the rest", async () => {
		const harness = await createDisallowHarness(
			[{ name: "nobash", frontmatter: { "disallowed-tools": ["bash"] }, body: "body" }],
			[passthroughTool("bash"), passthroughTool("keep")],
		);
		const requests: CapturedRequest[] = [];
		harness.setResponses([captureRequest(requests)]);

		await harness.session.prompt("/skill:nobash");

		expect(requests[0].toolNames).toContain("keep");
		expect(requests[0].toolNames).not.toContain("bash");
	});

	it("removes the disallowed tool from a subsequent request too", async () => {
		const harness = await createDisallowHarness(
			[{ name: "nobash", frontmatter: { "disallowed-tools": ["bash"] }, body: "body" }],
			[passthroughTool("bash"), passthroughTool("keep")],
		);
		const requests: CapturedRequest[] = [];
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("keep", {})], { stopReason: "toolUse" }),
			captureRequest(requests),
		]);

		await harness.session.prompt("/skill:nobash");

		expect(requests[0].toolNames).not.toContain("bash");
		expect(requests[0].toolNames).toContain("keep");
	});
});

describe("C3a disallowed-tools: pre-lookup policy block", () => {
	it("blocks a call to an already-removed tool with a message naming the tool", async () => {
		const harness = await createDisallowHarness(
			[{ name: "nobash", frontmatter: { "disallowed-tools": ["bash"] }, body: "body" }],
			[passthroughTool("bash")],
		);
		harness.setResponses([
			// The model calls bash even though it was removed from the schema.
			fauxAssistantMessage([fauxToolCall("bash", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("/skill:nobash");

		const result = toolResultFor(harness, "bash");
		expect(result?.isError).toBe(true);
		expect(result?.text).toContain("bash");
		expect(result?.text).toContain("disallowed-tools policy");
		expect(result?.text).not.toContain("not found");
	});
});

describe("C3a disallowed-tools: stacked union", () => {
	it("unions disallowed tools across two stacked invocations", async () => {
		const harness = await createDisallowHarness(
			[
				{ name: "nobash", frontmatter: { "disallowed-tools": ["bash"] }, body: "a" },
				{ name: "noread", frontmatter: { "disallowed-tools": ["read"] }, body: "b" },
			],
			[passthroughTool("bash"), passthroughTool("read"), passthroughTool("keep")],
		);
		const requests: CapturedRequest[] = [];
		harness.setResponses([captureRequest(requests)]);

		await harness.session.prompt("stack /nobash then /noread");

		expect(requests[0].toolNames).toContain("keep");
		expect(requests[0].toolNames).not.toContain("bash");
		expect(requests[0].toolNames).not.toContain("read");
	});
});

describe("C3a disallowed-tools: same-batch sibling exemption", () => {
	for (const scenario of [
		{ label: "parallel, skill first", mode: undefined, order: ["skill", "bash"] as const },
		{ label: "parallel, bash first", mode: undefined, order: ["bash", "skill"] as const },
		{ label: "sequential, skill first", mode: "sequential" as const, order: ["skill", "bash"] as const },
	]) {
		it(`does not block a same-batch sibling of the invoking skill call (${scenario.label})`, async () => {
			// Keep the built-in tool set so the genuine `skill` tool and a built-in
			// `read` sibling are both active; disallow `read`.
			const tempDir = makeTempDir();
			const skillsLoader = createSkillsLoader(tempDir, [
				{ name: "noread", frontmatter: { "disallowed-tools": ["read"] }, body: "body" },
			]);
			const resourceLoader: ResourceLoader = {
				...createTestResourceLoader(),
				getSkills: skillsLoader.getSkills,
			};
			const harness = await createHarness({ resourceLoader });
			harnesses.push(harness);
			writeFileSync(join(harness.tempDir, "sib.txt"), "SIBLING_CONTENT");
			if (scenario.mode === "sequential") {
				harness.session.agent.toolExecution = "sequential";
			}
			const requests: CapturedRequest[] = [];
			const toolCalls = scenario.order.map((name) =>
				name === "skill" ? fauxToolCall("skill", { name: "noread" }) : fauxToolCall("read", { path: "sib.txt" }),
			);
			harness.setResponses([fauxAssistantMessage(toolCalls, { stopReason: "toolUse" }), captureRequest(requests)]);

			await harness.session.prompt("go");

			// The sibling read ran (returned the file content) and was NOT policy
			// blocked: the per-request union snapshot predates the skill's mid-batch
			// activation, so this batch is exempt.
			const read = toolResultFor(harness, "read");
			expect(read?.text).not.toContain("disallowed-tools policy");
			expect(read?.text).toContain("SIBLING_CONTENT");
			// The restriction takes effect on the NEXT request.
			expect(requests[0].toolNames).not.toContain("read");
		});
	}
});

describe("C3a disallowed-tools: redirect resolution", () => {
	it("blocks the redirect target for a CC tool name via the default map", async () => {
		const harness = await createDisallowHarness(
			[{ name: "notask", frontmatter: { "disallowed-tools": ["Task"] }, body: "body" }],
			[passthroughTool("Agent"), passthroughTool("keep")],
		);
		const requests: CapturedRequest[] = [];
		harness.setResponses([captureRequest(requests)]);

		await harness.session.prompt("/skill:notask");

		// Default redirect Task → Agent (ADR-0006).
		expect(requests[0].toolNames).not.toContain("Agent");
		expect(requests[0].toolNames).toContain("keep");
	});

	it("honors a custom settings redirect map", async () => {
		const harness = await createDisallowHarness(
			[{ name: "noterminal", frontmatter: { "disallowed-tools": ["Terminal"] }, body: "body" }],
			[passthroughTool("bash"), passthroughTool("keep")],
			{ settings: { toolRedirects: { Terminal: "bash" } } },
		);
		const requests: CapturedRequest[] = [];
		harness.setResponses([captureRequest(requests)]);

		await harness.session.prompt("/skill:noterminal");

		expect(requests[0].toolNames).not.toContain("bash");
		expect(requests[0].toolNames).toContain("keep");
	});
});

describe("C3a disallowed-tools: input forms and diagnostics", () => {
	it("accepts a CSV form and removes each named tool", async () => {
		const harness = await createDisallowHarness(
			[{ name: "csv", frontmatter: { "disallowed-tools": "bash, read" }, body: "body" }],
			[passthroughTool("bash"), passthroughTool("read"), passthroughTool("keep")],
		);
		const requests: CapturedRequest[] = [];
		harness.setResponses([captureRequest(requests)]);

		await harness.session.prompt("/skill:csv");

		expect(requests[0].toolNames).not.toContain("bash");
		expect(requests[0].toolNames).not.toContain("read");
		expect(requests[0].toolNames).toContain("keep");
	});

	it("reduces a Tool(pattern) entry to the bare tool with a diagnostic", async () => {
		const harness = await createDisallowHarness(
			[{ name: "pat", frontmatter: { "disallowed-tools": ["bash(rm -rf)"] }, body: "body" }],
			[passthroughTool("bash")],
		);
		const errors: string[] = [];
		harness.session.extensionRunner.onError((error) => {
			errors.push(error.error);
		});
		const requests: CapturedRequest[] = [];
		harness.setResponses([captureRequest(requests)]);

		await harness.session.prompt("/skill:pat");

		expect(requests[0].toolNames).not.toContain("bash");
		expect(errors.some((message) => message.includes("parenthesized pattern"))).toBe(true);
	});
});

describe("C3a disallowed-tools: pre-run rollback", () => {
	it("a before_agent_start throw after activation leaves the next prompt unrestricted", async () => {
		let shouldThrow = true;
		const harness = await createDisallowHarness(
			[{ name: "nobash", frontmatter: { "disallowed-tools": ["bash"] }, body: "body" }],
			[passthroughTool("bash"), passthroughTool("keep")],
			{
				extensionFactories: [
					(pi) => {
						pi.on("before_agent_start", async () => {
							if (!shouldThrow) {
								return undefined;
							}
							// A malformed result message: accessing customType throws in the
							// session's post-activation message loop (before_agent_start runs
							// after the skill activated), exercising the pre-run rollback.
							const message = {} as { customType: string; content: unknown[] };
							Object.defineProperty(message, "customType", {
								get() {
									throw new Error("before_agent_start message exploded");
								},
							});
							return { message } as never;
						});
					},
				],
			},
		);
		const requests: CapturedRequest[] = [];
		harness.setResponses([captureRequest(requests)]);

		// The skill activates, then the malformed result throws → the prompt rejects.
		await expect(harness.session.prompt("/skill:nobash")).rejects.toThrow("before_agent_start message exploded");
		// No active invocation or restriction leaked past the failed run.
		expect(harness.session.skillRuntime.getActiveInvocations()).toHaveLength(0);

		shouldThrow = false;
		await harness.session.prompt("plain prompt");

		// The next request is unrestricted: bash is present again.
		expect(requests[0].toolNames).toContain("bash");
	});
});

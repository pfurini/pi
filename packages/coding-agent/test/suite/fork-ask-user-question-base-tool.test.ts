/**
 * Fork: `ask_user_question` is a base tool like `read`. These tests build real sessions on
 * the suite harness, whose `createTestResourceLoader` is a custom `ResourceLoader`, not a
 * `DefaultResourceLoader`. The tool must still register, follow the allow, exclude and
 * active rules, stay available without a UI, and emit its events on the loader's event
 * bus. Plan: docs/plans/ask-user-question-base-tool.plan.md.
 */
import { getCurrentTools } from "@earendil-works/pi-ai";
import { type Context, fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBus } from "../../src/core/event-bus.ts";
import type { ExtensionAPI, ExtensionUIContext } from "../../src/core/extensions/types.ts";
import { ASK_USER_PROMPT_EVENT } from "../../src/core/fork-builtins/ask-user-question/events.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

const NAME = "ask_user_question";
const harnesses: Harness[] = [];

afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	vi.unstubAllEnvs();
});

async function sessionWith(options: HarnessOptions = {}, builtins: "on" | "off" = "on"): Promise<Harness> {
	vi.stubEnv("PI_FORK_BUILTINS", builtins);
	const harness = await createHarness(options);
	harnesses.push(harness);
	return harness;
}

/** A UI whose questionnaire answers the first option; every other method is a no-op. */
function answeringUi(): ExtensionUIContext {
	const custom = vi.fn(async () => ({
		answers: [{ questionIndex: 0, question: "Pick one", kind: "option", answer: "Alpha" }],
		cancelled: false,
	}));
	return new Proxy({ custom } as Record<string | symbol, unknown>, {
		get: (target, key) => (key in target ? target[key] : () => undefined),
	}) as unknown as ExtensionUIContext;
}

/** Sends one prompt and returns the tool names the model received: the system messages' tool deltas. */
async function prompt(harness: Harness): Promise<string[]> {
	const sent: string[] = [];
	harness.setResponses([
		(context: Context) => {
			sent.push(...getCurrentTools(context.messages).map((tool) => tool.name));
			return fauxAssistantMessage("ok");
		},
	]);
	await harness.session.prompt("hello");
	return sent;
}

describe("ask_user_question as a base tool", () => {
	it("registers and activates with a custom ResourceLoader, as builtin", async () => {
		const harness = await sessionWith();
		const tool = harness.session.getAllTools().find((info) => info.name === NAME);
		expect(tool?.sourceInfo.path).toBe(`<builtin:${NAME}>`);
		expect(harness.session.getActiveToolNames()).toContain(NAME);
	});

	it("is absent when PI_FORK_BUILTINS=off", async () => {
		const harness = await sessionWith({}, "off");
		expect(harness.session.getAllTools().some((info) => info.name === NAME)).toBe(false);
	});

	it("follows the allow and exclude lists like read", async () => {
		const allowed = await sessionWith({ allowedToolNames: ["read"] });
		expect(allowed.session.getAllTools().map((info) => info.name)).not.toContain(NAME);
		const excluded = await sessionWith({ excludedToolNames: [NAME] });
		expect(excluded.session.getAllTools().map((info) => info.name)).not.toContain(NAME);
	});

	it("stays registered but inactive when an SDK caller passes its own base tools", async () => {
		const harness = await sessionWith({ tools: [] });
		expect(harness.session.getAllTools().some((info) => info.name === NAME)).toBe(true);
		expect(harness.session.getActiveToolNames()).not.toContain(NAME);
	});

	it("stays active without a UI, and a call there fails with no_ui", async () => {
		const harness = await sessionWith();
		expect(await prompt(harness), "the tools the model received").toContain(NAME);
		expect(harness.session.getActiveToolNames()).toContain(NAME);

		const tool = harness.session.agent.state.tools.find((candidate) => candidate.name === NAME);
		const result = await tool?.execute("call-1", {
			questions: [
				{
					question: "Pick one",
					header: "Choice",
					options: [
						{ label: "Alpha", description: "First" },
						{ label: "Beta", description: "Second" },
					],
				},
			],
		});
		expect(result?.details).toMatchObject({ cancelled: true, error: "no_ui" });
	});

	it("keeps a deactivation across prompts, with or without a UI", async () => {
		const harness = await sessionWith();
		harness.session.setActiveToolsByName(harness.session.getActiveToolNames().filter((name) => name !== NAME));
		await prompt(harness);
		expect(harness.session.getActiveToolNames()).not.toContain(NAME);
		await harness.session.bindExtensions({ uiContext: answeringUi(), mode: "tui" });
		await prompt(harness);
		expect(harness.session.getActiveToolNames()).not.toContain(NAME);
	});

	it("a same-named extension tool wins over the base tool", async () => {
		const factory = (pi: ExtensionAPI) => {
			pi.registerTool({
				name: NAME,
				label: "Extension ask",
				description: "An extension's own ask tool",
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: "extension" }], details: {} }),
			});
		};
		const harness = await sessionWith({ extensionFactories: [{ name: "own-ask", factory }] });
		const tool = harness.session.getAllTools().find((info) => info.name === NAME);
		expect(tool?.sourceInfo.path).toBe("<inline:own-ask>");
		await prompt(harness);
		expect(harness.session.getActiveToolNames()).toContain(NAME);
	});

	it("emits the prompt event on the resource loader's event bus and returns the answer", async () => {
		const eventBus = createEventBus();
		const prompts: unknown[] = [];
		eventBus.on(ASK_USER_PROMPT_EVENT, (data) => prompts.push(data));
		const harness = await sessionWith({ eventBus });
		await harness.session.bindExtensions({ uiContext: answeringUi(), mode: "tui" });

		const tool = harness.session.agent.state.tools.find((candidate) => candidate.name === NAME);
		const result = await tool?.execute("call-1", {
			questions: [
				{
					question: "Pick one",
					header: "Choice",
					options: [
						{ label: "Alpha", description: "First" },
						{ label: "Beta", description: "Second" },
					],
				},
			],
		});
		expect(prompts).toHaveLength(1);
		expect(JSON.stringify(result?.content)).toContain("Alpha");
	});
});

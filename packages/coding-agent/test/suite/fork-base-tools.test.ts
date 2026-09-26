/**
 * Fork: `ask_user_question` and `vcc_recall` are base tools (ADR-0009). These tests build real
 * sessions on the suite harness, whose `createTestResourceLoader` is a custom `ResourceLoader`.
 * The rule under test: each tool is active unless the session's allowlist or exclude list
 * removes it. Turning off Pi's own tools, through an empty initial active list or a caller's
 * base tools, leaves both active, as it leaves extension tools.
 */
import { getCurrentTools } from "@earendil-works/pi-ai";
import { type Context, fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "../../src/core/extensions/types.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

const harnesses: Harness[] = [];

/** The id of the last user message entry. Navigating to it moves the leaf to its parent and restores that branch's tools. */
function lastUserId(harness: Harness): string {
	const users = harness.sessionManager
		.getEntries()
		.filter((entry) => entry.type === "message" && entry.message.role === "user");
	const last = users[users.length - 1];
	if (!last) throw new Error("no user message");
	return last.id;
}

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

describe.each(["ask_user_question", "vcc_recall"])("%s as a fork base tool", (name) => {
	it("registers and activates with a custom ResourceLoader, as builtin", async () => {
		const harness = await sessionWith();
		const tool = harness.session.getAllTools().find((info) => info.name === name);
		expect(tool?.sourceInfo.path).toBe(`<builtin:${name}>`);
		expect(await prompt(harness), "the tools the model received").toContain(name);
	});

	it("is absent when PI_FORK_BUILTINS=off", async () => {
		const harness = await sessionWith({}, "off");
		expect(harness.session.getAllTools().some((info) => info.name === name)).toBe(false);
	});

	it("follows the allow and exclude lists like read", async () => {
		const allowed = await sessionWith({ allowedToolNames: ["read"] });
		expect(allowed.session.getAllTools().map((info) => info.name)).not.toContain(name);
		const listed = await sessionWith({ allowedToolNames: ["read", name] });
		expect(listed.session.getActiveToolNames()).toContain(name);
		const excluded = await sessionWith({ excludedToolNames: [name] });
		expect(excluded.session.getAllTools().map((info) => info.name)).not.toContain(name);
	});

	it("stays active when an SDK caller passes its own base tools", async () => {
		const harness = await sessionWith({ tools: [] });
		expect(await prompt(harness), "the tools the model received").toContain(name);
	});

	it("stays active when the session starts with no default tools, as --no-builtin-tools does", async () => {
		const harness = await sessionWith({ initialActiveToolNames: [] });
		expect(harness.session.getActiveToolNames()).toEqual(expect.arrayContaining([name]));
		expect(harness.session.getActiveToolNames()).not.toContain("read");
	});

	it("stays active beside a narrowed default list, as a defaultTools setting gives", async () => {
		const harness = await sessionWith({ initialActiveToolNames: ["read"] });
		expect(harness.session.getActiveToolNames()).toEqual(expect.arrayContaining(["read", name]));
		expect(harness.session.getActiveToolNames()).not.toContain("bash");
	});

	it("never activates a caller's base tool of the same name", async () => {
		const callers = {
			name,
			label: "Caller's tool",
			description: "A caller's own tool",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text" as const, text: "caller" }], details: {} }),
		};
		const harness = await sessionWith({ tools: [callers], initialActiveToolNames: [] });
		expect(harness.session.getAllTools().some((info) => info.name === name)).toBe(true);
		expect(harness.session.getActiveToolNames()).not.toContain(name);
	});

	it("a same-named extension tool wins over the base tool", async () => {
		const factory = (pi: ExtensionAPI) => {
			pi.registerTool({
				name,
				label: "Extension tool",
				description: "An extension's own tool",
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: "extension" }], details: {} }),
			});
		};
		const harness = await sessionWith({ extensionFactories: [{ name: "own-tool", factory }] });
		const tool = harness.session.getAllTools().find((info) => info.name === name);
		expect(tool?.sourceInfo.path).toBe("<inline:own-tool>");
		const active = harness.session.agent.state.tools.find((candidate) => candidate.name === name);
		expect(JSON.stringify((await active?.execute("call-1", {}))?.content)).toContain("extension");
	});

	it("comes back on /reload after a deactivation, like an extension tool", async () => {
		const harness = await sessionWith();
		harness.session.setActiveToolsByName(harness.session.getActiveToolNames().filter((active) => active !== name));
		expect(harness.session.getActiveToolNames()).not.toContain(name);
		await harness.session.reload();
		expect(harness.session.getActiveToolNames()).toContain(name);
	});

	it("comes back on tree navigation when the transcript never carried it", async () => {
		const harness = await sessionWith();
		harness.session.setActiveToolsByName(harness.session.getActiveToolNames().filter((active) => active !== name));
		expect(await prompt(harness)).not.toContain(name);
		await harness.session.navigateTree(lastUserId(harness));
		expect(harness.session.getActiveToolNames()).toContain(name);
	});

	it("stays off on tree navigation when the transcript recorded its removal", async () => {
		const harness = await sessionWith();
		expect(await prompt(harness)).toContain(name);
		harness.session.setActiveToolsByName(harness.session.getActiveToolNames().filter((active) => active !== name));
		expect(await prompt(harness)).not.toContain(name);
		await prompt(harness);
		await harness.session.navigateTree(lastUserId(harness));
		expect(harness.session.getActiveToolNames()).not.toContain(name);
	});
});

describe("vcc_recall as a base tool", () => {
	it("recalls the session's own messages through the base-tool context", async () => {
		const harness = await sessionWith();
		await prompt(harness);
		const tool = harness.session.agent.state.tools.find((candidate) => candidate.name === "vcc_recall");
		const result = await tool?.execute("call-1", { query: "hello" });
		expect(JSON.stringify(result?.content)).toContain("hello");
	});
});

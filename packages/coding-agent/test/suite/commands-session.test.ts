/**
 * A.1 send-path integration through AgentSession with the faux provider:
 * mid-prompt mixed skill+command composition, UTF-16 B.12 offsets, the
 * argument-ownership single-skill path, command rendering, the
 * `expandPromptTemplates:false` replay bypass, and the unified `getCommands()`
 * listing (built-ins exactly once, structural source values).
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { LoadedCommand } from "../../src/core/commands/loader.ts";
import { sliceSkillInvocationSegments } from "../../src/core/skills/delivery.ts";
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

interface SkillFixture {
	name: string;
	body: string;
	frontmatter?: Record<string, unknown>;
}

function makeTempDir(): string {
	const dir = join(tmpdir(), `commands-session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	tempDirs.push(dir);
	return dir;
}

function command(name: string, body: string, opts: Partial<LoadedCommand> = {}): LoadedCommand {
	const filePath = `/commands/${name}.md`;
	return {
		kind: opts.kind ?? "command",
		name,
		frontmatter: opts.frontmatter ?? {},
		body,
		filePath,
		baseDir: "/commands",
		sourceInfo: createSyntheticSourceInfo(filePath, { source: "local", scope: "user" }),
		commandNameValid: true,
		userInvocable: true,
		disableModelInvocation: opts.disableModelInvocation ?? false,
	};
}

interface SessionOptions {
	skills?: SkillFixture[];
	commands?: LoadedCommand[];
	tools?: AgentTool[];
	extensionFactories?: Array<(pi: ExtensionAPI) => void>;
}

async function createSession(options: SessionOptions): Promise<Harness> {
	const tempDir = makeTempDir();
	const skills = (options.skills ?? []).map((fixture) => {
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
			sourceInfo: createSyntheticSourceInfo(filePath, { source: "local", scope: "project", baseDir }),
			...(fixture.frontmatter &&
				Object.keys(fixture.frontmatter).length > 0 && { frontmatter: fixture.frontmatter }),
		};
	});
	const commands = options.commands ?? [];
	const resourceLoader: ResourceLoader = {
		...createTestResourceLoader(),
		getSkills: () => ({ skills, diagnostics: [] }),
		getCommands: () => ({ commands, diagnostics: [] }),
	};
	const harness = await createHarness({
		resourceLoader,
		...(options.tools && { tools: options.tools }),
		...(options.extensionFactories && { extensionFactories: options.extensionFactories }),
	});
	harnesses.push(harness);
	return harness;
}

/**
 * Session with a `wait` tool held open: prompt "start" is streaming until
 * `releaseToolExecution()` resolves, so steer/followUp hit the queue path.
 */
async function createWaitingSession(options: SessionOptions): Promise<{
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
			return { content: [{ type: "text", text: "released" }], details: {} };
		},
	};
	const harness = await createSession({ ...options, tools: [waitTool, ...(options.tools ?? [])] });
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
function deliveredUserMessage(harness: Harness) {
	return harness.session.messages.find((message) => message.role === "user");
}

describe("mid-prompt composition and B.12 offsets", () => {
	it("splices a skill block and command text into one message with valid UTF-16 offsets", async () => {
		const harness = await createSession({
			skills: [{ name: "rev", body: "REVIEWED-😀" }],
			commands: [command("note", "NOTE-😀")],
		});
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("😀 start /rev mid /note end");

		const message = deliveredUserMessage(harness);
		expect(message).toBeDefined();
		const text = getMessageText(message);
		expect(text).toContain('<skill name="rev" args="">');
		expect(text).toContain("REVIEWED-😀");
		expect(text).toContain("NOTE-😀");

		const invocations = harness.session.getMessageSkillInvocations(message!);
		expect(invocations).toBeDefined();
		expect(invocations).toHaveLength(1);
		expect(invocations?.[0].name).toBe("rev");
		// Offsets are valid UTF-16 code-unit ranges: the slicer accepts them and
		// carves out exactly the skill block.
		const segments = sliceSkillInvocationSegments(text, invocations ?? []);
		expect(segments).toBeDefined();
		const block = segments?.find((segment) => segment.type === "block");
		expect(block?.type === "block" && block.content.includes("REVIEWED-😀")).toBe(true);
	});
});

describe("argument ownership and command rendering", () => {
	it("a message-initial skill owns the whole remainder as args", async () => {
		const harness = await createSession({ skills: [{ name: "rev", body: "args=[$ARGUMENTS]" }] });
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("/rev src/core and more");

		const text = getMessageText(deliveredUserMessage(harness));
		expect(text).toContain('<skill name="rev" args="src/core and more">');
		expect(text).toContain("args=[src/core and more]");
	});

	it("a collapsed leading backslash before a message-initial skill is preserved", async () => {
		const harness = await createSession({ skills: [{ name: "rev", body: "REVIEWED" }] });
		harness.setResponses([fauxAssistantMessage("ok")]);

		// `\\/` collapses to one literal backslash; the skill still invokes and the
		// `\` must survive in the composed message (not the sole-skill path).
		await harness.session.prompt("\\\\/rev take this");

		const text = getMessageText(deliveredUserMessage(harness));
		expect(text.startsWith('\\<skill name="rev" args="take this">')).toBe(true);
		expect(text).toContain("REVIEWED");
	});

	it("a message-initial command renders its body with substituted args", async () => {
		const harness = await createSession({ commands: [command("deploy", "Deploy to $0 now")] });
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("/deploy prod");

		const text = getMessageText(deliveredUserMessage(harness));
		expect(text).toBe("Deploy to prod now");
	});
});

describe("replay bypass", () => {
	it("expandPromptTemplates:false keeps the message literal", async () => {
		const harness = await createSession({ skills: [{ name: "rev", body: "RENDERED" }] });
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("/rev keep literal", { expandPromptTemplates: false });

		const text = getMessageText(deliveredUserMessage(harness));
		expect(text).toBe("/rev keep literal");
	});
});

describe("unified getCommands() listing (c2b handoff)", () => {
	it("includes built-ins exactly once alongside commands and skills, with structural source values", async () => {
		const harness = await createSession({
			skills: [{ name: "rev", body: "b" }],
			commands: [command("note", "n")],
		});
		const listing = harness.session.getCommands();

		const modelEntries = listing.filter((entry) => entry.name === "model");
		expect(modelEntries).toHaveLength(1);
		expect(modelEntries[0].source).toBe("builtin");

		expect(listing.find((entry) => entry.name === "note")?.source).toBe("command");
		expect(listing.find((entry) => entry.name === "rev")?.source).toBe("skill");
		// Structural source strings only (no coding-agent types leak to the TUI).
		for (const entry of listing) {
			expect(["builtin", "extension", "command", "prompt", "skill"]).toContain(entry.source);
		}
	});
});

describe("extension command dispatch via the ext: qualifier (Fix #1)", () => {
	it("dispatches /ext:name for an extension command colliding with a built-in", async () => {
		const runs: string[] = [];
		// No custom resource loader: the harness must build its own around the
		// extension factories so the session's extension runner sees the command.
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					// "model" collides with the built-in /model command.
					pi.registerCommand("model", {
						description: "Extension model command",
						handler: async (args) => {
							runs.push(args);
						},
					});
				},
			],
		});
		harnesses.push(harness);

		await harness.session.prompt("/ext:model staging");

		expect(runs).toEqual(["staging"]);
		// The command executed; nothing was sent to the model as literal text.
		expect(harness.session.messages).toEqual([]);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("does not dispatch a bare extension command that collides with a built-in (precedence)", async () => {
		const runs: string[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					// "model" collides with the built-in /model, which outranks extensions;
					// "unique" has no collision.
					pi.registerCommand("model", {
						description: "Extension model command",
						handler: async (args) => {
							runs.push(args);
						},
					});
					pi.registerCommand("unique", {
						description: "Non-colliding extension command",
						handler: async () => {},
					});
				},
			],
		});
		harnesses.push(harness);

		// Resolution seam: the built-in wins the bare name, so a bare `model` must NOT
		// resolve to the extension; the `ext:` qualifier and non-colliding names still do.
		expect(harness.session.resolveExtensionCommand("model")).toBeUndefined();
		expect(harness.session.resolveExtensionCommand("ext:model")).toBeDefined();
		expect(harness.session.resolveExtensionCommand("unique")).toBeDefined();

		// Dispatch seam (headless): a bare `/model` is left literal and sent to the model;
		// the extension handler never runs.
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/model staging");
		expect(runs).toEqual([]);
	});

	it("refuses to queue an /ext:-qualified extension command", async () => {
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

		await expect(harness.session.steer("/ext:testcmd queued")).rejects.toThrow(
			'Extension command "/ext:testcmd" cannot be queued.',
		);
	});
});

describe("resolveControlCommand (c4e dispatch precedence)", () => {
	it("resolves the built-in for a bare colliding name, the extension for unique and ext:-qualified names", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					// "model" collides with the built-in /model, which outranks extensions.
					pi.registerCommand("model", {
						description: "Extension model command",
						handler: async () => {},
					});
					pi.registerCommand("unique", {
						description: "Non-colliding extension command",
						handler: async () => {},
					});
				},
			],
		});
		harnesses.push(harness);

		expect(harness.session.resolveControlCommand("model")?.source).toBe("builtin");
		expect(harness.session.resolveControlCommand("unique")?.source).toBe("extension");
		expect(harness.session.resolveControlCommand("ext:model")?.source).toBe("extension");
	});

	it("returns undefined for prompt-producing entries and unregistered names", async () => {
		const harness = await createSession({ skills: [{ name: "rev", body: "b" }] });

		// A skill is prompt-producing, not a control; the seam must not return it.
		expect(harness.session.resolveControlCommand("rev")).toBeUndefined();
		expect(harness.session.resolveControlCommand("nonexistent")).toBeUndefined();
	});

	it("keeps the hidden control commands out of the listing and the registry", async () => {
		const harness = await createSession({});
		const names = harness.session.getCommands().map((entry) => entry.name);

		expect(names).not.toContain("debug");
		expect(names).not.toContain("arminsayshi");
		expect(names).not.toContain("dementedelves");
		expect(harness.session.resolveControlCommand("debug")).toBeUndefined();
	});
});

describe("queued mixed invocations (A.5 deferred rendering)", () => {
	it("queues literal text, then composes skill + command spans on consumption with images intact", async () => {
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = await createWaitingSession({
			skills: [{ name: "rev", body: "REVIEWED" }],
			commands: [command("note", "NOTED")],
		});
		let deliveredText = "";
		let sawImage = false;
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			(context) => {
				const delivered = context.messages.find(
					(message) => message.role === "user" && getMessageText(message).includes("REVIEWED"),
				);
				deliveredText = delivered ? getMessageText(delivered) : "";
				sawImage =
					delivered?.role === "user" &&
					Array.isArray(delivered.content) &&
					delivered.content.some((part) => part.type === "image");
				return fauxAssistantMessage("done");
			},
		]);

		await waitForToolStart;
		await harness.session.steer("before /rev mid /note end", [
			{ type: "image", mimeType: "image/png", data: "ZmFrZQ==" },
		]);

		// Queue time: literal display text, one pending message, NO activation/render yet.
		expect(harness.session.pendingMessageCount).toBe(1);
		expect(harness.session.skillRuntime.getActiveInvocations()).toHaveLength(0);
		const queueUpdate = harness.eventsOfType("queue_update").at(-1);
		expect(queueUpdate?.steering).toEqual(["before /rev mid /note end"]);

		releaseToolExecution();
		await promptPromise;

		expect(deliveredText).toContain("before ");
		expect(deliveredText).toContain('<skill name="rev" args="">');
		expect(deliveredText).toContain("REVIEWED");
		expect(deliveredText).toContain("NOTED");
		expect(deliveredText).toContain(" end");
		expect(sawImage).toBe(true);
		expect(harness.session.pendingMessageCount).toBe(0);
	});
});

describe("slash_command tool registration (A.7)", () => {
	it("is active iff a model-visible command exists", async () => {
		const withCommand = await createSession({ commands: [command("deploy", "body")] });
		expect(withCommand.session.getActiveToolNames()).toContain("slash_command");

		const hiddenOnly = await createSession({
			commands: [command("deploy", "body", { disableModelInvocation: true })],
		});
		expect(hiddenOnly.session.getActiveToolNames()).not.toContain("slash_command");

		const withoutCommands = await createSession({});
		expect(withoutCommands.session.getActiveToolNames()).not.toContain("slash_command");
	});
});

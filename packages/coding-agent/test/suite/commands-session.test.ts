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
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
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

async function createSession(options: { skills?: SkillFixture[]; commands?: LoadedCommand[] }): Promise<Harness> {
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
	const harness = await createHarness({ resourceLoader });
	harnesses.push(harness);
	return harness;
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

	it("a message-initial command renders its body with substituted args", async () => {
		const harness = await createSession({ commands: [command("deploy", "Deploy to $1 now")] });
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

/**
 * Fork-owned: the `/agents` create wizard (plan T14) on a real session, driven through a scripted
 * UI. The generate path's one completion goes to the faux provider, whose reply the test scripts.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBus } from "../../src/core/event-bus.ts";
import type { ExtensionUIContext } from "../../src/core/extensions/types.ts";
import { buildNewAgentFile } from "../../src/core/fork-builtins/subagents/definitions/files.ts";
import { subagentServiceFor } from "../../src/core/fork-builtins/subagents/service/sessions.ts";
import subagentsPresentation from "../../src/core/fork-builtins/subagents/ui/index.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import { router } from "./fork-subagents-fixtures.ts";
import { createHarness, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];
const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	for (const harness of harnesses.splice(0)) harness.cleanup();
	vi.unstubAllEnvs();
});

type Answer = string | undefined | ((options: string[]) => string | undefined);
const pick =
	(prefix: string): Answer =>
	(options) =>
		options.find((option) => option.startsWith(prefix));

/** A session whose parent requests (the wizard's completion) answer `reply`, recording each context. */
async function session(reply = "", onRequest?: () => void) {
	vi.stubEnv("PI_FORK_BUILTINS", "on");
	const requests: Context[] = [];
	const harness = await createHarness({
		// The factory finds its session over the bus it shares with the base tools.
		eventBus: createEventBus(),
		extensionFactories: [{ name: "subagents", factory: subagentsPresentation }],
		settings: { forkBuiltins: { subagents: { defaultJoinMode: "async" } } } as unknown as Partial<Settings>,
	});
	harnesses.push(harness);
	harness.setResponses(
		Array.from({ length: 20 }, () =>
			router({}, (context) => {
				requests.push(context);
				onRequest?.();
				return fauxAssistantMessage(reply);
			}),
		),
	);
	const log = {
		selects: [] as Array<{ title: string; options: string[] }>,
		notes: [] as Array<{ message: string; type?: string }>,
	};
	const script = {
		select: [] as Answer[],
		input: [] as Array<string | undefined>,
		confirm: [] as boolean[],
		editor: [] as Array<string | undefined>,
	};
	const ui = {
		notify: (message: string, type?: string) => log.notes.push({ message, type }),
		setStatus: () => {},
		setWidget: () => {},
		onTerminalInput: () => () => {},
		getEditorText: () => "",
		select: async (title: string, options: string[]) => {
			log.selects.push({ title, options });
			const answer = script.select.shift();
			return typeof answer === "function" ? answer(options) : answer;
		},
		input: async () => script.input.shift(),
		confirm: async () => script.confirm.shift() ?? false,
		editor: async () => script.editor.shift(),
		custom: async () => undefined,
	} as unknown as ExtensionUIContext;
	await harness.session.bindExtensions({ uiContext: ui, mode: "tui" });
	const projectAgents = join(harness.tempDir, ".pi", "agents");
	/** Runs `/agents` → Create new agent with these answers after the location. */
	const create = async (answers: Partial<typeof script>, location: Answer = pick("Project")) => {
		script.select.push(pick("Create new agent"), location, ...(answers.select ?? []));
		script.input.push(...(answers.input ?? []));
		script.confirm.push(...(answers.confirm ?? []));
		script.editor.push(...(answers.editor ?? []));
		await harness.session.prompt("/agents");
	};
	const notes = () => log.notes.map((note) => note.message);
	return { harness, requests, log, create, notes, projectAgents };
}

const MANUAL = ["Manual", "read-only", "inherit", "high"].map(pick);
const GENERATED = "---\ndescription: Reviews diffs\ntools: read, grep\n---\n\nYou review diffs.\n";

async function spawnable(harness: Harness, type: string) {
	const service = subagentServiceFor(harness.session);
	const spawned = await service?.spawn({ type, prompt: "go", description: "go", params: { run_in_background: true } });
	expect(spawned).toMatchObject({ type });
	expect(spawned?.fellBackFrom).toBeUndefined();
	if (spawned) await service?.waitForResult(spawned.id);
}

describe("the /agents create wizard", () => {
	it("writes the manual path's file, and the new agent spawns at once", async () => {
		const { harness, create, notes, projectAgents } = await session();
		await create({ select: MANUAL, input: ["scout", "Scout: find things"], editor: ["You scout."] });
		const path = join(projectAgents, "scout.md");
		expect(readFileSync(path, "utf8")).toBe(
			buildNewAgentFile({
				description: "Scout: find things",
				tools: "read, bash, grep, find, ls",
				thinking: "high",
				systemPrompt: "You scout.",
			}),
		);
		expect(notes()).toContain(`Created ${path}`);
		await spawnable(harness, "scout");
	});

	it("generates with one tool-less request that joins no message, writes the parsed file, and the agent spawns", async () => {
		const { harness, requests, create, notes, projectAgents } = await session(GENERATED);
		const messages = harness.session.messages.length;
		await create({ select: [pick("Generate")], input: ["an agent that reviews diffs", "reviewer"] });
		const path = join(projectAgents, "reviewer.md");
		expect(requests).toHaveLength(1);
		// The provider sees the prompt as a leading system message; it declares no tool, and one user message follows.
		const [system, ...rest] = requests[0].messages;
		expect(system).toMatchObject({ role: "system" });
		expect((system as { toolsAdded?: unknown[] }).toolsAdded ?? []).toEqual([]);
		expect(requests[0].tools ?? []).toEqual([]);
		expect(rest).toEqual([expect.objectContaining({ role: "user", content: "an agent that reviews diffs" })]);
		expect(harness.session.messages).toHaveLength(messages);
		expect(readFileSync(path, "utf8")).toBe(GENERATED);
		expect(notes()).toEqual(expect.arrayContaining(["Generating agent definition...", `Created ${path}`]));
		await spawnable(harness, "reviewer");
	});

	it("writes nothing for a reply that fails to parse or has no description, and says why", async () => {
		for (const [reply, reason] of [
			["---\ndescription: [unclosed\n---\nBody.\n", "cannot be parsed"],
			["---\ntools: read\n---\nBody.\n", "has no description:"],
		]) {
			const { create, log, projectAgents } = await session(reply);
			await create({ select: [pick("Generate")], input: ["anything", "broken"] });
			expect(existsSync(join(projectAgents, "broken.md"))).toBe(false);
			expect(log.notes.at(-1)).toMatchObject({ type: "warning", message: expect.stringContaining(reason) });
		}
	});

	it("writes nothing for a reply with an invalid documented value or an unknown key, naming each", async () => {
		const { create, log, projectAgents } = await session(
			"---\ndescription: odd\nmax_turns: -1\nthinking: banana\nthinkingLevel: high\n---\nBody.\n",
		);
		await create({ select: [pick("Generate")], input: ["anything", "odd"] });
		expect(existsSync(join(projectAgents, "odd.md"))).toBe(false);
		const warning = log.notes.at(-1)?.message ?? "";
		expect(warning).toContain("has an invalid value for thinking");
		expect(warning).toContain("has an invalid value for max_turns");
		expect(warning).toContain('has the unknown key "thinkingLevel"');
	});

	it("writes nothing for a reply that names another agent, a path included", async () => {
		const sentinelDir = mkdtempSync(join(tmpdir(), "sn2-sentinel-"));
		cleanups.push(() => rmSync(sentinelDir, { recursive: true, force: true }));
		const sentinel = join(sentinelDir, "outside.md");
		writeFileSync(sentinel, "sentinel");
		const before = createHash("sha256").update(readFileSync(sentinel)).digest("hex");
		const { create, log, projectAgents } = await session(
			`---\nname: ${join("..", "..", sentinel)}\ndescription: escape\n---\nBody.\n`,
		);
		await create({ select: [pick("Generate")], input: ["anything", "chosen"] });
		expect(existsSync(join(projectAgents, "chosen.md"))).toBe(false);
		expect(log.notes.at(-1)).toMatchObject({
			type: "warning",
			message: expect.stringContaining('instead of "chosen"'),
		});
		expect(createHash("sha256").update(readFileSync(sentinel)).digest("hex")).toBe(before);
	});

	it("writes nothing for a reply whose list field is neither a list nor a string", async () => {
		for (const field of ["extensions: 123", "skills:\n  nested: map", "tools:"]) {
			const { create, log, projectAgents } = await session(`---\ndescription: lists\n${field}\n---\nBody.\n`);
			await create({ select: [pick("Generate")], input: ["anything", "lists"] });
			expect(existsSync(join(projectAgents, "lists.md"))).toBe(false);
			expect(log.notes.at(-1)?.message).toContain(`has an invalid value for ${field.split(":")[0]}`);
		}
	});

	it("asks again before overwriting a file another session created while the model answered", async () => {
		let path = "";
		const { create, projectAgents, log } = await session(GENERATED, () => {
			mkdirSync(projectAgents, { recursive: true });
			writeFileSync(path, "theirs");
		});
		path = join(projectAgents, "reviewer.md");
		await create({
			select: [pick("Generate")],
			input: ["an agent that reviews diffs", "reviewer"],
			confirm: [false],
		});
		expect(readFileSync(path, "utf8")).toBe("theirs");
		expect(log.notes.map((note) => note.message)).not.toContain(`Created ${path}`);
	});

	it("offers the session's scoped models in the model step", async () => {
		const { harness, create, log } = await session();
		const model = harness.getModel();
		harness.session.setScopedModels([{ model }]);
		await create({ select: [pick("Manual"), pick("read-only"), undefined], input: ["scout", "Scout"] });
		expect(log.selects.find((entry) => entry.title === "Model")?.options).toEqual([
			"inherit (parent model)",
			`${model.provider}/${model.id}`,
			"custom...",
		]);
	});

	it("offers only the personal location in an untrusted project", async () => {
		const { harness, create, log } = await session();
		harness.settingsManager.setProjectTrusted(false);
		await create({}, undefined);
		expect(log.selects.find((entry) => entry.title === "Choose location")?.options).toEqual([
			`Personal (${join(harness.tempDir, "agents")})`,
		]);
	});

	it("leaves an existing file unchanged when the overwrite is declined", async () => {
		const { create, projectAgents } = await session();
		mkdirSync(projectAgents, { recursive: true });
		const path = join(projectAgents, "scout.md");
		writeFileSync(path, "original");
		await create({ select: MANUAL, input: ["scout", "Scout"], editor: ["You scout."], confirm: [false] });
		expect(readFileSync(path, "utf8")).toBe("original");
	});

	it("refuses a name with a space, a colon or a path separator", async () => {
		for (const name of ["two words", "a:b", "nested/name"]) {
			const { create, log, projectAgents } = await session();
			await create({ select: [pick("Manual")], input: [name] });
			expect(log.notes.at(-1)).toMatchObject({ type: "warning", message: expect.stringContaining(`"${name}"`) });
			expect(existsSync(projectAgents)).toBe(false);
		}
	});
});

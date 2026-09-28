/**
 * Fork-owned: the `/agents` menu (plan T13) on a real session, driven through a scripted UI. The
 * command runs as a user types it; every select, confirm, editor and custom call takes the next
 * scripted answer, and each custom component renders once so its rows can be read.
 */
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBus } from "../../src/core/event-bus.ts";
import type { ExtensionMode, ExtensionUIContext } from "../../src/core/extensions/types.ts";
import { DISABLED_STUB } from "../../src/core/fork-builtins/subagents/definitions/files.ts";
import { subagentServiceFor } from "../../src/core/fork-builtins/subagents/service/sessions.ts";
import subagentsPresentation from "../../src/core/fork-builtins/subagents/ui/index.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import type { LoadedSkill } from "../../src/core/skills/frontmatter.ts";
import { getSkillSetController } from "../../src/core/skills/skill-set-events.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import { agentId, CHILD_START, call, held, router } from "./fork-subagents-fixtures.ts";
import { createHarness, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];
const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	for (const harness of harnesses.splice(0)) harness.cleanup();
	vi.unstubAllEnvs();
});

const WORKER = "---\ndescription: test worker\ntools: read\nextensions: false\n---\nYou are a test worker.\n";
const SCOUT = "---\ndescription: Scout the repo\ntools: read\nextensions: false\n---\nYou are a scout.\n";

type Answer = string | undefined | ((options: string[]) => string | undefined);
interface Script {
	select: Answer[];
	confirm: boolean[];
	editor: Array<string | undefined>;
	custom: Array<string | undefined>;
}

/** The first option that starts with `prefix`. */
const pick =
	(prefix: string): Answer =>
	(options) =>
		options.find((option) => option.startsWith(prefix));

/** A UI context that answers from `script` and records what the menu showed. Own properties only. */
function scriptedUi() {
	const script: Script = { select: [], confirm: [], editor: [], custom: [] };
	const log = {
		selects: [] as Array<{ title: string; options: string[] }>,
		confirms: [] as string[],
		notes: [] as Array<{ message: string; type?: string }>,
		renders: [] as string[],
	};
	const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
	const tui = { requestRender: () => {}, terminal: { rows: 40, columns: 120 } };
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
		confirm: async (_title: string, message: string) => {
			log.confirms.push(message);
			return script.confirm.shift() ?? false;
		},
		editor: async () => script.editor.shift(),
		custom: async (factory: (tui: unknown, theme: unknown, keybindings: unknown, done: () => void) => Component) => {
			const component = factory(tui, theme, new KeybindingsManager(), () => {});
			log.renders.push(component.render(120).join("\n"));
			return script.custom.shift();
		},
	} as unknown as ExtensionUIContext;
	return { ui, script, log, notes: () => log.notes.map((note) => note.message) };
}

type Scripted = ReturnType<typeof scriptedUi>;

async function session(subagents: Record<string, unknown> = {}, script: Parameters<typeof router>[0] = {}) {
	vi.stubEnv("PI_FORK_BUILTINS", "on");
	const bus = createEventBus();
	const harness = await createHarness({
		eventBus: bus,
		extensionFactories: [{ name: "subagents", factory: subagentsPresentation }],
		settings: {
			forkBuiltins: { subagents: { defaultJoinMode: "async", ...subagents } },
		} as unknown as Partial<Settings>,
	});
	harnesses.push(harness);
	mkdirSync(join(harness.tempDir, "agents"), { recursive: true });
	writeFileSync(join(harness.tempDir, "agents", "worker.md"), WORKER);
	harness.setResponses(Array.from({ length: 50 }, () => router(script)));
	const projectAgents = join(harness.tempDir, ".pi", "agents");
	const personal = `Personal (${join(harness.tempDir, "agents")})`;
	return { harness, bus, projectAgents, personal };
}

async function bind(harness: Harness, mode: ExtensionMode = "tui"): Promise<Scripted> {
	const scripted = scriptedUi();
	await harness.session.bindExtensions({ uiContext: scripted.ui, mode });
	return scripted;
}

/** Runs `/agents` once with the given answers appended to the script. */
async function agents(harness: Harness, scripted: Scripted, answers: Partial<Script>): Promise<void> {
	scripted.script.select.push(...(answers.select ?? []));
	scripted.script.confirm.push(...(answers.confirm ?? []));
	scripted.script.editor.push(...(answers.editor ?? []));
	scripted.script.custom.push(...(answers.custom ?? []));
	await harness.session.prompt("/agents");
}

function writeProjectAgent(projectAgents: string, name: string, content = SCOUT): string {
	mkdirSync(projectAgents, { recursive: true });
	const path = join(projectAgents, `${name}.md`);
	writeFileSync(path, content);
	return path;
}

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const temporaries = (dir: string) => readdirSync(dir).filter((name) => name.endsWith(".tmp"));

/** A directory outside the project, removed after the test. */
function outside(): string {
	const dir = mkdtempSync(join(tmpdir(), "sn2-outside-"));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** Makes `dir` read-only until the test ends. */
function readOnly(dir: string): void {
	chmodSync(dir, 0o555);
	cleanups.push(() => chmodSync(dir, 0o755));
}

describe("/agents", () => {
	it("answers outside the interactive TUI that it needs it, and opens nothing", async () => {
		const { harness } = await session();
		const scripted = await bind(harness, "rpc");
		await agents(harness, scripted, {});
		expect(scripted.notes()).toEqual(["/agents needs the interactive TUI."]);
		expect(scripted.log.selects).toEqual([]);
		expect(scripted.log.renders).toEqual([]);
	});

	it("lists a project agent before any spawn, and one added on disk when it opens again", async () => {
		const { harness, projectAgents } = await session();
		writeProjectAgent(projectAgents, "scout");
		const scripted = await bind(harness);
		await agents(harness, scripted, { select: [pick("Agent types")] });
		expect(scripted.log.selects[0].options).toEqual(["Agent types (5)"]);
		expect(scripted.log.renders[0]).toContain("•  scout");
		writeProjectAgent(projectAgents, "later");
		await agents(harness, scripted, { select: [pick("Agent types")] });
		expect(scripted.log.renders[1]).toContain("•  later");
	});

	it("opens a running agent's viewer, marks the agent types, and never lists a skill agent", async () => {
		const gate = held();
		const { harness, bus, projectAgents } = await session({}, { hold: [gate.behavior] });
		writeProjectAgent(projectAgents, "scout");
		writeFileSync(
			join(harness.tempDir, "agents", "off.md"),
			"---\ndescription: switched off\nenabled: false\n---\nOff.\n",
		);
		getSkillSetController(bus).publish([skill(harness.tempDir, "kit", { helper: "description: a skill's helper" })]);
		const scripted = await bind(harness);
		agentId(
			await call(harness, "Agent", {
				prompt: "hold task",
				description: "hold task",
				subagent_type: "worker",
				run_in_background: true,
			}),
		);
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		await agents(harness, scripted, {
			select: [pick("Running agents"), pick("1. "), undefined, pick("Agent types")],
		});
		expect(scripted.log.selects[1].options).toEqual([
			expect.stringMatching(/^1\. worker \(hold task\) · 0 tools · running · /),
		]);
		const [viewer, roster] = scripted.log.renders;
		expect(viewer).toContain("╭");
		expect(viewer).toContain("hold task");
		expect(roster).toContain("•  scout");
		expect(roster).toContain("◦  worker");
		expect(roster).toContain("✕◦ off");
		expect(roster).toContain("   Explore");
		expect(roster).toContain("• = project  ◦ = global  ✕ = disabled");
		expect(subagentServiceFor(harness.session)?.registry.agents.has("kit:helper")).toBe(true);
		expect(roster).not.toContain("helper");
		gate.release();
	});

	it("offers only the personal location in an untrusted project, for eject and the disable stub", async () => {
		const { harness, personal } = await session();
		harness.settingsManager.setProjectTrusted(false);
		const scripted = await bind(harness);
		await agents(harness, scripted, {
			select: [pick("Agent types"), pick("Eject"), undefined, pick("Disable"), undefined],
			custom: ["Explore", "Explore"],
		});
		const locations = scripted.log.selects.filter((entry) => entry.title === "Choose location");
		expect(locations.map((entry) => entry.options)).toEqual([[personal], [personal]]);
	});

	it("disables a default agent with a stub its next spawn routes around, and enabling deletes the stub", async () => {
		const { harness, projectAgents } = await session({ fallbackSubagent: "worker" });
		const scripted = await bind(harness);
		const stub = join(projectAgents, "Explore.md");
		await agents(harness, scripted, {
			select: [pick("Agent types"), pick("Disable"), pick("Project")],
			custom: ["Explore"],
		});
		expect(readFileSync(stub, "utf8")).toBe(DISABLED_STUB);
		expect(scripted.notes()).toContain(`Disabled Explore (${stub})`);

		const service = subagentServiceFor(harness.session);
		const spawned = await service?.spawn({
			type: "Explore",
			prompt: "fall back",
			description: "fall back",
			params: { run_in_background: true },
		});
		expect(spawned).toMatchObject({ type: "worker", fellBackFrom: "Explore" });
		if (spawned) await service?.waitForResult(spawned.id);

		await agents(harness, scripted, { select: [pick("Agent types"), pick("Enable")], custom: ["Explore"] });
		expect(existsSync(stub)).toBe(false);
		expect(scripted.notes()).toContain(`Enabled Explore (removed ${stub})`);
	});

	it("acts on a default agent's own file only: another agent's file at its path is neither reset nor overwritten", async () => {
		const { harness, projectAgents } = await session();
		const path = writeProjectAgent(projectAgents, "Explore", SCOUT.replace("---\n", "---\nname: scout\n"));
		const before = sha(path);
		const scripted = await bind(harness);
		await agents(harness, scripted, {
			select: [pick("Agent types"), pick("Disable"), pick("Project")],
			custom: ["Explore"],
			confirm: [false],
		});
		expect(scripted.log.selects.find((entry) => entry.title === "Explore")?.options).toEqual([
			"Eject (export as .md)",
			"Disable",
			"Back",
		]);
		expect(scripted.log.confirms).toEqual([`${path} already exists. Overwrite?`]);
		expect(sha(path)).toBe(before);
	});

	it("writes an edit only when the text changed, and deletes only after a confirm", async () => {
		const { harness, projectAgents } = await session();
		const path = writeProjectAgent(projectAgents, "scout");
		const scripted = await bind(harness);
		const inode = statSync(path).ino;
		const edited = SCOUT.replace("Scout the repo", "Scout the whole repo");
		await agents(harness, scripted, {
			select: [pick("Agent types"), pick("Edit"), pick("Edit"), pick("Delete")],
			editor: [SCOUT, edited],
			custom: ["scout", "scout", "scout"],
			confirm: [false],
		});
		expect(readFileSync(path, "utf8")).toBe(edited);
		expect(statSync(path).ino).not.toBe(inode);
		expect(scripted.notes().filter((note) => note === `Updated ${path}`)).toHaveLength(1);
		expect(scripted.log.confirms).toEqual([`Delete scout from project (${path})?`]);
		expect(existsSync(path)).toBe(true);

		await agents(harness, scripted, {
			select: [pick("Agent types"), pick("Delete")],
			custom: ["scout"],
			confirm: [true],
		});
		expect(existsSync(path)).toBe(false);
		expect(scripted.notes()).toContain(`Deleted ${path}`);
	});

	it("ejects a default agent, and resets it only after a confirm", async () => {
		const { harness, projectAgents } = await session();
		const scripted = await bind(harness);
		const path = join(projectAgents, "Plan.md");
		await agents(harness, scripted, {
			select: [pick("Agent types"), pick("Eject"), pick("Project")],
			custom: ["Plan"],
		});
		expect(readFileSync(path, "utf8")).toContain('description: "Software architect agent');
		expect(scripted.notes()).toContain(`Ejected Plan to ${path}`);

		await agents(harness, scripted, {
			select: [pick("Agent types"), pick("Reset to default"), pick("Reset to default")],
			custom: ["Plan", "Plan"],
			confirm: [false, true],
		});
		expect(scripted.log.confirms).toHaveLength(2);
		expect(existsSync(path)).toBe(false);
		expect(scripted.notes()).toContain("Restored default Plan");
	});

	it("leaves the target and no temporary file when the directory is read-only, and reports the error", async () => {
		const { harness, projectAgents } = await session();
		const path = writeProjectAgent(projectAgents, "scout");
		const before = sha(path);
		readOnly(projectAgents);
		const scripted = await bind(harness);
		await agents(harness, scripted, {
			select: [pick("Agent types"), pick("Edit")],
			editor: [SCOUT.replace("scout", "changed scout")],
			custom: ["scout"],
		});
		expect(sha(path)).toBe(before);
		expect(temporaries(projectAgents)).toEqual([]);
		expect(scripted.log.notes.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("EACCES") });
	});

	it("keeps a change that landed when the reload after it fails, and says the file is saved", async () => {
		const { harness, projectAgents } = await session({ strictAgentFiles: true });
		const path = writeProjectAgent(projectAgents, "scout");
		const scripted = await bind(harness);
		subagentServiceFor(harness.session)?.refreshDefinitions();
		writeProjectAgent(projectAgents, "broken", "---\ndescription: [unclosed\n---\nBroken.\n");
		const edited = SCOUT.replace("Scout the repo", "Scout again");
		await agents(harness, scripted, {
			select: [pick("Agent types"), pick("Edit")],
			editor: [edited],
			custom: ["scout"],
		});
		expect(readFileSync(path, "utf8")).toBe(edited);
		expect(scripted.log.notes).toContainEqual({
			message: expect.stringContaining("Agent definitions did not reload"),
			type: "warning",
		});
		expect(scripted.log.notes).toContainEqual({
			type: "warning",
			message: expect.stringMatching(new RegExp(`^Saved ${path}, but agent definitions did not reload: `)),
		});
		expect(scripted.log.notes.filter((note) => note.type === "error")).toEqual([]);
	});

	it("reports a failed rename, leaving the target and no temporary file", async () => {
		const { harness, projectAgents } = await session();
		const target = join(projectAgents, "Explore.md");
		mkdirSync(target, { recursive: true });
		const scripted = await bind(harness);
		await agents(harness, scripted, {
			select: [pick("Agent types"), pick("Eject"), pick("Project")],
			custom: ["Explore"],
			confirm: [true],
		});
		expect(scripted.log.confirms).toEqual([`${target} already exists. Overwrite?`]);
		expect(lstatSync(target).isDirectory()).toBe(true);
		expect(temporaries(projectAgents)).toEqual([]);
		expect(scripted.log.notes.at(-1)?.type).toBe("error");
	});

	it("reports a failed unlink and leaves the file in place", async () => {
		const { harness, projectAgents } = await session();
		const path = writeProjectAgent(projectAgents, "scout");
		readOnly(projectAgents);
		const scripted = await bind(harness);
		await agents(harness, scripted, {
			select: [pick("Agent types"), pick("Delete")],
			custom: ["scout"],
			confirm: [true],
		});
		expect(existsSync(path)).toBe(true);
		expect(scripted.log.notes.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("EACCES") });
	});

	it("refuses to write when its temporary path already exists, as a file or a symlink, and leaves it untouched", async () => {
		const { harness, projectAgents } = await session();
		const path = writeProjectAgent(projectAgents, "scout");
		const temporary = `${path}.${process.pid}.tmp`;
		const target = join(outside(), "target.txt");
		writeFileSync(target, "outside");
		const scripted = await bind(harness);
		for (const plant of [() => writeFileSync(temporary, "planted"), () => symlinkSync(target, temporary)]) {
			plant();
			const before = { path: sha(path), outside: sha(target) };
			await agents(harness, scripted, {
				select: [pick("Agent types"), pick("Edit")],
				editor: [SCOUT.replace("scout", "changed scout")],
				custom: ["scout"],
			});
			expect(scripted.log.notes.at(-1)).toMatchObject({
				type: "error",
				message: expect.stringContaining("already exists"),
			});
			expect(sha(path)).toBe(before.path);
			expect(sha(target)).toBe(before.outside);
			expect(existsSync(temporary)).toBe(true);
			rmSync(temporary);
		}
		expect(readFileSync(target, "utf8")).toBe("outside");
	});

	it("refuses every change through a symlinked .pi/agents or agent file, naming the link", async () => {
		const { harness, projectAgents } = await session();
		const elsewhere = outside();
		writeFileSync(join(elsewhere, "scout.md"), SCOUT);
		mkdirSync(join(harness.tempDir, ".pi"), { recursive: true });
		symlinkSync(elsewhere, projectAgents);
		const scripted = await bind(harness);
		const before = sha(join(elsewhere, "scout.md"));
		const refused = `Refusing to change an agent file behind a symlink: ${projectAgents}`;
		await agents(harness, scripted, {
			select: [pick("Agent types"), pick("Edit"), pick("Disable"), pick("Delete"), pick("Eject"), pick("Project")],
			editor: [SCOUT.replace("scout", "changed scout")],
			custom: ["scout", "scout", "scout", "Explore"],
			confirm: [true],
		});
		const errors = scripted.log.notes.filter((note) => note.type === "error").map((note) => note.message);
		expect(errors).toEqual([refused, refused, refused, refused]);
		expect(sha(join(elsewhere, "scout.md"))).toBe(before);
		expect(readdirSync(elsewhere)).toEqual(["scout.md"]);

		// A symlinked agent file inside a real directory.
		rmSync(projectAgents);
		mkdirSync(projectAgents);
		const linked = join(projectAgents, "scout.md");
		symlinkSync(join(elsewhere, "scout.md"), linked);
		await agents(harness, scripted, {
			select: [pick("Agent types"), pick("Edit"), pick("Delete")],
			editor: [SCOUT.replace("scout", "changed scout")],
			custom: ["scout", "scout"],
			confirm: [true],
		});
		const linkErrors = scripted.log.notes.filter((note) => note.type === "error").map((note) => note.message);
		expect(linkErrors.slice(4)).toEqual([
			`Refusing to change an agent file behind a symlink: ${linked}`,
			`Refusing to change an agent file behind a symlink: ${linked}`,
		]);
		expect(lstatSync(linked).isSymbolicLink()).toBe(true);
		expect(sha(join(elsewhere, "scout.md"))).toBe(before);
	});
});

/** A skill that bundles one agent file per entry of `agents`. */
function skill(root: string, name: string, agents: Record<string, string>): LoadedSkill {
	const baseDir = join(root, "skills", name);
	mkdirSync(join(baseDir, "agents"), { recursive: true });
	const filePath = join(baseDir, "SKILL.md");
	writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name} skill\n---\n${name} body`);
	for (const [agent, frontmatter] of Object.entries(agents)) {
		writeFileSync(join(baseDir, "agents", `${agent}.md`), `---\n${frontmatter}\n---\nYou are ${agent}.`);
	}
	return {
		name,
		description: `${name} skill`,
		filePath,
		baseDir,
		sourceInfo: createSyntheticSourceInfo(filePath, {
			source: "local",
			scope: "project",
			origin: "top-level",
			baseDir,
		}),
		disableModelInvocation: false,
		id: filePath,
		listingName: name,
		frontmatter: { name, description: `${name} skill` },
		argumentHint: undefined,
		userInvocable: true,
		commandNameValid: true,
	};
}

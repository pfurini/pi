/**
 * Fork-owned: agent mentions (phase 3 plan T1 to T5) on real parent and child sessions. The parent loads
 * the presentation factory through the harness; mention tests bind a fake TUI context and submit
 * prompts as a user would. Old pi-subagents tests at 79a7c42 this covers: agent-mention-wiring,
 * mention-start-notification (see docs/plans/subagents-native-phase3-evidence/old-cases.md).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBus } from "../../src/core/event-bus.ts";
import type {
	AutocompleteProviderFactory,
	ExtensionMode,
	ExtensionUIContext,
} from "../../src/core/extensions/types.ts";
import { inspectRecord, type SubagentService } from "../../src/core/fork-builtins/subagents/service/service.ts";
import { subagentServiceFor } from "../../src/core/fork-builtins/subagents/service/sessions.ts";
import subagentsPresentation from "../../src/core/fork-builtins/subagents/ui/index.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import type { LoadedSkill } from "../../src/core/skills/frontmatter.ts";
import { getSkillSetController } from "../../src/core/skills/skill-set-events.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ResourceLoader } from "../../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import {
	type Behavior,
	CHILD_START,
	call,
	held,
	notices,
	router,
	say,
	sleep,
	text,
	textOf,
	use,
} from "./fork-subagents-fixtures.ts";
import { createHarness, type Harness } from "./harness.ts";

// Pass-through spies, so the popup test can show that a keystroke reads no file.
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return { ...actual, readFileSync: vi.fn(actual.readFileSync), readdirSync: vi.fn(actual.readdirSync) };
});

const harnesses: Harness[] = [];

afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	delete (globalThis as { __sn3Hold?: unknown }).__sn3Hold;
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

const REMINDER = "<system-reminder>";

async function parent(
	script: Record<string, Behavior[]>,
	subagents: Record<string, unknown> = {},
	parentBehavior?: Behavior,
) {
	vi.stubEnv("PI_FORK_BUILTINS", "on");
	const harness = await createHarness({
		eventBus: createEventBus(),
		extensionFactories: [{ name: "subagents", factory: subagentsPresentation }],
		settings: {
			forkBuiltins: { subagents: { defaultJoinMode: "async", agentMentions: "direct", ...subagents } },
		} as unknown as Partial<Settings>,
	});
	harnesses.push(harness);
	mkdirSync(join(harness.tempDir, "agents"), { recursive: true });
	writeFileSync(
		join(harness.tempDir, "agents", "worker.md"),
		"---\ndescription: Test worker. It does work.\ntools: read\n---\nYou are a test worker.",
	);
	harness.setResponses(Array.from({ length: 50 }, () => router(script, parentBehavior)));
	return harness;
}

/** A fake UI context with own methods (P17): it records notifications and the autocomplete wrappers. */
async function bind(harness: Harness, mode: ExtensionMode = "tui") {
	const notes: string[] = [];
	const wrappers: AutocompleteProviderFactory[] = [];
	const ui = {
		notify: (message: string) => notes.push(message),
		setStatus: () => {},
		setWidget: () => {},
		onTerminalInput: () => () => {},
		getEditorText: () => "",
		addAutocompleteProvider: (factory: AutocompleteProviderFactory) => wrappers.push(factory),
	} as unknown as ExtensionUIContext;
	await harness.session.bindExtensions({ uiContext: ui, mode });
	return { notes, wrappers };
}

function service(harness: Harness) {
	const subagents = subagentServiceFor(harness.session);
	if (!subagents) throw new Error("no subagent service");
	return subagents;
}

/** The user and assistant turns the parent holds; a claimed mention adds none. */
const turns = (harness: Harness) =>
	harness.session.messages.filter((message) => message.role === "user" || message.role === "assistant").length;

/** The parent's user messages, as text. */
const userTexts = (harness: Harness) =>
	harness.session.messages.filter((message) => message.role === "user").map((message) => textOf(message.content));

/**
 * Makes every child that loads the agent directory's extensions hold an `input` of exactly `text`
 * until `release()`: a steer awaits its child's input handlers.
 */
function holdChildInput(harness: Harness, text: string) {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	const probe = { seen: false, promise };
	(globalThis as { __sn3Hold?: typeof probe }).__sn3Hold = probe;
	mkdirSync(join(harness.tempDir, "extensions"), { recursive: true });
	writeFileSync(
		join(harness.tempDir, "extensions", "hold-input.ts"),
		`export default function (pi) {\n\tpi.on("input", (event) => {\n\t\tif (event.text !== ${JSON.stringify(text)}) return undefined;\n\t\tglobalThis.__sn3Hold.seen = true;\n\t\treturn globalThis.__sn3Hold.promise.then(() => undefined);\n\t});\n}\n`,
	);
	return { probe, release: () => release() };
}

/** Makes the session's directory a git repository with one commit. */
function gitRepository(harness: Harness): void {
	const git = (...args: string[]) => execFileSync("git", args, { cwd: harness.tempDir, stdio: "pipe" });
	git("init", "-q");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	writeFileSync(join(harness.tempDir, "README.md"), "repo\n");
	git("add", "README.md");
	git("commit", "-q", "-m", "initial");
}

/** What `@name` resolves to, as `live:<id>` or `tombstone:<id>`. */
function target(subagents: SubagentService, name: string): string | undefined {
	const found = subagents.resolveMention(name);
	if (!found) return undefined;
	return found.kind === "live" ? `live:${found.view.id}` : `tombstone:${found.entry.id}`;
}

/** Starts a `worker` agent the way a mention does: detached, in the background. */
function spawnWorker(subagents: SubagentService, prompt: string, name?: string) {
	return subagents.spawn({ type: "worker", prompt, description: prompt, name, mode: "detached-background" });
}

/** Gives a record another handle, so two records share a name as a reopen makes them do. */
function rename(subagents: SubagentService, id: string, handle: string): void {
	const record = inspectRecord(subagents, id);
	if (!record) throw new Error(`no record ${id}`);
	Object.assign(record, { handle });
}

/** Ends every finished record's retention window, so the sweep evicts it. */
function evict(): void {
	vi.advanceTimersByTime(11 * 60_000);
}

/** The user messages of a request, as text. */
function users(context: Context): string[] {
	return context.messages.filter((message) => message.role === "user").map((message) => textOf(message.content));
}

/** A reply that records the user messages of each request it answers. */
function recorder() {
	const seen: string[][] = [];
	const behavior: Behavior = (context) => {
		seen.push(users(context));
		return fauxAssistantMessage("ok");
	};
	return { seen, behavior };
}

/** Runs a `worker` agent to its end, evicts it, and returns its tombstone. Needs fake `setInterval` and `Date`. */
async function evictedWorker(subagents: SubagentService, prompt: string, name?: string) {
	const view = await spawnWorker(subagents, prompt, name);
	await vi.waitFor(() => expect(view.status).toBe("completed"), CHILD_START);
	evict();
	const entry = subagents.listTombstones().find((tombstone) => tombstone.id === view.id);
	if (!entry) throw new Error(`no tombstone for ${view.id}`);
	return entry;
}

/** Rewrites the `worker` agent file, or deletes it with `undefined`. */
function workerFile(harness: Harness, frontmatter: string | undefined): void {
	const path = join(harness.tempDir, "agents", "worker.md");
	if (frontmatter === undefined) unlinkSync(path);
	else writeFileSync(path, `---\n${frontmatter}\ntools: read\n---\nYou are a test worker.`);
}

describe("handle resolution", () => {
	it("finds a top-level agent by handle, alias or id, whatever the casing, and never a nested one", async () => {
		const gate = held();
		const harness = await parent({ "task one": [gate.behavior] });
		const subagents = service(harness);
		const view = await spawnWorker(subagents, "task one", "Scout");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		for (const name of ["worker", "WORKER", "scout", "Scout", view.id]) {
			expect(target(subagents, name)).toBe(`live:${view.id}`);
		}
		const nested = await subagents.spawnOwned(
			view,
			{ type: "worker", prompt: "nested task", description: "nested task" },
			(registry) => {
				const definition = registry.agents.get("worker");
				return definition ? { ok: true, definition } : { ok: false, message: "no worker" };
			},
		);
		expect(nested.parentId).toBe(view.id);
		expect(target(subagents, nested.id)).toBeUndefined();
		gate.release();
	});

	it("prefers a running agent over finished ones by the same name, then the newest one with a session", async () => {
		const gate = held();
		const harness = await parent({ "task a": [say("a done")], "task b": [say("b done")], "task c": [gate.behavior] });
		const subagents = service(harness);
		const a = await spawnWorker(subagents, "task a");
		await vi.waitFor(() => expect(a.status).toBe("completed"), CHILD_START);
		const c = await spawnWorker(subagents, "task c");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const b = await spawnWorker(subagents, "task b");
		await vi.waitFor(() => expect(b.status).toBe("completed"), CHILD_START);
		expect([a.handle, c.handle, b.handle]).toEqual(["worker", "worker-2", "worker-3"]);
		rename(subagents, c.id, "worker");
		rename(subagents, b.id, "worker");
		expect(target(subagents, "worker")).toBe(`live:${c.id}`);
		gate.release();
		await vi.waitFor(() => expect(c.status).toBe("completed"), CHILD_START);
		expect(target(subagents, "worker")).toBe(`live:${b.id}`);
	});

	it("finds a tombstone by handle, alias or id only when no agent with a session or a run holds the name", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const gate = held();
		const harness = await parent({ "task old": [say("old done")], "task new": [gate.behavior] });
		const subagents = service(harness);
		const old = await spawnWorker(subagents, "task old", "Keeper");
		await vi.waitFor(() => expect(old.status).toBe("completed"), CHILD_START);
		evict();
		expect(subagents.list()).toEqual([]);
		for (const name of ["worker", "WORKER", "keeper", old.id])
			expect(target(subagents, name)).toBe(`tombstone:${old.id}`);
		const next = await spawnWorker(subagents, "task new");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		rename(subagents, next.id, "worker");
		expect(target(subagents, "worker")).toBe(`live:${next.id}`);
		gate.release();
		await vi.waitFor(() => expect(next.status).toBe("completed"), CHILD_START);
		expect(target(subagents, "worker")).toBe(`live:${next.id}`);
		// A run that never reached a session yields its name to the tombstone.
		const record = inspectRecord(subagents, next.id);
		const child = record?.child;
		if (!record || !child) throw new Error("no child session");
		record.child = undefined;
		expect(target(subagents, "worker")).toBe(`tombstone:${old.id}`);
		record.child = child;
	});

	it("lets steer_subagent and get_subagent_result reach an agent by its handle and its alias", async () => {
		const gate = held();
		const harness = await parent({ "task s": [gate.behavior] });
		const subagents = service(harness);
		const view = await spawnWorker(subagents, "task s", "Scout");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const steered: string[] = [];
		subagents.subscribe((event) => {
			if (event.type === "steered") steered.push(event.message);
		});
		expect(text(await call(harness, "steer_subagent", { agent_id: "worker", message: "by handle" }))).not.toContain(
			"Agent not found",
		);
		expect(text(await call(harness, "steer_subagent", { agent_id: "scout", message: "by alias" }))).not.toContain(
			"Agent not found",
		);
		expect(steered).toEqual(["by handle", "by alias"]);
		gate.release();
		await vi.waitFor(() => expect(view.status).toBe("completed"), CHILD_START);
		expect(text(await call(harness, "get_subagent_result", { agent_id: "worker" }))).toContain("released");
		expect(text(await call(harness, "get_subagent_result", { agent_id: "scout" }))).toContain("released");
	});

	it("lets the tools report an evicted agent's handle and an unknown one as not found", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const harness = await parent({ "task gone": [say("gone done")] });
		const subagents = service(harness);
		const view = await spawnWorker(subagents, "task gone");
		await vi.waitFor(() => expect(view.status).toBe("completed"), CHILD_START);
		evict();
		expect(target(subagents, "worker")).toBe(`tombstone:${view.id}`);
		for (const agentId of ["worker", "nobody"]) {
			expect(text(await call(harness, "steer_subagent", { agent_id: agentId, message: "hi" }))).toContain(
				"Agent not found",
			);
			expect(text(await call(harness, "get_subagent_result", { agent_id: agentId }))).toContain("Agent not found");
		}
	});

	it("frees an evicted agent's names when its tombstone is dropped, so the next agent takes the bare handle", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const harness = await parent({ "task first": [say("first done")], "task second": [say("second done")] });
		const subagents = service(harness);
		const first = await spawnWorker(subagents, "task first", "Keeper");
		await vi.waitFor(() => expect(first.status).toBe("completed"), CHILD_START);
		evict();
		subagents.dropTombstone("worker");
		expect(subagents.listTombstones()).toEqual([]);
		expect(target(subagents, "keeper")).toBeUndefined();
		const second = await spawnWorker(subagents, "task second", "Keeper");
		expect(second).toMatchObject({ handle: "worker", alias: "keeper" });
	});
});

describe("reopen", () => {
	it("reopens the evicted conversation: the child's first request holds the old user messages, then the new prompt", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const child = recorder();
		const harness = await parent({ "task delta": [child.behavior], "come back": [child.behavior] });
		const subagents = service(harness);
		const entry = await evictedWorker(subagents, "task delta");
		const before = child.seen.length;
		const view = await subagents.reopen(entry, "come back");
		await vi.waitFor(() => expect(view.status).toBe("completed"), CHILD_START);
		const first = child.seen[before];
		expect(first).toEqual(expect.arrayContaining(["task delta", "come back"]));
		expect(first.indexOf("task delta")).toBeLessThan(first.indexOf("come back"));
	});

	it("gives the reopened agent its tombstone's handle and alias back", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const gate = held();
		const harness = await parent({ "task audit": [say("audit done")], "anything else": [gate.behavior] });
		const subagents = service(harness);
		const entry = await evictedWorker(subagents, "task audit", "Auth Audit");
		expect(entry).toMatchObject({ handle: "worker", alias: "auth-audit" });
		const view = await subagents.reopen(entry, "anything else");
		expect(view).toMatchObject({ handle: "worker", alias: "auth-audit" });
		gate.release();
	});

	it("resolves the name to the reopened agent, not the tombstone", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const gate = held();
		const harness = await parent({ "task epsilon": [say("epsilon done")], "once more": [gate.behavior] });
		const subagents = service(harness);
		const entry = await evictedWorker(subagents, "task epsilon");
		const view = await subagents.reopen(entry, "once more");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		expect(target(subagents, "worker")).toBe(`live:${view.id}`);
		gate.release();
		await vi.waitFor(() => expect(view.status).toBe("completed"), CHILD_START);
		expect(target(subagents, "worker")).toBe(`live:${view.id}`);
	});

	it("refuses a deleted or disabled type, creating no record and keeping the tombstone", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const harness = await parent({ "task zeta": [say("zeta done")] });
		const subagents = service(harness);
		const entry = await evictedWorker(subagents, "task zeta");
		workerFile(harness, "description: Test worker. It does work.\nenabled: false");
		await expect(subagents.reopen(entry, "hi")).rejects.toThrow("The worker agent is no longer available.");
		workerFile(harness, undefined);
		await expect(subagents.reopen(entry, "hi")).rejects.toThrow("The worker agent is no longer available.");
		expect(subagents.list()).toEqual([]);
		expect(subagents.listTombstones()).toEqual([entry]);
	});

	it("reopens the same tombstone once its type is enabled again", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const child = recorder();
		const harness = await parent({ "task eta": [child.behavior], "hi again": [child.behavior] });
		const subagents = service(harness);
		const entry = await evictedWorker(subagents, "task eta");
		workerFile(harness, "description: Test worker. It does work.\nenabled: false");
		await expect(subagents.reopen(entry, "hi")).rejects.toThrow("no longer available");
		workerFile(harness, "description: Test worker. It does work.");
		// The refusal kept the tombstone, so the name still reaches it.
		const again = subagents.resolveMention("worker");
		if (again?.kind !== "tombstone") throw new Error("the tombstone is gone");
		const before = child.seen.length;
		const view = await subagents.reopen(again.entry, "hi again");
		await vi.waitFor(() => expect(view.status).toBe("completed"), CHILD_START);
		expect(view.handle).toBe("worker");
		expect(child.seen[before]).toEqual(expect.arrayContaining(["task eta", "hi again"]));
	});

	it("keeps the tombstone's description rather than one derived from the prompt", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const gate = held();
		const harness = await parent({ "find flaky tests": [say("found")], "anything else": [gate.behavior] });
		const subagents = service(harness);
		const entry = await evictedWorker(subagents, "find flaky tests");
		const view = await subagents.reopen(entry, "anything else");
		expect(view.description).toBe("find flaky tests");
		gate.release();
	});

	it("runs detached in the background: it notifies once on completion and joins no batch", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const harness = await parent({ "task theta": [say("theta done")], "report back": [say("reported back")] });
		const subagents = service(harness);
		const entry = await evictedWorker(subagents, "task theta");
		const view = await subagents.reopen(entry, "report back");
		expect(view).toMatchObject({ mode: "detached-background", joinMode: undefined });
		await vi.waitFor(() => expect(view.status).toBe("completed"), CHILD_START);
		const reported = () => notices(harness.session).filter((notice) => notice.includes("reported back"));
		await vi.waitFor(() => expect(reported()).toHaveLength(1), CHILD_START);
	});

	it("joins a reopen that is still starting, so one agent continues the conversation and gets both prompts", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const child = recorder();
		const harness = await parent({
			"task kappa": [child.behavior],
			"go on": [child.behavior],
			"and more": [child.behavior],
		});
		const subagents = service(harness);
		const entry = await evictedWorker(subagents, "task kappa");
		const [first, second] = await Promise.all([
			subagents.reopen(entry, "go on"),
			subagents.reopen(entry, "and more"),
		]);
		expect(second.id).toBe(first.id);
		expect(subagents.list()).toHaveLength(1);
		await vi.waitFor(() => expect(child.seen.flat()).toContain("and more"), CHILD_START);
	});
});

describe("the input hook", () => {
	it("starts an agent of the mentioned type with the message as its prompt, and spends no parent turn", async () => {
		const gate = held();
		const harness = await parent({ "task alpha": [gate.behavior] });
		const { notes } = await bind(harness);
		const message = "task alpha: find every retry marker in the codebase and list each one";
		await harness.session.prompt(`@worker ${message}`);
		expect(turns(harness)).toBe(0);
		await vi.waitFor(() => expect(notes).toContain("Started @worker"), CHILD_START);
		const [view] = service(harness).list();
		expect(view).toMatchObject({
			type: "worker",
			prompt: message,
			description: "task alpha: find every retry marker in…",
			mode: "detached-background",
		});
		gate.release();
	});

	it("applies the agent file's model, thinking and turn limit, and shows its turn limit and tool activity", async () => {
		const harness = await parent({ "task omega": [use("read", () => ({ path: "README.md" })), say("omega done")] });
		writeFileSync(join(harness.tempDir, "README.md"), "readme\n");
		const model = harness.getModel().id;
		workerFile(harness, `description: Test worker. It does work.\nmodel: ${model}\nthinking: low\nmax_turns: 5`);
		const { notes } = await bind(harness);
		await harness.session.prompt("@worker task omega");
		await vi.waitFor(() => expect(notes).toContain("Started @worker"), CHILD_START);
		const [view] = service(harness).list();
		await vi.waitFor(() => expect(view.status).toBe("completed"), CHILD_START);
		expect(view.invocation).toMatchObject({ modelInput: model, thinking: "low", maxTurns: 5 });
		expect(view.maxTurns).toBe(5);
		expect(view.toolUses).toBe(1);
		expect(view.activity).toEqual(expect.arrayContaining([expect.objectContaining({ type: "tool_start" })]));
	});

	it("relays a direct start's answer through the ordinary completion notification", async () => {
		const harness = await parent({ "task rho": [say("rho answer")] });
		const { notes } = await bind(harness);
		await harness.session.prompt("@worker task rho");
		await vi.waitFor(() => expect(notes).toContain("Started @worker"), CHILD_START);
		await vi.waitFor(() => expect(notices(harness.session).join("\n")).toContain("rho answer"), CHILD_START);
	});

	it("reports a refused start, and a start whose worktree fails once, with no second agent", async () => {
		const harness = await parent({});
		workerFile(harness, "description: Test worker. It does work.\nisolation: worktree");
		const { notes } = await bind(harness);
		await harness.session.prompt("@worker task sigma");
		await vi.waitFor(() =>
			expect(notes.join("\n")).toMatch(
				/Could not start @worker: Cannot run with isolation: "worktree": .* git repository/,
			),
		);
		expect(service(harness).list()).toEqual([]);
		gitRepository(harness);
		// A file where git keeps its worktrees: the repository checks pass, and `git worktree add` fails.
		writeFileSync(join(harness.tempDir, ".git", "worktrees"), "");
		await harness.session.prompt("@worker task tau");
		await vi.waitFor(
			() => expect(notes.join("\n")).toMatch(/Could not start @worker: .*git worktree add failed/),
			CHILD_START,
		);
		const views = service(harness).list();
		expect(views).toHaveLength(1);
		await vi.waitFor(() => expect(views[0]?.status).toBe("error"), CHILD_START);
		await sleep(200);
		expect(notes.filter((note) => note.startsWith("Could not start"))).toHaveLength(2);
		expect(notes).not.toContain("Started @worker");
		expect(service(harness).list()).toHaveLength(1);
		expect(turns(harness)).toBe(0);
	});

	it("refuses a type disabled after the hook read the registry, rather than starting another type", async () => {
		const harness = await parent({});
		const { notes } = await bind(harness);
		// The hook still lists `worker` from its cached registry; the spawn reads the file again.
		workerFile(harness, "description: Test worker. It does work.\nenabled: false");
		await harness.session.prompt("@worker go on");
		await vi.waitFor(() =>
			expect(notes).toContain("Could not start @worker: The worker agent is no longer available."),
		);
		expect(service(harness).list()).toEqual([]);
		expect(turns(harness)).toBe(0);
	});

	it("steers a running agent by its handle, with no second agent", async () => {
		const gate = held();
		const harness = await parent({ "task beta": [gate.behavior] });
		const { notes } = await bind(harness);
		await harness.session.prompt("@worker task beta");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const steered: string[] = [];
		service(harness).subscribe((event) => {
			if (event.type === "steered") steered.push(event.message);
		});
		await harness.session.prompt("@worker keep going");
		await vi.waitFor(() => expect(notes).toContain("Sent to @worker"));
		expect(steered).toEqual(["keep going"]);
		expect(service(harness).list()).toHaveLength(1);
		expect(turns(harness)).toBe(0);
		gate.release();
	});

	it("reaches a sibling by its numbered handle, and an agent still waiting for a slot", async () => {
		const gate = held();
		const harness = await parent({ "task one": [gate.behavior], "task two": [gate.behavior] }, { maxConcurrent: 1 });
		const { notes } = await bind(harness);
		const subagents = service(harness);
		const first = await spawnWorker(subagents, "task one");
		const second = await spawnWorker(subagents, "task two");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		expect([first.handle, first.status, second.handle, second.status]).toEqual([
			"worker",
			"running",
			"worker-2",
			"queued",
		]);
		const steered: string[] = [];
		subagents.subscribe((event) => {
			if (event.type === "steered") steered.push(`${event.record.handle}: ${event.message}`);
		});
		await harness.session.prompt("@worker-2 wait for me");
		await vi.waitFor(() => expect(notes).toContain("Sent to @worker-2"));
		expect(steered).toEqual(["worker-2: wait for me"]);
		expect(subagents.list()).toHaveLength(2);
		gate.release();
	});

	it("reports a steer that fails", async () => {
		const gate = held();
		const harness = await parent({ "task chi": [gate.behavior] });
		const { notes } = await bind(harness);
		const subagents = service(harness);
		await spawnWorker(subagents, "task chi");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		vi.spyOn(subagents, "steer").mockResolvedValueOnce({ kind: "failed", error: "steer broke" });
		await harness.session.prompt("@worker hello");
		await vi.waitFor(() => expect(notes).toContain("Could not send to @worker: steer broke"));
		gate.release();
	});

	it("resumes a finished agent in the background with no tool call, and relays its answer", async () => {
		const harness = await parent({ "task gamma": [say("gamma done")], "follow up": [say("follow done")] });
		const { notes } = await bind(harness);
		await harness.session.prompt("@worker task gamma");
		const subagents = service(harness);
		await vi.waitFor(() => expect(subagents.list()[0]?.status).toBe("completed"), CHILD_START);
		const before = turns(harness);
		await harness.session.prompt("@worker follow up");
		// The completion notice of the first run may start a parent turn; the mention adds none.
		expect(turns(harness)).toBe(before);
		expect(notes).toContain("Resuming @worker");
		const [view] = subagents.list();
		expect(view).toMatchObject({ mode: "background", toolCallId: undefined });
		await vi.waitFor(() => expect(view.result).toBe("follow done"), CHILD_START);
		expect(subagents.list()).toHaveLength(1);
		await vi.waitFor(() => expect(notices(harness.session).join("\n")).toContain("follow done"), CHILD_START);
	});

	it("keeps an agent file's output_transcript: false when resuming", async () => {
		const harness = await parent({ "task psi": [say("psi done")], "psi again": [say("psi again done")] });
		workerFile(harness, "description: Test worker. It does work.\noutput_transcript: false");
		const { notes } = await bind(harness);
		await harness.session.prompt("@worker task psi");
		const subagents = service(harness);
		await vi.waitFor(() => expect(subagents.list()[0]?.status).toBe("completed"), CHILD_START);
		const [view] = subagents.list();
		expect(view.transcriptPath).toBeUndefined();
		await harness.session.prompt("@worker psi again");
		expect(notes).toContain("Resuming @worker");
		await vi.waitFor(() => expect(view.result).toBe("psi again done"), CHILD_START);
		expect(view.transcriptPath).toBeUndefined();
	});

	it("reopens an evicted agent's session under its old handle", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const child = recorder();
		const harness = await parent({ "task delta": [child.behavior], "come back": [child.behavior] });
		const { notes } = await bind(harness);
		await harness.session.prompt("@worker task delta");
		const subagents = service(harness);
		await vi.waitFor(() => expect(subagents.list()[0]?.status).toBe("completed"), CHILD_START);
		evict();
		expect(subagents.list()).toEqual([]);
		expect(subagents.listTombstones()).toHaveLength(1);
		await harness.session.prompt("@worker come back");
		await vi.waitFor(() => expect(notes).toContain("Resuming @worker"), CHILD_START);
		const [view] = subagents.list();
		expect(view).toMatchObject({ handle: "worker", description: "task delta" });
		await vi.waitFor(() => expect(view.status).toBe("completed"), CHILD_START);
		expect(child.seen.at(-1)).toEqual(expect.arrayContaining(["task delta", "come back"]));
	});

	// T8-F1: the tombstone's old id kept pointing at the tombstone, so a second mention reopened it again.
	it("answers an evicted agent's old id with its reopened agent, so its session never reopens twice", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const gate = held();
		const harness = await parent({ "task sigma": [say("sigma done")], "first again": [gate.behavior] });
		const { notes } = await bind(harness);
		const subagents = service(harness);
		const entry = await evictedWorker(subagents, "task sigma");
		await harness.session.prompt(`@${entry.id} first again`);
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const [reopened] = subagents.list();
		expect(reopened.id).not.toBe(entry.id);
		await harness.session.prompt(`@${entry.id} second message`);
		await vi.waitFor(() => expect(notes).toContain("Sent to @worker"));
		expect(notes.filter((note) => note === "Resuming @worker")).toHaveLength(1);
		expect(subagents.list()).toEqual([reopened]);
		gate.release();
	});

	it("drops a tombstone whose session file is gone, and the next mention starts afresh", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const harness = await parent({ "task kappa": [say("kappa done")], "third try": [say("third done")] });
		const { notes } = await bind(harness);
		const subagents = service(harness);
		const entry = await evictedWorker(subagents, "task kappa");
		unlinkSync(entry.sessionFile);
		await harness.session.prompt("@worker again");
		expect(notes).toContain("Could not resume @worker: its session is gone.");
		expect(subagents.listTombstones()).toEqual([]);
		expect(subagents.list()).toEqual([]);
		await harness.session.prompt("@worker third try");
		await vi.waitFor(() => expect(notes).toContain("Started @worker"), CHILD_START);
		expect(subagents.list()).toEqual([expect.objectContaining({ handle: "worker", prompt: "third try" })]);
		expect(turns(harness)).toBe(0);
	});

	it("reports a reopen of an agent type that is no longer available, and keeps the tombstone", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const harness = await parent({ "task lambda": [say("lambda done")] });
		const { notes } = await bind(harness);
		const subagents = service(harness);
		await evictedWorker(subagents, "task lambda");
		workerFile(harness, "description: Test worker. It does work.\nenabled: false");
		await harness.session.prompt("@worker again");
		await vi.waitFor(() =>
			expect(notes).toContain("Could not resume @worker: The worker agent is no longer available."),
		);
		expect(notes).not.toContain("Resuming @worker");
		expect(subagents.list()).toEqual([]);
		expect(subagents.listTombstones()).toHaveLength(1);
	});

	it("reports a reopen whose worktree fails to start once, with no unhandled rejection", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const harness = await parent({ "task iota": [say("done")] });
		const { notes } = await bind(harness);
		await harness.session.prompt("@worker task iota");
		const subagents = service(harness);
		await vi.waitFor(() => expect(subagents.list()[0]?.status).toBe("completed"), CHILD_START);
		evict();
		vi.spyOn(subagents, "worktreeStarted").mockRejectedValueOnce(new Error("worktree refused"));
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			await harness.session.prompt("@worker again");
			await vi.waitFor(() => expect(notes).toContain("Could not resume @worker: worktree refused"), CHILD_START);
			await new Promise((resolve) => setImmediate(resolve));
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
		expect(unhandled).toEqual([]);
		expect(notes.filter((note) => note.startsWith("Could not resume"))).toHaveLength(1);
		expect(notes).not.toContain("Resuming @worker");
	});

	it("in model mode, claims the prompt at once and lets a clone with Agent as its only tool write the prompt", async () => {
		const requests: Context[] = [];
		const reply = held(() =>
			fauxAssistantMessage(
				[
					fauxToolCall("Agent", {
						subagent_type: "general-purpose",
						prompt: "clone wrote epsilon",
						description: "clone desc",
					}),
				],
				{ stopReason: "toolUse" },
			),
		);
		const parentBehavior: Behavior = (context, options) => {
			requests.push(context);
			const last = context.messages.at(-1);
			if (last?.role === "user" && textOf(last.content).includes(REMINDER)) return reply.behavior(context, options);
			return fauxAssistantMessage("hello back");
		};
		const gate = held();
		const harness = await parent(
			{ "clone wrote epsilon": [gate.behavior] },
			{ agentMentions: "model" },
			parentBehavior,
		);
		const { notes } = await bind(harness);
		await harness.session.prompt("hello");
		const before = turns(harness);
		// The prompt returns while the clone still waits for its reply.
		await harness.session.prompt("@worker find epsilon");
		expect(notes).toEqual(["Prompting @worker…"]);
		await vi.waitFor(() => expect(reply.requests()).toBe(1));
		expect(service(harness).list()).toEqual([]);
		const clone = requests.at(-1) as Context;
		expect(getCurrentTools(clone.messages).map((tool) => tool.name)).toEqual(["Agent"]);
		expect(getCurrentSystemPrompt(clone.messages)).toBe(getCurrentSystemPrompt(requests[0].messages));
		const last = textOf(clone.messages.at(-1)?.content);
		expect(last).toMatch(/^find epsilon\n\n<system-reminder>/);
		expect(last).toContain('invoke the agent "worker"');
		reply.release();
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		expect(turns(harness)).toBe(before);
		// The mentioned type wins over the clone's choice.
		expect(service(harness).list()[0]).toMatchObject({ type: "worker", description: "clone desc" });
		expect(notes).toEqual(["Prompting @worker…"]);
		gate.release();
	});

	it("in model mode, starts the agent directly when the clone calls no tool", async () => {
		const gate = held();
		const harness = await parent({ "find zeta": [gate.behavior] }, { agentMentions: "model" }, () =>
			fauxAssistantMessage("I will not call a tool"),
		);
		const { notes } = await bind(harness);
		await harness.session.prompt("@worker find zeta");
		await vi.waitFor(
			() => expect(notes).toContain("Started @worker directly: the conversation clone did not start it"),
			CHILD_START,
		);
		expect(service(harness).list()[0]).toMatchObject({ prompt: "find zeta" });
		gate.release();
	});

	it("in model mode, reports a fallback start that also fails", async () => {
		const harness = await parent({}, { agentMentions: "model" }, () =>
			fauxAssistantMessage("I will not call a tool"),
		);
		workerFile(harness, "description: Test worker. It does work.\nisolation: worktree");
		const { notes } = await bind(harness);
		await harness.session.prompt("@worker find eta");
		await vi.waitFor(() =>
			expect(notes.join("\n")).toMatch(/Could not start @worker: Cannot run with isolation: "worktree"/),
		);
		expect(service(harness).list()).toEqual([]);
	});

	it("in model mode, relays the answer of an agent the clone fell back to start", async () => {
		const harness = await parent({ "find theta": [say("theta answer")] }, { agentMentions: "model" }, () =>
			fauxAssistantMessage("I will not call a tool"),
		);
		const { notes } = await bind(harness);
		await harness.session.prompt("@worker find theta");
		await vi.waitFor(() => expect(notes.join("\n")).toContain("Started @worker directly"), CHILD_START);
		await vi.waitFor(() => expect(notices(harness.session).join("\n")).toContain("theta answer"), CHILD_START);
	});

	it("never clones for a steer, a resume, an unknown handle, the direct mode or the off setting", async () => {
		let clones = 0;
		const counting: Behavior = (context) => {
			const last = context.messages.at(-1);
			if (last?.role === "user" && textOf(last.content).includes(REMINDER)) clones++;
			return fauxAssistantMessage("main reply");
		};
		const gate = held();
		const script = { "task mu": [gate.behavior], "mu again": [say("mu again done")], "task nu": [say("nu")] };
		const model = await parent(script, { agentMentions: "model" }, counting);
		const { notes } = await bind(model);
		const subagents = service(model);
		const view = await spawnWorker(subagents, "task mu");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		await model.session.prompt("@worker steer me");
		await vi.waitFor(() => expect(notes).toContain("Sent to @worker"));
		gate.release();
		await vi.waitFor(() => expect(view.status).toBe("completed"), CHILD_START);
		await model.session.prompt("@worker mu again");
		expect(notes).toContain("Resuming @worker");
		await model.session.prompt("@nobody hello");
		expect(userTexts(model)).toEqual(["@nobody hello"]);
		for (const mode of ["direct", "off"]) {
			const other = await parent(script, { agentMentions: mode }, counting);
			await bind(other);
			await other.session.prompt("@worker task nu");
		}
		await sleep(100);
		expect(clones).toBe(0);
	});

	it("passes an unknown handle, a bare handle, a leading file path and an extension's prompt to the main model", async () => {
		const harness = await parent({});
		const { notes } = await bind(harness);
		const prompts = ["@nobody hi", "@worker", "@src/index.ts summarize this"];
		for (const prompt of prompts) await harness.session.prompt(prompt);
		await harness.session.prompt("@worker from an extension", { source: "extension" });
		expect(userTexts(harness)).toEqual([...prompts, "@worker from an extension"]);
		expect(turns(harness)).toBe(8);
		expect(service(harness).list()).toEqual([]);
		expect(notes).toEqual([]);
	});

	it("passes every mention on in print, JSON and RPC mode, and leaves a running agent alone", async () => {
		for (const mode of ["print", "json", "rpc"] as const) {
			const gate = held();
			const harness = await parent({ "task xi": [gate.behavior] });
			const { notes } = await bind(harness, mode);
			const subagents = service(harness);
			await spawnWorker(subagents, "task xi");
			await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
			const steered: string[] = [];
			subagents.subscribe((event) => {
				if (event.type === "steered") steered.push(event.message);
			});
			await harness.session.prompt("@worker hi");
			await harness.session.prompt("@plan hi");
			expect(userTexts(harness), mode).toEqual(["@worker hi", "@plan hi"]);
			expect(steered, mode).toEqual([]);
			expect(subagents.list(), mode).toHaveLength(1);
			expect(notes, mode).toEqual([]);
			gate.release();
		}
	});

	// T8-F4: the hook reread every settings file for each prompt before it checked for a mention.
	it("rereads the settings only for a prompt shaped as a mention", async () => {
		const harness = await parent({});
		await bind(harness);
		const reads = vi.spyOn(service(harness), "reloadSettings");
		for (const prompt of ["hello", "@worker", "ask @worker later"]) await harness.session.prompt(prompt);
		expect(reads).not.toHaveBeenCalled();
		await harness.session.prompt("@nobody hi");
		expect(reads).toHaveBeenCalledTimes(1);
	});

	it("passes every mention on while agentMentions is off, for a running, a finished and a never-started agent", async () => {
		const gate = held();
		const harness = await parent({ "task pi": [gate.behavior], "task rho": [say("rho")] }, { agentMentions: "off" });
		const { notes } = await bind(harness);
		const subagents = service(harness);
		const finished = await spawnWorker(subagents, "task rho", "Done");
		await vi.waitFor(() => expect(finished.status).toBe("completed"), CHILD_START);
		await spawnWorker(subagents, "task pi");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const prompts = ["@worker-2 steer", "@done resume", "@plan start"];
		for (const prompt of prompts) await harness.session.prompt(prompt);
		expect(userTexts(harness)).toEqual(prompts);
		expect(subagents.list()).toHaveLength(2);
		expect(finished.status).toBe("completed");
		expect(notes).toEqual([]);
		gate.release();
	});

	it("sends @main's text with its images to the main model, and passes a bare @main unchanged", async () => {
		const harness = await parent({});
		await bind(harness);
		// A 1x1 PNG, so the image survives Pi's resize step.
		const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
		const image = { type: "image" as const, data, mimeType: "image/png" };
		await harness.session.prompt("@main look at this", { images: [image] });
		await harness.session.prompt("@main");
		expect(userTexts(harness)).toEqual(["look at this", "@main"]);
		const [first] = harness.session.messages.filter((message) => message.role === "user");
		expect(first?.role === "user" && Array.isArray(first.content) ? first.content : []).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: "image" })]),
		);
	});

	it("never starts an agent for @main, even when a type slugs to main", async () => {
		const harness = await parent({});
		writeFileSync(join(harness.tempDir, "agents", "main.md"), "---\ndescription: Named main.\n---\nYou are main.");
		const { notes } = await bind(harness);
		await harness.session.prompt("@main hello there");
		expect(userTexts(harness)).toEqual(["hello there"]);
		expect(service(harness).list()).toEqual([]);
		expect(notes).toEqual([]);
	});

	it("starts the type @agent-<type> names and reaches its running agent", async () => {
		const gate = held();
		const harness = await parent({ "task tau": [gate.behavior] });
		const { notes } = await bind(harness);
		await harness.session.prompt("@agent-worker task tau");
		await vi.waitFor(() => expect(notes).toContain("Started @worker"), CHILD_START);
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		await harness.session.prompt("@Agent-Worker keep at it");
		await vi.waitFor(() => expect(notes).toContain("Sent to @worker"));
		expect(service(harness).list()).toHaveLength(1);
		expect(turns(harness)).toBe(0);
		gate.release();
	});

	it("prefers an agent named agent-<x> over the unwrapped <x>, and passes on when neither spelling resolves", async () => {
		const gate = held();
		const harness = await parent({ "task upsilon": [gate.behavior], "task phi": [gate.behavior] });
		const { notes } = await bind(harness);
		const subagents = service(harness);
		await spawnWorker(subagents, "task upsilon");
		const named = await spawnWorker(subagents, "task phi", "agent-worker");
		await vi.waitFor(() => expect(gate.requests()).toBe(2), CHILD_START);
		const steered: string[] = [];
		subagents.subscribe((event) => {
			if (event.type === "steered") steered.push(event.record.id);
		});
		await harness.session.prompt("@agent-worker for the named one");
		await vi.waitFor(() => expect(notes).toContain("Sent to @agent-worker"));
		expect(steered).toEqual([named.id]);
		await harness.session.prompt("@agent-nobody hi");
		expect(userTexts(harness)).toEqual(["@agent-nobody hi"]);
		gate.release();
	});

	it("matches a handle whatever its casing and reaches an agent by its raw id", async () => {
		const gate = held();
		const harness = await parent({ "task chi": [gate.behavior] });
		const { notes } = await bind(harness);
		const subagents = service(harness);
		const view = await spawnWorker(subagents, "task chi");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const steered: string[] = [];
		subagents.subscribe((event) => {
			if (event.type === "steered") steered.push(event.message);
		});
		await harness.session.prompt("@WORKER by casing");
		await harness.session.prompt(`@${view.id} by id`);
		await vi.waitFor(() => expect(steered).toEqual(["by casing", "by id"]));
		expect(notes).toEqual(["Sent to @worker", "Sent to @worker"]);
		expect(subagents.list()).toHaveLength(1);
		gate.release();
	});

	it("never reaches a nested agent: the mention starts a top-level agent instead", async () => {
		const gate = held();
		const harness = await parent({
			"task lead": [gate.behavior],
			"nested psi": [gate.behavior],
			"task new": [gate.behavior],
		});
		const { notes } = await bind(harness);
		const subagents = service(harness);
		const lead = await subagents.spawn({
			type: "general-purpose",
			prompt: "task lead",
			description: "lead",
			mode: "detached-background",
		});
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const nested = await subagents.spawnOwned(
			lead,
			{ type: "worker", prompt: "nested psi", description: "nested" },
			(registry) => {
				const definition = registry.agents.get("worker");
				return definition ? { ok: true, definition } : { ok: false, message: "no worker" };
			},
		);
		await vi.waitFor(() => expect(gate.requests()).toBe(2), CHILD_START);
		const steered: string[] = [];
		subagents.subscribe((event) => {
			if (event.type === "steered") steered.push(event.record.id);
		});
		await harness.session.prompt("@worker task new");
		await vi.waitFor(() => expect(notes).toContain("Started @worker"), CHILD_START);
		expect(steered).toEqual([]);
		const started = subagents.list().find((view) => view.prompt === "task new");
		expect(started).toMatchObject({ type: "worker", handle: "worker", parentId: undefined });
		expect(started?.id).not.toBe(nested.id);
		// Its raw id reaches nothing either: the prompt goes to the main model.
		await harness.session.prompt(`@${nested.id} hello`);
		expect(userTexts(harness)).toEqual([`@${nested.id} hello`]);
		expect(steered).toEqual([]);
		gate.release();
	});

	// T8-F3: an alias or a numbered handle named no type, so the mention fell through to the main model.
	it("starts a fresh agent of a record's own type when the record never reached a session, by its alias or numbered handle", async () => {
		const gate = held();
		const harness = await parent({
			"task first": [say("first done")],
			"task second": [say("second done")],
			"retry one": [gate.behavior],
			"retry two": [gate.behavior],
		});
		const { notes } = await bind(harness);
		const subagents = service(harness);
		const first = await spawnWorker(subagents, "task first");
		const second = await spawnWorker(subagents, "task second", "Reviewer");
		await vi.waitFor(() => expect([first.status, second.status]).toEqual(["completed", "completed"]), CHILD_START);
		expect([second.handle, second.alias]).toEqual(["worker-2", "reviewer"]);
		// Stands in for runs that failed before their session existed; the children return at the end.
		const records = [first, second].map((view) => inspectRecord(subagents, view.id));
		const children = records.map((record) => record?.child);
		for (const record of records) if (record) record.child = undefined;
		try {
			await harness.session.prompt("@reviewer retry one");
			await harness.session.prompt("@worker-2 retry two");
			await vi.waitFor(() => expect(gate.requests()).toBe(2), CHILD_START);
			expect(notes).toEqual(["Started @worker", "Started @worker"]);
			expect(userTexts(harness)).toEqual([]);
			expect(
				subagents
					.list()
					.filter((view) => view.prompt.startsWith("retry"))
					.map((view) => `${view.type} ${view.prompt}`)
					.sort(),
			).toEqual(["worker retry one", "worker retry two"]);
		} finally {
			records.forEach((record, index) => {
				if (record) record.child = children[index];
			});
			gate.release();
		}
	});

	it("starts afresh when an evicted agent left no session file", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const harness = await parent(
			{ "task omicron": [say("omicron done")], "second run": [say("second")] },
			{ rememberAgents: false },
		);
		const { notes } = await bind(harness);
		await harness.session.prompt("@worker task omicron");
		const subagents = service(harness);
		await vi.waitFor(() => expect(subagents.list()[0]?.status).toBe("completed"), CHILD_START);
		const [first] = subagents.list();
		evict();
		expect(subagents.list()).toEqual([]);
		expect(subagents.listTombstones()).toEqual([]);
		await harness.session.prompt("@worker second run");
		await vi.waitFor(() => expect(notes.filter((note) => note === "Started @worker")).toHaveLength(2), CHILD_START);
		const [second] = subagents.list();
		expect(second).toMatchObject({ handle: "worker", prompt: "second run" });
		expect(second.id).not.toBe(first.id);
	});

	it("returns at once from a steer whose child input handler never resolves", async () => {
		const gate = held();
		const harness = await parent({ "task sticky": [gate.behavior] });
		const hold = holdChildInput(harness, "never taken");
		const { notes } = await bind(harness);
		await harness.session.prompt("@worker task sticky");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const returned = await Promise.race([
			harness.session.prompt("@worker never taken").then(() => "returned"),
			sleep(2_000).then(() => "blocked"),
		]);
		expect(returned).toBe("returned");
		await vi.waitFor(() => expect(hold.probe.seen).toBe(true));
		expect(notes).toEqual(["Started @worker"]);
		hold.release();
		await vi.waitFor(() => expect(notes).toContain("Sent to @worker"));
		gate.release();
	});

	for (const end of ["reload", "shutdown"] as const) {
		it(`aborts a clone still waiting for its reply at ${end === "reload" ? "/reload" : "the session's end"}`, async () => {
			const reply = held(() =>
				fauxAssistantMessage(
					[fauxToolCall("Agent", { subagent_type: "worker", prompt: "late", description: "late" })],
					{ stopReason: "toolUse" },
				),
			);
			let released = false;
			const parentBehavior: Behavior = (context, options) => {
				const last = context.messages.at(-1);
				if (last?.role !== "user" || !textOf(last.content).includes(REMINDER)) return fauxAssistantMessage("ok");
				// Answers only once released, whatever the signal says: a provider that ignores the abort.
				return reply.behavior(context, released ? options : undefined);
			};
			const harness = await parent({ late: [say("late done")] }, { agentMentions: "model" }, parentBehavior);
			const { notes } = await bind(harness);
			const subagents = service(harness);
			await harness.session.prompt("@worker find sigma");
			await vi.waitFor(() => expect(reply.requests()).toBe(1));
			if (end === "reload") await harness.session.reload();
			else await harness.session.shutdown();
			released = true;
			reply.release();
			await sleep(300);
			expect(subagents.list()).toEqual([]);
			expect(notes).toEqual(["Prompting @worker…"]);
		});
	}

	it("reopens the same conversation on a retry after a reopen failed to start", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const child = recorder();
		const harness = await parent({ "task theta": [child.behavior], "try again": [child.behavior] });
		const { notes } = await bind(harness);
		await harness.session.prompt("@worker task theta");
		const subagents = service(harness);
		await vi.waitFor(() => expect(subagents.list()[0]?.status).toBe("completed"), CHILD_START);
		evict();
		const [tombstone] = subagents.listTombstones();
		// A directory at the session path makes the reopened child fail before its session exists.
		renameSync(tombstone.sessionFile, `${tombstone.sessionFile}.aside`);
		mkdirSync(tombstone.sessionFile);
		await harness.session.prompt("@worker first try");
		await vi.waitFor(() => expect(subagents.list()[0]?.status).toBe("error"), CHILD_START);
		rmdirSync(tombstone.sessionFile);
		renameSync(`${tombstone.sessionFile}.aside`, tombstone.sessionFile);
		child.seen.length = 0;
		await harness.session.prompt("@worker try again");
		await vi.waitFor(() => expect(notes.filter((note) => note === "Resuming @worker")).toHaveLength(2), CHILD_START);
		await vi.waitFor(
			() => expect(child.seen.at(-1)).toEqual(expect.arrayContaining(["task theta", "try again"])),
			CHILD_START,
		);
	});

	for (const end of ["reload", "shutdown"] as const) {
		it(`notifies nothing for a steer that settles after ${end === "reload" ? "/reload" : "the session's end"}, and raises no unhandled rejection`, async () => {
			const gate = held();
			const harness = await parent({ "task hold": [gate.behavior] });
			const hold = holdChildInput(harness, "held steer");
			const { notes } = await bind(harness);
			await harness.session.prompt("@worker task hold");
			await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
			await harness.session.prompt("@worker held steer");
			await vi.waitFor(() => expect(hold.probe.seen).toBe(true));
			const unhandled: unknown[] = [];
			const onUnhandled = (reason: unknown) => unhandled.push(reason);
			process.on("unhandledRejection", onUnhandled);
			try {
				if (end === "reload") await harness.session.reload();
				else await harness.session.shutdown();
				hold.release();
				gate.release();
				await sleep(300);
			} finally {
				process.off("unhandledRejection", onUnhandled);
			}
			expect(unhandled).toEqual([]);
			expect(notes).toEqual(["Started @worker"]);
		});
	}
});

/** A skill the session's skill set publishes, bundling one agent file per entry of `agents`. */
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

/** A provider below the popup that answers nothing, or throws `error`. */
function below(error?: Error): AutocompleteProvider {
	return {
		getSuggestions: async () => {
			if (error) throw error;
			return null;
		},
		applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
	};
}

/** The popup rows for `line`, as `<value> <description>`. */
async function popup(provider: AutocompleteProvider, line: string): Promise<string[]> {
	const result = await provider.getSuggestions([line], 0, line.length, { signal: new AbortController().signal });
	return (result?.items ?? []).map((item) => `${item.value} ${item.description ?? ""}`.trim());
}

describe("the @ popup", () => {
	it("adds agent rows above the wrapped provider's rows, and answers a live agent's handle", async () => {
		const gate = held();
		const harness = await parent({ "task eta": [gate.behavior] });
		const { wrappers } = await bind(harness);
		expect(wrappers).toHaveLength(1);
		const inner: AutocompleteProvider = {
			getSuggestions: async () => ({ items: [{ value: "@src/", label: "src/" }], prefix: "@" }),
			applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
		};
		const provider = wrappers[0](inner);
		const signal = new AbortController().signal;
		const before = await provider.getSuggestions(["@"], 0, 1, { signal });
		expect(before?.items.map((item) => item.value)).toEqual([
			"@general-purpose",
			"@explore",
			"@plan",
			"@worker",
			"@src/",
		]);
		await harness.session.prompt("@worker task eta");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const after = await provider.getSuggestions(["@wo"], 0, 3, { signal });
		expect(after?.items[0]).toMatchObject({
			value: "@worker",
			description: expect.stringMatching(/^send message · running/),
		});
		gate.release();
	});

	it("registers the provider once per activation, in TUI mode only, and again after /reload", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		// A loader whose reload runs the factory again, as interactive mode's `/reload` does.
		const cwd = mkdtempSync(join(tmpdir(), "pi-mention-reload-"));
		const bus = createEventBus();
		const load = () => createTestExtensionsResult([{ name: "subagents", factory: subagentsPresentation }], cwd, bus);
		let extensions = await load();
		const resourceLoader: ResourceLoader = {
			...createTestResourceLoader({ eventBus: bus }),
			getExtensions: () => extensions,
			reload: async () => {
				extensions = await load();
			},
		};
		const harness = await createHarness({
			cwd,
			eventBus: bus,
			resourceLoader,
			settings: { forkBuiltins: { subagents: { agentMentions: "direct" } } } as unknown as Partial<Settings>,
		});
		harnesses.push(harness);
		mkdirSync(join(cwd, "agents"), { recursive: true });
		writeFileSync(join(cwd, "agents", "worker.md"), "---\ndescription: Test worker.\ntools: read\n---\nYou work.");
		const first = await bind(harness);
		const second = await bind(harness);
		expect([first.wrappers.length, second.wrappers.length]).toEqual([1, 0]);
		await harness.session.reload();
		expect(second.wrappers).toHaveLength(1);
		expect(await popup(second.wrappers[0](below()), "@wor")).toEqual(["@worker start agent · Test worker."]);
		for (const mode of ["rpc", "json", "print"] as const) {
			const other = await parent({});
			const { wrappers } = await bind(other, mode);
			expect(wrappers, mode).toEqual([]);
		}
	});

	it("keeps the agent rows when the wrapped provider fails, and the service warns once", async () => {
		const harness = await parent({});
		const { wrappers } = await bind(harness);
		const provider = wrappers[0](below(new Error("inner broke")));
		for (const line of ["@w", "@wo", "@wor"]) {
			expect(await popup(provider, line)).toEqual(["@worker start agent · Test worker."]);
		}
		expect(service(harness).warnings.filter((warning) => warning.includes("inner broke"))).toEqual([
			"The autocomplete provider below agent mentions failed: inner broke",
		]);
	});

	it("lists no skill-bundled agent, nested agent or disabled type, and the hook still reaches a skill agent by its handle", async () => {
		const gate = held();
		const harness = await parent({
			"task skill": [gate.behavior],
			"task lead": [gate.behavior],
			"nested task": [gate.behavior],
			"task kept": [say("kept done")],
		});
		const subagents = service(harness);
		const bus = subagents.eventBus;
		if (!bus) throw new Error("no event bus");
		getSkillSetController(bus).publish([
			skill(harness.tempDir, "audit", { checker: "description: Checks things.\ntools: read" }),
		]);
		writeFileSync(
			join(harness.tempDir, "agents", "idle.md"),
			"---\ndescription: Idle.\nenabled: false\n---\nYou idle.",
		);
		const { notes, wrappers } = await bind(harness);
		const kept = await spawnWorker(subagents, "task kept");
		await vi.waitFor(() => expect(kept.status).toBe("completed"), CHILD_START);
		// A disabled type keeps its existing agent in the popup, but never lists as a start.
		workerFile(harness, "description: Test worker. It does work.\nenabled: false");
		subagents.refreshDefinitions();
		const checker = await subagents.spawn({
			type: "audit:checker",
			prompt: "task skill",
			description: "skill work",
			mode: "detached-background",
		});
		const lead = await subagents.spawn({
			type: "general-purpose",
			prompt: "task lead",
			description: "lead",
			mode: "detached-background",
		});
		await vi.waitFor(() => expect(gate.requests()).toBe(2), CHILD_START);
		await subagents.spawnOwned(
			lead,
			{ type: "general-purpose", prompt: "nested task", description: "nested" },
			(registry) => {
				const definition = registry.agents.get("general-purpose");
				return definition ? { ok: true, definition } : { ok: false, message: "no general-purpose" };
			},
		);
		await vi.waitFor(() => expect(gate.requests()).toBe(3), CHILD_START);
		expect(checker.handle).toBe("audit-checker");
		const rows = await popup(wrappers[0](below()), "@");
		expect(rows).toEqual([
			"@general-purpose send message · running · lead",
			"@worker resume · completed · task kept",
			expect.stringMatching(/^@explore start agent/),
			expect.stringMatching(/^@plan start agent/),
		]);
		await harness.session.prompt("@audit-checker look closer");
		await vi.waitFor(() => expect(notes).toContain("Sent to @audit-checker"));
		gate.release();
	});

	it("reads no file while it answers a keystroke", async () => {
		const harness = await parent({ "task read": [say("read done")] });
		const { wrappers } = await bind(harness);
		const done = await spawnWorker(service(harness), "task read");
		await vi.waitFor(() => expect(done.status).toBe("completed"), CHILD_START);
		const provider = wrappers[0](below());
		vi.mocked(fs.readFileSync).mockClear();
		vi.mocked(fs.readdirSync).mockClear();
		for (const line of ["@", "@w", "@wo", "ask @pl"]) expect(await popup(provider, line)).not.toEqual([]);
		expect(vi.mocked(fs.readFileSync)).not.toHaveBeenCalled();
		expect(vi.mocked(fs.readdirSync)).not.toHaveBeenCalled();
	});
});

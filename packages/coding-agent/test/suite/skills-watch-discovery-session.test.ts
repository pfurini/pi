/**
 * C4d end-to-end through AgentSession with the faux provider and a real
 * DefaultResourceLoader whose watcher is driven by an injected watch factory +
 * manual timers: live watching of skill/command roots (AC1/AC2), the collision
 * re-emit split (AC4), boundary negatives (AC6), reload/refresh convergence,
 * late-subscriber health replay, and nested/monorepo discovery (AC3).
 */

import type { FSWatcher } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultResourceLoader, type ResourceLoaderChangeEvent } from "../../src/core/resource-loader.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { extractSkillListingBlock } from "../../src/core/skills/listing.ts";
import type { ResourceWatchFactory, WatchTimers } from "../../src/core/skills/resource-watch.ts";
import { SKILLS_CHANGED_CHANNEL, type SkillsChangedEvent } from "../../src/core/skills/skill-set-events.ts";
import type { InlineExtension } from "../../src/index.ts";
import { canonicalizePath } from "../../src/utils/paths.ts";
import { createHarness, getUserTexts, type Harness } from "./harness.ts";

// ---------------------------------------------------------------------------
// Deterministic watch driver (real temp-dir content, fake fs events + timers)
// ---------------------------------------------------------------------------

class FakeWatch {
	readonly dir: string;
	readonly listener: (eventType: string, filename: string | null) => void;
	readonly onError: () => void;
	closed = false;
	constructor(dir: string, listener: (eventType: string, filename: string | null) => void, onError: () => void) {
		this.dir = dir;
		this.listener = listener;
		this.onError = onError;
	}
	unref(): this {
		return this;
	}
	close(): void {
		this.closed = true;
	}
}

class FakeWatchFactory {
	readonly watches: FakeWatch[] = [];
	readonly failDirs = new Set<string>();

	readonly factory: ResourceWatchFactory = (dir, listener, onError) => {
		if (this.failDirs.has(dir)) return null;
		const fake = new FakeWatch(dir, listener, onError);
		this.watches.push(fake);
		return fake as unknown as FSWatcher;
	};

	emit(dir: string, filename: string | null = null): void {
		for (const fake of this.watches.filter((w) => w.dir === dir && !w.closed)) {
			fake.listener("rename", filename);
		}
	}

	fail(dir: string): void {
		for (const fake of this.watches.filter((w) => w.dir === dir && !w.closed)) {
			fake.onError();
		}
	}
}

interface PendingTimer {
	fn: () => void;
	cancelled: boolean;
}

class ManualTimers implements WatchTimers {
	readonly pending: PendingTimer[] = [];
	set(fn: () => void): unknown {
		const timer: PendingTimer = { fn, cancelled: false };
		this.pending.push(timer);
		return timer;
	}
	clear(handle: unknown): void {
		(handle as PendingTimer).cancelled = true;
	}
	flush(): void {
		const ready = this.pending.filter((timer) => !timer.cancelled);
		this.pending.length = 0;
		for (const timer of ready) timer.fn();
	}
	get pendingCount(): number {
		return this.pending.filter((timer) => !timer.cancelled).length;
	}
}

// ---------------------------------------------------------------------------
// Harness over a real DefaultResourceLoader with an injected watcher
// ---------------------------------------------------------------------------

interface WatchHarness {
	harness: Harness;
	loader: DefaultResourceLoader;
	settingsManager: SettingsManager;
	factory: FakeWatchFactory;
	timers: ManualTimers;
	snapshots: SkillsChangedEvent[];
	changeEvents: ResourceLoaderChangeEvent[];
	cwd: string;
	agentDir: string;
	skillsRoot: string;
	userCommandsRoot: string;
	projectCommandsRoot: string;
}

const cleanups: Array<() => void> = [];

beforeEach(() => {
	// Keep the real ~/.agents/skills out of every loader under test.
	vi.stubEnv("HOME", mkdtempSync(join(tmpdir(), "pi-c4d-home-")));
});

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()!();
	}
	vi.unstubAllEnvs();
});

function writeSkill(dir: string, name: string, description = `${name} description`): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nBody of ${name}.\n`);
}

async function createWatchHarness(options: { extensionFactories?: InlineExtension[] } = {}): Promise<WatchHarness> {
	const cwd = mkdtempSync(join(tmpdir(), "pi-c4d-watch-"));
	const agentDir = join(cwd, "agent-home");
	mkdirSync(agentDir, { recursive: true });
	const skillsRoot = join(cwd, ".pi", "skills");
	mkdirSync(skillsRoot, { recursive: true });
	const userCommandsRoot = join(agentDir, "commands");
	const projectCommandsRoot = join(cwd, ".pi", "commands");

	const settingsManager = SettingsManager.inMemory();
	const factory = new FakeWatchFactory();
	const timers = new ManualTimers();
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		watchOptions: { watch: factory.factory, timers },
		...(options.extensionFactories && { extensionFactories: options.extensionFactories }),
	});
	await loader.reload();

	const snapshots: SkillsChangedEvent[] = [];
	loader.getEventBus().on(SKILLS_CHANGED_CHANNEL, (data) => snapshots.push(data as SkillsChangedEvent));
	const changeEvents: ResourceLoaderChangeEvent[] = [];
	loader.onResourceChange((event) => changeEvents.push(event));

	const harness = await createHarness({ cwd, resourceLoader: loader, models: [{ id: "session-model" }] });
	cleanups.push(() => {
		harness.cleanup();
		loader.dispose();
		rmSync(cwd, { recursive: true, force: true });
	});
	return {
		harness,
		loader,
		settingsManager,
		factory,
		timers,
		snapshots,
		changeEvents,
		cwd,
		agentDir,
		skillsRoot,
		userCommandsRoot,
		projectCommandsRoot,
	};
}

function listingNames(session: Harness["session"]): string[] {
	const block = extractSkillListingBlock(session.systemPrompt);
	if (!block) return [];
	return [...block.matchAll(/<name>([^<]*)<\/name>/g)].map((match) => match[1]!);
}

describe("c4d live watching (AC1/AC2)", () => {
	it("reflects skill add/edit/delete in the listing, skill tool, namespace, and A.9 without /reload", async () => {
		const w = await createWatchHarness();
		const { session } = w.harness;

		// Start with an empty skills root: no skill tool, empty listing.
		w.harness.setResponses([fauxAssistantMessage("first")]);
		await session.prompt("one");
		expect(listingNames(session)).toEqual([]);
		expect(session.getActiveToolNames()).not.toContain("skill");

		// Add a skill mid-session.
		writeSkill(join(w.skillsRoot, "alpha"), "alpha");
		w.factory.emit(w.skillsRoot, "alpha");
		w.timers.flush();

		expect(w.changeEvents.some((event) => event.kind === "refresh")).toBe(true);
		expect(w.harness.eventsOfType("resources_changed")).toHaveLength(1);
		expect(w.snapshots).toHaveLength(1);
		expect(w.snapshots[0]!.skills.map((entry) => entry.name)).toEqual(["alpha"]);
		expect(w.snapshots[0]!.removed).toEqual([]);
		// Zero-crossing: the skill tool registered.
		expect(session.getActiveToolNames()).toContain("skill");

		w.harness.setResponses([fauxAssistantMessage("second")]);
		await session.prompt("two");
		expect(listingNames(session)).toEqual(["alpha"]);

		// Edit the description: the content change re-publishes.
		writeSkill(join(w.skillsRoot, "alpha"), "alpha", "alpha v2");
		w.factory.emit(join(w.skillsRoot, "alpha"), "SKILL.md");
		w.timers.flush();
		expect(w.snapshots).toHaveLength(2);
		w.harness.setResponses([fauxAssistantMessage("third")]);
		await session.prompt("three");
		expect(extractSkillListingBlock(session.systemPrompt)).toContain("alpha v2");

		// Delete the skill: it unregisters, with `removed` in the A.9 snapshot, and the
		// skill tool crosses back to zero.
		const alphaId = w.snapshots[0]!.skills[0]!.id;
		rmSync(join(w.skillsRoot, "alpha"), { recursive: true, force: true });
		w.factory.emit(w.skillsRoot, "alpha");
		w.timers.flush();
		expect(w.snapshots).toHaveLength(3);
		expect(w.snapshots[2]!.removed).toEqual([alphaId]);
		expect(session.getActiveToolNames()).not.toContain("skill");
		w.harness.setResponses([fauxAssistantMessage("fourth")]);
		await session.prompt("four");
		expect(listingNames(session)).toEqual([]);

		// /reload still works afterwards.
		await session.reload();
		expect(w.loader.getSkills().skills).toEqual([]);
	});

	it("watches both command roots; a command-only change refreshes the namespace without a skills:changed event", async () => {
		const w = await createWatchHarness();
		const { session } = w.harness;

		// User commands root (not yet created: the watcher covers the nearest existing
		// ancestor first, then re-syncs onto the new directory).
		mkdirSync(w.userCommandsRoot, { recursive: true });
		w.factory.emit(w.agentDir, "commands");
		w.timers.flush();
		writeFileSync(join(w.userCommandsRoot, "user-cmd.md"), "User command body");
		w.factory.emit(w.userCommandsRoot, "user-cmd.md");
		w.timers.flush();
		expect(session.getCommands().map((command) => command.name)).toContain("user-cmd");
		expect(w.snapshots).toEqual([]); // command-only change: no A.9 publish
		expect(w.harness.eventsOfType("resources_changed")).toHaveLength(1);

		// Trust-gated project commands root (same ancestor re-anchor flow).
		mkdirSync(w.projectCommandsRoot, { recursive: true });
		w.factory.emit(join(w.cwd, ".pi"), "commands");
		w.timers.flush();
		writeFileSync(join(w.projectCommandsRoot, "proj-cmd.md"), "Project command body");
		w.factory.emit(w.projectCommandsRoot, "proj-cmd.md");
		w.timers.flush();
		expect(session.getCommands().map((command) => command.name)).toContain("proj-cmd");

		// Edit + delete flow through the same seam.
		writeFileSync(join(w.userCommandsRoot, "user-cmd.md"), "User command v2");
		w.factory.emit(w.userCommandsRoot, "user-cmd.md");
		w.timers.flush();
		expect(session.getCommands().find((command) => command.name === "user-cmd")).toBeDefined();
		rmSync(join(w.userCommandsRoot, "user-cmd.md"));
		w.factory.emit(w.userCommandsRoot, "user-cmd.md");
		w.timers.flush();
		expect(session.getCommands().map((command) => command.name)).not.toContain("user-cmd");
	});

	it("reflects a command argument-hint-only edit live (coalescing compares argumentHint/frontmatter)", async () => {
		const w = await createWatchHarness();
		const { session } = w.harness;

		mkdirSync(w.userCommandsRoot, { recursive: true });
		w.factory.emit(w.agentDir, "commands");
		w.timers.flush();
		// Body is identical across the edit; only the `argument-hint` frontmatter changes,
		// so name/description/body stay byte-identical and only the coalescing equality's
		// argumentHint/frontmatter comparison can catch it.
		const body = "---\nargument-hint: <old>\n---\nHint command body";
		writeFileSync(join(w.userCommandsRoot, "hint-cmd.md"), body);
		w.factory.emit(w.userCommandsRoot, "hint-cmd.md");
		w.timers.flush();
		expect(session.getCommands().find((command) => command.name === "hint-cmd")?.argumentHint).toBe("<old>");

		const eventsBefore = w.harness.eventsOfType("resources_changed").length;
		writeFileSync(join(w.userCommandsRoot, "hint-cmd.md"), "---\nargument-hint: <new>\n---\nHint command body");
		w.factory.emit(w.userCommandsRoot, "hint-cmd.md");
		w.timers.flush();

		// Pre-fix this refresh coalesced (argumentHint uncompared): stale hint, no event.
		expect(session.getCommands().find((command) => command.name === "hint-cmd")?.argumentHint).toBe("<new>");
		expect(w.harness.eventsOfType("resources_changed").length).toBe(eventsBefore + 1);
	});

	it("deleting a collision winner surfaces the survivor under the bare name and keeps its ID-keyed visibility state", async () => {
		const w = await createWatchHarness();
		const { session } = w.harness;
		// Project skill wins the bare name over the user skill (precedence order).
		writeSkill(join(w.skillsRoot, "deploy"), "deploy", "project deploy");
		const userSkillDir = join(w.agentDir, "skills", "deploy");
		writeSkill(userSkillDir, "deploy", "user deploy");
		w.factory.emit(w.skillsRoot, "deploy");
		w.factory.emit(join(w.agentDir, "skills"), "deploy");
		w.timers.flush();

		expect(w.loader.getSkills().skills.map((skill) => skill.description)).toEqual(["project deploy"]);

		// ID-keyed visibility state on the (currently shadowed) survivor (canonical path key).
		const survivorId = canonicalizePath(join(userSkillDir, "SKILL.md"));
		w.harness.settingsManager.setSkillVisibilityState(survivorId, "name-only", "project");

		// Delete the winner: the survivor registers under the bare name.
		rmSync(join(w.skillsRoot, "deploy"), { recursive: true, force: true });
		w.factory.emit(w.skillsRoot, "deploy");
		w.timers.flush();

		expect(w.loader.getSkills().skills.map((skill) => skill.description)).toEqual(["user deploy"]);
		expect(session.getCommands().map((command) => command.name)).toContain("deploy");
		const row = session.getSkillsManagementView().find((entry) => entry.id === survivorId);
		expect(row?.state).toBe("name-only");
		expect(row?.effective.model).toBe("name");
	});
});

describe("c4d collision re-emit split (AC4)", () => {
	it("re-emits on /reload unconditionally but dedups unchanged content on the watcher path", async () => {
		const w = await createWatchHarness();
		const { session } = w.harness;
		// A skill sharing a name with a built-in creates a registry collision.
		writeSkill(join(w.skillsRoot, "model"), "model");
		w.factory.emit(w.skillsRoot, "model");
		w.timers.flush();

		const errors: string[] = [];
		await session.bindExtensions({ onError: (error) => errors.push(error.error) });
		const collisionErrors = () => errors.filter((error) => error.includes("command namespace collisions"));

		// The watcher refresh that introduced the collision emitted it once (changed content).
		expect(collisionErrors()).toHaveLength(1);

		// A no-op watcher cycle (no semantic change) emits nothing.
		w.factory.emit(w.skillsRoot, "model");
		w.timers.flush();
		expect(collisionErrors()).toHaveLength(1);

		// A semantic change with unchanged collision content still dedups.
		writeSkill(join(w.skillsRoot, "other"), "other");
		w.factory.emit(w.skillsRoot, "other");
		w.timers.flush();
		expect(collisionErrors()).toHaveLength(1);

		// /reload re-emits unconditionally, twice in a row.
		await session.reload();
		expect(collisionErrors()).toHaveLength(2);
		await session.reload();
		expect(collisionErrors()).toHaveLength(3);
	});
});

describe("c4d boundary negatives (AC6)", () => {
	it("a light refresh performs no extension reload and no session lifecycle events", async () => {
		let factoryRuns = 0;
		const lifecycle: string[] = [];
		const extension: InlineExtension = (pi) => {
			factoryRuns++;
			pi.on("session_start", async (event) => {
				lifecycle.push(`start:${event.reason}`);
			});
			pi.on("session_shutdown", async (event) => {
				lifecycle.push(`shutdown:${event.reason}`);
			});
		};
		const w = await createWatchHarness({ extensionFactories: [extension] });
		const { session } = w.harness;
		expect(factoryRuns).toBe(1);

		await session.bindExtensions({ onError: () => {} });
		expect(lifecycle).toEqual(["start:startup"]);

		// The settings surface is not re-read by a watcher-driven refresh.
		const settingsReloads = vi.spyOn(w.settingsManager, "reload");
		writeSkill(join(w.skillsRoot, "alpha"), "alpha");
		w.factory.emit(w.skillsRoot, "alpha");
		w.timers.flush();

		expect(factoryRuns).toBe(1); // no extension reload
		expect(lifecycle).toEqual(["start:startup"]); // no shutdown/start round-trip
		expect(settingsReloads).not.toHaveBeenCalled();
		expect(w.loader.getSkills().skills.map((skill) => skill.name)).toEqual(["alpha"]);

		// /reload remains the full path.
		await session.reload();
		expect(factoryRuns).toBe(2);
		expect(lifecycle).toEqual(["start:startup", "shutdown:reload", "start:reload"]);
	});
});

describe("c4d convergence and health (AC1/AC4/AC6)", () => {
	it("a nested root registered during a paused reload() lands in the final snapshot with no further tool touch, and every intermediate publish is complete", async () => {
		const w = await createWatchHarness();
		// Nested root on disk before the reload starts.
		const nestedRoot = join(w.cwd, "apps", "web", ".pi", "skills");
		writeSkill(join(nestedRoot, "pair"), "pair");
		const touched = join(w.cwd, "apps", "web", "src", "index.ts");
		mkdirSync(join(w.cwd, "apps", "web", "src"), { recursive: true });
		writeFileSync(touched, "export {};\n");

		// Atomicity probe: every published snapshot must match the loader's live state.
		const torn: string[] = [];
		w.loader.getEventBus().on(SKILLS_CHANGED_CHANNEL, (data) => {
			const snapshot = data as SkillsChangedEvent;
			const liveIds = w.loader
				.getSkills()
				.skills.map((skill) => skill.id ?? skill.filePath)
				.sort();
			const publishedIds = snapshot.skills.map((entry) => entry.id).sort();
			if (JSON.stringify(liveIds) !== JSON.stringify(publishedIds)) {
				torn.push(`rev ${snapshot.revision}`);
			}
		});

		// Pause reload() at its first await (settingsManager.reload).
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.spyOn(w.settingsManager, "reload").mockImplementationOnce(() => gate);
		const reloadPromise = w.loader.reload();

		// During the pause: nested registration plus a watcher-driven light refresh.
		w.loader.discoverNestedSkillRoots?.(touched);
		w.loader.refreshSkillsAndCommands?.();
		expect(w.loader.getSkills().skills.map((skill) => skill.name)).toEqual(["pair"]);

		release();
		await reloadPromise;

		// The final snapshot includes the nested root — no additional tool touch.
		expect(w.loader.getSkills().skills.map((skill) => skill.name)).toEqual(["pair"]);
		expect(torn).toEqual([]);
		const finalSnapshot = w.snapshots[w.snapshots.length - 1]!;
		expect(finalSnapshot.skills.map((entry) => entry.name)).toEqual(["pair"]);
	});

	it("replays degraded watcher-health to a late subscriber exactly once and clears it on recovery", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-c4d-late-"));
		cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
		const agentDir = join(cwd, "agent-home");
		mkdirSync(join(cwd, ".pi", "skills"), { recursive: true });
		const settingsManager = SettingsManager.inMemory();
		const factory = new FakeWatchFactory();
		const timers = new ManualTimers();
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			watchOptions: { watch: factory.factory, timers },
		});
		cleanups.push(() => loader.dispose());
		await loader.reload();

		// The watch fails BEFORE any session subscribes.
		factory.fail(join(cwd, ".pi", "skills"));

		const harness = await createHarness({ cwd, resourceLoader: loader, models: [{ id: "session-model" }] });
		cleanups.push(() => harness.cleanup());
		const errors: string[] = [];
		// Registration replayed the health into the pre-listener buffer; binding flushes it once.
		await harness.session.bindExtensions({ onError: (error) => errors.push(error.error) });
		const healthErrors = () => errors.filter((error) => error.includes("watching degraded"));
		expect(healthErrors()).toHaveLength(1);

		// Recovery: the retry reattaches, reconciles, and clears — no second emission.
		timers.flush();
		expect(healthErrors()).toHaveLength(1);
	});

	it("degrades to /reload-only on watcher failure (one diagnostic + scheduled retry, no publication), and /reload recovers", async () => {
		const w = await createWatchHarness();
		const { session } = w.harness;
		const errors: string[] = [];
		await session.bindExtensions({ onError: (error) => errors.push(error.error) });

		// The skills-root watch dies and stays dead (reattach fails too).
		w.factory.failDirs.add(w.skillsRoot);
		w.factory.fail(w.skillsRoot);
		expect(errors.filter((error) => error.includes("watching degraded"))).toHaveLength(1);
		expect(w.timers.pendingCount).toBeGreaterThan(0); // retry scheduled

		// A disk change while dead produces no publication.
		writeSkill(join(w.skillsRoot, "late"), "late");
		expect(w.snapshots).toEqual([]);
		expect(w.loader.getSkills().skills).toEqual([]);

		// Explicit /reload restores the on-disk state.
		await session.reload();
		expect(w.loader.getSkills().skills.map((skill) => skill.name)).toEqual(["late"]);
	});
});

describe("c4d package-manager root retention", () => {
	it("retains a configured but not-yet-existing skill root and picks up a SKILL.md created under it", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-c4d-roots-"));
		cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
		const agentDir = join(cwd, "agent-home");
		mkdirSync(agentDir, { recursive: true });
		// A settings-configured skill root that does not exist yet (global settings file).
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ skills: ["empty-root"] }));
		const configuredRoot = join(agentDir, "empty-root");

		const settingsManager = SettingsManager.create(cwd, agentDir);
		const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
		cleanups.push(() => loader.dispose());
		await loader.reload();

		// The empty/missing root survives the leaf collapse and is watchable.
		expect(loader.getScannedSkillRoots?.().map((root) => root.dir)).toContain(configuredRoot);
		expect(loader.getSkills().skills).toEqual([]);

		writeSkill(join(configuredRoot, "later"), "later");
		loader.refreshSkillsAndCommands?.();
		expect(loader.getSkills().skills.map((skill) => skill.name)).toEqual(["later"]);
	});
});

describe("c4d nested discovery end-to-end (AC3)", () => {
	it("a tool touch registers the nested root: qualified collision name, variant note, watcher-tracked deletion", async () => {
		const w = await createWatchHarness();
		const { session } = w.harness;
		writeSkill(join(w.skillsRoot, "deploy"), "deploy", "incumbent deploy");
		const nestedRoot = join(w.cwd, "apps", "web", ".pi", "skills");
		writeSkill(join(nestedRoot, "deploy"), "deploy", "nested deploy");
		writeSkill(join(nestedRoot, "preview"), "preview");
		const touched = join(w.cwd, "apps", "web", "src", "index.ts");
		mkdirSync(join(w.cwd, "apps", "web", "src"), { recursive: true });
		writeFileSync(touched, "export {};\n");

		// A name-agnostic single-file touch (`read` here; any single-file tool qualifies)
		// under apps/web discovers the nested root mid-session.
		w.harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "apps/web/src/index.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("touched"),
		]);
		await session.prompt("touch it");

		expect(
			w.loader
				.getSkills()
				.skills.map((skill) => skill.listingName)
				.sort(),
		).toEqual(["apps/web:deploy", "deploy", "preview"]);
		expect(w.changeEvents.some((event) => event.kind === "refresh")).toBe(true);
		expect(
			w.snapshots
				.at(-1)!
				.skills.map((entry) => entry.listingName)
				.sort(),
		).toEqual(["apps/web:deploy", "deploy", "preview"]);
		// The /name namespace registers the qualified form.
		expect(session.getCommands().map((command) => command.name)).toContain("apps/web:deploy");

		// The next prompt's model-facing listing carries both collide-ees.
		w.harness.setResponses([fauxAssistantMessage("listed")]);
		await session.prompt("next");
		expect(listingNames(session).sort()).toEqual(["apps/web:deploy", "deploy", "preview"]);

		// Bare /deploy invokes the incumbent and carries the variant note (A.1).
		w.harness.setResponses([fauxAssistantMessage("invoked")]);
		await session.prompt("/deploy");
		const userTexts = getUserTexts(w.harness);
		expect(userTexts.some((text) => text.includes("Body of deploy."))).toBe(true);
		expect(userTexts.some((text) => text.includes("/apps/web:deploy"))).toBe(true);

		// Deleting the nested root unregisters it through the watcher, with `removed` in A.9.
		const nestedIds = w.snapshots
			.at(-1)!
			.skills.filter((entry) => entry.baseDir.startsWith(nestedRoot))
			.map((entry) => entry.id);
		expect(nestedIds).toHaveLength(2);
		rmSync(join(w.cwd, "apps", "web", ".pi"), { recursive: true, force: true });
		w.factory.emit(nestedRoot, null);
		w.factory.emit(join(w.cwd, "apps", "web"), ".pi");
		w.timers.flush();
		expect(w.loader.getSkills().skills.map((skill) => skill.listingName)).toEqual(["deploy"]);
		expect([...w.snapshots.at(-1)!.removed].sort()).toEqual(nestedIds.sort());
	});
});

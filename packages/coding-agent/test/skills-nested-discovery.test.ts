import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResourceLoaderChangeEvent } from "../src/core/resource-loader.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
	deriveNestedQualifier,
	findNestedSkillRootCandidates,
	scanNestedSkillRoot,
} from "../src/core/skills/nested-discovery.ts";
import { SKILLS_CHANGED_CHANNEL, type SkillsChangedEvent } from "../src/core/skills/skill-set-events.ts";
import { loadSkills } from "../src/core/skills.ts";
import { canonicalizePath } from "../src/utils/paths.ts";

/**
 * c4d nested/monorepo discovery (A.6), pure + loader level: ancestor-walk
 * bounds, trust gating, dir-qualified collision naming, and the staged
 * transaction (zero A.9/resource publications on scan failure).
 */

let tempDirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-nested-discovery-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// chmod'ed fixtures may need a permission restore before removal on some platforms.
			chmodSync(dir, 0o755);
			rmSync(dir, { recursive: true, force: true });
		}
	}
	tempDirs = [];
});

function writeSkill(dir: string, name: string, description = `${name} description`): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nBody of ${name}.\n`);
}

describe("findNestedSkillRootCandidates", () => {
	it("returns nothing for a file at cwd level", () => {
		const cwd = tempDir();
		writeSkill(join(cwd, ".pi", "skills", "root-skill"), "root-skill");
		const file = join(cwd, "top.ts");
		writeFileSync(file, "export {};\n");
		const candidates = findNestedSkillRootCandidates({ touchedFile: file, cwd, isAlreadyScanned: () => false });
		expect(candidates).toEqual([]);
	});

	it("never scans above cwd", () => {
		const cwd = tempDir();
		const outside = tempDir();
		writeSkill(join(outside, ".pi", "skills", "outside-skill"), "outside-skill");
		const file = join(outside, "src", "foo.ts");
		mkdirSync(join(outside, "src"), { recursive: true });
		writeFileSync(file, "export {};\n");
		const candidates = findNestedSkillRootCandidates({ touchedFile: file, cwd, isAlreadyScanned: () => false });
		expect(candidates).toEqual([]);
	});

	it("detects .pi/skills and .agents/skills roots between cwd and the file with the A.6 qualifier", () => {
		const cwd = tempDir();
		writeSkill(join(cwd, "apps", "web", ".pi", "skills", "deploy"), "deploy");
		writeSkill(join(cwd, "apps", "lib", ".agents", "skills", "lint"), "lint");
		const file = join(cwd, "apps", "web", "src", "index.ts");
		mkdirSync(join(cwd, "apps", "web", "src"), { recursive: true });
		writeFileSync(file, "export {};\n");

		const candidates = findNestedSkillRootCandidates({ touchedFile: file, cwd, isAlreadyScanned: () => false });
		expect(candidates).toEqual([{ root: join(cwd, "apps", "web", ".pi", "skills"), qualifier: "apps/web" }]);

		const libFile = join(cwd, "apps", "lib", "src", "index.ts");
		mkdirSync(join(cwd, "apps", "lib", "src"), { recursive: true });
		writeFileSync(libFile, "export {};\n");
		expect(findNestedSkillRootCandidates({ touchedFile: libFile, cwd, isAlreadyScanned: () => false })).toEqual([
			{ root: join(cwd, "apps", "lib", ".agents", "skills"), qualifier: "apps/lib" },
		]);
	});

	it("skips already-scanned roots (canonical-path comparison)", () => {
		const cwd = tempDir();
		writeSkill(join(cwd, "pkg", ".pi", "skills", "deploy"), "deploy");
		const file = join(cwd, "pkg", "src", "index.ts");
		mkdirSync(join(cwd, "pkg", "src"), { recursive: true });
		writeFileSync(file, "export {};\n");
		const scanned = new Set([canonicalizePath(join(cwd, "pkg", ".pi", "skills"))]);
		expect(
			findNestedSkillRootCandidates({ touchedFile: file, cwd, isAlreadyScanned: (root) => scanned.has(root) }),
		).toEqual([]);
	});

	it("dedupes symlinked roots by canonical path", () => {
		const base = tempDir();
		const real = join(base, "real");
		writeSkill(join(real, "pkg", ".pi", "skills", "deploy"), "deploy");
		const link = join(base, "link");
		symlinkSync(real, link);
		const file = join(link, "pkg", "src", "index.ts");
		mkdirSync(join(real, "pkg", "src"), { recursive: true });
		writeFileSync(join(real, "pkg", "src", "index.ts"), "export {};\n");

		const seen: string[] = [];
		const candidates = findNestedSkillRootCandidates({
			touchedFile: file,
			cwd: link,
			isAlreadyScanned: (canonicalRoot) => {
				seen.push(canonicalRoot);
				return false;
			},
		});
		expect(candidates).toHaveLength(1);
		expect(seen).toEqual([canonicalizePath(join(real, "pkg", ".pi", "skills"))]);
		expect(candidates[0]!.qualifier).toBe("pkg");
	});

	it("never matches under a .claude directory (ADR-0002)", () => {
		const cwd = tempDir();
		writeSkill(join(cwd, ".claude", "skills", "nope"), "nope");
		writeSkill(join(cwd, "pkg", ".pi", "skills", "deploy"), "deploy");
		const claudeFile = join(cwd, ".claude", "settings.json");
		mkdirSync(join(cwd, ".claude"), { recursive: true });
		writeFileSync(claudeFile, "{}\n");
		// A touch inside .claude walks no ancestors.
		expect(findNestedSkillRootCandidates({ touchedFile: claudeFile, cwd, isAlreadyScanned: () => false })).toEqual(
			[],
		);
	});

	it("ignores a candidate root that does not exist on disk", () => {
		const cwd = tempDir();
		const file = join(cwd, "pkg", "src", "index.ts");
		mkdirSync(join(cwd, "pkg", "src"), { recursive: true });
		writeFileSync(file, "export {};\n");
		expect(findNestedSkillRootCandidates({ touchedFile: file, cwd, isAlreadyScanned: () => false })).toEqual([]);
	});
});

describe("deriveNestedQualifier", () => {
	it("derives the root's containing package dir relative to cwd, posixified", () => {
		const cwd = join(tmpdir(), "mono");
		expect(deriveNestedQualifier(join(cwd, "apps", "web", ".pi", "skills"), cwd)).toBe("apps/web");
		expect(deriveNestedQualifier(join(cwd, "apps", "web", ".agents", "skills"), cwd)).toBe("apps/web");
	});

	it("falls back to the package dir basename when the root sits at cwd level", () => {
		const cwd = join(tmpdir(), "mono");
		expect(deriveNestedQualifier(join(cwd, ".pi", "skills"), cwd)).toBe("mono");
	});
});

describe("scanNestedSkillRoot", () => {
	it("scans a readable root with project-scope source info", () => {
		const root = join(tempDir(), ".pi", "skills");
		writeSkill(join(root, "deploy"), "deploy");
		const result = scanNestedSkillRoot(root);
		expect(result.error).toBeUndefined();
		expect(result.skills.map((skill) => skill.name)).toEqual(["deploy"]);
		expect(result.skills[0]!.sourceInfo.scope).toBe("project");
	});

	it("signals an error for a nonexistent root (not an empty result)", () => {
		const result = scanNestedSkillRoot(join(tempDir(), ".pi", "skills"));
		expect(result.error).toBeDefined();
		expect(result.skills).toEqual([]);
	});

	it("signals an error when the root path is a file", () => {
		const dir = tempDir();
		const file = join(dir, "skills");
		writeFileSync(file, "not a directory\n");
		const result = scanNestedSkillRoot(file);
		expect(result.error).toBeDefined();
		expect(result.skills).toEqual([]);
	});

	it("signals an error for a partially-readable root (unreadable subdirectory)", () => {
		const root = join(tempDir(), ".pi", "skills");
		mkdirSync(join(root, "blocked"), { recursive: true });
		writeSkill(join(root, "ok"), "ok");
		chmodSync(join(root, "blocked"), 0o000);
		try {
			const result = scanNestedSkillRoot(root);
			expect(result.error).toBeDefined();
			expect(result.error).toContain("partially readable");
			expect(result.skills).toEqual([]);
		} finally {
			chmodSync(join(root, "blocked"), 0o755);
		}
	});
});

describe("loadSkills qualifiedRoots (Blocking dedup seam)", () => {
	it("keeps both collide-ees: the incumbent under the bare name, the nested one dir-qualified", () => {
		const cwd = tempDir();
		const agentDir = tempDir();
		writeSkill(join(cwd, ".pi", "skills", "deploy"), "deploy", "incumbent");
		const nestedRoot = join(cwd, "apps", "web", ".pi", "skills");
		writeSkill(join(nestedRoot, "deploy"), "deploy", "nested");

		const result = loadSkills({
			cwd,
			agentDir,
			skillPaths: [join(cwd, ".pi", "skills"), nestedRoot],
			includeDefaults: false,
			qualifiedRoots: [{ root: nestedRoot, qualifier: "apps/web" }],
		});

		expect(result.skills).toHaveLength(2);
		const byListing = new Map(result.skills.map((skill) => [skill.listingName, skill]));
		expect(byListing.get("deploy")?.description).toBe("incumbent");
		expect(byListing.get("apps/web:deploy")?.description).toBe("nested");
		// No loser-drop diagnostic: both participants survived.
		expect(result.diagnostics.filter((d) => d.type === "collision")).toEqual([]);
	});

	it("falls back to loser-drop + collision diagnostic when the qualified name is still colliding", () => {
		const cwd = tempDir();
		const agentDir = tempDir();
		writeSkill(join(cwd, ".pi", "skills", "deploy"), "deploy", "incumbent");
		const nestedA = join(cwd, "apps", "web", ".pi", "skills");
		const nestedB = join(cwd, "apps", "lib", ".pi", "skills");
		writeSkill(join(nestedA, "deploy"), "deploy", "nested A");
		writeSkill(join(nestedB, "deploy"), "deploy", "nested B");

		const result = loadSkills({
			cwd,
			agentDir,
			skillPaths: [join(cwd, ".pi", "skills"), nestedA, nestedB],
			includeDefaults: false,
			// Both nested roots derive the same qualifier: the second qualified name collides.
			qualifiedRoots: [
				{ root: nestedA, qualifier: "apps/web" },
				{ root: nestedB, qualifier: "apps/web" },
			],
		});

		const byListing = new Map(result.skills.map((skill) => [skill.listingName, skill]));
		expect(byListing.get("deploy")?.description).toBe("incumbent");
		expect(byListing.get("apps/web:deploy")?.description).toBe("nested A");
		expect(result.skills).toHaveLength(2);
		expect(result.diagnostics.some((d) => d.type === "collision" && d.message.includes('"deploy"'))).toBe(true);
	});

	it("keeps today's loser-drop when no qualified root covers the colliding skill", () => {
		const cwd = tempDir();
		const agentDir = tempDir();
		writeSkill(join(cwd, ".pi", "skills", "deploy"), "deploy", "project skill");
		const other = join(tempDir(), "skills");
		writeSkill(join(other, "deploy"), "deploy", "other skill");

		const result = loadSkills({
			cwd,
			agentDir,
			skillPaths: [join(cwd, ".pi", "skills"), other],
			includeDefaults: false,
		});

		expect(result.skills).toHaveLength(1);
		expect(result.skills[0]!.description).toBe("project skill");
		expect(result.diagnostics.some((d) => d.type === "collision")).toBe(true);
	});
});

describe("DefaultResourceLoader nested registration (staged transaction)", () => {
	beforeEach(() => {
		// Keep the real ~/.agents/skills out of the loaders under test.
		vi.stubEnv("HOME", mkdtempSync(join(tmpdir(), "pi-nested-home-")));
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function makeLoader(cwd: string, agentDir: string, trusted: boolean) {
		const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: trusted });
		const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
		const events: ResourceLoaderChangeEvent[] = [];
		loader.onResourceChange((event) => events.push(event));
		const snapshots: SkillsChangedEvent[] = [];
		return { loader, settingsManager, events, snapshots };
	}

	it("registers a nested root on a tool touch: collision-conditional qualified name, A.9 snapshot, watcher coverage", async () => {
		const cwd = tempDir();
		const agentDir = tempDir();
		writeSkill(join(cwd, ".pi", "skills", "deploy"), "deploy", "incumbent");
		const nestedRoot = join(cwd, "apps", "web", ".pi", "skills");
		writeSkill(join(nestedRoot, "deploy"), "deploy", "nested");
		writeSkill(join(nestedRoot, "preview"), "preview");
		const touched = join(cwd, "apps", "web", "src", "index.ts");
		mkdirSync(join(cwd, "apps", "web", "src"), { recursive: true });
		writeFileSync(touched, "export {};\n");

		const { loader, events, snapshots } = makeLoader(cwd, agentDir, true);
		await loader.reload();
		loader.getEventBus?.().on(SKILLS_CHANGED_CHANNEL, (data) => snapshots.push(data as SkillsChangedEvent));

		// The nested root is unscanned until touched.
		expect(loader.getSkills().skills.map((skill) => skill.listingName ?? skill.name)).toEqual(["deploy"]);
		loader.discoverNestedSkillRoots?.(touched);

		const names = loader
			.getSkills()
			.skills.map((skill) => skill.listingName ?? skill.name)
			.sort();
		expect(names).toEqual(["apps/web:deploy", "deploy", "preview"]);
		expect(events.some((event) => event.kind === "refresh")).toBe(true);
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]!.removed).toEqual([]);
		expect(snapshots[0]!.skills.map((entry) => entry.listingName).sort()).toEqual([
			"apps/web:deploy",
			"deploy",
			"preview",
		]);
		// The nested skills carry the intentional project scope, not a "path" fallback.
		const nestedEntry = snapshots[0]!.skills.find((entry) => entry.listingName === "apps/web:deploy");
		expect(nestedEntry?.source.scope).toBe("project");
		// The new root joined the scanned set (watcher coverage + already-scanned check).
		expect(loader.getScannedSkillRoots?.().map((root) => root.dir)).toContain(nestedRoot);

		// A second touch does not re-scan (tracked).
		loader.discoverNestedSkillRoots?.(touched);
		expect(snapshots).toHaveLength(1);
		loader.dispose?.();
	});

	it("does not discover when the project is untrusted", async () => {
		const cwd = tempDir();
		const agentDir = tempDir();
		const nestedRoot = join(cwd, "apps", "web", ".pi", "skills");
		writeSkill(join(nestedRoot, "deploy"), "deploy");
		const touched = join(cwd, "apps", "web", "src", "index.ts");
		mkdirSync(join(cwd, "apps", "web", "src"), { recursive: true });
		writeFileSync(touched, "export {};\n");

		const { loader, events, snapshots } = makeLoader(cwd, agentDir, false);
		await loader.reload();
		loader.getEventBus?.().on(SKILLS_CHANGED_CHANNEL, (data) => snapshots.push(data as SkillsChangedEvent));
		loader.discoverNestedSkillRoots?.(touched);
		expect(loader.getSkills().skills).toEqual([]);
		expect(snapshots).toEqual([]);
		expect(events).toEqual([]);
		loader.dispose?.();
	});

	it("publishes zero A.9/resource-change events on a failed scan and retries on a later touch", async () => {
		const cwd = tempDir();
		const agentDir = tempDir();
		// A `.pi/skills` path that is a FILE: the scan fails with an explicit error signal.
		const nestedRoot = join(cwd, "apps", "web", ".pi", "skills");
		mkdirSync(join(cwd, "apps", "web", ".pi"), { recursive: true });
		writeFileSync(nestedRoot, "not a directory\n");
		const touched = join(cwd, "apps", "web", "src", "index.ts");
		mkdirSync(join(cwd, "apps", "web", "src"), { recursive: true });
		writeFileSync(touched, "export {};\n");

		const { loader, events, snapshots } = makeLoader(cwd, agentDir, true);
		await loader.reload();
		loader.getEventBus?.().on(SKILLS_CHANGED_CHANNEL, (data) => snapshots.push(data as SkillsChangedEvent));

		// findNestedSkillRootCandidates requires a directory; a file root is not a
		// candidate at all — use a partially-readable directory instead.
		rmSync(nestedRoot);
		mkdirSync(join(nestedRoot, "blocked"), { recursive: true });
		writeSkill(join(nestedRoot, "deploy"), "deploy");
		chmodSync(join(nestedRoot, "blocked"), 0o000);
		try {
			loader.discoverNestedSkillRoots?.(touched);
			expect(snapshots).toEqual([]);
			expect(events.filter((event) => event.kind === "refresh")).toEqual([]);
			const diagnostics = events.filter((event) => event.kind === "diagnostic");
			expect(diagnostics).toHaveLength(1);
			expect(loader.getSkills().skills).toEqual([]);
			expect(loader.getScannedSkillRoots?.().map((root) => root.dir)).not.toContain(nestedRoot);
		} finally {
			chmodSync(join(nestedRoot, "blocked"), 0o755);
		}

		// The root was not marked scanned: a later touch retries and registers.
		rmSync(join(nestedRoot, "blocked"), { recursive: true, force: true });
		loader.discoverNestedSkillRoots?.(touched);
		expect(loader.getSkills().skills.map((skill) => skill.name)).toEqual(["deploy"]);
		expect(snapshots).toHaveLength(1);
		loader.dispose?.();
	});

	it("isolates per-subscriber callback failures and replays current watcher-health to late subscribers", async () => {
		const cwd = tempDir();
		const agentDir = tempDir();
		const { loader } = makeLoader(cwd, agentDir, true);
		await loader.reload();

		// One throwing subscriber never blocks later subscribers.
		const received: string[] = [];
		const unsubscribeThrower = loader.onResourceChange?.(() => {
			throw new Error("listener boom");
		});
		const unsubscribeSecond = loader.onResourceChange?.((event) => received.push(event.kind));
		writeSkill(join(cwd, ".pi", "skills", "alpha"), "alpha");
		expect(() => loader.refreshSkillsAndCommands?.()).not.toThrow();
		expect(received).toEqual(["refresh"]);

		// Unsubscribe works.
		unsubscribeThrower?.();
		unsubscribeSecond?.();
		loader.refreshSkillsAndCommands?.();
		expect(received).toEqual(["refresh"]);
		loader.dispose?.();
	});
});

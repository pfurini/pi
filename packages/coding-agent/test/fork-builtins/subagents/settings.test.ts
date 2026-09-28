// Fork-owned: subagent settings under forkBuiltins.subagents (plan T2; the validated writer, T3). Old
// pi-subagents tests at 79a7c42 this covers: settings, agent-runner-settings, documented-defaults
// (the settings defaults).
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SUBAGENT_SETTINGS,
	readSubagentSettings,
	SUBAGENT_SETTING_KEYS,
	type SubagentSettings,
	sanitizeSubagentSettings,
	writeProjectSubagentSettings,
} from "../../../src/core/fork-builtins/subagents/settings/settings.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";

// A passthrough, so a case can make the atomic writer's rename fail.
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<{ renameSync: typeof renameSync }>();
	return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	vi.mocked(renameSync).mockClear();
});

function project(global: unknown, projectSettings: unknown): { agentDir: string; cwd: string } {
	const root = mkdtempSync(join(tmpdir(), "pi-subagent-settings-"));
	roots.push(root);
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	if (global !== undefined) writeFileSync(join(agentDir, "settings.json"), JSON.stringify(global));
	if (projectSettings !== undefined) writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify(projectSettings));
	return { agentDir, cwd };
}

const subagents = (values: Record<string, unknown>) => ({ forkBuiltins: { subagents: values } });

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("subagent settings", () => {
	it("merges the global values under the project values", () => {
		const { agentDir, cwd } = project(
			subagents({ maxConcurrent: 16, graceTurns: 10, defaultJoinMode: "async" }),
			subagents({ maxConcurrent: 4, reportUsage: true }),
		);
		const { settings, warnings } = readSubagentSettings(SettingsManager.create(cwd, agentDir));
		expect(warnings).toEqual([]);
		expect(settings).toEqual({
			...DEFAULT_SUBAGENT_SETTINGS,
			maxConcurrent: 4,
			graceTurns: 10,
			defaultJoinMode: "async",
			reportUsage: true,
		});
	});

	it("ignores the project values in an untrusted project", () => {
		const { agentDir, cwd } = project(subagents({ graceTurns: 10 }), subagents({ maxConcurrent: 4, graceTurns: 2 }));
		const manager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
		expect(readSubagentSettings(manager).settings).toEqual({ ...DEFAULT_SUBAGENT_SETTINGS, graceTurns: 10 });
	});

	it("documents each key's default and drops a value out of range or of the wrong type with one warning", () => {
		expect(DEFAULT_SUBAGENT_SETTINGS).toEqual({
			maxConcurrent: 10,
			maxConcurrentForeground: 0,
			defaultMaxTurns: 0,
			graceTurns: 5,
			defaultJoinMode: "smart",
			backgroundByDefault: true,
			scopeModels: false,
			strictAgentFiles: false,
			disableDefaultAgents: false,
			toolDescriptionMode: "full",
			fleetView: true,
			agentMentions: "model",
			rememberAgents: true,
			widgetMode: "background",
			outputTranscript: true,
			worktreeIsolation: true,
			maxSubagentDepth: 2,
			reportUsage: false,
			showCost: false,
			showModel: false,
			viewerMarkdown: "assistant",
		});
		expect([...SUBAGENT_SETTING_KEYS].sort()).toEqual(
			[...Object.keys(DEFAULT_SUBAGENT_SETTINGS), "fallbackSubagent"].sort(),
		);

		const bounds: Array<[string, number, number]> = [
			["maxConcurrent", 1, 1024],
			["maxConcurrentForeground", 0, 1024],
			["defaultMaxTurns", 0, 10_000],
			["graceTurns", 1, 1000],
			["maxSubagentDepth", 0, 16],
		];
		for (const [key, min, max] of bounds) {
			expect(sanitizeSubagentSettings({ [key]: min }, "global").values).toEqual({ [key]: min });
			expect(sanitizeSubagentSettings({ [key]: max }, "global").values).toEqual({ [key]: max });
			for (const bad of [min - 1, max + 1, 2.5, String(min)]) {
				const result = sanitizeSubagentSettings({ [key]: bad }, "project");
				expect(result.values).toEqual({});
				expect(result.warnings).toEqual([
					`forkBuiltins.subagents in the project settings.json: ${key} must be an integer from ${min} to ${max}; it is ignored.`,
				]);
			}
		}
		const enums: Array<[string, string[]]> = [
			["defaultJoinMode", ["async", "group", "smart"]],
			["toolDescriptionMode", ["full", "compact", "custom"]],
			["agentMentions", ["model", "direct", "off"]],
			["widgetMode", ["all", "background", "off"]],
			["viewerMarkdown", ["off", "assistant", "all"]],
		];
		for (const [key, values] of enums) {
			for (const value of values)
				expect(sanitizeSubagentSettings({ [key]: value }, "global").values).toEqual({ [key]: value });
			expect(sanitizeSubagentSettings({ [key]: "other" }, "global").warnings).toHaveLength(1);
		}
		expect(sanitizeSubagentSettings({ agentMentions: true }, "global").values).toEqual({});
		const booleans = SUBAGENT_SETTING_KEYS.filter(
			(key) => typeof DEFAULT_SUBAGENT_SETTINGS[key as keyof typeof DEFAULT_SUBAGENT_SETTINGS] === "boolean",
		);
		expect(booleans).toHaveLength(11);
		for (const key of booleans) {
			expect(sanitizeSubagentSettings({ [key]: false }, "global").values).toEqual({ [key]: false });
			expect(sanitizeSubagentSettings({ [key]: "false" }, "global").warnings).toHaveLength(1);
		}
		expect(sanitizeSubagentSettings({ fallbackSubagent: false }, "global").values).toEqual({
			fallbackSubagent: "none",
		});
		expect(sanitizeSubagentSettings({ fallbackSubagent: " reviewer " }, "global").values).toEqual({
			fallbackSubagent: "reviewer",
		});
		expect(sanitizeSubagentSettings({ fallbackSubagent: "" }, "global").warnings).toHaveLength(1);
		expect(sanitizeSubagentSettings({ workflowsEnabled: false, schedulingEnabled: true }, "global").warnings).toEqual(
			[
				"forkBuiltins.subagents in the global settings.json: unknown key workflowsEnabled; it is ignored.",
				"forkBuiltins.subagents in the global settings.json: unknown key schedulingEnabled; it is ignored.",
			],
		);
		expect(sanitizeSubagentSettings("fast", "global").warnings).toEqual([
			"forkBuiltins.subagents in the global settings.json must be an object; it is ignored.",
		]);
		expect(sanitizeSubagentSettings(JSON.parse('{"toString":1,"__proto__":2}'), "global").warnings).toEqual([
			"forkBuiltins.subagents in the global settings.json: unknown key toString; it is ignored.",
			"forkBuiltins.subagents in the global settings.json: unknown key __proto__; it is ignored.",
		]);
	});

	it("writes only forkBuiltins.subagents in the project settings.json", () => {
		const existing = {
			theme: "dark",
			enabledModels: ["anthropic/claude-sonnet-4-6"],
			forkBuiltins: { "pi-tokensave": { mode: "prefer" }, subagents: { maxConcurrent: 3, showCost: true } },
			packages: ["../x"],
		};
		const { agentDir, cwd } = project(subagents({ graceTurns: 9 }), existing);
		const globalBefore = readFileSync(join(agentDir, "settings.json"), "utf-8");
		writeProjectSubagentSettings(cwd, { maxConcurrent: 6, widgetMode: "all" });
		const written = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf-8"));
		expect(written.forkBuiltins.subagents).toEqual({ maxConcurrent: 6, widgetMode: "all" });
		const { forkBuiltins, ...rest } = written;
		const { forkBuiltins: existingForkBuiltins, ...existingRest } = existing;
		expect(rest).toEqual(existingRest);
		expect(forkBuiltins["pi-tokensave"]).toEqual(existingForkBuiltins["pi-tokensave"]);
		expect(readFileSync(join(agentDir, "settings.json"), "utf-8")).toBe(globalBefore);
		expect(readSubagentSettings(SettingsManager.create(cwd, agentDir)).settings).toMatchObject({
			maxConcurrent: 6,
			widgetMode: "all",
			graceTurns: 9,
			showCost: false,
		});

		// A byte-order mark, which core's own reader accepts, does not stop the write.
		writeFileSync(join(cwd, ".pi", "settings.json"), `\uFEFF${JSON.stringify({ theme: "light" })}`);
		writeProjectSubagentSettings(cwd, { showModel: true });
		expect(JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf-8"))).toEqual({
			theme: "light",
			...subagents({ showModel: true }),
		});

		const fresh = project(undefined, undefined);
		rmSync(join(fresh.cwd, ".pi"), { recursive: true });
		writeProjectSubagentSettings(fresh.cwd, { rememberAgents: false });
		expect(JSON.parse(readFileSync(join(fresh.cwd, ".pi", "settings.json"), "utf-8"))).toEqual(
			subagents({ rememberAgents: false }),
		);
	});

	it("refuses a value the reader would drop, naming its key, and leaves settings.json as it was", () => {
		const { cwd } = project(undefined, { theme: "dark", ...subagents({ maxConcurrent: 3 }) });
		const file = join(cwd, ".pi", "settings.json");
		const hash = sha(file);
		expect(() => writeProjectSubagentSettings(cwd, { maxConcurrent: 0 })).toThrow(
			/^Refusing to write subagent settings: .*maxConcurrent must be an integer from 1 to 1024\.$/,
		);
		expect(sha(file)).toBe(hash);
		const unknown = { unknownKey: 1 } as unknown as Partial<SubagentSettings>;
		expect(() => writeProjectSubagentSettings(cwd, unknown)).toThrow(/unknown key unknownKey/);
		expect(sha(file)).toBe(hash);
		writeProjectSubagentSettings(cwd, { maxConcurrent: 4 });
		expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({ theme: "dark", ...subagents({ maxConcurrent: 4 }) });
	});

	it("refuses to write through a symlinked .pi or settings.json, dangling or not", () => {
		const outside = mkdtempSync(join(tmpdir(), "pi-subagent-outside-"));
		roots.push(outside);
		const outsideFile = join(outside, "settings.json");
		writeFileSync(outsideFile, JSON.stringify({ theme: "outside" }));
		const hash = sha(outsideFile);
		const cases: Array<[string, (cwd: string) => void]> = [
			[".pi to a directory", (cwd) => symlinkSync(outside, join(cwd, ".pi"))],
			[".pi dangling", (cwd) => symlinkSync(join(outside, "missing"), join(cwd, ".pi"))],
			[
				"settings.json to a file",
				(cwd) => {
					mkdirSync(join(cwd, ".pi"));
					symlinkSync(outsideFile, join(cwd, ".pi", "settings.json"));
				},
			],
			[
				"settings.json dangling",
				(cwd) => {
					mkdirSync(join(cwd, ".pi"));
					symlinkSync(join(outside, "missing.json"), join(cwd, ".pi", "settings.json"));
				},
			],
		];
		for (const [name, plant] of cases) {
			const { cwd } = project(undefined, undefined);
			rmSync(join(cwd, ".pi"), { recursive: true });
			plant(cwd);
			expect(() => writeProjectSubagentSettings(cwd, { showCost: true }), name).toThrow(
				"Refusing to write subagent settings through a symlink",
			);
			expect(sha(outsideFile), name).toBe(hash);
			expect(existsSync(join(outside, "missing")), name).toBe(false);
			expect(existsSync(join(outside, "missing.json")), name).toBe(false);
		}
	});

	it("replaces an existing settings.json whole, and leaves it byte-identical when the rename fails", () => {
		const { cwd } = project(undefined, { theme: "dark", ...subagents({ maxConcurrent: 3 }) });
		const file = join(cwd, ".pi", "settings.json");
		const inode = statSync(file).ino;
		writeProjectSubagentSettings(cwd, { maxConcurrent: 5 });
		expect(statSync(file).ino).not.toBe(inode);
		expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({ theme: "dark", ...subagents({ maxConcurrent: 5 }) });

		const hash = sha(file);
		vi.mocked(renameSync).mockImplementationOnce(() => {
			throw new Error("rename failed");
		});
		expect(() => writeProjectSubagentSettings(cwd, { maxConcurrent: 6 })).toThrow("rename failed");
		expect(sha(file)).toBe(hash);
		expect(readdirSync(join(cwd, ".pi"))).toEqual(["settings.json"]);

		const fresh = project(undefined, undefined);
		writeProjectSubagentSettings(fresh.cwd, { showModel: true });
		expect(JSON.parse(readFileSync(join(fresh.cwd, ".pi", "settings.json"), "utf-8"))).toEqual(
			subagents({ showModel: true }),
		);
	});
});

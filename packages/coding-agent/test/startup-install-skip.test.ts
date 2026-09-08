import type * as ChildProcess from "node:child_process";
import type * as Fs from "node:fs";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { isOfflineModeEnabled, isStartupInstallSkipped } from "../src/utils/startup-network.ts";
import { ensureTool, type ToolStatus } from "../src/utils/tools-manager.ts";
import { getLatestPiRelease } from "../src/utils/version-check.ts";
import { allowNetwork } from "./test-network-env.ts";

// PI_SKIP_STARTUP_INSTALL=1 skips the startup operations that write code or
// caches (package installs and update checks, tool downloads, the pi
// version check) while leaving the model catalog refresh on. PI_OFFLINE
// keeps skipping everything. pi-fence sets the new variable inside its
// sandbox, where those writes are denied but the catalog refresh is wanted.

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof Fs>();
	return {
		...actual,
		existsSync: vi.fn(() => false),
	};
});

vi.mock("child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof ChildProcess>();
	return {
		...actual,
		spawnSync: vi.fn(() => ({ error: new Error("not found") })),
	};
});

const originalOffline = process.env.PI_OFFLINE;
const originalSkip = process.env.PI_SKIP_STARTUP_INSTALL;

function restore(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

beforeEach(() => {
	delete process.env.PI_OFFLINE;
	delete process.env.PI_SKIP_STARTUP_INSTALL;
	allowNetwork();
});

afterEach(() => {
	restore("PI_OFFLINE", originalOffline);
	restore("PI_SKIP_STARTUP_INSTALL", originalSkip);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("startup network switches", () => {
	it("parses 1, true and yes for both variables and nothing else", () => {
		for (const value of ["1", "true", "TRUE", "yes"]) {
			process.env.PI_SKIP_STARTUP_INSTALL = value;
			expect(isStartupInstallSkipped()).toBe(true);
			delete process.env.PI_SKIP_STARTUP_INSTALL;
			process.env.PI_OFFLINE = value;
			expect(isOfflineModeEnabled()).toBe(true);
			expect(isStartupInstallSkipped()).toBe(true);
			delete process.env.PI_OFFLINE;
		}
		for (const value of ["0", "", "no"]) {
			process.env.PI_SKIP_STARTUP_INSTALL = value;
			expect(isStartupInstallSkipped()).toBe(false);
		}
		expect(isOfflineModeEnabled()).toBe(false);
	});

	it("PI_SKIP_STARTUP_INSTALL alone is not offline mode, so the model catalog refresh stays on", () => {
		process.env.PI_SKIP_STARTUP_INSTALL = "1";
		expect(isStartupInstallSkipped()).toBe(true);
		expect(isOfflineModeEnabled()).toBe(false);
		expect(process.env.PI_OFFLINE).toBeUndefined();
	});
});

describe("ensureTool under PI_SKIP_STARTUP_INSTALL", () => {
	it("skips the download and says why, without going offline", async () => {
		process.env.PI_SKIP_STARTUP_INSTALL = "1";
		const statuses: ToolStatus[] = [];
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const result = await ensureTool("fd", (status) => statuses.push(status));

		expect(result).toBeUndefined();
		expect(statuses).toEqual([
			{
				type: "warning",
				message: "fd not found. Startup installs are skipped (PI_SKIP_STARTUP_INSTALL), skipping download.",
			},
		]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("getLatestPiRelease under PI_SKIP_STARTUP_INSTALL", () => {
	it("returns undefined without fetching", async () => {
		process.env.PI_SKIP_STARTUP_INSTALL = "1";
		const fetchMock = vi.fn(async () => Response.json({ version: "9.9.9" }));
		vi.stubGlobal("fetch", fetchMock);
		expect(await getLatestPiRelease("0.85.1")).toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("DefaultPackageManager under PI_SKIP_STARTUP_INSTALL", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `startup-skip-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(join(tempDir, "agent"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("skips installing missing package sources and reports no available updates", async () => {
		process.env.PI_SKIP_STARTUP_INSTALL = "1";
		const settingsManager = SettingsManager.inMemory();
		const packageManager = new DefaultPackageManager({
			cwd: tempDir,
			agentDir: join(tempDir, "agent"),
			settingsManager,
		});
		settingsManager.setProjectPackages(["npm:missing-package", "git:github.com/example/missing-repo"]);
		const installSpy = vi.spyOn(packageManager as any, "installParsedSource");

		const result = await packageManager.resolve();
		const all = [...result.extensions, ...result.skills, ...result.prompts, ...result.themes];
		expect(all.some((r) => r.metadata.origin === "package")).toBe(false);
		expect(installSpy).not.toHaveBeenCalled();
		expect(await packageManager.checkForAvailableUpdates()).toEqual([]);
	});
});

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import { DefaultResourceLoader, type ResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";

describe("createAgentSession skills option", () => {
	let tempDir: string;
	let skillsDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-sdk-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		skillsDir = join(tempDir, "skills", "test-skill");
		mkdirSync(skillsDir, { recursive: true });

		// Create a test skill in the pi skills directory
		writeFileSync(
			join(skillsDir, "SKILL.md"),
			`---
name: test-skill
description: A test skill for SDK tests.
---

# Test Skill

This is a test skill.
`,
		);
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("should discover skills by default and expose them on session.skills", async () => {
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
		});

		// Skills should be discovered and exposed on the session
		expect(session.resourceLoader.getSkills().skills.length).toBeGreaterThan(0);
		expect(session.resourceLoader.getSkills().skills.some((s) => s.name === "test-skill")).toBe(true);
	});

	it("should have empty skills when resource loader returns none (--no-skills)", async () => {
		const resourceLoader: ResourceLoader = {
			getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
			getSkills: () => ({ skills: [], diagnostics: [] }),
			getPrompts: () => ({ prompts: [], diagnostics: [] }),
			getThemes: () => ({ themes: [], diagnostics: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSystemPrompt: () => undefined,
			getSystemPromptSource: () => undefined,
			getAppendSystemPrompt: () => [],
			getAppendSystemPromptSources: () => [],
			extendResources: () => {},
			reload: async () => {},
		};

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			resourceLoader,
		});

		expect(session.resourceLoader.getSkills().skills).toEqual([]);
		expect(session.resourceLoader.getSkills().diagnostics).toEqual([]);
	});

	it("should use provided skills when resource loader supplies them", async () => {
		const customSkill = {
			name: "custom-skill",
			description: "A custom skill",
			filePath: "/fake/path/SKILL.md",
			baseDir: "/fake/path",
			sourceInfo: createSyntheticSourceInfo("/fake/path/SKILL.md", { source: "sdk" }),
			disableModelInvocation: false,
		};

		const resourceLoader: ResourceLoader = {
			getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
			getSkills: () => ({ skills: [customSkill], diagnostics: [] }),
			getPrompts: () => ({ prompts: [], diagnostics: [] }),
			getThemes: () => ({ themes: [], diagnostics: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSystemPrompt: () => undefined,
			getSystemPromptSource: () => undefined,
			getAppendSystemPrompt: () => [],
			getAppendSystemPromptSources: () => [],
			extendResources: () => {},
			reload: async () => {},
		};

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			resourceLoader,
		});

		expect(session.resourceLoader.getSkills().skills).toEqual([customSkill]);
		expect(session.resourceLoader.getSkills().diagnostics).toEqual([]);
	});
});

describe("createAgentSession loader ownership (c4d)", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-sdk-disposal-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("disposes the internally-created loader when the session is disposed", async () => {
		const disposeSpy = vi.spyOn(DefaultResourceLoader.prototype, "dispose");
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
		});
		expect(disposeSpy).not.toHaveBeenCalled();
		session.dispose();
		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});

	it("disposes the internally-created loader when session construction fails after reload", async () => {
		const disposeSpy = vi.spyOn(DefaultResourceLoader.prototype, "dispose");
		// Fail the AgentSession constructor (after the internal loader's reload started watching).
		const settingsManager = SettingsManager.inMemory();
		vi.spyOn(settingsManager, "getImageAutoResize").mockImplementation(() => {
			throw new Error("settings boom");
		});
		await expect(
			createAgentSession({
				cwd: tempDir,
				agentDir: tempDir,
				sessionManager: SessionManager.inMemory(),
				settingsManager,
			}),
		).rejects.toThrow("settings boom");
		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});

	it("never disposes a caller-injected loader", async () => {
		const dispose = vi.fn();
		const resourceLoader: ResourceLoader = {
			getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
			getSkills: () => ({ skills: [], diagnostics: [] }),
			getPrompts: () => ({ prompts: [], diagnostics: [] }),
			getThemes: () => ({ themes: [], diagnostics: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSystemPrompt: () => undefined,
			getSystemPromptSource: () => undefined,
			getAppendSystemPrompt: () => [],
			getAppendSystemPromptSources: () => [],
			extendResources: () => {},
			reload: async () => {},
			dispose,
		};
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			resourceLoader,
		});
		session.dispose();
		expect(dispose).not.toHaveBeenCalled();
	});
});

describe("createAgentSession default active tools", () => {
	let tempDir: string;

	function writeSkill(): void {
		const dir = join(tempDir, "skills", "greet-skill");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "SKILL.md"),
			`---\nname: greet-skill\ndescription: A skill for active-tool tests.\n---\n\n# Greet\n\nSay hello.\n`,
		);
	}

	function emptyResourceLoader(): ResourceLoader {
		return {
			getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
			getSkills: () => ({ skills: [], diagnostics: [] }),
			getPrompts: () => ({ prompts: [], diagnostics: [] }),
			getThemes: () => ({ themes: [], diagnostics: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSystemPrompt: () => undefined,
			getSystemPromptSource: () => undefined,
			getAppendSystemPrompt: () => [],
			getAppendSystemPromptSources: () => [],
			extendResources: () => {},
			reload: async () => {},
		};
	}

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-sdk-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("activates the skill tool on a default launch when a model-visible skill exists", async () => {
		writeSkill();
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
		});
		expect(session.getActiveToolNames()).toContain("skill");
		session.dispose();
	});

	it("leaves the active set at the four built-ins when no skills or commands exist", async () => {
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			resourceLoader: emptyResourceLoader(),
		});
		// Hermetic: the stub loader supplies no extension/custom tools, so the active
		// set is exactly the default built-ins.
		expect(session.getActiveToolNames().sort()).toEqual(["bash", "edit", "read", "write"]);
		expect(session.getActiveToolNames()).not.toContain("skill");
		expect(session.getActiveToolNames()).not.toContain("slash_command");
		session.dispose();
	});

	it("does not activate the skill tool when an explicit --tools allowlist omits it", async () => {
		writeSkill();
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			tools: ["read", "bash"],
		});
		expect(session.getActiveToolNames().sort()).toEqual(["bash", "read"]);
		expect(session.getActiveToolNames()).not.toContain("skill");
		session.dispose();
	});

	it("honors --exclude-tools skill through the default active-set path", async () => {
		writeSkill();
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			excludeTools: ["skill"],
		});
		const active = session.getActiveToolNames();
		expect(active).not.toContain("skill");
		expect(active).toEqual(expect.arrayContaining(["read", "bash", "edit", "write"]));
		session.dispose();
	});

	it("activates the slash_command tool on a default launch when a model-visible command exists", async () => {
		const commandsDir = join(tempDir, "commands");
		mkdirSync(commandsDir, { recursive: true });
		writeFileSync(join(commandsDir, "greet.md"), `---\ndescription: Greet command for SDK tests.\n---\nSay hello.\n`);
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
		});
		expect(session.getActiveToolNames()).toContain("slash_command");
		session.dispose();
	});
});

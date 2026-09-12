import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_HTTP_IDLE_TIMEOUT_MS } from "../src/core/http-dispatcher.ts";
import { type Settings, SettingsManager } from "../src/core/settings-manager.ts";

describe("SettingsManager", () => {
	const testDir = join(process.cwd(), "test-settings-tmp");
	const agentDir = join(testDir, "agent");
	const projectDir = join(testDir, "project");

	beforeEach(() => {
		// Clean up and create fresh directories
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
	});

	describe("preserves externally added settings", () => {
		it("should preserve enabledModels when changing thinking level", async () => {
			// Create initial settings file
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "dark",
					defaultModel: "claude-sonnet",
				}),
			);

			// Create SettingsManager (simulates pi starting up)
			const manager = SettingsManager.create(projectDir, agentDir);

			// Simulate user editing settings.json externally to add enabledModels
			const currentSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			currentSettings.enabledModels = ["claude-opus-4-5", "gpt-5.2-codex"];
			writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));

			// User changes thinking level via Shift+Tab
			manager.setDefaultThinkingLevel("high");
			await manager.flush();

			// Verify enabledModels is preserved
			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.enabledModels).toEqual(["claude-opus-4-5", "gpt-5.2-codex"]);
			expect(savedSettings.defaultThinkingLevel).toBe("high");
			expect(savedSettings.theme).toBe("dark");
			expect(savedSettings.defaultModel).toBe("claude-sonnet");
		});

		it("should preserve custom settings when changing theme", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					defaultModel: "claude-sonnet",
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			// User adds custom settings externally
			const currentSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			currentSettings.shellPath = "/bin/zsh";
			currentSettings.extensions = ["/path/to/extension.ts"];
			writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));

			// User changes theme
			manager.setTheme("light");
			await manager.flush();

			// Verify all settings preserved
			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.shellPath).toBe("/bin/zsh");
			expect(savedSettings.extensions).toEqual(["/path/to/extension.ts"]);
			expect(savedSettings.theme).toBe("light");
		});

		it("should let in-memory changes override file changes for same key", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "dark",
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			// User externally sets thinking level to "low"
			const currentSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			currentSettings.defaultThinkingLevel = "low";
			writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));

			// But then changes it via UI to "high"
			manager.setDefaultThinkingLevel("high");
			await manager.flush();

			// In-memory change should win
			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.defaultThinkingLevel).toBe("high");
		});
	});

	describe("packages migration", () => {
		it("should keep local-only extensions in extensions array", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					extensions: ["/local/ext.ts", "./relative/ext.ts"],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getPackages()).toEqual([]);
			expect(manager.getExtensionPaths()).toEqual(["/local/ext.ts", "./relative/ext.ts"]);
		});

		it("should handle packages with filtering objects", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					packages: [
						"npm:simple-pkg",
						{
							source: "npm:shitty-extensions",
							extensions: ["extensions/oracle.ts"],
							skills: [],
						},
					],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			const packages = manager.getPackages();
			expect(packages).toHaveLength(2);
			expect(packages[0]).toBe("npm:simple-pkg");
			expect(packages[1]).toEqual({
				source: "npm:shitty-extensions",
				extensions: ["extensions/oracle.ts"],
				skills: [],
			});
		});
	});

	describe("reload", () => {
		it("should reload global settings from disk", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "dark",
					extensions: ["/before.ts"],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "light",
					extensions: ["/after.ts"],
					defaultModel: "claude-sonnet",
				}),
			);

			await manager.reload();

			expect(manager.getTheme()).toBe("light");
			expect(manager.getExtensionPaths()).toEqual(["/after.ts"]);
			expect(manager.getDefaultModel()).toBe("claude-sonnet");
		});

		it("should keep previous settings and report the file path when the file is invalid", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			writeFileSync(settingsPath, "{ invalid json");
			await manager.reload();

			expect(manager.getTheme()).toBe("dark");
			expect(manager.drainErrors()).toMatchObject([{ scope: "global", path: settingsPath }]);
		});
	});

	describe("theme setting", () => {
		it("stores slash-separated automatic theme settings separately from fixed theme names", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "light/dark" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getTheme()).toBeUndefined();
			expect(manager.getThemeSetting()).toBe("light/dark");

			manager.setTheme("solarized-light/tokyo-night");
			await manager.flush();

			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.theme).toBe("solarized-light/tokyo-night");
		});
	});

	describe("error tracking", () => {
		it("should collect and clear load errors via drainErrors", () => {
			const globalSettingsPath = join(agentDir, "settings.json");
			const projectSettingsPath = join(projectDir, ".pi", "settings.json");
			writeFileSync(globalSettingsPath, "{ invalid global json");
			writeFileSync(projectSettingsPath, "{ invalid project json");

			const manager = SettingsManager.create(projectDir, agentDir);
			const errors = manager.drainErrors();

			expect(errors).toHaveLength(2);
			expect(errors).toMatchObject([
				{ scope: "global", path: globalSettingsPath },
				{ scope: "project", path: projectSettingsPath },
			]);
			expect(manager.drainErrors()).toEqual([]);
		});
	});

	describe("project trust", () => {
		it("should skip project settings when project is not trusted", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "global" }));
			writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({ theme: "project" }));

			const manager = SettingsManager.create(projectDir, agentDir, { projectTrusted: false });

			expect(manager.isProjectTrusted()).toBe(false);
			expect(manager.getTheme()).toBe("global");
			expect(manager.getProjectSettings()).toEqual({});
		});

		it("should reload project settings after trust changes to true", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "global" }));
			writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({ theme: "project" }));
			const manager = SettingsManager.create(projectDir, agentDir, { projectTrusted: false });

			manager.setProjectTrusted(true);

			expect(manager.isProjectTrusted()).toBe(true);
			expect(manager.getTheme()).toBe("project");
		});

		it("should fail project settings writes when project is not trusted", async () => {
			const projectSettingsPath = join(projectDir, ".pi", "settings.json");
			writeFileSync(projectSettingsPath, JSON.stringify({ packages: ["npm:existing"] }));
			const manager = SettingsManager.create(projectDir, agentDir, { projectTrusted: false });

			expect(() => manager.setProjectPackages(["npm:new"])).toThrow(
				"Project is not trusted; refusing to write project settings",
			);
			await manager.flush();

			expect(manager.getProjectSettings()).toEqual({});
			expect(JSON.parse(readFileSync(projectSettingsPath, "utf-8"))).toEqual({ packages: ["npm:existing"] });
		});

		it("should read default project trust from global settings only", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));
			writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({ defaultProjectTrust: "never" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getDefaultProjectTrust()).toBe("always");
		});

		it("should default invalid project trust settings to ask", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "sometimes" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getDefaultProjectTrust()).toBe("ask");
		});
	});

	describe("project settings directory creation", () => {
		it("should not create .pi folder when only reading project settings", () => {
			// Create agent dir with global settings, but NO .pi folder in project
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			// Delete the .pi folder that beforeEach created
			rmSync(join(projectDir, ".pi"), { recursive: true });

			// Create SettingsManager (reads both global and project settings)
			const manager = SettingsManager.create(projectDir, agentDir);

			// .pi folder should NOT have been created just from reading
			expect(existsSync(join(projectDir, ".pi"))).toBe(false);

			// Settings should still be loaded from global
			expect(manager.getTheme()).toBe("dark");
		});

		it("should create .pi folder when writing project settings", async () => {
			// Create agent dir with global settings, but NO .pi folder in project
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			// Delete the .pi folder that beforeEach created
			rmSync(join(projectDir, ".pi"), { recursive: true });

			const manager = SettingsManager.create(projectDir, agentDir);

			// .pi folder should NOT exist yet
			expect(existsSync(join(projectDir, ".pi"))).toBe(false);

			// Write a project-specific setting
			manager.setProjectPackages([{ source: "npm:test-pkg" }]);
			await manager.flush();

			// Now .pi folder should exist
			expect(existsSync(join(projectDir, ".pi"))).toBe(true);

			// And settings file should be created
			expect(existsSync(join(projectDir, ".pi", "settings.json"))).toBe(true);
		});
	});

	describe("terminal capability overrides", () => {
		it("maps explicit values and omits auto values", () => {
			const getOverrides = (terminal: NonNullable<Settings["terminal"]>) =>
				SettingsManager.inMemory({ terminal }).getTerminalCapabilityOverrides();

			expect(getOverrides({ images: false, trueColor: false, hyperlinks: false })).toEqual({
				images: null,
				trueColor: false,
				hyperlinks: false,
			});
			expect(getOverrides({ images: "kitty", trueColor: true, hyperlinks: true })).toEqual({
				images: "kitty",
				trueColor: true,
				hyperlinks: true,
			});
			expect(getOverrides({ images: "auto", trueColor: "auto", hyperlinks: "auto" })).toEqual({});
		});
	});

	describe("retry settings", () => {
		it("defaults and overrides agent retry delay cap", () => {
			expect(SettingsManager.inMemory().getRetrySettings()).toEqual({
				enabled: true,
				maxRetries: 3,
				baseDelayMs: 2000,
				maxAgentDelayMs: 60000,
			});
			expect(
				SettingsManager.inMemory({
					retry: { enabled: true, maxRetries: 10, baseDelayMs: 500, maxAgentDelayMs: 5000 },
				}).getRetrySettings(),
			).toEqual({ enabled: true, maxRetries: 10, baseDelayMs: 500, maxAgentDelayMs: 5000 });
		});
	});

	describe("httpIdleTimeoutMs", () => {
		it("should default to 5 minutes", () => {
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getHttpIdleTimeoutMs()).toBe(DEFAULT_HTTP_IDLE_TIMEOUT_MS);
		});

		it("should use merged global and project settings", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ httpIdleTimeoutMs: 300000 }));
			writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({ httpIdleTimeoutMs: 0 }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getHttpIdleTimeoutMs()).toBe(0);
		});

		it("should reject invalid timeout values", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ httpIdleTimeoutMs: -1 }));
			const manager = SettingsManager.create(projectDir, agentDir);

			expect(() => manager.getHttpIdleTimeoutMs()).toThrow("Invalid httpIdleTimeoutMs setting");
		});
	});

	describe("externalEditor", () => {
		const originalVisual = process.env.VISUAL;
		const originalEditor = process.env.EDITOR;
		const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

		function setEditorEnv(visual?: string, editor?: string): void {
			if (visual === undefined) delete process.env.VISUAL;
			else process.env.VISUAL = visual;
			if (editor === undefined) delete process.env.EDITOR;
			else process.env.EDITOR = editor;
		}

		afterEach(() => {
			setEditorEnv(originalVisual, originalEditor);
			if (originalPlatform) {
				Object.defineProperty(process, "platform", originalPlatform);
			}
		});

		it("should resolve editor commands by precedence", () => {
			setEditorEnv("vim", "nano");
			expect(SettingsManager.inMemory({ externalEditor: "code --wait" }).getExternalEditorCommand()).toBe(
				"code --wait",
			);
			expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("vim");

			setEditorEnv(undefined, "emacs");
			expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("emacs");
		});

		it("should fall back to platform defaults", () => {
			setEditorEnv();
			Object.defineProperty(process, "platform", { value: "win32" });
			expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("notepad");

			Object.defineProperty(process, "platform", { value: "darwin" });
			expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("nano");

			Object.defineProperty(process, "platform", { value: "linux" });
			expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("nano");
		});
	});

	describe("TUI mode", () => {
		it("defaults to regular and persists fullscreen mode", async () => {
			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getTuiMode()).toBe("regular");

			manager.setTuiMode("fullscreen");
			await manager.flush();

			expect(manager.getTuiMode()).toBe("fullscreen");
			const savedSettings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
			expect(savedSettings.tuiMode).toBe("fullscreen");
		});

		it("falls back to regular for unsupported values", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ tuiMode: "other" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getTuiMode()).toBe("regular");
		});

		it("does not recognize the old uiMode setting", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ uiMode: "fullscreen" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getTuiMode()).toBe("regular");
		});
	});

	it("validates and persists fullscreen settings", async () => {
		const manager = SettingsManager.create(projectDir, agentDir);
		expect(manager.getFullscreenExitOutput()).toBe("transcript");
		expect(manager.getFullscreenScrollbar()).toBe("auto");
		expect(manager.getFullscreenCopyOnSelect()).toBe(true);

		manager.setFullscreenExitOutput("resume-hint");
		manager.setFullscreenScrollbar("hidden");
		manager.setFullscreenCopyOnSelect(false);
		await manager.flush();
		const savedSettings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
		expect(savedSettings.fullscreenExitOutput).toBe("resume-hint");
		expect(savedSettings.fullscreenScrollbar).toBe("hidden");
		expect(savedSettings.fullscreenCopyOnSelect).toBe(false);

		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ fullscreenExitOutput: "nothing", fullscreenScrollbar: "sometimes" }),
		);
		const reloadedManager = SettingsManager.create(projectDir, agentDir);
		expect(reloadedManager.getFullscreenExitOutput()).toBe("transcript");
		expect(reloadedManager.getFullscreenScrollbar()).toBe("auto");
		expect(reloadedManager.getFullscreenCopyOnSelect()).toBe(true);
	});

	describe("outputPad", () => {
		it("should default to 1 and persist binary values", async () => {
			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getOutputPad()).toBe(1);

			manager.setOutputPad(0);
			await manager.flush();

			expect(manager.getOutputPad()).toBe(0);
			const savedSettings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
			expect(savedSettings.outputPad).toBe(0);
		});

		it("should treat unsupported outputPad values as default padding", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ outputPad: 2 }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getOutputPad()).toBe(1);
		});
	});

	describe("markdown.mermaid", () => {
		it("defaults to streaming and persists rendering modes", async () => {
			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getMermaidRenderingMode()).toBe("streaming");

			manager.setMermaidRenderingMode("final");
			await manager.flush();

			expect(manager.getMermaidRenderingMode()).toBe("final");
			const savedSettings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
			expect(savedSettings.markdown.mermaid).toBe("final");
		});

		it("falls back to streaming for unsupported values", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ markdown: { mermaid: "sometimes" } }));

			expect(SettingsManager.create(projectDir, agentDir).getMermaidRenderingMode()).toBe("streaming");
		});
	});

	describe("shellCommandPrefix", () => {
		it("should load shellCommandPrefix from settings", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ shellCommandPrefix: "shopt -s expand_aliases" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getShellCommandPrefix()).toBe("shopt -s expand_aliases");
		});

		it("should return undefined when shellCommandPrefix is not set", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getShellCommandPrefix()).toBeUndefined();
		});

		it("should preserve shellCommandPrefix when saving unrelated settings", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ shellCommandPrefix: "shopt -s expand_aliases" }));

			const manager = SettingsManager.create(projectDir, agentDir);
			manager.setTheme("light");
			await manager.flush();

			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.shellCommandPrefix).toBe("shopt -s expand_aliases");
			expect(savedSettings.theme).toBe("light");
		});
	});

	describe("defaultTools", () => {
		it("loads global defaults and lets project settings replace them", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultTools: ["read", "bash"] }));

			expect(SettingsManager.create(projectDir, agentDir).getDefaultTools()).toEqual(["read", "bash"]);

			writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({ defaultTools: ["grep"] }));

			expect(SettingsManager.create(projectDir, agentDir).getDefaultTools()).toEqual(["grep"]);
		});

		it("preserves an empty tool list", () => {
			expect(SettingsManager.inMemory({ defaultTools: [] }).getDefaultTools()).toEqual([]);
			expect(SettingsManager.inMemory().getDefaultTools()).toBeUndefined();
		});
	});

	describe("getSessionDir", () => {
		it("should return undefined when not set", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "dark" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getSessionDir()).toBeUndefined();
		});

		it("should return global sessionDir", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ sessionDir: "/tmp/sessions" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getSessionDir()).toBe("/tmp/sessions");
		});

		it("should return project sessionDir, overriding global", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ sessionDir: "/global/sessions" }));
			writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({ sessionDir: "./sessions" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getSessionDir()).toBe("./sessions");
		});

		it("should expand ~ in sessionDir", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ sessionDir: "~/sessions" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getSessionDir()).toBe(join(homedir(), "sessions"));
		});
	});

	describe("getShellPath", () => {
		it("should return undefined when not set", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "dark" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getShellPath()).toBeUndefined();
		});

		it("should return an absolute shellPath unchanged", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ shellPath: "/bin/zsh" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getShellPath()).toBe("/bin/zsh");
		});

		it("should expand ~ in shellPath", () => {
			writeFileSync(
				join(agentDir, "settings.json"),
				JSON.stringify({ shellPath: "~/.local/bin/agent-shell-sandbox" }),
			);
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getShellPath()).toBe(join(homedir(), ".local/bin/agent-shell-sandbox"));
		});

		it("should expand a bare ~ in shellPath", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ shellPath: "~" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getShellPath()).toBe(homedir());
		});
	});

	describe("promptHistory", () => {
		it("should default to session scope and 100 max entries", () => {
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getPromptHistorySettings()).toEqual({ scope: "session", maxEntries: 100 });
		});

		it("should accept explicit project scope and unlimited (0) max entries", () => {
			writeFileSync(
				join(agentDir, "settings.json"),
				JSON.stringify({ promptHistory: { scope: "project", maxEntries: 0 } }),
			);
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getPromptHistorySettings()).toEqual({ scope: "project", maxEntries: 0 });
		});

		it("should floor positive fractional maxEntries", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ promptHistory: { maxEntries: 250.9 } }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getPromptHistoryMaxEntries()).toBe(250);
		});

		it("should fall back to session scope on an invalid scope value", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ promptHistory: { scope: "nonsense" } }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getPromptHistoryScope()).toBe("session");
		});

		it.each([-1, "not-a-number", null])(
			"should fall back to 100 for a settings-file maxEntries value of %s",
			(value) => {
				writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ promptHistory: { maxEntries: value } }));
				const manager = SettingsManager.create(projectDir, agentDir);
				expect(manager.getPromptHistoryMaxEntries()).toBe(100);
			},
		);

		it("should fall back to 100 for NaN and Infinity passed to setPromptHistoryMaxEntries", async () => {
			const manager = SettingsManager.create(projectDir, agentDir);

			manager.setPromptHistoryMaxEntries(Number.NaN);
			expect(manager.getPromptHistoryMaxEntries()).toBe(100);

			manager.setPromptHistoryMaxEntries(Number.POSITIVE_INFINITY);
			expect(manager.getPromptHistoryMaxEntries()).toBe(100);
		});

		it("should merge global settings with a project override of only one child key", () => {
			writeFileSync(
				join(agentDir, "settings.json"),
				JSON.stringify({ promptHistory: { scope: "project", maxEntries: 500 } }),
			);
			writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({ promptHistory: { maxEntries: 0 } }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getPromptHistorySettings()).toEqual({ scope: "project", maxEntries: 0 });
		});

		it("setPromptHistoryScope should preserve the sibling maxEntries key and unrelated settings", async () => {
			writeFileSync(
				join(agentDir, "settings.json"),
				JSON.stringify({ theme: "dark", promptHistory: { maxEntries: 500 } }),
			);
			const manager = SettingsManager.create(projectDir, agentDir);

			manager.setPromptHistoryScope("project");
			await manager.flush();

			const savedSettings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
			expect(savedSettings.promptHistory).toEqual({ scope: "project", maxEntries: 500 });
			expect(savedSettings.theme).toBe("dark");
		});

		it("setPromptHistoryMaxEntries should preserve the sibling scope key and unrelated settings", async () => {
			writeFileSync(
				join(agentDir, "settings.json"),
				JSON.stringify({ theme: "dark", promptHistory: { scope: "project" } }),
			);
			const manager = SettingsManager.create(projectDir, agentDir);

			manager.setPromptHistoryMaxEntries(0);
			await manager.flush();

			const savedSettings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
			expect(savedSettings.promptHistory).toEqual({ scope: "project", maxEntries: 0 });
			expect(savedSettings.theme).toBe("dark");
		});
	});

	describe("skill render pipeline settings (C1b)", () => {
		it("returns the exact defaults when unset", () => {
			const manager = SettingsManager.inMemory({});
			expect(manager.getDisableSkillShellExecution()).toBe(false);
			expect(manager.getSkillShellTimeoutMs()).toBe(30000);
			expect(manager.getSkillShellOutputLimitBytes()).toBe(16384);
			expect(manager.getSkillInterop()).toBe(true);
			expect(manager.getDisableSkillEnvInjection()).toBe(false);
			expect(manager.getSkillPathsWindow()).toBe(50);
			expect(manager.getSkillListingBudgetFraction()).toBe(0.01);
		});

		it("returns configured values", () => {
			const manager = SettingsManager.inMemory({
				disableSkillShellExecution: true,
				skillShellTimeoutMs: 5000,
				skillShellOutputLimitBytes: 4096,
				skillInterop: false,
				disableSkillEnvInjection: true,
				skillPathsWindow: 5,
				skillListingBudgetFraction: 0.02,
			});
			expect(manager.getDisableSkillShellExecution()).toBe(true);
			expect(manager.getSkillShellTimeoutMs()).toBe(5000);
			expect(manager.getSkillShellOutputLimitBytes()).toBe(4096);
			expect(manager.getSkillInterop()).toBe(false);
			expect(manager.getDisableSkillEnvInjection()).toBe(true);
			expect(manager.getSkillPathsWindow()).toBe(5);
			expect(manager.getSkillListingBudgetFraction()).toBe(0.02);
		});

		it("rejects non-positive-integer timeout and cap", () => {
			expect(() => SettingsManager.inMemory({ skillShellTimeoutMs: 0 }).getSkillShellTimeoutMs()).toThrow(
				/Invalid skillShellTimeoutMs/,
			);
			expect(() => SettingsManager.inMemory({ skillShellTimeoutMs: 1.5 }).getSkillShellTimeoutMs()).toThrow(
				/Invalid skillShellTimeoutMs/,
			);
			expect(() =>
				SettingsManager.inMemory({ skillShellOutputLimitBytes: -1 }).getSkillShellOutputLimitBytes(),
			).toThrow(/Invalid skillShellOutputLimitBytes/);
			expect(() => SettingsManager.inMemory({ skillPathsWindow: 0 }).getSkillPathsWindow()).toThrow(
				/Invalid skillPathsWindow/,
			);
			expect(() => SettingsManager.inMemory({ skillPathsWindow: 1.5 }).getSkillPathsWindow()).toThrow(
				/Invalid skillPathsWindow/,
			);
		});

		it("rejects an out-of-range or non-numeric skillListingBudgetFraction", () => {
			expect(() =>
				SettingsManager.inMemory({ skillListingBudgetFraction: 0 }).getSkillListingBudgetFraction(),
			).toThrow(/Invalid skillListingBudgetFraction/);
			expect(() =>
				SettingsManager.inMemory({ skillListingBudgetFraction: 1.5 }).getSkillListingBudgetFraction(),
			).toThrow(/Invalid skillListingBudgetFraction/);
			expect(() =>
				SettingsManager.inMemory({
					skillListingBudgetFraction: "x" as unknown as number,
				}).getSkillListingBudgetFraction(),
			).toThrow(/Invalid skillListingBudgetFraction/);
		});
	});

	describe("skillVisibility (A.6/B.8)", () => {
		it("defaults to on for an absent entry and returns empty maps", () => {
			const manager = SettingsManager.inMemory();
			expect(manager.getSkillVisibilityState("/skills/a/SKILL.md")).toBe("on");
			expect(manager.getSkillVisibility()).toEqual({});
			expect(manager.getSkillVisibility("global")).toEqual({});
			expect(manager.getSkillVisibility("project")).toEqual({});
			expect(manager.getSkillVisibilityInfo("/skills/a/SKILL.md")).toEqual({
				state: "on",
				scope: undefined,
				malformed: false,
			});
		});

		it("falls back to on for a malformed value and emits exactly one deduplicated diagnostic", () => {
			const manager = SettingsManager.inMemory({
				skillVisibility: {
					"/skills/a/SKILL.md": "garbage",
					"/skills/b/SKILL.md": 42,
				} as unknown as Record<string, "on">,
			});
			expect(manager.getSkillVisibilityState("/skills/a/SKILL.md")).toBe("on");
			expect(manager.getSkillVisibilityState("/skills/a/SKILL.md")).toBe("on");
			expect(manager.getSkillVisibilityState("/skills/a/SKILL.md")).toBe("on");
			let diagnostics = manager.drainSkillVisibilityDiagnostics();
			expect(diagnostics).toHaveLength(1);
			expect(diagnostics[0]!.message).toContain("/skills/a/SKILL.md");
			expect(diagnostics[0]!.message).toContain("global");
			// Drained; further resolves stay deduped.
			expect(manager.drainSkillVisibilityDiagnostics()).toEqual([]);
			// A distinct malformed key reports its own diagnostic.
			expect(manager.getSkillVisibilityState("/skills/b/SKILL.md")).toBe("on");
			diagnostics = manager.drainSkillVisibilityDiagnostics();
			expect(diagnostics).toHaveLength(1);
			expect(diagnostics[0]!.message).toContain("/skills/b/SKILL.md");
			expect(manager.getSkillVisibilityInfo("/skills/a/SKILL.md")).toEqual({
				state: "on",
				scope: "global",
				malformed: true,
			});
		});

		it("round-trips a global state and prunes the key when it returns to the on default", () => {
			const manager = SettingsManager.inMemory();
			manager.setSkillVisibilityState("/skills/a/SKILL.md", "off", "global");
			expect(manager.getSkillVisibilityState("/skills/a/SKILL.md")).toBe("off");
			expect(manager.getSkillVisibility("global")).toEqual({ "/skills/a/SKILL.md": "off" });
			expect(manager.getSkillVisibilityInfo("/skills/a/SKILL.md")).toEqual({
				state: "off",
				scope: "global",
				malformed: false,
			});
			manager.setSkillVisibilityState("/skills/a/SKILL.md", "on", "global");
			expect(manager.getSkillVisibilityState("/skills/a/SKILL.md")).toBe("on");
			expect(manager.getSkillVisibility("global")).toEqual({});
		});

		it("resolves project over global, and writes an explicit project on over a global off", () => {
			const manager = SettingsManager.inMemory();
			manager.setSkillVisibilityState("/skills/a/SKILL.md", "off", "global");
			expect(manager.getSkillVisibilityState("/skills/a/SKILL.md")).toBe("off");
			// A project on must override the global off (not delete-and-re-expose).
			manager.setSkillVisibilityState("/skills/a/SKILL.md", "on", "project");
			expect(manager.getSkillVisibilityState("/skills/a/SKILL.md")).toBe("on");
			expect(manager.getSkillVisibility("project")).toEqual({ "/skills/a/SKILL.md": "on" });
			expect(manager.getSkillVisibility("global")).toEqual({ "/skills/a/SKILL.md": "off" });
			expect(manager.getSkillVisibilityInfo("/skills/a/SKILL.md")).toEqual({
				state: "on",
				scope: "project",
				malformed: false,
			});
			// Removing the project override re-exposes the global off.
			manager.setSkillVisibilityState("/skills/a/SKILL.md", "off", "project");
			expect(manager.getSkillVisibility("project")).toEqual({});
			expect(manager.getSkillVisibilityState("/skills/a/SKILL.md")).toBe("off");
			expect(manager.getSkillVisibilityInfo("/skills/a/SKILL.md").scope).toBe("global");
		});

		it("persists both scopes to disk and merges per-key across concurrent writers", async () => {
			// Existing store files: first-create atomicity is a deferred withLock limitation.
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({}));
			writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({}));

			const writerA = SettingsManager.create(projectDir, agentDir);
			const writerB = SettingsManager.create(projectDir, agentDir);
			writerA.setSkillVisibilityState("/skills/one/SKILL.md", "off", "global");
			writerB.setSkillVisibilityState("/skills/two/SKILL.md", "name-only", "global");
			writerA.setSkillVisibilityState("/skills/three/SKILL.md", "user-invocable-only", "project");
			writerB.setSkillVisibilityState("/skills/four/SKILL.md", "off", "project");
			await writerA.flush();
			await writerB.flush();

			const globalFile = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
			expect(globalFile.skillVisibility).toEqual({
				"/skills/one/SKILL.md": "off",
				"/skills/two/SKILL.md": "name-only",
			});
			const projectFile = JSON.parse(readFileSync(join(projectDir, ".pi", "settings.json"), "utf-8"));
			expect(projectFile.skillVisibility).toEqual({
				"/skills/three/SKILL.md": "user-invocable-only",
				"/skills/four/SKILL.md": "off",
			});

			// A fresh manager sees the merged effective map with project precedence.
			const reader = SettingsManager.create(projectDir, agentDir);
			expect(reader.getSkillVisibilityState("/skills/one/SKILL.md")).toBe("off");
			expect(reader.getSkillVisibilityState("/skills/two/SKILL.md")).toBe("name-only");
			expect(reader.getSkillVisibilityState("/skills/three/SKILL.md")).toBe("user-invocable-only");
			expect(reader.getSkillVisibilityState("/skills/four/SKILL.md")).toBe("off");
		});

		it("pruning a scope's first visibility write preserves a concurrent writer's other-key entries", async () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({}));
			writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({}));

			// A project override, so a later global `on` prunes (effective already on).
			const seeder = SettingsManager.create(projectDir, agentDir);
			seeder.setSkillVisibilityState("/skills/a/SKILL.md", "on", "project");
			await seeder.flush();

			// This session never wrote a global visibility entry (its in-memory
			// global map is undefined); a concurrent writer adds one on disk.
			const pruner = SettingsManager.create(projectDir, agentDir);
			const concurrent = SettingsManager.create(projectDir, agentDir);
			concurrent.setSkillVisibilityState("/skills/other/SKILL.md", "off", "global");
			await concurrent.flush();

			// The prune deletes the (absent) global key but must merge per-key,
			// not overwrite the whole field with undefined and wipe /other.
			pruner.setSkillVisibilityState("/skills/a/SKILL.md", "on", "global");
			await pruner.flush();

			const globalFile = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
			expect(globalFile.skillVisibility).toEqual({ "/skills/other/SKILL.md": "off" });
		});

		it("surfaces a save blockade via drainErrors when the settings file failed to load", async () => {
			writeFileSync(join(agentDir, "settings.json"), "{ invalid global json");
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.drainErrors()).toHaveLength(1); // initial load error, now cleared

			manager.setSkillVisibilityState("/skills/a/SKILL.md", "off", "global");
			await manager.flush();

			const errors = manager.drainErrors();
			expect(errors).toHaveLength(1);
			expect(errors[0]!.scope).toBe("global");
			expect(errors[0]!.error.message).toContain("not saved");
			// The unparseable file is left untouched, not clobbered.
			expect(readFileSync(join(agentDir, "settings.json"), "utf-8")).toBe("{ invalid global json");
		});
	});
});

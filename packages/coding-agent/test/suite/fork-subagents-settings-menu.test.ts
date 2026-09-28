/**
 * Fork-owned: the `/agents` settings menu (plan T15) on a file-backed session. Each session comes from
 * `createAgentSessionRuntime` with `SettingsManager.create`, so a save reaches the project
 * `settings.json` and the session rereads it. The menu runs as a user types `/agents`; a save is also
 * driven directly through `saveSubagentSetting` (P17). Old pi-subagents tests at 79a7c42 this covers
 * as reference: the settings toasts and the save failure (phase 1 gap lines).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { Component } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../../src/core/agent-session.ts";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import type { ExtensionUIContext } from "../../src/core/extensions/types.ts";
import { listedAgentTypes } from "../../src/core/fork-builtins/subagents/definitions/registry.ts";
import type { SubagentService } from "../../src/core/fork-builtins/subagents/service/service.ts";
import { subagentServiceFor } from "../../src/core/fork-builtins/subagents/service/sessions.ts";
import type { SubagentSettings } from "../../src/core/fork-builtins/subagents/settings/settings.ts";
import {
	type SettingChange,
	type SettingsMenuEnvironment,
	saveSubagentSetting,
} from "../../src/core/fork-builtins/subagents/ui/settings-menu.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { ModelRuntime } from "../../src/core/model-runtime.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	vi.unstubAllEnvs();
});

const WORKER = "---\ndescription: test worker\ntools: read\nextensions: false\n---\nYou are a test worker.\n";

interface Files {
	global?: Record<string, unknown>;
	/** The project `settings.json` as text; absent writes none. */
	project?: string;
	projectTrusted?: boolean;
}

/** A file-backed session: `<root>/agent` is its agent directory, `<root>/project` its working directory. */
async function fileSession(files: Files = {}) {
	vi.stubEnv("PI_FORK_BUILTINS", "on");
	const root = mkdtempSync(join(tmpdir(), "pi-sn2-settings-"));
	const agentDir = join(root, "agent");
	const projectDir = join(root, "project");
	mkdirSync(join(agentDir, "agents"), { recursive: true });
	mkdirSync(join(projectDir, ".pi"), { recursive: true });
	writeFileSync(join(agentDir, "agents", "worker.md"), WORKER);
	if (files.global) writeFileSync(join(agentDir, "settings.json"), JSON.stringify(files.global, null, 2));
	const projectFile = join(projectDir, ".pi", "settings.json");
	if (files.project !== undefined) writeFileSync(projectFile, files.project);
	const faux = registerFauxProvider();
	const authStorage = AuthStorage.inMemory();
	await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
	const modelRuntime = await ModelRuntime.create({ credentials: authStorage, modelsPath: join(root, "models.json") });
	const model = faux.getModel();
	modelRuntime.registerProvider(model.provider, {
		baseUrl: model.baseUrl,
		api: model.api,
		models: [
			{
				id: model.id,
				name: model.name,
				api: model.api,
				reasoning: model.reasoning,
				input: model.input,
				cost: model.cost,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				baseUrl: model.baseUrl,
			},
		],
	});
	const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			modelRuntime,
			settingsManager: SettingsManager.create(cwd, agentDir, { projectTrusted: files.projectTrusted ?? true }),
			resourceLoaderOptions: { noSkills: true, noPromptTemplates: true, noThemes: true },
		});
		return {
			...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model })),
			services,
			diagnostics: services.diagnostics,
		};
	};
	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: projectDir,
		agentDir,
		sessionManager: SessionManager.inMemory(projectDir),
	});
	cleanups.push(async () => {
		await runtime.dispose().catch(() => {});
		faux.unregister();
		rmSync(root, { recursive: true, force: true });
	});
	const service = subagentServiceFor(runtime.session);
	if (!service) throw new Error("no subagent service");
	return { session: runtime.session, service, projectFile, agentDir };
}

/** A UI context that answers from the script and records what it showed. Own properties only. */
function scriptedUi() {
	const script = {
		select: [] as Array<string | undefined>,
		input: [] as Array<string | undefined>,
		/** Each answer gets the rendered component; a function may drive it before answering. */
		custom: [] as Array<SettingChange | undefined | ((component: Component) => SettingChange | undefined)>,
	};
	const log = {
		selects: [] as Array<{ title: string; options: string[] }>,
		inputs: [] as string[],
		notes: [] as Array<{ message: string; type?: string }>,
		renders: [] as string[],
	};
	const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
	const tui = { requestRender: () => {}, terminal: { rows: 40, columns: 160 } };
	const ui = {
		notify: (message: string, type?: string) => log.notes.push({ message, type }),
		setStatus: () => {},
		setWidget: () => {},
		onTerminalInput: () => () => {},
		getEditorText: () => "",
		select: async (title: string, options: string[]) => {
			log.selects.push({ title, options });
			const answer = script.select.shift();
			return answer === undefined ? undefined : options.find((option) => option.startsWith(answer));
		},
		input: async (title: string) => {
			log.inputs.push(title);
			return script.input.shift();
		},
		custom: async (
			factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (value: unknown) => void) => Component,
		) => {
			let reported: unknown;
			const component = factory(tui, theme, new KeybindingsManager(), (value) => {
				reported = value;
			});
			log.renders.push(component.render(160).join("\n"));
			const answer = script.custom.shift();
			if (typeof answer !== "function") return answer;
			const driven = answer(component);
			return driven ?? reported;
		},
	} as unknown as ExtensionUIContext;
	const notes = () => log.notes.map((note) => note.message);
	return { ui, script, log, notes };
}

/** An environment for a direct save on the session, with its own recording UI. */
function environment(session: AgentSession, service: SubagentService) {
	const scripted = scriptedUi();
	const env: SettingsMenuEnvironment = {
		ui: scripted.ui,
		service,
		settingsManager: session.settingsManager,
		viewerState: {},
	};
	return { env, ...scripted };
}

const parse = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

/** Runs `/agents` in tui mode and opens its Settings entry. */
async function openSettings(
	session: AgentSession,
	answers: { custom: ReturnType<typeof scriptedUi>["script"]["custom"]; input?: Array<string | undefined> },
) {
	const scripted = scriptedUi();
	await session.bindExtensions({ uiContext: scripted.ui, mode: "tui" });
	scripted.script.select.push("Settings", undefined);
	scripted.script.custom.push(...answers.custom, undefined);
	scripted.script.input.push(...(answers.input ?? []));
	await session.prompt("/agents");
	return scripted;
}

describe("the /agents settings menu", () => {
	it("writes only the changed key into the project's own values, copies no global value, and keeps every other key", async () => {
		const project = {
			theme: "dark",
			forkBuiltins: { other: { keep: [1, 2] }, subagents: { graceTurns: 7 } },
			enabledModels: ["faux/*"],
		};
		const { session, service, projectFile } = await fileSession({
			global: { forkBuiltins: { subagents: { showCost: true, maxConcurrent: 3 } } },
			project: JSON.stringify(project, null, 2),
		});
		const { env, notes } = environment(session, service);
		await expect(saveSubagentSetting(env, "maxConcurrent", 5)).resolves.toBe(true);
		const saved = parse(projectFile);
		expect(saved).toEqual({
			...project,
			forkBuiltins: { other: { keep: [1, 2] }, subagents: { graceTurns: 7, maxConcurrent: 5 } },
		});
		expect(notes()).toEqual(["Max concurrency set to 5"]);
	});

	it("rereads the saved value into the service, and announces the change once", async () => {
		const { session, service } = await fileSession({ project: "{}" });
		const changes: unknown[] = [];
		service.eventBus?.on("subagents:settings_changed", (payload) => changes.push(payload));
		const { env } = environment(session, service);
		expect(service.settings.maxConcurrent).toBe(10);
		await saveSubagentSetting(env, "maxConcurrent", 4);
		expect(service.settings.maxConcurrent).toBe(4);
		expect(changes).toEqual([{ settings: expect.objectContaining({ maxConcurrent: 4 }), persisted: true }]);
	});

	it("asks for a number again until it passes the reader's checks, then saves it", async () => {
		const { session, service, projectFile } = await fileSession({ project: "{}" });
		const scripted = await openSettings(session, {
			custom: [{ key: "maxConcurrent" }],
			input: ["0", "many", "  6 "],
		});
		expect(scripted.log.inputs).toEqual([
			"Max concurrency (1+)",
			"Max concurrency (1+): maxConcurrent must be an integer from 1 to 1024",
			"Max concurrency (1+): maxConcurrent must be an integer from 1 to 1024",
		]);
		expect(parse(projectFile)).toEqual({ forkBuiltins: { subagents: { maxConcurrent: 6 } } });
		expect(service.settings.maxConcurrent).toBe(6);
		expect(scripted.notes()).toContain("Max concurrency set to 6");
		// The list reopens after the save.
		expect(scripted.log.renders).toHaveLength(2);
	});

	it("shows an untrusted project's effective values read-only, with a notice, and writes nothing", async () => {
		const project = JSON.stringify({ forkBuiltins: { subagents: { maxConcurrent: 2 } } });
		const { session, service, projectFile } = await fileSession({
			global: { forkBuiltins: { subagents: { maxConcurrent: 3 } } },
			project,
			projectTrusted: false,
		});
		const scripted = await openSettings(session, {
			// Enter on a boolean row: a read-only row cycles nothing and reports nothing.
			custom: [
				(component) => {
					for (let row = 0; row < 6; row++) component.handleInput?.("\x1b[B");
					component.handleInput?.("\r");
					return undefined;
				},
			],
		});
		const [render] = scripted.log.renders;
		expect(render).toContain("This project is not trusted: the effective settings are shown read-only.");
		expect(render).toMatch(/Max concurrency\s+3/);
		expect(render).toMatch(/Background by default\s+on/);
		const { env, log } = environment(session, service);
		await expect(saveSubagentSetting(env, "maxConcurrent", 5)).resolves.toBe(false);
		expect(log.notes).toEqual([
			{ message: "This project is not trusted: the effective settings are shown read-only.", type: "warning" },
		]);
		expect(readFileSync(projectFile, "utf8")).toBe(project);
		expect(service.settings.maxConcurrent).toBe(3);
	});

	it("warns and changes nothing when the project settings.json holds no JSON object", async () => {
		const project = "[1, 2]\n";
		const { session, service, projectFile } = await fileSession({ project });
		const { env, log } = environment(session, service);
		await expect(saveSubagentSetting(env, "showCost", true)).resolves.toBe(false);
		expect(log.notes).toEqual([
			{
				message: "Subagent settings not saved: The project settings.json does not hold a JSON object",
				type: "warning",
			},
		]);
		expect(readFileSync(projectFile, "utf8")).toBe(project);
		expect(service.settings.showCost).toBe(false);
	});

	it("shows pi-subagents' toast for each key's change", async () => {
		const { session, service } = await fileSession({ project: "{}" });
		const { env, notes } = environment(session, service);
		const changes: Array<[keyof SubagentSettings, SubagentSettings[keyof SubagentSettings], string]> = [
			["maxConcurrent", 4, "Max concurrency set to 4"],
			["maxConcurrentForeground", 0, "Max foreground concurrency set to unlimited"],
			["maxConcurrentForeground", 2, "Max foreground concurrency set to 2"],
			["defaultMaxTurns", 0, "Default max turns set to unlimited"],
			["defaultMaxTurns", 30, "Default max turns set to 30"],
			["graceTurns", 3, "Grace turns set to 3"],
			["maxSubagentDepth", 1, "Nested delegation disabled"],
			["maxSubagentDepth", 3, "Nested depth set to 3. Applies to agents started from now on."],
			["defaultJoinMode", "group", "Default join mode set to group"],
			["backgroundByDefault", false, "Agent calls block and return inline unless they pass run_in_background: true"],
			["backgroundByDefault", true, "Agent calls run in the background unless they pass run_in_background: false"],
			["scopeModels", true, "Scope models enabled"],
			["strictAgentFiles", true, "Strict agent files enabled"],
			["disableDefaultAgents", false, "Default agents enabled. Tool spec change takes effect on next pi session."],
			["fallbackSubagent", "none", "Unknown or disabled agent types will now be rejected"],
			["fallbackSubagent", "worker", "Unknown agent types will fall back to worker"],
			["outputTranscript", false, "Output transcript disabled by default"],
			["worktreeIsolation", false, "Worktree isolation disabled. Tool parameter updates on next pi session."],
			["reportUsage", true, "Subagent usage now counted in this session's totals"],
			["reportUsage", false, "Subagent usage no longer counted in this session's totals"],
			["showCost", true, "Cost display enabled"],
			["showModel", true, "Model display enabled"],
			["viewerMarkdown", "all", "Viewer markdown set to all"],
			["fleetView", false, "Fleet view disabled"],
			["agentMentions", "off", "Agent mentions disabled"],
			["agentMentions", "direct", "Agent mentions on: a mentioned agent starts here, with no model call"],
			["agentMentions", "model", "Agent mentions on: a conversation clone starts a mentioned agent off-screen"],
			["rememberAgents", false, "Remember agents disabled"],
			["widgetMode", "all", "Widget set to all"],
			["toolDescriptionMode", "compact", "Tool description set to compact. Takes effect on next pi session."],
		];
		env.viewerState.markdownMode = "off";
		for (const [key, value] of changes) await saveSubagentSetting(env, key, value);
		expect(notes()).toEqual(changes.map(([, , toast]) => toast));
		expect(new Set(changes.map(([key]) => key)).size).toBe(22);
		// A saved Markdown mode replaces the one the viewer's key chose for the session.
		expect(env.viewerState.markdownMode).toBeUndefined();
		expect(service.settings).toMatchObject({ viewerMarkdown: "all", toolDescriptionMode: "compact" });
	});

	it("reloads the definitions after a save, so disabling the defaults drops them from the roster", async () => {
		const { session, service } = await fileSession({ project: "{}" });
		const { env, notes } = environment(session, service);
		service.refreshDefinitions();
		expect(listedAgentTypes(service.registry)).toEqual(["general-purpose", "Explore", "Plan", "worker"]);
		await saveSubagentSetting(env, "disableDefaultAgents", true);
		expect(listedAgentTypes(service.registry)).toEqual(["worker"]);
		expect(notes()).toEqual(["Default agents disabled. Tool spec change takes effect on next pi session."]);
	});
});

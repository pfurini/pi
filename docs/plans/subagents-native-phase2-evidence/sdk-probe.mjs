// Checks the subagents presentation in a session the built SDK creates (phase 2 plan, D39).
//
//   node sdk-probe.mjs <coding-agent dist dir> <on|off>
//
// `on` expects the three subagent base tools with `sourceInfo.path` `<builtin:NAME>`, and the
// `<inline:subagents>` factory with its `agents` command and its `subagent-notification` renderer.
// The probe binds a fake TUI context, starts one background `Agent` call whose child blocks, and
// expects the factory to set the `agents` widget. It then quits the session: the child's extension
// takes 300 ms in `session_shutdown`, and `session.shutdown()` must resolve only after that handler
// finished. `off` expects no subagent tool and no `<inline:subagents>`, as under
// `PI_FORK_BUILTINS=off`. The session runs on a faux provider, with in-memory settings and session
// managers and subagent transcripts off. The probe creates its agent, working and extension
// directories and removes them before it exits. It prints one JSON line and exits 0 on a match,
// 1 on a mismatch and 2 on bad input.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai/compat";

const TOOLS = ["Agent", "get_subagent_result", "steer_subagent"];

const [dist, mode] = process.argv.slice(2);
if (!dist || !["on", "off"].includes(mode) || !existsSync(resolve(dist, "index.js"))) {
	process.stderr.write("usage: sdk-probe.mjs <dist> <on|off>\n");
	process.exit(2);
}

const sdk = await import(pathToFileURL(resolve(dist, "index.js")).href);
const agentDir = mkdtempSync(join(tmpdir(), "sn2-sdk-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "sn2-sdk-cwd-"));
const extensionDir = mkdtempSync(join(tmpdir(), "sn2-sdk-ext-"));
const faux = registerFauxProvider({ models: [{ id: "probe-faux" }] });
const model = faux.getModel();
const errors = [];
globalThis.__sn2Probe = { childShutdownDone: false };
let report;
try {
	// The child loads only this extension: the agent file names its path, and nothing else.
	const extension = join(extensionDir, "slow-shutdown.ts");
	writeFileSync(
		extension,
		'export default function (pi) {\n\tpi.on("session_shutdown", async () => {\n\t\tawait new Promise((resolve) => setTimeout(resolve, 300));\n\t\tglobalThis.__sn2Probe.childShutdownDone = true;\n\t});\n}\n',
	);
	mkdirSync(join(agentDir, "agents"));
	writeFileSync(
		join(agentDir, "agents", "probe.md"),
		`---\ndescription: probe agent\ntools: read\nextensions: [${JSON.stringify(extension)}]\n---\nYou are the probe agent.`,
	);
	const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
	modelRuntime.registerProvider(model.provider, {
		baseUrl: model.baseUrl,
		apiKey: "faux-key",
		api: faux.api,
		models: faux.models.map((entry) => ({
			id: entry.id,
			name: entry.name,
			api: entry.api,
			reasoning: entry.reasoning,
			input: entry.input,
			cost: entry.cost,
			contextWindow: entry.contextWindow,
			maxTokens: entry.maxTokens,
		})),
	});
	const { session, extensionsResult } = await sdk.createAgentSession({
		cwd,
		agentDir,
		model,
		modelRuntime,
		sessionManager: sdk.SessionManager.inMemory(),
		settingsManager: sdk.SettingsManager.inMemory({ forkBuiltins: { subagents: { outputTranscript: false } } }),
	});
	errors.push(...extensionsResult.errors.map((error) => `${error.path}: ${error.error}`));
	const sources = Object.fromEntries(
		TOOLS.map((name) => [name, session.getAllTools().find((info) => info.name === name)?.sourceInfo?.path ?? "none"]),
	);
	const factory = extensionsResult.extensions.find((extension) => extension.path === "<inline:subagents>");
	const presentation = {
		loaded: factory !== undefined,
		command: factory?.commands.has("agents") ?? false,
		renderer: factory?.messageRenderers.has("subagent-notification") ?? false,
	};
	let widget = false;
	let quitAwaited = false;
	if (mode === "on") {
		// Own properties only: the extension runner spreads the context it wraps.
		const uiContext = {
			notify: () => {},
			setStatus: () => {},
			onTerminalInput: () => () => {},
			setWidget: (key, content) => {
				if (key === "agents" && content !== undefined) widget = true;
			},
		};
		await session.bindExtensions({ uiContext, mode: "tui" });
		let parentTurns = 0;
		let childRequested = false;
		faux.setResponses(
			Array.from({ length: 6 }, () => (context, options) => {
				if (getCurrentSystemPrompt(context.messages).includes("<active_agent")) {
					// The child blocks until the session's end aborts it.
					childRequested = true;
					return new Promise((resolveChild) =>
						options?.signal?.addEventListener("abort", () => resolveChild(fauxAssistantMessage("")), { once: true }),
					);
				}
				parentTurns++;
				return parentTurns === 1
					? fauxAssistantMessage(
							[
								fauxToolCall("Agent", {
									subagent_type: "probe",
									prompt: "block",
									description: "probe task",
									run_in_background: true,
								}),
							],
							{ stopReason: "toolUse" },
						)
					: fauxAssistantMessage("parent done");
			}),
		);
		await session.prompt("start the probe agent");
		const deadline = Date.now() + 10_000;
		// Quit once the child runs, so the teardown this probe measures is a running child's.
		while (!(widget && childRequested) && Date.now() < deadline) {
			await new Promise((resolveWait) => setTimeout(resolveWait, 50));
		}
		await session.shutdown();
		quitAwaited = globalThis.__sn2Probe.childShutdownDone;
	} else {
		session.dispose();
	}
	report = { switch: process.env.PI_FORK_BUILTINS ?? "unset", mode, sources, presentation, widget, quitAwaited, errors };
} catch (error) {
	report = { switch: process.env.PI_FORK_BUILTINS ?? "unset", mode, errors: [...errors, String(error?.message ?? error)] };
} finally {
	faux.unregister();
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
	rmSync(extensionDir, { recursive: true, force: true });
}

const on = mode === "on";
report.pass =
	report.errors.length === 0 &&
	report.sources !== undefined &&
	TOOLS.every((name) => report.sources[name] === (on ? `<builtin:${name}>` : "none")) &&
	(on
		? report.presentation.loaded &&
			report.presentation.command &&
			report.presentation.renderer &&
			report.widget &&
			report.quitAwaited
		: !report.presentation.loaded);
console.log(JSON.stringify(report));
process.exit(report.pass ? 0 : 1);

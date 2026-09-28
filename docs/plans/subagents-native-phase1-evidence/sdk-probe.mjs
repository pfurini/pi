// Checks the subagent base tools in a session the built SDK creates (plan T11).
//
//   node sdk-probe.mjs <coding-agent dist dir> <on|off>
//
// `on` expects `Agent`, `get_subagent_result` and `steer_subagent` with `sourceInfo.path`
// `<builtin:NAME>`. Every loaded extension must have an `<inline:` path. One foreground `Agent`
// call must return the scripted child text. `off` expects none of the three tools, as under
// `PI_FORK_BUILTINS=off`. The session runs on a faux provider and in-memory settings and session
// managers. Its settings turn subagent transcripts off, so nothing lands in the OS temp directory.
// The probe creates its agent and working directories and removes them before it exits. The dist
// path may be relative to the working directory. The probe prints one JSON line. It exits 0 on a
// match, 1 on a mismatch and 2 on bad input.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai/compat";

const TOOLS = ["Agent", "get_subagent_result", "steer_subagent"];
const CHILD_TEXT = "probe child text";

const [dist, mode] = process.argv.slice(2);
if (!dist || !["on", "off"].includes(mode) || !existsSync(resolve(dist, "index.js"))) {
	process.stderr.write("usage: sdk-probe.mjs <dist> <on|off>\n");
	process.exit(2);
}

const sdk = await import(pathToFileURL(resolve(dist, "index.js")).href);
const agentDir = mkdtempSync(join(tmpdir(), "sn-sdk-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "sn-sdk-cwd-"));
const faux = registerFauxProvider({ models: [{ id: "probe-faux" }] });
const model = faux.getModel();
const errors = [];
let report;
try {
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
	const extensions = extensionsResult.extensions.map((extension) => extension.path);
	let childText = "";
	if (mode === "on") {
		// Parent turn, child turn, parent turn: the foreground call keeps the parent waiting on its child.
		faux.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("Agent", {
						subagent_type: "general-purpose",
						prompt: "answer the probe",
						description: "probe task",
						run_in_background: false,
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(CHILD_TEXT),
			fauxAssistantMessage("parent done"),
		]);
		await session.prompt("delegate the probe task");
		const result = session.messages.find((message) => message.role === "toolResult" && message.toolName === "Agent");
		childText = (result?.content ?? [])
			.map((part) => (part.type === "text" ? part.text : ""))
			.join("")
			.trim();
	}
	report = { switch: process.env.PI_FORK_BUILTINS ?? "unset", mode, sources, extensions, childText, errors };
	session.dispose();
} catch (error) {
	report = { switch: process.env.PI_FORK_BUILTINS ?? "unset", mode, errors: [...errors, String(error?.message ?? error)] };
} finally {
	faux.unregister();
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
}

const on = mode === "on";
report.pass =
	report.errors.length === 0 &&
	report.sources !== undefined &&
	TOOLS.every((name) => report.sources[name] === (on ? `<builtin:${name}>` : "none")) &&
	(!on || (report.extensions.every((path) => path.startsWith("<inline:")) && report.childText.endsWith(CHILD_TEXT)));
console.log(JSON.stringify(report));
process.exit(report.pass ? 0 : 1);

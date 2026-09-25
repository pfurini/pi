// C3, C4 and the SDK half of C5, from compiled output under plain Node.
// Usage: node spike/harness/c3-c5-sdk.mjs <label> [sdk entry]   (run from the worktree root)
// The SDK entry defaults to packages/coding-agent/dist/index.js, reached by absolute path.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const label = process.argv[2];
if (!label) throw new Error("candidate label required");
const root = process.cwd();
const sdkEntry = resolve(process.argv[3] ?? join(root, "packages/coding-agent/dist/index.js"));
// T6 copy: run with PI_FORK_BUILTINS=off; the fixture arrives through additionalExtensionPaths.
const out = join(root, "spike/runs", `${label}-C3-C5-sdk-off.json`);
const record = { label, sdkEntry, node: process.version, execArgv: process.execArgv, steps: [] };
const step = (name, data) => {
	record.steps.push({ name, ...data });
	console.log(`${name}: ${JSON.stringify(data)}`);
};

const agentDir = mkdtempSync(join(tmpdir(), "spike-0001-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "spike-0001-cwd-"));
writeFileSync(join(agentDir, "settings.json"), '{\n  "packages": []\n}\n');
step("setup", { agentDir, cwd });

const sdk = await import(pathToFileURL(sdkEntry).href);
const { createAgentSessionServices, createAgentSessionFromServices, SessionManager, SettingsManager, DefaultResourceLoader } =
	sdk;

// The OpenIntent worker's discovery settings (worker-entry.ts): every discovery switch off.
const discoveryOff = {
	noExtensions: true,
	noSkills: true,
	noPromptTemplates: true,
	noThemes: true,
	noContextFiles: true,
	additionalExtensionPaths: [join(root, "packages/builtins/spike-fixture-provider/index.ts")],
};

async function servicesSession(tools) {
	const services = await createAgentSessionServices({
		cwd,
		agentDir,
		settingsManager: SettingsManager.inMemory({}),
		resourceLoaderOptions: discoveryOff,
	});
	const extensions = services.resourceLoader.getExtensions();
	const model = services.modelRuntime.getModel("spike-fixture", "echo");
	const { session } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(),
		model,
		tools,
	});
	return { services, extensions, model, session };
}

try {
	// C3, first session: the allowlist omits ask_user_question.
	const first = await servicesSession(["read"]);
	step("C3-session-without", {
		extensionPaths: first.extensions.extensions.map((e) => e.path),
		extensionErrors: first.extensions.errors,
		registry: first.session.getAllTools().map((t) => t.name),
		active: first.session.getActiveToolNames(),
	});
	// C5, SDK half: the fixture provider resolves through the services model runtime.
	step("C5-sdk-getModel", {
		resolved: first.model ? { provider: first.model.provider, id: first.model.id } : null,
	});
	first.session.dispose();

	// C3, second session: the allowlist includes ask_user_question.
	const second = await servicesSession(["read", "ask_user_question"]);
	step("C3-session-with", {
		registry: second.session.getAllTools().map((t) => t.name),
		active: second.session.getActiveToolNames(),
	});
	// Supporting: one turn through the fixture provider on the SDK path.
	let reply = "";
	const unsubscribe = second.session.subscribe((event) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			reply = event.message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
		}
	});
	await second.session.prompt("sdk path hello");
	unsubscribe();
	step("C5-sdk-turn", { reply });
	second.session.dispose();

	// C4: a loader constructed here, outside packages/coding-agent, in the same process.
	const loader = new DefaultResourceLoader({ cwd, agentDir, noExtensions: true });
	await loader.reload();
	const loaded = loader.getExtensions();
	step("C4-third-party-loader", {
		extensions: loaded.extensions.map((e) => ({ path: e.path, hidden: e.hidden === true, tools: [...e.tools.keys()] })),
		errors: loaded.errors,
	});
	loader.dispose?.();
} catch (error) {
	step("error", { message: error instanceof Error ? error.stack : String(error) });
	process.exitCode = 1;
} finally {
	writeFileSync(out, `${JSON.stringify(record, null, "\t")}\n`);
	console.log(`raw: ${out}`);
	setTimeout(() => process.exit(), 200);
}

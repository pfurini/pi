// Checks which ask_user_question a session built by the SDK gets.
//
//   node sdk-probe.mjs <coding-agent dist dir> <custom|default|override> <expected source|none>
//
// `custom` builds the session on a ResourceLoader written from scratch, which loads no
// extension. `default` uses DefaultResourceLoader, which loads the fork's built-in packages.
// `override` uses DefaultResourceLoader with an `extensionsOverride` that removes every
// extension. The dist path may be relative to the working directory.
// The expected source is the tool's `sourceInfo.path`, e.g. `<builtin:ask_user_question>`, or
// `none` when the tool must be absent. A present tool must also be active, and an absent one
// inactive. Prints one JSON line and exits 0 on a match, 1 on a mismatch, 2 on bad input. Its temporary directories are removed before it exits.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [dist, loaderKind, expected] = process.argv.slice(2);
if (!dist || !["custom", "default", "override"].includes(loaderKind) || !expected) {
	process.stderr.write("usage: sdk-probe.mjs <dist> <custom|default|override> <expected source|none>\n");
	process.exit(2);
}

const sdk = await import(pathToFileURL(resolve(dist, "index.js")).href);
const agentDir = mkdtempSync(join(tmpdir(), "aubt-sdk-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "aubt-sdk-cwd-"));
const errors = [];
let report;
try {
	let resourceLoader;
	if (loaderKind === "custom") {
		const eventBus = sdk.createEventBus();
		resourceLoader = {
			getExtensions: () => ({ extensions: [], errors: [], runtime: sdk.createExtensionRuntime() }),
			getEventBus: () => eventBus,
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
	} else {
		resourceLoader = new sdk.DefaultResourceLoader({
			cwd,
			agentDir,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			...(loaderKind === "override" && { extensionsOverride: (base) => ({ ...base, extensions: [] }) }),
		});
		await resourceLoader.reload();
		errors.push(...resourceLoader.getExtensions().errors.map((error) => error.path));
	}
	const { session } = await sdk.createAgentSession({
		cwd,
		agentDir,
		resourceLoader,
		sessionManager: sdk.SessionManager.inMemory(),
		settingsManager: sdk.SettingsManager.inMemory(),
	});
	const tool = session.getAllTools().find((info) => info.name === "ask_user_question");
	report = {
		switch: process.env.PI_FORK_BUILTINS ?? "unset",
		loader: loaderKind,
		source: tool?.sourceInfo?.path ?? "none",
		active: session.getActiveToolNames().includes("ask_user_question"),
		errors,
	};
	session.dispose();
} catch (error) {
	report = { loader: loaderKind, source: "none", errors: [...errors, String(error?.message ?? error)] };
} finally {
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
}
report.expected = expected;
report.pass = report.source === expected && report.active === (expected !== "none") && report.errors.length === 0;
console.log(JSON.stringify(report));
process.exit(report.pass ? 0 : 1);

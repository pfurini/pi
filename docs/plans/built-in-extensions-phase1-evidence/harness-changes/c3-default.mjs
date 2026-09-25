// T6 supplement to C3: an SDK services session created without a `tools` option.
// Checks that a built-in tool is present by default in getAllTools() and active.
// Usage: node spike/harness/c3-default.mjs <label>   (run from the worktree root)
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const label = process.argv[2];
if (!label) throw new Error("label required");
const root = process.cwd();
const out = join(root, "spike/runs", `${label}-C3-default.json`);
const { createAgentSessionServices, createAgentSessionFromServices, SessionManager, SettingsManager } = await import(
	pathToFileURL(join(root, "packages/coding-agent/dist/index.js")).href
);
const agentDir = mkdtempSync(join(tmpdir(), "pi-builtins-t6-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "pi-builtins-t6-cwd-"));
writeFileSync(join(agentDir, "settings.json"), '{\n  "packages": []\n}\n');
const services = await createAgentSessionServices({
	cwd,
	agentDir,
	settingsManager: SettingsManager.inMemory({}),
	resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
});
const { session } = await createAgentSessionFromServices({
	services,
	sessionManager: SessionManager.inMemory(),
	model: services.modelRuntime.getModel("spike-fixture", "echo"),
});
const record = {
	label,
	agentDir,
	cwd,
	extensions: services.resourceLoader.getExtensions().extensions.map((e) => e.path),
	errors: services.resourceLoader.getExtensions().errors,
	getAllTools: session.getAllTools().map((t) => t.name),
	active: session.getActiveToolNames(),
};
writeFileSync(out, `${JSON.stringify(record, null, "\t")}\n`);
console.log(JSON.stringify(record));
session.dispose();
setTimeout(() => process.exit(), 200);

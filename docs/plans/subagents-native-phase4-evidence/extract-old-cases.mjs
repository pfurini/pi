// Lists every test case of the 25 pi-tasks test files at commit 83480bd, as "<file>\t<describe path> > <test title>" lines, in file order. It parses each
// file with the TypeScript compiler API, resolved from this repository's node_modules.
//
//   node extract-old-cases.mjs <pi-tasks checkout>
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = process.argv[2];
if (!repo) {
	process.stderr.write("usage: extract-old-cases.mjs <pi-tasks checkout>\n");
	process.exit(2);
}
const FILES = [
	"test/agent-reattach.test.ts",
	"test/auto-cascade.test.ts",
	"test/auto-clear-lifecycle.test.ts",
	"test/auto-clear.test.ts",
	"test/host-lifecycle.test.ts",
	"test/pi-versions.test.ts",
	"test/process-tracker.test.ts",
	"test/reminder-cadence.test.ts",
	"test/session-handoff.test.ts",
	"test/session-lifecycle.test.ts",
	"test/stale-task-reminder.test.ts",
	"test/store-scope.test.ts",
	"test/subagent-integration.test.ts",
	"test/subagent-result-consumption.test.ts",
	"test/subagents-e2e.test.ts",
	"test/task-glyphs.test.ts",
	"test/task-output-stop.test.ts",
	"test/task-paths.test.ts",
	"test/task-sort.test.ts",
	"test/task-store-concurrency.test.ts",
	"test/task-store.test.ts",
	"test/task-widget-lifecycle.test.ts",
	"test/task-widget.test.ts",
	"test/tasks-command.test.ts",
	"test/tasks-config.test.ts",
];

/** The call's base name (`describe`, `it`, `test`) when it declares a suite or a case. */
function kindOf(callee) {
	// describe.each(table)(title, fn): the callee is itself a call.
	if (ts.isCallExpression(callee)) return kindOf(callee.expression);
	if (ts.isPropertyAccessExpression(callee)) return kindOf(callee.expression);
	if (ts.isIdentifier(callee) && ["describe", "it", "test"].includes(callee.text)) return callee.text;
	return undefined;
}

function titleOf(node, source) {
	if (!node) return "<no title>";
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	if (ts.isTemplateExpression(node)) return node.getText(source).slice(1, -1);
	return node.getText(source);
}

for (const file of FILES) {
	const text = execFileSync("git", ["-C", repo, "show", `83480bd:${file}`], { encoding: "utf8" });
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const visit = (node, path) => {
		if (ts.isCallExpression(node)) {
			const kind = kindOf(node.expression);
			// Skip the inner `describe.each(table)` call; its outer call carries the title.
			const isTableCall = ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "each";
			if (kind && !isTableCall) {
				const title = titleOf(node.arguments[0], source);
				if (kind === "describe") {
					for (const arg of node.arguments.slice(1)) visit(arg, [...path, title]);
					return;
				}
				console.log(`${file}\t${[...path, title].join(" > ")}`);
				return;
			}
		}
		ts.forEachChild(node, (child) => visit(child, path));
	};
	visit(source, []);
}

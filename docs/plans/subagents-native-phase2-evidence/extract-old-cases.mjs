// Lists every test case of the 12 pi-subagents test files the phase 1 checklist marks `Phase 2`, at
// commit 79a7c42, as "<file>\t<describe path> > <test title>" lines, in file order. It parses each
// file with the TypeScript compiler API, resolved from this repository's node_modules.
//
//   node extract-old-cases.mjs <pi-subagents checkout>
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = process.argv[2];
if (!repo) {
	process.stderr.write("usage: extract-old-cases.mjs <pi-subagents checkout>\n");
	process.exit(2);
}
const FILES = [
	"test/agent-color.test.ts",
	"test/agent-color-surfaces.test.ts",
	"test/agent-file-toggle.test.ts",
	"test/agent-model-display.test.ts",
	"test/agent-widget.test.ts",
	"test/conversation-viewer.test.ts",
	"test/conversation-viewer-keybindings.test.ts",
	"test/cost-display.test.ts",
	"test/fleet-list.test.ts",
	"test/fleet-wiring.test.ts",
	"test/perf/no-fs-on-render.perf.test.ts",
	"test/perf/render-invariants.perf.test.ts",
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
	const text = execFileSync("git", ["-C", repo, "show", `79a7c42:${file}`], { encoding: "utf8" });
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

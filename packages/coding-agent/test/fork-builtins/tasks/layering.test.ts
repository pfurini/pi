/**
 * Fork-owned: the tasks module's layering (D47). Value imports only point down: the module root (0),
 * `service/` (1), `tools/` (2), `ui/` (3). No value import cycle exists. The subagents module never
 * imports the tasks module, and the tasks service never imports presentation code. Imports,
 * re-exports and side-effect imports count; type-only ones are erased and exempt.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../../src/core/fork-builtins/tasks");
const SUBAGENTS = resolve(__dirname, "../../../src/core/fork-builtins/subagents");

const LAYERS: Record<string, number> = {
	service: 1,
	tools: 2,
	ui: 3,
};

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return files(path);
		return path.endsWith(".ts") ? [path] : [];
	});
}

function layerOf(path: string): number {
	const top = relative(ROOT, path).split("/");
	return top.length === 1 ? 0 : (LAYERS[top[0]] ?? Number.NaN);
}

/** Whether `import { … }` or `export { … }` names only types, so the statement is erased. */
function onlyTypes(names: string): boolean {
	const inner = names.trim();
	return (
		inner.startsWith("{") &&
		inner
			.slice(1, -1)
			.split(",")
			.every((name) => !name.trim() || /^type\s/.test(name.trim()))
	);
}

/** The module files each file imports or re-exports at run time, side-effect imports included. */
function valueImports(root = ROOT, within = ROOT): Map<string, string[]> {
	const graph = new Map<string, string[]>();
	for (const file of files(root)) {
		const source = readFileSync(file, "utf8");
		const specs: string[] = [];
		for (const [, typeOnly, names, spec] of source.matchAll(
			// `[^;]` keeps a match inside one statement, so `export type X = …;` never swallows a later re-export.
			/^(?:import|export)\s+(type\s+)?([^;]*?)\s+from\s+"([^"]+)";/gm,
		)) {
			if (!typeOnly && !onlyTypes(names)) specs.push(spec);
		}
		for (const [, spec] of source.matchAll(/^import\s+"([^"]+)";/gm)) specs.push(spec);
		const edges = specs
			.filter((spec) => spec.startsWith("."))
			.map((spec) => resolve(dirname(file), spec))
			.filter((target) => target.startsWith(`${within}/`));
		graph.set(file, edges);
	}
	return graph;
}

describe("tasks module layering", () => {
	it("imports only from its own or a lower layer", () => {
		const upward: string[] = [];
		for (const [file, edges] of valueImports()) {
			for (const target of edges) {
				if (!(layerOf(target) <= layerOf(file)))
					upward.push(`${relative(ROOT, file)} -> ${relative(ROOT, target)}`);
			}
		}
		expect(upward).toEqual([]);
	});

	it("has no value import cycle", () => {
		const graph = valueImports();
		const cycles: string[] = [];
		const state = new Map<string, "open" | "done">();
		const stack: string[] = [];
		const visit = (node: string) => {
			if (state.get(node) === "done") return;
			if (state.get(node) === "open") {
				cycles.push([...stack.slice(stack.indexOf(node)), node].map((path) => relative(ROOT, path)).join(" -> "));
				return;
			}
			state.set(node, "open");
			stack.push(node);
			for (const next of graph.get(node) ?? []) visit(next);
			stack.pop();
			state.set(node, "done");
		};
		for (const node of graph.keys()) visit(node);
		expect(cycles).toEqual([]);
	});
	it("is never imported by the subagents module", () => {
		const edges = [...valueImports(SUBAGENTS, ROOT)].flatMap(([file, targets]) =>
			targets.map((target) => `${relative(SUBAGENTS, file)} -> ${relative(ROOT, target)}`),
		);
		expect(edges).toEqual([]);
	});

	it("keeps presentation code out of the service", () => {
		const service = join(ROOT, "service");
		const edges = [...valueImports(service, resolve(ROOT, ".."))]
			.flatMap(([file, targets]) => targets.map((target) => [file, target] as const))
			.filter(([, target]) => target.includes("/ui/"))
			.map(([file, target]) => `${relative(ROOT, file)} -> ${target}`);
		expect(edges).toEqual([]);
	});
});

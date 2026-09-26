import { expect, test } from "vitest";
import {
	evaluateGuard,
	extractBashSearchCandidate,
	extractSymbolCandidate,
} from "../../../src/core/fork-builtins/tokensave/guard.ts";

function baseParams(overrides: Partial<Parameters<typeof evaluateGuard>[0]> = {}) {
	return {
		toolName: "bash" as const,
		input: {},
		mode: "enforce" as const,
		tokensaveAvailable: true,
		projectInitialized: true,
		wasConsulted: () => false,
		...overrides,
	};
}

test("extractSymbolCandidate recognizes bare identifiers", () => {
	expect(extractSymbolCandidate("WellModel")).toBe("WellModel");
	expect(extractSymbolCandidate("generate_node_content")).toBe("generate_node_content");
});

test("extractSymbolCandidate recognizes declaration-style patterns", () => {
	expect(extractSymbolCandidate("class WellModel")).toBe("WellModel");
});

test("extractSymbolCandidate recognizes wildcard file-name searches", () => {
	expect(extractSymbolCandidate("*wellmodel*")).toBe("wellmodel");
});

test("extractSymbolCandidate ignores complex regex and short tokens", () => {
	expect(extractSymbolCandidate("^(foo|bar)\\d+$")).toBe(undefined);
	expect(extractSymbolCandidate("ab")).toBe(undefined);
});

test("extractBashSearchCandidate parses rg/grep/find invocations", () => {
	expect(extractBashSearchCandidate('rg "WellModel" .')).toBe("WellModel");
	expect(extractBashSearchCandidate('grep -R "class WellModel" .')).toBe("WellModel");
	expect(extractBashSearchCandidate('find . -iname "*wellmodel*"')).toBe("wellmodel");
	expect(extractBashSearchCandidate('rg "generate_node_content" backend')).toBe("generate_node_content");
});

test("extractBashSearchCandidate allows git grep", () => {
	expect(extractBashSearchCandidate('git grep "WellModel"')).toBe(undefined);
});

test("extractBashSearchCandidate allows complex pipelines", () => {
	expect(extractBashSearchCandidate('rg "WellModel" . | wc -l')).toBe(undefined);
	expect(extractBashSearchCandidate('rg "WellModel" . && echo done')).toBe(undefined);
});

test("extractBashSearchCandidate allows config/log/migration/markdown targets", () => {
	expect(extractBashSearchCandidate('rg "WellModel" docs/notes.md')).toBe(undefined);
	expect(extractBashSearchCandidate('rg "timeout" config.yaml')).toBe(undefined);
	expect(extractBashSearchCandidate('rg "WellModel" db/migrations/')).toBe(undefined);
	expect(extractBashSearchCandidate('grep "error" app.log')).toBe(undefined);
});

test("enforce mode blocks named-symbol search before TokenSave is consulted", () => {
	const decision = evaluateGuard(baseParams({ input: { command: 'rg "WellModel" .' } }));
	expect(decision.block).toBe(true);
	expect(decision.candidate).toBe("WellModel");
});

test("enforce mode blocks the built-in grep tool equivalent", () => {
	const decision = evaluateGuard(baseParams({ toolName: "grep", input: { pattern: "WellModel", path: "." } }));
	expect(decision.block).toBe(true);
});

test("enforce mode blocks the anchor_grep tool like the built-in grep", () => {
	const decision = evaluateGuard(
		baseParams({ toolName: "anchor_grep", input: { pattern: "class WellModel", path: "src" } }),
	);
	expect(decision.block).toBe(true);
	expect(decision.candidate).toBe("WellModel");
});

test("enforce mode allows anchor_grep over config files and complex regex", () => {
	expect(
		evaluateGuard(baseParams({ toolName: "anchor_grep", input: { pattern: "WellModel", glob: "*.yaml" } })).block,
	).toBe(false);
	expect(evaluateGuard(baseParams({ toolName: "anchor_grep", input: { pattern: "^(foo|bar)\\d+$" } })).block).toBe(
		false,
	);
});

test("enforce mode allows search after TokenSave was consulted for that symbol", () => {
	const decision = evaluateGuard(
		baseParams({ input: { command: 'rg "WellModel" .' }, wasConsulted: (c) => c === "WellModel" }),
	);
	expect(decision.block).toBe(false);
});

test("enforce mode allows fallback after TokenSave returned empty or errored (still counts as consulted)", () => {
	// The caller marks a query as consulted regardless of success/failure;
	// guard only checks whether it was consulted, not whether it succeeded.
	const decision = evaluateGuard(baseParams({ input: { command: 'rg "WellModel" .' }, wasConsulted: () => true }));
	expect(decision.block).toBe(false);
});

test("enforce mode allows complex regex", () => {
	const decision = evaluateGuard(baseParams({ input: { command: 'rg "^(foo|bar)\\\\d+$" .' } }));
	expect(decision.block).toBe(false);
});

test("enforce mode allows git grep", () => {
	const decision = evaluateGuard(baseParams({ input: { command: 'git grep "WellModel"' } }));
	expect(decision.block).toBe(false);
});

test("enforce mode allows logs and config files", () => {
	expect(evaluateGuard(baseParams({ input: { command: 'grep "error" app.log' } })).block).toBe(false);
	expect(evaluateGuard(baseParams({ input: { command: 'rg "timeout" config.yaml' } })).block).toBe(false);
});

test("enforce mode allows when TokenSave is not installed", () => {
	const decision = evaluateGuard(baseParams({ input: { command: 'rg "WellModel" .' }, tokensaveAvailable: false }));
	expect(decision.block).toBe(false);
});

test("enforce mode allows when project is not initialized", () => {
	const decision = evaluateGuard(baseParams({ input: { command: 'rg "WellModel" .' }, projectInitialized: false }));
	expect(decision.block).toBe(false);
});

test("prefer mode never blocks", () => {
	const decision = evaluateGuard(baseParams({ mode: "prefer", input: { command: 'rg "WellModel" .' } }));
	expect(decision.block).toBe(false);
});

/**
 * C3a (A.2/A.5/A.8) override-resolution pure helpers: model alias/id resolution,
 * effort integer clamp-map + model clamping, and the stacked disallowed-tools
 * union with redirect canonicalization. Outside test/suite/ per the harness rule
 * (these touch no session or provider).
 */

import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import type { SkillInvocation } from "../src/core/skills/runtime.ts";
import {
	computeDisallowedUnion,
	resolveActiveOverride,
	resolveEffortOverride,
	resolveModelOverride,
} from "../src/core/skills/skill-overrides.ts";
import { DEFAULT_TOOL_REDIRECTS } from "../src/core/skills/tool-redirects.ts";

function makeModel(id: string, opts: { reasoning?: boolean } = {}): Model<Api> {
	return {
		id,
		name: id,
		api: "openai-responses",
		provider: "test",
		baseUrl: "",
		reasoning: opts.reasoning ?? false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	} as Model<Api>;
}

const OPUS = makeModel("claude-opus-4-8", { reasoning: true });
const SONNET = makeModel("claude-sonnet-4-8", { reasoning: true });
const AVAILABLE = [OPUS, SONNET];
const CURRENT = SONNET;

function record(fields: Partial<SkillInvocation>): SkillInvocation {
	return {
		invocationId: "i",
		skillId: "s",
		name: "skill",
		baseDir: "/b",
		filePath: "/b/SKILL.md",
		rawArgs: "",
		...fields,
	};
}

describe("resolveModelOverride", () => {
	it("treats inherit/empty as no override", () => {
		expect(resolveModelOverride("inherit", { available: AVAILABLE, current: CURRENT }).model).toBeUndefined();
		expect(resolveModelOverride("  ", { available: AVAILABLE, current: CURRENT }).model).toBeUndefined();
		expect(resolveModelOverride("inherit", { available: AVAILABLE, current: CURRENT }).diagnostics).toHaveLength(0);
	});

	it("resolves a CC alias to a best-effort available model", () => {
		expect(resolveModelOverride("opus", { available: AVAILABLE, current: CURRENT }).model?.id).toBe(
			"claude-opus-4-8",
		);
	});

	it("resolves a Pi model id directly", () => {
		expect(resolveModelOverride("claude-sonnet-4-8", { available: AVAILABLE, current: CURRENT }).model?.id).toBe(
			"claude-sonnet-4-8",
		);
	});

	it("diagnoses and ignores an unmatched value", () => {
		const result = resolveModelOverride("no-such-model-xyz", { available: AVAILABLE, current: CURRENT });
		expect(result.model).toBeUndefined();
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0].message).toContain("no-such-model-xyz");
	});
});

describe("resolveEffortOverride", () => {
	it("clamp-maps integer budgets per A.2 with a diagnostic", () => {
		expect(resolveEffortOverride(1024, OPUS).thinkingLevel).toBe("low");
		expect(resolveEffortOverride(4096, OPUS).thinkingLevel).toBe("medium");
		expect(resolveEffortOverride(16384, OPUS).thinkingLevel).toBe("high");
		const big = resolveEffortOverride(50000, OPUS);
		// xhigh is unsupported without a thinkingLevelMap → clamps to high.
		expect(big.thinkingLevel).toBe("high");
		expect(big.diagnostics.some((d) => d.message.includes("clamp-maps"))).toBe(true);
	});

	it("passes level strings through and clamps to the model", () => {
		expect(resolveEffortOverride("high", OPUS).thinkingLevel).toBe("high");
		// xhigh not supported by a plain reasoning model → clamps down to high.
		expect(resolveEffortOverride("xhigh", OPUS).thinkingLevel).toBe("high");
	});

	it("clamps to off on a non-reasoning model", () => {
		expect(resolveEffortOverride("high", makeModel("m", { reasoning: false })).thinkingLevel).toBe("off");
	});

	it("diagnoses and ignores an unknown effort string", () => {
		const result = resolveEffortOverride("banana", OPUS);
		expect(result.thinkingLevel).toBeUndefined();
		expect(result.diagnostics).toHaveLength(1);
	});
});

describe("resolveActiveOverride", () => {
	it("resolves model first, then clamps effort against the resolved model", () => {
		const result = resolveActiveOverride(record({ model: "opus", effort: "high" }), {
			available: AVAILABLE,
			current: CURRENT,
		});
		expect(result.model?.id).toBe("claude-opus-4-8");
		expect(result.thinkingLevel).toBe("high");
	});

	it("leaves unset fields undefined", () => {
		const result = resolveActiveOverride(record({}), { available: AVAILABLE, current: CURRENT });
		expect(result.model).toBeUndefined();
		expect(result.thinkingLevel).toBeUndefined();
	});
});

describe("computeDisallowedUnion", () => {
	it("canonicalizes and unions a YAML list through the default redirect map", () => {
		const { union } = computeDisallowedUnion([record({ disallowedTools: ["Bash", "Task"] })], DEFAULT_TOOL_REDIRECTS);
		// Bash → bash, Task → Agent (lowercased).
		expect([...union].sort()).toEqual(["agent", "bash"]);
	});

	it("accepts a CSV string form", () => {
		const { union } = computeDisallowedUnion([record({ disallowedTools: "Bash, Read" })], DEFAULT_TOOL_REDIRECTS);
		expect([...union].sort()).toEqual(["bash", "read"]);
	});

	it("reduces a Tool(pattern) entry to the bare tool with a diagnostic", () => {
		const { union, diagnostics } = computeDisallowedUnion(
			[record({ disallowedTools: ["Bash(rm -rf)"] })],
			DEFAULT_TOOL_REDIRECTS,
		);
		expect([...union]).toEqual(["bash"]);
		expect(diagnostics.some((d) => d.message.includes("parenthesized pattern"))).toBe(true);
	});

	it("skips wildcard entries with a diagnostic", () => {
		const { union, diagnostics } = computeDisallowedUnion(
			[record({ disallowedTools: ["Bash*"] })],
			DEFAULT_TOOL_REDIRECTS,
		);
		expect(union.size).toBe(0);
		expect(diagnostics.some((d) => d.message.includes("wildcard"))).toBe(true);
	});

	it("honors a custom redirect map over the defaults", () => {
		const redirects = { ...DEFAULT_TOOL_REDIRECTS, Terminal: "bash" };
		const { union } = computeDisallowedUnion([record({ disallowedTools: ["Terminal"] })], redirects);
		expect([...union]).toEqual(["bash"]);
	});

	it("unions and dedupes across stacked records", () => {
		const { union } = computeDisallowedUnion(
			[record({ disallowedTools: ["Bash"] }), record({ disallowedTools: ["bash", "Read"] })],
			DEFAULT_TOOL_REDIRECTS,
		);
		expect([...union].sort()).toEqual(["bash", "read"]);
	});
});

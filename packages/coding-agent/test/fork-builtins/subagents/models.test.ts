// Fork-owned: subagent model resolution, model scope and the invocation merge (plan T2). Old
// pi-subagents tests at 79a7c42 this covers: model-resolver, model-scope, enabled-models,
// invocation-config.
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../../../src/core/fork-builtins/subagents/definitions/types.ts";
import {
	type InvocationParams,
	resolveInvocationConfig,
	resolveModel,
	resolveSpawnModel,
} from "../../../src/core/fork-builtins/subagents/settings/models.ts";

function model(provider: string, id: string, name = id): Model<Api> {
	return {
		id,
		name,
		api: "openai-completions",
		provider,
		baseUrl: "https://example.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
}

const haiku = model("anthropic", "claude-haiku-4-5", "Claude Haiku 4.5");
const haikuDated = model("anthropic", "claude-haiku-4-5-20251001", "Claude Haiku 4.5 (dated)");
const sonnet = model("anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6");
const routedOpus = model("openrouter", "claude-opus-4-6", "Claude Opus 4.6");
const available = [haiku, haikuDated, sonnet, routedOpus];

describe("model resolution", () => {
	it("prefers an exact match, then fuzzy under the provider, then any provider, else reports unavailable", () => {
		expect(resolveModel("anthropic/claude-haiku-4-5-20251001", available)).toBe(haikuDated);
		// The exact step decides when an earlier model's id spells the whole query.
		const lookalike = model("openrouter", "anthropic/claude-3");
		const direct = model("anthropic", "claude-3");
		expect(resolveModel("anthropic/claude-3", [lookalike, direct])).toBe(direct);
		expect(resolveModel("claude-sonnet-4-6-20250101", available)).toBe(sonnet);
		expect(resolveModel("ANTHROPIC/Claude-Haiku-4-5", available)).toBe(haiku);
		expect(resolveModel("anthropic/claude-haiku-4.5", available)).toBe(haiku);
		expect(resolveModel("haiku", available)).toBe(haiku);
		expect(resolveModel("sonnet", available)).toBe(sonnet);
		expect(resolveModel("anthropic/claude-opus-4.6", available)).toBe(routedOpus);
		const missing = resolveModel("google/gemini-9", available);
		expect(missing).toBe(
			'Model not found: "google/gemini-9".\n\nAvailable models:\n  anthropic/claude-haiku-4-5\n  anthropic/claude-haiku-4-5-20251001\n  anthropic/claude-sonnet-4-6\n  openrouter/claude-opus-4-6',
		);
	});
});

describe("model scope", () => {
	const base = {
		parentModel: sonnet,
		available,
		scopeModels: true,
		enabledModels: ["anthropic/claude-sonnet-4-6", "anthropic/claude-haiku-4-5"],
		agentLabel: "Explore",
	};

	it("refuses a caller's model outside enabledModels, listing the allowed models", () => {
		expect(resolveSpawnModel({ ...base, modelInput: "opus", fromCaller: true })).toEqual({
			ok: false,
			message:
				'Model not in scope: "opus".\n\nAllowed models (from enabledModels):\n  anthropic/claude-haiku-4-5\n  anthropic/claude-sonnet-4-6',
		});
		expect(resolveSpawnModel({ ...base, modelInput: "haiku", fromCaller: true })).toEqual({ ok: true, model: haiku });
		expect(resolveSpawnModel({ ...base, modelInput: "nothing-like-it", fromCaller: true })).toMatchObject({
			ok: false,
			message: expect.stringContaining('Model not found: "nothing-like-it"'),
		});
	});

	it("runs an out-of-scope frontmatter or inherited model with a warning", () => {
		expect(resolveSpawnModel({ ...base, modelInput: "openrouter/claude-opus-4-6", fromCaller: false })).toEqual({
			ok: true,
			model: routedOpus,
			warning: 'Agent "Explore" using out-of-scope model "openrouter/claude-opus-4-6"',
		});
		expect(resolveSpawnModel({ ...base, parentModel: routedOpus, fromCaller: false })).toEqual({
			ok: true,
			model: routedOpus,
			warning: 'Agent "Explore" using out-of-scope model "openrouter/claude-opus-4-6"',
		});
		// An agent file's unresolvable model falls back to the parent's.
		expect(resolveSpawnModel({ ...base, modelInput: "nothing-like-it", fromCaller: false })).toEqual({
			ok: true,
			model: sonnet,
		});
		expect(resolveSpawnModel({ ...base, scopeModels: false, modelInput: "opus", fromCaller: true })).toEqual({
			ok: true,
			model: routedOpus,
		});
		expect(resolveSpawnModel({ ...base, enabledModels: [], modelInput: "opus", fromCaller: true }).ok).toBe(true);
		expect(
			resolveSpawnModel({ ...base, enabledModels: ["anthropic/*"], modelInput: "opus", fromCaller: true }).ok,
		).toBe(false);
	});
});

function definition(overrides: Partial<AgentDefinition>): AgentDefinition {
	return {
		name: "locked",
		description: "locked",
		extensions: true,
		skills: true,
		systemPrompt: "",
		promptMode: "replace",
		enabled: true,
		hidden: false,
		source: { kind: "default" },
		...overrides,
	};
}

describe("invocation merge", () => {
	const options = { worktreeAllowed: true, defaultRunInBackground: true };
	const params: InvocationParams = {
		model: "haiku",
		thinking: "low",
		max_turns: 5,
		run_in_background: true,
		inherit_context: true,
		isolated: true,
		isolation: "worktree",
	};

	it("lets frontmatter win over a tool parameter for each locked field", () => {
		const locked = definition({
			model: "sonnet",
			thinking: "high",
			maxTurns: 30,
			runInBackground: false,
			inheritContext: false,
			isolated: false,
			isolation: "off",
		});
		expect(resolveInvocationConfig(locked, params, options)).toEqual({
			modelInput: "sonnet",
			modelFromParams: false,
			thinking: "high",
			maxTurns: 30,
			inheritContext: false,
			runInBackground: false,
			isolated: false,
			isolation: undefined,
			overridden: { thinking: "low", model: "haiku" },
		});
		expect(resolveInvocationConfig(definition({}), params, options)).toEqual({
			modelInput: "haiku",
			modelFromParams: true,
			thinking: "low",
			maxTurns: 5,
			inheritContext: true,
			runInBackground: true,
			isolated: true,
			isolation: "worktree",
			overridden: undefined,
		});
		expect(resolveInvocationConfig(definition({ isolation: "worktree" }), {}, options).isolation).toBe("worktree");
		expect(resolveInvocationConfig(definition({}), params, { ...options, worktreeAllowed: false }).isolation).toBe(
			undefined,
		);
		expect(resolveInvocationConfig(definition({}), {}, options).runInBackground).toBe(true);
		expect(
			resolveInvocationConfig(definition({}), {}, { ...options, defaultRunInBackground: false }).runInBackground,
		).toBe(false);
		expect(resolveInvocationConfig(definition({}), { thinking: "extreme" }, options).thinking).toBeUndefined();
	});
});

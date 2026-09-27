/**
 * Fork-owned: model resolution, model scope and the invocation merge for subagent spawns.
 * pi-subagents `src/model-resolver.ts`, `src/model-scope.ts` and `src/invocation-config.ts` at
 * 79a7c42 are the behavior reference. The allowed set comes from the session's
 * `settingsManager.getEnabledModels()` through core's own pattern resolution, instead of
 * pi-subagents' re-read of both settings files.
 */
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { resolveModelScopeFromModels } from "../../../model-resolver.ts";
import type { AgentDefinition } from "../definitions/types.ts";

export const THINKING_LEVELS: readonly ModelThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

export function isThinkingLevel(value: unknown): value is ModelThinkingLevel {
	return THINKING_LEVELS.includes(value as ModelThinkingLevel);
}

const normalize = (text: string) => text.toLowerCase().replace(/\./g, "-");

/**
 * Resolves a model name against the available models. Precedence: an exact `provider/id`, then
 * the best fuzzy match (`.` and `-` interchangeable, a trailing `-YYYYMMDD` optional), then, for a
 * `provider/id` that matched nothing, the same id under any provider. Returns an error message
 * listing the available models when nothing matches.
 */
export function resolveModel(input: string, available: readonly Model<Api>[]): Model<Api> | string {
	const slash = input.indexOf("/");
	if (slash !== -1) {
		const exact = available.find((model) => `${model.provider}/${model.id}`.toLowerCase() === input.toLowerCase());
		if (exact) return exact;
	}

	const query = normalize(input);
	let best: Model<Api> | undefined;
	let bestScore = 0;
	for (const model of available) {
		const id = normalize(model.id);
		const name = normalize(model.name ?? model.id);
		const full = normalize(`${model.provider}/${model.id}`);
		let score = 0;
		if (id === query || full === query) score = 100;
		else if (id.includes(query) || full.includes(query)) score = 60 + (query.length / id.length) * 30;
		else if (name.includes(query)) score = 40 + (query.length / name.length) * 20;
		else if (
			query
				.split(/[\s\-/]+/)
				.every(
					(part) =>
						/^\d{8}$/.test(part) ||
						id.includes(part) ||
						name.includes(part) ||
						model.provider.toLowerCase().includes(part),
				)
		) {
			score = 20;
		}
		if (score > bestScore) {
			bestScore = score;
			best = model;
		}
	}
	if (best) return best;

	if (slash !== -1) {
		const bare = resolveModel(input.slice(slash + 1), available);
		if (typeof bare !== "string") return bare;
	}
	const list = available
		.map((model) => `  ${model.provider}/${model.id}`)
		.sort()
		.join("\n");
	return `Model not found: "${input}".\n\nAvailable models:\n${list}`;
}

/** Canonical `provider/id` pairs that `enabledModels` allows, or undefined when nothing restricts the scope. */
export function allowedModelKeys(
	enabledModels: readonly string[] | undefined,
	available: readonly Model<Api>[],
): Set<string> | undefined {
	if (!enabledModels || enabledModels.length === 0) return undefined;
	const { scopedModels } = resolveModelScopeFromModels([...enabledModels], available);
	if (scopedModels.length === 0) return undefined;
	return new Set(scopedModels.map(({ model }) => `${model.provider}/${model.id}`.toLowerCase()));
}

export type SpawnModelResolution =
	| { ok: true; model: Model<Api> | undefined; warning?: string }
	| { ok: false; message: string };

export interface SpawnModelRequest {
	/** The effective `model` input: frontmatter first, then the caller's parameter. */
	modelInput?: string;
	/** Whether the input came from the caller rather than the agent file. */
	fromCaller: boolean;
	parentModel?: Model<Api>;
	available: readonly Model<Api>[];
	scopeModels: boolean;
	enabledModels?: readonly string[];
	agentLabel: string;
}

/**
 * The model a spawn runs on. A caller's unresolvable or out-of-scope model refuses the spawn. An
 * agent file's unresolvable model falls back to the parent's model. An out-of-scope model from the
 * agent file or the parent runs, with a warning: `scopeModels` guards the orchestrator's choices,
 * not the user's own configuration.
 */
export function resolveSpawnModel(request: SpawnModelRequest): SpawnModelResolution {
	let model = request.parentModel;
	if (request.modelInput) {
		const resolved = resolveModel(request.modelInput, request.available);
		if (typeof resolved !== "string") model = resolved;
		else if (request.fromCaller) return { ok: false, message: resolved };
	}
	if (!request.scopeModels || !model) return { ok: true, model };
	const allowed = allowedModelKeys(request.enabledModels, request.available);
	if (!allowed || allowed.has(`${model.provider}/${model.id}`.toLowerCase())) return { ok: true, model };
	if (request.fromCaller) {
		const list = [...allowed]
			.sort()
			.map((key) => `  ${key}`)
			.join("\n");
		return {
			ok: false,
			message: `Model not in scope: "${request.modelInput}".\n\nAllowed models (from enabledModels):\n${list}`,
		};
	}
	const label = request.modelInput ?? `${model.provider}/${model.id}`;
	return { ok: true, model, warning: `Agent "${request.agentLabel}" using out-of-scope model "${label}"` };
}

/** The spawn parameters an agent file can lock, as the `Agent` tool and RPC pass them. */
export interface InvocationParams {
	model?: string;
	thinking?: string;
	max_turns?: number;
	run_in_background?: boolean;
	inherit_context?: boolean;
	isolated?: boolean;
	/** Unvalidated on the RPC path; only the literal `worktree` requests one. */
	isolation?: unknown;
}

export interface InvocationConfig {
	modelInput?: string;
	modelFromParams: boolean;
	thinking?: ModelThinkingLevel;
	maxTurns?: number;
	inheritContext: boolean;
	runInBackground: boolean;
	isolated: boolean;
	isolation?: "worktree";
	/** Caller values an agent file outranked, kept so surfaces can say what was asked. */
	overridden?: { thinking?: string; model?: string };
}

/**
 * Merges an agent file and a call. Frontmatter is authoritative: `model`, `thinking`, `max_turns`,
 * `inherit_context`, `run_in_background`, `isolated` and `isolation` from the file win, and the
 * call fills only fields the file leaves unset. A file's `isolation: off` vetoes a caller's
 * worktree; `worktreeAllowed: false` drops any request silently.
 */
export function resolveInvocationConfig(
	definition: AgentDefinition | undefined,
	params: InvocationParams,
	options: { worktreeAllowed: boolean; defaultRunInBackground: boolean },
): InvocationConfig {
	const requestedIsolation = definition?.isolation ?? params.isolation;
	const paramThinking = isThinkingLevel(params.thinking) ? params.thinking : undefined;
	const overriddenThinking =
		definition?.thinking !== undefined && params.thinking !== undefined && definition.thinking !== params.thinking
			? params.thinking
			: undefined;
	const overriddenModel =
		definition?.model !== undefined && params.model !== undefined && definition.model !== params.model
			? params.model
			: undefined;
	return {
		modelInput: definition?.model ?? params.model,
		modelFromParams: definition?.model === undefined && params.model !== undefined,
		thinking: definition?.thinking ?? paramThinking,
		maxTurns: definition?.maxTurns ?? params.max_turns,
		inheritContext: definition?.inheritContext ?? params.inherit_context ?? false,
		runInBackground: definition?.runInBackground ?? params.run_in_background ?? options.defaultRunInBackground,
		isolated: definition?.isolated ?? params.isolated ?? false,
		isolation: requestedIsolation === "worktree" && options.worktreeAllowed ? "worktree" : undefined,
		overridden:
			overriddenThinking !== undefined || overriddenModel !== undefined
				? { thinking: overriddenThinking, model: overriddenModel }
				: undefined,
	};
}

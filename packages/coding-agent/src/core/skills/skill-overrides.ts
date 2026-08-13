/**
 * C3 (c3a) override resolution: pure helpers that turn an invocation record's
 * preserved `model`/`effort`/`disallowed-tools` fields into the concrete values
 * AgentSession applies to a turn's provider requests. No session or runtime
 * reference; every function is deterministic given its inputs.
 *
 * - `resolveModelOverride`: CC alias (`opus`/`sonnet`/`haiku`/`fable`) or Pi
 *   model id → a concrete available model; `inherit`/empty keeps the session
 *   model; an unmatched value is a diagnostic + ignore.
 * - `resolveEffortOverride`: integer budget clamp-map (A.2) or level string →
 *   thinking level, then clamped to the resolved model's supported levels.
 * - `resolveActiveOverride`: resolve model FIRST, then clamp effort against the
 *   resolved (possibly overridden) model (A.5).
 * - `computeDisallowedUnion`: union the redirect-canonicalized `disallowed-tools`
 *   across all active records (A.5), returning the normalize diagnostics.
 */

import { type Api, clampThinkingLevel, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai/compat";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import { parseModelPattern } from "../model-resolver.ts";
import { effortBudgetToLevel } from "./interop.ts";
import type { SkillInvocation } from "./runtime.ts";
import { normalizeDisallowedTools } from "./shell-injection.ts";
import { canonicalizeToolName } from "./tool-redirects.ts";

const VALID_THINKING_LEVELS: readonly ModelThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

/** Model resolution inputs: the available models to match against + the current session model. */
export interface ModelOverrideContext {
	available: readonly Model<Api>[];
	current: Model<Api>;
}

/**
 * Resolve a skill `model` override to a concrete model. `inherit`/empty keeps
 * the session model (no override). A CC alias or Pi id resolves through the same
 * matcher as model scoping; an unmatched value is a diagnostic + ignore.
 */
export function resolveModelOverride(
	raw: string,
	context: ModelOverrideContext,
): { model?: Model<Api>; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];
	const trimmed = raw.trim();
	if (trimmed === "" || trimmed.toLowerCase() === "inherit") {
		return { diagnostics };
	}
	const { model } = parseModelPattern(trimmed, [...context.available]);
	if (!model) {
		diagnostics.push({
			type: "warning",
			message:
				`skill model override "${raw}" matched no available model; ` +
				`keeping the session model "${context.current.provider}/${context.current.id}"`,
		});
		return { diagnostics };
	}
	return { model, diagnostics };
}

/**
 * Resolve a skill `effort` override to a thinking level clamped against the
 * given model. Integer budgets clamp-map per A.2 (with a diagnostic); level
 * strings pass through; an unrecognized string is a diagnostic + ignore.
 */
export function resolveEffortOverride(
	raw: string | number,
	model: Model<Api>,
): { thinkingLevel?: ModelThinkingLevel; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];
	const level = mapEffortToLevel(raw, diagnostics);
	if (level === undefined) {
		return { diagnostics };
	}
	return { thinkingLevel: clampThinkingLevel(model, level) as ModelThinkingLevel, diagnostics };
}

/** Map a raw effort value to a pre-clamp thinking level, or undefined to ignore. */
function mapEffortToLevel(raw: string | number, diagnostics: ResourceDiagnostic[]): ModelThinkingLevel | undefined {
	if (typeof raw === "number") {
		const mapped = effortBudgetToLevel(raw);
		diagnostics.push({
			type: "warning",
			message: `effort budget ${raw} clamp-maps to "${mapped}" (A.2)`,
		});
		return mapped;
	}
	const trimmed = raw.trim();
	if (trimmed === "") {
		return undefined;
	}
	const lowered = trimmed.toLowerCase();
	if ((VALID_THINKING_LEVELS as readonly string[]).includes(lowered)) {
		return lowered as ModelThinkingLevel;
	}
	diagnostics.push({
		type: "warning",
		message: `effort "${raw}" is not a known level (off/minimal/low/medium/high/xhigh/max) or integer budget; ignoring the override`,
	});
	return undefined;
}

/**
 * Resolve the model + effort override for one active invocation (A.5): resolve
 * the model FIRST, then clamp effort against the resolved (possibly overridden)
 * model. Fields the record does not set stay undefined (no override).
 */
export function resolveActiveOverride(
	record: SkillInvocation,
	context: ModelOverrideContext,
): { model?: Model<Api>; thinkingLevel?: ModelThinkingLevel; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];
	let model: Model<Api> | undefined;
	if (record.model !== undefined) {
		const resolved = resolveModelOverride(record.model, context);
		diagnostics.push(...resolved.diagnostics);
		model = resolved.model;
	}
	let thinkingLevel: ModelThinkingLevel | undefined;
	if (record.effort !== undefined) {
		const resolved = resolveEffortOverride(record.effort, model ?? context.current);
		diagnostics.push(...resolved.diagnostics);
		thinkingLevel = resolved.thinkingLevel;
	}
	return { model, thinkingLevel, diagnostics };
}

/**
 * Union the redirect-canonicalized `disallowed-tools` across all active records
 * (A.5 unions stacked declarations, unlike model/effort where the newest wins).
 * Names are canonicalized through the merged redirect map (ADR-0006) and
 * lowercased for case-insensitive matching. Returns the normalize diagnostics
 * (CSV / `Tool(pattern)` / wildcard notes) for the caller to surface once.
 */
export function computeDisallowedUnion(
	records: readonly SkillInvocation[],
	redirects: Readonly<Record<string, string>>,
): { union: Set<string>; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];
	const union = new Set<string>();
	for (const record of records) {
		if (record.disallowedTools === undefined) {
			continue;
		}
		for (const name of normalizeDisallowedTools(record.disallowedTools, diagnostics)) {
			union.add(canonicalizeToolName(name, redirects).toLowerCase());
		}
	}
	return { union, diagnostics };
}

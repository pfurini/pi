/**
 * A.6 per-skill visibility (c4c): the pure truth-table resolver. Effective
 * visibility is the AND of the frontmatter contribution and the
 * settings-state contribution on each of the two dimensions (model-facing,
 * user-facing); settings can never re-grant what frontmatter removed.
 * `off` is the only state whose resolved `userInvokeError` is `true`,
 * independent of `user-invocable` (A.6 marks `off` "invocation errors" the same
 * across all four frontmatter columns; A.1: "errors when invoked by any of its
 * names"). Turning that flag into a consumed error rather than literal text is
 * the registry's job, and it does so only where skill commands are enabled
 * (`enableSkillCommands`) — see `buildCommandRegistry`'s disabled tombstones.
 * Pure and session-agnostic (ADR-0003).
 */

/** B.8: the closed union of persisted per-skill visibility states. */
export type SkillVisibilityState = "on" | "name-only" | "user-invocable-only" | "off";

export const SKILL_VISIBILITY_STATES: readonly SkillVisibilityState[] = [
	"on",
	"name-only",
	"user-invocable-only",
	"off",
];

/** Frontmatter contribution to the two visibility dimensions. */
export interface SkillVisibilityFrontmatter {
	disableModelInvocation: boolean;
	userInvocable: boolean;
}

/** Effective visibility resolved from frontmatter + persisted state. */
export interface ResolvedSkillVisibility {
	/** Model-facing: `full` = listed with description, `name` = name+location only, `no` = omitted and tool-rejected. */
	model: "full" | "name" | "no";
	/** User-facing: `yes` = present in the `/name` namespace and menus. */
	user: "yes" | "no";
	/** A.1/A.6: `true` iff the persisted state is `off` — `/name` invocation errors instead of staying literal text. */
	userInvokeError: boolean;
}

/** True when `value` is one of the four B.8 states. Anything else is malformed and resolves as `on`. */
export function isSkillVisibilityState(value: unknown): value is SkillVisibilityState {
	return value === "on" || value === "name-only" || value === "user-invocable-only" || value === "off";
}

/**
 * Normalize a persisted value: unknown/malformed input falls back to the `on`
 * default (a corrupted value must never hide a skill the operator did not
 * restrict). Callers that need to signal malformed input check
 * `isSkillVisibilityState` first.
 */
export function normalizeSkillVisibilityState(value: unknown): SkillVisibilityState {
	return isSkillVisibilityState(value) ? value : "on";
}

/**
 * A.6 truth table. Settings never re-grant: `disableModelInvocation` forces
 * `model === "no"` for every state; `userInvocable === false` forces
 * `user === "no"` for every state. `userInvokeError` is `true` iff
 * `state === "off"`, independent of frontmatter.
 */
export function resolveSkillVisibility(
	frontmatter: SkillVisibilityFrontmatter,
	state: SkillVisibilityState,
): ResolvedSkillVisibility {
	if (state === "off") {
		return { model: "no", user: "no", userInvokeError: true };
	}
	const model = frontmatter.disableModelInvocation
		? "no"
		: state === "on"
			? "full"
			: state === "name-only"
				? "name"
				: "no";
	const user = frontmatter.userInvocable ? "yes" : "no";
	return { model, user, userInvokeError: false };
}

/**
 * Effective visibility of a skill with no persisted override — the `on` row of
 * the truth table. The single source consumers use when the snapshot has no
 * entry for a skill, so the frontmatter-only default is never re-inlined.
 */
export function defaultSkillVisibility(frontmatter: SkillVisibilityFrontmatter): ResolvedSkillVisibility {
	return resolveSkillVisibility(frontmatter, "on");
}

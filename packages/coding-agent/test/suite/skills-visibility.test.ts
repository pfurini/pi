import { describe, expect, it } from "vitest";
import {
	isSkillVisibilityState,
	normalizeSkillVisibilityState,
	type ResolvedSkillVisibility,
	resolveSkillVisibility,
	type SkillVisibilityFrontmatter,
	type SkillVisibilityState,
} from "../../src/core/skills/visibility.ts";

/**
 * A.6 truth table, all 16 (state × frontmatter) rows. The table is the
 * oracle; each cell asserts `{ model, user, userInvokeError }` independently.
 */
const FRONTMATTER_COLUMNS: readonly { name: string; flags: SkillVisibilityFrontmatter }[] = [
	{ name: "none", flags: { disableModelInvocation: false, userInvocable: true } },
	{ name: "dmi", flags: { disableModelInvocation: true, userInvocable: true } },
	{ name: "ui:f", flags: { disableModelInvocation: false, userInvocable: false } },
	{ name: "dmi+ui:f", flags: { disableModelInvocation: true, userInvocable: false } },
];

const TRUTH_TABLE: readonly {
	state: SkillVisibilityState;
	expected: Record<string, ResolvedSkillVisibility>;
}[] = [
	{
		state: "on",
		expected: {
			none: { model: "full", user: "yes", userInvokeError: false },
			dmi: { model: "no", user: "yes", userInvokeError: false },
			"ui:f": { model: "full", user: "no", userInvokeError: false },
			"dmi+ui:f": { model: "no", user: "no", userInvokeError: false },
		},
	},
	{
		state: "name-only",
		expected: {
			none: { model: "name", user: "yes", userInvokeError: false },
			dmi: { model: "no", user: "yes", userInvokeError: false },
			"ui:f": { model: "name", user: "no", userInvokeError: false },
			"dmi+ui:f": { model: "no", user: "no", userInvokeError: false },
		},
	},
	{
		state: "user-invocable-only",
		expected: {
			none: { model: "no", user: "yes", userInvokeError: false },
			dmi: { model: "no", user: "yes", userInvokeError: false },
			"ui:f": { model: "no", user: "no", userInvokeError: false },
			"dmi+ui:f": { model: "no", user: "no", userInvokeError: false },
		},
	},
	{
		state: "off",
		expected: {
			none: { model: "no", user: "no", userInvokeError: true },
			dmi: { model: "no", user: "no", userInvokeError: true },
			"ui:f": { model: "no", user: "no", userInvokeError: true },
			"dmi+ui:f": { model: "no", user: "no", userInvokeError: true },
		},
	},
];

describe("resolveSkillVisibility (A.6 truth table)", () => {
	for (const row of TRUTH_TABLE) {
		for (const column of FRONTMATTER_COLUMNS) {
			it(`state=${row.state} × frontmatter=${column.name}`, () => {
				expect(resolveSkillVisibility(column.flags, row.state)).toEqual(row.expected[column.name]);
			});
		}
	}

	it("settings never re-grant: dmi forces model no for every state", () => {
		for (const row of TRUTH_TABLE) {
			expect(resolveSkillVisibility({ disableModelInvocation: true, userInvocable: true }, row.state).model).toBe(
				"no",
			);
		}
	});

	it("settings never re-grant: ui:f forces user no for every state", () => {
		for (const row of TRUTH_TABLE) {
			expect(resolveSkillVisibility({ disableModelInvocation: false, userInvocable: false }, row.state).user).toBe(
				"no",
			);
		}
	});

	it("userInvokeError is true iff state is off", () => {
		for (const row of TRUTH_TABLE) {
			expect(
				resolveSkillVisibility({ disableModelInvocation: false, userInvocable: true }, row.state).userInvokeError,
			).toBe(row.state === "off");
		}
	});
});

describe("normalizeSkillVisibilityState", () => {
	it("passes through the four valid states", () => {
		for (const state of ["on", "name-only", "user-invocable-only", "off"] as const) {
			expect(isSkillVisibilityState(state)).toBe(true);
			expect(normalizeSkillVisibilityState(state)).toBe(state);
		}
	});

	it("falls back to on for malformed values without throwing", () => {
		for (const value of [undefined, null, "", "OFF", "disabled", 0, 1, true, {}, [], "name_only"]) {
			expect(isSkillVisibilityState(value)).toBe(false);
			expect(normalizeSkillVisibilityState(value)).toBe("on");
		}
	});
});

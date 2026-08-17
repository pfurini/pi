/**
 * AC5: the `/skills` management overlay (c4c) — rows carry cost, effective
 * visibility, and originating scope; the `app.skills.*` actions (modified
 * keys) cycle the A.6 state, sort by cost, and toggle the persist scope, while
 * bare characters (including `s`/`g`/space) narrow the text filter; empty and
 * zero-match states disable cycle/sort/scope with no callback or mutation.
 * All keys resolve through registered actions.
 */

import { stripVTControlCharacters } from "node:util";
import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillManagementRow } from "../src/core/agent-session.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { SkillsSelectorComponent } from "../src/modes/interactive/components/skills-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

// app.skills.* action keys, as raw control sequences (modified keys, so bare
// characters — including `s`/`g`/space — reach the text filter instead).
const CYCLE = "\x13"; // ctrl+s
const SORT = "\x14"; // ctrl+t
const SCOPE = "\x07"; // ctrl+g

function makeRow(overrides: Partial<SkillManagementRow> & { name: string }): SkillManagementRow {
	return {
		id: `/skills/${overrides.name}/SKILL.md`,
		listingName: overrides.name,
		location: `/skills/${overrides.name}/SKILL.md`,
		source: "local",
		disableModelInvocation: false,
		userInvocable: true,
		state: "on",
		stateScope: undefined,
		malformed: false,
		effective: { model: "full", user: "yes", userInvokeError: false },
		estimatedCost: 40,
		...overrides,
	};
}

function render(component: SkillsSelectorComponent): string {
	return stripVTControlCharacters(component.render(120).join("\n"));
}

beforeAll(() => {
	initTheme("dark");
});

beforeEach(() => {
	// Test isolation: keybindings are a global singleton.
	setKeybindings(new KeybindingsManager());
});

describe("SkillsSelectorComponent", () => {
	it("renders rows with state, scope, cost, and an invalid-value indicator", () => {
		const component = new SkillsSelectorComponent(
			{
				rows: [
					makeRow({ name: "deploy", state: "on", stateScope: "project", estimatedCost: 128 }),
					makeRow({ name: "review", state: "name-only", stateScope: "global", estimatedCost: 12 }),
					makeRow({ name: "audit", state: "off", stateScope: "global", malformed: true, estimatedCost: 3 }),
				],
				initialScope: "global",
			},
			{ onChange: () => {}, onCancel: () => {} },
		);
		const text = render(component);
		expect(text).toContain("deploy");
		expect(text).toContain("128");
		expect(text).toContain("(proj)");
		expect(text).toContain("name-only");
		expect(text).toContain("(glob)");
		expect(text).toContain("⚠ invalid");
		expect(text).toContain("model: full");
		expect(text).toContain("3 skills");
	});

	it("the app.skills.cycle action cycles the state; bare characters do not", () => {
		const onChange = vi.fn();
		const component = new SkillsSelectorComponent(
			{ rows: [makeRow({ name: "deploy", state: "on" })], initialScope: "global" },
			{ onChange, onCancel: () => {} },
		);
		// Bare space/letters must reach the filter, not trigger the action.
		component.handleInput(" ");
		component.handleInput("s");
		expect(onChange).not.toHaveBeenCalled();
		component.handleInput(CYCLE);
		expect(onChange).toHaveBeenCalledWith("/skills/deploy/SKILL.md", "name-only", "global");
	});

	it("two quick cycles advance two states from the optimistic pending state", () => {
		const onChange = vi.fn();
		const component = new SkillsSelectorComponent(
			{ rows: [makeRow({ name: "deploy", state: "on" })], initialScope: "global" },
			{ onChange, onCancel: () => {} },
		);
		// No host reconcile (updateRows) between the two presses: the second must
		// derive from the pending "name-only", not the stale committed "on".
		component.handleInput(CYCLE);
		component.handleInput(CYCLE);
		expect(onChange).toHaveBeenNthCalledWith(1, "/skills/deploy/SKILL.md", "name-only", "global");
		expect(onChange).toHaveBeenNthCalledWith(2, "/skills/deploy/SKILL.md", "user-invocable-only", "global");
		expect(render(component)).toContain("user-invocable-only");
	});

	it("typing s or g narrows the filter instead of sorting or toggling scope", () => {
		const onChange = vi.fn();
		const component = new SkillsSelectorComponent(
			{
				rows: [makeRow({ name: "assets" }), makeRow({ name: "deploy" })],
				initialScope: "global",
			},
			{ onChange, onCancel: () => {} },
		);
		component.handleInput("s");
		component.handleInput("g");
		const text = render(component);
		expect(onChange).not.toHaveBeenCalled();
		expect(component.getSearchInput().getValue()).toBe("sg");
		expect(text).not.toContain("sort (cost)");
		expect(text).toContain("scope: global");
	});

	it("g toggles the persist scope for subsequent cycles", () => {
		const onChange = vi.fn();
		const component = new SkillsSelectorComponent(
			{ rows: [makeRow({ name: "deploy", state: "off" })], initialScope: "global" },
			{ onChange, onCancel: () => {} },
		);
		component.handleInput(SCOPE);
		expect(render(component)).toContain("scope: project");
		component.handleInput(CYCLE);
		expect(onChange).toHaveBeenCalledWith("/skills/deploy/SKILL.md", "on", "project");
	});

	it("the sort action sorts rows by descending cost", () => {
		const component = new SkillsSelectorComponent(
			{
				rows: [makeRow({ name: "cheap", estimatedCost: 5 }), makeRow({ name: "pricey", estimatedCost: 500 })],
				initialScope: "global",
			},
			{ onChange: () => {}, onCancel: () => {} },
		);
		let text = render(component);
		expect(text.indexOf("cheap")).toBeLessThan(text.indexOf("pricey"));
		component.handleInput(SORT);
		text = render(component);
		expect(text.indexOf("pricey")).toBeLessThan(text.indexOf("cheap"));
		expect(text).toContain("sort (cost)");
	});

	it("a zero-match filter shows No matching skills and disables cycle, sort, and scope", () => {
		const onChange = vi.fn();
		const component = new SkillsSelectorComponent(
			{ rows: [makeRow({ name: "deploy", estimatedCost: 5 })], initialScope: "global" },
			{ onChange, onCancel: () => {} },
		);
		component.getSearchInput().setValue("zzz-no-match");
		component.handleInput("x"); // trigger refresh through the input path
		expect(render(component)).toContain("No matching skills");

		component.handleInput(CYCLE);
		component.handleInput(SORT);
		component.handleInput(SCOPE);
		expect(onChange).not.toHaveBeenCalled();
		const text = render(component);
		expect(text).not.toContain("sort (cost)");
		expect(text).toContain("scope: global");
	});

	it("an empty loader shows No skills loaded and disables cycle, sort, and scope", () => {
		const onChange = vi.fn();
		const component = new SkillsSelectorComponent(
			{ rows: [], initialScope: "project" },
			{ onChange, onCancel: () => {} },
		);
		expect(render(component)).toContain("No skills loaded");

		component.handleInput(CYCLE);
		component.handleInput(SORT);
		component.handleInput(SCOPE);
		expect(onChange).not.toHaveBeenCalled();
		const text = render(component);
		expect(text).not.toContain("sort (cost)");
		expect(text).toContain("scope: project");
	});

	it("the filter narrows rows and Escape cancels without touching persisted state", () => {
		const onChange = vi.fn();
		const onCancel = vi.fn();
		const component = new SkillsSelectorComponent(
			{ rows: [makeRow({ name: "deploy" }), makeRow({ name: "review" })], initialScope: "global" },
			{ onChange, onCancel },
		);
		component.getSearchInput().setValue("rev");
		component.handleInput("v"); // no-op char to refresh; value already narrowed
		const text = render(component);
		expect(text).toContain("review");
		expect(text).not.toContain("→ deploy");

		component.handleInput("");
		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onChange).not.toHaveBeenCalled();
	});
});

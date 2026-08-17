/**
 * AC5: the `/skills` management overlay (c4c) — rows carry cost, effective
 * visibility, and originating scope; Space cycles the A.6 state, the filter
 * narrows, `s` sorts by cost, `g` toggles the persist scope; empty and
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

	it("Space cycles the state through the registered app.skills.cycle action", () => {
		const onChange = vi.fn();
		const component = new SkillsSelectorComponent(
			{ rows: [makeRow({ name: "deploy", state: "on" })], initialScope: "global" },
			{ onChange, onCancel: () => {} },
		);
		component.handleInput(" ");
		expect(onChange).toHaveBeenCalledWith("/skills/deploy/SKILL.md", "name-only", "global");
	});

	it("g toggles the persist scope for subsequent cycles", () => {
		const onChange = vi.fn();
		const component = new SkillsSelectorComponent(
			{ rows: [makeRow({ name: "deploy", state: "off" })], initialScope: "global" },
			{ onChange, onCancel: () => {} },
		);
		component.handleInput("g");
		expect(render(component)).toContain("scope: project");
		component.handleInput(" ");
		expect(onChange).toHaveBeenCalledWith("/skills/deploy/SKILL.md", "on", "project");
	});

	it("s sorts rows by descending cost", () => {
		const component = new SkillsSelectorComponent(
			{
				rows: [makeRow({ name: "cheap", estimatedCost: 5 }), makeRow({ name: "pricey", estimatedCost: 500 })],
				initialScope: "global",
			},
			{ onChange: () => {}, onCancel: () => {} },
		);
		let text = render(component);
		expect(text.indexOf("cheap")).toBeLessThan(text.indexOf("pricey"));
		component.handleInput("s");
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

		component.handleInput(" ");
		component.handleInput("s");
		component.handleInput("g");
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

		component.handleInput(" ");
		component.handleInput("s");
		component.handleInput("g");
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

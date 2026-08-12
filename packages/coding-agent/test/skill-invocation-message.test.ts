/**
 * TUI component coverage for the C1c metadata-first skill rendering path:
 * SkillInvocationMessageComponent renders blocks built from B.12 entry
 * metadata (no XML parsing involved), collapsed and expanded.
 */

import { describe, expect, test } from "vitest";
import { SkillInvocationMessageComponent } from "../src/modes/interactive/components/skill-invocation-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("SkillInvocationMessageComponent (B.12 metadata blocks)", () => {
	test("renders a metadata-built block collapsed with the skill name", () => {
		initTheme("dark");
		// Mirrors addSkillInvocationSegmentsToChat: location carries the skillId.
		const component = new SkillInvocationMessageComponent({
			name: "test",
			location: "/skills/test/SKILL.md",
			content: "Base directory for this skill: /skills/test\n\nRendered body.",
			userMessage: undefined,
		});
		const collapsed = stripAnsi(component.render(80).join("\n"));
		expect(collapsed).toContain("[skill]");
		expect(collapsed).toContain("test");
		expect(collapsed).not.toContain("Rendered body.");

		component.setExpanded(true);
		const expanded = stripAnsi(component.render(80).join("\n"));
		expect(expanded).toContain("Rendered body.");
		expect(expanded).toContain("Base directory for this skill: /skills/test");
	});
});

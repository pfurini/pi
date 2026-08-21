import {
	buildBudgetedListingBlock,
	type ListingBudgetEntry,
	MAX_LISTING_DESCRIPTION_LENGTH,
	skillListingBudgetCodeUnits,
} from "./listing-budget.ts";
import type { Skill } from "./types.ts";

/** A.6 listing-budget inputs for {@link formatSkillsForSystemPrompt}. */
export interface FormatSkillsForSystemPromptOptions {
	/** Model context window in tokens; omitted or non-positive keeps the unbudgeted v1 listing. */
	contextWindow?: number;
	/** Fraction of the context window the listing may occupy (B.8 default 0.01). */
	budgetFraction?: number;
}

export function formatSkillsForSystemPrompt(skills: Skill[], options?: FormatSkillsForSystemPromptOptions): string {
	const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
	if (visibleSkills.length === 0) return "";

	const lines = [
		"The following skills provide specialized instructions for specific tasks.",
		"Read the full skill file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		"",
	];

	const budgetCodeUnits = skillListingBudgetCodeUnits(options?.contextWindow ?? 0, options?.budgetFraction ?? 0.01);
	if (budgetCodeUnits === undefined) {
		// Unbudgeted path: byte-identical to the pre-budget v1 listing.
		lines.push("<available_skills>");
		for (const skill of visibleSkills) {
			lines.push("  <skill>");
			lines.push(`    <name>${escapeXml(skill.name)}</name>`);
			lines.push(`    <description>${escapeXml(skill.description)}</description>`);
			lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
			lines.push("  </skill>");
		}
		lines.push("</available_skills>");
		return lines.join("\n");
	}

	// Budgeted path: the byte-exact A.6 v2 oracle. Harness skills carry no
	// paths boost and no invocation counts, so the truncation order
	// degenerates to `listingName` asc and emission is name-sorted.
	const entries: ListingBudgetEntry[] = [...visibleSkills]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((skill) => ({
			listingName: skill.name,
			description: skill.description.slice(0, MAX_LISTING_DESCRIPTION_LENGTH),
			location: skill.filePath,
			isExempt: false,
			invocationCount: 0,
		}));
	const { block } = buildBudgetedListingBlock(entries, budgetCodeUnits);
	return [...lines, block].join("\n");
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

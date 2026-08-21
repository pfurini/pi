import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { LoadedSkill, SkillInput } from "../skills.ts";
import { normalizeSkillInput } from "./frontmatter.ts";
import {
	buildBudgetedListingBlock,
	escapeXml,
	type ListingBudgetEntry,
	MAX_LISTING_DESCRIPTION_LENGTH,
	SKILL_LISTING_END_DELIMITER,
	SKILL_LISTING_START_DELIMITER,
	SKILL_LISTING_VERSION,
} from "./listing-budget.ts";
import { boostSkillsByPaths, byListingName } from "./paths-boost.ts";
import { defaultSkillVisibility, type ResolvedSkillVisibility } from "./visibility.ts";

export { escapeXml, SKILL_LISTING_END_DELIMITER, SKILL_LISTING_START_DELIMITER, SKILL_LISTING_VERSION };

/** The capped listing description (description + `when_to_use`) the budget engine and cost estimator render. */
export function getListingDescription(skill: LoadedSkill): string {
	const whenToUse = skill.frontmatter.when_to_use;
	const combined =
		typeof whenToUse === "string" && whenToUse.length > 0 ? `${skill.description} ${whenToUse}` : skill.description;
	return combined.slice(0, MAX_LISTING_DESCRIPTION_LENGTH);
}

/** Format skills for inclusion in a system prompt. */
/**
 * Format skills for inclusion in a system prompt.
 * `invocation` selects the instruction line: "tool" when the A.1 `skill` tool
 * is active (the model invokes skills through it), "read" otherwise (legacy
 * model-read convention for consumers without the tool, e.g. AskClaude).
 */
export function formatSkillsForPrompt(
	skills: SkillInput[],
	invocation: "read" | "tool" = "read",
	boost?: { touchedPaths: readonly string[]; cwd: string },
	budget?: {
		budgetCodeUnits: number | undefined;
		invocationCounts: ReadonlyMap<string, number>;
		diagnostics?: ResourceDiagnostic[];
	},
	visibility?: ReadonlyMap<string, ResolvedSkillVisibility>,
): string {
	const modelOf = (skill: LoadedSkill): "full" | "name" | "no" =>
		(visibility?.get(skill.id) ?? defaultSkillVisibility(skill)).model;
	const visibleSkills = skills
		.map((skill) => normalizeSkillInput(skill).skill)
		.filter((skill) => modelOf(skill) !== "no");

	if (visibleSkills.length === 0) {
		return "";
	}

	const lines = [
		"\n\nThe following skills provide specialized instructions for specific tasks.",
		invocation === "tool"
			? "Use the skill tool to invoke a skill and receive its rendered instructions when the task matches its description."
			: "Use the read tool to load a skill's file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		"",
	];

	const { ordered, exemptIds } = boost
		? boostSkillsByPaths(visibleSkills, boost.touchedPaths, boost.cwd)
		: { ordered: [...visibleSkills].sort(byListingName), exemptIds: new Set<string>() };

	const entries: ListingBudgetEntry[] = ordered.map((skill) => ({
		listingName: skill.listingName,
		description: getListingDescription(skill),
		location: skill.filePath,
		isExempt: exemptIds.has(skill.id),
		invocationCount: budget?.invocationCounts.get(skill.id) ?? 0,
		forceNameOnly: modelOf(skill) === "name",
	}));

	const { block, diagnostics } = buildBudgetedListingBlock(entries, budget?.budgetCodeUnits);
	if (budget?.diagnostics) {
		budget.diagnostics.push(...diagnostics);
	}

	return [...lines, block].join("\n");
}

/** Return the first complete v2 listing block, including its delimiters. */
export function extractSkillListingBlock(systemPrompt: string): string | undefined {
	const start = systemPrompt.indexOf(SKILL_LISTING_START_DELIMITER);
	if (start === -1) {
		return undefined;
	}
	const end = systemPrompt.indexOf(SKILL_LISTING_END_DELIMITER, start + SKILL_LISTING_START_DELIMITER.length);
	if (end === -1) {
		return undefined;
	}
	return systemPrompt.slice(start, end + SKILL_LISTING_END_DELIMITER.length);
}

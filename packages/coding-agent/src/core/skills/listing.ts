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

/**
 * Return the last complete v2 listing block, including its delimiters.
 *
 * Last, not first: `buildSystemPrompt` appends the listing after every project
 * context file, and it embeds those files verbatim. An `AGENTS.md` that merely
 * documents the skill system — a prose mention of the opener, or a copied
 * example block — therefore plants a delimiter ahead of the real listing.
 * Scanning from the front returned either that copied example or, for an
 * unterminated opener, a span running from the stray opener through the real
 * listing's terminator, swallowing the context files in between.
 *
 * Only the trailing position is trusted, not the block's contents: a genuine
 * listing and a copied one are byte-indistinguishable, so a prompt carrying no
 * real listing at all still yields a copied one.
 */
export function extractSkillListingBlock(systemPrompt: string): string | undefined {
	let start = systemPrompt.lastIndexOf(SKILL_LISTING_START_DELIMITER);
	while (start !== -1) {
		const end = systemPrompt.indexOf(SKILL_LISTING_END_DELIMITER, start + SKILL_LISTING_START_DELIMITER.length);
		if (end !== -1) {
			return systemPrompt.slice(start, end + SKILL_LISTING_END_DELIMITER.length);
		}
		// An unterminated opener is not a block, so keep walking back for one that
		// is. `lastIndexOf(x, -1)` searches index 0 rather than giving up, so stop
		// explicitly at 0 instead of looping on it forever.
		start = start === 0 ? -1 : systemPrompt.lastIndexOf(SKILL_LISTING_START_DELIMITER, start - 1);
	}
	return undefined;
}

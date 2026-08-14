import type { LoadedSkill, SkillInput } from "../skills.ts";
import { normalizeSkillInput } from "./frontmatter.ts";
import { boostSkillsByPaths, byListingName } from "./paths-boost.ts";

export const SKILL_LISTING_VERSION = "2";
export const SKILL_LISTING_START_DELIMITER = `<available_skills version="${SKILL_LISTING_VERSION}">`;
export const SKILL_LISTING_END_DELIMITER = "</available_skills>";

const MAX_LISTING_DESCRIPTION_LENGTH = 1536;

export function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function getListingDescription(skill: LoadedSkill): string {
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
): string {
	const visibleSkills = skills
		.map((skill) => normalizeSkillInput(skill).skill)
		.filter((skill) => !skill.disableModelInvocation);

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
		SKILL_LISTING_START_DELIMITER,
	];

	const ordered = boost
		? boostSkillsByPaths(visibleSkills, boost.touchedPaths, boost.cwd).ordered
		: [...visibleSkills].sort(byListingName);

	for (const skill of ordered) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.listingName)}</name>`);
		lines.push(`    <description>${escapeXml(getListingDescription(skill))}</description>`);
		lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
		lines.push("  </skill>");
	}

	lines.push(SKILL_LISTING_END_DELIMITER);
	return lines.join("\n");
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

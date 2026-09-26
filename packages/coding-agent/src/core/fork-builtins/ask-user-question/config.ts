/**
 * Fork-owned: the tool's settings, read from `forkBuiltins["ask-user-question"]` in the
 * session agent directory's `settings.json`. Only the guidance texts are configurable;
 * the questionnaire keys live in `keybindings.json` (see `keybindings.ts`). A missing,
 * unreadable or malformed file, or a field of the wrong type, keeps the default.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The key of this tool's entry under `forkBuiltins` in `settings.json`. */
export const SETTINGS_KEY = "ask-user-question";

export interface GuidanceFields {
	promptSnippet?: string;
	promptGuidelines?: string[];
	description?: string;
}

export interface AskUserQuestionConfig {
	guidance?: GuidanceFields;
}

/** Keeps only the non-empty string fields and a non-empty all-string guideline list. */
export function validateGuidanceFields(fields: unknown): GuidanceFields {
	if (!isObject(fields)) return {};
	const result: GuidanceFields = {};
	if (typeof fields.promptSnippet === "string" && fields.promptSnippet.length > 0) {
		result.promptSnippet = fields.promptSnippet;
	}
	if (
		Array.isArray(fields.promptGuidelines) &&
		fields.promptGuidelines.length > 0 &&
		fields.promptGuidelines.every((s) => typeof s === "string" && s.length > 0)
	) {
		result.promptGuidelines = fields.promptGuidelines;
	}
	if (typeof fields.description === "string" && fields.description.length > 0) {
		result.description = fields.description;
	}
	return result;
}

export function loadConfig(agentDir: string): AskUserQuestionConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8").replace(/^\uFEFF/, ""));
	} catch {
		return {};
	}
	const section = isObject(parsed) ? parsed.forkBuiltins : undefined;
	const entry = isObject(section) ? section[SETTINGS_KEY] : undefined;
	if (!isObject(entry) || entry.guidance === undefined) return {};
	return { guidance: validateGuidanceFields(entry.guidance) };
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

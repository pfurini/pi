/**
 * Fork-owned: parses one agent file into an `AgentDefinition`. Keys are pi-subagents' documented
 * snake_case spellings (`README.md` "Frontmatter Fields" at 79a7c42). A key outside that list loads
 * with a warning naming the file and the key; the loader turns it into an error under
 * `strictAgentFiles`. The legacy spellings `inherit_extensions` and `inherit_skills` are unknown keys.
 */
import { basename } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { parseFrontmatter } from "../../../../utils/frontmatter.ts";
import { type AgentDefinition, type AgentSource, type MemoryScope, QUALIFIED_SEPARATOR } from "./types.ts";

const KNOWN_KEYS = new Set([
	"name",
	"display_name",
	"description",
	"color",
	"tools",
	"disallowed_tools",
	"extensions",
	"exclude_extensions",
	"skills",
	"model",
	"thinking",
	"max_turns",
	"persist_session",
	"output_transcript",
	"session_dir",
	"allowed_subagents",
	"prompt_mode",
	"inherit_context",
	"run_in_background",
	"isolated",
	"memory",
	"isolation",
	"enabled",
]);

const THINKING_LEVELS: readonly ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export interface ParsedAgentFile {
	/** Absent when the file is refused; `error` then says why. */
	definition?: AgentDefinition;
	error?: string;
	/** `parse`: the file is unreadable as frontmatter. `reserved-name`: its type holds the skill separator. */
	errorKind?: "parse" | "reserved-name";
	/** Frontmatter keys outside the documented list, in file order. */
	unknownKeys: string[];
	/** Documented keys whose value was ignored, each with the reason. */
	invalidValues: string[];
}

/**
 * Parses an agent file's text. `source` names the file; its base name is the agent type when
 * `name:` is absent. A parse error, or a type holding the `:` reserved for skill agents, refuses the file.
 */
export function parseAgentFile(content: string, source: Exclude<AgentSource, { kind: "default" }>): ParsedAgentFile {
	let fm: Record<string, unknown>;
	let body: string;
	try {
		const parsed = parseFrontmatter<Record<string, unknown>>(content);
		fm = isRecord(parsed.frontmatter) ? parsed.frontmatter : {};
		body = parsed.body;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: message, errorKind: "parse", unknownKeys: [], invalidValues: [] };
	}
	const unknownKeys = Object.keys(fm).filter((key) => !KNOWN_KEYS.has(key));
	const invalidValues: string[] = [];
	const invalid = (key: string, expected: string) => invalidValues.push(`${key}: expected ${expected}`);

	const declared = stringField(fm, "name", invalid)?.trim();
	const name = declared || basename(source.sourcePath, ".md");
	if (name.includes(QUALIFIED_SEPARATOR)) {
		return {
			error: `agent type "${name}" contains "${QUALIFIED_SEPARATOR}", which is reserved for skill agents`,
			errorKind: "reserved-name",
			unknownKeys,
			invalidValues,
		};
	}

	const definition: AgentDefinition = {
		name,
		displayName: stringField(fm, "display_name", invalid),
		color: stringField(fm, "color", invalid),
		description: stringField(fm, "description", invalid) ?? name,
		tools: toolsField(fm.tools),
		disallowedTools: listField(fm.disallowed_tools),
		extensions: inheritField(fm.extensions),
		excludeExtensions: listField(fm.exclude_extensions),
		skills: inheritField(fm.skills),
		model: stringField(fm, "model", invalid),
		thinking: thinkingField(fm, invalid),
		maxTurns: maxTurnsField(fm, invalid),
		persistSession: booleanField(fm, "persist_session", invalid),
		outputTranscript: booleanField(fm, "output_transcript", invalid),
		sessionDir: stringField(fm, "session_dir", invalid),
		allowedSubagents: allowedSubagentsField(fm.allowed_subagents),
		systemPrompt: body.trim(),
		promptMode: fm.prompt_mode === "append" ? "append" : "replace",
		inheritContext: booleanField(fm, "inherit_context", invalid),
		runInBackground: booleanField(fm, "run_in_background", invalid),
		isolated: booleanField(fm, "isolated", invalid),
		memory: memoryField(fm, invalid),
		isolation: isolationField(fm, invalid),
		enabled: booleanField(fm, "enabled", invalid) ?? true,
		hidden: false,
		source,
	};
	if (fm.prompt_mode !== undefined && fm.prompt_mode !== "append" && fm.prompt_mode !== "replace") {
		invalid("prompt_mode", "append or replace");
	}
	return { definition, unknownKeys, invalidValues };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Invalid = (key: string, expected: string) => void;

function stringField(fm: Record<string, unknown>, key: string, invalid: Invalid): string | undefined {
	const value = fm[key];
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return value;
	invalid(key, "a string");
	return undefined;
}

function booleanField(fm: Record<string, unknown>, key: string, invalid: Invalid): boolean | undefined {
	const value = fm[key];
	if (value === undefined || value === null) return undefined;
	if (typeof value === "boolean") return value;
	invalid(key, "true or false");
	return undefined;
}

/** A YAML list or a comma-separated string. `none` or an empty value gives an empty list. */
function listItems(value: unknown): string[] {
	const raw = Array.isArray(value) ? value.map((item) => String(item)) : String(value).split(",");
	const items = raw.map((item) => item.trim()).filter(Boolean);
	return items.length === 1 && items[0].toLowerCase() === "none" ? [] : items;
}

/** Absent, empty or `none` gives undefined. */
function listField(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	const items = listItems(value);
	return items.length > 0 ? items : undefined;
}

/** Absent gives undefined (every Pi built-in); `none` or empty gives no tools; `all` is spelled `*`. */
function toolsField(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	return listItems(value).map((item) => (item.toLowerCase() === "all" ? "*" : item));
}

/** `extensions:` and `skills:`. Absent or `true` inherits all; `false`, `none` or empty inherits none. */
function inheritField(value: unknown): boolean | string[] {
	if (value === undefined || value === null || value === true) return true;
	if (value === false) return false;
	const items = listItems(value);
	return items.length > 0 ? items : false;
}

/** Absent, `none`, empty or `false` disables nesting; `all`, `*` or `true` allows every enabled agent. */
function allowedSubagentsField(value: unknown): "all" | string[] | undefined {
	if (typeof value === "boolean") return value ? "all" : undefined;
	const items = listField(value);
	if (!items) return undefined;
	return items.some((item) => item === "*" || item.toLowerCase() === "all") ? "all" : items;
}

function thinkingField(fm: Record<string, unknown>, invalid: Invalid): ModelThinkingLevel | undefined {
	const value = fm.thinking;
	if (value === undefined || value === null) return undefined;
	if (THINKING_LEVELS.includes(value as ModelThinkingLevel)) return value as ModelThinkingLevel;
	invalid("thinking", THINKING_LEVELS.join(", "));
	return undefined;
}

function maxTurnsField(fm: Record<string, unknown>, invalid: Invalid): number | undefined {
	const value = fm.max_turns;
	if (value === undefined || value === null) return undefined;
	if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
	invalid("max_turns", "a non-negative integer");
	return undefined;
}

function memoryField(fm: Record<string, unknown>, invalid: Invalid): MemoryScope | undefined {
	const value = fm.memory;
	if (value === undefined || value === null) return undefined;
	if (value === "user" || value === "project" || value === "local") return value;
	invalid("memory", "user, project or local");
	return undefined;
}

/** `off`, `none`, `no` and `false` all refuse a worktree. */
function isolationField(fm: Record<string, unknown>, invalid: Invalid): "worktree" | "off" | undefined {
	const value = fm.isolation;
	if (value === undefined || value === null) return undefined;
	if (value === "worktree") return "worktree";
	if (value === "off" || value === "none" || value === "no" || value === false) return "off";
	invalid("isolation", "worktree or off");
	return undefined;
}

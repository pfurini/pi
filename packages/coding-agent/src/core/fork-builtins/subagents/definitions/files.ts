/**
 * Fork-owned: agent-file edits for the `/agents` menu (plan T13). pi-subagents
 * `src/agent-file-toggle.ts` at 79a7c42 is the behavior reference.
 *
 * Deciding whether a file is disabled is a read, so it asks the loader's own frontmatter parser.
 * Editing cannot go through the parser, because serializing a parsed document would reformat a
 * hand-authored file: its comments, key order and quoting. The edits are therefore line-wise and
 * keep everything they do not touch, the line endings and a byte-order mark included.
 *
 * Every write and unlink first refuses a symlink below the location's root (P27): the project
 * directory for `.pi/agents/` and `.agents/agents/`, the agent directory for `<agentDir>/agents/`.
 * A write replaces the file whole through `writeFileAtomically`.
 */
import { mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { parseFrontmatter } from "../../../../utils/frontmatter.ts";
import { refuseSymlinks, writeFileAtomically } from "../atomic-write.ts";
import { parseAgentFile } from "./frontmatter.ts";
import type { AgentDefinition } from "./types.ts";

/** Where an agent file lives: `.pi/agents/`, `.agents/agents/` or `<agentDir>/agents/`. */
export type AgentFileLocation = "project" | "workspace" | "personal";

/** The directories agent files live in, and whether the project's may be read and written (P18). */
export interface AgentFileDirectories {
	cwd: string;
	agentDir: string;
	projectTrusted: boolean;
}

export interface AgentFile {
	path: string;
	location: AgentFileLocation;
}

/** The directory a location keeps its agent files in. */
export function agentDirectory(location: AgentFileLocation, directories: AgentFileDirectories): string {
	switch (location) {
		case "project":
			return join(directories.cwd, ".pi", "agents");
		case "workspace":
			return join(directories.cwd, ".agents", "agents");
		default:
			return join(directories.agentDir, "agents");
	}
}

/** The root no symlink may sit below: the project for project locations, the agent directory otherwise. */
function locationRoot(location: AgentFileLocation, directories: AgentFileDirectories): string {
	return location === "personal" ? directories.agentDir : directories.cwd;
}

/** The locations the loader reads, most important first; project ones only in a trusted project. */
function searchOrder(directories: AgentFileDirectories): AgentFileLocation[] {
	return directories.projectTrusted ? ["project", "workspace", "personal"] : ["personal"];
}

function isFile(path: string): boolean {
	return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
}

/** Whether the file at `path` loads as the agent `name`: its `name:` key can give it another one. */
function loadsAs(path: string, location: AgentFileLocation, name: string): boolean {
	try {
		const source = { kind: location === "personal" ? "global" : "project", sourcePath: path } as const;
		return parseAgentFile(readFileSync(path, "utf8"), source).definition?.name === name;
	} catch {
		return false;
	}
}

/**
 * `<name>.md` in the first location that has it, in the order the loader lets them win. A file
 * there that declares another `name:` belongs to that agent, so it is not this agent's file.
 */
export function findAgentFile(name: string, directories: AgentFileDirectories): AgentFile | undefined {
	for (const location of searchOrder(directories)) {
		const path = join(agentDirectory(location, directories), `${name}.md`);
		if (isFile(path) && loadsAs(path, location, name)) return { path, location };
	}
	return undefined;
}

/**
 * The file behind a loaded agent. The path the loader read wins, because `name:` can differ from
 * the file's base name; the `<name>.md` probe covers a default agent with no file and a path that
 * has since gone.
 */
export function locateAgentFile(
	name: string,
	sourcePath: string | undefined,
	directories: AgentFileDirectories,
): AgentFile | undefined {
	if (sourcePath && isFile(sourcePath)) {
		const location = searchOrder(directories).find((candidate) =>
			sourcePath.startsWith(agentDirectory(candidate, directories) + sep),
		);
		return { path: sourcePath, location: location ?? "personal" };
	}
	return findAgentFile(name, directories);
}

/** Writes `text` to `file` whole, after refusing a symlink on its path; creates its directory when needed. */
export function writeAgentFile(file: AgentFile, text: string, directories: AgentFileDirectories): void {
	refuseSymlinks(locationRoot(file.location, directories), file.path);
	mkdirSync(dirname(file.path), { recursive: true });
	writeFileAtomically(file.path, text);
}

/** Deletes `file`, after refusing a symlink on its path. */
export function removeAgentFile(file: AgentFile, directories: AgentFileDirectories): void {
	refuseSymlinks(locationRoot(file.location, directories), file.path);
	unlinkSync(file.path);
}

/** A `---` fence line, without its line ending. */
const FENCE = /^---[ \t]*$/;
/** A line setting `enabled: false`, ignoring trailing blanks. */
const ENABLED_FALSE = /^enabled:[ \t]*false[ \t]*$/;
/** A line setting the `enabled` key to any value. */
const ENABLED_KEY = /^enabled[ \t]*:/;

/**
 * The file's lines, each with its line ending, and the index of the closing fence; undefined when
 * the file has no frontmatter block. A byte-order mark stays in the first line: it belongs to the
 * file's encoding, and an edit keeps it where it was.
 */
function frontmatterBlock(content: string): { lines: string[]; close: number; eol: string } | undefined {
	const lines = content.split(/(?<=\n)/);
	const strip = (line: string) => line.replace(/\r?\n$/, "");
	if (!FENCE.test(strip(lines[0]?.replace(/^\uFEFF/, "") ?? ""))) return undefined;
	const close = lines.findIndex((line, index) => index > 0 && FENCE.test(strip(line)));
	if (close === -1) return undefined;
	return { lines, close, eol: lines[0].endsWith("\r\n") ? "\r\n" : "\n" };
}

/** Whether the loader reads this file as disabled; a file the parser refuses is not. */
export function isDisabledContent(content: string): boolean {
	try {
		return parseFrontmatter(content).frontmatter.enabled === false;
	} catch {
		return false;
	}
}

export type DisableOutcome = "disabled" | "already-disabled" | "no-frontmatter" | "cannot-rewrite";

/**
 * Sets `enabled: false`: it replaces an `enabled:` line of the block, else adds the key as the first
 * line. The outcome tells an edit from a no-op; `cannot-rewrite` refuses a file whose edit would not
 * read as disabled, such as one spelling the key in quotes, so no unparseable file is ever written.
 */
export function disableInContent(content: string): { content: string; outcome: DisableOutcome } {
	const block = frontmatterBlock(content);
	if (!block) return { content, outcome: "no-frontmatter" };
	if (isDisabledContent(content)) return { content, outcome: "already-disabled" };
	const lines = [...block.lines];
	const existing = lines.findIndex((line, index) => index > 0 && index < block.close && ENABLED_KEY.test(line));
	if (existing === -1) lines.splice(1, 0, `enabled: false${block.eol}`);
	else lines[existing] = `enabled: false${block.eol}`;
	const edited = lines.join("");
	if (!isDisabledContent(edited)) return { content, outcome: "cannot-rewrite" };
	return { content: edited, outcome: "disabled" };
}

/** Removes `enabled: false` wherever it sits in the block; `changed` is false when nothing was removed. */
export function enableInContent(content: string): { content: string; changed: boolean } {
	const block = frontmatterBlock(content);
	if (!block) return { content, changed: false };
	const kept = block.lines.filter(
		(line, index) => !(index > 0 && index < block.close && ENABLED_FALSE.test(line.replace(/\r?\n$/, ""))),
	);
	if (kept.length === block.lines.length) return { content, changed: false };
	return { content: kept.join(""), changed: true };
}

/** The stub that disables a default agent, once enabled again: an empty frontmatter block. */
export function isEmptyStub(content: string): boolean {
	return (
		content
			.replace(/^\uFEFF/, "")
			.replace(/\r\n/g, "\n")
			.trim() === "---\n---"
	);
}

/** The file `/agents` writes to disable a default agent that has no file. */
export const DISABLED_STUB = "---\nenabled: false\n---\n";

/**
 * An agent definition as an agent file, for eject: snake_case keys, strings and lists as JSON, which
 * YAML reads back unchanged. Parsing the file gives back the definition's fields.
 */
export function serializeAgentDefinition(definition: AgentDefinition): string {
	const fields: string[] = [];
	const put = (key: string, value: unknown) => {
		if (value !== undefined) fields.push(`${key}: ${JSON.stringify(value)}`);
	};
	put("display_name", definition.displayName);
	put("description", definition.description);
	put("color", definition.color);
	// Absent means every Pi built-in; an empty list means none.
	put("tools", definition.tools);
	put("disallowed_tools", definition.disallowedTools);
	// `true` is the default for both, and absence reads back as `true`.
	if (definition.extensions !== true) put("extensions", definition.extensions);
	put("exclude_extensions", definition.excludeExtensions);
	if (definition.skills !== true) put("skills", definition.skills);
	put("model", definition.model);
	put("thinking", definition.thinking);
	put("max_turns", definition.maxTurns);
	put("persist_session", definition.persistSession);
	put("output_transcript", definition.outputTranscript);
	put("session_dir", definition.sessionDir);
	put("allowed_subagents", definition.allowedSubagents);
	put("prompt_mode", definition.promptMode);
	put("inherit_context", definition.inheritContext);
	put("run_in_background", definition.runInBackground);
	put("isolated", definition.isolated);
	put("memory", definition.memory);
	put("isolation", definition.isolation);
	if (!definition.enabled) put("enabled", false);
	return `---\n${fields.join("\n")}\n---\n\n${definition.systemPrompt}\n`;
}

/** What the create wizard's manual path collects. */
export interface NewAgentInput {
	description: string;
	/** The `tools:` value as chosen: `all`, `none` or a comma-separated list. */
	tools: string;
	/** `provider/model`; absent inherits the parent's. */
	model?: string;
	/** A thinking level; absent inherits. */
	thinking?: string;
	systemPrompt: string;
}

/**
 * The file the create wizard writes. The description and the model come from free text, so they
 * are quoted: a `:` would make the file unparseable, and a `#` would start a comment and cut the
 * value. `tools` and `thinking` come from fixed choices and stay bare.
 */
export function buildNewAgentFile(input: NewAgentInput): string {
	const model = input.model ? `\nmodel: ${JSON.stringify(input.model)}` : "";
	const thinking = input.thinking ? `\nthinking: ${input.thinking}` : "";
	return `---\ndescription: ${JSON.stringify(input.description)}\ntools: ${input.tools}${model}${thinking}\nprompt_mode: replace\n---\n\n${input.systemPrompt}\n`;
}

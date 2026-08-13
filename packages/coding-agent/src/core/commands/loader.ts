/**
 * A.7 command loading. Two sources feed one `LoadedCommand[]`:
 *
 * - **Native command files** (`~/.pi/agent/commands/`, trust-gated
 *   `.pi/commands/`) parsed here with the A.7 frontmatter subset.
 * - **Grandfathered prompt templates** — the already-resolved
 *   `PromptTemplate[]` from `ResourceLoader.getPrompts()`, adapted without
 *   re-scanning any default directory (calling `loadPromptTemplates` would
 *   bypass trust, package/CLI/explicit sources, dedup, metadata, and
 *   overrides).
 *
 * The bare command-name grammar (A.1, `isBareSkillCommandName`) is a namespace
 * gate, not a load gate: a command with an invalid bare name still loads and
 * stays model-invocable by its exact name where representable, but is excluded
 * from `/name` invocation and autocomplete, with exactly one diagnostic.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseFrontmatter } from "../../utils/frontmatter.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { PromptTemplate } from "../prompt-templates.ts";
import { isBareSkillCommandName, normalizeBoolean } from "../skills/frontmatter.ts";
import type { SourceInfo } from "../source-info.ts";

export type CommandKind = "command" | "prompt";

export interface LoadedCommand {
	/** `command` = native `commands/` file; `prompt` = grandfathered template. */
	kind: CommandKind;
	name: string;
	description?: string;
	argumentHint?: string;
	/** Parsed frontmatter (A.7 subset for native commands; minimal for adapted templates). */
	frontmatter: Record<string, unknown>;
	/** Body after frontmatter stripping (pre-include, pre-argument). */
	body: string;
	filePath: string;
	/** Directory used to resolve A.7.1 relative includes. */
	baseDir: string;
	sourceInfo: SourceInfo;
	/** True when `name` matches the A.1 bare grammar (namespace/autocomplete eligibility). */
	commandNameValid: boolean;
	/** `user-invocable` frontmatter (default true). */
	userInvocable: boolean;
	/** `disable-model-invocation` frontmatter (default false). */
	disableModelInvocation: boolean;
}

export interface LoadCommandsResult {
	commands: LoadedCommand[];
	diagnostics: ResourceDiagnostic[];
}

function firstNonEmptyLine(body: string): string | undefined {
	const line = body.split("\n").find((entry) => entry.trim());
	if (!line) return undefined;
	const trimmed = line.trim();
	return trimmed.length > 60 ? `${trimmed.slice(0, 60)}...` : trimmed;
}

/** Emit exactly one invalid-name diagnostic for a loaded-but-namespace-excluded command. */
function invalidNameDiagnostic(name: string, filePath: string): ResourceDiagnostic {
	return {
		type: "warning",
		message: `command name "${name}" is not eligible for the bare command namespace`,
		path: filePath,
	};
}

/** Parse one native command markdown file. Returns null (with a diagnostic) when unreadable. */
export function parseCommandFile(
	filePath: string,
	sourceInfo: SourceInfo,
): { command: LoadedCommand | null; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];
	let rawContent: string;
	try {
		rawContent = readFileSync(filePath, "utf-8");
	} catch (error) {
		diagnostics.push({
			type: "warning",
			message: `could not read command file: ${error instanceof Error ? error.message : String(error)}`,
			path: filePath,
		});
		return { command: null, diagnostics };
	}

	const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(rawContent);
	const nameField = frontmatter.name;
	const name =
		typeof nameField === "string" && nameField.trim() !== ""
			? nameField.trim()
			: basename(filePath).replace(/\.md$/, "");
	const description =
		typeof frontmatter.description === "string" && frontmatter.description.trim() !== ""
			? frontmatter.description
			: firstNonEmptyLine(body);
	const argumentHint = typeof frontmatter["argument-hint"] === "string" ? frontmatter["argument-hint"] : undefined;
	const commandNameValid = isBareSkillCommandName(name);
	if (!commandNameValid) {
		diagnostics.push(invalidNameDiagnostic(name, filePath));
	}

	const command: LoadedCommand = {
		kind: "command",
		name,
		...(description !== undefined && { description }),
		...(argumentHint !== undefined && { argumentHint }),
		frontmatter,
		body,
		filePath,
		baseDir: dirname(filePath),
		sourceInfo,
		commandNameValid,
		userInvocable: normalizeBoolean(frontmatter["user-invocable"]) ?? true,
		disableModelInvocation: normalizeBoolean(frontmatter["disable-model-invocation"]) ?? false,
	};
	return { command, diagnostics };
}

/**
 * Load native command files from one directory (non-recursive, `.md` only).
 * Symlinks are followed; broken symlinks are skipped. An absent directory is
 * not a diagnostic; a real read failure (permissions, etc.) is.
 */
export function loadCommandsFromDir(dir: string, getSourceInfo: (filePath: string) => SourceInfo): LoadCommandsResult {
	const commands: LoadedCommand[] = [];
	const diagnostics: ResourceDiagnostic[] = [];
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.name.endsWith(".md")) {
				continue;
			}
			const fullPath = join(dir, entry.name);
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					isFile = statSync(fullPath).isFile();
				} catch {
					continue;
				}
			}
			if (!isFile) {
				continue;
			}
			const parsed = parseCommandFile(fullPath, getSourceInfo(fullPath));
			diagnostics.push(...parsed.diagnostics);
			if (parsed.command) {
				commands.push(parsed.command);
			}
		}
	} catch (error) {
		// ENOENT means the directory is absent (normal); anything else (EACCES
		// and friends) is a real failure that must not pass silently.
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			diagnostics.push({
				type: "warning",
				message: `could not read commands directory: ${error instanceof Error ? error.message : String(error)}`,
				path: dir,
			});
		}
	}
	return { commands, diagnostics };
}

/**
 * Adapt one already-resolved prompt template into a `LoadedCommand`. Templates
 * carry no A.7 frontmatter beyond description/argument-hint, so the remaining
 * A.7 fields default (user-invocable true, model-invocable, no shell override).
 */
export function adaptPromptTemplate(template: PromptTemplate): LoadedCommand {
	const commandNameValid = isBareSkillCommandName(template.name);
	return {
		kind: "prompt",
		name: template.name,
		...(template.description !== undefined && template.description !== "" && { description: template.description }),
		...(template.argumentHint !== undefined && { argumentHint: template.argumentHint }),
		frontmatter: {},
		body: template.content,
		filePath: template.filePath,
		baseDir: dirname(template.filePath),
		sourceInfo: template.sourceInfo,
		commandNameValid,
		userInvocable: true,
		disableModelInvocation: false,
	};
}

/** Adapt the resolved prompt template list, emitting one invalid-name diagnostic each. */
export function adaptPromptTemplates(templates: readonly PromptTemplate[]): LoadCommandsResult {
	const commands: LoadedCommand[] = [];
	const diagnostics: ResourceDiagnostic[] = [];
	for (const template of templates) {
		const command = adaptPromptTemplate(template);
		if (!command.commandNameValid) {
			diagnostics.push(invalidNameDiagnostic(command.name, command.filePath));
		}
		commands.push(command);
	}
	return { commands, diagnostics };
}

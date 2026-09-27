/**
 * Fork-owned: discovers agent files. User agents come from `<agentDir>/agents`, then, only in a
 * trusted project, from `<cwd>/.agents/agents` and `<cwd>/.pi/agents`; a later source overrides an
 * earlier one by name. Skill-bundled agents come from `<skill baseDir>/agents` of each skill whose
 * visibility is not `off`. pi-subagents `src/custom-agents.ts` and `src/agent-dir-loader.ts` at
 * 79a7c42 are the behavior reference; its unconditional project read is the trust gap this closes.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillSetSnapshotEntry } from "../../../skills/skill-set-events.ts";
import { parseAgentFile } from "./frontmatter.ts";
import type { AgentDefinition, AgentSource } from "./types.ts";

export interface AgentFileLoadOptions {
	agentDir: string;
	cwd: string;
	/** Project agent directories are read only when the project is trusted. */
	projectTrusted: boolean;
	/** `strictAgentFiles`: an unreadable file or an unknown key throws instead of warning. */
	strict: boolean;
}

export interface AgentFileLoad {
	agents: Map<string, AgentDefinition>;
	/** One line per problem, each naming the file. */
	warnings: string[];
}

/** The skill fields discovery reads, as the skill-set snapshot carries them. */
export type SkillAgentSource = Pick<SkillSetSnapshotEntry, "id" | "listingName" | "baseDir" | "visibility">;

/** One agent a skill bundles, before the registry mints its names. */
export interface BundledAgent {
	skillId: string;
	listingName: string;
	definition: AgentDefinition;
}

type FileSourceKind = Exclude<AgentSource["kind"], "default">;

export function loadAgentFiles(options: AgentFileLoadOptions): AgentFileLoad {
	const agents = new Map<string, AgentDefinition>();
	const warnings: string[] = [];
	const directories: Array<[string, "global" | "project"]> = [[join(options.agentDir, "agents"), "global"]];
	if (options.projectTrusted) {
		directories.push([join(options.cwd, ".agents", "agents"), "project"]);
		directories.push([join(options.cwd, ".pi", "agents"), "project"]);
	}
	for (const [dir, kind] of directories) {
		for (const definition of loadAgentDirectory(dir, kind, options.strict, warnings)) {
			agents.set(definition.name, definition);
		}
	}
	return { agents, warnings };
}

/**
 * Skill-bundled agents. A skill whose visibility is `off`, or arrives malformed, contributes none.
 * Skill files are third-party content, so `strictAgentFiles` never applies to them: a problem only warns.
 * Within one skill, a later file overrides an earlier one of the same name.
 */
export function loadSkillAgents(skills: readonly SkillAgentSource[]): { agents: BundledAgent[]; warnings: string[] } {
	const agents: BundledAgent[] = [];
	const warnings: string[] = [];
	for (const skill of skills) {
		if (skill.visibility?.userInvokeError !== false) continue;
		const byName = new Map<string, AgentDefinition>();
		for (const definition of loadAgentDirectory(join(skill.baseDir, "agents"), "skill", false, warnings, skill.id)) {
			byName.set(definition.name, definition);
		}
		for (const definition of byName.values()) {
			agents.push({ skillId: skill.id, listingName: skill.listingName, definition });
		}
	}
	return { agents, warnings };
}

/**
 * One directory's `*.md` files, sorted so a name clash resolves the same way everywhere.
 * A skill's directory is third-party content, so its symlinked entries are skipped.
 */
function loadAgentDirectory(
	dir: string,
	kind: FileSourceKind,
	strict: boolean,
	warnings: string[],
	skillId = "",
): AgentDefinition[] {
	let files: string[];
	try {
		files = readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.name.endsWith(".md") && (kind !== "skill" || entry.isFile()))
			.map((entry) => entry.name)
			.sort();
	} catch {
		// A missing directory is the normal case.
		return [];
	}
	const definitions: AgentDefinition[] = [];
	for (const file of files) {
		const sourcePath = join(dir, file);
		const source: Exclude<AgentSource, { kind: "default" }> =
			kind === "skill" ? { kind, sourcePath, skillId } : { kind, sourcePath };
		let content: string;
		try {
			content = readFileSync(sourcePath, "utf-8");
		} catch (error) {
			const message = `Agent file ${sourcePath} is unreadable: ${error instanceof Error ? error.message : String(error)}`;
			if (strict) throw new Error(message);
			warnings.push(`${message}. Skipping it.`);
			continue;
		}
		const parsed = parseAgentFile(content, source);
		if (parsed.unknownKeys.length > 0) {
			const messages = parsed.unknownKeys.map(
				(key) => `Agent file ${sourcePath} has unknown frontmatter key "${key}"`,
			);
			if (strict) throw new Error(messages.join("; "));
			warnings.push(...messages.map((message) => `${message}; it is ignored.`));
		}
		for (const reason of parsed.invalidValues) {
			warnings.push(`Agent file ${sourcePath} has an invalid value for ${reason}; it is ignored.`);
		}
		if (!parsed.definition) {
			const message = `Agent file ${sourcePath} cannot load: ${parsed.error}`;
			// A reserved name only warns, even under strict: the file is refused either way.
			if (strict && parsed.errorKind === "parse") throw new Error(message);
			warnings.push(`${message}. Skipping it.`);
			continue;
		}
		definitions.push(parsed.definition);
	}
	return definitions;
}

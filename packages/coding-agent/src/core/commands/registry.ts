/**
 * A.1 / ADR-0005 unified command namespace. Folds four source tiers into one
 * flat bare-name registry with deterministic precedence:
 *
 *   built-ins > extension commands > commands/templates > skills
 *
 * The reserved qualifier prefixes `skill:`, `prompt:`, `ext:` (and generated
 * nested `dir:name` forms) always resolve as disambiguators, so a bare-name
 * loser is never unreachable. Two entry classes:
 *
 * - **prompt-producing** (skills, commands, templates) — recognized and
 *   expanded anywhere in a message by the A.1 tokenizer.
 * - **control** (built-ins, extension commands) — recognized message-initial
 *   only; mid-prompt they stay literal.
 *
 * Cross-tier collisions demote the loser to its qualified form; same-tier
 * collisions keep every variant under a generated `dir:name` qualifier and
 * attach a note listing the variants to the bare name. One aggregated,
 * single-line diagnostic reports every collision.
 *
 * Namespace eligibility is a gate, not a load gate: entries with an invalid
 * bare name or `user-invocable: false` (and, for skills, `enableSkillCommands:
 * false`) are excluded here but remain model-invocable through their tools.
 */

import { basename, dirname } from "node:path";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { LoadedSkill } from "../skills/frontmatter.ts";
import type { BuiltinSlashCommand } from "../slash-commands.ts";
import type { SourceInfo } from "../source-info.ts";
import type { LoadedCommand } from "./loader.ts";

export type CommandSource = "builtin" | "extension" | "command" | "prompt" | "skill";

/** Precedence tier per source (lower wins the bare namespace). */
const TIER: Record<CommandSource, number> = {
	builtin: 0,
	extension: 1,
	command: 2,
	prompt: 2,
	skill: 3,
};

/** Extension command shape the registry needs (a projection of the runner's RegisteredCommand). */
export interface ExtensionCommandInfo {
	/** Underlying command name (used for the `ext:` qualifier and handler lookup). */
	name: string;
	/** Bare invocation name (may be deconflicted by the extension runner). */
	invocationName: string;
	description?: string;
	sourceInfo?: SourceInfo;
}

/** Resolution result for a recognized token. */
export interface ResolvedInvocation {
	source: CommandSource;
	/** Bare display name of the entry. */
	name: string;
	/** True for built-in / extension controls (message-initial only, not prompt-producing). */
	control: boolean;
	/** Present for `command` / `prompt` sources. */
	command?: LoadedCommand;
	/** Present for `skill` source. */
	skill?: LoadedSkill;
	/** For extension controls: the name to pass to the extension runner's `getCommand`. */
	extensionName?: string;
	/** When a bare name is ambiguous (same-tier nested collision), the qualified variants. */
	nestedVariants?: string[];
}

/** One flat listing row (built-ins included exactly once). */
export interface CommandListingEntry {
	/** Invocation name shown: the bare winner, or a qualified form for losers/variants. */
	name: string;
	description?: string;
	argumentHint?: string;
	source: CommandSource;
	sourceInfo?: SourceInfo;
}

export interface CommandRegistry {
	/**
	 * Resolve a token (bare or qualified) to an invocation. `messageInitial`
	 * gates controls: mid-prompt, controls resolve to undefined (literal text).
	 * Returns undefined for any unregistered name (A.1: no fuzzy fallback).
	 */
	resolve(name: string, options: { messageInitial: boolean }): ResolvedInvocation | undefined;
	/** Complete flat listing for autocomplete / `getCommands()`. */
	getListing(): CommandListingEntry[];
	/** One aggregated single-line collision diagnostic, or undefined when none. */
	collisionDiagnostic?: ResourceDiagnostic;
}

interface InternalEntry {
	source: CommandSource;
	name: string;
	tier: number;
	control: boolean;
	description?: string;
	argumentHint?: string;
	sourceInfo?: SourceInfo;
	/** Reserved-prefix qualifier (`skill:`/`prompt:`/`ext:`); absent for built-ins. */
	qualifier?: string;
	baseDir?: string;
	command?: LoadedCommand;
	skill?: LoadedSkill;
	extensionName?: string;
}

export interface BuildCommandRegistryInput {
	builtins: readonly BuiltinSlashCommand[];
	extensionCommands: readonly ExtensionCommandInfo[];
	/** Native commands and grandfathered templates, already merged by the loader. */
	commands: readonly LoadedCommand[];
	skills: readonly LoadedSkill[];
	/** `enableSkillCommands` (false removes bare skills only). */
	enableSkillCommands: boolean;
}

/** Generate a `dir:name` disambiguator for a same-tier nested collision. */
function dirQualifier(baseDir: string | undefined, name: string): string {
	let segment = baseDir ? basename(baseDir) : "";
	if (segment === "" || segment === name) {
		const parent = baseDir ? basename(dirname(baseDir)) : "";
		if (parent !== "" && parent !== name) {
			segment = parent;
		}
	}
	return segment !== "" ? `${segment}:${name}` : name;
}

export function buildCommandRegistry(input: BuildCommandRegistryInput): CommandRegistry {
	const entries: InternalEntry[] = [];

	for (const builtin of input.builtins) {
		entries.push({
			source: "builtin",
			name: builtin.name,
			tier: TIER.builtin,
			control: true,
			description: builtin.description,
			argumentHint: builtin.argumentHint,
		});
	}
	for (const extension of input.extensionCommands) {
		entries.push({
			source: "extension",
			name: extension.invocationName,
			tier: TIER.extension,
			control: true,
			description: extension.description,
			sourceInfo: extension.sourceInfo,
			qualifier: `ext:${extension.name}`,
			extensionName: extension.name,
		});
	}
	for (const command of input.commands) {
		if (!command.commandNameValid || !command.userInvocable) {
			continue;
		}
		const source: CommandSource = command.kind === "command" ? "command" : "prompt";
		entries.push({
			source,
			name: command.name,
			tier: TIER.command,
			control: false,
			description: command.description,
			argumentHint: command.argumentHint,
			sourceInfo: command.sourceInfo,
			qualifier: `prompt:${command.name}`,
			baseDir: command.baseDir,
			command,
		});
	}
	if (input.enableSkillCommands) {
		for (const skill of input.skills) {
			if (!skill.commandNameValid || !skill.userInvocable) {
				continue;
			}
			entries.push({
				source: "skill",
				name: skill.name,
				tier: TIER.skill,
				control: false,
				description: skill.description,
				argumentHint: skill.argumentHint,
				sourceInfo: skill.sourceInfo,
				qualifier: `skill:${skill.name}`,
				baseDir: skill.baseDir,
				skill,
			});
		}
	}

	const resolved = new Map<string, ResolvedInvocation>();
	const listing: CommandListingEntry[] = [];
	const collisions: string[] = [];

	const toInvocation = (entry: InternalEntry, nestedVariants?: string[]): ResolvedInvocation => ({
		source: entry.source,
		name: entry.name,
		control: entry.control,
		...(entry.command !== undefined && { command: entry.command }),
		...(entry.skill !== undefined && { skill: entry.skill }),
		...(entry.extensionName !== undefined && { extensionName: entry.extensionName }),
		...(nestedVariants !== undefined && { nestedVariants }),
	});

	const register = (name: string, invocation: ResolvedInvocation): void => {
		if (!resolved.has(name)) {
			resolved.set(name, invocation);
		}
	};

	// Group by bare name, preserving input order within a name.
	const byName = new Map<string, InternalEntry[]>();
	for (const entry of entries) {
		const group = byName.get(entry.name);
		if (group) {
			group.push(entry);
		} else {
			byName.set(entry.name, [entry]);
		}
	}

	for (const [name, group] of byName) {
		// Sort by tier (stable) so the highest-precedence entry is first.
		const ordered = [...group].sort((a, b) => a.tier - b.tier);
		const winner = ordered[0];
		const winnerTierPeers = ordered.filter((entry) => entry.tier === winner.tier);

		if (winnerTierPeers.length > 1) {
			// Same-tier nested collision: keep every variant under a dir-qualified
			// name; the bare name resolves to the first and carries the variant note.
			const variants = winnerTierPeers.map((entry) => dirQualifier(entry.baseDir, name));
			winnerTierPeers.forEach((entry, index) => {
				register(variants[index], toInvocation(entry));
				if (entry.qualifier) {
					register(entry.qualifier, toInvocation(entry));
				}
				listing.push({
					name: variants[index],
					...(entry.description !== undefined && { description: entry.description }),
					...(entry.argumentHint !== undefined && { argumentHint: entry.argumentHint }),
					source: entry.source,
					...(entry.sourceInfo !== undefined && { sourceInfo: entry.sourceInfo }),
				});
			});
			register(name, toInvocation(winner, variants));
			collisions.push(`/${name} nested variants: ${variants.join(", ")}`);
		} else {
			// Bare winner keeps the bare name; register its own qualifier too.
			register(name, toInvocation(winner));
			if (winner.qualifier) {
				register(winner.qualifier, toInvocation(winner));
			}
			listing.push({
				name,
				...(winner.description !== undefined && { description: winner.description }),
				...(winner.argumentHint !== undefined && { argumentHint: winner.argumentHint }),
				source: winner.source,
				...(winner.sourceInfo !== undefined && { sourceInfo: winner.sourceInfo }),
			});
		}

		// Cross-tier losers keep only their qualified form.
		const losers = ordered.slice(winnerTierPeers.length);
		const loserLabels: string[] = [];
		for (const loser of losers) {
			if (!loser.qualifier) {
				continue;
			}
			register(loser.qualifier, toInvocation(loser));
			listing.push({
				name: loser.qualifier,
				...(loser.description !== undefined && { description: loser.description }),
				...(loser.argumentHint !== undefined && { argumentHint: loser.argumentHint }),
				source: loser.source,
				...(loser.sourceInfo !== undefined && { sourceInfo: loser.sourceInfo }),
			});
			loserLabels.push(`/${loser.qualifier}`);
		}
		if (loserLabels.length > 0) {
			collisions.push(`/${name} resolves to ${winner.source}; also ${loserLabels.join(", ")}`);
		}
	}

	const collisionDiagnostic: ResourceDiagnostic | undefined =
		collisions.length > 0
			? { type: "warning", message: `command namespace collisions: ${collisions.join("; ")}` }
			: undefined;

	return {
		resolve(lookupName, options): ResolvedInvocation | undefined {
			const invocation = resolved.get(lookupName);
			if (!invocation) {
				return undefined;
			}
			if (invocation.control && !options.messageInitial) {
				return undefined;
			}
			return invocation;
		},
		getListing(): CommandListingEntry[] {
			return listing;
		},
		...(collisionDiagnostic !== undefined && { collisionDiagnostic }),
	};
}

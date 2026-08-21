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
import { defaultSkillVisibility, type ResolvedSkillVisibility } from "../skills/visibility.ts";
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

interface ResolvedInvocationBase {
	/** Bare display name of the entry. */
	name: string;
	/** When a bare name is ambiguous (same-tier nested collision), the qualified variants. */
	nestedVariants?: string[];
}

/** Skill invocation (prompt-producing). */
export interface ResolvedSkillInvocation extends ResolvedInvocationBase {
	source: "skill";
	control: false;
	skill: LoadedSkill;
}

/** Command / grandfathered-template invocation (prompt-producing). */
export interface ResolvedCommandInvocation extends ResolvedInvocationBase {
	source: "command" | "prompt";
	control: false;
	command: LoadedCommand;
}

/** Built-in control (message-initial only, not prompt-producing). */
export interface ResolvedBuiltinInvocation extends ResolvedInvocationBase {
	source: "builtin";
	control: true;
}

/** Extension control (message-initial only, not prompt-producing). */
export interface ResolvedExtensionInvocation extends ResolvedInvocationBase {
	source: "extension";
	control: true;
	/** The name to pass to the extension runner's `getCommand`. */
	extensionName: string;
}

/** Resolution result for a recognized token (discriminated on `source`). */
export type ResolvedInvocation =
	| ResolvedSkillInvocation
	| ResolvedCommandInvocation
	| ResolvedBuiltinInvocation
	| ResolvedExtensionInvocation;

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
	/**
	 * A.6 `off` tombstones (c4c): resolve a name that belongs to a skill at
	 * visibility `off` (consumed-error invocation, never literal text). Fallback
	 * only — a live `resolved` hit always wins, so an `off` skill never shadows
	 * a higher-precedence command. Tombstoned names never enter the listing,
	 * autocomplete, or collision accounting.
	 */
	resolveDisabled(name: string): { skillName: string; skillId: string } | undefined;
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
	/** A.6 per-skill effective visibility (c4c), keyed by canonical skill ID; absent entries fall back to frontmatter. */
	skillVisibility?: ReadonlyMap<string, ResolvedSkillVisibility>;
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

/** A.1 note appended when an unqualified invocation has nested qualified variants (c4d). */
export function formatNestedVariantsNote(name: string, variants: readonly string[]): string {
	const list = variants.map((variant) => `/${variant}`).join(", ");
	return `Note: /${name} has nested variants; the first was invoked. Qualified variants: ${list}.`;
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
	// A.6 (c4c): effective visibility = AND of frontmatter and the persisted
	// per-skill state. `off` skills leave the namespace but keep a tombstone so
	// every would-be name errors instead of staying literal.
	const visibilityOf = (skill: LoadedSkill): ResolvedSkillVisibility =>
		input.skillVisibility?.get(skill.id) ??
		defaultSkillVisibility({
			disableModelInvocation: skill.disableModelInvocation,
			userInvocable: skill.userInvocable,
		});
	const disabledSkills: LoadedSkill[] = [];
	if (input.enableSkillCommands) {
		for (const skill of input.skills) {
			if (!skill.commandNameValid) {
				continue;
			}
			const visibility = visibilityOf(skill);
			if (visibility.userInvokeError) {
				disabledSkills.push(skill);
				continue;
			}
			if (visibility.user === "no") {
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

	const toInvocation = (entry: InternalEntry, nestedVariants?: string[]): ResolvedInvocation => {
		const base: ResolvedInvocationBase = {
			name: entry.name,
			...(nestedVariants !== undefined && { nestedVariants }),
		};
		// Entry construction above guarantees the variant field per source.
		switch (entry.source) {
			case "skill":
				return { ...base, source: "skill", control: false, skill: entry.skill as LoadedSkill };
			case "command":
			case "prompt":
				return { ...base, source: entry.source, control: false, command: entry.command as LoadedCommand };
			case "extension":
				return {
					...base,
					source: "extension",
					control: true,
					extensionName: entry.extensionName as string,
				};
			case "builtin":
				return { ...base, source: "builtin", control: true };
		}
	};

	const toListingEntry = (entry: InternalEntry, displayName: string): CommandListingEntry => ({
		name: displayName,
		...(entry.description !== undefined && { description: entry.description }),
		...(entry.argumentHint !== undefined && { argumentHint: entry.argumentHint }),
		source: entry.source,
		...(entry.sourceInfo !== undefined && { sourceInfo: entry.sourceInfo }),
	});

	const register = (name: string, invocation: ResolvedInvocation, onDuplicate?: () => void): void => {
		if (!resolved.has(name)) {
			resolved.set(name, invocation);
		} else {
			onDuplicate?.();
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
			// Same-tier nested collision: keep every variant under a qualified name;
			// the bare name resolves to the first and carries the variant note. A
			// skill discovered from a nested root (c4d) carries its A.6 dir-qualified
			// name as listingName (e.g. `apps/web:deploy`); other entries derive the
			// dir qualifier from baseDir as before.
			const variants = winnerTierPeers.map((entry) =>
				entry.source === "skill" && entry.skill && entry.skill.listingName !== name
					? entry.skill.listingName
					: dirQualifier(entry.baseDir, name),
			);
			const seenSkillQualifiers = new Set<string>();
			winnerTierPeers.forEach((entry, index) => {
				register(variants[index], toInvocation(entry), () => {
					collisions.push(`/${name} qualifier "${variants[index]}" is ambiguous; one variant is unreachable`);
				});
				if (entry.qualifier) {
					// Two same-name skill collide-ees share the `skill:name` qualifier; the
					// first registration wins silently (the dir-qualified variants are the
					// disambiguators, noted below).
					const intraGroupSkillDupe = entry.source === "skill" && seenSkillQualifiers.has(entry.qualifier);
					if (entry.source === "skill") {
						seenSkillQualifiers.add(entry.qualifier);
					}
					if (!intraGroupSkillDupe) {
						register(entry.qualifier, toInvocation(entry), () => {
							collisions.push(
								`/${name} qualifier "${entry.qualifier}" is ambiguous; one variant is unreachable`,
							);
						});
					}
				}
				listing.push(toListingEntry(entry, variants[index]));
			});
			register(name, toInvocation(winner, variants));
			collisions.push(`/${name} nested variants: ${variants.join(", ")}`);
		} else {
			// Bare winner keeps the bare name; register its own qualifier too.
			register(name, toInvocation(winner));
			if (winner.qualifier) {
				register(winner.qualifier, toInvocation(winner));
			}
			listing.push(toListingEntry(winner, name));
		}

		// Cross-tier losers keep only their qualified form.
		const losers = ordered.slice(winnerTierPeers.length);
		const loserLabels: string[] = [];
		for (const loser of losers) {
			if (!loser.qualifier) {
				continue;
			}
			register(loser.qualifier, toInvocation(loser), () => {
				collisions.push(
					`/${name} qualifier "${loser.qualifier}" is ambiguous; one variant is unreachable (dir-qualified names land in C4)`,
				);
			});
			listing.push(toListingEntry(loser, loser.qualifier));
			loserLabels.push(`/${loser.qualifier}`);
		}
		if (loserLabels.length > 0) {
			collisions.push(`/${name} resolves to ${winner.source}; also ${loserLabels.join(", ")}`);
		}
	}

	// A.6 `off` tombstones (c4c): every name the skill would otherwise be
	// reachable under — bare, `skill:` qualifier, and, for same-tier collision
	// participants, each `dirQualifier` variant. Fallback-only: a tombstone is
	// never installed over a live `resolved` name, so an `off` skill never
	// shadows a higher-precedence command or a visible winner's bare name, and
	// never enters `listing`/collisions. Gated by `commandNameValid &&
	// enableSkillCommands` only — `off` error-resolution overrides
	// `user-invocable: false` (A.6 marks `off` "invocation errors" across all
	// four frontmatter columns).
	const disabled = new Map<string, { skillName: string; skillId: string }>();
	if (disabledSkills.length > 0) {
		const offCountByName = new Map<string, number>();
		for (const skill of disabledSkills) {
			offCountByName.set(skill.name, (offCountByName.get(skill.name) ?? 0) + 1);
		}
		const tombstone = (name: string, skill: LoadedSkill): void => {
			if (!resolved.has(name) && !disabled.has(name)) {
				disabled.set(name, { skillName: skill.name, skillId: skill.id });
			}
		};
		for (const skill of disabledSkills) {
			tombstone(skill.name, skill);
			tombstone(`skill:${skill.name}`, skill);
			const group = byName.get(skill.name);
			const higherTierClaimsBare = group?.some((entry) => entry.tier < TIER.skill) ?? false;
			const skillTierEntries = group?.filter((entry) => entry.tier === TIER.skill).length ?? 0;
			if (!higherTierClaimsBare && skillTierEntries + (offCountByName.get(skill.name) ?? 0) > 1) {
				// A nested collide-ee (c4d) carries its A.6 dir-qualified listingName; others derive it from baseDir.
				tombstone(
					skill.listingName !== skill.name ? skill.listingName : dirQualifier(skill.baseDir, skill.name),
					skill,
				);
			}
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
		resolveDisabled(lookupName): { skillName: string; skillId: string } | undefined {
			return disabled.get(lookupName);
		},
		getListing(): CommandListingEntry[] {
			return listing;
		},
		...(collisionDiagnostic !== undefined && { collisionDiagnostic }),
	};
}

/**
 * Fork-owned: the agent registry and type resolution. The defaults come first unless
 * `disableDefaultAgents` is on, user agents override them by name, and skill-bundled agents
 * join last without competing (ADR-0008): each always registers as `listingName:agent`, and its
 * bare alias only when no default or user agent holds the name (case-insensitively) and exactly
 * one skill claims it. Skill agents are hidden from listings and stay spawnable by exact name.
 * pi-subagents `src/agent-types.ts` at 79a7c42 is the behavior reference.
 */
import { DEFAULT_AGENTS, GENERAL_PURPOSE_AGENT } from "./defaults.ts";
import type { BundledAgent } from "./load.ts";
import { type AgentDefinition, QUALIFIED_SEPARATOR } from "./types.ts";

/** `fallbackSubagent` value that refuses an unresolved type instead of substituting one. */
export const NO_FALLBACK = "none";

/** Whether a skill agent's bare alias was granted; the rewrite maps publish `collided` as its negation. */
export interface SkillAliasDecision {
	skillId: string;
	bareName: string;
	qualified: string;
	granted: boolean;
}

export interface AgentRegistry {
	/** Registry key to definition; a skill agent appears under its qualified name and, when granted, its alias. */
	readonly agents: ReadonlyMap<string, AgentDefinition>;
	/** One decision per skill-bundled agent, in discovery order. */
	readonly aliases: readonly SkillAliasDecision[];
}

export interface AgentRegistryInputs {
	userAgents: ReadonlyMap<string, AgentDefinition>;
	skillAgents?: readonly BundledAgent[];
	disableDefaultAgents?: boolean;
}

export function buildAgentRegistry(inputs: AgentRegistryInputs): AgentRegistry {
	const agents = new Map<string, AgentDefinition>();
	if (!inputs.disableDefaultAgents) {
		for (const definition of DEFAULT_AGENTS) agents.set(definition.name, definition);
	}
	for (const [name, definition] of inputs.userAgents) agents.set(name, definition);

	const bundled = inputs.skillAgents ?? [];
	const aliases: SkillAliasDecision[] = [];
	if (bundled.length === 0) return { agents, aliases };

	const heldNames = new Set([...agents.keys()].map((name) => name.toLowerCase()));
	// A name claimed by two skills goes to neither. A disabled agent claims nothing.
	const claimants = new Map<string, Set<string>>();
	for (const { skillId, definition } of bundled) {
		if (!definition.enabled) continue;
		const lower = definition.name.toLowerCase();
		const skills = claimants.get(lower) ?? new Set<string>();
		skills.add(skillId);
		claimants.set(lower, skills);
	}
	const qualifiedOwners = new Map<string, string>();
	const minted: Array<{ entry: BundledAgent; qualified: string }> = [];
	for (const entry of bundled) {
		const qualified = `${entry.listingName}${QUALIFIED_SEPARATOR}${entry.definition.name}`;
		// Listing names are unique per snapshot, so this only guards a malformed one: the first skill keeps it.
		const owner = qualifiedOwners.get(qualified);
		if (owner !== undefined && owner !== entry.skillId) continue;
		qualifiedOwners.set(qualified, entry.skillId);
		agents.set(qualified, skillEntry(entry.definition, qualified));
		minted.push({ entry, qualified });
	}
	for (const { entry, qualified } of minted) {
		const bareName = entry.definition.name;
		const lower = bareName.toLowerCase();
		const granted = entry.definition.enabled && !heldNames.has(lower) && claimants.get(lower)?.size === 1;
		if (granted) agents.set(bareName, skillEntry(entry.definition, bareName));
		aliases.push({ skillId: entry.skillId, bareName, qualified, granted });
	}
	return { agents, aliases };
}

function skillEntry(definition: AgentDefinition, name: string): AgentDefinition {
	return { ...definition, name, hidden: true };
}

/** Enabled, listed agent types: the Agent tool's type list. Skill agents are hidden here. */
export function listedAgentTypes(registry: AgentRegistry): string[] {
	return [...registry.agents]
		.filter(([, definition]) => definition.enabled && !definition.hidden)
		.map(([name]) => name);
}

/**
 * The key a name identifies case-insensitively, or undefined. An exact match wins; otherwise
 * exactly one key may match, so two agents that differ only by case never resolve by guess.
 */
export function resolveAgentKey(registry: AgentRegistry, name: string): string | undefined {
	if (registry.agents.has(name)) return name;
	const lower = name.toLowerCase();
	const matches = [...registry.agents.keys()].filter((key) => key.toLowerCase() === lower);
	return matches.length === 1 ? matches[0] : undefined;
}

/** The definition a name identifies when it is exactly one enabled agent. Nested delegation uses this directly. */
export function findEnabledAgent(registry: AgentRegistry, requested: unknown): AgentDefinition | undefined {
	const raw = typeof requested === "string" ? requested.trim() : "";
	if (!raw) return undefined;
	const key = resolveAgentKey(registry, raw);
	const definition = key === undefined ? undefined : registry.agents.get(key);
	return definition?.enabled ? definition : undefined;
}

export type SpawnTypeResolution =
	| { ok: true; definition: AgentDefinition; fellBackFrom?: string }
	| { ok: false; message: string };

/**
 * Resolves a caller-supplied type. An unknown, disabled or case-ambiguous name falls back to
 * `general-purpose` when `fallbackSubagent` is unset, to the named agent when it is set, and is
 * refused under `none`. A configured fallback that is itself unusable is refused, never replaced.
 */
export function resolveSpawnType(
	registry: AgentRegistry,
	requested: unknown,
	fallbackSubagent?: string,
): SpawnTypeResolution {
	const raw = typeof requested === "string" ? requested.trim() : "";
	const found = findEnabledAgent(registry, raw);
	if (found) return { ok: true, definition: found };

	const available = listedAgentTypes(registry).join(", ") || "(none)";
	const reason = raw ? `Unknown or disabled agent type: "${raw}".` : "No agent type given.";
	const configured = fallbackSubagent?.trim();
	if (configured?.toLowerCase() === NO_FALLBACK) return { ok: false, message: `${reason} Available: ${available}.` };
	if (configured) {
		const fallback = findEnabledAgent(registry, configured);
		if (!fallback) {
			return {
				ok: false,
				message: `${reason} The configured fallbackSubagent "${configured}" is itself unknown or disabled. Available: ${available}.`,
			};
		}
		return { ok: true, definition: fallback, fellBackFrom: raw };
	}
	const generalPurpose = findEnabledAgent(registry, GENERAL_PURPOSE_AGENT) ?? DEFAULT_AGENTS[0];
	return { ok: true, definition: generalPurpose, fellBackFrom: raw };
}

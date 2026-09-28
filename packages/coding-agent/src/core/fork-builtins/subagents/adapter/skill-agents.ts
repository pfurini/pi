/**
 * Fork-owned: the skill-agent rewrite maps (plan T8; ADR-0008; pi-subagents
 * `src/skill-agents-adapter.ts` and `src/skill-agents.ts` at 79a7c42). A session's core
 * `SkillRuntime` rewrites a skill's bare agent names from these maps, so a bare name another agent
 * holds goes to the skill's qualified agent instead.
 *
 * Each bus keeps its own maps and revision. A publication happens only when the maps change: at the
 * adapter's install, on every `skills:changed`, and after a definition reload. The revision grows by
 * one per publication, and `skill-agents:query` answers with the latest maps. The wire types are
 * core's own (`skills/runtime.ts`).
 */
import type { AgentSession } from "../../../agent-session.ts";
import type { EventBus } from "../../../event-bus.ts";
import {
	SKILL_AGENTS_QUERY_CHANNEL,
	SKILL_AGENTS_REWRITE_MAPS_CHANNEL,
	type SkillAgentRewriteMaps,
	type SkillAgentRewriteMapsEvent,
	skillAgentsQueryReplyChannel,
} from "../../../skills/runtime.ts";
import { SKILLS_CHANGED_CHANNEL } from "../../../skills/skill-set-events.ts";
import type { SkillAliasDecision } from "../definitions/registry.ts";
import { loadAgentRegistry, reportSubagentWarning, sessionCwd, subagentSessionRecord } from "../service/service.ts";
import { readSubagentSettings } from "../settings/settings.ts";

interface MapsState {
	revision: number;
	maps: SkillAgentRewriteMaps;
	/** The published maps as sorted JSON; the empty map before any publication. */
	serialized: string;
}

const states = new WeakMap<EventBus, MapsState>();

function stateOf(bus: EventBus): MapsState {
	let state = states.get(bus);
	if (!state) {
		state = { revision: 0, maps: {}, serialized: "{}" };
		states.set(bus, state);
	}
	return state;
}

/** `{ [skillId]: { [bareName]: { qualified, collided } } }`, keys sorted so equal maps serialize equally. */
function buildMaps(aliases: readonly SkillAliasDecision[]): SkillAgentRewriteMaps {
	const maps: Record<string, Record<string, { qualified: string; collided: boolean }>> = {};
	for (const decision of [...aliases].sort((a, b) =>
		a.skillId === b.skillId ? a.bareName.localeCompare(b.bareName) : a.skillId.localeCompare(b.skillId),
	)) {
		maps[decision.skillId] ??= {};
		maps[decision.skillId][decision.bareName] = { qualified: decision.qualified, collided: !decision.granted };
	}
	return maps;
}

/** Publishes the maps these alias decisions give, unless they equal the last published ones. */
export function publishRewriteMaps(bus: EventBus, aliases: readonly SkillAliasDecision[]): void {
	const state = stateOf(bus);
	const maps = buildMaps(aliases);
	const serialized = JSON.stringify(maps);
	if (serialized === state.serialized) return;
	state.revision += 1;
	state.maps = maps;
	state.serialized = serialized;
	const event: SkillAgentRewriteMapsEvent = { revision: state.revision, maps };
	bus.emit(SKILL_AGENTS_REWRITE_MAPS_CHANNEL, event);
}

/**
 * Reloads the session's agents as its next spawn would, and publishes their maps when they changed.
 * A child session takes its agent files from its owner service's last reload instead of sweeping again.
 */
export function publishSessionRewriteMaps(session: AgentSession, bus: EventBus): void {
	const context = subagentSessionRecord(session);
	if (!context) return;
	try {
		const { settings } = readSubagentSettings(session.settingsManager);
		const { registry } = loadAgentRegistry({
			session,
			agentDir: context.agentDir,
			eventBus: bus,
			// A child's agents come from its owner's project, as its spawns resolve them, wherever it works.
			cwd: context.lineage ? context.lineage.owner.defaultCwd() : sessionCwd(session),
			settings,
			// A child reuses the files its owner loaded for the spawn, so a spawn sweeps them once (D34).
			files: context.lineage?.owner.agentFiles,
		});
		publishRewriteMaps(bus, registry.aliases);
	} catch (error) {
		// Only strict agent files throw here; the next spawn reports the same error to its caller.
		reportSubagentWarning(
			session,
			`Skill agent maps were not republished: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/** Answers `skill-agents:query` and republishes on `skills:changed`; returns the unsubscriber. */
export function serveSkillAgents(session: AgentSession, bus: EventBus): () => void {
	const offChanged = bus.on(SKILLS_CHANGED_CHANNEL, () => publishSessionRewriteMaps(session, bus));
	const offQuery = bus.on(SKILL_AGENTS_QUERY_CHANNEL, (data) => {
		const requestId = (data as { requestId?: unknown } | null)?.requestId;
		if (typeof requestId !== "string" || requestId.length === 0) return;
		const { revision, maps } = stateOf(bus);
		const reply: { success: true; data: SkillAgentRewriteMapsEvent } = { success: true, data: { revision, maps } };
		bus.emit(skillAgentsQueryReplyChannel(requestId), reply);
	});
	return () => {
		offChanged();
		offQuery();
	};
}

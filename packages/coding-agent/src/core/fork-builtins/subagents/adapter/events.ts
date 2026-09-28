/**
 * Fork-owned: the `subagents:*` lifecycle events (plan T8; D19). The names and payloads are
 * pi-subagents' (`README.md` "Events", `docs/rpc.md` and `src/index.ts:634-700` at 79a7c42), so
 * third-party listeners such as pi-tasks keep working unchanged.
 *
 * `bridgeServiceEvents` follows one service and emits each record's events on its owner's bus: a
 * top-level record's on the session's own bus, a nested record's on the bus of the child session its
 * parent runs in, and never on the main session's bus. `subagents:agent-ended` for an RPC spawn waits
 * until that spawn's reply is on the bus.
 */
import type { EventBus } from "../../../event-bus.ts";
import type { SubagentView, TerminalStatus } from "../service/records.ts";
import type { SubagentService } from "../service/service.ts";
import type { SubagentSettings } from "../settings/settings.ts";
import { displayTokens } from "../usage.ts";
import { publishRewriteMaps } from "./skill-agents.ts";

export const AGENT_ENDED_CHANNEL = "subagents:agent-ended";

/** The `subagents:agent-ended` payload: one terminal event per agent, with its native status. */
export interface AgentEndedEvent {
	agentId: string;
	status: TerminalStatus;
	result?: string;
	error?: string;
}

interface Gate {
	pending: Set<string>;
	buffered: Map<string, AgentEndedEvent>;
}

const gates = new WeakMap<EventBus, Gate>();

function gateOf(bus: EventBus): Gate {
	let gate = gates.get(bus);
	if (!gate) {
		gate = { pending: new Set(), buffered: new Map() };
		gates.set(bus, gate);
	}
	return gate;
}

/** Holds the agent's `agent-ended` until `flushSpawnReply`; called when an RPC spawn creates the record. */
export function markSpawnPending(bus: EventBus, agentId: string): void {
	gateOf(bus).pending.add(agentId);
}

/** Releases a held `agent-ended` once the spawn's reply is on the bus. */
export function flushSpawnReply(bus: EventBus, agentId: string): void {
	const gate = gateOf(bus);
	if (!gate.pending.delete(agentId)) return;
	const event = gate.buffered.get(agentId);
	if (!event) return;
	gate.buffered.delete(agentId);
	bus.emit(AGENT_ENDED_CHANNEL, event);
}

function emitAgentEnded(bus: EventBus, event: AgentEndedEvent): void {
	const gate = gateOf(bus);
	if (gate.pending.has(event.agentId)) gate.buffered.set(event.agentId, event);
	else bus.emit(AGENT_ENDED_CHANNEL, event);
}

/** The `subagents:completed` and `subagents:failed` payload; both share it. */
export function lifecyclePayload(record: SubagentView) {
	const total = displayTokens(record.usage);
	const { usage } = record;
	const spent = usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0 || usage.cost.total > 0;
	return {
		id: record.id,
		type: record.type,
		description: record.description,
		result: record.result,
		error: record.error,
		status: record.status,
		toolUses: record.toolUses,
		durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
		// The display total leaves out cacheRead; `usage` is the billed spend and keeps it.
		tokens: total > 0 ? { input: usage.input, output: usage.output, total } : undefined,
		usage: spent ? structuredClone(usage) : undefined,
	};
}

function isFailure(status: SubagentView["status"]): boolean {
	return status === "error" || status === "stopped" || status === "aborted";
}

export function settingsPayload(settings: Readonly<SubagentSettings>) {
	return { settings: { ...settings } };
}

/** What the bridge reads from a service. */
export type BridgedService = Pick<SubagentService, "eventBus" | "settings" | "subscribe" | "ownerBusOf">;

/** Emits a service's lifecycle events on the bus of each record's owner. Attached once, when the service is built. */
export function bridgeServiceEvents(service: BridgedService): void {
	const busOf = (record: SubagentView): EventBus | undefined => service.ownerBusOf(record);
	service.eventBus?.emit("subagents:settings_loaded", settingsPayload(service.settings));
	service.subscribe((event) => {
		switch (event.type) {
			case "created":
				busOf(event.record)?.emit("subagents:created", {
					id: event.record.id,
					type: event.record.type,
					description: event.record.description,
					isBackground: true,
				});
				return;
			case "started":
				busOf(event.record)?.emit("subagents:started", {
					id: event.record.id,
					type: event.record.type,
					description: event.record.description,
				});
				return;
			case "ended": {
				const { record } = event;
				const bus = busOf(record);
				if (!bus || record.status === "queued" || record.status === "running") return;
				bus.emit(isFailure(record.status) ? "subagents:failed" : "subagents:completed", lifecyclePayload(record));
				emitAgentEnded(bus, {
					agentId: record.id,
					status: record.status,
					...(record.result !== undefined && { result: record.result }),
					...(record.error !== undefined && { error: record.error }),
				});
				return;
			}
			case "steered":
				busOf(event.record)?.emit("subagents:steered", { id: event.record.id, message: event.message });
				return;
			case "compacted":
				busOf(event.record)?.emit("subagents:compacted", {
					id: event.record.id,
					type: event.record.type,
					description: event.record.description,
					reason: event.reason,
					tokensBefore: event.tokensBefore,
					compactionCount: event.record.compactionCount,
				});
				return;
			case "settings":
				// The settings come from the settings files, so what changed is already persisted.
				service.eventBus?.emit("subagents:settings_changed", {
					...settingsPayload(event.settings),
					persisted: true,
				});
				return;
			case "definitions":
				if (service.eventBus) publishRewriteMaps(service.eventBus, event.registry.aliases);
				return;
			case "warning":
				return;
		}
	});
}

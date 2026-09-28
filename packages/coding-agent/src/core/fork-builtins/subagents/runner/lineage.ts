/**
 * Fork-owned: who owns a child session. The runner stores a child's lineage for the child
 * loader's event bus before it builds the session, and the child's own base tools find it through
 * the bus they receive (plan Section 2.1 "Child lineage"). A child's spawns then belong to the agent
 * the child runs as, under that agent's `allowed_subagents`, `isolated` and depth.
 */
import type { EventBus } from "../../../event-bus.ts";
import type { SubagentView } from "../service/records.ts";
import type { SubagentService } from "../service/service.ts";

export interface ChildLineage {
	/** The subagent service that built the child. */
	owner: SubagentService;
	/** The agent the child runs as; a spawn from the child's session has it as its parent. */
	parentRecord: SubagentView;
	/** The child's nesting depth: the main session is 0, its subagents 1. */
	depth: number;
	allowedSubagents?: "all" | readonly string[];
	isolated: boolean;
}

const lineages = new WeakMap<EventBus, ChildLineage>();

export function setLineage(bus: EventBus, lineage: ChildLineage): void {
	lineages.set(bus, lineage);
}

/** The lineage of the child session whose loader owns `bus`; undefined for a top-level session. */
export function lineageForBus(bus: EventBus | undefined): ChildLineage | undefined {
	return bus ? lineages.get(bus) : undefined;
}

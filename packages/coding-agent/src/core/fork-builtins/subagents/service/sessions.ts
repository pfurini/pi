/**
 * Fork-owned: which session owns which subagent service (D18, D25; plan T5). `addForkBaseTools`
 * stores a per-session record at each registration without reading the session. The service is
 * built from that record on first use: the first subagent tool call, RPC request or skill-fork
 * spawn. A session with no record (fork built-ins off) has no service.
 */
import type { AgentSession } from "../../../agent-session.ts";
import type { NestedRuntime } from "./nested.ts";
import type { SubagentView } from "./records.ts";
import { SubagentService, type SubagentSessionContext } from "./service.ts";

const sessionRecords = new WeakMap<AgentSession, SubagentSessionContext>();
const services = new WeakMap<AgentSession, SubagentService>();

/**
 * Stores the per-session record `addForkBaseTools` builds at each registration, without reading
 * the session, and returns the stored record. A later registration (`/reload`) updates the same
 * record, so a service built earlier sees the current fork base tools.
 */
export function registerSubagentSession(
	session: AgentSession,
	context: SubagentSessionContext,
): SubagentSessionContext {
	const existing = sessionRecords.get(session);
	if (existing) return Object.assign(existing, context);
	sessionRecords.set(session, context);
	return context;
}

/** Reports a warning through the session's service, or holds it on the per-session record until the service exists. */
export function reportSubagentWarning(session: AgentSession, message: string): void {
	const service = services.get(session);
	if (service) service.warn(message);
	else {
		const context = sessionRecords.get(session);
		if (!context) return;
		context.warnings ??= [];
		context.warnings.push(message);
	}
}

/** The per-session record of a session; undefined when fork built-ins are off for it. */
export function subagentSessionRecord(session: AgentSession): SubagentSessionContext | undefined {
	return sessionRecords.get(session);
}

/** The session's subagent service. `addForkBaseTools` registers the session before any tool exists. */
export function requireService(session: AgentSession): SubagentService {
	const service = subagentServiceFor(session);
	if (!service) throw new Error("This session has no subagent service.");
	return service;
}

/**
 * The session's subagent service, built on first use from its per-session record: the first
 * subagent tool call, RPC request or skill-fork spawn. Undefined for a session with no record.
 */
export function subagentServiceFor(session: AgentSession): SubagentService | undefined {
	let service = services.get(session);
	if (service) return service;
	const context = sessionRecords.get(session);
	if (!context) return undefined;
	service = new SubagentService(session, context);
	services.set(session, service);
	context.onServiceCreated?.(service);
	return service;
}

/** The session's subagent service when one was built; never builds one. */
export function existingSubagentService(session: AgentSession): SubagentService | undefined {
	return services.get(session);
}

/**
 * Where a typed caller spawns and reaches agents (D19): the session's own service, or, in a child
 * session, its owner's service and the nested runtime of the agent the child runs as. Undefined for a
 * session with no record. The task service spawns through it; the bus adapter (`adapter/rpc.ts`) and
 * skill-fork resolve the same scope from the lineage.
 */
export interface SubagentScope {
	service: SubagentService;
	/** The agent a child session runs as; absent in a top-level session. */
	owner?: SubagentView;
	nested?: NestedRuntime;
}

export function subagentScope(session: AgentSession): SubagentScope | undefined {
	const context = sessionRecords.get(session);
	const lineage = context?.lineage;
	if (lineage) {
		return {
			service: lineage.owner,
			owner: lineage.parentRecord,
			nested: lineage.owner.nested(lineage.parentRecord),
		};
	}
	const service = subagentServiceFor(session);
	return service ? { service } : undefined;
}

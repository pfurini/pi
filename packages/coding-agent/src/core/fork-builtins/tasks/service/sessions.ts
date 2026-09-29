/**
 * Fork-owned: which session owns which task service (D47). `addForkBaseTools` registers the session
 * without reading it; the service is built on first use, by a task tool call or the presentation's
 * `session_start`. A session never registered (fork built-ins off) has no service.
 */
import type { AgentSession } from "../../../agent-session.ts";
import { TaskService } from "./service.ts";

const registered = new WeakSet<AgentSession>();
const services = new WeakMap<AgentSession, TaskService>();

export function registerTaskSession(session: AgentSession): void {
	registered.add(session);
}

/** The session's task service, built on first use; undefined for a session never registered. */
export function taskServiceFor(session: AgentSession): TaskService | undefined {
	let service = services.get(session);
	if (service) return service;
	if (!registered.has(session)) return undefined;
	service = new TaskService(session);
	services.set(session, service);
	return service;
}

export function requireTaskService(session: AgentSession): TaskService {
	const service = taskServiceFor(session);
	if (!service) throw new Error("This session has no task service.");
	return service;
}

/** The session's task service when one was built; never builds one. */
export function existingTaskService(session: AgentSession): TaskService | undefined {
	return services.get(session);
}

/**
 * Fork-owned: the `subagents:*` bus adapter of one session (plan T8; D19). `addForkBaseTools` calls
 * `installSubagentAdapter` whenever it registers the session's base tools, so at construction and on
 * each `/reload`. The first call answers the RPC and skill-agent channels on the session's bus, and
 * the session's `dispose()` removes them through the cleanup hook. Every call announces
 * `subagents:ready` and republishes changed skill-agent maps, a microtask later: registration reads
 * nothing from the session, and third parties ping on `subagents:ready` (pi-tasks does).
 */
import { registerSessionResourceCleanup } from "@earendil-works/pi-ai";
import type { AgentSession } from "../../../agent-session.ts";
import type { EventBus } from "../../../event-bus.ts";
import { PRESENTATION_BIND_CHANNEL, type PresentationBindRequest } from "../binding.ts";
import { serveRpc } from "./rpc.ts";
import { publishSessionRewriteMaps, serveSkillAgents } from "./skill-agents.ts";

const installed = new WeakSet<AgentSession>();

/** Answers the presentation factory of the session that owns the asking context's session manager. */
function servePresentation(session: AgentSession, bus: EventBus): () => void {
	return bus.on(PRESENTATION_BIND_CHANNEL, (raw) => {
		const request = raw as PresentationBindRequest;
		if (request.sessionManager === session.sessionManager) request.session = session;
	});
}

export function installSubagentAdapter(session: AgentSession, bus: EventBus): void {
	if (!installed.has(session)) {
		const offs = [serveRpc(session, bus), serveSkillAgents(session, bus), servePresentation(session, bus)];
		const unregister = registerSessionResourceCleanup((sessionId) => {
			if (sessionId !== session.sessionId) return;
			for (const off of offs) off();
			unregister();
			installed.delete(session);
		});
		installed.add(session);
	}
	queueMicrotask(() => {
		if (!installed.has(session)) return;
		bus.emit("subagents:ready", { sessionId: session.sessionId });
		publishSessionRewriteMaps(session, bus);
	});
}

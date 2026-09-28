/**
 * Fork-owned: how the presentation factory (`ui/`) finds its session (plan P3). The factory receives
 * only an extension API, whose `pi.events` forwards to the loader's event bus. Base tools install the
 * bus adapter on that same bus, so the factory asks over it:
 *
 * - At load, it emits a `ChildSessionQuery`. The runner answers on every child loader's bus, so a
 *   child session's factory registers nothing.
 * - At `session_start` or `session_shutdown`, it emits a `PresentationBindRequest` with its context's
 *   session manager. The adapter of the session that owns that manager answers with the session.
 *
 * Both channels are private to this module; emit is synchronous, so the answer is set on return.
 */
import type { AgentSession } from "../../agent-session.ts";

export const CHILD_SESSION_QUERY_CHANNEL = "fork-subagents:child-session-query";
export const PRESENTATION_BIND_CHANNEL = "fork-subagents:presentation-bind";

export interface ChildSessionQuery {
	child: boolean;
}

export interface PresentationBindRequest {
	/** The asking context's session manager, which tells apart sessions that share one bus. */
	readonly sessionManager: unknown;
	session?: AgentSession;
}

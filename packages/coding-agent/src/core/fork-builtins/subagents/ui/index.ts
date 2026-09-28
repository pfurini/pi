/**
 * Fork-owned: the subagents presentation factory (D18, R2; plan T6). `FORK_OWNED_BUILTINS` lists it,
 * so every `DefaultResourceLoader` loads it. In a child session it registers nothing: the parent owns
 * the child's presentation (P4). In a top-level session it finds its session over the bus
 * (`../binding.ts`) at `session_start`; a `session_shutdown` in a session that never started binds on
 * demand (P5).
 *
 * In `tui` and `rpc` mode it builds the session's service at `session_start` and keeps the status
 * line `subagents` current (P7, P8). Every `session_shutdown` unbinds the UI. A reason other than
 * `reload` then awaits the service's bounded `shutdown()`, so quit and session replacement wait for
 * the children's teardown (R4, P6); it never builds a service to do so. `/reload` keeps the service
 * and its agents. The `subagent-notification` renderer (`notification.ts`) draws completion notices.
 */
import type { AgentSession } from "../../../agent-session.ts";
import type { ExtensionAPI, ExtensionContext } from "../../../extensions/types.ts";
import {
	CHILD_SESSION_QUERY_CHANNEL,
	type ChildSessionQuery,
	PRESENTATION_BIND_CHANNEL,
	type PresentationBindRequest,
} from "../binding.ts";
import { NOTIFICATION_CUSTOM_TYPE } from "../service/notifications.ts";
import type { SubagentService } from "../service/service.ts";
import { existingSubagentService, subagentServiceFor } from "../service/sessions.ts";
import { notificationRenderer } from "./notification.ts";

const STATUS_KEY = "subagents";

/** `1 running agent`, `2 running, 1 queued agents`; undefined when no agent of the session runs or waits (P8). */
export function statusText(service: SubagentService): string | undefined {
	let running = 0;
	let queued = 0;
	for (const view of service.list()) {
		if (view.status === "running") running++;
		else if (view.status === "queued") queued++;
	}
	const total = running + queued;
	if (total === 0) return undefined;
	return `${running} running${queued > 0 ? `, ${queued} queued` : ""} ${total === 1 ? "agent" : "agents"}`;
}

/**
 * Keeps the status line current from the service's events, setting it only when its text changes.
 * A spawn emits several events at once, so one update runs after them. Returns the unbinder, which
 * clears the status.
 */
function bindStatus(service: SubagentService, ctx: ExtensionContext): () => void {
	let shown: string | undefined;
	let pending = false;
	let bound = true;
	const update = () => {
		pending = false;
		// A directly disposed session emits no `session_shutdown`, and its context is already invalidated.
		if (!bound || service.isDisposed) return;
		const text = statusText(service);
		if (text === shown) return;
		shown = text;
		ctx.ui.setStatus(STATUS_KEY, text);
	};
	const schedule = () => {
		if (pending) return;
		pending = true;
		queueMicrotask(update);
	};
	update();
	const off = service.subscribe(schedule);
	return () => {
		bound = false;
		off();
		if (shown !== undefined) ctx.ui.setStatus(STATUS_KEY, undefined);
	};
}

export default function subagentsPresentation(pi: ExtensionAPI): void {
	// A child's presentation is its parent's: the child registers no command, renderer or handler.
	const query: ChildSessionQuery = { child: false };
	pi.events.emit(CHILD_SESSION_QUERY_CHANNEL, query);
	if (query.child) return;

	let session: AgentSession | undefined;
	let unbind: (() => void) | undefined;

	const resolve = (ctx: ExtensionContext): AgentSession | undefined => {
		if (session) return session;
		const request: PresentationBindRequest = { sessionManager: ctx.sessionManager };
		pi.events.emit(PRESENTATION_BIND_CHANNEL, request);
		session = request.session;
		return session;
	};

	// A render never builds a service: without one, the notification shows no cost.
	pi.registerMessageRenderer(
		NOTIFICATION_CUSTOM_TYPE,
		notificationRenderer(() => (session ? existingSubagentService(session) : undefined)?.settings.showCost === true),
	);

	pi.on("session_start", (_event, ctx) => {
		const bound = resolve(ctx);
		// Print and JSON modes show nothing; their quit still awaits the children (session_shutdown).
		if (!bound || (ctx.mode !== "tui" && ctx.mode !== "rpc")) return;
		const service = subagentServiceFor(bound);
		if (!service) return;
		unbind?.();
		unbind = bindStatus(service, ctx);
	});

	pi.on("session_shutdown", async (event, ctx) => {
		unbind?.();
		unbind = undefined;
		// `/reload` keeps the session, its service and its agents (phase 1 plan M3).
		if (event.reason === "reload") return;
		const bound = resolve(ctx);
		await (bound ? existingSubagentService(bound) : undefined)?.shutdown();
	});
}

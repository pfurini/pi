/**
 * Fork-owned: the tasks presentation factory (D47). `FORK_OWNED_BUILTINS` lists it as
 * `<inline:tasks>`, so every `DefaultResourceLoader` loads it. It finds its session over the bus
 * (`../../subagents/binding.ts`), as the subagents presentation does, and calls the session's
 * `TaskService`; the service imports nothing from here.
 *
 * - Every session, a child included, gets the `context` hook: the next model request carries the
 *   service's reminder when one is due. The service gives one only while `TaskCreate` is active.
 * - A top-level session in `tui` mode shows the `tasks` widget; in `rpc` mode the widget goes out as
 *   plain lines. Both show the service's warnings and offer `/tasks`.
 * - `session_start` tells the service the reason, so a fork takes its parent's list.
 */
import type { AgentSession } from "../../../agent-session.ts";
import type { ExtensionAPI, ExtensionContext } from "../../../extensions/types.ts";
import {
	CHILD_SESSION_QUERY_CHANNEL,
	type ChildSessionQuery,
	PRESENTATION_BIND_CHANNEL,
	type PresentationBindRequest,
} from "../../subagents/binding.ts";
import { existingTaskService, taskServiceFor } from "../service/sessions.ts";
import { showTasksMenu } from "./menu.ts";
import { TaskWidget } from "./widget.ts";

export default function tasksPresentation(pi: ExtensionAPI): void {
	const query: ChildSessionQuery = { child: false };
	pi.events.emit(CHILD_SESSION_QUERY_CHANNEL, query);
	const child = query.child;

	let session: AgentSession | undefined;
	let unbind: (() => void) | undefined;

	const resolve = (ctx: ExtensionContext): AgentSession | undefined => {
		if (session) return session;
		const request: PresentationBindRequest = { sessionManager: ctx.sessionManager };
		pi.events.emit(PRESENTATION_BIND_CHANNEL, request);
		session = request.session;
		return session;
	};

	pi.on("context", (event, ctx) => {
		const bound = resolve(ctx);
		const reminder = bound ? existingTaskService(bound)?.takeReminder() : undefined;
		if (!reminder) return;
		return {
			messages: [
				...event.messages,
				{ role: "user" as const, content: [{ type: "text" as const, text: reminder }], timestamp: Date.now() },
			],
		};
	});

	pi.on("session_start", (event, ctx) => {
		// A child's list starts with its first task tool call; the parent owns the child's presentation.
		if (child) return;
		const bound = resolve(ctx);
		const service = bound ? taskServiceFor(bound) : undefined;
		if (!service) return;
		service.onSessionStart(event.reason, "previousSessionFile" in event ? event.previousSessionFile : undefined);
		if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
		unbind?.();
		// Subscribed first: the service hands the warnings it held to its first listener.
		const offWarnings = service.subscribe((change) => {
			if (change.type !== "warning") return;
			try {
				ctx.ui.notify(change.message, "warning");
			} catch {
				// A UI that cannot notify cannot show the widget's failure either.
			}
		});
		const widget = new TaskWidget(service, ctx.ui, ctx.mode === "rpc", (error) =>
			service.warn(`The tasks widget failed: ${error instanceof Error ? error.message : String(error)}`),
		);
		unbind = () => {
			offWarnings();
			widget.dispose();
		};
	});

	pi.on("session_shutdown", () => {
		unbind?.();
		unbind = undefined;
	});

	if (child) return;
	pi.registerCommand("tasks", {
		description: "Manage tasks: view, create, clear completed, settings",
		handler: async (_args, ctx) => {
			const bound = resolve(ctx);
			const service = bound ? taskServiceFor(bound) : undefined;
			if (!bound || !service) return;
			await showTasksMenu({
				ui: ctx.ui,
				service,
				settingsManager: bound.settingsManager,
				cwd: bound.sessionManager.getCwd(),
				tui: ctx.mode === "tui",
			});
		},
	});
}

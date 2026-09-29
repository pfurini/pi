/**
 * Fork-owned: agent mentions at the prompt (pi-subagents `src/index.ts:1043-1270` and
 * `src/ui/agent-mention.ts` at 79a7c42). `@handle message` addresses an agent instead of the main
 * model. The handle names the agent across its life: a running or queued agent is steered, a
 * finished one resumed, an evicted one reopened from its session file, and an agent type with no
 * instance started. Starting follows `agentMentions`: `model` lets a clone of the conversation write
 * the agent's prompt (`../tools/mention-clone.ts`), `direct` starts the agent with the typed message,
 * and `off` leaves every prompt to the main model.
 *
 * Mentions act only in the interactive TUI (D44). In print, JSON and RPC mode the hook passes every
 * prompt on unchanged. The hook never waits for an agent: it claims the prompt at once and reports
 * each outcome through a notification.
 *
 * `@` is also Pi's file picker. The autocomplete provider adds rows for agents above Pi's file rows
 * and hands everything else to the provider it wraps.
 */
import { existsSync } from "node:fs";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../../agent-session.ts";
import type { ExtensionContext, InputEvent, InputEventResult } from "../../../extensions/types.ts";
import { listedAgents } from "../definitions/registry.ts";
import {
	describeMention,
	MENTION_TRIGGER,
	parseMention,
	resolveHandleToType,
	stripAgentPrefix,
} from "../service/mentions.ts";
import { handleBase, isReservedHandle, isTerminal, type SubagentView } from "../service/records.ts";
import type { Tombstone } from "../service/retention.ts";
import type { MentionTarget, SubagentService } from "../service/service.ts";
import { errorText } from "../tools/common.ts";
import { runMentionClone } from "../tools/mention-clone.ts";

/** One row of the `@` popup, and what sending to it does. */
export type MentionRow =
	| { kind: "record"; handle: string; view: SubagentView; typeLabel: string }
	| { kind: "tombstone"; handle: string; entry: Tombstone; typeLabel: string }
	| { kind: "type"; handle: string; type: string; description: string };

/**
 * Everything `@` can reach, in popup order: running and queued agents first, then the other live
 * ones, earliest first; then evicted agents; then listed agent types with no agent under their
 * handle. A named agent lists once, under its alias. Skill-bundled and disabled agents never list
 * (ADR-0008), yet a skill agent's handle stays reserved, so no type row promises another agent under
 * it. Reads the service's cached registry, so a keystroke reads no file.
 */
export function mentionRoster(service: SubagentService): MentionRow[] {
	const registry = service.registry;
	const label = (type: string) => registry.agents.get(type)?.displayName ?? type;
	const live = (view: SubagentView) => !isTerminal(view);
	const views = service
		.list()
		.filter((view) => view.handle !== undefined)
		.sort((a, b) => Number(live(b)) - Number(live(a)) || a.startedAt - b.startedAt);
	const taken = new Set<string>();
	const rows: MentionRow[] = [];
	for (const view of views) {
		const handle = view.alias ?? (view.handle as string);
		taken.add(handle);
		taken.add(view.handle as string);
		// Skill-bundled agents stay out of the popup even once they run (ADR-0008); their exact handle still works.
		if (view.definition.hidden) continue;
		rows.push({ kind: "record", handle, view, typeLabel: view.definition.displayName ?? view.type });
	}
	for (const entry of service.listTombstones()) {
		const handle = entry.alias ?? entry.handle;
		if (taken.has(handle)) continue;
		taken.add(handle);
		taken.add(entry.handle);
		if (registry.agents.get(entry.type)?.hidden) continue;
		rows.push({ kind: "tombstone", handle, entry, typeLabel: label(entry.type) });
	}
	for (const [name, definition] of listedAgents(registry)) {
		const handle = handleBase(name);
		if (taken.has(handle)) continue;
		taken.add(handle);
		rows.push({ kind: "type", handle, type: name, description: definition.description });
	}
	return rows;
}

/** The first sentence of an agent description, at most 60 characters. */
function summarize(description: string): string {
	const first = (description.match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? description).replace(/\s+/g, " ").trim();
	return first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first;
}

/** Names the action a row's send takes, so the popup never promises another. */
function describeRow(row: MentionRow): string {
	if (row.kind === "type") return `start agent · ${summarize(row.description)}`;
	if (row.kind === "tombstone") return `resume · ${row.typeLabel} · ${row.entry.description}`;
	const { status, description, alias } = row.view;
	const action = isTerminal(row.view) ? "resume" : "send message";
	return `${action} · ${alias ? `${row.typeLabel} · ` : ""}${status} · ${description}`;
}

/** Rows for the `@` token before the cursor, by case-insensitive prefix; null when none matches. */
function mentionItems(rows: readonly MentionRow[], line: string, cursorCol: number): AutocompleteSuggestions | null {
	const match = MENTION_TRIGGER.exec(line.slice(0, cursorCol));
	if (!match) return null;
	const typed = match[2].toLowerCase();
	const items: AutocompleteItem[] = rows
		.filter((row) => row.handle.startsWith(typed))
		.map((row) => ({ value: `@${row.handle}`, label: `@${row.handle}`, description: describeRow(row) }));
	return items.length > 0 ? { items, prefix: `@${match[2]}` } : null;
}

/**
 * Wraps `current` with agent rows. Both halves measure the same `@` span wherever both answer, so
 * one prefix serves the merged list. A failing wrapped provider costs its rows, never the agents'.
 */
export function createMentionProvider(
	current: AutocompleteProvider,
	roster: () => readonly MentionRow[],
	enabled: () => boolean,
	warn: (message: string) => void,
): AutocompleteProvider {
	return {
		// Pi unions every wrapper's characters onto the outermost provider.
		triggerCharacters: ["@"],
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const mine = enabled() ? mentionItems(roster(), lines[cursorLine] ?? "", cursorCol) : null;
			let theirs: AutocompleteSuggestions | null = null;
			try {
				theirs = await current.getSuggestions(lines, cursorLine, cursorCol, options);
			} catch (error) {
				warn(`The autocomplete provider below agent mentions failed: ${errorText(error)}`);
			}
			if (!mine) return theirs;
			if (!theirs) return mine;
			return { items: [...mine.items, ...theirs.items], prefix: mine.prefix };
		},
		applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
			current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
		shouldTriggerFileCompletion: (lines, cursorLine, cursorCol) =>
			current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true,
	};
}

/** What the input hook works with; `signal` aborts at the session's end. */
export interface MentionEnv {
	session: AgentSession;
	service: SubagentService;
	signal: AbortSignal;
}

const CONTINUE: InputEventResult = { action: "continue" };

/**
 * The `input` handler. Returns `continue` for anything that is no agent mention, `transform` for
 * `@main`, and `handled` once it started the mention's action.
 */
export function handleMentionInput(
	event: InputEvent,
	ctx: ExtensionContext,
	env: MentionEnv | undefined,
): InputEventResult {
	// The factory builds `env` in TUI mode only (D44), so print, JSON and RPC prompts pass on here.
	if (!env || event.source === "extension") return CONTINUE;
	const mention = parseMention(event.text);
	if (!mention) return CONTINUE;
	const { service } = env;
	// Reread only for a mention, so an ordinary prompt costs no settings read.
	const mode = service.reloadSettings().agentMentions;
	if (mode === "off") return CONTINUE;
	if (isReservedHandle(mention.handle)) {
		return { action: "transform", text: mention.message, ...(event.images && { images: event.images }) };
	}
	// The handle as typed first, so an agent really named `agent-foo` wins over `@agent-` + `foo`.
	const unwrapped = stripAgentPrefix(mention.handle);
	const target = service.resolveMention(mention.handle) ?? (unwrapped && service.resolveMention(unwrapped));
	const notify = (message: string, type: "info" | "warning" | "error") => {
		// The session may end before an outcome arrives; its context is then gone.
		if (!env.signal.aborted) ctx.ui.notify(message, type);
	};
	if (target && dispatchExisting(target, mention.message, env, notify)) return { action: "handled" };
	const types = listedAgents(service.registry).map(([name]) => name);
	// A record that never reached a session starts afresh as its own type, whatever name reached it.
	const type =
		(target && target.kind === "live" ? target.view.type : undefined) ??
		resolveHandleToType(mention.handle, types) ??
		(unwrapped ? resolveHandleToType(unwrapped, types) : undefined);
	if (!type) return CONTINUE;
	void start(type, mention.message, mode, env, notify);
	return { action: "handled" };
}

type Notify = (message: string, type: "info" | "warning" | "error") => void;

/**
 * Steers, resumes or reopens the agent a handle names. False for a live agent that never reached a
 * session, which a mention starts afresh, as pi-subagents did.
 */
function dispatchExisting(target: MentionTarget, message: string, env: MentionEnv, notify: Notify): boolean {
	const { service } = env;
	if (target.kind === "tombstone") {
		const { entry } = target;
		const name = `@${entry.alias ?? entry.handle}`;
		if (!existsSync(entry.sessionFile)) {
			service.dropTombstone(entry.handle);
			notify(`Could not resume ${name}: its session is gone.`, "warning");
			return true;
		}
		// One rejection path for the reopen and its worktree start, so either failure is reported once.
		void service
			.reopen(entry, message)
			.then((view) => service.worktreeStarted(view))
			.then(
				() => notify(`Resuming ${name}`, "info"),
				(error: unknown) => notify(`Could not resume ${name}: ${errorText(error)}`, "warning"),
			);
		return true;
	}
	const { view } = target;
	const name = `@${view.alias ?? view.handle ?? view.id}`;
	if (!isTerminal(view)) {
		void service.steer(view.id, message).then((outcome) => {
			if (outcome.kind === "delivered" || outcome.kind === "queued") notify(`Sent to ${name}`, "info");
			else
				notify(
					`Could not send to ${name}: ${outcome.kind === "failed" ? outcome.error : outcome.reason}`,
					"warning",
				);
		});
		return true;
	}
	// A finished agent resumes in its child session; one that never reached a session starts afresh.
	if (!service.conversation(view.id)) return false;
	try {
		service.resume(view.id, message, { background: true });
		notify(`Resuming ${name}`, "info");
	} catch (error) {
		notify(`Could not resume ${name}: ${errorText(error)}`, "warning");
	}
	return true;
}

/** Starts an agent of `type`: through the clone in `model` mode, falling back to a direct start. */
async function start(type: string, message: string, mode: "model" | "direct", env: MentionEnv, notify: Notify) {
	const { service } = env;
	const name = `@${handleBase(type)}`;
	let fallback: string | undefined;
	try {
		let view: SubagentView | undefined;
		if (mode === "model") {
			notify(`Prompting ${name}…`, "info");
			const cloned = await runMentionClone(env.session, service, type, message, env.signal);
			if (env.signal.aborted) return;
			if (cloned.ok) view = cloned.view;
			else fallback = cloned.error;
		}
		view ??= await service.spawnListed({
			type,
			prompt: message,
			description: describeMention(message),
			mode: "detached-background",
		});
		await service.worktreeStarted(view);
		if (mode === "direct") notify(`Started ${name}`, "info");
		else if (fallback !== undefined) notify(`Started ${name} directly: ${fallback}`, "warning");
	} catch (error) {
		notify(`Could not start ${name}: ${errorText(error)}`, "error");
	}
}

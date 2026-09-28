/**
 * Fork-owned: completion notifications of background subagents (pi-subagents `src/index.ts` and
 * `src/status-note.ts` at 79a7c42).
 *
 * A completion that lands while the parent runs is parked and delivered once the parent settles,
 * so the model does not get a stale notice for a result it already fetched. While the parent is
 * idle, a completion is delivered after a short hold that each new arrival re-arms. After a run the
 * user interrupted, a notice rides on the next prompt instead of starting a turn. An aborted run
 * counts, and so does a retry that an abort cancelled; an abort during post-run compaction goes
 * undetected. Delivery goes through `session.sendCustomMessage` with `discardIf`, so a result read
 * before the notice is injected drops it. Grouped agents share one notice; `joins.ts` forms the groups.
 */
import type { AgentSession } from "../../../agent-session.ts";
import { displayTokens } from "../usage.ts";
import { isTerminal, type SubagentRecord } from "./records.ts";

export const NOTIFICATION_CUSTOM_TYPE = "subagent-notification";

/** The hold before an idle parent is notified; each arrival re-arms it. */
const IDLE_HOLD_MS = 200;

/** `auto_retry_end.finalError` when an abort cancels a retry (`AgentSession._finishCancelledRetry`). */
const RETRY_CANCELLED = "Retry cancelled";

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function statusLabel(record: SubagentRecord): string {
	switch (record.status) {
		case "error":
			return `Error: ${record.error ?? "unknown"}`;
		case "aborted":
			return record.error ? `Aborted: ${record.error}` : "Aborted";
		case "steered":
			return "Wrapped up (turn limit)";
		case "stopped":
			return "Stopped";
		default:
			return "Done";
	}
}

/** The note that keeps a parent from mistaking partial output for a finished task. */
export function statusNote(status: SubagentRecord["status"]): string {
	switch (status) {
		case "stopped":
			return " (STOPPED BY THE USER before completion — output is partial; the task was NOT finished)";
		case "aborted":
			return " (aborted before completion; output may be incomplete)";
		case "steered":
			return " (wrapped up at the turn limit — output may be partial)";
		default:
			return "";
	}
}

/** Claude Code's `<task-notification>` for one agent, with the result previewed to `maxLength` characters. */
export function formatTaskNotification(record: SubagentRecord, maxLength: number, showCost: boolean): string {
	const duration = (record.completedAt ?? Date.now()) - record.startedAt;
	const cost = showCost ? record.usage.cost.total : 0;
	const result = record.result
		? record.result.length > maxLength
			? `${record.result.slice(0, maxLength)}\n...(truncated, use get_subagent_result for full output)`
			: record.result
		: "No output.";
	return [
		"<task-notification>",
		`<task-id>${record.id}</task-id>`,
		record.toolCallId ? `<tool-use-id>${escapeXml(record.toolCallId)}</tool-use-id>` : undefined,
		record.transcriptPath ? `<output-file>${escapeXml(record.transcriptPath)}</output-file>` : undefined,
		`<status>${escapeXml(statusLabel(record))}</status>`,
		`<summary>Agent "${escapeXml(record.description)}" ${record.status}${statusNote(record.status)}</summary>`,
		`<result>${escapeXml(result)}</result>`,
		`<usage><total_tokens>${displayTokens(record.usage)}</total_tokens><tool_uses>${record.toolUses}</tool_uses>${
			record.compactionCount ? `<compactions>${record.compactionCount}</compactions>` : ""
		}${cost > 0 ? `<estimated_cost_usd>${cost.toFixed(4)}</estimated_cost_usd>` : ""}<duration_ms>${duration}</duration_ms></usage>`,
		"</task-notification>",
	]
		.filter((line) => line !== undefined)
		.join("\n");
}

/** What phase 2's renderer draws; each entry previews one agent. */
export interface NotificationDetails {
	id: string;
	description: string;
	status: string;
	toolUses: number;
	totalTokens: number;
	totalCost: number;
	durationMs: number;
	outputFile?: string;
	error?: string;
	resultPreview: string;
	others?: NotificationDetails[];
}

function details(record: SubagentRecord, maxLength: number): NotificationDetails {
	return {
		id: record.id,
		description: record.description,
		status: record.status,
		toolUses: record.toolUses,
		totalTokens: displayTokens(record.usage),
		totalCost: record.usage.cost.total,
		durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
		outputFile: record.transcriptPath,
		error: record.error,
		resultPreview: record.result
			? record.result.length > maxLength
				? `${record.result.slice(0, maxLength)}…`
				: record.result
			: "No output.",
	};
}

export interface NotificationMessage {
	customType: string;
	content: string;
	display: boolean;
	details: NotificationDetails;
}

/** One agent keeps the individual shape; several share the group shape. */
export function notificationMessage(
	records: SubagentRecord[],
	othersRunning: boolean,
	showCost: boolean,
): NotificationMessage {
	if (records.length === 1) {
		const [record] = records;
		const footer = record.transcriptPath ? `\nFull transcript available at: ${record.transcriptPath}` : "";
		return {
			customType: NOTIFICATION_CUSTOM_TYPE,
			content: formatTaskNotification(record, 500, showCost) + footer,
			display: true,
			details: details(record, 500),
		};
	}
	const label = othersRunning
		? `${records.length} agent(s) finished (partial — others still running)`
		: `${records.length} agent(s) finished`;
	const [first, ...rest] = records;
	return {
		customType: NOTIFICATION_CUSTOM_TYPE,
		content: `Background agent group completed: ${label}\n\n${records
			.map((record) => formatTaskNotification(record, 300, showCost))
			.join("\n\n")}\n\nUse get_subagent_result for full output.`,
		display: true,
		details: { ...details(first, 300), others: rest.map((record) => details(record, 300)) },
	};
}

interface Parked {
	record: SubagentRecord;
	/** A resume clears `completedAt`, which retires a notice parked for the earlier run. */
	completedAt?: number;
}

function isLive({ record, completedAt }: Parked): boolean {
	return !record.resultConsumed && record.completedAt === completedAt && isTerminal(record);
}

export interface NotificationQueueOptions {
	/** Whether other background agents still run, apart from the ones being delivered. */
	othersRunning(delivered: ReadonlySet<string>): boolean;
	showCost(): boolean;
	onError(error: unknown): void;
}

/** Parks completions and delivers them at the parent's turn boundary. */
export class NotificationQueue {
	private readonly session: AgentSession;
	private readonly options: NotificationQueueOptions;
	private readonly pending = new Map<string, Parked[]>();
	private readonly unsubscribe: () => void;
	private runActive = false;
	private interrupted = false;
	private idleTimer?: ReturnType<typeof setTimeout>;

	constructor(session: AgentSession, options: NotificationQueueOptions) {
		this.session = session;
		this.options = options;
		this.unsubscribe = session.subscribe((event) => {
			if (event.type === "agent_start") {
				this.runActive = true;
				this.interrupted = false;
				clearTimeout(this.idleTimer);
			} else if (event.type === "agent_end") {
				const last = event.messages.at(-1);
				// An aborted run can end on a tool result (a batch that terminates), so the run's own signal counts too.
				const aborted = session.agent.signal?.aborted === true;
				if (aborted || (last?.role === "assistant" && last.stopReason === "aborted")) this.interrupted = true;
			} else if (event.type === "auto_retry_end" && event.finalError === RETRY_CANCELLED) {
				// An abort during the retry backoff ends the run with no agent_end of its own.
				this.interrupted = true;
			} else if (event.type === "agent_settled") {
				this.runActive = false;
				if (this.pending.size > 0) this.flush();
			}
		});
	}

	park(key: string, records: SubagentRecord[]): void {
		this.pending.set(
			key,
			records.map((record) => ({ record, completedAt: record.completedAt })),
		);
		if (this.runActive || this.session.isStreaming) return;
		clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => {
			if (!this.runActive && !this.session.isStreaming) this.flush();
		}, IDLE_HOLD_MS);
		this.idleTimer.unref?.();
	}

	private flush(): void {
		const deliverAs = this.interrupted ? "nextTurn" : "followUp";
		const parked = [...this.pending.values()].flat();
		this.pending.clear();
		const seen = new Set<string>();
		const live = parked.filter((entry) => {
			if (!isLive(entry) || seen.has(entry.record.id)) return false;
			seen.add(entry.record.id);
			return true;
		});
		if (live.length === 0) return;
		const message = notificationMessage(
			live.map((entry) => entry.record),
			this.options.othersRunning(seen),
			this.options.showCost(),
		);
		// Not awaited: an idle delivery runs the whole triggered turn before it resolves.
		this.session
			.sendCustomMessage(message, { deliverAs, triggerTurn: true, discardIf: () => !live.some(isLive) })
			.catch((error: unknown) => this.options.onError(error));
	}

	dispose(): void {
		clearTimeout(this.idleTimer);
		this.pending.clear();
		this.unsubscribe();
	}
}

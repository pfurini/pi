/**
 * A.4 delivery transport (ADR-0004, C1c): given one rendered invocation, build
 * the exact messages that enter the transcript, plus the detached B.12 entry
 * metadata that persistence and consumers (TUI, HTML export) read.
 *
 * Two transports:
 *
 * - **Message block** (default, universal fallback): one user message whose
 *   text is `<skill name="…" args="…">…</skill>` with XML-escaped attribute
 *   values and a verbatim body. No `location` attribute: B.12 metadata carries
 *   identity, and parsing never depends on the text form for new messages.
 * - **Synthetic pair** (only for models whose `(api, provider)` converter path
 *   passed C1a replay verification): an AssistantMessage with exactly one
 *   `skill` ToolCall, followed by its ToolResultMessage. Both persist as
 *   ordinary session messages correlated by a shared `pairId`.
 *
 * `pairId` and all invocation metadata live on the session ENTRY envelope
 * (SessionMessageEntry), never as enumerable properties on a Pi Message:
 * pi-messages serializes the whole context to the wire, so an enumerable field
 * would leak into the native payload and break C1a's unchanged-replay contract.
 */

import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	AssistantMessage,
	ImageContent,
	Model,
	TextContent,
	ToolResultMessage,
	Usage,
	UserMessage,
} from "@earendil-works/pi-ai/compat";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { SessionMessageMetadata, SkillInvocationEntry } from "../session-manager.ts";
import { escapeXml } from "./listing.ts";
import type { RenderedSkillInvocation } from "./render.ts";
import type { SkillInvocationMetadata } from "./runtime.ts";

export const SKILL_TOOL_NAME = "skill";

/**
 * Providers that own their side of the session and cannot accept an injected
 * assistant tool_use block (ADR-0004): they always use the message block.
 */
const SYNTHETIC_PAIR_EXCLUDED_PROVIDERS: ReadonlySet<string> = new Set(["claude-bridge"]);

export type SkillDeliveryTransport = "message-block" | "synthetic-pair";

/**
 * Transport selection (A.4): synthetic pair only when the model carries the
 * C1a replay-verified capability flag, the provider is not excluded, and the
 * `forceSkillMessageBlock` rollback setting is off. Message block otherwise.
 */
export function selectSkillTransport(
	model: { provider: string; syntheticToolResultReplay?: true } | undefined,
	options: { forceMessageBlock: boolean },
): SkillDeliveryTransport {
	if (options.forceMessageBlock) return "message-block";
	if (!model) return "message-block";
	if (SYNTHETIC_PAIR_EXCLUDED_PROVIDERS.has(model.provider)) return "message-block";
	return model.syntheticToolResultReplay === true ? "synthetic-pair" : "message-block";
}

export interface SkillMessageBlock {
	/** Full user-message text (the block is the entire text in C1c). */
	text: string;
	/** B.12 entry metadata with UTF-16 offsets into `text`. */
	invocation: SkillInvocationEntry;
}

function skillWrapperText(name: string, args: string, body: string): string {
	return `<skill name="${escapeXml(name)}" args="${escapeXml(args)}">\n${body}\n</skill>`;
}

/**
 * Wrap a rendered body as `<skill name="…" args="…">…</skill>`: attribute
 * values XML-escaped, body verbatim. The `args` attribute is always present so
 * empty args encode consistently across block, tool arguments, and metadata.
 */
export function buildSkillMessageBlock(metadata: SkillInvocationMetadata, body: string): SkillMessageBlock {
	const text = skillWrapperText(metadata.name, metadata.args, body);
	return {
		text,
		invocation: {
			skillId: metadata.skillId,
			name: metadata.name,
			args: metadata.args,
			blockStart: 0,
			blockEnd: text.length,
		},
	};
}

/**
 * Ephemeral re-wrap for a compaction carry-forward re-attachment (c4b): the
 * same wrapper shape as `buildSkillMessageBlock`, without requiring the full
 * `SkillInvocationMetadata` — a `CarryForwardEntry` carries only `skillId`,
 * `args`, and the already-unwrapped `body`. Never persisted (ephemeral core
 * seam), so it has no B.12 invocation metadata to return.
 */
export function buildCarriedSkillBlock(name: string, args: string, body: string): { text: string } {
	return { text: skillWrapperText(name, args, body) };
}

/**
 * Pre-request fallback primitive: the message-block form for the same
 * rendered invocation. Used when the synthetic transport was never selected
 * (unflagged model, excluded provider, `forceSkillMessageBlock`). Runtime
 * post-rejection repair is descoped from C1.
 */
export function downgradeToMessageBlock(rendered: RenderedSkillInvocation): SkillMessageBlock {
	return buildSkillMessageBlock(rendered.invocation, rendered.body);
}

function flattenMessageContentText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((part) =>
				part && typeof part === "object" && (part as { type?: unknown }).type === "text"
					? String((part as { text?: unknown }).text ?? "")
					: "",
			)
			.join("");
	}
	return "";
}

const MESSAGE_BLOCK_SUFFIX = "\n</skill>";

export type RecoveredBody =
	| { kind: "body"; body: string }
	| { kind: "empty" }
	| { kind: "malformed"; diagnostic: ResourceDiagnostic };

/**
 * A.6 transport-aware bare-body recovery: dedup and carry-forward both need
 * the exact bare rendered body of a prior delivery, but persisted offsets are
 * not uniform across transports (a sole-skill message-block spans the whole
 * `<skill>…</skill>` wrapper; a mid-prompt composed block spans a non-zero
 * per-block offset; a synthetic-pair tool-result spans the bare body).
 * `text.slice(blockStart, blockEnd)` is correct at any offset; only a
 * message-block entry (`role !== "toolResult"`) then needs its wrapper
 * stripped. Only an exact `0/0` marker (a dedup note or a fork marker) is
 * "empty"; any other `blockEnd <= blockStart` (a reversed or zero-length-at-offset
 * range) is a torn entry → "malformed". Never re-renders — shell injection must
 * not run twice.
 */
export function recoverDeliveredBody(
	message: { role?: string; content: unknown },
	invocation: { blockStart: number; blockEnd: number },
): RecoveredBody {
	const { blockStart, blockEnd } = invocation;
	// Only an exact 0/0 is the intentional empty marker (dedup note / fork marker).
	// A reversed or zero-length-at-offset range is a torn entry, caught as malformed
	// by the range check below rather than silently skipped as "empty".
	if (blockStart === 0 && blockEnd === 0) {
		return { kind: "empty" };
	}
	const text = flattenMessageContentText(message.content);
	if (
		!Number.isInteger(blockStart) ||
		!Number.isInteger(blockEnd) ||
		blockStart < 0 ||
		blockEnd <= blockStart ||
		blockEnd > text.length
	) {
		return {
			kind: "malformed",
			diagnostic: {
				type: "warning",
				message: `skill invocation metadata malformed: offsets [${blockStart}, ${blockEnd}) invalid or out of range for a ${text.length}-code-unit message`,
			},
		};
	}
	const slice = text.slice(blockStart, blockEnd);
	if (message.role === "toolResult") {
		return { kind: "body", body: slice };
	}
	const prefixMatch = slice.match(/^<skill name="[^"]*" args="[^"]*">\n/);
	if (!prefixMatch || !slice.endsWith(MESSAGE_BLOCK_SUFFIX)) {
		return {
			kind: "malformed",
			diagnostic: {
				type: "warning",
				message: "skill invocation metadata malformed: message-block wrapper prefix/suffix does not match",
			},
		};
	}
	return { kind: "body", body: slice.slice(prefixMatch[0].length, slice.length - MESSAGE_BLOCK_SUFFIX.length) };
}

/**
 * A.6 dedup-hit delivery (resolved decision): a short plain note replacing
 * the full body. Its 0/0 empty-offset invocation (built by the caller, not
 * here) makes `recoverDeliveredBody` classify it "empty", so it counts once
 * but is never a dedup anchor and never carried forward — the anchor stays on
 * the last full delivery, preserving the note chain on repeated identical
 * invocations.
 */
export function buildAlreadyLoadedNote(metadata: SkillInvocationMetadata): { text: string } {
	const argsSuffix = metadata.args ? ` (args: ${metadata.args})` : "";
	return {
		text: `Skill "${metadata.name}"${argsSuffix} is already loaded; its instructions remain in context above.`,
	};
}

/**
 * `details` payload carried by genuine and synthetic `skill` tool results.
 *
 * `fork`/`emptyBody`/`forkError` are transient discriminators (c4b): they
 * disambiguate an otherwise-identical `{ invocation }` shape between inline
 * and fork tool results at the point `agent-session.ts` persists B.12
 * metadata or marks a result erroneous, but are not themselves the
 * authoritative persisted flag (that is `SkillInvocationEntry.fork`).
 */
export interface SkillToolResultDetails {
	invocation: SkillInvocationMetadata;
	/** Set on a genuine model `context: fork` tool result only; read by `_genuineSkillResultMeta` to mark the persisted entry `fork: true` (A.5 dedup/carry-forward exemption). */
	fork?: true;
	/** Set on a genuine inline `skill`-tool dedup note only; requests `blockStart:0, blockEnd:0` on the persisted entry so the note counts but is never a dedup anchor. */
	emptyBody?: true;
	/** Set when a foreground fork outcome must be reported as a tool error while retaining `fork`/`invocation` (a thrown error would replace `details` with `{}`); consumed by `agent.afterToolCall` to mark the result `isError: true`. */
	forkError?: true;
}

export interface SkillSyntheticPair {
	/** Durable correlation id stored on both session entries (never on the messages). */
	pairId: string;
	assistant: AssistantMessage;
	toolResult: ToolResultMessage<SkillToolResultDetails>;
}

function zeroUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

/**
 * A.4 synthetic pair construction contract: one AssistantMessage whose content
 * is exactly one `skill` ToolCall (id `skill_<uuid>`, zeroed usage,
 * `stopReason: "toolUse"`, current provider/model ids), followed by its
 * ToolResultMessage (`isError: false`, rendered text).
 */
export function buildSkillSyntheticPair(rendered: RenderedSkillInvocation, model: Model<any>): SkillSyntheticPair {
	const metadata = rendered.invocation;
	const pairId = randomUUID();
	const toolCallId = `skill_${randomUUID()}`;
	const assistant: AssistantMessage = {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: toolCallId,
				name: SKILL_TOOL_NAME,
				arguments: { name: metadata.name, args: metadata.args },
			},
		],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: zeroUsage(),
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
	const toolResult: ToolResultMessage<SkillToolResultDetails> = {
		role: "toolResult",
		toolCallId,
		toolName: SKILL_TOOL_NAME,
		content: [{ type: "text", text: rendered.body }],
		details: { invocation: metadata },
		isError: false,
		timestamp: Date.now(),
	};
	return { pairId, assistant, toolResult };
}

/** Notification payload for the A.4 synthetic `tool_result` extension event. */
export interface SyntheticToolResultNotification {
	toolCallId: string;
	input: Record<string, unknown>;
	content: (TextContent | ImageContent)[];
}

export interface SkillDelivery {
	transport: SkillDeliveryTransport;
	/** Messages to emit and insert into context, in order. */
	messages: AgentMessage[];
	/**
	 * The A.4 message-block text form of this delivery, whichever transport was
	 * used: a consistent text representation for observers (before_agent_start).
	 */
	textForm: string;
	/** B.12/pairId entry metadata keyed by delivered message object identity. */
	metadata: Map<AgentMessage, SessionMessageMetadata>;
	/** Present for synthetic-pair delivery only. */
	syntheticResult?: SyntheticToolResultNotification;
}

function invocationEntry(
	metadata: SkillInvocationMetadata,
	blockStart: number,
	blockEnd: number,
): SkillInvocationEntry {
	return {
		skillId: metadata.skillId,
		name: metadata.name,
		args: metadata.args,
		blockStart,
		blockEnd,
	};
}

/**
 * Build the delivery messages for one rendered invocation. Images stay on a
 * user-facing message ahead of the pair (the synthetic pair has no user
 * message), preserving attachment order.
 */
export function buildSkillDelivery(
	rendered: RenderedSkillInvocation,
	transport: SkillDeliveryTransport,
	options: { model?: Model<any>; images?: ImageContent[] } = {},
): SkillDelivery {
	const metadata = rendered.invocation;
	if (transport === "synthetic-pair" && options.model) {
		const pair = buildSkillSyntheticPair(rendered, options.model);
		const messages: AgentMessage[] = [];
		if (options.images && options.images.length > 0) {
			messages.push({ role: "user", content: [...options.images], timestamp: Date.now() });
		}
		messages.push(pair.assistant, pair.toolResult);
		const entryMetadata = new Map<AgentMessage, SessionMessageMetadata>([
			// Identity on the assistant entry lets load-time repair downgrade a
			// crash-torn pair; 0/0 offsets mark "no text block on this message".
			[pair.assistant, { pairId: pair.pairId, invocations: [invocationEntry(metadata, 0, 0)] }],
			[pair.toolResult, { pairId: pair.pairId, invocations: [invocationEntry(metadata, 0, rendered.body.length)] }],
		]);
		return {
			transport,
			messages,
			textForm: downgradeToMessageBlock(rendered).text,
			metadata: entryMetadata,
			syntheticResult: {
				toolCallId: pair.toolResult.toolCallId,
				input: { name: metadata.name, args: metadata.args },
				content: [{ type: "text", text: rendered.body }],
			},
		};
	}

	const block = buildSkillMessageBlock(metadata, rendered.body);
	const content: (TextContent | ImageContent)[] = [{ type: "text", text: block.text }];
	if (options.images) {
		content.push(...options.images);
	}
	const userMessage: UserMessage = { role: "user", content, timestamp: Date.now() };
	return {
		transport: "message-block",
		messages: [userMessage],
		textForm: block.text,
		metadata: new Map([[userMessage, { invocations: [block.invocation] }]]),
	};
}

export type SkillTextSegment =
	| { type: "text"; text: string }
	| { type: "block"; invocation: SkillInvocationEntry; content: string };

/**
 * Slice message text by B.12 invocation offsets (UTF-16 code units, document
 * order) into text/block segments for metadata-first consumers. Returns
 * undefined when the metadata is malformed (non-integer, out of range,
 * overlapping, or unordered offsets); callers must render the plain message
 * plus a non-fatal diagnostic in that case and must NOT fall back to the
 * legacy parser (fallback is for absent metadata only).
 */
export function sliceSkillInvocationSegments(
	text: string,
	invocations: readonly SkillInvocationEntry[],
): SkillTextSegment[] | undefined {
	if (invocations.length === 0) {
		return [{ type: "text", text }];
	}
	const segments: SkillTextSegment[] = [];
	let cursor = 0;
	for (const invocation of invocations) {
		// Persisted metadata is untrusted: a torn/hand-edited entry can hold a null
		// or non-object element. Treat it as malformed (render plain + diagnostic)
		// rather than dereferencing (throw), symmetric with the dedup/carry-forward scans.
		if (!invocation || typeof invocation !== "object") {
			return undefined;
		}
		const { blockStart, blockEnd } = invocation;
		if (
			!Number.isInteger(blockStart) ||
			!Number.isInteger(blockEnd) ||
			blockStart < cursor ||
			blockStart < 0 ||
			blockEnd < blockStart ||
			blockEnd > text.length
		) {
			return undefined;
		}
		if (blockStart > cursor) {
			segments.push({ type: "text", text: text.slice(cursor, blockStart) });
		}
		segments.push({ type: "block", invocation, content: text.slice(blockStart, blockEnd) });
		cursor = blockEnd;
	}
	if (cursor < text.length) {
		segments.push({ type: "text", text: text.slice(cursor) });
	}
	return segments;
}

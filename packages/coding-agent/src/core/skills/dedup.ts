/**
 * A.6 re-invocation dedup (c4b): identity = tuple `(skillId, raw args R,
 * byte-identical rendered body)` against the last full inline delivery of
 * that skill still present in context. Pure and session-agnostic (ADR-0003):
 * takes a structural `BranchEntryLike[]` so it never imports `session-manager`
 * (no cycle) and stays independently testable.
 */

import type { ResourceDiagnostic } from "../diagnostics.ts";
import { recoverDeliveredBody } from "./delivery.ts";

export interface DedupIdentity {
	skillId: string;
	args: string;
	body: string;
}

/** Structural subset of a session branch entry needed to scan for a prior inline delivery. */
export interface BranchEntryLike {
	readonly id?: string;
	readonly type?: string;
	readonly pairId?: string;
	readonly invocations?: readonly {
		readonly skillId?: unknown;
		readonly args?: unknown;
		readonly blockStart?: unknown;
		readonly blockEnd?: unknown;
		readonly fork?: unknown;
	}[];
	/** `SessionMessageEntry` shape: the underlying LLM message (role + content). */
	readonly message?: { readonly role?: unknown; readonly content?: unknown };
	/** `CustomMessageEntry` shape: content lives directly on the entry (no `role`, so never a message-block wrapper). */
	readonly content?: unknown;
}

/** Reused by `carry-forward.ts`: the message-shaped view `recoverDeliveredBody` needs, from either entry shape. */
export function entryMessageLike(entry: BranchEntryLike): { role?: string; content: unknown } {
	if (entry.message) {
		return {
			role: typeof entry.message.role === "string" ? entry.message.role : undefined,
			content: entry.message.content,
		};
	}
	return { role: undefined, content: entry.content };
}

export type LastFullInlineDeliveryResult =
	| { kind: "found"; args: string; body: string }
	| { kind: "absent" }
	| { kind: "malformed" };

/**
 * Scan backward from the branch tail to `boundaryEntryId` (inclusive;
 * `undefined` = whole branch = no compaction) for the most recent
 * non-fork, non-empty-offset invocation of `skillId`, then recover its bare
 * body. Keyed on `skillId` alone (A.6: identity compares against "the last
 * delivery of that skill"), so the anchor is always the most-recent delivery of
 * that skill (in an `A → B → A` sequence, the final `A`), never an earlier one —
 * the caller compares the whole tuple against it.
 *
 * A malformed most-recent candidate is terminal for this skill: it returns
 * `{ kind: "malformed" }` (never falls through to an older valid delivery,
 * which would compare a fresh invocation against a stale anchor).
 */
export function findLastFullInlineDelivery(
	entries: readonly BranchEntryLike[],
	boundaryEntryId: string | undefined,
	skillId: string,
	onDiagnostic?: (diagnostic: ResourceDiagnostic) => void,
): LastFullInlineDeliveryResult {
	const scanStart =
		boundaryEntryId === undefined
			? 0
			: Math.max(
					0,
					entries.findIndex((entry) => entry.id === boundaryEntryId),
				);
	for (let i = entries.length - 1; i >= scanStart; i--) {
		const entry = entries[i]!;
		if (!Array.isArray(entry.invocations)) {
			continue;
		}
		for (let j = entry.invocations.length - 1; j >= 0; j--) {
			const invocation = entry.invocations[j]!;
			// Persisted metadata is untrusted: a torn/hand-edited entry can hold a
			// null or non-object element. Skip it rather than dereferencing (throw).
			if (!invocation || typeof invocation !== "object") {
				continue;
			}
			if (typeof invocation.skillId !== "string" || invocation.skillId !== skillId) {
				continue;
			}
			if (invocation.fork === true) {
				continue;
			}
			const { blockStart, blockEnd } = invocation;
			if (typeof blockStart !== "number" || typeof blockEnd !== "number") {
				onDiagnostic?.({
					type: "warning",
					message: `skill invocation metadata malformed for "${skillId}": non-numeric offsets`,
				});
				return { kind: "malformed" };
			}
			const recovered = recoverDeliveredBody(entryMessageLike(entry), { blockStart, blockEnd });
			if (recovered.kind === "empty") {
				continue;
			}
			if (recovered.kind === "malformed") {
				onDiagnostic?.(recovered.diagnostic);
				return { kind: "malformed" };
			}
			return {
				kind: "found",
				args: typeof invocation.args === "string" ? invocation.args : "",
				body: recovered.body,
			};
		}
	}
	return { kind: "absent" };
}

/** A.6 body comparison: strict byte-identical (UTF-16 code unit) equality. */
export function isDedupHit(freshBody: string, anchorBody: string): boolean {
	return freshBody === anchorBody;
}

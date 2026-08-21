/**
 * The pure A.6 listing-budget oracle lives in `@earendil-works/pi-agent-core`
 * (`harness/listing-budget.ts`) so the harness can apply the same byte-exact
 * algorithm; this module re-exports it unchanged and keeps the session-shaped
 * invocation-count derivation local to coding-agent.
 */

export type {
	BudgetedListing,
	ListingBudgetDiagnostic,
	ListingBudgetEntry,
} from "@earendil-works/pi-agent-core";
export {
	buildBudgetedListingBlock,
	escapeXml,
	est,
	estimateListingEntryCost,
	MAX_LISTING_DESCRIPTION_LENGTH,
	SKILL_LISTING_END_DELIMITER,
	SKILL_LISTING_START_DELIMITER,
	SKILL_LISTING_VERSION,
	skillListingBudgetCodeUnits,
} from "@earendil-works/pi-agent-core";

/** Structural subset of a session branch entry (`SessionEntry`) needed to derive logical invocation counts, kept local to avoid a `session-manager` import cycle. */
export interface BranchEntryLike {
	readonly type?: string;
	readonly pairId?: string;
	readonly invocations?: readonly { readonly skillId?: unknown }[];
}

/**
 * Derive per-skill *logical* invocation counts from a session branch: a
 * synthetic-pair delivery writes the same invocation onto two entries under
 * one `pairId`, so only the first entry of each pair is counted. Never
 * throws — malformed persisted metadata is skipped rather than failing the
 * whole scan.
 */
export function computeSkillInvocationCounts(entries: readonly BranchEntryLike[]): Map<string, number> {
	const counts = new Map<string, number>();
	const seenPairs = new Set<string>();
	for (const entry of entries) {
		if (typeof entry.pairId === "string" && entry.pairId.length > 0) {
			if (seenPairs.has(entry.pairId)) {
				continue;
			}
			seenPairs.add(entry.pairId);
		}
		if (!Array.isArray(entry.invocations)) {
			continue;
		}
		for (const inv of entry.invocations) {
			if (inv && typeof inv.skillId === "string") {
				counts.set(inv.skillId, (counts.get(inv.skillId) ?? 0) + 1);
			}
		}
	}
	return counts;
}

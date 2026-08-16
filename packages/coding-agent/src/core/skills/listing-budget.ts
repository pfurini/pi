import type { ResourceDiagnostic } from "../diagnostics.ts";

export const SKILL_LISTING_VERSION = "2";
export const SKILL_LISTING_START_DELIMITER = `<available_skills version="${SKILL_LISTING_VERSION}">`;
export const SKILL_LISTING_END_DELIMITER = "</available_skills>";

export const MAX_LISTING_DESCRIPTION_LENGTH = 1536;

export function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** A.6 `est(s) = ceil(len / 4)`, measured in UTF-16 code units. */
export function est(s: string): number {
	return Math.ceil(s.length / 4);
}

export interface ListingBudgetEntry {
	listingName: string;
	description: string;
	location: string;
	isExempt: boolean;
	invocationCount: number;
}

export interface BudgetedListing {
	block: string;
	diagnostics: ResourceDiagnostic[];
}

/**
 * A.6 listing-budget algorithm: emit `entries` (already in emission order —
 * exempt-first, `listingName` asc) at full description, then, if the block
 * exceeds `budgetCodeUnits`, monotonically trim/drop descriptions in
 * `(isExempt asc, invocationCount asc, listingName asc)` order until the
 * block fits or every entry has hit the skeleton floor.
 *
 * `budgetCodeUnits === undefined` is the only passthrough (harness / no-model
 * path, full emission). Any number, including `0`, runs the algorithm.
 */
export function buildBudgetedListingBlock(
	entries: readonly ListingBudgetEntry[],
	budgetCodeUnits: number | undefined,
): BudgetedListing {
	const descriptions = entries.map((e) => e.description);
	const dropped = entries.map(() => false);

	const render = (): string => {
		const lines: string[] = [SKILL_LISTING_START_DELIMITER];
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i]!;
			lines.push("  <skill>");
			lines.push(`    <name>${escapeXml(entry.listingName)}</name>`);
			if (!dropped[i]) {
				lines.push(`    <description>${escapeXml(descriptions[i]!)}</description>`);
			}
			lines.push(`    <location>${escapeXml(entry.location)}</location>`);
			lines.push("  </skill>");
		}
		lines.push(SKILL_LISTING_END_DELIMITER);
		return lines.join("\n");
	};

	if (budgetCodeUnits === undefined) {
		return { block: render(), diagnostics: [] };
	}

	const B = Math.max(0, budgetCodeUnits);
	const fullBlock = render();
	if (est(fullBlock) <= B) {
		return { block: fullBlock, diagnostics: [] };
	}

	const truncationOrder = entries
		.map((_, i) => i)
		.sort((a, b) => {
			const entryA = entries[a]!;
			const entryB = entries[b]!;
			if (entryA.isExempt !== entryB.isExempt) return entryA.isExempt ? 1 : -1;
			if (entryA.invocationCount !== entryB.invocationCount) return entryA.invocationCount - entryB.invocationCount;
			return entryA.listingName.localeCompare(entryB.listingName);
		});

	for (const i of truncationOrder) {
		while (est(render()) > B && !dropped[i]) {
			const remove = 4 * (est(render()) - B) + 1;
			const newBody = descriptions[i]!.slice(0, Math.max(0, descriptions[i]!.length - remove));
			if (newBody.length < 64) {
				dropped[i] = true;
				descriptions[i] = "";
			} else {
				descriptions[i] = `${newBody}…`;
			}
		}
		if (est(render()) <= B) break;
	}

	const block = render();
	const diagnostics: ResourceDiagnostic[] = [];
	if (est(block) > B) {
		diagnostics.push({
			type: "warning",
			message: `skill listing skeleton (${entries.length} skills) exceeds the ${B}-code-unit budget; emitting name+location entries at the floor`,
		});
	}
	return { block, diagnostics };
}

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

/**
 * `B = floor(contextWindow * fraction)`. Returns `undefined` only when
 * `contextWindow` is non-positive/unknown (harness / no-model path) — a
 * positive window always yields a numeric budget, which may floor to `0`.
 */
export function skillListingBudgetCodeUnits(contextWindow: number, fraction: number): number | undefined {
	if (!(contextWindow > 0)) {
		return undefined;
	}
	return Math.floor(contextWindow * fraction);
}

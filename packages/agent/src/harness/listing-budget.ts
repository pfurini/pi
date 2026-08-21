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
	/** A.6 `name-only` visibility: the entry always renders without a description and is exempt from budget re-expansion. */
	forceNameOnly?: boolean;
}

/**
 * Structural diagnostic emitted by the budget engine. Assignable to
 * coding-agent's `ResourceDiagnostic` without this package depending on it.
 */
export interface ListingBudgetDiagnostic {
	type: "warning";
	message: string;
	path?: string;
}

export interface BudgetedListing {
	block: string;
	diagnostics: ListingBudgetDiagnostic[];
}

/** Render one `<skill>` entry exactly as the budgeted block emits it (LISTING_EMIT_LOOP). */
function renderListingEntry(entry: ListingBudgetEntry, showDescription: boolean, description: string): string[] {
	const lines = ["  <skill>", `    <name>${escapeXml(entry.listingName)}</name>`];
	if (showDescription) {
		lines.push(`    <description>${escapeXml(description)}</description>`);
	}
	lines.push(`    <location>${escapeXml(entry.location)}</location>`, "  </skill>");
	return lines;
}

/**
 * Estimated listing cost of one entry — `est` of its rendered (capped,
 * escaped) form, the same measure the budget engine applies. A `forceNameOnly`
 * entry is measured at its name+location rendering.
 */
export function estimateListingEntryCost(entry: ListingBudgetEntry): number {
	return est(renderListingEntry(entry, entry.forceNameOnly !== true, entry.description).join("\n"));
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
	const dropped = entries.map((e) => e.forceNameOnly === true);

	const render = (): string => {
		const lines: string[] = [SKILL_LISTING_START_DELIMITER];
		for (let i = 0; i < entries.length; i++) {
			lines.push(...renderListingEntry(entries[i]!, !dropped[i], descriptions[i]!));
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
	const diagnostics: ListingBudgetDiagnostic[] = [];
	if (est(block) > B) {
		diagnostics.push({
			type: "warning",
			message: `skill listing skeleton (${entries.length} skills) exceeds the ${B}-code-unit budget; emitting name+location entries at the floor`,
		});
	}
	return { block, diagnostics };
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

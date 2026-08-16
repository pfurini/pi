/**
 * A.6 compaction carry-forward (c4b): after compaction (auto or manual),
 * re-attach the most-recent inline delivery of each invoked skill, MRU-first,
 * budgeted at `est`-5,000 code units per skill and 25,000 combined. Pure and
 * session-agnostic (ADR-0003): the derivation is recomputed from the
 * persisted branch on every rebuild, never persisted itself.
 */

import type { ResourceDiagnostic } from "../diagnostics.ts";
import { type BranchEntryLike, entryMessageLike } from "./dedup.ts";
import { recoverDeliveredBody } from "./delivery.ts";
import { est } from "./listing-budget.ts";

export interface CarryForwardBudget {
	perSkill: number;
	total: number;
}

export const DEFAULT_CARRY_FORWARD_BUDGET: CarryForwardBudget = { perSkill: 5000, total: 25000 };

export interface CarryForwardEntry {
	skillId: string;
	args: string;
	body: string;
}

export interface DeriveCarriedSkillsResult {
	entries: CarryForwardEntry[];
	keys: Set<string>;
	diagnostics: ResourceDiagnostic[];
}

interface ResolvedCandidate {
	entryIndex: number;
	blockStart: number;
	args: string;
	body: string;
}

/**
 * Group candidates by canonical `skillId` alone (A.6: "the most-recent inline
 * delivery of each invoked skill" — never per-args, so one skill invoked with
 * several arg strings yields at most one carried entry). For each skill, the
 * most-recent non-fork, non-empty-offset inline delivery wins; a malformed
 * most-recent delivery drops that skill (diagnostic; never falls through to
 * an older delivery, which would restore stale instructions). Only skills
 * whose most-recent such delivery is before `boundaryEntryId` (dropped by
 * compaction) are kept, ordered MRU-first by `(entry index, blockStart)`
 * descending — same-entry ties (several skills composed into one message)
 * resolve by span position, never by iteration order.
 */
export function deriveCarriedSkills(
	entries: readonly BranchEntryLike[],
	boundaryEntryId: string | undefined,
	budget: CarryForwardBudget = DEFAULT_CARRY_FORWARD_BUDGET,
): DeriveCarriedSkillsResult {
	if (boundaryEntryId === undefined) {
		return { entries: [], keys: new Set(), diagnostics: [] };
	}
	const boundaryIndex = entries.findIndex((entry) => entry.id === boundaryEntryId);

	const resolved = new Map<string, ResolvedCandidate>();
	const settled = new Set<string>();
	const diagnostics: ResourceDiagnostic[] = [];

	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i]!;
		if (!Array.isArray(entry.invocations)) {
			continue;
		}
		const messageLike = entryMessageLike(entry);
		for (let j = entry.invocations.length - 1; j >= 0; j--) {
			const invocation = entry.invocations[j]!;
			if (typeof invocation.skillId !== "string") {
				continue;
			}
			const skillId = invocation.skillId;
			if (settled.has(skillId)) {
				continue;
			}
			if (invocation.fork === true) {
				continue;
			}
			const { blockStart, blockEnd } = invocation;
			if (typeof blockStart !== "number" || typeof blockEnd !== "number") {
				settled.add(skillId);
				diagnostics.push({
					type: "warning",
					message: `skill invocation metadata malformed for "${skillId}": non-numeric offsets`,
				});
				continue;
			}
			const recovered = recoverDeliveredBody(messageLike, { blockStart, blockEnd });
			if (recovered.kind === "empty") {
				continue;
			}
			settled.add(skillId);
			if (recovered.kind === "malformed") {
				diagnostics.push(recovered.diagnostic);
				continue;
			}
			resolved.set(skillId, {
				entryIndex: i,
				blockStart,
				args: typeof invocation.args === "string" ? invocation.args : "",
				body: recovered.body,
			});
		}
	}

	const dropped = [...resolved.entries()].filter(([, candidate]) => candidate.entryIndex < boundaryIndex);
	dropped.sort(([, a], [, b]) =>
		b.entryIndex !== a.entryIndex ? b.entryIndex - a.entryIndex : b.blockStart - a.blockStart,
	);

	const carried: CarryForwardEntry[] = [];
	const keys = new Set<string>();
	let running = 0;
	for (const [skillId, candidate] of dropped) {
		const cost = est(candidate.body);
		if (cost > budget.perSkill || running + cost > budget.total) {
			continue;
		}
		running += cost;
		keys.add(skillId);
		carried.push({ skillId, args: candidate.args, body: candidate.body });
	}

	return { entries: carried, keys, diagnostics };
}

// Ported from pi-vcc 0.8.0 (npm @sting8k/pi-vcc), src/core/lineage.ts.
// Copyright (c) 2026 sting8k. MIT licence: see LICENSE in this directory.

import type { ReadonlySessionManager } from "../../session-manager.ts";

/**
 * The ids of the entries on the active branch. A session without a leaf, which
 * `resetLeaf()` produces while entries remain, falls back to every entry, so
 * recall still reaches the session's history.
 */
export const getActiveLineageEntryIds = (
	sessionManager: Pick<ReadonlySessionManager, "getBranch" | "getEntries">,
): Set<string> => {
	const branch = sessionManager.getBranch();
	const entries = branch.length > 0 ? branch : sessionManager.getEntries();
	return new Set(entries.map((entry) => entry.id));
};

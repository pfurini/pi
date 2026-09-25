// Ported from pi-vcc 0.8.0 (npm @sting8k/pi-vcc), src/core/load-messages.ts.
// Copyright (c) 2026 sting8k. MIT licence: see LICENSE in this directory.

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "../../session-manager.ts";
import { isCountedMessageEntry } from "./global-indices.ts";
import { type RenderedEntry, renderMessage } from "./render-entries.ts";

export interface LoadedMessages {
	rendered: RenderedEntry[];
	rawMessages: AgentMessage[];
}

/**
 * Render the session's message entries. pi-vcc streamed them from the session
 * file; the fork reads `sessionManager.getEntries()`, which holds the same
 * entries in the same order, compacted and off-branch ones included.
 */
export const loadAllMessages = (
	entries: readonly SessionEntry[],
	full: boolean,
	allowedEntryIds?: Set<string>,
): LoadedMessages => {
	const rendered: RenderedEntry[] = [];
	const rawMessages: AgentMessage[] = [];
	let messageIndex = 0;

	for (const entry of entries) {
		// Counting rule shared with global-indices.ts — both index spaces must
		// agree by construction.
		if (!isCountedMessageEntry(entry)) continue;

		const allowed = !allowedEntryIds || allowedEntryIds.has(entry.id);
		if (allowed) {
			rendered.push(renderMessage(entry.message, messageIndex, full));
			rawMessages.push(entry.message);
		}
		messageIndex++;
	}

	return { rendered, rawMessages };
};

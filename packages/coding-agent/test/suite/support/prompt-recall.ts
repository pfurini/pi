/**
 * Prompt-history recall over a harness's persisted entries.
 *
 * Recall must replay what the user submitted, not the expansion it was delivered
 * as. This drives the real `PromptHistoryController` in session scope over the
 * session manager's entries, which is exactly what a resumed session rebuilds
 * from — the path where the live in-memory cache is gone.
 */

import type { EditorComponent } from "@earendil-works/pi-tui";
import { PromptHistoryController } from "../../../src/modes/interactive/prompt-history-controller.ts";
import type { Harness } from "../harness.ts";

export async function recalledHistory(harness: Harness): Promise<string[]> {
	let applied: string[] = [];
	const controller = new PromptHistoryController({
		settings: {
			getPromptHistoryScope: () => "session",
			getPromptHistoryMaxEntries: () => 0,
		},
	});
	controller.setEditor({
		getText: () => "",
		setText: () => {},
		handleInput: () => {},
		render: () => [],
		invalidate: () => {},
		setHistory: (entries: readonly string[]) => {
			applied = [...entries];
		},
	} as unknown as EditorComponent);
	await controller.refresh({
		isPersisted: () => false,
		getCwd: () => harness.tempDir,
		getSessionDir: () => harness.tempDir,
		getSessionFile: () => undefined,
		getEntries: () => harness.sessionManager.getEntries(),
	});
	return applied;
}

// Fork-owned: in-memory sessions and a tool runner for the ported vcc_recall tests.
// pi-vcc's tests wrote JSONL files; these helpers hold the same entries in a SessionManager.
import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionToolContext, ToolDefinition } from "../../../src/core/extensions/types.ts";
import { createRecallToolDefinition } from "../../../src/core/fork-builtins/vcc-recall/recall.ts";
import {
	type FileEntry,
	type ReadonlySessionManager,
	SessionManager,
	type SessionMessageEntry,
} from "../../../src/core/session-manager.ts";

/** One message entry. `parentId` defaults to the previous spec's id, so a list forms one chain. */
export interface MessageSpec {
	id: string;
	parentId?: string | null;
	/** A message shape as pi-vcc's tests wrote it; fixtures may omit fields the recall code never reads. */
	message: object;
}

const ENTRY_TIMESTAMP = "2026-01-01T00:00:00.000Z";

/** An in-memory session holding the given message entries in order. The leaf is the last entry unless `leafId` names another. */
export function sessionOf(specs: readonly MessageSpec[], leafId?: string): SessionManager {
	const entries: FileEntry[] = specs.map((spec, i) => {
		const entry = {
			type: "message",
			id: spec.id,
			parentId: spec.parentId === undefined ? (specs[i - 1]?.id ?? null) : spec.parentId,
			timestamp: ENTRY_TIMESTAMP,
			message: spec.message,
		};
		return entry as SessionMessageEntry;
	});
	const sessionManager = SessionManager.inMemory(process.cwd(), undefined, entries);
	if (leafId !== undefined) sessionManager.branch(leafId);
	return sessionManager;
}

/** The `vcc_recall` definition, as `AgentSession` registers it. */
export function recallTool(): ToolDefinition {
	return createRecallToolDefinition();
}

/** Run the tool against a session and return its text output. */
export async function recall(
	tool: ToolDefinition,
	sessionManager: ReadonlySessionManager,
	params: Record<string, unknown>,
): Promise<string> {
	const ctx = { sessionManager } as unknown as ExtensionToolContext;
	const result = await tool.execute("tool-call", params, undefined, undefined, ctx);
	return (result.content[0] as TextContent).text;
}

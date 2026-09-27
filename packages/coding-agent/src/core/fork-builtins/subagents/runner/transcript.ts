/**
 * Fork-owned: a child's `.output` transcript, a JSON-lines copy of its conversation under the OS
 * temp directory (pi-subagents `src/output-file.ts` at 79a7c42). One writer lives as long as the
 * child session, so resumes and steers reach the same file. A compaction replaces the session's
 * message array with a shorter one; the writer flushes before it and re-anchors after it, so the
 * transcript keeps growing and never repeats a message.
 */
import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "../../../agent-session.ts";

/** `<tmp>/pi-subagents-<uid>/<encoded cwd>/<root session id>/tasks/<agent id>.output`, with owner-only root. */
export function transcriptPath(cwd: string, rootSessionId: string, agentId: string): string {
	const root = join(tmpdir(), `pi-subagents-${process.getuid?.() ?? 0}`);
	mkdirSync(root, { recursive: true, mode: 0o700 });
	if (process.platform !== "win32") chmodSync(root, 0o700);
	const encoded = cwd
		.replace(/[/\\]/g, "-")
		.replace(/^[A-Za-z]:-/, "")
		.replace(/^-+/, "");
	const dir = join(root, encoded, rootSessionId, "tasks");
	mkdirSync(dir, { recursive: true });
	return join(dir, `${agentId}.output`);
}

export interface TranscriptWriter {
	/** Appends every message not yet written. */
	flush(): void;
	/** Flushes, then stops following the session. */
	stop(): void;
}

/** Follows `session` from message `startIndex`, appending each new non-system message to `path`. */
export function writeTranscript(
	session: AgentSession,
	path: string,
	agentId: string,
	cwd: string,
	startIndex: number,
): TranscriptWriter {
	let written = startIndex;
	appendFileSync(path, "", "utf-8");
	const flush = () => {
		const messages = session.messages;
		while (written < messages.length) {
			const message = messages[written++];
			if (message.role === "system") continue;
			const type = message.role === "assistant" || message.role === "user" ? message.role : "toolResult";
			const entry = { isSidechain: true, agentId, type, message, timestamp: new Date().toISOString(), cwd };
			try {
				appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf-8");
			} catch {
				// Best effort: a transcript write never fails the run.
			}
		}
	};
	const unsubscribe = session.subscribe((event) => {
		if (event.type === "turn_end" || event.type === "compaction_start") flush();
		// The overflow-retry path trims its trailing error message after compaction_end, so re-anchor a microtask later.
		if (event.type === "compaction_end" && !event.aborted && event.result) {
			queueMicrotask(() => {
				written = session.messages.length;
			});
		}
	});
	return {
		flush,
		stop() {
			flush();
			unsubscribe();
		},
	};
}

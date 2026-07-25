import { createReadStream } from "fs";
import { readdir } from "fs/promises";
import { join } from "path";
import { createInterface } from "readline";
import { resolvePath } from "../utils/paths.ts";
import { parseSessionEntryLine, type SessionEntry, type SessionHeader } from "./session-manager.ts";

export interface PromptHistoryRecord {
	text: string;
	timestamp: number;
	sessionPath: string;
	ordinal: number;
}

export interface LoadProjectPromptHistoryOptions {
	cwd: string;
	sessionDir: string;
	/** Path of the currently open session file, excluded from directory scanning to avoid duplicating `currentEntries`. */
	excludeSessionFile?: string;
	/** Raw entries (all branches) of the currently open, not-yet-flushed session. */
	currentEntries?: readonly SessionEntry[];
	/** 0 means unlimited. */
	maxEntries: number;
}

/** Mirrors MAX_CONCURRENT_SESSION_INFO_LOADS in session-manager.ts to bound concurrent file scans. */
const MAX_CONCURRENT_SESSION_SCANS = 10;

function cwdMatches(headerCwd: unknown, resolvedCwd: string): boolean {
	return typeof headerCwd === "string" && headerCwd !== "" && resolvePath(headerCwd) === resolvedCwd;
}

/**
 * Extract text from a user message, joining text blocks with "" to match
 * InteractiveMode.getUserMessageText() exactly. Returns null for non-user messages,
 * and "" for image-only user messages (callers should treat that as "nothing to record").
 */
function extractUserMessageText(message: unknown): string | null {
	if (typeof message !== "object" || message === null) return null;
	const role = (message as { role?: unknown }).role;
	if (role !== "user") return null;

	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return null;

	return content
		.filter((block): block is { type: string; text: string } => {
			return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text";
		})
		.map((block) => (typeof block.text === "string" ? block.text : ""))
		.join("");
}

/** Finite `message.timestamp`, then the entry's ISO timestamp, then the session header's ISO timestamp, then 0. */
function deriveOrderingTime(message: unknown, entryTimestampIso: string, headerTimestampIso: string): number {
	const msgTimestamp = (message as { timestamp?: unknown } | null)?.timestamp;
	if (typeof msgTimestamp === "number" && Number.isFinite(msgTimestamp)) return msgTimestamp;

	const entryTime = Date.parse(entryTimestampIso);
	if (Number.isFinite(entryTime)) return entryTime;

	const headerTime = Date.parse(headerTimestampIso);
	if (Number.isFinite(headerTime)) return headerTime;

	return 0;
}

async function listJsonlFiles(dir: string): Promise<string[]> {
	try {
		const dirents = await readdir(dir, { withFileTypes: true });
		return dirents.filter((d) => d.isFile() && d.name.endsWith(".jsonl")).map((d) => join(dir, d.name));
	} catch {
		return [];
	}
}

/** Read-only: streams a single session file and extracts user-message prompt records. Never writes. */
async function scanSessionFile(filePath: string, resolvedCwd: string): Promise<PromptHistoryRecord[]> {
	const stream = createReadStream(filePath, { encoding: "utf8" });
	try {
		const rl = createInterface({ input: stream, crlfDelay: Infinity });

		const records: PromptHistoryRecord[] = [];
		let header: SessionHeader | null = null;
		let ordinal = 0;
		let rejected = false;

		for await (const line of rl) {
			const entry = parseSessionEntryLine(line);
			if (!entry) continue;

			if (!header) {
				if (entry.type !== "session" || typeof (entry as { id?: unknown }).id !== "string") {
					rejected = true;
					break;
				}
				if (!cwdMatches((entry as SessionHeader).cwd, resolvedCwd)) {
					rejected = true;
					break;
				}
				header = entry as SessionHeader;
				continue;
			}

			if (entry.type !== "message") continue;

			const text = extractUserMessageText(entry.message);
			if (text === null || text.trim() === "") continue;

			const timestamp = deriveOrderingTime(entry.message, entry.timestamp, header.timestamp);
			records.push({ text, timestamp, sessionPath: filePath, ordinal: ordinal++ });
		}

		if (rejected || !header) return [];
		return records;
	} catch {
		// One unreadable or malformed session file must not block discovery of the others.
		return [];
	} finally {
		stream.destroy();
	}
}

async function scanFilesWithConcurrency(files: string[], resolvedCwd: string): Promise<PromptHistoryRecord[][]> {
	const results: PromptHistoryRecord[][] = new Array(files.length).fill([]);
	const inFlight = new Set<Promise<void>>();
	let nextIndex = 0;

	const startNext = (): void => {
		const index = nextIndex++;
		const file = files[index];
		if (!file) return;

		const task: Promise<void> = scanSessionFile(file, resolvedCwd)
			.then((records) => {
				results[index] = records;
			})
			.catch(() => {
				results[index] = [];
			})
			.finally(() => {
				inFlight.delete(task);
			});
		inFlight.add(task);
	};

	while (nextIndex < files.length || inFlight.size > 0) {
		while (nextIndex < files.length && inFlight.size < MAX_CONCURRENT_SESSION_SCANS) {
			startNext();
		}
		if (inFlight.size > 0) {
			await Promise.race(inFlight);
		}
	}

	return results;
}

function extractRecordsFromCurrentEntries(
	entries: readonly SessionEntry[],
	sessionPathLabel: string,
): PromptHistoryRecord[] {
	const records: PromptHistoryRecord[] = [];
	let ordinal = 0;
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const text = extractUserMessageText(entry.message);
		if (text === null || text.trim() === "") continue;
		const timestamp = deriveOrderingTime(entry.message, entry.timestamp, entry.timestamp);
		records.push({ text, timestamp, sessionPath: sessionPathLabel, ordinal: ordinal++ });
	}
	return records;
}

/**
 * Read-only discovery of every persisted user prompt across all valid session files in `sessionDir`
 * whose header `cwd` resolves to `cwd`, merged with the current in-memory session's raw entries.
 * Streams files, never mutates or migrates them, and is safe to call for `--no-session` callers
 * only if they omit `currentEntries` from a persisted session (the caller decides whether to call at all).
 * Records are returned sorted oldest to newest; apply dedup/limit via `loadProjectPromptHistory`.
 */
export async function collectProjectPromptHistoryRecords(
	options: LoadProjectPromptHistoryOptions,
): Promise<PromptHistoryRecord[]> {
	const resolvedCwd = resolvePath(options.cwd);
	const resolvedSessionDir = resolvePath(options.sessionDir);
	const excludePath = options.excludeSessionFile ? resolvePath(options.excludeSessionFile) : undefined;

	const files = await listJsonlFiles(resolvedSessionDir);
	const targetFiles = files.filter((f) => f !== excludePath);

	const perFileRecords = await scanFilesWithConcurrency(targetFiles, resolvedCwd);
	const records: PromptHistoryRecord[] = perFileRecords.flat();

	if (options.currentEntries) {
		records.push(...extractRecordsFromCurrentEntries(options.currentEntries, excludePath ?? "<in-memory-session>"));
	}

	records.sort((a, b) => {
		if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
		if (a.sessionPath !== b.sessionPath) return a.sessionPath < b.sessionPath ? -1 : 1;
		return a.ordinal - b.ordinal;
	});

	return records;
}

/**
 * Chronological (oldest-first) list of prompt texts, with consecutive duplicates collapsed
 * and the configured limit applied (0 = unlimited, keeps the newest N otherwise).
 */
export async function loadProjectPromptHistory(options: LoadProjectPromptHistoryOptions): Promise<string[]> {
	const records = await collectProjectPromptHistoryRecords(options);

	const deduped: string[] = [];
	for (const record of records) {
		if (deduped.length > 0 && deduped[deduped.length - 1] === record.text) continue;
		deduped.push(record.text);
	}

	if (options.maxEntries > 0 && deduped.length > options.maxEntries) {
		return deduped.slice(deduped.length - options.maxEntries);
	}
	return deduped;
}

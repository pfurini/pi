import { createReadStream } from "fs";
import { readdir } from "fs/promises";
import { join } from "path";
import { createInterface } from "readline";
import { resolvePath } from "../utils/paths.ts";
import { type FileEntry, parseSessionEntryLine, type SessionEntry, type SessionHeader } from "./session-manager.ts";

export interface PromptHistoryRecord {
	/** Trimmed prompt text, matching what PromptHistoryController caches for live submissions. */
	text: string;
	timestamp: number;
	sessionPath: string;
	ordinal: number;
	/**
	 * Session entry id. `createBranchedSession` copies the parent branch's entries verbatim into the
	 * new file, so the same prompt appears in both files under the same id; deduping on it keeps a
	 * fork from replaying its parent's prompts a second time.
	 */
	entryId?: string;
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
 * Extract text from a user message, joining text blocks with "". Returns null for non-user messages,
 * and "" for image-only user messages (callers should treat that as "nothing to record").
 * Shared by prompt-history discovery, PromptHistoryController and InteractiveMode so recalled text
 * is always identical to what was submitted.
 */
export function extractUserMessageText(message: unknown): string | null {
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

/**
 * The text to recall for one session entry, or null when the entry is not a
 * user prompt. An entry that recorded the user's submitted text wins over its
 * delivered content, so a skill or command invocation recalls `/skill:name
 * args` instead of the expanded block it was delivered as. That field is the
 * only reason a non-user entry can be a prompt: a synthetic skill pair (A.4)
 * persists an assistant tool call and its result, never a user message.
 *
 * Shared by the project-scope collector and the session-scope controller so the
 * two scopes can never recall different text for the same entry.
 */
export function extractPromptRecallText(entry: FileEntry): string | null {
	if (entry.type !== "message") return null;
	if (typeof entry.originalText === "string" && entry.originalText !== "") {
		return entry.originalText;
	}
	return extractUserMessageText(entry.message);
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

function recordFromEntry(
	entry: FileEntry,
	sessionPath: string,
	ordinal: number,
	fallbackTimestampIso: string,
): PromptHistoryRecord | null {
	if (entry.type !== "message") return null;
	const text = extractPromptRecallText(entry)?.trim();
	if (!text) return null;
	return {
		text,
		timestamp: deriveOrderingTime(entry.message, entry.timestamp, fallbackTimestampIso),
		sessionPath,
		ordinal,
		entryId: typeof entry.id === "string" && entry.id !== "" ? entry.id : undefined,
	};
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

			const record = recordFromEntry(entry, filePath, ordinal, header.timestamp);
			if (!record) continue;
			records.push(record);
			ordinal++;
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
		const record = recordFromEntry(entry, sessionPathLabel, ordinal, entry.timestamp);
		if (!record) continue;
		records.push(record);
		ordinal++;
	}
	return records;
}

/**
 * Drop records that are copies of one another, keeping the oldest occurrence. Entry ids are only
 * 8 characters and unique within a single session, so an id alone would eventually collide across a
 * large project and silently swallow an unrelated prompt; matching on id, ordering time and text
 * together only ever matches entries that really were copied verbatim (which is exactly what
 * `createBranchedSession` produces). Records without an id are always kept.
 */
function dropCopiedRecords(records: readonly PromptHistoryRecord[]): PromptHistoryRecord[] {
	const seen = new Set<string>();
	const result: PromptHistoryRecord[] = [];
	for (const record of records) {
		if (record.entryId) {
			const key = `${record.entryId}\u0000${record.timestamp}\u0000${record.text}`;
			if (seen.has(key)) continue;
			seen.add(key);
		}
		result.push(record);
	}
	return result;
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

	return dropCopiedRecords(records);
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

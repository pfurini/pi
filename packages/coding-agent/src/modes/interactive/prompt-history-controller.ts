import type { EditorComponent } from "@earendil-works/pi-tui";
import { type LoadProjectPromptHistoryOptions, loadProjectPromptHistory } from "../../core/prompt-history.ts";
import type { SessionEntry } from "../../core/session-manager.ts";

/** Narrow view of SettingsManager the controller needs; keeps the controller testable without a full SettingsManager. */
export interface PromptHistorySettingsSource {
	getPromptHistoryScope(): "session" | "project";
	getPromptHistoryMaxEntries(): number;
}

/** Narrow view of SessionManager the controller needs; keeps the controller testable without a real SessionManager/TUI. */
export interface PromptHistorySessionSource {
	isPersisted(): boolean;
	getCwd(): string;
	getSessionDir(): string;
	getSessionFile(): string | undefined;
	/** All raw entries (every branch), excluding the header. */
	getEntries(): SessionEntry[];
	/** Active, compaction-aware entry list for the current leaf. */
	buildContextEntries(): SessionEntry[];
}

export type ProjectPromptHistoryLoader = (options: LoadProjectPromptHistoryOptions) => Promise<string[]>;

export interface PromptHistoryControllerDeps {
	settings: PromptHistorySettingsSource;
	/** Defaults to the real collector; override in tests. */
	loadProjectHistory?: ProjectPromptHistoryLoader;
}

export interface PromptHistoryRefreshResult {
	/** Set when discovery failed and the controller fell back to session-local history. */
	warning?: string;
}

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

function extractSessionScopeHistory(entries: readonly SessionEntry[]): string[] {
	const texts: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const text = extractUserMessageText(entry.message);
		if (text === null) continue;
		const trimmed = text.trim();
		if (!trimmed) continue;
		texts.push(trimmed);
	}
	return texts;
}

function collapseConsecutiveDuplicates(entries: readonly string[]): string[] {
	const result: string[] = [];
	for (const entry of entries) {
		if (result.length > 0 && result[result.length - 1] === entry) continue;
		result.push(entry);
	}
	return result;
}

function applyLimit(entries: readonly string[], maxEntries: number): string[] {
	if (maxEntries > 0 && entries.length > maxEntries) {
		return entries.slice(entries.length - maxEntries);
	}
	return [...entries];
}

/**
 * Owns the authoritative in-memory prompt-history cache (chronological, oldest-first, trimmed text)
 * and applies it to the active TUI editor.
 *
 * Race handling: `refresh()` snapshots the session synchronously, then may await an async project
 * scan. Any `record()` call that lands while that scan is in flight is captured in a side buffer and
 * merged into the freshly collected list when the scan resolves ("merge on completion"), so a prompt
 * submitted mid-refresh is never dropped. A monotonically increasing generation counter discards a
 * refresh's result if a newer refresh has since started, so stale async results (e.g. from a cwd that
 * has since changed via /resume) never clobber a newer session's history.
 */
export class PromptHistoryController {
	private cache: string[] = [];
	private recordedDuringLoad: string[] | null = null;
	private generation = 0;
	private activeEditor: EditorComponent | null = null;
	private readonly deps: PromptHistoryControllerDeps;
	/** Guards the legacy addToHistory-replay fallback against re-adding the same cache to the same editor. */
	private readonly lastReplayedCache = new WeakMap<EditorComponent, string[]>();

	constructor(deps: PromptHistoryControllerDeps) {
		this.deps = deps;
	}

	private getMaxEntries(): number {
		return this.deps.settings.getPromptHistoryMaxEntries();
	}

	/** Track the currently active editor and immediately seed it with the current cache. */
	setEditor(editor: EditorComponent): void {
		this.activeEditor = editor;
		this.applyToEditor(editor);
	}

	/** Apply the current cache and limit to `editor`. Never replaces or wraps the editor implementation. */
	applyToEditor(editor: EditorComponent): void {
		const maxEntries = this.getMaxEntries();
		editor.setHistoryMaxEntries?.(maxEntries);
		if (editor.setHistory) {
			editor.setHistory(this.cache);
		} else if (editor.addToHistory) {
			// Legacy custom editor: best-effort replay, oldest to newest. addToHistory has no way to
			// clear existing entries, so a second replay of the same cache object would pile up
			// duplicates (it only collapses consecutive duplicates, and a full oldest-to-newest replay
			// rarely lands consecutively against whatever is already at the front). This guard only
			// catches the same cache array being reapplied unchanged; it cannot dedupe across two
			// refreshes that both produce equivalent but distinct cache arrays, since there is no way
			// to ask a legacy editor to forget what it was already given.
			if (this.lastReplayedCache.get(editor) !== this.cache) {
				for (const entry of this.cache) {
					editor.addToHistory(entry);
				}
				this.lastReplayedCache.set(editor, this.cache);
			}
		}
	}

	/** Record a live submission: update the cache and the active editor's native history immediately. */
	record(text: string, editor: EditorComponent): void {
		const trimmed = text.trim();
		if (!trimmed) return;

		if (this.cache.length === 0 || this.cache[this.cache.length - 1] !== trimmed) {
			this.cache.push(trimmed);
			this.cache = applyLimit(this.cache, this.getMaxEntries());
		}

		if (this.recordedDuringLoad) {
			const pending = this.recordedDuringLoad;
			if (pending.length === 0 || pending[pending.length - 1] !== trimmed) {
				pending.push(trimmed);
			}
		}

		editor.addToHistory?.(text);
	}

	/**
	 * Recompute the cache from current settings and the given session, then apply it to the active
	 * editor (if any). Safe to call repeatedly and concurrently; only the most recently started
	 * refresh's result is ever published.
	 */
	async refresh(session: PromptHistorySessionSource): Promise<PromptHistoryRefreshResult> {
		const myGeneration = ++this.generation;
		// Preserve entries recorded during a still-in-flight prior refresh (which will bail out on the
		// generation check below without publishing) so this refresh absorbs and republishes them too.
		this.recordedDuringLoad ??= [];

		const scope = this.deps.settings.getPromptHistoryScope();
		const useProjectScope = scope === "project" && session.isPersisted();

		let collected: string[];
		let warning: string | undefined;
		try {
			if (useProjectScope) {
				const loader = this.deps.loadProjectHistory ?? loadProjectPromptHistory;
				collected = await loader({
					cwd: session.getCwd(),
					sessionDir: session.getSessionDir(),
					excludeSessionFile: session.getSessionFile(),
					currentEntries: session.getEntries(),
					// Limit is applied locally after merging in anything recorded during this load.
					maxEntries: 0,
				});
			} else {
				collected = extractSessionScopeHistory(session.buildContextEntries());
			}
		} catch (error) {
			warning = `Failed to load project prompt history, falling back to session history: ${
				error instanceof Error ? error.message : String(error)
			}`;
			collected = extractSessionScopeHistory(session.buildContextEntries());
		}

		if (myGeneration !== this.generation) {
			// A newer refresh has since started; discard this stale result entirely.
			return {};
		}

		const pending = this.recordedDuringLoad ?? [];
		this.recordedDuringLoad = null;

		const merged = collapseConsecutiveDuplicates([...collected, ...pending]);
		this.cache = applyLimit(merged, this.getMaxEntries());

		if (this.activeEditor) {
			this.applyToEditor(this.activeEditor);
		}

		return { warning };
	}
}

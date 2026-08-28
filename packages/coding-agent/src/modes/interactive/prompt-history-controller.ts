import type { EditorComponent } from "@earendil-works/pi-tui";
import {
	extractPromptRecallText,
	type LoadProjectPromptHistoryOptions,
	loadProjectPromptHistory,
} from "../../core/prompt-history.ts";
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
	/**
	 * All raw entries (every branch), excluding the header. Prompt history deliberately reads these
	 * rather than the compaction-aware context: recall must keep working for prompts that compaction
	 * has dropped from the model's context, and for prompts on branches no longer on the active path.
	 */
	getEntries(): SessionEntry[];
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

function extractSessionScopeHistory(entries: readonly SessionEntry[]): string[] {
	const texts: string[] = [];
	for (const entry of entries) {
		// No entry-type guard: a `context: fork` spawn notice is a `custom_message`
		// entry and is still a user prompt. `extractPromptRecallText` is the gate.
		const text = extractPromptRecallText(entry);
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

	/**
	 * Apply the current cache and limit to `editor`. Never replaces or wraps the editor implementation.
	 * Returns an error message instead of throwing, so a misbehaving extension-provided editor cannot
	 * turn a fire-and-forget refresh into an unhandled rejection.
	 */
	applyToEditor(editor: EditorComponent): string | undefined {
		try {
			const maxEntries = this.getMaxEntries();
			editor.setHistoryMaxEntries?.(maxEntries);
			if (editor.setHistory) {
				editor.setHistory(this.cache);
			} else if (editor.addToHistory) {
				this.replayToLegacyEditor(editor, editor.addToHistory.bind(editor));
			}
			return undefined;
		} catch (error) {
			return `Failed to apply prompt history to the editor: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * Legacy custom editor: best-effort replay, oldest to newest. addToHistory has no way to clear
	 * existing entries, so replaying the whole cache again would pile up duplicates (it only collapses
	 * consecutive duplicates, and a full oldest-to-newest replay rarely lands consecutively against
	 * whatever is already at the front). Refreshes normally only append, so replay just the suffix the
	 * editor has not seen. When the cache is no longer an extension of the last replay (the limit
	 * trimmed its front, or a refresh replaced it wholesale) there is no way to ask the editor to
	 * forget what it was given, so a full replay is the only option left.
	 */
	private replayToLegacyEditor(editor: EditorComponent, addToHistory: (text: string) => void): void {
		const replayed = this.lastReplayedCache.get(editor);
		const isExtension =
			replayed !== undefined &&
			replayed.length <= this.cache.length &&
			replayed.every((entry, index) => this.cache[index] === entry);

		for (let index = isExtension ? replayed.length : 0; index < this.cache.length; index++) {
			addToHistory(this.cache[index]);
		}
		this.lastReplayedCache.set(editor, [...this.cache]);
	}

	/** Record a live submission: update the cache and the active editor's native history immediately. */
	record(text: string): void {
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

		this.activeEditor?.addToHistory?.(text);
	}

	/**
	 * Recompute the cache from current settings and the given session, then apply it to the active
	 * editor (if any). Safe to call repeatedly and concurrently; only the most recently started
	 * refresh's result is ever published. Never rejects: every failure is reported as a warning, so
	 * callers may discard the promise without risking an unhandled rejection.
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
					// Pre-trimming to the same limit is safe: anything recorded during this load is newer
					// than everything collected, so merging it in and re-applying the limit below yields
					// the same newest-N list an untrimmed load would have produced.
					maxEntries: this.getMaxEntries(),
				});
			} else {
				collected = extractSessionScopeHistory(session.getEntries());
			}
		} catch (error) {
			warning = `Failed to load project prompt history, falling back to session history: ${
				error instanceof Error ? error.message : String(error)
			}`;
			try {
				collected = extractSessionScopeHistory(session.getEntries());
			} catch {
				collected = [];
			}
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
			const applyError = this.applyToEditor(this.activeEditor);
			if (applyError) warning = warning ? `${warning}; ${applyError}` : applyError;
		}

		return { warning };
	}
}

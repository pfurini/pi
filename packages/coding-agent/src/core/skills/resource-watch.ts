import { type Dirent, existsSync, type FSWatcher, readdirSync, statSync, watch } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { closeWatcher, FS_WATCH_RETRY_DELAY_MS } from "../../utils/fs-watch.ts";
import { canonicalizePath } from "../../utils/paths.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";

/**
 * Live watching of scanned skill/command roots (c4d, A.6). Non-recursive
 * per-directory watchers — root plus each scanned subdirectory, matching the
 * discovery shape (recursion stops at a found `SKILL.md`) — chosen for event
 * fidelity and explicit root control over `fs.watch({ recursive: true })`.
 * The module owns no skill semantics: it maps fs events → debounce → the
 * loader's light refresh, then re-syncs the watcher set by canonical-path
 * diffing so topology changes (a new child skill directory) are covered.
 */

/** One root the watcher covers: a scanned directory, or the parent directory of a direct skill file. */
export interface WatchedResourceRoot {
	dir: string;
	/** Set for a direct skill file (`--skill <file>`): only events naming this file count. */
	file?: string;
}

export interface WatchTimers {
	set(fn: () => void, ms: number): unknown;
	clear(handle: unknown): void;
}

/**
 * Attaches one directory watcher. Returning `null` or throwing reports a failed attach.
 * A thrown `EPERM`/`EACCES` error reports a permission denial, which the watcher
 * tolerates for fallback-ancestor directories (see `WatchTarget.fallbackOnly`).
 */
export type ResourceWatchFactory = (
	path: string,
	listener: (eventType: string, filename: string | null) => void,
	onError: () => void,
) => FSWatcher | null;

export interface ResourceWatcherOptions {
	/** The loader's light refresh. May throw; the watcher contains the failure and retries. */
	onRefreshNeeded: () => void;
	/** Watcher-health transitions: a diagnostic while degraded, `undefined` on recovery. */
	onHealthChange: (diagnostic: ResourceDiagnostic | undefined) => void;
	watch?: ResourceWatchFactory;
	timers?: WatchTimers;
	debounceMs?: number;
	retryDelayMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 100;

/** Throws on attach failure so the watcher can tell a permission denial from other errors. */
const defaultWatchFactory: ResourceWatchFactory = (path, listener, onError) => {
	const watcher = watch(path, listener);
	watcher.on("error", onError);
	watcher.unref();
	return watcher;
};

function isPermissionError(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	return code === "EPERM" || code === "EACCES";
}

/** Default timers: unref'd so a pending debounce/retry never keeps a headless process alive. */
export function createUnrefWatchTimers(): WatchTimers {
	return {
		set(fn, ms) {
			const timer = setTimeout(fn, ms);
			timer.unref();
			return timer;
		},
		clear(handle) {
			clearTimeout(handle as NodeJS.Timeout);
		},
	};
}

interface DirWatch {
	dir: string;
	watcher: FSWatcher;
	/** Canonical file filter; undefined watches the whole directory. */
	fileFilters?: Set<string>;
}

/** One directory in the derived watch plan. */
interface WatchTarget {
	dir: string;
	/** Canonical file filter; undefined watches the whole directory. */
	fileFilters?: Set<string>;
	/**
	 * Set when the directory is planned only as the nearest existing ancestor of a
	 * not-yet-existing root. A permission denial on such a directory does not degrade
	 * health: the root under it could not be read either (e.g. a sandbox that grants
	 * a project directory but not its parent).
	 */
	fallbackOnly?: boolean;
}

type AttachResult = "attached" | "permission-denied" | "failed";

export class ResourceWatcher {
	private readonly options: ResourceWatcherOptions;
	private readonly watchFactory: ResourceWatchFactory;
	private readonly timers: WatchTimers;
	private readonly debounceMs: number;
	private readonly retryDelayMs: number;

	private roots: WatchedResourceRoot[] = [];
	private readonly watched = new Map<string, DirWatch>();
	private readonly failedDirs = new Map<string, WatchTarget>();
	private refreshFailed = false;
	private debounceTimer: unknown;
	private retryTimer: unknown;
	private disposed = false;
	private healthDiagnostic: ResourceDiagnostic | undefined;

	constructor(options: ResourceWatcherOptions) {
		this.options = options;
		this.watchFactory = options.watch ?? defaultWatchFactory;
		this.timers = options.timers ?? createUnrefWatchTimers();
		this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
		this.retryDelayMs = options.retryDelayMs ?? FS_WATCH_RETRY_DELAY_MS;
	}

	/** Replace the root set (full reload, nested registration) and re-sync watchers. */
	setRoots(roots: readonly WatchedResourceRoot[]): void {
		if (this.disposed) return;
		const seen = new Set<string>();
		this.roots = roots.filter((root) => {
			const key = `${canonicalizePath(root.dir)}${root.file ? `\u0000${canonicalizePath(root.file)}` : ""}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		this.resyncDirs();
		this.evaluateHealth();
		// An attach failure here has no fs event to drive a cycle, so start the retry now.
		if (this.degraded) {
			this.scheduleRetry();
		}
	}

	/** Idempotent: closes every watcher and clears every pending timer. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clearDebounceTimer();
		this.clearRetryTimer();
		for (const dirWatch of this.watched.values()) {
			closeWatcher(dirWatch.watcher);
		}
		this.watched.clear();
		this.failedDirs.clear();
	}

	/** Whether any directory watch or the last refresh is in a failed (degraded) state. */
	get degraded(): boolean {
		return this.failedDirs.size > 0 || this.refreshFailed;
	}

	// ------------------------------------------------------------------
	// Watch-plan derivation
	// ------------------------------------------------------------------

	private deriveWatchPlan(): Map<string, WatchTarget> {
		const plan = new Map<string, WatchTarget>();
		const addWholeDir = (dir: string, fallbackOnly = false): void => {
			const key = canonicalizePath(dir);
			const existing = plan.get(key);
			if (existing) {
				existing.fileFilters = undefined;
				if (!fallbackOnly) existing.fallbackOnly = undefined;
			} else {
				plan.set(key, fallbackOnly ? { dir, fallbackOnly } : { dir });
			}
		};
		const addFileWatch = (dir: string, file: string): void => {
			const key = canonicalizePath(dir);
			const existing = plan.get(key);
			// resolve (not realpath): a direct skill file may not exist yet.
			const resolvedFile = resolve(file);
			if (existing) {
				existing.fallbackOnly = undefined;
				if (existing.fileFilters) existing.fileFilters.add(resolvedFile);
			} else {
				plan.set(key, { dir, fileFilters: new Set([resolvedFile]) });
			}
		};

		for (const root of this.roots) {
			if (root.file !== undefined) {
				addFileWatch(root.dir, root.file);
				continue;
			}
			if (existsSync(root.dir)) {
				this.expandScannedDir(root.dir, addWholeDir);
			} else {
				// A not-yet-existing root is covered by its nearest existing ancestor
				// until it appears; the event → refresh → re-sync cycle then walks it.
				addWholeDir(this.nearestExistingAncestor(root.dir), true);
			}
		}
		return plan;
	}

	private nearestExistingAncestor(dir: string): string {
		let current = dir;
		while (!existsSync(current)) {
			const parent = dirname(current);
			if (parent === current) break;
			current = parent;
		}
		return current;
	}

	/** Watch `dir` and every scanned subdirectory (the discovery shape: no dot-dirs, no node_modules, stop below a found SKILL.md). */
	private expandScannedDir(dir: string, addWholeDir: (dir: string) => void): void {
		addWholeDir(dir);
		if (existsSync(join(dir, "SKILL.md"))) return;
		const visited = new Set<string>([canonicalizePath(dir)]);
		const walk = (current: string): void => {
			let entries: Dirent[];
			try {
				entries = readdirSync(current, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
				const fullPath = join(current, entry.name);
				let isDirectory = entry.isDirectory();
				if (entry.isSymbolicLink()) {
					try {
						isDirectory = statSync(fullPath).isDirectory();
					} catch {
						continue;
					}
				}
				if (!isDirectory) continue;
				const canonical = canonicalizePath(fullPath);
				if (visited.has(canonical)) continue;
				visited.add(canonical);
				addWholeDir(fullPath);
				if (!existsSync(join(fullPath, "SKILL.md"))) {
					walk(fullPath);
				}
			}
		};
		walk(dir);
	}

	// ------------------------------------------------------------------
	// Watcher lifecycle
	// ------------------------------------------------------------------

	private attachWatch(dir: string, fileFilters: Set<string> | undefined): AttachResult {
		let watcher: FSWatcher | null;
		try {
			watcher = this.watchFactory(
				dir,
				(eventType, filename) => this.handleFsEvent(dir, eventType, filename),
				() => this.handleWatchError(dir),
			);
		} catch (error) {
			return isPermissionError(error) ? "permission-denied" : "failed";
		}
		if (!watcher) {
			return "failed";
		}
		// Liveness (c4d): no watcher handle may keep a headless/print process alive.
		// Idempotent belt-and-braces over the default factory's own unref.
		watcher.unref?.();
		const dirWatch: DirWatch = { dir, watcher, ...(fileFilters && { fileFilters }) };
		this.watched.set(canonicalizePath(dir), dirWatch);
		return "attached";
	}

	private handleFsEvent(dir: string, _eventType: string, filename: string | null): void {
		if (this.disposed) return;
		const dirWatch = this.watched.get(canonicalizePath(dir));
		if (dirWatch?.fileFilters && filename) {
			if (!dirWatch.fileFilters.has(resolve(join(dir, filename)))) {
				return;
			}
		}
		this.scheduleDebouncedCycle();
	}

	private handleWatchError(dir: string): void {
		if (this.disposed) return;
		const key = canonicalizePath(dir);
		const dirWatch = this.watched.get(key);
		if (dirWatch) {
			closeWatcher(dirWatch.watcher);
			this.watched.delete(key);
			this.failedDirs.set(key, {
				dir: dirWatch.dir,
				...(dirWatch.fileFilters && { fileFilters: dirWatch.fileFilters }),
			});
		}
		this.evaluateHealth();
		this.scheduleRetry();
	}

	/** Diff the derived plan against live watchers; attach new/failed dirs; close stale watches. Returns whether any watcher was newly attached. */
	private resyncDirs(): boolean {
		if (this.disposed) return false;
		const plan = this.deriveWatchPlan();

		for (const [key, dirWatch] of this.watched) {
			const target = plan.get(key);
			if (!target) {
				closeWatcher(dirWatch.watcher);
				this.watched.delete(key);
			} else {
				if (target.fileFilters) {
					dirWatch.fileFilters = target.fileFilters;
				} else {
					delete dirWatch.fileFilters;
				}
				plan.delete(key);
			}
		}

		// Failed dirs no longer planned (their root left the root set) drop out of the
		// failed set; still-planned failures are retried by the attach loop below.
		for (const key of [...this.failedDirs.keys()]) {
			if (!plan.has(key)) {
				this.failedDirs.delete(key);
			}
		}

		// Anything still in the plan here is not currently watched (loop 1 deleted the live
		// ones), so every successful attach is a topology addition: either a recovered
		// failure or a brand-new directory. Both need the caller's catch-up refresh — a
		// write landing between the refresh scan and this attach is otherwise never seen.
		let attachedNew = false;
		for (const [key, target] of plan) {
			const result = this.attachWatch(target.dir, target.fileFilters);
			if (result === "attached") {
				this.failedDirs.delete(key);
				attachedNew = true;
			} else if (result === "permission-denied" && target.fallbackOnly) {
				// Not degraded and no retry timer: the directory stays unwatched in the plan.
				// An unwatched directory emits no event, so only a re-sync that another
				// watched directory's event or an explicit refresh starts attempts it again.
				this.failedDirs.delete(key);
			} else {
				this.failedDirs.set(key, target);
			}
		}
		return attachedNew;
	}

	// ------------------------------------------------------------------
	// Debounce / retry / health
	// ------------------------------------------------------------------

	private scheduleDebouncedCycle(): void {
		if (this.disposed) return;
		this.clearDebounceTimer();
		this.debounceTimer = this.timers.set(() => {
			this.debounceTimer = undefined;
			this.cycle();
		}, this.debounceMs);
	}

	private scheduleRetry(): void {
		if (this.disposed || this.retryTimer !== undefined) return;
		this.retryTimer = this.timers.set(() => {
			this.retryTimer = undefined;
			this.cycle();
		}, this.retryDelayMs);
	}

	private clearDebounceTimer(): void {
		if (this.debounceTimer !== undefined) {
			this.timers.clear(this.debounceTimer);
			this.debounceTimer = undefined;
		}
	}

	private clearRetryTimer(): void {
		if (this.retryTimer !== undefined) {
			this.timers.clear(this.retryTimer);
			this.retryTimer = undefined;
		}
	}

	private tryRefresh(): boolean {
		try {
			this.options.onRefreshNeeded();
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * One refresh + topology re-sync cycle. A directory watcher that reattaches
	 * after an error triggers an immediate catch-up refresh (the blind-interval
	 * reconciliation) before health may clear, and any failure keeps the watcher
	 * degraded with another coalesced retry scheduled — the retry persists until
	 * a fully successful cycle or dispose().
	 */
	private cycle(): void {
		if (this.disposed) return;
		const refreshOk = this.tryRefresh();
		const attachedNew = this.resyncDirs();
		let catchUpOk = true;
		if (refreshOk && attachedNew) {
			// The scan above ran before these watchers existed; re-scan so a write that
			// landed in the attach gap is not lost until the next unrelated event.
			catchUpOk = this.tryRefresh();
		}
		this.refreshFailed = !refreshOk || !catchUpOk;
		this.evaluateHealth();
		if (this.degraded) {
			this.scheduleRetry();
		}
	}

	private evaluateHealth(): void {
		if (this.disposed) return;
		if (!this.degraded) {
			if (this.healthDiagnostic !== undefined) {
				this.healthDiagnostic = undefined;
				this.options.onHealthChange(undefined);
			}
			return;
		}
		// One persistent diagnostic per degraded episode, deduped across retries.
		if (this.healthDiagnostic === undefined) {
			this.healthDiagnostic = {
				type: "warning",
				message:
					"skill/command directory watching degraded; on-disk changes require /reload until the watcher recovers",
			};
			this.options.onHealthChange(this.healthDiagnostic);
		}
	}
}

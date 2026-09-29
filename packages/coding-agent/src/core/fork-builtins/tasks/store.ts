/**
 * Fork-owned: one session's task list (D46, D50). pi-tasks `src/task-store.ts` and `src/types.ts` at
 * 83480bd are the behavior reference; the file format is theirs, so an existing session's file resumes.
 *
 * A store opened with a path reads the file once and writes it after every change, through a temporary
 * file and a rename (`writeFileAtomically`). A failed write therefore never truncates the file. The
 * store then keeps the list in memory for the rest of the session and reports one warning. The store
 * also moves to memory, and leaves the file as it is, when:
 * - the file exists but holds no readable task list (D50);
 * - a path component below the project root, the file included, is a symlink (D52);
 * - another process changed the file since this store last read or wrote it (D53).
 * A store opened without a path, or after a fallback, never touches a file, until `retryWrite` saves the
 * list of a failed write again.
 */
import { lstatSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { writeFileAtomically } from "../subagents/atomic-write.ts";

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface Task {
	id: string;
	subject: string;
	description: string;
	status: TaskStatus;
	activeForm?: string;
	owner?: string;
	metadata: Record<string, unknown>;
	blocks: string[];
	blockedBy: string[];
	createdAt: number;
	updatedAt: number;
}

/** The file format. */
export interface TaskStoreData {
	nextId: number;
	tasks: Task[];
}

export interface TaskUpdate {
	status?: TaskStatus | "deleted";
	subject?: string;
	description?: string;
	activeForm?: string;
	owner?: string;
	/** Merged shallowly; a key set to null is deleted. */
	metadata?: Record<string, unknown>;
	addBlocks?: string[];
	addBlockedBy?: string[];
}

export interface TaskUpdateResult {
	task: Task | undefined;
	changedFields: string[];
	warnings: string[];
}

const STATUSES: readonly TaskStatus[] = ["pending", "in_progress", "completed"];

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const optionalText = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const ids = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

/**
 * Fills the fields files written before dependencies existed lack, and replaces a field of the wrong
 * type, so every reader can trust the shape. A hand-edited or damaged file may hold anything: a text
 * field of another type becomes empty, an unknown status becomes `pending`, and a non-string edge goes.
 */
function normalizeTask(id: string, raw: Record<string, unknown>): Task {
	const now = Date.now();
	return {
		...raw,
		id,
		subject: text(raw.subject),
		description: text(raw.description),
		status: STATUSES.includes(raw.status as TaskStatus) ? (raw.status as TaskStatus) : "pending",
		activeForm: optionalText(raw.activeForm),
		owner: optionalText(raw.owner),
		metadata:
			raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
				? (raw.metadata as Record<string, unknown>)
				: {},
		blocks: ids(raw.blocks),
		blockedBy: ids(raw.blockedBy),
		createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
		updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
	};
}

/** Parses a task file; undefined when it holds no `tasks` array. */
function parseTaskFile(text: string): TaskStoreData | undefined {
	const data: unknown = JSON.parse(text);
	if (!data || typeof data !== "object") return undefined;
	const { nextId, tasks } = data as { nextId?: unknown; tasks?: unknown };
	if (!Array.isArray(tasks)) return undefined;
	const loaded: Task[] = [];
	let maxId = 0;
	for (const task of tasks as Array<Record<string, unknown> | null>) {
		if (!task || typeof task !== "object" || typeof task.id !== "string") continue;
		loaded.push(normalizeTask(task.id, task));
		const numeric = Number(task.id);
		if (Number.isFinite(numeric) && numeric > maxId) maxId = numeric;
	}
	// Every later id comes from the counter, so it clears every id in use.
	const next = typeof nextId === "number" && Number.isInteger(nextId) && nextId > maxId ? nextId : maxId + 1;
	return { nextId: next, tasks: loaded };
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The first component below `root`, `path` included, that is a symlink; `path` itself when it lies outside `root`. */
function symlinkBelow(root: string, path: string): string | undefined {
	const below = relative(root, path);
	if (below === "" || below === ".." || below.startsWith(`..${sep}`) || isAbsolute(below)) return path;
	let current = root;
	for (const part of below.split(sep)) {
		current = join(current, part);
		const stats = lstatSync(current, { throwIfNoEntry: false });
		if (!stats) return undefined;
		if (stats.isSymbolicLink()) return current;
	}
	return undefined;
}

/** The file's text, or undefined when it does not exist. */
function readIfExists(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

type WriteOutcome = "saved" | "failed" | "refused";

export class TaskStore {
	private path: string | undefined;
	/** The trusted project root; no path component below it may be a symlink (D52). */
	private readonly root: string | undefined;
	/** The file a failed write or check left; `retryWrite` tries it again. Unset after a refusal or a failed read. */
	private unsavedPath: string | undefined;
	/** The file's text as this store last read or wrote it; undefined while no file exists (D53). */
	private lastText: string | undefined;
	private nextId = 1;
	private tasks = new Map<string, Task>();
	private readonly warn: (message: string) => void;

	/** Opens `path` when given; a missing file is created by the first change. `root` bounds the symlink check. */
	constructor(path: string | undefined, warn: (message: string) => void, root?: string) {
		this.warn = warn;
		this.root = root;
		if (path) this.open(path);
	}

	/** The file the list is saved to; undefined while the list lives in memory. */
	get file(): string | undefined {
		return this.path;
	}

	/**
	 * Why `path` may not be used now, or undefined. A symlink refuses it (D52). A check that cannot run,
	 * such as one that meets a missing permission, fails like a write, so `retryWrite` tries again (D50).
	 */
	private refusal(path: string): { reason: string; outcome: WriteOutcome } | undefined {
		try {
			const link = this.root ? symlinkBelow(this.root, path) : undefined;
			return link ? { reason: `${link} is a symlink`, outcome: "refused" } : undefined;
		} catch (error) {
			return { reason: `${path} could not be checked (${errorText(error)})`, outcome: "failed" };
		}
	}

	private open(path: string): void {
		const refused = this.refusal(path);
		if (refused) {
			this.toMemory(refused.reason);
			// A check that could not run is retried like a failed write; D53 then refuses a file this store never read.
			if (refused.outcome === "failed") this.unsavedPath = path;
			return;
		}
		let text: string | undefined;
		try {
			text = readIfExists(path);
		} catch (error) {
			this.toMemory(`${path} could not be read (${errorText(error)})`);
			return;
		}
		if (text === undefined) {
			this.path = path;
			return;
		}
		let data: TaskStoreData | undefined;
		try {
			data = parseTaskFile(text);
		} catch (error) {
			this.toMemory(`${path} is not a task list (${errorText(error)})`);
			return;
		}
		if (!data) {
			this.toMemory(`${path} is not a task list (no tasks array)`);
			return;
		}
		this.path = path;
		this.lastText = text;
		this.nextId = data.nextId;
		for (const task of data.tasks) this.tasks.set(task.id, task);
	}

	private toMemory(reason: string): void {
		this.path = undefined;
		this.warn(`Tasks are not saved: ${reason}. The list stays in memory for this session.`);
	}

	private save(): void {
		const path = this.path;
		if (!path) return;
		if (this.write(path) === "failed") this.unsavedPath = path;
	}

	/**
	 * Writes the list to `path`. A symlink or another process's change refuses the write; an I/O error
	 * fails it. Either moves the list to memory with a warning and leaves the file as it is.
	 */
	private write(path: string): WriteOutcome {
		const refused = this.refusal(path);
		if (refused) {
			this.toMemory(refused.reason);
			return refused.outcome;
		}
		try {
			if (readIfExists(path) !== this.lastText) {
				this.toMemory(`${path} changed outside this session`);
				return "refused";
			}
			mkdirSync(dirname(path), { recursive: true });
			const text = JSON.stringify(this.snapshot(), null, 2);
			writeFileAtomically(path, text);
			this.lastText = text;
			return "saved";
		} catch (error) {
			this.toMemory(errorText(error));
			return "failed";
		}
	}

	/**
	 * After a failed write, tries the file once more (`/reload`): a success saves the list there again. A
	 * file that could not be read stays untouched, so this never replaces it. True when the list is saved.
	 */
	retryWrite(): boolean {
		const path = this.unsavedPath;
		if (!path) return this.path !== undefined;
		const outcome = this.write(path);
		if (outcome === "failed") return false;
		this.unsavedPath = undefined;
		if (outcome === "refused") return false;
		this.path = path;
		return true;
	}

	create(subject: string, description: string, activeForm?: string, metadata?: Record<string, unknown>): Task {
		const now = Date.now();
		const task: Task = {
			id: String(this.nextId++),
			subject,
			description,
			status: "pending",
			activeForm,
			owner: undefined,
			metadata: metadata ?? {},
			blocks: [],
			blockedBy: [],
			createdAt: now,
			updatedAt: now,
		};
		this.tasks.set(task.id, task);
		this.save();
		return task;
	}

	get(id: string): Task | undefined {
		return this.tasks.get(id);
	}

	/** Every task in id order. */
	list(): Task[] {
		return [...this.tasks.values()].sort((a, b) => Number(a.id) - Number(b.id));
	}

	update(id: string, fields: TaskUpdate): TaskUpdateResult {
		const task = this.tasks.get(id);
		if (!task) return { task: undefined, changedFields: [], warnings: [] };
		if (fields.status === "deleted") {
			this.remove([id]);
			this.save();
			return { task: undefined, changedFields: ["deleted"], warnings: [] };
		}
		const changedFields: string[] = [];
		const warnings: string[] = [];
		for (const key of ["status", "subject", "description", "activeForm", "owner"] as const) {
			if (fields[key] === undefined) continue;
			(task as unknown as Record<string, unknown>)[key] = fields[key];
			changedFields.push(key);
		}
		if (fields.metadata !== undefined) {
			for (const [key, value] of Object.entries(fields.metadata)) {
				if (value === null) delete task.metadata[key];
				else task.metadata[key] = value;
			}
			changedFields.push("metadata");
		}
		if (fields.addBlocks?.length) {
			for (const targetId of fields.addBlocks) this.link(task, targetId, warnings);
			changedFields.push("blocks");
		}
		if (fields.addBlockedBy?.length) {
			for (const sourceId of fields.addBlockedBy) {
				const source = this.tasks.get(sourceId);
				if (!task.blockedBy.includes(sourceId)) task.blockedBy.push(sourceId);
				if (source && !source.blocks.includes(id)) {
					source.blocks.push(id);
					source.updatedAt = Date.now();
				}
				if (sourceId === id) warnings.push(`#${id} blocks itself`);
				else if (!source) warnings.push(`#${sourceId} does not exist`);
				else if (task.blocks.includes(sourceId)) warnings.push(`cycle: #${id} and #${sourceId} block each other`);
			}
			changedFields.push("blockedBy");
		}
		task.updatedAt = Date.now();
		this.save();
		return { task, changedFields, warnings };
	}

	/** `task` blocks `targetId`: both edges, and a warning for a self edge, a missing target or a cycle. */
	private link(task: Task, targetId: string, warnings: string[]): void {
		const target = this.tasks.get(targetId);
		if (!task.blocks.includes(targetId)) task.blocks.push(targetId);
		if (target && !target.blockedBy.includes(task.id)) {
			target.blockedBy.push(task.id);
			target.updatedAt = Date.now();
		}
		if (targetId === task.id) warnings.push(`#${task.id} blocks itself`);
		else if (!target) warnings.push(`#${targetId} does not exist`);
		else if (target.blocks.includes(task.id)) warnings.push(`cycle: #${task.id} and #${targetId} block each other`);
	}

	/** Deletes the tasks and every dependency edge that points at them. */
	private remove(ids: readonly string[]): void {
		const removed = new Set(ids);
		for (const id of ids) this.tasks.delete(id);
		for (const task of this.tasks.values()) {
			task.blocks = task.blocks.filter((other) => !removed.has(other));
			task.blockedBy = task.blockedBy.filter((other) => !removed.has(other));
		}
	}

	delete(id: string): boolean {
		if (!this.tasks.has(id)) return false;
		this.remove([id]);
		this.save();
		return true;
	}

	clearAll(): number {
		const count = this.tasks.size;
		this.tasks.clear();
		this.save();
		return count;
	}

	clearCompleted(): number {
		const done = this.list()
			.filter((task) => task.status === "completed")
			.map((task) => task.id);
		if (done.length === 0) return 0;
		this.remove(done);
		this.save();
		return done.length;
	}

	/** The list as the file holds it; a fork carries it into the next session. */
	snapshot(): TaskStoreData {
		return { nextId: this.nextId, tasks: this.list() };
	}

	/** Fills an empty store from a snapshot; a store that holds tasks stays as it is. */
	seed(data: TaskStoreData): void {
		if (this.tasks.size > 0) return;
		this.nextId = data.nextId;
		for (const task of data.tasks) this.tasks.set(task.id, structuredClone(task));
		this.save();
	}

	/**
	 * Deletes the file of an empty list; true when the list is empty and its file is gone. A failed
	 * deletion moves the list to memory, and `retryWrite` saves it there again.
	 */
	deleteFileIfEmpty(): boolean {
		const path = this.path;
		if (!path || this.tasks.size > 0) return false;
		const refused = this.refusal(path);
		if (refused) {
			this.toMemory(refused.reason);
			return false;
		}
		try {
			if (readIfExists(path) !== this.lastText) {
				this.toMemory(`${path} changed outside this session`);
				return false;
			}
			unlinkSync(path);
		} catch (error) {
			// A file already gone needs no deletion; any other failure leaves it, as a failed write does (D50).
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				this.toMemory(`${path} could not be deleted (${errorText(error)})`);
				this.unsavedPath = path;
				return false;
			}
		}
		this.lastText = undefined;
		return true;
	}
}

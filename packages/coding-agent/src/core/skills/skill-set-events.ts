import { deepFreeze } from "../../utils/deep-freeze.ts";
import type { EventBus } from "../event-bus.ts";
import type { SourceInfo } from "../source-info.ts";
import type { LoadedSkill } from "./frontmatter.ts";

/**
 * A.9 skill-set seam: one revisioned SkillSetController per EventBus exposes the
 * effective skill set to extensions via `skills:changed` events and a
 * `skills:query`/`skills:query:reply:<requestId>` request/reply pair.
 *
 * CROSS-REPO CONTRACT (copy set). These wire types are the canonical
 * cross-repository contract. Companion repositories (the pi-subagents fork, the
 * claude-bridge companion) COPY the following byte-for-byte and never `import`
 * them (the published upstream package does not ship this module, so an import
 * would break their independent buildability):
 *   - the wire types below (`SkillSetVisibility`, `SkillSetSnapshotSource`,
 *     `SkillSetSnapshotEntry`, `SkillSetSnapshot`, `SkillsChangedEvent`,
 *     `SkillsQueryRequest`, `RpcReply`);
 *   - the `canonicalSkillSetJson` canonical-JSON rule;
 *   - the committed fixture
 *     `test/suite/fixtures/skills-contract/skill-set-snapshot.json`.
 * The rewrite-map half of the contract lives in `runtime.ts` (also copied).
 */

export const SKILLS_CHANGED_CHANNEL = "skills:changed";
export const SKILLS_QUERY_CHANNEL = "skills:query";

export function skillsQueryReplyChannel(requestId: string): string {
	return `skills:query:reply:${requestId}`;
}

/** Recursively readonly JSON-safe value as carried by skill-set payloads. */
export type SkillSetJsonValue =
	| string
	| number
	| boolean
	| null
	| readonly SkillSetJsonValue[]
	| { readonly [key: string]: SkillSetJsonValue };

/**
 * The exact A.9 `source` object shape: the complete detached SourceInfo, never
 * the `SourceInfo.source` string alone. `baseDir` is omitted (never null) when absent.
 */
export interface SkillSetSnapshotSource {
	readonly path: string;
	readonly source: string;
	readonly scope: "user" | "project" | "temporary";
	readonly origin: "package" | "top-level";
	readonly baseDir?: string;
}

/**
 * Resolved A.6 visibility carried on the wire (decision 6): a JSON-safe
 * structural copy of `ResolvedSkillVisibility` from `./visibility.ts`. Duplicated
 * (not imported) so this module stays self-contained for byte-for-byte copying
 * into companion repos. `userInvokeError` is `true` iff the effective state is
 * `off`; the fork suppresses a skill's bundled agents exactly when it is `true`.
 */
export interface SkillSetVisibility {
	readonly model: "full" | "name" | "no";
	readonly user: "yes" | "no";
	readonly userInvokeError: boolean;
}

export interface SkillSetSnapshotEntry {
	readonly id: string;
	readonly name: string;
	readonly listingName: string;
	readonly baseDir: string;
	readonly source: SkillSetSnapshotSource;
	readonly frontmatter: { readonly [key: string]: SkillSetJsonValue };
	readonly visibility: SkillSetVisibility;
}

export interface SkillSetSnapshot {
	readonly revision: number;
	readonly skills: readonly SkillSetSnapshotEntry[];
	readonly removed: readonly string[];
}

/** `skills:changed` carries the full authoritative snapshot after each publication. */
export type SkillsChangedEvent = SkillSetSnapshot;

export interface SkillsQueryRequest {
	readonly requestId: string;
}

export type RpcReply<T> =
	| { readonly success: true; readonly data?: T }
	| { readonly success: false; readonly error: string };

export interface SkillSetController {
	/**
	 * Publish a new effective skill set. Publication is atomic: the snapshot is
	 * fully built and deep-frozen before it becomes authoritative and the revision
	 * increments; a construction failure keeps the previous snapshot and revision
	 * and the error surfaces to the caller.
	 */
	publish(skills: readonly LoadedSkill[], visibilityById?: ReadonlyMap<string, SkillSetVisibility>): SkillSetSnapshot;
	/** The current authoritative snapshot (detached and deep-frozen). */
	getSnapshot(): SkillSetSnapshot;
}

function cloneJsonValue(
	value: unknown,
	valuePath = "frontmatter",
	activeObjects = new Set<object>(),
): SkillSetJsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		if (Number.isFinite(value)) return value;
		throw new TypeError(`${valuePath} must contain only finite numbers`);
	}
	if (typeof value !== "object") {
		throw new TypeError(`${valuePath} must contain only JSON-safe values`);
	}
	if (activeObjects.has(value)) {
		throw new TypeError(`${valuePath} must not contain cyclic values`);
	}

	activeObjects.add(value);
	try {
		if (Array.isArray(value)) {
			return value.map((item, index) => cloneJsonValue(item, `${valuePath}[${index}]`, activeObjects));
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError(`${valuePath} must contain only plain objects and arrays`);
		}
		const result: { [key: string]: SkillSetJsonValue } = {};
		for (const [key, item] of Object.entries(value)) {
			result[key] = cloneJsonValue(item, `${valuePath}.${key}`, activeObjects);
		}
		return result;
	} finally {
		activeObjects.delete(value);
	}
}

/**
 * Build the wire visibility for one entry as a FRESH detached object (never the
 * caller-owned map value), so `deepFreeze(snapshot)` cannot freeze loader-owned
 * state. Falls back to the frontmatter-only `on` row when the map has no entry;
 * this mirrors the `on` row of `resolveSkillVisibility` (`./visibility.ts`) and
 * is only reached by non-loader callers — the production loader always passes a
 * complete map.
 */
function entryVisibility(
	skill: LoadedSkill,
	visibilityById: ReadonlyMap<string, SkillSetVisibility> | undefined,
): SkillSetVisibility {
	const resolved = visibilityById?.get(skill.id);
	if (resolved) {
		return { model: resolved.model, user: resolved.user, userInvokeError: resolved.userInvokeError };
	}
	return {
		model: skill.disableModelInvocation ? "no" : "full",
		user: skill.userInvocable ? "yes" : "no",
		userInvokeError: false,
	};
}

function cloneSourceInfo(sourceInfo: SourceInfo): SkillSetSnapshotSource {
	return {
		path: sourceInfo.path,
		source: sourceInfo.source,
		scope: sourceInfo.scope,
		origin: sourceInfo.origin,
		...(sourceInfo.baseDir !== undefined && { baseDir: sourceInfo.baseDir }),
	};
}

function sortKeysRecursively(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortKeysRecursively);
	}
	if (typeof value === "object" && value !== null) {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			const item = (value as Record<string, unknown>)[key];
			if (item !== undefined) {
				sorted[key] = sortKeysRecursively(item);
			}
		}
		return sorted;
	}
	return value;
}

/**
 * Canonical-JSON rule for the A.9 wire contract: object keys sorted
 * lexicographically (recursively), absent optional fields omitted, JSON.stringify
 * with 2-space indentation, single trailing LF. The committed conformance fixture
 * and every byte comparison use exactly this function.
 */
export function canonicalSkillSetJson(snapshot: SkillSetSnapshot): string {
	return `${JSON.stringify(sortKeysRecursively(snapshot), null, 2)}\n`;
}

class SkillSetControllerImpl implements SkillSetController {
	private readonly bus: EventBus;
	private current: SkillSetSnapshot;

	constructor(bus: EventBus) {
		this.bus = bus;
		const initial: SkillSetSnapshot = { revision: 0, skills: [], removed: [] };
		deepFreeze(initial);
		this.current = initial;
		this.bus.on(SKILLS_QUERY_CHANNEL, (data) => this.handleQuery(data));
	}

	getSnapshot(): SkillSetSnapshot {
		return this.current;
	}

	publish(skills: readonly LoadedSkill[], visibilityById?: ReadonlyMap<string, SkillSetVisibility>): SkillSetSnapshot {
		// Build the full snapshot before touching controller state so a throwing
		// clone leaves the previous authoritative snapshot and revision intact.
		// Everything is cloned first: loader-owned skills are never frozen or mutated.
		const entries: SkillSetSnapshotEntry[] = skills.map((skill) => ({
			id: skill.id,
			name: skill.name,
			listingName: skill.listingName,
			baseDir: skill.baseDir,
			source: cloneSourceInfo(skill.sourceInfo),
			frontmatter: cloneJsonValue(skill.frontmatter) as { readonly [key: string]: SkillSetJsonValue },
			visibility: entryVisibility(skill, visibilityById),
		}));
		const publishedIds = new Set(entries.map((entry) => entry.id));
		const removed = this.current.skills.map((entry) => entry.id).filter((id) => !publishedIds.has(id));
		const snapshot: SkillSetSnapshot = {
			revision: this.current.revision + 1,
			skills: entries,
			removed,
		};
		deepFreeze(snapshot);
		this.current = snapshot;
		this.bus.emit(SKILLS_CHANGED_CHANNEL, snapshot);
		return snapshot;
	}

	private handleQuery(data: unknown): void {
		if (typeof data !== "object" || data === null) {
			return;
		}
		const requestId = (data as { requestId?: unknown }).requestId;
		if (typeof requestId !== "string" || requestId.length === 0) {
			return;
		}
		const reply: RpcReply<SkillSetSnapshot> = { success: true, data: this.current };
		this.bus.emit(skillsQueryReplyChannel(requestId), reply);
	}
}

const controllers = new WeakMap<EventBus, SkillSetControllerImpl>();

/**
 * Return the single skill-set controller for an EventBus, creating it (and its one
 * permanent `skills:query` listener) on first use. Multiple loaders sharing a bus
 * publish to the same controller; the latest publication is authoritative.
 */
export function getSkillSetController(bus: EventBus): SkillSetController {
	let controller = controllers.get(bus);
	if (!controller) {
		controller = new SkillSetControllerImpl(bus);
		controllers.set(bus, controller);
	}
	return controller;
}

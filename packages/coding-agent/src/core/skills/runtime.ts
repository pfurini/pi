/**
 * Session-owned skill invocation runtime (C1b). Owns the A.5/A.8 invocation
 * records and their logical-turn lifetime: a record is created when an
 * invocation is recognized, activated only when the carrying message is
 * consumed by the agent loop (queue time is NOT activation time), retained
 * across tool continuations and retries within the same logical turn, and
 * expired on definitive turn completion — anchored by AgentSession to the
 * `_runAgentPrompt()` `finally` / `agent_settled` boundary, not the per-run
 * `agent_end` or the low-level `turn_end` event.
 *
 * C1b deliberately does not apply `model`/`effort` overrides or
 * `disallowed-tools` filtering to provider requests (that is C3); the runtime
 * preserves those fields, stacks records, and exposes them read-only.
 */

import { randomUUID } from "node:crypto";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { EventBus } from "../event-bus.ts";
import type { LoadedSkill, SkillToolList } from "./frontmatter.ts";
import { buildSkillEnvironment, type SkillInteropContext } from "./interop.ts";

/** A.9 rewrite-map seam (Workstream 2 fork emits; core keeps the last received). */
export const SKILL_AGENTS_REWRITE_MAPS_CHANNEL = "skill-agents:rewrite-maps";
export const SKILL_AGENTS_QUERY_CHANNEL = "skill-agents:query";

export function skillAgentsQueryReplyChannel(requestId: string): string {
	return `skill-agents:query:reply:${requestId}`;
}

export interface SkillAgentRewriteEntry {
	readonly qualified: string;
	readonly collided: boolean;
}

/** Bare agent name → rewrite target for one skill. */
export type SkillAgentRewriteMap = Readonly<Record<string, SkillAgentRewriteEntry>>;

/** Canonical skill ID → rewrite map. Absence of the event = empty map (rewrite stage no-ops). */
export type SkillAgentRewriteMaps = Readonly<Record<string, SkillAgentRewriteMap>>;

export interface SkillAgentRewriteMapsEvent {
	readonly revision: number;
	readonly maps: SkillAgentRewriteMaps;
}

/**
 * Structured invocation record. Immutable after creation; carries the raw
 * args verbatim plus the preserved execution fields C3 later consumes.
 */
export interface SkillInvocation {
	readonly invocationId: string;
	/** Canonical skill ID (canonicalized absolute SKILL.md path, A.9). */
	readonly skillId: string;
	readonly name: string;
	readonly baseDir: string;
	/** Source path of the SKILL.md file. */
	readonly filePath: string;
	/** Raw argument string R, verbatim. */
	readonly rawArgs: string;
	readonly model?: string;
	readonly effort?: string | number;
	readonly disallowedTools?: SkillToolList;
	readonly shell?: string;
}

/**
 * Detached, JSON-serializable invocation metadata (no runtime references) —
 * the shape session entries and render results carry.
 */
export interface SkillInvocationMetadata {
	readonly invocationId: string;
	readonly skillId: string;
	readonly name: string;
	readonly baseDir: string;
	readonly filePath: string;
	readonly args: string;
	readonly model?: string;
	readonly effort?: string | number;
	readonly shell?: string;
}

export function toInvocationMetadata(invocation: SkillInvocation): SkillInvocationMetadata {
	return {
		invocationId: invocation.invocationId,
		skillId: invocation.skillId,
		name: invocation.name,
		baseDir: invocation.baseDir,
		filePath: invocation.filePath,
		args: invocation.rawArgs,
		...(invocation.model !== undefined && { model: invocation.model }),
		...(invocation.effort !== undefined && { effort: invocation.effort }),
		...(invocation.shell !== undefined && { shell: invocation.shell }),
	};
}

export interface SkillRuntimeContext {
	/** Session cwd. */
	readonly cwd: string;
	/** Current session id. */
	readonly sessionId: string;
	/** Current session thinking level (read at use time). */
	readonly getThinkingLevel: () => string;
	/** `skillInterop` setting (read at use time so reload swaps take effect). */
	readonly getSkillInterop: () => boolean;
	/** Shared event bus for the A.9 rewrite-map seam; absence = empty map. */
	readonly eventBus?: EventBus;
}

/** Caller timeout for the rewrite-map query pull (A.9 envelope convention). */
const REWRITE_MAP_QUERY_TIMEOUT_MS = 2000;

export class SkillRuntime {
	private readonly context: SkillRuntimeContext;
	/** Active records for the current logical turn, in activation order. */
	private activeInvocations: SkillInvocation[] = [];
	private rewriteMaps: SkillAgentRewriteMaps = {};
	private rewriteMapsRevision = 0;
	private readonly unsubscribers: Array<() => void> = [];
	private disposed = false;

	constructor(context: SkillRuntimeContext) {
		this.context = context;
		if (context.eventBus) {
			const bus = context.eventBus;
			this.unsubscribers.push(
				bus.on(SKILL_AGENTS_REWRITE_MAPS_CHANNEL, (data) => {
					this.acceptRewriteMaps(data);
				}),
			);
			this.queryRewriteMaps(bus);
		}
	}

	/** Build an invocation record from a loaded skill and its raw args. Not yet active. */
	createInvocation(skill: LoadedSkill, rawArgs: string): SkillInvocation {
		const frontmatter = skill.frontmatter;
		// Kebab-case frontmatter key wins over the camelCase alias.
		const disallowedTools =
			frontmatter["disallowed-tools"] !== undefined ? frontmatter["disallowed-tools"] : frontmatter.disallowedTools;
		return {
			invocationId: randomUUID(),
			skillId: skill.id,
			name: skill.name,
			baseDir: skill.baseDir,
			filePath: skill.filePath,
			rawArgs,
			...(typeof frontmatter.model === "string" && { model: frontmatter.model }),
			...((typeof frontmatter.effort === "string" || typeof frontmatter.effort === "number") && {
				effort: frontmatter.effort,
			}),
			...(disallowedTools !== undefined && { disallowedTools }),
			...(typeof frontmatter.shell === "string" && { shell: frontmatter.shell }),
		};
	}

	/**
	 * Activate a record: the carrying message was consumed by the agent loop.
	 * Stacking (A.5): the most recent invocation wins env and overrides; all
	 * records stay listed so C3 can union `disallowed-tools`. Conflicting
	 * override fields on discarded records produce diagnostics (the fields are
	 * preserved, never applied here).
	 */
	activate(invocation: SkillInvocation): ResourceDiagnostic[] {
		const diagnostics: ResourceDiagnostic[] = [];
		const previous = this.getActiveInvocation();
		if (previous && previous.invocationId !== invocation.invocationId) {
			for (const field of ["model", "effort"] as const) {
				if (previous[field] !== undefined && invocation[field] === undefined) {
					diagnostics.push({
						type: "warning",
						message:
							`skill "${invocation.name}" invocation stacks over "${previous.name}": ` +
							`the ${field} override from "${previous.name}" is discarded (most recent invocation wins)`,
						path: invocation.filePath,
					});
				}
			}
		}
		this.activeInvocations.push(invocation);
		return diagnostics;
	}

	/** The current logical turn's most recent active record, if any. */
	getActiveInvocation(): SkillInvocation | undefined {
		return this.activeInvocations[this.activeInvocations.length - 1];
	}

	/** All active records of the current logical turn, in activation order. */
	getActiveInvocations(): readonly SkillInvocation[] {
		return this.activeInvocations;
	}

	/**
	 * Expire the logical turn's records. Called once by AgentSession at the
	 * `_runAgentPrompt()` `finally` / `agent_settled` boundary so env and
	 * overrides survive tool continuations and retries but never leak into the
	 * next user turn.
	 */
	expireTurn(): void {
		this.activeInvocations = [];
	}

	/** Latest rewrite map for a skill (empty when no Workstream 2 map arrived). */
	getRewriteMap(skillId: string): SkillAgentRewriteMap | undefined {
		return this.rewriteMaps[skillId];
	}

	getRewriteMapsRevision(): number {
		return this.rewriteMapsRevision;
	}

	/**
	 * A.8 env for the bash spawn seam: the values of the turn's most recent
	 * invocation, or undefined when no invocation is active (no skill env is
	 * composed). Returns a fresh object per call.
	 */
	getActiveExecutionEnv(): NodeJS.ProcessEnv | undefined {
		const active = this.getActiveInvocation();
		if (!active) {
			return undefined;
		}
		return buildSkillEnvironment(active, this.interopContext());
	}

	/** Interop context for a specific invocation's own rendering (shell injection). */
	interopContext(): SkillInteropContext {
		return {
			cwd: this.context.cwd,
			sessionId: this.context.sessionId,
			thinkingLevel: this.context.getThinkingLevel(),
			skillInterop: this.context.getSkillInterop(),
		};
	}

	/** Stop bus subscriptions; the runtime must not receive maps after disposal. */
	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		for (const unsubscribe of this.unsubscribers.splice(0)) {
			unsubscribe();
		}
	}

	private acceptRewriteMaps(data: unknown): void {
		if (typeof data !== "object" || data === null) {
			return;
		}
		const event = data as Partial<SkillAgentRewriteMapsEvent>;
		if (typeof event.revision !== "number" || typeof event.maps !== "object" || event.maps === null) {
			return;
		}
		// Consumers ignore stale revisions (A.9).
		if (event.revision < this.rewriteMapsRevision) {
			return;
		}
		this.rewriteMapsRevision = event.revision;
		this.rewriteMaps = event.maps;
	}

	/** Pull the current maps once so a late-registered fork is not required to re-emit. */
	private queryRewriteMaps(bus: EventBus): void {
		const requestId = randomUUID();
		const replyChannel = skillAgentsQueryReplyChannel(requestId);
		let settled = false;
		let timer: NodeJS.Timeout | undefined;
		const unsubscribe = bus.on(replyChannel, (data) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timer) {
				clearTimeout(timer);
			}
			unsubscribe();
			if (typeof data === "object" && data !== null && (data as { success?: unknown }).success === true) {
				this.acceptRewriteMaps((data as { data?: unknown }).data);
			}
		});
		timer = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			unsubscribe();
		}, REWRITE_MAP_QUERY_TIMEOUT_MS);
		if (timer.unref) {
			timer.unref();
		}
		bus.emit(SKILL_AGENTS_QUERY_CHANNEL, { requestId });
	}
}

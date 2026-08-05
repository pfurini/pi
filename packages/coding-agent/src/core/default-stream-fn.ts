import { AsyncLocalStorage } from "node:async_hooks";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { ModelRuntime } from "./model-runtime.ts";

/**
 * One default-stream target: the runtime that decides whether a model is served, and the
 * session stream function used to serve it (the same wrapper the session's own Agent uses,
 * so bare callers get retry settings, timeouts, attribution headers, and extension hooks).
 *
 * onPayload/onResponse are the session's extension provider hooks. They are injected only
 * on this bare-caller dispatch path: the session's own Agent carries them itself, and
 * direct callers of the session stream function (compaction, branch summarization) must
 * not have extension hooks silently added to their requests.
 */
export interface DefaultStreamTarget {
	runtime: ModelRuntime;
	streamFn: StreamFn;
	onPayload?: SimpleStreamOptions["onPayload"];
	onResponse?: SimpleStreamOptions["onResponse"];
	/** Set by the release function when the owning session is torn down. The scoped
	 *  (AsyncLocalStorage) dispatch path must honor this: a detached promise or timer
	 *  created inside a session scope outlives the scope's session, and without this
	 *  check a bare Agent it starts after disposal would still route through the
	 *  disposed session and stream against its already-aborted signal. */
	released?: boolean;
}

/**
 * Late-bound default-stream installations, in installation order (mirrors extensionRunnerRef).
 * createAgentSession installs a target per session; the composed default resolves at call
 * time, so Agents constructed before any runtime exists still pick it up.
 *
 * Entries are WeakRefs so an entirely dropped session can be garbage collected, with dead
 * entries pruned during dispatch. `pinnedTargets` keeps each target reachable exactly as
 * long as its stream function is (the session's Agent holds it), so routing never changes
 * with GC timing while any caller could still stream through the session; release stays
 * the deterministic removal path.
 */
const installations: WeakRef<DefaultStreamTarget>[] = [];
const pinnedTargets = new WeakMap<StreamFn, DefaultStreamTarget>();

/** Carries the calling session's target through its async call trees (see runWithDefaultStreamTarget). */
const activeSessionTarget = new AsyncLocalStorage<DefaultStreamTarget>();

/**
 * Whether routing `model` through `runtime` is safe and useful:
 *
 * - Providers with a composition overlay (extension or models.json config) always route.
 *   They are exactly what the raw compat path cannot serve: overlay middleware and
 *   configured auth live in the composed provider.
 * - Plain builtin providers route only when the runtime has configured auth for them AND
 *   the provider catalog serves the model's `api` (mirroring compat's own builtin guard).
 *   Without the catalog check, single-api builtin providers would stream ad-hoc models
 *   with the wrong wire protocol; without the auth check, keyless callers (local
 *   endpoints, header-based auth) that the compat path serves would hard-fail in the
 *   runtime's auth resolution.
 */
function runtimeServesModel(runtime: ModelRuntime, model: Model<Api>): boolean {
	if (runtime.hasProviderOverlay(model.provider)) return true;
	if (!runtime.hasConfiguredAuth(model.provider)) return false;
	const provider = runtime.getProvider(model.provider);
	if (!provider) return false;
	return provider.getModels().some((candidate) => candidate.api === model.api);
}

/**
 * Process-default stream function for Agent and low-level loop callers that omit streamFn.
 *
 * Dispatch order:
 * 1. The calling session's own target, when the call happens inside a session scope
 *    (see runWithDefaultStreamTarget) and that session's runtime serves the model. This is
 *    what keeps concurrent sessions in one process from routing each other's bare-Agent
 *    traffic ("which session is calling", not "which session was created last").
 * 2. The single installed target whose runtime serves the model. When MORE than one live
 *    target could serve it, dispatch fails with an actionable error instead of silently
 *    picking the newest session: which session's settings, auth, hooks, and abort signal
 *    apply is genuinely ambiguous, and a guess routes traffic through a session the caller
 *    never chose.
 * 3. Raw compat, for models no installed runtime serves and all calls before a runtime
 *    exists.
 *
 * Routed calls go through the target session's stream function, so bare Agents get the
 * full session pipeline: composed providers (extension overlay middleware, configured auth
 * incl. credential baseUrl overrides), retry settings, timeouts, attribution headers, and
 * the provider extension hooks.
 */
export const composedDefaultStreamFn: StreamFn = (model, context, options) => {
	const scoped = activeSessionTarget.getStore();
	if (scoped && !scoped.released && runtimeServesModel(scoped.runtime, model)) {
		return streamThroughTarget(scoped, model, context, options);
	}
	const eligible: DefaultStreamTarget[] = [];
	for (let i = installations.length - 1; i >= 0; i--) {
		const target = installations[i].deref();
		if (!target) {
			installations.splice(i, 1);
			continue;
		}
		if (runtimeServesModel(target.runtime, model)) {
			eligible.push(target);
		}
	}
	if (eligible.length > 1) {
		throw new Error(
			`Ambiguous default-stream dispatch: ${eligible.length} live sessions can serve ` +
				`${model.provider}/${model.id} and no session scope applies. Run the bare Agent ` +
				`inside the owning session's call tree (extension handlers and tools are scoped ` +
				`automatically), pass an explicit streamFn to the Agent/loop, or dispose the ` +
				`sessions that should not receive this traffic.`,
		);
	}
	if (eligible.length === 1) {
		return streamThroughTarget(eligible[0], model, context, options);
	}
	return streamSimple(model, context, options);
};

/** Bare callers get the target session's extension provider hooks unless they carry their own. */
function streamThroughTarget(
	target: DefaultStreamTarget,
	model: Model<Api>,
	context: Parameters<StreamFn>[1],
	options: Parameters<StreamFn>[2],
): ReturnType<StreamFn> {
	return target.streamFn(model, context, {
		...options,
		onPayload: options?.onPayload ?? target.onPayload,
		onResponse: options?.onResponse ?? target.onResponse,
	});
}

/**
 * Run fn inside a session scope: bare Agents and low-level loops started (directly or
 * transitively) within fn resolve the composed default to this session's target first.
 * AsyncLocalStorage propagates through awaits, promise chains, and timers created inside.
 */
export function runWithDefaultStreamTarget<T>(target: DefaultStreamTarget, fn: () => T): T {
	return activeSessionTarget.run(target, fn);
}

/**
 * True when streamFn is a process default (the composed default or raw compat streamSimple)
 * rather than a session-provided wrapper. Callers use this to detect Agents that were
 * constructed without an explicit streamFn and still need explicit auth resolution.
 */
export function isDefaultStreamFn(streamFn: unknown): boolean {
	return streamFn === composedDefaultStreamFn || streamFn === streamSimple;
}

/**
 * Register a default-stream target. Unscoped dispatch routes through the single live
 * target that serves a model; several eligible targets are an ambiguity error (see
 * composedDefaultStreamFn).
 *
 * Returns an idempotent release function bound to this installation only: releasing removes
 * exactly this entry (repeated installations of the same runtime are unaffected), so the
 * remaining targets (or the raw compat fallback when none remain) serve subsequent calls
 * and a disposed session's runtime never stays dispatchable. The target is
 * pinned via its stream function (see pinnedTargets), so the entry collects only when the
 * session and its Agent are both unreachable.
 */
export function installDefaultStreamTarget(target: DefaultStreamTarget): () => void {
	const ref = new WeakRef(target);
	installations.push(ref);
	pinnedTargets.set(target.streamFn, target);
	return () => {
		const index = installations.indexOf(ref);
		if (index !== -1) installations.splice(index, 1);
		// Mark released for the scoped dispatch path too: removal from installations
		// only stops UN-scoped routing, but AsyncLocalStorage contexts created while
		// the session was alive still carry this target. Via the ref (not a strong
		// capture) so the WeakRef GC design is unchanged.
		const released = ref.deref();
		if (released) released.released = true;
	};
}

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
 * Dispatch: the most recently installed target whose runtime serves the model (see
 * runtimeServesModel) wins, and the call goes through that session's stream function, so
 * bare Agents get the full session pipeline: composed providers (extension overlay
 * middleware, configured auth incl. credential baseUrl overrides), retry settings,
 * timeouts, attribution headers, and the provider extension hooks. Models no installed
 * runtime serves, and all calls before a runtime exists, keep the pre-existing raw compat
 * behavior.
 */
export const composedDefaultStreamFn: StreamFn = (model, context, options) => {
	for (let i = installations.length - 1; i >= 0; i--) {
		const target = installations[i].deref();
		if (!target) {
			installations.splice(i, 1);
			continue;
		}
		if (runtimeServesModel(target.runtime, model)) {
			return target.streamFn(model, context, {
				...options,
				onPayload: options?.onPayload ?? target.onPayload,
				onResponse: options?.onResponse ?? target.onResponse,
			});
		}
	}
	return streamSimple(model, context, options);
};

/**
 * True when streamFn is a process default (the composed default or raw compat streamSimple)
 * rather than a session-provided wrapper. Callers use this to detect Agents that were
 * constructed without an explicit streamFn and still need explicit auth resolution.
 */
export function isDefaultStreamFn(streamFn: unknown): boolean {
	return streamFn === composedDefaultStreamFn || streamFn === streamSimple;
}

/**
 * Register a default-stream target. The most recent installation wins.
 *
 * Returns an idempotent release function bound to this installation only: releasing removes
 * exactly this entry (repeated installations of the same runtime are unaffected), and the
 * previously installed target (or the raw compat fallback when none remain) becomes the
 * default again, so a disposed session's runtime never stays the default. The target is
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
	};
}

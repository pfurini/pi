import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { ModelRuntime } from "./model-runtime.ts";

/** One default-stream installation. A unique token per install lets release remove exactly its own entry. */
interface DefaultStreamInstallation {
	runtime: ModelRuntime;
}

/**
 * Late-bound default-stream installations, in installation order (mirrors extensionRunnerRef).
 * createAgentSession installs each ModelRuntime it uses; the composed default resolves the
 * target at call time, so Agents constructed before any runtime exists still pick it up.
 */
const installations: DefaultStreamInstallation[] = [];

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
 * Dispatch: the most recently installed ModelRuntime that serves the model (see
 * runtimeServesModel) wins, so bare Agents get the composed provider pipeline (extension
 * overlay middleware plus the runtime's auth resolution, including credential baseUrl
 * overrides, matching what a session request resolves). Session-level streamFn concerns
 * (retry settings, idle timeouts, attribution headers, the before_provider_headers hook)
 * do not apply here; callers that need them must pass an explicit streamFn. Models no
 * installed runtime serves, and all calls before a runtime exists, keep the pre-existing
 * raw compat behavior.
 */
export const composedDefaultStreamFn: StreamFn = (model, context, options) => {
	for (let i = installations.length - 1; i >= 0; i--) {
		const runtime = installations[i].runtime;
		if (runtimeServesModel(runtime, model)) {
			return runtime.streamSimple(model, context, options);
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
 * Register a ModelRuntime as a default-stream target. The most recent installation wins.
 *
 * Returns an idempotent release function bound to this installation only: releasing removes
 * exactly this entry (repeated installations of the same runtime are unaffected), and the
 * previously installed runtime (or the raw compat fallback when none remain) becomes the
 * default again, so a disposed session's runtime never stays the default.
 */
export function installDefaultStreamRuntime(runtime: ModelRuntime): () => void {
	const installation: DefaultStreamInstallation = { runtime };
	installations.push(installation);
	return () => {
		const index = installations.indexOf(installation);
		if (index !== -1) installations.splice(index, 1);
	};
}

import { type StreamFn, setDefaultStreamFn } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { ModelRuntime } from "./model-runtime.ts";

/**
 * Late-bound default-stream runtimes, in installation order (mirrors extensionRunnerRef).
 * createAgentSession installs each ModelRuntime it uses; the composed default resolves the
 * target at call time, so Agents constructed before any runtime exists still pick it up.
 */
const installedRuntimes: ModelRuntime[] = [];

/**
 * Process-default stream function for Agent and low-level loop callers that omit streamFn.
 *
 * Dispatch: the most recently installed ModelRuntime whose provider catalog knows the
 * model's provider wins, so bare Agents get the composed provider pipeline (extension
 * middleware, configured auth) instead of the raw compat path. Models whose provider no
 * installed runtime knows — and all calls before a runtime exists — keep the pre-existing
 * raw compat behavior.
 */
const composedDefaultStreamFn: StreamFn = (model, context, options) => {
	for (let i = installedRuntimes.length - 1; i >= 0; i--) {
		const runtime = installedRuntimes[i];
		if (runtime.getProvider(model.provider)) {
			return runtime.streamSimple(model, context, options);
		}
	}
	return streamSimple(model, context, options);
};

/** Install the composed default stream function as the pi-agent-core process default. */
export function installComposedDefaultStreamFn(): void {
	setDefaultStreamFn(composedDefaultStreamFn);
}

/**
 * Register a ModelRuntime as a default-stream target. The most recent installation wins.
 *
 * Returns an idempotent release function. Releasing removes only this installation:
 * the previously installed runtime — or the raw compat fallback when none remain —
 * becomes the default again, so a disposed session's runtime never stays the default.
 */
export function installDefaultStreamRuntime(runtime: ModelRuntime): () => void {
	installedRuntimes.push(runtime);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const index = installedRuntimes.lastIndexOf(runtime);
		if (index !== -1) installedRuntimes.splice(index, 1);
	};
}

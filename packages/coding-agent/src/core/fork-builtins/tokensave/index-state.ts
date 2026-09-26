/**
 * Fork-owned: whether a project's TokenSave index holds any node, cached per project root.
 *
 * An index with 0 nodes gets no rules injection and no guard, because the rules would
 * send the model to tools that return nothing. A root starts `unknown`. Its first lookup
 * runs TokenSave's `status` tool once, with a 4 s timeout, and caches `empty` or `ready`.
 * An error or a timeout counts as `ready`, so the rules and the guard stay on when the
 * check itself fails. An entry stays until `reset` returns the root to `unknown`. A
 * successful `/tokensave-init`, `/tokensave-sync` or reconciliation sync calls `reset`.
 */

import { decodeStatusResponse } from "./decoders.ts";
import { runTokensaveTool } from "./runner.ts";

export type IndexState = "unknown" | "empty" | "ready";
export type KnownIndexState = Exclude<IndexState, "unknown">;

const PROBE_TIMEOUT_MS = 4_000;

export async function probeIndexState(root: string): Promise<KnownIndexState> {
	const result = await runTokensaveTool("status", {}, { projectRoot: root, timeoutMs: PROBE_TIMEOUT_MS });
	if (!result.ok) return "ready";
	const decoded = decodeStatusResponse(result);
	return decoded.kind === "object" && decoded.stats.node_count === 0 ? "empty" : "ready";
}

export interface IndexStateCache {
	state(root: string): IndexState;
	/** The root's state; an `unknown` root is probed once, and concurrent lookups share the probe. */
	lookup(root: string): Promise<KnownIndexState>;
	reset(root: string): void;
}

export function createIndexStateCache(
	probe: (root: string) => Promise<KnownIndexState> = probeIndexState,
): IndexStateCache {
	const states = new Map<string, KnownIndexState>();
	const pending = new Map<string, Promise<KnownIndexState>>();

	return {
		state(root) {
			return states.get(root) ?? "unknown";
		},
		lookup(root) {
			const known = states.get(root);
			if (known) return Promise.resolve(known);
			const inFlight = pending.get(root);
			if (inFlight) return inFlight;

			const probing: Promise<KnownIndexState> = probe(root)
				.catch((): KnownIndexState => "ready")
				.then((state) => {
					// A reset during the probe drops its result: the index changed after it started.
					if (pending.get(root) === probing) {
						pending.delete(root);
						states.set(root, state);
					}
					return state;
				});
			pending.set(root, probing);
			return probing;
		},
		reset(root) {
			states.delete(root);
			pending.delete(root);
		},
	};
}

/**
 * Machine-readable marker for fork-only behavior.
 *
 * This fork is semver-indistinguishable from published pi (it reports the merged upstream
 * version), so extensions that depend on fork-only guarantees must feature-detect them
 * structurally instead of version-checking. Probe via the aliased extension import:
 *
 *   const pi = await import("@earendil-works/pi-coding-agent");
 *   pi.piForkCapabilities?.has("composed-default-stream-fn");
 *
 * `piForkCapabilities` is `undefined` on published pi builds — treat that as "no fork
 * guarantees" and fail (or degrade) with an actionable message.
 *
 * Entries are append-only: removing one is a breaking change for extensions gating on it.
 */
export const piForkCapabilities: ReadonlySet<string> = new Set([
	// WS-P: bare Agent/loop callers without an explicit streamFn route through the calling
	// (or newest eligible) session's composed pipeline instead of raw compat streamSimple
	// (see default-stream-fn.ts).
	"composed-default-stream-fn",
	// WS-Q: before_provider_request / before_provider_headers / after_provider_response
	// carry the request's model as `event.model` (never the session's selected model).
	"provider-event-model",
]);

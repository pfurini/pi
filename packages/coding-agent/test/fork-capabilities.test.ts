import { describe, expect, it } from "vitest";
import { piForkCapabilities as fromModule } from "../src/core/fork-capabilities.ts";
import { piForkCapabilities } from "../src/index.ts";

describe("piForkCapabilities", () => {
	it("is exported from the package index (the surface extensions probe)", () => {
		expect(piForkCapabilities).toBe(fromModule);
	});

	it("contains every WS-P/WS-Q guarantee entry (append-only set)", () => {
		for (const entry of [
			"composed-default-stream-fn",
			"provider-event-model",
			"force-oauth-refresh",
			"kimi-oauth-error-hardening",
			"unscoped-bare-agent-ambiguity",
		]) {
			expect(piForkCapabilities.has(entry)).toBe(true);
		}
	});
});

import { describe, expect, it } from "vitest";
import * as httpDispatcher from "../src/core/http-dispatcher.ts";
import * as index from "../src/index.ts";

// An embedded SDK process gets no pi entry point, so it must install the undici
// proxy dispatcher itself. Without these on the package index there is no way to.
describe("http dispatcher public exports", () => {
	it("exposes the proxy-install contract on the package index", () => {
		expect(index.configureHttpDispatcher).toBe(httpDispatcher.configureHttpDispatcher);
		expect(index.applyHttpProxySettings).toBe(httpDispatcher.applyHttpProxySettings);
		expect(index.parseHttpIdleTimeoutMs).toBe(httpDispatcher.parseHttpIdleTimeoutMs);
		expect(index.DEFAULT_HTTP_IDLE_TIMEOUT_MS).toBe(httpDispatcher.DEFAULT_HTTP_IDLE_TIMEOUT_MS);
	});
});

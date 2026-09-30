import { describe, expect, it } from "vitest";
import type { AuthStorageBackend } from "../src/core/auth-storage.ts";
import { McpOAuthCredentialStore } from "../src/extensions/mcp/oauth.ts";

// A sandbox such as pi-fence denies reading mcp-auth.json, as it does auth.json. The file
// backend then serves read-only operations as an empty store and refuses every other one;
// this stub reproduces that contract without touching the file system.
const DENIED = "auth.json is not readable in this session; credential changes are refused";

function deniedBackend(): AuthStorageBackend & { readonly calls: (boolean | undefined)[] } {
	const calls: (boolean | undefined)[] = [];
	const serve: AuthStorageBackend["withLock"] = (fn, options) => {
		calls.push(options?.readOnly);
		if (!options?.readOnly) throw new Error(DENIED);
		return fn(undefined).result;
	};
	return {
		calls,
		withLock: serve,
		withLockAsync: async (fn, options) => {
			calls.push(options?.readOnly);
			if (!options?.readOnly) throw new Error(DENIED);
			return (await fn(undefined)).result;
		},
	};
}

describe("MCP OAuth credential store over a denied file", () => {
	const serverUrl = "https://mcp.example.test/mcp";

	it("reads as an empty store, so a server that authenticates by header still connects", () => {
		const backend = deniedBackend();
		const store = new McpOAuthCredentialStore(backend);
		expect(store.forServer(serverUrl).load()).toBeUndefined();
		expect(store.tokens(serverUrl)).toBeUndefined();
		expect(store.remove(serverUrl)).toBe(false);
		expect(backend.calls).toEqual([true, true, true]);
	});

	it("still refuses to save a sign-in", () => {
		const store = new McpOAuthCredentialStore(deniedBackend());
		expect(() => store.forServer(serverUrl).save({ serverUrl, codeVerifier: "verifier-fixture-881001" })).toThrow(
			DENIED,
		);
	});
});

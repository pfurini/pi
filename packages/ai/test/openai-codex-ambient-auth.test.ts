import { describe, expect, it } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import type { AuthContext } from "../src/auth/types.ts";
import { createModels } from "../src/models.ts";
import { OPENAI_CODEX_AMBIENT_TOKEN_ENV, openaiCodexProvider } from "../src/providers/openai-codex.ts";

function fakeAuthContext(env: Record<string, string>): AuthContext {
	return {
		env: async (name) => env[name],
		fileExists: async () => false,
	};
}

describe("openai-codex ambient token", () => {
	it("resolves the ambient token as the request api key when the credential store is empty", async () => {
		const models = createModels({
			credentials: new InMemoryCredentialStore(),
			authContext: fakeAuthContext({ [OPENAI_CODEX_AMBIENT_TOKEN_ENV]: "ambient-token" }),
		});
		models.setProvider(openaiCodexProvider());

		const result = await models.getAuth("openai-codex");
		expect(result?.auth.apiKey).toBe("ambient-token");
		expect(result?.source).toBe(OPENAI_CODEX_AMBIENT_TOKEN_ENV);
	});

	it("resolves to undefined with an empty store and the variable unset", async () => {
		const models = createModels({
			credentials: new InMemoryCredentialStore(),
			authContext: fakeAuthContext({}),
		});
		models.setProvider(openaiCodexProvider());

		expect(await models.getAuth("openai-codex")).toBeUndefined();
	});

	it("prefers a stored OAuth credential over the ambient token", async () => {
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("openai-codex", async () => ({
			type: "oauth",
			access: "stored-oauth-access-token",
			refresh: "r",
			// Keep this beyond getAuth()'s refresh window.
			expires: Date.now() + 10 * 60_000,
		}));
		const models = createModels({
			credentials,
			authContext: fakeAuthContext({ [OPENAI_CODEX_AMBIENT_TOKEN_ENV]: "ambient-token" }),
		});
		models.setProvider(openaiCodexProvider());

		const result = await models.getAuth("openai-codex");
		expect(result?.auth.apiKey).toBe("stored-oauth-access-token");
		expect(result?.source).toBe("OAuth");
	});

	it("reports the provider configured from the ambient token alone", async () => {
		const configured = createModels({
			credentials: new InMemoryCredentialStore(),
			authContext: fakeAuthContext({ [OPENAI_CODEX_AMBIENT_TOKEN_ENV]: "ambient-token" }),
		});
		configured.setProvider(openaiCodexProvider());
		expect(await configured.checkAuth("openai-codex")).toEqual({
			source: OPENAI_CODEX_AMBIENT_TOKEN_ENV,
			type: "api_key",
		});

		const unconfigured = createModels({
			credentials: new InMemoryCredentialStore(),
			authContext: fakeAuthContext({}),
		});
		unconfigured.setProvider(openaiCodexProvider());
		expect(await unconfigured.checkAuth("openai-codex")).toBeUndefined();
	});

	it("exposes no api-key login, leaving OAuth as the only login path", () => {
		const provider = openaiCodexProvider();
		expect(provider.auth.apiKey?.login).toBeUndefined();
		expect(provider.auth.oauth?.login).toBeDefined();
	});
});

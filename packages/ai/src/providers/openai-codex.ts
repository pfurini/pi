import { openAICodexResponsesApi } from "../api/openai-codex-responses.lazy.ts";
import { lazyOAuth } from "../auth/helpers.ts";
import { loadOpenAICodexOAuth } from "../auth/oauth/load.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import { OPENAI_CODEX_MODELS } from "./openai-codex.models.ts";

/**
 * A launcher-minted stand-in for a sandboxed egress proxy that swaps it for the
 * real OAuth access token; it is never a user-entered secret, so there is no
 * `login` here and this variable never appears in `getApiKeyEnvVars`.
 */
export const OPENAI_CODEX_AMBIENT_TOKEN_ENV = "PI_OAUTH_ACCESS_TOKEN_OPENAI_CODEX";

/**
 * Ambient-only: `openai-codex` declares OAuth only, so a sandbox that cannot read
 * the stored OAuth credential would otherwise leave the provider unconfigured.
 * Omitting `login` keeps `/login` offering the OAuth flows alone, with no
 * api-key entry option for a provider that has no user-facing API keys. A
 * stored OAuth credential still wins: `resolveProviderAuthWithSignal` only
 * reaches this ambient branch when the credential store has nothing stored
 * for the provider, so this never overrides real OAuth state outside a sandbox.
 */
function openaiCodexAmbientApiKeyAuth(): ApiKeyAuth {
	return {
		name: "OpenAI Codex ambient token",
		resolve: async ({ ctx, signal }) => {
			const token = await ctx.env(OPENAI_CODEX_AMBIENT_TOKEN_ENV);
			signal.throwIfAborted();
			return token ? { auth: { apiKey: token }, source: OPENAI_CODEX_AMBIENT_TOKEN_ENV } : undefined;
		},
	};
}

export function openaiCodexProvider(): Provider<"openai-codex-responses"> {
	return createProvider({
		id: "openai-codex",
		name: "OpenAI Codex",
		baseUrl: "https://chatgpt.com/backend-api",
		auth: {
			apiKey: openaiCodexAmbientApiKeyAuth(),
			oauth: lazyOAuth({
				name: "OpenAI (ChatGPT Plus/Pro)",
				isSubscription: true,
				load: loadOpenAICodexOAuth,
			}),
		},
		models: Object.values(OPENAI_CODEX_MODELS),
		api: openAICodexResponsesApi(),
	});
}

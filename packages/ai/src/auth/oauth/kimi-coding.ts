/**
 * Kimi Code (subscription) OAuth flow
 *
 * RFC 8628 device authorization grant against https://auth.kimi.com with JSON
 * responses. The access token authenticates requests to
 * https://api.kimi.com/coding as an `Authorization: Bearer` header.
 */

import { getProviderEnvValue } from "../../utils/provider-env.ts";
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "../types.ts";
import { pollOAuthDeviceCodeFlow } from "./device-code.ts";

const CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const DEFAULT_OAUTH_HOST = "https://auth.kimi.com";
const DEVICE_CODE_TIMEOUT_SECONDS = 15 * 60;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const REFRESH_MAX_RETRIES = 3;

type DeviceAuthorization = {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
	intervalSeconds: number;
	expiresInSeconds: number;
};

type TokenResponse = {
	access: string;
	refresh: string;
	expires: number;
};

function getOauthHost(): string {
	const override = getProviderEnvValue("KIMI_CODE_OAUTH_HOST") || getProviderEnvValue("KIMI_OAUTH_HOST");
	return (override || DEFAULT_OAUTH_HOST).replace(/\/+$/, "");
}

function requestSignal(signal: AbortSignal): AbortSignal {
	return AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal]);
}

function formUrlEncode(fields: Record<string, string>): string {
	return new URLSearchParams(fields).toString();
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
	try {
		const json = await response.json();
		return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/**
 * Error policy for this file: surfaced messages carry field NAMES, HTTP status,
 * and the standard OAuth `error` code only — never response bodies and never
 * `error_description`. Partial device/token responses can contain live secrets
 * (access tokens, refresh tokens, device codes), `error_description` is
 * server-controlled free text, and these messages surface in UI, logs, and
 * wrapped ModelsError chains.
 */
function invalidFieldNames(fields: Record<string, boolean>): string {
	return Object.entries(fields)
		.filter(([, valid]) => !valid)
		.map(([name]) => name)
		.join(", ");
}

/** The verification URI is opened in the user's browser; only http(s) URLs are trusted. */
function trustedHttpUrl(value: unknown): string | null {
	if (typeof value !== "string" || !value) return null;
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		return url.href;
	} catch {
		return null;
	}
}

async function startDeviceAuthorization(oauthHost: string, signal: AbortSignal): Promise<DeviceAuthorization> {
	const response = await fetch(`${oauthHost}/api/oauth/device_authorization`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: formUrlEncode({ client_id: CLIENT_ID }),
		signal: requestSignal(signal),
	});

	if (!response.ok) {
		// Status only, matching every other error path in this file: response bodies are
		// never echoed into surfaced errors (see invalidFieldNames).
		throw new Error(`Kimi Code device authorization failed with status ${response.status}`);
	}

	const json = await readJson(response);
	const deviceCode = json?.device_code;
	const userCode = json?.user_code;
	const verificationUri = json?.verification_uri;
	const verificationUriComplete = json?.verification_uri_complete;
	const invalid = invalidFieldNames({
		device_code: typeof deviceCode === "string" && deviceCode !== "",
		user_code: typeof userCode === "string" && userCode !== "",
		verification_uri: typeof verificationUri === "string" && trustedHttpUrl(verificationUri) !== null,
		verification_uri_complete:
			typeof verificationUriComplete === "string" && trustedHttpUrl(verificationUriComplete) !== null,
	});
	if (
		invalid !== "" ||
		// Redundant at runtime (covered by `invalid`), kept for type narrowing.
		typeof deviceCode !== "string" ||
		typeof userCode !== "string" ||
		typeof verificationUri !== "string" ||
		typeof verificationUriComplete !== "string"
	) {
		throw new Error(
			`Invalid Kimi Code device authorization response (status ${response.status}; missing or invalid: ${invalid})`,
		);
	}

	const interval = json?.interval;
	const expiresIn = json?.expires_in;
	return {
		deviceCode,
		userCode,
		verificationUri,
		verificationUriComplete,
		intervalSeconds:
			typeof interval === "number" && Number.isFinite(interval) && interval > 0
				? interval
				: DEFAULT_POLL_INTERVAL_SECONDS,
		expiresInSeconds:
			typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
				? expiresIn
				: DEVICE_CODE_TIMEOUT_SECONDS,
	};
}

function parseTokenResponse(json: Record<string, unknown> | null, operation: string): TokenResponse {
	const accessToken = json?.access_token;
	const refreshToken = json?.refresh_token;
	const expiresIn = json?.expires_in;
	const invalid = invalidFieldNames({
		access_token: typeof accessToken === "string" && accessToken !== "",
		refresh_token: typeof refreshToken === "string" && refreshToken !== "",
		expires_in: typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0,
	});
	if (
		invalid !== "" ||
		// Redundant at runtime (covered by `invalid`), kept for type narrowing.
		typeof accessToken !== "string" ||
		typeof refreshToken !== "string" ||
		typeof expiresIn !== "number"
	) {
		throw new Error(`Kimi Code token ${operation} response missing or invalid fields: ${invalid}`);
	}
	return {
		access: accessToken,
		refresh: refreshToken,
		expires: Date.now() + expiresIn * 1000,
	};
}

async function pollForToken(
	oauthHost: string,
	device: DeviceAuthorization,
	signal: AbortSignal,
): Promise<TokenResponse> {
	return pollOAuthDeviceCodeFlow<TokenResponse>({
		intervalSeconds: device.intervalSeconds,
		expiresInSeconds: device.expiresInSeconds,
		waitBeforeFirstPoll: true,
		signal,
		poll: async () => {
			const response = await fetch(`${oauthHost}/api/oauth/token`, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Accept: "application/json",
				},
				body: formUrlEncode({
					client_id: CLIENT_ID,
					device_code: device.deviceCode,
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				}),
				signal: requestSignal(signal),
			});

			if (response.status >= 500) {
				// Status only: the token endpoint's request carries the device code, and a
				// misbehaving server can echo request material into the error body.
				return {
					status: "failed",
					message: `Kimi Code device token request failed with status ${response.status}`,
				};
			}

			const json = await readJson(response);
			if (response.ok && typeof json?.access_token === "string") {
				try {
					return { status: "complete", value: parseTokenResponse(json, "poll") };
				} catch (error) {
					return { status: "failed", message: error instanceof Error ? error.message : String(error) };
				}
			}

			const error = json?.error;
			if (error === "authorization_pending") {
				return { status: "pending" };
			}
			if (error === "slow_down") {
				const interval = json?.interval;
				return {
					status: "slow_down",
					intervalSeconds: typeof interval === "number" && interval > 0 ? interval : undefined,
				};
			}
			if (error === "expired_token") {
				return { status: "failed", message: "Kimi Code device authorization expired. Please restart login." };
			}
			if (error === "access_denied") {
				return { status: "failed", message: "Kimi Code login was denied." };
			}
			return {
				status: "failed",
				message: `Kimi Code device token request failed (status ${response.status})${typeof error === "string" ? `: ${error}` : ""}`,
			};
		},
	});
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		signal.throwIfAborted();
		const onAbort = () => {
			clearTimeout(timeout);
			reject(signal.reason);
		};
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function isRetryableRefreshFailure(response: Response): boolean {
	return response.status === 429 || response.status >= 500;
}

async function refreshToken(oauthHost: string, refreshTokenValue: string, signal: AbortSignal): Promise<TokenResponse> {
	let lastError: Error | undefined;
	for (let attempt = 0; attempt <= REFRESH_MAX_RETRIES; attempt++) {
		if (attempt > 0) {
			await sleep(1000 * 2 ** (attempt - 1), signal);
		}
		if (signal.aborted) {
			throw new Error("Kimi Code token refresh aborted");
		}

		let response: Response;
		try {
			response = await fetch(`${oauthHost}/api/oauth/token`, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Accept: "application/json",
				},
				body: formUrlEncode({
					client_id: CLIENT_ID,
					grant_type: "refresh_token",
					refresh_token: refreshTokenValue,
				}),
				signal: requestSignal(signal),
			});
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			continue;
		}

		const json = await readJson(response);
		if (response.ok) {
			return parseTokenResponse(json, "refresh");
		}

		// Unauthorized: the stored credential is dead; Models clears it and prompts re-login.
		if (response.status === 401 || response.status === 403 || json?.error === "invalid_grant") {
			const errorCode = typeof json?.error === "string" ? ` (${json.error})` : "";
			throw new Error(`Kimi Code token refresh unauthorized (status ${response.status})${errorCode}`);
		}

		if (isRetryableRefreshFailure(response) && attempt < REFRESH_MAX_RETRIES) {
			lastError = new Error(`Kimi Code token refresh failed with status ${response.status}`);
			continue;
		}

		// Report only the standard OAuth error code — a token-endpoint body must
		// never be echoed wholesale (it can carry live token material), and
		// error_description is server-controlled free text (see the policy above).
		const errorCode = typeof json?.error === "string" ? ` (${json.error})` : "";
		throw new Error(`Kimi Code token refresh failed with status ${response.status}${errorCode}`);
	}

	throw lastError ?? new Error("Kimi Code token refresh failed");
}

async function loginKimiCoding(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
	const oauthHost = getOauthHost();
	const device = await startDeviceAuthorization(oauthHost, interaction.signal);
	interaction.notify({
		type: "device_code",
		userCode: device.userCode,
		verificationUri: device.verificationUriComplete,
		intervalSeconds: device.intervalSeconds,
		expiresInSeconds: device.expiresInSeconds,
	});
	const token = await pollForToken(oauthHost, device, interaction.signal);
	return { type: "oauth", access: token.access, refresh: token.refresh, expires: token.expires };
}

export const kimiCodingOAuth: OAuthAuth = {
	name: "Kimi Code (subscription)",
	isSubscription: true,
	loginLabel: "Sign in with Kimi Code",

	login: loginKimiCoding,

	refresh: async (credential, signal) => {
		const token = await refreshToken(getOauthHost(), credential.refresh, signal);
		return { type: "oauth", access: token.access, refresh: token.refresh, expires: token.expires };
	},

	async toAuth(credential) {
		return { headers: { Authorization: `Bearer ${credential.access}` } };
	},
};

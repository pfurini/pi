// Ported from pi-tokensave (github.com/pfurini/pi-tokensave) commit 2a626d3b, src/state.ts.
// Copyright (c) 2026 pi-tokensave contributors. MIT licence: see LICENSE in this directory.

/**
 * Session-scoped guard state and the user's settings (mode, branch management).
 *
 * Settings live in the session agent directory's `settings.json`, under
 * `forkBuiltins["pi-tokensave"]`:
 *
 *   { "forkBuiltins": { "pi-tokensave": { "mode": "prefer", "autoManageBranches": true } } }
 *
 * The module only reads that file, and never a project's `.pi/settings.json`.
 * `/tokensave-mode` changes the mode for the current session only. Session state
 * is in-memory and intentionally small: it exists to unblock the guard after
 * TokenSave has been consulted, or after it failed/returned nothing useful.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type TokensaveMode = "prefer" | "enforce";

/** Where the session's mode came from: the settings file, or `/tokensave-mode`. */
export type TokensaveModeSource = "settings" | "session";

export interface TokensaveConfig {
	mode: TokensaveMode;
	autoManageBranches: boolean;
}

export const DEFAULT_MODE: TokensaveMode = "enforce";
export const DEFAULT_AUTO_MANAGE_BRANCHES = false;

/** The key of this module's entry under `forkBuiltins` in `settings.json`. */
export const SETTINGS_KEY = "pi-tokensave";

export function tokensaveSettingsPath(agentDir: string): string {
	return join(agentDir, "settings.json");
}

/**
 * Reads `forkBuiltins["pi-tokensave"]` from the agent directory's `settings.json`.
 * A field keeps its value only when it has the right type; a missing, unreadable
 * or malformed file, or a missing or non-object entry, yields the defaults.
 */
export function loadTokensaveSettings(agentDir: string): TokensaveConfig {
	const entry = readSettingsEntry(tokensaveSettingsPath(agentDir));
	return {
		mode: entry.mode === "prefer" || entry.mode === "enforce" ? entry.mode : DEFAULT_MODE,
		autoManageBranches:
			typeof entry.autoManageBranches === "boolean" ? entry.autoManageBranches : DEFAULT_AUTO_MANAGE_BRANCHES,
	};
}

function readSettingsEntry(path: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
	} catch {
		return {};
	}
	const section = isObject(parsed) ? parsed.forkBuiltins : undefined;
	const entry = isObject(section) ? section[SETTINGS_KEY] : undefined;
	return isObject(entry) ? entry : {};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface TokensaveSessionState {
	mode: TokensaveMode;
	modeSource: TokensaveModeSource;
	/** undefined = not checked yet this session */
	binaryAvailable: boolean | undefined;
	/** Normalized query fragments TokenSave has already been asked about, per project root. */
	consultedQueries: Map<string, string[]>;
	/** Set when the most recent TokenSave call failed or returned nothing useful. */
	lastCallFailedOrEmpty: boolean;
	lastFailureMessage?: string;
	warnedManualExplorationOnce: boolean;
}

export function createSessionState(mode: TokensaveMode): TokensaveSessionState {
	return {
		mode,
		modeSource: "settings",
		binaryAvailable: undefined,
		consultedQueries: new Map(),
		lastCallFailedOrEmpty: false,
		warnedManualExplorationOnce: false,
	};
}

const MAX_CONSULTED_QUERIES = 50;

export function normalizeQueryFragment(text: string): string {
	return text.trim().toLowerCase();
}

export function recordConsultation(
	state: TokensaveSessionState,
	root: string,
	query: string,
	succeededWithResults: boolean,
): void {
	const normalized = normalizeQueryFragment(query);
	if (normalized.length >= 2) {
		const queries = state.consultedQueries.get(root) ?? [];
		queries.push(normalized);
		if (queries.length > MAX_CONSULTED_QUERIES) {
			queries.shift();
		}
		state.consultedQueries.set(root, queries);
	}
	state.lastCallFailedOrEmpty = !succeededWithResults;
}

export function recordFailure(state: TokensaveSessionState, message: string): void {
	state.lastCallFailedOrEmpty = true;
	state.lastFailureMessage = message;
}

/**
 * Conservative match: a candidate search term is considered "already
 * consulted" if it shares a case-insensitive substring relationship with
 * any query fragment previously consulted in the same project root.
 */
export function wasCandidateConsulted(state: TokensaveSessionState, root: string, candidate: string): boolean {
	const normalized = normalizeQueryFragment(candidate);
	if (!normalized) return false;
	const queries = state.consultedQueries.get(root) ?? [];
	return queries.some((query) => query.includes(normalized) || normalized.includes(query));
}

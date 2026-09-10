/**
 * The pi-fence recovery-record check (pi-fence phase 5a, section 8.3).
 *
 * Problem: a pi-fence launcher refreshes the openai-codex credential in
 * auth.json under the same lock this agent uses. When its exchange is
 * dispatched but the response is lost, nobody knows whether the provider
 * rotated the refresh token. Example: the launcher's request times out after
 * OpenAI already issued a new token pair; the stored refresh token is spent,
 * and a second refresh with it fails or, worse, revokes what the launcher
 * kept in memory.
 *
 * Solution: the launcher records that uncertainty in
 * `auth.json.fence-state/codex.json` as two fingerprints of the credential it
 * dispatched with: the generation (access and refresh together) and the
 * refresh token alone. Before this agent's `modify` callback for openai-codex
 * runs, the stored credential is fingerprinted the same way. The exact recorded
 * replacement takes precedence; otherwise either predecessor match quarantines
 * the credential (an access-only change still carries the spent refresh token).
 * Unreadable or malformed metadata fails closed for that provider only.
 * Reads, listing and every other provider stay available. The check never
 * writes and never clears a record: only `pi credential-recovery codex` does.
 */

import { createHash } from "crypto";
import { lstatSync, readFileSync, type Stats } from "fs";
import { userInfo } from "os";
import { join } from "path";
import { STATE_DIR_SUFFIX } from "./auth-atomic.ts";

export const CODEX_PROVIDER_ID = "openai-codex";
export const CODEX_SOURCE_IDENTITY = "pi-auth-json/openai-codex";
const RECORD_NAME = "codex.json";
const MAX_RECORD_BYTES = 64 * 1024;
const RECORD_STATES = new Set(["dispatching", "persistence-pending", "durability-pending", "recovery-required"]);
const HEX_64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REQUIRED_KEYS = ["createdAt", "operation", "predecessor", "provider", "source", "state", "updatedAt", "version"];
const OPTIONAL_KEYS = ["reason", "replacement"];
// Keep this credential-free vocabulary aligned with pi-fence src/credentials/owner.ts.
const OWNER_REASONS = new Set([
	"store-unavailable",
	"store-invalid",
	"unsupported-layout",
	"transaction-unresolved",
	"lock-unavailable",
	"lock-compromised",
	"cancelled",
	"not-due",
	"metadata-unavailable",
	"quarantined",
	"exchange-uncertain",
	"invalid-grant",
	"rejected",
	"account-mismatch",
	"storage-failed",
	"durability-unconfirmed",
	"payload-too-large",
	"competing-writer",
	"recovery-budget-exhausted",
	"expired",
	"owner-error",
	"sentinel-lost",
]);

export type QuarantineCheck =
	| { readonly status: "clear" }
	| { readonly status: "quarantined" }
	| { readonly status: "unreadable" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The generation fingerprint pi-fence records: SHA-256 over identity, access token and refresh token, NUL-separated. */
export function codexGenerationFingerprint(access: string, refresh: string): string {
	return createHash("sha256").update(`${CODEX_SOURCE_IDENTITY}\u0000${access}\u0000${refresh}`).digest("hex");
}

/** The spent-refresh fingerprint pi-fence records: SHA-256 over identity and refresh token alone. */
export function codexRefreshFingerprint(refresh: string): string {
	return createHash("sha256").update(`${CODEX_SOURCE_IDENTITY}\u0000${refresh}`).digest("hex");
}

function inspect(path: string): Stats | "unsafe" | undefined {
	try {
		const stats = lstatSync(path);
		return stats.isSymbolicLink() || stats.uid !== userInfo().uid ? "unsafe" : stats;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : "unsafe";
	}
}

function isFingerprints(value: unknown): value is { generation: string; refresh: string } {
	return (
		isPlainObject(value) &&
		Object.keys(value).sort().join() === "generation,refresh" &&
		typeof value.generation === "string" &&
		HEX_64.test(value.generation) &&
		typeof value.refresh === "string" &&
		HEX_64.test(value.refresh)
	);
}

function isCanonicalTimestamp(value: unknown): boolean {
	if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) return false;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function checkCodexQuarantine(authPath: string, current: unknown): QuarantineCheck {
	const stateDir = `${authPath}${STATE_DIR_SUFFIX}`;
	const root = inspect(stateDir);
	if (root === undefined) return { status: "clear" };
	if (root === "unsafe" || !root.isDirectory() || (root.mode & 0o7777) !== 0o700) return { status: "unreadable" };
	const recordPath = join(stateDir, RECORD_NAME);
	const stats = inspect(recordPath);
	const staging = inspect(`${recordPath}.next`);
	if (stats === "unsafe" || staging === "unsafe" || (stats && !stats.isFile()) || (staging && !staging.isFile())) {
		return { status: "unreadable" };
	}
	if (stats === undefined) return { status: staging === undefined ? "clear" : "unreadable" };
	let bytes: Buffer;
	try {
		bytes = readFileSync(recordPath);
	} catch {
		return { status: "unreadable" };
	}
	if (bytes.length > MAX_RECORD_BYTES) return { status: "unreadable" };
	let record: unknown;
	try {
		record = JSON.parse(bytes.toString("utf8"));
	} catch {
		return { status: "unreadable" };
	}
	if (!isPlainObject(record)) return { status: "unreadable" };
	const keys = Object.keys(record);
	if (REQUIRED_KEYS.some((key) => !keys.includes(key))) return { status: "unreadable" };
	if (keys.some((key) => !REQUIRED_KEYS.includes(key) && !OPTIONAL_KEYS.includes(key)))
		return { status: "unreadable" };
	if (record.version !== 1 || record.provider !== CODEX_PROVIDER_ID || record.source !== CODEX_SOURCE_IDENTITY) {
		return { status: "unreadable" };
	}
	if (typeof record.operation !== "string" || !UUID.test(record.operation)) return { status: "unreadable" };
	if (typeof record.state !== "string" || !RECORD_STATES.has(record.state)) return { status: "unreadable" };
	if (!isCanonicalTimestamp(record.createdAt) || !isCanonicalTimestamp(record.updatedAt))
		return { status: "unreadable" };
	if (record.reason !== undefined && (typeof record.reason !== "string" || !OWNER_REASONS.has(record.reason))) {
		return { status: "unreadable" };
	}
	const { predecessor, replacement } = record;
	if (!isFingerprints(predecessor) || (replacement !== undefined && !isFingerprints(replacement))) {
		return { status: "unreadable" };
	}
	// No stored OAuth credential means nothing the record can quarantine: a login may proceed.
	if (
		!isPlainObject(current) ||
		current.type !== "oauth" ||
		typeof current.access !== "string" ||
		typeof current.refresh !== "string"
	) {
		return { status: "clear" };
	}
	const generation = codexGenerationFingerprint(current.access, current.refresh);
	const refresh = codexRefreshFingerprint(current.refresh);
	// A provider may reuse its refresh token. Only the exact recorded replacement overrides the predecessor match.
	if (replacement !== undefined && generation === replacement.generation && refresh === replacement.refresh) {
		return { status: "clear" };
	}
	const quarantined = generation === predecessor.generation || refresh === predecessor.refresh;
	return quarantined ? { status: "quarantined" } : { status: "clear" };
}

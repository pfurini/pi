import type * as Fs from "node:fs";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	CODEX_SOURCE_IDENTITY,
	checkCodexQuarantine,
	codexGenerationFingerprint,
	codexRefreshFingerprint,
} from "../src/core/auth-quarantine.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";

const denial = vi.hoisted(() => ({ path: "", code: "EPERM" }));
vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof Fs>();
	return {
		...actual,
		lstatSync: (path: string) => {
			if (path === denial.path) throw Object.assign(new Error("metadata denied"), { code: denial.code });
			return actual.lstatSync(path);
		},
	};
});

const credential = { type: "oauth" as const, access: "fixture-access", refresh: "fixture-refresh", expires: 0 };
const fingerprints = (access: string, refresh: string) => ({
	generation: codexGenerationFingerprint(access, refresh),
	refresh: codexRefreshFingerprint(refresh),
});
const validRecord = () => ({
	version: 1,
	provider: "openai-codex",
	source: CODEX_SOURCE_IDENTITY,
	operation: "11111111-2222-4333-8444-555555555555",
	state: "recovery-required",
	predecessor: fingerprints("older-access", "older-refresh"),
	createdAt: "2026-09-10T12:00:00.000Z",
	updatedAt: "2026-09-10T12:00:00.000Z",
});

describe("strict Codex recovery metadata", () => {
	let root: string;
	let authPath: string;
	let stateDir: string;
	let recordPath: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "pi-quarantine-schema-"));
		authPath = join(root, "auth.json");
		stateDir = `${authPath}.fence-state`;
		recordPath = join(stateDir, "codex.json");
		mkdirSync(stateDir, { mode: 0o700 });
		writeFileSync(
			authPath,
			JSON.stringify({ "openai-codex": credential, anthropic: { type: "api_key", key: "fixture-key" } }),
			{ mode: 0o600 },
		);
	});
	afterEach(() => {
		denial.path = "";
		rmSync(root, { recursive: true, force: true });
	});

	test.each(["createdAt", "operation", "predecessor", "provider", "source", "state", "updatedAt", "version"])(
		"rejects missing required field %s",
		(key) => {
			const record: Record<string, unknown> = validRecord();
			delete record[key];
			writeFileSync(recordPath, JSON.stringify(record));
			expect(checkCodexQuarantine(authPath, credential).status).toBe("unreadable");
		},
	);

	test.each([
		{ unexpected: true },
		{ source: "wrong-source" },
		{ provider: "claude-code" },
		{ state: "healthy" },
		{ operation: "not-a-uuid" },
		{ operation: "11111111-2222-4333-7444-555555555555" },
		{ operation: "11111111-2222-1333-8444-555555555555" },
		{ createdAt: "+010000-09-10T12:00:00.000Z" },
		{ createdAt: "yesterday" },
		{ updatedAt: "2026-09-10T12:00:00Z" },
		{ createdAt: "2026-02-30T12:00:00.000Z" },
		{ reason: "provider response containing credentials" },
		{ reason: null },
		{ predecessor: { ...fingerprints("older-access", "older-refresh"), extra: true } },
		{ predecessor: { generation: "bad", refresh: "bad" } },
		{ replacement: { generation: "bad", refresh: "bad" } },
		{ replacement: { ...fingerprints("replacement", "refresh"), extra: true } },
		{ replacement: null },
	])("rejects invalid schema %j even for a nonmatching predecessor", (patch) => {
		writeFileSync(recordPath, JSON.stringify({ ...validRecord(), ...patch }));
		expect(checkCodexQuarantine(authPath, credential).status).toBe("unreadable");
	});

	test("accepts a complete record with optional reason and replacement", () => {
		writeFileSync(
			recordPath,
			JSON.stringify({
				...validRecord(),
				reason: "exchange-uncertain",
				replacement: fingerprints("replacement", "refresh"),
			}),
		);
		expect(checkCodexQuarantine(authPath, credential).status).toBe("clear");
	});

	test.each(["EPERM", "EACCES"])(
		"metadata-only %s refuses callbacks but leaves reads and unrelated providers available",
		async (code) => {
			denial.code = code;
			for (const path of [stateDir, recordPath, `${recordPath}.next`]) {
				denial.path = path;
				const storage = AuthStorage.create(authPath);
				const callback = vi.fn(async () => credential);
				await expect(storage.modify("openai-codex", callback)).rejects.toThrow("quarantined");
				expect(callback).not.toHaveBeenCalled();
				await expect(storage.read("openai-codex")).resolves.toEqual(credential);
				await expect(storage.list()).resolves.toHaveLength(2);
				await storage.modify("anthropic", async () => ({ type: "api_key", key: "changed-fixture-key" }));
			}
		},
	);

	test("staging-only metadata fails closed", () => {
		writeFileSync(`${recordPath}.next`, JSON.stringify(validRecord()));
		expect(checkCodexQuarantine(authPath, credential).status).toBe("unreadable");
	});

	test.skipIf(process.platform === "win32")("an unsafe state root fails closed even without a record", () => {
		chmodSync(stateDir, 0o755);
		expect(checkCodexQuarantine(authPath, credential).status).toBe("unreadable");
	});

	test("a symlink state root fails closed", () => {
		rmSync(stateDir, { recursive: true });
		const target = join(root, "state-target");
		mkdirSync(target, { mode: 0o700 });
		symlinkSync(target, stateDir, "dir");
		expect(checkCodexQuarantine(authPath, credential).status).toBe("unreadable");
	});

	test("the exact recorded replacement wins over a reused predecessor refresh token", async () => {
		writeFileSync(
			recordPath,
			JSON.stringify({
				...validRecord(),
				state: "durability-pending",
				predecessor: fingerprints("older-access", credential.refresh),
				replacement: fingerprints(credential.access, credential.refresh),
			}),
		);
		expect(checkCodexQuarantine(authPath, credential).status).toBe("clear");
		const storage = AuthStorage.create(authPath);
		const callback = vi.fn(async () => undefined);
		await storage.modify("openai-codex", callback);
		expect(callback).toHaveBeenCalledOnce();
		expect(checkCodexQuarantine(authPath, { ...credential, access: "unrecorded-access" }).status).toBe("quarantined");
	});
});

import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	CANDIDATE_SUFFIX,
	commitAtomicallySync,
	LOCK_STALE_MS,
	META_STAGING_SUFFIX,
	META_SUFFIX,
	reconcileTransactionSync,
	STATE_DIR_SUFFIX,
	transactionPaths,
} from "../src/core/auth-atomic.ts";

// The synchronous half of the auth.json transaction protocol pi-fence runs
// beside this agent (pi-fence phase 5a, section 7). Same names, same
// metadata, same crash recovery table: whatever either writer leaves behind,
// the other finishes or refuses without guessing.

const hash = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");

describe("auth-atomic", () => {
	const tempDir = join(tmpdir(), `pi-test-auth-atomic-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const target = join(tempDir, "auth.json");
	const seedText = JSON.stringify({ anthropic: { type: "api_key", key: "stored-fixture-771001" } }, null, 2);
	const nextText = JSON.stringify(
		{
			anthropic: { type: "api_key", key: "stored-fixture-771001" },
			openai: { type: "api_key", key: "next-fixture-771002" },
		},
		null,
		2,
	);

	beforeEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
		mkdirSync(tempDir, { recursive: true });
		writeFileSync(target, seedText, { mode: 0o600 });
	});

	afterEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	const listing = (): string[] => readdirSync(tempDir).sort();

	function meta(predecessor: string | null, candidate: string, mode = 0o600): string {
		return JSON.stringify({
			version: 1,
			operation: randomUUID(),
			predecessor,
			candidate: hash(candidate),
			size: Buffer.byteLength(candidate),
			mode,
		});
	}

	test("pins the protocol constants pi-fence declares", () => {
		expect(CANDIDATE_SUFFIX).toBe(".atomic");
		expect(META_SUFFIX).toBe(".atomic-meta");
		expect(META_STAGING_SUFFIX).toBe(".atomic-meta.next");
		expect(STATE_DIR_SUFFIX).toBe(".fence-state");
		expect(LOCK_STALE_MS).toBe(30_000);
		expect(transactionPaths("/x/auth.json")).toEqual({
			candidate: "/x/auth.json.atomic",
			meta: "/x/auth.json.atomic-meta",
			metaStaging: "/x/auth.json.atomic-meta.next",
			stateDir: "/x/auth.json.fence-state",
		});
	});

	test("commits the exact bytes, preserves the mode, and leaves no artifact", () => {
		expect(commitAtomicallySync(target, nextText)).toEqual({ status: "committed" });
		expect(readFileSync(target, "utf8")).toBe(nextText);
		expect(statSync(target).mode & 0o7777).toBe(0o600);
		expect(listing()).toEqual(["auth.json"]);
	});

	test.skipIf(process.platform === "win32")("preserves a non-default mode through the descriptor", () => {
		chmodSync(target, 0o660);
		expect(commitAtomicallySync(target, nextText)).toEqual({ status: "committed" });
		expect(statSync(target).mode & 0o7777).toBe(0o660);
	});

	test("creates a missing store exclusively at 0600", () => {
		rmSync(target);
		expect(commitAtomicallySync(target, nextText)).toEqual({ status: "committed" });
		expect(readFileSync(target, "utf8")).toBe(nextText);
		if (process.platform !== "win32") expect(statSync(target).mode & 0o7777).toBe(0o600);
	});

	test("refuses a candidate that is not a JSON object without touching the store", () => {
		for (const bad of ["[]", "null", "{broken"]) {
			expect(commitAtomicallySync(target, bad)).toEqual({ status: "not-installed", stage: "preflight" });
			expect(readFileSync(target, "utf8")).toBe(seedText);
			expect(listing()).toEqual(["auth.json"]);
		}
	});

	test("refuses to stack a second transaction on an unresolved one", () => {
		const paths = transactionPaths(target);
		writeFileSync(paths.candidate, '{"orphan":true}', { mode: 0o600 });
		expect(commitAtomicallySync(target, nextText)).toEqual({ status: "not-installed", stage: "preflight" });
		expect(readFileSync(target, "utf8")).toBe(seedText);
		expect(readFileSync(paths.candidate, "utf8")).toBe('{"orphan":true}');
	});

	test("reconcile: clean when nothing is pending", () => {
		expect(reconcileTransactionSync(target)).toEqual({ status: "clean" });
	});

	test("reconcile: finishes a complete candidate over its recorded predecessor", () => {
		const paths = transactionPaths(target);
		writeFileSync(paths.meta, meta(hash(seedText), nextText), { mode: 0o600 });
		writeFileSync(paths.candidate, nextText, { mode: 0o600 });
		expect(reconcileTransactionSync(target)).toEqual({ status: "completed", installed: "candidate" });
		expect(readFileSync(target, "utf8")).toBe(nextText);
		expect(listing()).toEqual(["auth.json"]);
	});

	test("reconcile: finishes restoration when the store already holds the candidate, keeping its inode", () => {
		const paths = transactionPaths(target);
		writeFileSync(paths.meta, meta(hash(seedText), nextText, 0o600), { mode: 0o600 });
		writeFileSync(target, nextText, { mode: 0o600 });
		writeFileSync(paths.candidate, nextText, { mode: 0o600 });
		const inode = statSync(target).ino;
		expect(reconcileTransactionSync(target)).toEqual({ status: "completed", installed: "already" });
		expect(statSync(target).ino).toBe(inode);
		expect(readFileSync(target, "utf8")).toBe(nextText);
		expect(listing()).toEqual(["auth.json"]);
	});

	test("reconcile: removes a partial candidate and its metadata, keeping the original store", () => {
		const paths = transactionPaths(target);
		writeFileSync(paths.meta, meta(hash(seedText), nextText), { mode: 0o600 });
		writeFileSync(paths.candidate, nextText.slice(0, 12), { mode: 0o600 });
		expect(reconcileTransactionSync(target)).toEqual({ status: "clean" });
		expect(readFileSync(target, "utf8")).toBe(seedText);
		expect(listing()).toEqual(["auth.json"]);
	});

	test("reconcile: refuses a store matching neither hash, deleting nothing", () => {
		const paths = transactionPaths(target);
		writeFileSync(paths.meta, meta(hash("{}"), nextText), { mode: 0o600 });
		writeFileSync(paths.candidate, nextText, { mode: 0o600 });
		expect(reconcileTransactionSync(target)).toEqual({ status: "error", error: "conflicting-store" });
		expect(readFileSync(target, "utf8")).toBe(seedText);
		expect(listing()).toEqual(["auth.json", "auth.json.atomic", "auth.json.atomic-meta"]);
	});

	test("reconcile: refuses invalid metadata and a candidate without metadata, deleting nothing", () => {
		const paths = transactionPaths(target);
		writeFileSync(paths.meta, "not json", { mode: 0o600 });
		writeFileSync(paths.candidate, nextText, { mode: 0o600 });
		expect(reconcileTransactionSync(target)).toEqual({ status: "error", error: "invalid-metadata" });
		expect(listing()).toEqual(["auth.json", "auth.json.atomic", "auth.json.atomic-meta"]);
		rmSync(paths.meta);
		expect(reconcileTransactionSync(target)).toEqual({ status: "error", error: "unresolved-candidate" });
		expect(listing()).toEqual(["auth.json", "auth.json.atomic"]);
	});

	test.skipIf(process.platform === "win32")("reconcile: refuses a symlinked artifact", () => {
		const paths = transactionPaths(target);
		const elsewhere = join(tempDir, "elsewhere.json");
		writeFileSync(elsewhere, nextText, { mode: 0o600 });
		symlinkSync(elsewhere, paths.candidate);
		writeFileSync(paths.meta, meta(hash(seedText), nextText), { mode: 0o600 });
		expect(reconcileTransactionSync(target)).toEqual({ status: "error", error: "unsafe-artifact" });
		expect(readFileSync(target, "utf8")).toBe(seedText);
	});

	test("reconcile: removes staging that never became metadata", () => {
		const paths = transactionPaths(target);
		writeFileSync(paths.metaStaging, meta(hash(seedText), nextText), { mode: 0o600 });
		expect(reconcileTransactionSync(target)).toEqual({ status: "clean" });
		expect(listing()).toEqual(["auth.json"]);
	});
});

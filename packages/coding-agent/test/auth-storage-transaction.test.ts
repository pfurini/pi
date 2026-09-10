import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AuthStorage, FileAuthStorageBackend, InMemoryAuthStorageBackend } from "../src/core/auth-storage.ts";

describe("auth transaction callback admission", () => {
	let root: string;
	let authPath: string;
	const credential = { type: "oauth" as const, access: "fixture-access", refresh: "fixture-refresh", expires: 0 };

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "pi-auth-admission-"));
		authPath = join(root, "auth.json");
		writeFileSync(authPath, JSON.stringify({ "openai-codex": credential }), { mode: 0o600 });
		writeFileSync(`${authPath}.atomic`, '{"orphan":true}', { mode: 0o600 });
	});

	afterEach(() => rmSync(root, { recursive: true, force: true }));

	test("refuses synchronous mutation callbacks before invocation even without next", () => {
		const callback = vi.fn(() => ({ result: "spent" }));
		expect(() => new FileAuthStorageBackend(authPath).withLock(callback)).toThrow(
			"unresolved replacement transaction",
		);
		expect(callback).not.toHaveBeenCalled();
	});

	test("refuses asynchronous mutation callbacks before invocation even without next", async () => {
		const callback = vi.fn(async () => ({ result: "spent" }));
		await expect(new FileAuthStorageBackend(authPath).withLockAsync(callback)).rejects.toThrow(
			"unresolved replacement transaction",
		);
		expect(callback).not.toHaveBeenCalled();
	});

	test("refuses OAuth modification callbacks while preserving fresh reads and listing", async () => {
		const storage = AuthStorage.create(authPath);
		const callback = vi.fn(async () => credential);
		await expect(storage.modify("openai-codex", callback)).rejects.toThrow("unresolved replacement transaction");
		expect(callback).not.toHaveBeenCalled();
		await expect(storage.read("openai-codex")).resolves.toEqual(credential);
		writeFileSync(
			authPath,
			JSON.stringify({
				"openai-codex": { ...credential, access: "new-fixture-access" },
				anthropic: { type: "api_key", key: "fixture-key" },
			}),
		);
		const signal = new AbortController().signal;
		await expect(storage.read("openai-codex", { signal })).resolves.toMatchObject({ access: "new-fixture-access" });
		await expect(storage.list({ signal })).resolves.toHaveLength(2);
		storage.reload();
		await expect(storage.read("anthropic")).resolves.toEqual({ type: "api_key", key: "fixture-key" });
		expect(readFileSync(`${authPath}.atomic`, "utf8")).toBe('{"orphan":true}');
	});

	test.each(["file", "memory"] as const)("%s read-only operations reject next without persisting it", async (kind) => {
		const backend = kind === "file" ? new FileAuthStorageBackend(authPath) : new InMemoryAuthStorageBackend();
		const previous = backend.withLock((current) => ({ result: current }), { readOnly: true });
		expect(() => backend.withLock(() => ({ result: "read", next: "{}" }), { readOnly: true })).toThrow("Read-only");
		await expect(
			backend.withLockAsync(async () => ({ result: "read", next: "{}" }), { readOnly: true }),
		).rejects.toThrow("Read-only");
		expect(backend.withLock((current) => ({ result: current }), { readOnly: true })).toBe(previous);
	});
});

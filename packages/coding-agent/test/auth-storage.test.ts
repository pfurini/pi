import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CredentialStore, createModels, InMemoryModelsStore, type Provider } from "@earendil-works/pi-ai";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AuthStorage, FileAuthStorageBackend, ReadOnlyAuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

/**
 * Simulates OS-level denial of auth.json reads (pi-fence sandbox: EPERM on
 * stat and on open) for exact paths only. Every fs function passes through to
 * the real module until a denial is armed for a path.
 */
const authFileDenial = vi.hoisted(() => {
	const state = {
		paths: new Set<string>(),
		readDenied: false,
		statDenied: false,
		existsDenied: false,
		code: "EPERM",
		writes: [] as string[],
	};
	const isDenied = (candidate: unknown): boolean => typeof candidate === "string" && state.paths.has(candidate);
	const deniedError = (operation: string, path: string): Error =>
		Object.assign(new Error(`${state.code}: operation not permitted, ${operation} '${path}'`), {
			code: state.code,
		});
	const build = <T extends Record<string, unknown>>(actual: T) => {
		const mocked = {
			...actual,
			existsSync: (path: unknown): boolean => {
				if (isDenied(path) && state.existsDenied) return false;
				return (actual.existsSync as (candidate: unknown) => boolean)(path);
			},
			readFileSync: (path: unknown, options?: unknown): unknown => {
				if (isDenied(path) && state.readDenied) throw deniedError("open", String(path));
				return (actual.readFileSync as (candidate: unknown, options?: unknown) => unknown)(path, options);
			},
			statSync: (path: unknown, options?: unknown): unknown => {
				if (isDenied(path) && state.statDenied) throw deniedError("stat", String(path));
				return (actual.statSync as (candidate: unknown, options?: unknown) => unknown)(path, options);
			},
			writeFileSync: (path: unknown, data: unknown, options?: unknown): void => {
				if (isDenied(path)) state.writes.push(String(path));
				(actual.writeFileSync as (candidate: unknown, data: unknown, options?: unknown) => void)(
					path,
					data,
					options,
				);
			},
		};
		return { ...mocked, default: mocked };
	};
	return { state, build };
});

vi.mock("fs", async (importOriginal) => authFileDenial.build(await importOriginal<Record<string, unknown>>()));
vi.mock("node:fs", async (importOriginal) => authFileDenial.build(await importOriginal<Record<string, unknown>>()));

describe("AuthStorage", () => {
	const tempDir = join(tmpdir(), `pi-test-auth-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const authJsonPath = join(tempDir, "auth.json");

	beforeEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
		vi.restoreAllMocks();
	});

	function writeAuthJson(data: Record<string, unknown>): void {
		writeFileSync(authJsonPath, JSON.stringify(data));
	}

	test("reads and resolves stored API-key credentials", async () => {
		const original = process.env.TEST_AUTH_STORAGE_KEY;
		process.env.TEST_AUTH_STORAGE_KEY = "environment-key";
		try {
			writeAuthJson({ anthropic: { type: "api_key", key: "$TEST_AUTH_STORAGE_KEY" } });
			const storage = AuthStorage.create(authJsonPath);
			expect(await storage.read("anthropic")).toEqual({ type: "api_key", key: "environment-key" });
		} finally {
			if (original === undefined) delete process.env.TEST_AUTH_STORAGE_KEY;
			else process.env.TEST_AUTH_STORAGE_KEY = original;
		}
	});

	test("resolves command-backed API-key credentials", async () => {
		writeAuthJson({ anthropic: { type: "api_key", key: "!printf 'command-key'" } });
		const storage = AuthStorage.create(authJsonPath);
		expect(await storage.read("anthropic")).toEqual({ type: "api_key", key: "command-key" });
	});

	test("returns OAuth credentials unchanged", async () => {
		const credential = {
			type: "oauth" as const,
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
		};
		const storage = AuthStorage.inMemory({ anthropic: credential });
		expect(await storage.read("anthropic")).toEqual(credential);
	});

	test("credential-scoped env takes precedence and remains inspectable", async () => {
		writeAuthJson({
			anthropic: {
				type: "api_key",
				key: "$SCOPED_KEY",
				env: { SCOPED_KEY: "scoped-value", REGION: "test-region" },
			},
		});
		const storage = AuthStorage.create(authJsonPath);
		expect(await storage.read("anthropic")).toMatchObject({
			key: "scoped-value",
			env: { SCOPED_KEY: "scoped-value", REGION: "test-region" },
		});
	});

	test("coalesces file reloads across concurrent readers and storage instances", async () => {
		writeAuthJson({ anthropic: { type: "api_key", key: "old" } });
		const first = AuthStorage.create(authJsonPath);
		const second = AuthStorage.create(authJsonPath);
		const lockSpy = vi.spyOn(lockfile, "lock");

		writeAuthJson({
			anthropic: { type: "api_key", key: "new" },
			openai: { type: "api_key", key: "openai-key" },
		});

		const [anthropic, openai, credentials] = await Promise.all([
			first.read("anthropic", { signal: new AbortController().signal }),
			second.read("openai", { signal: new AbortController().signal }),
			first.list({ signal: new AbortController().signal }),
		]);
		expect(anthropic).toEqual({ type: "api_key", key: "new" });
		expect(openai).toEqual({ type: "api_key", key: "openai-key" });
		expect(credentials).toEqual([
			{ providerId: "anthropic", type: "api_key" },
			{ providerId: "openai", type: "api_key" },
		]);
		expect(lockSpy).toHaveBeenCalledTimes(1);

		await expect(second.read("anthropic")).resolves.toEqual({ type: "api_key", key: "new" });
		expect(lockSpy).toHaveBeenCalledTimes(1);

		const otherPath = join(tempDir, "other-auth.json");
		writeFileSync(otherPath, JSON.stringify({ other: { type: "api_key", key: "other-key" } }));
		const otherFirst = AuthStorage.create(otherPath);
		const otherSecond = AuthStorage.create(otherPath);
		await otherFirst.read("other");
		await otherSecond.read("other");
		await otherFirst.list();
		expect(lockSpy).toHaveBeenCalledTimes(1);

		const third = AuthStorage.create(authJsonPath);
		writeAuthJson({ anthropic: { type: "api_key", key: "newest" } });
		const [firstReload, thirdReload] = await Promise.all([first.read("anthropic"), third.read("anthropic")]);
		expect(firstReload).toEqual({ type: "api_key", key: "newest" });
		expect(thirdReload).toEqual({ type: "api_key", key: "newest" });
		expect(lockSpy).toHaveBeenCalledTimes(2);
	});

	test("keeps a coalesced reload alive while another credential reader is waiting", async () => {
		writeAuthJson({ anthropic: { type: "api_key", key: "old" } });
		const storage = AuthStorage.create(authJsonPath);
		writeAuthJson({ anthropic: { type: "api_key", key: "new" } });
		let grantLock: (() => void) | undefined;
		const lockGranted = new Promise<void>((resolve) => {
			grantLock = resolve;
		});
		const release = vi.fn(async () => {});
		const lockSpy = vi.spyOn(lockfile, "lock").mockImplementation(async () => {
			await lockGranted;
			return release;
		});
		const firstController = new AbortController();
		const secondController = new AbortController();
		const first = storage.read("anthropic", { signal: firstController.signal });
		const second = storage.read("anthropic", { signal: secondController.signal });

		firstController.abort();
		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		grantLock?.();
		await expect(second).resolves.toEqual({ type: "api_key", key: "new" });
		expect(lockSpy).toHaveBeenCalledTimes(1);
		expect(release).toHaveBeenCalledTimes(1);
	});

	test.skipIf(process.platform === "win32")("creates new auth files with owner-only permissions", () => {
		AuthStorage.create(authJsonPath);

		expect(statSync(authJsonPath).mode & 0o777).toBe(0o600);
	});

	test.skipIf(process.platform === "win32")("preserves the mode of an existing auth file", async () => {
		writeAuthJson({ anthropic: { type: "api_key", key: "old" } });
		chmodSync(authJsonPath, 0o660);
		const storage = AuthStorage.create(authJsonPath);

		await storage.modify("anthropic", async () => ({ type: "api_key", key: "new" }));

		expect(statSync(authJsonPath).mode & 0o777).toBe(0o660);
	});

	test("modify persists a credential while preserving unrelated external edits", async () => {
		writeAuthJson({ anthropic: { type: "api_key", key: "old" } });
		const storage = AuthStorage.create(authJsonPath);
		writeAuthJson({
			anthropic: { type: "api_key", key: "old" },
			openai: { type: "api_key", key: "external" },
		});

		await storage.modify("anthropic", async () => ({ type: "api_key", key: "new" }));

		expect(JSON.parse(readFileSync(authJsonPath, "utf8"))).toEqual({
			anthropic: { type: "api_key", key: "new" },
			openai: { type: "api_key", key: "external" },
		});
	});

	test("modify with undefined leaves the current credential unchanged", async () => {
		writeAuthJson({ anthropic: { type: "api_key", key: "stored" } });
		const storage = AuthStorage.create(authJsonPath);
		expect(await storage.modify("anthropic", async () => undefined)).toEqual({ type: "api_key", key: "stored" });
		expect(await storage.read("anthropic")).toEqual({ type: "api_key", key: "stored" });
	});

	test("serializes concurrent modifications", async () => {
		writeAuthJson({});
		const first = AuthStorage.create(authJsonPath);
		const second = AuthStorage.create(authJsonPath);
		await Promise.all([
			first.modify("anthropic", async () => ({ type: "api_key", key: "anthropic-key" })),
			second.modify("openai", async () => ({ type: "api_key", key: "openai-key" })),
		]);
		expect(JSON.parse(readFileSync(authJsonPath, "utf8"))).toEqual({
			anthropic: { type: "api_key", key: "anthropic-key" },
			openai: { type: "api_key", key: "openai-key" },
		});
	});

	test("delete removes one credential while preserving others", async () => {
		writeAuthJson({
			anthropic: { type: "api_key", key: "anthropic-key" },
			openai: { type: "api_key", key: "openai-key" },
		});
		const storage = AuthStorage.create(authJsonPath);
		writeAuthJson({
			anthropic: { type: "api_key", key: "anthropic-key" },
			openai: { type: "api_key", key: "openai-key" },
			google: { type: "api_key", key: "external-key" },
		});
		await storage.delete("anthropic");
		await expect(storage.list()).resolves.toEqual([
			{ providerId: "openai", type: "api_key" },
			{ providerId: "google", type: "api_key" },
		]);
		expect(await storage.read("anthropic")).toBeUndefined();
		expect(await storage.read("openai")).toEqual({ type: "api_key", key: "openai-key" });
		expect(await storage.read("google")).toEqual({ type: "api_key", key: "external-key" });
	});

	test("in-memory storage implements the same credential-store behavior", async () => {
		const storage = AuthStorage.inMemory({ anthropic: { type: "api_key", key: "initial" } });
		expect(await storage.read("anthropic")).toEqual({ type: "api_key", key: "initial" });
		await storage.modify("anthropic", async () => ({ type: "api_key", key: "updated" }));
		expect(await storage.read("anthropic")).toEqual({ type: "api_key", key: "updated" });
		await storage.delete("anthropic");
		await expect(storage.list()).resolves.toEqual([]);
	});

	test("does not write after lock acquisition failure and recovers on retry", async () => {
		writeAuthJson({ anthropic: { type: "api_key", key: "stored" } });
		const storage = AuthStorage.create(authJsonPath);
		const lockSpy = vi.spyOn(lockfile, "lock").mockRejectedValueOnce(new Error("lock unavailable"));

		await expect(storage.modify("openai", async () => ({ type: "api_key", key: "new" }))).rejects.toThrow(
			"lock unavailable",
		);
		expect(JSON.parse(readFileSync(authJsonPath, "utf8"))).toEqual({
			anthropic: { type: "api_key", key: "stored" },
		});

		lockSpy.mockRestore();
		await storage.modify("openai", async () => ({ type: "api_key", key: "new" }));
		expect(JSON.parse(readFileSync(authJsonPath, "utf8"))).toEqual({
			anthropic: { type: "api_key", key: "stored" },
			openai: { type: "api_key", key: "new" },
		});
	});

	test("retries a briefly contended file lock", async () => {
		writeAuthJson({ anthropic: { type: "api_key", key: "stored" } });
		const backend = new FileAuthStorageBackend(authJsonPath);
		const release = vi.fn(async () => {});
		const lockSpy = vi
			.spyOn(lockfile, "lock")
			.mockRejectedValueOnce(Object.assign(new Error("locked"), { code: "ELOCKED" }))
			.mockResolvedValueOnce(release);
		vi.spyOn(Math, "random").mockReturnValue(0);
		const update = vi.fn(async () => ({ result: undefined }));

		await backend.withLockAsync(update);

		expect(lockSpy).toHaveBeenCalledTimes(2);
		expect(update).toHaveBeenCalledTimes(1);
		expect(release).toHaveBeenCalledTimes(1);
	});

	test("surfaces a compromised file storage lock", async () => {
		writeAuthJson({ anthropic: { type: "api_key", key: "stored" } });
		const backend = new FileAuthStorageBackend(authJsonPath);
		const update = vi.fn(async () => ({ result: undefined, next: JSON.stringify({}) }));
		const compromised = new Error("lock compromised");
		vi.spyOn(lockfile, "lock").mockImplementation(async (_file, options) => {
			options?.onCompromised?.(compromised);
			return async () => {};
		});

		await expect(backend.withLockAsync(update)).rejects.toThrow(compromised);
		expect(update).not.toHaveBeenCalled();
		expect(JSON.parse(readFileSync(authJsonPath, "utf8"))).toEqual({
			anthropic: { type: "api_key", key: "stored" },
		});
	});

	test("pre-aborted file operations do not create the backing file or run the mutation", async () => {
		const backend = new FileAuthStorageBackend(authJsonPath);
		const controller = new AbortController();
		controller.abort();
		const update = vi.fn(async () => ({ result: undefined, next: JSON.stringify({}) }));

		await expect(backend.withLockAsync(update, { signal: controller.signal })).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(update).not.toHaveBeenCalled();
		expect(existsSync(authJsonPath)).toBe(false);
	});

	test("aborts while waiting for a held file lock without running the mutation later", async () => {
		writeAuthJson({ anthropic: { type: "api_key", key: "stored" } });
		const release = await lockfile.lock(authJsonPath, { realpath: false });
		const backend = new FileAuthStorageBackend(authJsonPath);
		const controller = new AbortController();
		const update = vi.fn(async () => ({ result: undefined, next: JSON.stringify({}) }));
		const pending = backend.withLockAsync(update, { signal: controller.signal });

		await new Promise((resolve) => setTimeout(resolve, 10));
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(update).not.toHaveBeenCalled();

		await release();
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(update).not.toHaveBeenCalled();
		expect(JSON.parse(readFileSync(authJsonPath, "utf8"))).toEqual({
			anthropic: { type: "api_key", key: "stored" },
		});
	});

	test("releases a file lock acquired concurrently with cancellation before mutation", async () => {
		writeAuthJson({ anthropic: { type: "api_key", key: "stored" } });
		const backend = new FileAuthStorageBackend(authJsonPath);
		const controller = new AbortController();
		const release = vi.fn(async () => {});
		vi.spyOn(lockfile, "lock").mockImplementation(async () => {
			controller.abort();
			return release;
		});
		const update = vi.fn(async () => ({ result: undefined, next: JSON.stringify({}) }));

		await expect(backend.withLockAsync(update, { signal: controller.signal })).rejects.toMatchObject({
			name: "AbortError",
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(update).not.toHaveBeenCalled();
		expect(release).toHaveBeenCalledTimes(1);
	});

	test("holds the file lock until a cancelled active callback settles without committing it", async () => {
		writeAuthJson({ anthropic: { type: "api_key", key: "stored" } });
		const backend = new FileAuthStorageBackend(authJsonPath);
		const controller = new AbortController();
		let markStarted: (() => void) | undefined;
		let finish: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const blocked = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const pending = backend.withLockAsync(
			async () => {
				markStarted?.();
				await blocked;
				return { result: undefined, next: JSON.stringify({ openai: { type: "api_key", key: "cancelled" } }) };
			},
			{ signal: controller.signal },
		);

		await started;
		controller.abort();
		const competingMutation = vi.fn(async () => ({
			result: undefined,
			next: JSON.stringify({ google: { type: "api_key", key: "committed" } }),
		}));
		const competing = backend.withLockAsync(competingMutation);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(competingMutation).not.toHaveBeenCalled();

		finish?.();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		await competing;
		expect(competingMutation).toHaveBeenCalledTimes(1);
		expect(JSON.parse(readFileSync(authJsonPath, "utf8"))).toEqual({
			google: { type: "api_key", key: "committed" },
		});
	});

	test("cancels a signalled credential read waiting for a held file lock", async () => {
		writeAuthJson({ anthropic: { type: "api_key", key: "old" } });
		const storage = AuthStorage.create(authJsonPath);
		writeAuthJson({ anthropic: { type: "api_key", key: "new-value" } });
		const release = await lockfile.lock(authJsonPath, { realpath: false });
		const lockSpy = vi.spyOn(lockfile, "lock");
		const controller = new AbortController();
		const pending = storage.read("anthropic", { signal: controller.signal });

		await new Promise((resolve) => setTimeout(resolve, 10));
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		await release();
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(lockSpy).toHaveBeenCalledTimes(1);
		await expect(storage.read("anthropic")).resolves.toEqual({ type: "api_key", key: "new-value" });
	});

	test("serializes in-memory mutations across providers", async () => {
		const storage = AuthStorage.inMemory();
		let markStarted: (() => void) | undefined;
		let finish: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const blocked = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const first = storage.modify("anthropic", async () => {
			markStarted?.();
			await blocked;
			return { type: "api_key", key: "anthropic-key" };
		});
		await started;
		const secondMutation = vi.fn(async () => ({ type: "api_key" as const, key: "openai-key" }));
		const second = storage.modify("openai", secondMutation);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(secondMutation).not.toHaveBeenCalled();

		finish?.();
		await Promise.all([first, second]);
		expect(await storage.read("anthropic")).toEqual({ type: "api_key", key: "anthropic-key" });
		expect(await storage.read("openai")).toEqual({ type: "api_key", key: "openai-key" });
	});

	test("cancels a queued in-memory mutation without running it later", async () => {
		const storage = AuthStorage.inMemory();
		let markStarted: (() => void) | undefined;
		let finish: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const blocked = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const first = storage.modify("anthropic", async () => {
			markStarted?.();
			await blocked;
			return { type: "api_key", key: "anthropic-key" };
		});
		await started;
		const controller = new AbortController();
		const secondMutation = vi.fn(async () => ({ type: "api_key" as const, key: "openai-key" }));
		const second = storage.modify("openai", secondMutation, { signal: controller.signal });

		controller.abort();
		await expect(second).rejects.toMatchObject({ name: "AbortError" });
		expect(secondMutation).not.toHaveBeenCalled();
		finish?.();
		await first;
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(secondMutation).not.toHaveBeenCalled();
		expect(await storage.read("openai")).toBeUndefined();
	});

	test("preserves the stored credential after cancelling an active refresh mutation", async () => {
		const previous = {
			type: "oauth" as const,
			access: "expired",
			refresh: "refresh-token",
			expires: 0,
		};
		const storage = AuthStorage.inMemory({ oauth: previous });
		const controller = new AbortController();
		let markStarted: (() => void) | undefined;
		let finish: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const blocked = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const pending = storage.modify(
			"oauth",
			async () => {
				markStarted?.();
				await blocked;
				return { ...previous, access: "refreshed", expires: Date.now() + 60_000 };
			},
			{ signal: controller.signal },
		);

		await started;
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		const competingMutation = vi.fn(async () => ({ type: "api_key" as const, key: "other" }));
		const competing = storage.modify("other", competingMutation);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(competingMutation).not.toHaveBeenCalled();

		finish?.();
		await competing;
		expect(competingMutation).toHaveBeenCalledTimes(1);
		expect(await storage.read("oauth")).toEqual(previous);
	});

	test("translates a credential-store refresh failure and allows a later retry", async () => {
		const providerId = "oauth-provider";
		const base = AuthStorage.inMemory({
			[providerId]: {
				type: "oauth",
				access: "expired-access",
				refresh: "refresh-token",
				expires: 0,
			},
		});
		let failNextModify = true;
		const credentials: CredentialStore = {
			read: (id) => base.read(id),
			list: () => base.list(),
			modify: (id, fn) => {
				if (failNextModify) {
					failNextModify = false;
					return Promise.reject(new Error("credential store unavailable"));
				}
				return base.modify(id, fn);
			},
			delete: (id) => base.delete(id),
		};
		const provider: Provider = {
			id: providerId,
			name: "OAuth Provider",
			auth: {
				oauth: {
					name: "OAuth",
					login: async () => {
						throw new Error("not used");
					},
					refresh: async (credential) => ({
						...credential,
						access: "refreshed-access",
						expires: Date.now() + 60_000,
					}),
					toAuth: async (credential) => ({ apiKey: credential.access }),
				},
			},
			getModels: () => [],
			stream: () => {
				throw new Error("not used");
			},
			streamSimple: () => {
				throw new Error("not used");
			},
		};
		const models = createModels({ credentials });
		models.setProvider(provider);

		await expect(models.getAuth(providerId)).rejects.toMatchObject({ code: "auth" });
		await expect(models.getAuth(providerId)).resolves.toMatchObject({ auth: { apiKey: "refreshed-access" } });
	});

	test("does not overwrite malformed auth files", async () => {
		writeAuthJson({ anthropic: { type: "api_key", key: "stored" } });
		const storage = AuthStorage.create(authJsonPath);
		writeFileSync(authJsonPath, "{invalid-json", "utf8");
		await expect(storage.modify("openai", async () => ({ type: "api_key", key: "new" }))).rejects.toThrow();
		expect(readFileSync(authJsonPath, "utf8")).toBe("{invalid-json");
	});
});

describe("atomic persistence (pi-fence phase 5a protocol)", () => {
	const tempDir = join(tmpdir(), `pi-test-auth-atomic-backend-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const authJsonPath = join(tempDir, "auth.json");

	beforeEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
		vi.restoreAllMocks();
	});

	const listing = (): string[] => readdirSync(tempDir).sort();

	test("withLock replaces the store by rename, leaving no artifact and preserving the mode", () => {
		writeFileSync(authJsonPath, JSON.stringify({ anthropic: { type: "api_key", key: "old" } }, null, 2), {
			mode: 0o600,
		});
		const inode = statSync(authJsonPath).ino;
		const backend = new FileAuthStorageBackend(authJsonPath);
		backend.withLock(() => ({
			result: undefined,
			next: JSON.stringify({ anthropic: { type: "api_key", key: "new" } }, null, 2),
		}));
		expect(JSON.parse(readFileSync(authJsonPath, "utf8"))).toEqual({ anthropic: { type: "api_key", key: "new" } });
		expect(statSync(authJsonPath).ino).not.toBe(inode);
		if (process.platform !== "win32") expect(statSync(authJsonPath).mode & 0o7777).toBe(0o600);
		expect(listing()).toEqual(["auth.json"]);
	});

	test("withLockAsync replaces the store by rename too", async () => {
		writeFileSync(authJsonPath, JSON.stringify({ anthropic: { type: "api_key", key: "old" } }, null, 2), {
			mode: 0o600,
		});
		const inode = statSync(authJsonPath).ino;
		const backend = new FileAuthStorageBackend(authJsonPath);
		await backend.withLockAsync(async () => ({
			result: undefined,
			next: JSON.stringify({ anthropic: { type: "api_key", key: "new" } }, null, 2),
		}));
		expect(JSON.parse(readFileSync(authJsonPath, "utf8"))).toEqual({ anthropic: { type: "api_key", key: "new" } });
		expect(statSync(authJsonPath).ino).not.toBe(inode);
		expect(listing()).toEqual(["auth.json"]);
	});

	test("a complete candidate left by a crashed writer is finished before the mutation reads its base", async () => {
		const seed = JSON.stringify({ anthropic: { type: "api_key", key: "old" } }, null, 2);
		const next = JSON.stringify({ anthropic: { type: "api_key", key: "crashed-writer" } }, null, 2);
		writeFileSync(authJsonPath, seed, { mode: 0o600 });
		const digest = (text: string) => createHash("sha256").update(text).digest("hex");
		writeFileSync(
			`${authJsonPath}.atomic-meta`,
			JSON.stringify({
				version: 1,
				operation: "op-772001",
				predecessor: digest(seed),
				candidate: digest(next),
				size: Buffer.byteLength(next),
				mode: 0o600,
			}),
			{ mode: 0o600 },
		);
		writeFileSync(`${authJsonPath}.atomic`, next, { mode: 0o600 });
		const storage = AuthStorage.create(authJsonPath);
		let seen: unknown;
		await storage.modify("openai", async () => {
			seen = JSON.parse(readFileSync(authJsonPath, "utf8"));
			return { type: "api_key", key: "added" };
		});
		expect(seen).toEqual({ anthropic: { type: "api_key", key: "crashed-writer" } });
		expect(JSON.parse(readFileSync(authJsonPath, "utf8"))).toEqual({
			anthropic: { type: "api_key", key: "crashed-writer" },
			openai: { type: "api_key", key: "added" },
		});
		expect(listing()).toEqual(["auth.json"]);
	});

	test("an unresolved candidate refuses credential changes but not reads", async () => {
		const seed = JSON.stringify({ anthropic: { type: "api_key", key: "stored" } }, null, 2);
		writeFileSync(authJsonPath, seed, { mode: 0o600 });
		writeFileSync(`${authJsonPath}.atomic`, '{"orphan":true}', { mode: 0o600 });
		const storage = AuthStorage.create(authJsonPath);
		await expect(storage.read("anthropic")).resolves.toEqual({ type: "api_key", key: "stored" });
		await expect(storage.list()).resolves.toEqual([{ providerId: "anthropic", type: "api_key" }]);
		await expect(storage.modify("openai", async () => ({ type: "api_key", key: "new" }))).rejects.toThrow(
			"unresolved replacement transaction",
		);
		expect(readFileSync(authJsonPath, "utf8")).toBe(seed);
		expect(readFileSync(`${authJsonPath}.atomic`, "utf8")).toBe('{"orphan":true}');
	});

	test("creates a missing store exclusively: a stat that misses an existing file never truncates it", () => {
		writeFileSync(authJsonPath, JSON.stringify({ anthropic: { type: "api_key", key: "winner" } }), { mode: 0o600 });
		// The race of two first-time writers: this process's existence check
		// missed the file the other process just created.
		authFileDenial.state.paths.add(authJsonPath);
		authFileDenial.state.statDenied = true;
		authFileDenial.state.code = "ENOENT";
		try {
			const backend = new FileAuthStorageBackend(authJsonPath);
			expect(backend.withLock((current) => ({ result: current }))).toBe(
				JSON.stringify({ anthropic: { type: "api_key", key: "winner" } }),
			);
		} finally {
			authFileDenial.state.paths.clear();
			authFileDenial.state.statDenied = false;
			authFileDenial.state.code = "EPERM";
		}
		expect(JSON.parse(readFileSync(authJsonPath, "utf8"))).toEqual({ anthropic: { type: "api_key", key: "winner" } });
	});

	test.skipIf(process.platform === "win32")(
		"the synchronous lock honors the 30-second stale window of the asynchronous one",
		() => {
			writeFileSync(authJsonPath, JSON.stringify({ anthropic: { type: "api_key", key: "stored" } }, null, 2), {
				mode: 0o600,
			});
			const lockDir = `${authJsonPath}.lock`;
			mkdirSync(lockDir);
			// A live holder refreshes its lock every 15 s, so a 15-second-old lock is held.
			const fifteenSecondsAgo = (Date.now() - 15_000) / 1000;
			utimesSync(lockDir, fifteenSecondsAgo, fifteenSecondsAgo);
			const backend = new FileAuthStorageBackend(authJsonPath);
			expect(() => backend.withLock(() => ({ result: undefined, next: "{}" }))).toThrow(
				/ELOCKED|already being held/,
			);
			expect(JSON.parse(readFileSync(authJsonPath, "utf8"))).toEqual({
				anthropic: { type: "api_key", key: "stored" },
			});
			const fortySecondsAgo = (Date.now() - 40_000) / 1000;
			utimesSync(lockDir, fortySecondsAgo, fortySecondsAgo);
			expect(backend.withLock(() => ({ result: "reclaimed" }))).toBe("reclaimed");
		},
	);
});

describe("pi-fence recovery quarantine (phase 5a, section 8.3)", () => {
	const tempDir = join(tmpdir(), `pi-test-auth-quarantine-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const authJsonPath = join(tempDir, "auth.json");
	const stateDir = join(tempDir, "auth.json.fence-state");
	const recordPath = join(stateDir, "codex.json");
	const IDENTITY = "pi-auth-json/openai-codex";
	const codex = {
		type: "oauth" as const,
		access: "access-fixture-quarantine-773001",
		refresh: "refresh-fixture-quarantine-773002",
		expires: 1,
		accountId: "acct-773003",
	};
	const digest = (text: string) => createHash("sha256").update(text).digest("hex");
	const fingerprints = (access: string, refresh: string) => ({
		generation: digest(`${IDENTITY}\u0000${access}\u0000${refresh}`),
		refresh: digest(`${IDENTITY}\u0000${refresh}`),
	});
	const record = (predecessor: { generation: string; refresh: string }, state = "dispatching") =>
		JSON.stringify({
			version: 1,
			provider: "openai-codex",
			source: IDENTITY,
			operation: "11111111-2222-4333-8444-555555555555",
			state,
			predecessor,
			createdAt: "2026-09-10T12:00:00.000Z",
			updatedAt: "2026-09-10T12:00:00.000Z",
		});

	beforeEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
		mkdirSync(stateDir, { recursive: true, mode: 0o700 });
		writeFileSync(
			authJsonPath,
			JSON.stringify({ "openai-codex": codex, anthropic: { type: "api_key", key: "stored" } }, null, 2),
			{ mode: 0o600 },
		);
	});

	afterEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	test("a matching predecessor record blocks the openai-codex mutation before its callback runs, and blocks deletion", async () => {
		writeFileSync(recordPath, record(fingerprints(codex.access, codex.refresh)), { mode: 0o600 });
		const storage = AuthStorage.create(authJsonPath);
		const callback = vi.fn(async () => ({ ...codex, access: "spent-fixture-773005" }));
		await expect(storage.modify("openai-codex", callback)).rejects.toThrow("quarantined");
		expect(callback).not.toHaveBeenCalled();
		await expect(storage.delete("openai-codex")).rejects.toThrow("quarantined");
		expect(JSON.parse(readFileSync(authJsonPath, "utf8"))["openai-codex"]).toEqual(codex);
	});

	test("unrelated providers and read-only access stay available under quarantine", async () => {
		writeFileSync(recordPath, record(fingerprints(codex.access, codex.refresh), "recovery-required"), {
			mode: 0o600,
		});
		const storage = AuthStorage.create(authJsonPath);
		await expect(storage.read("openai-codex")).resolves.toEqual(codex);
		await expect(storage.list()).resolves.toEqual([
			{ providerId: "openai-codex", type: "oauth" },
			{ providerId: "anthropic", type: "api_key" },
		]);
		await storage.modify("anthropic", async () => ({ type: "api_key", key: "changed" }));
		expect(JSON.parse(readFileSync(authJsonPath, "utf8")).anthropic).toEqual({ type: "api_key", key: "changed" });
	});

	test("an access-only change that still carries the spent refresh token stays quarantined (section 8.2)", async () => {
		writeFileSync(recordPath, record(fingerprints(codex.access, codex.refresh)), { mode: 0o600 });
		writeFileSync(
			authJsonPath,
			JSON.stringify({ "openai-codex": { ...codex, access: "access-only-change-773010" } }, null, 2),
			{ mode: 0o600 },
		);
		const storage = AuthStorage.create(authJsonPath);
		const callback = vi.fn(async () => ({ ...codex, access: "spent-again-773011" }));
		await expect(storage.modify("openai-codex", callback)).rejects.toThrow("quarantined");
		expect(callback).not.toHaveBeenCalled();
	});

	test("a record whose predecessor no longer matches the stored credential does not block", async () => {
		writeFileSync(recordPath, record(fingerprints("older-access-773006", "older-refresh-773007")), { mode: 0o600 });
		const storage = AuthStorage.create(authJsonPath);
		await storage.modify("openai-codex", async () => ({ ...codex, access: "rotated-fixture-773008" }));
		expect(JSON.parse(readFileSync(authJsonPath, "utf8"))["openai-codex"].access).toBe("rotated-fixture-773008");
	});

	test("malformed or unreadable recovery metadata fails closed for the openai-codex mutation only", async () => {
		writeFileSync(recordPath, "not json", { mode: 0o600 });
		const storage = AuthStorage.create(authJsonPath);
		const callback = vi.fn(async () => codex);
		await expect(storage.modify("openai-codex", callback)).rejects.toThrow("quarantined");
		expect(callback).not.toHaveBeenCalled();
		await storage.modify("anthropic", async () => ({ type: "api_key", key: "still-fine" }));
	});

	test("no record means no quarantine", async () => {
		const storage = AuthStorage.create(authJsonPath);
		await storage.modify("openai-codex", async () => ({ ...codex, access: "rotated-fixture-773009" }));
		expect(JSON.parse(readFileSync(authJsonPath, "utf8"))["openai-codex"].access).toBe("rotated-fixture-773009");
	});
});

describe("denied auth.json", () => {
	const tempDir = join(tmpdir(), `pi-test-auth-storage-denied-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const authJsonPath = join(tempDir, "auth.json");
	const storedFixture = JSON.stringify({ anthropic: { type: "api_key", key: "stored" } }, null, 2);

	interface AuthFileSnapshot {
		bytes: string;
		mode: number;
	}

	beforeEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
		mkdirSync(tempDir, { recursive: true });
		writeFileSync(authJsonPath, storedFixture, { mode: 0o600 });
	});

	afterEach(() => {
		resetAuthFileDenial();
		if (process.platform !== "win32" && existsSync(authJsonPath)) {
			try {
				chmodSync(authJsonPath, 0o600);
			} catch {
				// Removal only needs directory permissions.
			}
		}
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
		vi.restoreAllMocks();
	});

	function resetAuthFileDenial(): void {
		authFileDenial.state.paths.clear();
		authFileDenial.state.readDenied = false;
		authFileDenial.state.statDenied = false;
		authFileDenial.state.existsDenied = false;
		authFileDenial.state.code = "EPERM";
		authFileDenial.state.writes.length = 0;
	}

	function denyAuthFileRead(code: string, options: { read?: boolean; stat?: boolean; exists?: boolean } = {}): void {
		resetAuthFileDenial();
		authFileDenial.state.code = code;
		authFileDenial.state.paths.add(authJsonPath);
		authFileDenial.state.readDenied = options.read ?? true;
		authFileDenial.state.statDenied = options.stat ?? false;
		authFileDenial.state.existsDenied = options.exists ?? false;
	}

	function snapshotAuthFile(): AuthFileSnapshot {
		return { bytes: readFileSync(authJsonPath, "utf-8"), mode: statSync(authJsonPath).mode };
	}

	function expectAuthFileUnchanged(snapshot: AuthFileSnapshot): void {
		expect(readFileSync(authJsonPath, "utf-8")).toBe(snapshot.bytes);
		if (process.platform !== "win32") {
			expect(statSync(authJsonPath).mode & 0o777).toBe(snapshot.mode & 0o777);
		}
	}

	function expectNoAuthFileWrites(): void {
		expect(authFileDenial.state.writes).toEqual([]);
	}

	test("still creates {} on the first locked operation when auth.json is missing", () => {
		rmSync(authJsonPath);
		const backend = new FileAuthStorageBackend(authJsonPath);

		expect(backend.withLock(() => ({ result: "ok" }))).toBe("ok");

		expect(readFileSync(authJsonPath, "utf-8")).toBe("{}");
		if (process.platform !== "win32") {
			expect(statSync(authJsonPath).mode & 0o777).toBe(0o600);
		}
	});

	test("leaves a stat-denied auth.json untouched instead of recreating it", () => {
		const snapshot = snapshotAuthFile();
		denyAuthFileRead("EPERM", { stat: true, exists: true });
		const backend = new FileAuthStorageBackend(authJsonPath);

		expect(backend.withLock(() => ({ result: "ok" }), { readOnly: true })).toBe("ok");

		expectNoAuthFileWrites();
		resetAuthFileDenial();
		expectAuthFileUnchanged(snapshot);
	});

	test("still throws when checking auth.json fails for another reason", () => {
		const snapshot = snapshotAuthFile();
		denyAuthFileRead("EIO", { stat: true, exists: true });
		const backend = new FileAuthStorageBackend(authJsonPath);

		expect(() => backend.withLock(() => ({ result: "ok" }))).toThrow();

		expectNoAuthFileWrites();
		resetAuthFileDenial();
		expectAuthFileUnchanged(snapshot);
	});

	test("withLock treats a read-denied auth.json as empty for read-only operations", () => {
		denyAuthFileRead("EPERM");
		const backend = new FileAuthStorageBackend(authJsonPath);
		let observed: string | undefined = "sentinel";

		expect(
			backend.withLock(
				(current) => {
					observed = current;
					return { result: "ok" };
				},
				{ readOnly: true },
			),
		).toBe("ok");

		expect(observed).toBeUndefined();
		expectNoAuthFileWrites();
	});

	test("withLockAsync treats a read-denied auth.json as empty for read-only operations", async () => {
		denyAuthFileRead("EPERM");
		const backend = new FileAuthStorageBackend(authJsonPath);
		let observed: string | undefined = "sentinel";

		await expect(
			backend.withLockAsync(
				async (current) => {
					observed = current;
					return { result: "ok" };
				},
				{ readOnly: true },
			),
		).resolves.toBe("ok");

		expect(observed).toBeUndefined();
		expectNoAuthFileWrites();
	});

	test("withLock refuses credential changes on a read-denied auth.json", () => {
		const snapshot = snapshotAuthFile();
		denyAuthFileRead("EPERM");
		const backend = new FileAuthStorageBackend(authJsonPath);

		expect(() =>
			backend.withLock(() => ({
				result: undefined,
				next: JSON.stringify({ anthropic: { type: "api_key", key: "new" } }, null, 2),
			})),
		).toThrow("auth.json is not readable in this session; credential changes are refused");

		expectNoAuthFileWrites();
		resetAuthFileDenial();
		expectAuthFileUnchanged(snapshot);
	});

	test("withLockAsync refuses credential changes on a read-denied auth.json", async () => {
		const snapshot = snapshotAuthFile();
		denyAuthFileRead("EPERM");
		const backend = new FileAuthStorageBackend(authJsonPath);

		await expect(
			backend.withLockAsync(async () => ({
				result: undefined,
				next: JSON.stringify({ anthropic: { type: "api_key", key: "new" } }, null, 2),
			})),
		).rejects.toThrow("auth.json is not readable in this session; credential changes are refused");

		expectNoAuthFileWrites();
		resetAuthFileDenial();
		expectAuthFileUnchanged(snapshot);
	});

	test("reports an empty store while auth.json is fully denied", async () => {
		const snapshot = snapshotAuthFile();
		denyAuthFileRead("EPERM", { stat: true, exists: true });
		const storage = AuthStorage.create(authJsonPath);
		const signal = new AbortController().signal;

		await expect(storage.read("anthropic")).resolves.toBeUndefined();
		await expect(storage.list()).resolves.toEqual([]);
		await expect(storage.read("anthropic", { signal })).resolves.toBeUndefined();
		await expect(storage.list({ signal })).resolves.toEqual([]);

		expectNoAuthFileWrites();
		resetAuthFileDenial();
		expectAuthFileUnchanged(snapshot);
	});

	test("refuses modify and delete while auth.json is read-denied", async () => {
		const snapshot = snapshotAuthFile();
		denyAuthFileRead("EPERM");
		const storage = AuthStorage.create(authJsonPath);

		await expect(storage.modify("openai", async () => ({ type: "api_key", key: "new" }))).rejects.toThrow(
			"auth.json is not readable in this session; credential changes are refused",
		);
		await expect(storage.delete("anthropic")).rejects.toThrow(
			"auth.json is not readable in this session; credential changes are refused",
		);

		expectNoAuthFileWrites();
		resetAuthFileDenial();
		expectAuthFileUnchanged(snapshot);
	});

	test("ReadOnlyAuthStorage treats a denied auth.json as empty", async () => {
		for (const code of ["EPERM", "EACCES"] as const) {
			denyAuthFileRead(code);
			const storage = new ReadOnlyAuthStorage(authJsonPath);
			await expect(storage.read("anthropic")).resolves.toBeUndefined();
			await expect(storage.list()).resolves.toEqual([]);
		}
	});

	test("ReadOnlyAuthStorage still surfaces corrupt auth.json", async () => {
		writeFileSync(authJsonPath, "{invalid-json");

		await expect(new ReadOnlyAuthStorage(authJsonPath).read("anthropic")).rejects.toThrow("Failed to read auth.json");
	});

	test("resolves the environment API key when auth.json is read-denied", async () => {
		const original = process.env.OPENROUTER_API_KEY;
		process.env.OPENROUTER_API_KEY = "env-openrouter-key";
		try {
			const snapshot = snapshotAuthFile();
			denyAuthFileRead("EPERM");
			const storage = AuthStorage.create(authJsonPath);
			const runtime = await ModelRuntime.create({
				credentials: storage,
				modelsPath: null,
				modelsStore: new InMemoryModelsStore(),
				allowModelNetwork: false,
				refreshOnCreate: false,
			});

			await expect(runtime.getAuth("openrouter")).resolves.toMatchObject({
				auth: { apiKey: "env-openrouter-key" },
				source: "OPENROUTER_API_KEY",
			});

			expectNoAuthFileWrites();
			resetAuthFileDenial();
			expectAuthFileUnchanged(snapshot);
		} finally {
			if (original === undefined) delete process.env.OPENROUTER_API_KEY;
			else process.env.OPENROUTER_API_KEY = original;
		}
	});

	test.each(["EPERM", "EACCES"] as const)("does not recreate a stat-denied auth.json (%s)", (code) => {
		const snapshot = snapshotAuthFile();
		denyAuthFileRead(code, { stat: true, exists: true });
		const backend = new FileAuthStorageBackend(authJsonPath);

		expect(backend.withLock(() => ({ result: "ok" }), { readOnly: true })).toBe("ok");

		expectNoAuthFileWrites();
		resetAuthFileDenial();
		expectAuthFileUnchanged(snapshot);
	});

	test.each(["EPERM", "EACCES"] as const)("withLock treats a read-denied auth.json as empty (%s)", (code) => {
		denyAuthFileRead(code);
		const backend = new FileAuthStorageBackend(authJsonPath);
		let observed: string | undefined = "sentinel";

		expect(
			backend.withLock(
				(current) => {
					observed = current;
					return { result: "ok" };
				},
				{ readOnly: true },
			),
		).toBe("ok");

		expect(observed).toBeUndefined();
		expectNoAuthFileWrites();
	});

	test.each(["EPERM", "EACCES"] as const)(
		"withLockAsync treats a read-denied auth.json as empty (%s)",
		async (code) => {
			denyAuthFileRead(code);
			const backend = new FileAuthStorageBackend(authJsonPath);
			let observed: string | undefined = "sentinel";

			await expect(
				backend.withLockAsync(
					async (current) => {
						observed = current;
						return { result: "ok" };
					},
					{ readOnly: true },
				),
			).resolves.toBe("ok");

			expect(observed).toBeUndefined();
			expectNoAuthFileWrites();
		},
	);

	test("withLock surfaces non-permission read errors", () => {
		denyAuthFileRead("EIO");
		const backend = new FileAuthStorageBackend(authJsonPath);

		expect(() => backend.withLock(() => ({ result: "ok" }))).toThrow("EIO: operation not permitted");
	});

	test("withLockAsync surfaces non-permission read errors", async () => {
		denyAuthFileRead("EIO");
		const backend = new FileAuthStorageBackend(authJsonPath);

		await expect(backend.withLockAsync(async () => ({ result: "ok" }))).rejects.toThrow(
			"EIO: operation not permitted",
		);
	});

	test("ReadOnlyAuthStorage wraps non-permission read errors", async () => {
		denyAuthFileRead("EIO");

		await expect(new ReadOnlyAuthStorage(authJsonPath).read("anthropic")).rejects.toThrow(
			"Failed to read auth.json: EIO: operation not permitted",
		);
	});

	test("clears a warm cache when stat and read are denied", async () => {
		const storage = AuthStorage.create(authJsonPath);
		await expect(storage.read("anthropic")).resolves.toEqual({ type: "api_key", key: "stored" });

		denyAuthFileRead("EPERM", { stat: true });
		const signal = new AbortController().signal;
		await expect(storage.read("anthropic")).resolves.toBeUndefined();
		await expect(storage.list()).resolves.toEqual([]);
		await expect(storage.read("anthropic", { signal })).resolves.toBeUndefined();
		await expect(storage.list({ signal })).resolves.toEqual([]);
	});

	test("reloads readable data when only stat is denied after a warm cache", async () => {
		const storage = AuthStorage.create(authJsonPath);
		await expect(storage.read("anthropic")).resolves.toEqual({ type: "api_key", key: "stored" });

		denyAuthFileRead("EPERM", { read: false, stat: true });
		await expect(storage.read("anthropic")).resolves.toEqual({ type: "api_key", key: "stored" });
		await expect(storage.list()).resolves.toEqual([{ providerId: "anthropic", type: "api_key" }]);
	});

	test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
		"tolerates a real mode-000 auth.json",
		async () => {
			const snapshot = snapshotAuthFile();
			chmodSync(authJsonPath, 0o000);
			const storage = AuthStorage.create(authJsonPath);
			const signal = new AbortController().signal;

			try {
				await expect(storage.read("anthropic")).resolves.toBeUndefined();
				await expect(storage.list()).resolves.toEqual([]);
				await expect(storage.read("anthropic", { signal })).resolves.toBeUndefined();
				await expect(storage.modify("openai", async () => ({ type: "api_key", key: "new" }))).rejects.toThrow(
					"auth.json is not readable in this session; credential changes are refused",
				);
			} finally {
				chmodSync(authJsonPath, 0o600);
			}

			expectAuthFileUnchanged(snapshot);
		},
	);
});

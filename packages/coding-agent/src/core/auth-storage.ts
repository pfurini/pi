/**
 * CredentialStore implementation backed by auth.json.
 * Provider auth orchestration belongs to ModelRuntime and pi-ai Models.
 */

import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";
import { setTimeout as sleep } from "timers/promises";
import { getAgentDir } from "../config.ts";
import { raceWithAbortSignal } from "../utils/abort.ts";
import { getFileRevision, normalizePath } from "../utils/paths.ts";
import { stripBom } from "../utils/text.ts";
import { commitAtomicallySync, LOCK_STALE_MS, type ReconcileResult, reconcileTransactionSync } from "./auth-atomic.ts";
import { CODEX_PROVIDER_ID, checkCodexQuarantine } from "./auth-quarantine.ts";
import { isCommandConfigValue, resolveConfigValue } from "./resolve-config-value.ts";

type AuthStorageData = Record<string, Credential>;

type LockResult<T> = {
	result: T;
	next?: string;
};

// First creation is exclusive, so two first-time writers never truncate each
// other's store; every later write replaces the file atomically through
// auth-atomic.ts, which preserves the existing mode through the descriptor.
const AUTH_FILE_CREATE_OPTIONS = { encoding: "utf-8", mode: 0o600, flag: "wx" } as const;
const AUTH_FILE_PERMISSION_ERROR = "auth.json is not readable in this session; credential changes are refused";
const AUTH_FILE_TRANSACTION_ERROR =
	"auth.json has an unresolved replacement transaction; recover it before changing credentials";
const AUTH_FILE_COMMIT_ERROR = "auth.json could not be replaced atomically";
const AUTH_FILE_QUARANTINE_ERROR =
	"the openai-codex credential is quarantined by an unresolved pi-fence refresh; run `pi credential-recovery codex` before changing it";

function isPermissionDenied(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		((error as { code?: unknown }).code === "EPERM" || (error as { code?: unknown }).code === "EACCES")
	);
}

type AuthFileReload = {
	controller: AbortController;
	promise: Promise<AuthStorageData>;
	readers: number;
};

type AuthFileReadState = {
	data: AuthStorageData;
	revision?: string;
	reload?: AuthFileReload;
};

let sharedAuthFileReadState: { authPath: string; readState: AuthFileReadState } | undefined;

export interface AuthStorageLockOptions {
	/** Read-only callbacks may inspect an unresolved store but must never return next. */
	readOnly?: boolean;
}

export interface AuthStorageBackend {
	withLock<T>(fn: (current: string | undefined) => LockResult<T>, options?: AuthStorageLockOptions): T;
	withLockAsync<T>(
		fn: (current: string | undefined) => Promise<LockResult<T>>,
		options?: AuthOperationOptions & AuthStorageLockOptions,
	): Promise<T>;
}

export class FileAuthStorageBackend implements AuthStorageBackend {
	private authPath: string;

	constructor(authPath: string = join(getAgentDir(), "auth.json")) {
		this.authPath = normalizePath(authPath);
	}

	private ensureParentDir(): void {
		const dir = dirname(this.authPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
	}

	private ensureFileExists(): void {
		try {
			statSync(this.authPath);
		} catch (error) {
			if (isPermissionDenied(error)) return;
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			try {
				writeFileSync(this.authPath, "{}", AUTH_FILE_CREATE_OPTIONS);
			} catch (createError) {
				// Another process created the store between the check and the write: keep its bytes.
				if ((createError as NodeJS.ErrnoException).code !== "EEXIST") throw createError;
			}
		}
	}

	/** Replaces the store atomically; a failure before the rename is an error, a failure after it is not. */
	private persist(next: string, reconciled: ReconcileResult): void {
		if (reconciled.status === "error") throw new Error(AUTH_FILE_TRANSACTION_ERROR);
		const outcome = commitAtomicallySync(this.authPath, next);
		if (outcome.status === "not-installed") throw new Error(`${AUTH_FILE_COMMIT_ERROR} (${outcome.stage})`);
	}

	private acquireLockSyncWithRetry(path: string): () => void {
		// Allow roughly one second for another process to finish an atomic credential commit.
		const maxAttempts = 50;
		const delayMs = 20;
		let lastError: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				// The same stale window as the asynchronous lock: a shorter one would steal a live holder's lock.
				return lockfile.lockSync(path, { realpath: false, stale: LOCK_STALE_MS });
			} catch (error) {
				const code =
					typeof error === "object" && error !== null && "code" in error
						? String((error as { code?: unknown }).code)
						: undefined;
				if (code !== "ELOCKED" || attempt === maxAttempts) {
					throw error;
				}
				lastError = error;
				const start = Date.now();
				while (Date.now() - start < delayMs) {
					// Sleep synchronously to avoid changing callers to async.
				}
			}
		}

		throw (lastError as Error) ?? new Error("Failed to acquire auth storage lock");
	}

	withLock<T>(fn: (current: string | undefined) => LockResult<T>, options?: AuthStorageLockOptions): T {
		this.ensureParentDir();
		this.ensureFileExists();

		let release: (() => void) | undefined;
		try {
			release = this.acquireLockSyncWithRetry(this.authPath);
			// Whatever an earlier writer left behind is finished before the base is read.
			const reconciled = reconcileTransactionSync(this.authPath);
			if (!options?.readOnly && reconciled.status === "error") throw new Error(AUTH_FILE_TRANSACTION_ERROR);
			let current: string | undefined;
			let denied = false;
			try {
				current = readFileSync(this.authPath, "utf-8");
			} catch (error) {
				if (isPermissionDenied(error)) denied = true;
				else if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			if (!options?.readOnly && denied) throw new Error(AUTH_FILE_PERMISSION_ERROR);
			const { result, next } = fn(current);
			if (next !== undefined) {
				if (options?.readOnly) throw new Error("Read-only auth storage operations cannot return next");
				if (denied) throw new Error(AUTH_FILE_PERMISSION_ERROR);
				this.persist(next, reconciled);
			}
			return result;
		} finally {
			if (release) {
				release();
			}
		}
	}

	private async acquireLockAsync(
		signal: AbortSignal | undefined,
		onCompromised: (error: Error) => void,
	): Promise<() => Promise<void>> {
		const staleMs = LOCK_STALE_MS;
		const maxDelayMs = 2_000;
		const deadline = Date.now() + staleMs;
		let retry = 0;
		while (true) {
			signal?.throwIfAborted();
			let release: (() => Promise<void>) | undefined;
			try {
				release = await lockfile.lock(this.authPath, {
					realpath: false,
					retries: 0,
					stale: staleMs,
					onCompromised,
				});
			} catch (error) {
				signal?.throwIfAborted();
				const code =
					typeof error === "object" && error !== null && "code" in error
						? String((error as { code?: unknown }).code)
						: undefined;
				const remainingMs = deadline - Date.now();
				if (code !== "ELOCKED" || remainingMs <= 0) throw error;
				const baseDelayMs = Math.min(10 * 2 ** retry, maxDelayMs / 2);
				retry++;
				const delayMs = Math.min(Math.round(baseDelayMs * (1 + Math.random())), remainingMs);
				if (signal) await sleep(delayMs, undefined, { signal });
				else await sleep(delayMs);
				continue;
			}
			if (signal?.aborted) {
				await release();
				signal.throwIfAborted();
			}
			return release;
		}
	}

	async withLockAsync<T>(
		fn: (current: string | undefined) => Promise<LockResult<T>>,
		options?: AuthOperationOptions & AuthStorageLockOptions,
	): Promise<T> {
		options?.signal?.throwIfAborted();
		this.ensureParentDir();
		this.ensureFileExists();

		let release: (() => Promise<void>) | undefined;
		let lockCompromised = false;
		let lockCompromisedError: Error | undefined;
		const throwIfCompromised = () => {
			if (lockCompromised) {
				throw lockCompromisedError ?? new Error("Auth storage lock was compromised");
			}
		};

		try {
			release = await this.acquireLockAsync(options?.signal, (error) => {
				lockCompromised = true;
				lockCompromisedError = error;
			});

			throwIfCompromised();
			options?.signal?.throwIfAborted();
			const reconciled = reconcileTransactionSync(this.authPath);
			if (!options?.readOnly && reconciled.status === "error") throw new Error(AUTH_FILE_TRANSACTION_ERROR);
			let current: string | undefined;
			let denied = false;
			try {
				current = readFileSync(this.authPath, "utf-8");
			} catch (error) {
				if (isPermissionDenied(error)) denied = true;
				else if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			if (!options?.readOnly && denied) throw new Error(AUTH_FILE_PERMISSION_ERROR);
			const { result, next } = await fn(current);
			throwIfCompromised();
			options?.signal?.throwIfAborted();
			if (next !== undefined) {
				if (options?.readOnly) throw new Error("Read-only auth storage operations cannot return next");
				if (denied) throw new Error(AUTH_FILE_PERMISSION_ERROR);
				this.persist(next, reconciled);
			}
			throwIfCompromised();
			return result;
		} finally {
			if (release) {
				try {
					await release();
				} catch {
					// Ignore unlock errors when lock is compromised.
				}
			}
		}
	}
}

export class ReadOnlyAuthStorage implements CredentialStore {
	private readonly authPath: string;
	private data: AuthStorageData | undefined;

	constructor(authPath: string = join(getAgentDir(), "auth.json")) {
		this.authPath = normalizePath(authPath);
	}

	private load(): AuthStorageData {
		if (this.data) return this.data;

		let parsed: unknown;
		try {
			parsed = JSON.parse(stripBom(readFileSync(this.authPath, "utf-8")));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT" || isPermissionDenied(error)) {
				this.data = {};
				return this.data;
			}
			throw new Error(`Failed to read auth.json: ${error instanceof Error ? error.message : String(error)}`);
		}

		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new Error("Invalid auth.json: expected an object");
		}
		for (const [providerId, credential] of Object.entries(parsed)) {
			if (typeof credential !== "object" || credential === null || Array.isArray(credential)) {
				throw new Error(`Invalid auth.json credential for provider "${providerId}"`);
			}
			const value = credential as Record<string, unknown>;
			if (value.type === "api_key") {
				const validKey = value.key === undefined || typeof value.key === "string";
				const validEnv =
					value.env === undefined ||
					(typeof value.env === "object" &&
						value.env !== null &&
						!Array.isArray(value.env) &&
						Object.values(value.env).every((entry) => typeof entry === "string"));
				if (validKey && validEnv) continue;
			} else if (
				value.type === "oauth" &&
				typeof value.access === "string" &&
				typeof value.refresh === "string" &&
				typeof value.expires === "number" &&
				Number.isFinite(value.expires)
			) {
				continue;
			}
			throw new Error(`Invalid auth.json credential for provider "${providerId}"`);
		}

		this.data = parsed as AuthStorageData;
		return this.data;
	}

	async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		const credential = this.load()[providerId];
		options?.signal?.throwIfAborted();
		if (!credential) return undefined;
		if (credential.type !== "api_key" || !credential.key || isCommandConfigValue(credential.key)) {
			return structuredClone(credential);
		}
		return { ...credential, key: resolveConfigValue(credential.key, credential.env) };
	}

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		options?.signal?.throwIfAborted();
		const credentials = Object.entries(this.load()).map(([providerId, credential]) => ({
			providerId,
			type: credential.type,
		}));
		options?.signal?.throwIfAborted();
		return credentials;
	}

	async modify(
		_providerId: string,
		_fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		_options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		throw new Error("Read-only credential storage cannot modify auth.json");
	}

	async delete(_providerId: string, _options?: AuthOperationOptions): Promise<void> {
		throw new Error("Read-only credential storage cannot modify auth.json");
	}
}

export class InMemoryAuthStorageBackend implements AuthStorageBackend {
	private value: string | undefined;
	private asyncChain: Promise<unknown> = Promise.resolve();

	withLock<T>(fn: (current: string | undefined) => LockResult<T>, options?: AuthStorageLockOptions): T {
		const { result, next } = fn(this.value);
		if (next !== undefined) {
			if (options?.readOnly) throw new Error("Read-only auth storage operations cannot return next");
			this.value = next;
		}
		return result;
	}

	withLockAsync<T>(
		fn: (current: string | undefined) => Promise<LockResult<T>>,
		options?: AuthOperationOptions & AuthStorageLockOptions,
	): Promise<T> {
		const previous = this.asyncChain;
		const operation = (async () => {
			await previous.catch(() => {});
			options?.signal?.throwIfAborted();
			const { result, next } = await fn(this.value);
			options?.signal?.throwIfAborted();
			if (next !== undefined) {
				if (options?.readOnly) throw new Error("Read-only auth storage operations cannot return next");
				this.value = next;
			}
			return result;
		})();
		this.asyncChain = operation.catch(() => {});
		return raceWithAbortSignal(operation, options?.signal);
	}
}

/**
 * Credential storage backed by a JSON file.
 */
export class AuthStorage implements CredentialStore {
	private storage: AuthStorageBackend;
	private authPath: string | undefined;
	private readState: AuthFileReadState;

	private constructor(storage: AuthStorageBackend, authPath?: string) {
		this.storage = storage;
		this.authPath = authPath;
		this.readState =
			authPath && sharedAuthFileReadState?.authPath === authPath ? sharedAuthFileReadState.readState : { data: {} };
		if (authPath && !sharedAuthFileReadState) {
			sharedAuthFileReadState = { authPath, readState: this.readState };
		}
		if (authPath) {
			const revision = getFileRevision(authPath);
			if (revision !== undefined && revision === this.readState.revision) return;
		}
		this.reload();
	}

	static create(authPath: string = join(getAgentDir(), "auth.json")): AuthStorage {
		const normalizedAuthPath = normalizePath(authPath);
		return new AuthStorage(new FileAuthStorageBackend(normalizedAuthPath), normalizedAuthPath);
	}

	static fromStorage(storage: AuthStorageBackend): AuthStorage {
		return new AuthStorage(storage);
	}

	static inMemory(data: AuthStorageData = {}): AuthStorage {
		const storage = new InMemoryAuthStorageBackend();
		storage.withLock(() => ({ result: undefined, next: JSON.stringify(data, null, 2) }));
		return AuthStorage.fromStorage(storage);
	}

	private assertNotQuarantined(provider: string, current: Credential | undefined): void {
		if (provider !== CODEX_PROVIDER_ID || this.authPath === undefined) return;
		if (checkCodexQuarantine(this.authPath, current).status !== "clear") throw new Error(AUTH_FILE_QUARANTINE_ERROR);
	}

	private parseStorageData(content: string | undefined): AuthStorageData {
		if (!content) {
			return {};
		}
		return JSON.parse(stripBom(content)) as AuthStorageData;
	}

	private updateReadState(data: AuthStorageData, revision?: string): void {
		this.readState.data = data;
		this.readState.revision = revision;
	}

	/**
	 * Reload credentials from storage.
	 */
	reload(): void {
		let content: string | undefined;
		let revision: string | undefined;
		try {
			this.storage.withLock(
				(current) => {
					content = current;
					revision = this.authPath ? getFileRevision(this.authPath) : undefined;
					return { result: undefined };
				},
				{ readOnly: true },
			);
			this.updateReadState(this.parseStorageData(content), revision);
		} catch {
			// Preserve the last valid in-memory snapshot.
		}
	}

	private async reloadFromStorageAsync(options?: AuthOperationOptions): Promise<AuthStorageData> {
		return this.storage.withLockAsync(
			async (content) => {
				const currentData = this.parseStorageData(content);
				const revision = this.authPath ? getFileRevision(this.authPath) : undefined;
				this.updateReadState(currentData, revision);
				return { result: currentData };
			},
			{ ...options, readOnly: true },
		);
	}

	private async readLatestData(options?: AuthOperationOptions): Promise<AuthStorageData> {
		options?.signal?.throwIfAborted();
		if (!this.authPath) {
			const reload = this.reloadFromStorageAsync(options);
			return options?.signal ? reload : reload.catch(() => this.readState.data);
		}
		const revision = getFileRevision(this.authPath);
		if (revision !== undefined && revision === this.readState.revision) return this.readState.data;
		if (!this.readState.reload) {
			const controller = new AbortController();
			const reload: AuthFileReload = {
				controller,
				promise: this.reloadFromStorageAsync({ signal: controller.signal }),
				readers: 0,
			};
			this.readState.reload = reload;
			void reload.promise.then(
				() => {
					if (this.readState.reload === reload) this.readState.reload = undefined;
				},
				() => {
					if (this.readState.reload === reload) this.readState.reload = undefined;
				},
			);
		}

		const reload = this.readState.reload;
		reload.readers++;
		try {
			const result = raceWithAbortSignal(reload.promise, options?.signal);
			return options?.signal ? await result : await result.catch(() => this.readState.data);
		} finally {
			reload.readers--;
			if (reload.readers === 0 && this.readState.reload === reload) {
				this.readState.reload = undefined;
				reload.controller.abort();
			}
		}
	}

	async read(provider: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		const credential = (await this.readLatestData(options))[provider];
		options?.signal?.throwIfAborted();
		if (credential?.type !== "api_key") return credential;
		if (credential.key === undefined) return credential;
		return { ...credential, key: resolveConfigValue(credential.key, credential.env) };
	}

	async modify(
		provider: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		let latestData = this.readState.data;
		let revision: string | undefined;
		const result = await this.storage.withLockAsync(async (content) => {
			const currentData = this.parseStorageData(content);
			// A pi-fence launcher may have left this credential's refresh token in
			// an uncertain state; the check runs under the same lock, before the
			// callback that could spend it.
			this.assertNotQuarantined(provider, currentData[provider]);
			const next = await fn(currentData[provider]);
			if (next === undefined) {
				latestData = currentData;
				revision = this.authPath ? getFileRevision(this.authPath) : undefined;
				return { result: currentData[provider] };
			}

			const merged: AuthStorageData = { ...currentData, [provider]: next };
			latestData = merged;
			return { result: next, next: JSON.stringify(merged, null, 2) };
		}, options);
		this.updateReadState(latestData, revision);
		return result;
	}

	async delete(provider: string, options?: AuthOperationOptions): Promise<void> {
		let latestData = this.readState.data;
		await this.storage.withLockAsync(async (content) => {
			const currentData = this.parseStorageData(content);
			this.assertNotQuarantined(provider, currentData[provider]);
			delete currentData[provider];
			latestData = currentData;
			return { result: undefined, next: JSON.stringify(currentData, null, 2) };
		}, options);
		this.updateReadState(latestData);
	}

	/** List credential metadata without resolving configured key values. */
	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		const entries = Object.entries(await this.readLatestData(options));
		options?.signal?.throwIfAborted();
		return entries.map(([providerId, credential]) => ({ providerId, type: credential.type }));
	}
}

/**
 * One-off synchronous read of a stored credential from an auth.json file,
 * without instantiating a store or resolving configured key values.
 */
export function readStoredCredential(
	providerId: string,
	authPath: string = join(getAgentDir(), "auth.json"),
): Credential | undefined {
	try {
		const data = JSON.parse(stripBom(readFileSync(normalizePath(authPath), "utf-8"))) as AuthStorageData;
		return data[providerId];
	} catch {
		return undefined;
	}
}

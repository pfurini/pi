/**
 * Atomic replacement of a locked JSON store, in the protocol pi-fence runs
 * beside this agent for auth.json (pi-fence phase 5a, section 7).
 *
 * Problem: a direct write truncates the store before the new bytes land, so a
 * crash or a concurrent reader can see an empty or torn file that holds every
 * provider's credential. Example: the launcher persists a rotated Codex
 * refresh token while this agent reads the file; the reader sees `{}` and
 * treats the user as logged out.
 *
 * Solution: the caller holds `<store>.lock`; this helper records a versioned
 * intent at `<store>.atomic-meta` (staged through `.atomic-meta.next`), writes
 * the one complete candidate at `<store>.atomic` (created exclusively, mode
 * 0600), verifies it through its own descriptor, renames it over the store,
 * restores the store's mode through that descriptor, and removes the intent.
 * Recovery reads the intent and finishes or refuses; it never promotes a
 * candidate by guessing. Both writers share the names, the metadata shape
 * and the recovery table, so whatever one leaves behind the other resolves.
 *
 * Metadata support is the ordinary layout: a regular, single-link file owned
 * by the caller with no ACL entries, no BSD flags, and no extended attribute
 * beyond the system provenance one. Node exposes no primitive that preserves
 * other metadata across a rename, so a store carrying it is refused before
 * anything is written. The inventory runs through `/bin/ls -lOe@` on macOS;
 * other platforms preserve the mode only and perform no inventory.
 */

import { execFileSync } from "child_process";
import { createHash, randomUUID } from "crypto";
import {
	closeSync,
	constants,
	fchmodSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	openSync,
	readFileSync,
	readSync,
	renameSync,
	type Stats,
	statSync,
	unlinkSync,
	writeSync,
} from "fs";
import { userInfo } from "os";
import { dirname } from "path";

export const CANDIDATE_SUFFIX = ".atomic";
export const META_SUFFIX = ".atomic-meta";
export const META_STAGING_SUFFIX = ".atomic-meta.next";
export const STATE_DIR_SUFFIX = ".fence-state";
/** The stale window both writers agree on; a live holder refreshes its lock every half window. */
export const LOCK_STALE_MS = 30_000;

const SYSTEM_XATTRS = new Set(["com.apple.provenance"]);
const TEMP_MODE = 0o600;
const META_KEYS = ["candidate", "mode", "operation", "predecessor", "size", "version"].join();
const HEX_64 = /^[0-9a-f]{64}$/;

export interface TransactionPaths {
	readonly candidate: string;
	readonly meta: string;
	readonly metaStaging: string;
	readonly stateDir: string;
}

export type ReconcileError =
	| "unresolved-candidate"
	| "invalid-metadata"
	| "conflicting-store"
	| "unsafe-artifact"
	| "io";

export type ReconcileResult =
	| { readonly status: "clean" }
	| { readonly status: "completed"; readonly installed: "candidate" | "already" }
	| { readonly status: "error"; readonly error: ReconcileError };

export type CommitOutcome =
	| { readonly status: "committed" }
	| {
			readonly status: "installed-unconfirmed";
			readonly stage: "metadata-restore" | "file-sync" | "directory-sync" | "cleanup";
	  }
	| {
			readonly status: "not-installed";
			readonly stage:
				| "preflight"
				| "metadata-intent"
				| "candidate-open"
				| "candidate-write"
				| "candidate-sync"
				| "candidate-verify"
				| "rename";
	  };

interface Meta {
	readonly version: 1;
	readonly operation: string;
	readonly predecessor: string | null;
	readonly candidate: string;
	readonly size: number;
	readonly mode: number;
}

type Inspection =
	| { readonly kind: "absent" }
	| { readonly kind: "unsafe" }
	| { readonly kind: "file"; readonly stats: Stats };

export function transactionPaths(target: string): TransactionPaths {
	return {
		candidate: `${target}${CANDIDATE_SUFFIX}`,
		meta: `${target}${META_SUFFIX}`,
		metaStaging: `${target}${META_STAGING_SUFFIX}`,
		stateDir: `${target}${STATE_DIR_SUFFIX}`,
	};
}

function hashBytes(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObject(bytes: Uint8Array): boolean {
	try {
		return isPlainObject(JSON.parse(Buffer.from(bytes).toString("utf8")));
	} catch {
		return false;
	}
}

function errnoCode(error: unknown): string | undefined {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	return typeof code === "string" ? code : undefined;
}

function ownerUid(): number | undefined {
	return process.platform === "win32" ? undefined : userInfo().uid;
}

function ownedByCaller(stats: Stats): boolean {
	const uid = ownerUid();
	return uid === undefined || stats.uid === uid;
}

function parseMeta(bytes: Buffer): Meta | undefined {
	let value: unknown;
	try {
		value = JSON.parse(bytes.toString("utf8"));
	} catch {
		return undefined;
	}
	if (!isPlainObject(value)) return undefined;
	if (Object.keys(value).sort().join() !== META_KEYS) return undefined;
	const { version, operation, predecessor, candidate, size, mode } = value;
	if (version !== 1) return undefined;
	if (typeof operation !== "string" || operation.length === 0) return undefined;
	if (predecessor !== null && (typeof predecessor !== "string" || !HEX_64.test(predecessor))) return undefined;
	if (typeof candidate !== "string" || !HEX_64.test(candidate)) return undefined;
	if (typeof size !== "number" || !Number.isInteger(size) || size < 0) return undefined;
	if (typeof mode !== "number" || !Number.isInteger(mode) || mode < 0 || mode > 0o7777) return undefined;
	return { version: 1, operation, predecessor, candidate, size, mode };
}

/**
 * A protocol artifact is safe only as a regular file the caller owns. A path
 * this process may not even stat (a fenced session) reads as absent: it can
 * neither reconcile nor write, and its writes are refused elsewhere.
 */
function inspect(path: string): Inspection {
	let stats: Stats;
	try {
		stats = lstatSync(path);
	} catch (error) {
		const code = errnoCode(error);
		return code === "ENOENT" || code === "EPERM" || code === "EACCES" ? { kind: "absent" } : { kind: "unsafe" };
	}
	if (stats.isSymbolicLink() || !stats.isFile() || !ownedByCaller(stats)) return { kind: "unsafe" };
	return { kind: "file", stats };
}

function syncDirectory(dir: string): void {
	const fd = openSync(dir, constants.O_RDONLY);
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

function writeAll(fd: number, bytes: Buffer): void {
	let offset = 0;
	while (offset < bytes.length) {
		const written = writeSync(fd, bytes, offset, bytes.length - offset, null);
		if (written <= 0) throw new Error("short write");
		offset += written;
	}
}

function readAll(fd: number): Buffer {
	const chunks: Buffer[] = [];
	let position = 0;
	for (;;) {
		const chunk = Buffer.alloc(64 * 1024);
		const bytesRead = readSync(fd, chunk, 0, chunk.length, position);
		if (bytesRead === 0) return Buffer.concat(chunks);
		chunks.push(chunk.subarray(0, bytesRead));
		position += bytesRead;
	}
}

function ignoreFailure(operation: () => void): void {
	try {
		operation();
	} catch {
		// Best-effort cleanup; the primary outcome is already decided.
	}
}

interface Inventory {
	readonly acl: boolean;
	readonly flags: boolean;
	readonly xattrs: readonly string[];
}

/** Parses `ls -lOe@` output: the flags field, ACL entry lines, and extended attribute lines. */
export function parseInventory(listing: string): Inventory {
	const lines = listing.split("\n").filter((line) => line.length > 0);
	const fields = (lines[0] ?? "").trim().split(/\s+/);
	const flags = fields[4] ?? "-";
	const xattrs: string[] = [];
	let acl = false;
	for (const line of lines.slice(1)) {
		if (/^\s*\d+: /.test(line)) acl = true;
		else if (/^\t\S/.test(line)) xattrs.push(line.trim().split(/\s+/)[0] ?? "");
	}
	return { acl, flags: flags !== "-", xattrs };
}

function inventory(target: string): Inventory {
	if (process.platform !== "darwin") return { acl: false, flags: false, xattrs: [] };
	const listing = execFileSync("/bin/ls", ["-lOe@", target], { env: {}, timeout: 10_000, maxBuffer: 1024 * 1024 });
	return parseInventory(listing.toString("utf8"));
}

type Preflight =
	| { readonly status: "ok"; readonly mode: number }
	| { readonly status: "absent" }
	| { readonly status: "error" };

function preflight(target: string): Preflight {
	let dirStats: Stats;
	try {
		dirStats = statSync(dirname(target));
	} catch {
		return { status: "error" };
	}
	if (!dirStats.isDirectory()) return { status: "error" };
	let stats: Stats;
	try {
		stats = lstatSync(target);
	} catch (error) {
		return errnoCode(error) === "ENOENT" ? { status: "absent" } : { status: "error" };
	}
	if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink > 1 || !ownedByCaller(stats))
		return { status: "error" };
	let metadata: Inventory;
	try {
		metadata = inventory(target);
	} catch {
		return { status: "error" };
	}
	if (metadata.acl || metadata.flags || metadata.xattrs.some((name) => !SYSTEM_XATTRS.has(name)))
		return { status: "error" };
	return { status: "ok", mode: stats.mode & 0o7777 };
}

/** Finishes or refuses whatever an earlier transaction left behind. The caller holds the lock. */
export function reconcileTransactionSync(target: string): ReconcileResult {
	const err = (error: ReconcileError): ReconcileResult => ({ status: "error", error });
	const paths = transactionPaths(target);
	const dir = dirname(target);
	const staging = inspect(paths.metaStaging);
	const meta = inspect(paths.meta);
	const candidate = inspect(paths.candidate);
	if (staging.kind === "absent" && meta.kind === "absent" && candidate.kind === "absent") return { status: "clean" };
	if (staging.kind === "unsafe" || meta.kind === "unsafe" || candidate.kind === "unsafe")
		return err("unsafe-artifact");

	try {
		if (staging.kind === "file") {
			if (meta.kind !== "absent" || candidate.kind !== "absent") return err("unsafe-artifact");
			unlinkSync(paths.metaStaging);
			syncDirectory(dir);
			return { status: "clean" };
		}
		if (meta.kind === "absent") return err("unresolved-candidate");

		const parsed = parseMeta(readFileSync(paths.meta));
		if (parsed === undefined) return err("invalid-metadata");

		const store = inspect(target);
		if (store.kind === "unsafe") return err("unsafe-artifact");
		const storeHash = store.kind === "file" ? hashBytes(readFileSync(target)) : null;

		if (storeHash === parsed.candidate) {
			const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				if ((fstatSync(fd).mode & 0o7777) !== parsed.mode) fchmodSync(fd, parsed.mode);
				fsyncSync(fd);
			} finally {
				closeSync(fd);
			}
			if (candidate.kind === "file") unlinkSync(paths.candidate);
			unlinkSync(paths.meta);
			syncDirectory(dir);
			return { status: "completed", installed: "already" };
		}

		if (storeHash !== parsed.predecessor) return err("conflicting-store");

		if (candidate.kind === "file") {
			const bytes = readFileSync(paths.candidate);
			const complete = bytes.length === parsed.size && hashBytes(bytes) === parsed.candidate && isJsonObject(bytes);
			if (complete) {
				const fd = openSync(paths.candidate, constants.O_WRONLY | constants.O_NOFOLLOW);
				try {
					fsyncSync(fd);
					renameSync(paths.candidate, target);
					fchmodSync(fd, parsed.mode);
					fsyncSync(fd);
				} finally {
					closeSync(fd);
				}
				syncDirectory(dir);
				unlinkSync(paths.meta);
				syncDirectory(dir);
				return { status: "completed", installed: "candidate" };
			}
			unlinkSync(paths.candidate);
		}
		unlinkSync(paths.meta);
		syncDirectory(dir);
		return { status: "clean" };
	} catch {
		return err("io");
	}
}

/**
 * Replaces the store with `text` atomically. The caller holds the lock and
 * has reconciled; a leftover artifact is refused rather than stacked on. A
 * missing store is created at mode 0600, because this agent owns its stores.
 */
export function commitAtomicallySync(target: string, text: string): CommitOutcome {
	const notInstalled = (stage: Extract<CommitOutcome, { status: "not-installed" }>["stage"]): CommitOutcome => ({
		status: "not-installed",
		stage,
	});
	const unconfirmed = (
		stage: Extract<CommitOutcome, { status: "installed-unconfirmed" }>["stage"],
	): CommitOutcome => ({
		status: "installed-unconfirmed",
		stage,
	});
	const bytes = Buffer.from(text, "utf8");
	const paths = transactionPaths(target);
	const dir = dirname(target);

	if (!isJsonObject(bytes)) return notInstalled("preflight");
	const layout = preflight(target);
	if (layout.status === "error") return notInstalled("preflight");
	let mode = TEMP_MODE;
	let predecessor: string | null = null;
	if (layout.status === "ok") {
		mode = layout.mode;
		try {
			predecessor = hashBytes(readFileSync(target));
		} catch {
			return notInstalled("preflight");
		}
	}
	for (const artifact of [paths.metaStaging, paths.meta, paths.candidate]) {
		if (inspect(artifact).kind !== "absent") return notInstalled("preflight");
	}

	const meta: Meta = {
		version: 1,
		operation: randomUUID(),
		predecessor,
		candidate: hashBytes(bytes),
		size: bytes.length,
		mode,
	};
	try {
		const fd = openSync(
			paths.metaStaging,
			constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
			TEMP_MODE,
		);
		try {
			writeAll(fd, Buffer.from(JSON.stringify(meta), "utf8"));
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		renameSync(paths.metaStaging, paths.meta);
		syncDirectory(dir);
	} catch {
		ignoreFailure(() => unlinkSync(paths.metaStaging));
		return notInstalled("metadata-intent");
	}

	const abandon = (
		fd: number | undefined,
		stage: Extract<CommitOutcome, { status: "not-installed" }>["stage"],
	): CommitOutcome => {
		if (fd !== undefined) ignoreFailure(() => closeSync(fd));
		ignoreFailure(() => unlinkSync(paths.candidate));
		ignoreFailure(() => unlinkSync(paths.meta));
		ignoreFailure(() => syncDirectory(dir));
		return notInstalled(stage);
	};

	let fd: number;
	try {
		fd = openSync(
			paths.candidate,
			constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
			TEMP_MODE,
		);
	} catch {
		return abandon(undefined, "candidate-open");
	}
	try {
		writeAll(fd, bytes);
	} catch {
		return abandon(fd, "candidate-write");
	}
	try {
		fsyncSync(fd);
	} catch {
		return abandon(fd, "candidate-sync");
	}
	try {
		const stats = fstatSync(fd);
		const onDisk = lstatSync(paths.candidate);
		const identity =
			stats.isFile() &&
			onDisk.isFile() &&
			stats.ino === onDisk.ino &&
			stats.dev === onDisk.dev &&
			ownedByCaller(stats);
		const contents = stats.size === bytes.length && hashBytes(readAll(fd)) === meta.candidate;
		if (!identity || !contents) return abandon(fd, "candidate-verify");
	} catch {
		return abandon(fd, "candidate-verify");
	}

	try {
		renameSync(paths.candidate, target);
	} catch {
		return abandon(fd, "rename");
	}

	try {
		fchmodSync(fd, mode);
	} catch {
		ignoreFailure(() => closeSync(fd));
		return unconfirmed("metadata-restore");
	}
	try {
		fsyncSync(fd);
		closeSync(fd);
	} catch {
		ignoreFailure(() => closeSync(fd));
		return unconfirmed("file-sync");
	}
	try {
		syncDirectory(dir);
	} catch {
		return unconfirmed("directory-sync");
	}
	try {
		unlinkSync(paths.meta);
		syncDirectory(dir);
	} catch {
		return unconfirmed("cleanup");
	}
	return { status: "committed" };
}

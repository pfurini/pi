import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FileAuthStorageBackend } from "../src/core/auth-storage.ts";

describe("synchronous auth lock patience (phase 5a P3)", () => {
	let root: string;
	let backend: FileAuthStorageBackend;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "pi-auth-lock-patience-"));
		const authPath = join(root, "auth.json");
		writeFileSync(authPath, "{}", { mode: 0o600 });
		backend = new FileAuthStorageBackend(authPath);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(root, { recursive: true, force: true });
	});

	test("waits for a real child-process lock holder beyond the old 200ms budget", async () => {
		const child = fork(new URL("./fixtures/auth-lock-holder.mjs", import.meta.url), [join(root, "auth.json")], {
			execArgv: [],
			stdio: ["ignore", "ignore", "pipe", "ipc"],
		});
		const exited = once(child, "exit");
		try {
			const [message] = await once(child, "message");
			expect(message).toBe("acquired");
			const started = performance.now();
			child.send("release-after-delay");
			expect(backend.withLock(() => ({ result: "acquired" }))).toBe("acquired");
			const elapsed = performance.now() - started;
			expect(elapsed).toBeGreaterThan(220);
			expect(elapsed).toBeLessThan(2_000);
			expect(await exited).toEqual([0, null]);
		} finally {
			if (child.exitCode === null) child.kill();
			await exited;
		}
	}, 10_000);

	test("survives contention beyond the former ten-attempt limit and releases exactly once", () => {
		let now = 0;
		vi.spyOn(Date, "now").mockImplementation(() => {
			now += 20;
			return now;
		});
		const release = vi.fn();
		let attempts = 0;
		const lock = vi.spyOn(lockfile, "lockSync").mockImplementation(() => {
			if (++attempts < 16) throw Object.assign(new Error("held"), { code: "ELOCKED" });
			return release;
		});
		const operation = vi.fn(() => ({ result: "acquired" }));
		expect(backend.withLock(operation)).toBe("acquired");
		expect(lock).toHaveBeenCalledTimes(16);
		expect(lock).toHaveBeenLastCalledWith(join(root, "auth.json"), { realpath: false, stale: 30_000 });
		expect(operation).toHaveBeenCalledTimes(1);
		expect(release).toHaveBeenCalledTimes(1);
	});

	test("stops after fifty attempts without invoking the operation", () => {
		let now = 0;
		vi.spyOn(Date, "now").mockImplementation(() => {
			now += 20;
			return now;
		});
		const held = Object.assign(new Error("held"), { code: "ELOCKED" });
		const lock = vi.spyOn(lockfile, "lockSync").mockImplementation(() => {
			throw held;
		});
		const operation = vi.fn(() => ({ result: "unexpected" }));
		expect(() => backend.withLock(operation)).toThrow(held);
		expect(lock).toHaveBeenCalledTimes(50);
		expect(operation).not.toHaveBeenCalled();
	});

	test("does not retry non-contention errors", () => {
		const denied = Object.assign(new Error("denied"), { code: "EACCES" });
		const lock = vi.spyOn(lockfile, "lockSync").mockImplementation(() => {
			throw denied;
		});
		const operation = vi.fn(() => ({ result: "unexpected" }));
		expect(() => backend.withLock(operation)).toThrow(denied);
		expect(lock).toHaveBeenCalledTimes(1);
		expect(operation).not.toHaveBeenCalled();
	});
});

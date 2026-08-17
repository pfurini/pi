/**
 * C4d AC6: the loader's watcher/timers are disposed at every internally-owned
 * construction boundary — runtime session replacement (`newSession`,
 * `switchSession`), runtime `dispose()`, and a `createAgentSessionServices`
 * construction failure after `reload()` started watching. A correct-but-never-
 * called `dispose()` fails these gates.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../src/core/agent-session-runtime.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SessionManager } from "../src/core/session-manager.ts";

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()!();
	}
	vi.restoreAllMocks();
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-c4d-disposal-"));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

describe("c4d internally-owned loader disposal", () => {
	it("disposes exactly one loader on newSession, on switchSession, and on runtime dispose", async () => {
		const disposeSpy = vi.spyOn(DefaultResourceLoader.prototype, "dispose");
		const cwd = tempDir();

		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd: runtimeCwd,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await createAgentSessionServices({ cwd: runtimeCwd, agentDir: cwd });
			return {
				...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
				services,
				diagnostics: services.diagnostics,
			};
		};
		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd,
			agentDir: cwd,
			sessionManager: SessionManager.create(cwd),
		});
		let runtimeDisposed = false;
		cleanups.push(() => {
			if (!runtimeDisposed) void runtime.dispose();
		});

		expect(disposeSpy).not.toHaveBeenCalled();

		await runtime.newSession();
		expect(disposeSpy).toHaveBeenCalledTimes(1);

		// A resumable session in another cwd (switchSession rebuilds services for it).
		const otherDir = tempDir();
		const otherSession = SessionManager.create(otherDir);
		otherSession.appendMessage({ role: "user", content: [{ type: "text", text: "other" }], timestamp: Date.now() });
		const otherSessionFile = otherSession.getSessionFile()!;
		mkdirSync(otherDir, { recursive: true });
		await runtime.switchSession(otherSessionFile);
		expect(disposeSpy).toHaveBeenCalledTimes(2);

		runtimeDisposed = true;
		await runtime.dispose();
		expect(disposeSpy).toHaveBeenCalledTimes(3);
	});

	it("disposes the internally-created loader when services construction fails after reload()", async () => {
		const disposeSpy = vi.spyOn(DefaultResourceLoader.prototype, "dispose");
		const cwd = tempDir();
		// Force the post-reload step (modelRuntime.refresh) to fail: the loader already
		// started watching, and no services object escapes to carry its disposal.
		const modelRuntime = await ModelRuntime.create({
			authPath: join(cwd, "auth.json"),
			modelsPath: join(cwd, "models.json"),
		});
		vi.spyOn(modelRuntime, "refresh").mockRejectedValue(new Error("refresh boom"));

		await expect(createAgentSessionServices({ cwd, agentDir: cwd, modelRuntime })).rejects.toThrow("refresh boom");
		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});
});

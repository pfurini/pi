import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAgentDir } from "../src/config.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";

describe("ExtensionContext.agentDir", () => {
	let tempDir: string;
	let agentDir: string;
	let capturePath: string;
	let loadCapturePath: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-agent-dir-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "custom-agent-dir");
		capturePath = join(tempDir, "captured-agent-dir.txt");
		loadCapturePath = join(tempDir, "captured-load-agent-dir.txt");
		mkdirSync(join(agentDir, "extensions"), { recursive: true });
		writeFileSync(
			join(agentDir, "extensions", "capture-agent-dir.ts"),
			`
			import { writeFileSync } from "node:fs";
			export default function (pi) {
				writeFileSync(${JSON.stringify(loadCapturePath)}, pi.agentDir);
				pi.on("input", async (_event, ctx) => {
					writeFileSync(${JSON.stringify(capturePath)}, ctx.agentDir);
				});
			}
			`,
		);
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("reports the session agent dir, not the global one", async () => {
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			sessionManager: SessionManager.inMemory(),
		});

		await session.extensionRunner.emitInput("hello", undefined, "interactive");

		const captured = readFileSync(capturePath, "utf-8");
		expect(captured).toBe(agentDir);
		expect(captured).not.toBe(getAgentDir());
		expect(session.extensionRunner.createContext().agentDir).toBe(agentDir);

		session.dispose();
	});

	it("reports the session agent dir at extension load, before any event", async () => {
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			sessionManager: SessionManager.inMemory(),
		});

		// Written by the extension factory itself, which runs before session_start.
		// Registrations pi flushes at load (providers, models, tools) depend on this.
		const captured = readFileSync(loadCapturePath, "utf-8");
		expect(captured).toBe(agentDir);
		expect(captured).not.toBe(getAgentDir());

		session.dispose();
	});
});

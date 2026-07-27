import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";

describe("createAgentSession context file options", () => {
	let tempDir: string;
	let agentDir: string;
	let repo: string;
	let nested: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-sdk-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		repo = join(tempDir, "repo");
		nested = join(repo, "packages", "app");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(repo, ".git"), { recursive: true });
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(repo, "AGENTS.md"), "Repo instructions");
		writeFileSync(join(nested, "AGENTS.md"), "Package instructions");
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("should collect context files up to the project root by default", async () => {
		const { session } = await createAgentSession({
			cwd: nested,
			agentDir,
			sessionManager: SessionManager.inMemory(),
		});

		expect(session.resourceLoader.getAgentsFiles().agentsFiles.map((f) => f.path)).toEqual([
			join(repo, "AGENTS.md"),
			join(nested, "AGENTS.md"),
		]);
	});

	it("should forward contextFileScope to the default resource loader", async () => {
		const { session } = await createAgentSession({
			cwd: nested,
			agentDir,
			contextFileScope: "cwd",
			sessionManager: SessionManager.inMemory(),
		});

		expect(session.resourceLoader.getAgentsFiles().agentsFiles.map((f) => f.path)).toEqual([
			join(nested, "AGENTS.md"),
		]);
	});

	it("should forward noContextFiles to the default resource loader", async () => {
		const { session } = await createAgentSession({
			cwd: nested,
			agentDir,
			noContextFiles: true,
			sessionManager: SessionManager.inMemory(),
		});

		expect(session.resourceLoader.getAgentsFiles().agentsFiles).toEqual([]);
	});
});

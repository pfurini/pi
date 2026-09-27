/**
 * Fork-owned: worktree isolation through the service (plan T7) on real parent and child sessions
 * whose working directory is a real git repository. The child writes through its own `write` tool,
 * so the test proves which directory the agent's tools resolve against. Git reads no global or
 * system configuration here.
 * Old pi-subagents tests at 79a7c42 this covers: worktree-isolation-e2e.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SubagentService, subagentServiceFor } from "../../src/core/fork-builtins/subagents/service/service.ts";
import { agentId, type Behavior, call, held, router, say, text, use } from "./fork-subagents-fixtures.ts";
import { createHarness, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];

beforeEach(() => {
	vi.stubEnv("PI_FORK_BUILTINS", "on");
	vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
	vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
});

afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	vi.unstubAllEnvs();
});

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function worktrees(repo: string): string[] {
	return git(repo, "worktree", "list", "--porcelain")
		.split("\n")
		.filter((line) => line.startsWith("worktree "))
		.map((line) => realpathSync(line.slice("worktree ".length)));
}

/** A session whose working directory holds the `scribe` agent, as a committed git repository when `repository`. */
async function parent(repository: boolean, script: Record<string, Behavior[]>): Promise<Harness> {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-subagent-worktree-")));
	mkdirSync(join(cwd, "agents"));
	writeFileSync(
		join(cwd, "agents", "scribe.md"),
		"---\ndescription: writes files\ntools: read, write\nextensions: false\n---\nYou write files.",
	);
	writeFileSync(
		join(cwd, "agents", "archivist.md"),
		"---\ndescription: keeps its session\ntools: read\nextensions: false\npersist_session: true\nsession_dir: sessions\n---\nYou keep records.",
	);
	if (repository) {
		git(cwd, "init", "-q");
		git(cwd, "config", "user.email", "test@example.com");
		git(cwd, "config", "user.name", "Test");
		writeFileSync(join(cwd, "README.md"), "# repo\n");
		git(cwd, "add", "README.md");
		git(cwd, "commit", "-q", "-m", "initial");
	}
	const harness = await createHarness({ cwd });
	harnesses.push(harness);
	harness.setResponses(Array.from({ length: 100 }, () => router(script)));
	return harness;
}

function serviceOf(harness: Harness): SubagentService {
	const service = subagentServiceFor(harness.session);
	if (!service) throw new Error("no subagent service");
	return service;
}

const isolated = (prompt: string, extra: Record<string, unknown> = {}) => ({
	subagent_type: "scribe",
	prompt,
	description: prompt,
	isolation: "worktree",
	...extra,
});

describe("worktree isolation through the service", () => {
	it("runs the agent in a worktree and saves its change to the branch the result names", async () => {
		const harness = await parent(true, {
			note: [use("write", () => ({ path: "note.txt", content: "from the agent" })), say("written")],
		});
		const repo = harness.tempDir;
		const result = await call(harness, "Agent", isolated("note task", { run_in_background: false }));
		const [record] = serviceOf(harness).list();
		const branch = `pi-agent-${record.id}`;
		expect(text(result)).toMatch(
			new RegExp(
				`\\n\\nwritten\\n\\n---\\nChanges saved to branch \`${branch}\` in \`${repo}\`\\. Merge with: \`git merge ${branch}\`$`,
			),
		);
		expect(git(repo, "show", `${branch}:note.txt`)).toBe("from the agent");
		expect(existsSync(join(repo, "note.txt"))).toBe(false);
		expect(worktrees(repo)).toEqual([repo]);
		expect(record.child?.session.systemPrompt).toContain(`isolated git worktree copy of ${repo}`);
		const resumed = await call(harness, "Agent", { ...isolated("again"), resume: record.id });
		expect(text(resumed)).toBe(
			`Agent "${record.id}" ran in an isolated worktree and cannot be resumed; start a new agent.`,
		);
	});

	it("saves a stopped agent's change to its branch, then removes the worktree", async () => {
		const stuck = held(() => fauxAssistantMessage("never"));
		const harness = await parent(true, {
			stop: [use("write", () => ({ path: "partial.txt", content: "half" })), stuck.behavior],
		});
		const repo = harness.tempDir;
		const launched = await call(harness, "Agent", isolated("stop task"));
		const id = agentId(launched);
		const outputFile = /^Output file: (.+)$/m.exec(text(launched))?.[1];
		await vi.waitFor(() => expect(stuck.requests()).toBe(1));
		serviceOf(harness).stop(id);
		const record = await serviceOf(harness).waitForResult(id);
		expect(record.status).toBe("stopped");
		expect(record.worktreeOutcome).toEqual({ kind: "committed", branch: `pi-agent-${id}` });
		expect(git(repo, "show", `pi-agent-${id}:partial.txt`)).toBe("half");
		expect(worktrees(repo)).toEqual([repo]);
		expect(record.transcriptPath).toBe(outputFile);
	});

	it("keeps a session_dir session file in the project, out of the worktree and its branch", async () => {
		const harness = await parent(true, {});
		const repo = harness.tempDir;
		await call(harness, "Agent", {
			...isolated("archive task", { run_in_background: false }),
			subagent_type: "archivist",
		});
		const [record] = serviceOf(harness).list();
		expect(record.sessionFile?.startsWith(`${join(repo, "sessions")}/`)).toBe(true);
		expect(record.sessionFile !== undefined && existsSync(record.sessionFile)).toBe(true);
		expect(record.worktreeOutcome).toEqual({ kind: "unchanged" });
	});

	it("fails the spawn with a named error outside a git repository", async () => {
		const harness = await parent(false, {});
		const result = await call(harness, "Agent", isolated("plain task", { run_in_background: false }));
		expect(text(result)).toMatch(
			/^Cannot run with isolation: "worktree": .* is not inside a git repository with at least one commit/,
		);
		expect(serviceOf(harness).list()).toEqual([]);
	});
});

/**
 * Fork-owned: worktree isolation (plan T7) against real git repositories under the OS temp
 * directory. Git reads no global or system configuration here, so a developer's hooks path, signing
 * or identity cannot change the outcome. Every test ends by listing the repository's worktrees: only
 * the main tree, an unrelated worktree created beforehand, and the worktrees a failure preserved.
 * Old pi-subagents tests at 79a7c42 this covers: worktree (worktree-isolation-e2e is in
 * test/suite/fork-subagents-worktree.test.ts).
 */
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createWorktree,
	finishWorktree,
	type Worktree,
	worktreeBase,
} from "../../../src/core/fork-builtins/subagents/runner/worktree.ts";

const cleanups: string[] = [];

beforeEach(() => {
	vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
	vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
	for (const name of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"]) {
		vi.stubEnv(name, undefined);
	}
});

afterEach(() => {
	vi.unstubAllEnvs();
	for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function temp(prefix: string): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	cleanups.push(dir);
	return dir;
}

/** A repository with one commit, a subdirectory, ignored `*.log` files, and an unrelated worktree. */
function repository(): { repo: string; other: string } {
	const repo = temp("pi-worktree-repo-");
	git(repo, "init", "-q");
	git(repo, "config", "user.email", "test@example.com");
	git(repo, "config", "user.name", "Test");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	writeFileSync(join(repo, ".gitignore"), "*.log\n");
	mkdirSync(join(repo, "pkg"));
	writeFileSync(join(repo, "pkg", "a.txt"), "a\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "initial");
	const other = join(temp("pi-worktree-other-"), "tree");
	git(repo, "worktree", "add", "-q", "--detach", other);
	return { repo, other };
}

/** The repository's registered worktrees as real paths, sorted. */
function worktrees(repo: string): string[] {
	return git(repo, "worktree", "list", "--porcelain")
		.split("\n")
		.filter((line) => line.startsWith("worktree "))
		.map((line) => realpathSync(line.slice("worktree ".length)))
		.sort();
}

const sorted = (...paths: string[]) => paths.map((path) => realpathSync(path)).sort();

async function created(cwd: string, id: string): Promise<Worktree> {
	const worktree = await createWorktree(cwd, id);
	cleanups.push(worktree.path);
	return worktree;
}

describe("worktree isolation", () => {
	it("commits a change to pi-agent-<id>, leaves the main tree unchanged, and removes the worktree", async () => {
		const { repo, other } = repository();
		const worktree = await created(join(repo, "pkg"), "commit1");
		expect(worktree.workPath).toBe(join(worktree.path, "pkg"));
		writeFileSync(join(worktree.workPath, "note.txt"), "from the agent\n");
		writeFileSync(join(worktree.workPath, "debug.log"), "ignored\n");
		expect(await finishWorktree(worktree, "pi-agent: note")).toEqual({
			kind: "committed",
			branch: "pi-agent-commit1",
		});
		expect(git(repo, "show", "pi-agent-commit1:pkg/note.txt")).toBe("from the agent");
		expect(git(repo, "log", "-1", "--format=%s", "pi-agent-commit1")).toBe("pi-agent: note");
		expect(existsSync(join(repo, "pkg", "note.txt"))).toBe(false);
		expect(git(repo, "status", "--porcelain")).toBe("");
		expect(existsSync(worktree.path)).toBe(false);
		expect(worktrees(repo)).toEqual(sorted(repo, other));
	});

	it("removes an unchanged worktree and creates no branch", async () => {
		const { repo, other } = repository();
		const worktree = await created(repo, "same2");
		expect(await finishWorktree(worktree, "pi-agent: nothing")).toEqual({ kind: "unchanged" });
		expect(git(repo, "branch", "--list", "pi-agent-same2")).toBe("");
		expect(existsSync(worktree.path)).toBe(false);
		expect(worktrees(repo)).toEqual(sorted(repo, other));
	});

	it("never runs the repository's hooks on the snapshot commit", async () => {
		const { repo, other } = repository();
		const hook = join(repo, ".git", "hooks", "pre-commit");
		writeFileSync(hook, "#!/bin/sh\nexit 1\n");
		chmodSync(hook, 0o755);
		const worktree = await created(repo, "hooked3");
		writeFileSync(join(worktree.workPath, "note.txt"), "hooked\n");
		expect(await finishWorktree(worktree, "pi-agent: hooked")).toEqual({
			kind: "committed",
			branch: "pi-agent-hooked3",
		});
		expect(worktrees(repo)).toEqual(sorted(repo, other));
	});

	it("keeps the worktree and names it when the commit fails", async () => {
		const { repo, other } = repository();
		git(repo, "config", "--unset", "user.name");
		git(repo, "config", "--unset", "user.email");
		git(repo, "config", "user.useConfigOnly", "true");
		const worktree = await created(repo, "noident4");
		writeFileSync(join(worktree.workPath, "note.txt"), "unsaved\n");
		const outcome = await finishWorktree(worktree, "pi-agent: no identity");
		expect(outcome).toMatchObject({ kind: "preserved", path: worktree.path, branch: undefined });
		expect(outcome.kind === "preserved" && outcome.error).toMatch(/user\.(email|name)|identity/i);
		expect(readFileSync(join(worktree.workPath, "note.txt"), "utf8")).toBe("unsaved\n");
		expect(worktrees(repo)).toEqual(sorted(repo, other, worktree.path));
	});

	it("keeps the worktree and names it when the branch already exists", async () => {
		const { repo, other } = repository();
		git(repo, "branch", "pi-agent-taken5");
		const worktree = await created(repo, "taken5");
		writeFileSync(join(worktree.workPath, "note.txt"), "committed, not branched\n");
		const outcome = await finishWorktree(worktree, "pi-agent: taken");
		expect(outcome).toMatchObject({ kind: "preserved", path: worktree.path, branch: undefined });
		expect(outcome.kind === "preserved" && outcome.error).toContain("already exists");
		expect(git(worktree.path, "show", "HEAD:note.txt")).toBe("committed, not branched");
		expect(worktrees(repo)).toEqual(sorted(repo, other, worktree.path));
	});

	it("adds and removes through the main tree when the spawn came from a linked worktree removed first", async () => {
		const { repo, other } = repository();
		const lead = join(temp("pi-worktree-lead-"), "tree");
		git(repo, "worktree", "add", "-q", "--detach", lead);
		const worktree = await created(lead, "nest7");
		expect(realpathSync(worktree.repo)).toBe(repo);
		git(repo, "worktree", "remove", lead);
		writeFileSync(join(worktree.workPath, "note.txt"), "nested\n");
		expect(await finishWorktree(worktree, "pi-agent: nested")).toEqual({
			kind: "committed",
			branch: "pi-agent-nest7",
		});
		expect(git(repo, "show", "pi-agent-nest7:note.txt")).toBe("nested");
		expect(worktrees(repo)).toEqual(sorted(repo, other));
	});

	it("creates the spawn's untracked directory inside the copy", async () => {
		const { repo, other } = repository();
		mkdirSync(join(repo, "newpkg"));
		const worktree = await created(join(repo, "newpkg"), "fresh8");
		expect(worktree.workPath).toBe(join(worktree.path, "newpkg"));
		expect(existsSync(worktree.workPath)).toBe(true);
		expect(await finishWorktree(worktree, "pi-agent: fresh")).toEqual({ kind: "unchanged" });
		expect(worktrees(repo)).toEqual(sorted(repo, other));
	});

	it("refuses a directory outside a git repository with a named error", async () => {
		const outside = temp("pi-worktree-plain-");
		await expect(worktreeBase(outside)).rejects.toThrow(
			`Cannot run with isolation: "worktree": ${outside} is not inside a git repository with at least one commit`,
		);
		await expect(createWorktree(outside, "plain6")).rejects.toThrow(/is not inside a git repository/);
	});
});

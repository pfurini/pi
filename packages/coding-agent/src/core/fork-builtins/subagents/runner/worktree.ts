/**
 * Fork-owned: worktree isolation for subagents (plan T7). pi-subagents `src/worktree.ts` at 79a7c42
 * is the behavior reference for creation and the branch; its failure handling is not (plan
 * Section 2.1 "Worktree preservation").
 *
 * `createWorktree` adds a detached worktree of the spawn's repository at `HEAD` under the OS temp
 * directory. The agent works at the same subdirectory inside the copy, created when the copy lacks
 * it (an untracked directory). Removal and the result's note use the main worktree, which outlives
 * a linked one the spawn may have come from, such as a worktree agent's own copy. `finishWorktree` commits the
 * agent's changes with `--no-verify` (handoff D29), points `pi-agent-<id>` at the result, and then
 * removes the worktree. A worktree is removed only after its changes are on that branch, or when it
 * holds none. A failed stage, commit, branch creation or removal keeps it, and the outcome names
 * its path and the error. Only the worktree this module created is ever removed; nothing here runs
 * a repository-wide `git worktree prune`.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { execCommand } from "../../../exec.ts";

export interface Worktree {
	/** The repository's main worktree, where the worktree is added and removed. */
	readonly repo: string;
	/** The worktree's root. */
	readonly path: string;
	/** Where the agent works: the spawn's directory, mapped into the copy. */
	readonly workPath: string;
	/** The commit the worktree started at. */
	readonly baseSha: string;
	/** The branch its changes go to. */
	readonly branch: string;
}

export type WorktreeOutcome =
	| { kind: "unchanged" }
	| { kind: "committed"; branch: string }
	/** A step failed; the worktree stays. `branch` is set when the changes reached it before the failure. */
	| { kind: "preserved"; path: string; error: string; branch?: string };

const GIT_TIMEOUT_MS = 60_000;

/** Runs git and returns its trimmed stdout; any exit but a clean one throws with git's own message. */
async function git(cwd: string, args: string[]): Promise<string> {
	const result = await execCommand("git", args, cwd, { timeout: GIT_TIMEOUT_MS, truncationNotice: false });
	if (result.killed || result.code !== 0) {
		const output = result.stderr.trim() || result.stdout.trim();
		throw new Error(output || `git ${args.join(" ")} failed (exit ${result.code})`);
	}
	return result.stdout.trim();
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Where a worktree of `cwd` comes from: the main worktree (`git worktree list` names it first), the
 * top level of `cwd`'s own tree, and its `HEAD`. Throws a named error outside a repository with commits.
 */
export async function worktreeBase(cwd: string): Promise<{ repo: string; top: string; baseSha: string }> {
	try {
		const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
		const baseSha = await git(cwd, ["rev-parse", "--verify", "HEAD"]);
		const main = (await git(cwd, ["worktree", "list", "--porcelain"])).split("\n")[0];
		return { repo: main.startsWith("worktree ") ? main.slice("worktree ".length) : top, top, baseSha };
	} catch (error) {
		throw new Error(
			`Cannot run with isolation: "worktree": ${cwd} is not inside a git repository with at least one commit (${errorText(error)}).`,
		);
	}
}

export async function createWorktree(cwd: string, agentId: string): Promise<Worktree> {
	const { repo, top, baseSha } = await worktreeBase(cwd);
	// Both sides resolved: git reports real paths, and the cwd may come through a symlink (macOS /tmp).
	const subdir = relative(realpathSync(top), realpathSync(cwd));
	const path = join(tmpdir(), `pi-agent-${agentId}-${randomUUID().slice(0, 8)}`);
	try {
		await git(repo, ["worktree", "add", "--detach", path, baseSha]);
	} catch (error) {
		throw new Error(`Cannot run with isolation: "worktree": git worktree add failed (${errorText(error)}).`);
	}
	const workPath = subdir ? join(path, subdir) : path;
	mkdirSync(workPath, { recursive: true });
	return { repo, path, workPath, baseSha, branch: `pi-agent-${agentId}` };
}

/** Saves the agent's changes to its branch and removes the worktree; keeps the worktree on any failure. */
export async function finishWorktree(worktree: Worktree, message: string): Promise<WorktreeOutcome> {
	let branch: string | undefined;
	try {
		if (await git(worktree.path, ["status", "--porcelain"])) {
			await git(worktree.path, ["add", "-A"]);
			await git(worktree.path, ["commit", "--no-verify", "-m", message]);
		}
		// The agent may have committed on its own; any commit past the base goes to the branch.
		if ((await git(worktree.path, ["rev-parse", "HEAD"])) !== worktree.baseSha) {
			await git(worktree.path, ["branch", worktree.branch]);
			branch = worktree.branch;
		}
		// Without --force: git refuses a worktree with changes it does not hold, and the worktree stays.
		await git(worktree.repo, ["worktree", "remove", worktree.path]);
		return branch ? { kind: "committed", branch } : { kind: "unchanged" };
	} catch (error) {
		return { kind: "preserved", path: worktree.path, error: errorText(error), branch };
	}
}

/** The note a result carries about its worktree; empty when nothing changed. */
export function describeWorktreeOutcome(outcome: WorktreeOutcome, repo: string): string {
	switch (outcome.kind) {
		case "unchanged":
			return "";
		case "committed":
			return `Changes saved to branch \`${outcome.branch}\` in \`${repo}\`. Merge with: \`git merge ${outcome.branch}\``;
		case "preserved":
			return `The worktree at \`${outcome.path}\` was kept because a git step failed: ${outcome.error}\n${
				outcome.branch
					? `Its changes are on branch \`${outcome.branch}\` in \`${repo}\`.`
					: "Its changes are on no branch yet; commit them from the worktree."
			}`;
	}
}

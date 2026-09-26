import { expect, test } from "vitest";
import {
	createBranchIndexLifecycle,
	createReconciliationStore,
	sharedReconciliationStore,
} from "../../../src/core/fork-builtins/tokensave/branch-lifecycle.ts";
import { setExecFileImplForTest } from "../../../src/core/fork-builtins/tokensave/runner.ts";

type Cb = (
	error: (NodeJS.ErrnoException & { killed?: boolean; signal?: string }) | null,
	stdout: string,
	stderr: string,
) => void;

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

/** One `git branch --format=%(HEAD)%09%(refname)%09%(objectname)` line. */
function ref(name: string, sha = SHA_A, current = false): string {
	return `${current ? "*" : " "}\trefs/heads/${name}\t${sha}`;
}

function fakePi(getRefs: () => string) {
	return {
		async exec(command: string) {
			expect(command).toBe("git");
			return { code: 0, stdout: getRefs(), stderr: "", killed: false };
		},
	};
}

function recordCommands(): string[][] {
	const commands: string[][] = [];
	setExecFileImplForTest((_file, args: string[], _options, cb: Cb) => {
		commands.push(args);
		cb(null, "ok", "");
		return {};
	});
	return commands;
}

/** First word(s) of each TokenSave invocation: ["branch", "add"], ["sync"], ... */
function steps(commands: string[][]): string[] {
	return commands.map((args) => (args[0] === "branch" ? `branch ${args[1]}` : args[0]));
}

test.afterEach(() => setExecFileImplForTest(undefined));

test("reconciles creation, checkout, and deletion while skipping an unchanged branch set", async () => {
	let refs = [ref("feature/old"), ref("main", SHA_A, true)].join("\n");
	const commands = recordCommands();

	const lifecycle = createBranchIndexLifecycle();
	const pi = fakePi(() => refs);

	await lifecycle.reconcile(pi, "/repo");
	expect(steps(commands)).toStrictEqual(["branch add", "sync", "branch gc"]);

	await lifecycle.reconcile(pi, "/repo");
	expect(commands.length, "unchanged refs should not invoke tokensave again").toBe(3);

	refs = [ref("feature/new", SHA_A, true), ref("feature/old"), ref("main")].join("\n");
	await lifecycle.reconcile(pi, "/repo");
	expect(commands.length, "creating and checking out a branch should reconcile").toBe(6);

	refs = [ref("feature/new", SHA_A, true), ref("main")].join("\n");
	await lifecycle.reconcile(pi, "/repo");
	expect(commands.length, "deleting a local branch should run branch gc").toBe(9);
});

test("a commit on the checked-out branch syncs its index", async () => {
	let refs = ref("main", SHA_A, true);
	const commands = recordCommands();

	const lifecycle = createBranchIndexLifecycle();
	const pi = fakePi(() => refs);
	await lifecycle.reconcile(pi, "/repo");
	commands.length = 0;

	refs = ref("main", SHA_B, true);
	await lifecycle.reconcile(pi, "/repo");
	expect(steps(commands)).toStrictEqual(["branch add", "sync", "branch gc"]);
	expect(commands[1]).toStrictEqual(["sync", "/repo"]);
});

test("sync runs with a longer timeout than the branch commands", async () => {
	const timeouts: Record<string, number> = {};
	setExecFileImplForTest((_file, args: string[], options, cb: Cb) => {
		timeouts[args[0] === "branch" ? `branch ${args[1]}` : args[0]] = options.timeout;
		cb(null, "ok", "");
		return {};
	});

	await createBranchIndexLifecycle().reconcile(
		fakePi(() => ref("main", SHA_A, true)),
		"/repo",
	);

	expect(timeouts.sync > timeouts["branch add"]).toBeTruthy();
	expect(timeouts.sync >= 120_000).toBeTruthy();
});

test("detached HEAD skips branch add and sync but still removes stale indexes", async () => {
	const commands = recordCommands();

	// Real `git branch` output during a rebase or bisect.
	const refs = [`*\t(HEAD detached at ${SHA_A.slice(0, 7)})\t${SHA_A}`, ref("main")].join("\n");
	await createBranchIndexLifecycle().reconcile(
		fakePi(() => refs),
		"/repo",
	);

	expect(steps(commands)).toStrictEqual(["branch gc"]);
});

test("a failed branch add skips the sync and reports the failure", async () => {
	const commands: string[][] = [];
	setExecFileImplForTest((_file, args: string[], _options, cb: Cb) => {
		commands.push(args);
		if (args[1] === "add") {
			const error = new Error("failed") as NodeJS.ErrnoException;
			cb(error, "", "add failed");
		} else {
			cb(null, "ok", "");
		}
		return {};
	});

	const result = await createBranchIndexLifecycle().reconcile(
		fakePi(() => ref("main", SHA_A, true)),
		"/repo",
	);

	expect(steps(commands)).toStrictEqual(["branch add", "branch gc"]);
	expect(result.reconciled).toBe(false);
	expect(result.warnings).toStrictEqual(["add failed"]);
});

test("failed reconciliation is retried instead of caching the branch fingerprint", async () => {
	let calls = 0;
	setExecFileImplForTest((_file, _args: string[], _options, cb: Cb) => {
		calls += 1;
		const error = new Error("failed") as NodeJS.ErrnoException;
		error.code = "EFAIL";
		cb(error, "", "failed");
		return {};
	});

	const lifecycle = createBranchIndexLifecycle();
	const pi = fakePi(() => ref("main", SHA_A, true));
	await lifecycle.reconcile(pi, "/repo");
	await lifecycle.reconcile(pi, "/repo");

	// branch add fails, so each attempt runs add and gc without sync.
	expect(calls).toBe(4);
});

test("a sync held by another process is retried later without a warning", async () => {
	let locked = true;
	const commands: string[][] = [];
	setExecFileImplForTest((_file, args: string[], _options, cb: Cb) => {
		commands.push(args);
		if (args[0] === "sync" && locked) {
			const error = new Error("exit 1") as NodeJS.ErrnoException;
			cb(
				error,
				"",
				"Error: sync lock: another sync is already in progress (PID 4242). If this is stale, remove /repo/.tokensave/sync.lock",
			);
		} else {
			cb(null, "ok", "");
		}
		return {};
	});

	const lifecycle = createBranchIndexLifecycle();
	const pi = fakePi(() => ref("main", SHA_A, true));

	const contended = await lifecycle.reconcile(pi, "/repo");
	expect(contended.reconciled).toBe(false);
	expect(contended.warnings).toStrictEqual([]);

	locked = false;
	commands.length = 0;
	const retried = await lifecycle.reconcile(pi, "/repo");
	expect(retried.reconciled).toBe(true);
	expect(steps(commands)).toStrictEqual(["branch add", "sync", "branch gc"]);
});

test("a sync timeout is reported as a warning", async () => {
	setExecFileImplForTest((_file, args: string[], _options, cb: Cb) => {
		if (args[0] === "sync") {
			const error = new Error("timed out") as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
			error.killed = true;
			error.signal = "SIGTERM";
			cb(error, "partial progress", "");
		} else {
			cb(null, "ok", "");
		}
		return {};
	});

	const result = await createBranchIndexLifecycle().reconcile(
		fakePi(() => ref("main", SHA_A, true)),
		"/repo",
	);

	expect(result.reconciled).toBe(false);
	expect(result.warnings).toStrictEqual(["tokensave sync timed out."]);
});

test("lifecycles on one store skip work the other already did", async () => {
	const commands = recordCommands();
	const store = createReconciliationStore();
	const pi = fakePi(() => ref("main", SHA_A, true));

	await createBranchIndexLifecycle(store).reconcile(pi, "/repo");
	expect(commands.length).toBe(3);

	// A pi-subagents child: a new module instance, the same process-wide store.
	const child = await createBranchIndexLifecycle(store).reconcile(pi, "/repo");
	expect(child.reconciled).toBe(false);
	expect(commands.length, "the child finds the parent's fingerprint").toBe(3);
});

test("a lifecycle joins a reconciliation another one on the same store still runs", async () => {
	const commands: string[][] = [];
	let releaseSync: (() => void) | undefined;
	setExecFileImplForTest((_file, args: string[], _options, cb: Cb) => {
		commands.push(args);
		if (args[0] === "sync") releaseSync = () => cb(null, "ok", "");
		else cb(null, "ok", "");
		return {};
	});
	const store = createReconciliationStore();
	const pi = fakePi(() => ref("main", SHA_A, true));

	const parent = createBranchIndexLifecycle(store).reconcile(pi, "/repo");
	await new Promise((resolve) => setImmediate(resolve));
	const child = createBranchIndexLifecycle(store).reconcile(pi, "/repo");
	releaseSync?.();

	const [parentResult, childResult] = await Promise.all([parent, child]);
	expect(parentResult, "the child awaits the parent's run").toBe(childResult);
	expect(steps(commands)).toStrictEqual(["branch add", "sync", "branch gc"]);
});

test("sharedReconciliationStore returns one store per process", () => {
	expect(sharedReconciliationStore()).toBe(sharedReconciliationStore());
});

test("a git call that throws (stale session) resolves without reconciling", async () => {
	const commands = recordCommands();
	const stalePi = {
		async exec(): Promise<{ code: number; stdout: string }> {
			throw new Error("This extension ctx is stale after session replacement or reload.");
		},
	};

	const result = await createBranchIndexLifecycle().reconcile(stalePi, "/repo");
	expect(result).toStrictEqual({ reconciled: false, warnings: [] });
	expect(commands.length).toBe(0);
});

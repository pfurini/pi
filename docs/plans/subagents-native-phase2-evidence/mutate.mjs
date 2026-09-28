// Runs mutation checks: break one guarded line, run the named test files, restore the file.
//
//   node mutate.mjs <worktree> <spec.json> <state-dir>
//
// The spec is a JSON array of entries:
//   { "id": "T10-M3", "cases": [3], "what": "background mode shows a foreground agent",
//     "path": "<file relative to packages/coding-agent>", "old": "<exact text>", "new": "<replacement>",
//     "files": ["<test file relative to packages/coding-agent>", ...],
//     "expect": ["<file> > <full test name>", ...] }
// `files` and `expect` hold concrete paths and identities, never globs. An entry is caught when at
// least one `expect` identity fails an assertion. A test file that fails to run, or a run that writes
// no report, is an infrastructure failure: it is listed with a `!` and never counts as caught.
// An entry may give "tsgo": "<error code>" instead of "files" and "expect"; it then runs
// `tsgo --noEmit` at the worktree root and is caught when tsgo fails with that code.
//
// For each entry the runner checks that `old` occurs exactly once, saves the file's bytes to
// <state-dir>/backup and its path to <state-dir>/current.json, writes the mutation, runs the check in
// its own process group, and restores the file in a `finally` block. SIGINT or SIGTERM stops the whole
// process group (SIGTERM, then SIGKILL after 5 s), waits until no process of the group is left,
// restores the file, verifies its SHA-256 and only then removes the recovery state. After a check exits
// normally, the runner ends whatever its group left behind in the same way. When <state-dir>/current.json
// exists at start, an earlier run died while a file was mutated: the runner prints the restore command
// and exits 2 without touching anything.
//
// Output, one block per entry:
//   <id> [<cases>] <what> | <k> of <n> failed, caught          (or ", not caught")
//       <file> > <full test name>        (each failing test, or "tsgo > <error line>")
//       ! <file> > <file failed to run>  (each infrastructure failure)
// then "restored | <k> of <n> failed" for all named test files together, and "clean: yes" or "clean: no".
// Exit 0 when every entry was caught, the restored run has no failure and every file is clean; 1
// otherwise; 2 on bad input or an interrupted earlier run.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function fail(message) {
	process.stderr.write(`mutate: ${message}\n`);
	process.exit(2);
}

const [worktreeArg, specArg, stateArg] = process.argv.slice(2);
if (!worktreeArg || !specArg || !stateArg) fail("usage: mutate.mjs <worktree> <spec.json> <state-dir>");
const worktree = resolve(worktreeArg);
const pkg = join(worktree, "packages/coding-agent");
const vitest = join(worktree, "node_modules/vitest/dist/cli.js");
const tsgo = join(worktree, "node_modules/.bin/tsgo");
const stateDir = resolve(stateArg);
const marker = join(stateDir, "current.json");
const backup = join(stateDir, "backup");
if (!existsSync(vitest)) fail(`vitest not installed at ${vitest}`);

if (existsSync(marker)) {
	const { path, pgid } = JSON.parse(readFileSync(marker, "utf8"));
	const group = pgid ? `First make sure process group ${pgid} has exited (\`pgrep -g ${pgid}\` prints nothing). ` : "";
	fail(
		`an earlier run was interrupted while ${path} was mutated. ${group}Restore the file with\n  cp ${backup} ${path} && rm ${marker} ${backup}\nthen rerun.`,
	);
}

let spec;
try {
	spec = JSON.parse(readFileSync(specArg, "utf8"));
} catch (error) {
	fail(`cannot read the spec: ${error.message}`);
}
if (!Array.isArray(spec) || spec.length === 0) fail("the spec is not a non-empty array");
const concrete = (list) =>
	Array.isArray(list) && list.length > 0 && list.every((item) => typeof item === "string" && !/[*?[\]{}]/.test(item.split(" > ")[0]));
for (const entry of spec) {
	const ok =
		typeof entry.id === "string" &&
		typeof entry.path === "string" &&
		typeof entry.old === "string" &&
		typeof entry.new === "string" &&
		entry.old !== entry.new &&
		(typeof entry.tsgo === "string" ? entry.files === undefined : concrete(entry.files) && concrete(entry.expect));
	if (!ok) fail(`malformed entry: ${JSON.stringify(entry)}`);
	for (const file of entry.files ?? []) if (!existsSync(join(pkg, file))) fail(`${entry.id}: no test file ${file}`);
}
mkdirSync(stateDir, { recursive: true });

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The running check's process group, the file under mutation and the run's scratch directory. */
let running;
let active;
let scratch;

function restoreActive() {
	if (!active) return;
	writeFileSync(active.full, active.original);
	if (sha(readFileSync(active.full)) !== active.hash) {
		process.stderr.write(`mutate: ${active.full} did not restore; recovery state kept in ${stateDir}\n`);
		active = undefined;
		return false;
	}
	rmSync(marker, { force: true });
	rmSync(backup, { force: true });
	active = undefined;
	return true;
}

/** Whether any process of group `pgid` still exists. */
function groupAlive(pgid) {
	try {
		process.kill(-pgid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

/**
 * Ends process group `pgid`: SIGTERM, then SIGKILL after 5 s. Resolves true once no member is left,
 * or false when one is still there after 10 s. The leader's exit alone proves nothing: a test's own
 * subprocess stays in the group after vitest exits.
 */
async function endGroup(pgid) {
	const signal = (name) => {
		try {
			process.kill(-pgid, name);
		} catch {
			// The group is already gone.
		}
	};
	const started = Date.now();
	let killed = false;
	signal("SIGTERM");
	while (groupAlive(pgid)) {
		const elapsed = Date.now() - started;
		if (elapsed >= 10000) return false;
		if (!killed && elapsed >= 5000) {
			signal("SIGKILL");
			killed = true;
		}
		await new Promise((done) => setTimeout(done, 50));
	}
	return true;
}

let stopping = false;
for (const name of ["SIGINT", "SIGTERM"]) {
	process.on(name, async () => {
		if (stopping) return;
		stopping = true;
		const group = running?.pid;
		const ended = group === undefined || (await endGroup(group));
		if (ended) restoreActive();
		else if (active) {
			// Restore the source, but keep the marker: it names the group that is still alive.
			writeFileSync(active.full, active.original);
			process.stderr.write(`mutate: process group ${group} outlived SIGKILL; recovery state kept in ${stateDir}\n`);
		}
		if (scratch) rmSync(scratch, { recursive: true, force: true });
		process.exit(name === "SIGINT" ? 130 : 143);
	});
}

/**
 * Runs a command in its own process group; `capture` keeps its output, otherwise it is discarded.
 * After a signal it starts nothing and never resolves: the loop must not start the next check while
 * the signal handler ends the current one, or `process.exit` would orphan the new group.
 */
function exec(command, args, options, capture) {
	if (stopping) return new Promise(() => {});
	return new Promise((done) => {
		const child = spawn(command, args, {
			...options,
			detached: true,
			stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
		});
		running = child;
		// The recovery marker names the group, so a runner killed outright leaves a trail to it.
		if (active) writeFileSync(marker, JSON.stringify({ path: active.full, pgid: child.pid }));
		let output = "";
		child.stdout?.on("data", (chunk) => {
			output += chunk;
		});
		child.stderr?.on("data", (chunk) => {
			output += chunk;
		});
		child.on("close", async (code) => {
			// Members the check left behind must not overlap the restore or the next check.
			await endGroup(child.pid);
			running = undefined;
			done({ code, output });
		});
	});
}

/** Runs vitest on `files` in an empty environment; returns failing identities and infrastructure failures. */
async function runVitest(files) {
	scratch = mkdtempSync(join(tmpdir(), "sn2-mutate-"));
	const out = join(scratch, "report.json");
	try {
		await exec(process.execPath, [vitest, "--run", "--reporter=json", `--outputFile=${out}`, ...files], {
			cwd: pkg,
			env: { PATH: process.env.PATH ?? "", HOME: scratch, TMPDIR: scratch, LANG: "C", TZ: "UTC" },
		});
		if (!existsSync(out)) return { total: 0, failed: [], infra: ["<vitest wrote no report>"] };
		const report = JSON.parse(readFileSync(out, "utf8"));
		const failed = [];
		const infra = [];
		for (const file of report.testResults) {
			const name = file.name.replace(/.*packages\/coding-agent\//, "");
			const tests = file.assertionResults ?? [];
			if (file.status === "failed" && !tests.some((test) => test.status === "failed")) {
				infra.push(`${name} > <file failed to run>`);
			}
			for (const test of tests) if (test.status === "failed") failed.push(`${name} > ${test.fullName}`);
		}
		return { total: report.numTotalTests, failed, infra };
	} finally {
		rmSync(scratch, { recursive: true, force: true });
		scratch = undefined;
	}
}

/** Runs tsgo at the worktree root; a failure counts only when its output holds `code`. */
async function runTsgo(code) {
	const result = await exec(tsgo, ["--noEmit"], { cwd: worktree }, true);
	const lines = result.output.split("\n").filter((line) => line.includes(code));
	const failed = result.code !== 0 && lines.length > 0 ? lines.map((line) => `tsgo > ${line.trim()}`) : [];
	return { total: 1, failed, infra: [] };
}

let caughtAll = true;
let clean = true;
const touched = new Map();
for (const entry of spec) {
	const full = join(pkg, entry.path);
	if (!existsSync(full)) fail(`${entry.id}: no file ${entry.path}`);
	const original = readFileSync(full);
	const text = original.toString("utf8");
	const count = text.split(entry.old).length - 1;
	if (count !== 1) fail(`${entry.id}: expected 1 match of "old" in ${entry.path}, found ${count}`);
	if (!touched.has(full)) touched.set(full, sha(original));
	writeFileSync(backup, original);
	writeFileSync(marker, JSON.stringify({ path: full }));
	active = { full, original, hash: sha(original) };
	let result;
	try {
		writeFileSync(full, text.replace(entry.old, entry.new));
		result = entry.tsgo ? await runTsgo(entry.tsgo) : await runVitest(entry.files);
	} finally {
		if (restoreActive() === false) clean = false;
	}
	const caught = entry.tsgo
		? result.failed.length > 0
		: result.failed.some((identity) => entry.expect.includes(identity));
	if (!caught) caughtAll = false;
	const cases = Array.isArray(entry.cases) ? entry.cases.join(",") : "";
	console.log(
		`${entry.id} [${cases}] ${entry.what ?? ""} | ${result.failed.length} of ${result.total} failed, ${caught ? "caught" : "not caught"}`,
	);
	for (const identity of result.failed) console.log(`    ${identity}`);
	for (const identity of result.infra) console.log(`    ! ${identity}`);
}
const files = [...new Set(spec.flatMap((entry) => entry.files ?? []))];
const restored = files.length > 0 ? await runVitest(files) : { total: 0, failed: [], infra: [] };
console.log(`restored | ${restored.failed.length + restored.infra.length} of ${restored.total} failed`);
for (const identity of restored.failed) console.log(`    ${identity}`);
for (const identity of restored.infra) console.log(`    ! ${identity}`);
for (const [full, hash] of touched) if (sha(readFileSync(full)) !== hash) clean = false;
console.log(`clean: ${clean ? "yes" : "no"}`);
process.exit(caughtAll && restored.failed.length === 0 && restored.infra.length === 0 && clean ? 0 : 1);

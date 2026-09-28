#!/usr/bin/env node
// Runs one package's vitest suite under ./test.sh isolation, or diffs the failing tests of two runs.
//
//   node failing-tests.mjs run <worktree> <package-dir> <out.json> [extra vitest args...]
//   node failing-tests.mjs diff <baseline.json> <candidate.json>
//
// `run` writes vitest's JSON report plus a `planningChangesPackageRoot` field, so `diff` can compare
// reports from different worktrees. It exits 0 once the report exists, whatever the tests did.
// `diff` exits 1 when the candidate has a failure the baseline lacks, 0 otherwise.
// Both exit 2 on bad input or when no report could be produced.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

function fail(message) {
	process.stderr.write(`failing-tests: ${message}\n`);
	process.exit(2);
}

// Mirrors the variable list in the repository's test.sh: an empty environment with a throwaway
// HOME, so e2e tests that activate on credentials or endpoint variables stay inert.
function isolatedEnv(root) {
	for (const dir of ["home/.config", "tmp", "cache/npm"]) mkdirSync(join(root, dir), { recursive: true });
	for (const file of ["npm-userconfig", "npm-globalconfig"]) writeFileSync(join(root, file), "");
	const home = join(root, "home");
	const tmp = join(root, "tmp");
	return {
		PATH: process.env.PATH ?? "",
		HOME: home,
		USERPROFILE: home,
		TMPDIR: tmp,
		TMP: tmp,
		TEMP: tmp,
		XDG_CONFIG_HOME: join(home, ".config"),
		XDG_CACHE_HOME: join(root, "cache"),
		LANG: "C",
		LC_ALL: "C",
		TZ: "UTC",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		GIT_ASKPASS: "false",
		GIT_EDITOR: "true",
		GIT_SEQUENCE_EDITOR: "true",
		NPM_CONFIG_USERCONFIG: join(root, "npm-userconfig"),
		NPM_CONFIG_GLOBALCONFIG: join(root, "npm-globalconfig"),
		NPM_CONFIG_CACHE: join(root, "cache/npm"),
		PI_NO_LOCAL_LLM: "1",
		AWS_EC2_METADATA_DISABLED: "true",
	};
}

function run([worktree, packageDir, out, ...extra]) {
	if (!worktree || !packageDir || !out) fail("usage: run <worktree> <package-dir> <out.json> [vitest args...]");
	const packageRoot = resolve(worktree, packageDir);
	const vitest = join(resolve(worktree), "node_modules/vitest/dist/cli.js");
	if (!existsSync(join(packageRoot, "package.json"))) fail(`no package.json in ${packageRoot}`);
	if (!existsSync(vitest)) fail(`vitest not installed at ${vitest}; run npm install --ignore-scripts first`);
	const outFile = isAbsolute(out) ? out : resolve(out);
	// Never overwrite: the path may belong to another run or session.
	if (existsSync(outFile)) fail(`output already exists: ${outFile}; choose a new path`);
	const root = mkdtempSync(join(tmpdir(), "planning-changes-tests-"));
	try {
		const result = spawnSync(
			process.execPath,
			[vitest, "--run", "--reporter=json", `--outputFile=${outFile}`, ...extra],
			// 256 MiB: a large suite's console output must not overflow spawnSync's buffer and kill vitest.
			{ cwd: packageRoot, env: isolatedEnv(root), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
		);
		if (!existsSync(outFile)) {
			// The last 30 lines hold vitest's startup or import error; earlier output is test noise.
			const tail = `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n").slice(-30).join("\n");
			fail(`vitest wrote no report (exit ${result.status}). Last output:\n${tail}`);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
	const report = JSON.parse(readFileSync(outFile, "utf8"));
	report.planningChangesPackageRoot = realpathSync(packageRoot);
	writeFileSync(outFile, JSON.stringify(report));
	const failed = index(report).failed;
	process.stdout.write(
		`${outFile}: ${report.numFailedTests ?? "?"} failed, ${report.numPassedTests ?? "?"} passed, ` +
			`${report.numFailedTestSuites ?? "?"} failed suites; ${failed.size} distinct failures\n`,
	);
}

// Keys every test that ran (`seen`) and every failing one (`failed`). A test file that failed before
// any test ran (an import error) counts as one failing key; every present file also marks that key seen.
function index(report) {
	const root = report.planningChangesPackageRoot;
	const seen = new Set();
	const failed = new Set();
	for (const file of report.testResults ?? []) {
		const name = root && file.name.startsWith(`${root}/`) ? file.name.slice(root.length + 1) : file.name;
		const tests = file.assertionResults ?? [];
		const fileKey = `${name} :: <file failed to run>`;
		seen.add(fileKey);
		if (file.status === "failed" && !tests.some((test) => test.status === "failed")) failed.add(fileKey);
		for (const test of tests) {
			const key = `${name} :: ${test.fullName}`;
			seen.add(key);
			if (test.status === "failed") failed.add(key);
		}
	}
	return { seen, failed };
}

function read(path) {
	if (!path || !existsSync(path)) fail(`report not found: ${path}`);
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		fail(`report is not JSON: ${path} (${error.message})`);
	}
}

function diff([baselinePath, candidatePath]) {
	if (!baselinePath || !candidatePath) fail("usage: diff <baseline.json> <candidate.json>");
	const baseline = index(read(baselinePath)).failed;
	const candidate = index(read(candidatePath));
	const added = [...candidate.failed].filter((key) => !baseline.has(key)).sort();
	const kept = [...candidate.failed].filter((key) => baseline.has(key)).sort();
	const fixed = [...baseline].filter((key) => candidate.seen.has(key) && !candidate.failed.has(key)).sort();
	// A baseline failure the candidate never ran is neither fixed nor kept; a filtered run hides it.
	const notRun = [...baseline].filter((key) => !candidate.seen.has(key)).sort();
	const section = (title, keys) => `${title} (${keys.length}):\n${keys.map((key) => `  ${key}\n`).join("")}`;
	process.stdout.write(
		section("new failures", added) +
			section("fixed failures", fixed) +
			section("unchanged failures", kept) +
			section("baseline failures not run by the candidate", notRun),
	);
	process.exit(added.length > 0 ? 1 : 0);
}

const [command, ...args] = process.argv.slice(2);
if (command === "run") run(args);
else if (command === "diff") diff(args);
else fail("usage: failing-tests.mjs run <worktree> <package-dir> <out.json> | diff <baseline.json> <candidate.json>");

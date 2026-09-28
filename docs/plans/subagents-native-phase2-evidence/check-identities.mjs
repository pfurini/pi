// Checks that the phase run keeps every test and fails only known flakes or repaired tests.
//
//   node check-identities.mjs <baseline.json> <phase.json> <reports dir>
//
// Reports are vitest JSON reports written by failing-tests.mjs. In <reports dir>, `T<n>-<k>.json` are
// task reports, written before the phase run. `T17-R<n>-<k>.json` (repairs) and `T18-F<n>-<k>.json`
// (review fixes) are fix reports, written after it. For each task or fix only its last report, the
// highest <k>, counts: a review fix may rename a test its task added. The check fails when:
//   - a baseline identity, whatever its status, is absent from the phase run;
//   - an identity of a task's last report is absent from the phase run;
//   - an identity fails in a fix's last report and is not a known flake (D36); a fix's tests need not
//     be in the phase run, which came before the fix;
//   - an identity is pending (skipped) in the phase run but was not pending in the baseline;
//   - an identity fails in the phase run, is not a known flake, and passes in no repair report.
// An identity is `<file relative to the package> :: <full test name>`. It prints each offending
// identity with its reason, exits 0 when none offends, 1 otherwise, and 2 on bad input.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function fail(message) {
	process.stderr.write(`check-identities: ${message}\n`);
	process.exit(2);
}

/** The statuses vitest reports for a test that did not run. */
const SKIPPED = new Set(["skipped", "pending", "todo"]);

/** Known flakes from handoff D36: a file, and a test name or every test of that file. */
const FLAKES = [
	{ file: "test/exec.test.ts", name: "execCommand captures finite inherited descendant output after the shell exits" },
	{ file: "test/agent-session-concurrent.test.ts" },
	{
		file: "test/footer-data-provider.test.ts",
		name: "updates the cached branch when the reftable directory changes",
	},
];

function statuses(path) {
	if (!existsSync(path)) fail(`report not found: ${path}`);
	let report;
	try {
		report = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		fail(`report is not JSON: ${path} (${error.message})`);
	}
	if (!Array.isArray(report.testResults)) fail(`report has no testResults: ${path}`);
	// Per identity: how many copies ran, and how many passed, failed or were skipped.
	const map = new Map();
	for (const file of report.testResults) {
		const name = file.name.replace(/.*packages\/coding-agent\//, "");
		for (const test of file.assertionResults ?? []) {
			const id = `${name} :: ${test.fullName}`;
			const counts = map.get(id) ?? { runs: 0, passed: 0, failed: 0, skipped: 0 };
			counts.runs++;
			if (test.status === "passed") counts.passed++;
			else if (test.status === "failed") counts.failed++;
			else if (SKIPPED.has(test.status)) counts.skipped++;
			map.set(id, counts);
		}
	}
	return map;
}

function isFlake(id) {
	const [file, name] = id.split(" :: ");
	return FLAKES.some((flake) => flake.file === file && (flake.name === undefined || name.endsWith(flake.name)));
}

const [baselinePath, phasePath, dir] = process.argv.slice(2);
if (!baselinePath || !phasePath || !dir || !existsSync(dir)) {
	fail("usage: check-identities.mjs <baseline.json> <phase.json> <reports dir>");
}
const baseline = statuses(baselinePath);
const phase = statuses(phasePath);
const names = readdirSync(dir).sort();
/** Per task or fix, only the report with the highest <k>. */
function lastReports(pattern) {
	const last = new Map();
	for (const name of names) {
		const match = pattern.exec(name);
		if (!match) continue;
		const best = last.get(match[1]);
		if (!best || Number(match[2]) > best.k) last.set(match[1], { k: Number(match[2]), name });
	}
	return [...last.values()].map((entry) => entry.name).sort();
}
// Task reports T1 to T16 come before the phase run; repair (T17-R) and review-fix (T18-F) reports after it.
const taskReports = lastReports(/^(T\d+)-(\d+)\.json$/);
const fixReports = lastReports(/^(T17-R\d+|T18-F\d+)-(\d+)\.json$/);
const repairReports = names.filter((name) => /^T17-R\d+-\d+\.json$/.test(name));

const offending = [];
for (const [id, counts] of baseline) {
	const runs = phase.get(id)?.runs ?? 0;
	if (runs < counts.runs) offending.push(`${id}\n    baseline test missing from the phase run (${runs} of ${counts.runs} copies)`);
}
for (const name of taskReports) {
	for (const [id, counts] of statuses(join(dir, name))) {
		const runs = phase.get(id)?.runs ?? 0;
		if (runs < counts.runs) offending.push(`${id}\n    test of ${name} missing from the phase run`);
	}
}
// A fix's tests need not be in the earlier phase run, but its last report must pass them.
for (const name of fixReports) {
	for (const [id, counts] of statuses(join(dir, name))) {
		if (counts.failed > 0 && !isFlake(id)) offending.push(`${id}\n    fails in ${name}, the fix's last report`);
	}
}
const repaired = new Set();
for (const name of repairReports) {
	for (const [id, counts] of statuses(join(dir, name))) {
		if (counts.passed > 0 && counts.failed === 0) repaired.add(id);
	}
}
for (const [id, counts] of phase) {
	if (counts.skipped > (baseline.get(id)?.skipped ?? 0)) offending.push(`${id}\n    skipped more often than in the baseline`);
	if (counts.failed > 0 && !isFlake(id) && !repaired.has(id)) {
		offending.push(`${id}\n    fails in the phase run and passes in no repair report`);
	}
}
const unique = [...new Set(offending)];
console.log(
	`baseline: ${baseline.size}, phase: ${phase.size}, task reports: ${taskReports.length}, fix reports: ${fixReports.length}, offending: ${unique.length}`,
);
for (const entry of unique) console.log(entry);
process.exit(unique.length === 0 ? 0 : 1);

// Checks the D24 old-test checklist against a vitest JSON report written by failing-tests.mjs.
//
//   node check-checklist.mjs <checklist.md> <report.json>
//
// A row reads `| <old file> | <status> | <covering tests> |`. The status is `Covered`, `Phase 2`,
// `Phase 3` or `Dropped: <reason>`. A `Covered` row lists one or more identities, each
// `<file relative to packages/coding-agent> > <full test name>`, separated by `; ` before the next
// `test/` (a test name may itself hold `; `). Each identity must pass every time it ran in the report.
// Prints each offending row with its reason. Exits 0 when every row holds, 1 otherwise, 2 on bad input.
import { existsSync, readFileSync } from "node:fs";

const [checklistPath, reportPath] = process.argv.slice(2);
if (!checklistPath || !reportPath || !existsSync(checklistPath) || !existsSync(reportPath)) {
	process.stderr.write("usage: check-checklist.mjs <checklist.md> <report.json>\n");
	process.exit(2);
}

let report;
try {
	report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
	process.stderr.write(`cannot read the report: ${error.message}\n`);
	process.exit(2);
}
if (!Array.isArray(report.testResults)) {
	process.stderr.write("the report has no testResults\n");
	process.exit(2);
}

/** Per identity, how often it ran and how often it passed. */
const results = new Map();
for (const file of report.testResults) {
	if (typeof file?.name !== "string" || !Array.isArray(file.assertionResults)) {
		process.stderr.write("a report entry lacks a name or assertionResults\n");
		process.exit(2);
	}
	const name = file.name.replace(/.*packages\/coding-agent\//, "");
	for (const test of file.assertionResults) {
		const id = `${name} > ${test.fullName}`;
		const counts = results.get(id) ?? { runs: 0, passed: 0 };
		counts.runs++;
		if (test.status === "passed") counts.passed++;
		results.set(id, counts);
	}
}

const rows = readFileSync(checklistPath, "utf8")
	.split("\n")
	.filter((line) => line.startsWith("|") && !/^\|\s*(Old file|---)/.test(line));
if (rows.length === 0) {
	process.stderr.write("the checklist has no rows\n");
	process.exit(2);
}

const offending = [];
let covered = 0;
for (const row of rows) {
	const cells = row
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());
	if (cells.length !== 3) {
		offending.push(`${row}\n    malformed: expected three cells`);
		continue;
	}
	const [oldFile, status, covering] = cells;
	if (!/^test\/\S+\.test\.ts$/.test(oldFile)) {
		offending.push(`${row}\n    malformed old file "${oldFile}"`);
		continue;
	}
	if (status === "Phase 2" || status === "Phase 3" || /^Dropped: \S/.test(status)) continue;
	if (status !== "Covered") {
		offending.push(`${row}\n    unknown status "${status}"`);
		continue;
	}
	covered++;
	const ids = covering
		.split(/; (?=test\/)/)
		.map((id) => id.trim())
		.filter(Boolean);
	if (ids.length === 0) {
		offending.push(`${row}\n    lists no covering test`);
		continue;
	}
	const failing = ids.filter((id) => {
		const counts = results.get(id);
		return counts === undefined || counts.passed === 0 || counts.passed < counts.runs;
	});
	if (failing.length > 0) {
		offending.push(`${row}\n${failing.map((id) => `    does not pass: ${id}`).join("\n")}`);
	}
}

console.log(`rows: ${rows.length}, covered: ${covered}, offending: ${offending.length}`);
for (const entry of offending) console.log(entry);
process.exit(offending.length === 0 ? 0 : 1);

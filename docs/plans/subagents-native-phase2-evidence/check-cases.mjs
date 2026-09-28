// Checks the phase 2 old-case inventory and the mutation records mutate.mjs writes.
//
//   node check-cases.mjs inventory <old-cases.md>
//     Every row has a number, an old test, and a status `T<n>.<k>`, `Phase 1` or `Dropped: <reason>`.
//     A `Phase 1` row lists covering tests. Prints the count per status.
//   node check-cases.mjs mutations <mutations.txt> <case count>
//     Every case 1..<count> is named by an entry marked `caught`; no entry is `not caught`; the record
//     ends with "restored | 0 of <n> failed" and "clean: yes".
//   node check-cases.mjs coverage <old-cases.md> <report.json>[,<report.json>...] <mutations dir> [T<n>]
//     Every `T<n>.<k>` and `Phase 1` row lists covering tests, and each passes. With several reports, a
//     later report's result for an identity replaces an earlier one's, so a repair report discharges a
//     phase-run failure. For a `T<n>.<k>` row, at least one covering test failed an assertion under a
//     caught entry of <mutations dir>/T<n>.txt whose cases include k. With `T<n>`, only that task's rows
//     are checked, and `Phase 1` rows are skipped.
//
// Covering tests are vitest identities `<file relative to packages/coding-agent> > <full test name>`,
// separated by `; ` before the next `test/`. Each subcommand prints every offending row with its
// reason, exits 0 when none offends, 1 otherwise, and 2 on bad input.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function fail(message) {
	process.stderr.write(`check-cases: ${message}\n`);
	process.exit(2);
}

function read(path) {
	if (!path || !existsSync(path)) fail(`not found: ${path}`);
	return readFileSync(path, "utf8");
}

const TASK_CASE = /^T(\d+)\.(\d+)$/;

/** The inventory rows, each with its number, old test, status and covering identities. */
function inventory(path) {
	const rows = [];
	const offending = [];
	for (const line of read(path).split("\n")) {
		if (!line.startsWith("|") || /^\|\s*(#|---)/.test(line)) continue;
		const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
		if (cells.length !== 4) {
			offending.push(`${line}\n    malformed: expected four cells`);
			continue;
		}
		const [number, oldTest, status, covering] = cells;
		const ids = covering.split(/; (?=test\/)/).map((id) => id.trim()).filter(Boolean);
		const row = { line, number, oldTest, status, ids };
		if (!/^\d+$/.test(number) || !/^test\/\S+\.test\.ts > \S/.test(oldTest)) {
			offending.push(`${line}\n    malformed number or old test`);
		} else if (!TASK_CASE.test(status) && status !== "Phase 1" && !/^Dropped: \S/.test(status)) {
			offending.push(`${line}\n    unknown status "${status}"`);
		} else if (status === "Phase 1" && ids.length === 0) {
			offending.push(`${line}\n    a Phase 1 row lists no covering test`);
		}
		rows.push(row);
	}
	if (rows.length === 0) fail(`no rows in ${path}`);
	return { rows, offending };
}

/** The entries of one mutation record: id, cases, whether it was caught, and its failing tests. */
function mutationRecord(path) {
	const entries = [];
	let restored;
	let clean;
	let current;
	for (const line of read(path).split("\n")) {
		const entry = /^(\S+) \[([\d,]*)\] .*\| (\d+) of (\d+) failed, (caught|not caught)$/.exec(line);
		if (entry) {
			current = {
				id: entry[1],
				cases: entry[2] ? entry[2].split(",").map(Number) : [],
				caught: entry[5] === "caught",
				identities: [],
			};
			entries.push(current);
			continue;
		}
		const done = /^restored \| (\d+) of (\d+) failed$/.exec(line);
		if (done) {
			restored = Number(done[1]);
			current = undefined;
			continue;
		}
		if (/^clean: /.test(line)) {
			clean = line === "clean: yes";
			continue;
		}
		// `!` lines are infrastructure failures; they never count as a test that caught the mutation.
		if (current && line.startsWith("    ") && !line.startsWith("    ! ")) current.identities.push(line.trim());
	}
	return { entries, restored, clean };
}

/** Whether an identity passes; with several reports, a later report's result replaces an earlier one's. */
function passing(reportPaths) {
	const results = new Map();
	for (const reportPath of reportPaths) {
		let report;
		try {
			report = JSON.parse(read(reportPath));
		} catch (error) {
			fail(`the report is not JSON: ${reportPath}: ${error.message}`);
		}
		if (!Array.isArray(report.testResults)) fail(`the report has no testResults: ${reportPath}`);
		const own = new Map();
		for (const file of report.testResults) {
			const name = file.name.replace(/.*packages\/coding-agent\//, "");
			for (const test of file.assertionResults ?? []) {
				const id = `${name} > ${test.fullName}`;
				const counts = own.get(id) ?? { runs: 0, passed: 0 };
				counts.runs++;
				if (test.status === "passed") counts.passed++;
				own.set(id, counts);
			}
		}
		for (const [id, counts] of own) results.set(id, counts);
	}
	return (id) => {
		const counts = results.get(id);
		return counts !== undefined && counts.passed > 0 && counts.passed === counts.runs;
	};
}

function finish(offending, summary) {
	console.log(summary);
	for (const entry of offending) console.log(entry);
	process.exit(offending.length === 0 ? 0 : 1);
}

const [command, ...args] = process.argv.slice(2);
if (command === "inventory") {
	const { rows, offending } = inventory(args[0]);
	const counts = {};
	for (const row of rows) {
		const key = row.status.startsWith("Dropped") ? "Dropped" : row.status.replace(/\.\d+$/, "");
		counts[key] = (counts[key] ?? 0) + 1;
	}
	finish(offending, `rows: ${rows.length}, ${JSON.stringify(counts)}, offending: ${offending.length}`);
} else if (command === "mutations") {
	const [path, countArg] = args;
	const count = Number(countArg);
	if (!Number.isInteger(count) || count < 1) fail("usage: mutations <mutations.txt> <case count>");
	const { entries, restored, clean } = mutationRecord(path);
	const offending = [];
	for (const entry of entries) if (!entry.caught) offending.push(`${entry.id} was not caught`);
	for (let k = 1; k <= count; k++) {
		if (!entries.some((entry) => entry.cases.includes(k) && entry.caught)) {
			offending.push(`case ${k} has no caught mutation`);
		}
	}
	if (restored !== 0) offending.push(`the restored run did not pass (${restored ?? "missing"} failed)`);
	if (clean !== true) offending.push("the record does not end clean");
	finish(offending, `entries: ${entries.length}, cases: ${count}, offending: ${offending.length}`);
} else if (command === "coverage") {
	const [inventoryPath, reportPath, mutationsDir, onlyTask] = args;
	if (!mutationsDir || !existsSync(mutationsDir)) {
		fail("usage: coverage <old-cases.md> <report.json>[,<report.json>...] <mutations dir> [T<n>]");
	}
	if (onlyTask !== undefined && !/^T\d+$/.test(onlyTask)) fail(`not a task id: ${onlyTask}`);
	const { rows, offending } = inventory(inventoryPath);
	const passes = passing(reportPath.split(",").filter(Boolean));
	const records = new Map();
	for (const name of readdirSync(mutationsDir)) {
		const match = /^(T\d+)\.txt$/.exec(name);
		if (match) records.set(match[1], mutationRecord(join(mutationsDir, name)));
	}
	let checked = 0;
	for (const row of rows) {
		const task = TASK_CASE.exec(row.status);
		if (!task && row.status !== "Phase 1") continue;
		if (onlyTask !== undefined && (!task || `T${task[1]}` !== onlyTask)) continue;
		checked++;
		if (row.ids.length === 0) {
			offending.push(`${row.line}\n    lists no covering test`);
			continue;
		}
		const failing = row.ids.filter((id) => !passes(id));
		if (failing.length > 0) offending.push(`${row.line}\n${failing.map((id) => `    does not pass: ${id}`).join("\n")}`);
		if (!task) continue;
		const record = records.get(`T${task[1]}`);
		const caught = (record?.entries ?? [])
			.filter((entry) => entry.caught && entry.cases.includes(Number(task[2])))
			.flatMap((entry) => entry.identities);
		if (!row.ids.some((id) => caught.includes(id))) {
			offending.push(`${row.line}\n    no covering test failed under a mutation of case ${row.status}`);
		}
	}
	finish(offending, `rows: ${rows.length}, checked: ${checked}, offending: ${offending.length}`);
} else {
	fail("usage: check-cases.mjs inventory|mutations|coverage ...");
}

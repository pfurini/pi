// Compares test identities between a baseline and a candidate vitest JSON report written by
// .pi/skills/planning-changes/scripts/failing-tests.mjs.
//
//   node test-identities.mjs <baseline.json> <candidate.json> [removed-list.txt]
//
// Every test that passed in the baseline must pass in the candidate as often, unless the
// removed list names it. Identities count with multiplicity, because a file can hold two
// tests with the same full name. A list line is `<file relative to packages/coding-agent> > <full test name>`.
// Prints the missing, failing and added counts, then each missing or failing identity.
// Exits 0 when nothing is missing or failing, 1 otherwise, 2 on bad input.
import { existsSync, readFileSync } from "node:fs";

const [baselinePath, candidatePath, removedPath] = process.argv.slice(2);
if (!baselinePath || !candidatePath || !existsSync(baselinePath) || !existsSync(candidatePath)) {
	process.stderr.write("usage: test-identities.mjs <baseline.json> <candidate.json> [removed-list.txt]\n");
	process.exit(2);
}

/** Per identity, how often it ran and how often it passed. */
function statuses(path) {
	const report = JSON.parse(readFileSync(path, "utf8"));
	const map = new Map();
	for (const file of report.testResults) {
		const name = file.name.replace(/.*packages\/coding-agent\//, "");
		for (const test of file.assertionResults) {
			const id = `${name} > ${test.fullName}`;
			const counts = map.get(id) ?? { runs: 0, passed: 0 };
			counts.runs++;
			if (test.status === "passed") counts.passed++;
			map.set(id, counts);
		}
	}
	return map;
}

const removed = new Set(
	removedPath
		? readFileSync(removedPath, "utf8")
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
		: [],
);
const baseline = statuses(baselinePath);
const candidate = statuses(candidatePath);
const missing = [];
const failing = [];
for (const [id, counts] of baseline) {
	if (counts.passed === 0 || removed.has(id)) continue;
	const now = candidate.get(id);
	if (now === undefined || now.runs < counts.passed) missing.push(`${id} (${now?.runs ?? 0} of ${counts.passed})`);
	else if (now.passed < counts.passed) failing.push(`${id} (${now.passed} of ${counts.passed} passed)`);
}
const added = [...candidate.keys()].filter((id) => !baseline.has(id)).length;
console.log(`missing: ${missing.length}, failing: ${failing.length}, added: ${added}`);
for (const id of missing) console.log(`  missing ${id}`);
for (const id of failing) console.log(`  failing ${id}`);
process.exit(missing.length + failing.length === 0 ? 0 : 1);

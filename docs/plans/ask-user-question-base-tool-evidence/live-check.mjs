// Checks that a marked prompt led to an answered ask_user_question questionnaire.
//
//   node live-check.mjs <marker> [sessions dir, default ~/.pi/agent/sessions]
//
// Passes (exit 0) when exactly one `*.jsonl` file under the sessions directory has a user
// message holding the marker, and after the first such message that file has at least one
// `toolResult` for `ask_user_question` with `isError` false, `details.cancelled` false and at
// least one answer. Prints one JSON line. Exits 1 on a failed check, 2 on bad input. It only
// reads files. Only user messages count as the marker, because the session that runs this
// check also records the marker, in its assistant text and tool calls.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [marker, dir = join(homedir(), ".pi", "agent", "sessions")] = process.argv.slice(2);
if (!marker) {
	process.stderr.write("usage: live-check.mjs <marker> [sessions dir]\n");
	process.exit(2);
}

function sessionFiles(root) {
	return readdirSync(root).flatMap((name) => {
		const path = join(root, name);
		if (statSync(path).isDirectory()) return sessionFiles(path);
		return name.endsWith(".jsonl") ? [path] : [];
	});
}

function entries(path) {
	return readFileSync(path, "utf8")
		.split("\n")
		.flatMap((line) => {
			try {
				return line.trim() ? [JSON.parse(line)] : [];
			} catch {
				return [];
			}
		});
}

function userTyped(entry) {
	return entry?.type === "message" && entry.message?.role === "user" && JSON.stringify(entry.message.content).includes(marker);
}

function askResult(entry) {
	const message = entry?.message;
	return entry?.type === "message" && message?.role === "toolResult" && message.toolName === "ask_user_question";
}

const files = sessionFiles(dir).filter((path) => readFileSync(path, "utf8").includes(marker) && entries(path).some(userTyped));
let after = [];
if (files.length === 1) {
	const all = entries(files[0]);
	after = all.slice(all.findIndex(userTyped) + 1).filter(askResult);
}
const answered = after.filter(
	(entry) =>
		entry.message.isError !== true &&
		entry.message.details?.cancelled === false &&
		(entry.message.details?.answers?.length ?? 0) > 0,
);
const pass = files.length === 1 && answered.length > 0;
console.log(JSON.stringify({ marker, files, askResultsAfterMarker: after.length, answered: answered.length, pass }));
process.exit(pass ? 0 : 1);

// Removes or restores one `packages` entry of a Pi settings file, under the lock Pi itself takes
// (`proper-lockfile`, `realpath: false`, as `FileSettingsStorage.withLock` in settings-manager.ts).
//
//   node settings-entry.mjs [--save <prefix>] <settings.json> remove <entry>
//   node settings-entry.mjs [--save <prefix>] <settings.json> add <entry> <after-entry>
//
// With `--save`, it writes the text it read to `<prefix>.before` and the text it wrote to
// `<prefix>.after`, both while it holds the lock and before it writes the settings file, so a
// comparison of the two shows only this edit even when another session changes the file before or
// after. Each save file must not exist yet. After exit 3, `.after` holds the text that was not written.
//
// `remove` requires the entry exactly once. `add` requires it absent and inserts it right after
// <after-entry>, which must be present. The file must equal `JSON.stringify(parsed, null, 2)`, as Pi
// writes it, so the edit changes only the one entry's line, and it must not be a symlink. While it holds
// the lock, the helper writes the new text to a sibling temporary file created with `wx` and the file's
// mode, syncs it, and renames it over the file, so a failed write never leaves a partial file. It prints
// the SHA-256 before and after. Exit 0: written. Exit 1: a precondition failed; nothing was written.
// Exit 3: the write failed; the helper re-read the file under the lock and found it byte-identical, and
// removed the temporary file. Exit 4: the write failed and the re-read file differs. Exit 2: bad input.
// The lock wait is 5 s at most.
import { createHash } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const lockfile = require("proper-lockfile");

const args = process.argv.slice(2);
let save;
if (args[0] === "--save") {
	save = args[1];
	args.splice(0, 2);
}
const [path, action, entry, after] = args;
if (save !== undefined && (!save || existsSync(`${save}.before`) || existsSync(`${save}.after`))) {
	process.stderr.write("settings-entry: --save needs a prefix whose .before and .after files do not exist\n");
	process.exit(2);
}
if (!path || !entry || !["remove", "add"].includes(action) || (action === "add" && !after) || !existsSync(path)) {
	process.stderr.write("usage: settings-entry.mjs <settings.json> remove <entry> | add <entry> <after-entry>\n");
	process.exit(2);
}

const sha = (text) => createHash("sha256").update(text).digest("hex");
const refuse = (message) => {
	process.stderr.write(`settings-entry: ${message}; nothing written\n`);
	return 1;
};

if (lstatSync(path).isSymbolicLink()) {
	process.stderr.write(`settings-entry: ${path} is a symlink; nothing written\n`);
	process.exit(1);
}

let release;
for (let attempt = 0; !release; attempt++) {
	try {
		release = lockfile.lockSync(path, { realpath: false });
	} catch (error) {
		if (error?.code !== "ELOCKED" || attempt >= 250) {
			process.stderr.write(`settings-entry: cannot lock ${path}: ${error?.message ?? error}\n`);
			process.exit(1);
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

let code;
try {
	code = (() => {
		const before = readFileSync(path, "utf8");
		let settings;
		try {
			settings = JSON.parse(before);
		} catch (error) {
			return refuse(`${path} is not JSON (${error.message})`);
		}
		if (JSON.stringify(settings, null, 2) !== before) return refuse(`${path} is not in Pi's own format`);
		const packages = settings.packages;
		if (!Array.isArray(packages)) return refuse("no packages array");
		const count = packages.filter((item) => item === entry).length;
		if (action === "remove") {
			if (count !== 1) return refuse(`"${entry}" occurs ${count} times, not once`);
			settings.packages = packages.filter((item) => item !== entry);
		} else {
			if (count !== 0) return refuse(`"${entry}" is already present`);
			const index = packages.indexOf(after);
			if (index < 0) return refuse(`"${after}" is absent`);
			settings.packages = [...packages.slice(0, index + 1), entry, ...packages.slice(index + 1)];
		}
		const next = JSON.stringify(settings, null, 2);
		if (save !== undefined) {
			// Both records come first: a failure here leaves the settings file untouched.
			try {
				writeFileSync(`${save}.before`, before, { flag: "wx" });
				writeFileSync(`${save}.after`, next, { flag: "wx" });
			} catch (error) {
				return refuse(`cannot save the records (${error?.message ?? error})`);
			}
		}
		const temporary = `${path}.${process.pid}.settings-entry.tmp`;
		let created = false;
		try {
			const fd = openSync(temporary, "wx", lstatSync(path).mode & 0o7777);
			created = true;
			try {
				const bytes = Buffer.from(next, "utf8");
				for (let offset = 0; offset < bytes.length; ) offset += writeSync(fd, bytes, offset);
				fsyncSync(fd);
			} finally {
				closeSync(fd);
			}
			renameSync(temporary, path);
			created = false;
		} catch (error) {
			if (created) unlinkSync(temporary);
			const unchanged = readFileSync(path, "utf8") === before;
			process.stderr.write(
				`settings-entry: write failed (${error?.message ?? error}); ${path} is ${unchanged ? "unchanged" : "CHANGED"}\n`,
			);
			return unchanged ? 3 : 4;
		}
		console.log(`before ${sha(before)}`);
		console.log(`after ${sha(next)}`);
		return 0;
	})();
} finally {
	release();
}
process.exit(code);

#!/usr/bin/env node
// Regenerates metadata-only SKILL.md conformance snapshots from pinned ASE/gstack Git
// commits and either writes them (default) or byte-compares them against the committed
// snapshots (--verify). Reads pinned Git objects only, never mutable working-tree files;
// changing either pin requires a plan amendment and regenerated expected counts.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
	cwd: SCRIPT_DIR,
	encoding: "utf8",
}).trim();
const FIXTURES_DIR = join(REPO_ROOT, "packages/coding-agent/test/suite/fixtures/skills-contract");

const REPOSITORIES = [
	{
		name: "ase",
		url: "https://github.com/pfurini/ase.git",
		commit: "bf86d97f90d3c2cddca8428b15de8bccd971cb0a",
		expectedCount: 48,
		snapshotFile: join(FIXTURES_DIR, "ase-frontmatter.snapshot.json"),
	},
	{
		name: "gstack",
		url: "https://github.com/pfurini/gstack",
		commit: "8d6f0a0797ba03de4c5b3c73d702a7b7c9132a16",
		expectedCount: 59,
		snapshotFile: join(FIXTURES_DIR, "gstack-frontmatter.snapshot.json"),
	},
];

// Mirrors src/utils/frontmatter.ts's extraction rule so the snapshot's raw YAML matches
// exactly what Pi's own loader would extract from the same SKILL.md content.
function extractFrontmatterYaml(content) {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---")) {
		return null;
	}
	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		return null;
	}
	return normalized.slice(4, endIndex);
}

function buildSnapshot(repo) {
	const tempDir = mkdtempSync(join(tmpdir(), `pi-skill-verify-${repo.name}-`));
	try {
		execFileSync("git", ["init", "-q"], { cwd: tempDir });
		execFileSync("git", ["remote", "add", "origin", repo.url], { cwd: tempDir });
		execFileSync("git", ["fetch", "--depth=1", "origin", repo.commit], { cwd: tempDir, stdio: "pipe" });
		const tree = execFileSync("git", ["rev-parse", "FETCH_HEAD^{tree}"], {
			cwd: tempDir,
			encoding: "utf8",
		}).trim();
		const lsTreeOutput = execFileSync("git", ["ls-tree", "-r", "--full-tree", "FETCH_HEAD"], {
			cwd: tempDir,
			encoding: "utf8",
		});

		const skillBlobs = [];
		for (const line of lsTreeOutput.split("\n")) {
			if (!line) continue;
			const tabIndex = line.indexOf("\t");
			const meta = line.slice(0, tabIndex);
			const path = line.slice(tabIndex + 1);
			if (path.split("/").pop() !== "SKILL.md") continue;
			const [, type, blob] = meta.split(" ");
			if (type !== "blob") continue;
			skillBlobs.push({ path, blob });
		}
		skillBlobs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

		if (skillBlobs.length !== repo.expectedCount) {
			throw new Error(
				`${repo.name}: expected ${repo.expectedCount} SKILL.md files at ${repo.commit}, found ${skillBlobs.length}`,
			);
		}

		const skills = skillBlobs.map(({ path, blob }) => {
			const content = execFileSync("git", ["cat-file", "-p", blob], { cwd: tempDir, encoding: "utf8" });
			const yamlText = extractFrontmatterYaml(content);
			if (yamlText === null) {
				throw new Error(`${repo.name}: ${path} (${blob}) has no parsable frontmatter block`);
			}
			const expected = parseYaml(yamlText);
			return { path, blob, yaml: yamlText, expected };
		});

		return { repository: repo.url, revision: repo.commit, tree, skills };
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

function canonicalSnapshotJson(snapshot) {
	return `${JSON.stringify(snapshot, null, 2)}\n`;
}

function main() {
	const verifyMode = process.argv.includes("--verify");
	let failed = false;

	for (const repo of REPOSITORIES) {
		let snapshot;
		try {
			snapshot = buildSnapshot(repo);
		} catch (error) {
			console.error(`FAIL ${repo.name}: ${error instanceof Error ? error.message : String(error)}`);
			failed = true;
			continue;
		}

		const serialized = canonicalSnapshotJson(snapshot);
		if (verifyMode) {
			let committed;
			try {
				committed = readFileSync(repo.snapshotFile, "utf8");
			} catch {
				console.error(`FAIL ${repo.name}: committed snapshot missing at ${repo.snapshotFile}`);
				failed = true;
				continue;
			}
			if (committed !== serialized) {
				console.error(`FAIL ${repo.name}: regenerated snapshot differs from committed ${repo.snapshotFile}`);
				failed = true;
				continue;
			}
			console.log(`OK ${repo.name}: ${snapshot.skills.length} skills verified byte-exactly against ${repo.commit}`);
		} else {
			mkdirSync(dirname(repo.snapshotFile), { recursive: true });
			writeFileSync(repo.snapshotFile, serialized);
			console.log(`WROTE ${repo.name}: ${snapshot.skills.length} skills from ${repo.commit}`);
		}
	}

	if (failed) {
		process.exit(1);
	}
}

main();

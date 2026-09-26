import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	applyRulesBlock,
	buildRulesBlock,
	installRulesBlock,
	removeRulesBlock,
	stripRulesBlock,
} from "../../../src/core/fork-builtins/tokensave/rules.ts";

function tmpFile(name = "AGENTS.md"): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-tokensave-rules-"));
	return join(dir, name);
}

test("installRulesBlock creates the file when missing", () => {
	const path = tmpFile();
	expect(existsSync(path)).toBe(false);

	const { changed } = installRulesBlock(path);
	expect(changed).toBe(true);
	expect(existsSync(path)).toBeTruthy();
	const content = readFileSync(path, "utf8");
	expect(content.includes("<!-- pi-tokensave:start -->")).toBeTruthy();
	expect(content.includes("<!-- pi-tokensave:end -->")).toBeTruthy();
});

test("applyRulesBlock appends to existing content without touching it", () => {
	const original = "# My AGENTS.md\n\nSome existing instructions.\n";
	const { content, changed } = applyRulesBlock(original);
	expect(changed).toBe(true);
	expect(content.startsWith("# My AGENTS.md\n\nSome existing instructions.")).toBeTruthy();
	expect(content.includes("<!-- pi-tokensave:start -->")).toBeTruthy();
});

test("applyRulesBlock does not duplicate an existing up-to-date block", () => {
	const once = applyRulesBlock("Existing content\n").content;
	const twice = applyRulesBlock(once).content;
	expect(once).toBe(twice);
	expect(once.split("<!-- pi-tokensave:start -->").length - 1).toBe(1);
});

test("applyRulesBlock updates an old block to the current version", () => {
	const oldBlock =
		"<!-- pi-tokensave:start -->\n<!-- pi-tokensave:version=0 -->\n\nOld content\n\n<!-- pi-tokensave:end -->";
	const original = `Before.\n\n${oldBlock}\n\nAfter.\n`;

	const { content, changed } = applyRulesBlock(original, "1");
	expect(changed).toBe(true);
	expect(content.includes("Before.")).toBeTruthy();
	expect(content.includes("After.")).toBeTruthy();
	expect(!content.includes("Old content")).toBeTruthy();
	expect(content.includes(buildRulesBlock("1"))).toBeTruthy();
});

test("the rules tell the model to fall back when a TokenSave tool is unavailable or blocked", () => {
	const block = buildRulesBlock();
	expect(
		block.includes(
			"When a TokenSave tool is unavailable or\nblocked in the current turn, also use Pi's normal tools directly.",
		),
	).toBeTruthy();

	// An installed version-2 block is replaced in place; the rest of the file is kept.
	const v2 = buildRulesBlock("2").replace(
		/ When a TokenSave tool is unavailable or\nblocked in the current turn, also use Pi's normal tools directly\./,
		"",
	);
	const original = `# Global\n\n${v2}\n\nMore rules.\n`;
	const { content, changed } = applyRulesBlock(original);
	expect(changed).toBe(true);
	expect(content).toBe(`# Global\n\n${block}\n\nMore rules.\n`);
});

test("stripRulesBlock removes only the managed block and preserves surrounding content", () => {
	const before = "Line before.\n";
	const after = "\nLine after.\n";
	const original = `${before}\n${buildRulesBlock()}\n${after}`;

	const { content, changed } = stripRulesBlock(original);
	expect(changed).toBe(true);
	expect(content.includes("Line before.")).toBeTruthy();
	expect(content.includes("Line after.")).toBeTruthy();
	expect(!content.includes("pi-tokensave:start")).toBeTruthy();
});

test("stripRulesBlock is a no-op when no block is present", () => {
	const original = "Just some content.\n";
	const { content, changed } = stripRulesBlock(original);
	expect(changed).toBe(false);
	expect(content).toBe(original);
});

test("removeRulesBlock on disk only strips the block", () => {
	const path = tmpFile();
	installRulesBlock(path);
	const before = readFileSync(path, "utf8");
	expect(before.includes("pi-tokensave:start")).toBeTruthy();

	const { changed } = removeRulesBlock(path);
	expect(changed).toBe(true);
	const after = readFileSync(path, "utf8");
	expect(!after.includes("pi-tokensave:start")).toBeTruthy();
});

test("installRulesBlock on an empty file produces just the block with a trailing newline", () => {
	const path = tmpFile();
	installRulesBlock(path);
	const content = readFileSync(path, "utf8");
	expect(content.endsWith("<!-- pi-tokensave:end -->\n")).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Byte-for-byte preservation of content outside the managed block
// ---------------------------------------------------------------------------

function roundTrip(original: string): string {
	const installed = applyRulesBlock(original).content;
	return stripRulesBlock(installed).content;
}

test("preserves trailing spaces on the last line", () => {
	const original = "Some notes.   ";
	expect(roundTrip(original)).toBe(original);
});

test("preserves content with no terminal newline", () => {
	const original = "# AGENTS.md\n\nNo trailing newline here";
	expect(roundTrip(original)).toBe(original);
});

test("preserves multiple terminal newlines", () => {
	const original = "# AGENTS.md\n\nSome instructions.\n\n\n\n";
	expect(roundTrip(original)).toBe(original);
});

test("preserves multiple blank lines before and after unrelated sections", () => {
	const original = "Section A.\n\n\n\nSection B.\n\n\nSection C.\n";
	expect(roundTrip(original)).toBe(original);
});

test("preserves CRLF content", () => {
	const original = "# AGENTS.md\r\n\r\nSome CRLF instructions.\r\n";
	const installed = applyRulesBlock(original).content;
	expect(installed.startsWith(original)).toBeTruthy();
	expect(stripRulesBlock(installed).content).toBe(original);
});

test("replaces an old block in the middle of the file without touching content before or after it", () => {
	const before = "Intro paragraph.\n";
	const after = "Trailing paragraph.\n";
	const oldBlock =
		"<!-- pi-tokensave:start -->\n<!-- pi-tokensave:version=0 -->\n\nOld content\n\n<!-- pi-tokensave:end -->";
	const original = `${before}\n${oldBlock}\n\n${after}`;

	const { content } = applyRulesBlock(original, "1");
	expect(content.startsWith(`${before}\n`)).toBeTruthy();
	expect(content.endsWith(`\n\n${after}`)).toBeTruthy();
	expect(!content.includes("Old content")).toBeTruthy();
	expect(content.includes(buildRulesBlock("1"))).toBeTruthy();
});

test("removal restores the original content exactly for a freshly installed block", () => {
	const originals = [
		"",
		"Hello world",
		"Hello world.\n",
		"Hello world.\n\n\n\n",
		"Trailing spaces here.   ",
		"CRLF content.\r\n\r\n",
	];
	for (const original of originals) {
		expect(roundTrip(original), `round-trip mismatch for ${JSON.stringify(original)}`).toBe(original);
	}
});

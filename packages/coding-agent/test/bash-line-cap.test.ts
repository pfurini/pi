import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Container } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forgetTempFile } from "../src/core/temp-file-registry.ts";
import { createBashTool, createBashToolDefinition } from "../src/core/tools/bash.ts";
import { OutputAccumulator, type OutputSnapshot } from "../src/core/tools/output-accumulator.ts";
import { capLineLengths } from "../src/core/tools/truncate.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const MARKER = /\.\.\. \[truncated \d+ chars\] \.\.\./;

function toBashSingleQuotedArg(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function getTextOutput(result: { content?: Array<{ type: string; text?: string }> }): string {
	return (
		result.content
			?.filter((block) => block.type === "text")
			.map((block) => block.text ?? "")
			.join("\n") ?? ""
	);
}

describe("capLineLengths", () => {
	it("leaves short lines byte-identical, CRLF and trailing newline included", () => {
		const input = "first\r\nsecond line\nthird\n";
		const result = capLineLengths(input, { minChars: 20, maxBytes: 1024 });

		expect(result.content).toBe(input);
		expect(result.cappedCount).toBe(0);
		expect(result.cappedLines).toEqual([false, false, false]);
	});

	it("keeps both ends of an over-long line without changing the line count", () => {
		const input = `head\nSTART${"x".repeat(5000)}FINISH\ntail`;
		const result = capLineLengths(input, { minChars: 100, maxBytes: 300 });

		const lines = result.content.split("\n");
		expect(lines).toHaveLength(3);
		expect(lines[0]).toBe("head");
		expect(lines[1].startsWith("START")).toBe(true);
		expect(lines[1].endsWith("FINISH")).toBe(true);
		expect(lines[1]).toMatch(MARKER);
		expect(lines[2]).toBe("tail");
		expect(result.cappedLines).toEqual([false, true, false]);
	});

	it("gives one line the whole budget and many lines a share each", () => {
		const one = capLineLengths("z".repeat(500_000), { minChars: 1000, maxBytes: 51_200 });
		expect(one.allowance).toBe(51_200 - 40 - 1);
		// The excerpt plus its marker still fits the budget it was given.
		expect(one.content.length).toBeLessThanOrEqual(51_200);

		const forty = capLineLengths(`${Array.from({ length: 40 }, () => "z".repeat(5000)).join("\n")}\n`, {
			minChars: 1000,
			maxBytes: 51_200,
		});
		expect(forty.allowance).toBe(Math.floor(51_200 / 40) - 40 - 1);
		expect(forty.cappedCount).toBe(40);
	});

	it("never drops below the minChars floor when lines are numerous", () => {
		const many = capLineLengths(`${Array.from({ length: 2000 }, () => "z".repeat(3000)).join("\n")}\n`, {
			minChars: 1000,
			maxBytes: 51_200,
		});

		// A fair share would be 25 chars; the floor wins.
		expect(many.allowance).toBe(1000);
	});

	it("does not split BMP characters at the cut", () => {
		const cjk = "漢".repeat(2000);
		const result = capLineLengths(`before\n${cjk}\nafter`, { minChars: 100, maxBytes: 400 });

		expect(result.content).not.toContain("\uFFFD");
		expect(result.cappedCount).toBe(1);
	});

	it("does not split surrogate pairs at either cut", () => {
		// An odd leading char forces both cuts to land mid-pair.
		const astral = `a${"\u{1F600}".repeat(2000)}`;
		const result = capLineLengths(`${astral}\n${astral}`, { minChars: 101, maxBytes: 300 });

		// A lone surrogate silently becomes U+FFFD on UTF-8 encoding.
		expect(Buffer.from(result.content, "utf-8").toString("utf-8")).not.toContain("\uFFFD");
		expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result.content)).toBe(false);
		expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result.content)).toBe(false);
		expect(result.cappedCount).toBe(2);
	});

	it("returns everything unchanged when disabled", () => {
		const input = `${"x".repeat(5000)}\nshort\n`;
		const result = capLineLengths(input, { minChars: 0, maxBytes: 100 });

		expect(result.content).toBe(input);
		expect(result.cappedCount).toBe(0);
		expect(result.cappedLines).toEqual([false, false]);
	});

	it("handles empty content and a single unterminated line", () => {
		expect(capLineLengths("", { minChars: 100, maxBytes: 1024 }).content).toBe("");
		expect(capLineLengths("", { minChars: 100, maxBytes: 1024 }).cappedLines).toEqual([]);

		const single = capLineLengths("y".repeat(3000), { minChars: 100, maxBytes: 300 });
		expect(single.content.split("\n")).toHaveLength(1);
		expect(single.cappedCount).toBe(1);
	});
});

describe("OutputAccumulator line cap", () => {
	const trackedPaths = new Set<string>();

	afterEach(() => {
		for (const path of trackedPaths) {
			rmSync(path, { force: true });
			forgetTempFile(path);
		}
		trackedPaths.clear();
	});

	function track(snapshot: OutputSnapshot): void {
		if (snapshot.fullOutputPath) trackedPaths.add(snapshot.fullOutputPath);
	}

	it("leaves long lines alone while the output fits the budget", () => {
		const accumulator = new OutputAccumulator({
			maxBytes: 8 * 1024,
			maxLines: 50,
			minLineChars: 100,
			tempFilePrefix: "pi-line-cap-test",
		});
		const long = "y".repeat(500);
		accumulator.append(Buffer.from(`short one\n${long}\nshort two\n${long}\n`));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		track(snapshot);

		// Under every limit, so every byte reaches the model untouched: shortening a
		// line here would drop content for nothing.
		expect(snapshot.truncation.truncated).toBe(false);
		expect(snapshot.cappedLineCount).toBe(0);
		expect(snapshot.lineCapChars).toBe(0);
		expect(snapshot.content).toBe(`short one\n${long}\nshort two\n${long}\n`);
		expect(snapshot.fullOutputPath).toBeUndefined();
	});

	it("spends the byte budget on more lines once over it", async () => {
		const accumulator = new OutputAccumulator({
			maxBytes: 600,
			maxLines: 50,
			minLineChars: 100,
			tempFilePrefix: "pi-line-cap-test",
		});
		for (let index = 0; index < 3; index++) accumulator.append(Buffer.from(`${"x".repeat(400)}\n`));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		track(snapshot);
		await accumulator.closeTempFile();

		// Untouched, 400-char lines would blow the 600-byte budget after one line;
		// shortened, all three fit.
		expect(snapshot.content.split("\n")).toHaveLength(4);
		expect(snapshot.cappedLineCount).toBe(3);
		expect(snapshot.truncation.outputLines).toBe(3);
		expect(snapshot.truncation.totalLines).toBe(3);
	});

	it("keeps both ends of a giant line that fits the rolling buffer", async () => {
		const accumulator = new OutputAccumulator({
			maxBytes: 50 * 1024,
			maxLines: 2000,
			minLineChars: 1000,
			tempFilePrefix: "pi-line-cap-test",
		});
		// One 150KB line, no newline: `curl` of a JSON API, `cat` of a minified bundle.
		accumulator.append(Buffer.from(`START${"a".repeat(150_000)}END`));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		track(snapshot);
		await accumulator.closeTempFile();

		expect(snapshot.cappedLineCount).toBe(1);
		expect(snapshot.content.startsWith("START")).toBe(true);
		expect(snapshot.content.endsWith("END")).toBe(true);
		expect(snapshot.content).toMatch(MARKER);
		// The whole budget went to the one line that had to share it with nobody.
		expect(snapshot.lineCapChars).toBeGreaterThan(50_000);
		expect(snapshot.truncation.lastLinePartial).toBe(false);
		expect(readFileSync(snapshot.fullOutputPath ?? "", "utf-8").endsWith("END")).toBe(true);
	});

	it("keeps only the end of a line larger than the rolling buffer", async () => {
		const accumulator = new OutputAccumulator({
			maxBytes: 50 * 1024,
			maxLines: 2000,
			minLineChars: 1000,
			tempFilePrefix: "pi-line-cap-test",
		});
		accumulator.append(Buffer.from(`START${"a".repeat(2_000_000)}END`));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		track(snapshot);
		await accumulator.closeTempFile();

		// Known limit: the rolling tail buffer discards the head long before capping
		// runs, so beyond ~200KB the excerpt's head is an interior offset, not the
		// line's start. The true end still survives, and the temp file stays complete.
		expect(snapshot.content.endsWith("END")).toBe(true);
		expect(snapshot.content.startsWith("START")).toBe(false);
		expect(readFileSync(snapshot.fullOutputPath ?? "", "utf-8").startsWith("START")).toBe(true);
	});

	it("counts only shortened lines that survive tail truncation", async () => {
		const accumulator = new OutputAccumulator({
			maxBytes: 1000,
			maxLines: 2,
			minLineChars: 100,
			tempFilePrefix: "pi-line-cap-test",
		});
		accumulator.append(Buffer.from(`${"a".repeat(300)}\nshort\nshort\n${"b".repeat(300)}\nlast\n`));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		track(snapshot);
		await accumulator.closeTempFile();

		// Only the last two lines are shown; the long "a" line was dropped whole.
		expect(snapshot.truncation.outputLines).toBe(2);
		expect(snapshot.content.startsWith("b".repeat(50))).toBe(true);
		expect(snapshot.cappedLineCount).toBe(1);
	});

	it("does not shorten when disabled", async () => {
		const accumulator = new OutputAccumulator({
			maxBytes: 1024,
			maxLines: 50,
			minLineChars: 0,
			tempFilePrefix: "pi-line-cap-test",
		});
		accumulator.append(Buffer.from(`${"z".repeat(2000)}\n`));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		track(snapshot);
		await accumulator.closeTempFile();

		expect(snapshot.cappedLineCount).toBe(0);
		expect(snapshot.lineCapChars).toBe(0);
		// Over budget with no shortening available: the pre-existing tail path handles it.
		expect(snapshot.truncation.lastLinePartial).toBe(true);
	});

	it("keeps the raw bytes recoverable from the temp file", async () => {
		const accumulator = new OutputAccumulator({
			maxBytes: 600,
			maxLines: 50,
			minLineChars: 100,
			tempFilePrefix: "pi-line-cap-test",
		});
		const long = "y".repeat(2000);
		accumulator.append(Buffer.from(`${long}\nshort\n`));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		track(snapshot);
		await accumulator.closeTempFile();

		expect(snapshot.cappedLineCount).toBeGreaterThan(0);
		expect(snapshot.fullOutputCapped).toBe(false);
		expect(readFileSync(snapshot.fullOutputPath ?? "", "utf-8")).toContain(long);
	});
});

describe("bash tool line cap", () => {
	let testDir: string;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "pi-bash-line-cap-test-"));
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	function cleanup(details: { fullOutputPath?: string } | undefined): void {
		if (!details?.fullOutputPath) return;
		rmSync(details.fullOutputPath, { force: true });
		forgetTempFile(details.fullOutputPath);
	}

	it("leaves a long line intact when the output fits the budget", async () => {
		const bashTool = createBashTool(testDir);
		const long = "z".repeat(1500);
		const command = `printf '%s\n%s\n' ${toBashSingleQuotedArg(long)} short`;
		const result = await bashTool.execute("test-linecap-underbudget", { command });

		expect(getTextOutput(result)).toContain(long);
		expect((result as { details?: unknown }).details).toBeUndefined();
	});

	it("reports shortened lines and points at the raw full-output file", async () => {
		const bashTool = createBashTool(testDir);
		const command = "node -e \"for(let i=0;i<40;i++)console.log('L'+i+'_'+'z'.repeat(1400))\"";
		const result = await bashTool.execute("test-linecap-footer", { command });
		const text = getTextOutput(result);
		const details = (result as { details?: { fullOutputPath?: string } }).details;

		expect(text).toContain("Showing all 40 lines");
		expect(text).toMatch(/40 lines capped at \d+ chars/);
		expect(text).toContain("Full output:");
		expect(text.endsWith("]")).toBe(true);
		expect(readFileSync(details?.fullOutputPath ?? "", "utf-8")).toContain("z".repeat(1400));
		cleanup(details);
	});

	it("keeps both ends of a command whose output is one giant line", async () => {
		const bashTool = createBashTool(testDir);
		const command = "node -e \"process.stdout.write('THE_START'+'a'.repeat(150000)+'THE_END')\"";
		const result = await bashTool.execute("test-linecap-giant", { command });
		const text = getTextOutput(result);
		const details = (result as { details?: { fullOutputPath?: string } }).details;

		// A single-line JSON response needs its opening keys and its final values.
		expect(text).toContain("THE_START");
		expect(text).toContain("THE_END");
		expect(text).toMatch(MARKER);
		cleanup(details);
	});

	function render(result: unknown, command: string): string {
		// Same definition on both sides: the wrapper runs it, the definition renders it.
		const component = createBashToolDefinition(testDir).renderResult?.(
			result as never,
			{ expanded: true, isPartial: false },
			theme,
			{
				args: { command },
				toolCallId: "test-linecap-render",
				invalidate: () => {},
				lastComponent: undefined,
				state: {},
				cwd: testDir,
				executionStarted: true,
				showImages: false,
				isError: false,
			} as never,
		);
		const container = new Container();
		if (component) container.addChild(component);
		return stripAnsi(container.render(200).join("\n"));
	}

	it("renders the full-output path once", async () => {
		const command = "node -e \"for(let i=0;i<40;i++)console.log('L'+i+'_'+'z'.repeat(1400))\"";
		const result = await createBashTool(testDir).execute("test-linecap-render", { command });
		const details = (result as { details?: { fullOutputPath?: string } }).details;
		const fullOutputPath = details?.fullOutputPath ?? "";
		const rendered = render(result, command);

		expect(fullOutputPath).not.toBe("");
		expect(rendered.split(fullOutputPath).length - 1).toBe(1);
		expect(rendered).toMatch(/40 lines capped at \d+ chars/);
		cleanup(details);
	});

	it("renders a capped temp file as a prefix, not as the full output", () => {
		const rendered = render(
			{
				content: [{ type: "text", text: "some output" }],
				details: { fullOutputPath: "/tmp/pi-bash-example.log", fullOutputCapped: { bytes: 5 * 1024 * 1024 } },
			},
			"cat huge.log",
		);

		// The file holds a prefix; calling it the full output sends the reader looking
		// for content that was never written.
		expect(rendered).toContain("First 5.0MB saved to: /tmp/pi-bash-example.log");
		expect(rendered).not.toContain("Full output:");
	});
});

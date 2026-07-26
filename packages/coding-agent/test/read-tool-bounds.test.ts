import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { createReadToolDefinition, MAX_READ_FILE_BYTES, type ReadOperations } from "../src/core/tools/read.ts";

type ReadTool = ReturnType<typeof createReadToolDefinition>;

/** execute() types ctx as required, but the tool only reads ctx?.model. */
function runRead(tool: ReadTool, args: { path: string; offset?: number; limit?: number }) {
	return tool.execute("call", args, undefined, undefined, {} as ExtensionContext);
}

/** Text of the first content block, which is where the read tool puts file contents. */
function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

describe("read tool input bounds", () => {
	let testDirectory: string;

	beforeEach(() => {
		testDirectory = mkdtempSync(join(tmpdir(), "pi-read-bounds-"));
	});

	afterEach(() => {
		rmSync(testDirectory, { recursive: true, force: true });
	});

	/** Real file on disk (so path resolution works) with ops that report whatever size the test wants. */
	function createTool(fileName: string, contents: string, options: { reportedSize?: number } = {}) {
		const filePath = join(testDirectory, fileName);
		writeFileSync(filePath, contents);

		const readFile = vi.fn(async () => Buffer.from(contents, "utf-8"));
		const readFilePrefix = vi.fn(async (_path: string, maxBytes: number) =>
			Buffer.from(contents, "utf-8").subarray(0, maxBytes),
		);
		const operations: ReadOperations = {
			readFile,
			access: async () => {},
			detectImageMimeType: async () => null,
			fileSize: async () => options.reportedSize ?? Buffer.byteLength(contents, "utf-8"),
			readFilePrefix,
		};

		return { tool: createReadToolDefinition(testDirectory, { operations }), filePath, readFile, readFilePrefix };
	}

	it("reads a normal file whole, without a prefix read or a notice", async () => {
		const { tool, filePath, readFile, readFilePrefix } = createTool("small.txt", "alpha\nbeta\ngamma\n");

		const result = await runRead(tool, { path: filePath });

		expect(readFile).toHaveBeenCalledTimes(1);
		expect(readFilePrefix).not.toHaveBeenCalled();
		expect(textOf(result)).toContain("alpha");
		expect(textOf(result)).not.toContain("read limit");
	});

	it("loads only a prefix of an oversized file and says so", async () => {
		const lines = Array.from({ length: 400 }, (_, index) => `line ${index}`).join("\n");
		const { tool, filePath, readFile, readFilePrefix } = createTool("huge.log", lines, {
			reportedSize: 900 * 1024 * 1024,
		});

		const result = await runRead(tool, { path: filePath });
		const text = textOf(result);

		// The whole-file read is what would OOM; it must not happen at all.
		expect(readFile).not.toHaveBeenCalled();
		expect(readFilePrefix).toHaveBeenCalledWith(filePath, MAX_READ_FILE_BYTES);
		expect(text).toContain("line 0");
		expect(text).toContain("above the 4.0MB read limit");
		expect(text).toContain("sed -n");
	});

	it("reports line counts as a floor when it only saw a prefix", async () => {
		const lines = Array.from({ length: 5000 }, (_, index) => `line ${index}`).join("\n");
		const { tool, filePath } = createTool("many.log", lines, { reportedSize: 50 * 1024 * 1024 });

		const text = textOf(await runRead(tool, { path: filePath }));

		// Never claims to know the file's real length.
		expect(text).toMatch(/of \d+\+\./);
	});

	it("drops the partial last line left by a prefix cut", async () => {
		const contents = "complete line\nchopped in half";
		const { tool, filePath, readFilePrefix } = createTool("cut.txt", contents, { reportedSize: 99 * 1024 * 1024 });
		readFilePrefix.mockImplementation(async () => Buffer.from("complete line\nchopped in ha", "utf-8"));

		const text = textOf(await runRead(tool, { path: filePath }));

		expect(text).toContain("complete line");
		expect(text).not.toContain("chopped in ha");
	});

	it("does not leave a replacement character when the prefix cuts a multi-byte character", async () => {
		const contents = "héllo wörld 😀 more\n";
		const { tool, filePath, readFilePrefix } = createTool("utf8.txt", contents, { reportedSize: 77 * 1024 * 1024 });
		const full = Buffer.from(contents, "utf-8");
		// Cut one byte into the emoji's 4-byte sequence.
		readFilePrefix.mockImplementation(async () => full.subarray(0, full.indexOf(Buffer.from("😀", "utf-8")) + 1));

		const text = textOf(await runRead(tool, { path: filePath }));

		expect(text).not.toContain("�");
	});

	it("points at bash when the requested offset is past the prefix", async () => {
		const { tool, filePath } = createTool("offset.log", "one\ntwo\nthree\n", { reportedSize: 80 * 1024 * 1024 });

		await expect(runRead(tool, { path: filePath, offset: 900000 })).rejects.toThrow(/sed -n/);
	});

	it("keeps the whole-file read for backends that provide no size operations", async () => {
		const filePath = join(testDirectory, "remote.txt");
		writeFileSync(filePath, "remote contents\n");
		const readFile = vi.fn(async () => Buffer.from("remote contents\n", "utf-8"));
		// An SSH-style backend written before the bound existed: only the original two operations.
		const tool = createReadToolDefinition(testDirectory, {
			operations: { readFile, access: async () => {}, detectImageMimeType: async () => null },
		});

		const text = textOf(await runRead(tool, { path: filePath }));

		expect(readFile).toHaveBeenCalledTimes(1);
		expect(text).toContain("remote contents");
	});
});

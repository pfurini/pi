import { rmSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forgetTempFile, getRegisteredTempFiles, registerTempFile } from "../src/core/temp-file-registry.ts";
import { OutputAccumulator } from "../src/core/tools/output-accumulator.ts";

describe("temp file registry", () => {
	it("tracks a path until it is forgotten", () => {
		const path = `/tmp/pi-registry-test-${Date.now()}.log`;

		registerTempFile(path);
		expect(getRegisteredTempFiles()).toContain(path);

		forgetTempFile(path);
		expect(getRegisteredTempFiles()).not.toContain(path);
	});

	it("registers the full-output file the bash tool hands to the model", async () => {
		// Enough output to force the accumulator past its byte limit and open the temp file.
		const accumulator = new OutputAccumulator({ maxBytes: 64, maxLines: 4, tempFilePrefix: "pi-registry-test" });
		accumulator.append(Buffer.from(`${"x".repeat(200)}\n`));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });

		try {
			expect(snapshot.fullOutputPath).toBeDefined();
			// Nothing else deletes these, so they must be queued for cleanup at exit.
			expect(getRegisteredTempFiles()).toContain(snapshot.fullOutputPath);
		} finally {
			await accumulator.closeTempFile();
			if (snapshot.fullOutputPath) forgetTempFile(snapshot.fullOutputPath);
		}
	});
});

describe("full-output temp file cap", () => {
	it("stops writing at the cap and reports the file as a prefix", async () => {
		const accumulator = new OutputAccumulator({
			maxBytes: 16,
			maxLines: 2,
			tempFilePrefix: "pi-cap-test",
			maxTempFileBytes: 100,
		});
		for (let index = 0; index < 20; index++) accumulator.append(Buffer.alloc(50, 0x61));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });

		try {
			expect(snapshot.fullOutputCapped).toBe(true);
			expect(snapshot.fullOutputBytes).toBe(100);
			await accumulator.closeTempFile();
			// 1000 bytes of output, 100 bytes on disk.
			expect(statSync(snapshot.fullOutputPath ?? "").size).toBe(100);
		} finally {
			if (snapshot.fullOutputPath) {
				rmSync(snapshot.fullOutputPath, { force: true });
				forgetTempFile(snapshot.fullOutputPath);
			}
		}
	});

	it("writes the whole output when it stays under the cap", async () => {
		const accumulator = new OutputAccumulator({ maxBytes: 16, maxLines: 2, tempFilePrefix: "pi-cap-test" });
		accumulator.append(Buffer.alloc(500, 0x62));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });

		try {
			expect(snapshot.fullOutputCapped).toBe(false);
			expect(snapshot.fullOutputBytes).toBe(500);
		} finally {
			await accumulator.closeTempFile();
			if (snapshot.fullOutputPath) {
				rmSync(snapshot.fullOutputPath, { force: true });
				forgetTempFile(snapshot.fullOutputPath);
			}
		}
	});
});

// A capped file holds a prefix, so the structured output (codemode) must take the end of the
// output from memory, not from the file, and must not report a prefix as complete.
describe("full output read from a capped temp file", () => {
	async function capped(chunks: string[], maxTempFileBytes: number) {
		const accumulator = new OutputAccumulator({
			maxBytes: 16,
			maxLines: 2,
			tempFilePrefix: "pi-cap-read-test",
			maxTempFileBytes,
		});
		for (const chunk of chunks) accumulator.append(Buffer.from(chunk));
		accumulator.finish();
		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		await accumulator.closeTempFile();
		try {
			expect(snapshot.fullOutputCapped).toBe(true);
			return await accumulator.readFullOutput(200);
		} finally {
			if (snapshot.fullOutputPath) {
				rmSync(snapshot.fullOutputPath, { force: true });
				forgetTempFile(snapshot.fullOutputPath);
			}
		}
	}

	it("keeps the head from the file and the real end from the rolling tail", async () => {
		const full = await capped(["H".repeat(100), "m".repeat(700), "FINAL-ERROR"], 100);

		expect(full.truncated).toBe(true);
		expect(full.content.startsWith("H".repeat(100))).toBe(true);
		expect(full.content.endsWith("FINAL-ERROR")).toBe(true);
		const [head, tail] = full.content.split(/\n\n\[\.\.\. \d+ bytes omitted \.\.\.\]\n\n/);
		const omitted = Number(/\[\.\.\. (\d+) bytes omitted/.exec(full.content)?.[1]);
		expect(head.length + omitted + tail.length).toBe(811);
	});

	it("returns the whole output when the rolling tail still holds all of it", async () => {
		const full = await capped(["abcdefghij", "0123456789", "klmnopqrst", "END"], 10);

		expect(full).toEqual({ content: "abcdefghij0123456789klmnopqrstEND", truncated: false });
	});
});

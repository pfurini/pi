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

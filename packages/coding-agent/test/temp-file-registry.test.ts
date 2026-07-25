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

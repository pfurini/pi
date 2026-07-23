import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	EXEC_SPILL_HIGH_WATER_MARK_BYTES,
	ExecOutputCollector,
	type SpillWriterFactory,
} from "../src/core/exec-output.ts";

class SlowWritable extends Writable {
	readonly chunks: Buffer[] = [];
	private readonly pendingCallbacks: Array<(error?: Error | null) => void> = [];

	constructor() {
		super({ highWaterMark: 1 });
	}

	_write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		this.chunks.push(Buffer.from(chunk));
		this.pendingCallbacks.push(callback);
	}

	release(): void {
		for (const callback of this.pendingCallbacks.splice(0)) callback();
	}
}

class FailingWritable extends Writable {
	private readonly path: string;

	constructor(path: string) {
		super();
		this.path = path;
	}

	_write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		writeFileSync(this.path, chunk);
		queueMicrotask(() => callback(new Error("injected spill failure")));
	}
}

describe("ExecOutputCollector", () => {
	let testDirectory: string;
	const spillPaths = new Set<string>();

	beforeEach(() => {
		testDirectory = mkdtempSync(join(tmpdir(), "pi-exec-output-test-"));
	});

	afterEach(() => {
		for (const path of spillPaths) rmSync(path, { force: true });
		spillPaths.clear();
		rmSync(testDirectory, { recursive: true, force: true });
	});

	function createCollector(
		retainedLimitBytes: number,
		options: { spillLimitBytes?: number; spillWriterFactory?: SpillWriterFactory } = {},
	): ExecOutputCollector {
		return new ExecOutputCollector({
			retainedLimitBytes,
			tempFilePrefix: "pi-exec-test",
			tempDirectory: testDirectory,
			...options,
		});
	}

	function trackSpill(snapshot: Awaited<ReturnType<ExecOutputCollector["finish"]>>): void {
		if (snapshot.truncation?.spill?.path) spillPaths.add(snapshot.truncation.spill.path);
	}

	it("returns empty and below-limit output without truncation metadata", async () => {
		const empty = await createCollector(8).finish();
		expect(empty).toEqual({ text: "" });

		const collector = createCollector(8);
		collector.append(Buffer.from("hello"));
		expect(await collector.finish()).toEqual({ text: "hello" });
	});

	it("truncates only after the exact retained limit", async () => {
		const exact = createCollector(4);
		exact.append(Buffer.from("abcd"));
		expect(await exact.finish()).toEqual({ text: "abcd" });

		const overflow = createCollector(4);
		overflow.append(Buffer.from("abcde"));
		const snapshot = await overflow.finish();
		trackSpill(snapshot);
		expect(snapshot.text).toBe("bcde");
		expect(snapshot.truncation).toMatchObject({
			totalBytes: 5,
			retainedBytes: 4,
			retainedLimitBytes: 4,
		});
	});

	it("replays the pre-overflow prefix into a complete spill", async () => {
		const collector = createCollector(4);
		collector.append(Buffer.from("abcd"));
		collector.append(Buffer.from("efgh"));
		const snapshot = await collector.finish();
		trackSpill(snapshot);

		expect(snapshot.text).toBe("efgh");
		expect(snapshot.truncation?.spill).toMatchObject({ bytes: 8, complete: true });
		expect(readFileSync(snapshot.truncation?.spill?.path ?? "")).toEqual(Buffer.from("abcdefgh"));
		expect(snapshot.truncation?.discardedBytes).toBe(0);
	});

	it("caps a spill at a contiguous raw prefix", async () => {
		const collector = createCollector(4, { spillLimitBytes: 5 });
		collector.append(Buffer.from("abcdefgh"));
		const snapshot = await collector.finish();
		trackSpill(snapshot);

		expect(snapshot.text).toBe("efgh");
		expect(snapshot.truncation?.spill).toMatchObject({ bytes: 5, complete: false });
		expect(readFileSync(snapshot.truncation?.spill?.path ?? "")).toEqual(Buffer.from("abcde"));
		expect(snapshot.truncation?.discardedBytes).toBe(3);
	});

	it("stops spilling permanently when bytes arrive during backpressure", async () => {
		const writer = new SlowWritable();
		let receivedHighWaterMark = 0;
		const collector = createCollector(4, {
			spillWriterFactory: (_path, options) => {
				receivedHighWaterMark = options.highWaterMark;
				return writer;
			},
		});
		collector.append(Buffer.from("abcd"));
		collector.append(Buffer.from("e"));
		collector.append(Buffer.from("fghi"));
		const finishPromise = collector.finish();
		writer.release();
		const snapshot = await finishPromise;
		trackSpill(snapshot);

		expect(receivedHighWaterMark).toBe(EXEC_SPILL_HIGH_WATER_MARK_BYTES);
		expect(Buffer.concat(writer.chunks).toString()).toBe("abcd");
		expect(snapshot.truncation?.spill).toMatchObject({ bytes: 4, complete: false });
		expect(snapshot.truncation?.discardedBytes).toBe(5);
	});

	it("contains asynchronous writer failures and removes the partial spill", async () => {
		let partialPath = "";
		const collector = createCollector(4, {
			spillWriterFactory: (path) => {
				partialPath = path;
				return new FailingWritable(path);
			},
		});
		collector.append(Buffer.from("abcdefgh"));
		const snapshot = await collector.finish();

		expect(snapshot.text).toBe("efgh");
		expect(snapshot.truncation?.spill).toBeUndefined();
		expect(snapshot.truncation?.spillError).toContain("injected spill failure");
		expect(snapshot.truncation?.discardedBytes).toBe(8);
		expect(partialPath).not.toBe("");
		expect(existsSync(partialPath)).toBe(false);
	});

	it("aligns a UTF-8 tail split across append calls", async () => {
		const bytes = Buffer.from("A😀BC");
		const collector = createCollector(4);
		collector.append(bytes.subarray(0, 3));
		collector.append(bytes.subarray(3));
		const snapshot = await collector.finish();
		trackSpill(snapshot);

		expect(snapshot.text).toBe("BC");
		expect(snapshot.text.startsWith("�")).toBe(false);
		expect(snapshot.truncation?.totalBytes).toBe(bytes.length);
		expect(snapshot.truncation?.retainedBytes).toBe(2);
	});

	it("bounds invalid bytes and counts raw bytes", async () => {
		const collector = createCollector(3);
		collector.append(Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb]));
		const snapshot = await collector.finish();
		trackSpill(snapshot);

		expect(Buffer.byteLength(snapshot.text, "utf-8")).toBeLessThanOrEqual(9);
		expect(snapshot.truncation).toMatchObject({ totalBytes: 5, retainedBytes: 3 });
	});

	it("copies and exactly trims one oversized input buffer", async () => {
		const input = Buffer.alloc(1024 * 1024, 0x61);
		input.set(Buffer.from("tail"), input.length - 4);
		const collector = createCollector(4, { spillLimitBytes: 8 });
		collector.append(input);
		const snapshot = await collector.finish();
		trackSpill(snapshot);

		expect(snapshot.text).toBe("tail");
		expect(snapshot.truncation).toMatchObject({ totalBytes: input.length, retainedBytes: 4 });
	});

	it("coalesces thousands of one-byte appends while preserving the exact tail", async () => {
		const collector = createCollector(32, { spillLimitBytes: 64 });
		for (let index = 0; index < 5000; index++) collector.append(Buffer.from([0x61 + (index % 26)]));
		const snapshot = await collector.finish();
		trackSpill(snapshot);
		const expected = Buffer.from(
			Array.from({ length: 32 }, (_, offset) => 0x61 + ((5000 - 32 + offset) % 26)),
		).toString();

		expect(snapshot.text).toBe(expected);
		expect(snapshot.truncation?.retainedBytes).toBe(32);
	});

	it.skipIf(process.platform === "win32")("creates real spill files with mode 0o600", async () => {
		const collector = createCollector(4);
		collector.append(Buffer.from("abcdefgh"));
		const snapshot = await collector.finish();
		trackSpill(snapshot);
		const path = snapshot.truncation?.spill?.path;

		expect(path).toBeDefined();
		expect(statSync(path ?? "").mode & 0o777).toBe(0o600);
	});
});

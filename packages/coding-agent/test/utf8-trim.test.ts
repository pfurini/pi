import { describe, expect, it } from "vitest";
import { trimIncompleteTrailingUtf8 } from "../src/utils/utf8.ts";

describe("trimIncompleteTrailingUtf8", () => {
	it("drops a multi-byte sequence cut at any interior position", () => {
		const full = Buffer.from("abc😀", "utf-8");

		for (let cut = full.length - 3; cut < full.length; cut++) {
			const trimmed = trimIncompleteTrailingUtf8(full.subarray(0, cut));
			expect(trimmed.toString("utf-8")).toBe("abc");
		}
	});

	it("leaves complete input untouched, including 2- and 3-byte characters at the end", () => {
		for (const text of ["abc", "café", "日本語", "abc😀", ""]) {
			const buffer = Buffer.from(text, "utf-8");
			expect(trimIncompleteTrailingUtf8(buffer).toString("utf-8")).toBe(text);
		}
	});

	it("keeps a replacement character that is genuinely part of the data", () => {
		// The reason this works on bytes: stripping a trailing U+FFFD after decoding would delete
		// this character, which the producer really emitted.
		const text = "output ends with �";
		const buffer = Buffer.from(text, "utf-8");

		expect(trimIncompleteTrailingUtf8(buffer).toString("utf-8")).toBe(text);
	});

	it("returns empty input unchanged and handles a lone continuation byte", () => {
		expect(trimIncompleteTrailingUtf8(Buffer.alloc(0)).length).toBe(0);
		// Three continuation bytes with no lead byte in range: nothing identifiable to trim.
		expect(trimIncompleteTrailingUtf8(Buffer.from([0x80, 0x80, 0x80])).length).toBe(3);
	});
});

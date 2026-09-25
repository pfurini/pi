// Ported from pi-vcc 0.8.0 (npm @sting8k/pi-vcc), tests/recall-touched-drilldown.test.ts.
// Copyright (c) 2026 sting8k. MIT licence: see src/core/fork-builtins/vcc-recall/LICENSE.
// Sessions are in memory. The two lineage tests make m1 and m2 both children of m0, with the
// leaf on m2, so the active lineage is [m0, m2] as pi-vcc's stubbed getBranch returned.
import { describe, expect, it } from "vitest";
import { parseDrillDown } from "../../../src/core/fork-builtins/vcc-recall/drill-down.ts";
import { formatTouchedOutput, TOUCHED_PAGE_SIZE } from "../../../src/core/fork-builtins/vcc-recall/format-recall.ts";
import type { TouchedFile } from "../../../src/core/fork-builtins/vcc-recall/search-entries.ts";
import { type MessageSpec, recall, recallTool, sessionOf } from "./session.ts";

// ── Helpers ───────────────────────────────────────────────────────────────

const toolMsg = (id: string, name: string, args: Record<string, unknown>, parentId?: string): MessageSpec => ({
	id,
	parentId,
	message: {
		role: "assistant",
		content: [{ type: "toolCall", name, arguments: args }],
	},
});

const userMsg = (id: string, content: string): MessageSpec => ({
	id,
	message: { role: "user", content },
});

// ── mode:touched ─────────────────────────────────────────────────────────

describe("vcc_recall mode:touched", () => {
	it("aggregates multiple edits on the same file into one line with chronological indices", async () => {
		const session = sessionOf([
			toolMsg("m0", "edit", { path: "src/a.ts", oldText: "x", newText: "y" }),
			toolMsg("m1", "quick_edit", { path: "src/a.ts", edits: [{ oldText: "a", newText: "b" }] }),
			toolMsg("m2", "write", { path: "src/b.ts", content: "line1\nline2" }),
		]);
		const tool = recallTool();
		const out = await recall(tool, session, { mode: "touched" });
		expect(out).toContain("src/a.ts");
		expect(out).toContain("#0 (edit), #1 (quick_edit)");
		expect(out).toContain("src/b.ts");
		expect(out).toContain("#2 (write)");
	});

	it("classifies by shape: custom tool with path+content counts; Read with path-only args is excluded", async () => {
		const session = sessionOf([
			toolMsg("m0", "my_custom_tool", { path: "src/custom.ts", content: "hello\nworld" }),
			toolMsg("m1", "read", { path: "src/readonly.ts" }),
		]);
		const tool = recallTool();
		const out = await recall(tool, session, { mode: "touched" });
		expect(out).toContain("src/custom.ts");
		expect(out).toContain("#0 (my_custom_tool)");
		expect(out).not.toContain("src/readonly.ts");
	});

	it("empty session has no touchable files", async () => {
		const session = sessionOf([userMsg("m0", "hello"), userMsg("m1", "world")]);
		const tool = recallTool();
		const out = await recall(tool, session, { mode: "touched" });
		expect(out).toContain("No file operations found in session history.");
	});

	it("respects scope: file on another branch only with scope all, indices unshifted", async () => {
		const session = sessionOf([
			toolMsg("m0", "edit", { path: "src/on.ts", oldText: "x", newText: "y" }),
			toolMsg("m1", "edit", { path: "src/off.ts", oldText: "x", newText: "y" }),
			toolMsg("m2", "edit", { path: "src/on.ts", oldText: "a", newText: "b" }, "m0"),
		]);
		const tool = recallTool();

		const defaultOut = await recall(tool, session, { mode: "touched" });
		expect(defaultOut).toContain("src/on.ts");
		expect(defaultOut).toContain("#0 (edit), #2 (edit)");
		expect(defaultOut).not.toContain("src/off.ts");

		const allOut = await recall(tool, session, { mode: "touched", scope: "all" });
		expect(allOut).toContain("src/off.ts");
		expect(allOut).toContain("#1 (edit)");
		expect(allOut).toContain("src/on.ts");
		expect(allOut).toContain("#2 (edit)"); // index unshifted
	});

	it("pages when more files than page size", async () => {
		const session = sessionOf(
			Array.from({ length: 7 }, (_, i) => toolMsg(`m${i}`, "write", { path: `src/f${i}.ts`, content: "x" })),
		);
		const tool = recallTool();
		const page1 = await recall(tool, session, { mode: "touched" });
		expect(page1).toContain("Page 1/2 (7 total files)");
		expect(page1).toContain("--- Use page:2 for more results ---");
		expect(page1).toContain("src/f0.ts");
		expect(page1).not.toContain("src/f5.ts");

		const page2 = await recall(tool, session, { mode: "touched", page: 2 });
		expect(page2).toContain("Page 2/2 (7 total files)");
		expect(page2).toContain("src/f5.ts");
		expect(page2).not.toContain("--- Use page:3");
	});
});

// ── #N:path drill-down ────────────────────────────────────────────────────

describe("vcc_recall drill-down", () => {
	const bigContent = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");

	it("expands an entry index from touched output", async () => {
		const session = sessionOf([
			toolMsg("m0", "edit", { path: "src/a.ts", oldText: "x", newText: "y" }),
			toolMsg("m1", "write", { path: "src/b.ts", content: "line1\nline2" }),
		]);
		const tool = recallTool();
		const touched = await recall(tool, session, { mode: "touched" });
		// #1 from touched output points at m1 (src/b.ts)
		expect(touched).toContain("#1 (write)");
		const expanded = await recall(tool, session, { expand: [1] });
		expect(expanded).toContain("src/b.ts");
	});

	it("#N:path previews file content", async () => {
		const session = sessionOf([toolMsg("m1", "write", { path: "src/big.ts", content: bigContent })]);
		const tool = recallTool();
		const out = await recall(tool, session, { query: "#0:src/big.ts" });
		expect(out).toContain("File: src/big.ts");
		expect(out).toContain("line 0");
		expect(out).not.toContain("line 39"); // preview truncates at 30 lines
		expect(out).toContain("more lines");
	});

	it("#N:path:full returns the complete content", async () => {
		const session = sessionOf([toolMsg("m1", "write", { path: "src/big.ts", content: bigContent })]);
		const tool = recallTool();
		const out = await recall(tool, session, { query: "#0:src/big.ts:full" });
		expect(out).toContain("File: src/big.ts");
		expect(out).toContain("line 39");
		expect(out).not.toContain("more lines");
	});

	it("inline mention is treated as a normal search, not drill-down", async () => {
		const session = sessionOf([toolMsg("m1", "write", { path: "src/big.ts", content: bigContent })]);
		const tool = recallTool();
		const out = await recall(tool, session, { query: "see #1:src/big.ts" });
		expect(out).not.toContain("File: src/big.ts");
	});
});

// ── Unit: parseDrillDown anchoring ────────────────────────────────────────

describe("parseDrillDown", () => {
	it("anchors on ^ so inline mentions are not drill-down", () => {
		expect(parseDrillDown("#42:auth.ts")).not.toBeNull();
		expect(parseDrillDown("#42:auth.ts:full")).not.toBeNull();
		expect(parseDrillDown("check #42:auth.ts")).toBeNull();
		expect(parseDrillDown("see #42:auth.ts here")).toBeNull();
	});

	it("parses full / offset / offset:limit suffixes", () => {
		expect(parseDrillDown("#42:auth.ts:full")).toMatchObject({ index: 42, pathPattern: "auth.ts", full: true });
		expect(parseDrillDown("#42:auth.ts:30")).toMatchObject({
			index: 42,
			pathPattern: "auth.ts",
			full: false,
			offset: 30,
		});
		expect(parseDrillDown("#42:auth.ts:30:20")).toMatchObject({
			index: 42,
			pathPattern: "auth.ts",
			full: false,
			offset: 30,
			limit: 20,
		});
	});
});

// ── Unit: formatTouchedOutput paging ──────────────────────────────────────

describe("formatTouchedOutput", () => {
	const tf = (path: string, index: number): TouchedFile => ({ path, entries: [{ index, toolName: "edit" }] });

	it("shows page header and footer when there are more pages", () => {
		const files = Array.from({ length: TOUCHED_PAGE_SIZE + 2 }, (_, i) => tf(`src/f${i}.ts`, i));
		const out = formatTouchedOutput(files, 1);
		expect(out).toContain(`Page 1/2 (${files.length} total files)`);
		expect(out).toContain("--- Use page:2 for more results ---");
	});

	it("returns empty-state message when no files", () => {
		expect(formatTouchedOutput([])).toContain("No file operations found in session history.");
	});
});
describe("drill-down scope", () => {
	it("blocks #N:path on off-lineage entries by default, allows with scope all", async () => {
		const session = sessionOf([
			toolMsg("m0", "edit", { path: "src/on.ts", oldText: "x", newText: "y" }),
			toolMsg("m1", "edit", { path: "src/off.ts", oldText: "secret-old", newText: "secret-new" }),
			toolMsg("m2", "edit", { path: "src/on.ts", oldText: "a", newText: "b" }, "m0"),
		]);
		const tool = recallTool();

		// off-lineage entry blocked under default scope
		const blocked = await recall(tool, session, { query: "#1:off.ts" });
		expect(blocked).toContain("Cannot expand indices outside active lineage: 1");
		expect(blocked).not.toContain("secret-old");

		// on-lineage entry still drills under default scope
		const onOut = await recall(tool, session, { query: "#2:on.ts" });
		expect(onOut).toContain("src/on.ts");

		// scope:'all' reaches the other branch
		const allOut = await recall(tool, session, { query: "#1:off.ts", scope: "all" });
		expect(allOut).toContain("src/off.ts");
	});
});

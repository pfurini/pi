// Fork-owned: the port's output text equals pi-vcc 0.8.0's, exactly, on two synthetic sessions.
// /tmp/vcc-recall-golden.mjs ran pi-vcc 0.8.0 on each golden/<session>.jsonl and stored every output as
// golden/<session>.<case>.txt (docs/plans/vcc-recall-builtin.plan.md, T1). Here the same session loads
// into an in-memory SessionManager, whose leaf is the last entry, as pi-vcc's run assumed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSessionEntries, SessionManager } from "../../../src/core/session-manager.ts";
import { recall, recallTool } from "./session.ts";

const golden = (file: string) => readFileSync(new URL(`golden/${file}`, import.meta.url), "utf8");

const CASES: Record<string, Record<string, Record<string, unknown>>> = {
	linear: {
		browse: {},
		query: { query: "alpha" },
		"query-page-2": { query: "alpha", page: 2 },
		regex: { query: "alph.*" },
		expand: { expand: [0, 3] },
		touched: { mode: "touched" },
		// #3 is the read result.
		"drill-down": { query: "#3:src/a.ts" },
	},
	branched: {
		query: { query: "beta" },
		"query-all": { query: "beta", scope: "all" },
	},
};

describe("vcc_recall golden outputs", () => {
	for (const [session, cases] of Object.entries(CASES)) {
		for (const [name, params] of Object.entries(cases)) {
			it(`${session}.${name} equals pi-vcc 0.8.0's output`, async () => {
				const entries = parseSessionEntries(golden(`${session}.jsonl`));
				const sessionManager = SessionManager.inMemory(process.cwd(), undefined, entries);
				expect(await recall(recallTool(), sessionManager, params)).toBe(golden(`${session}.${name}.txt`));
			});
		}
	}
});

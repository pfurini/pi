// Fork-owned: the `@handle message` grammar of agent mentions (phase 3 plan T1, cases 1 to 8).
// Old pi-subagents tests at 79a7c42 this covers: mention (every case). A handle that the trigger
// cannot match can never be typed back, and a parse that is too eager swallows input the user meant
// for the main model.
import { describe, expect, it } from "vitest";
import {
	agentMentionReminder,
	describeMention,
	MENTION_TRIGGER,
	parseMention,
	resolveHandleToType,
	stripAgentPrefix,
} from "../../../src/core/fork-builtins/subagents/service/mentions.ts";
import {
	assignHandle,
	handleBase,
	isReservedHandle,
} from "../../../src/core/fork-builtins/subagents/service/records.ts";

describe("handleBase", () => {
	it("lowercases and keeps hyphens", () => {
		expect(handleBase("Explore")).toBe("explore");
		expect(handleBase("general-purpose")).toBe("general-purpose");
	});

	it("turns other characters into single hyphens, without edge hyphens", () => {
		expect(handleBase("Code Review!")).toBe("code-review");
		expect(handleBase("  spaced  out  ")).toBe("spaced-out");
	});

	it("never returns an empty handle", () => {
		expect(handleBase("!!!")).toBe("agent");
		expect(handleBase("")).toBe("agent");
	});

	it("caps a long name at 64 characters without a trailing hyphen", () => {
		expect(handleBase("x".repeat(200))).toHaveLength(64);
		expect(handleBase(`${"x".repeat(63)}   tail`)).toBe("x".repeat(63));
	});

	it("only produces handles the suggestion trigger matches", () => {
		for (const type of ["Explore", "general-purpose", "Code Review!", "!!!", "デバッグ", `${"x".repeat(63)} y`]) {
			expect(MENTION_TRIGGER.exec(`@${handleBase(type)}`)?.[2]).toBe(handleBase(type));
		}
	});
});

describe("assignHandle", () => {
	it("takes the free base, then numbers from 2 past every taken form", () => {
		expect(assignHandle("explore", new Set())).toBe("explore");
		expect(assignHandle("explore", new Set(["explore"]))).toBe("explore-2");
		expect(assignHandle("explore", new Set(["explore", "explore-2"]))).toBe("explore-3");
	});

	it("never hands out main", () => {
		expect(assignHandle("main", new Set())).toBe("main-2");
	});

	it("skips a gap rather than reusing a live handle", () => {
		expect(assignHandle("explore", new Set(["explore", "explore-3"]))).toBe("explore-2");
	});
});

describe("resolveHandleToType", () => {
	const TYPES = ["general-purpose", "Explore", "Code Review!"];

	it("finds the type a handle came from, whatever its casing", () => {
		expect(resolveHandleToType("explore", TYPES)).toBe("Explore");
		expect(resolveHandleToType("EXPLORE", TYPES)).toBe("Explore");
		expect(resolveHandleToType("code-review", TYPES)).toBe("Code Review!");
	});

	it("matches exactly, never a prefix or a numbered handle", () => {
		expect(resolveHandleToType("ex", TYPES)).toBeUndefined();
		expect(resolveHandleToType("explore-2", TYPES)).toBeUndefined();
	});

	it("round-trips every registered type", () => {
		for (const type of TYPES) expect(resolveHandleToType(handleBase(type), TYPES)).toBe(type);
	});

	it("refuses main, even for a type named main", () => {
		expect(resolveHandleToType("main", ["main", ...TYPES])).toBeUndefined();
		expect(resolveHandleToType("Main", ["main", ...TYPES])).toBeUndefined();
	});
});

describe("isReservedHandle", () => {
	it("recognizes main in any casing and nothing else", () => {
		expect(isReservedHandle("main")).toBe(true);
		expect(isReservedHandle("MAIN")).toBe(true);
		for (const handle of ["explore", "mainframe", "main-2", "ma"]) expect(isReservedHandle(handle)).toBe(false);
	});
});

describe("stripAgentPrefix", () => {
	it("unwraps agent-<x> once", () => {
		expect(stripAgentPrefix("agent-explore")).toBe("explore");
		expect(stripAgentPrefix("Agent-Explore")).toBe("Explore");
		expect(stripAgentPrefix("agent-agent-foo")).toBe("agent-foo");
	});

	it("returns nothing without the prefix, without a remainder, or with the prefix inside", () => {
		expect(stripAgentPrefix("explore")).toBeUndefined();
		expect(stripAgentPrefix("agent-")).toBeUndefined();
		expect(stripAgentPrefix("agentexplore")).toBeUndefined();
		expect(stripAgentPrefix("sub-agent-explore")).toBeUndefined();
	});
});

describe("describeMention", () => {
	it("keeps the first line and collapses whitespace", () => {
		expect(describeMention("find every retry marker")).toBe("find every retry marker");
		expect(describeMention("  audit   the RPC path\nthen report back  ")).toBe("audit the RPC path");
	});

	it("clips a long message at 40 characters with an ellipsis", () => {
		const label = describeMention("x".repeat(200));
		expect(label).toHaveLength(40);
		expect(label.endsWith("…")).toBe(true);
		expect(describeMention("y".repeat(40))).toBe("y".repeat(40));
	});
});

describe("parseMention", () => {
	it("splits a leading handle from a trimmed message", () => {
		expect(parseMention("@explore check the RPC path")).toEqual({ handle: "explore", message: "check the RPC path" });
		expect(parseMention("@explore   spaced   ")).toEqual({ handle: "explore", message: "spaced" });
	});

	it("accepts a newline as the separator", () => {
		expect(parseMention("@explore\nline1\nline2")).toEqual({ handle: "explore", message: "line1\nline2" });
	});

	it("rejects a bare handle", () => {
		expect(parseMention("@explore")).toBeNull();
		expect(parseMention("@explore ")).toBeNull();
		expect(parseMention("@explore \t ")).toBeNull();
	});

	it("rejects a leading file path", () => {
		expect(parseMention("@src/index.ts summarize this")).toBeNull();
		expect(parseMention("@README.md what changed")).toBeNull();
	});

	it("rejects a mention after other text", () => {
		expect(parseMention("hey @explore look at this")).toBeNull();
		expect(parseMention(" @explore look at this")).toBeNull();
	});
});

describe("agentMentionReminder", () => {
	it("equals Claude Code's string byte for byte, trailing space included", () => {
		expect(agentMentionReminder("code-review")).toBe(
			'<system-reminder>\nThe user has expressed a desire to invoke the agent "code-review". Please invoke the agent appropriately, passing in the required context to it. \n</system-reminder>',
		);
	});

	it("names its agent", () => {
		expect(agentMentionReminder("Plan")).toContain('invoke the agent "Plan"');
	});
});

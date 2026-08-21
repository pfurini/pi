/**
 * ADR-0006 unknown-tool redirect policy tests (C1d): exact A.8 defaults,
 * settings merge/override, active-registry guard, case-insensitive
 * nearest-name fallback with deterministic tie break, and the
 * `disableToolRedirects` rollback switch.
 */

import { describe, expect, it } from "vitest";
import {
	canonicalizeToolName,
	DEFAULT_TOOL_REDIRECTS,
	formatToolRedirectMessage,
	formatToolSuggestionMessage,
	resolveToolRedirect,
} from "../src/core/skills/tool-redirects.ts";

/** Active registry shape used across the policy tests. */
const REGISTERED = ["read", "grep", "edit", "write", "bash", "ls", "find", "ask_user_question", "Agent", "skill"];

function resolve(attemptedName: string, options?: { redirects?: Record<string, string>; disabled?: boolean }) {
	return resolveToolRedirect({
		attemptedName,
		registeredToolNames: REGISTERED,
		redirects: options?.redirects,
		disabled: options?.disabled,
	});
}

describe("resolveToolRedirect mapped defaults (A.8)", () => {
	it("redirects Task to Agent with the frozen corrective wording", () => {
		expect(resolve("Task")).toBe("Tool Task is not available — use Agent instead");
	});

	it("redirects AskUserQuestion to ask_user_question", () => {
		expect(resolve("AskUserQuestion")).toBe("Tool AskUserQuestion is not available — use ask_user_question instead");
	});

	it("redirects Glob to find", () => {
		expect(resolve("Glob")).toBe("Tool Glob is not available — use find instead");
	});

	it("redirects capitalized identity tools (Read/Grep/Edit/Write/Bash/Ls)", () => {
		expect(resolve("Read")).toBe("Tool Read is not available — use read instead");
		expect(resolve("Bash")).toBe("Tool Bash is not available — use bash instead");
		expect(resolve("Ls")).toBe("Tool Ls is not available — use ls instead");
	});

	it("matches keys case-insensitively after exact match", () => {
		expect(resolve("task")).toBe("Tool task is not available — use Agent instead");
	});
});

describe("resolveToolRedirect registry guard", () => {
	it("falls through to the nearest name when the mapped target is unregistered", () => {
		// Skill maps to skill, which is unregistered in this fixture.
		const text = resolveToolRedirect({
			attemptedName: "Skill",
			registeredToolNames: ["skil"],
		});
		expect(text).toBe("Tool Skill not found — did you mean skil?");
	});

	it("returns undefined when the mapped target is unregistered and no name is near", () => {
		const text = resolveToolRedirect({
			attemptedName: "SlashCommand",
			registeredToolNames: ["read", "bash"],
		});
		expect(text).toBeUndefined();
	});

	it("does not suggest an excluded/inactive mapped target", () => {
		const text = resolveToolRedirect({
			attemptedName: "Glob",
			registeredToolNames: REGISTERED.filter((name) => name !== "find"),
		});
		// find is inactive; nearest name within distance 2 of "glob" wins if any.
		expect(text === undefined || !text.includes("use find instead")).toBe(true);
	});
});

describe("resolveToolRedirect settings merge", () => {
	it("lets a user override replace a default target", () => {
		expect(resolve("Task", { redirects: { Task: "read" } })).toBe("Tool Task is not available — use read instead");
	});

	it("lets a user add a new redirect entry", () => {
		expect(resolve("WebSearch", { redirects: { WebSearch: "grep" } })).toBe(
			"Tool WebSearch is not available — use grep instead",
		);
	});

	it("falls through to nearest name when a user override points at an unregistered target", () => {
		const text = resolveToolRedirect({
			attemptedName: "Task",
			registeredToolNames: ["tack"],
			redirects: { Task: "not_registered" },
		});
		expect(text).toBe("Tool Task not found — did you mean tack?");
	});

	it("keeps defaults intact when the override map does not mention the key", () => {
		expect(resolve("Glob", { redirects: { Task: "read" } })).toBe("Tool Glob is not available — use find instead");
	});
});

describe("resolveToolRedirect nearest-name fallback", () => {
	it("suggests the nearest registered name within distance 2", () => {
		expect(resolve("fin")).toBe("Tool fin not found — did you mean find?");
	});

	it("matches the nearest name case-insensitively", () => {
		expect(resolve("FIND")).toBe("Tool FIND not found — did you mean find?");
	});

	it("breaks ties deterministically by name ascending", () => {
		const text = resolveToolRedirect({
			attemptedName: "baf",
			registeredToolNames: ["bar", "bag"],
		});
		expect(text).toBe("Tool baf not found — did you mean bag?");
	});

	it("prefers smaller distance over alphabetical order", () => {
		const text = resolveToolRedirect({
			attemptedName: "ab",
			registeredToolNames: ["ax", "abbb"],
		});
		expect(text).toBe("Tool ab not found — did you mean ax?");
	});

	it("returns undefined at distance 3 or more", () => {
		const text = resolveToolRedirect({
			attemptedName: "xxxxx",
			registeredToolNames: REGISTERED,
		});
		expect(text).toBeUndefined();
	});
});

describe("resolveToolRedirect disableToolRedirects", () => {
	it("returns undefined for a mapped default when disabled", () => {
		expect(resolve("Task", { disabled: true })).toBeUndefined();
	});

	it("returns undefined for a near miss when disabled", () => {
		expect(resolve("fin", { disabled: true })).toBeUndefined();
	});
});

describe("wording helpers and canonicalizeToolName consistency", () => {
	it("pins the exact corrective wordings", () => {
		expect(formatToolRedirectMessage("Task", "Agent")).toBe("Tool Task is not available — use Agent instead");
		expect(formatToolSuggestionMessage("fin", "find")).toBe("Tool fin not found — did you mean find?");
	});

	it("keeps redirect defaults consistent with disallowed-tools canonicalization", () => {
		for (const [key, target] of Object.entries(DEFAULT_TOOL_REDIRECTS)) {
			expect(canonicalizeToolName(key)).toBe(target);
		}
		expect(canonicalizeToolName("task")).toBe("Agent");
		expect(canonicalizeToolName("unmapped")).toBe("unmapped");
	});
});

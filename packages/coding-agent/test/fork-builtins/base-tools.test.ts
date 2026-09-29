// Fork-owned: registration of the fork's base tools (ADR-0009). The session suite
// test/suite/fork-base-tools.test.ts covers their activation in a real session.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../../src/core/agent-session.ts";
import type { ToolDefinition } from "../../src/core/extensions/types.ts";
import { addForkBaseTools, forkBaseToolNames } from "../../src/core/fork-builtins/base-tools.ts";

const NAMES = [
	"ask_user_question",
	"vcc_recall",
	"Agent",
	"get_subagent_result",
	"steer_subagent",
	"TaskCreate",
	"TaskList",
	"TaskGet",
	"TaskUpdate",
];

/** Registration never touches the session; the subagent service is built on the first Agent call. */
const unusedSession = new Proxy(
	{},
	{
		get() {
			throw new Error("registration read the session");
		},
	},
) as AgentSession;

afterEach(() => vi.unstubAllEnvs());

/** Base definitions as `AgentSession` builds them, optionally seeded with a caller's tools. */
function definitions(seed: ToolDefinition[] = []): Map<string, ToolDefinition> {
	const map = new Map(seed.map((definition) => [definition.name, definition]));
	addForkBaseTools(map, { session: unusedSession, agentDir: mkdtempSync(join(tmpdir(), "pi-fork-base-tools-")) });
	return map;
}

describe("addForkBaseTools", () => {
	it("registers the ask_user_question, vcc_recall and subagent tools, all named for activation", () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const map = definitions();
		expect([...map.keys()]).toEqual(NAMES);
		expect(forkBaseToolNames(map)).toEqual(NAMES);
	});

	it("registers nothing when PI_FORK_BUILTINS=off", () => {
		vi.stubEnv("PI_FORK_BUILTINS", "off");
		const map = definitions();
		expect(map.size).toBe(0);
		expect(forkBaseToolNames(map)).toEqual([]);
	});

	it("never overwrites a caller's tool of the same name", () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const callers = { name: "vcc_recall" } as ToolDefinition;
		const map = definitions([callers]);
		expect(map.get("vcc_recall")).toBe(callers);
		expect(forkBaseToolNames(map)).toEqual(NAMES.filter((name) => name !== "vcc_recall"));
	});
});

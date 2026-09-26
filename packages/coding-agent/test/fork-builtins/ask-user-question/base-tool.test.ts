import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../../../src/core/extensions/types.ts";
import {
	addAskUserQuestionBaseTool,
	askUserQuestionDefaultActive,
} from "../../../src/core/fork-builtins/ask-user-question/base-tool.ts";

const NAME = "ask_user_question";

afterEach(() => vi.unstubAllEnvs());

/** Base definitions as `AgentSession` builds them, optionally seeded with a caller's tools. */
function definitions(seed: ToolDefinition[] = []): Map<string, ToolDefinition> {
	const map = new Map(seed.map((definition) => [definition.name, definition]));
	addAskUserQuestionBaseTool(map, { agentDir: mkdtempSync(join(tmpdir(), "pi-ask-user-question-base-")) });
	return map;
}

describe("addAskUserQuestionBaseTool", () => {
	it("registers the tool, active by default", () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const map = definitions();
		expect(map.get(NAME)?.name).toBe(NAME);
		expect(askUserQuestionDefaultActive(map)).toEqual([NAME]);
	});

	it("registers nothing when PI_FORK_BUILTINS=off", () => {
		vi.stubEnv("PI_FORK_BUILTINS", "off");
		const map = definitions();
		expect(map.size).toBe(0);
		expect(askUserQuestionDefaultActive(map)).toEqual([]);
	});

	it("never overwrites a caller's tool of the same name", () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const callers = { name: NAME } as ToolDefinition;
		expect(definitions([callers]).get(NAME)).toBe(callers);
	});
});

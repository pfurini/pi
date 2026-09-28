// Fork-owned: the subagent service's read-only surface (plan T3, F13). Each `@ts-expect-error` line
// below is a guard: `npm run check` runs tsgo over this file and fails with TS2578 when a guarded
// write or read type-checks again. The test only keeps the guards referenced.
import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../../../src/core/fork-builtins/subagents/definitions/types.ts";
import type { SubagentView } from "../../../src/core/fork-builtins/subagents/service/records.ts";
import type { SubagentService } from "../../../src/core/fork-builtins/subagents/service/service.ts";

/** Never called: tsgo checks it. */
function guards(service: SubagentService, view: SubagentView, definition: AgentDefinition): void {
	// @ts-expect-error A view's status belongs to the service.
	view.status = "completed";
	// @ts-expect-error A view reaches no child session.
	void view.child;
	// @ts-expect-error The service's settings are read-only.
	service.settings.maxConcurrent = 1;
	// @ts-expect-error The registry's agents are read-only.
	service.registry.agents.set(definition.name, definition);
	// @ts-expect-error An agent definition is read-only.
	definition.name = "renamed";
}

describe("the read-only subagent surface", () => {
	it("keeps its type guards", () => {
		expect(guards).toBeTypeOf("function");
	});
});

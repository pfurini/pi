/**
 * Fork-owned: what the task suite tests share. A session holds the `worker` agent, which names no task
 * tool, and the `tasker` agent, which names `TaskCreate` and `TaskExecute`; the faux router of
 * `fork-subagents-fixtures.ts` answers the parent and every child.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { SubagentService } from "../../src/core/fork-builtins/subagents/service/service.ts";
import { subagentServiceFor } from "../../src/core/fork-builtins/subagents/service/sessions.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import { type Behavior, router } from "./fork-subagents-fixtures.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

export const TASK_TOOLS = ["TaskCreate", "TaskList", "TaskGet", "TaskUpdate", "TaskExecute", "TaskOutput", "TaskStop"];

/** A session with fork built-ins on; `settings` becomes its `forkBuiltins` object. Callers clean it up. */
export async function taskSession(
	settings: Record<string, unknown> = {},
	options: HarnessOptions = {},
): Promise<Harness> {
	vi.stubEnv("PI_FORK_BUILTINS", "on");
	const cwd = options.cwd ?? mkdtempSync(join(tmpdir(), "pi-tasks-"));
	mkdirSync(join(cwd, "agents"), { recursive: true });
	writeFileSync(
		join(cwd, "agents", "worker.md"),
		"---\ndescription: test worker\ntools: read\nextensions: false\n---\nYou are a test worker.",
	);
	writeFileSync(
		join(cwd, "agents", "tasker.md"),
		"---\ndescription: keeps tasks\ntools: read, TaskCreate, TaskExecute\nextensions: false\n---\nYou keep tasks.",
	);
	return createHarness({ ...options, cwd, settings: { forkBuiltins: settings } as unknown as Partial<Settings> });
}

/** Answers every request of the session and its children through the faux router. */
export function withRouter(harness: Harness, script: Record<string, Behavior[]> = {}, main?: Behavior): Harness {
	harness.setResponses(Array.from({ length: 300 }, () => router(script, main)));
	return harness;
}

export function subagentsOf(harness: Harness): SubagentService {
	const service = subagentServiceFor(harness.session);
	if (!service) throw new Error("no subagent service");
	return service;
}

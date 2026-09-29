/**
 * Fork-owned: the mention clone (phase 3 probe) over a fake session whose provider ignores the abort
 * signal: a clone cancelled before its reply arrives starts no agent.
 */
import { describe, expect, it } from "vitest";
import type { AgentSession } from "../../../src/core/agent-session.ts";
import type { SubagentService } from "../../../src/core/fork-builtins/subagents/service/service.ts";
import { runMentionClone } from "../../../src/core/fork-builtins/subagents/tools/mention-clone.ts";

describe("the mention clone", () => {
	it("starts no agent when it was cancelled before a provider that ignores the abort answered", async () => {
		let release!: () => void;
		const replied = new Promise<void>((resolve) => {
			release = resolve;
		});
		const reply = {
			role: "assistant",
			stopReason: "toolUse",
			content: [
				{
					type: "toolCall",
					id: "c1",
					name: "Agent",
					arguments: { prompt: "p", description: "d", subagent_type: "worker" },
				},
			],
		};
		const session = {
			model: { id: "m", provider: "p" },
			thinkingLevel: "off",
			sessionId: "s",
			messages: [],
			getToolDefinition: () => ({
				name: "Agent",
				description: "Agent",
				parameters: {
					type: "object",
					properties: {
						prompt: { type: "string" },
						description: { type: "string" },
						subagent_type: { type: "string" },
					},
				},
			}),
			modelRuntime: {
				streamSimple: () => ({
					result: async () => {
						await replied;
						return reply;
					},
				}),
			},
		} as unknown as AgentSession;
		let spawns = 0;
		const service = {
			spawn: async () => {
				spawns++;
				return { id: "x" };
			},
		} as unknown as SubagentService;
		const controller = new AbortController();
		const pending = runMentionClone(session, service, "worker", "go", controller.signal);
		controller.abort();
		release();
		expect(await pending).toEqual({ ok: false, error: "the clone was cancelled" });
		expect(spawns).toBe(0);
	});
});

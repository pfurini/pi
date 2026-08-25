/**
 * AgentSession must chain the five Agent hooks it installs (transformInjectedMessages,
 * resolveToolRedirect, refreshTurnAfterInjection, onContinuationPinned,
 * isToolCallDisallowed) over whatever an embedder passed to `new Agent({ ... })`,
 * instead of clobbering them, and must restore each to its pre-construction value on
 * dispose without stomping a third party's later reassignment.
 */

import { join } from "node:path";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import type { SkillInvocation } from "../src/core/skills/runtime.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader, createTestSession } from "./utilities.ts";

function record(fields: Partial<SkillInvocation> = {}): SkillInvocation {
	return {
		invocationId: "i1",
		skillId: "s1",
		name: "test-skill",
		baseDir: "/skills/test-skill",
		filePath: "/skills/test-skill/SKILL.md",
		rawArgs: "",
		...fields,
	};
}

function continuationModels(agent: Agent) {
	return {
		pinned: agent.state.model,
		requested: {
			...agent.state.model,
			id: "requested-model",
			name: "Requested Model",
			provider: "requested-provider",
		},
	};
}

async function buildSecondSession(agent: Agent, tempDir: string): Promise<AgentSession> {
	const authStorage = AuthStorage.create(join(tempDir, "auth2.json"));
	const modelRegistry = await createModelRegistry(authStorage, tempDir);
	const session = new AgentSession({
		agent,
		sessionManager: SessionManager.inMemory(),
		settingsManager: SettingsManager.create(tempDir, tempDir),
		cwd: tempDir,
		agentDir: tempDir,
		modelRuntime: getModelRuntime(modelRegistry),
		resourceLoader: createTestResourceLoader(),
	});
	session.subscribe(() => {});
	return session;
}

describe("AgentSession chains Agent hooks over AgentOptions", () => {
	it("resolveToolRedirect: falls back to the embedder's resolver when the session has no redirect", async () => {
		const embedderRedirect = (context: { attemptedName: string }) =>
			context.attemptedName === "totally_unknown_tool" ? "embedder text" : undefined;
		const { session, cleanup } = await createTestSession({
			inMemory: true,
			agentOptions: { resolveToolRedirect: embedderRedirect },
		});
		try {
			expect(session.agent.resolveToolRedirect).not.toBe(embedderRedirect);
			const result = session.agent.resolveToolRedirect?.({
				attemptedName: "totally_unknown_tool",
				registeredToolNames: [],
			});
			expect(result).toBe("embedder text");
		} finally {
			cleanup();
		}
	});

	it("isToolCallDisallowed: the embedder's block still rejects the call when the session allows it", async () => {
		const embedderDisallow = vi.fn((name: string) => (name === "bash" ? "embedder blocked" : undefined));
		const { session, cleanup } = await createTestSession({
			inMemory: true,
			agentOptions: { isToolCallDisallowed: embedderDisallow },
		});
		try {
			expect(session.agent.isToolCallDisallowed).not.toBe(embedderDisallow);
			const result = session.agent.isToolCallDisallowed?.("bash");
			expect(result).toBe("embedder blocked");
			expect(embedderDisallow).toHaveBeenCalledWith("bash");
		} finally {
			cleanup();
		}
	});

	it("onContinuationPinned: the embedder's callback fires alongside the session's own recording", async () => {
		const embedderCallback = vi.fn();
		const { session, cleanup } = await createTestSession({
			inMemory: true,
			agentOptions: { onContinuationPinned: embedderCallback },
		});
		try {
			const { pinned, requested } = continuationModels(session.agent);
			expect(session.agent.onContinuationPinned).not.toBe(embedderCallback);
			expect(() => session.agent.onContinuationPinned?.(pinned, requested)).not.toThrow();
			expect(embedderCallback).toHaveBeenCalledWith(pinned, requested);
		} finally {
			cleanup();
		}
	});

	it("onContinuationPinned: a throwing embedder callback cannot suppress the session's recording", async () => {
		const embedderCallback = vi.fn(() => {
			throw new Error("embedder callback failed");
		});
		const { session, cleanup } = await createTestSession({
			inMemory: true,
			agentOptions: { onContinuationPinned: embedderCallback },
		});
		try {
			const { pinned, requested } = continuationModels(session.agent);
			expect(() => session.agent.onContinuationPinned?.(pinned, requested)).toThrow("embedder callback failed");
			expect(embedderCallback).toHaveBeenCalledWith(pinned, requested);
			const pendingNotices = (session as unknown as { _pendingContinuationNotices: string[] })
				._pendingContinuationNotices;
			expect(pendingNotices).toHaveLength(1);
		} finally {
			cleanup();
		}
	});

	it("refreshTurnAfterInjection: the embedder's turn update survives when no skill override is active", async () => {
		const embedderUpdate = { context: { systemPrompt: "PREVIOUS_MARKER", messages: [], tools: [] } };
		const embedderRefresh = vi.fn().mockResolvedValue(embedderUpdate);
		const { session, cleanup } = await createTestSession({
			inMemory: true,
			agentOptions: { refreshTurnAfterInjection: embedderRefresh },
		});
		try {
			expect(session.agent.refreshTurnAfterInjection).not.toBe(embedderRefresh);
			const result = await session.agent.refreshTurnAfterInjection?.(undefined);
			expect(result).toEqual(embedderUpdate);
			expect(embedderRefresh).toHaveBeenCalled();
		} finally {
			cleanup();
		}
	});

	it("refreshTurnAfterInjection: the session's override wins over the embedder's when a skill is active", async () => {
		const embedderUpdate = { context: { systemPrompt: "PREVIOUS_MARKER", messages: [], tools: [] } };
		const embedderRefresh = vi.fn().mockResolvedValue(embedderUpdate);
		const { session, cleanup } = await createTestSession({
			inMemory: true,
			agentOptions: { refreshTurnAfterInjection: embedderRefresh },
		});
		try {
			session.skillRuntime.activate(record());
			const result = await session.agent.refreshTurnAfterInjection?.(undefined);
			expect(embedderRefresh).toHaveBeenCalled();
			expect(result).toBeDefined();
			expect(result?.context?.systemPrompt).not.toBe("PREVIOUS_MARKER");
		} finally {
			cleanup();
		}
	});

	it("refreshTurnAfterInjection: a rejected embedder refresh cannot suppress an active skill override", async () => {
		const embedderRefresh = vi.fn().mockRejectedValue(new Error("embedder refresh failed"));
		const { session, cleanup } = await createTestSession({
			inMemory: true,
			agentOptions: { refreshTurnAfterInjection: embedderRefresh },
		});
		try {
			session.skillRuntime.activate(record());
			const result = await session.agent.refreshTurnAfterInjection?.(undefined);
			expect(embedderRefresh).toHaveBeenCalled();
			expect(result).toBeDefined();
		} finally {
			cleanup();
		}
	});

	it("restores each chained hook to its constructor-supplied value on dispose", async () => {
		const embedderTransform = vi.fn(async (messages: AgentMessage[]) => messages);
		const embedderRedirect = vi.fn(() => undefined);
		const embedderRefresh = vi.fn(async () => undefined);
		const embedderPinned = vi.fn();
		const embedderDisallow = vi.fn(() => undefined);
		const { session, cleanup } = await createTestSession({
			inMemory: true,
			agentOptions: {
				transformInjectedMessages: embedderTransform,
				resolveToolRedirect: embedderRedirect,
				refreshTurnAfterInjection: embedderRefresh,
				onContinuationPinned: embedderPinned,
				isToolCallDisallowed: embedderDisallow,
			},
		});
		const agent = session.agent;

		// Chained: AgentSession's own wrapper is installed over each, not the raw embedder value.
		expect(agent.transformInjectedMessages).not.toBe(embedderTransform);
		expect(agent.resolveToolRedirect).not.toBe(embedderRedirect);
		expect(agent.refreshTurnAfterInjection).not.toBe(embedderRefresh);
		expect(agent.onContinuationPinned).not.toBe(embedderPinned);
		expect(agent.isToolCallDisallowed).not.toBe(embedderDisallow);

		cleanup();

		// Restored: teardown gives each hook back its pre-construction (embedder) value.
		expect(agent.transformInjectedMessages).toBe(embedderTransform);
		expect(agent.resolveToolRedirect).toBe(embedderRedirect);
		expect(agent.refreshTurnAfterInjection).toBe(embedderRefresh);
		expect(agent.onContinuationPinned).toBe(embedderPinned);
		expect(agent.isToolCallDisallowed).toBe(embedderDisallow);
	});

	it("does not stomp a hook a third party reassigned after construction", async () => {
		const { session, cleanup } = await createTestSession({ inMemory: true });
		const agent = session.agent;
		const thirdPartyTransform = async (messages: unknown) => messages;

		// A third party takes over after AgentSession's own construction-time install.
		agent.transformInjectedMessages = thirdPartyTransform as Agent["transformInjectedMessages"];
		cleanup();

		// Identity guard: the hook no longer matches AgentSession's installed closure,
		// so dispose must leave the third party's reassignment untouched.
		expect(agent.transformInjectedMessages).toBe(thirdPartyTransform);
	});

	it("a second AgentSession over the same Agent does not chain into a disposed session's dead closure", async () => {
		const embedderTransform = vi.fn(async (messages: AgentMessage[]) => messages);
		const {
			session: session1,
			tempDir,
			cleanup,
		} = await createTestSession({
			inMemory: true,
			agentOptions: { transformInjectedMessages: embedderTransform },
		});
		const agent = session1.agent;
		cleanup();

		// Restoration proves session #2 will capture the embedder's closure directly as
		// `previous`, not session #1's dead wrapper (which would otherwise run its own
		// skill-delivery pass a second time on top of session #2's own pass).
		expect(agent.transformInjectedMessages).toBe(embedderTransform);

		const session2 = await buildSecondSession(agent, tempDir);
		try {
			await agent.transformInjectedMessages?.([], undefined);
			expect(embedderTransform).toHaveBeenCalledTimes(1);
		} finally {
			session2.dispose();
		}
	});
});

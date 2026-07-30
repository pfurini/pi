import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { applyToolOutputPolicy, POLICY_NOTICE_PREFIX, POLICY_SLACK_BYTES } from "../src/core/tool-output-policy.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "../src/core/tools/truncate.ts";
import type { ExtensionFactory } from "../src/index.ts";

const textBytes = (content: Array<{ type?: string; text?: unknown }>) =>
	content.reduce(
		(a, b) => a + (b?.type === "text" && typeof b.text === "string" ? Buffer.byteLength(b.text, "utf-8") : 0),
		0,
	);

describe("applyToolOutputPolicy (unit)", () => {
	it("passes small content through untouched, same array identity", () => {
		const content = [{ type: "text", text: "hello\nworld" }];
		const r = applyToolOutputPolicy(content);
		expect(r.truncated).toBe(false);
		expect(r.content).toBe(content);
	});

	it("caps a single oversized text block and appends the canonical notice", () => {
		const big = "x".repeat(200 * 1024);
		const r = applyToolOutputPolicy([{ type: "text", text: big }]);
		expect(r.truncated).toBe(true);
		expect(textBytes(r.content)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES + 256 /* notice */);
		const last = r.content[r.content.length - 1] as { text: string };
		expect(last.text.startsWith(POLICY_NOTICE_PREFIX)).toBe(true);
	});

	it("caps by line count independently of bytes", () => {
		// 100k tiny lines is only ~300KB... still over byte cap; use small enough
		// lines that the LINE limit is what fires: 10k lines of one char = ~20KB.
		const manyLines = Array.from({ length: 10_000 }, () => "y").join("\n");
		const r = applyToolOutputPolicy([{ type: "text", text: manyLines }]);
		expect(r.truncated).toBe(true);
		const kept = (r.content[0] as { text: string }).text;
		expect(kept.split("\n").length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
	});

	it("leaves a self-truncated result (cap + own notice) alone - the slack", () => {
		// A well-behaved tool returns cap-sized content plus its own marker line.
		const selfCapped = `${"z".repeat(DEFAULT_MAX_BYTES - 10)}\n[Showing lines 1-2000 of 9999. Use offset=2001 to continue.]`;
		expect(Buffer.byteLength(selfCapped, "utf-8")).toBeGreaterThan(DEFAULT_MAX_BYTES);
		expect(Buffer.byteLength(selfCapped, "utf-8")).toBeLessThan(DEFAULT_MAX_BYTES + POLICY_SLACK_BYTES);
		const r = applyToolOutputPolicy([{ type: "text", text: selfCapped }]);
		expect(r.truncated).toBe(false);
	});

	it("preserves non-text blocks and drops overflow text after them", () => {
		// Line-structured 60KB: the head block consumes the whole byte budget on
		// line boundaries, so the trailing text block must be dropped. (A single
		// 60KB LINE is different: truncateHead never splits a line, drops it
		// whole, and the budget would survive for the tail - covered by the
		// pathological-line test below.)
		const content = [
			{ type: "text", text: `${"a".repeat(100)}\n`.repeat(600) },
			{ type: "image", data: "AAAA", mimeType: "image/png" },
			{ type: "text", text: "tail that must be dropped" },
		];
		const r = applyToolOutputPolicy(content as never);
		expect(r.truncated).toBe(true);
		expect(r.content.some((b: { type?: string }) => b.type === "image")).toBe(true);
		const texts = r.content.filter((b: { type?: string }) => b.type === "text") as Array<{ text: string }>;
		expect(texts.some((t) => t.text.includes("tail that must"))).toBe(false);
	});

	it("splits the budget across multiple text blocks in order", () => {
		const r = applyToolOutputPolicy([
			{ type: "text", text: "first-".repeat(5000) }, // ~30KB
			{ type: "text", text: "second-".repeat(5000) }, // ~35KB -> partially kept
			{ type: "text", text: "third-".repeat(5000) }, // dropped
		]);
		expect(r.truncated).toBe(true);
		expect(textBytes(r.content)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES + 256);
		const joined = r.content.map((b: { text?: string }) => b.text ?? "").join("|");
		expect(joined.includes("first-")).toBe(true);
		expect(joined.includes("third-")).toBe(false);
	});

	it("handles empty and absent content", () => {
		expect(applyToolOutputPolicy([]).truncated).toBe(false);
		expect(applyToolOutputPolicy(undefined).truncated).toBe(false);
		expect(applyToolOutputPolicy(null).truncated).toBe(false);
	});

	// ---- stress ------------------------------------------------------------
	it("stress: 10MB single block is capped fast and linearly", () => {
		const big = "line of stress test payload\n".repeat(400_000); // ~10.7MB
		const t0 = performance.now();
		const r = applyToolOutputPolicy([{ type: "text", text: big }]);
		const ms = performance.now() - t0;
		expect(r.truncated).toBe(true);
		expect(textBytes(r.content)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES + 256);
		expect(r.totalBytes).toBeGreaterThan(10 * 1024 * 1024);
		expect(ms).toBeLessThan(500); // counting + head-truncate must stay linear
	});

	it("stress: 1000 blocks of mixed size stay within cap and keep order", () => {
		const blocks = Array.from({ length: 1000 }, (_, i) => ({
			type: "text",
			text: `block${i} ${"p".repeat(i % 97)}\n`,
		}));
		const t0 = performance.now();
		const r = applyToolOutputPolicy(blocks);
		const ms = performance.now() - t0;
		expect(ms).toBeLessThan(500);
		const texts = r.content.filter((b: { type?: string }) => b.type === "text") as Array<{ text: string }>;
		// order preserved: block indexes must be ascending in whatever was kept
		const idx = texts.map((t) => Number(/^block(\d+)/.exec(t.text)?.[1])).filter((n) => !Number.isNaN(n));
		expect([...idx].sort((a, b) => a - b)).toEqual(idx);
	});

	it("stress: pathological single line larger than the cap yields notice, not a partial line", () => {
		const oneLine = "q".repeat(2 * DEFAULT_MAX_BYTES); // no newlines at all
		const r = applyToolOutputPolicy([{ type: "text", text: oneLine }]);
		expect(r.truncated).toBe(true);
		// truncateHead never returns partial lines; the only text left is the notice
		const texts = r.content.filter((b: { type?: string }) => b.type === "text") as Array<{ text: string }>;
		expect(texts.length).toBe(1);
		expect(texts[0].text.startsWith(POLICY_NOTICE_PREFIX)).toBe(true);
	});
});

describe("tool output policy (end-to-end through a live session)", () => {
	const cleanups: Array<() => Promise<void> | void> = [];
	afterEach(async () => {
		while (cleanups.length > 0) await cleanups.pop()?.();
	});

	async function createHost(extensionFactory: ExtensionFactory, responses: ReturnType<typeof fauxAssistantMessage>[]) {
		const tempDir = join(tmpdir(), `pi-output-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		const faux = registerFauxProvider();
		faux.setResponses(responses);

		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
		const modelRuntime = await ModelRuntime.create({
			credentials: authStorage,
			modelsPath: join(tempDir, "models.json"),
		});
		const model = faux.getModel();
		modelRuntime.registerProvider(model.provider, {
			baseUrl: model.baseUrl,
			api: model.api,
			models: [
				{
					id: model.id,
					name: model.name,
					api: model.api,
					reasoning: model.reasoning,
					input: model.input,
					cost: model.cost,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					baseUrl: model.baseUrl,
				},
			],
		});

		const runtimeOptions = {
			agentDir: tempDir,
			modelRuntime,
			model: faux.getModel(),
			resourceLoaderOptions: {
				extensionFactories: [extensionFactory],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			},
		};
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({ ...runtimeOptions, cwd });
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: faux.getModel(),
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};
		const runtimeHost = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(tempDir),
		});
		await runtimeHost.session.bindExtensions({});

		cleanups.push(async () => {
			await runtimeHost.dispose();
			faux.unregister();
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		});
		return { runtimeHost, faux };
	}

	const lastToolResult = (session: { messages: Array<{ role: string }> }) =>
		[...session.messages].reverse().find((m) => m.role === "toolResult") as
			| { role: string; toolName: string; content: Array<{ type?: string; text?: string }> }
			| undefined;

	it("caps a flooding extension tool before its output enters context", async () => {
		const FLOOD = "flood line with some sensible width to it\n".repeat(40_000); // ~1.7MB
		const { runtimeHost } = await createHost(
			(pi) => {
				pi.registerTool({
					name: "flood",
					label: "flood",
					description: "returns far too much text",
					parameters: { type: "object", properties: {} },
					execute: async () => ({ content: [{ type: "text", text: FLOOD }], details: {} }),
				} as never);
			},
			[fauxAssistantMessage([fauxToolCall("flood", {})]), fauxAssistantMessage("done")],
		);

		await runtimeHost.session.prompt("run the flood tool");
		const tr = lastToolResult(runtimeHost.session);
		expect(tr).toBeTruthy();
		const bytes = textBytes(tr!.content);
		expect(bytes).toBeLessThanOrEqual(DEFAULT_MAX_BYTES + 256);
		const joined = tr!.content.map((b) => b.text ?? "").join("\n");
		expect(joined.includes(POLICY_NOTICE_PREFIX)).toBe(true);
	});

	it("caps content substituted by an extension tool_result hook", async () => {
		const HOOK_FLOOD = "hook-injected line\n".repeat(60_000); // ~1.1MB
		const { runtimeHost } = await createHost(
			(pi) => {
				pi.registerTool({
					name: "tiny",
					label: "tiny",
					description: "returns a small result",
					parameters: { type: "object", properties: {} },
					execute: async () => ({ content: [{ type: "text", text: "small" }], details: {} }),
				} as never);
				pi.on("tool_result", async () => ({ content: [{ type: "text", text: HOOK_FLOOD }] }));
			},
			[fauxAssistantMessage([fauxToolCall("tiny", {})]), fauxAssistantMessage("done")],
		);

		await runtimeHost.session.prompt("run tiny");
		const tr = lastToolResult(runtimeHost.session);
		expect(tr).toBeTruthy();
		expect(textBytes(tr!.content)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES + 256);
		const joined = tr!.content.map((b) => b.text ?? "").join("\n");
		expect(joined.includes("hook-injected")).toBe(true); // hook content survived, capped
		expect(joined.includes(POLICY_NOTICE_PREFIX)).toBe(true);
	});

	it("leaves a small tool result byte-identical (no hooks, no policy rewrite)", async () => {
		const { runtimeHost } = await createHost(
			(pi) => {
				pi.registerTool({
					name: "small",
					label: "small",
					description: "small output",
					parameters: { type: "object", properties: {} },
					execute: async () => ({ content: [{ type: "text", text: "exact small output" }], details: {} }),
				} as never);
			},
			[fauxAssistantMessage([fauxToolCall("small", {})]), fauxAssistantMessage("done")],
		);

		await runtimeHost.session.prompt("run small");
		const tr = lastToolResult(runtimeHost.session);
		expect(tr).toBeTruthy();
		expect(tr!.content).toEqual([{ type: "text", text: "exact small output" }]);
	});
});

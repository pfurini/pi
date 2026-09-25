import { createMockCtx, createMockPi } from "@juicesharp/rpiv-test-utils";
import { Value } from "typebox/value";
import { describe, expect, it, vi } from "vitest";
import { registerAskUserQuestionTool } from "./ask-user-question.js";
import { normalizeQuestionParams } from "./tool/normalize-params.js";
import { type QuestionParams, QuestionParamsSchema } from "./tool/types.js";
import { validateQuestionnaire } from "./tool/validate-questionnaire.js";

function question(count = 8) {
	return {
		question: "Which approach?",
		header: "Approach",
		options: Array.from({ length: count }, (_, i) => ({
			label: `Choice ${i + 1}`,
			description: `Trade-off ${i + 1}`,
		})),
	};
}

function registered() {
	const { pi, captured } = createMockPi();
	registerAskUserQuestionTool(pi);
	return { tool: captured.tools.get("ask_user_question")!, captured };
}

const rejected = [{ label: "Discarded\r approach", reason: "Incompatible\r\nwith the approved boundary." }];

describe("question capacity and rejected alternatives", () => {
	it("accepts eight selectable options and rejects nine at both boundaries", () => {
		for (const count of [2, 4, 5, 8]) {
			const params = { questions: [question(count)] };
			expect(Value.Check(QuestionParamsSchema, params)).toBe(true);
			expect(validateQuestionnaire(params)).toEqual({ ok: true });
		}
		const oversized = { questions: [question(9)] };
		expect(Value.Check(QuestionParamsSchema, oversized)).toBe(false);
		expect(validateQuestionnaire(oversized)).toMatchObject({ ok: false, error: "too_many_options" });
	});

	it.each([
		null,
		"wrong",
		[null],
		[{}],
		[{ label: "A", reason: " " }],
		[{ label: " ", reason: "why" }],
		[{ label: "x".repeat(61), reason: "why" }],
	])("rejects malformed setAside metadata: %j", async (setAside) => {
		const params = { questions: [{ ...question(2), setAside }] };
		expect(Value.Check(QuestionParamsSchema, params)).toBe(false);
		const { tool, captured } = registered();
		const select = vi.fn();
		const ctx = createMockCtx({ hasUI: true, mode: "rpc", ui: { select, input: vi.fn() } as never });
		const result = await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx as never);
		expect(result?.details).toMatchObject({ error: "invalid_set_aside", answers: [], cancelled: true });
		expect(select).not.toHaveBeenCalled();
		expect(captured.eventsEmitted.get("rpiv:ask-user:prompt")).toBeUndefined();
		expect(captured.eventsEmitted.get("rpiv:ask-user:blocked")).toBeUndefined();
	});

	it("normalizes new strings without mutating the request or adding an absent field", () => {
		const params = { questions: [{ ...question(), setAside: rejected }] };
		const normalized = normalizeQuestionParams(params);
		expect(normalized).toMatchObject({
			questions: [
				{ setAside: [{ label: "Discarded approach", reason: "Incompatible\nwith the approved boundary." }] },
			],
		});
		expect(params.questions[0].setAside).toEqual(rejected);
		expect(normalizeQuestionParams({ questions: [question()] }).questions[0]).not.toHaveProperty("setAside");
		expect(Value.Check(QuestionParamsSchema, normalized)).toBe(true);
	});

	it.each(["rpc", "fallback"])(
		"shows full metadata through %s dialogs and emits it without turning it into an answer",
		async (mode) => {
			const { tool, captured } = registered();
			const reason = `${"A long but genuine explanation. ".repeat(30)}LAST_REASON`;
			const params = { questions: [{ ...question(), setAside: [{ label: "Discarded\r", reason }] }] };
			const select = vi.fn(async (_title: string, options: string[]) => options[7]);
			const custom = vi.fn(async () => undefined);
			const ctx = createMockCtx({
				hasUI: true,
				...(mode === "rpc" ? { mode: "rpc" } : {}),
				ui: { select, input: vi.fn(), custom } as never,
			});
			const result = await tool.execute?.(
				"tc",
				params as never,
				undefined as never,
				undefined as never,
				ctx as never,
			);
			expect(select.mock.calls[0][0]).toContain(reason);
			expect(select.mock.calls[0][0]).toContain("Alternatives considered");
			expect(select.mock.calls[0][1]).toHaveLength(9);
			expect(select.mock.calls[0][1].join("\n")).not.toContain("Discarded");
			expect(result?.details).toMatchObject({ answers: [{ kind: "option", answer: "Choice 8" }], cancelled: false });
			expect(JSON.stringify(result)).not.toContain(reason);
			const events = captured.eventsEmitted.get("rpiv:ask-user:prompt")!;
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({ questions: [{ setAside: [{ label: "Discarded", reason }] }] });
		},
	);

	it("keeps rejected context visible in the custom-answer follow-up", async () => {
		const { tool } = registered();
		const select = vi.fn(async (_title: string, options: string[]) => options.at(-1));
		const input = vi.fn(async (_title: string) => "My different approach");
		const ctx = createMockCtx({ hasUI: true, mode: "rpc", ui: { select, input } as never });
		const result = await tool.execute?.(
			"tc",
			{ questions: [{ ...question(), setAside: rejected }] } as never,
			undefined as never,
			undefined as never,
			ctx as never,
		);
		expect(input.mock.calls[0]?.[0]).toContain("Discarded approach");
		expect(result?.details).toMatchObject({ answers: [{ kind: "custom", answer: "My different approach" }] });
	});

	it("preserves multi-select index eight and context without adding a rejected option", async () => {
		const { tool } = registered();
		const input = vi.fn(async (_title: string) => "1,8");
		const ctx = createMockCtx({ hasUI: true, mode: "rpc", ui: { select: vi.fn(), input } as never });
		const params = { questions: [{ ...question(), multiSelect: true, setAside: rejected }] };
		const result = await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx as never);
		expect(input.mock.calls[0][0]).toContain("Discarded approach");
		expect(result?.details).toMatchObject({ answers: [{ kind: "multi", selected: ["Choice 1", "Choice 8"] }] });
	});

	it.each([undefined, []])("keeps old dialog titles when metadata is %j", async (setAside) => {
		const { tool, captured } = registered();
		const params: QuestionParams = { questions: [{ ...question(2), ...(setAside ? { setAside } : {}) }] };
		const select = vi.fn(async (_title: string, options: string[]) => options[0]);
		const ctx = createMockCtx({ hasUI: true, mode: "rpc", ui: { select, input: vi.fn() } as never });
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx as never);
		expect(select.mock.calls[0][0]).toBe("[Approach] Which approach?");
		if (setAside === undefined)
			expect(
				(captured.eventsEmitted.get("rpiv:ask-user:prompt")![0] as { questions: unknown[] }).questions[0],
			).not.toHaveProperty("setAside");
	});
});

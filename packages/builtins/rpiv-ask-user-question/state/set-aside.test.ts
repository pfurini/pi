import type { Theme } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { makeTheme } from "@juicesharp/rpiv-test-utils";
import { describe, expect, it, vi } from "vitest";
import { buildItemsForQuestion } from "../ask-user-question.js";
import type { QuestionData, QuestionnaireResult, QuestionParams } from "../tool/types.js";
import { QuestionnaireSession } from "./questionnaire-session.js";

const down = "\x1b[B";
const up = "\x1b[A";
const enter = "\r";
const esc = "\x1b";
const tab = "\t";
const plain = (lines: string[]) => lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
const bindings = {
	matches(data: string, name: string) {
		return (
			(
				{
					"tui.select.up": up,
					"tui.select.down": down,
					"tui.select.confirm": enter,
					"tui.input.submit": enter,
					"tui.select.cancel": esc,
				} as Record<string, string>
			)[name] === data
		);
	},
};
function makeQuestion(extra: Partial<QuestionData> = {}): QuestionData {
	return {
		question: "Choose the implementation?",
		header: "Approach",
		options: Array.from({ length: 8 }, (_, i) => ({ label: `Choice ${i + 1}`, description: `Cost ${i + 1}` })),
		...extra,
	};
}
function sessionFor(questions: QuestionData[], collapseKey = "off") {
	const terminal = { columns: 32, rows: 10 };
	const done = vi.fn<(result: QuestionnaireResult) => void>();
	const params: QuestionParams = { questions };
	const session = new QuestionnaireSession({
		tui: { terminal, requestRender: vi.fn() } as unknown as TUI,
		theme: makeTheme() as unknown as Theme,
		params,
		itemsByTab: questions.map(buildItemsForQuestion),
		done,
		keybindings: bindings,
		editInput: async () => undefined,
		collapseKey,
		canReopenWhileHidden: false,
	});
	return { session, done, terminal, render: () => session.component.render(terminal.columns) };
}
const metadata = {
	setAside: [{ label: "Discarded design", reason: `${"Reason spanning many lines. ".repeat(30)}FINAL_REASON` }],
};

describe("read-only alternatives in the questionnaire session", () => {
	it("advertises the feature at a narrow width and returns to the same option without answering", () => {
		const { session, render, done } = sessionFor([makeQuestion(metadata)]);
		session.dispatch(down);
		expect(plain(render())).toContain("a alternatives");
		session.dispatch("a");
		expect(plain(render())).toContain("Alternatives considered");
		expect(done).not.toHaveBeenCalled();
		session.dispatch(enter);
		expect(done).not.toHaveBeenCalled();
		session.dispatch(enter);
		expect(done).toHaveBeenCalledWith(
			expect.objectContaining({ answers: [expect.objectContaining({ answer: "Choice 2" })] }),
		);
	});

	it.each([3, 7, 10])("makes the last reason reachable at height %i without leaving terminal bounds", (height) => {
		const { session, render, terminal, done } = sessionFor([
			makeQuestion(metadata),
			makeQuestion({ question: "Another question?" }),
		]);
		terminal.rows = height;
		session.dispatch("a");
		const seen: string[] = [];
		for (let i = 0; i < 100; i++) {
			const lines = render();
			expect(lines.length).toBeLessThanOrEqual(height);
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(terminal.columns);
			seen.push(plain(lines));
			session.dispatch(down);
		}
		expect(seen.join("\n")).toContain("Discarded design");
		expect(seen.join("\n")).toContain("FINAL_REASON");
		const end = plain(render());
		session.dispatch(up);
		expect(plain(render())).not.toBe(end);
		expect(done).not.toHaveBeenCalled();
	});

	it("clamps scroll after resizing and preserves collapse precedence with an alternative opening key", () => {
		const { session, render, terminal, done } = sessionFor([makeQuestion(metadata)], "a");
		expect(plain(render())).toContain("Ctrl+A alternatives");
		session.dispatch("\x01");
		for (let i = 0; i < 100; i++) {
			render();
			session.dispatch(down);
		}
		terminal.columns = 50;
		terminal.rows = 12;
		const end = plain(render());
		session.dispatch(up);
		expect(plain(render())).not.toBe(end);
		session.dispatch("a");
		expect(render()).toHaveLength(1);
		session.dispatch("a");
		expect(plain(render())).toContain("Alternatives considered");
		session.dispatch(esc);
		expect(done).not.toHaveBeenCalled();
		expect(plain(render())).toContain("Choice 1");
	});

	it("closes disclosure on tab switch without leaking it into the next question", () => {
		const { session, render, done, terminal } = sessionFor([
			makeQuestion(metadata),
			makeQuestion({ question: "Another question?" }),
		]);
		terminal.rows = 24;
		session.dispatch("a");
		expect(plain(render())).toContain("Alternatives considered");
		session.dispatch(tab);
		expect(plain(render())).toContain("Another question?");
		expect(plain(render())).not.toContain("Alternatives considered");
		expect(done).not.toHaveBeenCalled();
	});

	it("preserves multi-select checks and notes while inspecting alternatives", () => {
		const { session, render, done } = sessionFor([makeQuestion({ ...metadata, multiSelect: true })]);
		session.dispatch(" ");
		session.dispatch("n");
		session.dispatch("a");
		session.dispatch(esc);
		session.dispatch("a");
		expect(plain(render())).toContain("Alternatives considered");
		session.dispatch(esc);
		for (let i = 0; i < 7; i++) session.dispatch(down);
		session.dispatch(" ");
		const items = buildItemsForQuestion(makeQuestion({ ...metadata, multiSelect: true }));
		const next = items.findIndex((item) => item.kind === "next");
		for (let i = 7; i < next; i++) session.dispatch(down);
		session.dispatch(enter);
		expect(done).toHaveBeenCalledWith(
			expect.objectContaining({
				answers: [expect.objectContaining({ selected: ["Choice 1", "Choice 8"], notes: "a" })],
			}),
		);
	});

	it("keeps literal a in the custom editor and preserves its draft through disclosure", () => {
		const { session, render, done } = sessionFor([makeQuestion(metadata)]);
		for (let i = 0; i < 8; i++) session.dispatch(down);
		session.dispatch("a");
		expect(plain(render())).not.toContain("Alternatives considered");
		session.dispatch(up);
		session.dispatch("a");
		expect(plain(render())).toContain("Alternatives considered");
		session.dispatch(esc);
		session.dispatch(down);
		session.dispatch(enter);
		expect(done).toHaveBeenCalledWith(
			expect.objectContaining({ answers: [expect.objectContaining({ kind: "custom", answer: "a" })] }),
		);
	});

	it.each([undefined, []])("omitted or empty metadata leaves the ordinary UI unchanged: %j", (setAside) => {
		const baseline = sessionFor([makeQuestion()]);
		const current = sessionFor([makeQuestion({ setAside })]);
		expect(current.render()).toEqual(baseline.render());
		current.session.dispatch("a");
		expect(current.render()).toEqual(baseline.render());
	});

	it.each([false, true])("can select option eight with preview=%s in a small viewport", (preview) => {
		const q = makeQuestion();
		if (preview) q.options[7].preview = "Eight's design";
		const { session, render, done } = sessionFor([q]);
		for (let i = 0; i < 7; i++) session.dispatch(down);
		expect(plain(render())).toContain("Choice 8");
		session.dispatch(enter);
		expect(done).toHaveBeenCalledWith(
			expect.objectContaining({ answers: [expect.objectContaining({ answer: "Choice 8" })] }),
		);
	});
});

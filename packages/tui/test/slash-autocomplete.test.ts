import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import {
	type AutocompleteItem,
	CombinedAutocompleteProvider,
	type SlashCommand,
	slashRunAtCursor,
} from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import type { TUI } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

/** Create a TUI with a virtual terminal for testing */
function createTestTUI(cols = 80, rows = 24): TUI {
	return new TuiMainScreen(new VirtualTerminal(cols, rows));
}

async function flushAutocomplete(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => setImmediate(resolve));
}

function typeText(editor: Editor, text: string): void {
	for (const char of text) {
		editor.handleInput(char);
	}
}

const fixtureCommands: SlashCommand[] = [
	{ name: "model", description: "Select model", argumentHint: "<provider/model>", source: "builtin" },
	{ name: "review", description: "Review code", source: "skill" },
	{ name: "fix", description: "Fix an issue", source: "command" },
	{ name: "release", description: "Release flow", source: "prompt" },
	{
		name: "deploy",
		description: "Deploy the app",
		source: "extension",
		getArgumentCompletions: (argumentPrefix: string) =>
			argumentPrefix.startsWith("a") ? [{ value: "ant", label: "ant" }] : null,
	},
];

const baseDir = mkdtempSync(join(tmpdir(), "pi-slash-autocomplete-"));
mkdirSync(join(baseDir, "bin"));

after(() => {
	rmSync(baseDir, { recursive: true, force: true });
});

const getSuggestions = (
	provider: CombinedAutocompleteProvider,
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	options: { force?: boolean; explicitTab?: boolean } = {},
) =>
	provider.getSuggestions(lines, cursorLine, cursorCol, {
		signal: new AbortController().signal,
		force: options.force ?? false,
		explicitTab: options.explicitTab ?? false,
	});

function itemValues(items: AutocompleteItem[]): string[] {
	return items.map((item) => item.value);
}

describe("slashRunAtCursor", () => {
	it("matches a run at text start", () => {
		assert.deepStrictEqual(slashRunAtCursor("/re"), { start: 0, text: "/re" });
		assert.deepStrictEqual(slashRunAtCursor("/"), { start: 0, text: "/" });
	});

	it("matches a run immediately after whitespace", () => {
		assert.deepStrictEqual(slashRunAtCursor("please /re"), { start: 7, text: "/re" });
		assert.deepStrictEqual(slashRunAtCursor("a\t/re"), { start: 2, text: "/re" });
	});

	it("matches qualified and nested name characters", () => {
		assert.deepStrictEqual(slashRunAtCursor("run /skill:review"), { start: 4, text: "/skill:review" });
		assert.deepStrictEqual(slashRunAtCursor("run /apps/web:deploy"), { start: 4, text: "/apps/web:deploy" });
	});

	it("rejects a run whose slash does not follow whitespace", () => {
		assert.strictEqual(slashRunAtCursor("check/re"), null);
		assert.strictEqual(slashRunAtCursor("a/re"), null);
	});

	it("rejects text that does not end in a run", () => {
		assert.strictEqual(slashRunAtCursor("please /review this"), null);
		assert.strictEqual(slashRunAtCursor(""), null);
		assert.strictEqual(slashRunAtCursor("plain"), null);
	});
});

describe("CombinedAutocompleteProvider slash runs", () => {
	it("offers all commands including controls at message start", async () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);
		const result = await getSuggestions(provider, ["/"], 0, 1);

		assert.notStrictEqual(result, null);
		assert.strictEqual(result?.prefix, "/");
		assert.deepStrictEqual(itemValues(result?.items ?? []), ["model", "review", "fix", "release", "deploy"]);
	});

	it("offers a mid-line run without control commands", async () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);
		const result = await getSuggestions(provider, ["please /"], 0, 8);

		assert.notStrictEqual(result, null);
		assert.strictEqual(result?.prefix, "/");
		assert.deepStrictEqual(itemValues(result?.items ?? []), ["review", "fix", "release", "deploy"]);
		assert.ok(result?.items.every((item) => item.source !== "builtin"));
	});

	it("offers a run on the second line without control commands", async () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);
		const result = await getSuggestions(provider, ["hello", "/re"], 1, 3);

		assert.notStrictEqual(result, null);
		assert.strictEqual(result?.prefix, "/re");
		const values = itemValues(result?.items ?? []);
		assert.ok(values.includes("review"));
		assert.ok(values.includes("release"));
		assert.ok(!values.includes("model"));
	});

	it("carries the source on command items", async () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);
		const result = await getSuggestions(provider, ["please /review"], 0, 14);

		assert.strictEqual(result?.items.length, 1);
		assert.strictEqual(result?.items[0]?.source, "skill");
	});

	it("ignores a slash that is not at a candidate start", async () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);
		const result = await getSuggestions(provider, ["check/re"], 0, 8);

		assert.strictEqual(result, null);
	});

	it("keeps unknown runs literal instead of falling back to a shorter match", async () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);
		const result = await getSuggestions(provider, ["check /usr/bin"], 0, 14);

		assert.strictEqual(result, null);
	});

	it("falls back to path completion on explicit Tab mid-line when no command matches", async () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);
		const runPrefix = `${baseDir}/b`;
		const text = `check ${runPrefix}`;
		const result = await getSuggestions(provider, [text], 0, text.length, { explicitTab: true });

		assert.notStrictEqual(result, null);
		assert.strictEqual(result?.prefix, runPrefix);
		assert.deepStrictEqual(itemValues(result?.items ?? []), [`${baseDir}/bin/`]);
	});

	it("does not fall back to path completion on natural triggers", async () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);
		const runPrefix = `${baseDir}/b`;
		const text = `check ${runPrefix}`;
		const result = await getSuggestions(provider, [text], 0, text.length);

		assert.strictEqual(result, null);
	});

	it("completes arguments at message start", async () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);
		const result = await getSuggestions(provider, ["/deploy an"], 0, 10);

		assert.notStrictEqual(result, null);
		assert.strictEqual(result?.prefix, "an");
		assert.deepStrictEqual(itemValues(result?.items ?? []), ["ant"]);
	});

	it("keeps argument completion whole-message-initial", async () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);

		const secondLine = await getSuggestions(provider, ["hello", "/deploy an"], 1, 10);
		assert.strictEqual(secondLine, null);

		const midLine = await getSuggestions(provider, ["please /deploy an"], 0, 17);
		assert.strictEqual(midLine, null);
	});

	it("completes nothing after a closed mid-prompt run", async () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);
		const result = await getSuggestions(provider, ["please /review "], 0, 15);

		assert.strictEqual(result, null);
	});
});

describe("CombinedAutocompleteProvider applyCompletion slash runs", () => {
	it("applies a mid-line completion at the token position", () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);
		const result = provider.applyCompletion(["please /re"], 0, 10, { value: "review", label: "review" }, "/re");

		assert.deepStrictEqual(result.lines, ["please /review "]);
		assert.strictEqual(result.cursorCol, 15);
	});

	it("applies a completion on the second line", () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);
		const result = provider.applyCompletion(["hello", "/re"], 1, 3, { value: "review", label: "review" }, "/re");

		assert.deepStrictEqual(result.lines, ["hello", "/review "]);
		assert.strictEqual(result.cursorLine, 1);
		assert.strictEqual(result.cursorCol, 8);
	});

	it("applies a qualified command name mid-line", () => {
		const commands: SlashCommand[] = [{ name: "skill:review", description: "Review code", source: "skill" }];
		const provider = new CombinedAutocompleteProvider(commands, baseDir);
		const result = provider.applyCompletion(
			["please /skill:re"],
			0,
			16,
			{ value: "skill:review", label: "skill:review" },
			"/skill:re",
		);

		assert.deepStrictEqual(result.lines, ["please /skill:review "]);
	});

	it("keeps forced path completion on /-prefixed tokens on the file path", () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);
		const runPrefix = `${baseDir}/b`;
		const text = `check ${runPrefix}`;
		const result = provider.applyCompletion(
			[text],
			0,
			text.length,
			{ value: `${baseDir}/bin/`, label: "bin/" },
			runPrefix,
		);

		assert.deepStrictEqual(result.lines, [`check ${baseDir}/bin/`]);
	});

	it("applies first-line completions exactly as before", () => {
		const provider = new CombinedAutocompleteProvider(fixtureCommands, baseDir);
		const result = provider.applyCompletion(["/re"], 0, 3, { value: "review", label: "review" }, "/re");

		assert.deepStrictEqual(result.lines, ["/review "]);
		assert.strictEqual(result.cursorCol, 8);
	});
});

describe("Editor mid-prompt slash menu", () => {
	it("shows the menu while typing mid-line", async () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setAutocompleteProvider(new CombinedAutocompleteProvider(fixtureCommands, baseDir));

		editor.setText("please ");
		typeText(editor, "/re");
		await flushAutocomplete();

		assert.strictEqual(editor.isShowingAutocomplete(), true);
		assert.strictEqual(editor.getText(), "please /re");
	});

	it("shows the menu on a second line", async () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setAutocompleteProvider(new CombinedAutocompleteProvider(fixtureCommands, baseDir));

		typeText(editor, "hello");
		editor.handleInput("\n");
		typeText(editor, "/re");
		await flushAutocomplete();

		assert.strictEqual(editor.isShowingAutocomplete(), true);
		assert.strictEqual(editor.getText(), "hello\n/re");
	});

	it("applies a mid-line completion with Tab", async () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setAutocompleteProvider(new CombinedAutocompleteProvider([fixtureCommands[1]!], baseDir));

		editor.setText("please /re");
		editor.handleInput("\t");
		await flushAutocomplete();
		assert.strictEqual(editor.isShowingAutocomplete(), true);

		editor.handleInput("\t");
		assert.strictEqual(editor.getText(), "please /review ");
		assert.strictEqual(editor.isShowingAutocomplete(), false);
	});

	it("applies a second-line completion with Tab", async () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setAutocompleteProvider(new CombinedAutocompleteProvider([fixtureCommands[1]!], baseDir));

		editor.setText("hello\n/re");
		editor.handleInput("\t");
		await flushAutocomplete();
		assert.strictEqual(editor.isShowingAutocomplete(), true);

		editor.handleInput("\t");
		assert.strictEqual(editor.getText(), "hello\n/review ");
		assert.strictEqual(editor.isShowingAutocomplete(), false);
	});

	it("keeps the menu open when deleting within a mid-line run", async () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setAutocompleteProvider(new CombinedAutocompleteProvider(fixtureCommands, baseDir));

		editor.setText("please ");
		typeText(editor, "/rev");
		await flushAutocomplete();
		assert.strictEqual(editor.isShowingAutocomplete(), true);

		editor.handleInput("\x7f"); // Backspace
		await flushAutocomplete();

		assert.strictEqual(editor.getText(), "please /re");
		assert.strictEqual(editor.isShowingAutocomplete(), true);
	});

	it("keeps the menu open when deleting within a second-line run", async () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setAutocompleteProvider(new CombinedAutocompleteProvider(fixtureCommands, baseDir));

		typeText(editor, "hello");
		editor.handleInput("\n");
		typeText(editor, "/rev");
		await flushAutocomplete();
		assert.strictEqual(editor.isShowingAutocomplete(), true);

		editor.handleInput("\x7f"); // Backspace
		await flushAutocomplete();

		assert.strictEqual(editor.getText(), "hello\n/re");
		assert.strictEqual(editor.isShowingAutocomplete(), true);
	});

	it("applies and submits with Enter mid-line", async () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setAutocompleteProvider(new CombinedAutocompleteProvider([fixtureCommands[1]!], baseDir));

		let submitted: string | undefined;
		editor.onSubmit = (text) => {
			submitted = text;
		};

		editor.setText("please /re");
		editor.handleInput("\t");
		await flushAutocomplete();
		assert.strictEqual(editor.isShowingAutocomplete(), true);

		editor.handleInput("\r");
		assert.strictEqual(submitted, "please /review");
		assert.strictEqual(editor.getText(), "");
	});

	it("applies and submits with Enter on a second line", async () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setAutocompleteProvider(new CombinedAutocompleteProvider([fixtureCommands[1]!], baseDir));

		let submitted: string | undefined;
		editor.onSubmit = (text) => {
			submitted = text;
		};

		editor.setText("hello\n/re");
		editor.handleInput("\t");
		await flushAutocomplete();
		assert.strictEqual(editor.isShowingAutocomplete(), true);

		editor.handleInput("\r");
		assert.strictEqual(submitted, "hello\n/review");
	});

	it("excludes control commands from the mid-line menu", async () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setAutocompleteProvider(new CombinedAutocompleteProvider(fixtureCommands, baseDir));

		editor.setText("please ");
		typeText(editor, "/");
		await flushAutocomplete();
		assert.strictEqual(editor.isShowingAutocomplete(), true);

		const rendered = stripVTControlCharacters(editor.render(80).join("\n"));
		assert.ok(rendered.includes("[skill]"));
		assert.ok(!rendered.includes("model"));
		assert.ok(!rendered.includes("[builtin]"));
	});

	it("renders a badge for every source and keeps rows aligned", async () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setAutocompleteProvider(new CombinedAutocompleteProvider(fixtureCommands, baseDir));

		typeText(editor, "/");
		await flushAutocomplete();
		assert.strictEqual(editor.isShowingAutocomplete(), true);

		const lines = editor.render(80).map((line) => stripVTControlCharacters(line));
		const rendered = lines.join("\n");
		for (const badge of ["[builtin]", "[extension]", "[command]", "[prompt]", "[skill]"]) {
			assert.ok(rendered.includes(badge), `expected badge ${badge}`);
		}

		const badgeLines = lines.filter((line) => /\[(builtin|extension|command|prompt|skill)\]/.test(line));
		assert.strictEqual(badgeLines.length, 5);
		const badgeColumns = new Set(badgeLines.map((line) => line.indexOf("[")));
		assert.strictEqual(badgeColumns.size, 1, "badges should start in the same column on every row");
	});

	it("offers no argument completion mid-line", async () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setAutocompleteProvider(new CombinedAutocompleteProvider(fixtureCommands, baseDir));

		editor.setText("please /deploy ");
		typeText(editor, "an");
		await flushAutocomplete();

		assert.strictEqual(editor.isShowingAutocomplete(), false);
		assert.strictEqual(editor.getText(), "please /deploy an");
	});

	it("still offers argument completion at message start", async () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setAutocompleteProvider(new CombinedAutocompleteProvider(fixtureCommands, baseDir));

		editor.setText("/deploy ");
		typeText(editor, "an");
		await flushAutocomplete();

		assert.strictEqual(editor.isShowingAutocomplete(), true);
		editor.handleInput("\t");
		assert.strictEqual(editor.getText(), "/deploy ant");
	});
});

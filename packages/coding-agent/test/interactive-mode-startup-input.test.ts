import type { EditorComponent } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import {
	PromptHistoryController,
	type PromptHistorySessionSource,
	type PromptHistorySettingsSource,
} from "../src/modes/interactive/prompt-history-controller.ts";

type FakeEditor = EditorComponent & {
	setText: (text: string) => void;
	historyCalls: string[][];
};

type SubmitContext = {
	defaultEditor: { onSubmit?: (text: string) => void };
	editor: FakeEditor;
	promptHistoryController: PromptHistoryController;
	session: {
		isCompacting: boolean;
		isStreaming: boolean;
		isBashRunning: boolean;
		prompt: (text: string, options?: unknown) => Promise<void>;
	};
	flushPendingBashComponents: () => void;
	onInputCallback?: (text: string) => void;
	pendingUserInputs: string[];
	recordPromptHistory: (text: string) => void;
};

type InputContext = {
	onInputCallback?: (text: string) => void;
	pendingUserInputs: string[];
};

type InteractiveModePrivate = {
	setupEditorSubmitHandler(this: SubmitContext): void;
	getUserInput(this: InputContext): Promise<string>;
	recordPromptHistory(this: SubmitContext, text: string): void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrivate;

function createFakeEditor(): FakeEditor {
	const historyCalls: string[][] = [];
	let text = "";
	return {
		getText: () => text,
		setText: vi.fn((newText: string) => {
			text = newText;
		}),
		handleInput: () => {},
		render: () => [],
		invalidate: () => {},
		addToHistory: vi.fn(),
		setHistory: (entries: readonly string[]): void => {
			historyCalls.push([...entries]);
		},
		setHistoryMaxEntries: vi.fn(),
		historyCalls,
	};
}

function createSubmitContext(): SubmitContext {
	const settings: PromptHistorySettingsSource = {
		getPromptHistoryScope: () => "session",
		getPromptHistoryMaxEntries: () => 100,
	};

	return {
		defaultEditor: {},
		editor: createFakeEditor(),
		promptHistoryController: new PromptHistoryController({ settings }),
		session: {
			isCompacting: false,
			isStreaming: false,
			isBashRunning: false,
			prompt: vi.fn(async () => {}),
		},
		flushPendingBashComponents: vi.fn(),
		pendingUserInputs: [],
		recordPromptHistory: interactiveModePrototype.recordPromptHistory,
	};
}

describe("InteractiveMode startup input", () => {
	it("queues a normal prompt submitted before the input callback is installed", async () => {
		const context = createSubmitContext();
		context.promptHistoryController.setEditor(context.editor);
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.(" early prompt ");

		expect(context.pendingUserInputs).toEqual(["early prompt"]);
		expect(context.flushPendingBashComponents).toHaveBeenCalledTimes(1);
		expect(context.editor.addToHistory).toHaveBeenCalledWith("early prompt");
	});

	it("retains input submitted during the startup prompt-history refresh after that refresh resolves", async () => {
		const context = createSubmitContext();
		context.promptHistoryController.setEditor(context.editor);
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		// Simulate the awaited startup refresh in rebindCurrentSession(), which is still in flight
		// when the submit handler (wired earlier in init()) accepts input.
		let resolveLoad: (value: string[]) => void = () => {};
		const loadProjectHistory = vi.fn(
			() =>
				new Promise<string[]>((resolve) => {
					resolveLoad = resolve;
				}),
		);
		const projectSettings: PromptHistorySettingsSource = {
			getPromptHistoryScope: () => "project",
			getPromptHistoryMaxEntries: () => 100,
		};
		const controller = new PromptHistoryController({ settings: projectSettings, loadProjectHistory });
		controller.setEditor(context.editor);
		context.promptHistoryController = controller;

		const fakeSession: PromptHistorySessionSource = {
			isPersisted: () => true,
			getCwd: () => "/project",
			getSessionDir: () => "/project/sessions",
			getSessionFile: () => "/project/sessions/current.jsonl",
			getEntries: () => [],
		};
		const refreshPromise = controller.refresh(fakeSession);

		await context.defaultEditor.onSubmit?.(" early prompt ");
		expect(context.pendingUserInputs).toEqual(["early prompt"]);

		resolveLoad(["old prompt"]);
		await refreshPromise;

		expect(context.editor.historyCalls.at(-1)).toEqual(["old prompt", "early prompt"]);
	});

	it("returns queued startup input before installing a new input callback", async () => {
		const context: InputContext = {
			pendingUserInputs: ["queued prompt"],
		};

		await expect(interactiveModePrototype.getUserInput.call(context)).resolves.toBe("queued prompt");
		expect(context.onInputCallback).toBeUndefined();
		expect(context.pendingUserInputs).toEqual([]);
	});
});

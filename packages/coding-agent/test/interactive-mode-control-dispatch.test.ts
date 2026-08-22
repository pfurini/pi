/**
 * c4e: interactive control-command dispatch routed through the A.1 registry.
 * Exercises setupEditorSubmitHandler against a fake context (the startup-input
 * pattern) with a spied session.resolveControlCommand, proving: built-in >
 * extension bare-name precedence at the TUI dispatch decision (B2), hidden
 * easter-egg commands staying exact-match and unshadowable (B3), and every
 * built-in's exact argument convention plus the exact-only eligibility
 * fall-through across idle/compacting/streaming states (B4).
 */

import type { EditorComponent } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import {
	PromptHistoryController,
	type PromptHistorySettingsSource,
} from "../src/modes/interactive/prompt-history-controller.ts";

type FakeEditor = EditorComponent & {
	setText: (text: string) => void;
};

type ControlInvocation =
	| { source: "builtin"; control: true; name: string }
	| { source: "extension"; control: true; name: string; extensionName: string };

type SessionFake = {
	isCompacting: boolean;
	isStreaming: boolean;
	isBashRunning: boolean;
	prompt: ReturnType<typeof vi.fn>;
	resolveControlCommand: ReturnType<typeof vi.fn>;
	resolveExtensionCommand: ReturnType<typeof vi.fn>;
};

type DispatchContext = {
	[key: string]: unknown;
	defaultEditor: { onSubmit?: (text: string) => Promise<void> };
	editor: FakeEditor;
	promptHistoryController: PromptHistoryController;
	session: SessionFake;
	ui: { requestRender: () => void };
	flushPendingBashComponents: () => void;
	onInputCallback?: (text: string) => void;
	pendingUserInputs: string[];
	recordPromptHistory: (text: string) => void;
	queueCompactionMessage: (text: string, mode: "steer" | "followUp") => void;
	updatePendingMessagesDisplay: () => void;
	showWarning: (message: string) => void;
	handleBashCommand: (command: string, excludeFromContext?: boolean) => Promise<void>;
	updateEditorBorderColor: () => void;
	isBashMode: boolean;
	builtinControlDispatch: () => Record<string, { arg: string; run: (arg?: string) => unknown }>;
	runHiddenControlCommand: (name: string) => void;
	isExtensionCommand: (text: string) => boolean;
};

type InteractiveModePrivate = {
	setupEditorSubmitHandler(this: DispatchContext): void;
	builtinControlDispatch(this: DispatchContext): Record<string, { arg: string; run: (arg?: string) => unknown }>;
	runHiddenControlCommand(this: DispatchContext, name: string): void;
	isExtensionCommand(this: DispatchContext, text: string): boolean;
	recordPromptHistory(this: DispatchContext, text: string): void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrivate;

/** Every instance method the dispatch table or hidden pre-check can invoke. */
const HANDLER_NAMES = [
	"showSettingsSelector",
	"handleModelCommand",
	"handleThinkingCommand",
	"showModelsSelector",
	"showSkillsSelector",
	"handleExportCommand",
	"handleImportCommand",
	"handleShareCommand",
	"handleCopyCommand",
	"handleNameCommand",
	"handleSessionCommand",
	"handleChangelogCommand",
	"handleHotkeysCommand",
	"showUserMessageSelector",
	"handleCloneCommand",
	"showTreeSelector",
	"showTrustSelector",
	"handleLoginCommand",
	"showOAuthSelector",
	"handleClearCommand",
	"handleCompactCommand",
	"showSessionSelector",
	"handleReloadCommand",
	"shutdown",
	"handleDebugCommand",
	"handleArminSaysHi",
	"handleDementedDelves",
] as const;
type HandlerName = (typeof HANDLER_NAMES)[number];

function handler(context: DispatchContext, name: HandlerName): ReturnType<typeof vi.fn> {
	return context[name] as ReturnType<typeof vi.fn>;
}

/** Built-in command name → the handler its dispatch-table entry invokes. */
const HANDLER_BY_COMMAND: Record<string, HandlerName> = {
	settings: "showSettingsSelector",
	model: "handleModelCommand",
	thinking: "handleThinkingCommand",
	"scoped-models": "showModelsSelector",
	skills: "showSkillsSelector",
	export: "handleExportCommand",
	import: "handleImportCommand",
	share: "handleShareCommand",
	copy: "handleCopyCommand",
	name: "handleNameCommand",
	session: "handleSessionCommand",
	changelog: "handleChangelogCommand",
	hotkeys: "handleHotkeysCommand",
	fork: "showUserMessageSelector",
	clone: "handleCloneCommand",
	tree: "showTreeSelector",
	trust: "showTrustSelector",
	login: "handleLoginCommand",
	logout: "showOAuthSelector",
	new: "handleClearCommand",
	compact: "handleCompactCommand",
	resume: "showSessionSelector",
	reload: "handleReloadCommand",
	quit: "shutdown",
};

/** Argument convention per built-in; every name not listed here is exact-only. */
const ARG_CONVENTION: Record<string, "remainder" | "full"> = {
	model: "remainder",
	thinking: "remainder",
	login: "remainder",
	compact: "remainder",
	export: "full",
	import: "full",
	name: "full",
};

const HIDDEN_HANDLERS: Record<string, HandlerName> = {
	debug: "handleDebugCommand",
	arminsayshi: "handleArminSaysHi",
	dementedelves: "handleDementedDelves",
};

function builtinInvocation(name: string): ControlInvocation {
	return { source: "builtin", control: true, name };
}

/** Default fake registry: resolves every listed built-in, nothing else. */
function defaultControlResolution(name: string): ControlInvocation | undefined {
	return BUILTIN_SLASH_COMMANDS.some((builtin) => builtin.name === name) ? builtinInvocation(name) : undefined;
}

function createFakeEditor(): FakeEditor {
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
		setHistory: () => {},
		setHistoryMaxEntries: vi.fn(),
	};
}

interface ContextOptions {
	isCompacting?: boolean;
	isStreaming?: boolean;
	resolveControlCommand?: (name: string) => ControlInvocation | undefined;
	resolveExtensionCommand?: (name: string) => object | undefined;
}

function createDispatchContext(options: ContextOptions = {}): DispatchContext {
	const settings: PromptHistorySettingsSource = {
		getPromptHistoryScope: () => "session",
		getPromptHistoryMaxEntries: () => 100,
	};
	const context: DispatchContext = {
		defaultEditor: {},
		editor: createFakeEditor(),
		promptHistoryController: new PromptHistoryController({ settings }),
		session: {
			isCompacting: options.isCompacting ?? false,
			isStreaming: options.isStreaming ?? false,
			isBashRunning: false,
			prompt: vi.fn(async () => {}),
			resolveControlCommand: vi.fn(options.resolveControlCommand ?? defaultControlResolution),
			resolveExtensionCommand: vi.fn(options.resolveExtensionCommand ?? (() => undefined)),
		},
		ui: { requestRender: vi.fn() },
		flushPendingBashComponents: vi.fn(),
		pendingUserInputs: [],
		recordPromptHistory: interactiveModePrototype.recordPromptHistory,
		queueCompactionMessage: vi.fn(),
		updatePendingMessagesDisplay: vi.fn(),
		showWarning: vi.fn(),
		handleBashCommand: vi.fn(async () => {}),
		updateEditorBorderColor: vi.fn(),
		isBashMode: false,
		builtinControlDispatch: interactiveModePrototype.builtinControlDispatch,
		runHiddenControlCommand: interactiveModePrototype.runHiddenControlCommand,
		isExtensionCommand: interactiveModePrototype.isExtensionCommand,
	};
	for (const name of HANDLER_NAMES) {
		context[name] = vi.fn(async () => {});
	}
	context.promptHistoryController.setEditor(context.editor);
	interactiveModePrototype.setupEditorSubmitHandler.call(context);
	return context;
}

async function submit(context: DispatchContext, text: string): Promise<void> {
	await context.defaultEditor.onSubmit?.(text);
}

describe("B2: built-in wins its bare name through registry consultation", () => {
	it("dispatches the resolved built-in handler for a colliding bare name, never the extension", async () => {
		const context = createDispatchContext({
			resolveControlCommand: (name) =>
				name === "model"
					? builtinInvocation("model")
					: name === "ext:model"
						? { source: "extension", control: true, name: "model", extensionName: "model" }
						: undefined,
		});

		await submit(context, "/model");

		// Registry consultation, not a hardcoded name check, drives the decision.
		expect(context.session.resolveControlCommand).toHaveBeenCalledWith("model");
		expect(handler(context, "handleModelCommand")).toHaveBeenCalledWith(undefined);
		expect(context.session.prompt).not.toHaveBeenCalled();
		expect(context.pendingUserInputs).toEqual([]);
	});

	it("runs the handler the resolved invocation names, not the submitted token's", async () => {
		// The resolver reports the registry winner as "reload" for this token; the
		// dispatch table must run THAT handler (proves the invocation drives dispatch).
		const context = createDispatchContext({
			resolveControlCommand: () => builtinInvocation("reload"),
		});

		await submit(context, "/model");

		expect(handler(context, "handleReloadCommand")).toHaveBeenCalledTimes(1);
		expect(handler(context, "handleModelCommand")).not.toHaveBeenCalled();
	});

	it("routes /ext:model to the extension path, not the built-in table", async () => {
		const extensionWinner = (name: string): ControlInvocation | undefined =>
			name === "ext:model"
				? { source: "extension", control: true, name: "model", extensionName: "model" }
				: undefined;

		// Idle: falls through to ordinary submission; session.prompt dispatches downstream.
		const idle = createDispatchContext({ resolveControlCommand: extensionWinner });
		await submit(idle, "/ext:model");
		expect(handler(idle, "handleModelCommand")).not.toHaveBeenCalled();
		expect(idle.pendingUserInputs).toEqual(["/ext:model"]);

		// Compacting: the extension branch executes it immediately via session.prompt.
		const compacting = createDispatchContext({
			isCompacting: true,
			resolveControlCommand: extensionWinner,
			resolveExtensionCommand: (name) => (name === "ext:model" ? {} : undefined),
		});
		await submit(compacting, "/ext:model");
		expect(handler(compacting, "handleModelCommand")).not.toHaveBeenCalled();
		expect(compacting.session.prompt).toHaveBeenCalledWith("/ext:model");
	});
});

describe("B3: hidden commands stay exact-match and unshadowable", () => {
	for (const [name, handlerName] of Object.entries(HIDDEN_HANDLERS)) {
		it(`dispatches /${name} exactly even when an extension registers the name (all states)`, async () => {
			for (const state of ["idle", "compacting", "streaming"] as const) {
				const context = createDispatchContext({
					isCompacting: state === "compacting",
					isStreaming: state === "streaming",
					resolveControlCommand: () => ({ source: "extension", control: true, name, extensionName: name }),
					resolveExtensionCommand: () => ({}),
				});

				await submit(context, `/${name}`);

				expect(handler(context, handlerName)).toHaveBeenCalledTimes(1);
				expect(context.session.prompt).not.toHaveBeenCalled();
				expect(context.pendingUserInputs).toEqual([]);
				expect(context.queueCompactionMessage).not.toHaveBeenCalled();
			}
		});
	}

	it("falls through for a non-exact hidden form with no colliding extension", async () => {
		const idle = createDispatchContext();
		await submit(idle, "/debug now");
		expect(handler(idle, "handleDebugCommand")).not.toHaveBeenCalled();
		expect(idle.pendingUserInputs).toEqual(["/debug now"]);

		const compacting = createDispatchContext({ isCompacting: true });
		await submit(compacting, "/debug now");
		expect(handler(compacting, "handleDebugCommand")).not.toHaveBeenCalled();
		expect(compacting.queueCompactionMessage).toHaveBeenCalledWith("/debug now", "steer");

		const streaming = createDispatchContext({ isStreaming: true });
		await submit(streaming, "/debug now");
		expect(handler(streaming, "handleDebugCommand")).not.toHaveBeenCalled();
		expect(streaming.session.prompt).toHaveBeenCalledWith("/debug now", { streamingBehavior: "steer" });
	});

	it("routes a non-exact hidden form to the colliding extension with the text untouched", async () => {
		const colliding: ContextOptions = {
			resolveControlCommand: () => ({ source: "extension", control: true, name: "debug", extensionName: "debug" }),
			resolveExtensionCommand: (name) => (name === "debug" ? {} : undefined),
		};

		// Compacting: the extension branch executes immediately, text passed through
		// verbatim (the extension's raw-argument convention lives downstream).
		const compacting = createDispatchContext({ ...colliding, isCompacting: true });
		await submit(compacting, "/debug  now");
		expect(handler(compacting, "handleDebugCommand")).not.toHaveBeenCalled();
		expect(compacting.session.prompt).toHaveBeenCalledWith("/debug  now");

		// Streaming: steered to the session, which dispatches the extension.
		const streaming = createDispatchContext({ ...colliding, isStreaming: true });
		await submit(streaming, "/debug now");
		expect(handler(streaming, "handleDebugCommand")).not.toHaveBeenCalled();
		expect(streaming.session.prompt).toHaveBeenCalledWith("/debug now", { streamingBehavior: "steer" });

		// Idle: ordinary submission; dispatch happens downstream in session.prompt.
		const idle = createDispatchContext(colliding);
		await submit(idle, "/debug now");
		expect(handler(idle, "handleDebugCommand")).not.toHaveBeenCalled();
		expect(idle.pendingUserInputs).toEqual(["/debug now"]);
	});
});

describe("B4: per-command argument conventions", () => {
	for (const { name } of BUILTIN_SLASH_COMMANDS) {
		const handlerName = HANDLER_BY_COMMAND[name];
		const convention = ARG_CONVENTION[name] ?? "none";

		it(`/${name} dispatches ${handlerName} with the "${convention}" convention`, async () => {
			const bare = createDispatchContext();
			await submit(bare, `/${name}`);
			const bareHandler = handler(bare, handlerName);
			if (convention === "remainder") {
				expect(bareHandler).toHaveBeenCalledWith(undefined);
			} else if (convention === "full") {
				expect(bareHandler).toHaveBeenCalledWith(`/${name}`);
			} else if (name === "logout") {
				expect(bareHandler).toHaveBeenCalledWith("logout");
			} else {
				expect(bareHandler).toHaveBeenCalledWith();
			}
			expect(bare.pendingUserInputs).toEqual([]);

			const withArgs = createDispatchContext();
			await submit(withArgs, `/${name} foo bar`);
			const argsHandler = handler(withArgs, handlerName);
			if (convention === "remainder") {
				expect(argsHandler).toHaveBeenCalledWith("foo bar");
			} else if (convention === "full") {
				expect(argsHandler).toHaveBeenCalledWith(`/${name} foo bar`);
			} else {
				// Exact-only: a trailing argument is not a control invocation.
				expect(argsHandler).not.toHaveBeenCalled();
				expect(withArgs.pendingUserInputs).toEqual([`/${name} foo bar`]);
			}
		});
	}

	it("dispatches argument-bearing built-ins before the compaction and streaming branches", async () => {
		const compacting = createDispatchContext({ isCompacting: true });
		await submit(compacting, "/model gpt-5");
		expect(handler(compacting, "handleModelCommand")).toHaveBeenCalledWith("gpt-5");
		expect(compacting.queueCompactionMessage).not.toHaveBeenCalled();

		const streaming = createDispatchContext({ isStreaming: true });
		await submit(streaming, "/compact focus on tests");
		expect(handler(streaming, "handleCompactCommand")).toHaveBeenCalledWith("focus on tests");
		expect(streaming.session.prompt).not.toHaveBeenCalled();
	});

	it("normalizes remainder whitespace and treats a trailing-space bare form as bare", async () => {
		// Internal padding collapses: text.slice(spaceIndex + 1).trim() yields "gpt-5".
		const padded = createDispatchContext();
		await submit(padded, "/model   gpt-5");
		expect(handler(padded, "handleModelCommand")).toHaveBeenCalledWith("gpt-5");

		// Outer trim reduces "/model " to bare "/model", so the remainder is undefined, not "".
		const trailingSpace = createDispatchContext();
		await submit(trailingSpace, "/model ");
		expect(handler(trailingSpace, "handleModelCommand")).toHaveBeenCalledWith(undefined);
	});

	it("clears the editor with each built-in's pre-registry ordering (before vs after the handler)", async () => {
		// "remainder"/before-clear: /model clears the editor before opening the selector.
		const before = createDispatchContext();
		await submit(before, "/model");
		const modelHandler = handler(before, "handleModelCommand");
		const beforeSetText = vi.mocked(before.editor.setText);
		expect(beforeSetText).toHaveBeenCalledWith("");
		expect(beforeSetText.mock.invocationCallOrder[0]).toBeLessThan(modelHandler.mock.invocationCallOrder[0]);

		// "full"/after-clear: /export keeps the editor text until its async handler resolves.
		const after = createDispatchContext();
		await submit(after, "/export ./out.json");
		const exportHandler = handler(after, "handleExportCommand");
		const afterSetText = vi.mocked(after.editor.setText);
		expect(afterSetText).toHaveBeenCalledWith("");
		expect(exportHandler.mock.invocationCallOrder[0]).toBeLessThan(afterSetText.mock.invocationCallOrder[0]);
	});
});

describe("B4 eligibility: exact-only built-in with a trailing argument falls through in every state", () => {
	// A colliding extension for "quit" stays shadowed: the registered built-in owns
	// the bare name, so resolveExtensionCommand declines and NEITHER handler runs.
	const shadowedExtension: ContextOptions = {
		resolveControlCommand: (name) => (name === "quit" ? builtinInvocation("quit") : undefined),
		resolveExtensionCommand: () => undefined,
	};

	it("idle: ordinary input submission", async () => {
		const context = createDispatchContext(shadowedExtension);
		await submit(context, "/quit now");
		expect(handler(context, "shutdown")).not.toHaveBeenCalled();
		expect(context.session.prompt).not.toHaveBeenCalled();
		expect(context.pendingUserInputs).toEqual(["/quit now"]);
	});

	it("compacting: compaction queue", async () => {
		const context = createDispatchContext({ ...shadowedExtension, isCompacting: true });
		await submit(context, "/quit now");
		expect(handler(context, "shutdown")).not.toHaveBeenCalled();
		expect(context.session.prompt).not.toHaveBeenCalled();
		expect(context.queueCompactionMessage).toHaveBeenCalledWith("/quit now", "steer");
	});

	it("streaming: steering prompt", async () => {
		const context = createDispatchContext({ ...shadowedExtension, isStreaming: true });
		await submit(context, "/quit now");
		expect(handler(context, "shutdown")).not.toHaveBeenCalled();
		expect(context.session.prompt).toHaveBeenCalledWith("/quit now", { streamingBehavior: "steer" });
	});
});

/**
 * Fork-owned test harness for the ask_user_question base tool. It replaces the rpiv-mono
 * `@juicesharp/rpiv-test-utils` helpers the ported tests used, with the same call shapes:
 * `createMockPi()` holds a capturing event bus, and `installAskUserQuestionTool(pi)` builds
 * the real definition with `createAskUserQuestionToolDefinition`, the factory `AgentSession`
 * calls.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type MockInstance, vi } from "vitest";
import type { EventBus } from "../../../src/core/event-bus.ts";
import type { ExtensionContext, ExtensionUIContext, ToolDefinition } from "../../../src/core/extensions/types.ts";
import { createAskUserQuestionToolDefinition } from "../../../src/core/fork-builtins/ask-user-question/ask-user-question.ts";

export interface MockTheme {
	fg: (color: string, text: string) => string;
	bg: (color: string, text: string) => string;
	bold: (text: string) => string;
	strikethrough: (text: string) => string;
}

export function makeTheme(overrides: Partial<MockTheme> = {}): MockTheme {
	return {
		fg: (_color, text) => text,
		bg: (_color, text) => text,
		bold: (text) => text,
		strikethrough: (text) => text,
		...overrides,
	};
}

export function makeTui(): { requestRender: ReturnType<typeof vi.fn> } {
	return { requestRender: vi.fn() };
}

export interface CapturedPi {
	tools: Map<string, ToolDefinition>;
	eventsEmitted: Map<string, unknown[]>;
}

/** The session state the tool reads: its agent directory and its event bus. */
export interface MockPi {
	agentDir: string;
	events: EventBus;
}

const capturedByPi = new WeakMap<MockPi, CapturedPi>();

export function createMockPi(options: { events?: EventBus; agentDir?: string } = {}): {
	pi: MockPi;
	captured: CapturedPi;
} {
	const captured: CapturedPi = { tools: new Map(), eventsEmitted: new Map() };
	const events: EventBus = options.events ?? {
		emit: (channel, data) => {
			const list = captured.eventsEmitted.get(channel) ?? [];
			list.push(data);
			captured.eventsEmitted.set(channel, list);
		},
		on: () => () => {},
	};
	const pi: MockPi = {
		agentDir: options.agentDir ?? mkdtempSync(join(tmpdir(), "pi-ask-user-question-agentdir-")),
		events,
	};
	capturedByPi.set(pi, captured);
	return { pi, captured };
}

/** Builds the base tool for `pi`'s agent directory and event bus, and records it in `captured.tools`. */
export function installAskUserQuestionTool(pi: MockPi): ToolDefinition {
	const tool = createAskUserQuestionToolDefinition({ agentDir: pi.agentDir, eventBus: pi.events });
	capturedByPi.get(pi)?.tools.set(tool.name, tool);
	return tool;
}

export interface MockCtxOptions {
	hasUI?: boolean;
	mode?: string;
	cwd?: string;
	ui?: Partial<ExtensionUIContext>;
}

export function createMockUI(overrides: Partial<ExtensionUIContext> = {}): ExtensionUIContext {
	return {
		notify: vi.fn(),
		confirm: vi.fn(async () => true),
		input: vi.fn(async () => ""),
		select: vi.fn(async () => undefined),
		setWidget: vi.fn(),
		setStatus: vi.fn(),
		setWorkingMessage: vi.fn(),
		setHiddenThinkingLabel: vi.fn(),
		onTerminalInput: vi.fn(() => () => {}),
		pasteToEditor: vi.fn(),
		setEditorComponent: vi.fn(),
		...overrides,
	} as unknown as ExtensionUIContext;
}

export function createMockCtx(options: MockCtxOptions = {}): ExtensionContext {
	return {
		hasUI: options.hasUI ?? false,
		mode: options.mode,
		cwd: options.cwd ?? "/tmp/test-cwd",
		ui: createMockUI(options.ui),
		isIdle: vi.fn(() => true),
	} as unknown as ExtensionContext;
}

/**
 * Spy on `process.stdout.write` and pin `process.stdout.isTTY` for one test. The boolean
 * form installs a value; the function form installs a getter. `restore()` undoes both.
 */
export function mockStdout(isTTY: boolean | (() => boolean)): {
	stdoutWrite: MockInstance<typeof process.stdout.write>;
	restore: () => void;
} {
	const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	const isTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
	Object.defineProperty(
		process.stdout,
		"isTTY",
		typeof isTTY === "function" ? { get: isTTY, configurable: true } : { value: isTTY, configurable: true },
	);
	return {
		stdoutWrite,
		restore: () => {
			stdoutWrite.mockRestore();
			if (isTtyDescriptor) Object.defineProperty(process.stdout, "isTTY", isTtyDescriptor);
			else delete (process.stdout as { isTTY?: boolean }).isTTY;
		},
	};
}

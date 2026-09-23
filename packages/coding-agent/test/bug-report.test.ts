import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
	Container,
	Editor,
	getKeybindings,
	setKeybindings,
	stripTerminalSequences,
	TuiMainScreen,
} from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import type { AgentSession } from "../src/core/agent-session.ts";
import {
	type BugReportBundle,
	bugReportFiles,
	collectBugReportDiagnostics,
	collectBugReportMetadata,
	exportableCode,
	redactJsonValue,
	redactUrl,
} from "../src/core/bug-report.ts";
import type { CrashRecord } from "../src/core/crash-log.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { reportBug } from "../src/modes/interactive/bug-report.ts";
import { ExtensionEditorComponent } from "../src/modes/interactive/components/extension-editor.ts";
import { ExtensionSelectorComponent } from "../src/modes/interactive/components/extension-selector.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

beforeAll(() => initTheme("dark"));

describe("bug report prompt", () => {
	it("preserves line breaks in pasted descriptions", async () => {
		const previousKeybindings = getKeybindings();
		const keybindings = new KeybindingsManager();
		setKeybindings(keybindings);
		try {
			const ui = new TuiMainScreen(new VirtualTerminal());
			const editorContainer = new Container();
			const editor = new Editor(ui, getEditorTheme());
			const session = {
				model: undefined,
				settingsManager: { getExternalEditorCommand: () => "nano" },
			} as unknown as AgentSession;
			const showStatus = vi.fn();

			const report = reportBug({
				session,
				ui,
				editorContainer,
				editor,
				keybindings,
				showStatus,
				showError: vi.fn(),
			});

			const descriptionEditor = editorContainer.children[0];
			expect(descriptionEditor).toBeInstanceOf(ExtensionEditorComponent);
			if (!(descriptionEditor instanceof ExtensionEditorComponent)) throw new Error("Missing description editor");
			descriptionEditor.handleInput("\x1b[200~Request failed\r\n  ↳ pi exiting...\r\nstack trace\x1b[201~");
			descriptionEditor.handleInput("\r");
			expect(editorContainer.children[0]).toBe(editor);

			await vi.waitFor(() => expect(editorContainer.children[0]).toBeInstanceOf(ExtensionSelectorComponent));
			const transcriptSelector = editorContainer.children[0];
			if (!(transcriptSelector instanceof ExtensionSelectorComponent))
				throw new Error("Missing transcript selector");
			expect(transcriptSelector.render(120).join("\n")).toContain("Include the session transcript?");
			transcriptSelector.handleInput("j");
			transcriptSelector.handleInput("\r");
			expect(editorContainer.children[0]).toBe(editor);

			await vi.waitFor(() => expect(editorContainer.children[0]).toBeInstanceOf(ExtensionSelectorComponent));
			const summarySelector = editorContainer.children[0];
			if (!(summarySelector instanceof ExtensionSelectorComponent)) throw new Error("Missing summary selector");
			expect(summarySelector.render(120).join("\n")).toContain("Attach a summary written by");
			summarySelector.handleInput("j");
			summarySelector.handleInput("\r");
			expect(editorContainer.children[0]).toBe(editor);

			await vi.waitFor(() => expect(editorContainer.children[0]).toBeInstanceOf(ExtensionSelectorComponent));
			const deliverySelector = editorContainer.children[0];
			if (!(deliverySelector instanceof ExtensionSelectorComponent)) throw new Error("Missing delivery selector");
			const deliveryLines = deliverySelector.render(120).map(stripTerminalSequences);
			expect(deliveryLines.some((line) => line.includes("Description: Request failed"))).toBe(true);
			expect(deliveryLines.some((line) => line.includes("↳ pi exiting..."))).toBe(true);
			expect(deliveryLines.some((line) => line.includes("stack trace"))).toBe(true);

			deliverySelector.handleInput("j");
			deliverySelector.handleInput("j");
			deliverySelector.handleInput("\r");
			await report;
			expect(showStatus).toHaveBeenCalledWith("Bug report cancelled");
		} finally {
			setKeybindings(previousKeybindings);
		}
	});
});

describe("bug report redaction", () => {
	it("removes URL credentials and secret query parameters", () => {
		expect(redactUrl("https://user:pass@proxy.example.com:8080/")).toBe("https://proxy.example.com:8080/");
		expect(redactUrl("git:https://pat@github.com/org/repo")).toBe("git:https://github.com/org/repo");
		expect(redactUrl("https://api.example/v1?api-key=abc&model=x")).toBe(
			"https://api.example/v1?api-key=%3Credacted%3E&model=x",
		);
	});

	it("redacts nested secret values without hiding token counts", () => {
		expect(
			redactJsonValue({
				apiKey: "sk-123",
				headers: { Authorization: "Bearer x", "X-Trace": "1" },
				compaction: { reserveTokens: 16_384, keepRecentTokens: 20_000 },
				baseUrl: "https://me:secret@example.com/",
			}),
		).toEqual({
			apiKey: "<redacted>",
			headers: { Authorization: "<redacted>", "X-Trace": "1" },
			compaction: { reserveTokens: 16_384, keepRecentTokens: 20_000 },
			baseUrl: "https://example.com/",
		});
	});
});

describe("bug report export-safe diagnostics", () => {
	function privateFixture() {
		const tempDir = mkdtempSync(join(tmpdir(), "pi-bug-report-diagnostics-"));
		const sessionManager = SessionManager.inMemory(tempDir);
		sessionManager.appendMessage({ role: "user", content: "PRIVATE_PROMPT_TEXT", timestamp: 1 });
		const failed = fauxAssistantMessage("", {
			stopReason: "error",
			errorMessage: "401 invalid key PRIVATE_KEY_sk-live-1234567890abcdef in request body PRIVATE_BODY",
		});
		failed.rawStopReason = "content_filter";
		failed.diagnostics = [
			{
				type: "provider_error",
				timestamp: 2,
				error: {
					name: "APIError",
					message: "Authorization: Bearer PRIVATE_BEARER_TOKEN",
					stack: "Error: PRIVATE_STACK_FRAME at /Users/PRIVATE_HOME/file.ts:1:1",
					code: "invalid_api_key",
				},
				details: {
					status: 401,
					retryable: false,
					requestId: "req_PRIVATE_0123456789abcdef",
					body: "PRIVATE_RESPONSE_BODY",
					nested: { secret: "PRIVATE_NESTED" },
				},
			},
			{ type: "This diagnostic type is a sentence: PRIVATE_TYPE", timestamp: 3 },
		];
		sessionManager.appendMessage(failed);
		sessionManager.appendMessage(fauxAssistantMessage("fine"));
		const crashes: CrashRecord[] = [
			{
				timestamp: "2026-09-20T00:00:00.000Z",
				version: "0.87.1",
				kind: "uncaught_exception",
				message: "PRIVATE_CRASH_MESSAGE",
				stack: "PRIVATE_CRASH_STACK",
				sessionFile: "/Users/PRIVATE_HOME/session.jsonl",
				cwd: "/Users/PRIVATE_HOME/project",
			},
		];
		const bundle: BugReportBundle = {
			metadata: collectBugReportMetadata({
				sessionId: sessionManager.getSessionId(),
				cwd: tempDir,
				includeSession: false,
				includeSummary: false,
				messageCount: 3,
				modelRuntime: {} as ModelRuntime,
				thinkingLevel: "off",
				extensions: [],
				extensionErrors: [{ path: "npm:broken-extension", error: "PRIVATE_EXTENSION_ERROR /Users/PRIVATE_HOME" }],
				globalSettings: {},
				projectSettings: {},
			}),
			diagnostics: collectBugReportDiagnostics(sessionManager, crashes),
		};
		return { bundle, tempDir, sessionManager };
	}

	it("omits error text, bodies, stacks, detail objects, crash text, and extension errors from exported files", () => {
		const { bundle, tempDir } = privateFixture();
		try {
			const files = bugReportFiles(bundle);
			expect(files.map((file) => file.name)).toEqual(["report.json", "diagnostics.json"]);
			const exported = files.map((file) => file.data).join("\n");
			expect(exported).not.toContain("PRIVATE");
			expect(exported).not.toContain("sk-live");
			expect(exported).not.toContain("Bearer");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("keeps identifiers, timestamps, stop reasons, validated codes, and presence flags", () => {
		const { bundle, tempDir, sessionManager } = privateFixture();
		try {
			const failedEntry = sessionManager
				.getEntries()
				.find((entry) => entry.type === "message" && entry.message.role === "assistant");
			expect(bundle.diagnostics.assistantMessageCount).toBe(2);
			expect(bundle.diagnostics.assistant).toEqual([
				{
					entryId: failedEntry?.id,
					timestamp: failedEntry?.timestamp,
					provider: expect.any(String),
					model: expect.any(String),
					api: expect.any(String),
					stopReason: "error",
					rawStopReason: "content_filter",
					hasErrorMessage: true,
					diagnostics: [
						{
							type: "provider_error",
							timestamp: 2,
							error: { name: "APIError", code: "invalid_api_key", hasMessage: true, hasStack: true },
							details: { status: 401, retryable: false },
						},
						{ type: null, timestamp: 3 },
					],
				},
			]);
			expect(bundle.diagnostics.crashes).toEqual([
				{ timestamp: "2026-09-20T00:00:00.000Z", version: "0.87.1", kind: "uncaught_exception", hasStack: true },
			]);
			expect(bundle.metadata.extensionErrors).toEqual([{ path: "npm:broken-extension" }]);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("validates machine codes by shape, not by field name", () => {
		expect(exportableCode("invalid_api_key")).toBe("invalid_api_key");
		expect(exportableCode("ECONNRESET")).toBe("ECONNRESET");
		expect(exportableCode("ERR_HTTP2_STREAM_ERROR")).toBe("ERR_HTTP2_STREAM_ERROR");
		expect(exportableCode("end_turn")).toBe("end_turn");
		expect(exportableCode(429)).toBe(429);
		expect(exportableCode("rate limit exceeded")).toBeUndefined();
		expect(exportableCode("sk-live-1234567890abcdef")).toBeUndefined();
		expect(exportableCode("deadbeefdeadbeef0123")).toBeUndefined();
		expect(exportableCode("https://example.com/path")).toBeUndefined();
		expect(exportableCode("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc")).toBeUndefined();
		expect(exportableCode("")).toBeUndefined();
		expect(exportableCode("x".repeat(49))).toBeUndefined();
		expect(exportableCode(Number.NaN)).toBeUndefined();
		expect(exportableCode({ code: "nested" })).toBeUndefined();
	});
});

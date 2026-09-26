import { expect, test } from "vitest";
import {
	checkTokensaveAvailability,
	runTokensaveCommand,
	runTokensaveTool,
	setExecFileImplForTest,
	stripImageBanner,
} from "../../../src/core/fork-builtins/tokensave/runner.ts";

type Cb = (
	error: (NodeJS.ErrnoException & { killed?: boolean; signal?: string }) | null,
	stdout: string,
	stderr: string,
) => void;

function envelope(text: string): string {
	return JSON.stringify({ content: [{ type: "text", text }] });
}

test.afterEach(() => {
	setExecFileImplForTest(undefined);
});

test("builds argv as an array with tool/name/--project/--args/--json, no shell", async () => {
	let capturedFile: string | undefined;
	let capturedArgs: string[] | undefined;
	let capturedOptions: Record<string, unknown> | undefined;

	setExecFileImplForTest((file, args, options, cb: Cb) => {
		capturedFile = file;
		capturedArgs = args;
		capturedOptions = options as unknown as Record<string, unknown>;
		cb(null, envelope('{"ok":true}'), "");
		return {};
	});

	const result = await runTokensaveTool("status", { foo: "bar" }, { projectRoot: "/tmp/proj" });

	expect(capturedFile).toBe("tokensave");
	expect(capturedArgs).toStrictEqual([
		"tool",
		"status",
		"--project",
		"/tmp/proj",
		"--args",
		'{"foo":"bar"}',
		"--json",
	]);
	expect((capturedOptions as any).shell).toBe(undefined);
	expect(result.ok).toBeTruthy();
});

test("parses JSON content payload", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		cb(null, envelope(JSON.stringify({ hello: "world" })), "");
		return {};
	});

	const result = await runTokensaveTool("status", {}, { projectRoot: "/tmp" });
	expect(result.ok).toBeTruthy();
	if (result.ok) {
		expect(result.data).toStrictEqual({ hello: "world" });
		expect(result.isMarkdown).toBe(false);
	}
});

test("treats non-JSON content as markdown text", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		cb(null, envelope("## Code Context\nsome markdown"), "");
		return {};
	});

	const result = await runTokensaveTool("context", { task: "x" }, { projectRoot: "/tmp" });
	expect(result.ok).toBeTruthy();
	if (result.ok) {
		expect(result.isMarkdown).toBe(true);
		expect(result.data).toBe("## Code Context\nsome markdown");
	}
});

test("classifies binary-not-found errors", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		const err = new Error("spawn tokensave ENOENT") as NodeJS.ErrnoException;
		err.code = "ENOENT";
		cb(err, "", "");
		return {};
	});

	const result = await runTokensaveTool("status", {}, { projectRoot: "/tmp" });
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.kind).toBe("binary_not_found");
});

test("classifies timeout errors", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		const err = new Error("timeout") as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
		err.killed = true;
		err.signal = "SIGTERM";
		cb(err, "", "");
		return {};
	});

	const result = await runTokensaveTool("status", {}, { projectRoot: "/tmp", timeoutMs: 10 });
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.kind).toBe("timeout");
});

test("classifies cancellation via AbortSignal", async () => {
	const controller = new AbortController();
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		controller.abort();
		const err = new Error("aborted");
		err.name = "AbortError";
		cb(err as NodeJS.ErrnoException, "", "");
		return {};
	});

	const result = await runTokensaveTool("status", {}, { projectRoot: "/tmp", signal: controller.signal });
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.kind).toBe("cancelled");
});

test("classifies project-not-initialized failures from stderr text", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		const err = new Error("exit 1") as NodeJS.ErrnoException;
		cb(err, "", "Error: config error: no TokenSave index found at '/tmp' — run 'tokensave init' first");
		return {};
	});

	const result = await runTokensaveTool("status", {}, { projectRoot: "/tmp" });
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.kind).toBe("project_not_initialized");
});

test("classifies generic non-zero exit as command_failed", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		const err = new Error("exit 1") as NodeJS.ErrnoException;
		cb(err, "", "Error: config error: unknown tool: 'nope'");
		return {};
	});

	const result = await runTokensaveTool("nope", {}, { projectRoot: "/tmp" });
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.kind).toBe("command_failed");
});

test("classifies empty stdout as empty_result", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		cb(null, "", "");
		return {};
	});

	const result = await runTokensaveTool("search", { query: "x" }, { projectRoot: "/tmp" });
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.kind).toBe("empty_result");
});

test("classifies malformed JSON envelope", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		cb(null, "{not json", "");
		return {};
	});

	const result = await runTokensaveTool("search", { query: "x" }, { projectRoot: "/tmp" });
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.kind).toBe("malformed_json");
});

test("truncates oversized array output with an explicit note, never silently", async () => {
	const items = Array.from({ length: 500 }, (_, i) => ({ id: i, name: `symbol_${i}`, blob: "x".repeat(50) }));
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		cb(null, envelope(JSON.stringify(items)), "");
		return {};
	});

	const result = await runTokensaveTool("search", { query: "x" }, { projectRoot: "/tmp", maxOutputChars: 2000 });
	expect(result.ok).toBeTruthy();
	if (result.ok) {
		expect(result.truncated).toBe(true);
		expect(result.truncationNote && result.truncationNote.length > 0).toBeTruthy();
		expect(Array.isArray(result.data)).toBeTruthy();
		expect((result.data as unknown[]).length < items.length).toBeTruthy();
	}
});

// ---------------------------------------------------------------------------
// checkTokensaveAvailability
// ---------------------------------------------------------------------------

test("checkTokensaveAvailability reports available on a clean 'tokensave --version' exit", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		cb(null, "tokensave 7.0.0", "");
		return {};
	});

	const result = await checkTokensaveAvailability();
	expect(result).toStrictEqual({ available: true });
});

test("checkTokensaveAvailability reports not_found on ENOENT", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		const err = new Error("not found") as NodeJS.ErrnoException;
		err.code = "ENOENT";
		cb(err, "", "");
		return {};
	});

	const result = await checkTokensaveAvailability();
	expect(result.available).toBe(false);
	expect(result.reason).toBe("not_found");
});

test("checkTokensaveAvailability reports timeout when the process is killed by the timeout", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		const err = new Error("timeout") as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
		err.killed = true;
		err.signal = "SIGTERM";
		cb(err, "", "");
		return {};
	});

	const result = await checkTokensaveAvailability(10);
	expect(result.available).toBe(false);
	expect(result.reason).toBe("timeout");
});

test("checkTokensaveAvailability reports permission_denied on EACCES", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		const err = new Error("denied") as NodeJS.ErrnoException;
		err.code = "EACCES";
		cb(err, "", "");
		return {};
	});

	const result = await checkTokensaveAvailability();
	expect(result.available).toBe(false);
	expect(result.reason).toBe("permission_denied");
});

test("checkTokensaveAvailability reports failed on a non-zero exit that is not a recognized error", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		const err = new Error("exit 1") as NodeJS.ErrnoException;
		cb(err, "", "garbled crash output");
		return {};
	});

	const result = await checkTokensaveAvailability();
	expect(result.available).toBe(false);
	expect(result.reason).toBe("failed");
});

test("checkTokensaveAvailability never treats a crash or non-zero exit as available (regression for the old !error-code-ENOENT check)", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		const err = new Error("boom") as NodeJS.ErrnoException;
		err.code = "EPERM";
		cb(err, "", "");
		return {};
	});

	const result = await checkTokensaveAvailability();
	expect(result.available).toBe(false);
});

test("checkTokensaveAvailability shares one process across concurrent callers", async () => {
	let processCount = 0;
	let finish: Cb | undefined;
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		processCount += 1;
		finish = cb;
		return {};
	});

	const first = checkTokensaveAvailability();
	const second = checkTokensaveAvailability();
	expect(processCount).toBe(1);

	finish?.(null, "tokensave 7.0.0", "");
	const results = await Promise.all([first, second]);
	expect(results).toStrictEqual([{ available: true }, { available: true }]);
	expect(processCount).toBe(1);
});

// ---------------------------------------------------------------------------
// runTokensaveCommand output bounding
// ---------------------------------------------------------------------------

test("runTokensaveCommand bounds stdout/stderr with an explicit truncation message", async () => {
	const bigOutput = "x".repeat(20_000);
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		cb(null, bigOutput, "");
		return {};
	});

	const result = await runTokensaveCommand(["doctor"], "/tmp", 5000, 500);
	expect(result.ok).toBe(true);
	expect(result.stdout.length < bigOutput.length).toBeTruthy();
	expect(/truncated/i.test(result.stdout)).toBeTruthy();
});

test("runTokensaveCommand does not truncate output within the bound", async () => {
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		cb(null, "short output", "");
		return {};
	});

	const result = await runTokensaveCommand(["status"], "/tmp");
	expect(result.stdout).toBe("short output");
	expect(!/truncated/i.test(result.stdout)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Image banner (TokenSave 7.12 `status`)
// ---------------------------------------------------------------------------

const STATUS_BOX = [
	"╭──────────────────────────╮",
	"│    TokenSave v7.12.1     │",
	"├────────────┬─────────────┤",
	"│ Files  1,513 │ Nodes 31,731 │",
	"╰────────────┴─────────────╯",
].join("\n");

test("stripImageBanner drops half-block rows and keeps the box-drawn stats", () => {
	const banner = ["   ▄▄▀▀▄  ▄", "▀▀▄▄▄▀▀▀▄▄   ", "  ▄  "].join("\n");
	expect(stripImageBanner(`${banner}\n${STATUS_BOX}`)).toBe(STATUS_BOX);
	expect(stripImageBanner("✔ sync done — 3 added\n\nFiles 1,513")).toBe("✔ sync done — 3 added\n\nFiles 1,513");
});

test("runTokensaveCommand removes the coloured image banner from status output", async () => {
	// Two banner rows as TokenSave prints them: 24-bit colour codes around half blocks.
	const bannerRow =
		"\u001b[49m \u001b[38;2;33;25;35;49m▄\u001b[38;2;24;11;25;48;2;33;26;12m▄\u001b[49;38;2;29;27;35m▀\u001b[m";
	setExecFileImplForTest((_file, _args, _options, cb: Cb) => {
		cb(null, `${bannerRow}\n${bannerRow}\n\u001b[32m${STATUS_BOX}\u001b[0m\n`, "");
		return {};
	});

	const result = await runTokensaveCommand(["status", "/repo"], "/repo");
	expect(result.stdout).toBe(STATUS_BOX);
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { BashResult } from "../../src/core/bash-executor.ts";
import type { BashExecutionMessage } from "../../src/core/messages.ts";
import type { InlineExtension } from "../../src/index.ts";
import { createHarness, type Harness } from "./harness.ts";

function lastBashMessage(harness: Harness): BashExecutionMessage {
	const messages = harness.session.messages;
	const message = messages[messages.length - 1];
	expect(message?.role).toBe("bashExecution");
	return message as BashExecutionMessage;
}

/** Replaces "SECRET" in both patchable fields, and tries to overwrite the executor-owned ones. */
const sanitizingExtension: InlineExtension = (pi) => {
	pi.on("bash_result", (event) => ({
		command: event.command.replaceAll("SECRET", "[redacted]"),
		output: event.output.replaceAll("SECRET", "[redacted]"),
		exitCode: 0,
		cancelled: false,
		truncated: false,
		excludeFromContext: false,
	}));
};

const failedResult: BashResult = {
	output: "SECRET leaked\n",
	exitCode: 3,
	cancelled: true,
	truncated: true,
	fullOutputPath: "/tmp/full-output",
	fullOutputCapped: true,
};

describe("AgentSession bash_result hook", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("patches the result an extension recorded itself", async () => {
		const harness = await createHarness({ extensionFactories: [sanitizingExtension] });
		harnesses.push(harness);

		await harness.session.recordBashResult("echo SECRET", {
			output: "SECRET\n",
			exitCode: 0,
			cancelled: false,
			truncated: false,
		});

		const message = lastBashMessage(harness);
		expect(message.command).toBe("echo [redacted]");
		expect(message.output).toBe("[redacted]\n");
	});

	it("patches the result executeBash produced", async () => {
		const harness = await createHarness({ extensionFactories: [sanitizingExtension] });
		harnesses.push(harness);

		const result = await harness.session.executeBash("printf 'SECRET'");

		// The executor's own return value is untouched; only what pi records is sanitized.
		expect(result.output).toContain("SECRET");
		const message = lastBashMessage(harness);
		expect(message.command).toBe("printf '[redacted]'");
		expect(message.output).toBe("[redacted]");
	});

	it("keeps every executor-owned field a handler tried to overwrite", async () => {
		const harness = await createHarness({ extensionFactories: [sanitizingExtension] });
		harnesses.push(harness);

		await harness.session.recordBashResult("echo SECRET", failedResult, { excludeFromContext: true });

		const message = lastBashMessage(harness);
		expect(message.output).toBe("[redacted] leaked\n");
		expect(message.exitCode).toBe(3);
		expect(message.cancelled).toBe(true);
		expect(message.truncated).toBe(true);
		expect(message.fullOutputPath).toBe("/tmp/full-output");
		expect(message.fullOutputCapped).toBe(true);
		expect(message.excludeFromContext).toBe(true);
	});

	it("chains handlers in load order", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("bash_result", (event) => ({ output: `${event.output}[1]` }));
				},
				(pi) => {
					pi.on("bash_result", (event) => ({ output: `${event.output}[2]` }));
				},
			],
		});
		harnesses.push(harness);

		await harness.session.recordBashResult("echo hi", {
			output: "hi",
			exitCode: 0,
			cancelled: false,
			truncated: false,
		});

		expect(lastBashMessage(harness).output).toBe("hi[1][2]");
	});

	it("skips the hook entirely when no extension subscribes", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const emitBashResult = vi.spyOn(harness.session.extensionRunner, "emitBashResult");

		await harness.session.recordBashResult("echo hi", {
			output: "hi",
			exitCode: 0,
			cancelled: false,
			truncated: false,
		});

		expect(emitBashResult).not.toHaveBeenCalled();
		const message = lastBashMessage(harness);
		expect(message.command).toBe("echo hi");
		expect(message.output).toBe("hi");
	});

	it("still defers the patched message while the agent is streaming", async () => {
		const harness = await createHarness({ extensionFactories: [sanitizingExtension] });
		harnesses.push(harness);
		Object.defineProperty(harness.session, "isStreaming", { get: () => true, configurable: true });

		await harness.session.recordBashResult("echo SECRET", {
			output: "SECRET\n",
			exitCode: 0,
			cancelled: false,
			truncated: false,
		});

		expect(harness.session.hasPendingBashMessages).toBe(true);
		expect(harness.session.messages.some((message) => message.role === "bashExecution")).toBe(false);
	});
});

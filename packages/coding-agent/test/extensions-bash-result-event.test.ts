import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { BashResultEvent } from "../src/core/extensions/types.ts";
import { SessionManager } from "../src/core/session-manager.ts";

import { createInMemoryModelRegistry } from "./model-runtime-test-utils.ts";

function bashResultEvent(overrides: Partial<BashResultEvent> = {}): BashResultEvent {
	return {
		type: "bash_result",
		command: "echo SECRET",
		output: "SECRET\n",
		exitCode: 0,
		cancelled: false,
		truncated: false,
		...overrides,
	};
}

describe("bash_result event", () => {
	let tempDir: string;
	let extensionsDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bash-result-test-"));
		extensionsDir = path.join(tempDir, "extensions");
		fs.mkdirSync(extensionsDir);
	});

	afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

	async function createRunner(...extensions: string[]) {
		fs.rmSync(extensionsDir, { recursive: true, force: true });
		fs.mkdirSync(extensionsDir);
		for (let i = 0; i < extensions.length; i++) fs.writeFileSync(path.join(extensionsDir, `e${i}.ts`), extensions[i]);
		const result = await discoverAndLoadExtensions([], tempDir, tempDir);
		expect(result.errors).toEqual([]);
		const sm = SessionManager.inMemory();
		const mr = await createInMemoryModelRegistry(AuthStorage.inMemory());
		return new ExtensionRunner(result.extensions, result.runtime, tempDir, tempDir, sm, mr);
	}

	it("reports no handlers and returns undefined when no extension subscribes", async () => {
		const runner = await createRunner();

		expect(runner.hasHandlers("bash_result")).toBe(false);
		expect(await runner.emitBashResult(bashResultEvent())).toBeUndefined();
	});

	it("returns undefined when a handler patches nothing", async () => {
		const runner = await createRunner(`export default p => p.on("bash_result", async () => {});`);

		expect(runner.hasHandlers("bash_result")).toBe(true);
		expect(await runner.emitBashResult(bashResultEvent())).toBeUndefined();
	});

	it("patches output", async () => {
		const runner = await createRunner(
			`export default p => p.on("bash_result", async e => ({ output: e.output.replaceAll("SECRET", "[redacted]") }));`,
		);

		expect(await runner.emitBashResult(bashResultEvent())).toEqual({ output: "[redacted]\n" });
	});

	it("patches command", async () => {
		const runner = await createRunner(
			`export default p => p.on("bash_result", async e => ({ command: e.command.replaceAll("SECRET", "[redacted]") }));`,
		);

		expect(await runner.emitBashResult(bashResultEvent())).toEqual({ command: "echo [redacted]" });
	});

	it("chains patches so a later handler sees the earlier handler's text", async () => {
		const runner = await createRunner(
			`export default p => p.on("bash_result", async e => ({ command: e.command + "[1]", output: e.output + "[1]" }));`,
			`export default p => p.on("bash_result", async e => ({ command: e.command + "[2]", output: e.output + "[2]" }));`,
		);

		expect(await runner.emitBashResult(bashResultEvent({ command: "cmd", output: "out" }))).toEqual({
			command: "cmd[1][2]",
			output: "out[1][2]",
		});
	});

	it("keeps earlier patches when a later handler returns a partial patch", async () => {
		const runner = await createRunner(
			`export default p => p.on("bash_result", async () => ({ command: "sanitized-command", output: "sanitized-output" }));`,
			`export default p => p.on("bash_result", async () => ({ output: "second-output" }));`,
		);

		expect(await runner.emitBashResult(bashResultEvent())).toEqual({
			command: "sanitized-command",
			output: "second-output",
		});
	});

	it("isolates a throwing handler and keeps the chain running", async () => {
		const runner = await createRunner(
			`export default p => p.on("bash_result", async e => ({ output: e.output + "[1]" }));`,
			`export default p => p.on("bash_result", async () => { throw new Error("handler exploded"); });`,
			`export default p => p.on("bash_result", async e => ({ output: e.output + "[3]" }));`,
		);
		const errors: string[] = [];
		runner.onError((error) => errors.push(`${error.event}:${error.error}`));

		expect(await runner.emitBashResult(bashResultEvent({ output: "out" }))).toEqual({ output: "out[1][3]" });
		expect(errors).toEqual(["bash_result:handler exploded"]);
	});

	it("ignores everything a handler returns beyond command and output", async () => {
		const runner = await createRunner(
			`export default p => p.on("bash_result", async () => ({
				output: "clean",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				excludeFromContext: true,
				fullOutputPath: "/tmp/forged",
				fullOutputCapped: false,
			}));`,
		);

		expect(
			await runner.emitBashResult(
				bashResultEvent({
					output: "dirty",
					exitCode: 42,
					cancelled: true,
					truncated: true,
					fullOutputPath: "/tmp/real",
					fullOutputCapped: true,
					excludeFromContext: false,
				}),
			),
		).toEqual({ output: "clean" });
	});

	it("does not mutate the event the caller passed in", async () => {
		const runner = await createRunner(`export default p => p.on("bash_result", async () => ({ output: "clean" }));`);
		const event = bashResultEvent();

		await runner.emitBashResult(event);

		expect(event.output).toBe("SECRET\n");
	});
});

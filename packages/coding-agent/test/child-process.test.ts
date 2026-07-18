import type { ChildProcess } from "node:child_process";
import { getEventListeners, once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { spawnProcess, waitForChildProcess } from "../src/utils/child-process.ts";

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 3000): Promise<T> {
	let timeout: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

describe("waitForChildProcess force settlement", () => {
	const children: ChildProcess[] = [];

	afterEach(() => {
		for (const child of children.splice(0)) {
			if (!child.pid) continue;
			try {
				if (process.platform === "win32") child.kill("SIGKILL");
				else process.kill(-child.pid, "SIGKILL");
			} catch {
				// The process or process group has already exited.
			}
		}
	});

	function spawnNode(script: string): ChildProcess {
		const child = spawnProcess(process.execPath, ["-e", script], {
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});
		children.push(child);
		return child;
	}

	it("force-settles with an already-aborted signal and removes listeners", async () => {
		const controller = new AbortController();
		controller.abort();
		const child = spawnNode("setTimeout(() => {}, 30000)");

		const code = await withTimeout(waitForChildProcess(child, { forceSignal: controller.signal }));

		expect(code).toBeNull();
		expect(child.stdout?.destroyed).toBe(true);
		expect(child.stderr?.destroyed).toBe(true);
		expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
	});

	it.skipIf(process.platform === "win32")(
		"force-settles after child exit while a descendant keeps writing inherited stdout",
		async () => {
			const child = spawnProcess(
				"/bin/sh",
				["-c", 'printf "HEAD\\n"; ( for i in 1 2 3 4 5 6 7 8; do sleep 0.05; printf "TICK$i\\n"; done ) &'],
				{ stdio: ["ignore", "pipe", "pipe"], detached: true },
			);
			children.push(child);
			let output = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				output += chunk.toString();
			});
			const exited = once(child, "exit");
			const controller = new AbortController();
			const waiting = waitForChildProcess(child, { forceSignal: controller.signal });

			await exited;
			await new Promise((resolve) => setTimeout(resolve, 120));
			controller.abort();
			const code = await withTimeout(waiting);

			expect(code).toBe(0);
			expect(output).toContain("HEAD");
			expect(output).toContain("TICK");
			expect(child.stdout?.destroyed).toBe(true);
			expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
		},
	);

	it("settles once when force and close race", async () => {
		const child = spawnNode("setTimeout(() => {}, 20)");
		const controller = new AbortController();
		let settlements = 0;
		const waiting = waitForChildProcess(child, { forceSignal: controller.signal }).then((code) => {
			settlements++;
			return code;
		});
		setTimeout(() => controller.abort(), 20);

		await withTimeout(waiting);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(settlements).toBe(1);
		expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
	});

	it("preserves normal exit and output behavior without a force signal", async () => {
		const child = spawnNode('process.stdout.write("done"); process.exitCode = 7;');
		let output = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});

		const code = await withTimeout(waitForChildProcess(child));

		expect(code).toBe(7);
		expect(output).toBe("done");
	});
});

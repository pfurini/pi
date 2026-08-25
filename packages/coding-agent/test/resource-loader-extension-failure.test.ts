import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";

/**
 * Issue #8423 covers extension rollback at the bare loader API
 * (`loadExtensionFromFactory`). This file covers the layer above it: a failing
 * extension inside a full `DefaultResourceLoader.reload()`, which also discovers
 * and publishes skills. Skill discovery runs alongside extension loading, so a
 * half-rolled-back extension is exactly where a leaked handler or a lost skill
 * snapshot would show up.
 */
describe("DefaultResourceLoader with a failing extension", () => {
	let tempDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `rl-extfail-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	function writeSkillFixture(name: string): void {
		const skillsDir = join(agentDir, "skills", name);
		mkdirSync(skillsDir, { recursive: true });
		writeFileSync(
			join(skillsDir, "SKILL.md"),
			`---
name: ${name}
description: Fixture skill for the extension-failure integration test
---

Body of ${name}.
`,
		);
	}

	it("keeps skills loaded and discards the failed extension's runtime state", async () => {
		writeSkillFixture("survivor-skill");

		let capturedApi: ExtensionAPI | undefined;
		let failedHandlerCalls = 0;
		// Control subscriber on the same event. Without it, asserting the failed
		// extension's handler never runs would also pass if the emit reached nothing.
		let healthyHandlerCalls = 0;

		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			extensionFactories: [
				{
					name: "failing",
					factory: (pi) => {
						capturedApi = pi;
						pi.events.on("integration-probe", () => {
							failedHandlerCalls++;
						});
						pi.registerFlag("failing-flag", { type: "boolean", default: true });
						pi.registerProvider("failing-provider", {
							baseUrl: "https://provider.test/v1",
							apiKey: "provider-test-key",
						});
						throw new Error("integration factory failed");
					},
				},
				{
					name: "healthy",
					factory: (pi) => {
						pi.events.on("integration-probe", () => {
							healthyHandlerCalls++;
						});
					},
				},
			],
		});

		// A failing extension must not fail the reload: the session still has to start.
		await loader.reload();

		const extensions = loader.getExtensions();
		expect(extensions.errors.some((entry) => entry.error.includes("integration factory failed"))).toBe(true);
		expect(extensions.extensions.map((extension) => extension.path)).not.toContain("<inline:failing>");

		// The skill published beside the failing extension survives.
		expect(loader.getSkills().skills.map((skill) => skill.name)).toContain("survivor-skill");

		// Runtime state registered before the throw is rolled back.
		expect(extensions.runtime.flagValues.has("failing-flag")).toBe(false);
		expect(extensions.runtime.pendingProviderRegistrations.map(({ name }) => name)).not.toContain("failing-provider");

		// The subscription is gone, so the failed extension cannot observe later events.
		// The healthy count proves the emit actually reached the bus.
		loader.getEventBus?.()?.emit("integration-probe", undefined);
		expect(healthyHandlerCalls).toBe(1);
		expect(failedHandlerCalls).toBe(0);

		// Its API is fenced off rather than merely inert.
		expect(capturedApi).toBeDefined();
		expect(() => capturedApi?.registerFlag("late-flag", { type: "boolean", default: true })).toThrow();
	});

	it("loads a healthy extension and its skills when another extension fails", async () => {
		writeSkillFixture("survivor-skill");

		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			extensionFactories: [
				{
					name: "failing",
					factory: () => {
						throw new Error("integration factory failed");
					},
				},
				{
					name: "healthy",
					factory: (pi) => {
						pi.registerFlag("healthy-flag", { type: "boolean", default: true });
					},
				},
			],
		});

		await loader.reload();

		const extensions = loader.getExtensions();
		expect(extensions.errors.some((entry) => entry.error.includes("integration factory failed"))).toBe(true);
		// One failure must not roll back a sibling's registrations.
		expect(extensions.runtime.flagValues.has("healthy-flag")).toBe(true);
		expect(extensions.runtime.flagValues.has("failing-flag")).toBe(false);
		expect(loader.getSkills().skills.map((skill) => skill.name)).toContain("survivor-skill");
	});
});

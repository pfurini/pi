import { homedir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveAgentDir } from "../../../src/core/fork-builtins/tokensave/agent-dir.ts";

const ENV = "PI_CODING_AGENT_DIR";

function withAgentDirEnv(value: string | undefined, run: () => void): void {
	const previous = process.env[ENV];
	if (value === undefined) delete process.env[ENV];
	else process.env[ENV] = value;
	try {
		run();
	} finally {
		if (previous === undefined) delete process.env[ENV];
		else process.env[ENV] = previous;
	}
}

test("resolveAgentDir prefers the agentDir the host reports", () => {
	withAgentDirEnv("/env/agent", () => {
		expect(resolveAgentDir({ agentDir: "/session/agent" })).toBe("/session/agent");
	});
});

test("resolveAgentDir falls back to PI_CODING_AGENT_DIR on upstream Pi, which has no agentDir", () => {
	withAgentDirEnv("/env/agent", () => {
		expect(resolveAgentDir({})).toBe("/env/agent");
		expect(resolveAgentDir()).toBe("/env/agent");
	});
	withAgentDirEnv("~/custom-agent", () => {
		expect(resolveAgentDir({})).toBe(join(homedir(), "custom-agent"));
	});
});

test("resolveAgentDir defaults to ~/.pi/agent", () => {
	withAgentDirEnv(undefined, () => {
		expect(resolveAgentDir({ agentDir: "" })).toBe(join(homedir(), ".pi", "agent"));
		expect(resolveAgentDir()).toBe(join(homedir(), ".pi", "agent"));
	});
});

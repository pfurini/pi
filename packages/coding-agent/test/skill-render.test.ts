/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: A.3 placeholder fixtures */
/**
 * A.3 render pipeline orchestration tests: preamble, exact stage order,
 * single-pass behavior, @path absolutization, agent-name rewrite, shell
 * injection wiring, ASE-style interop includes, and the CC tool note.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type LoadedSkill, normalizeSkillInput } from "../src/core/skills/frontmatter.ts";
import { type RenderSkillContext, renderSkillInvocation } from "../src/core/skills/render.ts";
import type { SkillInvocation } from "../src/core/skills/runtime.ts";
import { DEFAULT_SKILL_SHELL_SETTINGS } from "../src/core/skills/shell-injection.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import type { BashOperations } from "../src/core/tools/bash.ts";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop() as string, { recursive: true, force: true });
	}
});

function writeSkill(body: string, frontmatter: Record<string, unknown> = {}): { skill: LoadedSkill; dir: string } {
	const dir = mkdtempSync(join(tmpdir(), "pi-c1b-render-"));
	tempDirs.push(dir);
	const filePath = join(dir, "SKILL.md");
	const frontmatterLines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${String(value)}`);
	writeFileSync(filePath, `---\n${frontmatterLines.join("\n")}\n---\n${body}`);
	const { skill } = normalizeSkillInput({
		name: (frontmatter.name as string) ?? "test-skill",
		description: "Test description",
		filePath,
		baseDir: dir,
		sourceInfo: createSyntheticSourceInfo(filePath, { source: "test" }),
		disableModelInvocation: false,
		frontmatter,
	});
	return { skill, dir };
}

function invocationFor(skill: LoadedSkill, rawArgs = "", overrides: Partial<SkillInvocation> = {}): SkillInvocation {
	return {
		invocationId: "inv-1",
		skillId: skill.id,
		name: skill.name,
		baseDir: skill.baseDir,
		filePath: skill.filePath,
		rawArgs,
		...overrides,
	};
}

function fakeOperations(script: Array<{ output?: string; exitCode?: number | null }>): {
	operations: BashOperations;
	commands: string[];
} {
	const commands: string[] = [];
	let index = 0;
	return {
		commands,
		operations: {
			exec: async (command, _cwd, options) => {
				commands.push(command);
				const step = script[Math.min(index, script.length - 1)] ?? {};
				index++;
				if (step.output) options.onData(Buffer.from(step.output));
				return { exitCode: step.exitCode === undefined ? 0 : step.exitCode };
			},
		},
	};
}

function renderContext(overrides: Partial<RenderSkillContext> = {}): RenderSkillContext {
	return {
		cwd: "/tmp/work",
		sessionId: "session-1",
		thinkingLevel: "medium",
		skillInterop: true,
		activeToolNames: ["read", "bash"],
		shellSettings: { ...DEFAULT_SKILL_SHELL_SETTINGS },
		...overrides,
	};
}

describe("renderSkillInvocation — stage 1 preamble", () => {
	it("prepends the base-dir preamble", async () => {
		const { skill, dir } = writeSkill("Body text.");
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext());
		expect(result.body).toBe(`Base directory for this skill: ${dir}\n\nBody text.`);
		expect(result.diagnostics).toEqual([]);
	});

	it("strips the frontmatter from the body", async () => {
		const { skill } = writeSkill("Body text.", { name: "test-skill" });
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext());
		expect(result.body).not.toContain("description:");
	});
});

describe("renderSkillInvocation — stage order and single pass", () => {
	it("substitutes arguments before shell injection: args inside !` are part of the command", async () => {
		const { operations, commands } = fakeOperations([{ output: "hi" }]);
		const { skill } = writeSkill("run !`echo $1` now");
		const result = await renderSkillInvocation(
			skill,
			invocationFor(skill, "hi"),
			renderContext({ bashOperations: operations }),
		);
		expect(commands).toEqual(["echo hi"]);
		expect(result.body).toContain("run hi now");
	});

	it("never re-scans shell output for earlier-stage syntax", async () => {
		const { operations } = fakeOperations([{ output: "$ARGUMENTS ${PI_SKILL_DIR} !`nested`" }]);
		const { skill } = writeSkill("out: !`emit`");
		const result = await renderSkillInvocation(
			skill,
			invocationFor(skill, "abc"),
			renderContext({ bashOperations: operations }),
		);
		expect(result.body).toContain("out: $ARGUMENTS ${PI_SKILL_DIR} !`nested`");
	});

	it("runs variable substitution after argument substitution", async () => {
		const { skill, dir } = writeSkill("arg=$1 dir=${PI_SKILL_DIR}");
		const result = await renderSkillInvocation(skill, invocationFor(skill, "v"), renderContext());
		expect(result.body).toContain(`arg=v dir=${dir}`);
	});
});

describe("renderSkillInvocation — variable substitution (A.8)", () => {
	it("substitutes the native PI_* variables", async () => {
		const { skill, dir } = writeSkill("${PI_SKILL_DIR}|${PI_SESSION_ID}|${PI_EFFORT}");
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext());
		expect(result.body).toContain(`${dir}|session-1|medium`);
	});

	it("accepts CLAUDE_* aliases when skillInterop is on (ASE-style include)", async () => {
		const { skill, dir } = writeSkill("Read ${CLAUDE_SKILL_DIR}/references/x.md for details.");
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext({ skillInterop: true }));
		expect(result.body).toContain(`Read ${join(dir, "references/x.md")} for details.`);
	});

	it("leaves CLAUDE_* aliases literal when skillInterop is off", async () => {
		const { skill } = writeSkill("Read ${CLAUDE_SKILL_DIR}/references/x.md.");
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext({ skillInterop: false }));
		expect(result.body).toContain("Read ${CLAUDE_SKILL_DIR}/references/x.md.");
	});

	it("uses the invocation effort for PI_EFFORT when preserved (ASE convention)", async () => {
		const { skill } = writeSkill("effort=${PI_EFFORT}");
		const invocation = invocationFor(skill, "", { effort: "high" });
		const result = await renderSkillInvocation(skill, invocation, renderContext());
		expect(result.body).toContain("effort=high");
		expect(result.invocation.effort).toBe("high");
	});

	it("carries disallowed-tools into the detached invocation metadata", async () => {
		const { skill } = writeSkill("body");
		const invocation = invocationFor(skill, "", { disallowedTools: ["Bash"] });
		const result = await renderSkillInvocation(skill, invocation, renderContext());
		expect(result.invocation.disallowedTools).toEqual(["Bash"]);
	});
});

describe("renderSkillInvocation — @path absolutization (no inlining)", () => {
	it("makes skill-relative @paths absolute against the baseDir", async () => {
		const { skill, dir } = writeSkill("See @references/x.md now.");
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext());
		expect(result.body).toContain(`See ${join(dir, "references/x.md")} now.`);
	});

	it("leaves escaped, absolute, code-fenced, inline-code, and non-path @tokens untouched", async () => {
		const body = [
			"escaped \\@references/x.md",
			"absolute @/etc/hosts",
			"mention @user",
			"inline `@references/inline.md`",
			"```",
			"fenced @references/fenced.md",
			"```",
		].join("\n");
		const { skill } = writeSkill(body);
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext());
		expect(result.body).toContain("escaped @references/x.md");
		expect(result.body).toContain("absolute @/etc/hosts");
		expect(result.body).toContain("mention @user");
		expect(result.body).toContain("inline `@references/inline.md`");
		expect(result.body).toContain("fenced @references/fenced.md");
	});

	it("treats a closing fence with an info string as unterminated, consistent with shell injection", async () => {
		const body = ["```", "@references/a.md", "``` js", "@references/b.md"].join("\n");
		const { skill } = writeSkill(body);
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext());
		// The ``` js line does not close the fence, so both @paths stay relative.
		expect(result.body).toContain("@references/a.md");
		expect(result.body).toContain("@references/b.md");
	});
});

describe("renderSkillInvocation — agent-name rewrite (A.3.4)", () => {
	const rewriteMap = { "code-reviewer": { qualified: "simplify:code-reviewer", collided: true } };

	it("rewrites collided bare names case-insensitively, including inside code blocks", async () => {
		const body = "Use code-reviewer here.\n```\nalso Code-Reviewer here\n```";
		const { skill } = writeSkill(body);
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext({ rewriteMap }));
		expect(result.body).toContain("Use simplify:code-reviewer here.");
		expect(result.body).toContain("also simplify:code-reviewer here");
	});

	it("never rewrites already-qualified forms or identifier substrings", async () => {
		const body = "simplify:code-reviewer and my-code-reviewer and code-reviewers";
		const { skill } = writeSkill(body);
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext({ rewriteMap }));
		expect(result.body).toContain(body);
	});

	it("no-ops without a rewrite map", async () => {
		const { skill } = writeSkill("Use code-reviewer here.");
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext());
		expect(result.body).toContain("Use code-reviewer here.");
	});
});

describe("renderSkillInvocation — shell injection wiring (A.3.5)", () => {
	it("executes injections with the skill's own env values", async () => {
		let seenEnv: NodeJS.ProcessEnv | undefined;
		const operations: BashOperations = {
			exec: async (_command, _cwd, options) => {
				seenEnv = options.env;
				options.onData(Buffer.from("ok"));
				return { exitCode: 0 };
			},
		};
		const { skill, dir } = writeSkill("!`cmd`");
		await renderSkillInvocation(skill, invocationFor(skill), renderContext({ bashOperations: operations }));
		expect(seenEnv?.PI_SKILL_DIR).toBe(dir);
		expect(seenEnv?.CLAUDE_SKILL_DIR).toBe(dir);
		expect(seenEnv?.PI_SESSION_ID).toBe("session-1");
	});

	it("drops CLAUDE_* env aliases when skillInterop is off", async () => {
		let seenEnv: NodeJS.ProcessEnv | undefined;
		const operations: BashOperations = {
			exec: async (_command, _cwd, options) => {
				seenEnv = options.env;
				return { exitCode: 0 };
			},
		};
		const { skill, dir } = writeSkill("!`cmd`");
		await renderSkillInvocation(
			skill,
			invocationFor(skill),
			renderContext({ bashOperations: operations, skillInterop: false }),
		);
		expect(seenEnv?.PI_SKILL_DIR).toBe(dir);
		expect(seenEnv?.CLAUDE_SKILL_DIR).toBeUndefined();
	});

	it("blocks injection when the skill disallows Bash (redirect-normalized)", async () => {
		const { operations, commands } = fakeOperations([{ output: "ok" }]);
		const { skill } = writeSkill("!`cmd`", { "disallowed-tools": ["Bash"] });
		const result = await renderSkillInvocation(
			skill,
			invocationFor(skill, "", { disallowedTools: ["Bash"] }),
			renderContext({ bashOperations: operations }),
		);
		expect(commands).toEqual([]);
		expect(result.body).toContain("[shell command execution disabled by tool policy]");
	});
});

describe("renderSkillInvocation — CC tool note (ADR-0006)", () => {
	it("appends the steering note when CC tool names appear in the body", async () => {
		const { skill } = writeSkill("Use the Task tool to delegate.");
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext());
		expect(result.body).toContain("Claude Code tool names");
		expect(result.body).toContain("`Task` → `Agent`");
	});

	it("appends no note when no CC tool names appear", async () => {
		const { skill } = writeSkill("Plain body without special names.");
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext());
		expect(result.body).not.toContain("Claude Code tool names");
	});
});

describe("renderSkillInvocation — result shape", () => {
	it("returns detached invocation metadata", async () => {
		const { skill } = writeSkill("Body.");
		const invocation = invocationFor(skill, "a b", { model: "test-model", shell: "bash" });
		const result = await renderSkillInvocation(skill, invocation, renderContext());
		expect(result.invocation).toEqual({
			invocationId: "inv-1",
			skillId: skill.id,
			name: skill.name,
			baseDir: skill.baseDir,
			filePath: skill.filePath,
			args: "a b",
			model: "test-model",
			shell: "bash",
		});
	});
});

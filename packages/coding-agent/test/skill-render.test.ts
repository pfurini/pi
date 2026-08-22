/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: A.3 placeholder fixtures */
/**
 * A.3 render pipeline orchestration tests: preamble, exact stage order,
 * single-pass behavior, `@path` references left verbatim, agent-name rewrite,
 * shell injection wiring, ASE-style interop includes, and the CC tool note.
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
		const { skill } = writeSkill("run !`echo $0` now");
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
		const { skill, dir } = writeSkill("arg=$0 dir=${PI_SKILL_DIR}");
		const result = await renderSkillInvocation(skill, invocationFor(skill, "v"), renderContext());
		expect(result.body).toContain(`arg=v dir=${dir}`);
	});

	it("runs the agent-name rewrite before every stage that introduces text", async () => {
		// Stage 1 sees only what the author wrote, so neither the substituted
		// variable value nor the argument value is scanned for agent names.
		const { skill } = writeSkill("dir=${PI_SKILL_DIR} arg=$ARGUMENTS");
		const result = await renderSkillInvocation(
			skill,
			invocationFor(skill, "code-reviewer"),
			renderContext({ rewriteMap: { "code-reviewer": { qualified: "simplify:code-reviewer", collided: true } } }),
		);
		expect(result.body).toContain("arg=code-reviewer");
		expect(result.body).not.toContain("simplify:code-reviewer");
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

describe("renderSkillInvocation — @path references (never rewritten)", () => {
	it("leaves a skill-authored @path exactly as written", async () => {
		const { skill } = writeSkill("See @references/x.md now.");
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext());
		expect(result.body).toContain("See @references/x.md now.");
	});

	it("leaves an argument-derived @path alone (issue #6)", async () => {
		const { skill, dir } = writeSkill("**Input**: $ARGUMENTS");
		const result = await renderSkillInvocation(skill, invocationFor(skill, "@docs/handoff.md"), renderContext());
		expect(result.body).toContain("**Input**: @docs/handoff.md");
		expect(result.body).not.toContain(join(dir, "docs/handoff.md"));
	});

	it("leaves an indexed argument-derived @path alone", async () => {
		const { skill, dir } = writeSkill("**Input**: $0");
		const result = await renderSkillInvocation(skill, invocationFor(skill, "@docs/handoff.md"), renderContext());
		expect(result.body).toContain("**Input**: @docs/handoff.md");
		expect(result.body).not.toContain(join(dir, "docs/handoff.md"));
	});

	it("leaves a dot-relative argument-derived @path alone", async () => {
		const { skill, dir } = writeSkill("**Input**: $ARGUMENTS");
		const result = await renderSkillInvocation(skill, invocationFor(skill, "@./relative.md"), renderContext());
		expect(result.body).toContain("**Input**: @./relative.md");
		expect(result.body).not.toContain(join(dir, "relative.md"));
	});

	it("leaves every token of a multi-path argument alone", async () => {
		const { skill } = writeSkill("**Input**: $ARGUMENTS");
		const result = await renderSkillInvocation(skill, invocationFor(skill, "@docs/a.md @docs/b.md"), renderContext());
		expect(result.body).toContain("**Input**: @docs/a.md @docs/b.md");
	});

	it("leaves a @path in the rule-8 append fallback alone", async () => {
		// The author wrote no placeholder, so `ARGUMENTS: R` is appended verbatim.
		const { skill, dir } = writeSkill("No placeholder here.");
		const result = await renderSkillInvocation(skill, invocationFor(skill, "@docs/handoff.md"), renderContext());
		expect(result.body.endsWith("ARGUMENTS: @docs/handoff.md")).toBe(true);
		expect(result.body).not.toContain(join(dir, "docs/handoff.md"));
	});

	it("leaves authored and argument-derived @paths alone in the same body", async () => {
		const { skill, dir } = writeSkill("See @references/x.md for $ARGUMENTS.");
		const result = await renderSkillInvocation(skill, invocationFor(skill, "@docs/handoff.md"), renderContext());
		expect(result.body).toContain("See @references/x.md for @docs/handoff.md.");
		expect(result.body).not.toContain(`${dir}/references`);
		expect(result.body).not.toContain(join(dir, "docs/handoff.md"));
	});

	it("makes a @${PI_SKILL_DIR} reference absolute, keeping the @ sigil", async () => {
		// The supported opt-in: variable substitution does the work, so only
		// what the author marked becomes absolute.
		const { skill, dir } = writeSkill("Read @${PI_SKILL_DIR}/references/x.md for details.");
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext());
		expect(result.body).toContain(`Read @${join(dir, "references/x.md")} for details.`);
	});

	it("keeps the backslash of a \\@path escape", async () => {
		// Nothing scans for `@path` any more, so there is nothing to escape and
		// the body stays byte-faithful. Command includes keep their own escape.
		const { skill } = writeSkill("escaped \\@references/x.md");
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext());
		expect(result.body).toContain("escaped \\@references/x.md");
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

	it("never rewrites argument-derived text", async () => {
		// The rewrite runs on the authored body, so a user argument that happens
		// to equal a collided agent name is left alone.
		const { skill } = writeSkill("Use $ARGUMENTS here.");
		const result = await renderSkillInvocation(
			skill,
			invocationFor(skill, "code-reviewer"),
			renderContext({ rewriteMap }),
		);
		expect(result.body).toContain("Use code-reviewer here.");
	});

	it("never rewrites the base-dir preamble", async () => {
		// The rewrite runs before the preamble is prepended, so preamble text
		// (and any collided name inside the baseDir path) is out of scope.
		const { skill, dir } = writeSkill("Body.");
		const result = await renderSkillInvocation(
			skill,
			invocationFor(skill),
			renderContext({ rewriteMap: { directory: { qualified: "simplify:directory", collided: true } } }),
		);
		expect(result.body).toBe(`Base directory for this skill: ${dir}\n\nBody.`);
	});

	it("leaves a declared $name placeholder intact when an agent shares its name", async () => {
		// The rewrite skips `$`-prefixed tokens: `$reviewer` is a placeholder,
		// not an agent mention, so argument substitution still sees it.
		const { skill } = writeSkill("Target: $reviewer.", { arguments: ["reviewer"] });
		const result = await renderSkillInvocation(
			skill,
			invocationFor(skill, "hello"),
			renderContext({ rewriteMap: { reviewer: { qualified: "simplify:reviewer", collided: true } } }),
		);
		expect(result.body).toContain("Target: hello.");
		expect(result.body).not.toContain("ARGUMENTS: hello");
	});

	it("leaves $ARGUMENTS intact when a collided agent is named arguments", async () => {
		// The rewrite is case-insensitive, so an agent named `arguments` would
		// otherwise consume the built-in placeholder.
		const { skill } = writeSkill("All: $ARGUMENTS.");
		const result = await renderSkillInvocation(
			skill,
			invocationFor(skill, "hello"),
			renderContext({ rewriteMap: { arguments: { qualified: "simplify:arguments", collided: true } } }),
		);
		expect(result.body).toContain("All: hello.");
	});

	it("leaves an authored $name literal even when it is a collided agent and undeclared", async () => {
		// Accepted consequence of the `$` exclusion: `$name` reads as a variable
		// reference, so it is never treated as an agent mention.
		const { skill } = writeSkill("Target: $code-reviewer.");
		const result = await renderSkillInvocation(skill, invocationFor(skill), renderContext({ rewriteMap }));
		expect(result.body).toContain("Target: $code-reviewer.");
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

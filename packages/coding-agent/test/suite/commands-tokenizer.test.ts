/**
 * A.1 tokenizer + unified namespace registry contract. Covers every normative
 * grammar example (punctuation stripping, qualified/nested names, no-fallback
 * rejection, code-fence/inline-code skipping, escapes, over-cap, fork stop,
 * argument ownership), the `enableSkillCommands` gate, control kinds, and the
 * cross-tier / same-tier collision diagnostics (one formatted line).
 */

import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import type { LoadedCommand } from "../../src/core/commands/loader.ts";
import {
	buildCommandRegistry,
	type CommandRegistry,
	type ExtensionCommandInfo,
} from "../../src/core/commands/registry.ts";
import {
	type InvocationSpan,
	MAX_INVOCATIONS_PER_MESSAGE,
	tokenizeMessage,
} from "../../src/core/commands/tokenizer.ts";
import { isBareSkillCommandName, type LoadedSkill } from "../../src/core/skills/frontmatter.ts";
import type { BuiltinSlashCommand } from "../../src/core/slash-commands.ts";

function makeSkill(name: string, opts: Partial<LoadedSkill> = {}): LoadedSkill {
	const filePath = opts.filePath ?? `/skills/${name}/SKILL.md`;
	const baseDir = opts.baseDir ?? dirname(filePath);
	return {
		name,
		description: opts.description ?? `${name} description`,
		filePath,
		baseDir,
		sourceInfo: opts.sourceInfo ?? { path: filePath, source: "local", scope: "user", origin: "top-level" },
		disableModelInvocation: opts.disableModelInvocation ?? false,
		id: opts.id ?? filePath,
		listingName: opts.listingName ?? name,
		frontmatter: opts.frontmatter ?? { name, description: `${name} description` },
		argumentHint: opts.argumentHint,
		userInvocable: opts.userInvocable ?? true,
		commandNameValid: opts.commandNameValid ?? isBareSkillCommandName(name),
	};
}

function makeCommand(name: string, opts: Partial<LoadedCommand> = {}): LoadedCommand {
	const filePath = opts.filePath ?? `/commands/${name}.md`;
	return {
		kind: opts.kind ?? "command",
		name,
		description: opts.description ?? `${name} description`,
		argumentHint: opts.argumentHint,
		frontmatter: opts.frontmatter ?? {},
		body: opts.body ?? "body",
		filePath,
		baseDir: opts.baseDir ?? dirname(filePath),
		sourceInfo: opts.sourceInfo ?? { path: filePath, source: "local", scope: "user", origin: "top-level" },
		commandNameValid: opts.commandNameValid ?? isBareSkillCommandName(name),
		userInvocable: opts.userInvocable ?? true,
		disableModelInvocation: opts.disableModelInvocation ?? false,
	};
}

function registry(options: {
	builtins?: BuiltinSlashCommand[];
	extensionCommands?: ExtensionCommandInfo[];
	commands?: LoadedCommand[];
	skills?: LoadedSkill[];
	enableSkillCommands?: boolean;
}): CommandRegistry {
	return buildCommandRegistry({
		builtins: options.builtins ?? [],
		extensionCommands: options.extensionCommands ?? [],
		commands: options.commands ?? [],
		skills: options.skills ?? [],
		enableSkillCommands: options.enableSkillCommands ?? true,
	});
}

function invocationNames(spans: ReturnType<typeof tokenizeMessage>["spans"]): string[] {
	return spans
		.filter((span): span is InvocationSpan => span.kind === "invocation")
		.map((span) => span.invocation.name);
}

function plainText(spans: ReturnType<typeof tokenizeMessage>["spans"]): string {
	return spans.map((span) => (span.kind === "text" ? span.text : `<${span.invocation.name}>`)).join("");
}

describe("A.1 tokenizer grammar examples", () => {
	const reg = registry({ skills: [makeSkill("review"), makeSkill("fix")], commands: [makeCommand("deploy")] });

	it("`/review src/core` → one invocation, args src/core (argument ownership)", () => {
		const result = tokenizeMessage("/review src/core", reg);
		expect(result.messageInitial).toBe(true);
		const spans = result.spans.filter((span): span is InvocationSpan => span.kind === "invocation");
		expect(spans).toHaveLength(1);
		expect(spans[0].invocation.name).toBe("review");
		expect(spans[0].rawArgs).toBe("src/core");
	});

	it("`/a one /b two` → one invocation a, args `one /b two` (inner token literal)", () => {
		const r = registry({ skills: [makeSkill("a"), makeSkill("b")] });
		const result = tokenizeMessage("/a one /b two", r);
		expect(result.messageInitial).toBe(true);
		const spans = result.spans.filter((span): span is InvocationSpan => span.kind === "invocation");
		expect(spans).toHaveLength(1);
		expect(spans[0].invocation.name).toBe("a");
		expect(spans[0].rawArgs).toBe("one /b two");
	});

	it("`please /review this and then /fix it` → two mid-prompt invocations, no args", () => {
		const result = tokenizeMessage("please /review this and then /fix it", reg);
		expect(result.messageInitial).toBe(false);
		expect(invocationNames(result.spans)).toEqual(["review", "fix"]);
		for (const span of result.spans) {
			if (span.kind === "invocation") {
				expect(span.rawArgs).toBe("");
			}
		}
	});

	it("`run /review.` → one invocation (trailing `.` stripped, stays literal text)", () => {
		const result = tokenizeMessage("run /review.", reg);
		expect(invocationNames(result.spans)).toEqual(["review"]);
		expect(plainText(result.spans)).toBe("run <review>.");
	});

	it("`see \\/review` and `` run `/review` `` → zero invocations", () => {
		expect(invocationNames(tokenizeMessage("see \\/review", reg).spans)).toEqual([]);
		expect(
			tokenizeMessage("see \\/review", reg)
				.spans.map((s) => (s.kind === "text" ? s.text : ""))
				.join(""),
		).toBe("see /review");
		expect(invocationNames(tokenizeMessage("run `/review`", reg).spans)).toEqual([]);
	});

	it("`check /usr/bin` → zero invocations (unregistered run, no fallback)", () => {
		expect(invocationNames(tokenizeMessage("check /usr/bin", reg).spans)).toEqual([]);
	});

	it("`/review:typo this` and `/foo.bar x` → zero invocations (full run unregistered)", () => {
		expect(invocationNames(tokenizeMessage("/review:typo this", reg).spans)).toEqual([]);
		const r = registry({ skills: [makeSkill("foo")] });
		expect(invocationNames(tokenizeMessage("/foo.bar x", r).spans)).toEqual([]);
	});

	it("qualified `/skill:review` and nested-qualified names resolve", () => {
		expect(invocationNames(tokenizeMessage("please /skill:review it", reg).spans)).toEqual(["review"]);
	});

	it("candidates inside a fenced block never expand", () => {
		const message = "before\n```\n/review inside\n```\nafter /fix";
		const result = tokenizeMessage(message, reg);
		expect(invocationNames(result.spans)).toEqual(["fix"]);
	});

	it("even backslashes leave the candidate live", () => {
		const result = tokenizeMessage("a \\\\/fix b", reg);
		expect(invocationNames(result.spans)).toEqual(["fix"]);
	});
});

describe("A.1 caps and fork stop", () => {
	it("caps at 6 invocations with one aggregated diagnostic", () => {
		const skills = ["a", "b", "c", "d", "e", "f", "g"].map((n) => makeSkill(n));
		const reg = registry({ skills });
		const message = "x /a /b /c /d /e /f /g y";
		const result = tokenizeMessage(message, reg);
		expect(invocationNames(result.spans)).toEqual(["a", "b", "c", "d", "e", "f"]);
		expect(invocationNames(result.spans)).toHaveLength(MAX_INVOCATIONS_PER_MESSAGE);
		expect(result.diagnostics).toHaveLength(1);
	});

	it("stops recognizing after a context: fork skill", () => {
		const forking = makeSkill("plan", { frontmatter: { name: "plan", description: "d", context: "fork" } });
		const reg = registry({ skills: [forking, makeSkill("review")] });
		const result = tokenizeMessage("go /plan then /review", reg);
		expect(invocationNames(result.spans)).toEqual(["plan"]);
		expect(result.diagnostics).toHaveLength(1);
	});
});

describe("A.1 control gate (rule 7)", () => {
	it("controls are recognized message-initial but never mid-prompt", () => {
		const reg = registry({
			builtins: [{ name: "model", description: "Select model" }],
			skills: [makeSkill("review")],
		});
		// mid-prompt control stays literal
		const mid = tokenizeMessage("please /model gpt", reg);
		expect(invocationNames(mid.spans)).toEqual([]);
		// message-initial control resolves (as a control) but is not prompt-producing
		expect(reg.resolve("model", { messageInitial: true })?.control).toBe(true);
		expect(reg.resolve("model", { messageInitial: false })).toBeUndefined();
	});
});

describe("namespace precedence and collisions", () => {
	it("cross-tier collision: built-in wins bare, skill via qualifier, one diagnostic line", () => {
		const reg = registry({
			builtins: [{ name: "review", description: "builtin review" }],
			skills: [makeSkill("review")],
		});
		expect(reg.resolve("review", { messageInitial: true })?.source).toBe("builtin");
		expect(reg.resolve("skill:review", { messageInitial: false })?.source).toBe("skill");
		expect(reg.collisionDiagnostic).toBeDefined();
		expect(reg.collisionDiagnostic?.message).not.toContain("\n");
		expect(reg.collisionDiagnostic?.message).toContain("/review");
	});

	it("prompt tier wins over skill tier for the bare name", () => {
		const reg = registry({ commands: [makeCommand("deploy", { kind: "prompt" })], skills: [makeSkill("deploy")] });
		expect(reg.resolve("deploy", { messageInitial: false })?.source).toBe("prompt");
		expect(reg.resolve("skill:deploy", { messageInitial: false })?.source).toBe("skill");
	});

	it("same-tier nested collision keeps both variants and notes the bare name", () => {
		const reg = registry({
			skills: [
				makeSkill("deploy", { baseDir: "/root/web", filePath: "/root/web/SKILL.md" }),
				makeSkill("deploy", { baseDir: "/root/api", filePath: "/root/api/SKILL.md", id: "/root/api/SKILL.md" }),
			],
		});
		const bare = reg.resolve("deploy", { messageInitial: false });
		expect(bare?.nestedVariants).toEqual(["web:deploy", "api:deploy"]);
		expect(reg.resolve("web:deploy", { messageInitial: false })?.source).toBe("skill");
		expect(reg.resolve("api:deploy", { messageInitial: false })?.source).toBe("skill");
		expect(reg.collisionDiagnostic?.message).toContain("nested variants");
	});
});

describe("namespace eligibility gates", () => {
	it("enableSkillCommands: false removes bare skills but keeps other tiers", () => {
		const reg = registry({
			commands: [makeCommand("deploy")],
			skills: [makeSkill("review")],
			enableSkillCommands: false,
		});
		expect(reg.resolve("review", { messageInitial: false })).toBeUndefined();
		expect(reg.resolve("deploy", { messageInitial: false })?.source).toBe("command");
	});

	it("invalid-name and user-invocable:false skills are excluded from the namespace", () => {
		const reg = registry({
			skills: [makeSkill("Bad Name", { commandNameValid: false }), makeSkill("hidden", { userInvocable: false })],
		});
		expect(reg.resolve("Bad Name", { messageInitial: false })).toBeUndefined();
		expect(reg.resolve("hidden", { messageInitial: false })).toBeUndefined();
		expect(reg.resolve("skill:hidden", { messageInitial: false })).toBeUndefined();
	});
});

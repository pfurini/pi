/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: normative A.3.2 placeholder fixtures */
/**
 * Cross-tier argument-grammar delivery: one grammar renders identically as a
 * skill, a command, and a prompt template (AC5), and the digit-like declared
 * argument name load warning reaches the user-visible diagnostic channel on
 * both the default ResourceLoader path and the lightweight-loader fallback
 * (AC6), including the fallback's snapshot invalidation contract (no per-turn
 * declaration re-reads).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Container } from "../../../tui/src/tui.ts";
import { adaptPromptTemplates, loadCommandsFromDir } from "../../src/core/commands/loader.ts";
import { type RenderCommandContext, renderCommand } from "../../src/core/commands/render.ts";
import type { PromptTemplate } from "../../src/core/prompt-templates.ts";
import { normalizeSkillInput, type SkillArguments } from "../../src/core/skills/frontmatter.ts";
import { type RenderSkillContext, renderSkillInvocation } from "../../src/core/skills/render.ts";
import type { SkillInvocation } from "../../src/core/skills/runtime.ts";
import { DEFAULT_SKILL_SHELL_SETTINGS } from "../../src/core/skills/shell-injection.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "../../src/core/source-info.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { parseFrontmatter } from "../../src/utils/frontmatter.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const tempDirs: string[] = [];
const harnesses: Harness[] = [];

afterEach(() => {
	while (harnesses.length > 0) {
		harnesses.pop()?.cleanup();
	}
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop() as string, { recursive: true, force: true });
	}
});

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "commands-load-diagnostics-"));
	tempDirs.push(dir);
	return dir;
}

const sourceInfo = (path: string): SourceInfo => ({ path, source: "local", scope: "user", origin: "top-level" });

// ============================================================================
// AC5 — one grammar across three tiers
// ============================================================================

describe("per-tier identity (AC5)", () => {
	// Named placeholder, indexed placeholder, escaped placeholder, and a shell
	// snippet that must survive untouched. No `@path`, `!``, or `${PI_*}`
	// constructs: those belong to other render stages.
	const BODY = ["name=[$issue] idx=[$1] esc=[\\$issue]", "```bash", 'for f in "$@"; do echo "$f"; done', "```"].join(
		"\n",
	);
	const ARGS = "a b c";
	const EXPECTED = ["name=[a] idx=[b] esc=[$issue]", "```bash", 'for f in "$@"; do echo "$f"; done', "```"].join("\n");

	it("one body renders identically as a skill, a command, and a prompt template", async () => {
		const dir = makeTempDir();

		// Skill tier.
		const skillPath = join(dir, "SKILL.md");
		writeFileSync(skillPath, `---\nname: tier-skill\ndescription: Tier skill\narguments: [issue]\n---\n${BODY}\n`);
		const { skill } = normalizeSkillInput({
			name: "tier-skill",
			description: "Tier skill",
			filePath: skillPath,
			baseDir: dir,
			sourceInfo: createSyntheticSourceInfo(skillPath, { source: "test" }),
			disableModelInvocation: false,
			frontmatter: { arguments: ["issue"] },
		});
		const invocation: SkillInvocation = {
			invocationId: "inv-1",
			skillId: skill.id,
			name: skill.name,
			baseDir: skill.baseDir,
			filePath: skill.filePath,
			rawArgs: ARGS,
		};
		const skillContext: RenderSkillContext = {
			cwd: "/tmp/work",
			sessionId: "session-1",
			thinkingLevel: "medium",
			skillInterop: true,
			activeToolNames: ["read", "bash"],
			shellSettings: { ...DEFAULT_SKILL_SHELL_SETTINGS },
		};
		const skillRendered = (await renderSkillInvocation(skill, invocation, skillContext)).body;

		// Command tier.
		const commandDir = join(dir, "commands");
		mkdirSync(commandDir);
		writeFileSync(
			join(commandDir, "tier.md"),
			`---\nname: tier\ndescription: Tier command\narguments: [issue]\n---\n${BODY}\n`,
		);
		const loaded = loadCommandsFromDir(commandDir, sourceInfo);
		expect(loaded.diagnostics).toEqual([]);
		const commandContext: RenderCommandContext = {
			cwd: "/tmp/work",
			sessionId: "session-1",
			thinkingLevel: "medium",
			skillInterop: true,
			activeToolNames: ["read", "bash"],
			shellSettings: { disabled: false, timeoutMs: 30000, outputLimitBytes: 16384 },
		};
		const commandRendered = (await renderCommand(loaded.commands[0], ARGS, commandContext)).text;

		// Prompt-template tier (declaration carried on the snapshot, parsed at load).
		const templatePath = join(dir, "tier-template.md");
		writeFileSync(templatePath, `---\narguments: [issue]\n---\n${BODY}\n`);
		const template: PromptTemplate = {
			name: "tier-template",
			description: "Tier template",
			content: BODY,
			filePath: templatePath,
			sourceInfo: sourceInfo(templatePath),
			arguments: ["issue"],
		};
		const adapted = adaptPromptTemplates([template]);
		expect(adapted.diagnostics).toEqual([]);
		const templateRendered = (await renderCommand(adapted.commands[0], ARGS, commandContext)).text;

		// Normalized contract: strip the skill tier's `Base directory …\n\n`
		// preamble; no other tier adds a wrapper. Whole bodies are compared.
		const skillPreamble = `Base directory for this skill: ${dir}\n\n`;
		expect(skillRendered.startsWith(skillPreamble)).toBe(true);
		const skillNormalized = skillRendered.slice(skillPreamble.length);
		expect(skillNormalized).toBe(EXPECTED);
		expect(commandRendered).toBe(EXPECTED);
		expect(templateRendered).toBe(EXPECTED);
	});
});

// ============================================================================
// Prompt-template `arguments:` through a session (fallback loader path)
// ============================================================================

describe("prompt-template arguments: through AgentSession", () => {
	it("renders the probe-5 shape: declared names map to slots, no append fallback", async () => {
		const dir = makeTempDir();
		const filePath = join(dir, "named.md");
		writeFileSync(filePath, "---\narguments: alpha beta gamma\n---\n[$alpha][$beta][$gamma]\n");
		const template: PromptTemplate = {
			name: "named",
			description: "Named template",
			content: "[$alpha][$beta][$gamma]",
			filePath,
			sourceInfo: sourceInfo(filePath),
			arguments: "alpha beta gamma",
		};
		const resourceLoader = {
			...createTestResourceLoader(),
			getPrompts: () => ({ prompts: [template], diagnostics: [] }),
		};
		const harness = await createHarness({ resourceLoader });
		harnesses.push(harness);
		let expandedPrompt = "";
		harness.setResponses([
			(context) => {
				const user = context.messages.find((message) => message.role === "user");
				expandedPrompt = user ? getMessageText(user) : "";
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.prompt("/named one two");

		expect(expandedPrompt).toBe("[one][two][]");
	});
});

// ============================================================================
// AC6 — digit-name warning delivery
// ============================================================================

function digitWarningDiagnostics() {
	// Real loader output: one native command and one prompt template, each
	// declaring a digit-like argument name.
	const dir = makeTempDir();
	writeFileSync(join(dir, "cmd.md"), '---\nname: cmd\ndescription: Cmd\narguments: [one, "2"]\n---\nbody\n');
	const commandResult = loadCommandsFromDir(dir, sourceInfo);

	const templatePath = join(dir, "tpl.md");
	writeFileSync(templatePath, '---\narguments: [one, "3"]\n---\nbody\n');
	const templateResult = adaptPromptTemplates([
		{
			name: "tpl",
			description: "Tpl",
			content: "body",
			filePath: templatePath,
			sourceInfo: sourceInfo(templatePath),
			arguments: ["one", "3"],
		},
	]);
	return [...commandResult.diagnostics, ...templateResult.diagnostics];
}

describe("showLoadedResources command-tier section (default path)", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	function renderWithCommandDiagnostics(diagnostics: ReturnType<typeof digitWarningDiagnostics>): string {
		const fakeThis: any = {
			options: { verbose: false },
			loadedResourcesContainer: new Container(),
			settingsManager: { getQuietStartup: () => true },
			session: {
				promptTemplates: [],
				getCommandCollisionDiagnostic: () => undefined,
				getCommandLoadDiagnostics: () => diagnostics,
				extensionRunner: {
					getCommandDiagnostics: () => [],
					getShortcutDiagnostics: () => [],
				},
				resourceLoader: {
					getSkills: () => ({ skills: [], diagnostics: [] }),
					getPrompts: () => ({ prompts: [], diagnostics: [] }),
					getThemes: () => ({ themes: [], diagnostics: [] }),
					getExtensions: () => ({ extensions: [], errors: [], runtime: {} }),
					getSystemPromptSource: () => undefined,
					getAppendSystemPromptSources: () => [],
					getAgentsFiles: () => ({ agentsFiles: [] }),
				},
			},
			getStartupExpansionState: () => false,
			formatDiagnostics: (items: Array<{ message: string }>) => items.map((item) => `  ${item.message}`).join("\n"),
		};
		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			force: false,
			showDiagnosticsWhenQuiet: true,
		});
		return fakeThis.loadedResourcesContainer.children.flatMap((child: any) => child.render(120)).join("\n");
	}

	it("renders the command-tier warnings in a [Command issues] section", () => {
		const diagnostics = digitWarningDiagnostics();
		expect(diagnostics).toHaveLength(2);
		const output = renderWithCommandDiagnostics(diagnostics);
		expect(output).toContain("[Command issues]");
		expect(output).toContain('"2"');
		expect(output).toContain('"3"');
		expect(output).toContain("shifting later declared names down one slot");
	});

	it("renders no command-tier section when there are no command diagnostics", () => {
		const output = renderWithCommandDiagnostics([]);
		expect(output).not.toContain("[Command issues]");
	});
});

describe("digit-name warning on the lightweight-loader fallback", () => {
	function fallbackSession(promptsHolder: { prompts: PromptTemplate[] }) {
		const resourceLoader = {
			...createTestResourceLoader(),
			getPrompts: () => ({ prompts: promptsHolder.prompts, diagnostics: [] }),
		};
		return createHarness({ resourceLoader });
	}

	function writeTemplate(dir: string, name: string, declaration: string): PromptTemplate {
		const filePath = join(dir, `${name}.md`);
		const content = `---\n${declaration}\n---\nbody\n`;
		writeFileSync(filePath, content);
		// Mirror loadTemplateFromFile: the `arguments:` declaration is parsed onto
		// the snapshot at load, so a rebuilt snapshot reflects a file edit.
		const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
		return {
			name,
			description: "Template",
			content: "body",
			filePath,
			sourceInfo: sourceInfo(filePath),
			...(frontmatter.arguments !== undefined && { arguments: frontmatter.arguments as SkillArguments }),
		};
	}

	it("surfaces the warning exactly once across repeated registry builds and snapshot replacement", async () => {
		const dir = makeTempDir();
		const holder = { prompts: [writeTemplate(dir, "digits", 'arguments: [one, "2", three]')] };
		const harness = await fallbackSession(holder);
		harnesses.push(harness);

		// Repeated fallback registry builds: the retained snapshot replaces, never appends.
		harness.session.getCommands();
		harness.session.getCommands();
		let diagnostics = harness.session.getCommandLoadDiagnostics();
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain('"2"');

		// A changed-then-unchanged watcher refresh: fresh snapshot objects with
		// the same declaration keep exactly one warning …
		holder.prompts = [writeTemplate(dir, "digits", 'arguments: [one, "2", three]')];
		harness.session.getCommands();
		diagnostics = harness.session.getCommandLoadDiagnostics();
		expect(diagnostics).toHaveLength(1);

		// … and editing the declaration away (with a new snapshot) clears it.
		holder.prompts = [writeTemplate(dir, "digits", "arguments: [one, two, three]")];
		harness.session.getCommands();
		expect(harness.session.getCommandLoadDiagnostics()).toEqual([]);

		// Restoring it brings back exactly one warning.
		holder.prompts = [writeTemplate(dir, "digits", 'arguments: [one, "2", three]')];
		harness.session.getCommands();
		diagnostics = harness.session.getCommandLoadDiagnostics();
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain('"2"');
	});

	it("the declaration is fixed on the snapshot at load: a file edit without a new snapshot is ignored", async () => {
		const dir = makeTempDir();
		const template = writeTemplate(dir, "cached", 'arguments: [one, "2", three]');
		const holder = { prompts: [template] };
		const harness = await fallbackSession(holder);
		harnesses.push(harness);

		harness.session.getCommands();
		expect(harness.session.getCommandLoadDiagnostics()).toHaveLength(1);

		// Edit the file but keep the snapshot object: adaptation never re-reads,
		// so the registry still sees the original declaration …
		writeFileSync(template.filePath, "---\narguments: [one, two, three]\n---\nbody\n");
		harness.session.getCommands();
		expect(harness.session.getCommandLoadDiagnostics()).toHaveLength(1);

		// … while a snapshot rebuilt from the edited file reflects the edit.
		holder.prompts = [writeTemplate(dir, "cached", "arguments: [one, two, three]")];
		harness.session.getCommands();
		expect(harness.session.getCommandLoadDiagnostics()).toEqual([]);
	});

	it("empty state: no digit-like declaration surfaces nothing and does not throw", async () => {
		const dir = makeTempDir();
		const holder = { prompts: [writeTemplate(dir, "plain", "arguments: [one, two]")] };
		const harness = await fallbackSession(holder);
		harnesses.push(harness);

		harness.session.getCommands();
		expect(harness.session.getCommandLoadDiagnostics()).toEqual([]);
	});

	it("a loader without prompts at all surfaces nothing and does not throw", async () => {
		const harness = await createHarness({ resourceLoader: createTestResourceLoader() });
		harnesses.push(harness);
		harness.session.getCommands();
		expect(harness.session.getCommandLoadDiagnostics()).toEqual([]);
	});
});

// ============================================================================
// AC6 default path: diagnostics come from resourceLoader.getCommands()
// ============================================================================

describe("digit-name warning on the default ResourceLoader path", () => {
	it("getCommandLoadDiagnostics reads the loader's command diagnostics", async () => {
		const diagnostics = digitWarningDiagnostics();
		const resourceLoader = {
			...createTestResourceLoader(),
			getCommands: () => ({ commands: [], diagnostics }),
		};
		const harness = await createHarness({ resourceLoader });
		harnesses.push(harness);
		harness.session.getCommands();
		const delivered = harness.session.getCommandLoadDiagnostics();
		expect(delivered).toHaveLength(2);
		expect(delivered.map((d) => basename(d.path ?? ""))).toEqual(["cmd.md", "tpl.md"]);
	});
});

// Fork-owned: subagent definitions (plan T1). Old pi-subagents tests at 79a7c42 this covers:
// agent-dir-loader, agent-file-bom, agent-types, custom-agents, documented-defaults (the default
// agents), fallback-subagent-wiring, skill-agents, strict-agent-files-wiring.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentFile } from "../../../src/core/fork-builtins/subagents/definitions/frontmatter.ts";
import {
	type AgentFileLoadOptions,
	loadAgentFiles,
	loadSkillAgents,
	type SkillAgentSource,
} from "../../../src/core/fork-builtins/subagents/definitions/load.ts";
import {
	buildAgentRegistry,
	findEnabledAgent,
	listedAgentTypes,
	resolveSpawnType,
} from "../../../src/core/fork-builtins/subagents/definitions/registry.ts";
import type { AgentDefinition } from "../../../src/core/fork-builtins/subagents/definitions/types.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): { agentDir: string; cwd: string } {
	const root = mkdtempSync(join(tmpdir(), "pi-subagent-defs-"));
	roots.push(root);
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	return { agentDir, cwd };
}

function writeAgent(dir: string, file: string, content: string): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, file);
	writeFileSync(path, content);
	return path;
}

function load(options: Partial<AgentFileLoadOptions> & { agentDir: string; cwd: string }) {
	return loadAgentFiles({ projectTrusted: true, strict: false, ...options });
}

const PROJECT_SOURCE = { kind: "project", sourcePath: "/p/.pi/agents/auditor.md" } as const;

function parse(content: string): AgentDefinition {
	const parsed = parseAgentFile(content, PROJECT_SOURCE);
	expect(parsed.error).toBeUndefined();
	return parsed.definition as AgentDefinition;
}

describe("agent file frontmatter", () => {
	it("reads every documented key", () => {
		const parsed = parseAgentFile(
			[
				"---",
				"name: code-review",
				"display_name: Reviewer",
				"description: Reviews code",
				"color: red",
				"tools: read, grep, ext:mcp/search",
				"disallowed_tools: [write, edit]",
				"extensions: [mcp, tokensave]",
				"exclude_extensions: pi-notify",
				"skills: api-conventions, error-handling",
				"model: anthropic/claude-haiku-4-5",
				"thinking: high",
				"max_turns: 30",
				"persist_session: true",
				"output_transcript: false",
				"session_dir: sessions/review",
				"allowed_subagents: Explore, Plan",
				"prompt_mode: append",
				"inherit_context: true",
				"run_in_background: false",
				"isolated: false",
				"memory: project",
				"isolation: worktree",
				"enabled: false",
				"---",
				"",
				"You review code.",
			].join("\n"),
			PROJECT_SOURCE,
		);
		expect(parsed.unknownKeys).toEqual([]);
		expect(parsed.invalidValues).toEqual([]);
		expect(parsed.definition).toEqual({
			name: "code-review",
			displayName: "Reviewer",
			color: "red",
			description: "Reviews code",
			tools: ["read", "grep", "ext:mcp/search"],
			disallowedTools: ["write", "edit"],
			extensions: ["mcp", "tokensave"],
			excludeExtensions: ["pi-notify"],
			skills: ["api-conventions", "error-handling"],
			model: "anthropic/claude-haiku-4-5",
			thinking: "high",
			maxTurns: 30,
			persistSession: true,
			outputTranscript: false,
			sessionDir: "sessions/review",
			allowedSubagents: ["Explore", "Plan"],
			systemPrompt: "You review code.",
			promptMode: "append",
			inheritContext: true,
			runInBackground: false,
			isolated: false,
			memory: "project",
			isolation: "worktree",
			enabled: false,
			hidden: false,
			source: PROJECT_SOURCE,
		});
	});

	it("reads the spelled-out forms: filename as name, none, all, booleans and isolation off", () => {
		const defaults = parse("---\ndescription: d\n---\nbody");
		expect(defaults).toMatchObject({ name: "auditor", tools: undefined, extensions: true, skills: true });
		expect(defaults.promptMode).toBe("replace");
		expect(defaults.enabled).toBe(true);
		expect(parse("---\ntools: none\nextensions: false\nskills: none\n---\n")).toMatchObject({
			tools: [],
			extensions: false,
			skills: false,
		});
		expect(parse("---\ntools: all, ext:mcp\n---\n").tools).toEqual(["*", "ext:mcp"]);
		expect(parse("---\nallowed_subagents: true\n---\n").allowedSubagents).toBe("all");
		expect(parse("---\nallowed_subagents: '*'\n---\n").allowedSubagents).toBe("all");
		expect(parse("---\nallowed_subagents: none\n---\n").allowedSubagents).toBeUndefined();
		for (const spelling of ["off", "none", "no", "false"]) {
			expect(parse(`---\nisolation: ${spelling}\n---\n`).isolation).toBe("off");
		}
	});

	it("parses a file that starts with a UTF-8 BOM", () => {
		const definition = parse("\uFEFF---\ntools: none\ndescription: bom\n---\nprompt");
		expect(definition.tools).toEqual([]);
		expect(definition.description).toBe("bom");
		expect(definition.systemPrompt).toBe("prompt");
	});

	it("refuses a type that holds the skill separator", () => {
		expect(parseAgentFile("---\nname: a:b\n---\n", PROJECT_SOURCE).error).toContain('"a:b"');
		expect(
			parseAgentFile("---\n---\n", { kind: "project", sourcePath: "/p/.pi/agents/x:y.md" }).definition,
		).toBeUndefined();
	});
});

describe("agent file discovery", () => {
	it("warns once per file and unknown key, naming both, and fails under strictAgentFiles", () => {
		const { agentDir, cwd } = tempRoot();
		const path = writeAgent(
			join(cwd, ".pi", "agents"),
			"explore-custom.md",
			"---\nthinkingLevel: high\npersistSession: true\ninherit_extensions: false\n---\nbody",
		);
		const loaded = load({ agentDir, cwd });
		expect(loaded.agents.get("explore-custom")?.systemPrompt).toBe("body");
		expect(loaded.warnings).toEqual([
			`Agent file ${path} has unknown frontmatter key "thinkingLevel"; it is ignored.`,
			`Agent file ${path} has unknown frontmatter key "persistSession"; it is ignored.`,
			`Agent file ${path} has unknown frontmatter key "inherit_extensions"; it is ignored.`,
		]);
		expect(() => load({ agentDir, cwd, strict: true })).toThrow(
			`${path} has unknown frontmatter key "thinkingLevel"`,
		);
	});

	it("skips an unparseable or reserved-name file with a warning; strictAgentFiles fails only the unparseable one", () => {
		const { agentDir, cwd } = tempRoot();
		const path = writeAgent(join(agentDir, "agents"), "broken.md", "---\ntools: [read\n---\n");
		const loaded = load({ agentDir, cwd });
		expect(loaded.agents.has("broken")).toBe(false);
		expect(loaded.warnings).toHaveLength(1);
		expect(loaded.warnings[0]).toContain(path);
		expect(() => load({ agentDir, cwd, strict: true })).toThrow(path);

		// A reserved name refuses the file with a warning, and strict does not turn it into an error.
		rmSync(path);
		const reserved = writeAgent(join(agentDir, "agents"), "colon.md", "---\nname: a:b\n---\n");
		const strictLoad = load({ agentDir, cwd, strict: true });
		expect(strictLoad.agents.size).toBe(0);
		expect(strictLoad.warnings).toEqual([expect.stringContaining(reserved)]);
	});

	it("reads no project agent directory in an untrusted project", () => {
		const { agentDir, cwd } = tempRoot();
		writeAgent(join(cwd, ".pi", "agents"), "project-agent.md", "---\ndescription: p\n---\n");
		writeAgent(join(cwd, ".agents", "agents"), "workspace-agent.md", "---\ndescription: w\n---\n");
		writeAgent(join(agentDir, "agents"), "global-agent.md", "---\ndescription: g\n---\n");
		expect([...load({ agentDir, cwd, projectTrusted: false }).agents.keys()]).toEqual(["global-agent"]);
		expect([...load({ agentDir, cwd }).agents.keys()].sort()).toEqual([
			"global-agent",
			"project-agent",
			"workspace-agent",
		]);
	});

	it("lets a project agent override a global one by name, and .pi/agents win over .agents/agents", () => {
		const { agentDir, cwd } = tempRoot();
		writeAgent(join(agentDir, "agents"), "reviewer.md", "---\ndescription: global\n---\n");
		const workspace = writeAgent(join(cwd, ".agents", "agents"), "reviewer.md", "---\ndescription: workspace\n---\n");
		expect(load({ agentDir, cwd }).agents.get("reviewer")?.source).toEqual({
			kind: "project",
			sourcePath: workspace,
		});
		const project = writeAgent(
			join(cwd, ".pi", "agents"),
			"other-file.md",
			"---\nname: reviewer\ndescription: pi\n---\n",
		);
		const winner = load({ agentDir, cwd }).agents.get("reviewer");
		expect(winner?.description).toBe("pi");
		expect(winner?.source).toEqual({ kind: "project", sourcePath: project });
	});
});

function agent(name: string, overrides: Partial<AgentDefinition> = {}): AgentDefinition {
	return {
		name,
		description: name,
		extensions: true,
		skills: true,
		systemPrompt: "",
		promptMode: "replace",
		enabled: true,
		hidden: false,
		source: { kind: "project", sourcePath: `/p/.pi/agents/${name}.md` },
		...overrides,
	};
}

function registryOf(...agents: AgentDefinition[]) {
	return buildAgentRegistry({ userAgents: new Map(agents.map((definition) => [definition.name, definition])) });
}

describe("agent registry", () => {
	it("documents the three default agents", () => {
		const registry = registryOf();
		expect(listedAgentTypes(registry)).toEqual(["general-purpose", "Explore", "Plan"]);
		const [generalPurpose, explore, plan] = ["general-purpose", "Explore", "Plan"].map(
			(name) => findEnabledAgent(registry, name) as AgentDefinition,
		);
		expect(generalPurpose).toMatchObject({ displayName: "Agent", promptMode: "append", systemPrompt: "" });
		expect(generalPurpose.tools).toBeUndefined();
		expect(generalPurpose.model).toBeUndefined();
		expect(explore).toMatchObject({
			tools: ["read", "bash", "grep", "find", "ls"],
			model: "anthropic/claude-haiku-4-5",
			promptMode: "replace",
		});
		expect(explore.systemPrompt).toContain("READ-ONLY MODE");
		expect(plan).toMatchObject({ tools: ["read", "bash", "grep", "find", "ls"], promptMode: "replace" });
		expect(plan.model).toBeUndefined();
		expect(plan.systemPrompt).toContain("Critical Files for Implementation");
		expect(listedAgentTypes(buildAgentRegistry({ userAgents: new Map(), disableDefaultAgents: true }))).toEqual([]);
	});

	it("resolves types case-insensitively, refuses case-ambiguous and disabled ones", () => {
		const registry = registryOf(
			agent("Reviewer"),
			agent("auditor"),
			agent("AUDITOR"),
			agent("off", { enabled: false }),
		);
		expect(findEnabledAgent(registry, "reviewer")?.name).toBe("Reviewer");
		expect(findEnabledAgent(registry, "explore")?.name).toBe("Explore");
		expect(findEnabledAgent(registry, "auditor")?.name).toBe("auditor");
		expect(findEnabledAgent(registry, "Auditor")).toBeUndefined();
		expect(findEnabledAgent(registry, "off")).toBeUndefined();
		expect(listedAgentTypes(registry)).not.toContain("off");
	});

	it("falls back to general-purpose, to a named agent, or refuses under none", () => {
		const registry = registryOf(agent("reviewer"));
		expect(resolveSpawnType(registry, "missing")).toMatchObject({
			ok: true,
			definition: { name: "general-purpose" },
			fellBackFrom: "missing",
		});
		expect(resolveSpawnType(registry, "missing", "reviewer")).toMatchObject({
			ok: true,
			definition: { name: "reviewer" },
		});
		expect(resolveSpawnType(registry, "missing", "none")).toEqual({
			ok: false,
			message: 'Unknown or disabled agent type: "missing". Available: general-purpose, Explore, Plan, reviewer.',
		});
		expect(resolveSpawnType(registry, "", "none")).toMatchObject({
			ok: false,
			message: expect.stringContaining("No agent type given."),
		});
		const broken = resolveSpawnType(registry, "missing", "ghost");
		expect(broken.ok).toBe(false);
		expect(broken.ok ? "" : broken.message).toContain(
			'The configured fallbackSubagent "ghost" is itself unknown or disabled.',
		);
		expect(resolveSpawnType(registry, "Reviewer", "none")).toMatchObject({
			ok: true,
			definition: { name: "reviewer" },
		});
	});
});

describe("skill-bundled agents", () => {
	function skill(root: string, id: string, listingName: string, agents: Record<string, string>, off = false) {
		const baseDir = join(root, listingName);
		for (const [file, content] of Object.entries(agents)) writeAgent(join(baseDir, "agents"), file, content);
		return {
			id,
			listingName,
			baseDir,
			visibility: { model: "full", user: "yes", userInvokeError: off },
		} as SkillAgentSource;
	}

	it("grants the bare alias only when the name is free and one skill claims it", () => {
		const { cwd } = tempRoot();
		const skills = [
			skill(cwd, "/s/simplify/SKILL.md", "simplify", { "reviewer.md": "---\n---\nr", "helper.md": "---\n---\nh" }),
			skill(cwd, "/s/audit/SKILL.md", "audit", { "helper.md": "---\n---\nh2", "Explore.md": "---\n---\ne" }),
			skill(cwd, "/s/hidden/SKILL.md", "hidden", { "secret.md": "---\n---\ns" }, true),
		];
		const bundled = loadSkillAgents(skills);
		expect(bundled.warnings).toEqual([]);
		const registry = buildAgentRegistry({ userAgents: new Map(), skillAgents: bundled.agents });
		expect(registry.aliases).toEqual([
			{ skillId: "/s/simplify/SKILL.md", bareName: "helper", qualified: "simplify:helper", granted: false },
			{ skillId: "/s/simplify/SKILL.md", bareName: "reviewer", qualified: "simplify:reviewer", granted: true },
			{ skillId: "/s/audit/SKILL.md", bareName: "Explore", qualified: "audit:Explore", granted: false },
			{ skillId: "/s/audit/SKILL.md", bareName: "helper", qualified: "audit:helper", granted: false },
		]);
		expect(findEnabledAgent(registry, "reviewer")?.systemPrompt).toBe("r");
		expect(findEnabledAgent(registry, "helper")).toBeUndefined();
		expect(findEnabledAgent(registry, "Explore")?.source).toEqual({ kind: "default" });
		expect(findEnabledAgent(registry, "hidden:secret")).toBeUndefined();

		const taken = buildAgentRegistry({
			userAgents: new Map([["REVIEWER", agent("REVIEWER")]]),
			skillAgents: bundled.agents,
		});
		expect(taken.aliases.find((alias) => alias.bareName === "reviewer")?.granted).toBe(false);
		expect(findEnabledAgent(taken, "reviewer")?.source.kind).toBe("project");
	});

	it("hides skill agents from listings and resolves them by qualified name", () => {
		const { cwd } = tempRoot();
		const bundled = loadSkillAgents([
			skill(cwd, "/s/simplify/SKILL.md", "simplify", { "reviewer.md": "---\ndescription: r\n---\nprompt" }),
		]);
		const registry = buildAgentRegistry({ userAgents: new Map(), skillAgents: bundled.agents });
		expect(listedAgentTypes(registry)).toEqual(["general-purpose", "Explore", "Plan"]);
		const qualified = findEnabledAgent(registry, "Simplify:Reviewer");
		expect(qualified).toMatchObject({ name: "simplify:reviewer", hidden: true, systemPrompt: "prompt" });
		expect(qualified?.source).toMatchObject({ kind: "skill", skillId: "/s/simplify/SKILL.md" });
		expect(resolveSpawnType(registry, "simplify:reviewer", "none")).toMatchObject({ ok: true });
	});

	it("never loads a symlinked skill agent file, while a user agent directory follows symlinks", () => {
		const { agentDir, cwd } = tempRoot();
		const target = writeAgent(join(cwd, "outside"), "secret.md", "---\ndescription: secret\n---\nsecret prompt");
		const skillSource = skill(cwd, "/s/simplify/SKILL.md", "simplify", { "real.md": "---\n---\nreal" });
		symlinkSync(target, join(skillSource.baseDir, "agents", "linked.md"));
		expect(loadSkillAgents([skillSource]).agents.map((entry) => entry.definition.name)).toEqual(["real"]);
		mkdirSync(join(agentDir, "agents"), { recursive: true });
		symlinkSync(target, join(agentDir, "agents", "linked.md"));
		expect(load({ agentDir, cwd }).agents.get("linked")?.systemPrompt).toBe("secret prompt");
	});

	it("loads no agent of a skill whose visibility is missing or malformed, and never applies strict to skill files", () => {
		const { cwd } = tempRoot();
		const missing = skill(cwd, "/s/a/SKILL.md", "a", { "one.md": "---\n---\n" });
		const malformed = skill(cwd, "/s/b/SKILL.md", "b", { "two.md": "---\n---\n" });
		const sources = [
			{ ...missing, visibility: undefined },
			{ ...malformed, visibility: { ...malformed.visibility, userInvokeError: "false" } },
		] as unknown as SkillAgentSource[];
		expect(loadSkillAgents(sources).agents).toEqual([]);

		const claudeStyle = skill(cwd, "/s/c/SKILL.md", "c", { "three.md": "---\npermissionMode: plan\n---\n" });
		const loaded = loadSkillAgents([claudeStyle]);
		expect(loaded.agents.map((entry) => entry.definition.name)).toEqual(["three"]);
		expect(loaded.warnings).toEqual([expect.stringContaining('unknown frontmatter key "permissionMode"')]);
	});

	it("keeps the last of two files in one skill that declare the same name, for the qualified name and the alias", () => {
		const { cwd } = tempRoot();
		const bundled = loadSkillAgents([
			skill(cwd, "/s/sk/SKILL.md", "sk", {
				"a.md": "---\nname: helper\n---\nfirst",
				"b.md": "---\nname: helper\nenabled: false\n---\nsecond",
			}),
		]);
		const registry = buildAgentRegistry({ userAgents: new Map(), skillAgents: bundled.agents });
		expect(registry.aliases).toEqual([
			{ skillId: "/s/sk/SKILL.md", bareName: "helper", qualified: "sk:helper", granted: false },
		]);
		expect(findEnabledAgent(registry, "helper")).toBeUndefined();
		expect(findEnabledAgent(registry, "sk:helper")).toBeUndefined();
	});
});

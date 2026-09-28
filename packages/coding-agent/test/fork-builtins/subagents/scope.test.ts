// Fork-owned: child tool and extension scoping (plan T3, D22). The suite test
// test/suite/fork-subagents-runner.test.ts checks the same rules on real child sessions.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Extension, LoadExtensionsResult } from "../../../src/core/extensions/types.ts";
import type { AgentDefinition } from "../../../src/core/fork-builtins/subagents/definitions/types.ts";
import {
	extensionNames,
	hasWriteTools,
	resolveExtensionPlan,
	resolveToolScope,
	type ToolScopeInput,
} from "../../../src/core/fork-builtins/subagents/runner/scope.ts";
import type { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
	return {
		name: "worker",
		description: "worker",
		extensions: true,
		skills: true,
		systemPrompt: "",
		promptMode: "replace",
		enabled: true,
		hidden: false,
		source: { kind: "default" },
		...overrides,
	};
}

function scope(definition: AgentDefinition, overrides: Partial<ToolScopeInput> = {}) {
	return resolveToolScope({
		definition,
		isolated: false,
		knownToolNames: new Set(["read", "bash", "ask_user_question", "vcc_recall", "tokensave_status"]),
		forkBaseToolNames: ["ask_user_question", "vcc_recall"],
		injectedToolNames: [],
		...overrides,
	});
}

describe("child tool scope", () => {
	it("selects Pi's seven coding tools by default and excludes the rest, the fork base tools and the subagent tools", () => {
		const result = scope(agent());
		expect([...result.selected].sort()).toEqual(["bash", "edit", "find", "grep", "ls", "read", "write"]);
		expect(result.excludeTools.sort()).toEqual(
			["Agent", "ask_user_question", "get_subagent_result", "powershell", "steer_subagent", "vcc_recall"].sort(),
		);
		expect(result.warnings).toEqual([]);
	});

	it("keeps a named fork base tool and a named Pi tool, and lets disallowed_tools win", () => {
		const result = scope(agent({ tools: ["read", "vcc_recall", "powershell"], disallowedTools: ["read"] }));
		expect(result.excludeTools).not.toContain("vcc_recall");
		expect(result.excludeTools).not.toContain("powershell");
		expect(result.excludeTools).toContain("ask_user_question");
		expect(result.excludeTools).toContain("bash");
		expect(result.excludeTools).toContain("read");
		expect(result.disallowed.has("read")).toBe(true);
	});

	it("leaves injected nested tools out of excludeTools and re-admits them, unless disallowed", () => {
		const nested = scope(agent(), { injectedToolNames: ["Agent", "get_subagent_result", "steer_subagent"] });
		expect(nested.excludeTools).not.toContain("Agent");
		expect([...nested.readmit].sort()).toEqual(["Agent", "get_subagent_result", "steer_subagent"]);
		const denied = scope(agent({ disallowedTools: ["steer_subagent"] }), {
			injectedToolNames: ["Agent", "get_subagent_result", "steer_subagent"],
		});
		expect(denied.excludeTools).toContain("steer_subagent");
		expect(denied.readmit.has("steer_subagent")).toBe(false);
	});

	it("warns about an unknown tools: name and about a subagent tool named in tools:", () => {
		const result = scope(agent({ tools: ["read", "reed", "tokensave_status", "steer_subagent", "ext:mcp"] }));
		expect(result.warnings).toEqual([
			{ type: "tools-error", message: 'tool "reed" requested by agent "worker" is not a known tool' },
			{
				type: "tools-error",
				message:
					'agent "worker" names "steer_subagent" in tools:, but a subagent receives it only through allowed_subagents',
			},
		]);
		expect(result.excludeTools).toContain("steer_subagent");
	});

	it("adds the memory tools, and judges write access after disallowed_tools", () => {
		expect([...scope(agent({ tools: ["grep"] }), { memory: "read-write" }).selected].sort()).toEqual([
			"edit",
			"grep",
			"read",
			"write",
		]);
		expect([...scope(agent({ tools: ["grep"] }), { memory: "read-only" }).selected].sort()).toEqual(["grep", "read"]);
		expect(hasWriteTools(agent())).toBe(true);
		expect(hasWriteTools(agent({ tools: ["read", "write"], disallowedTools: ["write"] }))).toBe(false);
		expect(hasWriteTools(agent({ tools: ["read", "edit"] }))).toBe(true);
	});

	it("parses ext: selectors case-insensitively by extension, and drops them under isolated", () => {
		const result = scope(agent({ tools: ["*", "ext:MCP/search", "ext:mcp/fetch", "ext:notes"] }));
		expect([...result.extNames].sort()).toEqual(["mcp", "notes"]);
		expect([...(result.narrowing.get("mcp") ?? [])].sort()).toEqual(["fetch", "search"]);
		expect(result.narrowing.has("notes")).toBe(false);
		expect(scope(agent({ tools: ["ext:mcp"] }), { isolated: true }).extNames.size).toBe(0);
	});
});

function extension(path: string): Extension {
	return { path, tools: new Map() } as unknown as Extension;
}

function base(...paths: string[]): LoadExtensionsResult {
	return { extensions: paths.map(extension), errors: [] } as unknown as LoadExtensionsResult;
}

function loaded(result: LoadExtensionsResult): DefaultResourceLoader {
	return { getExtensions: () => result } as unknown as DefaultResourceLoader;
}

const pathsOf = (result: LoadExtensionsResult) => result.extensions.map((entry) => entry.path);

describe("child extension plan", () => {
	it("names inline built-ins by their name, index entries by their directory, and packages by their short name", () => {
		const root = mkdtempSync(join(tmpdir(), "pi-sn-scope-"));
		roots.push(root);
		const packageDir = join(root, "pi-notify");
		mkdirSync(join(packageDir, "src"), { recursive: true });
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({ name: "@scope/pi-notify", pi: { extensions: ["./src/index.ts"] } }),
		);
		expect(extensionNames("<inline:tokensave>")).toEqual(["tokensave"]);
		expect(extensionNames("/x/extensions/Tracker.ts")).toEqual(["tracker"]);
		expect(extensionNames("/x/extensions/mcp/index.ts")).toEqual(["mcp"]);
		expect(extensionNames(join(packageDir, "src", "index.ts"))).toEqual(["src", "pi-notify"]);
	});

	it("refuses every spelling of a path inside an untrusted project, and keeps one outside", () => {
		const project = realpathSync(mkdtempSync(join(tmpdir(), "pi-sn-trust-")));
		const outside = mkdtempSync(join(tmpdir(), "pi-sn-outside-"));
		roots.push(project, outside);
		mkdirSync(join(project, "..helpers"));
		writeFileSync(join(project, "..helpers", "h.ts"), "");
		writeFileSync(join(outside, "o.ts"), "");
		// A case-insensitive disk also finds the project under another case.
		const recased = project.replace("pi-sn-trust-", "PI-SN-TRUST-");
		const spellings = ["./..helpers/h.ts", join(project, "..helpers", "h.ts")];
		if (existsSync(recased)) spellings.push(join(recased, "..helpers", "h.ts"));
		const plan = resolveExtensionPlan(
			agent({ extensions: [...spellings, join(outside, "o.ts")] }),
			false,
			project,
			false,
		);
		expect(plan.additionalExtensionPaths).toEqual([join(outside, "o.ts")]);
		plan.extensionsOverride(base());
		expect(plan.check(loaded(base())).map((warning) => warning.message)).toEqual(
			expect.arrayContaining(
				spellings.map(
					(entry) =>
						`extension path "${entry}" for agent "worker" is inside an untrusted project; it was not loaded`,
				),
			),
		);
	});

	it("loads nothing for extensions: false or isolated, and keeps listed names with the exclusion winning", () => {
		const discovered = base("<inline:tokensave>", "/x/extensions/mcp.ts", "/x/extensions/notes.ts");
		const none = resolveExtensionPlan(agent({ extensions: false }), false, "/x", true);
		expect(none.noExtensions).toBe(true);
		expect(pathsOf(none.extensionsOverride(discovered))).toEqual([]);
		expect(pathsOf(resolveExtensionPlan(agent(), true, "/x", true).extensionsOverride(discovered))).toEqual([]);

		const listed = resolveExtensionPlan(
			agent({ extensions: ["MCP", "tokensave"], excludeExtensions: ["tokensave"] }),
			false,
			"/x",
			true,
		);
		expect(pathsOf(listed.extensionsOverride(discovered))).toEqual(["/x/extensions/mcp.ts"]);
		const all = resolveExtensionPlan(agent({ excludeExtensions: ["notes"] }), false, "/x", true);
		expect(pathsOf(all.extensionsOverride(discovered))).toEqual(["<inline:tokensave>", "/x/extensions/mcp.ts"]);
		const wildcard = resolveExtensionPlan(agent({ extensions: ["*", "./local/extra.ts"] }), false, "/x", true);
		expect(wildcard.additionalExtensionPaths).toEqual(["/x/local/extra.ts"]);
		expect(pathsOf(wildcard.extensionsOverride(discovered))).toHaveLength(3);
	});

	it("warns about a missing requested extension, an exclusion that matches nothing, and an unloaded ext: selector", () => {
		const plan = resolveExtensionPlan(
			agent({
				extensions: ["mcp", "ghost", "notes"],
				excludeExtensions: ["notes", "typo"],
				tools: ["read", "ext:tokensave"],
			}),
			false,
			"/x",
			true,
		);
		const result = plan.extensionsOverride(
			base("<inline:tokensave>", "/x/extensions/mcp.ts", "/x/extensions/notes.ts"),
		);
		expect(plan.check(loaded(result)).map((warning) => warning.message)).toEqual([
			'exclude_extensions: "typo" for agent "worker" did not match any discovered extension',
			'extension "ghost" requested by agent "worker" was not loaded',
			'extension "notes" is in both extensions: and exclude_extensions: for agent "worker"; the exclusion wins',
			'ext:tokensave referenced by agent "worker", but extension "tokensave" is not loaded (check extensions: and exclude_extensions:)',
		]);
		const contradictory = resolveExtensionPlan(
			agent({ extensions: false, excludeExtensions: ["mcp"] }),
			false,
			"/x",
			true,
		);
		contradictory.extensionsOverride(base("/x/extensions/mcp.ts"));
		expect(contradictory.check(loaded(base())).map((warning) => warning.message)).toEqual([
			'exclude_extensions has no effect for agent "worker": extensions: false loads nothing',
		]);
	});
});

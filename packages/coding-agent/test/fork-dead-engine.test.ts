import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Fork quarantine guard for the legacy argument engine.
 *
 * This fork replaced the CC-inexact argument substitution with `substituteSkillArguments`
 * (0-based, no `$@`, no braced forms). The legacy engine — `substituteArgs`,
 * `expandPromptTemplate`, `formatPromptTemplateInvocation` — is kept byte-identical to
 * `upstream/main` so it merges for free, but it must never be re-wired to a live path:
 * two grammars with different index bases cannot both be reachable.
 *
 * The definitions live in two modules and legitimately call each other internally:
 *   - packages/coding-agent/src/core/prompt-templates.ts  (substituteArgs, expandPromptTemplate)
 *   - packages/agent/src/harness/prompt-templates.ts       (substituteArgs, formatPromptTemplateInvocation)
 * Those two files are excluded from the scan. Every other module under a package `src` tree must
 * contain no import or call of these symbols. Tests are out of scope: the legacy suites
 * (test/prompt-templates.test.ts) exercise the engine on purpose.
 */

const LEGACY_SYMBOLS = ["substituteArgs", "expandPromptTemplate", "formatPromptTemplateInvocation"] as const;

const REPO_ROOT = resolve(__dirname, "../../..");

const DEFINITION_FILES = [
	join(REPO_ROOT, "packages/coding-agent/src/core/prompt-templates.ts"),
	join(REPO_ROOT, "packages/agent/src/harness/prompt-templates.ts"),
];

const SRC_ROOTS = [join(REPO_ROOT, "packages/coding-agent/src"), join(REPO_ROOT, "packages/agent/src")];

/**
 * Report which legacy symbols a module imports or calls. Matches usage syntax, not bare
 * mentions, so the known false positives are ignored:
 *   - `expandPromptTemplates` (the boolean option in agent-session.ts): word boundaries stop
 *     `expandPromptTemplate` from matching the trailing `s`.
 *   - a doc-comment mention (`formatPromptTemplateInvocation` in a JSDoc string): only calls
 *     (`name(`) and named imports (`import { name }`) count, never prose.
 */
function findLegacyEngineReferences(content: string): string[] {
	const hits = new Set<string>();

	for (const importMatch of content.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+[^;\n]+/g)) {
		const specifiers = importMatch[1];
		for (const symbol of LEGACY_SYMBOLS) {
			if (new RegExp(`\\b${symbol}\\b`).test(specifiers)) hits.add(symbol);
		}
	}

	for (const symbol of LEGACY_SYMBOLS) {
		// Direct `symbol(` and namespace-qualified `ns.symbol(`; `.` is a non-word char so the
		// leading `\b` still holds.
		if (new RegExp(`\\b${symbol}\\s*\\(`).test(content)) hits.add(symbol);
	}

	return [...hits];
}

function collectTypeScriptFiles(dir: string, into: string[]): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			collectTypeScriptFiles(path, into);
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".ts")) into.push(path);
	}
}

describe("legacy argument engine quarantine", () => {
	it("detector flags real callers and imports", () => {
		expect(findLegacyEngineReferences(`const out = substituteArgs(content, args);`)).toEqual(["substituteArgs"]);
		expect(findLegacyEngineReferences(`import { expandPromptTemplate } from "./prompt-templates.ts";`)).toEqual([
			"expandPromptTemplate",
		]);
		expect(findLegacyEngineReferences(`pt.formatPromptTemplateInvocation(template, args);`)).toEqual([
			"formatPromptTemplateInvocation",
		]);
	});

	it("detector ignores the known false positives", () => {
		// The `expandPromptTemplates` boolean option (agent-session.ts) — substring, not a call.
		expect(
			findLegacyEngineReferences(
				`const expandPromptTemplates = options?.expandPromptTemplates ?? true;\n` +
					`if (expandPromptTemplates && text.startsWith("/")) doThing();`,
			),
		).toEqual([]);
		// A JSDoc mention (types.ts:65) is prose, not usage.
		expect(
			findLegacyEngineReferences(
				`/** Argument placeholders are formatted by \`formatPromptTemplateInvocation\`. */`,
			),
		).toEqual([]);
	});

	it("no module under packages/*/src imports or calls the legacy engine", () => {
		const files: string[] = [];
		for (const root of SRC_ROOTS) collectTypeScriptFiles(root, files);

		const violations: string[] = [];
		for (const file of files) {
			if (DEFINITION_FILES.includes(file)) continue;
			const references = findLegacyEngineReferences(readFileSync(file, "utf-8"));
			for (const symbol of references) {
				violations.push(`${file.slice(REPO_ROOT.length + 1)} -> ${symbol}`);
			}
		}

		expect(violations).toEqual([]);
	});
});

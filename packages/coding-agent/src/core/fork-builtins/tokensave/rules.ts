// Ported from pi-tokensave (github.com/pfurini/pi-tokensave) commit 2a626d3b, src/rules.ts.
// Copyright (c) 2026 pi-tokensave contributors. MIT licence: see LICENSE in this directory.

/**
 * The pi-tokensave instruction block that `before_agent_start` injects into the
 * system prompt. Its markers let the injection detect a prompt that already
 * holds the rules.
 */

export const RULES_BLOCK_VERSION = "4";
const START_MARKER = "<!-- pi-tokensave:start -->";
const END_MARKER = "<!-- pi-tokensave:end -->";
const VERSION_MARKER_PREFIX = "<!-- pi-tokensave:version=";

export function buildRulesBlock(version: string = RULES_BLOCK_VERSION): string {
	return `${START_MARKER}
${VERSION_MARKER_PREFIX}${version} -->

## TokenSave Code Intelligence

### Applicability

These rules apply only when the current project contains a \`.tokensave/\`
directory. When it does not, do not call TokenSave tools and use Pi's normal
code exploration tools directly. When a TokenSave tool is unavailable or
blocked in the current turn, also use Pi's normal tools directly.

### Two-Step Rule — mandatory
**Step 1 — Discover:** Use TokenSave tools to locate symbols, understand code
areas, build task context, and analyze dependencies before using grep, find,
or broad speculative reads.

**Step 2 — Verify:** Read the actual source files returned by TokenSave before
writing or modifying code.

TokenSave is a structural code index. It can locate symbols, relationships,
callers, callees, implementations, tests, and likely impact areas. It does not
replace reading the actual implementation or observing runtime behavior.

### Required workflow

For broad tasks or unfamiliar code:

1. Call \`tokensave_context\`.
2. Read the relevant source files returned.
3. Before changing shared logic, call \`tokensave_impact\`.
4. Make the change.
5. Run the relevant tests.

For a named class, function, method, model, interface, type, or constant:

1. Call \`tokensave_find_symbol\`.
2. Do not guess the file path.
3. Read the returned source file before answering implementation questions
   or editing code.

For conceptual code searches:

1. Call \`tokensave_search\`.
2. Use raw grep only when TokenSave returned no useful result or when the task
   explicitly requires complex regex, logs, configuration, generated files,
   literal non-indexed content, or another unsupported format.

Never modify code based only on TokenSave output.

TokenSave tools are orientation and code-intelligence tools. The source code
is the final authority.

### Projects

The tools query the session's project by default. Pass \`project\` to query
another repository that holds \`.tokensave/\`. Session-project results keep paths
relative to that project. Foreign-project results give absolute paths, except
\`tokensave_context\`, whose header says its paths are relative to the named root.
Absolute or root-relative paths both work as inputs.

### Direct database

When the tools cannot answer a structural question, read
\`<root>/.tokensave/tokensave.db\` directly, read-only (tables \`nodes\`, \`edges\`,
\`files\`). TokenSave does not version this schema.

### Subagents

Do not spawn a subagent for codebase research, exploration or analysis of a
repository that TokenSave has indexed, unless the user says otherwise. This
applies to the session's project and to any repository reachable through
\`project\`.

${END_MARKER}`;
}

# Pi Skill System — CC-Parity Implementation Plan

**Version 4** (2026-08-11). This document is **self-contained**: together with the ADRs it
cites, it is sufficient to write detailed per-phase implementation plans — Appendix A is the
normative behavior specification, Appendix B the Pi code anchor map. The v5 gap analysis
(`docs/pi-vs-claude-code-skill-parity.md`) is historical background only, not required reading
(and see Appendix B.9 before citing its ASE numbers).

**Decision record** (all in `docs/adr/`):

| ADR | Decision |
| --- | --- |
| ADR-0001 | Native skill parity in core, not a CC compatibility layer; frameworks port via forks with a Pi target |
| ADR-0002 | Pi never reads Claude Code's directories or settings (outbound-only interop) |
| ADR-0003 | New subsystems as new modules; hot upstream files get thin call sites only |
| ADR-0004 | Deterministic render pipeline; provider-aware delivery transport (synthetic tool pair / message block) |
| ADR-0005 | One command namespace: bare invocation, fixed precedence, prompt-producing vs control split |
| ADR-0006 | Tool-name redirects + local steering instead of a tool-alias mechanism |
| ADR-0007 | CC skill-*file* compatible (documented interop subset), not CC *framework* compatible |
| ADR-0008 | Skill-bundled agents: qualified-always, bare-when-free, soft scoping |

---

## 1. Goal and strategy

Bring Pi's native skill system to feature parity with Claude Code's, so that CC-class skill
frameworks run on Pi **as ported first-class citizens**, not under emulation. Today Pi treats a
skill as prompt expansion (3 frontmatter fields, raw arg append, model-read invocation; Appendix
B.1); after this plan, a skill is a first-class executable capability: structured invocation,
full render pipeline, per-skill execution semantics, and lifecycle management — end to end like
CC, better than CC where Pi can be (mid-prompt autocomplete, skill-bundled agents for plain
skills).

Target frameworks (ASE: 47 skills + 8 agents + 5 hooks + MCP; gstack: ~55 skills, 10 host
adapters) are ported by **forking them and adding a Pi installation target** (§6), never by
running their CC artifacts as-is (ADR-0001).

## 2. Non-goals

Explicitly out of scope, with rationale on record:

- **CC plugin system, marketplaces, `userConfig`** — Pi extensions/packages fill this role (ADR-0001).
- **Generic CC hook emulation** (hooks.json wire protocol) — per-framework extensions instead (ADR-0001).
- **Reading `~/.claude/` / `.claude/` in any form**, including the rejected skills allowlist (ADR-0002).
- **Import/vendor tooling for CC frameworks** — the fork's Pi target owns installation.
- **Permission layer** (allow/ask/deny, `Skill(name)` rules, `allowed-tools` enforcement) — separate future project; blocking-only semantics for now (ADR-0007).
- **Tool aliases in core** — deferred, `docs/plans/tool-aliases.md` kept ready (ADR-0006).
- **Statusline, bundled skills, enterprise tiers.**

## 3. Workstream 1 — Pi core

Architecture rule for the whole workstream (ADR-0003): new code in new modules (working layout:
`core/skills/` for pipeline/lifecycle/interop, `core/commands/` for the command engine and
tokenizer); `agent-session.ts`, `interactive-mode.ts`, `core/skills.ts`, `agent-loop.ts`, and
`packages/tui` receive thin call sites only (the specific required touch points are anchored in
Appendix B.10–B.12). All warnings/errors go through the existing `ResourceDiagnostic` channels
(TUI formatting, stderr in headless); aggregated single-line messages for multi-item warnings; no
logging-system changes.

### Phase C0 — contract surface

1. Parse and preserve the full CC frontmatter contract per Appendix A.2 (`when_to_use`,
   `argument-hint`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`,
   `context`, `agent`, `background`, `paths`, `shell`, `hooks`, `arguments`); lenient booleans
   (`yes/no/on/off/1/0/true/false`); unknown fields kept accessible. `hooks` is parsed, never
   executed (ADR-0007).
2. `argument-hint` in autocomplete; `when_to_use` folded into listing entries;
   `user-invocable: false` hides from menus.
3. Skill-set query + change-notification seam for extensions on the event bus, wire contract in
   Appendix A.9 (emitted on load and `/reload`; C4's watcher reuses it) — Workstream 2's
   discovery input.
4. Versioned listing delimiters (`<available_skills version="2">` … `</available_skills>`) and
   the exported `extractSkillListingBlock(systemPrompt)` helper — the Workstream 3 contract
   (§5) ships here, before any listing-content change.

*Acceptance:* every ASE/gstack skill file parses without loss; fixture skills exercising each
field round-trip through `getSkills()`; a fixture extension receives the A.9 snapshot and
change events; `extractSkillListingBlock` round-trips the emitted listing.

### Phase C1 — render pipeline, skill tool, delivery (ADR-0004)

1. Render pipeline (new module) implementing Appendix A.3 exactly — including the argument
   grammar (A.3.2), the agent-name rewrite rule (A.3.4), and the shell-injection executor spec
   (A.3.5) — replacing `_expandSkillCommand`'s naive expansion for all paths. Reuses/absorbs
   the prompt-template argument engine (Appendix B.2). The `@path` include convention needs
   nothing beyond substitution: paths become absolute and the model reads them (Pi has no
   approval flow to gate reads, so CC's read-auto-approval hooks have no equivalent to port).
2. Interop subset (config-gated module, ADR-0007): `CLAUDE_*` token aliases and env exports per
   the Appendix A.8 tables, CC-tool-name detection note (ADR-0006 layer 3). Env injection uses
   the bash tool's existing per-execution spawn-context seam (`resolveSpawnContext` /
   `BashSpawnHook`, Appendix B.6) scoped per A.8's turn-scoped rule; **never mutate
   `process.env`** (session-global, races with concurrent/background work). Ships the ADR-0007
   support matrix in the skills docs.
3. Dedicated `skill` tool (model invocation; contract in Appendix A.1).
4. Delivery transport per Appendix A.4: message-block is the default; synthetic tool-use/result
   pair is enabled per provider capability after this phase's feasibility check on Pi's message
   model + provider replay (the first task of this phase). Event emission for synthetic pairs
   is specified in A.4 (includes the `ToolResultEvent` type extension).
5. Tool-name redirect map on unknown-tool calls (ADR-0006, defaults in Appendix A.8):
   implemented at the `prepareToolCall` unknown-tool rejection site (Appendix B.10 — a thin
   `agent-loop.ts` change, permitted by ADR-0003; the map is supplied by coding-agent via an
   `AgentLoopConfig` callback); target-registered guard, settings-extensible, nearest-name
   fallback (case-insensitive edit distance ≤ 2, else no suggestion). Description parenthetical
   on `find`.

*Acceptance:* ASE-style fixture (args + `${CLAUDE_SKILL_DIR}` includes convention + effort
frontmatter) renders correctly on each supported transport; argument-grammar fixture covers the
A.3.2 examples verbatim; redirect fixture verifies the corrective reply for
`Task`/`AskUserQuestion` misses, and that a mapped entry whose target is unregistered falls
through to the nearest-name suggestion.

### Phase C2 — commands, tokenizer, namespace (ADR-0005)

1. Commands system evolved from prompt templates: `commands/` dirs per Appendix A.7, same
   render pipeline as skills with the command-specific differences in Appendix A.7,
   `slash_command` tool for model invocation (canonical name; CC's `SlashCommand` reaches it
   via redirect), migration note for existing prompt-template users.
2. Mid-prompt tokenizer implementing the Appendix A.1 grammar exactly (span model, exact-match
   registry, code-fence/inline-code skipping, escaping, argument-ownership rule, stacking cap
   6 with over-cap behavior); control commands stay message-initial.
3. Bare `/name` invocation: flat namespace, precedence built-ins > extension commands >
   commands/templates > skills; prefixes (`/skill:`, `/prompt:`, `/ext:`) as disambiguators;
   single aggregated collision diagnostic.
4. TUI: mid-prompt `/` autocomplete menu with per-candidate source badges (Pi improvement over
   CC, which has no mid-prompt menu). Requires real `packages/tui` changes — today's menu
   trigger, completion, and Enter-submit behavior are all hard start-of-line-only
   (Appendix B.11).

*Acceptance:* tokenizer fixture covers every A.1 grammar example verbatim (including code-fence
skipping, escapes, over-cap, and argument ownership); `/usr/bin` in prose never triggers;
collision fixture shows one-line diagnostic + qualified fallback works. Tokenizer logic tested
in coding-agent (vitest); completion-provider and editor behavior tested in `packages/tui`
(`node:test`).

### Phase C3 — execution semantics

1. Per-skill `effort` and `model` overrides via the **ephemeral request-override** mechanism in
   Appendix A.5 (never `setModel`/`setThinkingLevel`, which persist to session and settings —
   Appendix B.4; the genuine-tool-call path maps onto the existing `prepareNextTurn` snapshot,
   B.4).
2. `disallowed-tools`: turn-scoped removal/blocking, resolved through the redirect map
   (ADR-0006). `allowed-tools` stays parsed-advisory (ADR-0007).
3. `context: fork` / `agent` / `background` per the A.5 invocation×mode matrix: spawn via the
   pi-subagents RPC (wire contract in A.9), feature detection via `subagents:rpc:ping`, and
   graceful degradation to inline + diagnostic when the extension is absent.
4. `paths` glob-gated activation per A.6 (listing boost from recently touched files).

*Acceptance:* fixture skills for each field behave per Appendix A.5, including the fork matrix
rows (foreground result, background acknowledgment, repeat-while-running block, spawn-failure
fallback); fork fixture runs through a stub subagents extension in the test harness.

### Phase C4 — lifecycle & management

1. Re-invocation dedup ("already loaded" note; changed args/injection output re-renders —
   identity and compaction-interaction rules in Appendix A.6).
2. Listing budget per the deterministic algorithm in Appendix A.6 (estimator, rounding,
   tie-break, truncation order); cost visibility in `/skills`.
3. Compaction carry-forward per Appendix A.6 (5k per skill / 25k combined, MRU-first, inline
   deliveries only). Investigate `session_before_compact`'s customization surface first —
   prototyping re-attachment via the `context` event (B.4) is acceptable; only if neither works
   add a minimal core seam (new module + thin call site per ADR-0003).
4. `/skills` management UI: filter, token-cost sort, per-skill visibility states persisted to
   settings (keys in Appendix B.8; interaction rule in A.6 — frontmatter gates are upper
   bounds, settings can only restrict further).
5. Live watching of skill/command dirs; nested/monorepo discovery per the A.6 algorithm (this
   is **new** behavior — current discovery scans fixed roots only, Appendix B.1).

*Acceptance:* long-session fixture demonstrates carry-forward after forced compaction; listing
budget verified against an oversized skill set with byte-exact expected output (deterministic
per A.6); visibility states honored by listing, model invocation, and user invocation per the
A.6 interaction rule.

## 4. Workstream 2 — pi-subagents fork (parallel)

Separate plan, executed in the pi-subagents fork repo (current upstream state in Appendix B.5);
can start as soon as C0 lands (it only needs the parsed `agent`/`context` fields and the A.9
skill-set seam).

- Skill-bundled `<skill>/agents/*.md` discovery for every loaded skill; registration per
  ADR-0008 (qualified `skill:agent` always; bare name only when globally free — name comparison
  is case-insensitive, matching the fork's existing registry; soft scoping — hidden from global
  listings, spawnable by qualified name).
- Collision handling: core render pipeline rewrites the skill's own agent names in SKILL.md to
  qualified form when the bare name is taken, per the lexical rule in A.3.4. Seam: the fork
  publishes each skill's rewrite map on the event bus and answers pull queries (wire contract
  in A.9); C1's pipeline ships the rewrite step, consults the last-received map, and does
  nothing when no fork is present.
- RPC contract: `PROTOCOL_VERSION` bump 2 → 3 with capability advertisement
  (`{version, capabilities: {skillAgents: true}}` from ping, A.9) plus the
  `subagents:agent-ended` completion event, so core's feature detection (C3 item 3) adopts
  skill-scoped names automatically and the A.5 repeat guard has a liveness signal.
- `Agent` tool description gains the "(Claude Code skills may call this the Task tool)"
  parenthetical (ADR-0006 layer 2).
- Reference case and acceptance fixture: `furiai-skills/skills/simplify` (4 bundled agents,
  qualified/bare resolution incl. case-only collisions and names inside code blocks, and its
  Agent-unavailable fallback — which also gets documented as the blessed portable-skill idiom).

## 5. Workstream 3 — claude-bridge companion

In the pi-claude-bridge fork (current internals in Appendix B.7), with item-level milestones:

- **With C0** — replace prose-marker scraping with the C0 contract: the bridge imports
  `extractSkillListingBlock` and the versioned delimiters instead of matching literal prose.
  On delimiter/version mismatch the bridge forwards nothing and logs one diagnostic
  (fail-visible, not fail-silent). C0 already changes listing entry content (`when_to_use`
  folding) and C4 reworks the block wholesale; without the contract, Claude models silently
  lose the skill catalogue on whichever change first breaks the scrape.
- **With C1** — delete the `rewriteReadTool` hack (the new listing no longer says "use the read
  tool") and add one **provider-path** harness-prompt line: CC's native Skill tool is
  unavailable; skill invocation goes through the MCP-exposed `skill` tool (which reaches Claude
  as `mcp__custom-tools__skill` automatically — verified: the bridge enumerates
  `context.tools`).
- **AskClaude** (the sub-agent path) keeps CC-native tools and never sees the MCP `skill`
  tool: it continues to receive the listing block only when its mode allows `Read` (current
  behavior), with its own framing line stating that skill files can be read directly with the
  native Read tool. The provider-path harness line above does not apply to AskClaude.
- Transport: the bridge provider uses message-block delivery (A.4); nothing further needed.
- Tests for the bridge path live in the pi-claude-bridge repo (the coding-agent faux-provider
  harness cannot exercise the CC SDK path — §7).

## 6. Framework porting pattern (the ADR-0001 payoff)

A framework's Pi target consists of exactly three artifacts, all installed by the framework's
own setup into Pi-owned locations (ADR-0002):

1. **Skills** → `~/.pi/agent/skills/` or project dirs; prose regenerated with Pi tool names
   where the framework generates from templates (gstack's `gen:skill-docs` already does
   per-host generation).
2. **Agent definitions** → `<skill>/agents/*.md` (Workstream 2) or global agent dirs.
3. **One Pi extension** (~80–100 lines) implementing the framework's hook logic natively.
   Event map from CC: SessionStart→`session_start`, SessionEnd→`session_shutdown`,
   UserPromptSubmit→`input` (can also transform), PreToolUse→`tool_call` (block + arg
   mutation), PostToolUse→`tool_result`, Stop→`agent_end`. Auto-approval hooks become no-ops
   (nothing to approve in Pi); blocking hooks map directly.

Worked examples to be maintained in the framework forks, not here:

- **ASE**: 5 hooks all shell out to `ase hook <event>` — the extension maps five events to five
  CLI calls. ASE's MCP server (`ase mcp`) becomes extension-registered Pi tools wrapping the
  `ase` CLI. Its `${CLAUDE_SKILL_DIR}`-based include convention works via the interop subset.
- **gstack**: add a `pi` host adapter beside the existing 10 in `hosts/`; the harness-neutral
  `.agents/skills/` output already loads in Pi today (note: its generated `<skill>/agents/`
  dirs currently contain Codex-format `openai.yaml`, so the Pi target must emit Pi-format
  agent definitions). Skill-scoped hooks (e.g. `freeze`'s PreToolUse edit-blocking) move into
  the gstack Pi extension as `tool_call` handlers.

## 7. Conformance & validation

- **Fixture pack** (in `packages/coding-agent/test/suite/`, faux provider): synthetic skills
  exercising each CC feature — one per frontmatter field, each A.3.2 argument-grammar example,
  each A.1 tokenizer example, injection forms, message-block transport, lifecycle behaviors,
  and stub-RPC fork flows. These are the per-phase acceptance criteria above.
- **Test placement**: synthetic-pair transcript replay against real provider message converters
  → `packages/ai` tests; tokenizer/pipeline/lifecycle → coding-agent vitest; TUI completion +
  editor behavior → `packages/tui` `node:test`; bridge path → pi-claude-bridge repo.
- **Framework smoke tests**: as the ASE and gstack fork Pi targets land, their install + a
  scripted session (render a skill with args, fire a hook, spawn a bundled agent) become the
  end-to-end gate.
- **Upstream drift check**: on each merge from upstream pi-mono, re-run the fixture pack; the
  thin-call-site rule (ADR-0003) keeps conflicts confined, and the fixtures catch semantic
  drift the merge didn't conflict on.

## 8. Deferred / revisit triggers

- **Tool aliases** (`docs/plans/tool-aliases.md`): promote if redirect retries measurably fail
  on weaker models (ADR-0006).
- **`references/` read-interception** for agent-name rewriting: only if the bare-when-free rule
  proves insufficient in practice (ADR-0008).
- **Permission layer**: separate project; unblocks real `allowed-tools`, `Skill(name)` rules,
  and permission-gated shell injection (ADR-0007).
- **Skill-scoped hook execution** (the `hooks` frontmatter field doing something in Pi): only
  if a native-Pi skill ecosystem develops a need the per-framework extension pattern doesn't
  cover.
- **Post-expansion `skill_expansion` extension event** (v5 OQ-3): closed as deferred.
  Model-invoked skills surface through `tool_call` on the `skill` tool; synthetic-pair event
  behavior is specified in A.4. Add a dedicated event only if framework extensions need
  expansion-time policy the existing events cannot express.
- **Mid-prompt arguments**: mid-prompt invocations take no arguments (A.1). Add an explicit
  argument-delimiter syntax only if real usage demands it.

---

## Appendix A — Normative behavior specification

Distilled from the v5 gap analysis (verified against the Claude Code binary v2.1.220 and its
docs); adapted where Pi deliberately deviates. This appendix, not CC itself, is the parity
target: where CC changes later, this spec still governs. Defaults marked *(tunable)* are
settings-configurable with the stated default; their keys are listed in Appendix B.8.

### A.1 Invocation, naming, and the mid-prompt tokenizer

- **User invocation:** `/name args`, bare (ADR-0005). Pi deviation (deliberate, kept from
  today's behavior): the command name comes from frontmatter `name` (falling back to the
  directory name), and need not match the directory. CC derives command names from the
  directory; framework forks name their skills accordingly.
- **Model invocation:** the `skill` tool, parameters `{name: string, args?: string}`. Tool
  description carries a "do not guess names" contract. Skills with
  `disable-model-invocation: true` are excluded from both the listing and the tool's accepted
  names. Invoking a hidden or unknown skill returns an error result naming the valid
  alternatives.
- **Nested/monorepo names:** dir-qualified names on collision (e.g. `apps/web:deploy`); both
  collide-ees stay available; invoking the unqualified name appends a note listing the
  qualified variants. Discovery algorithm in A.6.
- **Namespace precedence** (ADR-0005): built-ins > extension commands > commands/templates >
  skills; qualified prefixes (`/skill:name`, `/prompt:name`, `/ext:name` for extension
  commands) always work as disambiguators.
- **Unknown and hidden names:** a `/name` that matches nothing in the registry is literal text
  — no error (today's behavior; indistinguishable from prose). A skill hidden by
  `user-invocable: false` is likewise literal text when typed. A skill at visibility `off`
  (A.6) **errors** when invoked by any of its names. `enableSkillCommands: false` removes
  skills from the bare command namespace entirely (they remain model-invocable per their
  frontmatter).

**Tokenizer grammar (normative).** The message is scanned left to right into an ordered list of
spans: `text` | `invocation{name, argsSpan?}`.

1. A candidate token is `/` + a registered prompt-producing command name, preceded by
   start-of-message or whitespace, and followed by whitespace, end-of-message, or one of
   `.,;:!?)`. Name scanning is **longest-registered-name match**: at a candidate position the
   longest registered name matching the following characters wins (qualified forms like
   `skill:review` are names, so a `:` inside a matched name is part of it; the follower-set
   check applies after the match). No fuzzy or prefix matching.
2. Candidates inside fenced code blocks (``` or `~~~` fences) and inline code spans
   (`` ` … ` ``) are never invocations.
3. `\/name` escapes: not an invocation. Escape-backslash removal happens whenever the
   tokenizer processes a message, regardless of whether any invocation expands.
4. **Argument ownership:** if the message **starts** with an invocation token, that command's
   `argsSpan` is the entire remainder of the message (raw text). Candidate tokens inside that
   remainder are **not** expanded — they are literal argument text. If the message does not
   start with an invocation, every recognized token is a **mid-prompt invocation and takes no
   arguments** (`argsSpan` absent); surrounding text is untouched.
5. **Cap:** at most 6 invocations per message. Recognized candidates past the 6th stay literal
   text; one aggregated diagnostic is emitted.
6. **Fork stop:** the first invocation whose skill resolves to `context: fork` is processed;
   later invocations in the same message stay literal text (one diagnostic).
7. Control commands (e.g. `/model`) are only recognized message-initial; mid-prompt they are
   literal text.

Examples (fixtures must cover each):

- `/review src/core` → one invocation, args `src/core`.
- `/a one /b two` → one invocation `a`, args `one /b two` (rule 4; `/b` is literal).
- `please /review this and then /fix it` → two mid-prompt invocations, no args.
- `see \/review` and `` run `/review` `` → zero invocations.
- `check /usr/bin` → zero invocations (`usr` not registered; and `usr/bin` fails exact match).

### A.2 Frontmatter contract (per-field semantics)

Booleans accept `true/false/yes/no/on/off/1/0`. Unknown fields are preserved and accessible to
extensions. `license`, `compatibility`, `metadata` are parsed and preserved.

| Field | Semantics |
| --- | --- |
| `name` | Display + command name (Pi deviation, A.1). Validated per agentskills.io, warnings only. |
| `description` | Required: missing/empty → skill not loaded (diagnostic). >1024 chars → warning only. |
| `when_to_use` | Appended to the listing entry; combined description + when_to_use capped at 1,536 chars in listings. |
| `argument-hint` | Shown in autocomplete/menus; no semantic effect. |
| `arguments` | Declares named arguments for `$name` substitution (grammar in A.3.2). |
| `disable-model-invocation` | `true` → excluded from listing and `skill` tool; still user-invocable. Upper bound — settings cannot re-enable (A.6). |
| `user-invocable` | `false` → hidden from menus and command expansion; still model-invocable. Upper bound — settings cannot re-enable (A.6). |
| `model` | Ephemeral per-request model override (A.5); value is a Pi model id. CC values from imported skills: `inherit` = no-op; `haiku`/`sonnet`/`opus`/`fable` resolve best-effort against available models, else diagnostic + ignore. |
| `effort` | Ephemeral per-request thinking-level override (A.5): `off\|minimal\|low\|medium\|high\|xhigh\|max` (Pi's full `ThinkingLevel` set, Appendix B.4) — clamped to the active model's supported levels. Integer values (CC uses them as token budgets, which Pi does not have) clamp-map: ≤2k→`low`, ≤8k→`medium`, ≤24k→`high`, >24k→`xhigh`, with a diagnostic noting the mapping. |
| `allowed-tools` | Parsed, preserved, **advisory only** (ADR-0007). |
| `disallowed-tools` (alias `disallowedTools`) | Turn-scoped removal/blocking of matching tools while the skill invocation is active; matching resolves through the redirect map. |
| `context` | `inline` (default) or `fork` (A.5). |
| `agent` | Subagent type for fork: pi-subagents type name, incl. `skill:agent` qualified names; unknown type → warning + `general-purpose` fallback. |
| `background` | Fork only; default `true` → background agent reporting back on completion. |
| `paths` | Glob list; listing boost when recently touched files match (A.6). |
| `shell` | `bash` (default) or `powershell` for shell injection (A.3.5). |
| `hooks` | Parsed and preserved; **never executed** (ADR-0007). |

### A.3 Render pipeline (exact order, all invocation paths)

#### A.3.1 Stages

1. Base-dir preamble: prepend `Base directory for this skill: <dir>` (skills only).
2. Argument substitution (A.3.2).
3. Variable substitution: `${PI_SKILL_DIR}`, `${PI_PROJECT_DIR}`, `${PI_SESSION_ID}`,
   `${PI_EFFORT}`; the `${CLAUDE_*}` spellings accepted as aliases (ADR-0007).
4. Agent-name rewrite (A.3.4) — no-op without a Workstream 2 rewrite map.
5. Shell injection (A.3.5).

Single pass: later stages never re-scan text produced by earlier stages for earlier-stage
syntax (e.g. shell output is not substituted; substituted args inside `` !` `` **are** part of
the command — see A.3.5 security note). There is **no `@file` inlining for skills**:
substitution makes `@`-referenced paths absolute and the model reads them. The rendered result
is what gets delivered (A.4) and persists in context for the session.

#### A.3.2 Argument grammar (normative)

Input: one raw string `R` (everything after the command name for user invocation; the `args`
value for the `skill` tool). Rules:

1. `$ARGUMENTS` — and its alias `$@` — substitute `R` **verbatim** (quotes, spacing,
   everything).
2. Positional tokenization of `R`: split on whitespace; double or single quotes group a token
   (quotes stripped); backslash escapes the next character everywhere; an unterminated quote
   runs to end of string (no error). Tokens are 1-based: `$1` ≡ `$ARGUMENTS[1]`. Out-of-range
   → empty string.
3. Named arguments: `arguments:` frontmatter is a list of names (or a map name → description).
   Tokens of the form `name=value` where `name` is declared bind that name and are **removed
   from the positional sequence, which is then renumbered (compacted)**. `$name` placeholders
   substitute bound values, matched longest-name-first (`$outdir` before `$out`). Undeclared
   `x=y` tokens stay positional.
4. Slicing over the post-binding positional sequence: `${@:N}` substitutes tokens N onward,
   space-joined; `${@:N:L}` substitutes L tokens starting at N (bash-style; inherited from the
   engine, Appendix B.2).
5. Defaults: `${ARGUMENTS:-default}`, `${@:-default}`, `${N:-default}`, `${name:-default}`
   substitute the default when the value is empty/absent.
6. Escaping placeholders (template side): `\$ARGUMENTS`, `\$@`, `\$1`, `\$name` render
   literally, backslash removed.
7. Append fallback: if `R` is non-empty and **no** placeholder consumed anything, append
   `\n\nARGUMENTS: R` to the rendered body. If `R` is empty, placeholders render empty and
   nothing is appended.
8. Substitution is a single pass over the template; substituted values are never re-scanned
   for placeholders. Repeated placeholders substitute repeatedly.

Examples (fixtures must cover each): with declared `arguments: [name]` and
`R = alpha "b c" name=x \$lit` — `$ARGUMENTS` = `alpha "b c" name=x \$lit` (verbatim, rule 1);
positional tokens after named-binding and compaction are `alpha`, `b c`, `$lit` (the `\$` here
is R-side tokenization escaping, rule 2): `$1` = `alpha`, `$2` = `b c`, `$3` = `$lit`, `$4` =
`` (empty); `$name` = `x`; `${@:2}` = `b c $lit`. Template-side: a literal `\$1` in the skill
body renders `$1` (rule 6).

#### A.3.3 (reserved)

#### A.3.4 Agent-name rewrite rule (ADR-0008)

Applies only to names in the invoked skill's own rewrite map with `collided: true` (A.9).
Matching is **case-insensitive** (the subagents registry folds case) and **lexical**: a match
is a complete identifier token — not preceded or followed by `[A-Za-z0-9_-]` — and not already
part of a qualified `skill:agent` form. Rewrites apply throughout the SKILL.md body **including
code blocks** (agent-invocation examples live in fenced blocks, e.g. the `simplify` reference
skill) but never inside frontmatter. `references/` files are not rewritten (ADR-0008; bare
names there resolve via the bare-when-free rule).

#### A.3.5 Shell injection executor

Syntax: `` !`cmd` `` inline spans and fenced blocks whose info string is `!`. Execution:

- Enabled by default; global kill switch `disableSkillShellExecution: false` *(tunable)*
  replaces each with `[shell command execution disabled by policy]`. Rationale for
  enabled-by-default: Pi's trust boundary is at install/load time (project skills are gated on
  project trust; installing a skill ≈ installing an extension, which runs in-process JS), and
  the model already has an ungated `bash` tool, so skill shell injection grants no new
  capability to the model.
- Shell selected by the `shell` field; commands run with cwd = session cwd, env = the bash
  tool's per-execution environment (Appendix B.6) plus the A.8 skill variables. A shell that
  cannot be spawned (e.g. `powershell` missing on the host) inlines
  `[shell unavailable: <shell>]`.
- Sequential, in document order. Per-command timeout 30s *(tunable)*; on timeout, inline
  `[command timed out after 30s]`. Output (stdout+stderr, interleaved) capped at 16 KiB
  *(tunable)* with a truncation marker. Non-zero exit inlines the output plus
  `[exit code N]`. Failures never abort the render. Session abort cancels outstanding
  commands. Headless mode executes normally (render is deterministic harness work).
- Output is inlined once and never re-scanned for substitution or injection syntax.
- **Security note (authoring contract):** argument substitution runs before injection, so
  arguments are shell-visible text inside `` !` `` commands — by design (CC parity; args feed
  commands). Skill authors must quote (`"$ARGUMENTS"`-style) exactly as in any shell script;
  the docs state this explicitly.

### A.4 Delivery (ADR-0004)

- **Transport selection:** message-block is the default and universal fallback. The synthetic
  tool-use/result pair is used only for providers with a declared capability flag, populated
  after C1's feasibility check (Pi message model + per-provider replay verification in
  `packages/ai`).
- **Message-block shape:** the rendered content is appended to the outgoing user message
  wrapped in `<skill name="…" args="…">…</skill>` (commands: `<command …>`); attribute values
  are XML-escaped. The existing consumers of the current block format are required thin
  changes (Appendix B.12): the parse regex must accept the new attribute set and
  non-message-initial placement, and collapse applies per block, not per message.
- **Synthetic pair:** the harness fabricates a `skill` tool-use with `{name, args}` and a
  tool-result whose content is the rendered text — byte-identical to a genuine model-initiated
  call's result. Synthetic pairs **do not** emit `tool_call` extension events (there is
  nothing to veto — the user's invocation is authoritative) but **do** emit `tool_result`
  events flagged `synthetic: true` (a type-only extension of `ToolResultEvent`, Appendix B.4);
  the unpaired-`tool_result` convention is documented in the support matrix.
- Genuine model-initiated `skill` tool calls return the rendered content as their real tool
  result on any provider (inline mode; fork mode returns per the A.5 matrix).

### A.5 Execution modes and overrides

**Ephemeral request override (normative mechanism):** skill `model`/`effort` overrides are held
by the skill runtime and applied when constructing provider requests; they are **never**
routed through `AgentSession.setModel`/`setThinkingLevel`, which persist to session history and
settings defaults (Appendix B.4). The genuine-tool-call path maps onto the existing
`prepareNextTurn` per-turn snapshot (B.4); the message-initial path needs an equivalent
override on the turn's first request. Scope by invocation path:

- **User or synthetic invocation:** the override applies to all provider requests of the turn
  processing that message, then expires.
- **Genuine model tool call:** the current assistant response is already streamed; the
  override governs the continuation request(s) after the tool result, expiring at turn end.
- **Stacking:** the most recent invocation's override wins; a diagnostic notes discarded
  conflicting overrides. `disallowed-tools` from all stacked invocations union.
- Effort values are clamped to the active (possibly overridden) model's supported thinking
  levels.

**Invocation-path × execution-mode matrix (normative):**

| | `context: inline` | `context: fork`, background (default) | `context: fork`, foreground |
| --- | --- | --- | --- |
| User `/name` or synthetic | Rendered content delivered per A.4 | Parent transcript gets a short spawn notice (skill name, agent id); content goes only to the subagent; completion reports back via the subagents extension's normal notification | Spawn notice; parent turn waits; subagent's final report is delivered as the notice's follow-up |
| Model `skill` tool call | Tool result = rendered content | Tool result = spawn acknowledgment `{agentId, background: true}` — **never** the rendered content | Tool result = subagent's final report |

- Fork resolution: `agent` type per A.2; spawn via A.9 RPC.
- **Fallbacks:** spawn RPC absent, spawn failure, or headless/print mode → inline delivery +
  one diagnostic.
- **Repeat guard (CC parity):** a background fork of a skill while a previous background fork
  of the same skill is still running → error result/notice, no spawn. Liveness is tracked via
  the A.9 `subagents:agent-ended` event.
- Fork invocations are exempt from A.6 content dedup (each spawn is an action) and excluded
  from carry-forward (their content never entered the parent context).

### A.6 Lifecycle

- **Re-invocation dedup:** identity = skill name + byte-identical rendered content vs the last
  delivery of that skill in this session → short "already loaded" note instead of full
  content. Any difference (args, injection output, file edits) re-delivers in full.
  **Compaction interaction:** if the last delivery was dropped or truncated by compaction (not
  carried forward in full), dedup state for that skill is invalidated and the next invocation
  re-delivers in full.
- **Compaction carry-forward:** after auto-compaction, re-attach the most recent **inline**
  invocation of each invoked skill, most-recent-first, budgets 5,000 tokens per skill and
  25,000 combined (estimator below). MRU state and invocation counts live in the session file
  and survive resume.
- **Listing budget (deterministic algorithm):** token estimator = `ceil(chars / 4)` (no model
  tokenizer dependency). Budget = `floor(contextWindow × skillListingBudgetFraction)`
  (default 0.01 *(tunable)*), recomputed on model switch at the next listing build. Per-entry
  cap: description + when_to_use ≤ 1,536 chars. When over budget: sort by (invocation count
  asc, name asc) and truncate descriptions with a `…` marker until the listing fits; a
  truncated description shorter than 64 chars is dropped entirely (name-only entry). Names
  always survive. `/skills` shows per-skill estimated cost.
- **Visibility states** (per skill, persisted in settings — key semantics in B.8): `on`
  (default) | `name-only` | `user-invocable-only` | `off` (hidden everywhere incl. SDK/RPC
  listings; invoking by name errors). **Interaction rule:** frontmatter gates
  (`disable-model-invocation`, `user-invocable: false`) are upper bounds; the effective
  visibility is the most restrictive of frontmatter and settings. Settings can never re-grant
  what frontmatter removed. Collision losers (A.1 precedence) keep their own visibility under
  their qualified name.
- **Discovery — retained behavior:** recursive `SKILL.md` under the Pi-owned locations
  (ADR-0002) with recursion stopping at a found `SKILL.md`; `.gitignore`/`.ignore`/`.fdignore`
  honored; symlinks followed, deduped by canonical path; project trust gating; `--skill` CLI
  flag; settings `skills` array; packages; extension-injected resources.
- **Discovery — new in C4 (nested/monorepo):** when session tool events touch a file whose
  ancestor directories (between cwd and the file) contain a `.pi/skills/` or `.agents/skills/`
  root not already scanned, scan that root and register its skills; on name collision the
  nested skill gets the dir-qualified name (`<root-relative-dir>:name`, e.g.
  `apps/web:deploy`). The watcher covers all scanned roots; deletions unregister.
- **`paths` activation:** matched against the session's recently touched files (sliding window
  of the last 50 tool-touched paths *(tunable)*); effect is a **listing boost only** — a
  matching skill is exempted from description truncation and sorted first in its listing
  section. No auto-invocation.
- **Reload:** live watching feeds the A.9 change events; `/reload` still works; both re-emit
  the aggregated collision diagnostics.

### A.7 Commands (differences from skills)

Commands are markdown files in `~/.pi/agent/commands/` (user) and `.pi/commands/` (project,
trust-gated) — Pi-native locations only; there is no `.agents/commands/` (no cross-harness
convention exists to mirror, and inventing one silently is worse than not having it). They
share the skill render pipeline with these differences:

- **`@path` references are inlined at expansion time** (CC behavior for custom commands),
  unlike skills where the model reads them.
- No base-dir preamble, no `context: fork`, no `paths`, no bundled agents.
- Frontmatter subset: `description`, `argument-hint`, `arguments`, `model`, `effort`,
  `disable-model-invocation`, `user-invocable`, `disallowed-tools`, `shell`.
- Model invocation via the **`slash_command`** tool (canonical name; `{command: string,
  args?: string}`), subject to `disable-model-invocation`. CC's `SlashCommand` name reaches it
  through the redirect map (A.8).
- Existing prompt templates are grandfathered as command sources (same engine, same argument
  grammar incl. `$@`/slicing — A.3.2); migration note in docs.

### A.8 Interop tables (ADR-0006 / ADR-0007)

Substitution variables (text) and environment variables (processes spawned during skill
execution — shell injection and bash-tool runs; injected per-execution via the spawn-context
seam, Appendix B.6). **Env-injection scope is turn-scoped**, matching A.5 override expiry: the
variables are present for executions during the invoking turn and absent afterwards (no stale
`PI_SKILL_DIR` leaking into unrelated later commands).

| Pi native | Accepted CC alias | Meaning |
| --- | --- | --- |
| `PI_SKILL_DIR` | `CLAUDE_SKILL_DIR` | Absolute dir of the invoked skill |
| `PI_PROJECT_DIR` | `CLAUDE_PROJECT_DIR` | Project root (cwd's git root) |
| `PI_SESSION_ID` | `CLAUDE_SESSION_ID` | Current session id |
| `PI_EFFORT` | `CLAUDE_EFFORT` | Effective effort/thinking level |

Redirect-map defaults (unknown-tool error replies; entry active only when target registered):
`AskUserQuestion → ask_user_question`, `Task → Agent`, `Glob → find`, `Skill → skill`,
`SlashCommand → slash_command`, plus capitalized→lowercase identities for core tools
(`Read → read`, `Grep → grep`, `Edit → edit`, `Write → write`, `Bash → bash`, `Ls → ls`).
User-extensible via settings (B.8); unmapped misses get a nearest-name suggestion
(case-insensitive edit distance ≤ 2, else none). Not translated (documented unsupported,
ADR-0007): `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${user_config.KEY}`,
`plugin:skill` names, hooks execution, `Skill(name)` permission rules.

### A.9 Cross-extension seam contracts (normative wire formats)

All seams ride the existing untyped, fire-and-forget core event bus (B.3); reliability comes
from the envelope conventions below. Shared TypeScript contract types are **copied** into each
repo with identical conformance fixtures (no shared package — repos stay independently
buildable).

- **RPC envelope (existing, recorded):** requests carry `requestId`; replies arrive on a
  scoped channel as `RpcReply<T> = {success: true, data?: T} | {success: false, error:
  string}`. Caller timeout: 2s (constant), degrade gracefully.
- **Subagents RPC (existing / fork):** `subagents:rpc:spawn {requestId, type, prompt,
  options}`, `subagents:rpc:stop`, `subagents:rpc:ping` → currently `{version: 2}`; the
  Workstream 2 fork bumps to `{version: 3, capabilities: {skillAgents: true}}` and adds the
  `subagents:agent-ended {agentId}` completion event (required by A.5's repeat guard). Core
  treats version ≥ 3 + `skillAgents` as permission to pass `skill:agent` qualified types.
- **Skill-set seam (new, core emits):** event `skills:changed {revision, skills: [{name,
  qualifiedName?, filePath, baseDir, source}], removed: [name]}` on load, `/reload`, and watch
  updates; request/reply `skills:query {requestId}` → full snapshot in the same shape.
  `revision` is a monotonic counter; consumers ignore stale revisions.
- **Rewrite-map seam (new, fork emits):** event `skill-agents:rewrite-maps {revision, maps:
  {[skillName]: {[bareName]: {qualified, collided}}}}` whenever its registry changes (initial
  emit after processing the first skills snapshot), plus request/reply
  `skill-agents:query {requestId}` → current maps, so a late-subscribing core pulls instead of
  waiting for the next registry change. Core keeps the last-received map; absence = empty map
  (rewrite stage no-ops).

## Appendix B — Pi code anchor map (verified 2026-08-11, branch `personal`)

Facts an implementer builds on; re-locate by symbol name if lines drift.

1. **Skills today:** `packages/coding-agent/src/core/skills.ts` — `SkillFrontmatter` parses
   exactly `name`, `description`, `disable-model-invocation` (strict `=== true`); everything
   else ignored via index signature. Discovery scans fixed roots only and stops descending at
   a found `SKILL.md` — the C4 nested discovery (A.6) is new behavior. User expansion:
   `agent-session.ts:_expandSkillCommand` — read file → strip frontmatter → wrap in
   `<skill name=… location=…>` XML + relative-paths hint → append args raw; an unknown
   `/skill:` name passes through as literal text (`agent-session.ts` ~1459). Model invocation:
   system-prompt `<available_skills>` block instructing the model to `read` the file. The
   expansion and model-read paths are what C1 retires.
2. **Argument engine to absorb:** `core/prompt-templates.ts` — `substituteArgs` supports
   `$ARGUMENTS`/`$@`, `$N`, `${@:N}`, `${@:N:L}`, and `${…:-default}` (regex at ~line 74):
   whitespace tokenization with quote-grouping and quote-stripping, 1-based positionals;
   **no** backslash-escape handling today (A.3.2 rules 2/6 are new); accepts exactly one
   message-initial command and assigns all trailing text as args (the A.1 tokenizer
   generalizes this).
3. **Resource loading:** `core/resource-loader.ts` — `getSkills(): {skills, diagnostics}`;
   internal `skillsOverride` option (not extension-exposed); event bus via `createEventBus`
   (`core/event-bus.ts` — untyped, fire-and-forget, no replay; A.9's envelope conventions sit
   on top). Diagnostics rendered by `interactive-mode.ts:formatDiagnostics` (already groups
   collisions by name); headless mode writes to stderr.
4. **Extension API:** `core/extensions/types.ts` — events: `input` (transform + block),
   `tool_call` (block + arg mutation), `tool_result`, `before_agent_start` (chainable
   `systemPrompt`), `context` (fired before each LLM call; can modify messages — wired via
   `transformContext`, `core/sdk.ts` ~403; candidate seam for carry-forward prototyping),
   `session_start`, `session_shutdown`, `session_before_compact` (cancellable/customizable —
   C4 must verify surface), `session_compact`, `agent_start`, `agent_end`, `turn_start`,
   `turn_end`, `tool_execution_start/update/end`, `resources_discover`, `user_bash`; APIs:
   `registerTool()`, `registerCommand()` (+ `getArgumentCompletions`),
   `ctx.setThinkingLevel()`, `ctx.reload()`, `ctx.ui`. **No permission layer and no MCP
   support exist in core.** ⚠ `AgentSession.setModel` and `setThinkingLevel` **persist**: they
   append to session history and write settings defaults (`setDefaultThinkingLevel`) — NOT the
   mechanism for A.5's ephemeral overrides. The existing per-turn override seam is
   `prepareNextTurn` (`packages/agent/src/agent-loop.ts` ~230–245): its snapshot can replace
   `model`/`thinkingLevel` for the next turn without persisting — A.5's genuine-tool-call path
   maps onto it. A.4's `synthetic: true` flag requires extending `ToolResultEventBase`
   (currently toolCallId/input/content/isError/usage only). `ThinkingLevel` =
   `off|minimal|low|medium|high|xhigh|max` (`packages/agent/src/types.ts`).
5. **pi-subagents (upstream `@tintinweb/pi-subagents`, to be forked; local checkout
   `~/Developer/ai/pi-subagents-tintin`):** agent types from files only (`~/.pi/agent/agents/`,
   `.agents/agents/`, `.pi/agents/`; frontmatter: `model`, `thinking`, `disallowed_tools`,
   `skills`, `run_in_background`, `isolated`, `max_turns`, tool selectors); **name resolution
   is case-insensitive** (`src/agent-types.ts`); RPC in `src/cross-extension-rpc.ts` with the
   A.9 envelope (`PROTOCOL_VERSION = 2`, `RpcReply`, `requestId`, ping → `{version}`).
6. **Bash tool env seam:** `core/tools/bash.ts` — `resolveSpawnContext` builds a
   **per-execution** env snapshot from `getShellEnv()`, strips `PI_SESSION_ID`/`PI_MODEL`/etc.,
   and re-injects them when `exposeSessionEnvironment` is on; a `BashSpawnHook` can transform
   the spawn context. This is the injection point for A.8 skill env vars (per-execution,
   turn-scoped per A.8 — never `process.env`). `env` is not a model-facing bash parameter.
7. **claude-bridge (your fork, `pi-claude-bridge`):** provider disables CC native tools
   (`tools: []`) and exposes Pi's `context.tools` (enumerated in `src/index.ts` ~line 889)
   through an in-process MCP server named `custom-tools` (`mcp__custom-tools__<tool>`).
   Provider `Context` is only `{systemPrompt, messages, tools}` (`packages/ai/src/types.ts`),
   so the Workstream 3 contract stays systemPrompt-based:
   `src/skills.ts:extractSkillsBlock` currently scrapes between the literal strings "The
   following skills provide specialized instructions…" and `</available_skills>` and rewrites
   the "Use the read tool…" line (`rewriteSkillsBlock`) — both replaced per §5. AskClaude
   subagents keep CC-native tools and forward the block only when Read is allowed
   (`rewriteReadTool: false` path, `src/index.ts` ~1982).
8. **Settings:** `core/settings-manager.ts` — existing: `skills?: string[]` (paths/dirs),
   `enableSkillCommands?: boolean` (false now also removes skills from the bare namespace,
   A.1), `packages`; deep-merge of user + project scopes with project-trust gating. New keys
   introduced by this plan (flat, matching existing style):
   `toolRedirects?: Record<string, string>` (merged over A.8 defaults),
   `skillVisibility?: Record<string, "on"|"name-only"|"user-invocable-only"|"off">` (keyed by
   the skill's listing name — the qualified form when the skill is dir-qualified),
   `skillListingBudgetFraction?: number` (default 0.01),
   `disableSkillShellExecution?: boolean` (default false),
   `skillShellTimeoutMs?: number` (default 30000),
   `skillShellOutputLimitBytes?: number` (default 16384),
   `skillPathsWindow?: number` (default 50),
   `skillInterop?: boolean` (default true).
9. **Reference materials outside this repo:** `~/Developer/ai/ase` (plugin: 47 skills, 8
   agents, `plugin/hooks/hooks.json` with 5 events shelling to `ase hook <event>`,
   `mcpServers` in `.claude-plugin/plugin.json`; effort census: 46/47 set `effort` — 30
   `high`, 12 `xhigh`, 4 `medium`; the v5 report's "46/47 xhigh" is wrong);
   `~/Developer/ai/gstack` (multi-host generator, 10 hosts in `hosts/index.ts`,
   `.agents/skills/` neutral output, root `SKILL.md` router);
   `~/Developer/ai/furiai-skills/skills/simplify` (bundled-agents reference skill).
10. **Unknown-tool rejection (redirect site):** `packages/agent/src/agent-loop.ts:
    prepareToolCall` returns an immediate `Tool <name> not found` error result **before**
    `beforeToolCall` hooks run — the C1 redirect map must be a thin change at this site
    (permitted by ADR-0003); it cannot be implemented in coding-agent extension hooks alone.
    The map itself lives in coding-agent settings (B.8) and is passed into `packages/agent`
    via an `AgentLoopConfig` callback.
11. **TUI autocomplete (C2 item 4 sites):** three start-of-line gates, all requiring thin
    changes: the slash-menu trigger `isInSlashCommandContext`
    (`packages/tui/src/components/editor.ts` ~2164: `isSlashMenuAllowed() &&
    textBeforeCursor.trimStart().startsWith("/")`); slash-command completion
    (`packages/tui/src/autocomplete.ts` ~393: requires `beforePrefix.trim() === ""`); and
    Enter-submit when the completion prefix begins with `/`
    (`packages/tui/src/components/editor.ts` ~767). Behavior tests in `packages/tui`'s
    `node:test` suite.
12. **Skill-block consumers (A.4 message-block changes):** `parseSkillBlock`
    (`core/agent-session.ts` ~132) matches
    `^<skill name="…" location="…">…$` — requires the `location` attribute and anchors to the
    whole message; an identical regex copy lives in `core/export-html/template.js` ~322; the
    TUI collapsible renderer is `modes/interactive/components/skill-invocation-message.ts`.
    All three are required thin changes for the new attribute set and non-message-initial
    placement.

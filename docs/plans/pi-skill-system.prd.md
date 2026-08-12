# Pi Skill System — PRD Shim (PRP routing document)

**This file is a routing shim for the PRP workflow (`/prp-plan` → `/prp-implement`), not a
specification.** The single source of truth is `docs/plans/pi-skill-system-plan.md`
(**Version 6, frozen**) together with the ADRs it cites (`docs/adr/ADR-0001` … `ADR-0008`).
Where this file and the plan disagree, **the plan wins**. This shim exists only to give the
PRP tooling a phases table to walk and to carry standing directives into every generated
per-phase implementation plan.

Per the plan's freeze note: further refinement happens in the per-phase implementation plans,
which are checked against the spec (Appendix A). Refinement means adding implementation
detail — never contradicting Appendix A or re-litigating an ADR decision.

---

## Problem Statement

Pi treats a skill as prompt expansion (3 frontmatter fields, raw arg append, model-read
invocation). CC-class skill frameworks (ASE: 47 skills + 8 agents + 5 hooks + MCP; gstack:
~55 skills, 10 host adapters) cannot run on Pi as first-class citizens: no structured
invocation, no render pipeline, no per-skill execution semantics, no lifecycle management.

## Proposed Solution

Bring Pi's native skill system to feature parity with Claude Code's per the frozen v6 plan:
full frontmatter contract, deterministic render pipeline, `skill`/`slash_command` tools,
mid-prompt tokenizer, ephemeral execution overrides, fork execution via pi-subagents, and
lifecycle management — native in core (ADR-0001), new modules with thin call sites
(ADR-0003), never reading Claude Code's directories (ADR-0002).

## Key Hypothesis

We believe native CC parity will let CC-class frameworks port to Pi via forks with a Pi
target. We'll know we're right when the §7 fixture pack passes per-phase and, ultimately,
the ASE and gstack fork Pi targets install and run a scripted end-to-end session (render a
skill with args, fire a hook, spawn a bundled agent).

---

## Standing Directives for Plan Generation

Every implementation plan generated from this PRD MUST follow these directives. Copy them
into consideration before Phase 1 of `prp-plan`; violations are plan defects.

### D1 — Source-of-truth precedence

- `docs/plans/pi-skill-system-plan.md` v6 + `docs/adr/ADR-0001…0008` are normative.
  Appendix A is the behavior spec (this spec, not current CC, is the parity target).
  Appendix B is the code anchor map. §2 non-goals and §8 deferred items are binding scope
  limits.
- Generated plans refine (add file-level tasks, code patterns, test cases); they never
  contradict Appendix A, reopen an ADR, or silently narrow an acceptance criterion.
- Any decision the spec does not settle goes into the plan's **Questionables** section with
  the assumption taken — never silently decided.

### D2 — Codebase research is verification, not discovery

- Appendix B (verified 2026-08-11, branch `personal`) is the authoritative anchor map.
  Codebase-research agents/passes must **verify the phase's cited anchors still hold**
  (re-locate by symbol name if line numbers drifted) and **extract the actual code
  snippets** around them for the plan's "Patterns to Mirror" section — the one thing
  Appendix B deliberately omits. Do not re-derive the architecture from scratch.
- Web research is generally unnecessary: Appendix A was verified against the Claude Code
  binary v2.1.220. Exceptions worth fetching: agentskills.io name-validation rules (A.2)
  and provider API docs when the C1 replay verification needs them.
- Pattern extraction must include the existing test idioms: `test/suite/harness.ts` + faux
  provider (coding-agent), `packages/ai` converter tests, `packages/tui` `node:test` style.

### D3 — Required plan content

- **Mandatory Reading (P0):** repo `AGENTS.md`; the plan sections listed under the phase's
  "Mandatory context" below; the ADRs cited there. P1: the anchor files themselves.
- **Acceptance Criteria:** copy the phase's *Acceptance* paragraph from §3 **verbatim** as
  the top-level criteria, then decompose into per-task validations. The §7 "required
  non-happy-path coverage" items that belong to the phase are acceptance criteria too.
- **NOT Building:** restate the §2 non-goals and §8 deferred items adjacent to the phase
  (e.g. no hooks execution, no permission layer, no `allowed-tools` enforcement, no
  `.claude/` reads, no tool aliases).
- New settings keys must use the exact names and defaults in Appendix B.8; new modules go
  in `core/skills/` / `core/commands/`; hot files (`agent-session.ts`,
  `interactive-mode.ts`, `core/skills.ts`, `agent-loop.ts`, `packages/tui`) get thin call
  sites only (ADR-0003), at the touch points anchored in B.10–B.13.
- A phase MAY be implemented as multiple sequential plan files (`…-c1a.plan.md`,
  `…-c1b.plan.md`) when one-loop scope demands it; propose the split in the plan's Agent
  Notes, and mark the phase `complete` here only when the phase's full §3 acceptance
  paragraph is green.

### D4 — Validation commands (pi-repo specific; embed these, not generic ones)

- **Level 1 (static):** `npm run check` from the repo root — full output, no tail; fix all
  errors, warnings, and infos.
- **Level 2 (targeted tests):** run each new/changed test file directly, from the package
  root:
  - coding-agent / ai (vitest):
    `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/…/<file>.test.ts`
  - tui (`node:test`): `node --test test/<file>.test.ts`
- **Level 3 (suite):** `./test.sh` from the repo root.
- **Forbidden:** `npm test` / the full vitest suite directly (e2e tests activate on env
  keys), `npm run build` (unless the user asks). Suite tests use the faux provider — no
  real provider APIs or keys.
- **Test placement (§7):** synthetic-pair replay against provider converters →
  `packages/ai`; tokenizer/pipeline/lifecycle → coding-agent vitest under
  `packages/coding-agent/test/suite/`; TUI completion/editor behavior → `packages/tui`
  `node:test`; bridge path → pi-claude-bridge repo (out of scope here).

### D5 — Repo working rules

- Follow repo `AGENTS.md` in full. Highlights the implement stage must not miss: stage
  explicit paths only (never `git add -A`/`.`); commit format
  `{feat,fix,docs}(coding-agent|ai|tui|agent): …`; changelog entries under
  `## [Unreleased]` in the affected package's `CHANGELOG.md`; no inline imports; erasable
  TypeScript only in `packages/*/src|test`; no `any`; other pi sessions may be running in
  this cwd — touch only your own files.

---

## Implementation Phases

<!-- STATUS: pending | in-progress | complete. prp-implement updates Status and PRP Plan. -->

| #   | Phase                                   | Description                                                                    | Status  | Parallel | Depends | PRP Plan |
| --- | --------------------------------------- | ------------------------------------------------------------------------------ | ------- | -------- | ------- | -------- |
| 1   | C0 — contract surface                   | Full frontmatter contract, listing v2 + helper, skill-set event seam           | in-progress | -        | -       | Split per D3, implement in order: `/Users/paolof/.prp/pi-b2ed50ef/plans/pi-skill-system-c0a-frontmatter-listing.plan.md` → `/Users/paolof/.prp/pi-b2ed50ef/plans/pi-skill-system-c0b-events-visibility.plan.md` → `/Users/paolof/.prp/pi-b2ed50ef/plans/pi-skill-system-c0c-fixtures-docs.plan.md` (consolidated reference: `/Users/paolof/.prp/pi-b2ed50ef/plans/pi-skill-system-c0-contract-surface.plan.md`; mark `complete` only when c0c verifies the full §3 C0 acceptance paragraph) |
| 2   | C1 — render pipeline, skill tool, delivery | A.3 pipeline, interop subset, `skill` tool, A.4 transports, redirect map    | pending | -        | 1       | -        |
| 3   | C2 — commands, tokenizer, namespace     | Commands system, A.7.1 includes, mid-prompt tokenizer, TUI autocomplete        | pending | with 4   | 2       | -        |
| 4   | C3 — execution semantics                | Ephemeral model/effort overrides, `disallowed-tools`, fork via subagents RPC   | pending | with 3   | 2       | -        |
| 5   | C4 — lifecycle & management             | Dedup, listing budget, carry-forward, `/skills` UI, watching + nested discovery | pending | -        | 3, 4    | -        |

Phases 3 and 4 both build only on C1 and touch disjoint areas (commands/tokenizer/TUI vs
agent-loop overrides/subagents RPC); they can run in parallel in separate git worktrees.

### Phase Details

For each phase: Goal/Scope/Success signal are extracted 1:1 from §3 of the source plan —
the wording there is authoritative; on any doubt, read the plan section, not this summary.

**Phase 1: C0 — contract surface**

- **Goal**: Parse and preserve the full CC frontmatter contract; establish the listing and
  event-seam contracts that Workstreams 2/3 build on.
- **Scope**: A.2 frontmatter parsing (lenient booleans, unknown fields preserved, `hooks`
  parsed-never-executed); A.1 command-name grammar as a namespace gate (invalid names load
  but stay out of the command namespace); `argument-hint` in autocomplete, `when_to_use`
  folding, `user-invocable: false` hiding; the A.9 skill-set seam (canonical IDs, full
  frontmatter payload, `skills:changed` + `skills:query`); the versioned listing with the
  byte-exact A.6 entry schema and exported `extractSkillListingBlock(systemPrompt)`.
- **Success signal**: The §3 C0 acceptance paragraph, verbatim — committed frontmatter
  conformance fixtures (metadata-only snapshots from pinned ASE/gstack fork revisions,
  vendored under `test/suite/`) parse without loss; per-field fixtures round-trip through
  `getSkills()`; a fixture extension receives the A.9 snapshot and change events including
  the query round-trip; `extractSkillListingBlock` round-trips the emitted listing
  byte-exactly.
- **Mandatory context**: Plan §3 Phase C0, §7; Appendix A.1 (name grammars), A.2, A.6
  (listing entry schema), A.9 (canonical ID, skill-set seam); Appendix B.1, B.3, B.8, B.9;
  ADR-0002, ADR-0007.

**Phase 2: C1 — render pipeline, skill tool, delivery**

- **Goal**: Replace `_expandSkillCommand`'s naive expansion with the full A.3 render
  pipeline on all invocation paths, with A.4 delivery and the tool-name redirect map.
- **Scope**: A.3 pipeline (argument grammar A.3.2, agent-name rewrite A.3.4, shell
  injection A.3.5 incl. its tool-policy gate), including queued steer/follow-up
  invocations carrying invocation metadata through the queue; the config-gated interop
  subset (`CLAUDE_*` aliases, A.8 env via the B.6 spawn-context seam — never
  `process.env`); the dedicated `skill` tool; A.4 transports (message-block default;
  synthetic pair per provider after the `packages/ai` replay verification, which is the
  first task of this phase; `ToolResultEvent` extension; B.12 invocation-metadata storage
  contract); the redirect map at the B.10 `prepareToolCall` site via an `AgentLoopConfig`
  callback.
- **Success signal**: The §3 C1 acceptance paragraph, verbatim — ASE-style fixture renders
  on each supported transport; A.3.2 examples covered verbatim; shell-policy fixtures for
  `--no-tools`, excluded `bash`, and `disallowed-tools`; queued invocation activates its
  overrides when consumed; redirect fixtures for `Task`/`AskUserQuestion` misses and
  unregistered-target fallthrough.
- **Mandatory context**: Plan §3 Phase C1, §7; Appendix A.1 (`skill` tool contract), A.3
  (all), A.4, A.5 (queued-invocation metadata), A.8; Appendix B.1, B.2, B.4, B.6, B.10,
  B.12, B.13; ADR-0004, ADR-0006, ADR-0007.

**Phase 3: C2 — commands, tokenizer, namespace**

- **Goal**: Evolve prompt templates into the commands system and ship the unified bare
  `/name` namespace with the mid-prompt tokenizer and TUI autocomplete.
- **Scope**: `commands/` dirs per A.7 with the A.7.1 include spec and `slash_command`
  tool; the A.1 tokenizer grammar exactly (maximal-run scan, punctuation stripping,
  no-fallback rejection, fence/inline-code skipping, odd-backslash escaping, argument
  ownership, cap 6, fork stop); namespace precedence with reserved qualifier prefixes and
  one aggregated collision diagnostic; TUI mid-prompt `/` autocomplete with source badges
  (all four B.11 start-of-line gates plus `AutocompleteItem` metadata + renderer).
- **Success signal**: The §3 C2 acceptance paragraph, verbatim — every A.1 grammar example
  as a fixture (punctuation stripping, qualified/nested names, no-fallback, fences,
  escapes, over-cap, ownership); `/usr/bin` never triggers; collision diagnostic +
  qualified fallback; every A.7.1 edge case; tokenizer in coding-agent vitest, editor
  behavior in `packages/tui` `node:test`.
- **Mandatory context**: Plan §3 Phase C2, §7; Appendix A.1 (tokenizer + name grammars),
  A.3.2, A.7, A.7.1; Appendix B.2, B.11; ADR-0005.

**Phase 4: C3 — execution semantics**

- **Goal**: Per-skill execution control: ephemeral `model`/`effort` overrides,
  `disallowed-tools` enforcement, and fork execution through the pi-subagents RPC.
- **Scope**: The A.5 ephemeral request-override record with **both** application points
  (first-request path reading agent state directly, and composition inside/after
  `_installAgentNextTurnRefresh`'s wrapper — a plain chained `prepareNextTurn` is
  insufficient, B.4); A.2 `disallowed-tools` grammar (schema removal from subsequent
  requests + `tool_call`-time blocking, redirect-map resolved); `context: fork` /
  `agent` / `background` per the A.5 matrix with A.9 spawn RPC, subscribe-before-spawn
  buffering, `subagents:rpc:ping` feature detection, and inline+diagnostic degradation;
  `paths` listing boost per A.6.
- **Success signal**: The §3 C3 acceptance paragraph, verbatim — per-field fixtures per
  A.5 incl. all fork matrix rows, repeat guard, spawn-failure fallback, completion-event
  ordering/buffering race via a stub subagents extension; override fixtures for initial,
  mid-turn tool-call, queued, and retry paths.
- **Mandatory context**: Plan §3 Phase C3, §7; Appendix A.2 (`disallowed-tools`, `model`,
  `effort`, `context`, `agent`, `background`), A.5, A.9 (subagents RPC + ordering);
  Appendix B.4, B.5, B.13; ADR-0006, ADR-0007.

**Phase 5: C4 — lifecycle & management**

- **Goal**: Skill lifecycle: dedup, listing budget, compaction carry-forward, `/skills`
  management UI, live watching and nested/monorepo discovery.
- **Scope**: Re-invocation dedup (identity tuple + compaction-interaction rules, A.6);
  the exact A.6 listing-budget algorithm (UTF-16 units, `est`, emission order, monotone
  truncation loop, exempt-overflow, skeleton floor) with cost visibility in `/skills`;
  carry-forward (5k/25k, MRU-first, inline-only; investigate `session_before_compact`
  first, `context`-event prototype acceptable, minimal core seam only as last resort);
  `/skills` UI with visibility states persisted by canonical skill ID per the A.6 truth
  table; live watching + the A.6 nested-discovery algorithm.
- **Success signal**: The §3 C4 acceptance paragraph, verbatim — carry-forward and dedup
  invalidation after forced compaction; byte-exact budget output incl. XML-escaped and
  non-ASCII descriptions (the A.6 algorithm is the oracle); the visibility truth table
  verified row by row across listing, model invocation, user invocation, and SDK/RPC
  listing; visibility survives collision-winner deletion; model-switch budget rebuild and
  watcher deletion covered.
- **Mandatory context**: Plan §3 Phase C4, §7 (incl. resume/branch state reconstruction);
  Appendix A.6 (all); Appendix B.1, B.3, B.4 (`session_before_compact`, `context` event),
  B.8; ADR-0002, ADR-0003.

---

## Workstreams outside this repo (not phases here)

- **Workstream 2 — pi-subagents fork** (plan §4): can start once Phase 1 (C0) lands; runs
  in the fork repo with its own PRP store. Needs the A.9 skill-set seam and ships the
  protocol v3 bump + `subagents:agent-ended` that Phase 4 (C3) consumes — coordinate: C3's
  stub-extension fixtures encode the A.9 contract WS2 must satisfy.
- **Workstream 3 — claude-bridge companion** (plan §5): item-level milestones tied to C0
  (listing contract + peer-dep bump) and C1 (`rewriteReadTool` deletion, provider-path
  harness line); runs in the pi-claude-bridge repo with its own PRP store.

## Notes for the PRP tooling

- `prp-plan` selects the first `pending` phase whose dependencies are `complete` and
  marks it `in-progress` with a link in the PRP Plan column; `prp-implement` marks it
  `complete`. Keep this file's table as the progress ledger.
- Wire back/forward references between successive phase plans with
  `prp-plan update-references` as they are created.

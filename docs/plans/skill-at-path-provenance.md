# Plan: remove skill `@path` absolutization and fix the stage-5 provenance defect

**Issue:** [pfurini/pi#6](https://github.com/pfurini/pi/issues/6) — Skill `@path` absolutization
rewrites user-supplied arguments against skill baseDir.
**Branch base:** `personal` @ `5ee18865d`
**Decision (user, 2026-08-22):** fix direction 4 (remove stage 4 entirely) plus the stage-5
sibling fix.
**Revision:** v2, amended after adversarial review (see §8).

## 1. Problem

The skill render pipeline runs argument substitution (stage 2) before `@path` absolutization
(stage 4). By the time stage 4 runs it sees one flat string and cannot tell skill-authored text
from user-supplied argument text, so it resolves both against `skill.baseDir`.

Verified at `5ee18865d` by running stages 2 and 4 directly:

| `$ARGUMENTS` raw value | Rendered output |
| --- | --- |
| `@docs/handoff.md` | `/…/.pi/skills/prp-prd/docs/handoff.md` |
| `@./relative.md` | `/…/.pi/skills/prp-prd/relative.md` |
| `@docs/a.md @docs/b.md` | both rewritten |
| `@/tmp/absolute.md` | unchanged (absolute guard) |
| `@user mentioned` | unchanged (no path separator) |

Two facts the issue does not record, both verified:

- **The rule-8 append fallback is also affected.** A body with no placeholder still gets
  `ARGUMENTS: <raw>` appended, and stage 4 rewrites that text too. A skill author who never
  wrote `$ARGUMENTS` still corrupts the user's path.
- **Stage 5 has the identical defect.** `rewriteAgentNames` re-scans argument text: raw args
  `reviewer` render as `myskill:reviewer` when a collided rewrite map exists. Currently inert
  (no rewrite map ships) but live once Workstream 2 lands. It also runs *after* the base-dir
  preamble is prepended, so a skill directory containing a collided agent name as a path
  segment would be corrupted in the preamble.

`absolutizeSkillPaths` is a Pi-only stage. Claude Code performs no `@path` absolutization at
all: the captured conformance probe `test/suite/fixtures/cc-argument-grammar/probes/probe11/expected.txt`
shows CC rendering authored and argument-derived `@path` tokens literally. Pi's stage 4 turned
CC's author opt-in (`@${CLAUDE_SKILL_DIR}/notes.md`, made absolute by ordinary variable
substitution) into an unconditional rewrite, and `docs/skills-capability-matrix.md:38` records
the two as equivalent when they are not.

## 2. Approach

Delete stage 4. Authors who want a skill-local reference write `@${PI_SKILL_DIR}/notes.md`,
which variable substitution already makes absolute. Nothing scans for bare `@path`, so argument
text can never be reinterpreted — the bug is fixed by construction rather than by adding
provenance tracking through a flattened string.

Fix stage 5 the same way: move the agent-name rewrite ahead of everything that introduces
non-authored text. A.3.4 scopes the rewrite to "the body"; the preamble and substituted
arguments are not the body.

### 2.1 The stage-5 move needs a companion regex fix

Moving the rewrite before argument substitution is **not safe on its own.**
`rewriteAgentNames` (`src/core/skills/render.ts:135`) matches a bare name unless it is adjacent
to `[A-Za-z0-9_:-]`. `$` is not in that class, so a `$`-prefixed placeholder is a valid match.
Running the rewrite first therefore destroys placeholders. Verified at `5ee18865d`:

| Body | Declared | Collided agent | Current output | Naive-move output |
| --- | --- | --- | --- | --- |
| `Target: $reviewer.` | `reviewer` | `reviewer` | `Target: hello.` | `Target: $myskill:reviewer.`<br>`\n\nARGUMENTS: hello` |
| `All: $ARGUMENTS.` | — | `arguments` | `All: hello.` | `All: $myskill:arguments.`<br>`\n\nARGUMENTS: hello` |

The rewrite is case-insensitive, so a collided agent literally named `arguments` breaks
`$ARGUMENTS`. Both cases also silently trip the rule-8 append fallback, because no placeholder
substituted.

**Fix:** add `$` to the lookbehind exclusion class —
`(?<![A-Za-z0-9_:$-])` — so a `$`-prefixed token is a placeholder, never an agent mention. An
author who means the agent writes `reviewer`, not `$reviewer`.

Verified this preserves every wanted behavior: declared `$name` still substitutes; authored bare
names are still rewritten, including inside code blocks and case-insensitively; the qualified
`other:reviewer` form stays untouched; and argument *values* are no longer rewritten.

Consequence to accept deliberately: an authored `$reviewer` where `reviewer` is a collided agent
but **not** a declared argument is no longer rewritten (today it becomes `$myskill:reviewer`).
`$name` reads as a variable reference, not an agent name, so leaving it literal is the better
reading. Covered by a test so the choice is pinned rather than incidental.

### 2.2 Resulting stage order (6 stages, was 7)

| # | Stage | Change |
| --- | --- | --- |
| 1 | Agent-name rewrite (A.3.4), on the authored body | moved from 5, plus the §2.1 regex fix |
| 2 | Base-dir preamble | was 1 |
| 3 | Argument substitution (A.3.2) | was 2 |
| 4 | Variable substitution (A.8) | was 3 |
| 5 | Shell injection (A.3.5) | was 6 |
| 6 | CC tool-name steering note | was 7 |

Old stage 4 is removed.

**The single-pass invariant, stated precisely.** It is *not* true that no stage re-scans text an
earlier stage produced — variable substitution and shell injection both do, by design. The
correct invariant after this change: **no stage reinterprets introduced text as a
skill-authored *reference*** — neither as a path nor as an agent name. The two deliberate
exceptions remain and stay documented: shell injection sees substituted arguments (CC parity,
per the A.3.5 security note, including the rule-8 append), and variable substitution sees them
(§7).

### 2.3 Not in scope

- **Variable substitution re-scanning argument text.** `${PI_SESSION_ID}` in an argument value
  does substitute. Plausible CC parity, unprobed. Left alone; flagged in §7.
- **The command pipeline (A.7.1).** `commands/include.ts` already runs include inlining before
  argument substitution for exactly this reason and is unaffected. Only its doc comment changes.

## 3. Changelog classification

**This is not a user-facing breaking change.** Skill `@path` absolutization has never been
released: it appears only in the `[Unreleased]` "Added" entry of
`packages/coding-agent/CHANGELOG.md` (the whole `core/skills/` pipeline is unreleased; current
published version is 0.84.1, and no released section mentions it). The same is true of the
`absolutizeSkillPaths` package export.

Therefore: **amend the existing `[Unreleased]` "Added" entry** that claims "skill-relative
`@path` absolutization" rather than adding a `### Breaking Changes` entry for a feature no user
has ever had. Released-section immutability is not engaged; AGENTS.md only forbids editing
released version sections.

## 4. Work items

Ordered. Tests first within each behavioral item.

Each item is marked **RED** (fails before the change) or **PIN** (passes before and after;
guards against regression or corrects stale bookkeeping). Do not label a PIN as RED.

### W1 — Render-level tests: `@path` is never rewritten (RED)

`packages/coding-agent/test/skill-render.test.ts`. This is the existing home of the stage-4
tests and needs no session harness.

Replace `describe("renderSkillInvocation — @path absolutization (no inlining)")` (currently
lines 170-207, three tests asserting the removed behavior) with
`describe("renderSkillInvocation — @path references (never rewritten)")`:

1. Authored `@references/x.md` renders verbatim. **RED** (today: absolutized).
2. Argument-derived `@docs/handoff.md` via `$ARGUMENTS` renders verbatim. **RED**.
3. Argument-derived via `$0` renders verbatim. **RED**.
4. `@./relative.md` renders verbatim — the dot-relative form stage 4 also rewrote. **RED**.
5. Two tokens `@docs/a.md @docs/b.md` both render verbatim. **RED**.
6. Append-fallback path: body with no placeholder, raw args `@docs/handoff.md`, body ends with
   `ARGUMENTS: @docs/handoff.md`. **RED**.
7. Authored *and* argument-derived tokens in one body both stay literal. **RED**.
8. `@${PI_SKILL_DIR}/references/x.md` renders `@<dir>/references/x.md` — the supported opt-in
   and migration target. Note the `@` sigil survives, unlike stage 4 which dropped it. **PIN**
   (variable substitution already does this; the test documents the migration path).
9. `\@references/x.md` renders as literal `\@references/x.md`, backslash **retained**. **RED**
   (today the backslash is stripped).

   *Decision:* the `\@` escape existed only to opt out of stage 4. With stage 4 gone there is
   nothing to escape, and retaining the backslash keeps the skill body byte-faithful. **No CC
   evidence either way** — probe11 contains no `\@` case and the corpus README documents it
   only as absolutization evidence, so this is a deliberate Pi contract change, not a parity
   claim. `commands/include.ts` keeps its own `\@` unescaping (pinned by
   `test/suite/commands-loader-render.test.ts:148`); command includes still exist and still
   need the opt-out.

Update the file's header comment (lines 3-4), which names `@path absolutization`.

### W2 — Render-level tests: stage-5 provenance and placeholder protection (RED)

Same file, `describe("renderSkillInvocation — agent-name rewrite (A.3.4)")`. Rewrite map
`{ "code-reviewer": { qualified: "simplify:code-reviewer", collided: true } }` unless noted.

1. Argument text equal to a collided bare name is **not** rewritten: body `Use $ARGUMENTS here.`,
   raw args `code-reviewer` → `Use code-reviewer here.` **RED**.
2. A base directory containing a collided name is not corrupted: assert the preamble reads
   `Base directory for this skill: <dir>` exactly. **RED**.
3. §2.1 regression guard: a declared argument sharing a collided agent's name still substitutes.
   Map `{ reviewer: … }`, `arguments: [reviewer]`, body `Target: $reviewer.`, raw args `hello`
   → `Target: hello.` **PIN** (passes today; would fail on a naive stage move — this is the
   test that catches the blocker the review found).
4. §2.1 regression guard: `$ARGUMENTS` survives a collided agent named `arguments`. **PIN**.
5. §2.1 accepted consequence: an authored `$reviewer` with `reviewer` collided but undeclared
   stays literal. **RED** (today: `$simplify:reviewer`). Pins the deliberate choice.
6. Existing tests in the block (authored names rewritten including inside code blocks;
   case-insensitivity; qualified-form guard) must keep passing **unchanged**. **PIN**.

In `describe("renderSkillInvocation — stage order and single pass")`, add: variable values are
not scanned for agent names (body `dir=${PI_SKILL_DIR}` with a baseDir containing
`code-reviewer`). **RED**.

### W3 — End-to-end regression through the session harness (RED)

`packages/coding-agent/test/suite/regressions/6-skill-at-path-argument-rewrite.test.ts`.

AGENTS.md requires issue regressions under `test/suite/regressions/` **and** requires
`test/suite/` tests to use `test/suite/harness.ts` + the faux provider. Both apply, so this test
uses `createHarness`. It pins the symptom the issue actually reported — the *delivered* user
message — rather than a function return value, which the W1 tests already cover.

Shape: create a skill whose body is `**Input**: $ARGUMENTS`, invoke `/name @docs/handoff.md`,
and assert the delivered message text contains `**Input**: @docs/handoff.md` and does **not**
contain the skill's baseDir. Use `getUserTexts(harness)`; follow
`test/suite/skill-render-parity.test.ts` for skill setup via `createTestResourceLoader`. **RED**.

### W4 — Corpus bookkeeping and a full-pipeline pin (PIN, not RED)

`packages/coding-agent/test/skill-arguments.test.ts`.

Probe11 is quarantined at line 249 with a comment claiming it "pins the stage-4 `@path`
absolutization deviation (issue #6)". **Verified false.** Its fixture writes
`authored=[@notes/local.md]`; the `[` immediately before `@` fails the `atTokenStart` test
(start-of-line or whitespace, `render.ts:174`), so recognition never fires. Probe11 passes
byte-for-byte today **with stage 4 active**, through both the corpus loop and a full-pipeline
comparison. The quarantine is inert and always was.

Consequently **W4 provides no red signal and must not be presented as one.** The red/green proof
for stage-4 removal is W1; for stage-5 it is W2; for the reported symptom it is W3.

Two changes, both bookkeeping:

1. Delete `CORPUS_EXCLUDED_PROBES` and its `continue` guard, restoring probe11 to the
   byte-equality loop. All 12 probes then run. The stale comment goes with it.
2. Add a full-pipeline test that renders probe11 through `renderSkillInvocation` and compares
   against the fixture. This is the coverage whose absence let the quarantine be inert
   unnoticed — the corpus loop only exercises `substituteSkillArguments`. Because
   `renderSkillInvocation` trims the raw body and prepends the preamble, compare against
   `"Base directory for this skill: " + dir + "\n\n" + expected.trimEnd()`; verified this
   expression is exactly equal at `5ee18865d`. State in a comment that it is a PIN.

   Do **not** edit the fixture: `fixtures/cc-argument-grammar/README.md` records the capture
   method and re-capture procedure for captured CC ground truth.

   Do **not** claim a new CC probe. Capturing one requires a live Claude Code session, which
   this change cannot do; W1 covers the same ground as a Pi renderer contract.

### W5 — Implementation (GREEN)

`packages/coding-agent/src/core/skills/render.ts`:

- Delete `absolutizeSkillPaths`, `absolutizeSkillPathsInLine`, and `isAbsolutePathToken`.
- Drop the now-unused `resolve` import from `node:path` and `scanFenceBlocks` from `./fences.ts`
  (verify: `renderSkillInvocation` does not scan fences itself; shell injection has its own).
- Change the `rewriteAgentNames` lookbehind to `(?<![A-Za-z0-9_:$-])` per §2.1.
- In `renderSkillInvocation`: apply `rewriteAgentNames` to `rawBody` before building the
  preamble; remove the old stage-4 and stage-5 calls.
- Rewrite the module header stage list to the six-stage order.
- Update the `rewriteAgentNames` doc comment: authored body only, before the preamble and before
  argument substitution; `$`-prefixed tokens are placeholders and are never rewritten.

`packages/coding-agent/src/index.ts:294`: remove the `absolutizeSkillPaths` export.

`packages/coding-agent/src/core/commands/include.ts:8`: the comment points at
`skills/render.ts:absolutizeSkillPathsInLine`, which will not exist. Restate the recognition
grammar self-containedly (the module implements it independently; the reference is documentary).

### W6 — Documentation

- `packages/coding-agent/docs/skills.md:95-103`: rewrite the pipeline list to six stages. Note
  that skills never inline files and a skill-local reference is written
  `@${PI_SKILL_DIR}/notes.md`.
- `docs/skills-capability-matrix.md:38`: the `@path` row claims parity it does not have. Change
  the Pi cell to "Not inlined and never rewritten; `${PI_SKILL_DIR}` makes them absolute" — the
  row becomes genuine parity. Fix the stale `core/skills/render.ts:92` anchor (line 92 is now a
  different stage) and re-verify the other `render.ts` anchors in the file.
- `docs/plans/pi-skill-system-plan.md` — Appendix A is frozen normative text, so use the dated
  amendment convention A.3.2 already established, not silent edits:
  - **A.3.2 "Cross-stage reinterpretation" (lines 537-546) — mandatory, and missed by v1 of this
    plan.** It currently states that agent-name rewrite and shell injection "deliberately process
    the whole rendered body and so reach substituted argument text by design", and records the
    `@path` stage as a "**Known violation**" tracked at issue #6. After this change both claims
    are wrong: the rewrite no longer reaches argument text, and the `@path` stage no longer
    exists. Amend to leave shell injection as the sole deliberate exception (plus variable
    substitution per §7) and remove the known-violation note as resolved.
  - A.3.1 (line ~435): replace the stage list with the six-stage order.
  - A.3.1 also states "There is **no `@file` inlining for skills**: substitution makes
    `@`-referenced paths absolute and the model reads them" (~line 865 region). Correct it:
    substitution makes `${PI_SKILL_DIR}` absolute; `@` tokens are never rewritten.
  - A.3.4 (line ~652): record the new stage position, the authored-body-only scope, and the
    `$`-prefix exclusion.
- `packages/coding-agent/CHANGELOG.md`, `[Unreleased]`:
  - Amend the "Added the deterministic skill render pipeline contract" entry: drop
    "skill-relative `@path` absolutization" and state the six-stage order.
  - Add a `### Changed` entry (not Breaking — §3): skill bodies never rewrite `@path` tokens,
    use `@${PI_SKILL_DIR}/…`; the `\@` escape is gone for skills (retained for command
    includes); `absolutizeSkillPaths` is no longer exported; the agent-name rewrite applies to
    authored body text only and skips `$`-prefixed tokens.
  - Read the whole `[Unreleased]` section first and append to the existing `### Changed`
    subsection; do not create a duplicate.

### W7 — Verification

1. From `packages/coding-agent`:
   `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/skill-render.test.ts test/skill-arguments.test.ts test/suite/regressions/6-skill-at-path-argument-rewrite.test.ts`
2. Grep for stragglers: `absolutizeSkillPaths`, `@path absolutization`, `CORPUS_EXCLUDED_PROBES`.
   `dist/` hits are build output and are ignored.
3. Blast radius (swept at plan time, re-check after): the only test files referencing
   `@references`/`@docs/`/`absolutiz` are `skill-render.test.ts`, `skill-arguments.test.ts`, the
   corpus fixtures, and `commands-loader-render.test.ts` (commands includes — unaffected). No
   test asserts a stage count.
4. No shipped skill regresses: 0 bare `@relative` tokens across `.pi/skills` and
   `~/.pi/agent/skills`; the only `@`-with-slash hits anywhere are npm scoped package names
   inside code fences.
5. `./test.sh` from the repo root for the non-e2e suite — the renderer feeds delivery, dedup,
   and carry-forward tests that assert rendered bodies.
6. `npm run check` (full output, no tail). Fix all errors, warnings, and infos.

### W8 — Commit

Single commit, explicit paths only (`git add <path>…`, never `-A` / `.`). Run `git status`
first and stage only the files in §5.

```
fix(coding-agent): stop rewriting @path tokens in skill bodies

closes #6
```

Body: the argument-provenance bug, the stage removal, the stage-5 move plus its `$`-prefix
guard, and the `@${PI_SKILL_DIR}` migration.

`closes #6` auto-closes only on the repository a PR targets. Issue #6 is on `pfurini/pi`
(`origin`); `upstream` is `earendil-works/pi`. Confirm the target before relying on the keyword.

## 5. Files touched

| File | Change |
| --- | --- |
| `src/core/skills/render.ts` | delete stage 4 + 3 functions; move agent rewrite to stage 1; `$` lookbehind fix |
| `src/index.ts` | remove `absolutizeSkillPaths` export |
| `src/core/commands/include.ts` | doc comment: remove dangling reference |
| `test/skill-render.test.ts` | rewrite `@path` block; extend agent-rewrite and stage-order blocks |
| `test/skill-arguments.test.ts` | un-quarantine probe11; add full-pipeline pin |
| `test/suite/regressions/6-skill-at-path-argument-rewrite.test.ts` | new, harness-based |
| `packages/coding-agent/docs/skills.md` | pipeline list; `${PI_SKILL_DIR}` guidance |
| `docs/skills-capability-matrix.md` | `@path` row; stale line anchors |
| `docs/plans/pi-skill-system-plan.md` | A.3.1, A.3.2, A.3.4 amendments |
| `packages/coding-agent/CHANGELOG.md` | amend Added; add Changed |

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| Stage move breaks `$name` / `$ARGUMENTS` placeholders | §2.1 `$` lookbehind fix; W2 cases 3-4 pin it |
| A skill relies on bare `@relative` | 0 occurrences in this repo's skill roots; unreleased feature, so no third-party skill can depend on it |
| Downstream imports `absolutizeSkillPaths` | Never released; not in any published `.d.ts` a consumer could have installed |
| Moving the agent rewrite changes behavior for authored names | W2 case 6 keeps the existing tests unchanged as the pin |
| Appendix A is frozen normative text | Dated-amendment convention, A.3.2 precedent; three sections to amend, not two |
| Mistaking a PIN for a RED test and shipping unproven work | Every W item is explicitly labeled; W4 is called out as PIN-only |

## 7. Follow-ups (not this change)

- Variable substitution re-scans argument text (`${PI_SESSION_ID}` in an argument value
  substitutes). Plausible CC parity, unprobed. Worth a probe capture before deciding.
- The `\@` skill escape is removed on Pi's own judgment with no CC evidence. A future corpus
  capture should include an authored `\@relative/path` case.
- Recognition grammar `atTokenStart` excludes `[`-prefixed tokens, which is why probe11 could
  not discriminate. Harmless for skills now, but `commands/include.ts` shares the rule and
  inherits the blind spot.

## 8. Adversarial review response (2026-08-22)

Reviewed by an independent agent on `openai-codex/gpt-5.6-sol`. Verdict: NOT READY. All six
findings were re-verified against the source before acceptance.

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | Moving the agent rewrite first corrupts `$name` / `$ARGUMENTS` placeholders | **Accepted, blocker.** Reproduced at `5ee18865d`. New §2.1 + W2 cases 3-5. |
| 2 | The probe11 full-pipeline test is already green, not RED | **Accepted.** W4 relabeled PIN; red/green responsibility moved to W1-W3. |
| 3 | Regression test in `test/suite/` must use the harness | **Accepted.** Split: render-level cases to `test/skill-render.test.ts` (W1-W2), harness-based end-to-end regression in `test/suite/regressions/` (W3). Stronger than v1 — it pins the delivered message. |
| 4 | A.3.2's "Cross-stage reinterpretation" paragraph contradicts the new semantics and was not in the doc list | **Accepted.** Verified at `pi-skill-system-plan.md:537-546`; now the first W6 doc item. |
| 5 | The `\@` "CC has no such escape" claim is unsupported by the corpus | **Accepted.** Reframed as a deliberate Pi contract change; follow-up logged in §7. |
| 6 | "No stage re-scans earlier output" overclaims | **Accepted.** §2.2 now states the narrow invariant with both exceptions named. |

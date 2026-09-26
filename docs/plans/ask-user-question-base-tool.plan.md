# ask_user_question as a fork-owned base tool

This plan turns `ask_user_question` from the ported rpiv-ask-user-question extension into a fork-owned base tool, registered by `AgentSession` next to `read`. A custom `ResourceLoader` or a loader's `extensionsOverride` can then no longer drop it, and no jiti load is involved. The tool stays available when no UI is attached. The source is the owner's request and rulings of 2026-09-26 (Section 2.1). A probe on 2026-09-26 built both commits, ran every affected suite, broke each new behavior once, and ran the built SDK with three loader kinds. The D11 question primitive follows as a later phase (Section 10).

## 1. Authority and workflow

| Source | Role |
| --- | --- |
| This plan | The implementation contract. |
| Owner request and rulings, 2026-09-26 | The source. Section 2.1 records every ruling, so no other document is needed. |
| `/Users/paolof/Developer/ai/_handoffs/2026-09-26-pi-session-control-consolidated.md` | Session-control design. Its D5, D11 and "work without clients" rule decide that no UI never hides the tool. Its line numbers are stale. |
| `/Users/paolof/.openintent/workspaces/pfurini/OpenIntent/worktrees/workflow-engine/openintent/changes/workflow-engine/design.md` | The workflow engine. Its D8 (workers, ask-operator tool) and D11 (gates) define what workers need later. Read only. |
| `docs/adr/ADR-0003-fork-first-merge-hygiene.md` | New code goes in new files; hot upstream files get thin call sites only. |
| `docs/adr/ADR-0009-built-in-extensions.md` | The built-in mechanism, the switch and the fork-owned kind. T3 amends it. |
| `docs/plans/built-in-extensions-phase1.plan.md` and `.results.md` | How rpiv-ask-user-question was ported; T2 undoes that port. |
| `docs/plans/tokensave-builtin.plan.md` and `.results.md` | The precedent for moving an extension into `src/core/fork-builtins/`, and for a cutover with other sessions running. |
| `docs/plans/ask-user-question-base-tool-evidence/` | Verified patches, probe and check scripts, suite runs (Appendix B). |
| `AGENTS.md` (repository) | Git, lockfile, key-binding, check and test rules. |

The `planning-changes` skill wrote this plan and runs its review passes. A fresh session implements it from the handoff prompt.

## 2. Decisions

### 2.1 User rulings

All rulings date from 2026-09-26.

| # | Ruling | Consequence |
| --- | --- | --- |
| R1 | Option 2: move the code into `packages/coding-agent` as a fork-owned module, registered as a base tool like `read`. | T1 creates `src/core/fork-builtins/ask-user-question/` and three call sites in `agent-session.ts`. |
| R2 | Keep the events. | The channels `rpiv:ask-user:prompt` and `rpiv:ask-user:blocked` and their payloads stay. They go to the resource loader's event bus, the bus `pi.events` used before. |
| R3 | Drop i18n. | The locales, the i18n bridge, the `rpiv-i18n` dynamic imports and their tests go. English literals stay. |
| R4 | Revised after review pass 2: no gate. The tool stays registered and active without a UI, because OpenIntent workers and future attached clients need it in sessions no screen watches yet. | The upstream reconciler goes and nothing replaces it. A call that finds no UI returns the existing `no_ui` result. |
| R5 | Stop upstream sync for this package. | `UPSTREAM.json` goes with the package. The rpiv-mono fork `personal` stays a reference for hand-porting fixes. |
| R6 | Move the questionnaire keys into Pi's app keybindings. | Six `app.askUserQuestion.*` ids join `KEYBINDINGS`; the `collapseKey` setting goes. `keybindings.ts` gets 2 added lines. |
| R7 | `PI_FORK_BUILTINS=off` removes the base tool too. | Upstream tests, which run with the switch off, see no new tool. |
| R8 | Port every test that still applies, with fork-owned copies of the helpers. | 33 module test files (653 tests) and an 8-test session suite join coding-agent's tests. Tests of removed behavior go (Section 2.3). |
| R9 | Approve the lockfile commit that removes the package's two entries. | T2 commits `package-lock.json` with `PI_ALLOW_LOCKFILE_CHANGE=1`. |
| R10 | Worker readiness is the next plan, not this one: the D11 question primitive, designed with the engine amendment that retires ask-operator. | This plan adds no question mode, answer channel or QuestionService. It keeps the question types, validation and dialog walker in their own files (Section 10). |

**Planner defaults.** Each is reversible; the reason stands next to it.

| Item | Default | Reason |
| --- | --- | --- |
| Module path | `packages/coding-agent/src/core/fork-builtins/ask-user-question/`, tests under `test/fork-builtins/ask-user-question/` | Matches `tokensave` and `vcc-recall`. |
| Settings key | `forkBuiltins["ask-user-question"]` in the session agent directory's `settings.json`; only `guidance` remains | The live `~/.pi/agent/settings.json` has no entry for the old key `rpiv-ask-user-question` (Section 3), so nothing migrates. |
| Keybinding ids and defaults | `collapse` `ctrl+]`, `setAside` `a`, `nextTab` `tab`+`right`, `previousTab` `shift+tab`+`left`, `notes` `n`, `toggle` `space` | The upstream defaults. An empty binding disables the action and drops its hint. |
| Set-aside key when collapse is `a` | No automatic swap to `ctrl+a`; the user rebinds `app.askUserQuestion.setAside` | Upstream swapped silently. A rebindable id makes the swap explicit. |
| Registration under `baseToolsOverride` | Registered but not active, like `skill` | Allow, exclude and active rules can still select it. |
| Existing tool of the same name | Registration skips a caller's base tool; an extension's tool overrides the base tool | A caller's or an extension's tool keeps its behavior; the `AskUserQuestion` redirect test depends on it (Appendix A). |
| A call without a UI | Returns the existing `no_ui` result, which tells the model the user saw no question | The handoff's D11 rules that a session-tier question nobody can answer fails. No new policy, such as proceeding on assumptions, is added before D11. |
| Ported-package mechanism | Kept, with `FORK_BUILTIN_PACKAGES` empty and the workspace glob in place | Future ports use it; removing it would touch six upstream-owned files. |
| Keybinding documentation | The module README, not `packages/coding-agent/docs/keybindings.md` | The docs file is upstream-owned (ADR-0003). |
| Load flakes | Every test in `agent-session-concurrent.test.ts`, and the footer test "updates the cached branch when the reftable directory changes", join the known flakes (Section 5). The footer test "debounces rapid reftable updates into a single async refresh" does not. | The first two fail on the unchanged baseline under deliberate load (Appendix A). The debounce test failed once in 12 T2 runs and never in 30 loaded baseline runs, so a failure of it stops the implementer. |
| Verified code | The evidence patches, replayed with `git am` and `git apply` | The patches hold 17,344 lines; Appendix B gives their hashes. |

### 2.3 Differences from the source

| Source item | This plan | Reason |
| --- | --- | --- |
| "A few lines" in `agent-session.ts` | 11 added lines in three hunks | One import block, the registration call and the default-active entry. Appendix B shows the diff. |
| "SDK callers that pass `tools` lose it, as they lose `read`" | It stays registered but inactive | The `skill` precedent; a caller can activate it by name. |
| The upstream reconciler hid the tool without a UI | No hiding at all (R4) | The handoff rules that work continues with no client attached, and any client may answer later. |
| Upstream error paths `session_load_failed` and `stale_module_cache` | Removed, with the lazy load and the 2 s prewarm timer | Both guard jiti's module cache (upstream issue #107). A static import cannot hit it. |
| Removed test files | `locales`, `ship-manifest`, `ask-user-question.session-load`, `state/i18n-bridge.shim`, `reconcile`, and the French-locale case in `preview-pane.test.ts` | Each tests removed behavior. `base-tool.test.ts` and the session suite replace `reconcile`. |
| `fork-builtins.test.ts` | 5 rpiv tests removed, 1 test added | Registration and settings of the package moved to the module's tests. `removed-t2.txt` lists the 5. |
| Handoff item 11.1: the question protocol starts from this package | This plan moves the package and leaves the protocol to the D11 plan (R10) | One plan per deliverable outcome; D11 needs the engine amendment as its co-consumer. |

### 2.4 Approvals

Standing approval: worktree creation, install, `npm run build:offline`, `npm run check`, `./test.sh` and single test files inside `/tmp` worktrees; commits on the feature branch in `/tmp/ask-user-question-base-tool`, including T2's lockfile commit (R9).

These actions always need the owner's explicit yes:
- any file removal, install, build or commit in the main checkout;
- each fast-forward of `personal` (T5 and T6);
- the live check in T5;
- the rollback in T5;
- removing any worktree or deleting any branch.

## 3. Verified facts

The probe ran on 2026-09-26 against `personal` at `92294f2296f6dfc8a8d0b2452eabc6667e2b99da`. It used `/tmp/ask-user-question-base-tool-probe` (the change) and `/tmp/ask-user-question-base-tool-baseline` (clean), both built with `npm run build:offline`. Test runs used `failing-tests.mjs`, one run at a time, under `./test.sh` isolation. Line numbers refer to the start commit.

| Fact | Evidence |
| --- | --- |
| Base tools get the same runner `ctx` as extension tools, with `ui`, `hasUI` and `mode`. | `extensions/wrapper.ts:17-19`; `agent-session.ts:5547-5555` wraps base definitions with the runner. |
| The session reaches the loader's event bus. | `agent-session.ts:790` `this._resourceLoader.getEventBus?.()`; extensions' `pi.events` uses that bus (`extensions/loader.ts:451-454`, `resource-loader.ts:944`). |
| The `skill` and `slash_command` base tools register at the call site the plan reuses. | `agent-session.ts:5619-5626`; default-active list `:5652-5661`. |
| An extension tool overrides a base definition of the same name. | `agent-session.ts:5525-5530` sets extension entries after base entries. |
| An `extensionsOverride` that removes every extension drops the tool today, and not after T2. | `sdk-probe.mjs <dist> override`: baseline `none`, T2 `<builtin:ask_user_question>` (Appendix A). |
| RPC mode binds a UI context, so a worker under `runRpcMode()` always has one. | `modes/rpc/rpc-mode.ts:329-330` passes `createExtensionUIContext()` to `bindExtensions`. |
| Today's OpenIntent workers have no ask-operator tool; engine D8 plans one. | Engine `design.md` D8 last bullet describes it; `packages/workflow/src/pi` in the workflow worktree has no match for `ask-operator` or `askOperator`. |
| A worker whose tool policy leaves this tool active fails its connection with `human-question` when the model calls it. The rpiv built-in behaves the same today, so this plan changes nothing for workers. | Under RPC the tool takes its dialog path (`hasUI` true, `mode` `rpc`); OpenIntent `packages/workflow/src/pi/transport/rpc-child.ts:442-450` fails the connection on any dialog method. `worker-policy-extension.ts:156-168` leaves every tool active when the policy declares no allowlist. |
| `git revert --no-edit <A>^..<C>` reverts C, B, A in that order, and runs no pre-commit hook. | Scratch repository with three commits and a logging hook: log `Revert "c1"`, `Revert "c2"`, `Revert "c3"` (newest last), hook log empty. |
| The package is 5,693 lines of non-test source and 37 test files, none of which run today. | `find ... ! -name '*.test.ts' | xargs wc -l`; the `test` script was removed in `4203ab182`. |
| Nothing outside the package listens to its events or reads its settings. | `grep -rln "rpiv:ask-user"` across `pi`, `pi-subagents`, `pi-fence`, `openintent` finds docs and one test comment only. `~/.pi/agent/settings.json` `forkBuiltins` holds only `pi-tokensave`. |
| `~/.pi/agent/keybindings.json` does not exist. | `test -f` false on 2026-09-26. No user binding collides with the new ids. |
| The planning runner is untracked in the main checkout. | `git ls-files --error-unmatch .pi/skills/planning-changes/scripts/failing-tests.mjs` exits 1; the evidence directory holds a byte-identical copy. |
| Fresh worktrees need the ignored model data to build and check. | Without `packages/ai/src/providers/data/`, `build:offline` fails in `check:model-data`, and `tsgo` types model ids as `never`. |
| Biome ignores `docs/`, so the evidence scripts pass the commit hook unchanged. | `npx biome check docs/plans/ask-user-question-base-tool-evidence/` reports the path as ignored. |
| Upstream changed the package once in the last month. | rpiv-mono `origin/main` at 2026-09-21: 1 package-specific commit since 2026-08-26. |
| The static import adds no measurable import cost. | `import(dist/index.js)`, six runs each: baseline 222-235 ms, probe 227-240 ms. |

## 4. Scope

**In scope.**
- The fork-owned module, its call sites, keybindings and tests (T1).
- Removal of the ported package and its lockfile entries (T2).
- The module README, the ADR-0009 amendment and the port-extension skill examples (T3).
- Built-output validation (T4), cutover (T5) and results (T6).

**Out of scope.** The D11 question primitive, question modes, any answer channel for headless hosts, and the engine amendment (Section 10). Porting rpiv-mono changes after `8403bb09`. Moving tokensave or vcc_recall out of the loader. Changes in pi-subagents, pi-fence or OpenIntent. The experimental `packages/server`, `packages/client` and `packages/protocol`, which the handoff rejects as a base.

**Binding constraints.**

| Constraint | Exception in this plan |
| --- | --- |
| Upstream-owned files get only thin call sites (ADR-0003). | `agent-session.ts` (11 added lines) and `keybindings.ts` (2 added lines), as Appendix B shows. |
| No `package-lock.json` change without approval. | T2, approved by R9: exactly 20 removed lines, the two package entries. |
| Never touch paths this plan did not create. `/tmp/ask-user-question-upgrade-2026-09-21` belongs to another session. Do not edit either OpenIntent worktree. | None. |
| AGENTS.md git rules: explicit paths only; no `reset --hard`, `checkout .`, `clean`, `stash`, `add -A`, `--no-verify`. | None. |

## 5. Working setup

1. `git worktree add -b feat/ask-user-question-base-tool /tmp/ask-user-question-base-tool personal`. Record `BASE=$(git -C /tmp/ask-user-question-base-tool rev-parse HEAD)`.
2. `cp -R /Users/paolof/Developer/ai/pi/packages/ai/src/providers/data /tmp/ask-user-question-base-tool/packages/ai/src/providers/data`, then `diff -r` of the two directories prints nothing.
3. `npm install --ignore-scripts` and `npm run build:offline` in the worktree; both exit 0; `git status --short` prints nothing.
4. `mkdir /tmp/aubt-impl`, which must succeed: when the directory already exists, stop and ask, because another session may own it. From the worktree root, with `E=docs/plans/ask-user-question-base-tool-evidence` (committed at T0), run coding-agent three times: `node $E/failing-tests.mjs run /tmp/ask-user-question-base-tool packages/coding-agent /tmp/aubt-impl/base-<n>.json`, n = 1 to 3. Run `./test.sh > /tmp/aubt-impl/base-testsh.log 2>&1` once.
5. When `BASE` differs from `92294f229`, compare the baseline with Appendix A before T1. A new baseline failure is a precondition to report, not a regression.

**Regression rule.** Commands run from the worktree root, with `E=docs/plans/ask-user-question-base-tool-evidence` and `S=$E/failing-tests.mjs`.
1. After each code task, run coding-agent once to `/tmp/aubt-impl/<task>-1.json`. `node $S diff /tmp/aubt-impl/base-1.json <candidate>` must report no new failure.
2. `node $E/test-identities.mjs /tmp/aubt-impl/base-1.json <candidate> [$E/removed-t2.txt]` must exit 0: every baseline-passing test still passes, except the tests the list names. Pass the list from T2 on.
3. When rule 1 or 2 fails, run the candidate twice more, to `<task>-2.json` and `<task>-3.json`. A failure is tolerated only in one of two cases, and then rules 1 and 2 are evaluated on a candidate run without that failure, which must exist:
   - base-2 or base-3 also shows it, and the candidate fails it no more often than the baseline did;
   - it is a known flake below, its file passes alone three times in a row, and at least one of the three candidate runs passes rules 1 and 2.
   Otherwise, stop and ask.
4. Run `./test.sh > /tmp/aubt-impl/<task>-testsh.log 2>&1` once. With `other() { grep -E 'Tests +[0-9]' "$1" | grep -v ' 50 skipped'; }`, `diff <(other /tmp/aubt-impl/base-testsh.log) <(other /tmp/aubt-impl/<task>-testsh.log)` prints nothing, and `grep -cE '(^| )FAIL |not ok' /tmp/aubt-impl/<task>-testsh.log` prints the same number as `grep -cE '(^| )FAIL |not ok' /tmp/aubt-impl/base-testsh.log`. Any difference outside coding-agent means stop and ask; there is no tolerance rule for it.

Known flakes, with their evidence:

| Test | Evidence |
| --- | --- |
| Every test in `agent-session-concurrent.test.ts` | Sequential baseline: "should throw when prompt() called while streaming" failed in 1 of 6 runs. Under deliberate load the unchanged baseline also failed "should allow steer() while streaming" (Appendix A). |
| `footer-data-provider.test.ts` "updates the cached branch when the reftable directory changes" | `tokensave-builtin.results.md` records it as a known flake. Under deliberate load the unchanged baseline failed it in 1 of 2 parallel suite runs and in 2 of 30 looped file runs (Appendix A). |

The footer test "debounces rapid reftable updates into a single async refresh" is not a known flake: it failed in 1 of 12 T2 runs and never in 30 loaded baseline runs. Its likely cause is a late real watcher event under load, but that is unproven, so a failure of it stops the implementer. `test-identities.mjs` reports a flake as failing in a run where it flakes; rule 3 applies.

Environment facts: the pre-commit hook runs `npm run check`; it blocks lockfile changes unless `PI_ALLOW_LOCKFILE_CHANGE=1`. Other Pi sessions run from the main checkout, so the main checkout stays read-only until T5.

## 6. Tasks

### T0. Record the plan

The handoff performs this task. Copy `docs/plans/ask-user-question-base-tool.plan.md` and the whole directory `docs/plans/ask-user-question-base-tool-evidence/` (8 files) from the main checkout into the worktree. Each copy's SHA-256 equals its source's; the evidence hashes also equal Appendix B. Stage the two paths explicitly and commit `docs: ask_user_question base tool plan`.

### T1. ask_user_question becomes a fork-owned base tool

**Changes.** `git am docs/plans/ask-user-question-base-tool-evidence/T1.patch` in the worktree. It creates 41 source files and 35 test files, and edits `agent-session.ts`, `keybindings.ts` and `fork-builtins.ts`.

| Area | Content |
| --- | --- |
| `base-tool.ts` | `addAskUserQuestionBaseTool` and `askUserQuestionDefaultActive` (Section 2.1 defaults). No gate. |
| `ask-user-question.ts` | `createAskUserQuestionToolDefinition({ agentDir, eventBus, getExternalEditorCommand })`; static imports; events on the bus; the `no_ui` result without a UI; no lazy load. |
| `keybindings.ts` (module) | The six ids, their defaults, and `questionnaireKeyTexts` for hints. |
| `config.ts` | Guidance from `forkBuiltins["ask-user-question"]`; no `collapseKey`. |
| `tool/types.ts`, `tool/validate-questionnaire.ts`, `rpc-fallback.ts` | The question types, their validation and the dialog walker, each in its own file for D11 to extend. |
| Views and router | Every questionnaire key goes through `kb.matches`; hints show the bound key; parameter properties become fields (erasable TypeScript). |
| `fork-builtins.ts` | `forkBuiltinsEnabled()`; header text. The package list is unchanged here. |
| Tests | `test-helpers.ts`, `base-tool.test.ts` (3 tests), `config.test.ts`, `test/suite/fork-ask-user-question-base-tool.test.ts` (8 tests), and the ported files. |

When `git am` fails because `BASE` moved, run `git am --abort`, then `git am -3` with the same patch. Stop and ask on any conflict, in any file.

**Validation.**
- `npm run check` exits 0.
- From `packages/coding-agent`: `node ../../node_modules/vitest/dist/cli.js --run test/fork-builtins/ask-user-question/ test/suite/fork-ask-user-question-base-tool.test.ts test/fork-builtins.test.ts test/suite/skill-c1-acceptance.test.ts` reports 0 failed.
- Regression rule, without a removed list: 3,951 + 661 = 4,612 tests at `BASE` `92294f229`.
- After `npm run build:offline`, `node $E/sdk-probe.mjs packages/coding-agent/dist default "<inline:@juicesharp/rpiv-ask-user-question>"` exits 0: the old extension still wins while the package exists.

**Commit.** `feat(coding-agent): ask_user_question as a fork-owned base tool`, produced by `git am`.

### T2. Remove the ported package

**Changes.**
1. `git rm -rq packages/builtins/rpiv-ask-user-question`.
2. Remove the workspace link only when it is the expected symlink: `L=node_modules/@juicesharp/rpiv-ask-user-question; test -L "$L" && [ "$(readlink "$L")" = "../../packages/builtins/rpiv-ask-user-question" ] && rm "$L"`. Stop when the test fails.
3. `git apply --index docs/plans/ask-user-question-base-tool-evidence/T2-files.patch`. It empties `FORK_BUILTIN_PACKAGES` and replaces the rpiv tests in `fork-builtins.test.ts`.
4. `npm install --package-lock-only --ignore-scripts`.

**Validation.**
- `git diff --numstat -- package-lock.json` prints `0	20`; `git diff -U0 -- package-lock.json | grep -c '^+[^+]'` prints `0`; `git diff -- package-lock.json | grep '^-[^-]' | grep -c rpiv-ask-user-question` prints `4`.
- `test ! -e packages/builtins/rpiv-ask-user-question`, and `git grep -n rpiv-ask-user-question -- package.json packages/coding-agent/src/core/fork-builtins.ts packages/coding-agent/test/fork-builtins.test.ts` exits 1.
- `npm run check` exits 0.
- Regression rule with `$E/removed-t2.txt`: 4,608 tests (T1 minus 4).

**Commit.** `feat(coding-agent): remove the ported rpiv-ask-user-question package`. Stage `package-lock.json`, `packages/coding-agent/src/core/fork-builtins.ts` and `packages/coding-agent/test/fork-builtins.test.ts` explicitly (the deletions are already staged), and commit with `PI_ALLOW_LOCKFILE_CHANGE=1` (R9).

### T3. Document the base tool

**Changes.**

| File | Required content |
| --- | --- |
| `packages/coding-agent/src/core/fork-builtins/ask-user-question/README.md` (new) | An opening paragraph of at most 100 words. Sections: origin and licence (rpiv-ask-user-question 2.11.0, fork `pfurini/rpiv-mono` `personal` at `8403bb09`); registration as a base tool and what removes it (`PI_FORK_BUILTINS=off`, allow and exclude lists, a caller's or extension's tool of the same name); behavior without a UI (the tool stays active, and a call returns `no_ui`); OpenIntent workers (under RPC a call takes the dialog path, which today's worker transport refuses with `human-question`, so an unattended worker excludes the tool through its allowlist until D11); a table of the six `app.askUserQuestion.*` ids with defaults, and how to rebind or disable one in `keybindings.json`; the `guidance` setting under `forkBuiltins["ask-user-question"]`, naming its three fields (`description` and `promptSnippet`, each a non-empty string; `promptGuidelines`, a non-empty array of non-empty strings), stating that a missing or invalid field keeps the built-in default, with a `settings.json` example; the two event channels and their payload fields; the RPC dialog fallback; hand-porting upstream fixes; the D11 follow-on (Section 10). |
| `docs/adr/ADR-0009-built-in-extensions.md` | "Fork-owned built-ins": add `ask_user_question`, a fork-owned base tool that `AgentSession` registers, not an inline factory. "Loading": the package list is empty; the mechanism stays for future ports. "Control": state that the base tool follows the same allowlist rule, and that under a caller's `baseToolsOverride` it stays registered but inactive, like `skill`. The sentence "A fork-owned built-in adds no upstream-owned line" gains the exception: the base tool adds 11 lines to `agent-session.ts` and 2 to `keybindings.ts`. Append "A 2026-09-26 amendment" to "Amendment evidence", with rows for the custom-loader and `extensionsOverride` registration, the switch, the ownership check, availability without a UI including the model-visible tool list, and the footprint (11 + 2 lines), each citing Appendix A of this plan. |
| `.pi/skills/port-extension/SKILL.md` | Line 49: the RPC fallback example cites `packages/coding-agent/src/core/fork-builtins/ask-user-question/rpc-fallback.ts`. Line 107: the pattern test becomes "registers the TokenSave tools and commands as a fork-owned built-in", because T2 removes the rpiv test. Lines 8 and 36 stay: they name a historical plan and a real rpiv-mono path. |

**Validation.**
- `npm run check` exits 0.
- With `R=packages/coding-agent/src/core/fork-builtins/ask-user-question/README.md`, each pair of id and default appears on one line: `grep -F 'app.askUserQuestion.<name>' $R | grep -cF '<default>'` is at least 1 for `collapse` `ctrl+]`, `setAside` `a`, `nextTab` `tab`, `previousTab` `shift+tab`, `notes` `n`, `toggle` `space`.
- `grep -cF <term> $R` is at least 1 for each of `rpiv:ask-user:prompt`, `rpiv:ask-user:blocked`, `hasPreview`, `setAside`, `active`, `no_ui`, `human-question`, `D11`, `PI_FORK_BUILTINS`, `forkBuiltins`, `description`, `promptSnippet`, `promptGuidelines`, `keybindings.json` and `8403bb09`.
- `grep -c "ask_user_question" docs/adr/ADR-0009-built-in-extensions.md` is at least 3; `grep -n "2026-09-26 amendment" docs/adr/ADR-0009-built-in-extensions.md` finds the new section; `grep -c baseToolsOverride docs/adr/ADR-0009-built-in-extensions.md` is at least 1; and `grep -n "adds no upstream-owned line" docs/adr/ADR-0009-built-in-extensions.md` prints only lines that also name the exception (`agent-session.ts`).
- `grep -c 'registers the tools of rpiv-ask-user-question' .pi/skills/port-extension/SKILL.md` prints `0`, and `grep -c 'fork-builtins/ask-user-question/rpc-fallback.ts' .pi/skills/port-extension/SKILL.md` prints `1`.

**Commit.** `docs: ADR-0009 and README for the ask_user_question base tool`, with explicit paths.

### T4. Validate the built outputs

**Changes.** None committed. `git worktree add --detach /tmp/ask-user-question-base-tool-validate <T3 commit>`, copy the model data as in Section 5, `npm install --ignore-scripts`, `npm run build:offline`. Let `D=/tmp/ask-user-question-base-tool-validate/packages/coding-agent/dist`.

**Validation.** Each command exits 0. `sdk-probe.mjs` passes only when the source matches, a present tool is active and an absent one inactive, and the loader reported no error; it exits 1 otherwise and removes its temporary directories. The custom and override sessions have no UI, so these runs also show that nothing hides the tool:
- `node $E/sdk-probe.mjs $D custom "<builtin:ask_user_question>"`
- `node $E/sdk-probe.mjs $D default "<builtin:ask_user_question>"`
- `node $E/sdk-probe.mjs $D override "<builtin:ask_user_question>"`
- `PI_FORK_BUILTINS=off node $E/sdk-probe.mjs $D custom none`
- `git -C /tmp/ask-user-question-base-tool-validate status --short` prints nothing.

### T5. Cut over the main checkout

Each step needs the owner's yes (Section 2.4). Let `M=/Users/paolof/Developer/ai/pi`.

0. Record `git -C $M status --short`, `git -C $M rev-parse HEAD`, and the running Pi processes (`pgrep -afl` with a pattern held in a script file, as in `tokensave-builtin.results.md`). Show the process list to the owner. The install and build replace `node_modules` and `dist` under those sessions; proceed only with the owner's yes.
1. This planning session left `docs/plans/ask-user-question-base-tool.plan.md` and `docs/plans/ask-user-question-base-tool-evidence/` untracked in `$M`, and T0 commits the same paths, so the fast-forward would refuse. For each of the 9 files, `cmp` the untracked copy with `git -C $M show feat/ask-user-question-base-tool:<path>`. When all 9 match, remove exactly those files and the empty directory. When any differs, stop and ask.
2. `git -C $M merge --ff-only feat/ask-user-question-base-tool`. It refuses when `personal` moved; then stop and ask.
3. `npm install --ignore-scripts` in `$M`. Pass: `git -C $M diff --quiet -- package-lock.json` exits 0, and `test ! -e $M/node_modules/@juicesharp/rpiv-ask-user-question`.
4. `npm run build:offline` in `$M` exits 0, and `node $M/$E/sdk-probe.mjs $M/packages/coding-agent/dist default "<builtin:ask_user_question>"` exits 0.
5. Live check (owner). Generate a marker `aubt-live-<8 random hex>`. The owner opens a new terminal and runs `cd /Users/paolof/Developer/ai/pi && pi --unfenced`, the interactive launch the tokensave cutover used. The owner types a prompt containing the marker that asks the model to put one question through `ask_user_question`, and answers it without cancelling. Pass: `node $M/$E/live-check.mjs <marker>` exits 0. The script needs an answered, non-cancelled result after the marked user message, and ignores this session's own transcript, where the marker appears only outside user messages.

**Rollback**, each step with the owner's yes, after T5 step 2 succeeded. The reverts are built and checked in the worktree, so no check runs in the shared checkout.
1. In `/tmp/ask-user-question-base-tool`: `git revert --no-edit <T1>^..<T3>`. It reverts T3, T2 and T1 in that order and runs no hook (Section 3); the T0 plan commit stays. Then `npm install --ignore-scripts`, `npm run check` and `npm run build:offline`; each exits 0.
2. `node $E/sdk-probe.mjs packages/coding-agent/dist default "<inline:@juicesharp/rpiv-ask-user-question>"` exits 0 in the worktree. The probe passed with this expectation on the baseline build (Appendix A).
3. In `$M`: `git -C $M diff --cached --quiet` exits 0, and `git -C $M status --short -- <every path T1 to T3 touched>` prints nothing. Otherwise stop and ask. Then `git -C $M merge --ff-only feat/ask-user-question-base-tool`, `npm install --ignore-scripts` and `npm run build:offline`.
4. `node $M/$E/sdk-probe.mjs $M/packages/coding-agent/dist default "<inline:@juicesharp/rpiv-ask-user-question>"` exits 0.

T6 then records the rollback; its fast-forward still applies, because the reverts sit on the feature branch.

Stop conditions: a session started before the cutover and then `/reload`ed reports the missing package in `getExtensions().errors`. That is expected (ADR-0009 "Failure"); tell the owner to restart such sessions.

### T6. Record the results

**Changes.** Write `docs/plans/ask-user-question-base-tool.results.md` with the sections `## Commits`, `## Tests`, `## Built outputs`, `## Cutover`, `## Deviations` and `## Open user actions`. Record the commits, the counts and identity results after T1 and T2, every tolerated flake with its runs, the T4 and T5 probe lines, the T5 marker and session file, and every deviation. `## Cutover` holds a table with one row per T5 step (0 to 5) and per rollback step run, each naming the owner's decision (approved or refused) and the outcome. After a rollback, it also records the trigger, the rollback probe output, and the final `personal` head and build result. The open user actions are:
- restart Pi sessions started before the cutover;
- start the D11 plan with the engine amendment (Section 10);
- decide whether to hand-port rpiv-mono changes after `8403bb09`;
- remove `/tmp/ask-user-question-base-tool` and the branch `feat/ask-user-question-base-tool` after this session exits.

Before the commit, with `F=docs/plans/ask-user-question-base-tool.results.md`: `grep -c '^## ' $F` prints `6`; `grep -cE '^\| T5 step [0-5] ' $F` prints `6`; `grep -cF` finds in `$F` each of the T1, T2 and T3 commit hashes (`git log --format=%h -4`), the T1 and T2 `numTotalTests` values of their run reports, and the T5 marker (or the word `rollback`).

Commit `docs: ask_user_question base tool results` on the feature branch. With the owner's yes, `git -C $M merge --ff-only feat/ask-user-question-base-tool` again; pass: `git -C $M log -1 --format=%s` prints that subject.

Remove the recorded worktrees and files, each only when its state matches:

| Path | Expected state before removal |
| --- | --- |
| `/tmp/ask-user-question-base-tool-validate` | `git status --short` empty |
| `/tmp/ask-user-question-base-tool-baseline` | `git status --short` empty |
| `/tmp/ask-user-question-base-tool-probe` | `git status --short` empty, detached at `0bc75dbc4` |
| `/tmp/ask-user-question-base-tool-replay` | `git -C <path> diff --cached 0bc75dbc4 -- . ':!package-lock.json'` prints nothing (T1 and T2 replayed, nothing else staged), and `git status --short | grep -v '^[DM] '` prints nothing |
| `/tmp/aubt-impl/` | Created by Section 5 step 4; holds only `base-*`, `T1-*`, `T2-*` run files and logs (`ls` shows no other name) |

For each worktree, also confirm `lsof -d cwd 2>/dev/null | grep -F <path>` prints nothing, and that `git -C <path> status --short --ignored --untracked-files=all | grep '^!!' | grep -vE '^!! (node_modules/|packages/[^/]+(/[^/]+)?/(dist|node_modules)/|packages/ai/src/providers/data/)'` prints nothing. That lists every ignored file, and each must lie under an install or build output this plan made. Then `git -C $M worktree remove --force <path>`. Stop on any other state.

## 7. Test plan

| Layer | What it proves | When it runs |
| --- | --- | --- |
| `test/fork-builtins/ask-user-question/**` (33 files, 653 tests) | The ported questionnaire, router, views, RPC fallback, events, guidance, keybindings and registration units. | Every `./test.sh`. |
| `test/suite/fork-ask-user-question-base-tool.test.ts` (8 tests) | A real session on a custom `ResourceLoader`: registration as builtin, the switch, allow and exclude lists, `baseToolsOverride`, availability without a UI in the tool list the model receives (the system messages' tool deltas) and the `no_ui` result, a deactivation that sticks, a same-named extension tool, events on the loader's bus. | Every `./test.sh`. |
| `test/fork-builtins.test.ts` | The loader no longer registers `ask_user_question`. | Every `./test.sh`. |
| `sdk-probe.mjs` | The built SDK gives the expected source and activity with a custom loader, a `DefaultResourceLoader`, and an `extensionsOverride` that removes every extension, and honors the switch. | T1, T4, T5, rollback. |
| `live-check.mjs` | A real session answered the questionnaire after the marked prompt. | T5, once. |

Each durable behavior failed under its mutation (Appendix A, M1 to M14), and every mutated file was restored byte for byte.

Footprint check, rerun after each upstream merge: `git diff --numstat <upstream-merge-base> -- packages/coding-agent/src/core/agent-session.ts packages/coding-agent/src/core/keybindings.ts` keeps the three `agent-session.ts` hunks and the two `keybindings.ts` lines of Appendix B.

**Not proved by this plan.** Rendering in RPC hosts (VS Code pendant, Zed); behavior in pi-subagents child sessions and OpenIntent workers beyond the documented `human-question` refusal; answering a question from a client attached later (D11); the model-visible tool list in a built SDK session (the probe checks activity, the suite checks the model-visible list at source level); the cause of the footer debounce failure; conflicts between the new ids and future upstream keybinding ids; any rpiv-mono change after `8403bb09`.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| An upstream merge conflicts in `agent-session.ts` near the `slash_command` block. | Three small hunks; the footprint check in Section 7 finds them. |
| Upstream adds its own `ask_user_question` or an `app.askUserQuestion.*` id. | The registration skips an existing base name, and an extension tool overrides it. A same-typed key id would not fail `tsgo`, so after each upstream merge `git grep -n 'app\.askUserQuestion' -- packages ':!packages/coding-agent/src/core/fork-builtins/ask-user-question' ':!packages/coding-agent/test'` must exit 1 (it does at `0bc75dbc4`). |
| A model in an unattended session with no UI spends a turn on a question nobody sees. | The `no_ui` result tells it the user saw nothing. Hosts that must avoid the turn exclude the tool through their tool allowlist; D11 replaces this path. |
| An OpenIntent worker with no tool allowlist calls the tool, and the worker transport fails the connection with `human-question`. | Unchanged from today, where the rpiv built-in behaves the same (Section 3). The README tells unattended workers to exclude the tool; the engine amendment (Section 10) replaces this path. |
| The install and build in the main checkout run under live sessions. | T5 step 0 lists them, and the owner decides. |
| Sessions started before the cutover lose the tool on `/reload`. | T5 stop condition; T6 open action. |
| A fix lands upstream after `8403bb09` and is missed. | T6 open action; the module README says where to look. |
| Upstream's jiti-cache guard (#107) protected against a real failure. | The static import cannot reach jiti; a failed import now fails Pi startup visibly instead. |

## 9. Done criteria

- T0 to T3 and T6 are committed on `feat/ask-user-question-base-tool`, and `personal` points at the T6 commit.
- The Regression rule held after T1 and T2, with the counts and identity results in the results file.
- T4's four probe commands and T5 steps 3 and 4 exited 0.
- `live-check.mjs` exited 0 for the T5 marker.
- `test ! -e packages/builtins/rpiv-ask-user-question` holds on `personal`.

## 10. Later phases

The later phases moved to the session-control handoff, which is their only authority: `/Users/paolof/Developer/ai/_handoffs/2026-09-26-pi-session-control-consolidated.md`. Its section 4.7 records this tool's state and seams. Its section 9 and ruling D15 define the D11 primitive and the engine amendment that retires ask-operator. Its sections 11.1 and 12.1 place D11 inside the Option 1 work and record the open delivery split.

This section held a two-row table until 2026-09-26. The table named only "this plan done" as the prerequisite of D11, which understated it: the wire part of D11 needs the Option 1 control service.

## Appendix A. Probe measurements

Suite runs are in `docs/plans/ask-user-question-base-tool-evidence/suite-runs.md`.

| Run | Tests | Failed |
| --- | --- | --- |
| base-1 to base-6 at `92294f229` | 3,951 each | 1 in base-2 (concurrent flake); 0 otherwise |
| drafts before pass 3 | 4,608 to 4,617 | Each finding led to a fix (Review history) |
| gate-free T1 `68ef2a376`, runs t1-3 to t1-6 | 4,612 | 0 in all four |
| gate-free T2 `cfa28fecb`, runs t2-3 to t2-8 | 4,608 | t2-3: footer cached-branch test; t2-5: footer debounce test; the other four: 0 |
| final T1 `00166b028`, run t1-7 | 4,612 | 0; diff no new failure; identities 0 missing and 0 failing |
| final T2 `0bc75dbc4`, run t2-9 | 4,608 | 0; diff no new failure; identities with `removed-t2.txt` 0 missing and 0 failing |

The final commits differ from the gate-free ones only in the suite test's model-visible assertion, so the gate-free runs count toward the flake evidence.

Deliberately loaded runs (`suite-runs.md`, second table):

| Load | Baseline result | T2 result |
| --- | --- | --- |
| Two suites in parallel, twice | Round 1: footer cached-branch test. Round 2: concurrent "should allow steer() while streaming" | Round 1: concurrent "should allow followUp() while streaming". Round 2: concurrent "should queue extension-origin steering messages while streaming" |
| Footer file looped 30 times on the baseline under a T2 or baseline suite | Cached-branch test failed 2 of 30; debounce test 0 of 30 | The background T2 suites failed only concurrent tests, 3 in 3 runs |

`./test.sh` exited 0 on the baseline and on the final T2. Every other workspace kept its baseline counts (972, 2,016, 349, 27, 159, 55, 133, 44, 15 and 105 tests). `npm run check` exited 0 at both final commits. `footer-data-provider.test.ts` passed alone 3 of 3 on gate-free T2.

The coding-agent count changed by +661 at T1 (653 module tests, 8 suite tests) and by -4 at T2 (5 rpiv tests removed, 1 added in `fork-builtins.test.ts`). `test-identities.mjs` reports fewer added identities than added tests, because some ported tests share a full name.

Mutation checks. M1 to M8 ran on gate-free T2, M9 and M10 on final T1, M11 to M14 before the rework; the files each one mutates are unchanged since it ran, apart from the suite test M9 and M10 were written for.

| # | Mutation | Failing tests |
| --- | --- | --- |
| M1 | Registration call made to throw | All 8 suite tests |
| M2 | Not active by default | 3 suite tests, including "stays active without a UI, and a call there fails with no_ui" |
| M3 | Hidden without a UI (default-active only when `hasUI`) | The same 3 suite tests |
| M4 | `no_ui` result removed | Suite "stays active without a UI"; 3 `ask-user-question.execute` tests |
| M5 | Switch ignored | Suite "is absent when PI_FORK_BUILTINS=off"; "registers nothing when PI_FORK_BUILTINS=off" |
| M6 | Registration overwrites a caller's tool | "never overwrites a caller's tool of the same name" |
| M7 | Events not emitted | Suite "emits the prompt event on the resource loader's event bus" |
| M8 | Base tool overrides a same-named extension tool | Suite "a same-named extension tool wins over the base tool" |
| M9 | The loadout drops the tool at request time (`_preparePromptAndToolLoadout`), registration and activity intact | Suite "stays active without a UI" and "a same-named extension tool wins" |
| M10 | Run preparation drops the tool from the selected tools (`run-preparation.ts`) | The same 2 suite tests |
| M11 | Keybindings not spread into `KEYBINDINGS` | 18 tests in `config.test.ts` and `factory.test.ts` |
| M12 | Notes key hardcoded to `n` | "follows rebound notes, toggle and tab keys" |
| M13 | Events not emitted, before the rework | 6 tests across the session suite and `ask-user-question.execute` |
| M14 | Collapse hint ignores rebinding | 2 listener tests |

Probe results (`sdk-probe.mjs`, which asserts source and activity; all exit 0 unless stated):

| Build | Loader | Switch | Output `source`, `active` |
| --- | --- | --- | --- |
| final T2 | custom (no UI) | unset | `<builtin:ask_user_question>`, true |
| final T2 | default | unset | `<builtin:ask_user_question>`, true |
| final T2 | override (no UI) | unset | `<builtin:ask_user_question>`, true |
| final T2 | custom | off | `none`, false |
| baseline | default | unset | `<inline:@juicesharp/rpiv-ask-user-question>`, true |
| baseline | override | unset | `none`, false |
| baseline | custom | unset | `none`, false |
| final T2 | custom, expecting `none` | unset | `<builtin:ask_user_question>`, exit 1 (mismatch detection) |

The probe ran with the relative path `packages/coding-agent/dist`, from the worktree root.

Other results:

| Check | Result |
| --- | --- |
| Lockfile at T2 | 20 removed lines, 0 added, 4 removed lines naming the package; `npm install --package-lock-only` regenerates it byte for byte |
| Replay | `T1.patch` applied with `git am` at `92294f229`, `T2-files.patch` with `git apply --index`; `git diff --cached 0bc75dbc4 -- . ':!package-lock.json'` prints 0 lines |
| `live-check.mjs` | Exit 1 with 0 files for an unused marker, although that marker appears in the planning session's transcript. Exit 0 for the user phrase "option 2 with events and without i18n", followed by 1 answered questionnaire (an earlier one is not counted). |
| `test-identities.mjs` | Exit 0 for final T1 and final T2; reports the concurrent flake for base-2; reports `missing 1 of 2` when one of two same-named tests in `9068-user-bash-fail-closed.test.ts` is dropped. |
| Other workspaces | The `Tests` lines of `./test.sh` outside coding-agent are identical for the baseline and final T2; neither log has a `FAIL` or `not ok` line. |
| Ignored files | `status --ignored --untracked-files=all` lists about 25,000 ignored files in the probe and baseline worktrees, all under `node_modules/`, a package `dist/` or `node_modules/`, or `packages/ai/src/providers/data/`; the replay worktree holds none. |
| SDK probe temporary directories | None left after the final runs. |

## Appendix B. Verified code

The evidence lives in `docs/plans/ask-user-question-base-tool-evidence/`:

| File | SHA-256 | Content |
| --- | --- | --- |
| `T1.patch` | `6582a2c4bf43eb4a204fb18fac020cb9e2c8ebd29a9c8958dc58de65faed0602` | `git format-patch` of `00166b028`, 17,214 lines. |
| `T2-files.patch` | `12d48695302c054fd43186ab77f0a43e6465ee90bd53a53c88a9f54507fac731` | `fork-builtins.ts` and `fork-builtins.test.ts` changes of `0bc75dbc4`, 130 lines. |
| `removed-t2.txt` | `da0717e76a44b4e598c7ebc5c223e57c24044b72ec13238df6a97d49bfaa1807` | The 5 tests T2 removes. |
| `sdk-probe.mjs` | `cd08838ec8c89a9842d3eee3da0833ac3bd58eb4ff5886d3b2b334e15c707bda` | Asserting SDK probe: source and activity; custom, default and override loaders. |
| `test-identities.mjs` | `79134323c3aa71e4d410c3dbcfc9f99144aad66521dde1478df8ddce4eebc966` | Baseline identity comparison, with multiplicity. |
| `live-check.mjs` | `0748dd48f0200ebcaa72b38d26866e0b2785a9a04f06df6ee53a6e81d39c9698` | T5 live-check verifier. |
| `failing-tests.mjs` | `5af620a5563cb8ce7fb934e672388cb8907117c9fb99f766ea6ba3aa139f080c` | Copy of the planning skill's runner, which is untracked in the main checkout. |
| `suite-runs.md` | `5b733913bb318b05114ee23112ebba6dd0f7bb3f376b75a6a025961ca2ae87d5` | Every suite run of the probe, sequential and deliberately loaded. |

The upstream-owned footprint, verbatim from `git diff 92294f229 0bc75dbc4`:

```diff
--- a/packages/coding-agent/src/core/agent-session.ts
+++ b/packages/coding-agent/src/core/agent-session.ts
@@ -132,6 +132,10 @@ import {
 import { emitSessionShutdownEvent } from "./extensions/runner.ts";
+import {
+	addAskUserQuestionBaseTool,
+	askUserQuestionDefaultActive,
+} from "./fork-builtins/ask-user-question/base-tool.ts";
@@ -5624,6 +5628,12 @@ export class AgentSession {
 			this._baseToolDefinitions.set(SLASH_COMMAND_TOOL_NAME, this._createSlashCommandTool());
 		}
+		// Fork: ask_user_question is a base tool like read (ADR-0009).
+		addAskUserQuestionBaseTool(this._baseToolDefinitions, {
+			agentDir: this._agentDir,
+			eventBus: this._resourceLoader.getEventBus?.(),
+			getExternalEditorCommand: () => this.settingsManager.getExternalEditorCommand(),
+		});
@@ -5658,6 +5668,7 @@ export class AgentSession {
 					...(this._baseToolDefinitions.has(SLASH_COMMAND_TOOL_NAME) ? [SLASH_COMMAND_TOOL_NAME] : []),
+					...askUserQuestionDefaultActive(this._baseToolDefinitions),
 				];
--- a/packages/coding-agent/src/core/keybindings.ts
+++ b/packages/coding-agent/src/core/keybindings.ts
@@ -10,6 +10,7 @@
 import { stripBom } from "../utils/text.ts";
+import { ASK_USER_QUESTION_KEYBINDINGS } from "./fork-builtins/ask-user-question/keybindings.ts";
@@ -77,6 +78,7 @@ const windowsKeybindings = useWindowsKeybindings();
 export const KEYBINDINGS = {
 	...TUI_KEYBINDINGS,
+	...ASK_USER_QUESTION_KEYBINDINGS,
```

## Review history

### Pass 1: 2026-09-26, reviewer model openai-codex/gpt-6-sol

| Angle | Verdict |
| --- | --- |
| Traceability | Skipped: the plan has no source document. |
| Assumptions | FAIL |
| Completeness | FAIL |
| Feasibility | FAIL |
| Validation | FAIL |
| Safety | FAIL |

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | Rollback range `<T3>..<T1>` selects no commit (all angles but validation). | Accepted | Now `<T1>^..<T3>`, verified in a scratch repository (Section 3). |
| 2 | Rollback verification used a custom loader that can never show the old extension. | Accepted | `sdk-probe.mjs` gained a `default` mode; it shows `<inline:@juicesharp/rpiv-ask-user-question>` on the baseline build (Appendix A). |
| 3 | A `before_agent_start` handler can bring the gated tool back. | Accepted in part | Real cause: `prepareRunPrompt` read the base options before the gate ran. The gate moved to `prepareActiveTools` (M13). A handler that adds the tool on purpose still wins; that is an explicit extension choice, and `execute` still returns `no_ui` (`ask-user-question.ts`, `rejectWithoutUi`). |
| 4 | A deactivation while the gate holds the tool out is undone when a UI appears. | Accepted | Claim narrowed to the "Gate limit" of Section 2.1. The upstream reconciler restored the tool on every UI prompt (`packages/builtins/rpiv-ask-user-question/reconcile.ts:34-38`). |
| 5 | T6 results never reach `personal`. | Accepted | T6 adds a second approved fast-forward. |
| 6 | SDK probe left temporary directories. | Accepted | The probe removes its directories; 8 old ones were removed (Appendix A). |
| 7 | T0 did not name the evidence copy. | Accepted | T0 lists both paths and the hash checks. |
| 8 | T2's source grep cannot pass (provenance comments name the package). | Accepted | Replaced by directory and `git grep` checks, verified on `bc9788777`. |
| 9 | The fast-forward collides with the untracked plan files in the main checkout. | Accepted | T5 step 1 compares and removes the exact files (9 after pass 2). |
| 10 | Replay worktree is dirty before removal. | Accepted | T6 records each worktree's expected state and stops on any other. |
| 11 | Count checks cannot see a swapped-out baseline test. | Accepted | `test-identities.mjs` joins the Regression rule. |
| 12 | No durable test with a same-named extension tool. | Accepted | Suite test added (M14). |
| 13 | Several pass conditions needed eyeballing. | Accepted | Asserting probe, lockfile counts, README and ADR greps, `live-check.mjs`, results headings. `live-check.mjs` counts only user messages, because the checking session's own transcript holds the marker. |
| 14 | `rm -rf` of the workspace link without a target check. | Accepted | T2 step 2 checks the symlink and its target first. |
| 15 | `/tmp/aubt-*` glob deletion without an ownership boundary. | Accepted | T6 names exact paths. |
| 16 | Main-checkout install and build under running sessions. | Accepted | T5 step 0 lists the processes for the owner's decision. |

Sections changed: all task sections, 2.1, 2.3, 2.4, 3, 5, 7, 8, 9, Appendices A and B. Changes made after this pass and not yet reviewed: all of the above.

### Pass 2: 2026-09-26, reviewer model openai-codex/gpt-6-sol (re-review)

| Angle | Verdict |
| --- | --- |
| Traceability | Skipped: the plan has no source document. |
| Assumptions | FAIL |
| Completeness | PASS_WITH_FINDINGS |
| Feasibility | FAIL |
| Validation | PASS_WITH_FINDINGS |
| Safety | Findings, no verdict line |

Pass-1 dispositions: the reviewers confirmed findings 5, 7, 9 and 14 on the success path; the others drew the new findings below.

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 17 | T1's SDK probe fails with a relative dist path. | Accepted | Reproduced (`ERR_MODULE_NOT_FOUND`); the probe now resolves a file URL and passed with the relative path (Appendix A). |
| 18 | T3's skill grep cannot reach 0; lines 8 and 107 also name the package. | Accepted in part | Line 107 cites a test T2 removes and is now edited. Lines 8 and 36 name a historical plan and a real rpiv-mono path, so they stay; the check targets the stale test name. |
| 19 | `live-check.mjs` accepts any result in the file, including cancellations. | Accepted | It now needs an answered, non-cancelled result after the marked user message; verified both ways (Appendix A). |
| 20 | A same-typed key-id collision would not fail `tsgo`. | Accepted | Risk row now prescribes a merge-time `git grep`, which exits 1 at `bc9788777`. |
| 21 | T1 gave no rule for conflicts outside three files. | Accepted | Any conflict stops. |
| 22 | The live-check launch mode was unspecified. | Accepted | `pi --unfenced` from the main checkout. |
| 23 | After a rollback, T6's fast-forward cannot work. | Accepted | The reverts now happen on the feature branch in the worktree; `personal` fast-forwards to them. |
| 24 | The regression runner is untracked in the main checkout. | Accepted | A byte-identical copy joins the evidence directory, committed at T0. |
| 25 | The `extensionsOverride` and failed-load claims were unproven. | Accepted | The `override` probe mode proves the first on both builds; the opening no longer claims the second. |
| 26 | Identity comparison collapses same-named tests. | Accepted | Counts with multiplicity; a dropped duplicate now reports `missing 1 of 2`. |
| 27 | README and results content relied on inspection. | Accepted in part | ID-default pairs, event fields and the results values are grep checks; the gate prose stays a named manual review by the owner. |
| 28 | Other-workspace comparison was manual and tolerated a new singleton failure. | Accepted | Rule 4 is a `diff` and `grep` command, with no tolerance outside coding-agent. |
| 29 | Rollback had no shared-checkout precondition. | Accepted | Rollback step 3 checks the index and every touched path before the fast-forward. |
| 30 | `npm run check` in the shared checkout can rewrite other sessions' files. | Accepted | The rollback check runs in the worktree; no check runs in the main checkout. |
| 31 | Forced worktree removal did not inventory ignored contents. | Accepted | T6 requires every ignored entry to match the plan's install and build outputs; verified on the current worktrees. |

Sections changed: opening, 3, 5, T0, T1, T3, T4, T5, T6, 7, 8, 9, Appendices A and B, evidence scripts. Changes made after this pass and not yet reviewed: all of the above.

### Rework after pass 2: 2026-09-26, owner ruling

The owner ruled that hiding the tool without a UI is wrong: OpenIntent workers and future attached clients need it in sessions no screen watches (R4 revised). The owner also ruled worker readiness out of this plan (R10), after reading the session-control handoff and the engine design. The experimental server packages are out of scope.

| Change | Effect on earlier findings |
| --- | --- |
| The gate, its `prepareActiveTools` hook in `run-preparation.ts` and the gate tests are removed. | Findings 3, 4 and 12 are superseded; M3, M13 and M14 of the earlier mutation list are replaced by M2, M3 and M8. The Gate limit paragraph is gone. |
| The session suite has 8 tests: availability without a UI with the `no_ui` result, and a deactivation that sticks, replace the gate tests. | Finding 13's live check is unchanged. |
| The `agent-session.ts` footprint is 11 added lines in 3 hunks; `run-preparation.ts` is untouched. | Sections 2.3, 4 and Appendix B updated. |
| New commits `68ef2a376` (T1) and `cfa28fecb` (T2); evidence patches and hashes regenerated; the replay equals `cfa28fecb`. | T0 hashes and T6 probe state updated. |
| The footer reftable tests flaked in 2 of 6 T2 runs under a load average near 26, never in 6 baseline runs or 4 T1 runs. They join the known flakes with an explicit tolerance rule. | New planner default, open to the owner's correction. |
| Section 10 names D11 and the engine amendment as later phases. | New section. |

Sections changed: all except 2.4. Changes made after this entry and not yet reviewed: all of the above.

### Pass 3: 2026-09-26, reviewer model openai-codex/gpt-6-sol (re-review after the rework)

| Angle | Verdict |
| --- | --- |
| Traceability | Skipped: the plan has no source document. |
| Assumptions | PASS_WITH_FINDINGS |
| Completeness | PASS_WITH_FINDINGS |
| Feasibility | FAIL |
| Validation | FAIL |
| Safety | PASS_WITH_FINDINGS |

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 32 | Section 3 said workers raise questions through ask-operator; today they have none, and a worker call gets `human-question`. | Accepted | Verified in OpenIntent `rpc-child.ts:442-450` and `worker-policy-extension.ts:156-168`. Section 3 now states both, a Section 8 row and the README cover it. The rpiv built-in behaves the same today. |
| 33 | The footer debounce test was tolerated without baseline evidence (assumptions, validation). | Accepted | Deliberate load on the unchanged baseline reproduced the cached-branch test (1 of 2 parallel runs, 2 of 30 file loops) and concurrent tests, but never the debounce test (0 of 30). Only the first two are known flakes now; a debounce failure stops the implementer. |
| 34 | `sdk-probe.mjs` printed `active` but never asserted it. | Accepted | The probe now requires a present tool to be active and an absent one inactive; all seven cases pass and the mismatch case exits 1. |
| 35 | Nothing checked the tool list the model actually receives without a UI. | Accepted | The suite test now reads the system messages' tool deltas with `getCurrentTools`, the helper the agent loop uses. `context.tools` turned out to be only the executable set. Request-time hiding in the loadout (M9) or in run preparation (M10) now fails it. |
| 36 | The ADR amendment would leave "adds no upstream-owned line" and the Control row contradicting the base tool. | Accepted | T3 qualifies both, with grep checks. |
| 37 | The README contract did not name the guidance fields. | Accepted | T3 names the three fields, their types, the fallback and an example, with grep checks. |
| 38 | Results did not record cutover approvals or the rollback outcome. | Accepted | `## Cutover` holds one row per step with the decision and outcome, checked by `grep -cE`. |
| 39 | Rule 3 tolerated flakes while rules 1 and 2 still failed on the same run. | Accepted | Rule 3 now names the extra runs and evaluates rules 1 and 2 on a clean one. |
| 40 | The failure-count `grep` in rule 4 had no input. | Accepted | Both log files are named. |
| 41 | Forced worktree removal did not inventory ignored files or the replay's staged content. | Accepted | `--untracked-files=all` lists every ignored file, each must lie under an install or build output; the replay's index must equal T2. Both guards ran on the old replay before its removal. |
| 42 | `mkdir -p /tmp/aubt-impl` could reuse a directory another session owns. | Accepted | `mkdir` without `-p`; an existing directory stops the implementer. |

New commits: T1 `00166b028` (the suite test's model-visible assertion) and T2 `0bc75dbc4`. Both passed `npm run check`, the diff and identity rules; T2 also passed `./test.sh` and the seven probe cases. Evidence patches, `sdk-probe.mjs` and `suite-runs.md` were regenerated; the replay equals T2.

Sections changed: 2.1 defaults, 3, 5, T3, T4, T6, 7, 8, Appendices A and B, evidence scripts. Changes made after this pass and not yet reviewed: all of the above.

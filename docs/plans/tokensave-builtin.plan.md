# pi-tokensave as a fork-owned built-in

This plan moves the owner's pi-tokensave fork into Pi as a fork-owned built-in module under `packages/coding-agent/src/core/fork-builtins/tokensave/`. It drops the code that writes `AGENTS.md` and the upstream-compatibility fallbacks, and moves the settings into `settings.json`. It adds an empty-index check and a `project` parameter on every tool. Its source is the pi-tokensave rows of `docs/plans/built-in-extensions.report.md`, plus the owner's rulings of 2026-09-26. A probe on 2026-09-26 verified the port, the registration, the test conversion and the SDK, RPC and print modes. No later phase follows.

## 1. Authority and workflow

| Source | Role |
| --- | --- |
| This plan | The implementation contract. It overrides the source where Section 2 or Section 4 names a difference. |
| `docs/plans/built-in-extensions.report.md` | The pi-tokensave rows of Sections 4.1 to 4.6 and 5.3; questions Q8, Q12 and Q13. |
| `docs/adr/ADR-0009-built-in-extensions.md` | The built-in mechanism and the fork-owned kind. T7 amends it. |
| `docs/adr/ADR-0003-fork-first-merge-hygiene.md` | New code goes in new files; upstream-owned files get no line. |
| `docs/plans/vcc-recall-builtin.plan.md` and `.results.md` | The precedent for a fork-owned built-in, its cutover and its validation. |
| `/Users/paolof/Developer/ai/pi-tokensave`, branch `personal`, commit `2a626d3b13fe503e2ef3aff6bb743073b1bb71a1` | The code T1 copies. Read-only. |
| `AGENTS.md` (repository) | Git, lockfile, check and test rules. |

The `planning-changes` skill wrote this plan and runs its review passes. A fresh session implements it from the handoff prompt.

## 2. Decisions

### 2.1 User rulings

All rulings date from 2026-09-26.

| # | Ruling | Consequence |
| --- | --- | --- |
| R1 | The code becomes a fork-owned module in `packages/coding-agent/src/core/fork-builtins/tokensave/`, not a ported package under `packages/builtins/`. | No `UPSTREAM.json`, no sync, no workspace and no lockfile change. Biome, `tsgo` and vitest cover the code. |
| R2 | Remove all management of `AGENTS.md`: the write at `session_start`, `/tokensave-rules-install`, `/tokensave-rules-remove` and the doctor check. Keep the injection in `before_agent_start`. | T3 removes the code. T9 removes the block from `~/.pi/agent/AGENTS.md`. |
| R3 | Settings live in `settings.json` under `forkBuiltins["pi-tokensave"]`, read from the session's agent directory. `pi-tokensave.json` is no longer read. | T4. The cutover (T9) writes `autoManageBranches: true` there. |
| R4 | `/tokensave-mode prefer\|enforce` changes the mode for the current session only and writes nothing. | T4. A new session starts from the settings mode. |
| R5 | `enforce` stays the default everywhere. A worker's `toolSelection` governs the guard; no new switch is added. | No task. The existing stand-down on an uncallable `tokensave_find_symbol` stays. |
| R6 | Drop the real-binary smoke test. | T1 does not copy `test/smoke-real-tokensave.test.ts`. |
| R7 | Move two of the owner's `AGENTS.md` additions into the injected rules: the direct database fallback and "never spawn a subagent for codebase research". Trim the rest of the owner's text as Section 6, T9 shows. | T6 edits the rules text. T9 edits `~/.pi/agent/AGENTS.md`. |
| R8 | Add a per-root empty-index check. An index with 0 nodes gets no rules injection and no guard. | T6. |
| R9 | Add an optional `project` parameter to all six tools now, with the design below. | T5. |
| R10 | For a foreign root, structured results carry absolute file paths. `tokensave_context` keeps TokenSave's text under a header saying its paths are relative to the root. Every file-taking input strips a leading root. | T5 and T6. Recorded after review pass 1. |

**R9 design, as the owner approved it.**

| Aspect | Behavior |
| --- | --- |
| Parameter | Optional `project` on all six tools: a path, absolute or relative to the session cwd. Omitted means today's behavior. |
| Resolution | `resolveProjectRoot` on the resolved path: walk up to `.tokensave/` or the nearest `.git`. |
| Uninitialized target | An error text naming the resolved root. Never initialize automatically. |
| Returned file paths | For a foreign root: absolute in the structured output of `tokensave_find_symbol`, `tokensave_search`, `tokensave_symbol`, `tokensave_impact` and `tokensave_status`. `tokensave_context` output stays as TokenSave writes it (R10). The session root keeps today's relative paths. |
| Input file paths | A leading `<root>/` is stripped from `tokensave_impact`'s `file` and from every `pathInclude` and `pathExclude` entry (R10). The strip happens once, at the start of `execute`, before local filtering (`matchesPathFilters`) and before any CLI call. The CLI accepts only root-relative files (Section 3). |
| Result header | Every result starts with `Project: <root>`. For a foreign root, `tokensave_context` adds `File paths below are relative to <root>.` |
| Empty-index check | Cached per root. The rules injection checks the session root; the guard checks its target root. |
| Branch reconciliation | The session root keeps today's behavior: it reconciles at `session_start` and before each TokenSave call. A foreign root reconciles before the first TokenSave call that targets it, when `autoManageBranches` is on. |
| Consulted queries | Keyed by root. |
| Guard target | The root of the search target (`path` for `grep`, `find` and `anchor_grep`; path arguments for `bash`), not the cwd. The block message names `project` when the target root differs from the session root. |
| Rules injection | Still gated on the cwd project. The tool guidelines mention `project`. |
| Commands | `/tokensave-status`, `/tokensave-init` and `/tokensave-sync` accept an optional path argument. |

### 2.2 Source questions

| # | Status | Answer used |
| --- | --- | --- |
| Q8 | Adopted recommendation (a) | Built-ins stay always on; R5 confirms it for this module. |
| Q9 | Deferred | OpenIntent readiness is outside this plan. T10 lists the resource as an open user action. |
| Q12 | Resolved by R1 | The tests move into coding-agent's vitest suite; no workspace `test` script exists. |
| Q13 | Adopted recommendation | Standing approval in `/tmp` worktrees, per-step approval in the main checkout (Section 2.4). |

### 2.3 Differences from the source

| Source item | This plan | Reason |
| --- | --- | --- |
| Section 4.1 and 5.1: port as a package under `packages/builtins/` with `UPSTREAM.json` | A fork-owned module (R1) | Upstream holds 2 commits, the last on 2026-07-12; the owner wrote the other 13. The fork-owned kind gets the full checks. |
| Section 4.3: reads `~/.pi/agent/AGENTS.md` | Never reads or writes `AGENTS.md` (R2) | The injection covers every case, and a fenced session cannot write `AGENTS.md` (Section 3). |
| Section 5.3: confirm the `AGENTS.md` behavior | Removed with R2 | Nothing remains to confirm. |
| Section 4.3: settings in `~/.pi/agent/pi-tokensave.json` | `settings.json` under `forkBuiltins["pi-tokensave"]` (R3) | One settings file for every built-in, which the fence lets Pi read. |
| Section 5.4: remove the `settings.json` entry after the rebuild | T9 removes it before the rebuild | Two copies of the six tools never load together. The vcc cutover used the same order. |

**Planner defaults.** Each is reversible; the reason stands next to it.

| Item | Default | Reason |
| --- | --- | --- |
| Test assertions | Convert `node:assert/strict` to vitest `expect` (T1 mapping) | No coding-agent test imports `node:assert` (Section 3). |
| Inline extension name | `tokensave`, the directory name | Matches the `vcc-recall` precedent. The settings key stays `pi-tokensave` (R3). |
| `autoManageBranches` default | Stays `false`; T9 writes `true` to the owner's settings | Keeps the documented default. The owner's live file sets `true` (Section 3). |
| `pi-tokensave.json` | Left on disk; T10 lists its deletion as an optional user action | The module no longer reads it. |
| Module documentation | A trimmed `README.md` in the module directory | The commands and settings need a reference; Biome ignores Markdown. |
| Empty-index probe failure | Fail open: an error or timeout counts as `ready`, so rules and guard stay on | Today's behavior injects the rules and guards without probing. |
| `bash` guard target | The last non-flag argument that exists as a path, else the cwd | The existing tokenizer already separates targets from flags. |
| Known flakes | Section 5 lists two tests with their evidence and a frequency limit | Both fail on BASE or under machine load (Appendix A). |
| Empty-index lookup and refresh | Any consumer that meets an `unknown` root probes it once and awaits the result: `before_agent_start` for the session root, the guard for its target root. An `empty` or `ready` entry is never probed again until it is reset to `unknown`. A successful `/tokensave-init` or `/tokensave-sync` resets it, and so does a reconciliation whose result reports `synced: true`. | One `status` call per root costs 0.2 s (Section 3); a probe on every guarded call would not. |

### 2.4 Approvals

This plan adopts the vcc plan's approval policy. The owner may override it before implementation.

Standing approval: install, `npm run build:offline`, `npm run check`, `./test.sh` and single test files inside `/tmp` worktrees.

These actions always need the owner's explicit yes:
- any install, build or commit in the main checkout;
- any commit that includes `package-lock.json` (none is expected);
- each edit of `~/.pi/agent/settings.json` or `~/.pi/agent/AGENTS.md`;
- the fast-forward of `personal`;
- removing any worktree or deleting any branch.

## 3. Verified facts

The probe ran on 2026-09-26 against `personal` at `7f15419c19593e3049c64ca0030dddbd185dfabb`. It used the worktrees `/tmp/tokensave-builtin-probe` (the change) and `/tmp/tokensave-builtin-baseline` (clean), both built with `npm run build:offline`. Test runs used `.pi/skills/planning-changes/scripts/failing-tests.mjs` from the main checkout, under `./test.sh` isolation.

| Fact | Evidence |
| --- | --- |
| The source fork is clean at `2a626d3b`, 13 commits ahead of `upstream/main` and 0 behind. | `git status --short` prints nothing; `git rev-list --left-right --count upstream/main...HEAD` prints `0 13`. |
| Source tree ids at `2a626d3b`. | `git rev-parse 2a626d3b:src` `6c3708afb23f108da36b6a1bfd3c958b883fceee`; `:test` `f071daf1e14f26f24fc83de905f9b49665fa9963`; `:LICENSE` `267fcc55b7b720391a27e2b7485135e1b59383cc`. |
| The source has 12 files and 3,119 lines, and no npm runtime dependency. | `git show 2a626d3b:src/<file> \| wc -l` summed over the 12 files; `package.json` `"dependencies": {}`. |
| External imports are `typebox`, `@earendil-works/pi-ai` (`StringEnum`), the coding-agent types and `node:` modules. | Appendix A, import census. |
| coding-agent already depends on both packages. | `packages/coding-agent/package.json:54` `@earendil-works/pi-ai`; `:68` `typebox` 1.3.27. |
| The copied module passes `tsgo` and Biome after two hand fixes. | Appendix A. The fixes are in Appendix B. |
| The code holds no `any`. | `grep -nw any` finds the word only in 4 comments and 1 guideline string. |
| The fork types every API the source reaches by cast. | `extensions/types.ts:328` `ctx.agentDir`; `:1451` `pi.agentDir`; `:1640` `getCallableTools()`; `:783` `systemPromptOptions` sections. |
| `before_agent_start` handlers are awaited. | `extensions/runner.ts:1496` `await handler(event, ctx)`. |
| 148 tests pass under `node:test` and the same 148 under vitest, after an import swap only. | Appendix A. |
| The tests use `node:test` only for `test` and one `t.skip`, in the dropped smoke test. | Appendix A, API census. |
| No coding-agent test imports `node:assert`. | `grep -rl 'from "node:assert' packages/coding-agent/test` prints nothing. |
| The registration passes, and its test guards it. | Appendix A: `fork-builtins.test.ts` 11 of 11; without the entry, 1 fails. |
| `fork-builtins.test.ts` loads only when coding-agent's `dist/` is built. | Appendix A: on an unbuilt baseline it fails to resolve `@earendil-works/pi-coding-agent` from `packages/builtins/rpiv-ask-user-question/fork-settings.ts:15`. |
| On a built tree the coding-agent baseline has 0 failures. | Appendix A: 5 of 6 runs clean; 1 run shows the known footer flake. |
| TokenSave is 7.12.1 at `/opt/homebrew/bin/tokensave`; `TOKENSAVE_BIN` is unset. | `tokensave --version`; `which tokensave`. |
| A query for another indexed repository works from any cwd and returns paths relative to that repository. | `tokensave tool find_exact_symbol --project …/pi-fence` from `pi/` returns `src/profile/loader.ts:99`. |
| An unindexed target returns an error text naming the path, with exit 0. | `tokensave tool status --project /tmp` prints `Error: config error: no TokenSave index found at '/tmp'`. `…/pi-tokensave` gives the same. |
| `context` returns markdown whose paths are root-relative free text. | `tokensave tool context --project …/pi-fence` prints `## Code Context` with `src/profile/loader.ts:99` inside list lines; `JSON.parse` of the text fails. |
| The CLI accepts only root-relative files. | Review pass 1: `file_dependents` for pi-fence's `src/profile/loader.ts` returns 28 dependents; the absolute path returns 0. |
| Five of the six tools check the cwd's project before running. | Source `src/tools.ts:80` `guardCheckNotInitialized(ctx)` reads `ctx.cwd`; it is called at `:150`, `:419`, `:544`, `:745` and `:901`, and `executeStatus` checks `projectRoot(ctx)` at `:93`. |
| The shared test fake has no `getCallableTools` and no `agentDir`. | Source `test/index.test.ts:23-44` `fakePi()`. |
| Four tests pass a callback to `assert.doesNotReject`. | Source `test/tools-execution.test.ts:451`, `:591`, `:601`, `:680`: `async () => execute(...)`. |
| The live `pi` launcher runs the unbundled CLI. | `~/.local/bin/pi` resolves to pi-fence's `dist/cli/main.js`; `~/.pi-fence/entry.json` `piEntry` is `packages/coding-agent/dist/cli.js`. T9 therefore never runs `dist/bundle`. |
| Live Pi sessions appear in `ps` as `node /Users/paolof/.local/bin/pi …`, not as `coding-agent/dist/cli.js`. | `pgrep -fl 'coding-agent/dist/cli.js'` printed nothing while `pgrep -fl '\.local/bin/pi'` listed 5 sessions; the planning session's own ancestor chain is `node /Users/paolof/.local/bin/pi --unfenced`. `/tmp` resolves to `/private/tmp`. |
| RPC and print mode run a built-in's command with no model call, for both the unbundled and the bundled CLI. | Appendix A, mode probes: the probe build answers `/tokensave-status` over RPC with TokenSave's status box and exits 0 in print mode; the baseline answers nothing and exits 1. |
| The built SDK executes a TokenSave tool. | Appendix A: `dist-probe.mjs` prints `"tokensaveTools":6,"statusRan":true`, and `PI_FORK_BUILTINS=off` removes every built-in. |
| Impact by file sends the file to three CLI tools. | Source `src/tools.ts:958` `file_dependents`, `:977` `diff_context`, `:1004` `affected`. |
| `tokensave_find_symbol` filters by path locally. | Source `src/tools.ts:436-453` applies `matchesPathFilters` to `find_exact_symbol` and `by_qualified_name` results. |
| Structured file paths render in more places than the node lists. | Source `src/tools.ts:401-408` `formatAmbiguity` (used at `:727` and `:919`), `:516` the "Next step: read" line, and the literal search branch that prints `match.file`. |
| A reconciliation result does not say whether `sync` ran. | Source `src/branch-lifecycle.ts:13-16` exposes `reconciled` and `warnings`; `sync` runs only on a branch, at `:131-133`. |
| Running Pi sessions still load the old extension, which writes the `AGENTS.md` block at every `session_start`. | Source `src/index.ts` `session_start` calls `installRulesBlock`; `settings.json` line 22 loads the fork. |
| 36 repositories under `~/Developer/ai/` have `.tokensave/`; `pi-tokensave` has none. | `for d in */; do [ -d "$d.tokensave" ] …` |
| A status call on `pi/` takes 0.2 s and reports `node_count` 47,480. | `time tokensave tool status --project $PWD`. |
| The TokenSave binary runs inside the fence. | `~/.pi-fence/violations/20260922T180402Z-87016d56.jsonl` records a `tokensave(2378)` process; its only denials are `~/.tokensave/config.toml`, its `.lock` and `~/.claude/settings.json`. |
| The fence lets Pi read `settings.json` and write neither `AGENTS.md` nor `pi-tokensave.json`. | `~/.pi-fence/profiles/base.json`: read allow `~/.pi/agent`; the write allow list names neither file. |
| `SettingsManager` keeps unknown top-level keys when it writes. | `settings-manager.ts:697-700` starts from the file's current settings. rpiv's `forkBuiltins` entry relies on it. |
| `settings.json` lists pi-tokensave once and has no `forkBuiltins` key. | Line 22 `"../../Developer/ai/pi-tokensave",`; 15 packages; SHA-256 `f9837414b97845f60c36cfae94321aa1920ab63dd9954f41a6e8791a1ab7980e`. |
| `settings.json` round-trips through `JSON.stringify(parsed, null, 2)` byte for byte, with no final newline. | Node check printed `exact 1455 1455`. |
| `pi-tokensave.json` holds only `autoManageBranches: true`. | File content; SHA-256 `b65c590fa448f1b070f73517da68545c4f3ae6be60f084fb1280ac9b13e0119d`. |
| `AGENTS.md` holds the managed block at lines 39 to 92, a blank line on each side, and the owner's additions at lines 94, 96, 98 and 104. | `grep -n`; SHA-256 `2a59f35ada5af7e908c389a4d7adacb358cfd464fbcd17967fbe051d82b92604`. |
| Session files record the rules marker. | The newest `pi/` session file holds `pi-tokensave:start` 11 times. |
| The source is MIT licensed. | `LICENSE`: "Copyright (c) 2026 pi-tokensave contributors". |

## 4. Scope

**In scope.**
- The verbatim module copy, the mechanical fixes and the converted tests (T1).
- The registration and its guard test (T2).
- Removal of `AGENTS.md` management and the upstream fallbacks (T3).
- Settings in `settings.json` and the session-only mode (T4).
- The `project` parameter (T5).
- The rules text and the empty-index check (T6).
- The ADR-0009 amendment and the module README (T7).
- Validation of the built outputs in SDK, RPC and print mode (T8).
- The cutover of the live setup (T9).
- The results record and cleanup (T10).

**Out of scope.**
- TokenSave's write tools, which the extension never exposed.
- pi-fence grants for `~/.tokensave/`; the owner edits the fence.
- OpenIntent's resource list and readiness (report Q9).
- Deleting `~/.pi/agent/pi-tokensave.json` or the source fork.

**Binding constraints.** No upstream-owned file changes. The shrinkwrap, the install lock, `package-lock.json`, `models.generated.ts`, `packages/builtins/` and the source fork stay untouched.

| Constraint | Exception in this plan |
| --- | --- |
| `~/.pi/agent/settings.json` stays untouched | T9 removes one package entry and adds `forkBuiltins["pi-tokensave"]`, with approval. |
| `~/.pi/agent/AGENTS.md` stays untouched | T9 removes the managed block and trims four paragraphs, with approval. |

## 5. Working setup

1. Create the worktree: `git worktree add -b feat/tokensave-builtin /tmp/tokensave-builtin personal`.
2. Copy the ignored model data: `cp -R /Users/paolof/Developer/ai/pi/packages/ai/src/providers/data /tmp/tokensave-builtin/packages/ai/src/providers/`.
3. Run `npm install --ignore-scripts`, then `npm run build:offline`, in the worktree. Without the build, `fork-builtins.test.ts` fails to load (Section 3).
4. Record `BASE=$(git -C /tmp/tokensave-builtin rev-parse HEAD)`. The probe used `7f15419c19593e3049c64ca0030dddbd185dfabb`. When BASE differs, Section 3 still describes the probe, and the baseline below describes BASE.
5. Record the baseline, one run at a time, with `S=/Users/paolof/Developer/ai/pi/.pi/skills/planning-changes/scripts/failing-tests.mjs`:
   - three coding-agent runs: `node $S run /tmp/tokensave-builtin packages/coding-agent /tmp/tokensave-builtin-impl-base-<n>.json` for `n` 1 to 3;
   - one `./test.sh` run from the worktree root, its full output saved to `/tmp/tokensave-builtin-impl-base-testsh.log`.
   The rule below calls these `base-1` to `base-3` and `base-testsh.log`.
   Each output path must not exist beforehand; the script refuses an existing path.
6. Create the path record `/tmp/tokensave-builtin-impl-paths.txt`, refusing when it exists. Append every temporary path that Section 5 and T1 to T9 create, one per line, including this file itself. T10 deletes only the paths listed there.

**Regression rule.** T1 to T6 apply it after every change.
1. Run the coding-agent suite once and diff it against `base-1` with `node $S diff`. The candidate runs at least as many tests as `base-1`, plus the tests the task adds, minus the tests the task removes by name.
2. A failure absent from `base-1` triggers two more candidate runs. It is tolerated only when `base-2` or `base-3` also shows it, and the candidate fails it in no more of its three runs than the baseline did in its three. Otherwise, stop and ask. The known flakes below are the only exception.
3. Run `./test.sh` and keep its exit status. Collect from its log every vitest `FAIL` line, every node:test `not ok` line, and every `This error originated in "<file>"` line of an unhandled-error block. Each collected line must also appear in `base-testsh.log`, or belong to a known flake. An unhandled error belongs to a known flake only when its file is that flake's file, and the same run also shows that flake's `FAIL` line. A nonzero exit with no collected line means stop and ask. For any other line, rerun `./test.sh` once; a line that recurs means stop and ask.

**Known flakes.** The two tests below get a frequency limit instead of step 2's baseline condition. A known flake is tolerated when the candidate fails it in at most 1 of its three runs. Two or more failures in three runs mean stop and ask. Ten runs of its file alone (`for i in $(seq 10); do node ../../node_modules/vitest/dist/cli.js --run <file> || echo FAIL; done` from `packages/coding-agent`) are diagnosis only; record them in the results, but they never excuse a failure.

| Test | Evidence |
| --- | --- |
| `test/footer-data-provider.test.ts` "updates the cached branch when the reftable directory changes" | Failed in 1 of 6 built baseline runs (Appendix A), and on BASE in the vcc plan. |
| `test/agent-session-concurrent.test.ts`, the "while streaming" tests | A 10 ms timer race. It failed on BASE in the vcc results; here it failed in 1 of 6 probe suite runs and 1 of 2 probe `./test.sh` runs, never in a built baseline run, and passed 10 of 10 alone in both worktrees (Appendix A). |

Environment facts:
- Run suites one at a time. Two suites in parallel produce load-induced failures.
- Other sessions load this machine heavily; the probe saw load averages of 11 to 18.
- The pre-commit hook runs the full `npm run check`.
- Interactive `pi` in a worktree that contains `.pi/` shows a trust dialog. Choose "Do not trust (this session only)".

## 6. Tasks

### T0. Record the plan

The handoff performs this task. It copies `docs/plans/tokensave-builtin.plan.md` from the main checkout into the worktree, and `cmp` confirms the copy. It commits that single file as `docs: pi-tokensave built-in plan`. `git show --name-only --format= HEAD` must list only that path.

### T1. Copy the module and convert its tests

**Source preflight.** In `/Users/paolof/Developer/ai/pi-tokensave`, `git rev-parse 2a626d3b:src 2a626d3b:test 2a626d3b:LICENSE` must print the three tree ids of Section 3. A mismatch means stop and ask. The copy always reads the commit through `git archive`, never the working tree.

**Changes.**
1. Extract `src`, `test` and `LICENSE` from `git -C /Users/paolof/Developer/ai/pi-tokensave archive 2a626d3b src test LICENSE` into a new temporary directory, and record its path.
2. Copy `src/*.ts` and `LICENSE` into `packages/coding-agent/src/core/fork-builtins/tokensave/`.
3. In those files, replace `from "@earendil-works/pi-coding-agent"` with `from "../../extensions/types.ts"` (3 files: `commands.ts`, `index.ts`, `tools.ts`).
4. Each `.ts` file starts with a header naming its source path and commit, and pointing to the `LICENSE` in the directory, in the style of `fork-builtins/vcc-recall/recall.ts:1-2`.
5. Run `npx biome check --write` on the directory, then apply the two hand fixes of Appendix B (`runner.ts`, `guard.ts`).
6. Copy every `test/*.test.ts` except `smoke-real-tokensave.test.ts` into `packages/coding-agent/test/fork-builtins/tokensave/`. Apply the three rewrites of Appendix B's conversion script.
7. Convert every assertion to vitest `expect` with this mapping, then remove the `node:assert/strict` import:

| `node:assert/strict` | vitest |
| --- | --- |
| `assert.equal(a, b)` | `expect(a).toBe(b)` |
| `assert.deepEqual(a, b)` | `expect(a).toStrictEqual(b)` |
| `assert.ok(x)` | `expect(x).toBeTruthy()` |
| `assert.match(s, re)` | `expect(s).toMatch(re)` |
| `assert.doesNotMatch(s, re)` | `expect(s).not.toMatch(re)` |
| `await assert.doesNotReject(fn, message)` | `await fn()`; the 4 sites pass a callback, which must be invoked (Section 3) |
| `assert.fail(message)` | `expect.unreachable(message)` |

8. Fix the 8 `noAssignInExpressions` errors in `commands.test.ts` (Appendix A) without changing what the tests assert, then run `npx biome check --write` on the test directory.

No behavior changes in T1. The module is not registered yet.

**Validation.**
- `node ../../node_modules/vitest/dist/cli.js --run test/fork-builtins/tokensave` from `packages/coding-agent` reports 11 files and 148 tests passed.
- `grep -rn 'node:assert\|node:test' packages/coding-agent/test/fork-builtins/tokensave` prints nothing.
- Make `decodeStatusResponse` in `decoders.ts` throw, and confirm that the converted test "no registered tool throws when TokenSave returns an unexpected but valid plain-text response" fails. Its invocations include `tokensave_status`. Restore the file.
- The Section 5 regression rule holds, with 148 added tests.
- `npm run check` exits 0.

**Commit.** `feat(coding-agent): copy pi-tokensave as a fork-owned module`.

Stop and ask when a converted test fails. A failure means the conversion changed an assertion.

### T2. Register pi-tokensave as a fork-owned built-in

**Changes.**
- `packages/coding-agent/src/core/fork-builtins.ts`: apply Appendix B's diff. Add pi-tokensave to the header comment's list of fork-owned built-ins.
- `packages/coding-agent/test/fork-builtins.test.ts`: add Appendix B's test.

**Validation.**
- `fork-builtins.test.ts` passes 11 of 11.
- Remove the `tokensave` entry from `FORK_OWNED_BUILTINS`, and confirm that exactly 1 test fails. Restore the file from a recorded backup.
- The Section 5 regression rule holds, with 1 added test. `npm run check` exits 0.

**Commit.** `feat(coding-agent): ship pi-tokensave as a fork-owned built-in`.

### T3. Remove AGENTS.md management and the upstream fallbacks

**Changes.**

| File | Change |
| --- | --- |
| `rules.ts` | Keep `buildRulesBlock` and its markers; the markers let `before_agent_start` detect a prompt that already holds the rules. Delete `agentsMdPath`, `applyRulesBlock`, `stripRulesBlock`, `installRulesBlock`, `removeRulesBlock`, `currentBlockVersion` and `findBlockRange`. |
| `index.ts` | Delete the `installRulesBlock` call in `session_start`. Replace `canCallTool`'s cast with `pi.getCallableTools().includes(name)`. Read the agent directory from `pi.agentDir` and `ctx.agentDir`. |
| `commands.ts` | Delete `/tokensave-rules-install` and `/tokensave-rules-remove`, the doctor's rules-block line and the `agentsPathOverride` parameter. |
| `agent-dir.ts` | Delete the file. Every caller reads `agentDir` from `pi` or `ctx`. |
| `state.ts` | `modeConfigPath` takes the agent directory as a required argument. T4 replaces it. |

Test changes, by source test name:

| File | Removed | Rewritten |
| --- | --- | --- |
| `agent-dir.test.ts` | Delete the file (3 tests). | none |
| `rules.test.ts` | 15 tests; keep only "the rules tell the model to fall back when a TokenSave tool is unavailable or blocked". | none |
| `commands.test.ts` | "tokensave-rules-install and tokensave-rules-remove round-trip" | "tokensave-doctor reports mode and rules-block presence" asserts no rules line. "mode, rules, and doctor commands use the session agentDir…" drops the rules command. |
| `index.test.ts` | none | "a session with its own agentDir reads settings and installs rules there…" asserts that no `AGENTS.md` is created in the agent directory or under `HOME`. |

Update the shared `fakePi()` in `index.test.ts` and the fakes in `commands.test.ts` and `tools-execution.test.ts`: each gains `agentDir` (a per-test temporary directory) and `getCallableTools()`, which returns `getActiveTools()` unless a test overrides it. Every test context gains `agentDir`. The tests "a session without active TokenSave tools gets neither the guard nor the rules" and "the guard stands down while a skill disallows tokensave_find_symbol, but the rules stay" keep separate inactive and uncallable cases.

Add one test in `index.test.ts`: after `session_start`, the agent directory holds no `AGENTS.md`, and a pre-existing `AGENTS.md` keeps its exact bytes.

**Validation.**
- `grep -rn 'installRulesBlock\|removeRulesBlock\|agent-dir\|rules-install\|rules-remove' packages/coding-agent/src/core/fork-builtins/tokensave` prints nothing.
- The new test fails when the `installRulesBlock` call is restored in `session_start`. Restore T3's version.
- The regression rule holds, with 19 removed tests and 1 added test. `npm run check` exits 0.

**Commit.** `feat(coding-agent): pi-tokensave no longer writes AGENTS.md`.

### T4. Read settings from settings.json and make the mode session-only

**Changes.**
- Replace `state.ts`'s file config with `loadTokensaveSettings(agentDir)`. It reads `join(agentDir, "settings.json")`, strips a BOM, and takes `forkBuiltins["pi-tokensave"]`. It keeps `mode` only when it equals `"prefer"` or `"enforce"`, and `autoManageBranches` only when it is a boolean. A missing, unreadable or malformed file yields the defaults. It never reads a project's `.pi/settings.json`.
- Delete `modeConfigPath`, `loadPersistedMode`, `savePersistedMode` and every reference to `pi-tokensave.json`.
- The factory reads settings from `pi.agentDir` at load and from `ctx.agentDir` at each `session_start`.
- `/tokensave-mode <value>` sets `state.mode` only. Its reply says the change lasts for this session. With no argument, it prints the mode and its source (settings or session).
- `/tokensave-doctor` prints the settings path and the effective `mode` and `autoManageBranches`.

Tests:
- Settings come from the session agent directory, never from `HOME` or a project `.pi/settings.json`.
- Mistyped values fall back to defaults; a BOM-prefixed file reads; a malformed file yields defaults.
- `/tokensave-mode prefer` changes the guard for the session, and `settings.json` keeps its exact bytes.
- A new `session_start` resets the mode to the settings value.
- Rewrite "tokensave-mode reports current mode with no args and persists a new one" to assert no write. Rewrite `state.test.ts`'s "loads autoManageBranches and preserves it when changing mode" against `settings.json`.

**Validation.**
- `grep -rn 'pi-tokensave.json\|savePersistedMode' packages/coding-agent/src/core/fork-builtins/tokensave` prints nothing.
- The byte-identity test fails when the command calls a writer that stores the mode in `settings.json`. Restore T4's version.
- The regression rule holds. `npm run check` exits 0.

**Commit.** `feat(coding-agent): pi-tokensave reads forkBuiltins settings and keeps the mode per session`.

### T5. Add the project parameter

**Changes.** Implement the R9 design table as R10 amends it.
- A new `projects.ts` exports `resolveToolProject(cwd, project?)`. It returns `{ root, sessionRoot, foreign, initialized }`, with `root` from `resolveProjectRoot(resolve(cwd, project ?? "."))`, `sessionRoot` from `resolveProjectRoot(cwd)`, and `foreign` true when they differ.
- Every tool resolves its target with `resolveToolProject(ctx.cwd, params.project)` first. Replace `guardCheckNotInitialized(ctx)` and `executeStatus`'s `projectRoot(ctx)` check (Section 3) with a check of the target root. An indexed `project` then works from an uninitialized cwd.
- Every tool schema gains `project: Type.Optional(Type.String({ description: "Path of another indexed project; defaults to the session's project" }))`. `toSnakeArgs` must not forward it to the CLI.
- `callTool` passes `root` as `--project`. An uninitialized root returns `TokenSave is not initialized at <root>. Run /tokensave-init <path> or omit project.` and spawns no process.
- Input paths: at the start of each `execute`, strip a leading `<root>/` from `tokensave_impact`'s `file` and from each `pathInclude` and `pathExclude` entry. Every later use sees the stripped values: local `matchesPathFilters` calls, `file_dependents`, `diff_context`, `affected` and the `search` call.
- Output: every successful result starts with `Project: <root>`. For a foreign root, every structured file value becomes `join(root, file)` before formatting. The sites are:
  - `nodeLine` and `formatSymbolMatch`;
  - `formatAmbiguity`, used by `tokensave_symbol` and `tokensave_impact`;
  - the "Next step: read" line of `tokensave_find_symbol`;
  - `tokensave_search`'s array items, its literal-match lines and its plain-text fallback, where the text is TokenSave's and stays unchanged;
  - the symbol callers, callees and implementations;
  - the impact, affected-tests and file-dependents lists.

  `tokensave_context` output is not rewritten; for a foreign root its header adds `File paths below are relative to <root>.`
- `TokensaveSessionState.consultedQueries` becomes a `Map<string, string[]>` keyed by root. `recordConsultation` and `wasCandidateConsulted` take the root.
- `tool_call` for a `tokensave_*` tool reconciles the tool's target root. The session root's `session_start` reconciliation stays.
- The guard resolves the target root: `path` for `grep`, `find` and `anchor_grep`; for `bash`, the last non-flag argument that exists as a path, resolved against the cwd, else the cwd. It skips roots without `.tokensave/`. When the target root differs from the session root, the block message adds `Pass project: "<path>"`.
- `/tokensave-status`, `/tokensave-init` and `/tokensave-sync` resolve their optional argument with `resolveToolProject(ctx.cwd, args.trim() || undefined)`. `/tokensave-init` keeps its confirmation, which names the resolved root.
- Each tool's `promptGuidelines` adds one sentence: pass `project` to query another indexed repository.

Tests, each with a fake `execFile` that records the `--project` argument and the `--args` JSON:
- **Six-tool table.** One table-driven test lists all six tools with minimal parameters. For each tool it asserts:
  - the registered schema has an optional `project` property;
  - with `project` omitted, every spawned call carries the session root;
  - with a foreign `project`, every spawned call carries that root, and no `--args` JSON holds a `project` key;
  - the result text starts with `Project: <root>`;
  - from an uninitialized cwd, an indexed `project` still spawns calls with that root.
- A relative and an absolute `project` both reach the resolved root.
- An uninitialized target returns the error text and spawns no process.
- A foreign root makes every structured file absolute; the session root keeps relative files. Cover every site in the output list above except the plain-text fallback: find-symbol matches and its "Next step: read" line, both structured search forms (array and literal), an ambiguity list from `tokensave_symbol` and from `tokensave_impact`, symbol relationships, and impact lists.
- `tokensave_context` on a foreign root keeps TokenSave's text and adds the relative-path header line.
- `tokensave_impact` with `file` and `includeTests: true`, given an absolute path inside the foreign root, sends the root-relative path to `file_dependents`, `diff_context` and `affected`.
- `tokensave_find_symbol` with an absolute `pathInclude` inside the foreign root keeps a `find_exact_symbol` match whose root-relative file lies under it. `tokensave_search` with the same filter sends it root-relative to the `search` call.
- Each of `/tokensave-status`, `/tokensave-init` and `/tokensave-sync`, given a relative path to a foreign root, runs `tokensave` with that root; `/tokensave-init` still asks for confirmation and names the root.
- A consultation in root A does not unblock a search in root B.
- `rg Foo ../other` is not blocked when `../other` has no `.tokensave/`, and is blocked with the `project` hint when it has one.
- A `tokensave_*` call with `project` reconciles that root.

**Validation.**
- Each new test fails on a named mutation. Restore after each.
  - Forwarding `sessionRoot` instead of `root` fails the six-tool table.
  - Deleting the `project` property from any one tool's schema fails the six-tool table for that tool.
  - Keeping the cwd check fails the uninitialized-cwd row.
  - Dropping the output prefix fails the absolute-file test.
  - Dropping the input strip fails the impact input test and the `pathInclude` test.
  - Formatting the ambiguity list with the raw file fails the ambiguity rows.
  - Ignoring the argument of `/tokensave-sync` fails its command test.
  - Keying consultations globally fails the root A and root B test.
  - Resolving the guard from the cwd fails the `../other` test.
- The regression rule holds. `npm run check` exits 0.

**Commit.** `feat(coding-agent): pi-tokensave tools accept a project path`.

### T6. Update the rules text and add the empty-index check

**Changes.**
- `buildRulesBlock` bumps `RULES_BLOCK_VERSION` to `4` and adds three paragraphs, in the register of Section 1.5 of the report:
  - **Projects.** The tools query the session's project by default. Pass `project` to query another repository that holds `.tokensave/`. Session-project results keep paths relative to that project. Foreign-project results give absolute paths, except `tokensave_context`, whose header says its paths are relative to the named root. Absolute or root-relative paths both work as inputs.
  - **Direct database.** When the tools cannot answer a structural question, read `<root>/.tokensave/tokensave.db` directly, read-only (tables `nodes`, `edges`, `files`). TokenSave does not version this schema.
  - **Subagents.** Do not spawn a subagent for codebase research, exploration or analysis of a repository that TokenSave has indexed, unless the user says otherwise. This applies to the session's project and to any repository reachable through `project`.
- A per-root cache holds the index state: `unknown`, `empty` or `ready`. The first lookup runs the `status` tool, with a 4 s timeout, and decodes `node_count`. A `node_count` of 0 means `empty`; any error or timeout means `ready` (fail open).
- A root's lookup follows the planner default "Empty-index lookup and refresh" (Section 2.3). `session_start` starts the session root's lookup without awaiting it. `before_agent_start` awaits the session root's state and skips injection when it is `empty`. The guard awaits its target root's state, probing once when it is `unknown`, and stands down when it is `empty`.
- `BranchReconciliationResult` gains `synced: boolean`, true only when the `sync` step ran and succeeded. `createBranchReconciliation` resets the root's index state to `unknown` when a result reports `synced: true`. A successful `/tokensave-init` or `/tokensave-sync` resets its resolved root.
- The tools still run on an empty index; `tokensave_status` reports the counts.

Tests:
- An index whose `status` reports `node_count` 0 gets no rules section and no block.
- A `status` error or timeout still injects the rules.
- A root is probed at most once until it is reset: two prompts and three guarded searches in one root spawn one `status` call.
- A foreign root with `node_count` 0 is not guarded: `rg Foo ../empty` passes while the session root is `ready`.
- Two roots in one session, one `empty` and one `ready`, get independent `status` calls and independent guard decisions, and resetting one leaves the other unchanged.
- Empty to ready: with the session root cached `empty`, a guarded search passes. After a successful `/tokensave-sync` (the fake `status` now reports nodes), the same search is blocked, with no `before_agent_start` in between.
- A reconciliation that ran `sync` resets the root; one that skipped `sync` (detached HEAD) does not. The lifecycle tests assert `synced` for both.
- The rules text contains each new paragraph's key phrase.

**Validation.**
- Each mutation below fails its named test. Restore the code after each.
  - `before_agent_start` ignoring the cache fails the empty-index injection test;
  - `/tokensave-sync` leaving the cache entry unchanged fails the empty-to-ready test;
  - one global cache entry instead of one per root fails the two-roots test;
  - the guard reading the session root's state instead of its target's fails the foreign-empty test.
- The regression rule holds. `npm run check` exits 0.

**Commit.** `feat(coding-agent): pi-tokensave rules cover projects and skip empty indexes`.

### T7. Document the module and amend ADR-0009

**Changes.**
- Add `packages/coding-agent/src/core/fork-builtins/tokensave/README.md`: the six tools, the three commands with their path argument, `/tokensave-mode`, `/tokensave-doctor`, the settings keys and example, the modes, branch reconciliation, the `project` parameter and the rules injection. Carry over the source README's text where it still holds; drop install, uninstall and `AGENTS.md` sections.
- Amend `docs/adr/ADR-0009-built-in-extensions.md`:

| Section | Amendment |
| --- | --- |
| Decision, fork-owned row | Name pi-tokensave as the second fork-owned built-in. |
| Consequences | A fork-owned built-in reads its settings from `forkBuiltins.<key>` in the session agent directory's `settings.json`. It writes no file in the agent directory. |
| Amendment evidence | Cite this plan's Section 3 and Appendix A. |

**Validation.**
- `grep -cF` finds `tokensave-builtin.plan.md` and `forkBuiltins` at least once each in the ADR.
- In the README, `grep -F` finds each of these strings: the six tool names, `/tokensave-status`, `/tokensave-init`, `/tokensave-sync`, `/tokensave-mode`, `/tokensave-doctor`, `forkBuiltins`, `"pi-tokensave"`, `autoManageBranches`, `enforce`, `prefer`, `project` and `before_agent_start`.
- The README contains neither `pi install` nor `rules-install`.

**Commit.** `docs: ADR-0009 and README for the pi-tokensave built-in`.

### T8. Validate the built outputs

The probe ran every command below against `/tmp/tokensave-builtin-probe` (Appendix A, mode probes). Set `V=/tmp/tokensave-builtin-validate` and `F=/Users/paolof/Developer/ai/pi-fence`. `F` is an indexed repository with no `.pi/`, so no trust dialog appears.

1. Run `git worktree add --detach $V feat/tokensave-builtin`. Copy the model data, then run `npm install --ignore-scripts` and `npm run build:offline`. Record `$V` in the path list.
2. Copy Appendix B's `dist-probe.mjs` and `rpc-probe.mjs` to `/tmp/tokensave-builtin-impl-dist-probe.mjs` and `/tmp/tokensave-builtin-impl-rpc-probe.mjs`, refusing existing paths, and record both.
3. **SDK.** Run `node /tmp/tokensave-builtin-impl-dist-probe.mjs $V $F`, then the same with `PI_FORK_BUILTINS=off`.
4. **RPC.** For each entry `dist/cli.js` and `dist/bundle/cli.js`, run `node /tmp/tokensave-builtin-impl-rpc-probe.mjs $V $F <entry>`.
5. **Print.** For each entry, run from `$F`, with a fresh `mktemp -d` agent directory that the step records and deletes: `PI_CODING_AGENT_DIR=<dir> PI_OFFLINE=1 node $V/packages/coding-agent/<entry> -p --no-session --no-extensions /tokensave-status`. Repeat the `dist/cli.js` run with `PI_FORK_BUILTINS=off`.
6. Run `grep -rl tokensave_find_symbol $V/packages/coding-agent/dist/bundle`.

**Validation.**
- Step 3 plain output contains `"errors":[],"tokensaveTools":6,"statusRan":true` (`grep -F` exits 0); the switched-off output contains `"paths":[],`.
- Each step 4 output contains `TokenSave v` inside `"notify"`: `grep -F '"notify":["' ` and `grep -F 'TokenSave v'` both exit 0.
- Each plain step 5 run exits 0; the switched-off run exits 1, because `/tokensave-status` then reaches the model and finds no API key.
- Step 6 names at least one bundle file.

### T9. Cut over the live setup

Every step needs the owner's approval. Every Pi process started before step 5's build loads the old extension, and any `session_start` in it rewrites the `AGENTS.md` block (Section 3). The implementing session is such a process. The quiet interval therefore runs from step 3 until the implementing session exits at the end of T10:
- Before step 3, record the implementing session's pids: walk `ps -o ppid= -p <pid>` up from `$$`, and record every ancestor whose command contains `.local/bin/pi` or `coding-agent/dist`.
- The owner closes every other Pi session and confirms that no other SDK host runs, such as an OpenIntent worker. `pgrep -fl '\.local/bin/pi|coding-agent/dist/(bundle/)?cli\.js'` must then list only the recorded pids.
- The implementing session runs no `/new`, `/resume`, `/fork` or `/reload` until it exits.
- Steps 7 and 8 each start a session on the new build, which loads no old extension. The owner quits each before the next step, and the `pgrep` check then lists only the recorded pids again.
- Nobody edits the main checkout during the interval.

The rollback runs inside the same interval, under the same checks.

1. In the main checkout, `git rev-parse --abbrev-ref HEAD` must print `personal`, and `git diff --cached --name-only` must print nothing. `git status --short` may list only files under `.pi/` and untracked files under `docs/plans/`. Anything else means stop and ask. Move this plan aside, compare it with the committed copy, then delete the moved copy.
2. Run `git merge --ff-only feat/tokensave-builtin`. When it fails because `personal` moved, stop and ask. The fix is to rebase the branch and rerun the T1 to T6 validation.
3. **Settings.** `~/.pi/agent/settings.json.bak-tokensave` must not exist; otherwise, stop. Run `cp -n` to create it, and confirm that the two SHA-256 values are equal. When the original differs from Section 3's hash, re-read it and confirm the round-trip check still prints `exact`. Then run a Node script, recorded in the path list, that:
   - reads the file and computes its SHA-256; it refuses when that differs from the backup's;
   - parses the text and checks that `JSON.stringify(parsed, null, 2)` equals it;
   - removes the one `packages` element `"../../Developer/ai/pi-tokensave"`, refusing when it is absent or appears twice;
   - sets `forkBuiltins["pi-tokensave"] = { autoManageBranches: true }`, refusing when that key already exists, and keeping any other `forkBuiltins` entry;
   - re-reads the file and refuses when its SHA-256 changed since the first read;
   - writes `JSON.stringify(parsed, null, 2)` with no final newline.
   Verify with `JSON.parse`, confirm 14 packages remain, and record the new SHA-256.
4. **AGENTS.md.** `~/.pi/agent/AGENTS.md.bak-tokensave` must not exist; otherwise, stop. Create it with `cp -n`, and compare the SHA-256 values. When the original differs from Section 3's hash, stop and ask. Build the expected file with a Node script, recorded in the path list, that reads the backup and applies these edits by exact string match. Each match must occur exactly once, or the script refuses.

| Match | Edit |
| --- | --- |
| `\n\n<!-- pi-tokensave:start -->` through `<!-- pi-tokensave:end -->` (lines 38 to 92) | Delete. |
| The paragraph starting `**TokenSave is enabled** only when` (line 94) and its following blank line | Delete; the injection gate and R8 replace it. |
| The paragraph starting `If a code question cannot be answered by` (line 96) and its following blank line | Delete; T6 moves it into the rules. |
| The paragraph starting `Never spawn a subagent for codebase research` (line 98) | Replace with: "When a task needs a subagent, `Explore` and `Plan` run `prompt_mode: replace` and do not inherit this file. Their agent definitions carry the cross-tool routing below. Anything else you need from this file has to go in the prompt." |
| `- **TokenSave** (when enabled):` (line 104) | Replace with `- **TokenSave** (when its tools are available):`. |

   The script writes `/tmp/tokensave-builtin-impl-AGENTS.expected.md`. Show the owner `diff ~/.pi/agent/AGENTS.md.bak-tokensave /tmp/tokensave-builtin-impl-AGENTS.expected.md` and get approval. Recheck that `~/.pi/agent/AGENTS.md` still has the backup's SHA-256, then copy the expected file over it. `cmp ~/.pi/agent/AGENTS.md /tmp/tokensave-builtin-impl-AGENTS.expected.md` must exit 0, and `grep -c 'pi-tokensave' ~/.pi/agent/AGENTS.md` must print 0. Record the new SHA-256.
5. Confirm that `git diff --quiet ORIG_HEAD HEAD -- package-lock.json` exits 0, then run `npm run build:offline`.
6. Run `pi list` and confirm that its output has no `pi-tokensave`.
7. **Unfenced session.** Run `touch /tmp/tokensave-builtin-cutover.marker`, then start `pi --unfenced` in `/Users/paolof/Developer/ai/pi`. Send one message that holds a unique phrase, such as `amber-kestrel-` plus random digits. Ask the model to call `tokensave_find_symbol` for `derivedPackageReads` with `project: "../pi-fence"`. Then run `find ~/.pi/agent/sessions -name '*.jsonl' -newer /tmp/tokensave-builtin-cutover.marker -exec grep -l '<phrase>' {} +`. It must print exactly one file, excluding the implementing session's own file (`PI_SESSION_FILE`). That file must contain:
   - `pi-tokensave:start`, which now only the injection can supply;
   - a `tokensave_find_symbol` result holding `/Users/paolof/Developer/ai/pi-fence/src/profile/loader.ts`;
   - no `"isError":true`.
8. **Fenced session.** Repeat step 7 with `pi --profile general` and a new phrase. Then run `grep -l pi-tokensave ~/.pi-fence/violations/<newest journal>`; it must print nothing, so no denial names the old fork path.
9. **Check.** `cmp ~/.pi/agent/AGENTS.md /tmp/tokensave-builtin-impl-AGENTS.expected.md` still exits 0, so no old session rewrote the block. `settings.json` still has step 3's recorded SHA-256. When either fails, stop and ask. The quiet interval continues through T10.

**Rollback.**
1. With approval, recheck the branch and the empty index as in step 1. Run `git revert --no-commit <T2 commit>`. The staged paths must equal `git show --name-only --format= <T2 commit>`. Commit with `fix(coding-agent): withdraw the pi-tokensave built-in`, then run `npm run build:offline`.
2. Run `node /tmp/tokensave-builtin-impl-dist-probe.mjs /Users/paolof/Developer/ai/pi /Users/paolof/Developer/ai/pi-fence`; it must print `"tokensaveTools":0`. When the build or this check fails, stop with the settings entry still removed, and ask.
3. Restore `AGENTS.md` from its backup when the file still has its post-edit hash; otherwise, stop and ask.
4. Restore `settings.json` from its backup when the file still has its post-edit hash; otherwise, re-add the package line and delete `forkBuiltins["pi-tokensave"]` with the step 3 script's checks. Verify with `JSON.parse`.

**Validation.** Step 6 shows no `pi-tokensave`. Steps 7 and 8 each find exactly one session file meeting all three conditions. Step 9's two checks pass.

### T10. Record results and clean up

1. Write `docs/plans/tokensave-builtin.results.md` with these sections: `## Commits`, `## Baseline comparisons`, `## Built outputs`, `## Cutover` (hashes, backup paths, both session files), `## Deviations` and `## Open user actions`.
2. The open user actions are:
   - optionally delete `~/.pi/agent/pi-tokensave.json`, which nothing reads;
   - delete the two `.bak-tokensave` backups once the cutover needs no rollback;
   - add pi-tokensave to OpenIntent's list of SDK-provided resources;
   - optionally grant the fence read and write on `~/.tokensave/`, which TokenSave touches but does not need;
   - after the implementing session exits, confirm in the first new session that `grep -c pi-tokensave ~/.pi/agent/AGENTS.md` prints 0.
3. With approval, commit the results file on `personal`, staging it by path: `docs: pi-tokensave built-in results`.
4. Check each worktree with `git status --short` before removing it:
   - `/tmp/tokensave-builtin-probe` must show exactly `M packages/coding-agent/src/core/fork-builtins.ts`, `M packages/coding-agent/test/fork-builtins.test.ts`, `?? packages/coding-agent/src/core/fork-builtins/tokensave/` and `?? packages/coding-agent/test/fork-builtins/tokensave/`. Its contents must match the manifest `/tmp/tokensave-builtin-probe-manifest.txt` (26 files, recorded at review pass 1): from the probe root, `shasum -a 256 -c /tmp/tokensave-builtin-probe-manifest.txt` must print only `OK` lines. Then `find <the four paths> -type f \| wc -l` must print 26. Appendix B and the source fork hold all of it.
   - `/tmp/tokensave-builtin-baseline` must be clean.
   - `/tmp/tokensave-builtin-validate` and `/tmp/tokensave-builtin` must show no uncommitted changes.
   - `lsof -d cwd 2>/dev/null | grep -F "$(realpath <worktree path>)"` must print nothing; `/tmp` resolves to `/private/tmp` (Section 3), so the literal path would miss a process.
   - Every `!!` line of `git status --short --ignored` must name `node_modules/`, a `dist/` directory, or `packages/ai/src/providers/data/`. The recorded install, build and model-data copy in that worktree created all of them. Any other ignored entry means stop and ask.
   - Any other status means stop and ask. Otherwise, with approval, run `git worktree remove --force` on each, then `git worktree prune`.
5. Delete only recorded paths: Appendix A's list, `/tmp/tokensave-builtin-cutover.marker`, and each line of `/tmp/tokensave-builtin-impl-paths.txt`, that file last. Delete no glob. Before deleting each path, confirm it still exists and has the kind the record names (file or directory). A path absent from every record means stop and ask.
6. With approval, delete the `feat/tokensave-builtin` branch.
7. Rerun T9 step 9's two checks. Then tell the owner that the quiet interval ends when this session exits, and that the session must exit without `/new`, `/resume`, `/fork` or `/reload`.

**Validation.**
- `grep -cE '^## (Commits|Baseline comparisons|Built outputs|Cutover|Deviations|Open user actions)$' docs/plans/tokensave-builtin.results.md` prints 6.
- For each commit of T1 to T7, `grep -cF <short hash>` on the results file prints at least 1.
- The results file contains each of: the new `settings.json` SHA-256 and the new `AGENTS.md` SHA-256 from T9, both backup paths, and both T9 session file names.
- `git worktree list` shows none of the four worktrees.
- Step 7's `cmp` exits 0 and the `settings.json` hash matches.

## 7. Test plan

| Layer | What it proves | When it runs |
| --- | --- | --- |
| Converted tests | The copied module behaves as at `2a626d3b`: 148 tests. | Every `./test.sh`. |
| T3 to T6 tests | No `AGENTS.md` write; settings and session mode; the `project` parameter; the rules and the empty-index check. | Every `./test.sh`. |
| `fork-builtins.test.ts` | pi-tokensave registers hidden, with its six tools and `/tokensave-mode`, and honors the switch. | Every `./test.sh` on a built tree, and after each upstream Pi merge. |
| Upstream suites | The change breaks no upstream behavior in any workspace. | After T1 to T6, under the Section 5 regression rule. |
| T8 mode checks | The built SDK registers the six tools and executes `tokensave_status`. RPC and print mode, unbundled and bundled, run `/tokensave-status` with no model call. The switch removes the built-in. | During T8. |
| Cutover sessions | The live CLI, fenced and unfenced, injects the rules and answers a foreign-project query. | During T9. |

Mutation checks:
- Removing the `tokensave` entry from `FORK_OWNED_BUILTINS` fails 1 test (measured).
- T3, T4, T5 and T6 each name the mutation their tests must catch.

**Not proved by this plan.**
- Guard precision on real searches beyond the tests.
- Behavior inside OpenIntent workers.
- Empty-index behavior against a real 0-node index; the tests fake the `status` output, because `tokensave init` writes to `~/.tokensave/`.
- The bundled CLI in interactive TUI mode. T8 runs the bundle in RPC and print mode, and T9 runs the unbundled TUI, which the live launcher uses (Section 3). SPIKE-0003 proved that the bundled TUI loads built-ins in general.
- A model-driven tool call in RPC or print mode. T8 runs a command there, which proves the built-in loads and runs; T9 proves model-driven tool calls in the TUI.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| The conversion changes an assertion. | T1 stops on any failure, and the test count must stay 148. |
| Two copies of the tools load at cutover. | T9 removes the settings entry before the build. |
| An `AGENTS.md` edit removes owner text beyond the plan. | T9 compares the edited file with its backup by `diff`, and both files are hashed. |
| A foreign-project path points the model at the wrong file. | R10: structured foreign paths are absolute, context carries a relative-path header, and inputs strip the root. T5 tests each. |
| A running old session rewrites the `AGENTS.md` block during or after the cutover. | T9 closes every other Pi session, checks with `pgrep` against recorded pids, and forbids session switches in the implementing session until it exits. Step 9 and T10 step 7 recheck the file byte for byte; T10 leaves a final check to the owner. |
| The empty-index lookup delays the first prompt or a guarded search. | Each root is probed once until reset; a probe takes 0.2 s on `pi/` and times out after 4 s. |
| A flaky test reads as a regression, or the reverse. | Section 5 tolerates only the two listed flakes, and only when the candidate fails one in at most 1 of 3 runs. |
| A fenced sync fails in a repository without a write grant. | The existing one-time warning reports it; T10 lists the fence grant as a user action. |

## 9. Done criteria

- T0 to T10 are committed or complete, as Section 6 lists.
- `npm run check` exits 0 on the branch head.
- The Section 5 regression rule holds after T6, for coding-agent and for `./test.sh`.
- Every T8 validation line passes: SDK, RPC and print for both entries, the switch, and the bundle grep.
- Both T9 sessions meet their three conditions.
- `~/.pi/agent/settings.json` no longer lists pi-tokensave and holds `forkBuiltins["pi-tokensave"]`; its backup exists.
- `~/.pi/agent/AGENTS.md` holds no `pi-tokensave` marker; its backup exists.
- `docs/plans/tokensave-builtin.results.md` is committed on `personal`.

## Appendix A. Probe measurements

**Import census** of the copied `src/*.ts` after step 3: relative `./*.ts` files; `../../extensions/types.ts` (3 files); `node:child_process`, `node:fs`, `node:os`, `node:path`; `typebox` (1 file); `@earendil-works/pi-ai` (1 file).

**Static checks** on the copied module.

| Check | Result |
| --- | --- |
| `npx biome check --write` | 12 files fixed. 1 error: `noAssignInExpressions` at `guard.ts:78`. 1 warning: an unused suppression at `runner.ts:293` of the source (line 308 after formatting). |
| The same, after Appendix B's two fixes | `No fixes applied`, 0 findings, with `--error-on-warnings`. |
| `npx tsgo --noEmit`, whole repository | exit 0, 0 errors. |
| `npx biome check --write` on the converted tests | 8 `noAssignInExpressions` errors in `commands.test.ts`, lines 47, 65, 84, 98, 113, 125, 146 and 165. T1 fixes them. |

**Test API census** of the source tests: `assert.equal` 170, `assert.ok` 54, `assert.match` 50, `assert.deepEqual` 32, `assert.doesNotMatch` 9, `assert.doesNotReject` 4, `assert.fail` 1; `import test from "node:test"` 12; `t.skip` 1, in the smoke test.

**Test parity.**

| Run | Result |
| --- | --- |
| `node --experimental-strip-types --test --test-reporter=tap` on the 11 files, in the source fork | `# tests 148`, `# pass 148`, `# fail 0`. The fork stayed clean. |
| vitest on the 11 converted files, import swap only | 11 files, 148 tests passed; 58 ms of test time. |

**Registration.**

| Check | Result |
| --- | --- |
| `fork-builtins.test.ts` with Appendix B's changes, built tree | 11 of 11 pass. |
| The same, without the `tokensave` entry | 1 fails, 10 pass. |
| The same, unbuilt tree (baseline and probe) | The file fails to load: `Failed to resolve entry for package "@earendil-works/pi-coding-agent"`. |

**Suite runs** (coding-agent, built trees, `failing-tests.mjs`, one at a time).

| Run | Tests | Failures |
| --- | --- | --- |
| Baseline 1, 2, 4, 5, 6 | 3,779 (3,729 run, 50 skipped) | none |
| Baseline 3 | 3,779 | `footer-data-provider` "updates the cached branch when the reftable directory changes" |
| Probe 1 | 3,928 (3,878 run) | `agent-session-concurrent` "should throw when prompt() called while streaming" |
| Probe 4 | 3,928 | the `footer-data-provider` test |
| Probe 2, 3, 5, 6 | 3,928 | none |

The probe runs 149 more tests: 148 converted and 1 registration test.

**`./test.sh` runs.**

| Run | Exit | Failures |
| --- | --- | --- |
| Baseline 1 and 2 | 0 | none |
| Probe 1 | 1 | the `footer-data-provider` test |
| Probe 2 | 1 | `agent-session-concurrent` "should throw when prompt() called while streaming" and "should allow steer() while streaming" |

`agent-session-concurrent.test.ts` alone passed 10 of 10 runs in each worktree. Its failing tests wait 10 ms with `setTimeout` and then expect `isStreaming` to be `true`. The load average was 11 to 18 during these runs. The vcc results record the same test failing on BASE `43aca69ad`.

**Unbuilt baseline** (for reference): 2 runs with 4 failures each and a load failure of `fork-builtins.test.ts`. The build removes all of them.

**Unhandled error.** Probe `./test.sh` run 2 also reported `Errors 1 error`: an unhandled `No API key found for anthropic.` rejection that originated in `test/agent-session-concurrent.test.ts`, in the same run as that file's two `FAIL` lines. No baseline log shows an unhandled error.

**Mode probes** (review pass 2), with `/Users/paolof/Developer/ai/pi-fence` as the cwd and a temporary agent directory.

| Check | Probe worktree | Baseline worktree |
| --- | --- | --- |
| `dist-probe.mjs`, switch unset | `"paths":["<inline:@juicesharp/rpiv-ask-user-question>","<inline:vcc-recall>","<inline:tokensave>"],"errors":[],"tokensaveTools":6,"statusRan":true` | not run |
| `dist-probe.mjs`, `PI_FORK_BUILTINS=off` | `"paths":[],"errors":[],"tokensaveTools":0,"statusRan":false` | not run |
| `rpc-probe.mjs`, `dist/cli.js` | 2 lines; one `notify` holding `TokenSave v7.12.1` | 1 line; no `notify` |
| `rpc-probe.mjs`, `dist/bundle/cli.js` | 2 lines; one `notify` holding `TokenSave v7.12.1` | 1 line; no `notify` |
| print, `dist/cli.js` | exit 0, empty output | exit 1: `No API key found for the selected model.` |
| print, `dist/bundle/cli.js` | exit 0 | not run |
| print, `dist/cli.js`, `PI_FORK_BUILTINS=off` | exit 1 | not run |
| print with `--mode json`, `dist/cli.js` | exit 0; only the `session` header line | not run |

**Temporary paths** created by the probe:
- worktrees `/tmp/tokensave-builtin-probe` and `/tmp/tokensave-builtin-baseline`;
- `/tmp/tokensave-builtin-probe-src/` (the `git archive` extract);
- `/tmp/tokensave-builtin-fb.bak` and `/tmp/tokensave-builtin-probe-manifest.txt`;
- scripts `/tmp/tokensave-builtin-dist-probe.mjs` and `/tmp/tokensave-builtin-rpc-probe.mjs`;
- outputs `/tmp/tokensave-builtin-print-probe.out`, `-print-baseline.out` and `-print-json.out`;
- reports `/tmp/tokensave-builtin-base-1.json`, `-base-2.json`, `-base-built-1.json` to `-base-built-6.json`, `-probe-1.json` to `-probe-6.json`;
- logs `/tmp/tokensave-builtin-base-1.log`, `-base-2.log`, `-baseline-install.log`, `-probe-install.log`, `-baseline-build.log`, `-probe-build.log`, `-probe-biome.log`, `-probe-biome-tests.log`, `-probe-tsgo.log`, `-probe-vitest-1.log`, `-base-testsh.log`, `-base-testsh-2.log`, `-probe-testsh.log`, `-probe-testsh-2.log`, and `-conc-baseline-1.log` to `-10.log`, `-conc-probe-1.log` to `-10.log`.

These paths use the prefix `/tmp/tokensave-builtin-`. The implementation's own outputs use `/tmp/tokensave-builtin-impl-` (Section 5), so they never collide with the probe's.

## Appendix B. Verified code

**`runner.ts` hand fix.** Delete the suppression comment above the ANSI regex in `stripAnsi`; `biome.json` turns `noControlCharactersInRegex` off, so it suppresses nothing.

**`guard.ts` hand fix.** The tokenizer body, as it passed the probe:

```ts
function tokenize(command: string): string[] {
	const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
	return Array.from(command.matchAll(regex), (match) => match[1] ?? match[2] ?? match[3] ?? "");
}
```

**Test conversion script**, as it ran in the probe from the extracted `test/` directory. T1 then applies the assertion mapping.

```sh
for f in *.test.ts; do
	[ "$f" = smoke-real-tokensave.test.ts ] && continue
	sed -e 's#import test from "node:test";#import { test } from "vitest";#' \
		-e 's#"\.\./src/\([a-z-]*\)\.ts"#"../../../src/core/fork-builtins/tokensave/\1.ts"#g' \
		-e 's#from "@earendil-works/pi-coding-agent"#from "../../../src/core/extensions/types.ts"#' \
		"$f" > "<worktree>/packages/coding-agent/test/fork-builtins/tokensave/$f"
done
```

**`packages/coding-agent/src/core/fork-builtins.ts`**, the probe's diff against BASE:

```diff
 import type { ExtensionFactory, InlineExtension } from "./extensions/types.ts";
+import pluginTokensave from "./fork-builtins/tokensave/index.ts";
 import { registerRecallTool } from "./fork-builtins/vcc-recall/recall.ts";
@@
 export const FORK_OWNED_BUILTINS: readonly InlineExtension[] = [
 	{ name: "vcc-recall", factory: registerRecallTool, hidden: true },
+	{ name: "tokensave", factory: pluginTokensave, hidden: true },
 ];
```

**`packages/coding-agent/test/fork-builtins.test.ts`**, the test added after "registers vcc_recall as a fork-owned built-in":

```ts
	it("registers the TokenSave tools and commands as a fork-owned built-in", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const subject = loader([]);
		await subject.reload();

		const builtIn = subject.getExtensions().extensions.find((extension) => extension.path === "<inline:tokensave>");
		expect(builtIn?.hidden).toBe(true);
		expect([...(builtIn?.tools.keys() ?? [])].sort()).toEqual([
			"tokensave_context",
			"tokensave_find_symbol",
			"tokensave_impact",
			"tokensave_search",
			"tokensave_status",
			"tokensave_symbol",
		]);
		expect(builtIn?.commands.has("tokensave-mode")).toBe(true);
	});
```

**`dist-probe.mjs`**, as it ran against `/tmp/tokensave-builtin-probe` (Appendix A, mode probes).

```js
// Probe: the built SDK registers pi-tokensave under noExtensions, runs tokensave_status on a real
// indexed project, and PI_FORK_BUILTINS=off removes it. Usage: node <this> <worktree> <indexed project>
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [worktree, project] = process.argv.slice(2);
const sdk = await import(pathToFileURL(join(worktree, "packages/coding-agent/dist/index.js")).href);
const root = mkdtempSync(join(tmpdir(), "tokensave-builtin-dist-"));
try {
	const loader = new sdk.DefaultResourceLoader({
		cwd: project,
		agentDir: root,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
	});
	await loader.reload();
	const { extensions, errors } = loader.getExtensions();
	const tokensave = extensions.find((extension) => extension.path === "<inline:tokensave>");
	const names = [...(tokensave?.tools.keys() ?? [])].filter((name) => name.startsWith("tokensave_"));
	let statusText = "";
	const status = tokensave?.tools.get("tokensave_status");
	if (status) {
		const result = await status.definition.execute("probe", {}, undefined, undefined, { cwd: project, agentDir: root });
		statusText = result.content[0].text;
	}
	console.log(
		JSON.stringify({
			switch: process.env.PI_FORK_BUILTINS ?? "unset",
			paths: extensions.map((extension) => extension.path),
			errors,
			tokensaveTools: names.length,
			statusRan: /nodes: \d+/.test(statusText),
		}),
	);
} finally {
	rmSync(root, { recursive: true, force: true });
}
```

**`rpc-probe.mjs`**, as it ran against both worktrees and both entry points.

```js
// Probe: does RPC mode run a fork-owned built-in's command (/tokensave-status) without a model call?
// Usage: node /tmp/tokensave-builtin-rpc-probe.mjs <worktree> <cwd> [entry relative to packages/coding-agent]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [worktree, cwd, entry = "dist/cli.js"] = process.argv.slice(2);
const agentDir = mkdtempSync(join(tmpdir(), "tokensave-builtin-rpc-agent-"));
const child = spawn(
	process.execPath,
	[join(worktree, "packages/coding-agent", entry), "--mode", "rpc", "--no-session", "--no-extensions"],
	{ cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" }, stdio: ["pipe", "pipe", "pipe"] },
);
let out = "";
let err = "";
child.stdout.on("data", (d) => {
	out += d;
});
child.stderr.on("data", (d) => {
	err += d;
});
child.stdin.write(`${JSON.stringify({ id: "1", type: "prompt", message: "/tokensave-status" })}\n`);
setTimeout(() => {
	child.kill();
}, 8000);
child.on("exit", () => {
	const lines = out.split("\n").filter(Boolean);
	const notify = lines.map((l) => JSON.parse(l)).filter((m) => m.type === "extension_ui_request" && m.method === "notify");
	console.log(JSON.stringify({ lines: lines.length, notify: notify.map((n) => String(n.message).slice(0, 160)), stderr: err.slice(0, 300) }));
	rmSync(agentDir, { recursive: true, force: true });
});
```

## Review history

### Pass 1: 2026-09-26, reviewer model openai-codex/gpt-6-sol

| Angle | Verdict |
| --- | --- |
| traceability | FAIL |
| assumptions | FAIL |
| completeness | PASS_WITH_FINDINGS |
| feasibility | FAIL |
| validation | FAIL |
| safety | PASS_WITH_FINDINGS |

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | `tokensave_context` returns free text, so the approved path prefix cannot reach it (traceability, assumptions). | Ruled R10: structured paths absolute, context keeps its text under a relative-path header. | Section 3: `context` returns markdown. |
| 2 | Absolute foreign paths fed back into `tokensave_impact` find 0 dependents instead of 28 (assumptions). | Ruled R10: file inputs strip a leading root; T5 tests it. | Section 3: the CLI accepts only root-relative files. |
| 3 | The rules text says all paths are relative, contradicting the prefix (traceability, assumptions). | Accepted: T6's Projects paragraph states both forms. | T6. |
| 4 | R9 said reconciliation runs at the first tool call, yet the session root reconciles at `session_start` (traceability). | Accepted as wording: the ruling meant foreign roots; the session root keeps today's behavior. | Source `src/index.ts` `session_start`; R9 table row. |
| 5 | Five tools check the cwd project before using `project` (completeness). | Accepted: T5 replaces the check and tests an uninitialized cwd. | Source `src/tools.ts:80,93,150,419,544,745,901`. |
| 6 | The empty-index cache never refreshes after init or sync (assumptions, completeness). | Accepted: planner default for cache refresh; T6 test for empty to ready. | T6. |
| 7 | T3 uses `getCallableTools` and `agentDir`, which the test fakes lack (feasibility). | Accepted: T3 updates the fakes. | Source `test/index.test.ts:23-44`. |
| 8 | Mapping `doesNotReject(fn)` to `await fn` never calls the tool (feasibility). | Accepted: `await fn()`, plus a mutation check in T1. | Source `test/tools-execution.test.ts:451,591,601,680`. |
| 9 | No test proves `project` on each of the six tools (validation). | Accepted: a six-tool table test with per-tool mutations. | T5. |
| 10 | The known-flake exception could excuse a persistent failure (validation). | Accepted: a frequency limit of 1 in 3; isolated runs are diagnosis only. | Section 5. |
| 11 | The bundle is "proved" by a string search (validation). | Accepted: recorded as not proved. | Section 3: the live launcher runs `dist/cli.js`. |
| 12 | README, `AGENTS.md` edit and results record were checked by eye (validation). | Accepted: string checks, an expected file with `cmp`, and results content checks. | T7, T9, T10. |
| 13 | Running old sessions can rewrite the `AGENTS.md` block or race the settings write (safety). | Accepted: close other sessions, recheck hashes before writing, and a final byte check. | Section 3; T9 steps 3, 4 and 9. |
| 14 | Forced probe removal checks status paths, not contents (safety). | Accepted: a 26-file SHA-256 manifest. | `/tmp/tokensave-builtin-probe-manifest.txt`. |
| 15 | Glob cleanup can delete another session's files (safety). | Accepted: a path record and no globs. | Section 5 step 6; T10 step 5. |
| 16 | The source is 3,119 lines, not 3,420 (assumptions). | Accepted. | Sum of `wc -l` over the 12 files. |

Sections changed: 2.1, 2.3, 3, 5, 6 (T1, T3, T5, T6, T7, T9, T10), 7, 8. Pass 2 re-reviewed these changes.

### Pass 2 (re-review): 2026-09-26, reviewer model openai-codex/gpt-6-sol

| Angle | Verdict |
| --- | --- |
| traceability | FAIL |
| assumptions | FAIL |
| completeness | PASS_WITH_FINDINGS |
| feasibility | FAIL |
| validation | FAIL |
| safety | FAIL |

Pass 2 confirmed the pass-1 dispositions on the uninitialized cwd, the test fakes, the `doesNotReject` mapping, the six-tool table, the frequency limit, the source line count, the settings hashes and the unbundled launcher. It raised these findings:

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | A foreign empty index can still be guarded, because the guard never probed its target root (traceability, assumptions). | Accepted: the guard probes an `unknown` target root once; tests for a foreign empty root and for two roots. | Planner default "Empty-index lookup and refresh"; T6. |
| 2 | Absolute path filters bypass the strip in `tokensave_find_symbol`'s local filtering (traceability, validation). | Accepted: the strip runs at the start of `execute`; a `pathInclude` test. | Source `src/tools.ts:436-453`. |
| 3 | Ambiguity lists, the "Next step: read" line and literal search results keep relative paths (traceability, completeness). | Accepted: T5 lists every output site and tests each structured one. | Source `src/tools.ts:401-408`, `:516`, literal branch. |
| 4 | The moved subagent rule lost "for the target repository" (traceability). | Accepted: the rule names indexed repositories, the session's or through `project`. | `~/.pi/agent/AGENTS.md:98`. |
| 5 | Impact by file sends the file to `diff_context` and `affected` too; the test covered only `file_dependents` (assumptions, validation). | Accepted: the test asserts all three. | Source `src/tools.ts:958`, `:977`, `:1004`. |
| 6 | The `pgrep` pattern matches no live Pi session (feasibility, safety, assumptions). | Accepted: the pattern names `.local/bin/pi` and both CLI entries, checked against recorded ancestor pids. | Section 3: `pgrep` output. |
| 7 | The implementing session loads the old extension and could restore the block after the interval ends (safety). | Accepted: the interval lasts until the implementing session exits; session switches are forbidden; T10 step 7 rechecks; the owner's final check is an open user action. | Section 3; T9 preamble; T10 steps 2 and 7. |
| 8 | T6's sync mutation could pass, because `before_agent_start` re-probed empty roots (feasibility). | Accepted: only `unknown` roots are probed; the empty-to-ready test uses the guard with no prompt in between. | T6 tests. |
| 9 | A reconciliation result does not say whether `sync` ran (feasibility). | Accepted: `synced: boolean` on the result, with lifecycle tests. | Source `src/branch-lifecycle.ts:13-16`, `:131-133`. |
| 10 | Command path arguments had no test (completeness). | Accepted: one test per command, and a mutation for `/tokensave-sync`. | Source `src/commands.ts:88-101`. |
| 11 | RPC, print and SDK tool execution were not proved (validation). | Accepted: probed now; T8 runs SDK execution, RPC and print on both entries. Bundled TUI and model-driven calls outside the TUI are recorded as not proved. | Appendix A, mode probes. |
| 12 | `./test.sh` comparison ignored unhandled errors and the exit status (validation). | Accepted: step 3 collects unhandled-error origins and stops on a nonzero exit with nothing collected. | `/tmp/tokensave-builtin-probe-testsh-2.log:182-210`. |
| 13 | No test holds an empty and a ready root together (validation). | Accepted: the two-roots test. | T6. |
| 14 | Forced removal missed `/private/tmp` in the `lsof` check and did not account for ignored contents (safety). | Accepted: `realpath` in the check; every ignored entry must match the recorded install, build and data copy. | Section 3: `/tmp` resolves to `/private/tmp`. |

Sections changed: 1 (opening paragraph), 2.1, 2.3, 3, 4, 5, 6 (T5, T6, T8, T9, T10), 7, 8, 9, Appendix A, Appendix B. Changes made after this pass and not yet reviewed: all of those.

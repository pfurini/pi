# Native vcc_recall as a fork-owned built-in

This plan replaces the npm extension `@sting8k/pi-vcc` with a native `vcc_recall` tool that ships inside the fork. The tool keeps its name, parameters and output, and reads the session from memory instead of from disk. It lives as fork-owned code in `packages/coding-agent/` and loads through the built-in list of ADR-0009. Its source is report decision D14 in `docs/plans/built-in-extensions.report.md`. A probe on 2026-09-25 verified every load-bearing claim. No later phase follows.

## 1. Authority and workflow

| Source | Role |
| --- | --- |
| This plan | The implementation contract. It overrides the source where Section 2 or Section 4 names a difference. |
| `docs/plans/built-in-extensions.report.md` | Decision D14, question Q7, and the `vcc_recall` rows of Sections 4.1, 4.3, 4.5 and 5.3. |
| `docs/adr/ADR-0009-built-in-extensions.md` | The built-in mechanism. T3 amends it. |
| `docs/adr/ADR-0003-fork-first-merge-hygiene.md` | New code goes in new files; upstream-owned files get no line. |
| `~/.pi/agent/npm/node_modules/@sting8k/pi-vcc/` (version 0.8.0) | The code T1 ports. |
| `AGENTS.md` (repository) | Git, lockfile, check and test rules. |

The `planning-changes` skill wrote this plan and runs its review passes. A fresh session implements it from the handoff prompt.

## 2. Decisions

### 2.1 User rulings

| # | Ruling | Consequence |
| --- | --- | --- |
| R1 | 2026-09-25: the tool lives as a fork-owned module in `packages/coding-agent/src/core/fork-builtins/vcc-recall/`. It registers as an inline factory from `fork-builtins.ts`. | Zero upstream-owned lines. Biome, `tsgo`, the import check and vitest cover the code. ADR-0009 gains a second built-in kind (T3). |
| R2 | 2026-09-25: port pi-vcc 0.8.0's recall code onto in-memory session entries, with MIT attribution. | The tuned search, truncation and drill-down behavior stays; the JSONL reader goes. pi-vcc's recall tests port with it. |
| R3 | 2026-09-25: the tool keeps the name `vcc_recall`, its parameters, description, prompt snippet and output text. | The model sees no change. |
| R4 | 2026-09-25: only the tool is kept. The compaction hook, `/pi-vcc` and `/pi-vcc-recall` go at cutover. | T5 removes the npm package from `~/.pi/agent/settings.json`. `/pi-vcc-recall` had 0 uses across this machine's sessions. |

### 2.2 Source questions

| # | Status | Answer used |
| --- | --- | --- |
| Q7 | Resolved by R1 | A module inside `packages/coding-agent/`, not option (a) `packages/builtins/vcc-recall/` nor option (b) a core tool. |

### 2.3 Differences from the source

| Source item | This plan | Reason |
| --- | --- | --- |
| Q7 recommendation (a): a package under `packages/builtins/vcc-recall/` | A module under `packages/coding-agent/src/core/fork-builtins/vcc-recall/` (R1) | Biome and `tsgo` skip `packages/builtins/` (Section 3). That directory holds ported packages that sync from an upstream; this code has none. |
| Section 4.3: `vcc_recall` reads `~/.pi/agent/sessions` and `~/.pi/agent/pi-vcc-config.json` | The tool reads `ctx.sessionManager` in memory and loads no config | The recall code never imports pi-vcc's settings module, and in-memory entries match the file (Section 3). |
| Section 5.4: remove a ported package's `settings.json` entry after the rebuild | T5 removes the entry before the rebuild | Two `vcc_recall` tools never load together. Phase 1 used the same order. |
| Sections 4.5 and 5.3: uninstall `@sting8k/pi-vcc` when the rewrite lands | T5 removes its `settings.json` entry, which stops it loading, compaction hooks included. Deleting its npm directory stays an optional user action (T6). | The settings removal ends every pi-vcc hook and command. `pi remove` stayed unrun, because it may run the configured `npmCommand`, which other packages' patches rely on (report Section 4.5). |

### 2.4 Approvals

This plan adopts phase 1's approval policy (`docs/plans/built-in-extensions-phase1.plan.md` R4). The user may override it before implementation.

Standing approval: install, `npm run build:offline`, `npm run check`, `./test.sh` and single test files inside `/tmp` worktrees.

These actions always need the user's explicit yes:
- any install, build or commit in the main checkout;
- any commit that includes `package-lock.json` (none is expected);
- the edit of `~/.pi/agent/settings.json`;
- the fast-forward of `personal`;
- removing any worktree or deleting any branch.

## 3. Verified facts

The probe ran on 2026-09-25 against `personal` at `6ed010550afb3d0bef0b296a7725253fe9358cb9`. It used the worktrees `/tmp/vcc-recall-probe` (the change) and `/tmp/vcc-recall-baseline` (clean). Test runs used `.pi/skills/planning-changes/scripts/failing-tests.mjs` from the main checkout, under `./test.sh` isolation.

| Fact | Evidence |
| --- | --- |
| The tool calls load no config. | The import closure of pi-vcc's `src/tools/recall.ts` holds 12 files and 1,634 lines (`wc -l`); none imports `src/core/settings.ts`. External imports: `typebox`, the two Pi packages, `fs`. |
| In-memory entries equal the file's `#N` sequence. | Appendix A: 3,455 of 3,456 session files, subagent sessions included; 292,626 message entries; 48 with compaction; 0 mismatches between the file scan and `SessionManager.open().getEntries()`. |
| Compacted entries stay in memory. | `packages/coding-agent/src/core/session-manager.ts:1744`: "Entries cannot be modified or deleted." |
| No local session has messages off the active branch. | Appendix A: 0 of 3,455 sessions. `scope: 'all'` therefore has no real-data coverage. |
| Tools receive a read-only session manager. | `packages/coding-agent/src/core/extensions/types.ts:330` types `ctx.sessionManager` as `ReadonlySessionManager`, which offers `getEntries`, `getBranch` and `getEntry` (`session-manager.ts:303`). |
| Biome and `tsgo` skip `packages/builtins/`. | `biome.json` `files.includes` and `tsconfig.json` `include` list `packages/*/src` and `packages/*/test`, with no `packages/builtins` pattern. |
| The copied closure needs only mechanical fixes. | Appendix A: `tsgo` 0 errors. Biome: 1 manual error, in `jsonl.ts`, which T1 does not port. Everything else is auto-fixed by `biome check --write`. |
| The code holds 17 uses of `any`. | `grep -c '\bany\b'`: `search-entries.ts` 7, `drill-down.ts` 3, `global-indices.ts` 3, `render-entries.ts` 3, `load-messages.ts` 1. |
| coding-agent source never imports its own package name. | No `from "@earendil-works/pi-coding-agent"` import exists in `packages/coding-agent/src` outside comments. pi-vcc's `recall.ts` has one. |
| coding-agent already depends on `typebox`. | `packages/coding-agent/package.json`: `typebox` 1.3.27. |
| An inline factory registers the tool with no upstream-owned line. | Appendix A: `fork-builtins.test.ts` passes 8 of 8 with Appendix B's changes; `git diff` touches only the fork-owned `fork-builtins.ts` and its test. |
| The new test guards the registration. | Appendix A: without `FORK_OWNED_BUILTINS` in `forkBuiltInExtensions()`, 3 tests fail. |
| The built outputs carry the tool. | Appendix A: after `npm run build:offline`, `dist/index.js` registers `vcc_recall`. `PI_FORK_BUILTINS=off` removes it. `dist/bundle/chunks/chunk-DCHU5CM4.js` holds the code. |
| The upstream suite stays at baseline, apart from known flakes. | Appendix A lists the 4 baseline failures and 3 flaky tests. |
| 11 pi-vcc test files exercise only recall code. | Appendix A lists them: 1,355 lines, all on `bun:test`'s `describe`, `it` and `expect`. Four write JSONL fixtures. |
| The suite harness can drive a tool call. | `packages/coding-agent/test/suite/harness.ts` accepts `extensionFactories`; `test/suite/skills-fork.test.ts:774` issues `fauxToolCall`. |
| pi-vcc is MIT licensed. | pi-vcc `LICENSE`: "Copyright (c) 2026 sting8k". |
| `settings.json` lists pi-vcc once. | `~/.pi/agent/settings.json` line 24: `"npm:@sting8k/pi-vcc",`, the 7th of 16 packages. SHA-256 on 2026-09-25: `8c31d9007f0c7ac9b58be99544193b146f40ff0485091e549d275f22adda33b9`. |
| An empty branch with existing entries is a real session state. | `session-manager.ts:1815`: `resetLeaf()` sets the leaf to null, so `getBranch()` returns nothing while entries remain. pi-vcc's `lineage.ts:16-25` then falls back to `getEntries()`. |
| One ported test needs pi-vcc's fixture helpers. | pi-vcc `tests/render-entries.test.ts:4` imports `userMsg`, `assistantText`, `assistantWithToolCall` and `toolResult` from `tests/fixtures.ts` (60 lines). |
| The MIT licence requires its full notice in copies. | pi-vcc `LICENSE`: "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software." |
| pi-vcc 0.8.0 runs from this repository through jiti. | `/tmp/vcc-recall-probe-golden.mjs` loaded `src/tools/recall.ts` with `node_modules/jiti` 2.7.0 and ran a query, `mode: 'touched'` and `expand` on a session copy; exit 0. |
| Another workspace depends on coding-agent. | `packages/evals/package.json` lists `@earendil-works/pi-coding-agent`, so the coding-agent suite alone does not cover every consumer. |
| The test script never overwrites a report. | `failing-tests.mjs run` exits 2 when its output path exists (verified with an existing file, which stayed intact). |

## 4. Scope

**In scope.**
- The ported recall engine and its tests (T1).
- The registration, its tests and an end-to-end tool call (T2).
- The ADR-0009 amendment (T3).
- Validation of the built outputs (T4).
- The cutover of the live setup (T5).
- The results record and cleanup (T6).

**Out of scope.**
- `/pi-vcc-recall`, `/pi-vcc` and the compaction hook (R4).
- Recall across earlier sessions; the tool searches only the current one.
- Uninstalling the npm package directory or deleting `~/.pi/agent/pi-vcc-config.json`. T6 lists both as optional user actions.

**Binding constraints.** No upstream-owned file changes. The shrinkwrap, the install lock, `package-lock.json`, `models.generated.ts`, `packages/builtins/` and the pi-vcc install stay untouched.

| Constraint | Exception in this plan |
| --- | --- |
| `~/.pi/agent/settings.json` stays untouched | T5 removes the pi-vcc entry, with the user's approval. |

## 5. Working setup

1. Create the worktree: `git worktree add -b feat/vcc-recall-builtin /tmp/vcc-recall-builtin personal`.
2. Copy the ignored model data: `cp -R /Users/paolof/Developer/ai/pi/packages/ai/src/providers/data /tmp/vcc-recall-builtin/packages/ai/src/providers/`.
3. Run `npm install --ignore-scripts` in the worktree.
4. Record `BASE=$(git -C /tmp/vcc-recall-builtin rev-parse HEAD)`. The probe used `6ed010550afb3d0bef0b296a7725253fe9358cb9`. When BASE differs, Section 3 still describes the probe, and the baseline below describes BASE.
5. Record the baseline, one run at a time, with `S=/Users/paolof/Developer/ai/pi/.pi/skills/planning-changes/scripts/failing-tests.mjs`:
   - three full coding-agent runs: `node $S run /tmp/vcc-recall-builtin packages/coding-agent /tmp/vcc-recall-builtin-base-<n>.json` for `n` 1 to 3;
   - one `./test.sh` run from the worktree root, its full output saved to `/tmp/vcc-recall-builtin-base-testsh.log`.
   Each output path must not exist beforehand; the script refuses an existing path.

**Regression rule.** T1 and T2 apply it after every change.
1. Run the coding-agent suite once and `diff` it against `base-1`. The candidate must run at least as many tests as `base-1` plus the tests the task adds.
2. A failure absent from `base-1` triggers two more candidate runs. It is tolerated only when `base-2` or `base-3` also shows it, and the candidate fails it in no more of its three runs than the baseline did in its three. Otherwise it is a regression: stop and ask.
3. Run `./test.sh`, and collect every failing-test line of its log: vitest `FAIL` and `×` lines, and node:test `not ok` lines. Each line must also appear in `base-testsh.log`. For any other line, rerun `./test.sh` once; a line that recurs is a regression: stop and ask.

Environment facts:
- Run suites one at a time. Two suites in parallel produced load-induced failures in the probe (Appendix A).
- The script path above lives in the main checkout. When the `planning-changes` skill is committed, use the worktree's copy instead.
- The pre-commit hook runs the full `npm run check`.
- Interactive `pi` in a worktree that contains `.pi/` shows a trust dialog. Choose "Do not trust (this session only)".

## 6. Tasks

### T0. Record the plan

The handoff performs this task. It copies `docs/plans/vcc-recall-builtin.plan.md` from the main checkout into the worktree, and `cmp` confirms the copy. It commits that single file as `docs: vcc_recall built-in plan`. `git show --name-only --format= HEAD` must list only that path.

### T1. Port the recall engine onto in-memory entries

**Source preflight.** In `~/.pi/agent/npm/node_modules/@sting8k/pi-vcc`, `package.json` must say version `0.8.0`. This command must print `6fc5dde4c06240f0df4373ae60b814f2ffc00aec6b2063e1443496fbf151adbc`: `cat src/tools/recall.ts src/core/{search-entries,drill-down,content,format-recall,global-indices,jsonl,render-entries,load-messages,recall-scope,lineage,tool-args}.ts | shasum -a 256`. A mismatch means stop and ask.

**Changes.** Create `packages/coding-agent/src/core/fork-builtins/vcc-recall/`. Copy pi-vcc's `LICENSE` verbatim into it as `LICENSE`, which carries the copyright and permission notice the licence requires. Each ported file starts with a header naming its pi-vcc 0.8.0 source path and pointing to that `LICENSE`.

| New file | Source in pi-vcc | Change |
| --- | --- | --- |
| `content.ts`, `format-recall.ts`, `render-entries.ts`, `search-entries.ts`, `recall-scope.ts`, `tool-args.ts` | `src/core/<same name>` | Relative imports end in `.ts`. Types replace every `any`. Behavior stays identical. |
| `global-indices.ts` | `src/core/global-indices.ts` | Keep the in-memory index builder; delete the file-streaming path. |
| `load-messages.ts` | `src/core/load-messages.ts` | Build the rendered entries from `sessionManager.getEntries()`, with the same counting rule and lineage filter. |
| `drill-down.ts` | `src/core/drill-down.ts` | Resolve `#N` and `#N:path` against in-memory entries instead of reading the file. |
| `lineage.ts` | `src/core/lineage.ts` | Types replace `any`. The `getEntries()` fallback stays, because `resetLeaf()` produces an empty branch in a live session (Section 3). |
| `recall.ts` | `src/tools/recall.ts` | Same tool name, description, prompt snippet, schema and output. Import `ExtensionAPI` from `../../extensions/types.ts`. Remove the "No session file available." branch. |

pi-vcc's `src/core/jsonl.ts` has no counterpart.

**Tests.** Port the 11 test files of Appendix A, plus pi-vcc's `tests/fixtures.ts`, into `packages/coding-agent/test/fork-builtins/vcc-recall/`. Replace the `bun:test` import with `vitest`. The four files that write JSONL fixtures build `SessionManager.inMemory()` sessions instead.

Four `load-messages.test.ts` tests exercise only the file reader, which the port removes. Retire them, and replace them with one in-memory test: a session with no entries yields empty history. The retired tests are:
- "loads JSONL incrementally across read-chunk boundaries";
- "treats a not-yet-written session file as empty history instead of throwing ENOENT";
- "returns empty history for an existing but empty session file";
- "still surfaces read errors that are not 'file does not exist'".

Every other assertion stays unchanged. Add four tests:
- **Contract.** The registered tool's name, label, description, prompt snippet and parameter schema equal pi-vcc 0.8.0's `src/tools/recall.ts:19-54`, recorded as literal expected values.
- **Golden outputs.** Build two synthetic sessions with the fixture helpers, and write them as JSONL under `test/fork-builtins/vcc-recall/golden/`:
  - `linear.jsonl`: 14 messages. The keyword `alpha` appears in at least 7 of them, so a query for it spans two pages. Assistant turns call `read` on `src/a.ts`, `edit` on `src/b.ts` and `bash` with `ls`, each with its result. A compaction entry follows the eighth message.
  - `branched.jsonl`: one parent message with two child branches. The leaf sits on the second branch, and only the first branch mentions `beta`.

  Adapt Appendix B's `golden-probe.mjs` to run pi-vcc 0.8.0 through jiti on each file, writing each full output to `golden/<session>.<case>.txt`.
  - Cases on `linear`: `{}`; `{query: "alpha"}`; `{query: "alpha", page: 2}`; `{query: "alph.*"}`; `{expand: [0, 3]}`; `{mode: "touched"}`; and `{query: "#<index of the read result>:src/a.ts"}`.
  - Cases on `branched`: `{query: "beta"}` and `{query: "beta", scope: "all"}`.

  The test loads each JSONL file into `SessionManager.inMemory()`, runs the port with the same parameters, and asserts exact equality with the stored output.
- **Compaction.** A query and `expand` both reach a message from before the compaction.
- **Branches.** `scope: 'lineage'` excludes the off-branch message, `scope: 'all'` returns it, and after `resetLeaf()` the default scope falls back to all entries.

Real session files never enter the repository: the golden sessions are synthetic.

**Validation.**
- Every test under `test/fork-builtins/vcc-recall/` passes.
- The Section 5 regression rule holds.
- `npm run check` exits 0.

**Commit.** `feat(coding-agent): port the vcc_recall engine onto in-memory session entries`.

Stop and ask when a ported test fails for a reason other than the data-source change. That failure is a behavior difference R3 forbids.

### T2. Register vcc_recall as a fork-owned built-in

**Changes.**
- `packages/coding-agent/src/core/fork-builtins.ts`: apply Appendix B's version. Extend the header comment so it describes both kinds: ported packages and fork-owned modules.
- `packages/coding-agent/test/fork-builtins.test.ts`: apply Appendix B's diff.
- Create `packages/coding-agent/test/suite/vcc-recall.test.ts`. It passes `FORK_OWNED_BUILTINS` as `extensionFactories` to `createHarness`. A faux model first answers a user turn. It then calls `vcc_recall` with a query matching that turn.

**Validation.**
- `fork-builtins.test.ts` passes all its tests.
- The suite test passes: the tool result names the earlier turn.
- Remove `...FORK_OWNED_BUILTINS` from the `forkBuiltInExtensions()` return, and confirm 3 tests fail. Restore it.
- The Section 5 regression rule and `npm run check` hold.

**Commit.** `feat(coding-agent): ship vcc_recall as a fork-owned built-in`.

### T3. Amend ADR-0009

Edit `docs/adr/ADR-0009-built-in-extensions.md` in place.

| Section | Amendment |
| --- | --- |
| Decision | Add a row for fork-owned built-ins: code under `packages/coding-agent/src/core/fork-builtins/<name>/`, listed in `FORK_OWNED_BUILTINS`, with no `UPSTREAM.json` and no sync. |
| Footprint | A fork-owned built-in adds no upstream-owned line. |
| Consequences | Fork-owned built-ins get the full check and test coverage that ported packages lack. OpenIntent workers receive `vcc_recall` like every built-in. |
| Evidence | Cite this plan's Section 3 and Appendix A. |

**Validation.** `grep -cF` finds each of these strings at least once in `docs/adr/ADR-0009-built-in-extensions.md`: `FORK_OWNED_BUILTINS`, `src/core/fork-builtins/` and `vcc-recall-builtin.plan.md`.

**Commit.** `docs: ADR-0009 fork-owned built-ins`.

### T4. Validate the built outputs

1. Run `git worktree add --detach /tmp/vcc-recall-validate feat/vcc-recall-builtin`, copy the model data, then run `npm install --ignore-scripts` and `npm run build:offline`.
2. Copy Appendix B's `dist-probe.mjs` to `/tmp/vcc-recall-dist-probe.mjs`, with its import path pointed at `/tmp/vcc-recall-validate`. Run it twice: once plainly, once with `PI_FORK_BUILTINS=off`.
3. Run `grep -rl vcc_recall /tmp/vcc-recall-validate/packages/coding-agent/dist/bundle`.

**Validation.**
- `node /tmp/vcc-recall-dist-probe.mjs | grep -F '"errors":[],"vccRecallRegistered":true'` exits 0.
- `PI_FORK_BUILTINS=off node /tmp/vcc-recall-dist-probe.mjs | grep -F '"paths":[],'` exits 0.
- The grep names at least one bundle file.
- Every command exits 0.

Not run by the probe: an interactive session calling the tool. T5 runs it.

### T5. Cut over the live setup

Every step needs the user's approval. Agree a quiet interval with the user for steps 2 to 4: no new Pi session starts, and nobody edits the main checkout.

1. In the main checkout, `git rev-parse --abbrev-ref HEAD` must print `personal`, and `git diff --cached --name-only` must print nothing. `git status --short` may list only files under `.pi/` and untracked files under `docs/plans/`. Anything else means stop and ask. Move this plan aside, compare it with the committed copy, then delete the moved copy.
2. Run `git merge --ff-only feat/vcc-recall-builtin`. When it fails because `personal` moved, stop and ask. The fix is to rebase the branch onto `personal` and rerun the T1 and T2 validation.
3. `~/.pi/agent/settings.json.bak-vcc-recall` must not exist; otherwise, stop. Copy `~/.pi/agent/settings.json` there with `cp -n`, and confirm that the two SHA-256 values are equal. When the original differs from Section 3's hash, re-read it before editing. Delete the line `"npm:@sting8k/pi-vcc",`. Verify with `JSON.parse`, and record the new SHA-256.
4. Confirm that `git diff --quiet ORIG_HEAD HEAD -- package-lock.json` exits 0, then run `npm run build:offline`.
5. Run `pi list` and confirm that its output has no `@sting8k/pi-vcc`.
6. Run `touch /tmp/vcc-recall-cutover.marker`, then start `pi --unfenced`. Send a first message holding a unique phrase, such as `cobalt-heron-` plus random digits. In a second message, ask the model to recall that phrase with `vcc_recall`. Then run `find ~/.pi/agent/sessions -name '*.jsonl' -newer /tmp/vcc-recall-cutover.marker -exec grep -l '<phrase>' {} +`. It must print exactly one file, whose `vcc_recall` result contains the phrase and no `"isError":true`.
7. Repeat step 6 with `pi --profile general` and a new phrase.

**Rollback.**
1. With approval, recheck the branch and the empty index as in step 1. Run `git revert --no-commit <T2 commit>`. The staged paths must equal the output of `git show --name-only --format= <T2 commit>`. Commit with `fix(coding-agent): withdraw the vcc_recall built-in`, then run `npm run build:offline`.
2. Point T4's probe at the main checkout's `dist/index.js` and run it; it must print `"vccRecallRegistered":false`. When the build or this check fails, stop with the pi-vcc entry still removed, and ask.
3. Restore the pi-vcc entry. When the file still has the post-edit hash, copy the backup back; otherwise, re-add the one line by hand. Verify with `JSON.parse`.

**Validation.** Step 5 shows no pi-vcc. Steps 6 and 7 each find exactly one session file, whose `vcc_recall` result contains that step's phrase.

### T6. Record results and clean up

1. Write `docs/plans/vcc-recall-builtin.results.md` with these sections: `## Commits`, `## Baseline comparisons`, `## Built outputs`, `## Cutover` (hashes, backup path, both session files) and `## Open user actions`.
2. The open user actions are:
   - optionally uninstall the npm package directory;
   - optionally delete `~/.pi/agent/pi-vcc-config.json`;
   - add `vcc_recall` to OpenIntent's list of SDK-provided resources.
3. With approval, commit the results file on `personal`, staging it by path: `docs: vcc_recall built-in results`.
4. Check each worktree with `git status --short` before removing it:
   - `/tmp/vcc-recall-probe` must show exactly `M packages/coding-agent/src/core/fork-builtins.ts`, `M packages/coding-agent/test/fork-builtins.test.ts` and `?? packages/coding-agent/src/core/fork-builtins/`. Appendix B and pi-vcc hold all of it, so nothing is unique.
   - `/tmp/vcc-recall-baseline` must be clean.
   - `/tmp/vcc-recall-validate` and `/tmp/vcc-recall-builtin` must show no uncommitted changes.
   - `lsof -d cwd 2>/dev/null | grep -F <worktree path>` must print nothing, so no process runs inside it.
   - `git status --short --ignored` may add only entries under `node_modules/`, under a `dist/` directory, or `packages/ai/src/providers/data/`. Installs and builds regenerate all of them.
   - Any other status means stop and ask. Otherwise, with approval, run `git worktree remove --force` on each, then `git worktree prune`. `--force` is needed for the probe, whose changes are expected.
5. Delete only the recorded temporary files:
   - `/tmp/vcc-recall-baseline.json`, `/tmp/vcc-recall-baseline-2.json` and `/tmp/vcc-recall-baseline-3.json`;
   - `/tmp/vcc-recall-probe.json`, `/tmp/vcc-recall-probe-3.json` and `/tmp/vcc-recall-probe-4.json`;
   - `/tmp/vcc-recall-probe-parity.mjs`, `/tmp/vcc-recall-probe-dist.mjs`, `/tmp/vcc-recall-probe-golden.mjs`, `/tmp/vcc-recall-golden-session.jsonl` and `/tmp/vcc-recall-probe-check.log`;
   - `/tmp/vcc-build.log`;
   - `/tmp/vcc-recall-builtin-base-1.json` to `-3.json` and `/tmp/vcc-recall-builtin-base-testsh.log`;
   - `/tmp/vcc-recall-dist-probe.mjs`, and every other path T1 to T5 recorded.
6. With approval, delete the `feat/vcc-recall-builtin` branch.

**Validation.** `grep -cE '^## (Commits|Baseline comparisons|Built outputs|Cutover|Open user actions)$' docs/plans/vcc-recall-builtin.results.md` prints 5. `git worktree list` shows none of the four worktrees. Also delete `/tmp/vcc-recall-cutover.marker`.

## 7. Test plan

| Layer | What it proves | When it runs |
| --- | --- | --- |
| Ported recall tests | Search, ranking, truncation, expansion, drill-down, touched mode and scope behave as in pi-vcc 0.8.0. | Every `./test.sh`. |
| Contract and golden tests | The model-facing definition and the output text equal pi-vcc 0.8.0's, exactly, on synthetic sessions (R3). | Every `./test.sh`. |
| New in-memory tests | Compacted and off-branch messages stay recallable from memory. | Every `./test.sh`. |
| `fork-builtins.test.ts` | `vcc_recall` registers hidden, in order, and honors the switch. | Every `./test.sh`, and after each upstream Pi merge. |
| Suite test | A model's `vcc_recall` call returns an earlier turn through the real session stack. | Every `./test.sh`. |
| Upstream suites | The change breaks no upstream behavior in any workspace. | After T1 and T2, under the Section 5 regression rule. |
| T4 output checks | The built SDK and the bundle carry the tool. | During T4. |
| Cutover sessions | The live CLI, fenced and unfenced, runs the native tool. | During T5. |

Mutation checks:
- Removing `...FORK_OWNED_BUILTINS` from `forkBuiltInExtensions()` fails 3 tests (measured).
- Each new in-memory test fails when `load-messages.ts` ignores the entries it tests (T1 confirms this).

**Not proved by this plan.**
- Recall quality on real sessions beyond what the ported tests assert.
- `scope: 'all'` on a real branched session; none exists locally.
- Behavior inside OpenIntent workers.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| The port changes search results. | The ported tests pin pi-vcc 0.8.0's behavior. T1 stops on any unexplained test failure. |
| Two `vcc_recall` tools load at cutover. | T5 removes the settings entry before the build. |
| A flaky upstream test reads as a regression, or a regression reads as a flake. | The Section 5 regression rule tolerates only a failure the baseline itself showed, and reruns the full suite for anything else. |
| An upstream merge edits `fork-builtins.ts`. | The file is fork-owned; `fork-builtins.test.ts` fails if the list is lost. |
| The fork later wants pi-vcc's upstream fixes. | R2 accepts no sync; the file headers name the source version for manual comparison. |

## 9. Done criteria

- T0 to T6 are committed or complete, as Section 6 lists.
- `npm run check` exits 0 on the branch head.
- The Section 5 regression rule holds after T2, for coding-agent and for `./test.sh`.
- T4's two runs and the grep pass.
- Both T5 sessions show a successful `vcc_recall` call.
- `~/.pi/agent/settings.json` no longer lists pi-vcc, and its backup exists.
- `docs/plans/vcc-recall-builtin.results.md` is committed on `personal`.

## Appendix A. Probe measurements

**Index parity.** `/tmp/vcc-recall-probe-parity.mjs` copied every `.jsonl` file under `~/.pi/agent/sessions/`, recursively, and compared the ids of `type: "message"` entries.

| Measure | Value |
| --- | --- |
| Session files checked | 3,455 of 3,456, including nested subagent sessions |
| Files that failed to open | 1: `leaked-worker-session.jsonl`, not a valid Pi session |
| Message entries | 292,626 |
| Sessions with compaction | 48 |
| Sessions with off-branch messages | 0 |
| Mismatches | 0 |

**Porting effort.** The 12 closure files were copied into `packages/coding-agent/src/core/fork-builtins/vcc-recall/`, and relative imports were rewritten to `.ts`.

| Check | Result |
| --- | --- |
| `tsgo --noEmit` | 0 errors in the copied files |
| Biome, after `format --write` | 5 fixable `organizeImports` errors, 8 fixable `useTemplate` infos, 1 `noAssignInExpressions` error in `jsonl.ts` |
| `check:pinned-deps`, `check:runtime-deps`, `check:ts-imports`, `check:entry-graphs`, `check:shrinkwrap`, `check:install-lock:coding-agent`, `check:browser-smoke` | All exit 0 |

**Portable pi-vcc tests** (files under pi-vcc `tests/` that import only recall code):

| File | Lines |
| --- | --- |
| `search-entries.test.ts` | 522 |
| `recall-touched-drilldown.test.ts` | 284 |
| `recall-quality.test.ts` | 131 |
| `load-messages.test.ts` | 106 |
| `recall-tool-scope.test.ts` | 81 |
| `render-entries.test.ts` | 62 |
| `content.test.ts` | 59 |
| `lineage.test.ts` | 33 |
| `recall-scope.test.ts` | 32 |
| `format-recall.test.ts` | 30 |
| `recall-expand.test.ts` | 15 |

**Suite runs** (coding-agent, `failing-tests.mjs`):

| Run | Failed | New versus baseline run 1 |
| --- | --- | --- |
| Baseline 1 (in parallel with probe 1) | 4 | reference |
| Probe 1 (in parallel) | 6 | `agent-session-concurrent` "should allow steer() while streaming"; `footer-data-provider` "debounces rapid reftable updates into a single async refresh" |
| Probe 2 | 5 | `footer-data-provider` "updates the cached branch when the reftable directory changes" |
| Baseline 2 | 4 | none |
| Probe 3 | 5 | the same `footer-data-provider` test |
| Probe 4 | 4 | none |
| Baseline 3 | 5 | the same `footer-data-provider` test |

Rerun alone, `agent-session-concurrent.test.ts` and `footer-data-provider.test.ts` passed 3 of 3 times in each worktree. `footer-data-provider.test.ts` then passed 5 of 5 more times in each. Only "updates the cached branch when the reftable directory changes" also failed on BASE (baseline run 3). The other two failed only while two suites ran in parallel.

The 4 baseline failures:
- `test/experimental-presentation-facets.test.ts` "builds conventional plugin entries into the server-owned plugin cache";
- the same file's "builds the example plugin package without a package-owned build script";
- `test/experimental-remote-runtime.test.ts` "passes client plugin packages to a cold server and restores them for its next generation";
- `test/suite/regressions/2791-fswatch-error-crash.test.ts` "should survive an error event on the theme FSWatcher".

**Registration and built outputs.**

| Check | Result |
| --- | --- |
| `fork-builtins.test.ts` with Appendix B's changes | 8 of 8 pass |
| The same, without `...FORK_OWNED_BUILTINS` | 3 fail |
| `npm run build:offline` | exit 0, 5.7 s |
| `dist-probe.mjs`, switch unset | `"paths":["<inline:@juicesharp/rpiv-ask-user-question>","<inline:vcc-recall>"],"errors":[],"vccRecallRegistered":true` |
| `dist-probe.mjs`, `PI_FORK_BUILTINS=off` | `"paths":[],"errors":[],"vccRecallRegistered":false` |
| `vcc_recall` in `dist/bundle/` | `chunks/chunk-DCHU5CM4.js` |
| pi-vcc 0.8.0 through jiti (`/tmp/vcc-recall-probe-golden.mjs`) | exit 0. The query header read "Page 1/10 (50 total matches — showing 50 of 89 matches, refine your query for more precise results)". |

## Appendix B. Verified code

**`packages/coding-agent/src/core/fork-builtins.ts`**, as it passed the probe. T2 also extends its header comment.

```ts
/**
 * Fork-owned: the extensions this Pi fork ships as built-ins. Every DefaultResourceLoader
 * loads them after the caller's factories, including under `noExtensions`.
 *
 * The ported packages live under `packages/builtins/` as npm workspaces. No dependency is
 * declared on them: each name resolves through the monorepo's workspace links, and each
 * package loads through the jiti-backed module loader that loads any extension path.
 * `PI_FORK_BUILTINS=off` disables them; coding-agent's vitest config sets it (ADR-0009).
 */
import { createRequire } from "node:module";
import { loadExtensionFactoryFromPath } from "./extensions/loader.ts";
import type { ExtensionFactory, InlineExtension } from "./extensions/types.ts";
import { registerRecallTool } from "./fork-builtins/vcc-recall/recall.ts";

export const FORK_BUILTIN_PACKAGES: readonly string[] = ["@juicesharp/rpiv-ask-user-question"];

/** Fork-owned built-ins that live in this package and register without a package resolution. */
export const FORK_OWNED_BUILTINS: readonly InlineExtension[] = [
	{ name: "vcc-recall", factory: registerRecallTool, hidden: true },
];

const requireFromHere = createRequire(import.meta.url);

function packageFactory(packageName: string): ExtensionFactory {
	return async (pi) => {
		const factory = await loadExtensionFactoryFromPath(requireFromHere.resolve(packageName));
		if (!factory) {
			throw new Error(`Built-in extension ${packageName} does not export a factory`);
		}
		await factory(pi);
	};
}

/** The built-ins for the given package names. Tests pass their own names; production uses the fork list. */
export function createForkBuiltInExtensions(packageNames: readonly string[]): InlineExtension[] {
	return packageNames.map((name) => ({ name, factory: packageFactory(name), hidden: true }));
}

/** The fork's built-ins, or none when `PI_FORK_BUILTINS=off`. Read at each loader construction. */
export function forkBuiltInExtensions(): InlineExtension[] {
	if (process.env.PI_FORK_BUILTINS === "off") {
		return [];
	}
	return [...createForkBuiltInExtensions(FORK_BUILTIN_PACKAGES), ...FORK_OWNED_BUILTINS];
}
```

**`packages/coding-agent/test/fork-builtins.test.ts`**, the probe's diff against BASE:

```diff
-import { createForkBuiltInExtensions, FORK_BUILTIN_PACKAGES } from "../src/core/fork-builtins.ts";
+import { createForkBuiltInExtensions, FORK_BUILTIN_PACKAGES, FORK_OWNED_BUILTINS } from "../src/core/fork-builtins.ts";
@@ loads every listed package after the caller's factories, hidden, under noExtensions
 			...FORK_BUILTIN_PACKAGES.map((name) => `<inline:${name}>`),
+			...FORK_OWNED_BUILTINS.map((builtIn) => `<inline:${builtIn.name}>`),
 		]);
@@ after "registers the tools of rpiv-ask-user-question"
+	it("registers vcc_recall as a fork-owned built-in", async () => {
+		vi.stubEnv("PI_FORK_BUILTINS", "on");
+		const subject = loader([]);
+		await subject.reload();
+
+		const builtIn = subject.getExtensions().extensions.find((extension) => extension.path === "<inline:vcc-recall>");
+		expect(builtIn?.hidden).toBe(true);
+		expect(builtIn?.tools.has("vcc_recall")).toBe(true);
+	});
@@ reads the switch when the loader is constructed, not when it reloads
-		expect(constructedOn.getExtensions().extensions).toHaveLength(FORK_BUILTIN_PACKAGES.length);
+		expect(constructedOn.getExtensions().extensions).toHaveLength(
+			FORK_BUILTIN_PACKAGES.length + FORK_OWNED_BUILTINS.length,
+		);
```

**`dist-probe.mjs`**, as it ran against `/tmp/vcc-recall-probe`:

```js
// Probe: the built SDK registers vcc_recall under noExtensions, and PI_FORK_BUILTINS=off removes it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const sdk = await import(pathToFileURL("/tmp/vcc-recall-probe/packages/coding-agent/dist/index.js").href);
const root = mkdtempSync(join(tmpdir(), "vcc-recall-dist-"));
try {
	const loader = new sdk.DefaultResourceLoader({
		cwd: root,
		agentDir: root,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
	});
	await loader.reload();
	const { extensions, errors } = loader.getExtensions();
	const recall = extensions.find((extension) => extension.path === "<inline:vcc-recall>");
	console.log(
		JSON.stringify({
			switch: process.env.PI_FORK_BUILTINS ?? "unset",
			paths: extensions.map((extension) => extension.path),
			errors,
			vccRecallRegistered: recall?.tools.has("vcc_recall") ?? false,
		}),
	);
} finally {
	rmSync(root, { recursive: true, force: true });
}
```

**`golden-probe.mjs`**, as it ran against a session copy. T1 adapts it to write the synthetic sessions and record their outputs.

```js
// Probe: can jiti run pi-vcc 0.8.0's recall tool on a session file, to record golden outputs?
import { createJiti } from "/Users/paolof/Developer/ai/pi/node_modules/jiti/lib/jiti.mjs";

const root = `${process.env.HOME}/.pi/agent/npm/node_modules/@sting8k/pi-vcc`;
const jiti = createJiti(import.meta.url, { interopDefault: true });
const { registerRecallTool } = await jiti.import(`${root}/src/tools/recall.ts`);

let tool;
registerRecallTool({ registerTool: (definition) => (tool = definition) });
const sessionFile = process.argv[2];
const lines = (await import("node:fs")).readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);
const entries = lines.map((line) => JSON.parse(line)).filter((entry) => entry.type !== "session");
const byId = new Map(entries.map((entry) => [entry.id, entry]));
const leaf = entries.at(-1);
const branch = [];
for (let current = leaf; current; current = current.parentId ? byId.get(current.parentId) : undefined) branch.unshift(current);
const ctx = {
	sessionManager: { getSessionFile: () => sessionFile, getBranch: () => branch, getEntries: () => entries },
};
const run = async (params) => (await tool.execute("probe", params, undefined, undefined, ctx)).content[0].text;
const outputs = {
	name: tool.name,
	promptSnippet: tool.promptSnippet.slice(0, 60),
	query: (await run({ query: "vcc_recall plan" })).split("\n").slice(0, 3),
	touched: (await run({ mode: "touched" })).split("\n").slice(0, 2),
	expand: (await run({ expand: [0] })).split("\n").slice(0, 2),
};
console.log(JSON.stringify(outputs, null, 1));
```

## Review history

### Pass 1: 2026-09-25, reviewer model openai-codex/gpt-6-sol

| Angle | Verdict |
| --- | --- |
| traceability | PASS_WITH_FINDINGS |
| assumptions | FAIL |
| completeness | FAIL |
| feasibility | FAIL |
| validation | FAIL |
| safety | FAIL |

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | Dropping the lineage fallback changes behavior and breaks the ported lineage test (traceability, assumptions, completeness). | Accepted: the fallback stays. | `session-manager.ts:1815` `resetLeaf()`; pi-vcc `tests/lineage.test.ts:12-20`. |
| 2 | No check pins the tool contract or the exact output text (traceability, validation). | Accepted: contract and golden tests in T1. | pi-vcc `src/tools/recall.ts:19-54`; the jiti probe in Appendix A. |
| 3 | The attribution omits the MIT permission notice (assumptions). | Accepted: a verbatim `LICENSE` in the module. | pi-vcc `LICENSE:12-13`. |
| 4 | Rerunning a failure alone can waive a suite-only regression (assumptions, validation). | Accepted: the Section 5 regression rule. | `failing-tests.mjs` diffs full-suite reports only. |
| 5 | Only coding-agent was compared, though the claim covers every workspace (assumptions, validation). | Accepted: `./test.sh` baseline and comparison. | `test.sh:78`; `packages/evals/package.json`. |
| 6 | The closure is 1,634 lines, not 1,646 (assumptions). | Accepted. | `wc -l`; the earlier count added one line per file. |
| 7 | `render-entries.test.ts` needs `tests/fixtures.ts` (completeness). | Accepted: `fixtures.ts` ports too. | pi-vcc `tests/render-entries.test.ts:4`. |
| 8 | T0 lacked its copy and commit steps (completeness). | Accepted. | Section 6, T0. |
| 9 | Cleanup gave no rule for the dirty probe worktree (completeness, feasibility, safety). | Accepted: expected statuses, then `--force`. | `git -C /tmp/vcc-recall-probe status --short`. |
| 10 | A moved `personal` desynchronizes BASE and the fast-forward (feasibility). | Accepted: BASE is the worktree head; a failed fast-forward stops. | Section 5 step 4; T5 step 2. |
| 11 | Cutover never checked the branch (feasibility). | Accepted. | T5 step 1. |
| 12 | The diff ignores tests that stop running (validation). | Accepted: the test count must not drop. | Section 5 regression rule, step 1. |
| 13 | T3, T5 and T6 were checked by eye (validation). | Accepted: grep checks, `pi list` and session-file checks. | T3 and T5 validation. |
| 14 | The test script force-deleted an existing output path (safety). | Accepted: the script now refuses one. | `failing-tests.mjs`, verified with an existing file. |
| 15 | The rollback commit skipped the commit preflight and message format (safety). | Accepted. | `AGENTS.md` commit rules; T5 rollback step 1. |
| 16 | The settings backup was never verified (safety). | Accepted: hash check, and restoration even after a failed build. | T5 step 3; rollback step 2. |

Sections changed: 3, 5, 6 (T0, T1, T2, T3, T5, T6), 7, 8, 9, Appendix A. Pass 2 re-reviewed these changes.

### Pass 2 (re-review): 2026-09-25, reviewer model openai-codex/gpt-6-sol

| Angle | Verdict |
| --- | --- |
| traceability | FAIL |
| assumptions | PASS_WITH_FINDINGS |
| completeness | FAIL |
| feasibility | FAIL |
| validation | FAIL |
| safety | FAIL |

Pass 2 confirmed the pass-1 dispositions it checked, and raised these findings on the changed sections:

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | The report requires uninstalling pi-vcc; the plan left it optional (traceability). | Accepted: declared in Section 2.3. | Report Sections 4.5 and 5.3. |
| 2 | The parity probe skipped nested subagent sessions (assumptions). | Accepted: rerun recursively. | Appendix A: 3,455 files, 0 mismatches. |
| 3 | One baseline flake could excuse a persistent failure (assumptions). | Accepted: the rule compares failure frequency. | Section 5 regression rule, step 2. |
| 4 | The unfenced check had no launch flag (completeness). | Accepted: `pi --unfenced`. | Phase-1 results, deviation 4. |
| 5 | Golden fixtures and cases were unspecified (completeness). | Accepted: two fixtures and nine cases. | T1 tests. |
| 6 | Comparing workspace counts lets one failure replace another (completeness, validation). | Accepted: failing-line identities. | Section 5 regression rule, step 3. |
| 7 | Nothing checked the pi-vcc source before copying (completeness). | Accepted: version and closure hash preflight. | T1 source preflight. |
| 8 | Four ported tests exercise only file I/O (feasibility). | Accepted: retired, with an in-memory replacement. | pi-vcc `tests/load-messages.test.ts:30,51,63,76`. |
| 9 | The newest session file may belong to another session, and the check never verified recall (feasibility, validation). | Accepted: a unique phrase, a marker file, and the phrase in the result. | T5 step 6. |
| 10 | The built-output probe never fails by itself (validation). | Accepted: `grep -F` exit codes. | T4 validation. |
| 11 | T0, T3 and T6 checks tested tokens, not content (validation). | Accepted: `cmp`, fixed-string checks and a heading count. | T0, T3 and T6 validation. |
| 12 | A failed rollback build could restore two tools (safety). | Accepted: verify the build before restoring the entry. | T5 rollback step 2. |
| 13 | The rollback commit could absorb another session's staged files (safety). | Accepted: empty-index and staged-path checks. | T5 rollback step 1. |
| 14 | The fixed backup path could be overwritten (safety). | Accepted: refuse an existing path; `cp -n`. | T5 step 3. |
| 15 | Forced removal ignored running processes and ignored files (safety). | Accepted: `lsof` check and an ignored-file inventory. | T6 step 4. |

Sections changed: 2.3, 3, 5, 6 (T0, T1, T3, T4, T5, T6), Appendix A. Changes made after this pass and not yet reviewed: all of those. The user ruled on 2026-09-25 that no further review pass runs.

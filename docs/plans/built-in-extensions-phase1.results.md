# Built-in extensions, phase 1: results

Phase 1 ran on 2026-09-25 against `docs/plans/built-in-extensions-phase1.plan.md` (the plan). The fork now ships `rpiv-ask-user-question` as a built-in, and the live setup loads it from the main checkout. Every T6 mode check passed without a waiver. Both cutover sessions called `ask_user_question` successfully. `./test.sh` shows no failure absent from the baseline. Four deviations are recorded below; none changed a pass condition. Raw outputs sit in `docs/plans/built-in-extensions-phase1-evidence/`.

## Commits

All commits landed on `feat/builtins-phase1`, starting from `BASE` `384884dfe46bfe2d76d2b558f89999d4f1bd8f13`. T9 fast-forwarded `personal` to `8bbde341d`.

| Task | Commit | Message |
| --- | --- | --- |
| T0 | `bc798f8c2` | `docs: built-in extensions report and phase-1 plan` |
| T1 | `4ae8099f6` | `feat(coding-agent): load fork built-in extensions from packages/builtins` |
| T2 | `a22a98a95` | `docs: add port-extension and sync-upstream skills` |
| T3 | `1c5f06cdd` | `feat(coding-agent): port rpiv-ask-user-question as a built-in` |
| T2 fix | `53af1eb6d` | `docs: port-extension skill checks the staged package against its source commit` |
| T4 | `4203ab182` | `fix: skip rpiv-ask-user-question tests that need rpiv-mono tooling` |
| T7 | `806c3b79b` | `docs: amend ADR-0009 with load order, the built-in switch and test policy` |
| T8 | `8bbde341d` | `docs: phase-1 handoff for pi-fence and OpenIntent` |
| T2 fix | `10ba418ab` | `docs: port-extension skill fixes from the phase-1 validation and cutover` |
| Plan | (this batch) | `docs: amend phase-1 plan: correct the fenced and unfenced launch commands` |
| T10 | (this commit) | `docs: phase-1 results and validation evidence` |

T1 and T3 include `package-lock.json`, committed with the owner's approval and `PI_ALLOW_LOCKFILE_CHANGE=1`. The pre-commit hook ran `npm run check` on every commit, and every run passed.

## Tests

The baseline is `./test.sh` on `bc798f8c2`, whose code equals `BASE`. It exits 1. Its failures predate this phase.

| Workspace | Baseline result |
| --- | --- |
| coding-agent | 4 failed, 3589 passed, 50 skipped. The 4 failures equal plan Appendix A. |
| pi-ai | 1 failed: `test/model-catalog-types.test.ts`, GitHub Copilot `gpt-6-sol` context window. |
| pi-client | 1 suite fails to load: `test/unix.test.ts`. |
| pi-durable | 5 suites fail to load: missing `@earendil-works/chord/context`. |
| session-backend-sqlite-node | 6 suites fail to load: missing `@earendil-works/pi-ai/utils/uuid`. |
| Every other workspace | Passed. |

| Run | Commit state | Result against the baseline |
| --- | --- | --- |
| T1 | Mechanism, empty list | Same failure set. coding-agent gains 4 passing tests (3593 passed). |
| T3 | rpiv ported, `test` script still present | coding-agent: same failure set, 3594 passed. The rpiv workspace adds 27 suites that fail to load, as the plan predicts. |
| T4 | rpiv `test` script removed | Same failure set as the baseline. coding-agent 3594 passed. |

`packages/coding-agent/test/fork-builtins.test.ts` passes 5 of 5 alone. Summaries are in `docs/plans/built-in-extensions-phase1-evidence/tests/`.

## T1 footprint

| Check | Result |
| --- | --- |
| `git diff --numstat BASE..HEAD` over the six upstream-owned files | 10 insertions, 1 deletion. |
| Shrinkwrap and install lock | `git diff --quiet` exit 0. |
| `package-lock.json` | One added line, `"packages/builtins/*",`. |

## T3 port

| Check | Result |
| --- | --- |
| rpiv-mono `HEAD` | `8403bb09464e956d01cb4caf957980aba670b5f2` on `personal`. |
| Package subdirectory status | Clean. |
| Untracked files outside the package | `docs/rpiv-mono-overview.md` and `docs/rpiv-mono-overview.pdf`, as expected. |
| Base | `d74b1c99830a565f3df3f37e0a36616d17ffc574`, equal to `merge-base 8403bb09 upstream/main` before the fetch. |
| Pre-checks | No ignored path, no CR byte, no symlink, no submodule. |
| Parity | `diff -r` against a second archive exit 0. All 108 file modes match. The committed blobs and modes equal `8403bb09:packages/rpiv-ask-user-question`. |
| `@juicesharp/rpiv-config` | 2.11.0, integrity `sha512-fjySBPar14qTPNMNPRYmH24YCaQ0r8xzW4P4jz8/Ph7JLFzIa+TM3ySzg9jRq0hh8wVqIAD4j4pcU66fdCkIag==`. |
| Lockfile diff | 32 added lines, identical to the probe's. |

## T5 sync

| Item | Value |
| --- | --- |
| Fetch | `git fetch upstream` exit 0. `upstream/main` stayed at `d74b1c99830a565f3df3f37e0a36616d17ffc574`. |
| Range | `d74b1c99..d74b1c99`: no commit. |
| Outcome | Exit 3, `SYNC OUTCOME: up to date`. `UPSTREAM.json` unchanged, so no commit. |
| Conflicts | None. |
| Scratch path | None. The script prints one only after step (6), which did not run. |

## T6 mode checks

The checks ran in `/tmp/pi-builtins-validate`, detached at `4203ab182`, with the fixture provider appended to the list. `npm install --ignore-scripts` and `npm run build:offline` both exited 0. `models.generated.ts` stayed untouched.

| Check | Exit | Observed |
| --- | --- | --- |
| C1 interactive TUI, bundle | 0 | The questionnaire rendered with "Teal" and "Amber". The tool result "Teal" returned. |
| C2 RPC mode | 0 | One `select` extension UI request. `tool_execution_end` carried "Teal". |
| C3 SDK services and allowlist | 0, 0, 0 | Allowlist `["read"]`: `getAllTools()` is `["read"]`, and runtime enabling fails. Without `tools`: `ask_user_question` is in `getAllTools()` and active. |
| C4 bare import and third-party loader | 0 | Both built-ins load, with no errors. |
| C5 print mode, bundle | 0 | Both commands exit 0. `--list-models` lists `spike-fixture`. `-p` prints `FIXTURE-ECHO: cli path hello`. |
| C8 outside consumer through a symlink | 0 | Both built-ins load through the linked checkout. |
| C9 missing package, run last | 0 | The session started. `errors` names `@pi-fork/spike-missing-package`. `ask_user_question` stayed active. Both rebuilds exited 0, and the list was restored. |
| Unbundled `dist/cli.js` | 0 | Same as print mode. |
| `PI_FORK_BUILTINS=off`, CLI | 1, then 0 | The first run failed on a harness bug (below). The rerun printed `FIXTURE-ECHO: off check`. |
| `PI_FORK_BUILTINS=off`, SDK | 0 | The fixture loaded through `additionalExtensionPaths`. `getAllTools()` holds no `ask_user_question`. The third-party loader lists no built-in. |

No check needed a waiver. `runs/P1-exit-codes.tsv` holds every exit code.

## T9 cutover

| Step | Result |
| --- | --- |
| 1. Main checkout status | On `personal` at `384884dfe`. Only the owner's `.pi/agents/*.md` edits and the untracked report and plan. Both moved copies equaled the committed files and were deleted. |
| 2. Fast-forward | `git merge --ff-only feat/builtins-phase1` to `8bbde341d`. |
| 3. `~/.pi/agent/settings.json` | SHA-256 before `088a665e4f2bc895cce80927fb8ba4a45b138ea18637334409103e3b446c96bc`. After `8c31d9007f0c7ac9b58be99544193b146f40ff0485091e549d275f22adda33b9`. `JSON.parse` succeeded: 16 packages, none naming rpiv. |
| Backup | `~/.pi/agent/settings.json.pre-builtins-phase1.bak`, equal to the before hash. |
| 4. Install and build | `npm install --ignore-scripts` and `npm run build:offline` exited 0. A loader built from `dist/index.js` listed the hidden built-in with `ask_user_question` and no errors. |
| 5. Fenced, scripted | The SPIKE-0003 `c6-fenced.sh` harness passed against the main checkout's `dist/cli.js`. Journal `20260925T163456Z-29425a45.jsonl`: no `rpiv-mono` entry; 34 `auth.json` read denials and 1 DNS `mach-lookup` denial. |
| 5. Fenced, real model | The owner ran `pi --profile general`. The dialog rendered, and the answer returned. Journal `20260925T165104Z-3c058b15.jsonl`: no `rpiv-mono` entry. |
| 6. Unfenced, real model | The owner ran `pi --unfenced`. The answer returned. |

The fenced session also showed the warning "skill/command directory watching degraded". It predates phase 1: session logs from 2026-09-05, 2026-09-08 and 2026-09-24 show it. Phase 1 changed nothing under `packages/coding-agent/src/core/skills/`. The same journal holds 28 `file-read-data /Users/paolof/Developer` denials, a possible cause that nobody has verified.

## Deviations

| # | Deviation | Resolution |
| --- | --- | --- |
| 1 | The first T3 commit included `node_modules/.vite/vitest/<hash>/results.json`. rpiv's own vitest wrote it during `./test.sh`, and `git add -f` staged it. | With the owner's approval, the commit was amended without the file. `53af1eb6d` adds a staged-tree check to the port skill. |
| 2 | T6 step 4 required that no `/tmp/spike-0003-*` file exist. Three SPIKE-0003 leftovers from 11:30 existed. | `c9-missing.sh` wrote to `/tmp/pi-builtins-c9*` instead. The plan amendment records the change. `harness-changes/c9-missing.sh.diff` holds the edit. |
| 3 | The SPIKE-0003 scripts always pass `tools`, so none proves "present by default". The first `off-cli.sh` passed a relative `-e` path from another directory. | `harness-changes/c3-default.mjs` adds a session without `tools`. The fixed `off-cli.sh` reran and passed. `10ba418ab` records both lessons in the port skill. |
| 4 | Plan T9 step 5 named `pi-fence run --profile general`. That command needs `-- <program>`, and it passes no credentials. | The owner ran `pi --profile general` and `pi --unfenced`. The plan amendment and `10ba418ab` correct the commands. |

## Temporary paths

| Path | Owner | Planned handling |
| --- | --- | --- |
| `/tmp/pi-builtins-c9-build.log`, `/tmp/pi-builtins-c9-rebuild.log` | This phase, `c9-missing.sh` | Delete (T10 step 6). |
| Other `/tmp/pi-builtins-*` files | This phase: logs, helper scripts, summaries | Delete with approval. |
| `/tmp/spike-0001-*`, `/tmp/spike-0003-outside.lEYa8j` and `$TMPDIR/spike-000*` created during T6 | This phase, harness `mktemp` output | Listed by name in `/tmp/pi-builtins-t10-tmp-now.txt` against `/tmp/pi-builtins-t6-tmp-before.txt`. Delete by name with approval. |
| `/tmp/spike-0003-c9-build.log`, `/tmp/spike-0003-c9-rebuild.log`, `/tmp/spike-0003-outside.SCRMHY` | SPIKE-0003, 11:30 | The owner approved deleting the report's leftovers (T10 step 8), after a listing and a second confirmation. |
| T5 scratch directory | None created | Nothing to delete. |

## Not proved in phase 1

- Print, RPC and SDK runs never execute `ask_user_question` against a real model. The TUI check and the owner's two cutover sessions did.
- rpiv's non-tool registrations (the reconciler and the `rpiv:ask-user:*` events) ran only in interactive sessions, without a dedicated assertion.
- OpenIntent worker behavior with built-ins. No OpenIntent worker ran.
- A fenced session honoring `PI_FORK_BUILTINS`. pi-fence drops the name.
- Bundle-only failures after later upstream merges. The mode checks run at each port, not on every `./test.sh`.
- rpiv's external editor under the fence.

## Open owner actions

| # | Action | Source |
| --- | --- | --- |
| 1 | Decide whether fenced sessions should honor `PI_FORK_BUILTINS`. If yes, add the name to `ALLOWED_PI_NAMES` in `pi-fence/src/profile/environment.ts`. | Handoff, pi-fence |
| 2 | Only if an rpiv config file is ever created: add `~/.config/rpiv-ask-user-question` to the fence base profile's read allow list. | Handoff, pi-fence |
| 3 | Amend OpenIntent `design.md` D2, D8, D11 and D14, per `docs/plans/built-in-extensions-phase1.handoff.md`. D11 requires worker tool selections to exclude `ask_user_question`. | Handoff, OpenIntent |
| 4 | Decide whether to track the "skill/command directory watching degraded" warning under the fence. | T9 |
| 5 | Delete `~/.pi/agent/settings.json.pre-builtins-phase1.bak` once the rollback window closes. | T9 |

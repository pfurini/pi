# ask_user_question as a fork-owned base tool: results

This file records the implementation of `docs/plans/ask-user-question-base-tool.plan.md` on 2026-09-26. Tasks T0 to T6 ran in order on the branch `feat/ask-user-question-base-tool`, starting at `BASE` `92294f2296f6dfc8a8d0b2452eabc6667e2b99da`. Every commit's tree equals the probe commit of the plan. The Regression rule held after T1 and after T2, with one tolerated known flake. The built SDK carries the base tool with all three loader kinds. The cutover of the main checkout and the live check passed, and no rollback ran.

## Commits

| Task | Commit | Subject | Check |
| --- | --- | --- | --- |
| T0 | `1518962aa` | `docs: ask_user_question base tool plan` | Done by the handoff; the 8 evidence hashes equal Appendix B. |
| T1 | `765227d64` | `feat(coding-agent): ask_user_question as a fork-owned base tool` | `git am` applied `T1.patch` with no conflict. `git diff 00166b028 765227d64 -- . ':!docs/plans'` prints 0 lines. |
| T2 | `9e40fefa2` | `feat(coding-agent): remove the ported rpiv-ask-user-question package` | Committed with `PI_ALLOW_LOCKFILE_CHANGE=1` (R9). `git diff 0bc75dbc4 9e40fefa2 -- . ':!docs/plans'` prints 0 lines. |
| T3 | `b42c5ceed` | `docs: ADR-0009 and README for the ask_user_question base tool` | Every T3 grep passed. |
| T6 | This commit | `docs: ask_user_question base tool results` | |

T1 details:
- `npm run check` exited 0, and Biome applied no fixes.
- The targeted vitest run (module tests, the session suite, `fork-builtins.test.ts`, `skill-c1-acceptance.test.ts`) passed 688 of 688 tests in 36 files.
- After `npm run build:offline`, the probe printed `{"switch":"unset","loader":"default","source":"<inline:@juicesharp/rpiv-ask-user-question>","active":true,"errors":[],"expected":"<inline:@juicesharp/rpiv-ask-user-question>","pass":true}` and exited 0.

T2 details:
- The workspace link `node_modules/@juicesharp/rpiv-ask-user-question` was the expected symlink to `../../packages/builtins/rpiv-ask-user-question`.
- `git diff --numstat -- package-lock.json` printed `0	20`. The added-line count was `0`, and the removed lines naming the package counted `4`.
- `test ! -e packages/builtins/rpiv-ask-user-question` held, and the `git grep` for the package name exited 1.
- `npm run check` exited 0.

T3 details:
- The README opening paragraph has 74 words. Each of the six id and default pairs appears on one line, and each of the 15 required terms appears at least once.
- ADR-0009 names `ask_user_question` 6 times and `baseToolsOverride` once. The new section is "A second 2026-09-26 amendment". The only line matching "adds no upstream-owned line" names the `agent-session.ts` exception.
- `.pi/skills/port-extension/SKILL.md`: the old test-name grep prints `0`, and the `rpc-fallback.ts` path grep prints `1`.
- `npm run check` exited 0.

## Tests

The machine load average was 3 to 12 during the runs. Each run used `failing-tests.mjs run`, one at a time. The run reports live in `/tmp/aubt-impl/`.

| Run | Tree | `numTotalTests` | Failed | Failing test |
| --- | --- | --- | --- | --- |
| base-1 | `1518962aa` (BASE plus plan files) | 3951 | 0 | none |
| base-2 | `1518962aa` | 3951 | 0 | none |
| base-3 | `1518962aa` | 3951 | 1 | `footer-data-provider.test.ts` "updates the cached branch when the reftable directory changes" (known flake) |
| T1-1 | `765227d64` | 4612 | 0 | none |
| T2-1 | T2 tree, before its commit | 4608 | 1 | `agent-session-concurrent.test.ts` "should allow followUp() while streaming" (known flake) |
| T2-2 | T2 tree | 4608 | 0 | none |
| T2-3 | T2 tree | 4608 | 0 | none |

Regression rule results:

| Candidate | Rule 1 (`failing-tests.mjs diff` against base-1) | Rule 2 (`test-identities.mjs`) | Rule 4 (`./test.sh`) |
| --- | --- | --- | --- |
| T1-1 | No new failure (exit 0) | missing 0, failing 0, added 656 (exit 0) | Exit 0; other workspaces identical to the baseline; 0 `FAIL` or `not ok` lines, as in the baseline |
| T2-1 | 1 new failure (exit 1) | missing 0, failing 1 (exit 1) | |
| T2-2 | No new failure (exit 0) | With `removed-t2.txt`: missing 0, failing 0, added 657 (exit 0) | |
| T2-3 | No new failure (exit 0) | With `removed-t2.txt`: missing 0, failing 0, added 657 (exit 0) | Exit 0; other workspaces identical to the baseline; 0 `FAIL` or `not ok` lines |

The baseline `./test.sh` exited 0 with coding-agent at 3,901 passed and 50 skipped (3,951). T1 gave 4,562 passed and 50 skipped (4,612). T2 gave 4,558 passed and 50 skipped (4,608).

Tolerated flake, under rule 3, second case:
- The test is `agent-session-concurrent.test.ts` "should allow followUp() while streaming". Every test in that file is a known flake (plan Section 5).
- It failed in T2-1 only. T2-2 and T2-3 passed rules 1 and 2.
- The file passed alone 3 of 3 times (`T2-concurrent-alone-1.json` to `-3.json`, 7 of 7 tests each).

The footer debounce test "debounces rapid reftable updates into a single async refresh" did not fail in any run.

## Built outputs

T4 used the detached worktree `/tmp/ask-user-question-base-tool-validate` at `b42c5ceed`, with the model data copied (`diff -r` clean). `npm install --ignore-scripts` and `npm run build:offline` exited 0. Each probe below exited 0:

| Command | Output |
| --- | --- |
| `sdk-probe.mjs $D custom "<builtin:ask_user_question>"` | `{"switch":"unset","loader":"custom","source":"<builtin:ask_user_question>","active":true,"errors":[],"expected":"<builtin:ask_user_question>","pass":true}` |
| `sdk-probe.mjs $D default "<builtin:ask_user_question>"` | `{"switch":"unset","loader":"default","source":"<builtin:ask_user_question>","active":true,"errors":[],"expected":"<builtin:ask_user_question>","pass":true}` |
| `sdk-probe.mjs $D override "<builtin:ask_user_question>"` | `{"switch":"unset","loader":"override","source":"<builtin:ask_user_question>","active":true,"errors":[],"expected":"<builtin:ask_user_question>","pass":true}` |
| `PI_FORK_BUILTINS=off sdk-probe.mjs $D custom none` | `{"switch":"off","loader":"custom","source":"none","active":false,"errors":[],"expected":"none","pass":true}` |

`git -C /tmp/ask-user-question-base-tool-validate status --short` printed nothing. No `aubt-sdk-*` temporary directory remained.

## Cutover

The main checkout is `M=/Users/paolof/Developer/ai/pi`. The owner approved steps 1 to 4 together, after step 0 showed the process list, and ran step 5 in person.

| Step | Owner decision | Outcome |
| --- | --- | --- |
| T5 step 0 | Approved (proceed with sessions running) | `personal` at `92294f2296f6dfc8a8d0b2452eabc6667e2b99da`. Other sessions' dirty paths: 5 files under `.pi/agents/`, `.pi/skills/prp-plan/SKILL.md`, `.pi/skills/prp-plan-review/SKILL.md`, untracked `.pi/skills/planning-changes/`. 14 Pi processes: this session (pid 4679) and 13 others (6740, 6906, 7219, 7361, 15558, 29938, 34331, 56460, 71602, 80079, 83621, 95643, 99871). |
| T5 step 1 | Approved | All 9 untracked plan files matched the branch copies with `cmp`. The 9 files and the empty evidence directory were removed. |
| T5 step 2 | Approved | `git merge --ff-only` moved `personal` from `92294f229` to `b42c5ceed`. The other sessions' dirty paths stayed unchanged. |
| T5 step 3 | Approved | `npm install --ignore-scripts` exited 0. `package-lock.json` stayed unchanged, and `node_modules/@juicesharp/rpiv-ask-user-question` is gone. |
| T5 step 4 | Approved | `npm run build:offline` exited 0. The probe printed `{"switch":"unset","loader":"default","source":"<builtin:ask_user_question>","active":true,"errors":[],"expected":"<builtin:ask_user_question>","pass":true}` and exited 0. |
| T5 step 5 | Approved; the owner ran the live session | The marker was `aubt-live-37ced51d`. `live-check.mjs` exited 0 and printed `{"marker":"aubt-live-37ced51d","files":["/Users/paolof/.pi/agent/sessions/--Users-paolof-Developer-ai-pi--/2026-09-26T19-57-28-653Z_01a0df4b-4acc-77ff-9056-aff6b987d1fe.jsonl"],"askResultsAfterMarker":1,"answered":1,"pass":true}`. |

No rollback ran.

## Deviations

| Item | Plan | Actual | Reason |
| --- | --- | --- | --- |
| ADR-0009 section title | Append "A 2026-09-26 amendment" | The new section opens "A second 2026-09-26 amendment" | The pi-tokensave section already opens "A 2026-09-26 amendment"; the wording follows the existing "A second 2026-09-25 amendment". The plan's grep matches both. |
| README registration table | Name `PI_FORK_BUILTINS=off`, the allow and exclude lists, and a same-named tool | Also names `--no-builtin-tools` and a `defaultTools` setting, which leave the tool registered but inactive | Both pass an explicit active list to `AgentSession`, which then omits the tool (`agent-session.ts` `_buildRuntime`). The live `~/.pi/agent/settings.json` has no `defaultTools`. |
| Rule 3 file-alone runs | "its file passes alone three times" | Run with `failing-tests.mjs run ... test/agent-session-concurrent.test.ts`, so the runs kept `./test.sh` isolation | The plan names no command for the solo runs. |

No plan defect needed an amendment.

## Open user actions

- Restart the Pi sessions that started before the cutover. A `/reload` in one of them reports the missing package in `getExtensions().errors` (ADR-0009 "Failure"). The pids were 6740, 6906, 7219, 7361, 15558, 29938, 34331, 56460, 71602, 80079, 83621, 95643 and 99871.
- Plan D11 inside the session-control work. `/Users/paolof/Developer/ai/_handoffs/2026-09-26-pi-session-control-consolidated.md` is the authority: section 4.7 (this tool), section 9 and D15 (the primitive and the engine amendment), sections 11.1 and 12.1 (Option 1 dependency and the open delivery split).
- Decide whether to hand-port rpiv-mono changes made after `8403bb09`.
- Remove `/tmp/ask-user-question-base-tool` and the branch `feat/ask-user-question-base-tool` after this session exits.

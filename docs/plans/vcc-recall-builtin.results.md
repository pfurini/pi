# Native vcc_recall as a fork-owned built-in: results

This file records the execution of `docs/plans/vcc-recall-builtin.plan.md` on 2026-09-25 and 2026-09-26. Tasks T0 to T5 are complete. `personal` now carries a native `vcc_recall` tool in `packages/coding-agent/src/core/fork-builtins/vcc-recall/`, and `~/.pi/agent/settings.json` no longer loads `@sting8k/pi-vcc`. The upstream suites stayed at baseline after T1 and T2. Both live CLI modes, fenced and unfenced, ran the native tool successfully. Section "Deviations" lists every departure from the plan and why.

## Commits

| Task | Commit | Message |
| --- | --- | --- |
| T0 | `43aca69ad` | `docs: vcc_recall built-in plan` |
| T1 | `f85ce97c9` | `feat(coding-agent): port the vcc_recall engine onto in-memory session entries` |
| T2 | `4b35a61f1` | `feat(coding-agent): ship vcc_recall as a fork-owned built-in` |
| T3 | `e795c791f` | `docs: ADR-0009 fork-owned built-ins` |
| T5 | fast-forward | `personal` moved from `6ed010550` to `e795c791f` with `git merge --ff-only`. |

BASE was `43aca69ad34150a9fb4657b0c275a013451de43d`.

## Baseline comparisons

The coding-agent runs used `.pi/skills/planning-changes/scripts/failing-tests.mjs`, one suite at a time.

| Run | Tests | Failed | Failures beyond the 4 known ones |
| --- | --- | --- | --- |
| base-1 | 3,657 | 5 | `agent-session-concurrent.test.ts` "should throw when prompt() called while streaming" |
| base-2 | 3,657 | 4 | none |
| base-3 | 3,657 | 4 | none |
| T1 candidate | 3,770 | 4 | none; 0 new versus base-1 |
| T2 candidate | 3,772 | 4 | none; 0 new versus base-1 |

The 4 known failures equal plan Appendix A's list. T1 added 113 tests and T2 added 2, so each candidate ran exactly base-1 plus its added tests.

`./test.sh` failed with exit 1 in every run. The baseline log `/tmp/vcc-recall-builtin-base-testsh.log` held 17 failing-test lines. Most are suite load failures in workspaces whose `dist` is not built. The T1 and T2 logs held the same 17 lines and no other.

Mutation checks:

| Mutation | Result |
| --- | --- |
| `load-messages.ts` skips entries before the latest compaction | 7 tests fail: 6 golden cases and the compaction test. |
| `load-messages.ts` skips entries off the path to the last entry | 5 tests fail: a golden case, 2 branch tests and 2 ported scope tests. |
| `forkBuiltInExtensions()` without `...FORK_OWNED_BUILTINS` | 3 tests in `fork-builtins.test.ts` fail, as the plan measured. |

`npm run check` exited 0 after T1 and after T2.

## Built outputs

T4 ran in `/tmp/vcc-recall-validate` at `e795c791f`. `npm install --ignore-scripts` and `npm run build:offline` exited 0, and `package-lock.json` stayed unchanged.

| Check | Output |
| --- | --- |
| `node /tmp/vcc-recall-dist-probe.mjs` | `{"switch":"unset","paths":["<inline:@juicesharp/rpiv-ask-user-question>","<inline:vcc-recall>"],"errors":[],"vccRecallRegistered":true}` |
| `PI_FORK_BUILTINS=off node /tmp/vcc-recall-dist-probe.mjs` | `{"switch":"off","paths":[],"errors":[],"vccRecallRegistered":false}` |
| `grep -rl vcc_recall dist/bundle` | `dist/bundle/chunks/chunk-DH5AADCP.js` |

Both `grep -F` validations exited 0. After the T5 build, the same probe against the main checkout's `dist/index.js` also printed `"vccRecallRegistered":true`.

## Cutover

| Item | Value |
| --- | --- |
| `settings.json` SHA-256 before | `8c31d9007f0c7ac9b58be99544193b146f40ff0485091e549d275f22adda33b9`, equal to plan Section 3 |
| Backup | `~/.pi/agent/settings.json.bak-vcc-recall`, same SHA-256 as the original |
| Edit | The line `"npm:@sting8k/pi-vcc",` removed; `JSON.parse` succeeds; 15 packages remain |
| `settings.json` SHA-256 after | `f9837414b97845f60c36cfae94321aa1920ab63dd9954f41a6e8791a1ab7980e` |
| Main-checkout build | `npm run build:offline` exited 0 in 5.7 s; `package-lock.json` unchanged from `ORIG_HEAD` |
| `pi list` | Exit 0; no `@sting8k/pi-vcc` |

Session files under `~/.pi/agent/sessions/--Users-paolof-Developer-ai-pi--/`:

| Step | Mode | Phrase | Session file | `vcc_recall` result |
| --- | --- | --- | --- | --- |
| 6 | `pi --unfenced` | `cobalt-heron-3050390074` | `2026-09-26T07-02-41-304Z_01a0dc85-f398-7791-8639-e1476a8b7c08.jsonl` | 1 result, contains the phrase, `isError` false |
| 7 | `pi --profile general` | `cobalt-heron-3388588434` | `2026-09-26T07-04-43-637Z_01a0dc87-d175-71c3-8766-dc66707ba6dc.jsonl` | 1 result, contains the phrase, `isError` false |

Neither file contains `"isError":true`. The fence journal `~/.pi-fence/violations/20260926T070443Z-060bbbf7.jsonl` confirms that step 7 ran fenced. That journal shows no denial on a pi-vcc path.

A first fenced session, `2026-09-26T07-03-40-303Z_01a0dc86-da0e-7711-a929-febcb610e14c.jsonl`, sent the step 6 phrase instead of the step 7 phrase. Its `vcc_recall` call also succeeded. The step 7 rerun replaced it as evidence.

## Deviations

| Item | Plan | Execution | Reason |
| --- | --- | --- | --- |
| Golden drill-down case | `#<index of the read result>:src/a.ts` | Recorded as written: `#3` yields `No file content found in entry #3 for "src/a.ts".` | A `read` result holds no tool call, so this case pins only the not-found text. The ported drill-down tests cover content output. |
| Fixture types | pi-vcc `tests/fixtures.ts` | `usage` is cast through `unknown` to `Usage`; the tool-call argument type is `ToolCall["arguments"]` | pi-vcc's usage shape predates Pi's `Usage`, and Pi now types arguments as `JsonObject`. The recall code reads neither. |
| Test `any` | Not stated for tests | Every `as any` in ported tests became a cast through `unknown` | `AGENTS.md` forbids `any`. No assertion changed. |
| Suite test index | "The tool result names the earlier turn" | The test expects `#1` for the first user turn | The session persists the system message as entry `#0`, and pi-vcc counts it the same way from the file. |
| T5 marker | Touched before each of steps 6 and 7 | Touched once, before step 6 | Each `find` filters on its own unique phrase, so one earlier marker is sufficient. |
| T5 `find` | Exactly one file per phrase | The implementing session's own file was excluded by `PI_SESSION_FILE` | The implementing session printed both phrases, so its file always matches. The user ruled to record this here rather than amend the plan. |
| T5 step 7 | One fenced session with a new phrase | Rerun once | The first fenced session sent the step 6 phrase. |

## Temporary files

The plan's cleanup list names the probe files. This run added the paths below. `/tmp/vcc-build.log` from the plan's list no longer existed. `/tmp/vcc-recall-builtin-handoff-prompt.txt` predates this run; this run leaves it for the user.

- Worktree: `/tmp/vcc-recall-validate`.
- Scripts: `/tmp/vcc-recall-builtin-baseline.sh`, `/tmp/vcc-recall-builtin-report.mjs`, `/tmp/vcc-recall-builtin-testsh-compare.mjs`, `/tmp/vcc-recall-builtin-edit-drill.mjs`, `/tmp/vcc-recall-builtin-edit-tests.mjs`, `/tmp/vcc-recall-golden.mjs`, `/tmp/vcc-recall-dist-probe.mjs`, `/tmp/vcc-recall-main-dist-probe.mjs`, `/tmp/vcc-recall-cutover-check.mjs`.
- Reports: `/tmp/vcc-recall-builtin-base-1.json` to `-3.json`, `/tmp/vcc-recall-builtin-t1-cand-1.json`, `/tmp/vcc-recall-builtin-t2-cand-1.json`.
- Logs: `/tmp/vcc-recall-builtin-base-testsh.log`, `/tmp/vcc-recall-builtin-baseline-driver.log`, `/tmp/vcc-recall-builtin-t1-check.log`, `/tmp/vcc-recall-builtin-t1-testsh-1.log`, `/tmp/vcc-recall-builtin-t1-commit.log`, `/tmp/vcc-recall-builtin-t2-check.log`, `/tmp/vcc-recall-builtin-t2-testsh-1.log`, `/tmp/vcc-recall-builtin-t2-commit.log`, `/tmp/vcc-recall-builtin-t3-commit.log`, `/tmp/vcc-recall-golden.log`, `/tmp/vcc-recall-validate-install.log`, `/tmp/vcc-recall-validate-build.log`, `/tmp/vcc-recall-main-build.log`.
- Other: `/tmp/vcc-recall-builtin-t2-appendix-b.patch`, `/tmp/vcc-recall-validate-probe-on.txt`, `/tmp/vcc-recall-validate-probe-off.txt`, `/tmp/vcc-recall-pi-list.txt`, `/tmp/vcc-recall-cutover-phrases.txt`, `/tmp/vcc-recall-cutover.marker`.

## Open user actions

- Optionally uninstall the npm package directory `~/.pi/agent/npm/node_modules/@sting8k/pi-vcc`. It no longer loads.
- Optionally delete `~/.pi/agent/pi-vcc-config.json`. The native tool loads no config.
- Add `vcc_recall` to OpenIntent's list of SDK-provided resources.
- Delete `~/.pi/agent/settings.json.bak-vcc-recall` once the cutover needs no rollback.

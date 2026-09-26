# pi-tokensave as a fork-owned built-in: results

This file records the execution of `docs/plans/tokensave-builtin.plan.md` on 2026-09-26. Tasks T0 to T10 are complete. `personal` now carries pi-tokensave as a fork-owned built-in in `packages/coding-agent/src/core/fork-builtins/tokensave/`. `~/.pi/agent/settings.json` no longer loads the source fork, and `~/.pi/agent/AGENTS.md` no longer holds the managed block. The coding-agent suite and `./test.sh` stayed at baseline after every task. Both live CLI modes ran a foreign-project query through the built-in. Section "Deviations" lists every departure from the plan.

## Commits

| Task | Commit | Message |
| --- | --- | --- |
| T0 | `181756cd9` | `docs: pi-tokensave built-in plan` |
| T1 | `9af1077ba` | `feat(coding-agent): copy pi-tokensave as a fork-owned module` |
| T2 | `220e865c7` | `feat(coding-agent): ship pi-tokensave as a fork-owned built-in` |
| T3 | `885310caa` | `feat(coding-agent): pi-tokensave no longer writes AGENTS.md` |
| T4 | `119cf4062` | `feat(coding-agent): pi-tokensave reads forkBuiltins settings and keeps the mode per session` |
| T5 | `c0e781bc8` | `feat(coding-agent): pi-tokensave tools accept a project path` |
| T6 | `c531ac686` | `feat(coding-agent): pi-tokensave rules cover projects and skip empty indexes` |
| T7 | `ce617eb7e` | `docs: ADR-0009 and README for the pi-tokensave built-in` |
| T9 | fast-forward | `personal` moved from `7f15419c1` to `ce617eb7e` with `git merge --ff-only`. |

BASE was `181756cd911b604662880a5c2040aaf902f99731`, the T0 commit on top of `7f15419c19593e3049c64ca0030dddbd185dfabb`. Every file changed after BASE is fork-owned: `fork-builtins.ts`, `fork-builtins.test.ts`, the module and test directories, ADR-0009 and this plan's documents.

## Baseline comparisons

The coding-agent runs used `.pi/skills/planning-changes/scripts/failing-tests.mjs` from the main checkout, one suite at a time, on a built tree.

| Run | Tests | Failed | Failures |
| --- | --- | --- | --- |
| base-1 | 3,779 | 0 | none |
| base-2 | 3,779 | 1 | `footer-data-provider` "updates the cached branch when the reftable directory changes" (known flake) |
| base-3 | 3,779 | 0 | none |
| T1 candidate | 3,927 | 0 | none |
| T2 candidates 1 to 3 | 3,928 | 1, 0, 0 | candidate 1: the same footer flake; 1 failure in 3 runs is within the known-flake limit |
| T3 candidate | 3,910 | 0 | none |
| T4 candidate | 3,916 | 0 | none |
| T5 candidate | 3,934 | 0 | none |
| T6 candidate | 3,942 | 0 | none |

Each candidate ran exactly the previous count plus the tests the task added, minus the tests it removed:

| Task | Tests added | Tests removed |
| --- | --- | --- |
| T1 | 148 | 0 |
| T2 | 1 | 0 |
| T3 | 1 | 19 |
| T4 | 6 | 0 |
| T5 | 18 | 0 |
| T6 | 8 | 0 |

`./test.sh` exited 0 on the baseline and after every task, and no log held a `FAIL`, `not ok` or unhandled-error line. `npm run check` exited 0 after every task, and the pre-commit hook passed on every commit.

Mutation checks. Each mutation made its named test fail, and each file was restored byte for byte.

| Task | Mutation | Failing tests |
| --- | --- | --- |
| T1 | `decodeStatusResponse` throws | "no registered tool throws when TokenSave returns an unexpected but valid plain-text response", plus 1 other |
| T2 | the `tokensave` entry removed from `FORK_OWNED_BUILTINS` | exactly 1: the registration test |
| T3 | `installRulesBlock` restored in `session_start` | the new byte-identity test and the rewritten agent-directory test |
| T4 | `/tokensave-mode` writes the mode into `settings.json` | the byte-identity test, plus 3 others |
| T5 | `sessionRoot` forwarded instead of `root` | the six-tool table (6 rows), plus the relative and absolute test |
| T5 | `project` deleted from `tokensave_search`'s schema | the six-tool table row for `tokensave_search` |
| T5 | the cwd check kept | the six-tool table (the uninitialized-cwd row of each tool) |
| T5 | the output prefix dropped | the absolute-file test, plus the `pathInclude` test |
| T5 | the input strip dropped | the impact input test and the `pathInclude` test |
| T5 | the ambiguity list formatted with the raw file | the absolute-file test (ambiguity rows) |
| T5 | the `/tokensave-sync` argument ignored | the status and sync command test |
| T5 | consultations keyed globally | the root A and root B test |
| T5 | the guard resolved from the cwd | the `../other` test, plus the root A and root B test |
| T6 | `before_agent_start` ignores the cache | the empty-index injection test |
| T6 | `/tokensave-sync` leaves the cache entry unchanged | the empty-to-ready test and the two-roots test |
| T6 | one global cache entry | the two-roots test and the foreign-empty test |
| T6 | the guard reads the session root's state | the foreign-empty test and the two-roots test |
| T6 (extra) | no reset after a reconciliation sync | the reconciliation test |

## Built outputs

T8 ran in `/tmp/tokensave-builtin-validate` at `ce617eb7e`. `npm install --ignore-scripts` and `npm run build:offline` exited 0, and the worktree stayed clean. The probe scripts, extracted from Appendix B, were byte-identical to the probe's copies.

| Check | Output |
| --- | --- |
| SDK, switch unset | `{"switch":"unset","paths":["<inline:@juicesharp/rpiv-ask-user-question>","<inline:vcc-recall>","<inline:tokensave>"],"errors":[],"tokensaveTools":6,"statusRan":true}` |
| SDK, `PI_FORK_BUILTINS=off` | `{"switch":"off","paths":[],"errors":[],"tokensaveTools":0,"statusRan":false}` |
| RPC, `dist/cli.js` | 2 lines; the `notify` holds `TokenSave v7.12.1` |
| RPC, `dist/bundle/cli.js` | 2 lines; the `notify` holds `TokenSave v7.12.1` |
| Print, `dist/cli.js` | exit 0, empty output |
| Print, `dist/bundle/cli.js` | exit 0 |
| Print, `dist/cli.js`, `PI_FORK_BUILTINS=off` | exit 1: `No API key found for the selected model.` |
| `grep -rl tokensave_find_symbol dist/bundle` | `dist/bundle/chunks/chunk-MJJ6CQAQ.js` |

Every `grep -F` validation exited 0. Each print run's temporary agent directory held only `auth.json` and `models-store.json`, so the module wrote no file there.

## Cutover

| Item | Value |
| --- | --- |
| `settings.json` SHA-256 before | `f9837414b97845f60c36cfae94321aa1920ab63dd9954f41a6e8791a1ab7980e`, equal to plan Section 3; round trip `exact 1455 1455` |
| `settings.json` backup | `~/.pi/agent/settings.json.bak-tokensave`, same SHA-256 as the original |
| `settings.json` edit | The package `../../Developer/ai/pi-tokensave` removed; `forkBuiltins["pi-tokensave"] = { autoManageBranches: true }` added; `JSON.parse` succeeds; 14 packages remain; no final newline |
| `settings.json` SHA-256 after | `61d5ab6e501b5c433a795dd3f543e941b996a914ba49095e47b2743a33bc25a0` |
| `AGENTS.md` SHA-256 before | `2a59f35ada5af7e908c389a4d7adacb358cfd464fbcd17967fbe051d82b92604`, equal to plan Section 3 |
| `AGENTS.md` backup | `~/.pi/agent/AGENTS.md.bak-tokensave`, same SHA-256 as the original |
| `AGENTS.md` edit | The owner approved the diff. The file built from the backup was byte-identical to the approved preview. `cmp` exited 0, and `grep -c pi-tokensave` printed 0. |
| `AGENTS.md` SHA-256 after | `24a3f54939445cd24d1276cfb1cace40fd9a3bceecdf44634748026be877c777` |
| Main-checkout build | `package-lock.json` unchanged from `ORIG_HEAD`; `npm run build:offline` exited 0 in 6.2 s |
| `pi list` | Exit 0; no `pi-tokensave` |
| Main-checkout SDK probe | `"tokensaveTools":6,"statusRan":true` |

Session files under `~/.pi/agent/sessions/--Users-paolof-Developer-ai-pi--/`:

| Step | Mode | Phrase | Session file | Result |
| --- | --- | --- | --- | --- |
| 7 | `pi --unfenced` | `amber-kestrel-365193307` | `2026-09-26T13-56-12-149Z_01a0de00-88f5-75ed-836d-359eb85e613c.jsonl` | Pass: marker present; `- file: /Users/paolof/Developer/ai/pi-fence/src/profile/loader.ts:99`; no `"isError":true` |
| 8, first run | `pi --profile general` | `amber-kestrel-1648551328` | `2026-09-26T13-58-14-462Z_01a0de02-66bd-7673-a750-baa65792c7cf.jsonl` | Fail: marker present, but SQLite could not open pi-fence's index (fence write denial) |
| 8, rerun | `pi --profile general` with a temporary overlay | `amber-kestrel-3323828994` | `2026-09-26T14-06-11-768Z_01a0de09-af38-7201-ac44-d636e88f8709.jsonl` | Pass: marker present; `- file: /Users/paolof/Developer/ai/pi-subagents/src/skills-contract.ts:114`; no `"isError":true` |

The step 8 rerun's fence journal is `~/.pi-fence/violations/20260926T140611Z-f5a718a1.jsonl`. It holds no denial on pi-subagents. Section "Deviations" explains its four lines that name pi-tokensave.

Step 9 and T10 step 7 checks: `AGENTS.md` stayed byte-identical to the expected file, and `settings.json` kept its step 3 hash.

## Deviations

| Item | Plan | Execution | Reason |
| --- | --- | --- | --- |
| T1 assertion census | Appendix A counts `assert.equal` 170 and `assert.ok` 54 | 167 and 53 were converted | The dropped smoke test holds exactly the 3 and 1 missing calls. |
| T2 header comment | Add pi-tokensave to the header's list of fork-owned built-ins | Added the line "The fork-owned built-ins are vcc-recall and tokensave (pi-tokensave)." | The header had no such list. |
| T3 kept rules test | Keep the fallback test unchanged | Its second half, which called `applyRulesBlock`, was removed | T3 deletes `applyRulesBlock`; that half tested `AGENTS.md` management. |
| Test names | Rewrite tests by source name | Five rewritten tests got names matching their new assertions: three in T3, and two more in T4, which also renamed two of T3's again | The old names described removed behavior; counts are unchanged. |
| T3 test fakes | Fakes gain `agentDir` and `getCallableTools` | Fake-HOME swaps that only isolated settings were removed, and settings moved into the agent directory | The module no longer reads `HOME` or `PI_CODING_AGENT_DIR`. |
| T6 existing tests | Not stated | `index.test.ts` gained a default fake, and its two reconciliation tests no longer count `tool` calls | The new `status` probe at `session_start` is a `tool` call; without the fake, some tests would spawn the real binary. |
| T5 guidelines | Each tool adds one sentence | One shared sentence is the second `promptGuidelines` element of every tool | Pi renders identical rules once, so the sentence appears once in the prompt. |
| T9 other sessions | The owner closes every other Pi session | The owner kept 12 older sessions (8 unfenced) running; their pids were recorded | They run the old build and never re-read the files. A settings write merges only changed keys. The residual risk is a `/new`, `/resume`, `/fork` or `/reload` in an unfenced old session, which rewrites the block. |
| T9 `pgrep` check | `pgrep -fl <pattern>` lists only the recorded pids | `pgrep -afl <pattern>` from a script file | macOS `pgrep` hides the caller's ancestors unless `-a` is given. A script file keeps the pattern out of the caller's command line. |
| T9 step 8 target | A fenced query of `../pi-fence` | A fenced query of `../pi-subagents`, through a temporary project overlay for the pi repo granting write on `~/Developer/ai/pi-subagents/.tokensave` | TokenSave opens its index in SQLite WAL mode, which writes the database and its `-wal` file even for reads. The `general` profile grants no write on another repository's `.tokensave/`. Plan Section 3's fence fact was measured on the cwd project only. The owner protects pi-fence, and pi-tokensave has no index. The overlay was deleted after the test. |
| T9 step 8 journal | `grep -l pi-tokensave <journal>` prints nothing | 4 lines: `file-read-metadata` of `pi-tokensave/.gitignore`, `README.md`, `package.json` and `src/agent-dir.ts` | The reads come from a startup metadata scan by the fenced Pi process across about 23 repositories. The same scan appears in the first step 8 launch (13 lines). Nothing touched `pi-tokensave/src/index.ts`, so the old extension did not load. The owner accepted step 8. |
| T10 worktrees | Remove all four worktrees and delete the branch | `/tmp/tokensave-builtin` and `feat/tokensave-builtin` stay for the owner | The implementing session runs inside `/tmp/tokensave-builtin`, so its `lsof` check cannot pass, and the branch is checked out there. |
| Plan defects | Amend the plan | Recorded here instead | Owner ruling. |

## Open user actions

- Optionally delete `~/.pi/agent/pi-tokensave.json`, which nothing reads.
- Delete `~/.pi/agent/settings.json.bak-tokensave` and `~/.pi/agent/AGENTS.md.bak-tokensave` once the cutover needs no rollback.
- Add pi-tokensave to OpenIntent's list of SDK-provided resources.
- Optionally grant the fence read and write on `~/.tokensave/`, which TokenSave touches but does not need.
- For `project` queries in fenced sessions, grant write on the target repository's `.tokensave/` (a project overlay or a profile). Without the grant, SQLite cannot open that index.
- Avoid `/new`, `/resume`, `/fork` and `/reload` in the sessions started before the cutover. Quit and restart them instead.
- After this session exits, remove `/tmp/tokensave-builtin` (`git worktree remove --force`, then `git worktree prune`) and delete the branch `feat/tokensave-builtin`.
- After the implementing session and the older sessions exit, confirm in the first new session that `grep -c pi-tokensave ~/.pi/agent/AGENTS.md` prints 0.

# Native subagents, phase 4: results

Phase 4 rebuilt pi-tasks as fork-owned code on branch `feat/subagents-native`. Each session owns one headless task service; seven task base tools and the `<inline:tasks>` presentation call it, and `TaskExecute` runs tasks through the subagent service's typed API. This file records each task's commit, test reports, mutation record and review, the phase runs, the phase review with its applied fixes, and the built-output checks. The plan is `docs/plans/subagents-native-phase4.plan.md`; the rulings are D16 to D53 in the session-control handoff. `## Cutover` follows with T15.

Every commit passed the pre-commit hook. `agent-session.ts`, `interactive-mode.ts` and `core/keybindings.ts` are unchanged against BASE `cd8573e32`.

## Commits

| Commit | Subject |
| --- | --- |
| `6da9e8c22` | docs: native subagents phase 4 plan |
| `743613234` | feat(coding-agent): the native task store, task settings and sort orders |
| `b7cec41ff` | feat(coding-agent): the native task service and the task list tools |
| `949cb1878` | feat(coding-agent): run tasks as subagents through the typed service |
| `7d8a84568` | feat(coding-agent): the tasks widget, /tasks and the task reminder |
| `9091f1a12` | docs: native tasks README, subagents README and ADR-0009 amendment |
| `7fd14fec4` | fix(coding-agent): a task's outcome at the session's end no longer depends on which service ends first |
| `6358cab9b` | fix(coding-agent): a task file's fields are normalized when it loads |
| `0b38baee3` | fix(coding-agent): task warnings reach the UI without escape sequences |
| `7a50b67bc` | fix(coding-agent): a task file that cannot be deleted no longer counts as deleted |
| `86429da73` | docs(coding-agent): the tasks README's auto-clear sentence reads plainly |

The results commit itself follows these.

## Tasks

Test reports, mutation specs and records sit in `/tmp/sn4-impl` during the phase. The results commit copies every mutation spec and record to `docs/plans/subagents-native-phase4-evidence/mutations/`. Each test report was run through `docs/plans/subagents-native-phase4-evidence/failing-tests.mjs`, and every final report printed `exit 0, unhandled 0`.

### T1 The task store, task settings and sort orders

Commit: `743613234`

Tests: /tmp/sn4-impl/T1-1.json: 5 files, 53 tests, 53 passed. /tmp/sn4-impl/T1-2.json (after the review fix): 5 files, 54 tests, 54 passed, 0 failed, 0 pending.

Mutations: /tmp/sn4-impl/mutations/T1.txt: 52 entries, 18 cases, all caught; restored | 0 of 47 failed; clean: yes. The probe's entries Q7, Q8, Q13, Q18, Q19, Q25 to Q27 and Q29 are among them.

Inventory: `check-cases.mjs coverage ... T1` checked 69 rows, offending 0.

Review:

- Critical: the store compares the file and then renames its temporary file over it in two steps, so two processes that resume one session can both pass the comparison and the second rename drops the first process's task (tasks/store.ts write). Rejected: D53 keeps pi-tasks' file lock dropped and rejects "restoring pi-tasks' lock and re-read"; plan R16 specifies the comparison before each write, which the store implements; closing the window needs the lock the ruling rejects. T5's README names the window as a known limitation.
- Important: a path check that cannot run while the store opens its file (a file where `.pi` belongs) moves the list to memory without keeping the path, so `retryWrite` never saves it, while T1 case 17 says a check that could not run is retried (tasks/store.ts open). Accepted: `open` keeps the path for `retryWrite` when the check failed; D53's comparison then refuses a file the store never read. Test "the task store retries a path whose check could not run at open, and never replaces a file it never read" (mutation T1-M43).
- none (round 2)

Notes and deviations:

- Deviation (review finding, accepted): `open` keeps the path for `retryWrite` when its symlink check could not run; D53's comparison then refuses a file the store never read. One test, mutation T1-M43.
- Note: the probe's eight store tests stay verbatim, so the probe's mutations target them; the new cases sit in `describe("the task store")`.

### T2 The task service, reminders, auto-clear and the four list tools

Commit: `b7cec41ff`

Tests: /tmp/sn4-impl/T2-1.json: 6 files, 76 tests, 76 passed. /tmp/sn4-impl/T2-2.json: 77 passed. /tmp/sn4-impl/T2-3.json: 6 files, 78 tests, 78 passed, 0 failed, 0 pending.

Mutations: /tmp/sn4-impl/mutations/T2.txt: 56 entries, 16 cases, all caught; restored | 0 of 55 failed; clean: yes. The probe's entries Q9, Q16, Q17, Q20, Q24 and Q28 are among them. Q15 serves case 1 through entry T2-M1 and again in T3's record; Q5 and Q6 name the presentation suite, which arrives in T4, so T4's record holds them, and T2-M20 and T2-M28 mutate the same lines against the service suite.

Inventory: `check-cases.mjs coverage ... T2` checked 78 rows, offending 0.

Review:

- Important: the task service's resource cleanup matches its session by id, so disposing one of two live sessions that share a session id disposes the other's service too (tasks/service/service.ts constructor; `packages/ai/src/session-resources.ts` passes only an id). Rejected: the runtime disposes a session before it builds the next (`agent-session-runtime.ts` `teardownCurrent`), so Pi never holds two live sessions with one id; the subagent service, the pattern P3 names, keys its cleanup the same way (`subagents/service/service.ts` constructor); a cleanup keyed by session object needs a line in the upstream-owned `agent-session.ts`, which R2 (D47) excludes. T5's README names the limitation.

Notes and deviations:

- Note: the tool descriptions and TaskCreate's prompt guidelines were compared with pi-tasks' texts at 83480bd and are verbatim; the suite pins their SHA-256.
- Note: the storage, reminder, auto-clear, session-start, fork and warning cases run on a fake session whose manager is a real `SessionManager`, as the probe's test does (T2 case 6).

### T3 Tasks on the typed subagent service

Commit: `949cb1878`

Tests: /tmp/sn4-impl/T3-1.json: 1 file, 23 tests, 21 passed, 2 failed (a wrong `resume` call and a held script that never reached its failing turn, both test mistakes; fixed). /tmp/sn4-impl/T3-2.json: 23 passed. /tmp/sn4-impl/T3-3.json to T3-6.json: 6 files, 139 tests, 139 passed. /tmp/sn4-impl/T3-7.json (after the review fixes): 6 files, 139 tests, 139 passed, 0 failed, 0 pending.

Mutations: /tmp/sn4-impl/mutations/T3.txt: 42 entries, 11 cases, all caught; restored | 0 of 55 failed; clean: yes. The probe's entries Q1 to Q4, Q10 to Q12, Q14 and Q15 are among them.

Inventory: `check-cases.mjs coverage ... T3` checked 75 rows, offending 0.

Review:

- Important: `execute` marks a task in progress, awaits the model and the spawn, then records the agent without checking that the task still exists, so a parallel `TaskUpdate` that deletes the task leaves an agent running with no task (tasks/service/service.ts execute). Rejected: the model asked for the agent in the same call, and a `detached-background` agent's completion notification still brings its result to the session when nobody reads it (`subagents/service/service.ts` notifications); pi-tasks has the same window between its spawn and its metadata update (`src/index.ts:1205-1215` at 83480bd); stopping the agent silently would contradict the call that started it.
- Important: TaskOutput cannot find a task by the id or id prefix of an agent that already ended, because the end handler removes the agent from the live map that `resolve` searches, while T3 case 5 finds a task by agent id (tasks/service/service.ts resolve). Accepted: `resolve` falls back to the task whose `metadata.agentId` matches; test "TaskOutput reports a failed agent's error and consumes it, and consumes a result read after the fact" reads the ended agent by id and prefix (mutation T3-M19).
- Important: TaskStop trusts the task's editable `metadata.agentId`, so a task in progress that names a bogus or unrelated agent id reports success and completes, or stops an agent that runs no task, while T3 case 6 refuses a task with no running agent (tasks/service/service.ts stop). Accepted: `stop` requires the live mapping from that agent to the task; test "TaskStop refuses a task with no running agent, an agent id only its metadata names, and an unknown id" (mutation T3-M24).
- Important (round 2): a TaskUpdate that deletes a running task's `metadata.agentId` makes TaskOutput and TaskStop by task id refuse the task, although the live map still holds its agent (tasks/service/service.ts output and stop). Rejected: the model removed the task's recorded agent link itself; the agent's end still completes or reverts the task through the live map (`onSubagentEvent`); T3 case 1 makes `metadata.agentId` the task's record of its agent, and pi-tasks read the same field (`src/index.ts:1115` at 83480bd).

Notes and deviations:

- Deviation (review findings, accepted): `resolve` falls back to the task whose `metadata.agentId` matches, so TaskOutput finds an ended agent's task by its id or prefix (mutation T3-M19); `stop` requires the live mapping from the agent to the task (mutation T3-M24). The TaskStop refusal test was renamed within the task before its commit, and its four inventory rows name the new title.
- Note: the model-forwarding test registers two faux models, so a dropped `model` is visible (T3-M3 was not caught with one model).

### T4 The presentation: widget, `/tasks` and the reminder hook

Commit: `7d8a84568`

Tests: /tmp/sn4-impl/T4-1.json to T4-7.json ran single files while the tests were written; their failures were test mistakes (a padded header, an ANSI reset after the dots) and two defects of the probe code, fixed before the review (see the deviations). /tmp/sn4-impl/T4-8.json: 6 files, 61 tests, 61 passed. /tmp/sn4-impl/T4-14.json (after the review fixes): 6 files, 66 tests, 66 passed, 0 failed, 0 pending.

Mutations: /tmp/sn4-impl/mutations/T4.txt: 56 entries, 9 cases, all caught; restored | 0 of 40 failed; clean: yes. The probe's entries Q5, Q6 and Q21 to Q23 are among them.

Inventory: `check-cases.mjs coverage ... T4` checked 80 rows, offending 0.

Review:

- Important: a session disposed directly, as an SDK caller's `session.dispose()` does, emits no `session_shutdown`, so the widget keeps its UI reference and its spinner timer ticks on (tasks/ui/index.ts; tasks/ui/widget.ts timer). Accepted: the widget stops without touching the UI once its service is disposed, as the subagents status line does (`subagents/ui/index.ts` bindStatus); test "the tasks widget's lifecycle stops without touching the UI once its service is disposed" (mutation T4-M30).
- Important: a settings save reads the project values the session cached, so a value another process wrote to the project `settings.json` since then is dropped by the whole-section write (tasks/ui/menu.ts save). Accepted: the save rereads the settings first, as the subagents menu does (`subagents/ui/settings-menu.ts` saveSubagentSetting); test "the task settings list keeps a project value another process wrote after the session read the file" (mutation T4-M46).
- Important (round 2): task subjects, active forms and descriptions reach the terminal with their escape sequences, so a task text the model copied from a file holding an OSC 52 sequence writes the clipboard through the widget or the `/tasks` menu (tasks/ui/widget.ts row; tasks/ui/menu.ts). Accepted: the widget and the menu show task text through `displayText`, as the subagents surfaces do (`subagents/tools/details.ts`), and widget rows fold newlines; the stored text stays as given; tests "the tasks widget's rows strips escape sequences and control characters from task text, and folds its newlines" and "the /tasks menu strips escape sequences from the task text it lists and titles" (mutations T4-M17, T4-M41).
- Important (round 2): in RPC mode the widget sends its lines only on a task change, so the elapsed time and tokens of a worked-on row stay as they were (tasks/ui/widget.ts sync). Rejected: P9 makes the RPC widget a plain-line snapshot per change, rendered at frame 0 so its spinner is static too; each `setWidget` becomes one JSONL notification to the client (`rpc-mode.ts:205-216`), so a refresh timer would stream the widget several times a second while any task runs.
- Important (round 3): task ids, blocker ids and the agent label still reach the terminal raw, and `metadata.agentId` is editable through TaskUpdate while a task file can hold any string id (tasks/ui/widget.ts row; tasks/ui/menu.ts). Accepted: the widget and the menu show every id and the agent label through `displayText`, and lookups keep the stored values; the two strip tests gained hostile ids and agent ids (mutations T4-M18, T4-M19, T4-M42).
- Important (round 4): after the round 3 fix, two stored ids that differ only in stripped characters show the same `/tasks` choice, and `choices.indexOf(selected)` then opens the first of them (tasks/ui/menu.ts viewTasks). Accepted: a label that repeats an earlier one gains its row number; test "the /tasks menu keeps two tasks apart whose ids show alike once stripped" (mutation T4-M43).
- Important (round 5): the round 4 suffix is not checked again, so a subject that already ends in ` (row <n>)` can still collide with a suffixed label (tasks/ui/menu.ts viewTasks). Accepted: the suffix repeats until the label is unique; the test gained three rows whose second subject already ends in the suffix (mutation T4-M43). No sixth round ran: Paolo asked on 2026-09-29 to skip the next re-review when only minor points remain.

Notes and deviations:

- Deviation (found while writing the tests): the settings list did not await `SettingsManager.reload()` before it reloaded the service, so the service kept the old values; saves now await the reload and run one after another. Warnings the service held before any listener went to the widget's subscription; the notification listener now subscribes first.
- Deviation (review findings, accepted): the widget stops once its service is disposed; a settings save rereads the file first; task text, ids and agent labels pass through `displayText`; `/tasks` keeps choices unique when two ids show alike.
- Deviation: the review ran five rounds. After round 5's fix, Paolo asked to skip the next re-review when only minor points remain, so no sixth round ran (Decisions by Paolo).

### T5 Documentation and the full inventory check

Commit: `9091f1a12`

Tests: /tmp/sn4-impl/T5-1.json: the 10 files the inventory's covering tests name, 151 tests, 151 passed, 0 failed, 0 pending.

Mutations: none; documentation only.

Inventory: `check-cases.mjs inventory` reports rows: 456 (T1 69, T2 78, T3 75, T4 80, Dropped 154), offending: 0. `check-cases.mjs coverage $E4/old-cases.md $R/T5-1.json $R/mutations` checked 302 rows, offending 0.

Review:

- none

Notes and deviations:

- Deviation: the doc comment of `subagentScope` (`subagents/service/sessions.ts`) claimed the bus adapter and skill-fork call it; it now says they resolve the same scope from the lineage. The file is outside T5's list.

### T8 Validate the built outputs and run the smoke

T8 passed at commit `86429da73`.

Build: `npm run build:offline` exit 0 (/tmp/sn4-impl/T8-build.log); `dist/core/fork-builtins/tasks/ui/index.js` exists.

on: exit 0: {"switch":"unset","mode":"on","sources":{"Agent":"<builtin:Agent>","get_subagent_result":"<builtin:get_subagent_result>","steer_subagent":"<builtin:steer_subagent>"},"presentation":{"loaded":true,"command":true,"renderer":true},"widget":true,"quitAwaited":true,"errors":[],"pass":true}

off with PI_FORK_BUILTINS=off: exit 0: {"switch":"off","mode":"off","sources":{"Agent":"none","get_subagent_result":"none","steer_subagent":"none"},"presentation":{"loaded":false,"command":false,"renderer":false},"widget":false,"quitAwaited":false,"errors":[],"pass":true}

off without the switch: exit 1: {"switch":"unset","mode":"off","sources":{"Agent":"<builtin:Agent>","get_subagent_result":"<builtin:get_subagent_result>","steer_subagent":"<builtin:steer_subagent>"},"presentation":{"loaded":true,"command":true,"renderer":true},"widget":false,"quitAwaited":false,"errors":[],"pass":false}

Smoke (`$E4/run-smoke.sh "$PWD/packages/coding-agent/dist" /tmp/sn4-impl/smoke`), exit 0:

```text
pass 00-print: task file saved
pass 00-shell-id: rejected
surface surface:214
pass 01-start: escape interrupt
pass 02-widget: 1 tasks (1 in progress)
pass 03-agent: smoke task one (agent 
pass 04-done: 1 tasks (1 done)
pass 05-output: checked: Task #1 [completed]: subagent
pass 05-result:  | smoke child done
pass 06-menu: View all tasks (1)
pass 07-settings: Task Settings
pass 08-quit: SMOKE-EXIT 0
```

Afterwards `ls -A /tmp/sn4-impl/home` printed nothing, `git status --short` printed nothing, and `shasum -a 256 -c /tmp/sn4-impl/live-settings.sha256` passed.

## Phase runs

T6 ran the full coding-agent suite and `./test.sh` once, before the phase review (D36).

- Full coding-agent run: /tmp/sn4-impl/phase.json: 459 files, 5,435 tests, 5,384 passed, 1 failed, 50 pending; `exit 1, unhandled 1`. `failing-tests.mjs diff base-1.json phase.json` lists one new failure, `agent-session-concurrent.test.ts` "should queue extension-origin steering messages while streaming", a known flake. The unhandled rejection is an `ENOENT` on `auth.json.lock` from the same file's teardown, which runs with `PI_FORK_BUILTINS=off`. Paolo ruled it part of the known flake (Decisions by Paolo).
- ./test.sh: /tmp/sn4-impl/phase-testsh.log, exit 0. `Vitest caught` appears 0 times, as in the baseline; 11 `Test Files` lines and 1 `ℹ tests` line; the failure ids and the package lists equal the baseline's.
- `check-identities.mjs base-1.json phase.json /tmp/sn4-impl`: baseline 5,274, phase 5,429, task reports 5, fix reports 0, offending 0; exit 0. After T7: fix reports 4, offending 0; exit 0.
- Footprint: `git diff --numstat cd8573e32 -- agent-session.ts interactive-mode.ts core/keybindings.ts` prints nothing.
- No T6-R task: no failure beyond the known flake.

## Phase review

`/tmp/sn4-impl/phase-review.md`, verbatim:

Verdict: With fixes

Scope: super-code-review over cd8573e320e3b8189df605cc5e74cf1cd5a75c30..9091f1a12 (34 files outside docs/plans), fan-out mode, 12 lenses: requirements, correctness, guidelines, security, error handling, type design, test coverage, architecture, evolvability, performance, comments, docs impact (simplification skipped as opt-in). Spec: docs/plans/subagents-native-phase4.plan.md and the session-control handoff, rulings D16 to D53. Each finding below was checked against the source; F2 and F3 were reproduced with a scratch probe. Correctness and docs impact reported no finding.

### F1: The order in which the two services end changes the outcome of a task whose agent still runs
Lens: requirements. Evidence: tasks/service/service.ts dispose skips a mapped task that is no longer `in_progress`, while the subagent service's end emits `aborted`, whose handler sends every mapped task to pending (`onSubagentEvent`). A task the model set to completed or pending while its agent ran therefore reaches the fork as completed or as pending, depending on cleanup order. T3 case 8 and P8 require the same outcome either way. Fix: dispose treats every mapped task as the event does; extend the cleanup-order test with a task the model changed.
Disposition: Accepted
Approved: 2026-09-29, Paolo selected "F1 same task outcome whichever service ends first (Recommended)"
Applied: 7fd14fec4

### F2: A task file's fields other than the id load unchecked, so a hostile or damaged file crashes the tools and the UI or injects escape sequences
Lenses: security, type design, test coverage. Evidence: tasks/store.ts parseTaskFile checks only `id`; a probe loaded `subject: null`, `description: 5`, `status: "\u001b]52;c;YWJj\u0007"` and `blockedBy: [3]` unchanged. TaskGet then throws on `description.replace`, `displayText(null)` throws (`utils/ansi.ts` stripAnsi), and `/tasks` shows the raw status (ui/menu.ts). Fix: `normalizeTask` defaults non-string `subject`, `description`, `activeForm` and `owner`, maps an unknown status to `pending`, and keeps only string edges; the menu shows the status through `displayText`; one store test with a hostile file.
Disposition: Accepted
Approved: 2026-09-29, Paolo selected "F2 validate every field of a loaded task file (Recommended)"
Applied: 6358cab9b

### F3: Warnings reach the notifications with the escape sequences their sources hold
Lens: security. Evidence: a probe of a malformed task file produced a warning holding a raw ESC, because the store quotes the JSON parse error (tasks/store.ts open); an unknown settings key enters its warning verbatim (tasks/settings.ts). ui/index.ts passes each warning to `ctx.ui.notify` unchanged, and ui/menu.ts does the same for a failed save. Fix: both notify through `displayText`; one presentation test.
Disposition: Accepted
Approved: 2026-09-29, Paolo selected "F3 sanitize warnings before they are notified (Recommended)"
Applied: 0b38baee3

### F4: deleteFileIfEmpty reports a deletion that failed
Lens: error handling. Evidence: tasks/store.ts deleteFileIfEmpty catches every unlink error, clears `lastText` and returns true; the file stays, so the next write reports "changed outside this session", a wrong reason. Fix: ignore only ENOENT; any other error moves the list to memory with that error.
Disposition: Accepted
Approved: 2026-09-29, Paolo selected "F4 deleteFileIfEmpty reports only a real deletion (Recommended)"
Applied: 7a50b67bc

### F5: TaskOutput swallows every failure of waitForResult
Lens: error handling. Evidence: tasks/service/service.ts output catches the wait's rejection.
Disposition: Rejected: `waitForResult` rejects only for an unknown agent or an aborted signal (subagents/service/service.ts waitForResult); `output` waits only while the agent is mapped, so its record exists, and the abort is the timeout or the call's own signal, both expected.

### F6: A render error blanks the widget without a report
Lens: error handling. Evidence: tasks/ui/widget.ts render returns no line on a throw.
Disposition: Rejected: the module states the design ("A render that throws draws nothing for one frame"), as pi-tasks' widget did (`src/ui/task-widget.ts` at 83480bd); a report per 150 ms frame would repeat, and F2 removes the reachable cause, a task with non-string fields.

### F7: A failed notification is swallowed
Lens: error handling. Evidence: tasks/ui/index.ts catches `ctx.ui.notify`.
Disposition: Rejected: the notification is the report channel itself; the comment there says a UI that cannot notify cannot show any other report either.

### F8: The task service combines lifecycle, list, reminder, execution and handoff in one class
Lens: architecture. Evidence: tasks/service/service.ts, about 520 lines.
Disposition: Deferred: a refactor with no defect today, as phase 2 F13 (splitting the subagent service) is; it belongs with a change that adds execution states.

### F9: Execution state is spread over status, metadata and two maps
Lens: evolvability. Evidence: tasks/service/service.ts `agentTasks`, `working`, `metadata.agentId`.
Disposition: Deferred: no defect today; a typed execution state fits the same later refactor as F8.

### F10: Task ids are strings but ordered with Number(id)
Lens: evolvability. Evidence: tasks/store.ts list, tasks/sort.ts, tasks/tools/tools.ts TaskList; a non-numeric id from a hand-edited file orders by NaN.
Disposition: Deferred: pi-tasks orders the same way (`src/task-sort.ts` at 83480bd), and every id the store creates is numeric; one comparator fits a change that allows other ids.

### F11: TaskExecute resolves the model and spawns each ready task one after another
Lens: performance. Evidence: tasks/service/service.ts execute awaits each spawn in its loop.
Disposition: Rejected: pi-tasks spawned in the same serial loop (`src/index.ts:1180-1225` at 83480bd); a `detached-background` spawn returns once its record exists, and the runs do not wait for each other.

### F12: on_task_complete writes the file once per cleared task
Lens: performance. Evidence: tasks/auto-clear.ts onTurnStart calls `store.delete` per expired task.
Disposition: Rejected: a turn clears the tasks completed four turns earlier, a handful at most; pi-tasks deletes the same way (`src/auto-clear.ts` at 83480bd).

### F13: The widget sorts the whole list on every spinner frame
Lens: performance. Evidence: tasks/ui/widget.ts renderTaskLines per 150 ms frame.
Disposition: Rejected: task lists hold tens of tasks, and pi-tasks' widget sorted, and reread the file, on every render (`src/ui/task-widget.ts` and `src/task-store.ts` `list` at 83480bd); a cached view would add invalidation for no measured cost.

### F14: The store hands out its live task objects
Lens: type design. Evidence: tasks/store.ts get, list and create return the stored records.
Disposition: Deferred: an API hardening with no defect today; every caller is the service, the tools and the widget, which mutate nothing; as phase 3 F7 (read-only tombstones), it fits a change that adds another caller.

### F15: The README's auto-clear sentence is hard to parse
Lens: comments. Evidence: tasks/README.md "A list that auto-clear, a deletion or a clear empties deletes its file and leaves `.pi/tasks/` in place."
Disposition: Accepted
Approved: 2026-09-29, Paolo selected "F15 reword the README's auto-clear sentence (Recommended)"
Applied: 86429da73

### F16: The tool descriptions use em dashes
Lens: comments. Evidence: tasks/tools/descriptions.ts TaskUpdate and TaskExecute texts.
Disposition: Rejected: plan P23 keeps Claude Code's tool descriptions verbatim; only the service's own answers use colons.

### F17: The README's opening paragraph is one sentence over 25 words
Lens: comments. Evidence: tasks/README.md line 3.
Disposition: Rejected: the paragraph holds seven sentences and 80 words; the longest sentence has 18 words.

### F18: Exported shapes are interfaces instead of type aliases
Lens: guidelines. Evidence: tasks/store.ts, service/service.ts, settings.ts, reminder.ts, ui/menu.ts, ui/widget.ts.
Disposition: Rejected: no repository rule prefers type aliases, every import of them is `import type` and erased, and phase 3 review F11 recorded the same disposition.

- Phase review: super-code-review, fan-out mode, 12 lenses (simplification skipped as opt-in). Verdict: With fixes. 18 findings: F1 to F4 and F15 Accepted and approved by Paolo on 2026-09-29; F8 to F10 and F14 Deferred; F5 to F7, F11 to F13 and F16 to F18 Rejected.

### T7-F1 The order in which the two services end changes a task's outcome

Commit: `7fd14fec4`

Tests: /tmp/sn4-impl/T7-F1-1.json: 20 files (every file T1 to T4 ran), 303 tests, 303 passed, 0 failed. A run of the new test before the fix failed the task-service-first order (/tmp/sn4-impl/diagnostic-runs/T7-F1-repro.json).

Mutations: /tmp/sn4-impl/mutations/T7-F1.txt: 1 entry, caught; restored | 0 of 25 failed; clean: yes.

Review:

- none

### T7-F2 A task file's fields other than the id load unchecked

Commit: `6358cab9b`

Tests: /tmp/sn4-impl/T7-F2-1.json: 20 files, 304 tests, 304 passed, 0 failed.

Mutations: /tmp/sn4-impl/mutations/T7-F2.txt: 4 entries, caught; restored | 0 of 29 failed; clean: yes.

Review:

- none

### T7-F3 Warnings reach the notifications with their escape sequences

Commit: `0b38baee3`

Tests: /tmp/sn4-impl/T7-F3-1.json: 20 files, 306 tests, 306 passed, 0 failed.

Mutations: /tmp/sn4-impl/mutations/T7-F3.txt: 2 entries, caught; restored | 0 of 26 failed; clean: yes.

Review:

- none

### T7-F4 deleteFileIfEmpty reports a deletion that failed

Commit: `7a50b67bc`

Tests: /tmp/sn4-impl/T7-F4-1.json: 20 files, 307 tests, 307 passed, 0 failed.

Mutations: /tmp/sn4-impl/mutations/T7-F4.txt: 2 entries, caught; restored | 0 of 30 failed; clean: yes.

Review:

- none

### T7-F15 The README's auto-clear sentence is hard to parse

Commit: `86429da73`

Tests: none; documentation only.

Mutations: none; no behavior changes.

Review:

- none

Notes and deviations:

- Deviation: the commit subject starts `docs(coding-agent):` instead of `fix(coding-agent): <finding>`, because the change touches no behavior. The same commit names a failed deletion in the README's failure table, which T7-F4 made behave like a failed write.

## Decisions by Paolo

- 2026-09-29, T4 review gate: Paolo asked to skip the next re-review when only minor points remain ("if there are only minor left, please skip the next re-review and go on with the next step"). T4 committed after round 5's fix without a sixth round.
- 2026-09-29, T6: the full coding-agent run (phase.json) failed `agent-session-concurrent.test.ts` "should queue extension-origin steering messages while streaming" and printed `unhandled 1`: an `ENOENT` on `auth.json.lock` raised from the same file's teardown, with `PI_FORK_BUILTINS=off`. Paolo selected "Count it as part of the known flake (Recommended)". No T6-R task; the results file records the unmet `unhandled 0` check as a deviation.
- 2026-09-29, T7: Paolo approved phase review findings F1, F2, F3, F4 and F15 for application, selecting each as recommended.

## Deviations

Each task section above lists its own deviations. Across the phase:

- The regression runs follow D36: each task ran `npm run check`, the test files its changes touch and at least one mutation per case; the full suites ran once, in T6.
- The phase run's `unhandled 0` check was not met: the one unhandled rejection came from the known flake file's teardown, and Paolo ruled it part of the flake.
- Accepted per-commit review findings changed the probe's verified code in T1, T3 and T4, and two defects found while writing T4's tests changed it too.
- The mutation specs carry more entries than one per case, because every inventory row needs a covering test that a mutation of its case breaks. The T1 to T4 specs match the code at their own commits; later fixes changed some of the lines they mutate.
- Three diagnostic runs that matched the fix-report name pattern (`T7-F1-repro`, `T7-F2-repro`, `T7-F3-probe`) moved to `/tmp/sn4-impl/diagnostic-runs/`, so Section 9's report glob reads only the fixes' own reports.

## Open items

- The workflow work excludes `Agent`, `get_subagent_result`, `steer_subagent`, `TaskExecute`, `TaskOutput` and `TaskStop` from worker sessions, with a test that a worker's model never receives them, before it resumes (D43, D51).
- Phase 2's deferred findings F11 (viewer render caching), F13 (splitting the service) and F14 (a shared settings schema) stay open.
- Phase 3 review F7 (read-only tombstones, `reopen` keyed by handle), F8 (one list of mention candidates) and F10 (a user page for subagents) stay open; the task service never reads tombstones or reopens an agent.
- Phase 4 review F8 (splitting the task service), F9 (a typed execution state), F10 (one task-id comparator) and F14 (read-only task snapshots) are deferred.
- The requirements lens noted three plan wordings to clarify in a later plan: T1 case 5 detects direct two-task cycles only; T3 case 2's `No tasks to execute.` answers an empty id list; the TaskStop schema requires `task_id` but accepts extra properties.
- Closed: the agent files' unknown keys (phase 3 Section 10). `47c063242` removed `persistSession` from `.pi/agents`, and on 2026-09-29, with Paolo's yes, `~/.pi/agent/agents/*.md` lost it too and five files took `thinking:`.

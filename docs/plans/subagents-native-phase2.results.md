# Native subagents, phase 2: results

Phase 2 added the presentation of native subagents as one inline factory, `<inline:subagents>`, on branch `feat/subagents-native`. It restructured the service first and fixed phase 1 review findings F11, F13, F14 and F15, then rendered `Agent` calls with live progress (F12). This file records each task's commit, test reports, mutation record and review, the phase runs, the phase review with its applied fixes, the SDK probe and the deviations. The plan is `docs/plans/subagents-native-phase2.plan.md`; the rulings are D16 to D40 in the session-control handoff. Every commit passed the pre-commit hook. `agent-session.ts` is unchanged against BASE, and `core/keybindings.ts` changes only its two fork lines.

## Commits

| Commit | Subject |
| --- | --- |
| `82fac8be5` | docs: native subagents phase 2 plan |
| `0e5533eef` | docs: apply review pass 3 to the native subagents phase 2 plan |
| `4fac58849` | docs: let the phase 2 plan's setup check accept several plan commits |
| `4291af00c` | fix(coding-agent): layer the subagents module and split its service |
| `d7aaabb03` | fix(coding-agent): report a subagent steer that fails to deliver |
| `79bf34ef0` | fix(coding-agent): hand out subagent records, settings and definitions read-only |
| `1ae9994e1` | fix(coding-agent): refuse subagent memory behind a symlinked ancestor directory |
| `9ebe91e59` | feat(coding-agent): fork keybindings in one list, with the subagent viewer keys |
| `034e1a1e6` | feat(coding-agent): subagents presentation factory that awaits child teardown on quit |
| `5efc2eb63` | feat(coding-agent): subagent display formats and agent color badges |
| `7d6ac40c1` | feat(coding-agent): render Agent calls with live progress |
| `f65bdcae2` | feat(coding-agent): render subagent notifications |
| `e96866025` | feat(coding-agent): subagent widget above the editor |
| `2cd7a89c5` | feat(coding-agent): subagent conversation viewer |
| `fece61620` | feat(coding-agent): FleetView agent list below the editor |
| `77c2dff4f` | feat(coding-agent): /agents lists, edits, ejects and toggles agents |
| `008d6de5c` | feat(coding-agent): /agents create wizard |
| `e4d8d3213` | feat(coding-agent): /agents settings menu writes the project settings |
| `7d4f0cdf7` | docs: native subagents phase 2 README and ADR-0009 amendment |
| `5a867f26a` | fix(coding-agent): a foreground Agent call returns on abort while its child starts |
| `2924855bc` | fix(coding-agent): subagent conversations include the message the child streams |
| `a2c022b7e` | fix(coding-agent): steer tools stop waiting when their call is aborted |
| `25ad9ebec` | fix(coding-agent): the subagents presentation prints child output without escapes |
| `b6a4466bc` | fix(coding-agent): the subagent viewer closes its steer composer when the agent stops |
| `db058147b` | fix(coding-agent): /agents enables every spelling of a disabled agent file |
| `bb7b60f45` | docs(coding-agent): split the subagent service header into short sentences |
| `624936eaf` | fix(coding-agent): the refuseSymlinks comment names the boundary it keeps |
| `2b53c0081` | fix(coding-agent): the subagents README title names the presentation |

The results commit itself follows these.

## Tasks

Test reports, mutation specs and records sit in `/tmp/sn2-impl` during the phase. This commit copies every mutation spec and record to `docs/plans/subagents-native-phase2-evidence/mutations/`.

### T1 Layer the subagents module and split its service (F14)

Commit: `4291af00c`

Tests: /tmp/sn2-impl/T1-1.json: 20 files, 312 tests, 312 passed, 0 failed, 0 pending.

Mutations: /tmp/sn2-impl/mutations/T1.txt: 1 entry (T1-M1, probe P1), caught; restored | 0 of 2 failed; clean: yes.

Review:

- none

Notes and deviations:

- wc -l service/service.ts: 873 (was 1,045).
- Deviation: the README's nesting paragraph now names tools/nested.ts next to service/nested.ts (a path T1 moved).
- Deviation: service.ts gains `busSkills(eventBus)`, the skill list the three loadAgentRegistry callers pass; records.ts gains `inBackground(mode)`; the batch window is the class `SpawnBatch` in joins.ts.

### T2 Report a failed steer (F11, R13)

Commit: `d7aaabb03`

Tests: /tmp/sn2-impl/T2-1.json: 4 files, 78 passed, 0 failed. /tmp/sn2-impl/T2-2.json (after the review fix): 4 files, 79 passed, 0 failed.

Mutations: /tmp/sn2-impl/mutations/T2.txt: 7 entries, all caught; restored | 0 of 36 failed; clean: yes. The pre-review record is /tmp/sn2-impl/mutations/T2-pre-review.txt (6 entries).

Review:

- Important: a steer could report `delivered` and emit `subagents:steered` after `stop()` or the owner's end during the child's `session.steer` await (service.ts steer). Accepted: `stop()` sets `stopped` synchronously (service.ts endRecord) while `AgentSession.steer` awaits `_queueTokenized`; `steer` now rechecks `disposed` and the status after the await and returns `refused`; test "refuses a steer whose agent stops while the steer is delivered, and announces nothing" (mutation T2-M7).

Notes and deviations:

- Deviation: the README's steer_subagent and subagents:steered rows now state the failed-steer behavior.
- Deviation: the nested test lives under the describe "nested ownership", next to the existing nested steer test.

### T3 Hand out records, settings and definitions read-only (F13)

Commit: `79bf34ef0`

Tests: /tmp/sn2-impl/T3-1.json: 18 files, 231 passed, 0 failed.

Mutations: /tmp/sn2-impl/mutations/T3.txt: 9 entries (one tsgo, TS2578), all caught; restored | 0 of 34 failed; clean: yes.

Review:

- Important: a symlink swapped in for `.pi` or `settings.json` between the writer's lstat check and the storage's write could redirect a save outside the project (settings.ts writeProjectSubagentSettings). Rejected: plan P12 (docs/plans/subagents-native-phase2.plan.md, Section 2.1) makes the storage create a missing file and the lstat check of a planted symlink the guard; the suggested fix, bypassing the storage's first write, contradicts P12, and the race needs a process writing the trusted project's `.pi` during the save itself.

Notes and deviations:

- Deviation: cases 2 to 4 (frozen service settings, conversation, queuePosition) live in test/suite/fork-subagents-service.test.ts, the suite "service.test.ts", because they need real child sessions; the module service.test.ts gained only the import paths of T1.
- Deviation: `refuseSymlinks` (P27) is not added in T3; T3's settings writer checks `.pi` and `settings.json` itself. T13 adds `refuseSymlinks` for agent files.
- Deviation: `SubagentView` adds `parentId` and `worktreePath` fields to the internal record, which back the view's fields of those names. Owner parameters compare by id.
- Deviation: the README's service and settings paragraphs describe the views, the accessors and the validated writer.
- Deviation: settings.test.ts mocks node:fs as a passthrough so case 8 can make the rename fail.

### T4 Refuse memory behind a symlinked ancestor (F15)

Commit: `1ae9994e1`

Tests: /tmp/sn2-impl/T4-1.json: 2 files, 30 passed. /tmp/sn2-impl/T4-2.json (after the review fix): 2 files, 31 passed.

Mutations: /tmp/sn2-impl/mutations/T4.txt: 5 entries, all caught; restored | 0 of 8 failed; clean: yes. Pre-review record: T4-pre-review.txt (4 entries).

Review:

- Important: an unreadable memory directory made a read-only agent fail to start, because `lstatSync` with `throwIfNoEntry: false` still throws `EACCES` (memory.ts symlinkBelowRoot), where phase 1's `isSymlink` swallowed it. Accepted: an unreadable component now ends the walk as missing, so the read-only block has no content and read-write fails as before; test "gives a read-only agent an empty block when a memory directory cannot be read" (mutation T4-M5).

Notes and deviations:

- Deviation: a symlinked memory directory `<name>` itself keeps phase 1's error `Refusing to use a symlinked memory directory: <dir>`, because the existing test expects "symlinked memory directory" and T4's validation keeps it passing (P29). Every other link gives the plan's `Refusing to use subagent memory behind a symlink: <path>`.
- Deviation: a symlinked MEMORY.md now also refuses read-write memory (T4 lists MEMORY.md among the checked components); phase 1 only ignored it.
- Deviation: the README's `memory` frontmatter row states the rule.

### T5 One fork keybinding list with the viewer keys (R12)

Commit: `9ebe91e59`

Tests: /tmp/sn2-impl/T5-1.json: 3 files, 89 passed, 0 failed.

Mutations: /tmp/sn2-impl/mutations/T5.txt: 1 entry (T5-M1, probe P6), caught; restored | 0 of 2 failed; clean: yes.

Review:

- none

Notes and deviations:

- Footprint: `git diff --numstat $BASE -- core/keybindings.ts` prints `2 2`, and the four changed lines equal Appendix B.

### T6 The presentation factory (R2, R4, R5)

Commit: `034e1a1e6`

Tests: /tmp/sn2-impl/T6-1.json: 4 files, 43 passed. /tmp/sn2-impl/T6-2.json (after the review fixes, with fork-subagents-adapter.test.ts added because the bridge changed): 5 files, 68 passed.

Mutations: /tmp/sn2-impl/mutations/T6.txt: 15 entries, all caught; restored | 0 of 42 failed; clean: yes. Pre-review record: T6-pre-review.txt (13 entries). Probe P2 to P5 and P7 to P10 are T6-M2, M3, M8, M13, M1, M9, M10 and M11.

Review:

- Important: a foreground `Agent` call whose child's extension factory never resolves keeps the tool pending, so `AgentSession.shutdown()` and runtime replacement, which await `abort()` before `session_shutdown`, never reach the bounded `shutdown()` (ui/index.ts). Rejected: the diff does not reach that path; the foreground wait without a signal is phase 1 code (tools/agent.ts:277, unchanged), and `agent-session.ts:1864-1872` awaits `abort()` before any `session_shutdown` handler runs. Recorded as an open item for Paolo.
- Important: after a direct `session.dispose()`, the service's `ended` event scheduled a status update that read the invalidated extension context in a microtask and threw outside the service's listener guard (ui/index.ts bindStatus). Accepted: the update returns once the service is disposed; test "writes no status through the context of a session disposed directly" (mutation T6-M15).
- Important: a foreground spawn that waits for a slot emitted no service event, so the status kept `1 running agent` instead of `1 running, 1 queued agents` (service.ts launch). Accepted: the service emits a `queued` event, which the bus adapter does not bridge (D19); test "counts a foreground agent that waits for a slot" (mutation T6-M14).

Notes and deviations:

- Deviation: the status line's update is coalesced to one microtask per event burst, so a spawn's `created` and `started` give one change.
- Deviation: the service emits a new typed event `queued` (review finding); the bus adapter bridges nothing for it, so the `subagents:*` events stay as they were (D19).
- Deviation: the presentation suite adds two cases beyond the plan's list: a queued foreground agent in the status, and no status write after a direct `dispose()` (review findings).
- Open item: a foreground `Agent` call whose child's extension factory never resolves still hangs quit, before `session_shutdown` (phase 1 behavior, review finding rejected as outside the diff).

### T7 Display formats, agent colors and the effective model

Commit: `5efc2eb63`

Tests: /tmp/sn2-impl/T7-1.json: 4 files, 45 passed, 5 failed (a case-sensitive color regex, fixed before commit). /tmp/sn2-impl/T7-2.json: 4 files, 50 passed. /tmp/sn2-impl/T7-3.json (after the review fix, with fork-subagents-tools.test.ts added): 5 files, 78 passed.

Mutations: /tmp/sn2-impl/mutations/T7.txt: 19 entries, all caught; restored | 0 of 49 failed; clean: yes. Pre-review record: T7-pre-review.txt (18 entries). Case 8's entries mutate `formatCost` in tools/common.ts, which ui/format.ts re-exports.

Coverage: `check-cases.mjs coverage ... T7` passes for the 18 T7 rows.

Review:

- Important: `invocationTags` disclosed `(asked haiku)` when the caller's spelling named the very model the agent file pinned, because `resolveInvocationConfig` keeps any differing string in `overridden.model` (format.ts invocationTags; settings/models.ts). Accepted: at spawn the service resolves the caller's spelling and drops `overridden.model` when it names the winning model; an unresolvable or other spelling stays disclosed; test "keeps a caller's model the agent file outranked only when it names another model" (mutation T7-M19).

Notes and deviations:

- Deviation: the review fix moves part of T8 case 7 forward: at spawn the service drops `overridden.model` when the caller's spelling names the winning model.
- Deviation: the test runs added test/fork-builtins/subagents/layering.test.ts (ui/ imports) and, after the fix, fork-subagents-tools.test.ts (spawn changed).

### T8 Render Agent calls with live progress (F12)

Commit: `7d6ac40c1`

Tests: /tmp/sn2-impl/T8-1.json: 5 files, 69 passed, 1 failed (a spinner test that measured a wrapped line; fixed before commit). /tmp/sn2-impl/T8-2.json and T8-3.json: 5 files, 70 passed. /tmp/sn2-impl/T8-4.json (after the review fixes, with the service and presentation suites added): 7 files, 107 passed.

Mutations: /tmp/sn2-impl/mutations/T8.txt: 24 entries, all caught; restored | 0 of 23 failed; clean: yes. Pre-review record: T8-pre-review.txt (23 entries). A first run had three uncaught entries: M2 (dropped: turn and usage events still drove updates), M14 (the resume test was strengthened) and M17 (replaced by a stronger variant).

Coverage: `check-cases.mjs coverage ... T8` passes for the 16 T8 rows.

Review:

- Important: a queued foreground call kept an obsolete "N ahead" count, because it refreshed only on its own record's events (tools/agent.ts followProgress). Accepted: while the call is queued, every service event reschedules its update, and `queuePosition` joins the change key; test "reports a queued foreground call's place in the queue" extended (mutation T8-M25).
- Important: a child's streaming response did not update the activity text, because the service emitted progress only on tool, turn and usage events (service.ts; tools/agent.ts). Accepted: the service emits `progress` when a child attaches, and the progress follower subscribes to the child's conversation; no deterministic test, because the faux provider streams a reply in one burst.

Notes and deviations:

- Deviation: `withAgentToolRenderers(definition, session)` takes the session as a second argument, read only at render time, so the call row finds the agent's display name and color in the registry; Appendix B's fragment has one argument.
- Deviation: the activity, model and tag helpers moved from ui/format.ts to tools/details.ts, because the tools layer builds the details; ui/format.ts re-exports them.
- Deviation: the service emits a `progress` event on tool start and end, turn end, usage and child attach; the bus adapter does not bridge it.
- Deviation: the running row's stats line also shows the elapsed time (P10).

### T9 Render subagent notifications

Commit: `f65bdcae2`

Tests: /tmp/sn2-impl/T9-1.json: 5 files, 64 passed. /tmp/sn2-impl/T9-2.json: 5 files, 65 passed. /tmp/sn2-impl/T9-3.json and T9-4.json (after the review fix, with fork-subagents-rendering.test.ts and fork-subagents-tools.test.ts added because tools/details.ts changed): 7 files, 115 and 116 passed, 0 failed.

Mutations: /tmp/sn2-impl/mutations/T9.txt: 22 entries, all caught; restored | 0 of 89 failed; clean: yes. Pre-review record: T9-pre-review.txt (21 entries).

Coverage: `check-cases.mjs coverage ... T9` passes for the 7 T9 rows.

Review:

- Important: a notification drew the turn limit from the `defaultMaxTurns` setting at delivery, so a setting changed while the run was active showed a limit the run never enforced (service/notifications.ts details; service.ts run captures the limit at start, and every spawn rereads the settings). Accepted: the record keeps the limit its current run enforces (`maxTurns`, set in `run`), and both the notification and the `Agent` details read it; tests "hands the renderer the run's turns and the turn limit it enforced, though the setting changed since" and "keeps the turn limit the run enforces in its details, though the setting changed since" (mutations T9-M13, T9-M22).

Notes and deviations:

- Deviation: case 6 (the model-facing `<estimated_cost_usd>`) lives in the suite test/suite/fork-subagents-service.test.ts, because it needs a real background run; the module service.test.ts holds the details' turn fields.
- Deviation: the presentation suite adds a case: the factory draws the cost from the bound session's existing service, and a render in print mode builds no service.
- Deviation: the review fix adds `maxTurns` to the record and view (the limit the current run enforces, set when it starts); the `Agent` details (T8's tools/details.ts) read it too, so both displays show the enforced limit.
- Deviation: the module service.test.ts fixture gains `turns: 2`; the rendering suite's afterEach restores mocks.

### T10 The widget

Commit: `e96866025`

Tests: /tmp/sn2-impl/T10-1.json and T10-2.json: 4 files, 54 passed. /tmp/sn2-impl/T10-3.json (after the review fix): 4 files, 55 passed, 0 failed. The runs add test/fork-builtins.test.ts and layering.test.ts, because ui/index.ts changed and ui/ gained an import.

Mutations: /tmp/sn2-impl/mutations/T10.txt: 36 entries, all caught; restored | 0 of 46 failed; clean: yes. Pre-review record: T10-pre-review.txt (35 entries).

Coverage: `check-cases.mjs coverage ... T10` passes for the 28 T10 rows.

Review:

- Important: after a direct `session.dispose()`, which emits no `session_shutdown`, the widget's update returned on the disposed service before stopping its 80 ms timer, so the interval kept requesting renders (ui/widget.ts update). Accepted: on a disposed service the widget releases its timer and listener without touching the invalidated UI context; test "stops its timer and listener, touching no UI, once the session is disposed directly" (mutation T10-M36).

Notes and deviations:

- Deviation: a steered, stopped or aborted agent lingers two parent turns like an error, as pi-subagents' ERROR_STATUSES did; only a completed agent lingers one.
- Deviation: the widget resets an agent's linger at every `ended` event, so a resumed agent's completion line returns without pi-subagents' separate markRunning.
- Deviation: case 11's suite test also checks that quit removes the widget and that rpc mode sets none; the module test file mocks `node:fs` as a recording passthrough for case 9.

### T11 The conversation viewer

Commit: `2cd7a89c5`

Tests: /tmp/sn2-impl/T11-1.json and T11-2.json: 4 files, 113 passed. /tmp/sn2-impl/T11-3.json (after the review fix): 4 files, 114 passed, 0 failed. The runs add ui-format.test.ts and fork-subagents-rendering.test.ts (describeModel changed) and layering.test.ts.

Mutations: /tmp/sn2-impl/mutations/T11.txt: 59 entries, all caught; restored | 0 of 73 failed; clean: yes. Pre-review record: T11-pre-review.txt (58 entries). Before the pre-review record, a first run left rows 123 and 143 uncovered; both tests were fixed (a finished agent for the later-viewer test, raw mode for the assistant clamp test) and the spec reran.

Coverage: `check-cases.mjs coverage ... T11` passes for the 67 T11 rows.

Review:

- Important: a stop armed with one press stayed armed after the viewed run ended, so after a resume a single press stopped the new run (ui/viewer.ts handleInput; service.ts resume reactivates the same record). Accepted: the viewer disarms stop whenever an event leaves its agent inactive; test "forgets a pending stop when the run ends, so a resumed run needs both presses" (mutation T11-M59).

Notes and deviations:

- Deviation: `describeModel` (tools/details.ts) returns no canonical id for a model with no provider, so the viewer's invocation line falls back to the short label (old case 98); the viewer shows `provider/id` otherwise.
- Deviation: nothing opens the viewer in T11; `openConversationViewer` and the session-scoped `ViewerSessionState` wait for T12 and T13.
- Deviation: the footer names the keys the manager binds (`Enter steer`, `x stop`, `m md`, `↑↓ scroll · PgUp/PgDn · Esc close`), so a rebinding shows in the hints; a refused steer also shows its reason.

### T12 FleetView

Commit: `fece61620`

Tests: /tmp/sn2-impl/T12-1.json and T12-2.json: 5 files, 129 passed. /tmp/sn2-impl/T12-3.json (after the review fixes): 5 files, 131 passed, 0 failed. The runs add ui-viewer.test.ts (viewer.ts changed), layering.test.ts and test/fork-builtins.test.ts.

Mutations: /tmp/sn2-impl/mutations/T12.txt: 41 entries, all caught; restored | 0 of 49 failed; clean: yes. Pre-review record: T12-pre-review.txt (39 entries). A first run left T12-M13 uncaught, because `update()` clamps the selection again; the redundant clamp in the key handler was removed and the entry retargeted before the pre-review record.

Coverage: `check-cases.mjs coverage ... T12` passes for the 36 T12 rows.

Review:

- Important: with the viewer open, terminal input reached FleetView before the focused overlay, so the viewer's Escape deactivated the list and reset its selection; after the viewer closed, the marker sat on the viewed agent but the next key activated at `main` (ui/fleet.ts handleKey). Accepted: the list ignores every key while its viewer is open, as pi-subagents did, and navigation resumes at the viewed agent; test "leaves the viewer its keys, and resumes navigation at the viewed agent once it closes" (mutation T12-M40).
- Important: a directly disposed session released FleetView without closing an open viewer, and the later `dispose()` returned early, so the overlay stayed over a disposed session (ui/fleet.ts update). Accepted: the disposed-service path closes the viewer after releasing; test "closes an open viewer when the session is disposed directly" (mutation T12-M41).

Notes and deviations:

- Deviation: the focus check reads `getFocusedComponent()` structurally, because the exported `TUI` interface omits it while pi-tui's implementation makes it public.
- Deviation: `openConversationViewer` gains a close handle, so quit and a direct session disposal close an open viewer; `keyLabel` is shared by the viewer and FleetView, whose hints name the bound keys.
- Deviation: the per-session `ViewerSessionState` lives in a WeakMap in ui/index.ts, so the Markdown mode survives `/reload` (P16 "for the rest of the session").

### T13 `/agents` lists and agent-file actions

Commit: `77c2dff4f`

Tests: /tmp/sn2-impl/T13-1.json: 6 files, 94 passed. /tmp/sn2-impl/T13-2.json and T13-3.json (after the review fixes): 6 files, 98 passed, 0 failed. The runs add atomic-write.test.ts (atomic-write.ts changed), layering.test.ts and the presentation suite (ui/index.ts changed).

Mutations: /tmp/sn2-impl/mutations/T13.txt: 56 entries, all caught; restored | 0 of 71 failed; clean: yes. Pre-review record: T13-pre-review.txt (52 entries). A first post-review run stopped at T13-M14 (its old string gained a second match) before mutating it, left no marker and no residue, and the spec was fixed and rerun.

Coverage: `check-cases.mjs coverage ... T13` passes for the 39 T13 rows.

Review:

- Critical: for a default agent with no source file, the `<name>.md` probe accepted a file that declares another `name:`, so Explore's Reset to default or Delete could unlink the file of the agent that file defines; the disable stub could likewise overwrite it (definitions/files.ts findAgentFile; ui/agents-menu.ts disable). Accepted: the probe takes a file only when the loader's parser gives it that name, and the disable stub asks before overwriting an existing file; tests "skips a probed file that declares another agent's name" and "acts on a default agent's own file only: another agent's file at its path is neither reset nor overwritten" (mutations T13-M53, T13-M56).
- Important: disabling a file that sets `enabled: true` inserted a second `enabled` key, which makes the YAML unparseable and drops the agent (definitions/files.ts disableInContent). Accepted: an existing unquoted `enabled:` line is replaced, and an edit that would not read as disabled is refused as `cannot-rewrite`, which the menu reports; tests "replaces an enabled: true line instead of adding a second key" and "refuses an enabled key it cannot rewrite, rather than write a file the loader cannot parse" (mutations T13-M54, T13-M55).
- Important: `refuseSymlinks` does not check the location root itself, so a symlinked project directory or agent directory is followed (atomic-write.ts). Rejected: the root is the project directory or the agent directory the session was given, so a link there cannot lead outside the boundary P27 protects; plan T4 case 3 keeps a symlinked scope root working for the same check (docs/plans/subagents-native-phase2.plan.md, T4), and a symlinked `~/.pi/agent` is a common setup. Flagged for Paolo in the final report.

Notes and deviations:

- Deviation: the top menu offers `Running agents (N)` and `Agent types (N)` only; T14 adds `Create new agent` and T15 `Settings`.
- Deviation: `refuseSymlinks` checks every component below the root, the root itself excepted, as T4 case 3 does for memory (review finding rejected; open item for Paolo).
- Deviation: `findAgentFile` takes a probed `<name>.md` only when it loads as that name, and the disable stub asks before overwriting an existing file (review fix).
- Deviation: `disableInContent` replaces an existing `enabled:` line and refuses an edit that would not read as disabled (`cannot-rewrite`), beyond pi-subagents' insert-only edit (review fix).
- Deviation: the service gains an `agentDir` getter, which the menu needs for the personal location; `serializeAgentDefinition` writes values as JSON, which YAML reads back unchanged.

### T14 The create wizard (R16)

Commit: `008d6de5c`

Tests: /tmp/sn2-impl/T14-1.json: 6 files, 114 passed. /tmp/sn2-impl/T14-2.json (after the review fixes): 6 files, 116 passed. /tmp/sn2-impl/T14-3.json (every subagents module and suite file, skills-fork.test.ts and test/fork-builtins.test.ts, because the parser change reaches the loader): 30 files, 545 passed, 0 failed.

Mutations: /tmp/sn2-impl/mutations/T14.txt: 16 entries, all caught; restored | 0 of 29 failed; clean: yes. Pre-review record: T14-pre-review.txt (14 entries).

Review:

- Important: a list key written with no value (`tools:`, which YAML reads as null) passed as absent with no invalid value, so a generated reply with `tools: null` was written and its agent got every built-in tool (definitions/frontmatter.ts listValue). Accepted: null counts as neither a string nor a list, is reported as an invalid value and ignored as absent, so the wizard refuses it and the loader warns; tests "reports a list key written with no value, and ignores it as absent" and the wizard's list-field test with `tools:` (mutation T14-M15).
- Important: the overwrite check ran before the awaited completion, so a file another session created while the model answered was replaced without a confirm (ui/create-wizard.ts generate). Accepted: after the completion, a file that did not exist before needs the overwrite confirm; test "asks again before overwriting a file another session created while the model answered" (mutation T14-M16).
- Minor: `nameProblem` was a single-line helper with one call site, which AGENTS.md says to inline (ui/create-wizard.ts). Accepted: the check is inlined into `askName`.

Notes and deviations:

- Deviation: the menu asks for the location and writes; `ui/create-wizard.ts` asks for the method and the answers and returns the file, so the wizard imports nothing from the menu.
- Deviation: the generate path strips one code fence the model wrapped the file in, and refuses a reply whose stop reason is an error or an abort.
- Deviation: a list key written with no value (null) is now an invalid value, reported and ignored as absent (review fix); the loader behaves as before except for the warning.
- Deviation: test/suite/fork-subagents-agents-menu.test.ts "lists a project agent before any spawn, and one added on disk when it opens again" now expects the top menu's `Create new agent` entry (T13's plan names it in the top menu); the test keeps its name.

### T15 The settings menu

Tests: /tmp/sn2-impl/T15-1.json: 8 files, 64 passed, 1 failed (the settings_changed expectation assumed a flat payload; fixed before commit). /tmp/sn2-impl/T15-2.json and T15-3.json: 8 files, 65 passed, 0 failed. The runs add the agents-menu and create-wizard suites (agents-menu.ts changed), the presentation suite and test/fork-builtins.test.ts (ui/index.ts changed), layering.test.ts (ui/ gained a module) and settings.test.ts (settings.ts changed).

Mutations: /tmp/sn2-impl/mutations/T15.txt: 20 entries, all caught; restored | 0 of 24 failed; clean: yes.

Commit: `e4d8d3213`

Review:

- none

Notes and deviations:

- Deviation: test/suite/fork-subagents-agents-menu.test.ts "lists a project agent before any spawn, and one added on disk when it opens again" now expects the top menu's `Settings` entry; the test keeps its name.
- Deviation: each change closes the list, saves and reopens it at the same row (`SettingsList.selectItem`), because the save awaits `SettingsManager.reload()`.
- Deviation: `settingsListTheme` moved from ui/agents-menu.ts to ui/settings-menu.ts, so the menu imports the settings module and no import cycle forms; settings.ts gains `projectSubagentValues`.
- Deviation: saving `viewerMarkdown` clears the Markdown mode the viewer's key chose for the session, so the saved mode shows (P16 keeps the key's change for the session otherwise).
- Deviation: toasts follow pi-subagents' wording, except `Strict agent files enabled` drops "Takes effect on next pi session." (the save reloads the definitions at once), the agentMentions toasts use a colon instead of an em dash, and a failed write warns `Subagent settings not saved: <error>` instead of pi-subagents' "(session only; failed to persist)", because nothing changes in memory.
- Deviation: the README's settings paragraph names the settings menu as the writer's caller.

### T16 Documentation and the full inventory check

Tests: /tmp/sn2-impl/T16-1.json: the 11 files the inventory's covering tests name, 316 passed, 0 failed.

Inventory: `check-cases.mjs inventory` reports rows: 235, offending: 0. `check-cases.mjs coverage $E2/old-cases.md $R/T16-1.json $R/mutations` exits 0 (213 rows checked), and exits 1 on a copy with the identity of row 1 misspelled.

Commit: `7d4f0cdf7`

Review:

- Important: a README sentence on the generate path ran to 31 words, over the 25-word limit of the prose register (README.md, `## /agents` wizard table; ~/.pi/agent/AGENTS.md "Voice"). Accepted: the sentence is split into three; documentation only, so no test or mutation applies.

Notes and deviations:

- Deviation: the stale header comment of src/core/fork-builtins.ts ("The fork-owned built-in is tokensave") now names both inline factories.
- Deviation: the README also gains a `ui/` layout row, a layering paragraph (F14), and a sentence in `## Wiring` that the factory builds the service at `session_start` in `tui` and `rpc` mode; the settings rows lose their "Phase 2:" prefixes.
- Deviation: the README's known limitations also name a loader that drops `<inline:subagents>` (plan Section 8, first risk).
- Deviation: the README records Paolo's 2026-09-28 decision that `refuseSymlinks` does not check the location root.

### T19 Validate the built outputs (R14)

Build: npm run build:offline exit 0 (/tmp/sn2-impl/T19-build.log). dist/index.js exports createAgentSession, SettingsManager, SessionManager and ModelRuntime; @earendil-works/pi-ai exports getCurrentSystemPrompt.
on: exit 0: {"switch":"unset","mode":"on","sources":{"Agent":"<builtin:Agent>","get_subagent_result":"<builtin:get_subagent_result>","steer_subagent":"<builtin:steer_subagent>"},"presentation":{"loaded":true,"command":true,"renderer":true},"widget":true,"quitAwaited":true,"errors":[],"pass":true}
off with PI_FORK_BUILTINS=off: exit 0: {"switch":"off","mode":"off","sources":{"Agent":"none","get_subagent_result":"none","steer_subagent":"none"},"presentation":{"loaded":false,"command":false,"renderer":false},"widget":false,"quitAwaited":false,"errors":[],"pass":true}
off without the switch: exit 1: {"switch":"unset","mode":"off","sources":{"Agent":"<builtin:Agent>","get_subagent_result":"<builtin:get_subagent_result>","steer_subagent":"<builtin:steer_subagent>"},"presentation":{"loaded":true,"command":true,"renderer":true},"widget":false,"quitAwaited":false,"errors":[],"pass":false}
Afterwards: live-settings.sha256 OK, ls -A /tmp/sn2-impl/home prints nothing, git status --short prints nothing.

## Phase runs

T17 ran the full coding-agent suite and `./test.sh` once, before the phase review (D36).

- Full coding-agent run: /tmp/sn2-impl/phase.json: 443 files, 5,128 tests, 5,077 passed, 1 failed, 50 pending. `failing-tests.mjs diff base-1.json phase.json` lists one new failure, the known flake `test/exec.test.ts` "execCommand captures finite inherited descendant output after the shell exits" (D36).
- ./test.sh: /tmp/sn2-impl/phase-testsh.log, exit 1. The failure ids equal the baseline's (only the same exec flake), and the package lists are identical.
- `check-identities.mjs base-1.json phase.json /tmp/sn2-impl`: baseline 4,784, phase 5,122, task reports 16, fix reports 0, offending 0; exit 0.
- No T17-R task: no failure beyond the known flake.

## Phase review

`/tmp/sn2-impl/phase-review.md`, verbatim:

Verdict: With fixes

Scope: super-code-review over 941bec9ab9acfa5564586318ae988bc6b1e1486b..7d4f0cdf7 (77 files outside docs/plans), fan-out mode, 12 lenses: requirements, correctness, guidelines, security, error handling, type design, test coverage, architecture, evolvability, performance, comments, docs impact. Spec: docs/plans/subagents-native-phase2.plan.md and the session-control handoff, rulings D16 to D40. Each finding below was checked against the source.

### F1: A foreground Agent call waits without its abort signal, so a hung child extension factory blocks Esc and quit
Lenses: requirements, correctness, test coverage, architecture. Evidence: tools/agent.ts:228-240 `waitInForeground` calls `service.waitForResult(id)` without the call's signal, for spawn (:359) and resume (:299); agent-session.ts awaits `abort()` before `session_shutdown`, so the bounded `service.shutdown()` is never reached. Fix: pass the call's signal to the wait in both paths and return the `stopped` result when it aborts; test a child whose extension factory never resolves (aborting returns the call, and `session.shutdown()` resolves within the bound), plus a mutation. Paolo decided this fix on 2026-09-28 ("ok 1").
Disposition: Accepted
Approved: 2026-09-28, Paolo selected "F1 foreground Agent wait honors the abort signal"
Applied: 5a867f26a

### F2: The conversation accessor omits the streaming message, so no surface shows a child's text while it streams
Lens: correctness. Evidence: service/service.ts:787-800 returns `session.messages`, which is `agent.state.messages`; agent-core appends an assistant message only at `message_end` and holds it in `state.streamingMessage` meanwhile (packages/agent/src/agent.ts:689-699). The widget, the `Agent` row's activity and the viewer read this accessor; pi-subagents accumulated `text_delta` into its activity text (src/index.ts:131, src/agent-runner.ts:546). The T8 review fix subscribed to the child's stream but reads the same messages. Fix: include the child's streaming message while one is in flight, without a duplicate after `message_end`; test with a response held between text chunks, plus a mutation.
Disposition: Accepted
Approved: 2026-09-28, Paolo selected "F2 conversation includes the streaming message"
Applied: 2924855bc

### F3: steer_subagent and the nested steer await delivery without their abort signal, so a hung child input handler blocks Esc and quit
Lens: correctness. Evidence: T2 (F11) made tools/steer.ts:35-45 and tools/nested.ts:160-165 await `service.steer`, which awaits `child.session.steer`, which awaits the child's extension `input` handlers (agent-session.ts:4159); neither tool takes its signal. Fix: race the delivery with the call's signal; on abort, answer that the steer was cancelled before its delivery was confirmed, and keep observing the delivery so a late rejection is not unhandled; test with a child input handler that never resolves, plus a mutation.
Disposition: Accepted
Approved: 2026-09-28, Paolo selected "F3 steer tools honor their abort signal"
Applied: a2c022b7e

### F4: The viewer and the Agent renderers print child output with its terminal escape sequences
Lens: security (CWE-150). Evidence: ui/viewer.ts:535-551 wraps tool-result and bash text raw through `wrapTextWithAnsi`; ui/tool-renderers.ts:107-108 and :162-164 and ui/notification.ts:37-42 print result text likewise. Pi's own tool rows strip escapes and binary (core/tools/render-utils.ts:48, `stripAnsi` and `sanitizeBinaryOutput`). A file holding an OSC 52 sequence, read by a child, reaches the terminal when its viewer opens. pi-subagents had the same gap. Fix: pass child-provided text through `stripAnsi` and `sanitizeBinaryOutput` before wrapping or Markdown, keeping the presentation's own styling; test an OSC 52 and a cursor-movement payload in each viewer mode and in the result row, plus a mutation.
Disposition: Accepted
Approved: 2026-09-28, Paolo selected "F4 sanitize child output in viewer and renderers"
Applied: 25ad9ebec

### F5: The steer composer stays open after the viewed agent stops
Lens: requirements. Evidence: plan T11 case 11 says the composer "is absent once the agent stops"; ui/viewer.ts:210-216 clears only `stopArmed` when an event leaves the agent inactive, so the composer keeps its input and `Enter send` hint, and a submit is refused. The T11 test opens the viewer on an agent already finished. Fix: close the composer when the viewed run becomes inactive; test running, composing, then completed, plus a mutation.
Disposition: Accepted
Approved: 2026-09-28, Paolo selected "F5 close the steer composer when the agent stops"
Applied: b6a4466bc

### F6: Enable reports "not disabled" for a file the loader reads as disabled
Lens: requirements. Evidence: plan T13 case 4 says a file the loader reads as disabled can be enabled; definitions/files.ts:119 and :167-175 remove only a bare `enabled: false` line, so `enabled: false # note` or `enabled: False` stays disabled and ui/agents-menu.ts `enable` answers "is not disabled". pi-subagents has the same regex. Fix: remove the block's `enabled:` line when the parsed value is false, and report `cannot-rewrite` (as disable does) when the edit still reads as disabled; test both spellings, plus a mutation.
Disposition: Accepted
Approved: 2026-09-28, Paolo selected "F6 enable handles every disabled spelling"
Applied: db058147b

### F7: A service.ts header sentence runs to 36 words
Lens: guidelines. Evidence: service/service.ts:5-10, "Its parts live beside it: ...", against ~/.pi/agent/AGENTS.md "at most 25 words" for comments. Fix: split the part inventory into sentences.
Disposition: Accepted
Approved: 2026-09-28, Paolo selected "F7 split the 36-word service.ts sentence"
Applied: bb7b60f45

### F8: The refuseSymlinks comment overstates the boundary it keeps
Lens: comments. Evidence: atomic-write.ts:10-13 says a change "never reaches a file outside the project or the agent directory", then that `root` itself may be a link; Paolo kept the root unchecked on 2026-09-28. Fix: state that the check keeps a change inside the directory tree the root names, and that the root itself is trusted.
Disposition: Accepted
Approved: 2026-09-28, Paolo selected "F8 reword the refuseSymlinks comment"
Applied: 624936eaf

### F9: The module README's title still reads "service and base tools"
Lens: docs impact. Evidence: fork-builtins/subagents/README.md:1, while T16 added the presentation sections. Fix: "subagents (fork-owned service, base tools and presentation)".
Disposition: Accepted
Approved: 2026-09-28, Paolo selected "F9 README title names the presentation"
Applied: 2b53c0081

### F10: docs/skills.md still names the pi-subagents extension for context: fork and skill-bundled agents
Lens: docs impact. Evidence: docs/skills.md:165-167, :180-181 and :203-205.
Disposition: Deferred: phase review finding F16 of phase 1; plan Section 2.2 and Section 10 place the skill docs with the phase 3 cutover, while the live setup still loads pi-subagents.

### F11: The viewer rebuilds and wraps the whole conversation on every render
Lens: performance. Evidence: ui/viewer.ts:308 and :497-564 build every message's lines per frame; Markdown parses are cached per message, raw text is wrapped again. Fix: cache lines per message, width and mode.
Disposition: Deferred: an optimization beyond the plan's perf cases; plan Section 8 accepts rendering cost with the T10 and T11 perf cases, which pass, and no slowdown was measured.

### F12: The widget builds rows for every running agent before its 12-line limit
Lens: performance. Evidence: ui/widget.ts:257 maps every running agent through `runningLines` each 80 ms frame.
Disposition: Rejected: the rows are bounded by the pools; background agents run at most `maxConcurrent` (default 10) and a foreground agent is one pending parent tool call, and a row reads no file (T10 perf cases).

### F13: SubagentService holds 1,061 lines of coordination
Lens: evolvability. Evidence: service/service.ts:194-1060.
Disposition: Deferred: a refactor with no defect; T1 made the split plan T1 specifies (queue, retention, joins, sessions), and a further split belongs with phase 3 or 4 changes that need it.

### F14: The settings contract repeats in settings.ts and settings-menu.ts
Lens: evolvability. Evidence: settings/settings.ts:59-113 (defaults, checks, keys) and ui/settings-menu.ts:57-215 (rows, enum values), :297-359 (toasts).
Disposition: Deferred: no defect today; test/fork-builtins/subagents/ui-settings-menu.test.ts pins the 22 keys, and `settingToast` fails `tsgo` (TS2366) on a missing key; a shared schema is a refactor for a later phase.

Dropped by the synthesis (pre-existing outside the diff, or below the severity floor):
- definitions/load.ts:90-98 treats every directory read error as absent: load.ts is unchanged since BASE.
- service/service.ts:277-284 swallows listener errors: phase 1 design (plan Section 3), unchanged in intent.
- runner/memory.ts:50-57 treats an unreadable MEMORY.md as absent: phase 1 behavior; T4's review kept an unreadable component as missing.
- runner/prompt.ts:118-123 reduces a skill read error to "missing": prompt.ts is unchanged since BASE.
- ui/viewer.ts as a 598-line module: Low severity.

- Phase review: /tmp/sn2-impl/phase-review.md. super-code-review, fan-out mode, 12 lenses (simplification skipped as opt-in). Verdict: With fixes. 14 findings: F1 to F9 Accepted and approved by Paolo on 2026-09-28; F10, F11, F13, F14 Deferred; F12 Rejected. Five lens items dropped by the synthesis are listed at the end of the file.

### T18-F1 A foreground Agent call waits without its abort signal, so a hung child extension factory blocks Esc and quit

Tests: /tmp/sn2-impl/T18-F1-1.json: 35 files (every subagents module and suite file, test/fork-builtins.test.ts, base-tools tests, the skills-fork suites), 591 passed, 0 failed.

Mutations: /tmp/sn2-impl/mutations/T18-F1.txt: 2 entries, all caught; restored | 0 of 15 failed; clean: yes.

Commit: `5a867f26a`

Review:

- none

Notes and deviations:

- Deviation: the nested `Agent` tool (tools/nested.ts:107, :129) still waits without its signal; its hang stays inside the child session, whose teardown is bounded, so it is outside the approved fix (open item for Paolo).

### T18-F2 The conversation accessor omits the streaming message, so no surface shows a child's text while it streams

Tests: /tmp/sn2-impl/T18-F2-1.json and T18-F2-2.json (after the review fix): 35 files, 592 passed, 0 failed.

Mutations: /tmp/sn2-impl/mutations/T18-F2.txt: 2 entries, all caught; restored | 0 of 31 failed; clean: yes. Pre-review record: T18-F2-pre-review.txt (1 entry).

Commit: `2924855bc`

Review:

- Important: the in-flight message reached readers as a new object on every update, because agent-core emits a copy per `message_update` (packages/agent/src/agent-loop.ts:519-523), so the viewer's Markdown cache by identity (ui/viewer.ts:465-479) built a new component per chunk and T11 case 10's reuse and single fallback did not hold for real streams. Accepted: the service keeps one object per streamed message and child session, updated in place, and hands it out until the message ends; test "includes the message a child is streaming, so its text grows before the message ends" now expects one in-flight object (mutation T18-F2-M2).

### T18-F3 steer_subagent and the nested steer await delivery without their abort signal, so a hung child input handler blocks Esc and quit

Tests: /tmp/sn2-impl/T18-F3-1.json: 35 files, 594 passed, 0 failed.

Mutations: /tmp/sn2-impl/mutations/T18-F3.txt: 3 entries, all caught; restored | 0 of 38 failed; clean: yes.

Commit: `a2c022b7e`

Review:

- none

Notes and deviations:

- Deviation: the service's `steer` is unchanged; the tools race its delivery with their signal through `unlessAborted` (tools/common.ts), so the viewer, which awaits no steer, keeps its path.

### T18-F4 The viewer and the Agent renderers print child output with its terminal escape sequences

Tests: /tmp/sn2-impl/T18-F4-1.json and T18-F4-2.json: 35 files, 598 passed, 0 failed. /tmp/sn2-impl/T18-F4-3.json (after the review fix): 35 files, 600 passed, 0 failed.

Mutations: /tmp/sn2-impl/mutations/T18-F4.txt: 14 entries, all caught; restored | 0 of 160 failed; clean: yes. Pre-review record: T18-F4-pre-review.txt (9 entries). A first run left T18-F4-M2 uncaught (the activity test used only sequences `stripAnsi` removes); the test gained a lone control character, and the spec reran before the pre-review record.

Commit: `25ad9ebec`

Review:

- Important: child-controlled text still reached the terminal unsanitized through an unknown tool name in the activity line (tools/details.ts describeActivity), a child's provider error in the Agent result row (ui/tool-renderers.ts error and aborted rows) and in the widget (ui/widget.ts finished error line). Accepted: each sink passes the text through `displayText`, and the viewer's failed-steer message does too; tests "describes the activity without the child's escape sequences" (extended), "prints a result's text without its escape sequences" (extended), "prints a finished agent's error without its escape sequences" and "shows a failed steer's error without its escape sequences" (mutations T18-F4-M10 to T18-F4-M14).

Notes and deviations:

- Deviation: `displayText` lives in tools/details.ts, beside the activity text it cleans, and ui/format.ts re-exports it; the details and every model-facing text keep the raw values.

### T18-F5 The steer composer stays open after the viewed agent stops

Tests: /tmp/sn2-impl/T18-F5-1.json: 6 files (ui-viewer, ui-fleet, layering, the agents-menu and presentation suites, test/fork-builtins.test.ts: the tasks that open the viewer), 149 passed, 0 failed.

Mutations: /tmp/sn2-impl/mutations/T18-F5.txt: 1 entry, caught; restored | 0 of 76 failed; clean: yes.

Commit: `b6a4466bc`

Review:

- none

### T18-F6 Enable reports "not disabled" for a file the loader reads as disabled

Tests: /tmp/sn2-impl/T18-F6-1.json: 9 files, 139 passed. /tmp/sn2-impl/T18-F6-2.json (with ui-settings-menu.test.ts, T15's module test, since agents-menu.ts changed): 10 files, 142 passed, 0 failed.

Mutations: /tmp/sn2-impl/mutations/T18-F6.txt: 3 entries, all caught; restored | 0 of 75 failed; clean: yes.

Commit: `db058147b`

Review:

- none

Notes and deviations:

- Deviation: `enableInContent` keeps its `{ content, changed }` shape and adds `cannotRewrite: true` only for a disabled key it cannot remove, so existing expectations stay unchanged (P29); the two new shapes join the existing parametrized list as new tests.

### T18-F7 A service.ts header sentence runs to 36 words

Tests: /tmp/sn2-impl/T18-F7-1.json: 2 files (the module and suite service tests), 38 passed, 0 failed.

Mutations: none; the change is a comment and adds no behavior.

Commit: `bb7b60f45`

Review:

- none

Notes and deviations:

- Deviation: the commit subject starts `docs(coding-agent):` instead of plan T18's `fix(coding-agent): <finding>`; the commit is not amended (AGENTS.md forbids --amend).

### T18-F8 The refuseSymlinks comment overstates the boundary it keeps

Tests: /tmp/sn2-impl/T18-F8-1.json: 2 files (atomic-write and agent-files module tests), 64 passed, 0 failed.

Mutations: none; the change is a comment and adds no behavior.

Commit: `624936eaf`

Review:

- none

### T18-F9 The module README's title still reads "service and base tools"

Tests: none; the change is the README title (documentation only, as T16).

Mutations: none; no behavior changes.

Commit: `2b53c0081`

Review:

- none

## Decisions by Paolo

- 2026-09-28: the hang of a foreground `Agent` call whose child's extension factory never resolves (Esc and quit both block, because tools/agent.ts waits without the call's signal) is fixed as a T18 finding: with Paolo's approval it becomes task `T18-F<n>`. Fix: in the foreground spawn and resume paths, stop waiting when the call's signal aborts and return the `stopped` result; add a test (a child whose extension factory hangs: Esc returns the call, and `session.shutdown()` resolves within the bound) and a mutation. If super-code-review does not raise it, add it to $R/phase-review.md as a finding. Paolo's words: "ok 1".
- 2026-09-28: open item 3 (T13 review, `refuseSymlinks` does not check the location root itself) stays as implemented: the root is not checked, so a symlinked project or agent directory keeps working. Paolo chose "Keep as is: root is not checked (Recommended)".

## Deviations

Each task section above lists its own deviations. Across the phase:

- The regression runs follow D36: each task ran `npm run check`, the test files its diff touched and one mutation per new behavior; the full suites ran once, in T17.
- T6's open item, a foreground `Agent` call whose child's extension factory hangs, is fixed by T18-F1, as Paolo decided on 2026-09-28.
- T18-F7's commit subject starts `docs(coding-agent):` instead of plan T18's `fix(coding-agent): <finding>`; it was not amended.
- T18-F7, T18-F8 and T18-F9 change comments or documentation only, so they carry no mutation record.

## Open items

- T4's memory refusal keeps phase 1's error text for a symlinked memory directory itself, because an existing test expects it (T4 notes).
- The nested `Agent` tool's foreground wait (`tools/nested.ts`) still takes no signal; its hang stays inside a child session whose teardown is bounded (T18-F1 notes).
- Phase review findings F10 (skill docs, phase 3), F11 (viewer render caching), F13 (splitting the service) and F14 (a shared settings schema) are deferred; F12 is rejected.


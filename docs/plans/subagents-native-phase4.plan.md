# Native subagents, phase 4: pi-tasks on the typed service

This plan rebuilds pi-tasks as fork-owned code: a headless task service per session, seven task base tools, and one `<inline:tasks>` presentation factory. `TaskExecute`, `TaskOutput` and `TaskStop` run tasks through the subagent service's typed API instead of the bus. The cutover then fast-forwards `personal`, removes the pi-tasks settings entry and rebuilds the main checkout. Paolo runs each cutover command in his own terminal. The sources are the session-control handoff (D16 to D53) and the phase 3 plan and results. A probe proved the code, the smoke and the cutover commands.

## 1. Authority and workflow

| Source | Role |
| --- | --- |
| This plan | The implementation contract. It overrides the source where Section 2 or Section 4 names a difference. |
| `/Users/paolof/Developer/ai/_handoffs/2026-09-26-pi-session-control-consolidated.md` | The source and sole authority for rulings. Section 7 holds D16 to D53; D46 to D53 rule this phase. Section 14 holds the port's facts. Record any new ruling there as a dated row from D54, only after Paolo's yes. |
| `docs/plans/subagents-native-phase3.plan.md` | The template: its rulings, defaults, review gate, cutover steps and rollback. Its Section 10 names this phase. |
| `docs/plans/subagents-native-phase3.results.md` | Its deviations, open items and `## Cutover` notes: the `Files` fact, the unwritable main checkout, the process list that matched nothing. |
| `docs/plans/subagents-native-phase1.plan.md`, `-phase2.plan.md` and their results | The subagent service this phase calls, its child lineage and its bus adapter. |
| `packages/coding-agent/src/core/fork-builtins/subagents/README.md` | The subagent service's typed API, lineage and presentation binding. |
| `/Users/paolof/Developer/ai/pi-tasks` at `83480bd` | The behavior reference: `src/index.ts`, `src/task-store.ts`, `src/auto-clear.ts`, `src/reminder-cadence.ts`, `src/ui/`. Read it to learn a behavior; never copy a file wholesale (D46). |
| `docs/plans/subagents-native-phase4-evidence/` | The four per-task probe patches and their mutation spec, the phase 4 copy of `failing-tests.mjs`, the old-case inventory with its extractor, the identity check, and the smoke with its faux provider (Appendix A, Appendix B). |
| `docs/plans/subagents-native-phase2-evidence/`, `-phase3-evidence/` | The mutation runner `mutate.mjs`, the case checker `check-cases.mjs`, the SDK probe `sdk-probe.mjs` and the settings helper `settings-entry.mjs`, reused unchanged. |
| `docs/adr/ADR-0003-fork-first-merge-hygiene.md` | New code in new files; hot upstream files get thin call sites only. |
| `docs/adr/ADR-0009-built-in-extensions.md` | Built-in kinds, the base-tool activation rule and the upstream footprint. T5 amends it for D47 and D48. |
| `AGENTS.md` (repository) and `~/.pi/agent/AGENTS.md` | Git, lockfile, check and test rules; the durable-prose register; cmux instead of tmux. |

The `planning-changes` skill wrote this plan and ran its review passes (Review history). A fresh session implements it from a handoff prompt, on `feat/subagents-native` in `/tmp/subagents-native`, running `pi --unfenced`.

## 2. Decisions

### 2.1 User rulings

Paolo made every ruling below; the handoff's section 7 records each D-row.

| # | Ruling | Consequence |
| --- | --- | --- |
| R1 (D46) | pi-tasks becomes fork-owned code under `fork-builtins/tasks/`, with no upstream sync. The cutover removes the `../../Developer/ai/pi-tasks` entry. | T1 to T4 rebuild the kept features; T12 removes the entry. No code is copied from pi-tasks. |
| R2 (D47) | Wiring W2: a headless `TaskService` per `AgentSession`, seven fork base tools bound to it, and one `<inline:tasks>` factory for the widget, `/tasks` and the reminder hook. | P1, P3 and P4. `agent-session.ts` stays unchanged. |
| R3 (D48) | Task settings live under `forkBuiltins.tasks` in the global and project `settings.json`; the project value applies only when trusted. | T1 adds the reader and writer; T4's settings list writes the project file; T5 amends ADR-0009. |
| R4 (D49) | Kept: the seven tools, `/tasks` with its settings list, the widget, reminders, auto-clear, the `session` and `memory` scopes, the fork handoff and the five sort presets. Dropped: shell branches and `shell_id`, the protocol handshake, the other scopes and `PI_TASKS`, the file lock, custom sort specs and glyphs, auto-cascade and `PI_TASKS_DEBUG`. | Section 2.3; every old case of a dropped feature is `Dropped` in `$E4/old-cases.md`. |
| R5 (D50) | `taskScope: memory` stays. A failed write or an unreadable file moves the list to memory with one warning, and the file is never overwritten. | T1 cases 9 to 11; P12 fixes the `/reload` retry. |
| R6 (D51) | D43's worker exclusion also covers `TaskExecute`, `TaskOutput` and `TaskStop`. | No task touches the workflow worktree; T9 records the exclusion as the workflow work's open action. |
| R7 (D19) | In-process consumers call the subagent service's typed API. The `subagents:*` names and payloads stay unchanged. | T3 spawns, waits, consumes and stops through `SubagentService`. No bus event is added or changed. |
| R8 (D22) | A fork base tool is active in a child only when the agent's `tools:` names it. | The task tools follow the rule with no new code (T3 case 7). |
| R9 (D23, D25, D26) | One fast-forward after this phase carries phases 3 and 4 with the phase 3 record and the two `.pi/agents` fixes. `agent-session.ts` keeps its two added lines. | T11. No task edits `agent-session.ts`, `interactive-mode.ts` or `core/keybindings.ts`. |
| R10 (D24) | Tests are new; old tests are a behavior checklist. | Each of the 456 old cases has a status in `$E4/old-cases.md` (P13). |
| R11 (D27; planning request) | One `code-reviewer` agent reviews each commit, and receives a saved copy of the staged diff too. The `super-code-review` skill reviews the phase; Paolo approves which findings apply. | The review gate in Section 6; T7. |
| R12 (D36) | Runs stay minimal: each code task runs `npm run check`, its test files and one mutation per case. The phase runs the full coding-agent suite and `./test.sh` once. Three known flakes are ignored everywhere. | Section 5's regression rule; T6. |
| R13 (D45's pattern) | A scripted smoke with an isolated home and a faux provider gates the first cutover step. After the last step, Paolo runs a checklist in a real session; a failure starts the gated rollback. | T8 runs `$E4/run-smoke.sh`; T14 is Paolo's checklist. |
| R14 (planning request, 2026-09-29) | Paolo runs every cutover and rollback command in his own terminal. The session asks, records and verifies with read-only commands. The main checkout, `personal` and `~/.pi/agent/` stay read-only for the session. `/tmp/sn3-impl` stays; removing it needs Paolo's yes. | T11 to T13 and the rollback (P17). |
| R15 (D52) | The store refuses a symlink at any path component below the project root, the task file included, and keeps the list in memory with one warning. | T1 case 17; P2. |
| R16 (D53) | The lock stays dropped. Before each write or deletion, the store compares the file with the text it last read or wrote; another process's change moves the list to memory with one warning and leaves the file as it is. | T1 case 18; P2. |

**Planner defaults.** Each is reversible; the reason stands next to it.

| # | Item | Default | Reason |
| --- | --- | --- | --- |
| P1 | Module layout | `tasks/` root: `names.ts`, `store.ts`, `settings.ts`, `sort.ts`, `reminder.ts`, `auto-clear.ts`. `tasks/service/`: `service.ts`, `sessions.ts`. `tasks/tools/`: `tools.ts`, `descriptions.ts`. `tasks/ui/`: `index.ts`, `widget.ts`, `menu.ts`. `fork-builtins/settings-section.ts` holds the value checks, the section lookup and the project writer both built-ins use. `subagents/service/sessions.ts` exports `subagentScope`. | The subagents module's layering (phase 1 F14). The layering test passed on the probe, and probe mutations Q16 and Q17 fail it (Appendix A). |
| P2 | File format and access | A session's list is `<cwd>/.pi/tasks/tasks-<sessionId>.json` in pi-tasks' format. The store reads the file once. After every change it checks for a symlink below the project root (D52) and for another process's change (D53), then writes through `writeFileAtomically`. It takes no lock. | 305 existing task files resume unchanged (Section 3). Two processes that resume one session share its file; D53 keeps each from overwriting the other. |
| P3 | Service lifetime | `addForkBaseTools` registers the session; the service is built by the first task tool call or the factory's top-level `session_start`. It survives `/reload`. The session's resource cleanup disposes it. A disposed service leaves its list for a fork: a saved session's keyed by its file, at most 16 of them; an unsaved session's keyed by its session manager. A fork takes its parent's entry. | The subagent service's pattern (`subagents/service/sessions.ts`). Pi disposes the old session before it starts a fork (`agent-session-runtime.ts:166-179`), and another session or a child may end in between. A saved fork names its parent's file in `previousSessionFile`; an unsaved fork reuses the parent's session manager (`agent-session-runtime.ts:339-353`). Probe mutations Q24 and Q28. |
| P4 | Reminder wiring | The service counts turns and tool results from `session.subscribe`. The factory's `context` hook appends `takeReminder()`, which answers only while `TaskCreate` is active. In a child session the factory registers only the hook, and the service starts with the child's first task tool call. | The `context` transform exists only as an extension hook (`extensions/runner.ts:1342`); session events carry turns and tool ends (`agent-session.ts:266-273`). |
| P5 | Typed execution | `TaskExecute` spawns `mode: "detached-background"` through `subagentScope(session)`: the session's own service, or a child's nested runtime. `onCreated` maps the agent to its task before the run starts. A `model` string resolves through `resolveCallerModel`; `thinking` and `max_turns` go in `params`. | pi-tasks spawned with `isBackground: true` over the bus (`pi-tasks/src/index.ts:1205-1212`); the adapter maps that to `detached-background`. The precedent is skill-fork's typed runtime (`skills/skill-fork.ts:386-433`). |
| P6 | An agent's end | `completed` and `steered` complete the task with the result. `stopped` completes it and keeps the partial or earlier result. `error` and `aborted` send it to pending, remove the result and set `lastError`. | pi-tasks `src/index.ts:300-364`; the service's `ended` event carries the native status. |
| P7 | TaskOutput and TaskStop | Both find a task by id, agent id or agent id prefix. TaskOutput waits through `waitForResult` with a timeout and the call's signal, and consumes a result only once the task holds it. TaskStop stops the agent through the service. The parameter `shell_id` is gone. | pi-tasks `src/index.ts:1000-1130`; D49. |
| P8 | The session's end | Disposal sends every task whose agent still runs back to pending with `SESSION_ENDED_ERROR`. The subagent service may end the agents first; the text is the same either way. | D21 ends the agents; the print-mode probe showed the subagent service can end them first (Appendix A, finding 3). |
| P9 | RPC | RPC gets the widget as plain lines through `setWidget(key, string[])`, and `/tasks` through `select` and `input`. The settings list shows in the TUI only. | RPC forwards only string arrays (`rpc-mode.ts:205-216`); pi-tasks' widget factory showed nothing there. |
| P10 | Widget activity | A task an agent runs shows the agent's own token usage. A task the session works on accumulates the parent's turn tokens. | pi-tasks gave every active task the parent's tokens, agent tasks included (`pi-tasks/src/ui/task-widget.ts` `addTokenUsage`). |
| P11 | Settings list | Seven rows in pi-tasks' order, without auto-cascade. A change writes the project's own values plus that key, then reloads the manager and the service. An untrusted project shows the values read-only. | The subagents settings menu's rule (phase 2 P17). |
| P12 | D50's `/reload` | `/reload` retries a failed write through `retryWrite`, including a write whose symlink check could not run. A file that could not be read is never retried, and D53's check refuses it anyway, so nothing replaces it. A new session and a resume open the file again. | W2 keeps the service across `/reload`, where pi-tasks rebuilt its store; D50 forbids overwriting an unreadable file. Probe mutations Q18 and Q19. |
| P13 | Old-case inventory | `$E4/old-cases.md` gives each of the 456 cases a status: `T<n>.<k>` or `Dropped: <reason>` (T1 69, T2 78, T3 75, T4 80, Dropped 154). Tasks T1 to T4 fill the covering tests of their rows in the commit that adds them. `$E2/check-cases.mjs coverage` checks every row. | Phase 3 P13; `$E4/extract-old-cases.mjs` parsed the 25 files with the TypeScript compiler. |
| P14 | Mutation records | As phase 3 P15, with `$E2/mutate.mjs` and `$E2/check-cases.mjs`. T9 copies the specs and records to `$E4/mutations/`. | The runner and checker work unchanged (Appendix A). |
| P15 | Identity check | `$E4/check-identities.mjs` is phase 3's check with the fix reports renamed `T6-R<n>-<k>.json` and `T7-F<n>-<k>.json`. It checks the fixes in implementation order, `T6-R` then `T7-F`, each by number, against the phase run plus every earlier fix. A later fix therefore cannot delete or skip a test an earlier fix added. Every test file of the phase run and of each fix's last report must still exist on disk. Renames follow phase 3 P16. | Phase 3's copy hardcodes its task numbers and compares each fix with the phase run only. Self-tests in Appendix A. |
| P16 | Changed existing tests | `test/fork-builtins/base-tools.test.ts` gains the task tool names in its `NAMES` list: four in T2, three in T3. No test is renamed or removed. | The list asserts the exact registration order. The probe's full run failed exactly its two tests before the change (Appendix A). |
| P17 | Cutover execution | Each cutover and rollback step first asks Paolo with `ask_user_question`, quoting the exact commands with every path expanded. `$R/approvals.md` gets `<step>: <date>, <Paolo's words>` before Paolo runs them. Paolo runs them in his own terminal and says when they finished. The session then runs the step's read-only validation. | Phase 3 cutover note: the implementing session's tools failed with `ENOENT` in the main checkout. |
| P18 | Cutover backups | C2 keeps `$R/settings.json.pre-cutover` for the record and edits the entry through `$E3/settings-entry.mjs` under Pi's lock. Before C3, `$R/dist-pre-cutover.tar` holds every `dist` directory of the main checkout, with a SHA-256 manifest. Every command Paolo runs starts with `test ! -e` for each file it creates, so a repeat never overwrites a backup or a record; a repeat after an interrupted step takes Paolo's new yes and new file names. | Phase 3 P20, proven there and rehearsed again on a copy (Appendix A). |
| P19 | Rebuild timing | Before C3, `ps -axo pid=,args= \| awk '$2=="pi"'` lists the running Pi processes. Paolo closes them or accepts the risk. | Pi retitles its processes `pi`, so phase 3's `pgrep` pattern matched nothing. The command listed 2 processes during planning. |
| P20 | Cutover record | T15 writes `## Cutover` in the results file with three facts, each read from its source (the rollback's State table). With Paolo's yes, T15 updates the handoff's sections 14.1 and 14.5. The record stays on `feat/subagents-native`; the next fast-forward of `personal` carries it, as phase 4's carries phase 3's (R9). | Phase 3 P22. Phase 3's `Files` fact read a path the fast-forward brought back; each fact here has a read command that the cutover cannot fake. |
| P21 | State directory | `$R` holds eight read-only files: `personal.ref`, `base.ref`, `main-packages.status`, `main-status.pre-cutover`, `live-settings.sha256`, `agents-drift.expected`, `base-1.json` and `base-testsh.log`. The planning session wrote them. Every run output goes to a new path in `$R`. | Phase 3 P24. |
| P22 | The review gate's diff | Before each review round, `git diff --cached > $R/reviews/<task>-<k>.diff`. The reviewer's prompt names that file and the command. | The phase 3 reviewer once reported an empty staged diff with files staged. |
| P23 | Own result strings | The service's own answers use a colon where pi-tasks used an em dash: `Task #1 [completed]: subagent <id>`, `spawn failed: <reason>`. Claude Code's tool descriptions stay verbatim. | `~/.pi/agent/AGENTS.md` forbids em dashes for interruptions; phase 3 made the same change. |

### 2.2 Source questions

| # | Status | Answer used |
| --- | --- | --- |
| Phase 3 review F7 (read-only tombstones, `reopen` by handle) "with the typed-API work of phase 4" | Adopted: stays deferred | The task service never reads tombstones or reopens an agent. The results file keeps F7 open. |
| Phase 3 review F8 (one list of mention candidates) and F10 (a user page for subagents) | Adopted: stay deferred | No phase 4 change needs them. T5 adds a module README for tasks, as phase 3 did for mentions. |
| Phase 2 F11, F13 and F14 | Adopted: stay deferred | `settings-section.ts` shares the checks and the writer; F14's menu-and-reader duplication stays open. |
| The agent files' unknown keys (phase 3 Section 10) | Resolved by evidence | `47c063242` removed `persistSession` from `.pi/agents`; on 2026-09-29, with Paolo's yes, `~/.pi/agent/agents/*.md` lost it too, and five files took `thinking:`. T9 closes the open item. |
| Handoff 12.1: graceful cancel | Deferred beyond phase 4 | No task. |
| The worker exclusion (D43, D51) | Resolved by R6 | T9 records it for the workflow work. |

### 2.3 Differences from the source

| Source item | This plan | Reason |
| --- | --- | --- |
| pi-tasks talked to pi-subagents over the bus with a version handshake | Typed calls to `SubagentService`; no handshake | R7, R4. |
| `TaskOutput` and `TaskStop` also served background shells; `TaskStop` took `shell_id` | Agents only; `shell_id` fails validation | R4. Nothing called `ProcessTracker.track` (`pi-tasks/src/index.ts:1015`, `:1069`, `:1104` are its only uses). |
| pi-tasks rebuilt its state at every `/reload`, relinked running agents and handed an in-memory list over | The service survives `/reload`; nothing is relinked or handed over | R2, P3. |
| Four scopes, `PI_TASKS`, a cross-process lock and a re-read on every access | `session` and `memory` only; the file is read once | R4, P2. |
| `tasks-config.json`, global and project, read without a trust check | `forkBuiltins.tasks`; project values only when trusted | R3. |
| pi-tasks' settings menu wrote only values that differ from the global ones, so returning a value to the global one removed the override | The settings list writes the project's own values plus the changed key, as `/agents` does; a value equal to the global one stays in the project file | P11; phase 2 P17. Old case 446 is dropped under D48. |
| A failed write failed the tool call after the change was already in memory; a corrupt file was replaced by the next write | Memory fallback with one warning; the file is never overwritten | R5, P12. |
| Custom sort specs, custom glyphs and auto-cascade | Gone; the five presets and the default glyphs stay | R4. |
| The reminder went out whatever tools were active | Only while `TaskCreate` is active | P4. A session whose model cannot create tasks gets no nudge to create them. |
| RPC showed no widget; `/tasks` Settings opened nothing there | Plain widget lines in RPC; no Settings entry in RPC | P9. |
| Agent tasks showed the parent's token counts | The agent's own usage | P10. |
| A child loaded pi-tasks when its agent loaded extensions | Task tools reach a child only when `tools:` names them | R8. |
| pi-subagents' `/reload` ended the running agents, and pi-tasks sent their tasks back to pending | The agents and their tasks survive `/reload` | Phase 2 keeps agents across `/reload`; R2. Old cases 123 and 221 are dropped, and so is the `/reload` variant of old case 225, whose fork variant T3 case 8 covers. |
| A fork re-linked a running agent to the carried task | The parent's end aborts the agent, and the fork carries the task as pending | D21, P8. Old case 113 is dropped. |
| Em dashes in pi-tasks' own answers | Colons | P23. |
| pi-tasks followed a symlinked `.pi` or `.pi/tasks` | A symlink below the project root keeps the list in memory | R15 (D52). |
| pi-tasks locked the file and re-read it on every access, so two processes on one session merged their changes; a deleted file came back at the next change | No lock; a change or deletion by another process moves the list to memory and leaves the file as it is | R16 (D53). Old case 341 is dropped. |

### 2.4 Approvals

Standing approval, inside `/tmp/subagents-native` only: `npm install --ignore-scripts`, `npm run build:offline`, `npm run check`, `./test.sh`, single test files through `failing-tests.mjs`, mutation runs through `$E2/mutate.mjs`, `git hook run pre-commit`, the per-task commits of Section 6, one `code-reviewer` agent per commit, and the fallback baseline worktree of Section 5 step 3. Also standing: T8's `$E4/run-smoke.sh` runs, which open and close their own background cmux surfaces and write only under their output directory in `$R`; and the read-only validations of T10 to T15, including `node $M/packages/coding-agent/dist/cli.js --help` with an isolated home under `$R`.

These actions always need Paolo's explicit yes, recorded per P17:
- every cutover and rollback command, all of which Paolo runs himself;
- any edit, move, install, build or commit in the main checkout, and any change to `personal`;
- any edit of `~/.pi/agent/settings.json` or other live configuration;
- any edit of the handoff beyond a new ruling Paolo made (T15);
- a `package-lock.json` change (none is expected);
- any change to `agent-session.ts` or another upstream-owned line, which also needs a ruling;
- applying any `super-code-review` finding in T7;
- removing any worktree, branch or backup directory, `/tmp/sn3-impl` included.

## 3. Verified facts

The probe ran on 2026-09-29 in `/tmp/sn4-probe`, a detached worktree at BASE `cd8573e320e3b8189df605cc5e74cf1cd5a75c30`. The baselines ran in the clean `/tmp/subagents-native` at the same commit. Coding-agent ran through `failing-tests.mjs` under `./test.sh` isolation, one run at a time. Under R12 the baseline ran once. Line numbers refer to BASE unless a path names pi-tasks.

| Fact | Evidence |
| --- | --- |
| `feat/subagents-native` is `cd8573e32`, three commits past `personal` at `57e5e56be`: the phase 3 cutover record, the `persistSession` removal and the architecture-reviewer YAML fix. | `git log --oneline -4`; `git -C $M rev-parse personal` |
| The main checkout is on `personal` with an empty status. | `$R/main-status.pre-cutover` is empty |
| `diff -rq $M/.pi/agents .pi/agents` lists exactly the 15 files the two `.pi/agents` commits changed. | `$R/agents-drift.expected`; `git diff --stat 57e5e56be HEAD` |
| pi-tasks loads from `~/.pi/agent/settings.json` line 25, right after `npm:@narumitw/pi-btw` on line 24. | `grep -n` of the live file |
| No `tasks-config.json` exists globally or in the main checkout, and no shell profile sets `PI_TASKS`. `~/Developer` holds 305 session task files; 3 hold an `agentType` and 2 an `agentId`. | `find` and `grep` during planning |
| pi-tasks spawns, stops and consumes over `subagents:rpc:*` and advances tasks on `subagents:completed` and `subagents:failed`. | `pi-tasks/src/index.ts:210`, `:216`, `:227`, `:300`, `:344` |
| `ProcessTracker` has no caller of `track`; only `getOutput`, `waitForCompletion` and `stop` appear. | `pi-tasks/src/index.ts:1015`, `:1069`, `:1104` |
| pi-tasks saves no list for a session without a session file. | `pi-tasks/src/index.ts:388` |
| An extension tool replaces a fork base tool of the same name in the session's registry. | `agent-session.ts:5503-5567` (extension tools set after built-ins at `:5566`); the coexistence probe (Appendix A) |
| RPC forwards `setWidget` only for string arrays. | `rpc-mode.ts:205-216` |
| The `context` hook is the only transform of a request's messages; session events include `turn_start`, `turn_end`, `tool_execution_end` and `agent_settled`. | `extensions/runner.ts:1342`; `agent-session.ts:266-273`; `agent/src/types.ts:582-592` |
| Session resource cleanups run in registration order at `dispose()`. | `ai/src/session-resources.ts:12`; `agent-session.ts:1931` |
| The subagent service ends its agents with `SESSION_ENDED_ERROR` when the session ends. | `subagents/service/service.ts:85` |
| Skill-fork already spawns through the typed service, the nested runtime in a child. | `skills/skill-fork.ts:386-433`; `subagents/adapter/rpc.ts:48` |
| The subagents adapter answers the presentation bind request of the session that owns a session manager. | `subagents/adapter/install.ts:19`; `subagents/binding.ts` |
| `agent-session.ts` carries the two `session: this` lines and nothing else of the port. | `agent-session.ts:797`, `:5636` |
| The probe passes `npm run check`; its full coding-agent run fails nothing and exits 0; all 29 probe mutations are caught. | Appendix A |
| Each per-task patch, applied in order at BASE, reproduces a stage that passed `npm run check` and its probe tests; the four together equal the probe byte for byte. | Split check in `/tmp/sn4-split2` (Appendix A) |
| A vitest run whose tests pass but whose code leaks a rejection exits 1, and the JSON report omits the error. | `$E4/failing-tests.mjs` self-test (Appendix A) |
| A latest-only or workspace-keyed handoff loses a parent's list when another session ends before the fork starts. A saved fork's `session_start` names the parent's file; an unsaved fork reuses the parent's session manager. | Assumptions reviews, passes 1 and 2; `agent-session-runtime.ts:296-353`; probe mutations Q24 and Q28 |
| The smoke passes on the probe's `dist` and writes only under its output directory. It fails steps 02 to 04 when the widget renders nothing, and step 05-result when TaskOutput drops the result. The live settings keep their hash. | `$E4/run-smoke.sh`; negative controls (Appendix A) |
| Phase 2's SDK probe passes unchanged on the probe's `dist`: exits 0, 0 and 1. | Appendix A |
| With pi-tasks loaded next to the native build, pi-tasks' `TaskStop` answers `shell_id`; the native tool rejects it. | Coexistence probe (Appendix A) |
| The fast-forward of a shared clone lands on BASE with a clean status; `reset --keep 57e5e56be` undoes it. | Rehearsal in `/tmp/sn4-plan/ff-clone` (Appendix A) |
| `settings-entry.mjs` removes the pi-tasks entry as a one-line diff and restores it byte for byte after `npm:@narumitw/pi-btw`. | Rehearsal on a copy (Appendix A) |
| No dependency, lockfile or shrinkwrap differs between `personal` and BASE. | `git -C $M diff --name-only personal feat/subagents-native -- package-lock.json '*package.json' packages/coding-agent/npm-shrinkwrap.json` prints nothing |
| The main checkout's `dist` holds 12 directories and no `core/fork-builtins/tasks/`; its phase 3 build is present. | `ls -d`; `test -e` |
| tmux is absent; cmux is present and `CMUX_SOCKET_PATH` is set. | `command -v cmux`; `test -S` |
| The coding-agent baseline has 1,540 suites and 5,280 tests: 5,230 passed, 0 failed, 50 pending. `./test.sh` ran 12 packages and exited 0. | `$R/base-1.json`; `$R/base-testsh.log` |

Claims not yet verified, each with the task that verifies it:
- the store, settings and sort cases beyond the probe's tests (T1);
- the service, reminder and auto-clear cases, and the four list tools (T2);
- the execution cases beyond the probe's tests, `/reload` and the pool (T3);
- the widget, the menu and the settings list (T4);
- the cutover commands in the main checkout and the live settings (T11 to T13), and Paolo's live session (T14).

## 4. Scope

**In scope.**
- The store, settings and sort orders, and the shared settings section: T1.
- The task service, reminders, auto-clear and `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`: T2.
- `TaskExecute`, `TaskOutput` and `TaskStop` on the typed service: T3.
- The presentation factory: widget, `/tasks`, settings list, reminder hook: T4.
- The module README, the subagents README, the ADR-0009 amendment and the full inventory check: T5.
- The phase runs (T6), the phase review (T7), the built outputs and the smoke (T8), and the results (T9).
- The cutover: pre-checks (T10), the fast-forward (T11), the settings entry (T12), the rebuild (T13), Paolo's checklist (T14) and the record (T15).

**Out of scope.** The workflow worker exclusion of D43 and D51, and every workflow or OpenIntent change. Phase 2's F11, F13 and F14, phase 3's F7, F8 and F10, and the print-mode hold. Graceful cancel. Editing or retiring the pi-tasks checkout. Migrating old sessions' in-progress agent tasks: their agents ended with those sessions. Changelog entries: AGENTS.md allows none off `main`.

**Binding constraints.**

| Constraint | Exception in this plan |
| --- | --- |
| Upstream-owned files get thin call sites only (ADR-0003). | None: `agent-session.ts`, `interactive-mode.ts` and `core/keybindings.ts` stay unchanged against BASE. |
| No new runtime dependency and no `package-lock.json` change. | None. |
| The main checkout, `personal` and `~/.pi/agent/` stay read-only for the session. | None: Paolo runs every change there (R14). |
| Never touch paths this plan did not create. `/tmp/ask-user-question-base-tool` belongs to another session. Do not edit OpenIntent, the workflow worktree, pi-tasks or pi-subagents. `/tmp/sn3-impl` stays. | None. |
| AGENTS.md git rules: explicit paths only; no `reset --hard`, `checkout .`, `clean`, `stash`, `add -A`, `--no-verify`. | None. The rollback uses `reset --keep`, which refuses to discard local changes. |
| `vitest.config.ts` keeps `PI_FORK_BUILTINS=off`. | None. |
| The `subagents:*` event names and payloads stay unchanged (R7). | None. |
| No existing test is removed or renamed. | P16 changes `NAMES` in `base-tools.test.ts`; a review or repair fix may rename a test this phase added (P15). |
| Only `$E2/mutate.mjs` mutates source files (P14). | None. |

## 5. Working setup

Every command runs from `/tmp/subagents-native` unless it names another directory. Shorthands:

| Name | Value |
| --- | --- |
| `M` | `/Users/paolof/Developer/ai/pi` (the main checkout) |
| `E` | `docs/plans/subagents-native-phase1-evidence` |
| `E2` | `docs/plans/subagents-native-phase2-evidence` |
| `E3` | `docs/plans/subagents-native-phase3-evidence` |
| `E4` | `docs/plans/subagents-native-phase4-evidence` |
| `S` | `$E4/failing-tests.mjs`, the phase 4 copy that also keeps vitest's output and exit code |
| `I` | `$E4/check-identities.mjs` |
| `R` | `/tmp/sn4-impl` |
| `SUB` | `packages/coding-agent/src/core/fork-builtins/subagents` |
| `TSK` | `packages/coding-agent/src/core/fork-builtins/tasks` |
| `BASE` | `cd8573e320e3b8189df605cc5e74cf1cd5a75c30` |
| `LIVE` | `/Users/paolof/.pi/agent/settings.json` |

1. `git rev-parse --abbrev-ref HEAD` prints `feat/subagents-native`. `git merge-base --is-ancestor $BASE HEAD` exits 0. `git log --reverse --format=%s $BASE..HEAD | head -1` prints `docs: native subagents phase 4 plan`, and every other subject in that range starts with `docs: `. `git diff --name-only $BASE HEAD | grep -v -e '^docs/plans/subagents-native-phase4.plan.md$' -e '^docs/plans/subagents-native-phase4-evidence/'` prints nothing. `git status --short` prints nothing. Otherwise stop and ask.
2. `test -x .husky/_/pre-commit` exits 0, and `diff -r $M/packages/ai/src/providers/data packages/ai/src/providers/data` prints nothing. Otherwise stop and ask.
3. `ls -l $R` lists the eight files of P21, each read-only, and the directory `planning/`, which holds the planning session's probe records. `shasum -a 256 $R/base-1.json $R/base-testsh.log` prints Appendix A's hashes. When a baseline is missing or differs, rebuild both, then use the `-b` files and record the substitution in the results file:
   - `git worktree add --detach /tmp/sn4-base $BASE`; when the path exists, stop and ask;
   - copy the providers data into it, then run `npm install --ignore-scripts` and `npm run build:offline` there;
   - `node $S run /tmp/sn4-base packages/coding-agent $R/base-1b.json`, whose `.exit` file must hold `0`;
   - from `/tmp/sn4-base`, `./test.sh > $R/base-testsh-b.log 2>&1`.
4. The protected state matches: `git -C $M rev-parse personal | diff - $R/personal.ref` and `git -C $M status --porcelain=v1 -- packages | diff - $R/main-packages.status` succeed. `shasum -a 256 -c $R/live-settings.sha256` may fail when a session changed a setting; record the result and go on, because the cutover edits the file as it is then. Otherwise stop and ask; another session may have caused it, so never restore anything.
5. `diff -rq $M/.pi/agents .pi/agents | diff - $R/agents-drift.expected` prints nothing: the only drift is the 15 files T11's fast-forward carries. Otherwise stop and ask. The session's `Agent` tool reads the worktree's own `.pi/agents/`, so the review gate dispatches the branch's `code-reviewer`.
6. `shasum -a 256 $E4/*` prints the hashes of Appendix B.
7. `mkdir -p $R/mutations $R/reviews` succeeds. Define `tf() { (cd packages/coding-agent && eval "ls -1d $*"); }` in the shell; `tf 'test/suite/fork-subagents-*.test.ts' | wc -l` prints a number above 0. `npm run build:offline` exits 0.
8. `command -v cmux` prints a path and `test -S "$CMUX_SOCKET_PATH"` exits 0. Otherwise T8 cannot run its smoke: stop and ask before T8, not before T1.

**Regression rule (R12).**
1. Each code task: `npm run check` exits 0. The test files the task names run as `node $S run /tmp/subagents-native packages/coding-agent $R/<task>-<n>.json $(tf <files>)`, with every pattern quoted, where `n` counts runs from 1. Each run prints `0 failed`, `0 failed suites` and `exit 0, unhandled 0`, and its report covers every listed file. An exit other than 0 with no failed test is an unhandled error or rejection: `$R/<task>-<n>.json.log` names it, and it is a defect of the task. The mutations follow P14:
   - write `$R/mutations/<task>.json`, one entry per numbered case at least, each targeting the task's own code and listing its concrete test files and `expect` identities; the probe's entries of Appendix A that name the task's cases belong in it;
   - `node $E2/mutate.mjs /tmp/subagents-native $R/mutations/<task>.json $R/mutation-state > $R/mutations/<task>.txt` exits 0;
   - `node $E2/check-cases.mjs mutations $R/mutations/<task>.txt <case count>` exits 0.
2. A mutation that makes a test run past 30 s counts as caught when that test is expected: vitest fails the test.
3. When `mutate.mjs` exits 2 because an earlier run was interrupted, follow its message: confirm with `pgrep -g <group>` that the recorded process group has exited, run the restore command, confirm `git diff` shows only the task's own changes, and rerun.
4. T6 runs the full coding-agent suite once and `./test.sh` once. A known flake's failure is ignored. Every other failure is a regression to fix (D36), as task `T6-R<n>`, whose reports are named `$R/T6-R<n>-<k>.json`. When the fix would change an upstream-owned file, stop and ask first.
5. A known flake's failure triggers no rerun, no solo run and no question.

Run suites one at a time: suites run in parallel produce load-induced failures.

Known flakes (D36):

| Test | Evidence |
| --- | --- |
| `exec.test.ts` "captures finite inherited descendant output after the shell exits" | D36; phase 3 baselines. |
| Every test in `agent-session-concurrent.test.ts` | D36; handoff 14.5. |
| `footer-data-provider.test.ts` "updates the cached branch when the reftable directory changes" | D36; handoff 14.5. |

Environment facts:
- The implementing session runs from the main checkout's `dist` (phase 3's build) with pi-tasks loaded. Its `TaskCreate` and siblings are pi-tasks' until it restarts after the cutover; its `Agent` tool is the native one.
- The session's own pi-tasks may create `.pi/tasks/` in the worktree; git ignores it.
- A fenced Pi denies `/tmp`; run the implementing session with `pi --unfenced`.
- The session cannot write the main checkout (phase 3 cutover note); Paolo runs every command there (R14).
- Any SDK or CLI run outside the test harness uses an isolated home under `$R`.
- An SDK probe resolves `@earendil-works/pi-ai` relative to its own path; run it from the worktree whose `dist` it tests.
- TokenSave indexes the main checkout at an older commit. Use `read` and `grep` inside `/tmp/subagents-native` instead.

## 6. Tasks

Shared rules for every code task:
- Tests turn fork built-ins on with `vi.stubEnv("PI_FORK_BUILTINS", "on")`. Suite tests use `test/suite/harness.ts`, the faux provider and `test/suite/fork-tasks-fixtures.ts` (`probe-T2.patch`), never a real provider. A test that reads an agent's child uses `inspectRecord`. A test of the factory binds a plain fake UI context with own methods and loads the factory through `extensionFactories` and a shared `createEventBus()`. Tests assert visible output: tool answers, task records, widget lines, notifications and the requests the faux provider received.
- Each task's **Cases** are numbered; the case count feeds `check-cases.mjs mutations`. Tasks T1 to T4 fill the `Covering tests` of their `$E4/old-cases.md` rows in the same commit, and `node $E2/check-cases.mjs coverage $E4/old-cases.md $R/<task>-<n>.json $R/mutations <task>` exits 0 on the task's last report.
- Each code task T1 to T4 starts with `git apply $E4/probe-T<n>.patch`, which exits 0 on the tree the earlier tasks left; Appendix B lists what each patch holds. The probe verified every patch alone: `npm run check` passed and the task's probe tests passed at each stage (Appendix A). The task then adds its remaining tests.
- **Review gate (R11, P22).** It applies to every implementation commit: T1 to T5, each `T6-R<n>` and each `T7-F<n>`. T0, T9 and T15 commit only plan and results files, so they take no review. After validation passes, stage the task's paths explicitly and write `git diff --cached > $R/reviews/<task>-<k>.diff`, where `k` counts the review rounds of the task from 1. Dispatch one `code-reviewer` agent whose prompt names both `git diff --cached` and that file. Check each finding against the source. Fix the accepted ones, rerun the task's validation, restage and write the next round's diff file. Append every finding with its disposition to `$R/reviews.md` under `## <task id>`, one line per finding starting `- `. A disposition is Accepted, Rejected with the disproving source, or Deferred with the date of Paolo's yes. A review with no finding records `- none`. Then commit; the hook runs `npm run check`.
- A commit prints `✅ All pre-commit checks passed!`; when it does not, stop.
- The commit body names the task's test reports and its mutation record.

### T0. Record the plan

The planning session commits this plan and `$E4/` as `docs: native subagents phase 4 plan`. Each later edit of the plan before implementation is its own `docs: ` commit that touches only the plan and `$E4/`; Section 5 step 1 checks the range.

### T1. The task store, settings and sort orders

**Changes.** `git apply $E4/probe-T1.patch` adds every file below except the two new test files.

| File | Change |
| --- | --- |
| `packages/coding-agent/src/core/fork-builtins/settings-section.ts` | New: `SettingCheck`, `describeSetting`, `acceptsSetting`, `forkBuiltinSection`, `writeForkBuiltinProjectSection`. |
| `$SUB/settings/settings.ts` | Uses the shared checks, section lookup and writer; its messages stay. |
| `$TSK/names.ts`, `$TSK/store.ts`, `$TSK/settings.ts`, `$TSK/sort.ts` | New. |
| `test/fork-builtins/tasks/store.test.ts` | New: the probe's eight store tests, plus the rest of cases 1 to 12, 17 and 18. |
| `test/fork-builtins/tasks/settings.test.ts` | New: cases 13, 14. |
| `test/fork-builtins/tasks/sort.test.ts` | New: case 15. |

**Cases.**
1. `create` numbers tasks from 1, keeps the subject as given (a whitespace-only one included), starts tasks `pending` with empty edges and metadata, and never reuses an id, deleted ones included.
2. `get` returns a task by id and undefined for a missing one; `list` returns every task in numeric id order.
3. `update` changes status, subject, description, activeForm and owner, reports the changed fields in that order and bumps `updatedAt`; an unknown id changes nothing and reports no field.
4. Metadata merges shallowly, and a key set to null is deleted.
5. `addBlocks` and `addBlockedBy` set both edges once each, and warn for a self edge, a missing task and a cycle while still recording the edge.
6. Status `deleted`, `delete`, `clearCompleted` and `clearAll` remove tasks with every edge that points at them, and report the count.
7. A file-backed store writes pi-tasks' format after every change (two-space JSON with `nextId` and `tasks`), creates its directory at the first change, and a new store on the same file reads the same list.
8. An old pi-tasks file resumes: missing `blocks`, `blockedBy`, `metadata`, `createdAt` and `updatedAt` are filled, wrong types are replaced, records without a string id are skipped, and a missing or stale `nextId` becomes the highest id plus one (Q13).
9. A failed write keeps the list in memory with one warning; later changes stay in memory, and the file is unchanged (D50; Q7).
10. A file that cannot be read, is not JSON, or holds no `tasks` array moves the list to memory with a warning, and nothing ever overwrites it, `retryWrite` included (D50; Q8, Q19).
11. `retryWrite` saves the list of a failed write once the file can be written, and later changes save to the file again (P12; Q18).
12. `seed` fills only an empty store, with copies; `snapshot` returns the list as the file holds it; `deleteFileIfEmpty` deletes the file of an empty file-backed list only.
13. Task settings: defaults, then global values, then project values; a project value applies only in a trusted project; a wrong type, an out-of-range number, an unknown key and a non-object section each warn once and are dropped.
14. `writeProjectTaskSettings` replaces only `forkBuiltins.tasks` in the project `settings.json`, keeps every other key, refuses a value the reader would drop and names its key, refuses a symlinked `.pi` or `settings.json`, and leaves the file byte-identical when the write fails.
15. The five sort orders (`id`, `status`, `active`, `recent`, `oldest`) order tasks as pi-tasks' presets do, tie-breaks included.
16. The subagent settings writer keeps its behavior through the shared section writer: `test/fork-builtins/subagents/settings.test.ts` passes unchanged, and a mutation of `writeForkBuiltinProjectSection` fails it.
17. A symlink at any path component below the project root, the task file included, keeps the list in memory with the warning `Tasks are not saved: <link> is a symlink. ...`; nothing is read, written or deleted through it; the root itself may be a link (D52; Q25). A component the store cannot check, such as a file where a directory belongs, keeps the list in memory with `... could not be checked (<error>) ...`, and the change still succeeds (D50; Q27). A check that could not run is retried by `retryWrite`, as a failed write is (Q29). The tests pass the project root, as the service does.
18. A file another process changed or deleted since the store last read or wrote it keeps the list in memory with the warning `Tasks are not saved: <file> changed outside this session. ...`; neither a write, `retryWrite` nor `deleteFileIfEmpty` touches it or recreates it (D53; Q26). Old case 341, which expected a deleted file to come back, is dropped under D53.

**Validation.** Test files: the three new files, `test/fork-builtins/subagents/settings.test.ts` and `test/suite/fork-subagents-settings-menu.test.ts`. Mutations with case count 18; Q7, Q8, Q13, Q18, Q19 and Q25 to Q27 and Q29 serve their cases. `npm run check` exits 0.

**Commit.** `feat(coding-agent): the native task store, task settings and sort orders`.

### T2. The task service, reminders, auto-clear and the four list tools

**Changes.** `git apply $E4/probe-T2.patch` adds every file below except the two new module tests.

| File | Change |
| --- | --- |
| `$TSK/reminder.ts`, `$TSK/auto-clear.ts`, `$TSK/service/sessions.ts`, `$TSK/tools/descriptions.ts` | New. |
| `$TSK/service/service.ts` | New, without typed execution: no `execute`, `output`, `stop`, agent map or subagent scope; `activity` returns the session's own counts. |
| `$TSK/tools/tools.ts` | New, with the four list tools; `TASK_TOOL_FACTORIES` holds four entries. |
| `packages/coding-agent/src/core/fork-builtins/base-tools.ts` | Registers the session for its task service and the task tools. |
| `test/fork-builtins/base-tools.test.ts` | `NAMES` gains the four names (P16). |
| `test/fork-builtins/tasks/layering.test.ts` | New: case 16. |
| `test/fork-builtins/tasks/reminder.test.ts`, `auto-clear.test.ts` | New: cases 7, 8, 10 to 12. |
| `test/suite/fork-tasks-fixtures.ts` | New; `TASK_TOOLS` lists the four list tools until T3. |
| `test/suite/fork-tasks-service.test.ts` | New: the probe's five tests, plus the rest of cases 1 to 6, 9 and 13 to 15. |

**Cases.**
1. `addForkBaseTools` registers `TaskCreate`, `TaskList`, `TaskGet` and `TaskUpdate` as fork base tools, active in a top-level session; none under `PI_FORK_BUILTINS=off`; a caller's tool of the same name stays; registration reads no session property.
2. TaskCreate answers `Task #<id> created successfully: <subject>`, stores `agentType` as `metadata.agentType`, merges `metadata`, and carries Claude Code's description and prompt guidelines verbatim.
3. TaskList answers `No tasks found`, or lists pending, then in-progress, then completed tasks, each by id, with the owner in parentheses and only open blockers.
4. TaskGet answers `Task not found`, or the subject, status, owner, description with double-escaped newlines unescaped, open blockers, blocks and metadata JSON.
5. TaskUpdate answers `Updated task #<id> <fields>` with warnings appended, or `Task #<id> not found`; `deleted` removes the task.
6. A session Pi saves keeps its list in `<cwd>/.pi/tasks/tasks-<sessionId>.json`; an in-memory session (`--no-session`) and `taskScope: memory` save no file; `taskScope` takes effect at the next session. The test builds a `TaskService` on a fake session whose manager is `SessionManager.create(<cwd>, <dir>)`, as the probe's test does (Q20).
7. The cadence: a reminder is due once 4 turns passed without a task tool (2 while a task is in progress), a non-task tool ran, and the list holds tasks; a task tool call resets it; one reminder per cycle; a text-only turn with an in-progress task marks it due after 2 turns.
8. The reminder's text: the empty-list nudge, the list echo with activeForm, newlines and reminder tags stripped from fields, at most 10 tasks with unfinished ones first, and the overflow sentence.
9. `takeReminder` gives a reminder only while `TaskCreate` is active.
10. Auto-clear `on_list_complete`: the list leaves 4 turns after its last completion; a task going back to work cancels the countdown; a list that auto-clear, a deletion or a clear empties deletes its file and leaves `.pi/tasks/` in place.
11. Auto-clear `on_task_complete`: each completed task leaves 4 turns after it completed; a reverted or deleted task is forgotten.
12. `never` keeps everything; `startNewBatch` retires a finished list when a later run creates a task, and keeps a list built within the same run.
13. Session start: startup and `/new` clear an all-completed list and delete its empty file; resume, fork and reload keep the list and mark its run ended; `/reload` rereads the settings, so a changed auto-clear mode applies from the next completion and turn, and retries a failed write.
14. A fork takes the list its parent's session left: a saved fork by the parent's file, an unsaved fork through the session manager it shares with its parent. Another session's end in between changes nothing; a new or resumed session takes nothing (Q9, Q24, Q28).
15. Warnings go out once per text and are held until the first listener subscribes.
16. The tasks module's layering: imports point down, no cycle, the subagents module never imports it, and the service imports no presentation code (Q16, Q17).

**Validation.** Test files: the new files, `test/fork-builtins/base-tools.test.ts` and `test/suite/fork-base-tools.test.ts`. Mutations with case count 16. `npm run check` exits 0.

**Commit.** `feat(coding-agent): the native task service and the task list tools`.

### T3. Tasks on the typed subagent service

**Changes.** `git apply $E4/probe-T3.patch` makes every change below.

| File | Change |
| --- | --- |
| `$SUB/service/sessions.ts` | `SubagentScope` and `subagentScope(session)`. |
| `$TSK/service/service.ts` | `execute`, `output`, `stop`, the agent map, the subagent scope, `activity` for agent tasks, and the agent loop of `dispose` (P5 to P8). |
| `$TSK/tools/tools.ts` | `TaskExecute`, `TaskOutput` and `TaskStop`; `TASK_TOOL_FACTORIES` holds seven entries. |
| `test/fork-builtins/base-tools.test.ts` | `NAMES` gains the three names (P16). |
| `test/suite/fork-tasks-fixtures.ts` | `TASK_TOOLS` lists all seven tools. |
| `test/suite/fork-tasks-execute.test.ts` | New: the probe's five tests, plus the rest of cases 1 to 11. |

**Cases.**
1. TaskExecute starts one agent per ready task through the subagent service as `detached-background`, with the task prompt, the subject as description, and `model`, `thinking` and `max_turns` forwarded; the task records the agent id as owner and `metadata.agentId`; the answer lists each launch (Q1).
2. TaskExecute skips a task that is missing, not pending, without `agentType`, or blocked (naming the open blockers); a refused spawn sends the task back to pending with the reason; nothing ready answers `No tasks to execute.` (Q12).
3. The task prompt: the task line, the description, each completed prerequisite's result cut at 4,000 characters with a note, `additional_context`, then the closing instruction.
4. An agent's end: completed or steered completes the task with the result; stopped completes it and keeps the partial or earlier result; error or aborted sends it back to pending, removes the result and records `lastError`; the end of an agent TaskExecute did not start, or a second end, changes no task (Q2).
5. TaskOutput finds a task by id, by agent id or by an agent id prefix; refuses an empty id, an unknown task and a task with no agent; with `block` waits until the agent ends, the timeout passes or the call aborts; answers the status with the result or `Error: <lastError>`; consumes the agent's result only once the task holds it (Q3).
6. TaskStop finds the task the same way, stops its agent through the service, completes the task, and refuses a task with no running agent; `shell_id` alone fails schema validation (Q11).
7. In a child session, TaskExecute spawns through the nested runtime of the agent the child runs as, so `allowed_subagents`, `isolated` and `maxSubagentDepth` apply and a refusal is a skipped task; task tools reach a child only when its agent's `tools:` names them (D22; Q10, Q14).
8. The session's end sends every task whose agent still runs back to pending with `The session ended before the agent finished.`, whichever service ends first (Q4).
9. `/reload` keeps the service, its list and its agents: an agent's end after `/reload` still updates its task as case 4 says, and TaskOutput still finds the task by the agent's id and waits for it.
10. All seven tools register; TaskExecute's agents take background slots and queue past `maxConcurrent`; an agent whose result TaskOutput did not hand over notifies the session (Q15).
11. The service's activity: an agent task reports the agent's usage; a task the session works on accumulates the parent's turn tokens (P10).

**Validation.** Test files: the execute suite, `test/suite/fork-tasks-service.test.ts`, `test/fork-builtins/base-tools.test.ts`, `test/suite/fork-subagents-adapter.test.ts`, `test/suite/fork-subagents-nested.test.ts` and `test/suite/skills-fork.test.ts`. Mutations with case count 11. `npm run check` exits 0.

**Commit.** `feat(coding-agent): run tasks as subagents through the typed service`.

### T4. The presentation: widget, `/tasks` and the reminder hook

**Changes.** `git apply $E4/probe-T4.patch` adds every file below except `ui-menu.test.ts`.

| File | Change |
| --- | --- |
| `$TSK/ui/index.ts`, `$TSK/ui/widget.ts`, `$TSK/ui/menu.ts` | New (P4, P9 to P11). |
| `packages/coding-agent/src/core/fork-builtins.ts` | `{ name: "tasks", factory: tasksPresentation, hidden: true }` in `FORK_OWNED_BUILTINS`; the module comment names it. |
| `test/fork-builtins/tasks/ui-widget.test.ts` | New: the probe's two failure tests, plus the rest of cases 3 to 5 with a fixed source. |
| `test/fork-builtins/tasks/ui-menu.test.ts` | New: cases 7 and 8 with fake UI contexts. |
| `test/suite/fork-tasks-presentation.test.ts` | New: the probe's two tests, plus the rest of cases 1, 2, 6 and 9. |

**Cases.**
1. The factory at a top-level `session_start` builds the service and passes the reason and `previousSessionFile`; `tui` shows the widget; `rpc` sends it as plain lines; print and JSON show nothing; a child session registers no command and builds no service at start.
2. The `context` hook adds a due reminder as the last user message of the request, in every mode and in a child whose service exists; no session keeps it (Q5, Q6).
3. Widget rows: the summary counts; `✔`, `◼` and `◻`; completed rows struck through; a pending row names its open blockers; a worked-on in-progress row shows the spinner, activeForm or subject, the agent label, elapsed time and tokens; any in-progress row names its agent; each line is clipped to the terminal width with `...`.
4. Widget options: `collapseCompleted`, `showAll`, `maxVisible`, `hiddenAt` with the overflow line, and `sortOrder`.
5. Widget lifecycle: it registers once the list has tasks and removes itself when the list empties; the spinner timer runs only while a task is worked on; several changes in one tick redraw once; `session_shutdown` removes it; a render error, a failed `setWidget`, `requestRender` or removal never escapes, and a failed registration is tried again at the next change (Q21 to Q23).
6. The service's warnings reach the UI as notifications, held ones included.
7. `/tasks`: view with status glyphs; detail actions start, complete, delete and back; create through two inputs; clear completed and clear all; RPC offers no Settings entry; a subject holding `#<n>` opens the right task.
8. The settings list: seven rows with current values; a change writes the project's own values plus that key and reloads; an untrusted project is read-only with a notice; a failed write warns.
9. `/reload` loads the factory again: the widget rebinds to the same service and list.

**Validation.** Test files: the three new files, `test/fork-builtins.test.ts`, `test/suite/fork-subagents-presentation.test.ts` and `test/fork-builtins/tasks/layering.test.ts`. Mutations with case count 9. `npm run check` exits 0.

**Commit.** `feat(coding-agent): the tasks widget, /tasks and the task reminder`.

### T5. Documentation and the full inventory check

**Changes.**
- `$TSK/README.md`, new: the layout, the wiring (D47), the service, the tools, the settings (D48) with a key table, the memory fallback (D50), the symlink refusal (D52), the conflict detection (D53), the reminder, auto-clear, the presentation per mode, children (D22), what D49 dropped, and known limitations. The limitations include: a task left `in_progress` by an agent of an ended pi-tasks session stays so until the model or `/tasks` changes it, and a custom loader that drops `<inline:tasks>` removes the widget and the reminders.
- `$SUB/README.md`: the opening paragraph names the task service as a typed consumer; the "Later phases" table drops phase 4; `## Wiring` names `subagentScope`.
- An ADR-0009 amendment dated on the day of the task. It covers the seven task base tools, `<inline:tasks>`, `forkBuiltins.tasks` (D48), `fork-builtins/settings-section.ts`, and an unchanged upstream footprint.

**Validation.**
- For each term `D46`, `D47`, `D48`, `D49`, `D50`, `D52`, `D53`, `forkBuiltins.tasks`, `TaskExecute`, `retryWrite` and `<inline:tasks>`, `grep -cF "<term>" $TSK/README.md` prints at least 1.
- `grep -c '| 4 |' $SUB/README.md` prints 0.
- For each term `D47`, `D48` and `forkBuiltins.tasks`, `grep -cF` on the ADR prints at least 1.
- `node $E2/check-cases.mjs inventory $E4/old-cases.md` exits 0 and reports `rows: 456`.
- Run every file the inventory's covering tests name: `node $S run /tmp/subagents-native packages/coding-agent $R/T5-1.json <files>`. `node $E2/check-cases.mjs coverage $E4/old-cases.md $R/T5-1.json $R/mutations` exits 0.
- `npm run check` exits 0.

**Commit.** `docs: native tasks README, subagents README and ADR-0009 amendment`.

### T6. Phase test runs (R12)

**Changes.** None. Run `node $S run /tmp/subagents-native packages/coding-agent $R/phase.json`, then `./test.sh > $R/phase-testsh.log 2>&1; echo $? > $R/phase-testsh.exit`, one after the other.

**Validation.**
- `node $S diff $R/base-1.json $R/phase.json` lists no new failure other than a known flake. The run prints `unhandled 0`, and `$R/phase.json.exit` holds `0`, or `1` when the report's only failures are known flakes; the baseline run exited 0.
- `grep -c 'Vitest caught' $R/phase-testsh.log` prints `0`, as it does for `$R/base-testsh.log`.
- `$R/phase-testsh.exit` holds `0`, as the baseline run's exit did (Appendix A), or `1` when the added failure ids are all known flakes. `grep -cE '^ +Test Files ' $R/phase-testsh.log` prints `11` and `grep -c '^ℹ tests ' $R/phase-testsh.log` prints `1`, as for `$R/base-testsh.log`, so every package's run completed.
- With `ids() { grep -E '(^| )FAIL |^✖ |ℹ fail ' "$1" | sed -E 's/ \([0-9.]+ ?m?s\)$//' | sort -u; }`, `diff <(ids $R/base-testsh.log) <(ids $R/phase-testsh.log)` shows no added line other than a known flake. With `pkgs() { grep -E '^> @earendil-works/.* test$' "$1" | sort; }`, `diff <(pkgs $R/base-testsh.log) <(pkgs $R/phase-testsh.log)` prints nothing.
- Every failure other than a known flake becomes task `T6-R<n>` under the regression rule and the review gate, committed as `fix(coding-agent): <failure>`.
- `node $I $R/base-1.json $R/phase.json $R` exits 0 (P15). Section 9 reruns it after T7.

### T7. Phase review

**Changes.** Run the `super-code-review` skill over `$BASE..HEAD` (R11), with this plan and the handoff as the spec. Write `$R/phase-review.md` with the first line `Verdict: <the skill's verdict>`. Record each finding as a heading `### F<n>: <one line>` followed by one line `Disposition: Accepted`, `Disposition: Rejected: <disproving source>` or `Disposition: Deferred: <reason>`. Present the verdict and the dispositions to Paolo, and wait for his yes per accepted finding. Record each yes as `Approved: <date>, <Paolo's words>` under its heading. Each applied finding is its own code task `T7-F<n>` under the regression rule and the review gate, and gets `Applied: <commit hash>` under its heading.

**Validation.** With `P=$R/phase-review.md`:
- `head -1 $P | grep -c '^Verdict: .'` prints `1`.
- `grep -c '^### F[0-9]' $P` equals `grep -c '^Disposition: ' $P`.
- `for h in $(sed -n 's/^Applied: //p' $P); do git merge-base --is-ancestor "$h" HEAD || echo "missing $h"; done` prints nothing.
- `awk '/^### F/{f=$0; a=0} /^Approved: /{a=1} /^Applied: /{if (!a) print f}' $P` prints nothing.

**Commit.** One per applied finding, `fix(coding-agent): <finding>`; none when nothing is applied.

### T8. Validate the built outputs and run the smoke (R13)

**Changes.** None. Section 5 step 8 must hold.

**Validation.** Run `npm run build:offline`. Then `mkdir $R/home`, which must succeed, and with `H=$R/home`:
- `env -i PATH="$PATH" HOME=$H PI_CODING_AGENT_DIR=$H/.pi/agent node $E2/sdk-probe.mjs packages/coding-agent/dist on` exits 0;
- the same with `PI_FORK_BUILTINS=off` and mode `off` exits 0;
- mode `off` without the switch exits 1;
- `test -f packages/coding-agent/dist/core/fork-builtins/tasks/ui/index.js` exits 0;
- `$E4/run-smoke.sh "$PWD/packages/coding-agent/dist" $R/smoke` exits 0 and prints 11 `pass` lines, from `00-print` to `08-quit`, `05-result` included.

A smoke step that fails leaves its screen in `$R/smoke/<step>.txt`. A failure caused by the harness, such as a changed startup text, is fixed in `$E4/run-smoke.sh` in its own `docs: ` commit, and the run repeats to a new directory. A failure caused by the code becomes a `T7-F<n>` task after Paolo's yes. Afterwards `ls -A $H` prints nothing and `git status --short` prints nothing.

### T9. Record the results

**Changes.** `docs/plans/subagents-native-phase4.results.md`:
- the commits;
- one section `### T<n> <title>` per task T1 to T5, and one for T8;
- in each code-task section, `Tests:`, `Mutations:` and `Review:` lines as phase 3's results file shows them;
- in T8's section, the SDK probe's three JSON lines and the smoke output;
- `## Phase runs` with T6's counts and every `T6-R<n>`;
- `## Phase review` with `$R/phase-review.md` verbatim, then each `T7-F<n>`;
- `## Open items`, which includes: "The workflow work excludes `Agent`, `get_subagent_result`, `steer_subagent`, `TaskExecute`, `TaskOutput` and `TaskStop` from worker sessions, with a test that a worker's model never receives them, before it resumes (D43, D51)." It also carries phase 2's F11, F13 and F14 and phase 3's F7, F8 and F10. It closes the agent files' unknown keys (Section 2.2);
- the deviations.

It copies every `$R/mutations/*.json` and `*.txt` to `$E4/mutations/`.

**Validation.** With `F=docs/plans/subagents-native-phase4.results.md`:
- `for h in $(git log --format=%h $BASE..HEAD); do grep -qF "$h" $F || echo "missing $h"; done` prints nothing.
- `for c in "T1 18" "T2 16" "T3 11" "T4 9"; do set -- $c; node $E2/check-cases.mjs mutations $E4/mutations/$1.txt $2 > /dev/null || echo "$1 mutations incomplete"; done` prints nothing.
- `grep -cF 'D51' $F` prints at least 1.
- `grep -E '^- ' $R/reviews.md | grep -vxFf $F` prints nothing, and `grep -v '^$' $R/phase-review.md | grep -vxFf $F` prints nothing.

**Commit.** `docs: native subagents phase 4 results`, holding the results file and `$E4/mutations/`.

### T10. Check the cutover's preconditions

**Changes.** None; every command is read-only.

**Validation.** Each check has a fallback; a failed check stops the cutover until Paolo answers.
- `git -C $M rev-parse --abbrev-ref HEAD` prints `personal`, and `git -C $M rev-parse personal | diff - $R/personal.ref` succeeds. Otherwise another commit landed on `personal`: stop and ask, because the fast-forward may no longer apply.
- `git -C $M merge-base --is-ancestor personal feat/subagents-native` exits 0.
- `git -C $M status --porcelain=v1 --untracked-files=all | diff - $R/main-status.pre-cutover` prints nothing. Otherwise list the paths; stop and ask. This plan moves no path in the main checkout.
- `diff -rq $M/.pi/agents .pi/agents | diff - $R/agents-drift.expected` prints nothing.
- `grep -c '"../../Developer/ai/pi-tasks"' $LIVE` prints `1`, and `grep -n '"npm:@narumitw/pi-btw"' $LIVE` prints one line, the entry that precedes it.
- `git -C $M diff --quiet personal feat/subagents-native -- package-lock.json packages/coding-agent/npm-shrinkwrap.json` exits 0, and `git -C $M diff --name-only personal feat/subagents-native -- '*package.json'` prints nothing, so C3 needs no install.
- T8 passed at a commit `<t8>` that the results file names, and `git diff --name-only <t8> HEAD | grep -v '^docs/plans/'` prints nothing.
- `test -e $R/dist-pre-cutover.tar` and `test -e $R/settings.json.pre-cutover` each exit 1.
- `test -e $M/packages/coding-agent/dist/core/fork-builtins/tasks` exits 1: the main checkout's build predates this phase.
- `df -k $R | awk 'NR==2 {print $4}'` prints more than 200000.

Present the results and the three cutover steps to Paolo in one message. The steps then follow one at a time, each with its own yes (P17). A declined step is a safe stopping point: the table "Stopping states" below names what runs from then on.

### T11. C1: fast-forward `personal`

**Changes.** After Paolo's yes, Paolo runs in his terminal:

```text
test ! -e /tmp/sn4-impl/C1-merge.log && git -C /Users/paolof/Developer/ai/pi merge --ff-only feat/subagents-native > /tmp/sn4-impl/C1-merge.log 2>&1; echo "C1 exit $?"
```

**Validation.** Paolo reports `C1 exit 0`; any other exit, the no-clobber guard included, changed nothing. `git -C $M rev-parse personal` equals `git rev-parse HEAD` of `/tmp/subagents-native`; the session writes that hash to `$R/cutover-head.ref`. `git -C $M status --porcelain=v1 --untracked-files=all` prints nothing. `diff -rq $M/.pi/agents .pi/agents` prints nothing. When the merge refuses, git changed nothing: stop and ask.

### T12. C2: remove the pi-tasks entry

Ask T11 and T12 back to back, and restart no Pi session between them.

**Changes.** After Paolo's yes, Paolo runs in his terminal:

```text
test ! -e /tmp/sn4-impl/settings.json.pre-cutover && test ! -e /tmp/sn4-impl/C2.log && cp /Users/paolof/.pi/agent/settings.json /tmp/sn4-impl/settings.json.pre-cutover && cmp /Users/paolof/.pi/agent/settings.json /tmp/sn4-impl/settings.json.pre-cutover && cd /tmp/subagents-native && node docs/plans/subagents-native-phase3-evidence/settings-entry.mjs --save /tmp/sn4-impl/C2 /Users/paolof/.pi/agent/settings.json remove ../../Developer/ai/pi-tasks > /tmp/sn4-impl/C2.log 2>&1; echo "C2 exit $?"
```

The copy is a record; the rollback never copies it back.

**Validation.** Paolo reports `C2 exit 0`. `diff $R/C2.before $R/C2.after` shows exactly one removed line, `    "../../Developer/ai/pi-tasks",`, and no added line. `grep -c '"../../Developer/ai/pi-tasks"' $LIVE` prints `0`. Exit 1: a precondition failed and nothing was written. Exit 3: the write failed and the file is unchanged. Exit 4: the write failed and the file changed. On any of them, stop and ask; on exit 4, also show Paolo `$R/C2.before`.

### T13. C3: rebuild the main checkout

**Changes.** The session runs `ps -axo pid=,args= | awk '$2=="pi"'` and `ps -axo pid=,args= | grep -F 'Developer/ai/pi/packages/coding-agent/dist/cli.js' | grep -v grep`, and shows Paolo both lists (P19). After Paolo's yes, Paolo runs in his terminal:

```text
( for f in dist-dirs.txt dist-pre-cutover.tar dist-pre-cutover.sha256 C3-build.log; do if test -e /tmp/sn4-impl/$f; then echo "C3 refused: /tmp/sn4-impl/$f exists"; exit 1; fi; done ) && cd /Users/paolof/Developer/ai/pi && ls -d packages/*/dist packages/session-backends/*/dist > /tmp/sn4-impl/dist-dirs.txt && tar -cf /tmp/sn4-impl/dist-pre-cutover.tar $(cat /tmp/sn4-impl/dist-dirs.txt) && find $(cat /tmp/sn4-impl/dist-dirs.txt) -type f -print0 | sort -z | xargs -0 shasum -a 256 > /tmp/sn4-impl/dist-pre-cutover.sha256 && echo "C3 snapshot ok" && npm run build:offline > /tmp/sn4-impl/C3-build.log 2>&1; echo "C3 exit $?"
```

**Validation.** Paolo reports `C3 snapshot ok` and `C3 exit 0`. `C3 refused` means a file of an earlier attempt exists: nothing ran, so stop and ask. `grep -vxE 'packages/([a-z-]+/)?[a-z-]+/dist' $R/dist-dirs.txt` prints nothing. `test -f $M/packages/coding-agent/dist/core/fork-builtins/tasks/ui/index.js` exits 0. `git -C $M status --porcelain=v1` prints nothing. `mkdir $R/c3-home` succeeds; then, from `$R`, `env -i PATH="$PATH" HOME=$R/c3-home PI_CODING_AGENT_DIR=$R/c3-home/.pi/agent PI_OFFLINE=1 node $M/packages/coding-agent/dist/cli.js --help > /dev/null` exits 0. When the snapshot fails, nothing was built: stop and ask. When the build fails, start the rollback; RB3 restores the snapshot and needs no build.

### T14. Paolo's live checklist (R13)

**Changes.** None by the implementer. Paolo starts a new real session with PATH `pi` in a project of his choice and runs the checklist below, in order. Every prompt carries the marker `sn4-cutover-2026`. The implementer writes the checklist to `$R/checklist.md` and asks Paolo for each result.

1. The startup lists no `pi-tasks` package among its extensions.
2. `sn4-cutover-2026: create two tasks with TaskCreate, one with agentType general-purpose` shows both in the `tasks` widget. `/tasks` lists them, and its Settings shows `Task storage` as `session`; Paolo changes nothing.
3. `sn4-cutover-2026: run the agent task with TaskExecute, then wait for it with TaskOutput` shows the task in progress with its agent, then completed, and the answer quotes the agent's result.
4. `grep -rlF sn4-cutover-2026 <project>/.pi/tasks` names the session's task file.
5. After `/quit` and `pi -c` in the same project, the widget shows the same tasks.
6. `sn4-cutover-2026: create a task with agentType general-purpose that lists every file under this project with one line each, and start it with TaskExecute; do not wait for it` shows the task in progress with its agent in the widget. While it still shows in progress, `/quit` exits. Paolo reports both observations.

**Validation.** `grep -rlF sn4-cutover-2026 ~/.pi/agent/sessions | head -1` names the session file, and `$R/checklist.md` records each item as `pass`, `fail` or `skipped: <reason>` with Paolo's words. Any `fail` starts the rollback after Paolo's yes. A `skipped` item needs Paolo's explicit acceptance, recorded as `Accepted: <date>, <Paolo's words>` under it; without it, the item counts as `fail`.

### T15. Record the cutover

**Changes.**
- The results file gains `## Cutover`. Its first line is one of `Outcome: completed` (all six T14 items `pass`), `Outcome: completed, unverified` (no `fail`, and each `skipped` item accepted by Paolo), `Outcome: rolled back`, `Outcome: not started` (Paolo declined C1), or `Outcome: stopped at <step>`. Three lines follow, each read from the live state with the commands of the rollback's "State" table: `Source: <40-hex commit>` (the commit C1 deployed, or `personal` as it stands when C1 did not run), `Entry: present|absent` and `Build: pre-cutover|native|partial`. Then come T10's checks, each step's commands, Paolo's reported exit lines and approval lines, the build log's last line, and T14's checklist with its session file. A step that did not run is listed as `not run: <reason>`; each rollback step that ran is listed with its verification.
- With Paolo's yes, the handoff's section 14.1 "Loaded today" for pi-tasks and section 14.5's cutover facts describe the three facts in words.

**Validation.** `grep -c '^## Cutover' docs/plans/subagents-native-phase4.results.md` prints `1`. `grep -cE '^Outcome: (completed|completed, unverified|rolled back|not started|stopped at (C[1-3]|RB[1-3]))$'` on the same file prints `1`, and `grep -cE '^(Source: [0-9a-f]{40}|Entry: (present|absent)|Build: (pre-cutover|native|partial))$'` prints `3`. `$R/approvals.md` holds one line per step that ran.

**Commit.** `docs: native subagents phase 4 cutover record`, on `feat/subagents-native`.

### Cutover rollback

A failed step, or a `fail` in T14, starts the rollback after Paolo's yes. No Pi session starts from PATH `pi` until it ends. Paolo runs every rollback command (R14).

**State.** Three facts describe the live setup. Each cutover step changes one fact, and one rollback step changes it back:

| Fact | Pre-cutover value | Changed by | Restored by | Read with |
| --- | --- | --- | --- | --- |
| `Source` | `personal` at `$R/personal.ref` | C1 (`$R/cutover-head.ref`) | RB1 | `git -C $M rev-parse personal` |
| `Entry` | `present` | C2 (`absent`) | RB2 | `grep -c '"../../Developer/ai/pi-tasks"' $LIVE` |
| `Build` | `pre-cutover` | C3 (`native`, or `partial` when the build failed) | RB3 | `partial` when C3's build exited non-zero, or when `$R/rb3-started` exists and `$R/rb3-verified` does not; otherwise `test -f $M/packages/coding-agent/dist/core/fork-builtins/tasks/ui/index.js` tells `native` from `pre-cutover` |

A rollback step runs only when its fact differs from the pre-cutover value, in the order RB1, RB3, RB2. RB1 comes first because RB3 restores the old executable and RB2 the old extension, and both belong with the old source. RB3 restores the snapshot rather than rebuilding. RB2 edits one entry under Pi's lock, so it keeps any setting a session changed during the checklist.

**Preflight.** Before the first rollback command, the session checks the prerequisite of every step that will run, and stops and asks on any failure:
- RB1: `git -C $M rev-parse personal | diff - $R/cutover-head.ref` succeeds, and `git -C $M status --porcelain=v1 --untracked-files=all` prints nothing;
- RB3: `tar -tf $R/dist-pre-cutover.tar > /dev/null` exits 0, and `grep -vxE 'packages/([a-z-]+/)?[a-z-]+/dist' $R/dist-dirs.txt` prints nothing. The session reruns T13's two process lists and shows them; Paolo closes the sessions they list, the failed checklist session included, or accepts the risk in his yes (P19);
- RB2: `grep -c '"npm:@narumitw/pi-btw"' $LIVE` prints `1`.

**Steps.** Paolo runs each command in his terminal after its own yes; the session then runs the verification.

RB1, then `git -C $M rev-parse personal | diff - $R/personal.ref` succeeds:

```text
git -C /Users/paolof/Developer/ai/pi reset --keep 57e5e56be0e2c928f93d534c1b9268188ac81dac; echo "RB1 exit $?"
```

RB3, which stops with `RB3 refused: <dir> was not removed` before any extraction when a deletion fails. Before asking, the session writes the date to `$R/rb3-started`: from then on `Build` reads `partial` until `$R/rb3-verified` exists. A refused or failed RB3 leaves `partial`, and RB3 runs again after Paolo's new yes; its deletions of missing directories succeed, so a rerun completes the restore (Appendix A):

```text
cd /Users/paolof/Developer/ai/pi && ( for d in $(cat /tmp/sn4-impl/dist-dirs.txt); do rm -rf "$d" || { echo "RB3 refused: $d was not removed"; exit 1; }; done ) && tar -xf /tmp/sn4-impl/dist-pre-cutover.tar; echo "RB3 exit $?"
```

After `RB3 exit 0`, from `$M`: `shasum -a 256 -c --quiet $R/dist-pre-cutover.sha256` exits 0; `diff <(find $(cat $R/dist-dirs.txt) -type f | sort) <(sed -E 's/^[0-9a-f]{64}  //' $R/dist-pre-cutover.sha256 | sort)` prints nothing, so no file of the native build remains; and T13's `--help` run exits 0 with a new `$R/rb-home`. Only then does the session write `$R/rb3-verified`.

RB2, then `diff $R/RB2.before $R/RB2.after` shows exactly one added line, the entry, right after `npm:@narumitw/pi-btw`:

```text
test ! -e /tmp/sn4-impl/RB2.before && cd /tmp/subagents-native && node docs/plans/subagents-native-phase3-evidence/settings-entry.mjs --save /tmp/sn4-impl/RB2 /Users/paolof/.pi/agent/settings.json add ../../Developer/ai/pi-tasks npm:@narumitw/pi-btw; echo "RB2 exit $?"
```

**Stopping states.** A declined cutover step, or a declined or failed rollback step, stops the work. T15 records the three facts as read then, and the table below says what runs. Any combination the table does not list continues with the next rollback step.

| Facts | What runs from PATH `pi` | Next step |
| --- | --- | --- |
| All pre-cutover | The pre-cutover setup: phase 3's build with pi-tasks | None (`Outcome: not started`, or `rolled back` when steps ran). |
| `Source` new; `Entry` present; `Build` pre-cutover | The pre-cutover setup: the old `dist` ignores the source | RB1, or C2. |
| `Source` new; `Entry` absent; `Build` pre-cutover | Phase 3's build with no task tools at all | C3, or RB2. |
| `Entry` absent; `Build` native | The native tasks (the cutover, whatever `Source` holds) | T14 when `Source` is new; RB3 after RB1. |
| `Build` partial | Nothing reliable; no Pi session starts from PATH `pi` | RB3, again after a refused or failed attempt (after RB1 when `Source` is new). |
| `Entry` present; `Build` native | pi-tasks' tools shadow the native ones, while both reminder hooks and both widgets run | RB3 or C2, never T14. |

## 7. Test plan

| Layer | What it proves | When it runs |
| --- | --- | --- |
| Module tests `test/fork-builtins/tasks/{store,settings,sort,reminder,auto-clear,ui-widget,ui-menu}.test.ts` | The store and its fallback, the settings, the sort orders, the cadence, auto-clear, the widget lines and the menu | T1, T2, T4; T6 |
| Suite tests `fork-tasks-service`, `fork-tasks-execute`, `fork-tasks-presentation` | Registration, the service on real sessions, typed execution with real children, children's scoping, the session's end, the factory and the reminder hook | T2 to T4; T6 |
| `test/fork-builtins/tasks/layering.test.ts` | Layers point down; no cycle; subagents never imports tasks; the service imports no presentation code | Every code task from T2 |
| Existing subagents suites | The shared settings writer and `subagentScope` keep the subagent service's behavior | T1, T3; T6 |
| Mutation records (`$E2/mutate.mjs`, `check-cases.mjs mutations`) | Every numbered case has a mutation that one of its expected tests catches | T1 to T4; T9 |
| Inventory coverage (`check-cases.mjs coverage`) | Every kept old case has passing tests that its case's mutation breaks | T1 to T4 per task; T5 in full; the done criteria |
| Identity check (`$E4/check-identities.mjs`) | No baseline, task or earlier-fix test disappeared or became skipped; every failure is a flake or repaired | T6; the done criteria |
| Run exit codes (`$E4/failing-tests.mjs`) | No test run leaks an unhandled error or rejection | Every task run; T6 |
| SDK probe (`$E2/sdk-probe.mjs`) | The subagents presentation and the bounded quit still load from the built outputs; the switch removes them | T8 |
| Smoke (`$E4/run-smoke.sh`) | The built CLI saves a print-mode task file, rejects `shell_id`, shows the widget with an agent task, completes it, hands the agent's result to `TaskOutput`, opens `/tasks` and its settings, and quits | T8 |
| Settings helper (`$E3/settings-entry.mjs`) | C2 and RB2 edit one entry under Pi's lock | Appendix A; T12 and RB2 verify the live result |
| `dist` snapshot | RB3 restores the pre-cutover build exactly | Phase 3 rehearsal; RB3's manifest check |
| Footprint check | `agent-session.ts`, `interactive-mode.ts` and `core/keybindings.ts` unchanged against BASE | T6; the done criteria |
| Paolo's checklist | The live setup runs the native tasks without pi-tasks, and an old session format resumes | T14 |

The probe confirmed mutations Q1 to Q29 (Appendix A). Each is an entry of the task and case it names in Section 6.

**Not proved by this plan.**
- A real model's use of the task tools; the smoke's faux provider scripts it.
- RPC clients beyond the widget lines' shape, fenced runs of the smoke, and OpenIntent workers (R6).
- The smoke's steps match text that another surface could also show; the widget and result steps have negative controls, the menu steps do not.
- `ui-menu.test.ts` and the other tests each task adds beyond the probe's run only in their task; the probe verified the code they cover through the smoke and the probe tests.
- RB1, RB2 and RB3 on the live setup; each ran only on a clone, a copy or a probe worktree.
- A full-suite comparison after the `T6-R<n>` and `T7-F<n>` fixes: D36 runs the full suites once.
- Sessions started before T13 keep pi-tasks until they restart.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| A running Pi session lazy-loads a module that T13 rebuilt, and fails. | P19: Paolo sees the running list first; restarting every session after T13 clears it. |
| The fast-forward meets a new path in the main checkout. | T10 compares the full status with `$R/main-status.pre-cutover` and stops on any difference. |
| pi-tasks and the native build run together. | C2 precedes C3; T11 and T12 are asked back to back; "Stopping states" forbids T14 in that state. |
| A session changes a setting during the cutover. | C2 and RB2 edit one entry under Pi's lock and keep every other key. |
| A rebuild fails and leaves a partial `dist`. | RB3 restores the snapshot and its manifest, with no build. |
| An old session's task file holds an `in_progress` agent task whose agent ended with pi-tasks' session. | The native service leaves it as pi-tasks did; the README names it; `TaskUpdate` or `/tasks` resets it. |
| The reminder's cadence counts turns differently from pi-tasks. | The service counts the same session events pi-tasks' hooks counted; T2 cases 7 to 9 pin the intervals. |
| The smoke's screen texts change with Pi's UI. | T8 fixes the harness in a `docs: ` commit and reruns; the screens are kept per step. |
| The reviewer reads an empty staged diff. | P22 gives it the saved diff file. |
| Two Pi processes resume one session and share its task file. | D53: the second writer's list moves to memory with a warning; the file keeps the first writer's tasks. |
| A project links `.pi` or `.pi/tasks` elsewhere. | D52: the list stays in memory with a warning; nothing is written or deleted through the link. |

## 9. Done criteria

- These commits exist on `feat/subagents-native`, each with its Section 6 message: T0, T1 to T5, every `T6-R<n>`, every applied `T7-F<n>`, T9 and T15. `git log --oneline $BASE..HEAD` lists them.
- `npm run check` exits 0 at the last code commit.
- `node $I $R/base-1.json $R/phase.json $R` exits 0.
- `git diff --numstat $BASE -- packages/coding-agent/src/core/agent-session.ts packages/coding-agent/src/modes/interactive/interactive-mode.ts packages/coding-agent/src/core/keybindings.ts` prints nothing.
- With `REPORTS=$R/phase.json$(ls $R/T6-R*-*.json $R/T7-F*-*.json 2>/dev/null | sort -V | while read -r f; do printf ',%s' "$f"; done)`, `node $E2/check-cases.mjs coverage $E4/old-cases.md $REPORTS $E4/mutations` exits 0.
- T8's runs exit 0, 0, 1 and 0, and the results file holds their output.
- `$R/approvals.md` holds a line for each cutover and rollback step that ran.
- The results file's three fact lines equal the facts read again now with the commands of the rollback's "State" table. `completed` and `completed, unverified`: `Source` equals `$R/cutover-head.ref`; `Entry` is `absent`; `Build` is `native`. `personal` may have moved past it later; the check reads `Source` from the record, not from `personal`. `rolled back` and `not started`: every fact holds its pre-cutover value, and, when C3 ran, `shasum -a 256 -c --quiet $R/dist-pre-cutover.sha256` passes from `$M`. `stopped at <step>`: the facts match a row of "Stopping states".
- `$R/checklist.md` records each of T14's six items, or the results file states why T14 did not run.

## 10. Later phases

| Order | Item | Prerequisite |
| --- | --- | --- |
| Workflow work | The worker exclusion of `Agent`, `get_subagent_result`, `steer_subagent`, `TaskExecute`, `TaskOutput` and `TaskStop`, with its test (D43, D51) | Before the workflow work resumes |
| Unassigned | Phase 2's F11, F13 and F14; phase 3's F7, F8 and F10; the print-mode hold | A ruling that schedules them |
| Unassigned | Retiring the pi-tasks checkout and its `personal` branch | Paolo's decision after T14 |
| Next fast-forward | The phase 4 cutover record (T15) | Any later fast-forward of `personal` |

## Appendix A. Probe measurements

The probe started at BASE on 2026-09-29 in `/tmp/sn4-probe`; the baselines ran in the clean `/tmp/subagents-native`. Planning records sit in `/tmp/sn4-impl/planning/`.

| Run | Tests | Failed | Pending | Exit |
| --- | --- | --- | --- | --- |
| base-1 (coding-agent) | 5,280 in 1,540 suites | 0 | 50 | 0 |
| probe-full-1 | 5,293 | 2 new: `base-tools.test.ts`'s two exact-list tests, before P16 | 50 | |
| probe-full-6 (final) | 5,306 | 0 | 50 | 0; `unhandled 0` |
| base `./test.sh` | 12 packages; 11 `Test Files` lines and 1 `ℹ tests` line | none | | 0 (`/tmp/sn4-impl/planning/base-testsh.exit`) |

- `failing-tests.mjs diff base-1 probe-full-6`: no new failure; exit 0.
- `npm run check` exited 0 on the final probe.
- `$R/base-1.json` SHA-256 `cfd52fd51489e5b554e54a5687e15b05accd36206034f8a84ec7291804a25dca`. `$R/base-testsh.log` SHA-256 `7ad5211947bcd6565a149fc583e539f600a7df8d4ba018c7968c69e99e38c6f6`.

Per-task split, in `/tmp/sn4-split2`, a detached worktree at BASE with its own install, rebuilt after review passes 2 and 3 by `/tmp/sn4-impl/planning/split.sh`. Each stage added only its task's files, then ran `npm run check` and its probe tests through `$E4/failing-tests.mjs`:

| Stage | `npm run check` | Probe tests | Tree |
| --- | --- | --- | --- |
| T1 | exit 0 | 22 passed; exit 0 | `20047866c` |
| T2 | exit 0 | 43 passed; exit 0 | `0417ed359` |
| T3 | exit 0 | 101 passed; exit 0 | `e0bb31c80` |
| T4 | exit 0 | 30 passed; exit 0 | `be766afe3` |

With a temporary index at BASE, `git apply --cached` of `probe-T1.patch` to `probe-T4.patch` in order produced each stage's tree exactly. The T4 tree's diff against BASE equals the final probe's, byte for byte. The first T2 run failed `npm run check` on an unused import in the probe's service test; the probe was fixed and every stage rerun.

Self-tests of the evidence tools:
- `$E4/failing-tests.mjs` on a scratch test that passes while a rejection escapes: `0 failed, 1 passed … exit 1, unhandled 1`; the log holds vitest's `Vitest caught 1 unhandled error` banner. On `ui-widget.test.ts`: `exit 0, unhandled 0`. The scratch test was deleted afterwards.
- `$E4/check-identities.mjs` on `base-1`, `probe-full-3` and the probe's execute report as `T3-1.json`: offending 0, exit 0. With the execute suite removed from the phase report: exit 1, naming each test. On synthetic reports where `T7-F1` adds a test: exit 0 when `T7-F2` keeps it, exit 1 when `T7-F2` drops it (`earlier test missing`), exit 1 when `T7-F2` skips it (`skipped more often`). Where `T7-F1` adds a test file that `T7-F2` does not run: exit 0 while the file exists, exit 1 once it is deleted (`test file no longer exists`).

Findings the probe made:
1. The first full run failed `base-tools.test.ts`'s two tests that assert the exact list of fork base tools. P16 adds the task tool names to `NAMES`; no test is renamed.
2. Two smoke runs failed in the harness. The output directory `smoke-1` matched the model name on the launch line, so step 01 passed before Pi started; step 01 now waits for Pi's own `escape interrupt`. Later, a completion notice whose path held `planning` read as the `plan` prompt; the faux provider now matches whole prompts.
3. A print-mode run showed the subagent service can end a task's agent before the task service's disposal. Both paths now write the same `SESSION_ENDED_ERROR` (P8).
4. W2 keeps the service across `/reload`, where pi-tasks rebuilt its store. `retryWrite` therefore implements D50's retry for a failed write only (P12).
5. The old-case inventory found that the widget let a failed `setWidget`, `requestRender` or removal escape, and marked a failed registration as done. pi-tasks guarded all of them (old cases 126, 355, 357, 358, 366). The widget now contains each failure and retries the registration (Q21 to Q23).
6. The planning session changed seven of the inventory subagent's statuses. Old cases 2 to 5 and 7 test behavior the service keeps across `/reload`, so they moved from a drop to T3.9 and T3.4. Old case 110 moved from T2.6 to T2.14, and old case 186 from a drop to T3.4.
7. Review pass 1: the latest-only handoff lost a parent's list when another saved session ended first. Handoffs are now keyed per session (P3; Q24).
8. Review pass 1: D52 and D53 added the symlink refusal and the conflict check to the store (Q25, Q26). The conflict check also refuses to replace an unreadable file, so Q19 now targets taking such a file over.
9. Review pass 1: T2's first split imported T3's `subagentScope` and did not compile. The per-task patches replace the single patch, and each stage passed on its own.
10. Review pass 2: the symlink check ran outside the store's error handling, so a file where a directory belongs threw `ENOTDIR` out of the store. A check that cannot run now falls back to memory (Q27), and the fallback tests pass the project root, as the service does.
11. Review pass 2: unsaved sessions in one workspace shared one handoff key. An unsaved fork reuses its parent's session manager, so that entry is keyed by the manager (Q28).
12. Review pass 2: D53 refuses to recreate a file another process deleted, which old case 341 expected; the case is dropped under D53.
13. Review pass 3: a symlink check that could not run counted as a refusal, so `/reload` never retried it. It now counts as a failed write (Q29).
14. Review pass 3: old case 446 expected a value equal to the global one to leave the project file; the settings list keeps it, as `/agents` does, and the case is dropped under D48.

Mutations, from `$E4/probe-mutations.json` run by `$E2/mutate.mjs` on the final probe:

| Mutation | Failing tests |
| --- | --- |
| Q1: TaskExecute spawns without a background slot | the execute test |
| Q2: a completed agent leaves its task in progress | the execute test |
| Q3: TaskOutput consumes nothing | the execute test |
| Q4: the session's end leaves agent tasks in progress | the session-end test |
| Q5: a session without `TaskCreate` still gets the reminder | the reminder-gating test |
| Q6: other tools never mark a reminder due | the reminder test |
| Q7: a failed write throws instead of falling back | two store tests |
| Q8: a file that holds no task list is written to | the unreadable-file test |
| Q9: a fork takes no list | both fork tests |
| Q10: a child's TaskExecute ignores its nested runtime | the child test |
| Q11: TaskStop leaves the agent running | the stop test |
| Q12: a refused spawn leaves the task in progress | the refused-spawn test |
| Q13: old files are not normalized | the old-file test |
| Q14: the scope ignores a child's lineage | the child test |
| Q15: task tools are no fork base tools | 7 tests across the execute, service and base-tools files |
| Q16: the service imports the widget | two layering tests |
| Q17: the subagents module imports the tasks module | the layering test |
| Q18: a retried write never saves again | the retry test |
| Q19: a file that holds no task list is taken over and overwritten | the unreadable-file test |
| Q20: a session Pi saves keeps its list in memory | the file-scope test |
| Q21: a failing `setWidget` escapes the update | the widget failure test |
| Q22: a failed registration counts as registered | the widget failure test |
| Q23: a failing removal escapes dispose | the widget removal test |
| Q24: a saved session's fork takes the latest list, whoever left it | the saved-session fork test |
| Q25: the store follows a symlink below the project root | the symlink test |
| Q26: a write overwrites another process's change | the shared-file test |
| Q27: an ancestor that cannot be checked throws out of the store | the not-a-directory test |
| Q28: a fork of an unsaved session takes no list | the unsaved-session fork test |
| Q29: a check that could not run is never retried | the retried-check test |
| Restored | 0 of 29 failed; `clean: yes`; exit 0 |

Old-case inventory: `extract-old-cases.mjs` listed 456 cases in the 25 files. `check-cases.mjs inventory` reported 456 rows (T1 69, T2 78, T3 75, T4 80, Dropped 154) and no offending row. The drops: scopes 39, custom glyphs 31, one service per session 18, shell branches 16, custom sort specs 12, auto-cascade 11, protocol handshake 10, packaging 7, pi-subagents bus 5, tasks-config.json 3, D53 1, D48 1.

SDK probe (`$E2/sdk-probe.mjs`) against the probe's `dist`, run from `/tmp/sn4-probe`, with an isolated home: the three runs exited 0, 0 and 1, printed the same JSON lines as phase 3's T9, and the home stayed empty.

Smoke (`$E4/run-smoke.sh`) against the final probe's `dist`:

```text
pass 00-print: task file saved
pass 00-shell-id: rejected
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

The run exited 0 and wrote its transcripts under its own `tmp/`. Negative controls: with the built `renderTaskLines` patched to return no line, steps 02 to 04 failed and the run exited 1; with the built TaskOutput answer patched to drop the result, step 05-result failed and the run exited 1. Each patched file was restored byte for byte. `shasum -a 256 -c` of the live settings passed afterwards.

Coexistence, with the probe's built CLI in print mode and an isolated home: the native `TaskStop` rejected `{ "shell_id": "1" }` with `Validation failed for tool "TaskStop"`. With `-e /Users/paolof/Developer/ai/pi-tasks/src/index.ts` added, the same call answered `No running background process for task 1`, pi-tasks' own text: the extension's tool replaced the native one. `git -C /Users/paolof/Developer/ai/pi-tasks status --short` printed nothing afterwards.

Cutover commands:
- `/tmp/sn4-plan/ff-clone`, a `git clone --shared --no-checkout` of the main checkout at `personal`: `git merge --ff-only origin/feat/subagents-native` printed `Updating 57e5e56be..cd8573e32`, `Fast-forward`, and left a clean status. `git reset --keep 57e5e56be` returned `HEAD` to `57e5e56be`.
- `$E3/settings-entry.mjs` on a copy of the live settings: `remove ../../Developer/ai/pi-tasks` exited 0 with a one-line diff; `add ../../Developer/ai/pi-tasks npm:@narumitw/pi-btw` exited 0 and restored the copy byte for byte; a second `add` exited 1 and wrote nothing.
- The no-clobber guards of C1 and C3, run in bash and zsh against a scratch directory: with no file present they went on and printed exit 0; with one file present they printed `C3 refused: …` or wrote nothing, and exit 1.
- RB3 in bash and zsh against a scratch tree of two `dist` directories, after an added and a changed file: with the first directory undeletable it printed `RB3 refused: packages/a/dist was not removed` and exit 1, and left the second untouched; once deletable it printed exit 0, the manifest check passed, and the inventory `diff` printed nothing.
- RB3 against three directories: with the last one undeletable it removed the first two, printed `RB3 refused: packages/c/dist was not removed`, and failed verification; the rerun printed exit 0 and verified. With a missing archive the extraction failed after every deletion and verification failed; the rerun with the archive verified.
- `ps -axo pid=,args= | awk '$2=="pi"'` listed 2 processes, this session's among them.
- The `dist` snapshot and restore commands are phase 3's, rehearsed there on 11 directories and run live on 12 (phase 3 results, `## Cutover`).

## Appendix B. Verified code

Evidence files, with SHA-256:

| File | SHA-256 |
| --- | --- |
| `docs/plans/subagents-native-phase4-evidence/check-identities.mjs` | `5f6ce8f55b1735bf56c42631f17612aa9da539aa7ed2478d5951a801d9434145` |
| `docs/plans/subagents-native-phase4-evidence/extract-old-cases.mjs` | `df5c5133c69c41bcad8533e34ec9d76b67942878375beca93f2d2590d611b1ef` |
| `docs/plans/subagents-native-phase4-evidence/failing-tests.mjs` | `cebacb803e95cbc22cc93503981956a8dec3d4b231d460af2938c875fd3b2dde` |
| `docs/plans/subagents-native-phase4-evidence/faux-tasks.ts` | `dea54452fe48e835fdbac34fadb8ce0e31839f71b734b88d0ca67eefd8497331` |
| `docs/plans/subagents-native-phase4-evidence/old-cases.md` | `6916ff0ac97fa0ee31520b07869ff0a7ab3f9d1b81a683a043dc2d3cea123f5f` |
| `docs/plans/subagents-native-phase4-evidence/probe-mutations.json` | `4f2d6f6cd0500cce2a5258c399d6759148a80fc82fe7038eeddfddb21a1a270f` |
| `docs/plans/subagents-native-phase4-evidence/probe-T1.patch` | `94788ea31a068117f72db7f96d5e5b39414bdca3362686f6e9276379f46c6731` |
| `docs/plans/subagents-native-phase4-evidence/probe-T2.patch` | `64acf9d3f360ddf6fcaad0b6ec2518cb4b21dd91eb47e0775fc7fd75f687bd53` |
| `docs/plans/subagents-native-phase4-evidence/probe-T3.patch` | `b22955add79dc55c80581097cd0672d228f74dbf672b647f5065af4297cc3061` |
| `docs/plans/subagents-native-phase4-evidence/probe-T4.patch` | `b0ba44e1a3aa0006870ac579f5c771724ee32c53ba51a8266aaf500fdf2965fe` |
| `docs/plans/subagents-native-phase4-evidence/run-smoke.sh` | `9a889196fb99870cc6ef69fa8e5974c3e92bd38dc8a64effbfc81e0edf9c3758` |

Each patch applies on the tree the earlier ones leave, starting at BASE. They hold, verbatim as the split check passed them:

| Patch | Files | Content |
| --- | --- | --- |
| `probe-T1.patch` | `fork-builtins/settings-section.ts`; `$SUB/settings/settings.ts`; `$TSK/names.ts`, `store.ts`, `settings.ts`, `sort.ts`; `test/fork-builtins/tasks/store.test.ts` | The shared settings section, the subagents reader on it, the store with the memory fallback, `retryWrite`, the symlink refusal and the conflict check, the task settings, the sort orders, and the probe's eight store tests |
| `probe-T2.patch` | `$TSK/reminder.ts`, `auto-clear.ts`, `service/service.ts`, `service/sessions.ts`, `tools/descriptions.ts`, `tools/tools.ts`; `fork-builtins/base-tools.ts`; `test/fork-builtins/base-tools.test.ts`; `test/fork-builtins/tasks/layering.test.ts`; `test/suite/fork-tasks-fixtures.ts`, `fork-tasks-service.test.ts` | The service without typed execution, the four list tools, the registration, and the probe's layering and service tests |
| `probe-T3.patch` | `$SUB/service/sessions.ts`; `$TSK/service/service.ts`, `tools/tools.ts`; `test/fork-builtins/base-tools.test.ts`; `test/suite/fork-tasks-fixtures.ts`, `fork-tasks-execute.test.ts` | `subagentScope`, typed execution, the three agent tools, and the probe's execute tests |
| `probe-T4.patch` | `$TSK/ui/index.ts`, `widget.ts`, `menu.ts`; `fork-builtins.ts`; `test/fork-builtins/tasks/ui-widget.test.ts`; `test/suite/fork-tasks-presentation.test.ts` | The factory, the widget with its failure guards, `/tasks` and the settings list, the `<inline:tasks>` entry, and the probe's widget and reminder-hook tests |

`faux-tasks.ts` registers the provider `smoke` with the model `smoke-1`. A child's request waits 4 s. The prompt `plan work` calls `TaskCreate`, then `TaskExecute`; `check it` calls `TaskOutput` and answers on one line; `stopshell now` calls `TaskStop` with `shell_id` only.

## Review history

### Pass 1: 2026-09-29, reviewer model openai-codex/gpt-6-astra

| Angle | Verdict |
| --- | --- |
| traceability | FAIL |
| assumptions | PASS_WITH_FINDINGS |
| completeness | PASS_WITH_FINDINGS |
| feasibility | FAIL |
| validation | PASS_WITH_FINDINGS |
| safety | PASS_WITH_FINDINGS |

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | C4 made a second fast-forward that R9 does not allow, and left the committed `Source` stale (blocking; traceability, completeness, feasibility) | Accepted: C4 and T16 are gone; the record rides the next fast-forward | R9; phase 3 P22; P20, T15, Section 9, Section 10 |
| 2 | T2's split imported T3's `subagentScope` and called `agentOf`, so T2 would fail `npm run check` (blocking; feasibility) | Accepted | Per-task patches, each stage verified in `/tmp/sn4-split` (Appendix A) |
| 3 | Old case 225 maps its `/reload` variant to T3.8 although the plan keeps agents across `/reload` (traceability) | Accepted | `pi-tasks/test/subagents-e2e.test.ts:206-212` at `83480bd`; Section 2.3 |
| 4 | A latest-only handoff loses a parent's list when another session ends before the fork starts (assumptions) | Accepted | Reviewer's reproduction; P3; T2 case 14; Q24 |
| 5 | Checklist item 6 has no running agent to quit under (completeness) | Accepted | T14 item 6 |
| 6 | `failing-tests.mjs` ignores vitest's exit code, so a leaked rejection passes every gate (validation) | Accepted | `$E4/failing-tests.mjs` and its self-test; Section 5 rule 1; T6 |
| 7 | The identity check compares each fix with the phase run only, so a later fix can delete an earlier fix's test (validation) | Accepted | `$E4/check-identities.mjs` self-tests; P15 |
| 8 | The smoke never checks the agent's result in TaskOutput's answer (validation) | Accepted | Step 05-result and its negative control (Appendix A) |
| 9 | Task files follow a symlinked `.pi` or `.pi/tasks` (safety) | Ruled R15 (D52) | T1 case 17; Q25 |
| 10 | Two processes resuming one session overwrite each other's task file; the plan's reason for dropping the lock was wrong (safety) | Ruled R16 (D53) | T1 case 18; Q26; P2 |
| 11 | The backup commands can overwrite a backup on a repeat (safety) | Accepted | `test ! -e` guards in C1 to C3, tested in bash and zsh (Appendix A); P18 |
| 12 | RB3 deletes the build without checking the sessions that run it (safety) | Accepted | The rollback's RB3 preflight reruns the process lists (P19) |

Sections changed: 1, 2.1 (R14 to R16, P2, P3, P12, P15, P18, P20, P22), 2.3, 2.4, 3, 4, 5, 6 (shared rules, T1 to T6, T8, T11 to T15, T16 removed, the rollback), 7, 8, 9, 10, Appendix A, Appendix B. Changes made after this pass and not yet reviewed: the sections just named.

### Pass 2: 2026-09-29, reviewer model openai-codex/gpt-6-astra (re-review)

| Angle | Verdict |
| --- | --- |
| traceability | FAIL |
| assumptions | FAIL |
| completeness | PASS |
| feasibility | FAIL |
| validation | PASS_WITH_FINDINGS |
| safety | PASS_WITH_FINDINGS |

Every pass 1 disposition held. New findings:

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | T1 case 7 and old case 341 expected a deleted file to come back, which D53 refuses (blocking; traceability, feasibility) | Accepted: old case 341 is dropped under D53; case 7 no longer recreates, case 18 names deletion | `pi-tasks/test/task-store.test.ts:464-473` at `83480bd`; D53 |
| 2 | The symlink check's `lstatSync` threw `ENOTDIR` or `EACCES` out of the store instead of falling back (blocking; assumptions; validation) | Accepted | Reviewer's reproduction; the check now falls back (Q27); the tests pass the project root |
| 3 | Unsaved sessions in one workspace shared one handoff key (assumptions) | Accepted | `agent-session-runtime.ts:339-353`: an unsaved fork reuses the parent's session manager; P3; Q28 |
| 4 | T9 still checked 16 T1 cases (traceability; validation) | Accepted | T9 uses 18 |
| 5 | A later fix could delete an earlier fix's whole test file unnoticed (validation) | Accepted | `$E4/check-identities.mjs` checks every reported file on disk; self-test in Appendix A |
| 6 | RB3's delete loop could fail midway and still extract and report success (safety) | Accepted | RB3 stops on a failed deletion, and its verification compares the full file list; rehearsed in bash and zsh (Appendix A) |

Sections changed: 2.1 (P3, P13, P15), 2.3, 3, 6 (T1, T2, T9, the rollback's RB3 and its steps as code blocks), 7, Appendix A, Appendix B, and `$E4/old-cases.md`. Changes made after this pass and not yet reviewed: the sections just named. The probe code, the per-task patches, the mutations and the smoke reran on the final state (Appendix A).

### Pass 3: 2026-09-29, reviewer model openai-codex/gpt-6-astra (re-review)

| Angle | Verdict |
| --- | --- |
| traceability | PASS_WITH_FINDINGS |
| assumptions | PASS_WITH_FINDINGS |
| completeness | PASS_WITH_FINDINGS |
| feasibility | PASS |
| validation | PASS_WITH_FINDINGS |
| safety | PASS_WITH_FINDINGS |

Every pass 2 disposition held. New findings, none blocking:

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | Old case 446 mapped pi-tasks' removal of a value equal to the global one to T4 case 8, which keeps it (traceability) | Accepted: dropped under D48 and declared in Section 2.3 | `pi-tasks/src/tasks-config.ts:58-66` at `83480bd`; phase 2 P17 |
| 2 | A symlink check that could not run counted as a refusal, so `/reload` never retried it (assumptions) | Accepted | Reviewer's reproduction; the check now fails like a write; test and Q29 |
| 3 | An RB3 that stops midway left `Build` without a state, readable as `native` or `pre-cutover` (completeness, safety) | Accepted | `$R/rb3-started` and `$R/rb3-verified` define `partial`; rerun rehearsed after a later-directory and an extraction failure (Appendix A) |
| 4 | T6 ignored `./test.sh`'s exit, so a package whose runner never started passed every check (validation) | Accepted | T6 keeps the exit and compares each package's completion line with the baseline |

Sections changed: 2.1 (P12), 2.3, 3, 6 (T1, T6, the rollback's State table, RB3 and Stopping states), 7, Appendix A, Appendix B, and `$E4/old-cases.md`. Changes made after this pass and not yet reviewed: the sections just named. Each change follows a verified finding; the probe code, the per-task split, the 29 mutations and the smoke reran on the final state.

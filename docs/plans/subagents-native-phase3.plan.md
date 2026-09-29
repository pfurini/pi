# Native subagents, phase 3: agent mentions and the cutover

This plan adds agent mentions to the native subagents: the `@handle message` input hook, the `@` autocomplete rows and the conversation clone of `agentMentions: model`. It points `docs/skills.md` at the native built-in (F16). A scripted TUI smoke then gates the cutover: `personal` fast-forwards to the branch, the pi-subagents entry leaves `~/.pi/agent/settings.json`, and the main checkout's `dist` is rebuilt. Each cutover step needs Paolo's yes. The sources are the session-control handoff (D16 to D45) and the phase 1 and 2 plans and results. A probe proved the design, the smoke and the cutover commands. Phase 4 follows.

## 1. Authority and workflow

| Source | Role |
| --- | --- |
| This plan | The implementation contract. It overrides the source where Section 2 or Section 4 names a difference. |
| `/Users/paolof/Developer/ai/_handoffs/2026-09-26-pi-session-control-consolidated.md` | The source and sole authority for rulings. Section 7 holds D16 to D45; section 14 holds the port's facts. Record any new ruling there as a dated row from D46, only after Paolo's yes. |
| `docs/plans/subagents-native-phase2.plan.md` | Phase 2's contract. Its Section 2.1 defaults stay in force unless Section 2.3 here names a change. Its Section 10 row 3, amended by D43, is this phase's scope. |
| `docs/plans/subagents-native-phase2.results.md` | Phase 2's deviations, its open items and the deferred findings F10, F11, F13 and F14. |
| `docs/plans/subagents-native-phase1.plan.md`, `.results.md` | Phase 1's Section 10 and finding F16. |
| `packages/coding-agent/src/core/fork-builtins/subagents/README.md` | The module as phase 2 left it. T6 extends it. |
| `/Users/paolof/Developer/ai/pi-subagents` at `79a7c42` | The behavior reference: `src/mention.ts`, `src/mention-clone.ts`, `src/ui/agent-mention.ts`, `src/index.ts:1040-1270` and `src/agent-manager.ts:1372-1410`. Read it to learn a behavior; never copy a file wholesale (D16). |
| `docs/plans/subagents-native-phase3-evidence/old-cases.md` | Every case of the six old mention test files, with the numbered case of this plan that covers it, or a deliberate drop (R5, P13). |
| `docs/plans/subagents-native-phase3-evidence/` | The probe patch and its mutation spec, the old-case inventory with its extractor, the identity check, the TUI smoke with its faux provider, and the settings helper of C3 and RB3 (Appendix A, Appendix B). |
| `docs/plans/subagents-native-phase2-evidence/` | The mutation runner `mutate.mjs`, the case checker `check-cases.mjs` and the SDK probe `sdk-probe.mjs`, reused unchanged. |
| `docs/adr/ADR-0003-fork-first-merge-hygiene.md` | New code in new files; hot upstream files get thin call sites only. |
| `docs/adr/ADR-0008-skill-bundled-agents-scoping.md` | Skill-bundled agents stay hidden from `@` autocomplete. |
| `docs/adr/ADR-0009-built-in-extensions.md` | Built-in kinds and the upstream footprint. T6 amends it. |
| `AGENTS.md` (repository) and `~/.pi/agent/AGENTS.md` | Git, lockfile, check and test rules; the durable-prose register; cmux instead of tmux. |

The `planning-changes` skill wrote this plan and ran its review passes (Review history). A fresh session implements it from a handoff prompt, on `feat/subagents-native` in `/tmp/subagents-native`, running Pi unfenced.

## 2. Decisions

### 2.1 User rulings

Paolo made every ruling below; the handoff's section 7 records each D-row.

| # | Ruling | Consequence |
| --- | --- | --- |
| R1 (D16, D17) | Agent mentions are kept and rebuilt natively. | T1 to T5. No code is copied from pi-subagents. |
| R2 (D18) | The mention input hook lives in the presentation factory. The service imports no presentation code. | T4 and T5 add `ui/mentions.ts`; the layering test keeps `ui/` above `service/` and `tools/`. |
| R3 (D19) | In-process consumers call the service's typed API; the `subagents:*` names and payloads stay unchanged. | Every mention spawn, steer, resume and reopen calls `SubagentService`. No bus event is added or changed. |
| R4 (D23) | `personal` receives the phases in one fast-forward after this phase, together with the removal of the pi-subagents settings entry. No coexistence code exists. | T12 to T15. The cutover record (T17) stays on the branch until phase 4's fast-forward. |
| R5 (D24) | Tests are new; old tests are a behavior checklist. | Every case of the six old files has a status in `$E3/old-cases.md` (P13). |
| R6 (D25, D26) | `agent-session.ts` carries exactly two added lines. | No task edits `agent-session.ts`, `interactive-mode.ts` or `keybindings.ts`. |
| R7 (D27; kept by Paolo) | One `code-reviewer` agent reviews each commit; the `super-code-review` skill reviews the phase. Paolo approves which phase findings are applied. | The review gate in Section 6; T8. |
| R8 (D36) | Runs stay minimal: each code task runs `npm run check`, its test files and one mutation per new behavior. The phase runs the full coding-agent suite and `./test.sh` once. Three known flakes are ignored everywhere. | Section 5's regression rule; T7. |
| R9 (D43) | The cutover does not wait for the workflow workers' exclusion of `Agent`, `get_subagent_result` and `steer_subagent`. The workflow work adds it before it resumes. | No task touches the workflow worktree or OpenIntent. T10 lists the exclusion as an open action for the workflow work. |
| R10 (D44, 2026-09-29) | A mention acts only in the interactive TUI. Print, JSON and RPC prompts pass to the main model unchanged. | The factory builds the mention environment in `tui` mode only (P3). Old case 73 is dropped. |
| R11 (D45, 2026-09-29) | A scripted TUI smoke with an isolated home and a faux provider gates the first cutover step. After the last step, Paolo runs a checklist in a real session; a failure starts the gated rollback. | T9 runs `$E3/run-smoke.sh`; T16 is Paolo's checklist; Section 6 "Cutover rollback". |
| R12 (planning request, 2026-09-29) | The main checkout, `personal` and `~/.pi/agent/` stay read-only until a gated cutover step. Each cutover step needs Paolo's explicit yes. Never touch `/tmp/ask-user-question-base-tool`, pi-subagents, pi-tasks, OpenIntent or the workflow worktree. | Section 2.4; T11 to T15 and the rollback each ask first and record the answer (P18). |
| R13 (D20) | Subagent settings live under `forkBuiltins.subagents`. | `agentMentions` (`model`, `direct`, `off`; default `model`) already exists with its `/agents` row; this phase reads it and adds no setting. |

**Planner defaults.** Each is reversible; the reason stands next to it.

| # | Item | Default | Reason |
| --- | --- | --- | --- |
| P1 | Module layout | `service/mentions.ts` holds the grammar: `MENTION_TRIGGER`, `parseMention`, `resolveHandleToType`, `stripAgentPrefix`, `describeMention` and `agentMentionReminder`. `service/records.ts` exports `isReservedHandle`. `SubagentService` gains `resolveMention`, `dropTombstone` and `reopen`. `tools/mention-clone.ts` holds the clone. `ui/mentions.ts` holds the roster, the autocomplete provider and the input handler; `ui/index.ts` wires them. | The grammar and the reopen are headless service logic. The clone calls a model and forwards `Agent` arguments, as a tool does. The hook and the popup are presentation (R2). The probe's layering test passed with this layout (Appendix A). |
| P2 | Routing | A running or queued agent is steered. A finished agent whose child session exists is resumed in the background. An evicted agent reopens from its tombstone. A finished agent that never reached a session starts afresh when no tombstone holds its name. Otherwise a listed agent type whose handle the text names starts. `@main` drops its prefix and goes to the main model. `@agent-<x>` resolves `<x>` when the handle as typed resolves nothing. Anything else passes to the main model. | pi-subagents `src/index.ts:1075-1265`; the handle names the agent across its life. |
| P3 | Where mentions act (R10) | The factory builds the mention environment and registers the popup only at a `tui` `session_start`. The input handler passes every prompt on while no environment exists, and passes on any prompt with `source: "extension"`. | Print mode binds nothing (`ui/index.ts:120`), and RPC gets the status line only (phase 2 P7). Probe mutation Q9 proves the RPC case (Appendix A). |
| P4 | The hook never waits | The handler returns `handled` at once and reports each outcome later through `ctx.ui.notify`. It never awaits a steer, a spawn, a worktree or the clone. Each action has one rejection path that covers its spawn and its worktree start, so every failure becomes one notification and none an unhandled rejection. After the session ends, no notification is sent. | A steer awaits the child's `input` handlers (`service/service.ts:907-930`), and phase 2's T18-F3 showed a hung handler can block the parent. The prompt path awaits the input handlers (`agent-session.ts:2402-2420`). |
| P5 | Spawn mode | Every mention start and reopen spawns `mode: "detached-background"`: it takes a background slot, notifies on completion and joins no batch. A resume through a mention uses `resume(..., { background: true })`. | pi-subagents started mentions detached with `isBackground: true` (`src/index.ts:1173-1177`, `:1261-1264`). The native modes are in `service/records.ts:15-27`. |
| P6 | The clone (`agentMentions: model`) | One `session.modelRuntime.streamSimple` request: the conversation from `sessionManager.buildSessionProjection()` through `convertToLlm`, one system message that leaves `Agent` as the only declared tool, then the user's message and Claude Code's reminder. It uses the session's model, thinking level (no `reasoning` at `off`) and session id, and the factory's abort signal; it checks that signal again before it spawns, because a provider may answer after an abort. The first `Agent` call counts. Its arguments pass `prepareArguments` and `validateToolArguments`. The spawn keeps the mentioned type and takes the call's `prompt`, `description`, `name`, `model`, `thinking`, `max_turns`, `inherit_context`, `isolated` and `isolation`; `resume` and `run_in_background` are ignored. | pi-subagents `src/mention-clone.ts`. The mentioned type is what the user chose. A spawn through the service keeps the notification that `Agent.execute` with an agent file's `run_in_background: false` would lose (Section 2.3). |
| P7 | Clone failures | A clone that ends without starting an agent returns `ok: false` and never rejects. The hook then starts the agent directly and warns `Started @<handle> directly: <reason>`. A start whose worktree then fails reports `Could not start @<handle>: <error>` once and starts nothing else. | pi-subagents `src/index.ts:1230-1250`. A second direct spawn would fail on the same worktree. |
| P8 | Hidden and disabled agents | A mention starts listed types only: enabled and not hidden (`listedAgents`, `definitions/registry.ts:126`). The popup lists no skill-bundled agent: no startable type, no running or finished record whose definition is hidden, and no tombstone whose type the registry marks hidden. A disabled agent is excluded only as a startable type; its existing record or tombstone still lists, as in pi-subagents, and a reopen of a disabled type fails with its reason (P12). The hook still reaches an existing agent by its exact handle, as `steer_subagent` and `get_subagent_result` do. | ADR-0008: skill-bundled agents are hidden from `@` autocomplete and spawnable by name. pi-subagents filtered only startable types (`src/agent-types.ts:237-241`, `src/ui/agent-mention.ts` `mentionRoster`); review pass 1 reproduced a running skill agent in the probe's roster. |
| P9 | Registry freshness | At a `tui` `session_start`, the factory calls `service.refreshDefinitions()`; a throw becomes a service warning. The popup and the hook read the cached registry, so a keystroke reads no file. Every spawn refreshes it again. | The service starts with an empty user-agent registry (phase 2 Section 3). Probe mutation Q12 (Appendix A). |
| P10 | Popup registration | `ctx.ui.addAutocompleteProvider` runs once per factory activation, at the first `tui` `session_start`. | Interactive mode drops every wrapper in `resetExtensionUI` (`interactive-mode.ts:2385-2404`), which runs before `/reload` (`:6426`) and before a session is replaced (`:594-596`). Both reload the factory. |
| P11 | Unbinding order | `session_start` assigns `unbind` before the mention wiring, so a throw there still leaves the widget, FleetView and status to unbind. | Probe finding 2 and mutation Q13 (Appendix A). |
| P12 | Reopen | `reopen(tombstone, prompt)` accepts only the tombstone's exact type as an enabled agent, with no fallback; otherwise it throws `The <type> agent is no longer available.`, and the tombstone stays. The new record takes back the tombstone's handle, alias and description, and its first run opens the tombstone's session file. `resolveMention` prefers, in order: a running or queued agent by the name; the newest one by the name with a child session; the tombstone; a record whose run failed before its session existed. A reopen that fails to start therefore leaves the tombstone reachable, and the retry reopens the same conversation. A tombstone whose session file is gone is dropped with a warning. | pi-subagents `src/index.ts:1134-1195`, `src/agent-manager.ts:1372-1410`. The runner already reopens a session file (`runner/run.ts:66-67`, `:184-185`). |
| P13 | Old-case inventory | `$E3/old-cases.md` gives each of the 164 cases a status: a numbered case `T<n>.<k>`, or `Dropped: <reason>`. Tasks T1 to T5 fill the covering tests of their rows in the commit that adds them. `$E2/check-cases.mjs coverage` checks every row. | Phase 2 P25; `extract-old-cases.mjs` parsed the six files with the TypeScript compiler (Appendix A). |
| P14 | Dropped old cases | Old case 43 (a mention un-consumes a running agent's result): the native service never marks a running record consumed, because `consume` refuses it (`service/service.ts:893-898`). Old case 73 (a headless model-mode start): R10. | Section 2.3. |
| P15 | Mutation records | As phase 2 P28, with `$E2/mutate.mjs` and `$E2/check-cases.mjs`. T10 copies the specs and records to `$E3/mutations/`. | Phase 2's runner and checker work unchanged (Appendix A). |
| P16 | Identity check | `$E3/check-identities.mjs` is phase 2's check with the fix reports renamed `T7-R<n>-<k>.json` and `T8-F<n>-<k>.json`. It also checks each fix's last report: every phase-run test of a file the report ran must still run there, and be skipped no more often; a file that failed to load fails the check. A suite that fails while its tests pass (an import error, a failing hook) also fails the check. A fix may rename only a test this phase added, never a baseline test: it adds `<old identity>\t<new identity>` to `$R/renamed.txt`. When the renamed test covers an inventory row, the fix also updates that `$E3/old-cases.md` row and reruns its task's mutation spec with the new identity in `expect`, replacing `$R/mutations/T<n>.json` and `T<n>.txt`, so the coverage check finds the new identity among the caught tests. | Phase 2's copy hardcodes its own task numbers (`T17-R`, `T18-F`). Review passes 1 to 3: a fix could delete, skip, rename or break the loading of an existing test after the phase run, and a renamed covering test left the coverage check unsatisfiable. The self-tests are in Appendix A. |
| P17 | Test file lists and fixtures | Phase 2 P23, P24 and P32 hold. A mention test's fake UI context has `addAutocompleteProvider` as an own method. Phase 2's fake contexts stay unchanged. | Mutation Q13 relies on phase 2's fakes, which lack the method. |
| P18 | Recorded approvals | Phase 2 P30 holds. Each cutover and rollback step first asks Paolo with `ask_user_question`, quoting the exact command. `$R/approvals.md` then gets one line `<step>: <date>, <Paolo's words>` before the command runs. | R12. |
| P19 | TUI smoke tool | `$E3/run-smoke.sh` drives the built CLI in a background cmux surface (`cmux new-surface --focus false`), reads the screen with `cmux read-screen` and closes the surface. It first checks a print-mode mention over stdin. | tmux is not installed; `~/.pi/agent/AGENTS.md` names cmux. The CLI reads an argument that starts with `@` as a file (`cli/args.ts:235`), so the print check pipes the prompt. |
| P20 | Cutover backups and edits | C1 hashes the six untracked phase 1 paths, then moves them to `$R/cutover-backup/`, keeping their relative paths. C3 and its rollback edit the one `packages` entry through `$E3/settings-entry.mjs`, under the lock Pi takes; neither copies a whole file over `LIVE`. C3 keeps a copy `$R/settings.json.pre-cutover` for the record. Before C4, `$R/dist-pre-cutover.tar` holds every `dist` directory of the main checkout, with a SHA-256 manifest. Each backup refuses an existing destination. | The template's backup rule. The six paths equal committed files (Section 3). Review pass 1: Pi rewrites the global file whenever a session changes a setting, such as the model, so a whole-file restore could drop Paolo's later change; and a failed rebuild must not be the only way back to a working CLI. |
| P21 | Rebuild timing | Before C4, `pgrep -fl 'Developer/ai/pi/packages/coding-agent/dist/cli.js'` lists the Pi processes that run from the main checkout. Paolo closes them or accepts the risk; the implementing session is one of them and ends after T17. | A running session may lazy-load a rebuilt module (Section 8). Handoff 14.5: a session keeps the old code until it restarts. |
| P22 | Cutover record | T17 writes the results file's `## Cutover` section and commits it on `feat/subagents-native`. `personal` receives that commit with phase 4's fast-forward, not a second one. With Paolo's yes, T17 also updates the handoff's sections 14.1 and 14.5, which still describe pi-subagents as loaded. | R4 allows one fast-forward for this phase. |
| P23 | Known limitations | A clone still waiting for its reply at `/reload` or at the session's end is aborted, and no agent starts (T4 case 13). The CLI cannot send a mention as an argument (P19). | The factory's context is invalid after `/reload` (phase 2 P5). T6 documents both. |
| P24 | State directory | `$R` holds six read-only files (`chmod a-w`): `personal.ref`, `main-packages.status`, `main-status.pre-cutover`, `live-settings.sha256`, `base-1.json` and `base-testsh.log`. The planning session wrote them. Every run output goes to a new path in `$R`. | Phase 2 P31; `main-status.pre-cutover` feeds T11's check. |

### 2.2 Source questions

| # | Status | Answer used |
| --- | --- | --- |
| F16 (phase 1) and F10 (phase 2): the skill docs name pi-subagents | Adopted recommendation: the user docs change with the cutover | T6. |
| Phase 2 F11 (viewer render caching), F13 (splitting the service), F14 (a shared settings schema) | Adopted: they stay deferred, since no phase 3 change needs them | No task. The results file keeps them open. |
| The worker exclusion (phase 1 and 2 Section 10) | Resolved by R9 | T10 records it as the workflow work's open action. |
| "The engine amendment" (phase 1 Section 2.2, phase 2 Section 10) | Resolved by R9: the workflow work owns it | No task. |
| A live TUI check before the cutover (D39) | Resolved by R11 | T9 and T16. |
| Where headless mentions act | Resolved by R10 | P3. |
| The print-mode hold (phase 2 P26) | Stays unassigned | No task; R10 removes the case that needed it. |
| Handoff 12.1: graceful cancel | Deferred beyond phase 4 | No task. |

### 2.3 Differences from the source

| Source item | This plan | Reason |
| --- | --- | --- |
| pi-subagents' `model` mode started an agent through the clone in every mode | TUI only | R10 (D44). |
| pi-subagents' clone called the registered `Agent` tool, with the model's `subagent_type` | The clone spawns the mentioned type through the service, detached in the background | P6. R3 asks for the typed API. |
| pi-subagents' hook awaited a startup and a reopen before it returned | The hook never waits | P4. |
| pi-subagents un-consumed a running agent's result on a mention steer | Dropped | P14. |
| pi-subagents' popup listed a running or evicted skill-bundled agent | The popup lists none; the exact handle still works. Disabled agents keep pi-subagents' behavior. | P8; ADR-0008. |
| pi-subagents' `resolveMention` preferred any record by the name over its tombstone | A record whose run failed before its session existed yields to the tombstone | P12; old case 101. |
| pi-subagents warned about a failing inner autocomplete provider on `console.warn` | A service warning, once per distinct text | The service already deduplicates warnings (`service/service.ts`, `warn`). |
| pi-subagents' notices used an em dash (`Could not resume @x — …`) | A colon (`Could not resume @x: …`) | `~/.pi/agent/AGENTS.md` forbids em dashes for interruptions. |
| Phase 1 and 2 Section 10: the cutover waits for a verified worker exclusion | No wait | R9 (D43). |
| D39: the first live TUI use comes with the cutover | A scripted smoke comes first | R11 (D45). |
| Phase 2 R6: "`personal` receives them only after phase 3" | It receives phases 1 to 3 in T13; the cutover record follows with phase 4 | P22. |

### 2.4 Approvals

Standing approval, inside `/tmp/subagents-native` only: `npm install --ignore-scripts`, `npm run build:offline`, `npm run check`, `./test.sh`, single test files through `failing-tests.mjs`, mutation runs through `$E2/mutate.mjs`, `git hook run pre-commit`, the per-task commits of Section 6, one `code-reviewer` agent per commit, and the fallback baseline worktree of Section 5 step 3. Also standing: T9's `$E3/run-smoke.sh` runs, which open and close their own background cmux surfaces and write only under their output directory in `$R`, `TMPDIR` included.

These actions always need Paolo's explicit yes, recorded per P18:
- any edit, move, install, build or commit in the main checkout, including C1 and C4;
- any change to `personal`, including C2's fast-forward and any rollback;
- any edit of `~/.pi/agent/settings.json` or other live configuration, including C3;
- any edit of the handoff beyond a new ruling Paolo made (T17);
- a `package-lock.json` change (none is expected);
- any change to `agent-session.ts` or another upstream-owned line, which also needs a ruling;
- applying any `super-code-review` finding in T8;
- removing any worktree, branch or backup directory.

## 3. Verified facts

The probe ran on 2026-09-29 in `/tmp/sn3-probe`, a detached worktree at BASE `af021d3cc5e1d444145ff4d061e08dc68f491cfa`. The baselines ran in the clean `/tmp/subagents-native` at the same commit. Coding-agent ran through `failing-tests.mjs` under `./test.sh` isolation, one run at a time. Under R8 the baseline ran once. Line numbers refer to BASE.

| Fact | Evidence |
| --- | --- |
| Handles, aliases and the reserved `main` exist; `assignHandle` skips live and tombstone names. | `service/records.ts:148`, `:162-166`; `service/service.ts:519-530` |
| The service finds an agent by id, handle or alias among its own agents only. | `service/service.ts:792-801` |
| `consume` refuses a running agent, so a running record's result is never consumed. | `service/service.ts:893-898` |
| A steer awaits the child's `session.steer`, which awaits its `input` handlers. | `service/service.ts:907-930`; phase 2 results T18-F3 |
| Tombstones hold handle, alias, id, type, description and session file; the store has no delete. | `service/retention.ts:14-49`, `:63-81` |
| The runner reopens a session file when a request names one; the service never names one. | `runner/run.ts:66-67`, `:184-185`; `service/service.ts:663-689` |
| `agentMentions` exists with default `model`, and the settings menu shows its row. | `settings/settings.ts:40`, `:71`, `:97`; `ui/settings-menu.ts:185`, `:348` |
| `listedAgents` returns enabled, unhidden agents; `findEnabledAgent` matches exactly one enabled agent. | `definitions/registry.ts:126-128`, `:146-151` |
| The factory binds only in `tui` and `rpc` mode, and its `session_start` assigns `unbind` last. | `ui/index.ts:117-136` |
| An `input` handler sees text, images, source and mode, and returns `continue`, `transform` or `handled`. | `extensions/types.ts:1012-1031`; `agent-session.ts:2402-2420` |
| Interactive mode keeps autocomplete wrappers until `resetExtensionUI`, which runs before `/reload` and a session replacement. RPC and headless contexts ignore the call. | `interactive-mode.ts:2592-2595`, `:2385-2404`, `:594-596`, `:6426`; `rpc-mode.ts:283`; `extensions/runner.ts:343` |
| The clone's inputs exist: `convertToLlm`, `getCurrentTools`, `validateToolArguments`, `ModelRuntime.streamSimple`, `getToolDefinition`, and the session's `model`, `thinkingLevel` and `sessionId`. | `core/messages.ts:156`; `ai/src/utils/transcript.ts:58`; `ai/src/utils/validation.ts:317`; `model-runtime.ts:656`; `agent-session.ts:2033`, `:1965`, `:1970`, `:2087` |
| The CLI reads an argument that starts with `@` as a file to attach. | `cli/args.ts:235`; the probe's first print check failed with `File not found` (Appendix A) |
| The six old mention files hold 164 cases. | `$E3/extract-old-cases.mjs`; `check-cases.mjs inventory` reports 164 rows (Appendix A) |
| The probe passes `npm run check`; its final full coding-agent run fails nothing; all 18 probe mutations are caught. | Appendix A |
| Phase 2's SDK probe passes unchanged on the probe's `dist`, run from the worktree that built it. | Appendix A |
| The TUI smoke passes on the probe's `dist` in `direct` and `model` mode, writes only under its output directory, and fails step 05 when the viewer cannot open. The live settings keep their hash. | `$E3/run-smoke.sh`; negative control (Appendix A) |
| `personal` is `83af84af2`, an ancestor of BASE. The main checkout is on `personal` with six untracked files under `docs/plans/`. | `git -C $M rev-parse personal`; `git -C $M merge-base --is-ancestor personal feat/subagents-native`; `$R/main-status.pre-cutover` |
| The six untracked paths equal committed files: the plan equals `ea2e39c01`'s, the five evidence files equal BASE's. | `cmp` against `git show` (Appendix A) |
| All six untracked paths block `merge --ff-only`; moved away, the fast-forward succeeds and lands on BASE. | Probe on a `--shared` clone of the main checkout (Appendix A) |
| `git reset --keep 83af84af2` undoes the fast-forward and keeps an unrelated untracked file. | Same clone (Appendix A) |
| No dependency, lockfile or shrinkwrap changed between `personal` and BASE. | `git diff --stat 83af84af2 af021d3cc -- package-lock.json '**/package.json' packages/coding-agent/npm-shrinkwrap.json` prints nothing |
| The live settings load pi-subagents from line 25; `jq -j` removes exactly that line and keeps the file's missing final newline. | `grep -n pi-subagents ~/.pi/agent/settings.json`; `diff` of a copy (Appendix A) |
| pi-fence runs the main checkout's `packages/coding-agent/dist/cli.js`. | `~/.pi-fence/entry.json` `piEntry` |
| Pi writes the global settings file under a `proper-lockfile` lock (`realpath: false`), merges only the fields a session changed, and writes `JSON.stringify(settings, null, 2)`. The live file is in exactly that format. | `settings-manager.ts:292-345`, `:687-716`; `node -e` comparison (Appendix A) |
| `$E3/settings-entry.mjs` removes the entry with the same one-line diff as `jq -j`, restores it byte for byte, keeps the file's mode, refuses a missing or duplicate entry and a symlink, waits for a lock another process holds, saves the text it read and wrote while it holds the lock, and leaves the file byte-identical when its write fails. | Appendix A |
| The main checkout's `dist` directories total about 50 MB. A tar snapshot and a SHA-256 manifest restore them exactly and remove files a later build added. | `du -sh`; rehearsal on the probe worktree (Appendix A) |
| `dist/` is ignored in the main checkout. | `.gitignore:8` (`packages/*/dist/`) |
| `~/.pi/agent/subagents.json` holds only `workflowsEnabled: false`; no project `.pi/subagents.json` exists in the main checkout. | `cat`; `ls $M/.pi` |
| The live and project agent files use `persistSession`, and some `thinkingLevel`. Both loaders ignore these keys; the native loader records a warning that no surface shows. | `~/.pi/agent/agents/*.md`, `.pi/agents/*.md`; handoff 14.6 "Frontmatter keys"; `definitions/load.ts:114-119` |
| tmux is absent; cmux is present and `CMUX_SOCKET_PATH` is set in Paolo's terminal. | `command -v tmux` prints nothing; `command -v cmux` |
| The coding-agent baseline has 443 files and 5,143 tests: 5,092 passed, 1 failed (the known `exec.test.ts` flake), 50 pending. `./test.sh` ran 12 packages and failed only the same flake. | `$R/base-1.json`; `$R/base-testsh.log` |

Claims not yet verified, each with the task that verifies it:
- the grammar and resolution cases beyond the probe's tests (T1);
- the reopen's refusal, alias and description cases (T2);
- the clone's request shape per old case, and its failure paths (T3);
- the hook cases beyond the probe's tests, and the aborted clone (T4);
- the popup against Pi's real `CombinedAutocompleteProvider` (T5);
- the cutover commands in the main checkout and the live settings (T12 to T15), and Paolo's live session (T16).

## 4. Scope

**In scope.**
- Mention grammar and handle resolution: T1.
- Reopening an evicted agent: T2.
- The conversation clone: T3.
- The input hook and its wiring: T4.
- The `@` autocomplete rows: T5.
- The README, F16, the ADR-0009 amendment and the full inventory check: T6.
- The phase runs (T7), the phase review (T8), the built outputs and the TUI smoke (T9), and the results (T10).
- The cutover: pre-checks (T11), clearing the untracked paths (T12), the fast-forward (T13), the settings entry (T14), the rebuild (T15), Paolo's checklist (T16), and the record (T17).

**Out of scope.** pi-tasks on the typed service (phase 4). The worker exclusion and every workflow or OpenIntent change (R9). Phase 2's deferred F11, F13 and F14. The print-mode hold. Graceful cancel. Fixing the agent files' unknown keys in `~/.pi/agent/agents/` or `.pi/agents/` (Section 10). Changelog entries: AGENTS.md allows none off `main`.

**Binding constraints.**

| Constraint | Exception in this plan |
| --- | --- |
| Upstream-owned files get thin call sites only (ADR-0003). | None: `agent-session.ts`, `interactive-mode.ts` and `core/keybindings.ts` stay unchanged against BASE. |
| No new runtime dependency and no `package-lock.json` change. | None. |
| The main checkout, `personal` and `~/.pi/agent/` stay read-only. | T12 to T15 and the rollback, each after Paolo's yes (R12). |
| Never touch paths this plan did not create. `/tmp/ask-user-question-base-tool` belongs to another session. Do not edit OpenIntent, the workflow worktree, pi-tasks or pi-subagents. | None. |
| AGENTS.md git rules: explicit paths only; no `reset --hard`, `checkout .`, `clean`, `stash`, `add -A`, `--no-verify`. | None. The rollback uses `reset --keep`, which refuses to discard local changes. |
| `vitest.config.ts` keeps `PI_FORK_BUILTINS=off`. | None. |
| The `subagents:*` event names and payloads stay unchanged (R3). | None. |
| No existing test is removed or renamed (phase 2 P29). | A review or repair fix may rename a test this phase added, recorded per P16. |
| Only `$E2/mutate.mjs` mutates source files (P15). | None. |

## 5. Working setup

Every command runs from `/tmp/subagents-native` unless it names another directory. Shorthands:

| Name | Value |
| --- | --- |
| `M` | `/Users/paolof/Developer/ai/pi` (the main checkout) |
| `E` | `docs/plans/subagents-native-phase1-evidence` |
| `E2` | `docs/plans/subagents-native-phase2-evidence` |
| `E3` | `docs/plans/subagents-native-phase3-evidence` |
| `S` | `$E/failing-tests.mjs` |
| `I` | `$E3/check-identities.mjs` |
| `R` | `/tmp/sn3-impl` |
| `SUB` | `packages/coding-agent/src/core/fork-builtins/subagents` |
| `BASE` | `af021d3cc5e1d444145ff4d061e08dc68f491cfa` |
| `LIVE` | `/Users/paolof/.pi/agent/settings.json` |

1. `git rev-parse --abbrev-ref HEAD` prints `feat/subagents-native`. `git merge-base --is-ancestor $BASE HEAD` exits 0. `git log --reverse --format=%s $BASE..HEAD | head -1` prints `docs: native subagents phase 3 plan`, and every other subject in that range starts with `docs: `. `git diff --name-only $BASE HEAD | grep -v -e '^docs/plans/subagents-native-phase3.plan.md$' -e '^docs/plans/subagents-native-phase3-evidence/'` prints nothing. `git status --short` prints nothing. Otherwise stop and ask.
2. `test -x .husky/_/pre-commit` exits 0, and `diff -r $M/packages/ai/src/providers/data packages/ai/src/providers/data` prints nothing. Otherwise stop and ask.
3. `ls -l $R` lists the six files of P24, each read-only. `shasum -a 256 $R/base-1.json $R/base-testsh.log` prints Appendix A's hashes. When a baseline is missing or differs, rebuild both, then use the `-b` files and record the substitution in the results file:
   - `git worktree add --detach /tmp/sn3-base $BASE`; when the path exists, stop and ask;
   - copy the providers data into it, then run `npm install --ignore-scripts` and `npm run build:offline` there;
   - `node $S run /tmp/sn3-base packages/coding-agent $R/base-1b.json`;
   - from `/tmp/sn3-base`, `./test.sh > $R/base-testsh-b.log 2>&1`.
4. The protected state matches: `git -C $M rev-parse personal | diff - $R/personal.ref`, `git -C $M status --porcelain=v1 -- packages | diff - $R/main-packages.status` and `shasum -a 256 -c $R/live-settings.sha256` all succeed. Otherwise stop and ask; another session may have caused it, so never restore anything.
5. `diff -rq $M/.pi/agents .pi/agents` prints nothing, so the review gate dispatches Paolo's current `code-reviewer`. Otherwise stop and ask.
6. `shasum -a 256 $E3/*` prints the hashes of Appendix B.
7. `mkdir $R/mutations` succeeds. Define `tf() { (cd packages/coding-agent && eval "ls -1d $*"); }` in the shell (phase 2 P32); `tf 'test/suite/fork-subagents-*.test.ts' | wc -l` prints a number above 0. `npm run build:offline` exits 0.
8. `command -v cmux` prints a path and `test -S "$CMUX_SOCKET_PATH"` exits 0. Otherwise T9 cannot run its smoke: stop and ask before T9, not before T1.

**Regression rule (R8).**
1. Each code task: `npm run check` exits 0. The test files the task names run as `node $S run /tmp/subagents-native packages/coding-agent $R/<task>-<n>.json $(tf <files>)`, with every pattern quoted, where `n` counts runs from 1. Each report shows 0 failed tests and 0 failed suites (`failing-tests.mjs` prints both counts), and covers every listed file. The mutations follow P15:
   - write `$R/mutations/<task>.json`, one entry per numbered case at least, each targeting the task's own code and listing its concrete test files and `expect` identities;
   - `node $E2/mutate.mjs /tmp/subagents-native $R/mutations/<task>.json $R/mutation-state > $R/mutations/<task>.txt` exits 0;
   - `node $E2/check-cases.mjs mutations $R/mutations/<task>.txt <case count>` exits 0.
2. A mutation that makes a test run past 30 s counts as caught when that test is expected: vitest fails the test (`vitest.config.ts:10`).
3. When `mutate.mjs` exits 2 because an earlier run was interrupted, follow its message: confirm with `pgrep -g <group>` that the recorded process group has exited, run the restore command, confirm `git diff` shows only the task's own changes, and rerun.
4. T7 runs the full coding-agent suite once and `./test.sh` once. A known flake's failure is ignored. Every other failure is a regression to fix (D36), as task `T7-R<n>`, whose reports are named `$R/T7-R<n>-<k>.json`. When the fix would change an upstream-owned file, stop and ask first.
5. A known flake's failure triggers no rerun, no solo run and no question.

Run suites one at a time: suites run in parallel produce load-induced failures.

Known flakes (D36):

| Test | Evidence |
| --- | --- |
| `exec.test.ts` "captures finite inherited descendant output after the shell exits" | D36; it failed in `$R/base-1.json`, `$R/base-testsh.log` and the probe's full runs. |
| Every test in `agent-session-concurrent.test.ts` | D36; handoff 14.5. |
| `footer-data-provider.test.ts` "updates the cached branch when the reftable directory changes" | D36; handoff 14.5. |

Environment facts:
- Other Pi sessions run from the main checkout, so it stays read-only until T12.
- A fenced Pi denies `/tmp`; run the implementing session with `pi --unfenced`.
- The implementing session itself runs from the main checkout's `dist` and loads pi-subagents. Its own `Agent`, `get_subagent_result` and `steer_subagent` tools are the old extension's until it restarts after the cutover.
- Any SDK or CLI run outside the test harness uses an isolated home (T9).
- An SDK probe resolves `@earendil-works/pi-ai` relative to its own path. Run it from the worktree whose `dist` it tests, or the faux API lands in another registry (Appendix A, probe finding 3).
- TokenSave indexes the main checkout at an older commit. Use `read` and `grep` inside `/tmp/subagents-native` instead.
- The session's task tool may create `.pi/tasks/` in the worktree; git ignores it.

## 6. Tasks

Shared rules for every code task:
- Tests turn fork built-ins on with `vi.stubEnv("PI_FORK_BUILTINS", "on")`. Suite tests use `test/suite/harness.ts` and the faux provider, never a real provider. A test that reads a record's child uses `inspectRecord` (phase 2 P33). A test of eviction fakes `setInterval`, `clearInterval` and `Date`, as `fork-subagents-service.test.ts:826-848` does.
- A mention test binds a plain fake UI context with own methods, `addAutocompleteProvider` included, and submits prompts through `harness.session.prompt` (P17). Tests assert visible output: notifications, records, rows and the requests the faux provider received.
- Each task's **Cases** are numbered; the case count feeds `check-cases.mjs mutations`. A case that cites old cases (`old 57`) covers those rows of `$E3/old-cases.md`. Tasks T1 to T5 fill the `Covering tests` of their rows in the same commit, and `node $E2/check-cases.mjs coverage $E3/old-cases.md $R/<task>-<n>.json $R/mutations <task>` exits 0 on the task's last report.
- Code comes from `$E3/probe.patch` where the task names it; Appendix B lists what the patch holds. The probe's test file `test/suite/fork-subagents-mentions.test.ts` is split across T2, T4 and T5 by its describe blocks.
- **Review gate (R7).** It applies to every implementation commit: T1 to T6, each `T7-R<n>` and each `T8-F<n>`. T0, T10 and T17 commit only plan and results files, so they take no review. After validation passes, stage the task's paths explicitly, then dispatch one `code-reviewer` agent on `git diff --cached`. Check each finding against the source. Fix the accepted ones, rerun the task's validation, and restage. Append every finding with its disposition to `$R/reviews.md` under `## <task id>`, one line per finding starting `- `. A disposition is Accepted, Rejected with the disproving source, or Deferred with the date of Paolo's yes. A review with no finding records `- none`. Then commit; the hook runs `npm run check`.
- A commit prints `✅ All pre-commit checks passed!`; when it does not, stop.
- The commit body names the task's test reports and its mutation record.

### T0. Record the plan

The planning session commits this plan and `$E3/` as `docs: native subagents phase 3 plan`. Each later edit of the plan before implementation is its own `docs: ` commit that touches only the plan and `$E3/`; Section 5 step 1 checks the range. `$E3/` holds eight files: `probe.patch`, `probe-mutations.json`, `old-cases.md`, `extract-old-cases.mjs`, `check-identities.mjs`, `run-smoke.sh`, `faux-smoke.ts` and `settings-entry.mjs`.

### T1. Mention grammar and handle resolution

**Changes.**

| File | Change |
| --- | --- |
| `$SUB/service/mentions.ts` | New (`probe.patch`). |
| `$SUB/service/records.ts` | Exports `isReservedHandle` (`probe.patch`). |
| `$SUB/service/retention.ts` | `TombstoneStore.delete(handle)` (`probe.patch`). |
| `$SUB/service/service.ts` | `MentionTarget`, `resolveMention(name)` with the order of P12, and `dropTombstone(handle)` (`probe.patch`). Not yet `reopen`. |
| `test/fork-builtins/subagents/mentions.test.ts` | New: cases 1 to 8. |
| `test/suite/fork-subagents-mentions.test.ts` | New: `describe("handle resolution")` with cases 9 to 11. |

**Cases.**
1. `handleBase` lowercases, keeps hyphens, turns other characters into single hyphens, never returns an empty or untypeable handle, caps at 64 characters without a trailing hyphen, and every output matches `MENTION_TRIGGER` (old 132 to 138).
2. `assignHandle` takes the free base, numbers from 2, counts past every taken form, never returns `main`, and skips a gap rather than reusing a live handle (old 139 to 143).
3. `resolveHandleToType` matches exactly and case-insensitively, finds a type whose slug differs from its name, round-trips every registered type, and refuses `main` (old 144 to 148).
4. `isReservedHandle` recognizes `main` in any casing and nothing else (old 149, 150).
5. `stripAgentPrefix` unwraps `agent-<x>` once, only at the start, and returns nothing for a missing or empty remainder (old 151 to 154).
6. `describeMention` keeps the first line, collapses whitespace, and clips at 40 characters with `…` (old 155 to 157).
7. `parseMention` splits a leading handle and a trimmed message, accepts a newline as the separator, and rejects a bare handle, a file path and a mention after other text (old 158 to 162).
8. `agentMentionReminder` equals Claude Code's string byte for byte, trailing space included, and names its agent (old 163, 164).
9. `resolveMention` finds a top-level agent by handle, alias or id, case-insensitively, never a nested one. A running or queued agent wins over a finished one by the same name, and the newest finished one with a session wins over older ones. It finds a tombstone by handle, alias or id only when no agent with a session or a run holds the name.
10. `steer_subagent` and `get_subagent_result` reach an agent by its handle and by its alias. They report an evicted agent's handle, and an unknown one, as not found (old 103, 106 to 109).
11. `dropTombstone` frees the tombstone's names: the next agent of that type takes the bare handle.

**Validation.** Test files: both new files, `test/fork-builtins/subagents/service.test.ts` and `test/suite/fork-subagents-tools.test.ts`. Mutations with case count 11. `npm run check` exits 0.

**Commit.** `feat(coding-agent): subagent mention grammar and handle resolution`.

### T2. Reopen an evicted agent

**Changes.**

| File | Change |
| --- | --- |
| `$SUB/service/records.ts` | The internal `reopenFrom` field of `SubagentRecord` (`probe.patch`). |
| `$SUB/service/service.ts` | `reopen(entry, prompt)`; `spawnRecord` and `createRecord` take the tombstone; `childRequest` passes `resumeSessionFile: record.reopenFrom` (`probe.patch`; P12). |
| `test/suite/fork-subagents-mentions.test.ts` | `describe("reopen")`: cases 1 to 7, calling `service.reopen` directly. |

**Cases.**
1. The reopened child's first request holds the evicted conversation's user messages, then the new prompt (old 95; probe mutation Q4).
2. The reopened record takes back the tombstone's handle and its alias (old 96, 98; Q5).
3. After a reopen, `resolveMention` returns the live record, not the tombstone (old 97).
4. A tombstone whose type is deleted or disabled makes `reopen` throw `The <type> agent is no longer available.`, creates no record, and keeps the tombstone (old 99).
5. Once the agent is enabled again, the same tombstone reopens (old 100).
6. The reopened record keeps the tombstone's description, not one derived from the prompt (old 102).
7. A reopened run is `detached-background`: it notifies once on completion and joins no batch.

**Validation.** Test files: the mentions suite and `test/suite/fork-subagents-service.test.ts`. Mutations with case count 7; Q4 and Q5 serve cases 1 and 2. `npm run check` exits 0.

**Commit.** `feat(coding-agent): reopen an evicted subagent from its tombstone`.

### T3. The conversation clone

**Changes.**

| File | Change |
| --- | --- |
| `$SUB/tools/mention-clone.ts` | New (`probe.patch`; P6, P7), with the signal check before the spawn. |
| `test/suite/fork-subagents-mention-clone.test.ts` | New: cases 1 to 12, calling `runMentionClone(session, service, type, message, signal)` on a harness session whose faux provider records each request. |

**Cases.**
1. The clone sends exactly one model request (old 112).
2. The request carries the session's projected conversation; after a compaction it holds the summary, not the turns it replaced (old 111, 113).
3. The request's system prompt equals, byte for byte, the one the session sent on its last turn (old 110, 114).
4. `getCurrentTools` of the request names `Agent` alone (old 115; Q6).
5. The request ends with one user message: the typed message, a blank line, then the reminder (old 116).
6. The request uses the session's model and session id, sends the thinking level as `reasoning`, and sends no `reasoning` at `off` (old 117, 118).
7. The session's projection, messages and turn count are unchanged afterwards (old 119).
8. The spawn is the session's own top-level agent: the mentioned type, `detached-background`, no `toolCallId`, and the call's `prompt`, `description` and `name` (old 120, 121; Q7). The call's `model`, `thinking`, `max_turns`, `inherit_context`, `isolated` and `isolation` reach the record's invocation; one mutation drops the forwarded parameters and must fail this case. A call that sets `resume` or `run_in_background: false` still starts a new `detached-background` agent.
9. Only the first `Agent` call of the reply counts (old 122).
10. `prepareArguments` runs before validation (old 123).
11. `ok: false` with a reason, and no agent, for: a reply with no `Agent` call, a provider error, arguments the schema rejects, no selected model, and a thrown error (old 124 to 128).
12. Aborting the signal ends the request with `ok: false`, and no agent starts, even when the provider ignores the abort and answers with an `Agent` call afterwards: the clone checks its signal before it spawns (Q18).

**Validation.** Test files: the new clone suite, `test/fork-builtins/subagents/mention-clone.test.ts` (the probe's fake-provider test, `probe.patch`), and `test/fork-builtins/subagents/layering.test.ts`. Mutations with case count 12. `npm run check` exits 0.

**Commit.** `feat(coding-agent): start a mentioned subagent from a clone of the conversation`.

### T4. The input hook

**Changes.**

| File | Change |
| --- | --- |
| `$SUB/ui/mentions.ts` | New: `MentionEnv`, `handleMentionInput`, the routing and the start path (`probe.patch`; P2 to P5, P7, P8). The roster and the provider follow in T5. |
| `$SUB/ui/index.ts` | The mention environment and its abort controller at a `tui` `session_start`, the definitions refresh (P9), `unbind` assigned first (P11), and `pi.on("input", …)`. Not yet the popup. |
| `test/suite/fork-subagents-mentions.test.ts` | `describe("the input hook")`: cases 1 to 14. |

**Cases.**
1. `direct`: `@worker <text>` starts a `worker` agent with the text as its prompt and `describeMention(text)` as its description, `detached-background`. It notifies `Started @worker` and adds no parent turn. The agent file's model, thinking and `max_turns` apply, and the record shows its turn limit and tool activity. Its completion arrives as the ordinary notification (old 57 to 61, 130; Q1, Q12).
2. A refused start notifies `Could not start @<handle>: <error>`. A start whose worktree fails notifies that error once, with no second agent (old 63, 129).
3. A running or queued agent is steered: `Sent to @<handle>`, one `steered` event, no second agent. A sibling is reached by its numbered handle. A failed steer notifies `Could not send to @<handle>: <reason>` (old 42, 44, 54, 62; Q2).
4. A finished agent resumes in the background with no `toolCallId`: `Resuming @<handle>`. Its answer arrives as the ordinary notification, and an agent file's `output_transcript: false` keeps it without a transcript (old 45 to 48; Q3).
5. An evicted agent reopens with `Resuming @<handle>`. A tombstone whose session file is gone is dropped with `Could not resume @<handle>: its session is gone.`, and the next mention starts afresh. An unavailable type notifies `Could not resume @<handle>: The <type> agent is no longer available.` A reopen whose worktree start rejects notifies `Could not resume @<handle>: <error>` once, never `Resuming`, and raises no unhandled rejection (old 104, 105; Q15).
6. `model`: the hook claims the prompt at once and notifies `Prompting @<handle>…`. The clone receives the resolved type and the message. A failed clone starts the agent directly with `Started @<handle> directly: <reason>`, and a failed fallback notifies `Could not start …`. A steer, a resume and an unknown handle never clone. `direct` never clones. The clone's agent completes through the ordinary notification (old 64 to 72, 75, 76, 131; Q8).
7. An unknown handle, a bare handle, a leading file path and a prompt with `source: "extension"` pass to the main model. In `print`, `json` and `rpc` mode every mention passes on, and a running agent is left alone (old 74, 77 to 82; Q9).
8. `agentMentions: off` passes every mention on, for a running, a finished and a never-started agent (old 83 to 85).
9. `@main <text>` sends `<text>` with its images to the main model. A type that slugs to `main` never starts. A bare `@main` passes on unchanged (old 87 to 90; Q10).
10. `@agent-<type>` starts that type and reaches its running agent. An agent named `agent-<x>` wins over the unwrapped `<x>`. When neither spelling resolves, the prompt passes on (old 91 to 94).
11. Handles match case-insensitively, a raw id reaches its agent, a nested agent is never reached (the mention starts a top-level agent instead), and an evicted agent without a session file starts afresh (old 52, 53, 55, 56).
12. A steer whose child `input` handler never resolves still returns `handled` at once (P4).
13. A clone still waiting for its reply at `/reload`, and one waiting at the session's end, is aborted: once the held reply is released, no agent starts and no notification follows (P23). One mutation keeps the clone's signal alive across `/reload` and must fail the `/reload` half.
14. A throw in the mention wiring leaves `unbind` set, so quit still clears the widget and FleetView (P11; Q13).
15. A reopen that fails before its session exists (a directory in place of the session file) leaves the tombstone reachable. Once the file is back, the next mention reopens the same conversation: the child's request holds the evicted user messages and the new one (old 101; Q14).
16. An outcome that settles after the session's end, or after `/reload`, notifies nothing and raises no unhandled rejection: a steer whose child `input` handler is held, released after `session.shutdown()` and again after `/reload`. One mutation removes the `signal.aborted` check in the hook's `notify` and must fail this case (P4).

**Validation.** Test files: the mentions suite, `test/suite/fork-subagents-presentation.test.ts`, `test/fork-builtins/subagents/layering.test.ts` and `test/fork-builtins.test.ts`. Mutations with case count 16. `npm run check` exits 0.

**Commit.** `feat(coding-agent): route @agent mentions at the prompt to subagents`.

### T5. The `@` autocomplete rows

**Changes.**

| File | Change |
| --- | --- |
| `$SUB/ui/mentions.ts` | `MentionRow`, `mentionRoster(service)` and `createMentionProvider(current, roster, enabled, warn)` (`probe.patch`). |
| `$SUB/ui/index.ts` | Registers the provider once per activation at a `tui` `session_start` (P10). |
| `test/fork-builtins/subagents/ui-mentions.test.ts` | New: the provider with a fixed roster, a fake wrapped provider, and Pi's `CombinedAutocompleteProvider` over a temporary directory. |
| `test/suite/fork-subagents-mentions.test.ts` | `describe("the @ popup")`: the roster on real sessions and the registration. |

**Cases.**
1. Agent rows come before the wrapped provider's rows. A bare `@` offers every agent and still the files; agents stand alone when no file matched; the wrapped list returns unchanged when no handle matches or no agent exists (old 1 to 3, 7, 15; Q11).
2. A wrapped provider that throws, synchronously or asynchronously, still leaves the agent rows, and the service warns once, not per keystroke (old 4 to 6).
3. Running and queued agents list first, then other live agents from the earliest; live agents come before evicted ones and before startable types (old 8, 14, 36).
4. Matching is a case-insensitive prefix, and a mention typed mid-message completes (old 9, 10).
5. A type with no agent lists as `start agent · <first sentence>`. A live agent owns its handle, so the type does not list twice. A finished agent lists as `resume` (old 11 to 13).
6. The wrapped provider alone answers a path-shaped token, an `@` that is not at a token boundary, and every token while `agentMentions` is `off`. Nested agents never list (old 16 to 19, 86).
7. The provider composes with wrappers registered before and after it, declares `@` for Pi to union, and a rebuild from the same factory carries no state (old 20 to 23).
8. Against Pi's real `CombinedAutocompleteProvider`, a completion inserts the handle and a space at a line's start and mid-line, keeps the text after the cursor, and inserts a file row from the agent prefix character for character (old 24 to 28).
9. `applyCompletion` and `shouldTriggerFileCompletion` go to the wrapped provider, and `triggerCharacters` is `["@"]` (old 29 to 31).
10. A named agent lists once, under its alias, with its type label; an unnamed row repeats no type; the unlisted type handle of a named agent still resolves (old 32 to 34).
11. An evicted agent lists as `resume` after the live ones; an aliased tombstone keeps its type handle reserved; a type whose handle a tombstone holds does not list (old 35, 37, 38).
12. Rows show an agent's `display_name`, and the raw type when it has none (old 39 to 41).
13. The factory registers the provider once per activation, only in `tui` mode, and the provider answers a live agent's handle. After `/reload` the new activation registers it again (old 49 to 51).
14. Skill-bundled agents never list: no startable type, no running record and no tombstone of a hidden type (ADR-0008; P8; Q16, Q17). A disabled type never lists as `start agent`; an existing record of it still lists. An existing skill agent's exact handle still reaches it through the hook.
15. Answering a keystroke reads no file: a spy on `readFileSync` and `readdirSync` records no call during `getSuggestions`.

**Validation.** Test files: both files above, `test/suite/fork-subagents-presentation.test.ts` and `test/fork-builtins/subagents/layering.test.ts`. Mutations with case count 15. `npm run check` exits 0.

**Commit.** `feat(coding-agent): @ autocomplete rows for subagents`.

### T6. Documentation and the full inventory check

**Changes.**
- The module README (`$SUB/README.md`) gains `## Mentions`: the grammar, the routing of P2, the three modes, TUI only (D44), the clone (P6, P7), the popup, and the reopen. The `agentMentions` settings row loses its `Phase 3:` prefix. Known limitations gain P23. The later-phases table drops phase 3.
- `docs/skills.md:162-168`, `:178-181` and `:203-205` name the fork's native subagents (`core/fork-builtins/subagents/`) instead of the pi-subagents extension. The event-bus path stays described for `PI_FORK_BUILTINS=off`.
- `docs/skills-capability-matrix.md:44-45` names the native service for `context: fork` and skill-bundled agents. The provenance note `f19923f` may stay.
- An ADR-0009 amendment dated on the day of the task. It covers the input hook and the popup inside `<inline:subagents>`, D44 and D45, and an unchanged upstream footprint.

**Validation.**
- For each term `@main`, `@agent-`, `agentMentions`, `direct`, `model`, `D44`, `reopen` and `tombstone`, `grep -cF "<term>" $SUB/README.md` prints at least 1. `grep -c 'Phase 3:' $SUB/README.md` prints 0.
- `grep -n 'pi-subagents' docs/skills.md` prints nothing.
- For each term `D44`, `D45` and `mention`, `grep -cF` on the ADR prints at least 1.
- `node $E2/check-cases.mjs inventory $E3/old-cases.md` exits 0 and reports `rows: 164`.
- Run every file the inventory's covering tests name: `node $S run /tmp/subagents-native packages/coding-agent $R/T6-1.json <files>`. `node $E2/check-cases.mjs coverage $E3/old-cases.md $R/T6-1.json $R/mutations` exits 0.
- `npm run check` exits 0.

**Commit.** `docs: native subagents phase 3 README, skill docs and ADR-0009 amendment`.

### T7. Phase test runs (R8)

**Changes.** None. Run `node $S run /tmp/subagents-native packages/coding-agent $R/phase.json`, then `./test.sh > $R/phase-testsh.log 2>&1`, one after the other.

**Validation.**
- `node $S diff $R/base-1.json $R/phase.json` lists no new failure other than a known flake.
- With `ids() { grep -E '(^| )FAIL |^✖ |ℹ fail ' "$1" | sed -E 's/ \([0-9.]+ ?m?s\)$//' | sort -u; }`, `diff <(ids $R/base-testsh.log) <(ids $R/phase-testsh.log)` shows no added line other than a known flake. With `pkgs() { grep -E '^> @earendil-works/.* test$' "$1" | sort; }`, `diff <(pkgs $R/base-testsh.log) <(pkgs $R/phase-testsh.log)` prints nothing.
- Every failure other than a known flake becomes task `T7-R<n>` under the regression rule and the review gate, committed as `fix(coding-agent): <failure>`.
- `node $I $R/base-1.json $R/phase.json $R` exits 0 (P16). Section 9 reruns it after T8.

### T8. Phase review

**Changes.** Run the `super-code-review` skill over `$BASE..HEAD` (R7), with this plan and the handoff as the spec. Write `$R/phase-review.md` with the first line `Verdict: <the skill's verdict>`. Record each finding as a heading `### F<n>: <one line>` followed by one line `Disposition: Accepted`, `Disposition: Rejected: <disproving source>` or `Disposition: Deferred: <reason>`. Present the verdict and the dispositions to Paolo, and wait for his yes per accepted finding. Record each yes as `Approved: <date>, <Paolo's words>` under its heading. Each applied finding is its own code task `T8-F<n>` under the regression rule and the review gate, and gets `Applied: <commit hash>` under its heading.

**Validation.** With `P=$R/phase-review.md`:
- `head -1 $P | grep -c '^Verdict: .'` prints `1`.
- `grep -c '^### F[0-9]' $P` equals `grep -c '^Disposition: ' $P`.
- `for h in $(sed -n 's/^Applied: //p' $P); do git merge-base --is-ancestor "$h" HEAD || echo "missing $h"; done` prints nothing.
- `awk '/^### F/{f=$0; a=0} /^Approved: /{a=1} /^Applied: /{if (!a) print f}' $P` prints nothing.

**Commit.** One per applied finding, `fix(coding-agent): <finding>`; none when nothing is applied.

### T9. Validate the built outputs and run the TUI smoke (R11)

**Changes.** None. Section 5 step 8 must hold.

**Validation.** Run `npm run build:offline`. Then `mkdir $R/home`, which must succeed, and with `H=$R/home`:
- `env -i PATH="$PATH" HOME=$H PI_CODING_AGENT_DIR=$H/.pi/agent node $E2/sdk-probe.mjs packages/coding-agent/dist on` exits 0;
- the same with `PI_FORK_BUILTINS=off` and mode `off` exits 0;
- mode `off` without the switch exits 1;
- `$E3/run-smoke.sh "$PWD/packages/coding-agent/dist" direct $R/smoke-direct` exits 0 and prints 11 `pass` lines, from `00-print` to `11-quit`; `05-viewer` passes only on the viewer's own ` close` key hint;
- `$E3/run-smoke.sh "$PWD/packages/coding-agent/dist" model $R/smoke-model` exits 0 and prints 12 `pass` lines, `08-clone` included;
- `find $R/smoke-direct/tmp $R/smoke-model/tmp -name '*.output' | wc -l` prints a number above 0: the transcripts stayed in the runs' own `TMPDIR`.

A smoke step that fails leaves its screen in `$R/smoke-<mode>/<step>.txt`. A failure caused by the harness, such as a changed startup text, is fixed in `$E3/run-smoke.sh` in its own `docs: ` commit, and the run repeats to a new directory. A failure caused by the code becomes a `T8-F<n>` task after Paolo's yes. Afterwards `shasum -a 256 -c $R/live-settings.sha256` passes, `ls -A $H` prints nothing, and `git status --short` prints nothing.

### T10. Record the results

**Changes.** `docs/plans/subagents-native-phase3.results.md`:
- the commits;
- one section `### T<n> <title>` per task T1 to T6, and one for T9;
- in each code-task section, `Tests:`, `Mutations:` and `Review:` lines as phase 2's T20 defines them;
- in T9's section, the probe's three JSON lines and the two smoke outputs;
- `## Phase runs` with T7's counts and every `T7-R<n>`;
- `## Phase review` with `$R/phase-review.md` verbatim, then each `T8-F<n>`;
- `## Open items`, which includes: "The workflow work excludes `Agent`, `get_subagent_result` and `steer_subagent` from worker sessions, with a test that a worker's model never receives them, before it resumes (D43)." It also carries phase 2's deferred F11, F13 and F14, and the agent files' unknown keys (Section 10);
- the deviations.

It copies every `$R/mutations/*.json` and `*.txt` to `$E3/mutations/`.

**Validation.** With `F=docs/plans/subagents-native-phase3.results.md`:
- `for h in $(git log --format=%h $BASE..HEAD); do grep -qF "$h" $F || echo "missing $h"; done` prints nothing.
- `for c in "T1 11" "T2 7" "T3 12" "T4 16" "T5 15"; do set -- $c; node $E2/check-cases.mjs mutations $E3/mutations/$1.txt $2 > /dev/null || echo "$1 mutations incomplete"; done` prints nothing.
- `grep -cF 'D43' $F` prints at least 1.
- `grep -E '^- ' $R/reviews.md | grep -vxFf $F` prints nothing, and `grep -v '^$' $R/phase-review.md | grep -vxFf $F` prints nothing.

**Commit.** `docs: native subagents phase 3 results`, holding the results file and `$E3/mutations/`.

### T11. Check the cutover's preconditions

**Changes.** None; every command is read-only.

**Validation.** Each check has a fallback; a failed check stops the cutover until Paolo answers.
- `git -C $M rev-parse --abbrev-ref HEAD` prints `personal`, and `git -C $M rev-parse personal | diff - $R/personal.ref` succeeds. Otherwise another commit landed on `personal`: stop and ask, because the fast-forward may no longer apply.
- `git -C $M merge-base --is-ancestor personal feat/subagents-native` exits 0.
- `git -C $M status --porcelain=v1 --untracked-files=all | diff - $R/main-status.pre-cutover` prints nothing. Otherwise list the new paths; stop and ask. Another session's file under `packages/` or `docs/` may block the merge, and this plan never moves a path it did not record.
- The six paths hold committed content, so moving them loses nothing. From `/tmp/subagents-native`: `git show ea2e39c01:docs/plans/subagents-native-phase1.plan.md | cmp - $M/docs/plans/subagents-native-phase1.plan.md` succeeds, and for each of the five files under `docs/plans/subagents-native-phase1-evidence/` in `$R/main-status.pre-cutover`, `git show HEAD:<path> | cmp - $M/<path>` succeeds. Otherwise stop and ask.
- `grep -c '"../../Developer/ai/pi-subagents"' $LIVE` prints `1`, and `grep -n '"npm:@narumitw/pi-btw"' $LIVE` prints one line, the entry that precedes it. When `shasum -a 256 -c $R/live-settings.sha256` fails, a session changed a setting since planning; that is expected, and C3's helper edits the current file.
- `git -C $M diff --quiet personal feat/subagents-native -- package-lock.json packages/coding-agent/npm-shrinkwrap.json` exits 0, and `git -C $M diff --name-only personal feat/subagents-native -- '*package.json'` prints nothing, so C4 needs no install.
- T9 passed at a commit `<t9>` that the results file names, and `git diff --name-only <t9> HEAD | grep -v '^docs/plans/'` prints nothing.
- `test -e $R/cutover-backup`, `test -e $R/dist-pre-cutover.tar` and `test -e $R/settings.json.pre-cutover` each exit 1.
- `df -k $R | awk 'NR==2 {print $4}'` prints more than 200000 (200 MB free for the `dist` snapshot).

Present the results and the four cutover steps to Paolo in one message. The steps then follow one at a time, each with its own yes (P18). A declined step is a safe stopping point: the table "Stopping states" below names what runs from then on.

### T12. C1: clear the untracked phase 1 paths

**Changes.** After Paolo's yes, from `$M`: `sed 's/^?? //' $R/main-status.pre-cutover | xargs shasum -a 256 > $R/cutover-backup.sha256`. Then `mkdir -p $R/cutover-backup/docs/plans`, `mv $M/docs/plans/subagents-native-phase1.plan.md $R/cutover-backup/docs/plans/`, and `mv $M/docs/plans/subagents-native-phase1-evidence $R/cutover-backup/docs/plans/`, one path per command.

**Validation.** `git -C $M status --porcelain=v1 --untracked-files=all` prints nothing. From `$R/cutover-backup`, `shasum -a 256 -c $R/cutover-backup.sha256` reports six `OK` lines. When the second `mv` fails, move the first path back with RB1's command for it, and stop and ask.

### T13. C2: fast-forward `personal`

**Changes.** After Paolo's yes: `git -C $M merge --ff-only feat/subagents-native > $R/C2-merge.log 2>&1`.

**Validation.** The command exits 0. `git -C $M rev-parse personal` equals `git rev-parse HEAD` of `/tmp/subagents-native`; write that hash to `$R/cutover-head.ref`. `git -C $M status --porcelain=v1 --untracked-files=all` prints nothing. When the merge refuses, git changed nothing: run RB1, then stop and ask.

### T14. C3: remove the pi-subagents entry

Ask T13 and T14 back to back, and restart no Pi session between them.

**Changes.** After Paolo's yes:
- `cp $LIVE $R/settings.json.pre-cutover`, then `cmp $LIVE $R/settings.json.pre-cutover` succeeds. The copy is a record; the rollback never copies it back.
- `node $E3/settings-entry.mjs --save $R/C3 $LIVE remove ../../Developer/ai/pi-subagents > $R/C3.log 2>&1`, from `/tmp/subagents-native`. It takes Pi's settings lock, saves the text it read and the text it writes as `$R/C3.before` and `$R/C3.after`, and removes the one entry.

**Validation.** The helper exits 0. `diff $R/C3.before $R/C3.after` shows exactly one removed line, `    "../../Developer/ai/pi-subagents",`, and no added line; both files were written under the lock, so another session's save cannot enter the comparison. `jq -r '.packages[]' $LIVE` still lists `../../Developer/ai/pi-tasks`. Exit 1: a precondition failed or the records could not be written, and nothing was written to `LIVE`. Exit 3: the settings write failed, and the helper re-read `LIVE` under the lock and found it unchanged. Exit 4: the write failed and `LIVE` changed. On any of them, stop and ask; on exit 4, also show Paolo `$R/C3.before`.

### T15. C4: rebuild the main checkout

**Changes.** Run `pgrep -fl 'Developer/ai/pi/packages/coding-agent/dist/cli.js'` and show Paolo the list (P21). After Paolo's yes, from `$M`:
1. `ls -d packages/*/dist packages/session-backends/*/dist > $R/dist-dirs.txt`.
2. `tar -cf $R/dist-pre-cutover.tar $(cat $R/dist-dirs.txt)`.
3. `find $(cat $R/dist-dirs.txt) -type f -print0 | sort -z | xargs -0 shasum -a 256 > $R/dist-pre-cutover.sha256`.
4. `npm run build:offline > $R/C4-build.log 2>&1`.

**Validation.** Steps 1 to 3 exit 0 before step 4 runs. The build exits 0. `test -f $M/packages/coding-agent/dist/core/fork-builtins/subagents/ui/mentions.js` exits 0; the old `dist` has no `subagents/` directory. `git -C $M status --porcelain=v1` prints nothing, because `.gitignore:8` ignores `packages/*/dist/`. `mkdir $R/c4-home` succeeds; then, from `$R`, `env -i PATH="$PATH" HOME=$R/c4-home PI_CODING_AGENT_DIR=$R/c4-home/.pi/agent PI_OFFLINE=1 node $M/packages/coding-agent/dist/cli.js --help > /dev/null` exits 0. That run writes `auth.json` and `models-store.json` under `$R/c4-home` only. When the build fails, run the rollback; RB4 restores the snapshot and needs no build.

### T16. Paolo's live checklist (R11)

**Changes.** None by the implementer. Paolo starts a new real session with PATH `pi` in a project of his choice and runs the checklist below, in order. Every prompt carries the marker `sn3-cutover-2026`. The implementer writes the checklist to `$R/checklist.md` and asks Paolo for each result.

1. The startup lists no `pi-subagents` package.
2. `/agents` opens and lists the agent types, Paolo's own agents included. Its settings show the `Agent mentions` value; Paolo records it and changes nothing.
3. Before any Explore agent exists in the session, `@explore sn3-cutover-2026 list the top-level files` shows `Prompting @explore…` in `model` mode or `Started @explore` in `direct` mode, and an Explore agent starts. In `off` mode the prompt goes to the main model, and the item is `skipped: agentMentions off`.
4. A prompt that asks for a background `Plan` agent shows it in the widget and in FleetView (↓, then ↓ and Enter opens its viewer).
5. When a pi-tasks task runs an agent, it completes through the native service.
6. `/quit` exits while an agent runs.

**Validation.** `grep -rlF sn3-cutover-2026 ~/.pi/agent/sessions | head -1` names the session file, and `$R/checklist.md` records each item as `pass`, `fail` or `skipped: <reason>` with Paolo's words. Any `fail` starts the rollback after Paolo's yes. A `skipped` item needs Paolo's explicit acceptance, recorded as `Accepted: <date>, <Paolo's words>` under it; without it, the item counts as `fail`.

### T17. Record the cutover

**Changes.**
- The results file gains `## Cutover`. Its first line is one of `Outcome: completed` (all six T16 items `pass`), `Outcome: completed, unverified` (no `fail`, and each `skipped` item accepted by Paolo), `Outcome: rolled back` (every fact back at its pre-cutover value after rollback steps ran), `Outcome: not started` (Paolo declined C1), or `Outcome: stopped at <step>`, where `<step>` names the last cutover or rollback step that ran. Four lines follow, each read from the live state with the commands of the rollback's "State" table: `Files: in place|backed up`, `Source: <40-hex commit>`, `Entry: present|absent` and `Build: pre-cutover|native|partial`. Then come T11's checks, each step's command, exit code and approval line, the build log's last line, and T16's checklist with its session file. A step that did not run is listed as `not run: <reason>`; each rollback step that ran is listed with its verification.
- With Paolo's yes, the handoff's section 14.1 "Loaded today" and section 14.5's cutover facts describe the four facts in words. For `completed` and `completed, unverified`: the native built-in replaced pi-subagents on the cutover's date, at the commit `$R/cutover-head.ref` names. For any other outcome: what runs from PATH `pi`, from the matching row of "Stopping states", and a dated line that points to the results file.

**Validation.** `grep -c '^## Cutover' docs/plans/subagents-native-phase3.results.md` prints `1`. `grep -cE '^Outcome: (completed|completed, unverified|rolled back|not started|stopped at (C[1-4]|RB[1-4]))$' docs/plans/subagents-native-phase3.results.md` prints `1`, and `grep -cE '^(Files: (in place|backed up)|Source: [0-9a-f]{40}|Entry: (present|absent)|Build: (pre-cutover|native|partial))$'` on the same file prints `4`. `$R/approvals.md` holds one line per step that ran.

**Commit.** `docs: native subagents phase 3 cutover record`, on `feat/subagents-native` only (P22).

### Cutover rollback

A failed step, or a `fail` in T16, starts the rollback after Paolo's yes. No Pi session starts from PATH `pi` until it ends.

**State.** Four facts describe the live setup. Each cutover step changes one fact, and one rollback step changes it back:

| Fact | Pre-cutover value | Changed by | Restored by | Read with |
| --- | --- | --- | --- | --- |
| `Files` | `in place` | C1 (`backed up`) | RB1 | `test -e $M/docs/plans/subagents-native-phase1.plan.md` |
| `Source` | `personal` at `$R/personal.ref` | C2 (`$R/cutover-head.ref`) | RB2 | `git -C $M rev-parse personal` |
| `Entry` | `present` | C3 (`absent`) | RB3 | `grep -c '"../../Developer/ai/pi-subagents"' $LIVE` |
| `Build` | `pre-cutover` | C4 (`native`, or `partial` when the build failed) | RB4 | `test -f $M/packages/coding-agent/dist/core/fork-builtins/subagents/ui/mentions.js`; `partial` when C4's build exited non-zero |

A rollback step runs only when its fact differs from the pre-cutover value, in the order RB2, RB4, RB3, RB1. RB2 comes first because RB4 restores the old executable and RB3 the old extension, and both belong with the old source. RB4 restores the snapshot rather than rebuilding, so it needs no build tooling. RB3 edits one entry under Pi's lock, so it keeps any setting a session changed during the checklist.

**Preflight.** Before the first rollback command, check the prerequisite of every step that will run, and stop and ask on any failure:
- RB2: `git -C $M rev-parse personal | diff - $R/cutover-head.ref` succeeds, and `git -C $M status --porcelain=v1 --untracked-files=all` prints nothing;
- RB4: `tar -tf $R/dist-pre-cutover.tar > /dev/null` exits 0, and `grep -vxE 'packages/([a-z-]+/)?[a-z-]+/dist' $R/dist-dirs.txt` prints nothing, so RB4 deletes only `dist` directories;
- RB3: `grep -c '"npm:@narumitw/pi-btw"' $LIVE` prints `1`;
- RB1: neither `$M/docs/plans/subagents-native-phase1.plan.md` nor `$M/docs/plans/subagents-native-phase1-evidence` exists (`test ! -e` for each), so the move overwrites nothing another session created.

**Steps:**

| Step | Command | Verification |
| --- | --- | --- |
| RB2 | `git -C $M reset --keep 83af84af2` | `git -C $M rev-parse personal | diff - $R/personal.ref` succeeds. |
| RB4 | From `$M`: `for d in $(cat $R/dist-dirs.txt); do rm -rf "$d"; done`, then `tar -xf $R/dist-pre-cutover.tar`. `dist-dirs.txt` lists only the `dist` directories the main checkout held before C4. | From `$M`, `shasum -a 256 -c --quiet $R/dist-pre-cutover.sha256` exits 0, and T15's `--help` run exits 0 with a new `$R/rb-home` as its home. |
| RB3 | `node $E3/settings-entry.mjs --save $R/RB3 $LIVE add ../../Developer/ai/pi-subagents npm:@narumitw/pi-btw`, from `/tmp/subagents-native` | Exits 0; `diff $R/RB3.before $R/RB3.after` shows exactly one added line, the entry, right after `npm:@narumitw/pi-btw`. |
| RB1 | Recheck both `test ! -e` of the preflight, then `mv $R/cutover-backup/docs/plans/subagents-native-phase1.plan.md $M/docs/plans/` and `mv $R/cutover-backup/docs/plans/subagents-native-phase1-evidence $M/docs/plans/` | From `$M`, `shasum -a 256 -c $R/cutover-backup.sha256` reports six `OK` lines. |

**Stopping states.** A declined cutover step, or a declined or failed rollback step, stops the work. T17 records the four facts as read then, and the table below says what runs. Any combination the table does not list continues with the next rollback step.

| Facts | What runs from PATH `pi` | Next step |
| --- | --- | --- |
| All pre-cutover | The pre-cutover setup | None (`Outcome: not started`, or `rolled back` when steps ran). |
| `Files` backed up only | The pre-cutover setup | RB1, or C2. |
| `Source` new; `Entry` present; `Build` pre-cutover | The pre-cutover setup: the old `dist` ignores the source | RB2, or C3. |
| `Source` new; `Entry` absent; `Build` pre-cutover | The old `dist` with no subagents | C4, or RB3. |
| `Entry` absent; `Build` native | The native built-in (the cutover, whatever `Source` holds) | T16 when `Source` is new; RB4 after RB2. |
| `Build` partial | Nothing reliable | RB4 (after RB2 when `Source` is new). |
| `Entry` present; `Build` native | pi-subagents and the native tools together | RB4, never T16. |

## 7. Test plan

| Layer | What it proves | When it runs |
| --- | --- | --- |
| Module tests `test/fork-builtins/subagents/mentions.test.ts`, `ui-mentions.test.ts` | The grammar, and the provider against a fake and Pi's real autocomplete | T1, T5; T7 |
| Suite tests `fork-subagents-mentions.test.ts`, `fork-subagents-mention-clone.test.ts` | Resolution, reopen, the clone's request, the hook on real parent and child sessions, and the popup's registration | T1 to T5; T7 |
| `layering.test.ts` | `ui/` stays above `tools/` and `service/`; no cycle | Every code task |
| Mutation records (`$E2/mutate.mjs`, `check-cases.mjs mutations`) | Every numbered case has a mutation that one of its expected tests catches | T1 to T5; T10 |
| Inventory coverage (`check-cases.mjs coverage`) | Every kept old case has passing tests that its case's mutation breaks | T1 to T5 per task; T6 in full; the done criteria |
| Identity check (`$E3/check-identities.mjs`) | No baseline or task test disappeared from the phase run or became skipped; no phase test of a file a fix reran disappeared, became skipped or failed to load, except a rename recorded in `$R/renamed.txt`; every failure is a flake or repaired | T7; the done criteria |
| SDK probe (`$E2/sdk-probe.mjs`) | The built outputs carry the factory and the bounded quit; the switch removes them | T9 |
| TUI smoke (`$E3/run-smoke.sh`) | The built CLI shows the widget, status, FleetView, the agent's viewer and the popup; mentions start agents in both modes; a print-mode mention reaches the model; `/quit` exits 0 while agents run. The screen checks are text matches: a step passes on its string anywhere on the screen, and step 05's string ` close` appears only in the viewer's key hints. | T9 |
| Settings helper (`$E3/settings-entry.mjs`) | C3 and RB3 edit one entry under Pi's lock | Appendix A; T14 and RB3 verify the live result |
| `dist` snapshot | RB4 restores the pre-cutover build exactly | Appendix A; RB4's manifest check |
| Footprint check | `agent-session.ts`, `interactive-mode.ts` and `core/keybindings.ts` unchanged against BASE | T7; the done criteria |
| Paolo's checklist | The live setup runs the native built-in without pi-subagents | T16 |

The probe confirmed mutations Q1 to Q18 (Appendix A). Each is an entry of the task and case it names in Section 6.

**Not proved by this plan.**
- A real model's clone reply; the smoke's faux provider scripts it.
- RPC clients, fenced runs of the smoke, and OpenIntent workers (R9).
- That quit waited for a child's `session_shutdown` in the TUI smoke; the SDK probe proves it on the built SDK.
- The smoke's widget and FleetView steps match text that other surfaces could also show; the viewer step has a negative control, the others do not.
- RB2, RB3 and RB4 on the live setup; each ran only on a clone, a copy or the probe worktree.
- A full-suite comparison after the `T7-R<n>` and `T8-F<n>` fixes: D36 runs the full suites once.
- Sessions started before T15 keep the old code until they restart.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| A running Pi session lazy-loads a module that T15 rebuilt, and fails. | P21: Paolo sees the running list first; restarting every session after T15 clears it. |
| The fast-forward meets a new untracked or modified path in the main checkout. | T11 compares the full status with `$R/main-status.pre-cutover` and stops on any difference. |
| C2 lands and C3 does not. | Harmless until C4: the old `dist` has no native tools (Stopping states). T13 and T14 are asked back to back. |
| A rollback restores the extension while the native build stays. | The preflight checks every prerequisite first; RB2 and RB4 run before RB3. |
| A rebuild fails and leaves a partial `dist`. | RB4 restores the pre-cutover snapshot and its manifest, with no build. |
| A session changes a setting during the cutover or the checklist. | C3 and RB3 edit one entry under Pi's lock, and keep every other key as the file holds it then. |
| pi-tasks misbehaves without pi-subagents. | The bus adapter keeps every channel pi-tasks uses (D19); T16 item 5 checks it live; the rollback restores the old setup. |
| The clone sends the whole conversation, which costs one model request per mention. | Only `agentMentions: model` clones; `direct` starts the agent from the typed text. |
| A mention in a long prompt is misread as an agent. | Only a leading `@handle` with text after it is a mention; `@main` escapes it (T1 case 7, T4 case 9). |
| The smoke's screen texts change with Pi's UI. | T9 fixes the harness in a `docs: ` commit and reruns; the screens are kept per step. |
| The live agent files keep keys both loaders ignore (`persistSession`, `thinkingLevel`). | Behavior is unchanged by the cutover; Section 10 lists the fix. |

## 9. Done criteria

- These commits exist on `feat/subagents-native`, each with its Section 6 message: T0, T1 to T6, every `T7-R<n>`, every applied `T8-F<n>`, T10 and T17. `git log --oneline $BASE..HEAD` lists them.
- `npm run check` exits 0 at the last code commit.
- `node $I $R/base-1.json $R/phase.json $R` exits 0.
- `git diff --numstat $BASE -- packages/coding-agent/src/core/agent-session.ts packages/coding-agent/src/modes/interactive/interactive-mode.ts packages/coding-agent/src/core/keybindings.ts` prints nothing.
- With `REPORTS=$R/phase.json$(ls $R/T7-R*-*.json $R/T8-F*-*.json 2>/dev/null | sort -V | while read -r f; do printf ',%s' "$f"; done)`, `node $E2/check-cases.mjs coverage $E3/old-cases.md $REPORTS $E3/mutations` exits 0. `sort -V` orders attempts numerically (`T8-F1-2` before `T8-F1-10`), so each fix's last report replaces the earlier results for its tests.
- T9's runs exit 0, 0, 1, 0 and 0, and the results file holds their output.
- `$R/approvals.md` holds a line for each cutover and rollback step that ran.
- The results file's four fact lines equal the facts read again now with the commands of the rollback's "State" table. `completed` and `completed, unverified`: `Source` equals `$R/cutover-head.ref`, `Entry` is `absent` and `Build` is `native`. `rolled back` and `not started`: every fact holds its pre-cutover value, and, when C4 ran, `shasum -a 256 -c --quiet $R/dist-pre-cutover.sha256` passes from `$M`. `stopped at <step>`: the facts match a row of "Stopping states".
- `$R/checklist.md` records each of T16's six items as `pass`, `fail` or `skipped: <reason>`, or the results file states why T16 did not run.

## 10. Later phases

| Order | Item | Prerequisite |
| --- | --- | --- |
| 4 | pi-tasks on the typed service; the fast-forward that also carries T17's record | Phase 3 and its cutover |
| Workflow work | The worker exclusion of `Agent`, `get_subagent_result` and `steer_subagent`, with its test (D43) | Before the workflow work resumes |
| Unassigned | Phase 2's deferred F11, F13 and F14; the print-mode hold | A ruling that schedules them |
| Unassigned | The agent files' `persistSession` and `thinkingLevel` keys become `persist_session` and `thinking`, in `~/.pi/agent/agents/` and `.pi/agents/` | Paolo's yes; the files are live configuration and project files |

## Appendix A. Probe measurements

The probe started at BASE on 2026-09-29 in `/tmp/sn3-probe`; the baselines ran in the clean `/tmp/subagents-native`.

| Run | Files | Tests | Failed | Pending |
| --- | --- | --- | --- | --- |
| base-1 (coding-agent) | 443 | 5,143 | 1: `exec.test.ts` "captures finite inherited descendant output after the shell exits" (known flake) | 50 |
| probe-full-1 | 444 | 5,151 | 2 new: the presentation suite's FleetView-clearing and RPC-widget tests (probe finding 2); the flake passed | 50 |
| probe-full-2 | 444 | 5,151 | 1: the same known flake | 50 |
| probe-full-3 (after review pass 1) | 445 | 5,154 | 0 | 50 |
| base `./test.sh` | 12 packages | coding-agent 5,143 | the same known flake only | |

- `failing-tests.mjs diff base-1 probe-full-3`: no new failure; exit 0.
- `check-identities.mjs` (the phase 3 copy) on `base-1`, `probe-full-3` and the probe's mention report as `T4-1.json`: baseline 5,137 identities, phase 5,148, offending 0, exit 0. With the mention file removed from the phase report, it flagged each of its tests as missing and exited 1. With a fix report `T8-F1-<k>.json` that reran the mentions file: exit 0 for the unchanged file; exit 1 naming the test when one phase test was removed, marked skipped, or renamed without a `renamed.txt` line; exit 1 naming the file when it failed to load with no assertions; exit 0 for the rename once `renamed.txt` declared it. Review pass 3: exit 1 naming the file when the suite failed while all its tests passed; exit 1 for a declared rename of a baseline test from the presentation file.
- `npm run check` exited 0 on the final probe.
- `$R/base-1.json` SHA-256 `c7dba2fdd1964054e8538c9b53c35eadd1e5bd1c6b92d6592d8f5976b669d976`. `$R/base-testsh.log` SHA-256 `11aa67af272da0df7efccf6194c07b09356c5f2504e76db66f4e3c01a06e57f5`.

Findings the probe made:
1. Mutation Q9 first targeted the hook's own `ctx.mode !== "tui"` check and was not caught: the factory never builds the mention environment outside the TUI, so the check was redundant. The hook now tests only for the environment, and Q9 targets the factory's mode test, with an RPC case in the test (P3).
2. The first full run failed two phase 2 presentation tests. Their fake UI contexts have no `addAutocompleteProvider`, so `session_start` threw after it had built the widget and FleetView but before it assigned `unbind`; quit then cleared nothing. Real contexts all have the method. `unbind` is now assigned before the mention wiring (P11), and Q13 proves the order.
3. Phase 2's SDK probe first failed on the probe's `dist` with `No API provider registered for api: faux:…`. The run used the script from another worktree, whose `@earendil-works/pi-ai` is a different module instance. Run from the worktree that built the `dist`, it passed unchanged.
4. The first smoke runs failed in the harness: cmux typed the long `--command` into a shell that never ran it; two Escapes after the viewer opened the session tree; `ctrl+d` did not quit. A launcher script, one Escape per open list, and `/quit` fixed them.
5. The print-mode check failed with `File not found`: the CLI reads an argument that starts with `@` as a file (`cli/args.ts:235`). The check pipes the prompt over stdin (P19).
6. Review pass 1: a reopen whose child failed before its session existed left a record that shadowed the tombstone, so the retry started a new conversation. `resolveMention` now ranks that record last (P12); the probe test "reopens the same conversation on a retry after a reopen failed to start" puts a directory at the session path to fail the first reopen.
7. Review pass 1: the reopen's success handler awaited `worktreeStarted`, whose rejection escaped as an unhandled rejection. One promise chain now covers both; the probe test spies `worktreeStarted` to reject.
8. Review pass 1: the smoke's Enter after the first Down landed on `main` and opened no viewer, and both launches wrote transcripts under the shared `/tmp/pi-subagents-501`. The smoke now presses Down twice, matches the viewer's ` close` hint, and gives each run its own `TMPDIR`. With the probe's built `openSelected` patched to return at once, step 05 failed and the smoke exited 1; the file was then restored byte for byte.
9. Review pass 3: the faux provider turns an aborted request into an aborted reply (`ai/src/providers/faux.ts:348-352`), which hid a missing guard: a provider that answers after the abort made the clone start an agent. The clone now checks its signal before spawning; `mention-clone.test.ts` uses a fake provider that ignores the abort.

Mutations, from `$E3/probe-mutations.json` run by `$E2/mutate.mjs` on the final probe:

| Mutation | Failing tests |
| --- | --- |
| Q1: a direct mention starts another type | 5 mention tests, the start test included |
| Q2: a mention steers no agent | the steer test |
| Q3: a resume drops the message | the resume test |
| Q4: a reopen starts an empty conversation | the reopen test |
| Q5: a reopen takes a new handle | the reopen test |
| Q6: the clone keeps every tool | the model-mode clone test |
| Q7: the clone's type wins | the model-mode clone test |
| Q8: a failed clone starts nothing | the clone-fallback test |
| Q9: mentions act in RPC mode | the pass-through test |
| Q10: `@main` keeps its prefix | the pass-through test |
| Q11: agent rows follow the file rows | the popup test |
| Q12: the registry stays empty until a spawn | 7 of 8 mention tests |
| Q13: a failing mention wiring leaves the UI bound | the two presentation tests of finding 2 |
| Q14: a failed reopen shadows its tombstone | the retry test of finding 6 |
| Q15: a reopen worktree failure escapes the rejection handler | the worktree-failure test of finding 7 |
| Q16: the roster lists running skill-bundled agents | the roster test in `ui-mentions.test.ts` |
| Q17: the roster lists evicted skill-bundled agents | the same roster test |
| Q18: a cancelled clone still starts its agent | the fake-provider test in `mention-clone.test.ts` |
| Restored | 27 of 27 pass; `clean: yes`; exit 0 |

Old-case inventory: `extract-old-cases.mjs` listed 164 cases in the six files: 41 in `agent-mention-provider`, 68 in `agent-mention-wiring`, 2 in `e2e/mention-clone`, 18 in `mention-clone`, 2 in `mention-start-notification` and 33 in `mention`. `check-cases.mjs inventory` reported 164 rows (T1 38, T2 7, T3 19, T4 53, T5 45, Dropped 2) and no offending row.

SDK probe (`$E2/sdk-probe.mjs`) against the probe's `dist`, run from `/tmp/sn3-probe`, with an isolated home:

```text
{"switch":"unset","mode":"on","sources":{"Agent":"<builtin:Agent>","get_subagent_result":"<builtin:get_subagent_result>","steer_subagent":"<builtin:steer_subagent>"},"presentation":{"loaded":true,"command":true,"renderer":true},"widget":true,"quitAwaited":true,"errors":[],"pass":true}
{"switch":"off","mode":"off","sources":{"Agent":"none","get_subagent_result":"none","steer_subagent":"none"},"presentation":{"loaded":false,"command":false,"renderer":false},"widget":false,"quitAwaited":false,"errors":[],"pass":true}
{"switch":"unset","mode":"off","sources":{"Agent":"<builtin:Agent>","get_subagent_result":"<builtin:get_subagent_result>","steer_subagent":"<builtin:steer_subagent>"},"presentation":{"loaded":true,"command":true,"renderer":true},"widget":false,"quitAwaited":false,"errors":[],"pass":false}
```

The runs exited 0, 0 and 1, and the isolated home stayed empty.

TUI smoke (`$E3/run-smoke.sh`) against the probe's `dist`:

```text
pass 00-print: smoke reply
pass 01-start: smoke-1
pass 02-widget: smoke background
pass 03-status: 1 running agent
pass 04-fleet: Enter view
pass 05-viewer:  close
pass 06-popup: start agent
pass 07-mention: Started @explore
pass 09-main: smoke reply
pass 10-running: running
pass 11-quit: SMOKE-EXIT 0
```

The `model` run printed the same lines with `07-mention: Prompting @explore` and `08-clone: smoke clone`; its screen showed an `Explore` agent described `smoke clone`, although the scripted clone asked for `general-purpose`. Both runs exited 0, each run's transcripts lay under its own `tmp/`, and `shasum -a 256 -c` of the live settings passed afterwards.

Cutover commands, on `/tmp/sn3-plan/cutover-clone`, a `git clone --shared --no-checkout` of the main checkout at `personal`:
- With copies of the six untracked paths in place, `git merge --ff-only origin/feat/subagents-native` exited 1 and named all six.
- Moved to a backup directory, the same merge exited 0 and moved `HEAD` to `af021d3cc`, with a clean status.
- The backed-up plan equals `git show ea2e39c01:docs/plans/subagents-native-phase1.plan.md`, and the evidence files equal the branch's.
- `git reset --keep 83af84af2` returned `HEAD` to `83af84af2` and kept an untracked scratch file.
- On a copy of `~/.pi/agent/settings.json`, `jq -j '.packages |= map(select(. != "../../Developer/ai/pi-subagents"))'` changed exactly one line; plain `jq` also added a final newline.
- The live file equals `JSON.stringify(JSON.parse(file), null, 2)` (`node -e` printed `true`), and its `promptHistory` key holds a setting, `{"scope":"project","maxEntries":0}`, not a history.
- `settings-entry.mjs` on a copy: `remove` exited 0 with the same bytes as `jq -j`, and kept a `0640` mode; a second `remove` exited 1 and wrote nothing; `add … npm:@narumitw/pi-btw` restored the original byte for byte; a second `add` exited 1; a file not in Pi's format exited 1; a symlink exited 1. With a `proper-lockfile` lock held 1.5 s by another process, `remove` waited about 1.3 s, then exited 0, and left no lock and no temporary file behind. Review pass 2 fault test: with a preload that made the first `writeSync` write 12 bytes and throw `ENOSPC`, the helper exited 3, the copy stayed byte-identical, and no temporary file remained. Review pass 3: with `--save`, the saved `.before` and `.after` differed by exactly the removed line, and `.after` equalled the file; a prefix whose files existed exited 2; the same preload, now failing the `.before` record, made the helper exit 1 with the settings copy unchanged.

`dist` snapshot, rehearsed on `/tmp/sn3-probe`: `tar` of the 11 `dist` directories took 1.9 s and 51 MB, and the manifest listed 3,400 files. After a stray file was added and every listed directory removed, `tar -xf` restored the tree, `shasum -c --quiet` of the manifest passed, and the stray file was gone. The main checkout's list holds 12 directories (with `orchestrator`); every line matches RB4's guard pattern.

## Appendix B. Verified code

Evidence files, with SHA-256:

| File | SHA-256 |
| --- | --- |
| `docs/plans/subagents-native-phase3-evidence/probe.patch` | `6501c8b8146f2132745227142df1f3869f32d3e4808e5e66303f89b9bf2e64d6` |
| `docs/plans/subagents-native-phase3-evidence/probe-mutations.json` | `704caca6ab1d5922871e53547f95a4bcebcb01b3bee42206cb860927d99cf253` |
| `docs/plans/subagents-native-phase3-evidence/old-cases.md` | `3e9f1057b5f52d4b9b0b2c32646c0bf3f36fccc789a29e154009e78fe76b1cdf` |
| `docs/plans/subagents-native-phase3-evidence/extract-old-cases.mjs` | `f02587ff7fc34d76a694b0e12294c79b26e24dce3bc5c3e167c06fd5dec1ec72` |
| `docs/plans/subagents-native-phase3-evidence/check-identities.mjs` | `5557dd4d94e35d28a412ea59897032dbc5b5823cb44152ad010fb0ebb245cc5f` |
| `docs/plans/subagents-native-phase3-evidence/run-smoke.sh` | `800dcf61ab9675e533b4105719375a9a42c021fc3c0fe474c11e3b00e85cfe3c` |
| `docs/plans/subagents-native-phase3-evidence/faux-smoke.ts` | `ae1c79a327299c3d1ff8e1698fe5e4fb7836c2bed98baa50b54a799ba819672b` |
| `docs/plans/subagents-native-phase3-evidence/settings-entry.mjs` | `f2ea14dfbab85d30b79d03108bc12280ef7e78ba9a45bc180b46a63a9f7fbb72` |

`probe.patch` applies at BASE (`git apply --check` exits 0). It holds, verbatim as the probe's checks passed them:

| File | Content | Task |
| --- | --- | --- |
| `$SUB/service/mentions.ts` | The grammar (new, 44 lines) | T1 |
| `$SUB/service/records.ts` | `isReservedHandle`; the `reopenFrom` field | T1; T2 |
| `$SUB/service/retention.ts` | `TombstoneStore.delete` | T1 |
| `$SUB/service/service.ts` | `MentionTarget`, `resolveMention` with the order of P12, `dropTombstone`; `reopen` and the tombstone parameter of `spawnRecord` and `createRecord`; `resumeSessionFile` in `childRequest` | T1; T2 |
| `$SUB/tools/mention-clone.ts` | `runMentionClone`, with the signal check before the spawn (new, 124 lines) | T3 |
| `$SUB/ui/mentions.ts` | The hook, the routing, the start path and the one-chain reopen; the roster with its hidden-agent filter, and the provider (new, 259 lines) | T4; T5 |
| `$SUB/ui/index.ts` | The mention environment, the refresh, `unbind` first, the input handler; the provider registration | T4; T5 |
| `test/suite/fork-subagents-mentions.test.ts` | Ten probe tests with the fixtures `parent`, `bind`, `service` and `turns` (new, 313 lines) | T2, T4, T5 |
| `test/fork-builtins/subagents/ui-mentions.test.ts` | The roster test over a fake service (new, 48 lines) | T5 |
| `test/fork-builtins/subagents/mention-clone.test.ts` | The cancelled-clone test over a fake session and provider (new, 68 lines) | T3 |

`faux-smoke.ts` registers the provider `smoke` with the model `smoke-1` through `registerFauxProvider` and `pi.registerProvider`. A child's request waits 4 s. A clone's request, whose last user message holds the reminder, calls `Agent`. A prompt holding `spawn` starts a background agent.

## Review history

### Pass 1: 2026-09-29, reviewer model openai-codex/gpt-6-astra

| Angle | Verdict |
| --- | --- |
| traceability | FAIL |
| assumptions | FAIL |
| completeness | PASS_WITH_FINDINGS |
| feasibility | PASS_WITH_FINDINGS |
| validation | PASS_WITH_FINDINGS |
| safety | PASS_WITH_FINDINGS |

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | Old case 101 lost its retry after a reopen that failed to start (blocking; traceability) | Accepted | pi-subagents `test/agent-mention-wiring.test.ts:1186-1218`; P12, T4 case 15, inventory row 101, probe mutation Q14 |
| 2 | Skill-bundled agents list once they run or are evicted (blocking; assumptions) | Accepted: the popup hides them, the exact handle still reaches them | ADR-0008 hides them from autocomplete and keeps them spawnable by name; P8, Section 2.3, T5 case 14, Q16, Q17 |
| 3 | A reopen's worktree failure escaped as an unhandled rejection (assumptions) | Accepted | P4, T4 case 5, Q15 |
| 4 | T17 could record a success after a rollback (traceability, completeness) | Accepted | T17's `Outcome:` line; Section 9 |
| 5 | The rollback had no rules for partial cutovers or declined steps (completeness) | Accepted | T12 and T13 fallbacks; the rollback's preflight and "Stopping states" |
| 6 | RB3 overwrote settings changed after C3, without Pi's lock (completeness, safety) | Accepted | `settings-manager.ts:292-345`; `$E3/settings-entry.mjs`; P20, T14, RB3 |
| 7 | The rollback restored the extension before checking that the source could be rolled back (safety) | Accepted | Preflight; order RB2, RB4, RB3, RB1 |
| 8 | Recovery from a failed rebuild depended on another rebuild (safety) | Accepted | `$R/dist-pre-cutover.tar` and its manifest (T15); RB4; rehearsal in Appendix A |
| 9 | The live checklist's Explore agent made the mention check answer "Sent to" (feasibility) | Accepted | T16 reordered; item 2 confirms `model` mode |
| 10 | The smoke wrote transcripts outside its output directory (feasibility) | Accepted | `run-smoke.sh` sets `TMPDIR`; T9's `find` check |
| 11 | The smoke never opened the conversation viewer (validation) | Accepted | `ui/fleet.ts:193-240`; two Downs and the ` close` hint; negative control in Appendix A |
| 12 | The clone's forwarded invocation parameters had no test (validation) | Accepted | T3 case 8 |
| 13 | Fix reports could lose or skip existing tests unnoticed (validation) | Accepted | P16; `$E3/check-identities.mjs` self-tests; Section 9 feeds `T8-F` reports into coverage |

Sections changed: 1, 2.1 (P2, P4, P8, P12, P16, P20), 2.3, 2.4, 3, 6 (T0, T1, T3, T4, T5, T9, T10, T11 to T17, the rollback), 7, 8, 9, Appendix A, Appendix B. Changes made after this pass and not yet reviewed: none; pass 2 reviewed them.

### Pass 2: 2026-09-29, reviewer model openai-codex/gpt-6-astra (re-review)

| Angle | Verdict |
| --- | --- |
| traceability | PASS_WITH_FINDINGS |
| assumptions | PASS_WITH_FINDINGS |
| completeness | PASS_WITH_FINDINGS |
| feasibility | PASS_WITH_FINDINGS |
| validation | PASS_WITH_FINDINGS |
| safety | PASS_WITH_FINDINGS |

Every pass 1 disposition held. New findings:

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | T17 wrote "pi-subagents stays loaded" for a stop at C3, and no state covered a declined or failed rollback step (traceability, completeness) | Accepted | T17's `Outcome`, `Source`, `Build` and `Entry` lines; five rollback rows in "Stopping states" |
| 2 | T5 case 14 hid disabled agents, while P8 and the patch hid only skill-bundled ones (traceability, assumptions) | Accepted: T5 follows P8 | pi-subagents lists existing records of any agent (`src/ui/agent-mention.ts:79-105`); P8, Section 2.3 |
| 3 | The identity check missed a fix report whose file failed to load (assumptions) | Accepted | `$E3/check-identities.mjs` checks file status; self-test in Appendix A |
| 4 | A fix could delete a test the phase added (validation) | Accepted | The check compares a fix's files against the phase run; renames go in `$R/renamed.txt` and `old-cases.md` (P16) |
| 5 | The coverage report list sorted `T8-F1-10` before `T8-F1-2` (feasibility) | Accepted | Section 9 uses `sort -V`; command output in this pass |
| 6 | `/reload` cancelling a pending clone had no test (validation) | Accepted | T4 case 13 |
| 7 | `completed` needed no passing checklist item (validation) | Accepted | `Outcome: completed` requires six passes; `completed, unverified` requires Paolo's acceptance per skipped item |
| 8 | T16 changed the project's `agentMentions` and never restored it (completeness) | Accepted: T16 changes no setting | T16 items 2 and 3 |
| 9 | A failed write in `settings-entry.mjs` could truncate the live settings (safety) | Accepted | The helper writes a `wx` sibling file and renames it; exit 3 on a failed write; fault test in Appendix A |

Sections changed: 2.1 (P8, P16, P23), 2.3, 3, 6 (T4, T5, T14, T16, T17, the rollback's Stopping states), 7, 9, Appendix A, Appendix B. Changes made after this pass and not yet reviewed: none; pass 3 reviewed them.

### Pass 3: 2026-09-29, reviewer model openai-codex/gpt-6-astra (re-review)

| Angle | Verdict |
| --- | --- |
| traceability | PASS_WITH_FINDINGS |
| assumptions | PASS_WITH_FINDINGS |
| completeness | PASS_WITH_FINDINGS |
| feasibility | PASS_WITH_FINDINGS |
| validation | PASS_WITH_FINDINGS |
| safety | PASS_WITH_FINDINGS |

Every pass 2 disposition held. New findings:

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | `renamed.txt` let a fix rename a baseline test, against Section 4 (traceability) | Accepted | The checker refuses a baseline rename; Section 4's exception covers tests this phase added (P16) |
| 2 | A renamed covering test left the coverage check unsatisfiable (feasibility) | Accepted | `check-cases.mjs:181-186`; P16 makes the fix rerun its task's mutation spec |
| 3 | Partial rollbacks, a declined C1 and the snapshot check in Section 9 had no consistent record (traceability, completeness, feasibility) | Accepted | The rollback's four-fact "State" table, preflight per step, `Outcome: not started`, and the conditional manifest check |
| 4 | A provider answering after the abort let a cancelled clone start an agent (assumptions) | Accepted | Reproduced against the probe's build; guard in the clone, Q18, T3 case 12 |
| 5 | The identity check accepted a failed suite whose tests passed (validation) | Accepted | Checker change and self-test; the regression rule requires 0 failed suites |
| 6 | No case covered a late outcome after the session's end or `/reload` (validation) | Accepted | T4 case 16 |
| 7 | T14 compared against a copy taken outside the settings lock (validation) | Accepted | `settings-entry.mjs --save` records both texts under the lock; T14 and RB3 compare those |
| 8 | RB1 could overwrite a file another session recreated (safety) | Accepted | RB1's preflight `test ! -e` of both paths; verification against `$R/cutover-backup.sha256` |

Sections changed: 2.1 (P6, P16), 3, 4, 5 (regression rule 1), 6 (T3, T4, T10, T14, T17, the Cutover rollback), 9, Appendix A, Appendix B. Changes made after this pass and not yet reviewed: the sections just named. Paolo asked for the handoff after this pass; each change follows a verified finding, and the code, checker and helper changes ran their probe checks.

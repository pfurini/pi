# Native subagents, phase 2: the presentation factory

This plan adds the presentation of native subagents as one inline factory in `FORK_OWNED_BUILTINS`: the widget, FleetView, the conversation viewer, `/agents` with settings, the create wizard, eject and the notification renderer. Quit awaits every child's teardown, within a bound. First the plan restructures the service and fixes phase 1 review findings F11, F13, F14 and F15; then it renders `Agent` calls with live progress (F12). The sources are the session-control handoff (D16 to D40) and the phase 1 plan and results. A probe proved the binding, the bounded quit, the keys and the layering. Phases 3 and 4 follow.

## 1. Authority and workflow

| Source | Role |
| --- | --- |
| This plan | The implementation contract. It overrides the source where Section 2 or Section 4 names a difference. |
| `/Users/paolof/Developer/ai/_handoffs/2026-09-26-pi-session-control-consolidated.md` | The source and sole authority for rulings. Section 7 holds D16 to D40; section 14 holds the port's facts. Record any new ruling there as a dated row from D41, never elsewhere. |
| `docs/plans/subagents-native-phase1.plan.md` | Phase 1's contract. Its Section 2.1 defaults stay in force unless Section 2.3 here names a change. Its Section 10 row 2 is this phase's scope. |
| `docs/plans/subagents-native-phase1.results.md` | The phase review findings F11 to F16, and the deviations this plan builds on. |
| `packages/coding-agent/src/core/fork-builtins/subagents/README.md` | The module as phase 1 left it. T16 extends it. |
| `/Users/paolof/Developer/ai/pi-subagents` at `79a7c42` | The feature reference: `src/ui/agent-widget.ts`, `fleet-list.ts`, `conversation-viewer.ts`, `viewer-keys.ts`, `src/agent-color.ts`, `src/agent-file-toggle.ts`, `src/custom-agents.ts` and `src/index.ts`. Read it to learn a behavior; never copy a file wholesale (D16). Its workflow and schedule files are out of scope. |
| `docs/plans/subagents-native-phase2-evidence/old-cases.md` | Every case of the 12 old test files marked `Phase 2`, with the numbered case of this plan that covers it, or a deliberate drop (R7, P25). |
| `docs/plans/subagents-native-phase2-evidence/` | The probe patch, the mutation runner with the probe's spec, the SDK probe, the old-case inventory with its extractor and checker, and the phase identity check (Appendix A, Appendix B). |
| `docs/adr/ADR-0003-fork-first-merge-hygiene.md` | New code in new files; hot upstream files get thin call sites only. |
| `docs/adr/ADR-0008-skill-bundled-agents-scoping.md` | Skill-bundled agents stay hidden from listings and menus. |
| `docs/adr/ADR-0009-built-in-extensions.md` | Built-in kinds, the switch and the settings rule. T16 amends it. |
| `AGENTS.md` (repository) | Git, lockfile, check and test rules. |

The `planning-changes` skill wrote this plan and ran review passes 1 and 2. Pass 1 ran on stale reviewer definitions; pass 2 reran all six angles on the current ones (Review history). A fresh session implements the plan from a handoff prompt, on `feat/subagents-native` in `/tmp/subagents-native`.

## 2. Decisions

### 2.1 User rulings

Paolo made every ruling below; the handoff's section 7 records each D-row.

| # | Ruling | Consequence |
| --- | --- | --- |
| R1 (D16, D17) | pi-subagents is rebuilt as fork-owned code. Kept: the widget, FleetView and the viewer, `/agents`, the create wizard and eject. Workflow and scheduling code stay dropped. | No workflow or schedule row, setting or menu entry exists anywhere in the UI. |
| R2 (D18) | One inline factory in `FORK_OWNED_BUILTINS` carries the presentation. The service imports no presentation code. | T6 adds the factory. T1's layering test keeps `ui/` out of the headless layers. |
| R3 (D20) | Settings live under `forkBuiltins.subagents`. The `/agents` settings menu writes the project `settings.json`. | T15 writes through `writeProjectSubagentSettings`. No other surface writes a settings file. |
| R4 (D21) | The session owns its agents, and its end cancels them. | T6: quit and session replacement await the children's teardown, within the bound of P6. `/reload` keeps the agents. |
| R5 (D22) | Inline built-ins in a child follow its agent's `extensions:`. | T6: a child that loads the factory gets no presentation. |
| R6 (D23) | Phases land on `feat/subagents-native`. `personal` receives them only after phase 3. | Nothing here touches `personal`, the main checkout or `~/.pi/agent/`. |
| R7 (D24) | Tests are new; old tests are a behavior checklist. | Every case of the 12 old files has a status in `$E2/old-cases.md` (P25). |
| R8 (D25, D26) | `agent-session.ts` carries exactly two added lines. | No task edits `agent-session.ts`. Any new upstream-owned line needs a new ruling first. |
| R9 (D27; kept by Paolo on 2026-09-28) | One `code-reviewer` agent reviews each commit; the `super-code-review` skill reviews the phase. Paolo approves which phase findings are applied. | The review gate in Section 6; T18. The gate uses `.pi/agents/code-reviewer.md` (`openai-codex/gpt-6-sol`, thinking `high` since `83af84af2`). |
| R10 (D35) | The compaction gap stays documented and unfixed. F10 is dropped. F15 joins phase 2, placed by the planner. | T4 fixes F15. No task touches the compaction gap or F10. |
| R11 (D36) | Runs stay minimal: each code task runs `npm run check`, its test files and one mutation per new behavior. The phase runs the full coding-agent suite and `./test.sh` once. Three known flakes are ignored everywhere. | Section 5's regression rule; T17. |
| R12 (D37) | The two fork lines in `core/keybindings.ts` spread one fork-owned `FORK_KEYBINDINGS`. It adds four `app.subagents.*` ids; every other key reuses an existing id. The viewer's `q`, `k`, `j` and Shift+arrow aliases are dropped. | T5; T11 and T12 match keys only through ids. |
| R13 (D38) | F11 joins phase 2. | T2. |
| R14 (D39) | An SDK probe alone validates the built outputs. No manual TUI check gates phase 2. | T19 runs `$E2/sdk-probe.mjs`. |
| R15 (Paolo's planning request, 2026-09-28) | The phase 1 checklist's 506 gap lines are reference only. Flaky failures are never raised. | No task exists for a phase 1 gap line. Section 7 names the ones a task covers anyway. |
| R16 (D40) | The create wizard's generate path runs the model with no tools and takes the agent file as text. The wizard parses it, refuses an invalid definition, and writes only the chosen path. | T14; P21. |

**Planner defaults.** Each is reversible; the reason stands next to it.

| # | Item | Default | Reason |
| --- | --- | --- | --- |
| P1 | Module layout | `subagents/ui/` holds `index.ts` (the factory), `format.ts`, `colors.ts`, `tool-renderers.ts`, `notification.ts`, `widget.ts`, `fleet.ts`, `viewer.ts`, `agents-menu.ts`, `create-wizard.ts`, `settings-menu.ts` and `keybindings.ts`. The module root holds the leaves `binding.ts`, `names.ts`, `usage.ts` and `atomic-write.ts`. `service/` gains `sessions.ts`, `queue.ts`, `retention.ts` and `joins.ts`; `tools/` gains `nested.ts` and `details.ts`; `definitions/` gains `files.ts`. | The phase 1 README announces `ui/`. Agent-file edits are definitions logic that the UI calls. |
| P2 | Layers (F14) | Value imports, re-exports and side-effect imports point down only: module root, `definitions/` and `settings/` (0); `runner/` (1); `service/` (2); `tools/` and `adapter/` (3); `ui/` (4). No value import cycle exists. `base-tools.ts` wires the layers: it injects `createNestedTools` and `onServiceCreated` into the service (T1) and attaches the `Agent` renderers (T8). | The phase review's F14 items. The probe reached 0 cycles this way, and mutations P1, P11 and P12 prove the test sees each form (Appendix A). |
| P3 | Session binding | The factory emits two private requests on `pi.events` (`binding.ts`, Appendix B). At load, a child query, which `setLineage` answers on every child loader's bus. At `session_start`, a bind request carrying `ctx.sessionManager`, which the session's adapter answers. | The factory receives only `pi.events`, which forwards to the loader's bus. Base tools install the adapter on that bus. Probe mutations P2 and P3 (Appendix A). |
| P4 | Children | A child session's factory registers nothing. | The parent owns the child's presentation, as pi-subagents returned early in a child (`src/index.ts:335-338`). |
| P5 | Lifecycle | The factory binds at `session_start`. A command, or a `session_shutdown` in a session that never started, binds on demand. Every `session_shutdown` unbinds the UI: timers, subscriptions, terminal input, widgets and the status line. A reason other than `reload` then awaits `shutdown()` of an existing service; it never builds one. | `/reload` invalidates the old context (`agent-session.ts:5686-5687`) but keeps the service (phase 1 M3). Mutations P4 and P5. |
| P6 | `service.shutdown()` | It runs `dispose()`, then waits at most `startupWaitMs` for children still starting: records with a run and no child yet. The option defaults to `CHILD_SHUTDOWN_TIMEOUT_MS` (3 s). It then awaits every teardown started by then, each bounded at 3 s by `teardownChild`. A child that attaches after the wait is torn down when it attaches, and quit does not wait for it (Appendix B). | Pass 1 finding 3: an unbounded wait would let a hung extension factory hang quit. A child running a tool that ignores its abort signal needs no wait: `dispose()` already started its teardown. Mutations P8, P9 and P10. |
| P7 | Surfaces by mode | `tui`: status line, widget, FleetView, viewer and `/agents`. `rpc`: the status line only; `/agents` answers that it needs the interactive TUI. `print` and `json`: no surface; the quit still awaits. In `tui` and `rpc` mode the factory builds the service at `session_start`. | RPC ignores widget factories and its `custom()` returns `undefined` (`rpc-mode.ts:205-207`, `:238-241`). One-way status travels to remote clients (handoff section 8). |
| P8 | Status line | Key `subagents`; text `N running`, then `, M queued` when M > 0, then ` agent` or ` agents` for the total. Set only on a change; cleared when no agent runs or waits. | pi-subagents `src/ui/agent-widget.ts:609-621`. |
| P9 | Tool renderers | T8 sets `renderCall` and `renderResult` on the `Agent` definition in place, from `ui/tool-renderers.ts`, in `base-tools.ts` (Appendix B). A spread copy would read the lazy `description` and `parameters` getters at registration. | Renderers come from the definition (`interactive-mode.ts:2162-2163`). The throwing-proxy test in `base-tools.test.ts` forbids reading the session at registration (phase 1 M5). |
| P10 | Live progress (F12) | A foreground `Agent` call sends `onUpdate` when its record's status, activity, turns, tool uses or usage change, at most once per 100 ms. The result component computes its spinner frame and elapsed time when it renders. | Tool rows call the renderer only on updates but render its component every frame (`tool-execution.ts:308-370`). RPC writes each update as a JSON line (`rpc-mode.ts:365-366`); pi-subagents updated every 80 ms. |
| P11 | Read-only surface (F13) | Public service methods and events hand out `SubagentView`, a read-only type that the internal `SubagentRecord` satisfies. Settings are frozen; definitions and the registry are typed read-only. Accessors replace internal reads: `conversation(id)`, `contextPercent(id)`, `queuePosition(id)` and `ownerBusOf(view)`. | F13 (`records.ts:16-81`, `service.ts:145-150`, `:243-255`). No code outside the service assigns a record field; four readers use internal fields (Section 3). |
| P12 | Settings writer (F13) | `writeProjectSubagentSettings` runs the reader's checks on its values first. Any warning throws, naming the key, and nothing is written. It checks `.pi` and `.pi/settings.json` with `lstat` and refuses a symlink, dangling or not, so a project save never reaches a file outside the project. When `settings.json` does not exist yet, the writer returns the new text and the storage creates the file; a failed first write loses nothing. When the file exists, the storage holds its lock, and the writer replaces the file through `writeFileAtomically` (P27) and returns `undefined`, so the storage writes nothing itself. A failed write leaves an existing `settings.json` byte-identical. | F13: the writer stored values the reader drops (`settings.ts:187-201`). Pass 2: the storage writes in place with `writeFileSync` (`settings-manager.ts:319-345`), so a failure midway could truncate the file, and a symlinked file led a reviewer's scratch save outside the project. A callback that returns `undefined` skips the storage's write, and the storage takes its lock only for an existing file or a write (`:326-339`). |
| P13 | Steer outcome (F11) | `steer` resolves to `delivered`, `queued`, `refused` or `failed`. `subagents:steered` fires for `delivered` and `queued` only. The tool answers `Failed to steer agent: <error>`. | pi-subagents `src/index.ts:3061-3080`. `AgentSession.steer` rejects extension-command text (`agent-session.ts:4155`). |
| P14 | Memory (F15) | Memory refuses a symlink at every path component between its scope root and `MEMORY.md`. The roots are the agent directory (`user`) and the project directory (`project`, `local`). A read-write agent then fails to start and the error names the link; a read-only agent gets no memory content. | F15: only the memory directory and `MEMORY.md` were checked (`memory.ts:31-34`, `:48-54`). |
| P15 | Keys (R12) | FleetView opens on `tui.editor.cursorDown` or `tui.editor.cursorLeft` at an empty, focused editor. Its list uses `tui.select.up`, `down`, `confirm` and `cancel`. The viewer scrolls on `tui.select.up`, `down`, `pageUp` and `pageDown`, closes on `tui.select.cancel` and opens its steer composer on `tui.select.confirm`. Stop, Markdown mode, top and bottom use the `app.subagents.*` ids. FleetView matches through `getKeybindings()`; the viewer and menus through the `keybindings` argument of `ctx.ui.custom`. | AGENTS.md forbids hardcoded key checks. Interactive mode installs the app manager globally (`interactive-mode.ts:623-624`) and passes it to every `custom()` factory (`:2931`). `ctrl+b` also opens FleetView at an empty prompt, because `tui.editor.cursorLeft` includes it (`tui/src/keybindings.ts:82-85`). |
| P16 | Markdown mode key | The viewer's Markdown key changes the mode for the rest of the session. The settings menu persists `viewerMarkdown`. | R3 names the settings menu as the one writer; ADR-0009 forbids other settings writes. |
| P17 | Settings menu writes | The menu writes the project's own subagent values plus the changed key; it never copies a global value into the project. It then reloads the session's `SettingsManager` (`settings-manager.ts:592`) and the service's settings. In an untrusted project it shows the effective values read-only, with a notice. `ui/settings-menu.ts` exports the save step as `saveSubagentSetting`, apart from the list component, so suite tests drive it on a file-backed session. | The reader ignores project values in an untrusted project (`settings.ts:167-176`), so a write there changes nothing and edits an untrusted repository. The suite harness holds an in-memory `SettingsManager` (`harness.ts:123`), which does no file I/O (`settings-manager.ts:455-461`). |
| P18 | Agent-file locations | Project locations (`.pi/agents/`) exist only in a trusted project. Create, eject and the default-agent disable stub otherwise offer only `<agentDir>/agents/`. | The loader reads project agents only when trusted (phase 1 T1). |
| P19 | Definitions refresh | `/agents` calls `service.refreshDefinitions()` before it shows the agent roster, after every successful file change, and after every settings save. When the refresh throws, the menu warns with the error and shows the last good roster. | Phase 1 "Definition refresh". The service starts with an empty user-agent registry (`service/service.ts:216`), and pi-subagents reloaded agents when the menu opened (`src/index.ts:3109-3110`). |
| P20 | Wizard models | Inherit, the session's scoped models (`ctx.scopedModels`), or a typed `provider/model`. | pi-subagents hardcoded stale Anthropic ids (`src/index.ts:3590-3604`). |
| P21 | Wizard generation (R16) | One `session.modelRuntime.completeSimple(model, context)` call with the session's current model, a system prompt that asks for the whole agent file, and the user's description as the only message. The context carries no tools, and no message joins the session. The wizard parses the reply's text with `parseAgentFile(text, source)` for the chosen path. It refuses the reply, and writes nothing, on a parse error, a reserved name, a missing `description:`, any entry in `invalidValues` or any entry in `unknownKeys`; the warning names each reason. A valid file is written per P27. | `model-runtime.ts:664-666`; `definitions/frontmatter.ts:56`. `parseAgentFile` returns a definition together with its invalid values and unknown keys (`frontmatter.ts:40-49`, `:67`, `:113`), so a parse without error is not yet a valid definition (pass 2). The loader ignores an unknown key silently (handoff 14.6), so a misspelled key such as `thinkingLevel` would do nothing; Paolo confirmed refusing unknown keys on 2026-09-28. The feasibility probe ran exactly this call on the faux provider and parsed the reply (Appendix A). |
| P22 | Effective model | The service records the child's model and thinking level when the child attaches. Displays compare them with the requested ones and `invocation.overridden`. | The `agent-model-display` old tests; `settings/models.ts:153-164`. |
| P23 | Test fixtures | A fake UI context is a plain object with own methods. A test that matches `app.*` ids through `getKeybindings()` installs `setKeybindings(new KeybindingsManager())` and restores the previous manager afterwards. | The runner spreads the UI context (`runner.ts:556-565`), so a proxy loses its methods (Appendix A). `getKeybindings()` falls back to TUI ids only (`tui/src/keybindings.ts:315-320`). |
| P24 | Visible assertions | Presentation tests assert visible output: status text, widget lines, rendered rows. None asserts only the absence of an error. | The service swallows listener errors (`service.ts:262-270`); the probe's first widget test failed silently. |
| P25 | Old-case inventory | `$E2/old-cases.md` gives each of the 235 cases of the 12 old files a status: a numbered case `T<n>.<k>` of this plan, `Phase 1` with the covering phase 1 test, or `Dropped: <reason>`. Each task T7 to T13 fills the covering tests of its rows in the commit that adds them. `$E2/check-cases.mjs coverage` checks every row. Phase 1's checklist stays unchanged. | Pass 1 findings 9 and 14: a per-file map left the covered behaviors to the implementer. `extract-old-cases.mjs` parsed the old files with the TypeScript compiler (Appendix A). |
| P26 | Print-mode hold | Documented as a known limitation, not fixed: a `pi -p` run aborts its background agents at exit. | pi-subagents' hold relied on a process-global manager (`src/index.ts:782`, `:861-869`), which phase 1 dropped with `manager-registry-guard`. It lies outside this phase's scope. |
| P27 | Agent-file writes | `$SUB/atomic-write.ts` exports `writeFileAtomically(target, text)`. It creates `<target>.<pid>.tmp` in the target's directory with the exclusive flag `wx`, writes and closes it, then `renameSync`s it over the target. When the temporary path already exists, as a file or a symlink, it refuses and touches nothing there. Otherwise a failed write or rename leaves the target unchanged and removes only the temporary file this call created. Agent-file actions and the settings writer (P12) use it. A failed agent-file write, rename or unlink notifies `error` with the message and changes nothing else. After a successful change, `refreshDefinitions()` runs. When it throws, the change stays on disk, and the menu warns `Saved <path>, but agent definitions did not reload: <error>`. | Pass 1 finding 6: disk and registry could diverge with no truthful message. Pass 2: a temporary name another file already held could be overwritten or deleted. A rename within one directory replaces the file whole. |
| P28 | Mutation records | Each code task lists numbered cases; each case is one new behavior (D36). The task's mutation spec `$R/mutations/<task>.json` holds at least one entry per case, and an entry may name several cases it breaks. Every entry lists concrete test files and the identities it expects to fail (`expect`). An entry is caught only when an expected test fails an assertion; a test file that fails to load is an infrastructure failure and never counts. Only `$E2/mutate.mjs` mutates files; it writes the record `$R/mutations/<task>.txt`, and `check-cases.mjs mutations` checks it. A case with several inventory rows needs entries until each row has a covering test that one of them fails. T20 commits the specs and records under `$E2/mutations/`. | Pass 1 findings 5 and 17; pass 2: an import failure passed as a caught mutation, the runner left test processes running after a SIGTERM, and the records lived only in `/tmp`. The runner now runs each check in its own process group and waits until the group is empty, after a signal and after a normal exit, before it restores the file or starts the next check (Appendix A). |
| P29 | Existing tests | No task removes or renames an existing test: its file and full name stay. A task changes an existing expectation only where it says so. `$E2/check-identities.mjs` checks the phase run: every baseline test and every test of each task's last report is still present, counted with its copies; no test is skipped more often than in the baseline; every failure is a known flake or passes in a repair report. A task's earlier reports are skipped, because a review fix may rename a test the task itself added. | Pass 1 finding 14; pass 2: phase 1's identity check skipped tests with no pass, so a skipped test could vanish, and it ignored task reports and repair reports. Self-tests of the check (Appendix A). |
| P30 | Recorded approvals | Paolo's yes is written down with its date. In `$R/phase-review.md`, an applied finding carries `Approved: <date>, <Paolo's words>` above its `Applied:` line. In `$R/reviews.md`, a Deferred finding names the date of Paolo's yes. | Pass 1 finding 8. |
| P31 | State directory | `$R` holds five read-only files (`chmod a-w`): `personal.ref`, `main-packages.status`, `live-settings.sha256`, `base-1.json` and `base-testsh.log`. Every run output goes to a new path in `$R`. | The planning request names `/tmp/sn2-impl` as the state directory, as phase 1 used `/tmp/sn-impl`. The read-only mode makes an accidental overwrite fail. |
| P32 | Test file lists | A task names its test files as paths relative to `packages/coding-agent`. Patterns such as `test/suite/fork-subagents-*.test.ts` are passed quoted to `tf() { (cd packages/coding-agent && eval "ls -1d $*"); }`, which expands them in the package directory and fails on a pattern that matches nothing. The run passes `$(tf '<pattern>' <file> ...)`. After the run, `node -e 'console.log(require(process.argv[1]).testResults.length)' <report>` prints the number of lines `tf` printed. | Pass 2: commands run from the repository root, where the pattern matches nothing; `failing-tests.mjs` forwards it unchanged, and vitest treats it as a name filter that selects no file. Quoting keeps the shell from expanding the pattern at the root; `tf` behaved the same in bash and zsh (Appendix A). |
| P33 | Record access in tests | `service/service.ts` exports `inspectRecord(service, id)`, marked `@internal`, which returns the internal record. Only tests import it. A test that reads a record's `child`, `parent`, `abort`, `waiters` or `run` goes through it. | T3 hides these fields from views. The probe's tests and five phase 1 suite files read `child` or `parent` from records the service hands out (`fork-subagents-adapter`, `-nested`, `-runner`, `-service`, `-tools`, `-worktree`). |

### 2.2 Source questions

| # | Status | Answer used |
| --- | --- | --- |
| F11: `steer_subagent` reports success when delivery fails | Resolved by R13 | T2. |
| F12: `Agent` sends no live progress | Adopted recommendation: the phase review deferred it to phase 2, which owns the tool's rendering | T8. |
| F13: records, settings and definitions leave the service as live mutable objects | Adopted recommendation: phase 2 defines the UI's read model | T3, before any UI task. |
| F14: service layering and the import cycle | Adopted recommendation: restructure before the UI factory subscribes | T1, the first code task. |
| F15: memory paths follow a symlinked ancestor directory | Resolved by R10 | T4. |
| F16: skill docs still name pi-subagents | Adopted recommendation: the user docs change with the cutover | Phase 3 (Section 10). The live setup still loads pi-subagents until then. |
| Handoff 12.1: D1 graceful cancel has no design | Deferred beyond phase 4 | Abort and a bounded teardown, as in phase 1. |
| Phase 1 gap lines marked for phase 2 | Reference only (R15) | Section 7 names those a task covers anyway. |

### 2.3 Differences from the source

| Source item | This plan | Reason |
| --- | --- | --- |
| D18 lists the mention input hook in the factory | Phase 3 | Phase 1 plan Section 10 puts mentions in phase 3. |
| pi-subagents viewer keys `q`, `k`, `j`, Shift+Up and Shift+Down | Dropped | R12. |
| pi-subagents viewer keys without a keybinding manager fell back to hardcoded keys | Dropped: the viewer always has a manager | `ctx.ui.custom` passes the TUI's manager to every factory (`interactive-mode.ts:2931`), and FleetView reads the one interactive mode installs (`:623-624`). Old cases 159 and 165. |
| pi-subagents' read-only history viewer, opened without stop or steer handlers | The viewer always wires the service's stop and steer, and hides both once the agent stops running | The fork opens the viewer only from the service. Old cases 149 and 156. |
| pi-subagents persisted the viewer's Markdown mode | Session only | P16. |
| pi-subagents wrote the whole settings snapshot to `.pi/subagents.json` | Project values plus the change, under `forkBuiltins.subagents` in `.pi/settings.json` | R3; P17. |
| pi-subagents `/agents` in RPC mode showed empty lists | `/agents` answers that it needs the TUI | P7. |
| pi-subagents' generate path gave a `general-purpose` child every tool and let it write the file | One completion with no tools; the wizard writes | R16 (D40). |
| Hardcoded wizard model ids | Scoped models or a typed id | P20. |
| Foreground progress every 80 ms | Change-driven, at most one update per 100 ms; spinner computed at render | P10. |
| pi-subagents awaited only children that had a session | Also children still starting, for at most 3 s; a later one is torn down at attach, unawaited | P6. |
| pi-subagents ran its widget and FleetView under any UI context | TUI only; RPC gets the status line | P7. |
| Phase 1 built the service on first use | Built at `session_start` in `tui` and `rpc` modes | The status line subscribes to it. `subagents:settings_loaded` fires at that moment. |
| Phase 1 Section 2.3: phase 2's factory awaits child teardown | Only in sessions whose loader includes `FORK_OWNED_BUILTINS` | A custom `ResourceLoader` or an `extensionsOverride` drops inline factories (handoff 14.4). `session.dispose()` alone keeps phase 1's unawaited teardown. |
| The phase review deferred F11 to phase 4 | Phase 2 | R13. |
| Phase 1's checklist mapped each old file as a whole | A per-case inventory (`$E2/old-cases.md`) | P25. |

### 2.4 Approvals

Standing approval, inside `/tmp/subagents-native` only: `npm install --ignore-scripts`, `npm run build:offline`, `npm run check`, `./test.sh`, single test files through `failing-tests.mjs`, mutation runs through `$E2/mutate.mjs` (it restores every file it changes), and `git hook run pre-commit`. Also standing: the per-task commits of Section 6 on `feat/subagents-native`, one `code-reviewer` agent per commit, and the fallback baseline worktree of Section 5 step 3.

These actions always need Paolo's explicit yes:
- any edit, install, build or commit in the main checkout;
- any change to `personal`, including a fast-forward;
- any edit of `~/.pi/agent/settings.json` or other live configuration;
- a `package-lock.json` change (none is expected: phase 2 adds no dependency);
- any change to `agent-session.ts`, or any other new upstream-owned line, which also needs a ruling;
- applying any `super-code-review` finding in T18;
- removing any worktree or deleting any branch.

## 3. Verified facts

The probe ran on 2026-09-28 at `36feafa3e2c6f795a44bc6f370d4169f7dbced79`. The branch then merged `personal`'s commit `83af84af2` as `941bec9ab`, which is this plan's BASE. That commit, made with Paolo's yes, holds the gpt-6 review-agent definitions and the `planning-changes` skill. The merge changes only `.pi/` files, no test reads the repository's own `.pi/`, and `probe.patch` applies at BASE. The probe's results therefore hold at BASE. The change ran in `/tmp/sn2-probe`, a detached worktree; the baselines ran in the clean `/tmp/subagents-native`. Coding-agent ran through `failing-tests.mjs` under `./test.sh` isolation, one run at a time. Under R11 the baseline ran once. Line numbers refer to BASE.

| Fact | Evidence |
| --- | --- |
| BASE differs from the probe's start commit only under `.pi/`. | `git diff --stat 36feafa3e 941bec9ab -- . ':(exclude).pi'` prints nothing |
| No test reads the repository's own `.pi/`. | `grep` over `packages/*/test`: the four matches build synthetic paths (`skills-paths-boost.test.ts:17-19`, `definitions.test.ts:50`, `resource-formatting.test.ts:11`, `skill-arguments.test.ts:226`) |
| `FORK_OWNED_BUILTINS` lists only tokensave. | `fork-builtins.ts:29-31` |
| An inline factory's `pi.events` forwards to the loader's event bus. | `extensions/loader.ts:451-460` |
| Base tools and the skill-fork client receive the same bus. | `agent-session.ts:5638`, `:796` |
| A handler's `ctx.sessionManager` is the session's own `sessionManager`. | `extensions/runner.ts:879-882`; `agent-session.ts:5649-5655` |
| The bus binding works in a harness session with a shared bus, stays inert in a child, and survives `/reload`. | Probe tests; mutations P2, P3 and P5 (Appendix A) |
| The runner wraps a UI context by spreading it, so a fake context needs own methods. | `extensions/runner.ts:551-565`; probe finding (Appendix A) |
| `ctx.ui.custom` hands every factory the TUI's keybinding manager. | `interactive-mode.ts:2931` |
| The service swallows listener errors. | `service/service.ts:262-270` |
| Replacement and quit run `abort()`, `session_shutdown`, then `dispose()`; `AgentSession.shutdown()` does the same. | `agent-session-runtime.ts:166-181`, `:412-420`; `agent-session.ts:1864-1875` |
| `/reload` emits `session_shutdown` with reason `reload`, then invalidates the old runner. | `agent-session.ts:5686-5687` |
| Print mode disposes the runtime after its prompts; nothing holds it for background agents. | `modes/print-mode.ts:42-48` |
| RPC mode ignores terminal input and widget factories, returns `undefined` from `custom()`, and writes every session event. | `modes/rpc/rpc-mode.ts:173-176`, `:205-207`, `:238-241`, `:365-366` |
| Interactive mode takes tool renderers from the definition; a tool row calls them on updates and renders their components every frame. | `interactive-mode.ts:2162-2163`; `core/tools/renderers/index.ts:51-63`; `components/tool-execution.ts:308-370` |
| `dispose()` and a late `attachChild` start child teardowns without awaiting them; `teardownChild` bounds a child's `session_shutdown` at 3 s. | `service/service.ts:640-647`, `:977-983`; `runner/run.ts:378-412` |
| A late-attached child's turn returns at once, because its run's signal is already aborted. | `runner/run.ts:299-302` |
| The bounded `shutdown()` waits for running children's handlers and for a child still starting, and returns while a startup stays blocked past the bound. | Probe tests; mutations P4, P8, P9 and P10; the SDK probe (Appendix A) |
| `core/keybindings.ts` spreads the fork's keys through two added lines. | `core/keybindings.ts:13`, `:81` |
| Replacing the two lines keeps `keybindings.ts` at 19 added and 0 removed lines against the upstream merge base. | `git diff --numstat $(git merge-base HEAD earendil-works/main) -- packages/coding-agent/src/core/keybindings.ts`, before and after the probe |
| Keybinding conflicts come only from user bindings; `tui.editor.cursorLeft` defaults to `left` and `ctrl+b`. | `tui/src/keybindings.ts:243-262`, `:82-85` |
| Interactive mode installs the app keybinding manager globally; `KeybindingsManager.create` reads `keybindings.json` from the agent directory. | `interactive-mode.ts:623-624`; `tui/src/keybindings.ts:309-320`; `core/keybindings.ts:398-403` |
| `tui.getFocusedComponent()` is public, and `SettingsList` handles input. | `tui/src/tui.ts:550`; `tui/src/components/settings-list.ts:222` |
| The module has one value-import cycle and three upward imports. | `service/service.ts:31`; `adapter/skill-agents.ts:23`; `runner/run.ts:23`; `service/nested.ts:25-26`; `runner/scope.ts:25` |
| `service.ts` holds 1,045 lines. | `wc -l` |
| No code outside the service assigns a record field. Four readers use internal fields. | `grep` for assignments (0 hits); `tools/common.ts:51`, `tools/result.ts:123-124`, `tools/steer.ts:44`, `service/nested.ts:263`, `adapter/events.ts:99` |
| `Agent` ignores `onUpdate` and returns no details. | `tools/agent.ts:235`; `tools/common.ts:18` |
| Steer delivery is fire-and-forget, and the tool reports success before delivery. | `service/service.ts:826-840`; `tools/steer.ts:44-45` |
| `AgentSession.steer` rejects extension-command text. | `agent-session.ts:4139`, `:4155` |
| Memory checks only the memory directory and `MEMORY.md` for symlinks. | `runner/memory.ts:14-20`, `:31-34`, `:48-54` |
| The settings writer stores its values without validation. | `settings/settings.ts:187-201` |
| The suite harness builds an in-memory `SettingsManager`, which does no file I/O. `createAgentSessionServices` accepts a caller's settings manager. | `test/suite/harness.ts:123`; `settings-manager.ts:455-461`; `agent-session-services.ts:40`, `:147` |
| A file-backed `SettingsManager` sees a project write after `reload()`, keeps other keys, and ignores it in an untrusted project. | Feasibility probe (Appendix A); `settings-manager.ts:407-411`, `:592` |
| `ModelRuntime.completeSimple` sends one request; `parseAgentFile` parses agent-file text. | `model-runtime.ts:664-666`; `definitions/frontmatter.ts:56`; feasibility probe (Appendix A) |
| A test built through `createAgentSessionRuntime` quits and replaces sessions as the CLI does. | `test/suite/fork-subagents-service.test.ts:501-567` |
| `NotificationDetails` carries no turn count. | `service/notifications.ts:86-98` |
| `tsgo`, run by `npm run check`, fails on an unused `@ts-expect-error` in a test file. | Probe scratch file: TS2578 (Appendix A) |
| Biome forbids an assignment inside an expression, as in `(open = resolve)`. | Probe finding: `lint/suspicious/noAssignInExpressions` (Appendix A) |
| vitest stops a test at 30 s. | `vitest.config.ts:10` |
| pi-tui exports `SettingsList`, `SelectList`, `Markdown`, `Input`, `ScrollView` and `CancellableLoader`. The theme offers `getColorMode`, `getMarkdownTheme`, `getSelectListTheme` and `getSettingsListTheme`. | `tui/src/index.ts:18-39`; `theme/theme.ts:367`, `:1170`, `:1209`, `:1226` |
| The coding-agent baseline has 4,790 tests, 0 failures and 50 pending. `./test.sh` fails only the known flake `exec.test.ts` "captures finite inherited descendant output after the shell exits". | `$R/base-1.json`; `$R/base-testsh.log` (Appendix A) |
| The probe passes `npm run check`, and its full run shows no new failure beyond two known flakes. | Appendix A |
| The built SDK loads the factory, sets the widget under a fake TUI context, and awaits a child's `session_shutdown` on quit. | `$E2/sdk-probe.mjs` against the probe's `dist` (Appendix A) |
| The mutation runner ends the check's whole process group on SIGTERM (SIGKILL after 5 s) and waits until no member is left, then restores the file; it refuses to start after a run that died mid-mutation. It counts a mutation only when an expected test fails an assertion. | Runner checks (Appendix A) |
| `FileSettingsStorage.withLock` writes the settings file in place with `writeFileSync`, and skips the write when its callback returns `undefined`. | `settings-manager.ts:319-345` |
| `parseAgentFile` returns a definition together with its invalid values and unknown keys; neither sets `error`. | `definitions/frontmatter.ts:40-49`, `:113`; reproduced by the pass 2 reviewers |
| The service starts with an empty user-agent registry until its first refresh. | `service/service.ts:216` |
| This vitest reports a test that did not run as `skipped`. | The probe's full-run report: 4,749 passed, 50 skipped, 2 failed |
| A test-file pattern passed from the repository root reaches vitest unexpanded, and vitest reads it as a name filter. | `printf '%s\n' test/suite/fork-subagents-*.test.ts` at the root prints the pattern; `failing-tests.mjs:64-67` forwards it |
| pi-subagents' print-mode hold used a process-global manager registry. | pi-subagents `src/index.ts:782`, `:861-869`; `test/subagents-print-mode-e2e.test.ts:122-162` |

Claims not yet verified, each with the task that verifies it:
- the type-level guards of the read-only surface, the atomic writer and the settings writer's refusals (T3);
- the display formats and colors (T7);
- progress coalescing and render-time animation (T8);
- the widget, viewer and FleetView behaviors (T10 to T12);
- the menus, the atomic writes and the wizard (T13 to T15);
- the SDK probe on the implementation's `dist` (T19).

## 4. Scope

**In scope.**
- Layering and the service split (F14): T1.
- Steer outcomes (F11): T2.
- The read-only service surface, the validated settings writer (F13) and the atomic file writer: T3.
- Memory behind a symlinked ancestor (F15): T4.
- The fork keybinding list and the four viewer ids (R12): T5.
- The presentation factory, its binding, the status line and the bounded quit: T6.
- Display formats, agent colors and the effective model: T7.
- `Agent` rendering and live progress (F12): T8.
- The notification renderer: T9. The widget: T10. The viewer: T11. FleetView: T12.
- `/agents` lists and agent-file actions: T13. The create wizard: T14. The settings menu: T15.
- The README, the ADR-0009 amendment and the full inventory check: T16.
- The phase runs (T17), the phase review (T18), the SDK probe (T19) and the results (T20).

**Out of scope.** Mentions and `mention-clone` (phase 3). F16 and the engine amendment (phase 3). The cutover (phase 3). pi-tasks (phase 4). The compaction gap and F10 (R10). The phase 1 gap lines (R15). The print-mode hold (P26). Graceful cancel (handoff 12.1). D11, and RPC presentation beyond the status line.

**Binding constraints.**

| Constraint | Exception in this plan |
| --- | --- |
| Upstream-owned files get thin call sites only (ADR-0003). | `core/keybindings.ts`: its two fork lines change text (R12). `agent-session.ts` does not change (R8). `docs/keybindings.md` stays untouched. |
| No new runtime dependency and no `package-lock.json` change. | None. |
| The main checkout, `personal` and `~/.pi/agent/` stay untouched (R6). | Setup and the done criteria read them; nothing writes them. |
| Never touch paths this plan did not create. `/tmp/ask-user-question-base-tool` belongs to another session. Do not edit OpenIntent, pi-tasks or pi-subagents. | None. |
| AGENTS.md git rules: explicit paths only; no `reset --hard`, `checkout .`, `clean`, `stash`, `add -A`, `--no-verify`. | None. |
| `vitest.config.ts` keeps `PI_FORK_BUILTINS=off`. | None. |
| The `subagents:*` event names and payloads stay unchanged (D19). | T2 changes only when `subagents:steered` fires. |
| No existing test is removed or renamed (P29). | None. |
| Only `$E2/mutate.mjs` mutates source files (P28). | None. |
| Test-file patterns are expanded in `packages/coding-agent` before a run (P32). | None. |

## 5. Working setup

Every command runs from `/tmp/subagents-native` unless it names another directory. Shorthands:

| Name | Value |
| --- | --- |
| `M` | `/Users/paolof/Developer/ai/pi` (the main checkout) |
| `E` | `docs/plans/subagents-native-phase1-evidence` |
| `E2` | `docs/plans/subagents-native-phase2-evidence` |
| `S` | `$E/failing-tests.mjs` |
| `I` | `$E2/check-identities.mjs` |
| `R` | `/tmp/sn2-impl` |
| `SUB` | `packages/coding-agent/src/core/fork-builtins/subagents` |
| `BASE` | `941bec9ab9acfa5564586318ae988bc6b1e1486b` |

1. `git rev-parse --abbrev-ref HEAD` prints `feat/subagents-native`. `git log -1 --format=%s` prints `docs: native subagents phase 2 plan`. `git rev-parse HEAD~1` prints `$BASE`. `git status --short` prints nothing. Otherwise stop and ask.
2. `test -x .husky/_/pre-commit` exits 0, and `diff -r $M/packages/ai/src/providers/data packages/ai/src/providers/data` prints nothing. Otherwise stop and ask; the planning session prepared both.
3. `ls -l $R` lists `personal.ref`, `main-packages.status`, `live-settings.sha256`, `base-1.json` and `base-testsh.log`, each read-only (P31). `shasum -a 256 $R/base-1.json $R/base-testsh.log` prints Appendix A's hashes. When a baseline is missing or differs, rebuild both, then use the `-b` files and record the substitution in the results file:
   - `git worktree add --detach /tmp/sn2-base $BASE`; when the path exists, stop and ask;
   - copy the providers data into it, then run `npm install --ignore-scripts` and `npm run build:offline` there;
   - `node $S run /tmp/sn2-base packages/coding-agent $R/base-1b.json`;
   - from `/tmp/sn2-base`, `./test.sh > $R/base-testsh-b.log 2>&1`.
4. The protected state matches: `git -C $M rev-parse personal | diff - $R/personal.ref`, `git -C $M status --porcelain=v1 -- packages | diff - $R/main-packages.status` and `shasum -a 256 -c $R/live-settings.sha256` all succeed. `personal.ref` holds `83af84af2`, re-recorded after the agents commit. Otherwise stop and ask; another session may have caused it, so never restore anything.
5. `diff -rq $M/.pi/agents .pi/agents` prints nothing, so the `code-reviewer` the review gate dispatches is Paolo's current one. Otherwise stop and ask.
6. `shasum -a 256 $E2/*` prints the hashes of Appendix B.
7. `mkdir $R/mutations` succeeds. Define `tf` in the shell (P32); `tf 'test/suite/fork-subagents-*.test.ts' | wc -l` prints a number above 0. `npm run build:offline` exits 0.

**Regression rule (R11).**
1. Each code task: `npm run check` exits 0. The test files the task names run as `node $S run /tmp/subagents-native packages/coding-agent $R/<task>-<n>.json $(tf <files>)` (P32), with every pattern quoted, where `n` counts runs from 1. Each report shows 0 failed and covers every listed file. The mutations follow P28:
   - write `$R/mutations/<task>.json`, one entry per numbered case at least, each targeting the task's own code and listing its concrete test files and `expect` identities;
   - `node $E2/mutate.mjs /tmp/subagents-native $R/mutations/<task>.json $R/mutation-state > $R/mutations/<task>.txt` exits 0;
   - `node $E2/check-cases.mjs mutations $R/mutations/<task>.txt <case count>` exits 0.
2. A mutation that makes a test run past 30 s counts as caught when that test is expected: vitest fails the test (`vitest.config.ts:10`).
3. When `mutate.mjs` exits 2 because an earlier run was interrupted, follow its message: confirm with `pgrep -g <group>` that the recorded process group has exited, run the restore command, confirm `git diff` shows only the task's own changes, and rerun.
4. T17 runs the full coding-agent suite once and `./test.sh` once. A known flake's failure is ignored. Every other failure is a regression to fix (D36), as task `T17-R<n>`, whose reports are named `$R/T17-R<n>-<k>.json`. When the fix would change an upstream-owned file, stop and ask first.
5. A known flake's failure triggers no rerun, no solo run and no question.

Run suites one at a time: suites run in parallel produce load-induced failures.

Known flakes (D36):

| Test | Evidence |
| --- | --- |
| `exec.test.ts` "captures finite inherited descendant output after the shell exits" | D36; it failed in `$R/base-testsh.log` and in the probe's full run. |
| Every test in `agent-session-concurrent.test.ts` | D36; handoff 14.5; one failed in the probe's full run. |
| `footer-data-provider.test.ts` "updates the cached branch when the reftable directory changes" | D36; handoff 14.5. |

Environment facts:
- Other Pi sessions run from the main checkout, so it stays read-only for this whole phase.
- A fenced Pi denies `/tmp`; run the implementing session with `pi --unfenced`.
- The live `~/.pi/agent/settings.json` still loads pi-subagents. The implementing session's own `Agent`, `get_subagent_result` and `steer_subagent` tools are therefore the old extension's. They read project agents from `/tmp/subagents-native/.pi/agents`, which step 5 checks.
- Any SDK or CLI run outside the test harness uses an isolated home (T19).
- TokenSave indexes the main checkout at `452d35e62`, which lacks phases 1 and 2. Use `read` and `grep` inside `/tmp/subagents-native` instead.
- The session's task tool may create `.pi/tasks/` in the worktree; git ignores it (`.gitignore:44`).

## 6. Tasks

Shared rules for every code task:
- Tests turn fork built-ins on with `vi.stubEnv("PI_FORK_BUILTINS", "on")`. Suite tests use `test/suite/harness.ts` and the faux provider, never a real provider. A test that needs file-backed settings or real session replacement builds its session through `createAgentSessionRuntime`, as `fork-subagents-service.test.ts:501-567` does. From T3 on, a test that reads a record's child uses `inspectRecord` (P33).
- Fake UI contexts and keybinding managers follow P23. Presentation tests assert visible output (P24).
- Each task's **Cases** are numbered; the case count feeds `check-cases.mjs mutations`. A case that cites old cases (`old 63`) covers those rows of `$E2/old-cases.md`. Tasks T7 to T13 fill the `Covering tests` of their rows in the same commit, and `node $E2/check-cases.mjs coverage $E2/old-cases.md $R/<task>-<n>.json $R/mutations <task>` exits 0 on the task's last report.
- **Review gate (R9).** It applies to every implementation commit: T1 to T16, each `T17-R<n>` and each `T18-F<n>`. T0 and T20 commit only the plan and its results, so they take no review. After validation passes, stage the task's paths explicitly, then dispatch one `code-reviewer` agent on `git diff --cached`. Check each finding against the source. Fix the accepted ones, rerun the task's validation, and restage. Append every finding with its disposition to `$R/reviews.md` under `## <task id>`, one line per finding starting `- `. A disposition is Accepted, Rejected with the disproving source, or Deferred with the date of Paolo's yes (P30). A review with no finding records `- none`. Then commit; the hook runs `npm run check`.
- A commit prints `✅ All pre-commit checks passed!`; when it does not, stop.
- The commit body names the task's test reports and its mutation record.

### T0. Record the plan

The planning session commits this plan and `$E2/` as `docs: native subagents phase 2 plan`. `$E2/` holds eight files: `probe.patch`, `mutate.mjs`, `probe-mutations.json`, `sdk-probe.mjs`, `old-cases.md`, `extract-old-cases.mjs`, `check-cases.mjs` and `check-identities.mjs`.

### T1. Layer the subagents module and split its service (F14)

**Changes.**

| File | Change |
| --- | --- |
| `$SUB/usage.ts`, `$SUB/names.ts` | Moved unchanged from `service/usage.ts` and `tools/names.ts` (`probe.patch`). |
| `$SUB/tools/nested.ts` | The three nested tool builders, moved from `service/nested.ts`; `NestedRuntime` stays (`probe.patch`). |
| `$SUB/service/service.ts` | No import of `adapter/` or `tools/`. `SubagentSessionContext` gains `createNestedTools` and `onServiceCreated` (Appendix B). |
| `packages/coding-agent/src/core/fork-builtins/base-tools.ts` | Passes `createNestedTools: createNestedToolDefinitions` and `onServiceCreated: bridgeServiceEvents` (Appendix B). It attaches no renderer; T8 does. |
| `$SUB/service/sessions.ts` | New. `registerSubagentSession`, `reportSubagentWarning`, `subagentSessionRecord`, `requireService` and `subagentServiceFor` move here from `service.ts`. `existingSubagentService` is added; it never builds a service. |
| `$SUB/service/queue.ts` | New. `SpawnQueue`: the choice of pool, the room check, queueing, draining, removing a queued record and the running counts. |
| `$SUB/service/retention.ts` | New. `Retention`: the sweep, plus `TombstoneStore` moved from `records.ts`. |
| `$SUB/service/joins.ts` | New. The batch window, plus `GroupJoin` moved from `notifications.ts`. |
| `$SUB/definitions/registry.ts` | `loadAgentRegistry` moves here from `service.ts`. It takes `projectTrusted` and the skill list instead of the session. |
| `$SUB/service/records.ts`, `service.ts` | Spawn modes become a union. `SpawnRequest.detached` becomes `mode?: "detached" \| "detached-background"`; absent means an `Agent` call whose `run_in_background` decides. The record's `isBackground` and `blocking` become `mode: "foreground" \| "background" \| "detached" \| "detached-background"`. Event payloads stay unchanged: `subagents:created` still carries `isBackground: true`. |
| `test/fork-builtins/subagents/layering.test.ts` | New (`probe.patch`). |
| Existing tests | Import paths and the spawn-mode field only; no expectation changes (P29). |

**Cases.**
1. The layering test passes; its mutation is the probe's P1 (the service imports `adapter/events.ts` again), which fails both of its tests.

**Validation.**
- `grep -n -E '^export function (registerSubagentSession|subagentServiceFor|existingSubagentService|reportSubagentWarning|requireService|subagentSessionRecord)' $SUB/service/sessions.ts` prints six lines, and the same grep on `$SUB/service/service.ts` prints nothing.
- `grep -n -E '^export class (SpawnQueue|Retention|TombstoneStore|GroupJoin)' $SUB/service/*.ts` prints four lines, none in `service.ts`.
- `grep -n -E '\b(isBackground|blocking)\b|\bdetached\??:|\.detached\b' $SUB/service/*.ts` prints nothing. The pattern matches the old fields and leaves the new mode literals alone (Appendix A).
- `grep -n '^export function loadAgentRegistry' $SUB/definitions/registry.ts` prints one line.
- The test files pass: `$(tf 'test/fork-builtins/subagents/*.test.ts' 'test/suite/fork-subagents-*.test.ts' test/suite/skills-fork.test.ts test/suite/skills-fork-count-symmetry.test.ts test/suite/skill-contract.test.ts test/fork-builtins/base-tools.test.ts test/suite/fork-base-tools.test.ts)` (P32).
- Mutations per the regression rule, with case count 1. `npm run check` exits 0. The results file records `wc -l $SUB/service/service.ts`.

**Commit.** `fix(coding-agent): layer the subagents module and split its service`.

### T2. Report a failed steer (F11, R13)

**Changes.**
- `$SUB/service/service.ts`: `steer(ref, message, owner?)` returns `Promise<SteerOutcome>`, one of `{ kind: "delivered" }`, `{ kind: "queued" }`, `{ kind: "refused"; reason }` and `{ kind: "failed"; error }`. `delivered` means the child's `session.steer` resolved; `failed` means it rejected. `subagents:steered` is emitted for `delivered` and `queued` only. A queued steer that fails when the child starts records `steer failed: <error>` as activity, as today.
- `NestedRuntime.steer` returns the same outcome.
- `$SUB/tools/steer.ts`: `failed` answers `Failed to steer agent: <error>` (pi-subagents `src/index.ts:3079`). The other texts stay.
- `$SUB/tools/nested.ts`: the nested steer answers `Failed to steer nested agent <id>: <error>`.

**Cases** (in `test/suite/fork-subagents-tools.test.ts` and `fork-subagents-nested.test.ts`).
1. A child whose extension registers the command `probe-cmd` rejects a steer whose text is `/probe-cmd`. `steer_subagent` returns text starting `Failed to steer agent:`, no `subagents:steered` reaches the session's bus, and the agent keeps running.
2. A plain steer returns `Steering message sent` and emits exactly one `subagents:steered`.
3. A steer before the child exists answers the queued text, emits one `subagents:steered`, and reaches the child when it starts.
4. The nested `steer_subagent` reports a failed delivery the same way.

**Validation.** Test files: the two above, plus `fork-subagents-adapter.test.ts` and `fork-subagents-service.test.ts`. Mutations with case count 4. `npm run check` exits 0.

**Commit.** `fix(coding-agent): report a subagent steer that fails to deliver`.

### T3. Hand out records, settings and definitions read-only (F13)

**Changes.**

| File | Change |
| --- | --- |
| `$SUB/service/records.ts` | `SubagentView`: read-only `id`, `type`, `definition`, `handle`, `alias`, `description`, `prompt`, `status`, `result`, `error`, `usage`, `toolUses`, `turns`, `compactionCount`, `startedAt`, `completedAt`, `depth`, `parentId`, `mode`, `resultConsumed`, `joinMode`, `toolCallId`, `invocation`, `model`, `cwd`, `fellBackFrom`, `sessionFile`, `transcriptPath`, `worktreePath`, `worktreeOutcome` and `activity`. `SubagentRecord` stays internal to `service/`. |
| `$SUB/service/service.ts` | `get`, `list`, `lookup`, `spawn`, `resume`, `waitForResult` and every event return or carry `SubagentView`. `settings` returns the frozen settings. `registry` returns a read-only registry. New accessors: `conversation(id)` returns `{ messages; subscribe(listener) }` for a record with a child, else `undefined`; `contextPercent(id)`; `queuePosition(id)`; `ownerBusOf(view)`. The `@internal` test accessor `inspectRecord(service, id)` (P33). |
| `$SUB/service/nested.ts`, `$SUB/adapter/*`, `$SUB/tools/*`, `src/core/skills/skill-fork.ts` | Use views and the accessors. None reads a record's `child`, `abort`, `waiters`, `run` or `parent`. |
| `$SUB/atomic-write.ts` | New: `writeFileAtomically(target, text)` (P27). |
| `$SUB/settings/settings.ts` | `readSubagentSettings` returns a frozen object. `writeProjectSubagentSettings` runs `sanitizeSubagentSettings` on its values and throws on any warning, naming the key, before it writes. It refuses a symlinked `.pi` or `settings.json`, and replaces an existing file through `writeFileAtomically` under the settings lock (P12). |
| `$SUB/definitions/types.ts`, `registry.ts` | `AgentDefinition` fields and the registry maps are typed read-only. |
| Tests | New `test/fork-builtins/subagents/views.test.ts` and `atomic-write.test.ts`; new cases in `settings.test.ts` and `service.test.ts`. Every existing test that reads a record's `child`, `parent`, `abort`, `waiters` or `run` switches to `inspectRecord` (P33), with no expectation change. `npm run check` finds each one, because the view type lacks these fields. |

**Cases.**
1. `views.test.ts` holds one `// @ts-expect-error` line per guard: assigning `view.status`, reading `view.child`, assigning `service.settings.maxConcurrent`, calling `service.registry.agents.set` and assigning `definition.name`. Its mutation is a `tsgo` entry (`"tsgo": "TS2578"`) that makes `SubagentView.status` writable.
2. `Object.isFrozen(service.settings)` is true, and a settings reload returns a new frozen object.
3. `conversation(id)` returns the child's messages, calls a subscriber on the child's next message, and returns `undefined` for a queued record.
4. `queuePosition(id)` returns 1 for the first queued record and `undefined` for a running one.
5. The writer throws on `{ maxConcurrent: 0 }` and on `{ unknownKey: 1 }`, naming the key, and `.pi/settings.json` keeps its SHA-256. A valid object writes as before.
6. With `.pi` or `.pi/settings.json` a symlink, to a file outside the project or dangling, the writer throws and the outside file keeps its SHA-256.
7. `writeFileAtomically` leaves the target byte-identical and no temporary file when the directory is read-only or the rename fails (the target is a directory). A pre-existing `<target>.<pid>.tmp`, file or symlink, is neither overwritten nor deleted, and the call refuses.
8. A save into an existing `.pi/settings.json` replaces the file whole (its inode changes) and keeps its other keys. With the rename made to fail, the file stays byte-identical. A save with no `settings.json` creates it.

**Validation.** `grep -rln inspectRecord packages/coding-agent/src | grep -v 'subagents/service/service.ts'` prints nothing. Test files: `$(tf 'test/fork-builtins/subagents/*.test.ts' 'test/suite/fork-subagents-*.test.ts' test/suite/skills-fork.test.ts)` (P32), which includes `views.test.ts`, `atomic-write.test.ts`, `settings.test.ts` and `service.test.ts`. Mutations with case count 8. `npm run check` exits 0.

**Commit.** `fix(coding-agent): hand out subagent records, settings and definitions read-only`.

### T4. Refuse memory behind a symlinked ancestor (F15)

**Changes.** `$SUB/runner/memory.ts` applies P14. Before it reads or creates anything, it checks with `lstat` every existing component below the scope root:
- `agent-memory`, `<name>` and `MEMORY.md` for `user`;
- `.pi`, `agent-memory` or `agent-memory-local`, `<name>` and `MEMORY.md` for `project` and `local`.

A symlink refuses the memory with `Refusing to use subagent memory behind a symlink: <path>`.

**Cases** (in `test/fork-builtins/subagents/memory.test.ts`).
1. A symlinked `agent-memory` (`user`), a symlinked `.pi` (`project`) and a symlinked `agent-memory-local` (`local`) each make the read-write block throw, naming the link, and leave the link's target directory empty.
2. The read-only block for the same layouts holds none of the target's `MEMORY.md` text.
3. A symlinked scope root, the agent directory or the project directory itself, still works.

**Validation.** The existing symlinked-directory and symlinked-file cases still pass. Test files: `memory.test.ts` and `test/suite/fork-subagents-runner.test.ts`. Mutations with case count 3. `npm run check` exits 0.

**Commit.** `fix(coding-agent): refuse subagent memory behind a symlinked ancestor directory`.

### T5. One fork keybinding list with the viewer keys (R12)

**Changes.** `packages/coding-agent/src/core/fork-builtins/keybindings.ts` and `$SUB/ui/keybindings.ts` as in Appendix B. The two lines of `core/keybindings.ts` as in Appendix B. `test/fork-builtins/keybindings.test.ts` from `probe.patch`.

**Cases.**
1. Every `FORK_KEYBINDINGS` id is in `KEYBINDINGS` with its default, and the four `app.subagents.*` ids default to `x`, `m`, `home` and `end`.
2. A binding for `app.subagents.stop` in `keybindings.json` takes effect.

The probe's mutation P6 breaks both cases.

**Validation.**
- `git diff --numstat $BASE -- packages/coding-agent/src/core/keybindings.ts` prints `2	2	packages/coding-agent/src/core/keybindings.ts`.
- `git diff $BASE -- packages/coding-agent/src/core/keybindings.ts | grep -E '^[-+][^-+]'` prints exactly the four lines of Appendix B.
- The `ask_user_question` key tests pass: `test/fork-builtins/ask-user-question/state/key-router.test.ts` and `ask-user-question.listener.test.ts`.
- Mutations with case count 2. `npm run check` exits 0.

**Commit.** `feat(coding-agent): fork keybindings in one list, with the subagent viewer keys`.

### T6. The presentation factory (R2, R4, R5)

**Changes.**

| File | Change |
| --- | --- |
| `$SUB/binding.ts` | As in Appendix B. |
| `$SUB/runner/lineage.ts` | `setLineage` answers the child query (Appendix B). |
| `$SUB/adapter/install.ts` | `servePresentation` joins the listeners installed once per session (Appendix B). |
| `$SUB/service/service.ts` | The `startupWaitMs` option, the bounded `shutdown()` and the late-attach teardown (Appendix B; P6). |
| `$SUB/ui/index.ts` | The factory: the child check, the binding and the lifecycle of P5 (Appendix B), and the status line of P8 in `tui` and `rpc` modes. The probe's string widget, stub command and stub renderer are not kept; T9, T10 and T13 add the real ones. |
| `packages/coding-agent/src/core/fork-builtins.ts` | `{ name: "subagents", factory: subagentsPresentation, hidden: true }` after tokensave. |
| `test/fork-builtins.test.ts` | The registration case from `probe.patch`, without the command and renderer assertions; T9 and T13 add those. |
| `test/suite/fork-subagents-presentation.test.ts` | The cases below, with the fixtures of Appendix B. |
| `test/suite/fork-subagents-service.test.ts` | Case 8, the test of Appendix B. |
| Fixtures after T3 | Appendix B's fixtures come from the probe, which predates T3. Where they read `record.child` (case 8's test, and the probe suite's child-loader check), they read `inspectRecord(service, id)?.child` instead (P33). |

**Cases.**
1. `<inline:subagents>` registers hidden, with no tool (probe mutation P7).
2. A child session's `<inline:subagents>` registers no command, handler or message renderer (P2).
3. A top-level `tui` session shows the status `1 running agent` while one agent runs, and `2 running, 1 queued agents` with three agents under `maxConcurrent: 2`. The status clears when none runs or waits.
4. An `rpc` session shows the same status; a `print` session sets none.
5. Two sessions on one event bus each bind to their own session: each status counts only its own agents.
6. `session.shutdown()` resolves only after a running child's 300 ms `session_shutdown` handler finished (P3, P4).
7. `session.shutdown()` waits for a child still starting (P8, P9).
8. With `startupWaitMs: 200`, `shutdown()` returns while a child's startup stays blocked, and the child's `session_shutdown` handler runs once the startup finishes (P10).
9. A session that never emitted `session_start` still awaits its child on `session.shutdown()`.
10. `/reload` keeps the service and a running agent (P5), and the status still updates afterwards.
11. `AgentSessionRuntime.newSession()` resolves only after the old session's child finished its `session_shutdown` handler. This session loads through `createAgentSessionServices`, whose `DefaultResourceLoader` also loads `<agentDir>/extensions/`. The child's extension is therefore named by the agent file's `extensions:` path, outside that directory, as `$E2/sdk-probe.mjs` does.

The probe's mutations P2 to P5 and P7 to P10 serve as this task's entries for the cases they name.

**Validation.** Test files: the presentation suite, `fork-subagents-service.test.ts`, `test/fork-builtins.test.ts` and `test/fork-builtins/base-tools.test.ts`. Mutations with case count 11. `npm run check` exits 0.

**Commit.** `feat(coding-agent): subagents presentation factory that awaits child teardown on quit`.

### T7. Display formats, agent colors and the effective model

**Changes.**

| File | Change |
| --- | --- |
| `$SUB/ui/format.ts` | Token counts (`33.8k token`, and FleetView's `↓ 13.1k tokens`); context percent with `⇊N` compactions; turns (`↻N≤M`); elapsed time (`1.2s`, and FleetView's whole seconds); status icons; activity text; the model label and tags. The activity text follows pi-subagents `src/ui/agent-widget.ts:225-250`: mapped tool names, repeats grouped ("reading 3 files"), else the response's first line up to 60 characters, else `thinking…`. Cost uses `tools/common.ts` `formatCost`. |
| `$SUB/ui/colors.ts` | `resolveAgentColor` (23 names and `#RRGGBB`) and `renderAgentNameLabel`, following pi-subagents `src/agent-color.ts`. |
| `$SUB/service/*` | The view gains `effective: { model?; thinking? }`, read from the child session when it attaches (P22). |
| Tests | `test/fork-builtins/subagents/ui-format.test.ts`, `ui-colors.test.ts`; the effective-model case in `test/suite/fork-subagents-service.test.ts`. |

**Cases.**
1. `resolveAgentColor` resolves Claude Code names and Agency aliases, normalizes six-digit hex, and rejects other values (old 1, 2).
2. The badge pads the name on a truecolor background with a foreground chosen for contrast (old 3).
3. In 256-color mode, contrast is judged against the quantized color (old 4).
4. The badge restores an enclosing background after itself, and resets the background when the caller paints none (old 5, 6).
5. Without a valid color, the label keeps the theme's styling and shows no badge (old 7).
6. Context percent is dim below 70, warning from 70 and error from 85 (old 63).
7. The compaction count sits beside the percent, and the outer style survives the nested annotation's reset (old 64, 65).
8. `formatCost` keeps distinguishing precision, never pads a round figure, shows nothing for zero, says a tiny cost is tiny, and marks the figure as an estimate (old 79 to 83).
9. Elapsed time: `1.2s`; FleetView's whole seconds, floored at `0s` (old 178, 179).
10. Token counts: `33.8k token`; FleetView's `↓ 13.1k tokens` (old 180).
11. The view's effective model and thinking level come from the child session: an inherited model, and a level the model clamps.

**Validation.** Test files: the two new files and `test/suite/fork-subagents-service.test.ts`. Mutations with case count 11; coverage of rows `T7` as the shared rules say. `npm run check` exits 0.

**Commit.** `feat(coding-agent): subagent display formats and agent color badges`.

### T8. Render Agent calls with live progress (F12)

**Changes.**

| File | Change |
| --- | --- |
| `$SUB/tools/details.ts` | `AgentToolDetails` and its builder from a view: status, display name, color, description, model label, tags, tool uses, turns, maximum turns, tokens, context percent, compactions, cost when `showCost` is on, start time, duration, activity, queue position, error and the background id. |
| `$SUB/service/service.ts` | A `progress` event on a child's tool start and end, turn end and usage. |
| `$SUB/tools/agent.ts` | Results carry details. A foreground call sends `onUpdate` per P10. A queued call's activity reads pi-subagents' `queued — waiting for a foreground slot (N ahead)`. |
| `$SUB/ui/tool-renderers.ts` | `renderCall`: the name badge and the description. `renderResult`, following pi-subagents `src/index.ts:1868-1959`: the raw text for an error or a result without details (#199); a spinner, stats and `⎿ <activity>` while running or queued; `⎿ Running in background (ID: <id>)`; `✓` stats with `⎿ Done` or `⎿ Wrapped up (turn limit)` collapsed, and up to 50 result lines plus a `get_subagent_result` hint expanded; `■` for stopped; `✗` with the error; the reason for aborted. |
| `packages/coding-agent/src/core/fork-builtins/base-tools.ts` | Attaches the renderers in place (P9; Appendix B). |
| Tests | `test/suite/fork-subagents-rendering.test.ts`. |

**Cases.**
1. A foreground call's `onUpdate` receives a running update after its child's first tool call, and no two updates come less than 100 ms apart (fake timers).
2. A queued foreground call reports its position under `maxConcurrentForeground: 1`.
3. An error result renders its error text, and a result without details renders its raw text.
4. The result names the effective model even when the child inherited it, and while streaming before a session exists (old 53, 54).
5. The agent's alias sits beside the model label (old 55).
6. A clamped level shows the session's level and the one asked for (old 56).
7. A level or model the agent file pinned over the caller's is disclosed (#182). A caller's spelling that names the winning model stays quiet; a spelling that names no available model is disclosed; an honored request says nothing (old 57 to 61).
8. A resumed agent renders its reopened session's settings, not the resume call's (old 62).
9. Under `showCost`, the foreground result text names the cost; without it, or for an unpriced model, it names none (old 166 to 168).
10. `get_subagent_result` reports the cost as its own labelled field, and omits it when unpriced (old 169, 170).
11. `renderCall` shows the display-name badge in the agent's color (old 8).
12. The result component shows a different spinner frame when rendered 100 ms later.
13. The result text holds no ANSI escape, so print mode shows no badge.
14. Finished results render by status: `✓` with `⎿ Done` for completed, `✓` with `⎿ Wrapped up (turn limit)` for steered, `■` with `⎿ Stopped`, `✗` with the error, and the aborted reason.
15. Expanded, a completed result shows at most 50 lines, and a longer one ends with the `get_subagent_result` hint.

**Validation.** `test/fork-builtins/base-tools.test.ts` still passes: registration reads nothing from the session. Test files: the new suite, `fork-subagents-tools.test.ts` and `base-tools.test.ts`. Mutations with case count 15; coverage of rows `T8`. `npm run check` exits 0.

**Commit.** `feat(coding-agent): render Agent calls with live progress`.

### T9. Render subagent notifications

**Changes.** `$SUB/ui/notification.ts`, registered by the factory for `subagent-notification`, following pi-subagents `src/index.ts:342-404`. `NotificationDetails` gains `turnCount` and `maxTurns`. The renderer reads `showCost` from the bound session's existing service (`existingSubagentService`) when it renders; without a service it shows no cost, because a render never builds one. `test/fork-builtins.test.ts` asserts the renderer.

**Cases** (in `test/fork-builtins/subagents/ui-notification.test.ts` and `service.test.ts`).
1. Collapsed, the result's first line up to 80 characters after `⎿`; expanded, up to 30 lines.
2. `✗` for error, stopped and aborted; `✓` otherwise, with `completed (steered)` for steered.
3. `transcript: <path>` when the agent wrote one.
4. The stats line shows turns, tool uses, tokens and duration, and the cost under `showCost`.
5. A group renders every member. With `showCost` and two or more priced members, a leading total line appears; none for one member, for unpriced members, or with `showCost` off (old 174 to 177).
6. The model-facing notification carries `<estimated_cost_usd>` only under `showCost` with a priced model (old 171 to 173).

**Validation.** Test files: `ui-notification.test.ts`, `service.test.ts` and `test/fork-builtins.test.ts`. Mutations with case count 6; coverage of rows `T9`. `npm run check` exits 0.

**Commit.** `feat(coding-agent): render subagent notifications`.

### T10. The widget

**Changes.** `$SUB/ui/widget.ts`, following pi-subagents `src/ui/agent-widget.ts`:
- `setWidget("agents", <factory>, { placement: "aboveEditor" })` while an agent runs, waits or lingers; removed otherwise and at unbind;
- heading `● Agents` when any agent is active, else `○ Agents`;
- a running agent takes two lines, a finished one line, and queued agents one summary line;
- at most 12 lines, with priority for running, then queued, then finished rows, and a footer `+N more (x running, y finished)` counting exactly what it hid;
- a completed agent lingers one parent turn and an error two (a turn is the parent's `tool_execution_start`);
- `widgetMode`: `all`, `background` (hides foreground agents) and `off`; nested agents never show;
- `showModel` and `showCost` are read when rendering;
- an 80 ms timer runs only while an agent runs;
- one render reads `service.list()` once and touches no file.

**Cases** (in `test/fork-builtins/subagents/ui-widget.test.ts`, and case 11 in `fork-subagents-presentation.test.ts`).
1. The heading marks activity, and a running agent's rows show the spinner, name, description, stats and `⎿ <activity>` (old 66).
2. `all` shows foreground agents; `background` hides them and shows background and detached ones; `off` shows nothing; nested agents never show (old 67, 68, 70 to 72, 78).
3. Under `showModel`, a running row names the model and thinking level, with the short label, and discloses a level the run did not honor; without it, the row is unchanged (old 73 to 76).
4. Queued agents share one summary line, and finished agents stay visible (old 77).
5. The cost sits beside the token count when enabled, stays after the agent finishes, and shows for an agent nobody tracks live; it is hidden when disabled, for an unpriced model, and by default (old 84 to 89).
6. The widget never exceeds 12 lines, for any fleet shape. Its footer counts exactly what it hid. The queued summary stays visible, ahead of finished lines. A fleet that fits shows no footer, and a resumed agent's completion line returns (old 90 to 96).
7. Finished rows: `✓` completed, `✓` with ` (turn limit)` for steered, `■` stopped, `✗` error with at most 60 characters of it, and aborted.
8. A completed agent lingers one parent turn, and an error two.
9. A render touches no file (spies on `node:fs`), and one frame reads `service.list()` a constant number of times (old 230, 235).
10. A running row shows the colored display name (old 9).
11. An RPC-spawned background agent shows with its live activity.
12. The 80 ms timer runs only while an agent runs, and unbind removes the widget and the timer.

**Validation.** Mutations with case count 12; coverage of rows `T10`. `npm run check` exits 0.

**Commit.** `feat(coding-agent): subagent widget above the editor`.

### T11. The conversation viewer

**Changes.** `$SUB/ui/viewer.ts`, following pi-subagents `src/ui/conversation-viewer.ts`:
- an overlay through `ctx.ui.custom`: `anchor: "center"`, `width: "90%"`, `maxHeight: "70%"`;
- a header with the status icon, the name badge, the description, tools, duration, tokens with context percent, and cost under `showCost`; an invocation line `↳ provider/model · tags`;
- a body from `service.conversation(id)`, rendered again on each child message: `[User]`, `[Assistant]` in Markdown per mode, `[Tool: <name>]`, `[Result]` capped at 16,000 characters with the notice outside any code fence, and capped bash output;
- one Markdown component per message, cached; auto-scroll until the user scrolls up;
- keys per P15; a steer composer (`Input`) that calls `service.steer` and shows a `failed` outcome; stop on two presses of `app.subagents.stop`; Markdown mode per P16;
- every line fits the width.

**Cases** (in `test/fork-builtins/subagents/ui-viewer.test.ts`).
1. The invocation line names the model with its provider, falls back to the short label, discloses a model and level the run did not honor, and is absent without an invocation (old 97 to 100).
2. The header shows the cost when enabled, and none when disabled or unpriced (old 101 to 103).
3. `tui.select.cancel` closes the viewer when not composing (old 104).
4. No line exceeds the width, for every content kind and at narrow widths; bordered rows stay exact-width at a double-width boundary; overwidth lines from a buggy wrap are clamped (old 105 to 116, 141 to 145).
5. Assistant Markdown renders by default and stays verbatim under `off`. Tool results stay byte-exact by default, render under `all`, and stay dim on both paths. Ordered lists keep their numbers, and Markdown renders to fit (old 117 to 121, 135, 136, 139).
6. `app.subagents.markdownMode` cycles the mode for the session and shows it in the footer (old 122, 123).
7. The footer's navigation hints stay intact at 80 columns (old 125).
8. Stop needs two presses of `app.subagents.stop`; any other key, the Markdown key included, disarms it; no stop once the agent stops running (old 124, 146 to 148).
9. A tool result is capped at 16,000 characters. The notice sits outside any code fence it cut into, and gives the exact omitted count, abbreviated and rounded to fit. A growing result is tracked past the cap, a shorter one stays untouched, and bash output follows the same rule (old 126 to 130, 132 to 134).
10. An unsafe streaming prefix falls back to literal wrapping once; a streaming message renders again; one Markdown per message is reused, and its cache survives a frame (old 131, 137, 138, 234).
11. For a running agent, `tui.select.confirm` opens the steer composer. It sends the trimmed text and closes, cancels on `tui.select.cancel`, and returns on an empty submit. While open it owns the scroll keys; it fits the width, and it is absent once the agent stops (old 150 to 155, 157).
12. A failed steer shows its error.
13. Keys come from the manager: user bindings apply, a default manager behaves as the defaults, removing a default key disables it, `ctrl+p` bound to `tui.select.up` scrolls, and `app.subagents.stop` rebound to `s` stops (old 158, 161 to 163).
14. Render cost grows linearly with the message count, on the raw and the Markdown path (old 232, 233).
15. A render touches no file (old 231).
16. The header shows the colored display name (old 11).
17. `app.subagents.top` and `app.subagents.bottom` jump; auto-scroll follows new messages until the user scrolls up.
18. A new child message renders without reopening the viewer.

**Validation.** Mutations with case count 18; coverage of rows `T11`. `npm run check` exits 0.

**Commit.** `feat(coding-agent): subagent conversation viewer`.

### T12. FleetView

**Changes.** `$SUB/ui/fleet.ts`, following pi-subagents `src/ui/fleet-list.ts` without workflow rows:
- a `belowEditor` widget `fleet`, shown while `fleetView` is on and at least one agent has a session;
- rows: `main`, then agents in start order; an agent without a session is hidden; a finished agent lingers 4 s; at most 5 rows, with `↑ N more` and `↓ N more`; right-aligned elapsed time, tokens and cost;
- keys per P15, matched through `getKeybindings()`; key releases ignored (`isKeyRelease`); the list steals no key while another component has focus (`tui.getFocusedComponent()`);
- `tui.select.confirm` opens the viewer as an overlay; closing it restores the cursor on that agent, even when the list reordered; the viewer stays open when its agent finishes;
- a 200 ms tick runs only while the list shows.

**Cases** (in `test/fork-builtins/subagents/ui-fleet.test.ts`, and cases 1 and 12 in `fork-subagents-presentation.test.ts`).
1. No widget without agents; the widget appears once a spawned agent has a session, and quit clears it (old 181, 229).
2. Nested agents and agents without a session are hidden (old 182, 201).
3. `tui.editor.cursorDown` or `tui.editor.cursorLeft`, `ctrl+b` included, opens the list at an empty focused editor and consumes the key; editor text keeps it closed; key releases are ignored (old 183 to 186).
4. The list steals no key from a focused selector, opened before or while the list is active; it opens with the editor focused, and assumes the editor when focus is unknown (old 195 to 198).
5. The selection moves and clamps, `tui.select.up` above `main` closes the list, `tui.select.cancel` closes it, and other keys pass through and close it (old 189 to 192).
6. With `fleetView` off, the list ignores input and hides; the tick re-arms when it shows again (old 193, 194).
7. The selected row takes the theme's text color, and keeps its badge, bolded, without shifting (old 187, 188).
8. Rows show markers, type, description and right-aligned stats, oldest first; overflow collapses into `↓ N more`; no line exceeds the terminal; the window keeps the selection visible (old 199, 200, 202 to 204).
9. `tui.select.confirm` on `main` closes the list. After the viewer closes, the cursor returns to the viewed agent. The viewer steers through `service.steer` with the agent's id, gets the Markdown setting, and stays open when its agent finishes. A finished agent lingers 4 s (old 205 to 210).
10. The cost follows the token count when enabled, is absent when disabled or unpriced, and does not change when the agent finishes (old 211 to 213).
11. A row shows the colored display name (old 10).
12. The bound factory captures terminal input (old 228).

**Validation.** Mutations with case count 12; coverage of rows `T12`. `npm run check` exits 0.

**Commit.** `feat(coding-agent): FleetView agent list below the editor`.

### T13. `/agents` lists and agent-file actions

**Changes.**

| File | Change |
| --- | --- |
| `$SUB/definitions/files.ts` | `enableInContent`, `disableInContent`, `isDisabledContent`, `isEmptyStub`, `locateAgentFile`, `serializeAgentDefinition` (eject) and `buildNewAgentFile` (T14), following pi-subagents `src/agent-file-toggle.ts`. The serializer writes snake_case keys and is the parser's inverse. Every write goes through `writeFileAtomically` (T3, P27). |
| `$SUB/ui/agents-menu.ts` | `/agents` in `tui` mode; any other mode answers that it needs the interactive TUI. The top menu: `Running agents (N)` when any exist, `Agent types (N)`, `Create new agent`, `Settings`; each submenu returns to it. Running agents open the viewer. Agent types list in a `SettingsList`: `•` project, `◦` global, `✕` disabled, the model label as value; skill agents never show (ADR-0008). The per-agent menu offers what applies: edit, delete, reset to default, eject, disable, enable. Each confirms destructive steps, writes per P18 and P27, refreshes per P19 and notifies. |
| `test/fork-builtins.test.ts` | Asserts the `agents` command. |
| Tests | `test/fork-builtins/subagents/agent-files.test.ts`; `test/suite/fork-subagents-agents-menu.test.ts` with a scripted UI. |

**Cases.**
1. `enableInContent` strips `enabled: false` as the first, a middle or the last frontmatter line, reports no change when there is nothing to strip, keeps the body and other keys, and handles CRLF (old 12 to 17).
2. `disableInContent` inserts `enabled: false`, is idempotent wherever the key sits, never writes a file the loader cannot parse, reports a file without frontmatter, handles CRLF, and keeps a BOM where it was (old 18 to 24).
3. `isDisabledContent` sees the key anywhere in the block, in a CRLF file, not in an enabled file, and agrees with the loader (old 27 to 31).
4. A file the loader reads as disabled can be enabled, and disable then enable returns the original file (old 32, 33).
5. `isEmptyStub` recognizes the stub, also behind a BOM, and rejects real frontmatter (old 34 to 36).
6. `locateAgentFile` prefers `.pi/agents`, then `.agents/agents`, then the personal directory. It uses the file the loader read and classifies its location. It probes `<type>.md` for a default, falls back when the recorded path is gone, and finds nothing when neither resolves (old 37 to 45).
7. Parsing the eject of each default agent, and of a fixture that sets every frontmatter key, gives back the same definition fields.
8. `buildNewAgentFile` round-trips a description, also one with a colon or a `#`. It keeps a `provider/model:thinking` suffix and a model with a colon-space or `#`. It writes only the fields the wizard set, and keeps the system prompt as the body (old 46 to 52).
9. In an untrusted project, eject and the default-agent disable stub offer only the personal location.
10. Disabling a default agent writes the stub, and the next spawn of that name follows `fallbackSubagent`; enabling deletes the empty stub.
11. Edit writes only a changed text; delete and reset unlink only after a confirm.
12. `/agents` in `rpc` mode notifies and opens nothing.
13. A write into a read-only directory leaves the target unchanged, leaves no temporary file, and notifies `error`.
14. When `refreshDefinitions()` throws after a successful write (`strictAgentFiles` with a broken sibling file), the change stays on disk and the menu warns with the error.
15. Running agents open the viewer; agent types show their markers; skill agents never show.
16. Opening `/agents` before any spawn lists an existing project agent; reopening after an agent file was added on disk lists it too (P19).
17. A failed rename (the target path is a directory) leaves the target and no temporary file, and notifies `error`.
18. A failed unlink (delete in a read-only directory) notifies `error` and leaves the file in place.
19. A pre-existing `<target>.<pid>.tmp`, file or symlink, makes the action refuse and stays untouched.

**Validation.** Test files: the two new files and `test/fork-builtins.test.ts`. Mutations with case count 19; coverage of rows `T13`. `npm run check` exits 0.

**Commit.** `feat(coding-agent): /agents lists, edits, ejects and toggles agents`.

### T14. The create wizard (R16)

**Changes.** `$SUB/ui/create-wizard.ts`, following pi-subagents `src/index.ts:3451-3636` except where R16 differs. It asks for the location (P18) and the method.
- Generate: a description, a name, an overwrite confirm when the file exists, the notice `Generating agent definition...`, then the completion of P21. It ends with `Created <path>`, or a warning naming why nothing was written.
- Manual: a name, a description, tools (`all`, `none`, `read-only`, or a typed list), a model (P20), a thinking level (`inherit` or a level) and the system prompt in the editor. It writes `buildNewAgentFile`'s text.
- A name with a space, a `:` or a path separator is refused. Every write follows P27 and triggers `refreshDefinitions()`.

**Cases** (suite, with a scripted UI).
1. The manual path writes the expected file, and the new agent is spawnable at once.
2. The generate path sends one request that carries no tools, adds no message to the session, writes the parsed file, and the agent is spawnable.
3. A reply that fails to parse, or has no `description:`, writes nothing and warns with the reason.
4. The model step lists the session's scoped models.
5. An untrusted project offers only the personal location.
6. Declining the overwrite confirm leaves the existing file unchanged.
7. Names with a space, a `:` or a path separator are refused.
8. A reply that parses but carries an invalid documented value (`max_turns: -1`, `thinking: banana`) or an unknown key writes nothing, and the warning names each one (R16, P21).

**Validation.** Mutations with case count 8. `npm run check` exits 0.

**Commit.** `feat(coding-agent): /agents create wizard`.

### T15. The settings menu

**Changes.** `$SUB/ui/settings-menu.ts`: a `SettingsList` in `ctx.ui.custom`, and the exported `saveSubagentSetting` (P17). The list shows the 22 keys of `SubagentSettings` in pi-subagents' order (`src/index.ts:3705-3900`, without the scheduling and workflow keys). Booleans and enums cycle. Numbers are typed in an input, re-asked until they pass the reader's checks. `fallbackSubagent` offers the enabled types and `none`. A change saves per P17, then shows pi-subagents' per-key toast. A failed write shows a warning with the error and changes nothing.

**Cases.** Suite cases build a file-backed session through `createAgentSessionRuntime` with `SettingsManager.create(projectDir, agentDir, { projectTrusted })`.
1. Saving `maxConcurrent` writes only that key into the project's own values, copies no global value, and leaves every other key's parsed value deep-equal.
2. After the save, `service.settings.maxConcurrent` holds the new value, and `subagents:settings_changed` fires once.
3. An out-of-range number is asked again.
4. An untrusted project shows the notice and writes nothing.
5. A project `settings.json` that holds no JSON object shows the warning and changes nothing.
6. Each key's change shows pi-subagents' toast, for example `Cost display enabled`.
7. The list shows the 22 keys in order, and a boolean toggles through `SettingsList.handleInput` (module test with a mock TUI).
8. Saving `disableDefaultAgents: true` refreshes the definitions, so the agent roster drops `general-purpose`, `Explore` and `Plan` (P19).

**Validation.** Mutations with case count 8. `npm run check` exits 0.

**Commit.** `feat(coding-agent): /agents settings menu writes the project settings`.

### T16. Documentation and the full inventory check

**Changes.**
- The module README gains these sections:
  - `## Presentation`: the factory and its binding, the surfaces per mode, the lifecycle and the bounded quit;
  - `## Keys`: the four `app.subagents.*` ids and the reused ones;
  - `## /agents`: the menus, the trust rules, the atomic writes and the wizard's no-tool generation (D40).
- Its known limitations gain the print-mode hold (P26) and a child that starts after quit's wait. Its later-phases table drops phase 2.
- An ADR-0009 amendment dated on the day of the task. It covers the second inline factory `<inline:subagents>`, `FORK_KEYBINDINGS` (D37) with the unchanged two-line footprint, and the subagent settings writer the menu now uses (D20).

**Validation.**
- For each term `app.subagents.stop`, `app.subagents.markdownMode`, `app.subagents.top`, `app.subagents.bottom`, `FORK_KEYBINDINGS`, `session_shutdown`, `/agents`, `widgetMode`, `fleetView`, `viewerMarkdown` and `D40`, `grep -cF "<term>" $SUB/README.md` prints at least 1.
- For each term `D37`, `FORK_KEYBINDINGS` and `<inline:subagents>`, `grep -cF` on the ADR prints at least 1.
- `node $E2/check-cases.mjs inventory $E2/old-cases.md` exits 0 and reports `rows: 235`.
- Run every file the inventory's covering tests name: `node $S run /tmp/subagents-native packages/coding-agent $R/T16-1.json <files>`. `node $E2/check-cases.mjs coverage $E2/old-cases.md $R/T16-1.json $R/mutations` exits 0, and exits 1 on a copy with one identity misspelled.
- `npm run check` exits 0.

**Commit.** `docs: native subagents phase 2 README and ADR-0009 amendment`.

### T17. Phase test runs (R11)

**Changes.** None. Run `node $S run /tmp/subagents-native packages/coding-agent $R/phase.json`, then `./test.sh > $R/phase-testsh.log 2>&1`, one after the other.

**Validation.**
- `node $S diff $R/base-1.json $R/phase.json` lists no new failure other than a known flake.
- With `ids() { grep -E '(^| )FAIL |^✖ |ℹ fail ' "$1" | sed -E 's/ \([0-9.]+ ?m?s\)$//' | sort -u; }`, `diff <(ids $R/base-testsh.log) <(ids $R/phase-testsh.log)` shows no added line other than a known flake. With `pkgs() { grep -E '^> @earendil-works/.* test$' "$1" | sort; }`, `diff <(pkgs $R/base-testsh.log) <(pkgs $R/phase-testsh.log)` prints nothing.
- Every failure other than a known flake becomes task `T17-R<n>` under the regression rule and the review gate, committed as `fix(coding-agent): <failure>`. Its reports `$R/T17-R<n>-<k>.json` hold the failing identity's file and the test files of every task whose files its diff touches. A report that shows the identity passing discharges the failure.
- `node $I $R/base-1.json $R/phase.json $R` exits 0 (P29): no baseline or task-report test is missing, none is skipped more often, and every failure is a known flake or discharged by a repair report.

### T18. Phase review

**Changes.** Run the `super-code-review` skill over `$BASE..HEAD` (R9), with this plan and the handoff as the spec. Write `$R/phase-review.md` with the first line `Verdict: <the skill's verdict>`. Check each finding against the source. Record it as a heading `### F<n>: <one line>` followed by one line `Disposition: Accepted`, `Disposition: Rejected: <disproving source>` or `Disposition: Deferred: <reason>`. Present the verdict and the dispositions to Paolo, and wait for his yes per accepted finding to apply. Record each yes as `Approved: <date>, <Paolo's words>` under its heading (P30). Each applied finding is its own code task `T18-F<n>` under the regression rule and the review gate, committed on its own, and gets `Applied: <commit hash>` under its heading. Its test run holds the test files of every task whose files its diff touches.

**Validation.** With `P=$R/phase-review.md`:
- `head -1 $P | grep -c '^Verdict: .'` prints `1`.
- `grep -c '^### F[0-9]' $P` equals `grep -c '^Disposition: ' $P`.
- `for h in $(sed -n 's/^Applied: //p' $P); do git merge-base --is-ancestor "$h" HEAD || echo "missing $h"; done` prints nothing.
- `awk '/^### F/{f=$0; a=0} /^Approved: /{a=1} /^Applied: /{if (!a) print f}' $P` prints nothing.

Whether a disposition is right stays Paolo's judgment.

**Commit.** One per applied finding, `fix(coding-agent): <finding>`; none when nothing is applied.

### T19. Validate the built outputs (R14)

**Changes.** None; `$E2/sdk-probe.mjs` exists since T0. First check that `packages/coding-agent/dist/index.js` exports `createAgentSession`, `SettingsManager`, `SessionManager` and `ModelRuntime`, and that `@earendil-works/pi-ai` exports `getCurrentSystemPrompt`; when one is missing, stop and ask.

**Validation.** Run `npm run build:offline`. Then `mkdir $R/home`, which must succeed, and with `H=$R/home`:
- `env -i PATH="$PATH" HOME=$H PI_CODING_AGENT_DIR=$H/.pi/agent node $E2/sdk-probe.mjs packages/coding-agent/dist on` exits 0;
- the same with `PI_FORK_BUILTINS=off` and mode `off` exits 0;
- mode `off` without the switch exits 1.

Afterwards `shasum -a 256 -c $R/live-settings.sha256` passes, `ls -A $H` prints nothing, and `git status --short` prints nothing.

### T20. Record the results

**Changes.** `docs/plans/subagents-native-phase2.results.md`:
- the commits;
- one section `### T<n> <title>` per task T1 to T16, and one for T19;
- in each code-task section, `Tests: <each report path from $R and its counts>`, `Mutations: <the record path, its entry count and its restored line>` and `Review:` followed by that task's `- ` lines from `$R/reviews.md`, copied verbatim;
- in T16's section, `Review:` with its lines;
- in T19's section, the probe's three JSON lines;
- a `## Phase runs` section with T17's counts and every `T17-R<n>`;
- a `## Phase review` section with `$R/phase-review.md` verbatim, then each `T18-F<n>` with its tests, mutation record and review lines;
- the deviations.

It also copies every `$R/mutations/*.json` and `*.txt` to `$E2/mutations/`, so later phases can rerun the coverage check.

**Validation.** With `F=docs/plans/subagents-native-phase2.results.md`:
- `for h in $(git log --format=%h $BASE..HEAD); do grep -qF "$h" $F || echo "missing $h"; done` prints nothing.
- `for t in T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15 T16; do awk -v t="### $t" '$0 ~ "^"t"( |$)"{f=1;next} /^#{2,3} /{f=0} f' $F > $R/sec.txt; grep -q '^Review:' $R/sec.txt || echo "$t lacks Review"; [ $t = T16 ] && continue; grep -qE '^Tests: [^ ]' $R/sec.txt || echo "$t lacks Tests"; grep -qE '^Mutations: [^ ]' $R/sec.txt || echo "$t lacks Mutations"; done` prints nothing.
- `for c in "T1 1" "T2 4" "T3 8" "T4 3" "T5 2" "T6 11" "T7 11" "T8 15" "T9 6" "T10 12" "T11 18" "T12 12" "T13 19" "T14 8" "T15 8"; do set -- $c; node $E2/check-cases.mjs mutations $E2/mutations/$1.txt $2 > /dev/null || echo "$1 mutations incomplete"; done` prints nothing.
- `for f in $E2/mutations/T17-R*.txt $E2/mutations/T18-F*.txt; do [ -e "$f" ] || continue; node $E2/check-cases.mjs mutations "$f" 1 > /dev/null || echo "$f incomplete"; done` prints nothing.
- `for f in $R/mutations/*; do cmp -s "$f" $E2/mutations/$(basename "$f") || echo "not copied: $f"; done` prints nothing.
- `grep -E '^- ' $R/reviews.md | grep -vxFf $F` prints nothing.
- `grep -v '^$' $R/phase-review.md | grep -vxFf $F` prints nothing.

**Commit.** `docs: native subagents phase 2 results`, holding the results file and `$E2/mutations/`.

## 7. Test plan

| Layer | What it proves | When it runs |
| --- | --- | --- |
| Module tests `test/fork-builtins/subagents/*.test.ts` | Layering, views, memory, formats, colors, notifications, the widget, the viewer, FleetView and agent files, with a mock theme and TUI | Each task that touches them; T17 |
| Suite tests `test/suite/fork-subagents-*.test.ts` | Real parent and child sessions: binding, lifecycle, bounded quit, steer outcomes, rendering and progress, the menus, the wizard and file-backed settings | Each task that touches them; T17 |
| `test/fork-builtins.test.ts` | The factory's list entry and registrations | T6, T9, T13; T17 |
| `test/fork-builtins/keybindings.test.ts` | The fork ids reach Pi's table and take user bindings | T5; T17 |
| `views.test.ts` under `npm run check` | The read-only surface at compile time | Every commit, through the hook |
| Mutation records (`$E2/mutate.mjs`, `check-cases.mjs mutations`) | Every numbered case has a mutation that one of its expected tests catches with a failed assertion | Each code task; T20 |
| Inventory coverage (`check-cases.mjs coverage`) | Every kept old case has passing tests that its case's mutation breaks | T7 to T13 per task; T16 in full; the done criteria |
| Identity check (`$E2/check-identities.mjs`) against `base-1.json`, the task reports and the repair reports | No test disappeared or became skipped, and every failure is a flake or repaired (P29) | T17 |
| Built SDK (T19) | The built outputs carry the factory and the bounded quit; the switch removes them | T19 |
| Footprint check | `agent-session.ts` unchanged against `$BASE`; `keybindings.ts` changes exactly the two lines of Appendix B | T5, T17, and after every later upstream merge |
| Protected-state check | `personal`, the main checkout's `packages/` status and the live `settings.json` match setup | Done criteria |

The probe confirmed mutations P1 to P12 (Appendix A).

**Old-test inventory (R7).** `$E2/old-cases.md` gives each of the 235 cases a status:

| Status | Cases |
| --- | --- |
| T7 | 18 |
| T8 | 16 |
| T9 | 7 |
| T10 | 28 |
| T11 | 67 |
| T12 | 36 |
| T13 | 39 |
| Phase 1 (covered by `definitions.test.ts`) | 2 |
| Dropped | 22 |

The drops are:
- 14 workflow-row cases of `fleet-list` and one of `agent-widget` (R1);
- the `k`, `j` and Shift+arrow aliases (R12);
- the fallback without a keybinding manager (Section 2.3);
- the read-only viewer without stop or steer handlers (Section 2.3);
- one check of the old test's own mock.

Rows 122 and 208 keep their case but lose the Markdown mode's persistence (P16).

Phase 1 gap lines marked for phase 2 that a task covers anyway (R15):
- `child-session-shutdown` "quit waits for the child's shutdown handlers to finish" (T6);
- the `agent-file-bom` toggles and the `custom-agents` eject cases (T13);
- the `agent-manager` model relabels and `model-resolver` "describeModel" (T7);
- `agent-tool-error-rendering`, and `subagents-print-mode-e2e` "a colored agent's name badge never reaches print-mode text" (T8);
- the `rpc-lifecycle-gating` widget cases (T10);
- the settings toasts and the save failure (T15).

**Not proved by this plan.**
- A live TUI with a real model and terminal (R14); phase 3's cutover is the first live use.
- RPC clients rendering the status line. Fenced runs. OpenIntent workers. Mentions.
- The print-mode hold (P26).
- The teardown of a child that starts after quit's wait finished before the process exits.
- A full-suite comparison at the final head after `T17-R<n>` and `T18-F<n>` fixes: D36 runs the full suites once, before the review. Each fix runs the test files of every task its diff touches. A further full run would need a ruling beyond D36.
- Performance beyond the perf cases.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| A custom `ResourceLoader` or an `extensionsOverride` drops `<inline:subagents>`, and with it the presentation and the awaited quit. | Documented (Section 2.3, T16). `dispose()` still ends every child, as in phase 1. |
| A child whose startup outlasts quit's 3 s wait is torn down after quit returns; a process that exits at once cuts its handlers short. | Bounded by design (P6); T6 case 8 tests both sides of the bound; T16 documents it. |
| Two sessions share one event bus. | The bind request carries the session manager; T6 case 5 tests it. |
| UI code runs from service events outside any handler, so a stale context throws, and the service swallows it. | The factory unbinds at every `session_shutdown`. Tests assert visible output (P24). T6 case 10 tests the status after `/reload`. |
| FleetView takes cursor keys, `ctrl+b` included, at an empty prompt. | Only with an empty, focused editor (P15); every key is a configurable id. |
| The settings menu reloads the whole `SettingsManager`. | `/reload` makes the same call (`agent-session.ts:5688`); T15 case 1 checks that other keys stay deep-equal. |
| A generated agent file carries instructions the user did not intend. | The wizard parses and shows the path; the model had no tool to act with (R16). |
| Rendering cost grows with long transcripts and many agents. | The perf cases in T10 and T11. |
| Upstream merges touch the two `keybindings.ts` lines. | The footprint check in Section 7. |
| An SDK run on this machine loads the live pi-subagents. | T19 runs with an isolated home and checks the live settings hash afterwards. |
| An interrupted mutation run leaves a broken source file, or a test subprocess that keeps writing. | `mutate.mjs` ends the check's process group and waits until it is empty, restores the file, and refuses to run again until the recorded file is restored (Appendix A). |

## 9. Done criteria

- These commits exist on `feat/subagents-native`, each with its Section 6 message: T0, T1 to T16, every `T17-R<n>`, every applied `T18-F<n>`, and T20. `git log --oneline $BASE..HEAD` lists them.
- `npm run check` exits 0 at the last commit.
- T17's runs show no failure beyond the known flakes, or each other failure is discharged by its `T17-R<n>` report. `node $I $R/base-1.json $R/phase.json $R` exits 0.
- `git diff --numstat $BASE -- packages/coding-agent/src/core/agent-session.ts` prints nothing.
- `git diff $BASE -- packages/coding-agent/src/core/keybindings.ts | grep -E '^[-+][^-+]'` prints exactly the four lines of Appendix B.
- With `REPORTS=$R/phase.json$(for f in $R/T17-R*-*.json; do [ -e "$f" ] && printf ',%s' "$f"; done)`, `node $E2/check-cases.mjs coverage $E2/old-cases.md $REPORTS $E2/mutations` exits 0.
- T20's mutation loops print nothing.
- T19's three runs exit 0, 0 and 1, and the results file holds their JSON lines.
- The protected state matches setup: `git -C $M rev-parse personal | diff - $R/personal.ref`, `git -C $M status --porcelain=v1 -- packages | diff - $R/main-packages.status` and `shasum -a 256 -c $R/live-settings.sha256` all succeed. On a difference, stop and ask; never restore anything.

## 10. Later phases

| Order | Item | Prerequisite |
| --- | --- | --- |
| 3 | Mentions (input hook, autocomplete, clone); F16 (the skill docs name the native provider); the engine amendment; one fast-forward of `personal` with removal of the pi-subagents `settings.json` entry (R6) | Phase 2, and a verified worker-side exclusion of `Agent`, `get_subagent_result` and `steer_subagent` accepted by the workflow work |
| 4 | pi-tasks on the typed service | Phase 3 |
| Unassigned | The print-mode hold (P26) | A ruling that schedules it |

## Appendix A. Probe measurements

The probe started at `36feafa3e2c6f795a44bc6f370d4169f7dbced79` on 2026-09-28; BASE `941bec9ab` differs only under `.pi/` (Section 3). Baselines ran in `/tmp/subagents-native`; the probe ran in `/tmp/sn2-probe`.

| Run | Tests | Failed | Pending |
| --- | --- | --- | --- |
| base-1 (coding-agent) | 4,790 | 0 | 50 |
| probe-1 (layering, factory, keys, renderers) | 4,799 | 0 | 50 |
| probe-2 (the late-attach teardown) | 4,800 | 0 | 50 |
| probe-3 (the bounded `shutdown()` and its test) | 4,801 | 2, both known flakes: `agent-session-concurrent.test.ts` "should queue extension-origin steering messages while streaming" and `exec.test.ts` "captures finite inherited descendant output after the shell exits" | 50 |
| base `./test.sh` | coding-agent 1 failed, 4,739 passed, 50 skipped; 12 packages ran | `exec.test.ts` "captures finite inherited descendant output after the shell exits" (a known flake) | |

- `failing-tests.mjs diff base-1 probe-2`: no failures. `test-identities.mjs base-1 probe-2`: 0 missing, 0 failing, 10 added.
- `failing-tests.mjs diff base-1 probe-3` lists only the two known flakes above; D36 ignores them with no rerun. `test-identities.mjs base-1 probe-3`: 0 missing, 11 added, and the same two flakes failing.
- `npm run check` exited 0 on the final probe. Pass 2 changed only the probe's layering test: its two tests passed alone, `npm run check` exited 0 again, and the probe's diff is `probe.patch`.
- `$R/base-1.json` SHA-256 `da99b4234015fecda0eb3ca27f601da4db86490b2f17f4d8ba852caf9bbfab7b`. `$R/base-testsh.log` SHA-256 `adb9d2e3a1b3511de23cee26a198f303910fc3b72426a5269a8963cc3e8fc96a`.
- `tsgo --noEmit` on a scratch test file reported TS2578 for an unused `@ts-expect-error` and accepted a used one. The file was deleted.

Findings the probe made:
1. A fake UI context built as a `Proxy` lost `setWidget`, because the runner spreads the context it wraps (`runner.ts:556-565`). The widget test then failed with no error, because the service swallows listener errors. Plain objects fixed the fixture (P23, P24).
2. The first SDK probe run quit before the child session existed. The child attached after `dispose()` and was torn down unawaited, so `quitAwaited` was false. A late `attachChild` now joins the awaited teardowns.
3. Pass 1 found that an unbounded wait for a starting child could hang quit, while the 3 s bound let a slower child escape unawaited. `shutdown()` now waits only for children still starting, bounded by `startupWaitMs`. The test of Appendix B proves both sides: quit returns while the startup is blocked, and the child's handler runs once it attaches.
4. Biome's `noAssignInExpressions` refused `new Promise((resolve) => (open = resolve))` in a test; a block body passes.
5. A mutation runner built on `spawnSync` ignored SIGTERM until the whole run ended. `mutate.mjs` uses `spawn`, so a signal stops the test process and restores the file at once.

Feasibility checks, in a scratch test that was then deleted:
- A `SettingsManager.create(dir, agentDir, { projectTrusted: true })` read `maxConcurrent` 10, still read 10 after `writeProjectSubagentSettings(dir, { showCost: true, maxConcurrent: 3 })`, and read 3 after `reload()`. The file kept its other key. An untrusted manager on the same file read 10.
- `harness.session.modelRuntime.completeSimple(model, { systemPrompt, messages })` returned the faux reply, `parseAgentFile` read its `description`, `tools` and body, and the session held no message afterwards.
- Pass 2: `parseAgentFile` on the probe's `dist`, for a file with `thinking: banana`, `max_turns: -1` and `thinkingLevel: high`, returned a definition, no `error`, two `invalidValues` entries and `unknownKeys: ["thinkingLevel"]` (P21).
- Pass 2: `tf 'test/suite/fork-subagents-*.test.ts' test/suite/skills-fork.test.ts` printed 7 paths in bash and in zsh, and a pattern that matched nothing exited 1 in both (P32).

Mutation runner checks:
- A SIGTERM 4 s into a run stopped the test process, restored the file to its SHA-256, removed the backup and the marker, and left no stray vitest process or scratch directory.
- A state directory with a marker made the runner exit 2 with the restore command and the recorded process group, touching nothing.
- A `tsgo` entry that made a field `string` reported `1 of 1 failed, caught` with TS2322, and restored the file.
- Pass 2: an entry whose module throws at load reported `0 of 0 failed, not caught` with a `! <file failed to run>` line, and the runner exited 1. `check-cases.mjs mutations` rejected that record.
- Pass 2: a test that spawns a subprocess, adapted from the safety reviewer's probe (`/tmp/sn2-plan/sa2-check/check.mjs`). The interrupted runner left a subprocess alive or writing in all three scenarios. The final runner exited 143 on SIGTERM with the source restored and no marker, and the subprocess neither survived nor wrote late, also when it ignored SIGTERM. After a normal run, the runner ended the subprocess the test left behind before it moved on.

Mutations, from `$E2/probe-mutations.json` run by `$E2/mutate.mjs` on the final probe:

| Mutation | Failing tests |
| --- | --- |
| P1: `service.ts` imports `adapter/events.ts` again | both layering tests |
| P2: a child's loader answers no child query | "registers nothing in a child session" |
| P3: the adapter answers no bind request | the widget test and both quit tests |
| P4: quit does not await the child teardown | both quit tests |
| P5: `/reload` ends the agents | "keeps the service and its running agent across /reload" |
| P6: the subagent keys leave `FORK_KEYBINDINGS` | both keybinding tests |
| P7: `FORK_OWNED_BUILTINS` omits the factory | the registration test in `fork-builtins.test.ts` |
| P8: a child that attaches after `dispose()` is torn down unawaited | "makes quit wait for a child that is still starting" |
| P9: `shutdown()` does not wait for children still starting | "makes quit wait for a child that is still starting" |
| P10: `shutdown()` waits for a starting child without a bound | "waits for a starting child only up to its bound, and tears it down when it attaches later" |
| P11: `service.ts` re-exports presentation code | "imports only from its own or a lower layer" |
| P12: `service.ts` imports presentation code for its side effects | "imports only from its own or a lower layer" |
| Restored | 37 of 37 pass; `clean: yes`; exit 0; every entry `caught` by an expected test |

The corrected T1 patterns matched 6 exports and 21 old-field lines on the probe, matched all four old field forms in a sample, and matched none of the new `mode` literals.

Old-case inventory: `extract-old-cases.mjs` listed 235 cases in the 12 files. `check-cases.mjs inventory` reported 235 rows and no offending row. On a sample, `check-cases.mjs coverage` flagged a row whose test no mutation of its case caught, an unknown `Phase 1` identity and an unfilled row. It passed the good rows, with and without a task filter. Pass 2: with a phase report in which a covering test failed, `coverage` exited 1; with a repair report listed after it, where the test passed, it exited 0.

Identity check (`check-identities.mjs`), on copies of `base-1.json`, `probe-3.json` and a task report. It exited 0 for the unchanged phase run, and for a failure that a repair report shows passing. It exited 1 for a removed pending baseline test, a non-flake failure with no repair, a missing test of a task report, a newly skipped test, and a test missing from a task's last report. A test present only in a task's earlier report did not count.

SDK probe against the probe's `dist`, with an isolated home:

```text
{"switch":"unset","mode":"on","sources":{"Agent":"<builtin:Agent>","get_subagent_result":"<builtin:get_subagent_result>","steer_subagent":"<builtin:steer_subagent>"},"presentation":{"loaded":true,"command":true,"renderer":true},"widget":true,"quitAwaited":true,"errors":[],"pass":true}
{"switch":"off","mode":"off","sources":{"Agent":"none","get_subagent_result":"none","steer_subagent":"none"},"presentation":{"loaded":false,"command":false,"renderer":false},"widget":false,"quitAwaited":false,"errors":[],"pass":true}
{"switch":"unset","mode":"off","sources":{"Agent":"<builtin:Agent>","get_subagent_result":"<builtin:get_subagent_result>","steer_subagent":"<builtin:steer_subagent>"},"presentation":{"loaded":true,"command":true,"renderer":true},"widget":false,"quitAwaited":false,"errors":[],"pass":false}
```

The runs exited 0, 0 and 1. The isolated home stayed empty, and the live `settings.json` kept its hash.

## Appendix B. Verified code

Evidence files, with SHA-256:

| File | SHA-256 |
| --- | --- |
| `docs/plans/subagents-native-phase2-evidence/probe.patch` | `5dfc07b31b01b86ffa63edc04a06b754fa9ddd73e02ad0e4df9819e6aa10e8d9` |
| `docs/plans/subagents-native-phase2-evidence/mutate.mjs` | `6b83f2323b644e205c144cf79b85d8675c869300043f49a4d09920ea9eb0d0d1` |
| `docs/plans/subagents-native-phase2-evidence/probe-mutations.json` | `8a1fd43731fa65569e7243560873a7895001c08389f1d517e960053afb015c8f` |
| `docs/plans/subagents-native-phase2-evidence/sdk-probe.mjs` | `75c44b1f5164fded6ea61b7708e5a3fb52a8d24df46be1d324c1a376e769671a` |
| `docs/plans/subagents-native-phase2-evidence/old-cases.md` | `56ed8653b207b6104406846d28223df50bd6be76ab9b36b921d19e409b81892e` |
| `docs/plans/subagents-native-phase2-evidence/extract-old-cases.mjs` | `408cf67fee571432f6e1bce4378490741ed0fe34597e4aeea39de74a61bab5f5` |
| `docs/plans/subagents-native-phase2-evidence/check-cases.mjs` | `530c8af5d56fcd916306eeeedaac634044d965c37af49bc7326dddb838bbff09` |
| `docs/plans/subagents-native-phase2-evidence/check-identities.mjs` | `e432708b4611cba2342c5a81a80d9624fce60c0ec515f98571876400140db614` |

`probe.patch` is the probe's final diff against its start commit, and `git apply --check` accepts it at BASE. It is a spike, not the implementation: its factory sets a string widget and registers a stub command, a stub renderer and stub tool renderers, which T6, T8, T9 and T13 replace. The fragments below are copied verbatim from it.

`subagents/binding.ts` (T6):

```ts
/**
 * Fork-owned: how the presentation factory (`ui/`) finds its session (probe). The factory receives
 * only an extension API, whose `pi.events` forwards to the loader's event bus. Base tools install the
 * bus adapter on that same bus, so the factory asks over it:
 *
 * - At load, it emits a `ChildSessionQuery`. The runner answers on every child loader's bus, so a
 *   child session's factory registers nothing.
 * - At `session_start` or `session_shutdown`, it emits a `PresentationBindRequest` with its context's
 *   session manager. The adapter of the session that owns that manager answers with the session.
 *
 * Both channels are private to this module; emit is synchronous, so the answer is set on return.
 */
import type { AgentSession } from "../../agent-session.ts";

export const CHILD_SESSION_QUERY_CHANNEL = "fork-subagents:child-session-query";
export const PRESENTATION_BIND_CHANNEL = "fork-subagents:presentation-bind";

export interface ChildSessionQuery {
	child: boolean;
}

export interface PresentationBindRequest {
	/** The asking context's session manager, which tells apart sessions that share one bus. */
	readonly sessionManager: unknown;
	session?: AgentSession;
}
```

`runner/lineage.ts`, the child query's answer (T6):

```ts
export function setLineage(bus: EventBus, lineage: ChildLineage): void {
	// Once per bus: the child's presentation factory asks while it loads, before the child session exists.
	if (!lineages.has(bus)) {
		bus.on(CHILD_SESSION_QUERY_CHANNEL, (query) => {
			(query as ChildSessionQuery).child = true;
		});
	}
	lineages.set(bus, lineage);
}
```

`adapter/install.ts`, the bind request's answer, installed with the other per-session listeners (T6):

```ts
function servePresentation(session: AgentSession, bus: EventBus): () => void {
	return bus.on(PRESENTATION_BIND_CHANNEL, (raw) => {
		const request = raw as PresentationBindRequest;
		if (request.sessionManager === session.sessionManager) request.session = session;
	});
}
```

`service/service.ts`, the option, the bounded shutdown and the late attach (T6). The option and its field:

```ts
	stragglerTimeoutMs?: number;
	/** How long `shutdown()` waits for children still starting; `CHILD_SHUTDOWN_TIMEOUT_MS` by default. */
	startupWaitMs?: number;
```

```ts
	private readonly teardowns: Promise<void>[] = [];
	private readonly startupWaitMs: number;
```

```ts
		this.startupWaitMs = options.startupWaitMs ?? CHILD_SHUTDOWN_TIMEOUT_MS;
```

```ts
	/**
	 * Ends every agent as `dispose()` does, then waits at most `startupWaitMs` for children still
	 * starting, and resolves once every teardown started by then has settled: each child's
	 * `session_shutdown` handlers ran or hit their 3 s bound, and its session and loader are disposed.
	 * A child that attaches after the wait is torn down when it attaches; `shutdown()` does not wait
	 * for it. The presentation factory awaits `shutdown()` from the parent's `session_shutdown` (D21).
	 */
	async shutdown(): Promise<void> {
		const starting = [...this.records.values()].flatMap((record) =>
			record.run && !record.child ? [record.run] : [],
		);
		this.dispose();
		// A child still being built attaches after dispose(), which starts its teardown there (attachChild).
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			Promise.allSettled(starting),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, this.startupWaitMs);
				timer.unref?.();
			}),
		]);
		clearTimeout(timer);
		// Read after the wait, so it holds the teardowns of children that attached during it.
		await Promise.allSettled(this.teardowns);
	}
```

```ts
		// The owner ended while the child was being built: nothing may keep it.
		if (this.disposed) {
			this.teardowns.push(teardownChild(child));
			return;
```

`dispose()` pushes each teardown into `this.teardowns` where phase 1 wrote `void teardownChild(record.child)`.

`service/service.ts`, the context hooks, and `base-tools.ts`, which fills them (T1):

```ts
	createNestedTools?(runtime: NestedRuntime): ToolDefinition[];
	/** Called once with the service when it is built; `base-tools.ts` attaches the bus adapter's event bridge. */
	onServiceCreated?(service: SubagentService): void;
```

```ts
		forkBaseToolNames: () => forkBaseToolNames(definitions),
		// The wiring layer injects what the headless service must not import (F14).
		createNestedTools: createNestedToolDefinitions,
		onServiceCreated: bridgeServiceEvents,
	});
```

`base-tools.ts`, the renderer attachment (T8):

```ts
	// The renderers live with the presentation (ui/); the tool definition stays headless.
	addOwned(definitions, AGENT_TOOL_NAME, () =>
		withAgentToolRenderers(createAgentToolDefinition(options.session, subagents)),
	);
```

`ui/index.ts`, the child check, the binding and the shutdown handler (T6):

```ts
export default function subagentsPresentation(pi: ExtensionAPI): void {
	// A child's presentation is its parent's: the child registers no command, renderer or handler.
	const query: ChildSessionQuery = { child: false };
	pi.events.emit(CHILD_SESSION_QUERY_CHANNEL, query);
	if (query.child) return;

	let session: AgentSession | undefined;
	let unbind: (() => void) | undefined;

	const resolve = (ctx: ExtensionContext): AgentSession | undefined => {
		if (session) return session;
		const request: PresentationBindRequest = { sessionManager: ctx.sessionManager };
		pi.events.emit(PRESENTATION_BIND_CHANNEL, request);
		session = request.session;
		return session;
	};
```

```ts
	pi.on("session_shutdown", async (event, ctx) => {
		unbind?.();
		unbind = undefined;
		// `/reload` keeps the session, its service and its agents (phase 1 plan M3).
		if (event.reason === "reload") return;
		const bound = resolve(ctx);
		await (bound ? existingSubagentService(bound) : undefined)?.shutdown();
	});
```

`fork-builtins.ts`, the list entry (T6):

```ts
	{ name: "subagents", factory: subagentsPresentation, hidden: true },
```

`core/keybindings.ts`, the two changed lines, as removed and added lines (T5):

```diff
-import { ASK_USER_QUESTION_KEYBINDINGS } from "./fork-builtins/ask-user-question/keybindings.ts";
+import { FORK_KEYBINDINGS } from "./fork-builtins/keybindings.ts";
-	...ASK_USER_QUESTION_KEYBINDINGS,
+	...FORK_KEYBINDINGS,
```

`fork-builtins/keybindings.ts` (T5):

```ts
/**
 * Fork-owned: every keybinding the fork's built-ins add (D37). `core/keybindings.ts` spreads
 * `FORK_KEYBINDINGS` into `KEYBINDINGS` through its two fork lines, so a later built-in adds its keys
 * here, with no edit of an upstream-owned file.
 */
import { ASK_USER_QUESTION_KEYBINDINGS } from "./ask-user-question/keybindings.ts";
import { SUBAGENT_KEYBINDINGS } from "./subagents/ui/keybindings.ts";

export const FORK_KEYBINDINGS = {
	...ASK_USER_QUESTION_KEYBINDINGS,
	...SUBAGENT_KEYBINDINGS,
};
```

`subagents/ui/keybindings.ts` (T5):

```ts
/**
 * Fork-owned: the conversation viewer's own keys (D37). `fork-builtins/keybindings.ts` merges them into
 * `FORK_KEYBINDINGS`, which `core/keybindings.ts` spreads into `KEYBINDINGS`, so users rebind them in
 * `keybindings.json` like any other Pi key. Every other key the presentation handles reuses an
 * existing id.
 */
import type { KeybindingDefinition } from "@earendil-works/pi-tui";

export const SUBAGENT_KEYBINDING_IDS = {
	stop: "app.subagents.stop",
	markdownMode: "app.subagents.markdownMode",
	top: "app.subagents.top",
	bottom: "app.subagents.bottom",
} as const;

type SubagentKeybindingId = (typeof SUBAGENT_KEYBINDING_IDS)[keyof typeof SUBAGENT_KEYBINDING_IDS];

declare module "@earendil-works/pi-tui" {
	interface Keybindings {
		"app.subagents.stop": true;
		"app.subagents.markdownMode": true;
		"app.subagents.top": true;
		"app.subagents.bottom": true;
	}
}

export const SUBAGENT_KEYBINDINGS = {
	[SUBAGENT_KEYBINDING_IDS.stop]: { defaultKeys: "x", description: "Stop the viewed subagent (press twice)" },
	[SUBAGENT_KEYBINDING_IDS.markdownMode]: {
		defaultKeys: "m",
		description: "Cycle the subagent viewer's Markdown mode",
	},
	[SUBAGENT_KEYBINDING_IDS.top]: { defaultKeys: "home", description: "Scroll the subagent viewer to the top" },
	[SUBAGENT_KEYBINDING_IDS.bottom]: { defaultKeys: "end", description: "Scroll the subagent viewer to the bottom" },
} satisfies Record<SubagentKeybindingId, KeybindingDefinition>;
```

Test fixtures in `test/suite/fork-subagents-presentation.test.ts` (T6):

```ts
/** A child extension whose `session_shutdown` handler takes 300 ms, then records that it finished. */
function writeSlowShutdownExtension(harness: Harness): void {
	const dir = join(harness.tempDir, "extensions");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "slow-shutdown.ts"),
		'export default function (pi) {\n\tpi.on("session_shutdown", async () => {\n\t\tawait new Promise((resolve) => setTimeout(resolve, 300));\n\t\tglobalThis.__sn2Presentation.shutdownDone = true;\n\t});\n}\n',
	);
}

/** A child extension that takes 300 ms to load, so its child is still starting when the parent quits. */
function writeSlowStartExtension(harness: Harness): void {
	const dir = join(harness.tempDir, "extensions");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "slow-start.ts"),
		'export default async function (pi) {\n\tawait new Promise((resolve) => setTimeout(resolve, 300));\n\tpi.on("session_shutdown", async () => {\n\t\tawait new Promise((resolve) => setTimeout(resolve, 100));\n\t\tglobalThis.__sn2Presentation.shutdownDone = true;\n\t});\n}\n',
	);
}
```

```ts
/** A TUI context that records the `agents` widget. Own properties only: the runner spreads the context it wraps. */
function recordingUi() {
	const widgets: Array<string[] | undefined> = [];
	const ui = {
		notify: () => {},
		setStatus: () => {},
		onTerminalInput: () => () => {},
		setWidget: (id: string, content: string[] | undefined) => {
			if (id === "agents") widgets.push(content);
		},
	} as unknown as ExtensionUIContext;
	return { ui, widgets };
}
```

T6 case 8, in `test/suite/fork-subagents-service.test.ts`:

```ts
	it("waits for a starting child only up to its bound, and tears it down when it attaches later", async () => {
		const harness = await parent();
		let open!: () => void;
		const opened = new Promise<void>((resolve) => {
			open = resolve;
		});
		const gate = { opened, shutdowns: 0 };
		(globalThis as { __sn2Gate?: typeof gate }).__sn2Gate = gate;
		cleanups.push(() => {
			open();
			delete (globalThis as { __sn2Gate?: typeof gate }).__sn2Gate;
		});
		// Extensions load for this agent, so its child's loader runs the gated extension below.
		writeFileSync(
			join(harness.tempDir, "agents", "gated.md"),
			"---\ndescription: gated\ntools: read\n---\nYou are gated.",
		);
		mkdirSync(join(harness.tempDir, "extensions"), { recursive: true });
		writeFileSync(
			join(harness.tempDir, "extensions", "gate.ts"),
			'export default async function (pi) {\n\tawait globalThis.__sn2Gate.opened;\n\tpi.on("session_shutdown", () => {\n\t\tglobalThis.__sn2Gate.shutdowns++;\n\t});\n}\n',
		);
		const subagents = service(harness, { startupWaitMs: 200 });
		const record = await subagents.spawn({
			type: "gated",
			prompt: "gated task",
			description: "gated task",
			params: { run_in_background: true },
		});
		const started = Date.now();
		await subagents.shutdown();
		expect(Date.now() - started).toBeLessThan(2000);
		expect(record.child, "the child is still starting").toBeUndefined();
		expect(gate.shutdowns).toBe(0);
		open();
		await vi.waitFor(() => expect(gate.shutdowns).toBe(1), CHILD_START);
	});
```

The layering test (`test/fork-builtins/subagents/layering.test.ts`), the keybinding test and the presentation suite are in `probe.patch` in full.

## Review history

### Pass 1: 2026-09-28, reviewer model openai-codex/gpt-5.6-sol (stale definition)

The six reviewers ran on the worktree's committed `plan-reviewer.md`, which still named `openai-codex/gpt-5.6-sol` with thinking `medium`. Paolo's current definition names `openai-codex/gpt-6-astra` with thinking `high`. It reached the branch with the merge `941bec9ab` after this pass. The next pass reruns all six angles on the current definition.

| Angle | Verdict |
| --- | --- |
| Traceability | PASS_WITH_FINDINGS |
| Assumptions | FAIL |
| Completeness | PASS_WITH_FINDINGS |
| Feasibility | PASS_WITH_FINDINGS |
| Validation | FAIL |
| Safety | FAIL |

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | Traceability: the plan exempted non-flaky baseline failures, against D36. | Accepted | Handoff D36: "Any other failure is a regression to fix." Section 5 rule 4, T17 and Section 9 now allow only the three flakes. |
| 2 | Traceability: the fallback without a keybinding manager was dropped outside Section 2.3. | Accepted | `interactive-mode.ts:2931`. Section 2.3 row; old cases 159 and 165. |
| 3 | Assumptions, blocking: `shutdown()` could return before a late-starting child attached, leaving its handlers unawaited. | Accepted | `Promise.allSettled` reads its array once. P6 now states the bound, `startupWaitMs` makes it testable, T6 case 8 proves both sides, and mutation P10 guards it (Appendix A). |
| 4 | Assumptions: T15 relied on the harness, whose settings manager does no file I/O. | Accepted | `harness.ts:123`; `settings-manager.ts:455-461`. T15 builds a file-backed session; `saveSubagentSetting` is exported; the feasibility probe proved the write and reload (Appendix A). |
| 5 | Completeness and validation, blocking: tasks named fewer mutations than behaviors (D36). | Accepted | Every code task now has numbered cases; P28, the spec-driven `mutate.mjs`, `check-cases.mjs mutations` and T20's loop check one caught mutation per case. |
| 6 | Completeness: agent-file actions had no partial-failure behavior. | Accepted | P27; T13 cases 13 and 14; T14 cases 3 and 6. |
| 7 | Completeness: a `T17-R<n>` fix could never clear T17's recorded failure. | Accepted | T17: the fix's report must show the identity passing, which discharges it; Section 9 follows. |
| 8 | Completeness: Paolo's approvals were not recorded durably. | Accepted | P30; T18's `Approved:` lines and their check. |
| 9 | Completeness: test and document artifacts were defined by reference. | Accepted in part | `$E2/old-cases.md` assigns each of the 235 old cases (P25), and T16 lists the README's sections. The new test names stay the implementer's; `check-cases.mjs coverage` checks them. |
| 10 | Feasibility and validation: T1's patterns escaped `\|`, and one rejected the required `mode` literals. | Accepted | The patterns now use plain alternation and target the old fields; they were run against the probe and samples (Appendix A). |
| 11 | Feasibility: `base-tools.ts` imported the renderers in T1, before T8 created them. | Accepted | T1 attaches no renderer; T8 creates `ui/tool-renderers.ts` and attaches it (P9; Appendix B). |
| 12 | Feasibility: the done criteria required commits from T17 and T19, which make none. | Accepted | Section 9 lists T0, T1 to T16, the fixes and T20. |
| 13 | Validation: the final head is not compared with the baseline after review fixes. | Accepted in part | Each fix runs the test files of every task its diff touches. Section 7 names the remaining gap: a further full run needs a ruling beyond D36. |
| 14 | Validation: the removal list and the checklist let tests disappear or cover nothing. | Accepted | P29 forbids removing or renaming a test, so the identity check runs without a removal list. `check-cases.mjs coverage` requires each old case's tests to fail under its case's mutation. |
| 15 | Safety, blocking: run outputs overwrite the read-only state directory `/tmp/sn2-impl`. | Rejected | The planning request names `/tmp/sn2-impl` as the implementation's state directory, as phase 1 used `/tmp/sn-impl` for its runs (phase 1 plan Section 5). "Read-only" in the review brief addressed the reviewers. Hardened anyway: the five baseline files are read-only (P31). |
| 16 | Safety, blocking: the generate wizard gave a model every tool. | Ruled R16 (D40) | P21; T14. |
| 17 | Safety: a mutation interrupted mid-run could leave source mutated. | Accepted | `mutate.mjs` backs up, restores on signals, verifies the hash, and refuses after an interrupted run (Appendix A). |

Sections changed: opening, 1, 2.1 (R9, R16, P1, P2, P6, P9, P15, P17, P21, P25, P27 to P31), 2.3, 2.4, 3, 4, 5, every task, 7, 8, 9, Appendices A and B, and all evidence files. Changes made after this pass and not yet reviewed: all of the above.

### Pass 2: 2026-09-28, reviewer model openai-codex/gpt-6-astra

All six angles ran on `.pi/agents/plan-reviewer.md` at `941bec9ab` (thinking `high`). A later session found the fixes half-applied after the planning session ran out of context, audited them against source (`/tmp/sn2-plan/pass2-audit.md`) and finished them. Findings 1, 3 and 4 are one finding, and so are 2 and 10.

| Angle | Verdict |
| --- | --- |
| Traceability | FAIL |
| Assumptions | FAIL |
| Completeness | FAIL |
| Feasibility | PASS_WITH_FINDINGS |
| Validation | PASS_WITH_FINDINGS |
| Safety | PASS_WITH_FINDINGS |

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | Traceability, blocking: T14 wrote a generated file whose values the parser flagged invalid, against D40. | Accepted | `frontmatter.ts:40-49`, `:113`; Appendix A parser check. P21 refuses any `invalidValues` or `unknownKeys` entry (unknown keys confirmed by Paolo, 2026-09-28); T14 case 8. |
| 2 | Traceability: the final coverage gate read only the phase report, so a `T17-R<n>` repair could never clear it. | Accepted | `check-cases.mjs coverage` takes a comma list of reports, a later one replacing an earlier result; Section 9 passes the repair reports (Appendix A). |
| 3 | Assumptions, blocking: parser success does not make a valid definition. | Accepted, as 1 | As 1. |
| 4 | Completeness, blocking: generation did not reject `invalidValues`. | Accepted, as 1 | As 1. |
| 5 | Completeness: a failed settings write could truncate the project `settings.json`. | Accepted | `settings-manager.ts:319-345` writes in place. P12 replaces an existing file through `writeFileAtomically`; T3 case 8. |
| 6 | Completeness: `/agents` could list a stale roster before any refresh. | Accepted | `service/service.ts:216`; pi-subagents `src/index.ts:3109-3110`. P19; T13 case 16; T15 case 8. |
| 7 | Completeness: mutation specs and records lived only in `/tmp`. | Accepted | T20 copies them to `$E2/mutations/` with a `cmp` check; T20's loops and Section 9 read the copies. |
| 8 | Feasibility: test-file patterns reached vitest unexpanded from the repository root. | Accepted | `failing-tests.mjs:64-67`. P32's `tf`, with quoted patterns, checked in bash and zsh (Appendix A); T1 and T3 use it. |
| 9 | Feasibility: T6's probe fixtures read `record.child`, which T3 hides. | Accepted | The probe tests and six phase 1 suite files read `child` or `parent`. P33's `inspectRecord`; T3 moves every such read; T6's fixture row. |
| 10 | Feasibility: the identity and coverage gates could not see T17 repairs. | Accepted, as 2 | Phase 1 `test-identities.mjs:44-58`. New `$E2/check-identities.mjs` reads repair reports (P29). |
| 11 | Validation: an import failure counted as a caught mutation. | Accepted | `mutate.mjs` requires an `expect` test to fail an assertion and lists load failures with `!`; `check-cases.mjs` reads `caught` (Appendix A). |
| 12 | Validation: the identity gate let skipped tests and task tests vanish. | Accepted | Phase 1 `test-identities.mjs:48` skips tests with no pass. `check-identities.mjs` counts every status and each task's last report (P29; Appendix A). |
| 13 | Validation: the layering test missed re-exports and side-effect imports. | Accepted | The probe's layering test parses both forms; mutations P11 and P12 fail it (Appendix A). |
| 14 | Validation: terminal renders, the 50-line cap and rename or unlink failures had no case. | Accepted | T8 cases 14 and 15; T13 cases 17 and 18. |
| 15 | Safety: the project settings write followed a symlink out of the project. | Accepted | P12 refuses a symlinked `.pi` or `settings.json` found by `lstat`; T3 case 6. |
| 16 | Safety: an interrupted mutation run left test subprocesses running. | Accepted | `mutate.mjs` runs each check in its own process group and waits until the group is empty, after a signal or a normal exit. The reviewer's scenario and a SIGTERM-ignoring subprocess pass (Appendix A). |
| 17 | Safety: temporary agent-file writes could clobber or delete a file they did not create. | Accepted | P27: exclusive `wx` creation, refusal on collision, cleanup of its own file only; T3 case 7; T13 case 19. |

Sections changed: 1 (the evidence row and the workflow paragraph), 2.1 (P1, P2, P12, P19, P21, P27 to P29, new P32 and P33), 3, 4, 5, T0, T1, T3, T6, T8, T13, T14, T15, T17, T20, 7, 8, 9, Appendices A and B, and the evidence files `probe.patch`, `mutate.mjs`, `probe-mutations.json`, `check-cases.mjs` and the new `check-identities.mjs`. Changes made after this pass and not yet reviewed: all of the above.

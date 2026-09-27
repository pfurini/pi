# Native subagents, phase 1: the headless service and its base tools

This plan rebuilds pi-subagents' headless core inside `packages/coding-agent` as fork-owned code. Each session owns one subagent service. `Agent`, `get_subagent_result` and `steer_subagent` become fork base tools bound to that service. A bus adapter keeps the `subagents:*` contract for third parties. The source is the session-control handoff, rulings D16 to D27 and section 14. Probes on 2026-09-27 proved the wiring and the adapter on real sessions, ran the full coding-agent suite, and broke each proved behavior once. Phases 2 to 4 follow on the same branch (Section 10).

## 1. Authority and workflow

| Source | Role |
| --- | --- |
| This plan | The implementation contract. It overrides the source where Section 2 or Section 4 names a difference. |
| `/Users/paolof/Developer/ai/_handoffs/2026-09-26-pi-session-control-consolidated.md` | The source and sole authority for rulings. Section 7 holds D1 and D16 to D27; section 14 holds the port's facts. Record any new ruling there, never elsewhere. |
| `/Users/paolof/Developer/ai/pi-subagents` at `79a7c42` | The feature reference. Read it to learn a behavior; never copy a file wholesale (D16). Its tests are the behavior checklist (D24, Section 7). |
| `docs/adr/ADR-0003-fork-first-merge-hygiene.md` | New code in new files; hot upstream files get thin call sites only. |
| `docs/adr/ADR-0008-skill-bundled-agents-scoping.md` | Qualified and bare names for skill-bundled agents, and the collision rewrite. |
| `docs/adr/ADR-0009-built-in-extensions.md` | Built-in kinds, the switch, the base-tool activation rule. T9 amends it for D20, D22 and D26. |
| `docs/plans/ask-user-question-base-tool.plan.md`, its `.results.md` and its evidence directory | The precedent for a fork base tool, its suite tests, its identity check and its SDK probe. |
| `docs/plans/subagents-native-phase1-evidence/` | The probe patch, the mutation script, the test runner, the identity check and the removed-test list (Appendix A, Appendix B). |
| `AGENTS.md` (repository) | Git, lockfile, check and test rules. |

The `planning-changes` skill wrote this plan and runs its review passes. A fresh session implements it from the handoff prompt, on the feature branch `feat/subagents-native`.

## 2. Decisions

### 2.1 User rulings

All rulings date from 2026-09-27 and are recorded in the handoff's section 7.

| # | Ruling | Consequence |
| --- | --- | --- |
| R1 (D16) | pi-subagents becomes fork-owned code under `src/core/fork-builtins/`, with no `UPSTREAM.json` and no sync. Features are rebuilt natively; defects stay behind. | Every task writes new code against Pi's APIs, using pi-subagents only as a reference. |
| R2 (D17) | Kept: `Agent`, `get_subagent_result`, `steer_subagent`, background agents, the widget, custom and skill-bundled agents, `/agents`, mentions, FleetView and viewer, nested subagents, worktree isolation, memory, the create wizard and eject, compact and custom tool descriptions. Dropped: all workflow code and scheduling. | Phase 1 builds the headless part of the kept list (Section 4). No `croner`, `nanoid`, `node:vm` or `node:worker_threads`, and no structured-output tool. |
| R3 (D18) | Wiring W2: one headless service per `AgentSession`; the three tools are fork base tools; presentation is one inline factory. The service imports no presentation code. | T4 and T5. The inline factory is phase 2. |
| R4 (D19) | In-process consumers call the typed service. The `subagents:*` events and RPC channels stay as an adapter, unchanged in names and payloads. | T8. |
| R5 (D20) | Settings live under `forkBuiltins.subagents` in Pi's global and project `settings.json`; the project value wins. The settings menu writes the project file. | T2 builds the reader and the project writer. The menu is phase 2. T9 amends ADR-0009. |
| R6 (D21) | The session owns top-level subagents; session end or replacement cancels them. A nested agent's parent is the agent that spawned it. No detach in version 1. | T4 (session cascade), T6 (nested cascade). |
| R7 (D22) | In a child, a fork base tool is active only when the agent's `tools:` names it; known names come from the live registry. Inline built-ins follow `extensions:`, `exclude_extensions:` and `isolated`. | T3. T9 amends ADR-0009. |
| R8 (D23) | Each phase is a plan on the long-lived branch `feat/subagents-native`. `personal` receives all phases in one fast-forward after phase 3, together with removing the pi-subagents entry from `~/.pi/agent/settings.json`. No coexistence code. | Phase 1 never touches `personal`, the main checkout or `~/.pi/agent/`. |
| R9 (D24) | Tests are new. Old tests are a behavior checklist; each plan maps the old files it covers and names deliberate drops. | Each task's validation names the cases that cover its old files; Section 7 holds the map. |
| R10 (D25, D26) | The footprint in `agent-session.ts` is two added lines: `session: this` in the `addForkBaseTools` call, and `session: this` in the fork's own `SkillForkClient` construction. The service ends its children through `registerSessionResourceCleanup`. | T5 adds the first line, T8 the second. |
| R11 (D27) | Before each implementation commit, one `code-reviewer` agent reviews the staged diff; the implementer checks each finding against the source, fixes the accepted ones and records every disposition in the results file. At the end of the phase, the `super-code-review` skill reviews the phase range; the owner approves which findings are applied. | The review gate in Section 6. T10 is the phase review. |

**Planner defaults.** Each is reversible; the reason stands next to it.

| Item | Default | Reason |
| --- | --- | --- |
| Module layout | `src/core/fork-builtins/subagents/` with `definitions/`, `settings/`, `runner/`, `service/`, `tools/`, `adapter/`; tests under `test/fork-builtins/subagents/` and `test/suite/fork-subagents-*.test.ts` | Matches the other fork-owned modules. Phase 2 adds `ui/`. |
| Per-session record | `addForkBaseTools` stores `{ agentDir, eventBus, lineage }` for the session in a `WeakMap<AgentSession, …>` without reading any session property. `lineage` comes from the child-lineage map below and is absent for a top-level session. `subagentServiceFor(session)` builds the service lazily from that record, on the first subagent tool call, RPC request or skill-fork spawn. A session with no record (fork built-ins off) has no service. | Registration must not read the session: reading it at registration broke the registration test (Appendix A, M5). The probe passed `agentDir` as an argument; the record removes the need for a third footprint line in T8. |
| Child lineage | Before building a child, the runner stores `{ owner service, parent record, depth, allowedSubagents, isolated }` for the child loader's event bus in a `WeakMap<EventBus, …>`, read through `lineageForBus(bus)`. The child's own `addForkBaseTools` finds it through the bus it receives. In a child, the adapter's `spawn`, `stop` and `consume`, and typed skill-fork spawns, go to the owning agent's nested runtime (T6), so `allowed_subagents`, `isolated` and `maxSubagentDepth` apply. Without permission, under `isolated`, or at the cap, they reply with an error and start nothing. The lifecycle events of a record started there are emitted on that child's bus, which is the owner's scope, and never on the main session's bus. | Every child is an `AgentSession`, so it gets its own base tools and adapter (`agent-session.ts:5634`); the scratch probe before pass 3 confirmed the child's adapter answers on its own loader's bus (Appendix A). pi-tasks spawns over `subagents:rpc:spawn`, not `Agent` (`pi-tasks/src/index.ts:207-211`), and advances its tasks on `subagents:completed` and `subagents:failed` (`:300-310`, `:344-364`). Without lineage, a child loading pi-tasks would start new top-level agents past the depth cap; without owner-scoped events, its tasks would never finish. |
| Adapter activation | `addForkBaseTools` installs the bus adapter on the session's event bus when one exists, once per session, and emits `subagents:ready` on every call (construction and each `/reload`). The adapter leaves the bus through the session cleanup hook. It resolves the service lazily per request. | Third parties ping before any tool call: pi-tasks pings while its factory loads and again on `subagents:ready` (`pi-tasks/src/index.ts:260-261` at `83480bd`). The loader's bus lives as long as the loader (`resource-loader.ts:469`). Proved by M6 to M9 (Appendix A). |
| Working directory | Taken from the tool call's `ctx.cwd`; for RPC and skill-fork spawns, from the `ExtensionContext` or the spawn's `cwd` option, else `process.cwd()` as pi-subagents did | `AgentSession` has no public `cwd` getter, and `sessionManager.getCwd()` can differ from the session's cwd. Keeps the footprint at R10. |
| Child settings | `SettingsManager.create(childCwd, agentDir, { projectTrusted: parent.settingsManager.isProjectTrusted() })` | A worktree child shares the parent's repository, so its trust follows the parent's. |
| Project trust | Project agents (`.pi/agents/`, `.agents/agents/`), project settings and `.pi/agent-tool-description.md` are read only when `settingsManager.isProjectTrusted()` is true | Closes the gap in handoff 14.6: pi-subagents read them unconditionally, and an agent file's `extensions:` paths load code. |
| Unknown frontmatter keys | Load the agent and warn once per file and key, naming both; `strictAgentFiles` turns the warning into a load error | Your `Explore.md` sets `thinkingLevel` and `persistSession`, which were silently ignored (handoff 14.6). |
| Frontmatter spellings | snake_case as documented by pi-subagents; the `inherit_extensions` and `inherit_skills` aliases and boolean `agentMentions` are dropped | Legacy spellings are defects to leave behind (R1). A dropped spelling triggers the unknown-key warning. |
| Subagent tools in children | `Agent`, `get_subagent_result` and `steer_subagent` reach a child only as T6's nested tools. Otherwise they go into the child's `excludeTools`, even when `tools:` names them, and naming them warns. | The exclude list also removes SDK custom tools (`agent-session.ts:5511-5517`), so T6's injected names must not be excluded. The injected custom tools then override the child's own base tools of the same names (`:5529-5533`). The child's own base `Agent` would otherwise bind to the child session with no depth limit. |
| Skills for `skills:` preload | Resolved from the parent session's loaded skills (`resourceLoader.getSkills()`) | Replaces pi-subagents' own five-directory scan (handoff 14.6). |
| Skill-bundled agents | The adapter publishes revisioned `skill-agents:rewrite-maps` events and answers `skill-agents:query`, with types imported from `skills/runtime.ts:36-57`. It republishes on every `skills:changed` event (`skills/skill-set-events.ts`). | ADR-0008 requires collision-sensitive rewrites that follow skill changes. The wire types are importable in-tree, so the copy-set rule no longer applies to subagents. |
| `enabledModels` | `settingsManager.getEnabledModels()` (`settings-manager.ts:1554`) | Replaces the re-implemented merge (handoff 14.6). |
| Notifications | `session.sendCustomMessage` with `customType: "subagent-notification"`, `deliverAs` and `discardIf`, driven by the session's `agent_settled` event | Typed API; no cast of `pi.sendMessage` (`agent-session.ts:4237`). The renderer is phase 2; until then Pi renders the custom message's text. |
| skill-fork transport | The typed service whenever the session has a per-session record; the event bus only when it has none | The service is created on demand, so a fork skill run before any `Agent` call sends no ping (D26). `PI_FORK_BUILTINS=off` and third-party subagents extensions keep the bus path. |
| Worktree preservation | A worktree is removed only after its changes are committed to the result branch, or when it holds none. On a failed stage, commit or branch creation, the worktree stays, and the result names its path and the error; it never reports "no changes". The service removes only worktree paths it created, and never runs a repository-wide `git worktree prune`. | pi-subagents force-removed the worktree on any error (`src/worktree.ts:177-193`), which can destroy the child's only copy of its work. |
| Child teardown | `teardownChild(child)` starts `child.session.abort()` without awaiting it, and attaches a handler to that promise so a rejection is never unhandled. It races `child.session.emitShutdownOnce({ type: "session_shutdown", reason: "quit" })` (`agent-session.ts:1845`) against 3 s. In a `finally`, whether the race settles, times out or rejects, it calls `dispose()`, which is idempotent, then disposes the child's `DefaultResourceLoader`. A rejected emission or abort is recorded as an `extension-error` activity on the child's record, never rethrown. On a startup failure the runner disposes the loader too. The parent's cleanup hook aborts every child synchronously, then starts these teardowns without awaiting. Phase 2's factory awaits the same teardown from its `session_shutdown` handler. | `dispose()` emits no `session_shutdown` (`agent-session.ts:1876-1890`), and pi-subagents' fix #242 exists because child extension timers otherwise outlive the child (`agent-manager.ts:335-363`). `abort()` waits for idle with no deadline (`agent-session.ts:4450-4469`), so `shutdown()`, which awaits it first, lets a tool that ignores cancellation use the whole window: the teardown scratch probe after pass 3 counted 0 `session_shutdown` calls that way and 1 with the unawaited abort (Appendix A). The emission rejects when an extension error listener throws, and core disposes in a `finally` for that reason (`agent-session.ts:1863-1874`; `test/agent-session-shutdown-emit.test.ts:184-217`). An injected loader stays caller-owned (`sdk.ts:197-200`, `agent-session.ts:1931-1934`). |
| Record retention | Running and queued records are never evicted. A terminal record stays 10 minutes after completion, then is evicted and its child torn down. A persisted child leaves a tombstone (handle, alias, id, type, description, session file, completion time); at most 100 are kept, oldest first out. | pi-subagents `agent-manager.ts:74` and `:1480-1500`. Phase 3's mentions resolve handles through the tombstones. |
| Pool eligibility | Only top-level records occupy pool slots. The background pool (`maxConcurrent`) counts every background top-level record, RPC spawns with `isBackground: true` included. The foreground pool (`maxConcurrentForeground`) counts only blocking top-level spawns, where a caller awaits the result inline. A detached spawn without `isBackground` (RPC, and phase 3's mentions) blocks nobody and occupies no foreground slot. Nested children occupy no slot in either pool. | A nested child queued behind its own parent deadlocks (pi-subagents `agent-manager.ts:100-158`). pi-subagents charges background RPC work to the background pool (`:110-113`), and pi-tasks sends `isBackground: true` (`pi-tasks/src/index.ts:1208-1210`). |
| Top-level visibility | A nested record is unreachable from the session's own tools: `get_subagent_result`, `steer_subagent` and `resume` treat its id as unknown. RPC `stop` and `consume` on the main session's bus reply `Agent is owned by another agent or workflow`. It emits no `subagents:*` event on the main session's bus and no notification in the main session; the events of a record started from a child's bus go to that child's bus ("Child lineage"). Its usage and transcript roll up to its parent. | Handoff section 3: internal children are reachable only through their parent. pi-subagents `test/status-note-wiring.test.ts:146-199`, `:293-318`; the error string is `src/cross-extension-rpc.ts:256`, kept verbatim (R4). |
| Isolated agents | `isolated: true` (frontmatter or tool parameter) forces `extensions: false` and `skills: false`, drops `ext:` selectors, and makes the agent ineligible for nesting: it gets no nested tools, and its child session refuses RPC and skill-fork spawns, even with `allowed_subagents`. | pi-subagents `src/agent-runner.ts:710-715` (extensions and skills off), `:931` (no nested tools); `README.md:346`. |
| Result waits | `get_subagent_result` with `wait` calls the service's `waitForResult(id, signal)`. Cancelling the tool call aborts only the wait: the child keeps running, its result stays unread, and its notification still arrives. A wait on a queued record waits through the queue, and a cancelled waiter's listener is removed. | pi-subagents `README.md:471`; `test/wait-queued.test.ts:132-239`. |
| Definition refresh | The service reloads agent definitions (T1's loader) before every spawn, whether from `Agent`, RPC or skill-fork, and whenever its `refreshDefinitions()` method is called; phase 2's create, eject, enable, disable and edit actions call it. A reload leaves existing records untouched. When a reload changes a skill agent's bare alias or collision, the adapter publishes a new `skill-agents:rewrite-maps` revision; an unchanged map publishes nothing. Settings are read from the session's `SettingsManager` at each spawn; the tool description is built at registration, so it follows each `/reload`. | pi-subagents reloads before tool and programmatic spawns and republishes registry changes, because adding `.pi/agents/reviewer.md` can change an alias with no skill change (`src/index.ts:436-445`, `:786-796`, `:1967-1968`). |
| Memory legacy path | `~/.pi/agent-memory` is not read | A legacy fallback (R1). |
| Tool-scoping workaround | Kept: children leave `allowedToolNames` unset whenever extensions load, and scope through `excludeTools` plus active-set narrowing | `_allowedToolNames` is fixed at construction (`agent-session.ts:685`), so late-registering extension tools would be dropped otherwise. |
| Commit hook in the worktree | Setup copies the ignored `.husky/_` from the main checkout | `npm install --ignore-scripts` skips Husky's `prepare` (`package.json:56`), and `.husky/_` is ignored (`.husky/_/.gitignore:1`). Without it no hook runs. Proved in the probe worktree (Appendix A). |
| Old-test checklist file | `docs/plans/subagents-native-phase1-evidence/checklist.md`, written by T9 | Keeps the D24 map with its phase. |

### 2.2 Source questions

| # | Status | Answer used |
| --- | --- | --- |
| Handoff 14.3 judgment: derive known tool names from the live registry | Resolved by R7 | T3 reads the parent's registry. |
| Handoff 14.4 judgment: add a small context type instead of widening `ForkBaseToolOptions` | Adopted | `ForkBaseToolOptions` gains one field, `session`, which is the context. The probe did exactly this. |
| Handoff 14.5: a code review before each commit | Resolved by R11 | The review gate in Section 6, and T10. |
| Handoff 12.1: D1 graceful cancel has no design | Deferred beyond phase 4 | Phase 1 cancels by abort and dispose, as pi-subagents did. |
| Engine amendment: workers exclude `Agent` | Deferred to phase 3, as a cutover prerequisite | A worker policy without `tools` leaves every tool open (workflow worktree `packages/workflow/src/pi/worker-policy-extension.ts:156` at `d64cc9c`). Phase 3 must verify the exclusion, not only draft it (Section 10). |

### 2.3 Differences from the source

| Source item | This plan | Reason |
| --- | --- | --- |
| D25 "one added line" | Two lines (D26 supersedes it) | Probe finding: `SkillForkClient` receives only the event bus. |
| pi-subagents `Agent` param `schedule` | Absent | Scheduling is dropped (R2). |
| `workflowsEnabled`, `schedulingEnabled` settings | Absent | Both features are dropped (R2). |
| pi-subagents `subagents.json` global and project files | Not read; nothing migrates | R5. The live global file holds only `workflowsEnabled: false`. |
| The mention input hook and `mention-clone` | Phase 3 | Presentation-adjacent; needs the UI factory. |
| pi-subagents emitted `subagents:ready` from its `session_start` handler | Emitted when the session builds its base tools, at construction and on each `/reload` | Base tools have no `session_start` hook. A listener that subscribes in `session_start` misses it but gets an answer when it pings, as before. |
| pi-subagents awaited each child's `session_shutdown` from its own `session_shutdown` handler | Phase 1's parent cleanup hook aborts children at once and starts their bounded teardown without awaiting it; phase 2's factory awaits it | Base tools have no `session_shutdown` hook, and `AgentSession.dispose()` is synchronous. In print mode, a process that exits right after disposal can cut a child's shutdown handlers short until phase 2 lands. |

### 2.4 Approvals

Standing approval: worktree creation, `npm install --ignore-scripts`, `npm run build:offline`, `npm run check`, `./test.sh`, single test files and `git hook run pre-commit` inside `/tmp` worktrees; commits on `feat/subagents-native` in `/tmp/subagents-native`; `code-reviewer` agents per commit.

These actions always need the owner's explicit yes:
- any edit, install, build or commit in the main checkout;
- any change to `personal`, including a fast-forward (none is planned in phase 1);
- any edit of `~/.pi/agent/settings.json` or other live configuration;
- a `package-lock.json` change (none is expected: phase 1 adds no dependency);
- applying any `super-code-review` finding in T10;
- removing any worktree or deleting any branch.

## 3. Verified facts

The probe ran on 2026-09-27 against `personal` at `452d35e62c2609106c43013fbac22c3e62bde176`. It used `/tmp/subagents-native-probe` (the change) and `/tmp/subagents-native-baseline` (clean), both built with `npm run build:offline` after copying `packages/ai/src/providers/data/` from the main checkout. Coding-agent ran through `failing-tests.mjs` under `./test.sh` isolation, one run at a time. Line numbers refer to the start commit. Both worktrees and the run directory `/tmp/sn-runs` were removed at handoff; `probe.patch` holds the probe's final diff, and Appendix A holds its measurements.

| Fact | Evidence |
| --- | --- |
| A session exposes its model runtime publicly. | `agent-session.ts:871` `get modelRuntime()` |
| `createAgentSession` takes `modelRuntime`, `excludeTools`, `customTools` and `resourceLoader`. | `sdk.ts:57`, `:86`, `:88`, `:91` |
| A child built from the parent's `modelRuntime` reaches the parent's providers, including one registered at runtime. | Probe test "runs a child from the parent's model runtime" with the harness's runtime-registered faux provider (Appendix A, M1). |
| `AgentSession.dispose()` calls `cleanupSessionResources(this.sessionId)`; `registerSessionResourceCleanup` subscribes to it. | `agent-session.ts:1930`; `packages/ai/src/session-resources.ts` |
| Session replacement runs `session_shutdown`, then `dispose()`. | `agent-session-runtime.ts` `teardownCurrent` |
| A parent's `dispose()` aborts a running child through the cleanup hook; the child's last message has `stopReason: "aborted"`. | Probe test (Appendix A, M4). |
| `_buildRuntime` rebuilds the base tools on every `/reload`, so per-session state must live outside the definitions. A `WeakMap` keyed on the session keeps one service across `/reload`. | `agent-session.ts:5634`; probe test (M3). |
| Inline factories load before `extensionsOverride` runs, so a child loader's override can drop `<inline:tokensave>`. | `resource-loader.ts` `loadFinalExtensionSet`, then line 836; probe test (M2). |
| Passing names in `excludeTools` removes them from what the child's model receives. | Probe test, `getCurrentTools` of the child's request (M1). |
| The exclude list filters SDK custom tools as well as base tools; a custom tool overrides a base tool of the same name. | `agent-session.ts:5511-5517` (filter), `:5529-5533` (custom entries set after base entries) |
| The registration gate `_allowedToolNames` is fixed at construction. | `agent-session.ts:685`, `_refreshToolRegistry` |
| `AgentSession` has no public `cwd` or `agentDir` getter; `sessionManager.getCwd()` can differ from the session cwd. | `grep` of `agent-session.ts` getters; the suite harness passes `SessionManager.inMemory()` and `cwd: tempDir`. |
| A `DefaultResourceLoader` creates its event bus once, in its constructor, so the bus survives `/reload`. | `resource-loader.ts:469` |
| An adapter installed from `addForkBaseTools` answers `subagents:rpc:ping` on a fresh session before any tool call, announces `subagents:ready` at construction and after `/reload`, and stops answering after `dispose()`. | Probe tests (Appendix A, M6 to M9). |
| A child session built by the service installs its own adapter on its loader's event bus, which is the bus its `addForkBaseTools` receives; the parent's disposal removes it. This is the key that Section 2.1 "Child lineage" uses. | Scratch probe before pass 3 (Appendix A). |
| pi-tasks pings subagents while its factory loads and again on each `subagents:ready`. | `pi-tasks/src/index.ts:260-261` at `83480bd` |
| The skill-agent rewrite-map and query channels and types live in `skills/runtime.ts`. | `skills/runtime.ts:36-57` |
| The session delivers custom messages with `deliverAs` and `discardIf`. | `agent-session.ts:4237-4246` |
| `SettingsManager` provides `isProjectTrusted()` and `getEnabledModels()`. | `settings-manager.ts:563`, `:1554` |
| `skills/skill-fork.ts` and the `SkillForkClient` block in `agent-session.ts` are fork code (commit `e34e67119`); upstream has no `skill-fork.ts`. | `git blame` of `agent-session.ts:793-806`; `git cat-file -e earendil-works/main:...` fails. |
| Core's skill-fork tests stub subagents on the event bus, and still pass with the probe's adapter. | `test/suite/skills-fork.test.ts`, `test/suite/skill-contract.test.ts`: 146 of 146 pass with the probe files (Appendix A). |
| `packages/coding-agent/vitest.config.ts` sets `PI_FORK_BUILTINS=off`; fork tests turn it on with `vi.stubEnv`. | Handoff 14.5; `test/suite/fork-base-tools.test.ts` |
| Registering `Agent` and the adapter breaks no existing coding-agent test. | probe-2: 4,635 tests, 0 failures, no new failure against base-1; `test-identities.mjs` with `removed.txt` exits 0 (Appendix A). |
| The probe passes `npm run check`, with no import cycle through `sdk.ts`. | `npm run check` exit 0, twice. |
| A fresh worktree runs no commit hook until `.husky/_` exists; with it copied, `git hook run pre-commit` runs the lockfile guard and `npm run check`. | `.husky/_/.gitignore:1`; `package.json:56`; probe worktree run, exit 0 (Appendix A). |
| `./test.sh` output mixes three formats: vitest `FAIL` lines, Node spec `ℹ fail N` summaries, and Node dot output (`packages/tui`) that lists failures as `✖ <name>` under "Failed tests:". | The baseline `./test.sh` log of 2026-09-27 (Appendix A; the log was deleted at handoff, and setup step 6 writes a fresh one); `packages/tui/package.json:13`; a scratch dot-reporter run printed `✖ breaks here (0.38ms)`. |
| The SDK defaults to the live agent directory and its settings, and loads their extensions; the live `settings.json` still lists pi-subagents. | `agent-session-services.ts:139-159`; reviewer read-only check, pass 1. |
| `AgentSession.shutdown()` aborts, emits `session_shutdown` once and disposes; `dispose()` alone emits nothing and is idempotent. `abort()` waits for idle with no deadline, and `emitShutdownOnce` is a public method. | `agent-session.ts:1845`, `:1852-1874`, `:1876-1893`, `:4450-4469` |
| With a tool that ignores cancellation, a teardown that awaits `abort()` first times out before `session_shutdown` runs; starting `abort()` unawaited and racing `emitShutdownOnce` lets the handler run once within the deadline. | Teardown scratch probe after pass 3 (Appendix A). |
| A session built with an injected resource loader never disposes it. | `sdk.ts:197-200`; `agent-session.ts:1931-1934` |
| pi-subagents keeps terminal records 10 minutes, keeps at most 100 tombstones, exempts nested children from both pools, and bounds child shutdown at 3 s. | pi-subagents `src/agent-manager.ts:74`, `:100-158`, `:335-363`, `:1480-1500` |
| pi-tasks spawns and stops subagents only over `subagents:rpc:*`. | `pi-tasks/src/index.ts:207-216` at `83480bd` |
| Core's skill-fork maps completions by `status` value, not only by key presence. | `skills/skill-fork.ts:87-135` (`normalizeSubagentCompletion`, `normalizeAgentEnded`) |
| `failing-tests.mjs` refuses an output path that already exists. | `failing-tests.mjs:61-62` |
| The coding-agent baseline has 50 pending tests. | `base-1.json`: `numPendingTests=50` |
| pi-subagents' size and workflow coupling. | Handoff 14.6. |

Claims not yet verified, each with the task that verifies it: child teardown with extension shutdown, rejection handling and loader disposal on the real runner (T3, T4), retention, pool eligibility, definition refresh and result-wait cancellation (T4, T5), nested ownership, isolation, lineage and owner-scoped events (T5, T6, T8), worktree preservation under the new runner (T7), rewrite-map publication and skill-fork over the typed service (T8), the built outputs (T11).

## 4. Scope

**In scope.**
- Agent definitions: defaults, custom, skill-bundled, trust gate, frontmatter warnings (T1).
- Settings under `forkBuiltins.subagents`, model resolution and scope (T2).
- The child-session runner with R7 scoping, prompts, skills, memory, transcripts and turn limits (T3).
- The per-session service: records, queue and concurrency, steering, resume, join modes, notifications, usage, the session cascade (T4).
- The three base tools, the per-session record and the first footprint line (T5).
- Nested subagents (T6) and worktree isolation with preservation (T7).
- The bus adapter with rewrite maps, and skill-fork over the typed service with the second footprint line (T8).
- The module README, the ADR-0009 amendment and the old-test checklist (T9).
- The phase review (T10), built-output validation (T11) and results (T12).

**Out of scope.** The inline UI factory: widget, FleetView, viewer, `/agents`, create wizard, eject, the notification renderer (phase 2). Mentions and cutover (phase 3). pi-tasks (phase 4). Workflow code and scheduling (dropped). pi-fence, OpenIntent and the engine amendment.

**Binding constraints.**

| Constraint | Exception in this plan |
| --- | --- |
| Upstream-owned files get only thin call sites (ADR-0003). | `agent-session.ts`: 2 added lines (R10). No other upstream-owned file changes. |
| No new runtime dependency and no `package-lock.json` change. | None. |
| The main checkout, `personal` and `~/.pi/agent/` stay untouched (R8). | Setup and the done criteria read them; nothing writes them. |
| Never touch paths this plan did not create. `/tmp/ask-user-question-base-tool` belongs to another session. Do not edit OpenIntent, pi-tasks or pi-subagents. | None. |
| AGENTS.md git rules: explicit paths only; no `reset --hard`, `checkout .`, `clean`, `stash`, `add -A`, `--no-verify`. | None. |
| `vitest.config.ts` keeps `PI_FORK_BUILTINS=off`. | None. |

## 5. Working setup

Every command runs from `/tmp/subagents-native` unless it names another directory. `M=/Users/paolof/Developer/ai/pi` is the main checkout; `E=docs/plans/subagents-native-phase1-evidence`.

1. `git -C $M worktree add -b feat/subagents-native /tmp/subagents-native personal`. Record `BASE=$(git rev-parse HEAD)` in `/tmp/sn-impl/BASE` after step 5 creates the directory.
2. `cp -R $M/packages/ai/src/providers/data packages/ai/src/providers/data`, then `diff -r $M/packages/ai/src/providers/data packages/ai/src/providers/data` prints nothing.
3. `test ! -e .husky/_ && cp -R $M/.husky/_ .husky/_`, then `test -x .husky/_/pre-commit` exits 0. When `.husky/_` already exists, stop and ask.
4. `npm install --ignore-scripts` and `npm run build:offline`; both exit 0; `git status --short` prints nothing. Then `git hook run pre-commit` exits 0 and its last line is `✅ All pre-commit checks passed!`.
5. `mkdir /tmp/sn-impl`, which must succeed; when it exists, stop and ask. Record the protected state, read-only:
   - `git -C $M rev-parse personal > /tmp/sn-impl/personal.ref`
   - `git -C $M status --porcelain=v1 -- packages > /tmp/sn-impl/main-packages.status`
   - `shasum -a 256 ~/.pi/agent/settings.json > /tmp/sn-impl/live-settings.sha256`
6. After T0 commits the evidence: run coding-agent three times, `node $E/failing-tests.mjs run /tmp/subagents-native packages/coding-agent /tmp/sn-impl/base-<n>.json`, n = 1 to 3. Run `./test.sh > /tmp/sn-impl/base-testsh.log 2>&1` once.
7. `node -e 'const r=require("/tmp/sn-impl/base-1.json");console.log(r.numTotalTests,r.numFailedTests)'`. When `BASE` is `452d35e62`, it prints `4628 0`. Otherwise record the numbers in the results file and compare them with Appendix A. A new baseline failure is a precondition to report, not a regression. Then `echo /tmp/sn-impl/base-1.json > /tmp/sn-impl/latest.candidate`.

**Regression rule.** With `S=$E/failing-tests.mjs` and `I=$E/test-identities.mjs`. The rule applies to code tasks: T1 to T8, and each T10 fix, whose task id is `T10-F<n>`. T9, T11 and T12 change no code under test; they run no candidate and leave the chain unchanged. Every run writes a new path: `/tmp/sn-impl/<task>-a<k>-<n>.json` and `/tmp/sn-impl/<task>-a<k>-testsh.log`, where `k` counts validation attempts from 1 (a review fix starts a new attempt) and `n` counts runs within the attempt. The run that satisfies rules 1 to 3 in the last attempt is the task's candidate: write its path to `/tmp/sn-impl/<task>.candidate`, then to `/tmp/sn-impl/latest.candidate`. The previous candidate is the path in `latest.candidate` when the task starts; setup step 7 seeds that file with `/tmp/sn-impl/base-1.json`.
1. After each code task, run coding-agent once. `node $S diff /tmp/sn-impl/base-1.json <run>` reports no new failure. `node $I /tmp/sn-impl/base-1.json <run>` and `node $I "$(cat /tmp/sn-impl/latest.candidate)" <run>` both exit 0; from T5 on, pass `$E/removed.txt` as their third argument. The run's `numTotalTests` equals the previous candidate's plus the tests the task added, and its `numPendingTests` equals base-1's (50 at `452d35e62`), so no new test is skipped.
2. A failure absent from baseline run 1 triggers two more runs in the same attempt. It is tolerated only when base-2 or base-3 also shows it and the runs fail it no more often than the baseline did, or when it is a known flake below whose file passes alone three times in a row. Rule 1 then applies to a run without that failure, which must exist. Otherwise, stop and ask.
3. Run `./test.sh > /tmp/sn-impl/<task>-a<k>-testsh.log 2>&1` once. Define `ids() { grep -E '(^| )FAIL |^✖ |ℹ fail ' "$1" | sed -E 's/ \([0-9.]+ ?m?s\)$//' | sort -u; }` and `pkgs() { grep -E '^> @earendil-works/.* test$' "$1" | sort; }`. Both `diff <(ids /tmp/sn-impl/base-testsh.log) <(ids <log>)` and `diff <(pkgs /tmp/sn-impl/base-testsh.log) <(pkgs <log>)` print nothing. On a difference, rerun once to a new log; stop and ask when it recurs.

Run suites one at a time: suites run in parallel produce load-induced failures.

Known flakes and baseline failures:

| Test | Evidence |
| --- | --- |
| Every test in `agent-session-concurrent.test.ts` | Handoff 14.5. |
| `footer-data-provider.test.ts` "updates the cached branch when the reftable directory changes" | Handoff 14.5. The footer test "debounces rapid reftable updates" is not a known flake. |
| `packages/agent` `docs/mobile-handoff/01-harness/01-delta/delta.test.ts` "dead-op elimination > is linear in the number of ops" | Fails in the baseline `./test.sh` (Appendix A), so `./test.sh` exits 1 on the baseline. A timing test outside coding-agent; rule 3 compares identities, not the exit code. |

Environment facts: other Pi sessions run from the main checkout, so it stays read-only for this whole phase. A fenced Pi denies `/tmp`; run the implementing session with `pi --unfenced`. The live `~/.pi/agent/settings.json` still loads pi-subagents, so any SDK or CLI run outside the test harness must use an isolated agent directory (T11).

## 6. Tasks

Shared rules for every code task:
- Tests turn fork built-ins on with `vi.stubEnv("PI_FORK_BUILTINS", "on")`. Suite tests use `test/suite/harness.ts` and the faux provider, never a real provider.
- Each new test gets one mutation check: break the guarded line, see the test fail, restore, see it pass. Record the mutation in the commit body.
- **Review gate (R11).** It applies to every implementation commit: T1 to T9, each T10 fix, and T11. T0 and T12 commit only the plan and its results record, so they take no review. After validation passes, stage the task's paths explicitly, then dispatch one `code-reviewer` agent on `git diff --cached`. Check each finding against the source. Fix accepted findings, rerun the task's validation as a new attempt, and restage. Append every finding with its disposition (Accepted, Rejected with the disproving source, or Deferred with the owner's yes) to `/tmp/sn-impl/reviews.md` under a heading `## <task id>`, one line per finding starting `- `; a review with no finding records `- none`. Then commit; the hook runs `npm run check`.
- A commit prints `✅ All pre-commit checks passed!`; when it does not, stop.

### T0. Record the plan

The handoff performs this task. Copy `docs/plans/subagents-native-phase1.plan.md` and `docs/plans/subagents-native-phase1-evidence/` (5 files) from the main checkout into the worktree. Each copy's SHA-256 equals its source's, and the evidence hashes equal Appendix B. Stage both paths explicitly and commit `docs: native subagents phase 1 plan`.

### T1. Agent definitions

**Changes.**

| File | Change |
| --- | --- |
| `src/core/fork-builtins/subagents/definitions/types.ts` | `AgentDefinition`: `name`, `displayName`, `color`, `description`, `tools` (base names and `ext:` selectors), `disallowedTools`, `extensions` (`true`, `false` or a list), `excludeExtensions`, `skills`, `model`, `thinking`, `maxTurns`, `persistSession`, `outputTranscript`, `sessionDir`, `allowedSubagents`, `systemPrompt`, `promptMode`, `inheritContext`, `runInBackground`, `isolated`, `memory`, `isolation`, `enabled`, `hidden`, and a discriminated `source`: `default`, `project` or `global` with `sourcePath`, or `skill` with `sourcePath` and `skillId`. |
| `definitions/defaults.ts` | `general-purpose`, `Explore`, `Plan`, with pi-subagents' prompts and tool sets (`src/default-agents.ts`). |
| `definitions/frontmatter.ts` | Parse one `.md` file: BOM strip, snake_case keys, CSV and list forms, `:` in `name` refused, unknown keys collected. |
| `definitions/load.ts` | Discovery from `<agentDir>/agents`, then `<cwd>/.agents/agents` and `<cwd>/.pi/agents` only when the project is trusted. Later sources override earlier ones by name. `strictAgentFiles` makes an unreadable file or an unknown key a load error. |
| `definitions/registry.ts` | Case-insensitive resolution, `enabled: false`, `disableDefaultAgents`, `fallbackSubagent` (a name, or `none`). Skill-bundled agents under `skill:agent`, with the bare alias only when free (ADR-0008); skill agents hidden from listings. |
| Tests | `test/fork-builtins/subagents/definitions.test.ts`. |

**Validation.** The new test file passes alone. Cases: each frontmatter key; a BOM file; an unknown key warns with file and key, and fails under `strictAgentFiles`; `thinkingLevel` warns; an untrusted project's `.pi/agents/*.md` is not loaded; project overrides global by name; case-insensitive and ambiguous resolution; fallback to `general-purpose`, to a named agent, and refusal under `none`; the documented defaults of the three default agents; bare skill alias only when free; a skill agent hidden from listings but resolvable by qualified name. `npm run check` exits 0. Regression rule.

**Commit.** `feat(coding-agent): native subagent definitions with a trust gate and frontmatter warnings`.

### T2. Settings and model resolution

**Changes.**

| File | Change |
| --- | --- |
| `subagents/settings/settings.ts` | Read `forkBuiltins.subagents` through the session's `SettingsManager`, global merged under project; project values only when trusted. Keys, defaults and ranges from pi-subagents `src/settings.ts`, minus `workflowsEnabled` and `schedulingEnabled`. Out-of-range or wrongly typed values are dropped with one warning per key. `writeProjectSubagentSettings(cwd, values)` writes only the `forkBuiltins.subagents` object of `<cwd>/.pi/settings.json`, preserving every other key. |
| `subagents/settings/models.ts` | Fuzzy model resolution (pi-subagents `src/model-resolver.ts`) and scope checks against `settingsManager.getEnabledModels()` (pi-subagents `src/model-scope.ts` rules). The invocation merge where frontmatter is authoritative and tool parameters fill only unset fields (pi-subagents `src/invocation-config.ts`). |
| Tests | `test/fork-builtins/subagents/settings.test.ts`, `models.test.ts`. |

**Validation.** The new files pass alone. Cases: global and project merge; untrusted project ignored; each key's range and default; the writer leaves every other key's parsed value deep-equal; model precedence exact, fuzzy under provider, any provider, unavailable; scope outcomes for caller-supplied (error listing allowed models), frontmatter (warning, runs) and inherited (warning, runs) models; frontmatter beats a tool parameter for each locked field. `npm run check` exits 0. Regression rule.

**Commit.** `feat(coding-agent): subagent settings under forkBuiltins and model resolution`.

### T3. The child-session runner

**Changes.**

| File | Change |
| --- | --- |
| `subagents/runner/scope.ts` | Tool scoping per R7 and the "Subagent tools in children" default. Known names come from the parent's `getAllTools()`. Fork base tools (`forkBaseToolNames`) go into `excludeTools` unless `tools:` names them. The three subagent tools go into `excludeTools` unless T6 injects them. `extensions: false` or `isolated` drop every inline built-in and every path extension through `extensionsOverride`; a list keeps the named extensions, `<inline:name>` included; `exclude_extensions` wins. `ext:` selectors narrow the active set after bind, re-applied when tools register late. `disallowed_tools` wins over everything. An unknown `tools:` name warns. |
| `subagents/runner/prompt.ts` | `replace` and `append` modes, the environment block, the memory block, skill preload from the parent's `resourceLoader.getSkills()`, and `inherit_context` (the parent's conversation forked into the child). |
| `subagents/runner/memory.ts` | `user`, `project`, `local` scopes; read-only fallback for agents without write tools. No legacy path. |
| `subagents/runner/run.ts` | Build the child: store its lineage for the new loader's event bus (Section 2.1 "Child lineage"), then `DefaultResourceLoader` with the override, `createAgentSession` with the parent's `modelRuntime`, child `SettingsManager` (Section 2.1 default). The runner owns the loader. Persist the session under `<sessionDir>/.subagents/` when `persistSession` or `rememberAgents` says so, or exactly at `session_dir:` when set. Graceful `maxTurns` with `graceTurns`. The `.output` transcript under the OS temp directory unless `outputTranscript` is off. Returns final text, usage and status. `teardownChild(child)` implements Section 2.1 "Child teardown". |
| Tests | `test/suite/fork-subagents-runner.test.ts`, plus module tests for `scope.ts`, `prompt.ts` and `memory.ts`. |

**Validation.** Suite cases read the child's request through `getCurrentTools` or the child's files:
- a child without `tools:` naming them lacks `ask_user_question` and `vcc_recall`; naming one activates it;
- a child never receives `Agent`, even when `tools:` names it, and the naming warns;
- `isolated` drops `<inline:tokensave>` and path extensions, and a `skills:` list puts no skill content in the child's prompt (Section 2.1 "Isolated agents"); `exclude_extensions: tokensave` drops it; `ext:` narrowing hides a non-selected extension tool, including one registered after bind;
- `maxTurns` sends the wrap-up, then stops with the partial result;
- `replace` mode omits the parent prompt; `append` includes it; `inherit_context` gives the child the parent's messages;
- `skills: [name]` puts that skill's content in the child's system prompt;
- `memory: project` with write tools persists a file under `.pi/agent-memory/<name>/`; a read-only agent gets the read-only memory block;
- the `.output` transcript holds the child's messages, and none is written under `output_transcript: false`;
- after `compact()` on a child that answered several turns, a further turn reaches the transcript, and every pre-compaction answer appears in it exactly once (pi-subagents `test/output-file-compaction-e2e.test.ts:128-156`); the task's mutation for this case stops the writer from tracking entries after a compaction;
- a persisted child's session file lands under `.subagents/`, and `session_dir:` is used verbatim;
- a failing child startup reports status `error` with the cause, and the child's loader is disposed (a spy on `dispose`);
- `teardownChild` delivers `session_shutdown` to a child extension's handler, then disposes the child session and its loader; a handler that never settles is cut at 3 s (fake timers) and disposal still happens;
- with a child extension tool that never returns and ignores its abort signal, `teardownChild` still delivers `session_shutdown` once within 3 s, then disposes (the teardown scratch probe's case, Appendix A); the task's mutation for this case awaits `abort()` before emitting;
- with a child extension whose `session_shutdown` handler throws and whose extension error listener also throws (the case in `test/agent-session-shutdown-emit.test.ts:184-217`), `teardownChild` resolves, disposes the child session and its loader, records an `extension-error` activity, and leaves no unhandled rejection; the task's mutation for this case moves the disposal out of the `finally`;
- `lineageForBus(childLoader.getEventBus())` returns the parent record, the depth and the isolation flag for a child the runner built. T5 checks that the child's per-session record carries it.

Old-test mapping: `child-session-shutdown` (`test/child-session-shutdown.test.ts:71-127` at `79a7c42`) maps to the teardown cases.

`npm run check` exits 0. Regression rule.

**Commit.** `feat(coding-agent): subagent child sessions scoped by agent definitions`.

### T4. The per-session service

**Changes.**

| File | Change |
| --- | --- |
| `subagents/service/service.ts` | `SubagentService` for one `AgentSession`, constructed from the session and its per-session record (Section 2.1). T5 adds the lazy `subagentServiceFor` lookup and the record registration (Appendix B); T4's tests construct the service directly on a harness session. It owns records (id, handle, alias, type, status, result, usage, parent record), the background pool (`maxConcurrent`) and the foreground pool (`maxConcurrentForeground`) with Section 2.1 "Pool eligibility", the queue, steer (`session.steer` on the child), resume of a persisted child, stop, `waitForResult(id, signal)` per Section 2.1 "Result waits", `refreshDefinitions()` per Section 2.1 "Definition refresh", and `defaultJoinMode` (`async`, `group`, `smart`). Every spawn reloads definitions first. It applies Section 2.1 "Record retention" and ends children through `teardownChild` (T3). It registers `registerSessionResourceCleanup` on construction; when the parent's session id is cleaned up, it aborts every running and queued child, then tears down every child, running, queued or finished (R6). |
| `subagents/service/notifications.ts` | Completion delivery through `session.sendCustomMessage({ customType: "subagent-notification", ... }, { deliverAs, triggerTurn, discardIf })`, held while the parent streams and flushed on `agent_settled` (`session.subscribe`). `discardIf` drops a notification whose result the model already fetched. |
| `subagents/service/usage.ts` | Lifetime usage per agent, counted once across resumes; `reportUsage` attaches it to tool results. |
| Tests | `test/fork-builtins/subagents/service.test.ts` and `test/suite/fork-subagents-service.test.ts`. |

**Validation.** Cases:
- a background spawn completes and delivers one notification after the parent settles; a result fetched first discards it;
- `async` join gives two notifications for two agents; `group` gives one notification holding both; `smart` groups agents spawned in the same turn and keeps a later one separate; a group whose member is late delivers the finished members at the group timeout;
- the background pool queues the eleventh background spawn at `maxConcurrent: 10`, detached background spawns (`isBackground: true`, as RPC sends them) included; `maxConcurrentForeground: 1` queues the second blocking spawn; a detached spawn without `isBackground` starts at once while a blocking spawn holds the only foreground slot;
- `waitForResult` on a running agent, then on a queued one: aborting the signal rejects only that wait, the agent keeps running (or stays queued), its result stays unread, its notification is still delivered, and no waiter listener remains;
- steer reaches a running child; stop reports partial output with status `stopped`;
- `resume` of a finished persisted agent reopens its session file and appends to it;
- an agent file written to the project's `.pi/agents/` after the service was built is spawnable at the next spawn, with no restart; `refreshDefinitions()` picks up a disabled agent the same way; both leave existing records and their results unchanged;
- lifetime usage equals the sum of the child's assistant usages; a resumed agent counts only its new turns; with `reportUsage` the spawn result carries `usage` for T5's tools to attach;
- each terminal status (`completed`, `steered`, `aborted`, `stopped`, `error`) is recorded;
- parent `dispose()` aborts running and queued children, tears down every child including finished ones (their loaders' `dispose` spies fire), and leaves no cleanup hook registered; session replacement (`AgentSessionRuntime.newSession`) does the same;
- retention, with fake timers: a finished record is retrievable at 9 minutes and evicted at 11, and eviction tears its child down; running and queued records are never evicted; the 101st tombstone drops the oldest, and a tombstone keeps the evicted persisted child's session file.

`npm run check` exits 0. Regression rule.

**Commit.** `feat(coding-agent): per-session subagent service owned by its session`.

### T5. The three base tools

**Changes.**

| File | Change |
| --- | --- |
| `src/core/agent-session.ts` | One added line, `session: this,`, as the first property of the `addForkBaseTools` options (Appendix B). |
| `src/core/fork-builtins/base-tools.ts` | `ForkBaseToolOptions` gains `session: AgentSession`. Store the per-session record without reading the session, with the lineage `lineageForBus(options.eventBus)` returns (T3). Register `Agent`, `get_subagent_result` and `steer_subagent` through `addOwned`; each resolves the service lazily. |
| `subagents/service/service.ts` | `subagentServiceFor(session)`: the `WeakMap<AgentSession, SubagentService>` lookup that builds the service from the session's per-session record on first use (Appendix B). |
| `subagents/tools/agent.ts` | `Agent` parameters: `prompt`, `description`, `name`, `subagent_type`, `model`, `thinking`, `max_turns`, `run_in_background`, `resume`, `isolated`, `inherit_context`, and `isolation` only when `worktreeIsolation` is on. Frontmatter is authoritative. `backgroundByDefault` decides an unset `run_in_background`. |
| `subagents/tools/result.ts`, `steer.ts` | `get_subagent_result` (`agent_id`, `wait`, `verbose`) and `steer_subagent` (`agent_id`, `message`); handles accepted as ids. |
| `subagents/tools/description.ts` | `full`, `compact` and `custom` descriptions; `custom` reads `.pi/agent-tool-description.md` only when trusted, then `<agentDir>/agent-tool-description.md`, then falls back to `full` with a warning. |
| `test/fork-builtins/base-tools.test.ts` | Expect the three new names; register with a session proxy that throws on any read (Appendix B). The renamed test is listed in `$E/removed.txt`. |
| Tests | `test/suite/fork-subagents-tools.test.ts`. |

**Validation.**
- `git diff --numstat $BASE -- packages/coding-agent/src/core/agent-session.ts` prints `1	0	packages/coding-agent/src/core/agent-session.ts`, and `git diff $BASE -- packages/coding-agent/src/core/agent-session.ts | grep -cxF '+			session: this,'` prints `1`.
- Suite cases: `Agent` foreground returns the child's text; background returns an id and a later notification; `get_subagent_result` with `wait` returns the finished result; cancelling a `get_subagent_result` call with `wait` returns without stopping the agent, whose notification still arrives; an unknown `subagent_type` under `fallbackSubagent: none` returns an error naming the available types; the three tools are absent with `PI_FORK_BUILTINS=off`, absent when the allowlist omits them, and removed by the exclude list; an extension tool named `Agent` overrides the base tool; the tool description switches with `toolDescriptionMode`; an untrusted project's custom description is ignored.
- Wiring cases: after `/reload`, `subagentServiceFor` returns the same service, and `get_subagent_result` still returns an agent finished before the reload; a child session built by T3's runner has a per-session record whose lineage is the one `lineageForBus` returned for its loader's bus; with `reportUsage`, the `Agent` result carries `usage`.
- `npm run check` exits 0. Regression rule, with `$E/removed.txt`.

**Commit.** `feat(coding-agent): Agent, get_subagent_result and steer_subagent as fork base tools`.

### T6. Nested subagents

**Changes.** `subagents/service/nested.ts`: an agent with `allowed_subagents` that is not isolated (Section 2.1 "Isolated agents") gets scoped copies of the three tools as `customTools`, bound to its own record as parent; T3 leaves their names out of `excludeTools`. Depth counts from the main session (main 0); `maxSubagentDepth` (default 2) stops injection at the cap. A parent agent's end aborts its children (R6). Nested children's usage and transcripts roll up to the parent. Nested spawns default to foreground. The nested runtime also serves the child's RPC and skill-fork spawns (Section 2.1 "Child lineage"; T8 wires them). Tests: `test/suite/fork-subagents-nested.test.ts`.

**Validation.** Cases:
- an agent with `allowed_subagents` and no subagent names in `tools:` receives the three nested tools, each with source `<sdk:NAME>`;
- an agent with `isolated: true` and `allowed_subagents: all` receives none of them;
- a nested spawn outside `allowed_subagents` fails naming the allowed list;
- the depth cap removes the tools;
- a parent's completion aborts a running child;
- a child cannot fetch or steer an agent it does not own;
- a nested child's usage is counted once in the parent's total;
- with `maxConcurrentForeground: 1` and `maxConcurrent: 1`, a foreground parent that delegates to a nested child finishes: the child occupies no slot;
- the main session's `get_subagent_result`, `steer_subagent` and `Agent` with `resume` treat a nested record's id as unknown (Section 2.1 "Top-level visibility").

`npm run check` exits 0. Regression rule, with `$E/removed.txt`.

**Commit.** `feat(coding-agent): nested subagents owned by their parent agent`.

### T7. Worktree isolation

**Changes.** `subagents/runner/worktree.ts`: `isolation: "worktree"` creates a git worktree under the OS temp directory and records its path. The child runs there. On completion, its changes are committed to a `pi-agent-<id>` branch, then the recorded worktree is removed. Frontmatter `off` refuses one. `worktreeIsolation: false` drops the request silently and hides the parameter (T5). A directory outside a git repository fails the spawn with a named error. The "Worktree preservation" default governs every failure. Tests: `test/fork-builtins/subagents/worktree.test.ts`, with git isolated from the developer's configuration (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`).

**Validation.** Cases:
- a child's file change lands on the branch and the main tree is unchanged;
- no change means no branch, and the worktree is removed;
- an aborted child with changes commits them, then removes the worktree;
- a failing commit (a `pre-commit` hook that exits 1 in the test repository) keeps the worktree and reports its path and the error;
- a failing branch creation (the branch name already exists) does the same;
- no test run leaves a worktree registered in `git worktree list` except the preserved ones, and the main repository's other worktrees stay listed.

`npm run check` exits 0. Regression rule, with `$E/removed.txt`.

**Commit.** `feat(coding-agent): worktree isolation for subagents that never discards changes`.

### T8. Bus adapter, skill-fork over the service

**Changes.**

| File | Change |
| --- | --- |
| `subagents/adapter/install.ts` | `installSubagentAdapter(session, bus)`, called from `addForkBaseTools` when the options carry an event bus (Appendix B). Once per session; `subagents:ready` on every call; leaves the bus through the cleanup hook. |
| `subagents/adapter/events.ts` | Emit `subagents:created`, `started`, `completed`, `failed`, `steered`, `compacted`, `agent-ended`, `settings_loaded`, `settings_changed` with pi-subagents' payloads (`docs/rpc.md` and `README.md` "Events" at `79a7c42`). A top-level record's events go to its session's bus; a record started from a child's bus has its events on that child's bus only (Section 2.1 "Child lineage", "Top-level visibility"). A fixture `test/fork-builtins/subagents/fixtures/lifecycle-events.json` holds one complete example payload per event, and one per terminal status for `completed`, `failed` and `agent-ended`, and cites the doc lines. |
| `subagents/adapter/rpc.ts` | Answer `subagents:rpc:ping` (protocol 3, `capabilities.skillAgents: true`), `spawn`, `stop`, `consume` with pi-subagents' reply envelopes and error strings (`src/cross-extension-rpc.ts` at `79a7c42`). A string `model` option resolves through T2. An RPC spawn is detached: it occupies no foreground slot. In a child session, the handlers follow Section 2.1 "Child lineage". A `consume` marks the result read, so its notification is discarded. |
| `subagents/adapter/skill-agents.ts` | Publish `skill-agents:rewrite-maps` with a monotonic revision at install, on each `skills:changed`, and after a definition reload that changes a map (Section 2.1 "Definition refresh"); an unchanged map publishes nothing. Answer `skill-agents:query` with the current maps. Types from `skills/runtime.ts:36-57`. |
| `src/core/agent-session.ts` | One added line, `session: this,`, in the options of the fork's `SkillForkClient` construction. |
| `src/core/skills/skill-fork.ts` | Options gain `session?: AgentSession`. When the session has a per-session record, `detectPresence`, `spawn`, `stop` and completion waits go to `subagentServiceFor(session)`, which creates the service when needed. In a child session, those spawns follow Section 2.1 "Child lineage". With no record, the event-bus path runs unchanged. |
| Tests | `test/suite/fork-subagents-adapter.test.ts`, which also holds the skill-fork cases. |

**Validation.**
- `git diff --numstat $BASE -- packages/coding-agent/src/core/agent-session.ts` prints `2	0	packages/coding-agent/src/core/agent-session.ts`, and `git diff $BASE -- packages/coding-agent/src/core/agent-session.ts | grep -cxF '+			session: this,'` prints `2`.
- `test/suite/skills-fork.test.ts` and `test/suite/skill-contract.test.ts` pass unchanged.
- Cold-session cases, with no subagent tool called first: ping answers protocol 3; `spawn` returns an id and `subagents:completed` follows with that id; a `context: fork` skill runs through the service and no `subagents:rpc:ping` is emitted.
- Each lifecycle event's payload deep-equals the fixture's example for the same inputs, with ids and times normalized. `normalizeSubagentCompletion` and `normalizeAgentEnded` (`skills/skill-fork.ts:87-135`) map every terminal-status example to the expected `ok` value. `stop` and `consume` reply envelopes and error strings match `cross-extension-rpc.ts`.
- A listener that sends `subagents:rpc:consume` from inside its `subagents:completed` handler leaves zero `subagent-notification` messages in the session (pi-subagents `test/rpc-result-consumption.test.ts:154-166`).
- An RPC spawn without `isBackground` starts at once while a blocking `Agent` call holds the only foreground slot (`maxConcurrentForeground: 1`). Two RPC spawns with `isBackground: true` under `maxConcurrent: 1` run one at a time: the second replies with its id at once and starts after the first ends.
- A nested record emits no `subagents:*` event on the main session's bus; RPC `stop` and `consume` of its id on that bus reply `Agent is owned by another agent or workflow`.
- In a child session without `allowed_subagents`, or with `isolated: true`, an RPC spawn on the child's bus replies with an error and starts nothing. With `allowed_subagents`, it starts a nested child owned by that agent: `subagents:completed` (and, for a failing child, `subagents:failed`) for it arrives on the child's bus with its id, and never on the main session's bus. At the depth cap it replies with an error.
- The same three child cases hold for a `context: fork` skill run inside the child through the typed skill-fork path: refused without permission or under `isolated`, owned by the agent with permission, refused at the cap.
- A skill change that frees a bare agent name publishes a higher revision with `collided: false`; a query returns the latest revision.
- With the skill set unchanged, adding a project agent whose name collides with a skill agent's bare name publishes a higher revision with `collided: true` at the next spawn or `refreshDefinitions()`; disabling it publishes one with `collided: false`; a reload that changes nothing publishes no revision.
- After two `/reload` calls, `subagents:ready` has been emitted three times, and one ping gets exactly one reply.
- After `dispose()`, a ping gets no answer within 100 ms.
- Mutation checks for this task include a wrong terminal `status` value in the `completed` payload, a `consume` that replies success but leaves the result unread, a typed skill-fork path that ignores the child's lineage, and child events emitted on the main session's bus.

`npm run check` exits 0. Regression rule, with `$E/removed.txt`.

**Commit.** `feat(coding-agent): subagents bus adapter; skill-fork calls the service`.

### T9. Documentation

**Changes.**
- `packages/coding-agent/src/core/fork-builtins/subagents/README.md`: the service, the tools, settings keys with defaults, frontmatter keys, trust behavior, lineage and visibility, retention, events and RPC, and what phase 2 adds.
- ADR-0009 amendment dated 2026-09-27: subagents as the third fork base-tool set; the settings-write exception (R5); the child-session rule (R7); the footprint of 12 plus 2 lines in `agent-session.ts`.
- `$E/checklist.md`: a table with columns `Old file | Status | Covering tests`, one row per old test file at `79a7c42`. `Status` is `Covered`, `Phase 2`, `Phase 3` or `Dropped: <reason>`. For `Covered`, `Covering tests` lists vitest identities as `<file relative to packages/coding-agent> > <full test name>`, separated by `; `.
- `$E/check-checklist.mjs <checklist.md> <vitest report.json>`: exits 1 when a `Covered` row lists no identity, or lists one that does not pass in the report; prints each offending row. `unrun`: no probe built it.

**Validation.**
- `npm run check` exits 0.
- For each key in `settings.ts`'s key list, `grep -cF "<key>" packages/coding-agent/src/core/fork-builtins/subagents/README.md` prints at least 1.
- For each term `Agent`, `get_subagent_result`, `steer_subagent`, `forkBuiltins.subagents`, `excludeTools`, `2026-09-27`, `session: this`, `grep -cF` on the ADR prints at least 1.
- `git -C /Users/paolof/Developer/ai/pi-subagents ls-tree -r --name-only 79a7c42 test | grep -E '\.test\.ts$'` lists 116 files, and for each, `grep -cF "<file>" $E/checklist.md` prints exactly 1.
- `node $E/check-checklist.mjs $E/checklist.md "$(cat /tmp/sn-impl/T8.candidate)"` exits 0, and exits 1 on a copy of the checklist with one identity misspelled.

**Commit.** `docs: native subagents phase 1 README, ADR-0009 amendment and test checklist`.

### T10. Phase review

**Changes.** Run the `super-code-review` skill over `$BASE..HEAD` (R11), with the plan and the handoff as the spec. Write `/tmp/sn-impl/phase-review.md` with the first line `Verdict: <the skill's verdict>`. Check each finding against the source, and record it as a heading `### F<n>: <one line>` followed by one line `Disposition: Accepted`, `Disposition: Rejected: <disproving source>` or `Disposition: Deferred: <reason>`. Present the verdict and the dispositions to the owner, and wait for the owner's yes per accepted finding to apply. Each applied finding is its own code task with id `T10-F<n>`: it follows the regression rule (its candidate goes to `/tmp/sn-impl/T10-F<n>.candidate` and `latest.candidate`) and the review gate, is committed on its own, and gets `Applied: <commit hash>` under its heading.

**Validation.** With `P=/tmp/sn-impl/phase-review.md`:
- `head -1 $P | grep -c '^Verdict: .'` prints `1`.
- `grep -c '^### F[0-9]' $P` equals `grep -c '^Disposition: ' $P`.
- `for h in $(sed -n 's/^Applied: //p' $P); do git merge-base --is-ancestor "$h" HEAD || echo "missing $h"; done` prints nothing.
- `grep -c '^Applied: ' $P` equals `ls /tmp/sn-impl/T10-F*.candidate 2>/dev/null | wc -l`.

Whether a disposition is right stays the owner's judgment.

**Commit.** One per applied finding, `fix(coding-agent): <finding>`; none when nothing is applied.

### T11. Validate the built outputs

**Changes.** `$E/sdk-probe.mjs`, modeled on `docs/plans/ask-user-question-base-tool-evidence/sdk-probe.mjs`. It imports `<dist>/index.js`, creates its agent directory and working directory with `mkdtemp`, builds a session with `createAgentSession`, an in-memory `SettingsManager` and a faux provider, and removes its directories before it exits. It asserts:
- with the switch unset: `Agent`, `get_subagent_result` and `steer_subagent` are present with `sourceInfo.path` `<builtin:NAME>`; every loaded extension path starts with `<inline:`; one foreground `Agent` call returns the scripted child text;
- with `PI_FORK_BUILTINS=off`: none of the three is present.
It prints one JSON line and exits 0 on a match, 1 on a mismatch, 2 on bad input. `unrun`: no probe built this script. First check that `<dist>/index.js` exports `createAgentSession`, `SettingsManager` and `DefaultResourceLoader`, and that `@earendil-works/pi-ai/compat` exports `registerFauxProvider`; when one is missing, stop and ask.

**Validation.** Run `npm run build:offline`. Then `mkdir /tmp/sn-impl/home`, which must succeed, and run each mode with an isolated home:
- `env -i PATH="$PATH" HOME=/tmp/sn-impl/home PI_CODING_AGENT_DIR=/tmp/sn-impl/home/.pi/agent node $E/sdk-probe.mjs packages/coding-agent/dist on` exits 0;
- the same with `PI_FORK_BUILTINS=off` and mode `off` exits 0;
- a deliberately wrong expectation (mode `off` without the switch) exits 1.
`shasum -a 256 -c /tmp/sn-impl/live-settings.sha256` passes afterwards. `git status --short` prints only `$E/sdk-probe.mjs`.

**Commit.** `docs: native subagents phase 1 SDK probe`.

### T12. Record the results

**Changes.** `docs/plans/subagents-native-phase1.results.md`: commits; one section `### T<n> <title>` per task from T1 to T9, and one for T11. Sections T1 to T8 open with `Candidate: <path from T<n>.candidate> (<numTotalTests> tests, <numFailedTests> failed, <numPendingTests> pending)` and `Mutations: <each mutation and its failing test>`. Every section from T1 to T9, and the T11 section, then holds `Review:` followed by that task's `- ` lines from `/tmp/sn-impl/reviews.md`, copied verbatim. The T11 section also holds the probe's three JSON lines. A `## Phase review` section holds `/tmp/sn-impl/phase-review.md` verbatim, followed by each `T10-F<n>` candidate and its review lines. Then the deviations.

**Validation.** With `R=docs/plans/subagents-native-phase1.results.md`:
- `for h in $(git log --format=%h $BASE..HEAD); do grep -qF "$h" $R || echo "missing $h"; done` prints nothing.
- `for t in T1 T2 T3 T4 T5 T6 T7 T8 T9 T11; do awk -v t="### $t" '$0 ~ "^"t"([^0-9]|$)"{f=1;next} /^#{2,3} /{f=0} f' $R > /tmp/sn-impl/sec.txt; grep -q '^Review:' /tmp/sn-impl/sec.txt || echo "$t lacks Review"; case $t in T9|T11) continue;; esac; c=$(sed -n 's/^Candidate: \([^ ]*\).*/\1/p' /tmp/sn-impl/sec.txt); [ "$c" = "$(cat /tmp/sn-impl/$t.candidate)" ] && test -f "$c" || echo "$t candidate wrong"; grep -qE '^Mutations: [^ ]' /tmp/sn-impl/sec.txt || echo "$t lacks Mutations"; done` prints nothing.
- `grep -E '^- ' /tmp/sn-impl/reviews.md | grep -vxFf $R` prints nothing: every review line is in the results file verbatim.
- `grep -v '^$' /tmp/sn-impl/phase-review.md | grep -vxFf $R` prints nothing: the phase review is in it verbatim.

**Commit.** `docs: native subagents phase 1 results`.

## 7. Test plan

| Layer | What it proves | When it runs |
| --- | --- | --- |
| Module tests under `test/fork-builtins/subagents/` | Definitions, settings, models, scoping, prompts, memory, service bookkeeping, worktrees | Each task, and every `./test.sh` |
| Suite tests `test/suite/fork-subagents-*.test.ts` | Real parent and child sessions: R6, R7, the tools, nesting, the adapter, cold-session RPC and skill-fork | Each task, and every `./test.sh` |
| `test/fork-builtins/base-tools.test.ts` | Registration names, and that registration reads nothing from the session | T5 |
| Existing `skills-fork` and `skill-contract` suites | The bus path still works for third parties | T8 |
| Identity check (`test-identities.mjs`) against base-1 and against the previous candidate, plus the pending-count check | Every baseline-passing test and every test an earlier task added still passes; no test becomes skipped | Each task |
| Built SDK (T11) | The outputs carry the tools with builtin provenance, and the switch removes them | T11 |
| Footprint check | `git diff --numstat $BASE` of `agent-session.ts` shows exactly the R10 lines | T5, T8, and after every later merge of upstream |
| Protected-state check | `personal`, the main checkout's `packages/` status and the live `settings.json` match setup | Done criteria |

Mutations the probe already confirmed (Appendix A): M1 child excludes, M2 inline built-in filter, M3 per-session reuse, M4 session cascade, M5 lazy service, M6 ping handler, M7 adapter teardown, M8 ready announcement, M9 adapter installation. Each task adds one mutation per new behavior, recorded in its commit body.

**Old-test checklist (R9).** Every one of the 116 old test files maps to a task, a later phase, or a deliberate drop. The named validation cases of each task carry the mapping; T9 writes it per case.

| Covered by | Old test files at `79a7c42` |
| --- | --- |
| T1 | `agent-dir-loader`, `agent-file-bom`, `agent-types`, `custom-agents`, `documented-defaults`, `fallback-subagent-wiring`, `skill-agents`, `strict-agent-files-wiring` |
| T2 | `settings`, `enabled-models`, `model-resolver`, `model-scope`, `invocation-config`, `agent-runner-settings` |
| T3 | `agent-runner`, `agent-runner-e2e`, `prompts`, `context`, `env`, `memory`, `isolation-param`, `output-file`, `output-file-path`, `output-transcript-wiring`, `ext-templates-e2e`, `e2e/loader-lifecycle`, `e2e/tool-veto-reachability`, `e2e/turn-limit-steer`, `e2e/output-transcript`, `e2e/isolated-provider`, `output-file-compaction-e2e`, `agent-startup-error`, `child-session-shutdown` |
| T4 | `agent-manager`, `agent-manager-gc`, `agent-ended-statuses`, `background-by-default`, `background-resume-wiring`, `foreground-concurrency`, `foreground-concurrency-wiring`, `foreground-result-retrieval`, `group-join`, `notification-boundary`, `wait-queued`, `usage`, `usage-reporting`, `e2e/usage-reaches-session-stats`, `abortable`, `subagent-error-status-e2e`, `print-mode`, `subagents-print-mode-e2e`, `foreground-concurrency-print-mode-e2e`, `status-note-wiring`, `clear-completed-wiring`, `perf/spawn-invariants` |
| T5 | `tool-description-mode`, `steer-subagent-wiring`, `agent-tool-error-rendering` (result text only; rendering is phase 2) |
| T6 | `nested-tools`, `nested-delegation-e2e`, `subagents-nested-print-mode-e2e` |
| T7 | `worktree`, `worktree-isolation-e2e` |
| T8 | `cross-extension-rpc`, `rpc-lifecycle-gating`, `rpc-result-consumption`, `skill-agents-e2e`, `skills-contract` |
| Phase 2 | `agent-color`, `agent-color-surfaces`, `agent-file-toggle`, `agent-model-display`, `agent-widget`, `conversation-viewer`, `conversation-viewer-keybindings`, `cost-display`, `fleet-list`, `fleet-wiring`, `perf/no-fs-on-render`, `perf/render-invariants` |
| Phase 3 | `agent-mention-provider`, `agent-mention-wiring`, `mention`, `mention-clone`, `mention-start-notification`, `e2e/mention-clone` |
| Dropped | The 18 `workflow-*` files and `e2e/workflow`, `structured-output`, and the 5 `schedule*` files (R2); `child-context` (no child flag under W2); `manager-registry-guard` (no global registry); `skill-loader` (Pi's skills replace it); `memory-legacy-fallback` (legacy path dropped); `unnest-script` (a script for old session layouts) |

**Not proved by this plan.** Behavior in the TUI and RPC modes with a live model; the phase 2 UI; an awaited child teardown on parent shutdown (phase 2); OpenIntent workers; fenced runs; graceful cancel (handoff 12.1); coexistence with the old extension (R8 forbids it; phase 3 removes it).

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| The runner is the largest task, and pi-subagents' scoping has subtle history (#75, #125). | T3's suite cases read the child's actual request; the scoping workaround is kept (Section 2.1). |
| `Agent` becomes active in every session, OpenIntent workers included. A worker policy without `tools` leaves every tool open (`worker-policy-extension.ts:156` at `d64cc9c`). | The branch reaches `personal` only at cutover (R8). Phase 3's cutover requires a verified worker-side exclusion (Section 10). |
| The old extension and the native adapter both answer `subagents:rpc:*` if both load. | R8: no coexistence. Phase 3 removes the settings entry in the same step as the fast-forward and checks that only `<builtin:Agent>` loads. |
| An import cycle through `sdk.ts` appears as more modules join. | The probe showed none; `npm run check` and the suite load `agent-session.ts` first on every task. |
| The cleanup hook's global set holds every session with a bus until it is disposed. | The hook unregisters on dispose; T4 and T8 test that no hook stays registered. Sessions an SDK caller never disposes keep one entry each, as before. |
| Until phase 2, a parent's disposal starts child teardown without awaiting it, so a print-mode process that exits at once can cut child `session_shutdown` handlers short. | Children are aborted synchronously first. Phase 2's factory awaits the teardown from `session_shutdown`; Section 2.3 records the difference. |
| A child that loads an RPC consumer (pi-tasks today, native later) could start agents outside its owner. | Section 2.1 "Child lineage"; T8 tests the refusal and the depth cap on a child's bus. |
| Notifications render as plain custom messages until phase 2. | Acceptable on the feature branch; no user sees it before cutover. |
| Upstream merges touch the `addForkBaseTools` or `SkillForkClient` blocks. | The footprint check in Section 7. |
| An SDK or CLI run on this machine loads the live pi-subagents. | T11 runs with an isolated home and agent directory, and checks the live settings hash afterwards. |

## 9. Done criteria

- T0 to T12 are committed on `feat/subagents-native`: `git log --oneline $BASE..HEAD` lists every commit message of Section 6.
- `npm run check` exits 0 at the last commit.
- The last candidate run shows no new failure against base-1 (`failing-tests.mjs diff`), and `test-identities.mjs` with `$E/removed.txt` exits 0.
- `git diff --numstat $BASE -- packages/coding-agent/src/core/agent-session.ts` prints `2	0	packages/coding-agent/src/core/agent-session.ts`.
- T11's three runs exit 0, 0 and 1, and the results file holds their JSON lines.
- The protected state matches setup: `git -C $M rev-parse personal | diff - /tmp/sn-impl/personal.ref`, `git -C $M status --porcelain=v1 -- packages | diff - /tmp/sn-impl/main-packages.status` and `shasum -a 256 -c /tmp/sn-impl/live-settings.sha256` all succeed. On a difference, stop and ask; another session may have caused it, so never restore anything.

## 10. Later phases

| Order | Item | Prerequisite |
| --- | --- | --- |
| 2 | Presentation factory: widget, FleetView, conversation viewer, `/agents` with settings (writes through T2's writer), create wizard, eject, notification renderer; its `session_shutdown` handler awaits the service's child teardown | Phase 1 on the branch |
| 3 | Mentions (input hook, autocomplete, clone); the engine amendment; one fast-forward of `personal` with removal of the pi-subagents `settings.json` entry (R8) | Phase 2, and a verified worker-side exclusion of `Agent`, `get_subagent_result` and `steer_subagent` accepted by the workflow work |
| 4 | pi-tasks on the typed service | Phase 3 |

## Appendix A. Probe measurements

Start commit `452d35e62c2609106c43013fbac22c3e62bde176`, 2026-09-27.

| Run | Tests | Failed |
| --- | --- | --- |
| base-1, base-2, base-3 (coding-agent) | 4,628 | 0 |
| probe-1 (coding-agent, wiring only) | 4,632 | 0 |
| probe-2 (coding-agent, wiring and adapter) | 4,635 | 0 |
| base `./test.sh` | coding-agent 4,578 passed and 50 skipped; `packages/agent` 1 failed, 971 passed, 1 skipped | `delta.test.ts` "is linear in the number of ops"; exit 1 |

- `failing-tests.mjs diff base-1 base-2` and `base-1 base-3`: no failures. `diff base-1 probe-2`: no new, fixed or unchanged failures.
- `test-identities.mjs base-1 probe-2`: 1 missing (the renamed base-tools test) and exit 1. With `removed.txt`: 0 missing, 0 failing, 8 added, exit 0.
- The five affected files (`fork-subagents-probe`, `base-tools`, `fork-base-tools`, `skills-fork`, `skill-contract`): 146 of 146 pass.
- `npm run check` exited 0 after each probe step.
- Hook: after `cp -R .husky/_` into the probe worktree, `git hook run pre-commit` exited 0 in 8 s with `✅ All pre-commit checks passed!`. Before the copy, `.husky/_` did not exist there.
- Child adapter, a scratch test run before pass 3 and then deleted (not in `probe.patch`): after one `service.spawn`, `child.session.resourceLoader.getEventBus()` is the child loader's bus, a ping on that bus answers protocol 3, and after the parent's `dispose()` the same ping gets no answer within 100 ms. With the adapter installation removed (M9), the test fails; restored, it passes. The probe worktree's diff hashes to `probe.patch` again afterwards.
- Teardown, a scratch test run after pass 3 and then deleted (not in `probe.patch`): a harness session with an inline extension whose tool never returns and ignores its abort signal, and a `session_shutdown` handler that counts calls. Starting `abort()` and awaiting it before `emitShutdownOnce`, raced against 300 ms, timed out with 0 calls. Starting `abort()` without awaiting it and racing `emitShutdownOnce` against 300 ms finished with 1 call. Both tests passed as written; the probe worktree's diff hashes to `probe.patch` again afterwards.

Mutation checks, run by `mutate.py` against `test/suite/fork-subagents-probe.test.ts` and `test/fork-builtins/base-tools.test.ts` (10 tests):

| Mutation | Failing tests |
| --- | --- |
| M1: the child gets `excludeTools: []` | "runs a child from the parent's model runtime and returns its text through Agent" |
| M2: no `extensionsOverride` on the child loader | "drops inline built-ins from the child's loader (D22)" |
| M3: no `WeakMap` reuse | "keeps one service across /reload" |
| M4: the cleanup hook ignores the parent's id | "parent dispose ends a running child through the session cleanup hook (D21)" |
| M5: the service is built at registration | the two registration tests that pass the throwing session proxy |
| M6: the ping handler sends no reply | "answers subagents:rpc:ping on a fresh session, before any tool call (D19)" |
| M7: the adapter never unsubscribes | "leaves the bus when the session is disposed (D21)" |
| M8: no `subagents:ready` | "announces subagents:ready at construction and after /reload" |
| M9: the adapter is not installed | the ping test and the ready test |
| Restored | 10 of 10 pass |

## Appendix B. Verified code

Evidence files, with SHA-256:

| File | SHA-256 |
| --- | --- |
| `docs/plans/subagents-native-phase1-evidence/probe.patch` | `2f2eeddc4442addd65b54432414bdb9e8ff1981fc1fbe8706ee3d20efc09168e` |
| `docs/plans/subagents-native-phase1-evidence/mutate.py` | `5c152b861f18781eca1d1e19f889dd2947eb61508fa7b2f42a1584e3b233606c` |
| `docs/plans/subagents-native-phase1-evidence/failing-tests.mjs` | `5af620a5563cb8ce7fb934e672388cb8907117c9fb99f766ea6ba3aa139f080c` |
| `docs/plans/subagents-native-phase1-evidence/test-identities.mjs` | `79134323c3aa71e4d410c3dbcfc9f99144aad66521dde1478df8ddce4eebc966` |
| `docs/plans/subagents-native-phase1-evidence/removed.txt` | `99e8cf30383447ce102cf2730ae3d313ed91f8c3e422879eaed1a72ab55c900f` |

`probe.patch` is a spike, not the implementation: the probe's final state after `npm run check`. `failing-tests.mjs` is a copy of `.pi/skills/planning-changes/scripts/failing-tests.mjs`; `test-identities.mjs` is byte-identical to the ask-user-question evidence copy. The fragments below are copied verbatim from `probe.patch`. One planned change departs from them: T5 replaces the `agentDir` argument of `subagentServiceFor` with the per-session record (Section 2.1).

The first footprint line, in `agent-session.ts` (T5):

```ts
		addForkBaseTools(this._baseToolDefinitions, {
			session: this,
			agentDir: this._agentDir,
```

The lazy registration and the adapter call in `base-tools.ts` (T5, T8):

```ts
	addOwned(definitions, AGENT_TOOL_NAME, () =>
		createAgentToolDefinition(
			() => subagentServiceFor(options.session, options.agentDir),
			() => [AGENT_TOOL_NAME, ...forkBaseToolNames(definitions)],
		),
	);
	if (options.eventBus) installSubagentAdapter(options.session, options.eventBus);
```

The session proxy in `base-tools.test.ts` (T5):

```ts
/** Registration never touches the session; the subagent service is built on the first Agent call. */
const unusedSession = new Proxy(
	{},
	{
		get() {
			throw new Error("registration read the session");
		},
	},
) as AgentSession;
```

The inline built-in filter and the session cascade (T3, T4):

```ts
/** Drops every inline built-in (`<inline:name>`) from a child loader's extension set. */
function dropInlineBuiltIns(base: LoadExtensionsResult): LoadExtensionsResult {
	return { ...base, extensions: base.extensions.filter((extension) => !extension.path.startsWith("<inline:")) };
}
```

```ts
		const parentId = parent.sessionId;
		this.unregisterCleanup = registerSessionResourceCleanup((sessionId) => {
			if (sessionId === parentId) this.dispose();
		});
```

```ts
const services = new WeakMap<AgentSession, SubagentService>();

export function subagentServiceFor(session: AgentSession, agentDir: string): SubagentService {
	let service = services.get(session);
	if (!service) {
		service = new SubagentService(session, agentDir);
		services.set(session, service);
	}
	return service;
}
```

The adapter installation (T8):

```ts
const installed = new WeakMap<AgentSession, () => void>();

export function installSubagentAdapter(session: AgentSession, bus: EventBus): void {
	if (!installed.has(session)) {
		const unsubscribePing = bus.on("subagents:rpc:ping", (raw) => {
			const { requestId } = raw as { requestId: string };
			bus.emit(`subagents:rpc:ping:reply:${requestId}`, {
				success: true,
				data: { version: SUBAGENTS_PROTOCOL_VERSION, capabilities: { skillAgents: true } },
			});
		});
		const unregisterCleanup = registerSessionResourceCleanup((sessionId) => {
			if (sessionId !== session.sessionId) return;
			unsubscribePing();
			unregisterCleanup();
			installed.delete(session);
		});
		installed.set(session, unregisterCleanup);
	}
	bus.emit("subagents:ready", {});
}
```

## Review history

### Pass 1: 2026-09-27, reviewer model openai-codex/gpt-6-astra

| Angle | Verdict |
| --- | --- |
| Traceability | FAIL |
| Assumptions | PASS_WITH_FINDINGS |
| Completeness | FAIL |
| Feasibility | PASS_WITH_FINDINGS |
| Validation | FAIL |
| Safety | PASS_WITH_FINDINGS |

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | Blocking: a fork skill run before any `Agent` call took the bus path and pinged, against D26. | Accepted | Lazy creation plus "when the service exists" in T8. Now skill-fork uses the per-session record and creates the service on demand. |
| 2 | Blocking: T3 excluded the nested tools T6 injects. | Accepted | `agent-session.ts:5511-5517` filters custom tools by the exclude list. New default "Subagent tools in children"; T6 case with `<sdk:NAME>`. |
| 3 | Rewrite-map publication and skill-change handling had no task. | Accepted | `skills/runtime.ts:36-57`; ADR-0008. Assigned to T8 with tests. |
| 4 | Traceability, completeness: the owner's per-commit review was missing. | Ruled R11 (D27) | Handoff 14.5. Shared review gate and T10. |
| 5 | Assumptions, feasibility: fresh worktrees run no commit hook. | Accepted | `.husky/_/.gitignore:1`, `package.json:56`; probe hook run (Appendix A). Setup step 3 and 4. |
| 6 | Assumptions, feasibility, safety: T10 (now T11) was not isolated from the live agent directory and pi-subagents. | Accepted | `agent-session-services.ts:139-159`. Isolated home, provenance asserts, settings hash check. |
| 7 | The worker allowlist mitigation was stated as universal. | Accepted | `worker-policy-extension.ts:156` at `d64cc9c`. Risk row and phase 3 prerequisite corrected. |
| 8 | Blocking: no task installed the adapter before first contact. | Accepted | pi-tasks pings at factory load (`pi-tasks/src/index.ts:260-261`). Adapter installed at base-tool registration; probed (M6 to M9). |
| 9 | Completeness, safety: worktree cleanup could discard changes on failure. | Accepted | pi-subagents `src/worktree.ts:177-193`. "Worktree preservation" default and fault-injection cases in T7. |
| 10 | The SDK probe script was discarded. | Accepted | T11 now commits `$E/sdk-probe.mjs`. |
| 11 | Feasibility: the `./test.sh` comparison missed Node dot-reporter failures. | Accepted | `packages/tui/package.json:13`; scratch dot-reporter run. Rule 3 now compares `FAIL`, `✖` and `ℹ fail` identities and the package list. |
| 12 | Blocking: retained behaviors lacked named cases (memory, transcripts, resume, joins, usage, payloads). | Accepted | Handoff D24. Named cases added to T3, T4, T6 and T8; payload fixture in T8. |
| 13 | Baseline comparison did not preserve passing identities. | Accepted | Precedent `test-identities.mjs`; probe showed it catches the rename. Regression rule 1 and `removed.txt`. |
| 14 | Several gates required eyeballing. | Accepted | Footprint, T9, T11 and T12 checks are now commands with expected output. |
| 15 | Validation, safety: the unchanged-state gate checked only a ref. | Accepted | Setup step 5 records three baselines; done criteria compare them and forbid restoring. |

Sections changed: opening, 1, 2.1, 2.2, 2.3, 2.4, 3, 4, 5, all tasks (T10 to T12 renumbered), 7, 8, 9, 10, Appendices A and B, evidence files. Changes made after this pass and not yet reviewed: all of the above.

### Pass 2: 2026-09-27, reviewer model openai-codex/gpt-6-astra (re-review)

| Angle | Verdict |
| --- | --- |
| Traceability | FAIL |
| Assumptions | PASS_WITH_FINDINGS |
| Completeness | FAIL |
| Feasibility | PASS_WITH_FINDINGS |
| Validation | PASS_WITH_FINDINGS |
| Safety | PASS |

Pass-1 dispositions: the reviewers confirmed findings 1, 3, 4, 5, 6, 8, 9, 10, 13 and 15 as applied; findings 12 and 14 drew findings 25 to 27 below.

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 16 | Blocking: child teardown by dispose alone skips the child extensions' `session_shutdown` (pi-subagents #242). | Accepted | `agent-session.ts:1852-1893`; pi-subagents `agent-manager.ts:335-363`. Default "Child teardown"; T3 cases; Section 2.3 row for the unawaited parent path. |
| 17 | Nested records were reachable from top-level tools and the bus. | Accepted | Handoff section 3; pi-subagents `status-note-wiring.test.ts:146-199`. Default "Top-level visibility"; T6 and T8 cases. |
| 18 | Traceability, completeness: record retention and tombstones had no task. | Accepted | pi-subagents `agent-manager.ts:74`, `:1480-1500`. Default "Record retention"; T4 cases. |
| 19 | Child adapters bypassed `allowed_subagents` and the depth cap through RPC spawns. | Accepted | `pi-tasks/src/index.ts:207-216`; every child registers base tools (`agent-session.ts:5634`). Default "Child lineage"; T3 records it; T8 tests it. |
| 20 | Injected child loaders were never disposed. | Accepted | `sdk.ts:197-200`; `agent-session.ts:1931-1934`. T3 owns and disposes the loader, including on startup failure. |
| 21 | Blocking: a nested foreground child could deadlock on the foreground pool. | Accepted | pi-subagents `agent-manager.ts:100-158`. Default "Pool eligibility"; T6 deadlock case; T8 detached RPC case. |
| 22 | Reruns after a review fix collided with existing report paths. | Accepted | `failing-tests.mjs:61-62`. Attempt-qualified paths and `.candidate` files in the regression rule. |
| 23 | T9's README path was wrong. | Accepted | The module layout in Section 2.1. Full path in T9. |
| 24 | A later task could skip an earlier task's tests unnoticed. | Accepted | `test-identities.mjs:48-58` counts added identities without checking them. Identity check against the previous candidate and a pending-count check. |
| 25 | Reload proofs stayed in the spike. | Accepted | `probe.patch` reload tests. T4 and T8 reload cases. |
| 26 | Adapter checks verified keys, not values or the consume race. | Accepted | `skill-fork.ts:87-135`; pi-subagents `rpc-result-consumption.test.ts:154-166`. Full payload fixture, normalizer mapping, consume race, and two named mutations in T8. |
| 27 | Review and results completeness relied on eyeballing. | Accepted in part | T9 `check-checklist.mjs`, T10 heading and disposition counts, T12 per-section keys. Whether a disposition is right stays the owner's judgment. |

Sections changed: 2.1 (per-session record, child lineage, child teardown, record retention, pool eligibility, top-level visibility), 2.3, 3, 5 (regression rule), T3, T4, T6, T8, T9, T10, T12, 7, 8, 10. Changes made after this pass and not yet reviewed: all of the above, plus a Section 3 row and an Appendix A entry for the scratch child-adapter probe run before pass 3.

### Pass 3: 2026-09-27, reviewer model openai-codex/gpt-6-astra (re-review)

| Angle | Verdict |
| --- | --- |
| Traceability | FAIL |
| Assumptions | PASS_WITH_FINDINGS |
| Completeness | FAIL |
| Feasibility | FAIL |
| Validation | PASS_WITH_FINDINGS |
| Safety | PASS |

Pass-2 dispositions: the reviewers confirmed findings 16 to 27 as applied. The assumptions reviewer reproduced the child-adapter scratch probe independently. Findings 29 and 30 refine the fixes for 16 and 21; finding 28 comes from combining the fixes for 17 and 19.

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 28 | Blocking: a permitted child RPC spawn emitted no lifecycle event, so pi-tasks in a child never finishes its task. | Accepted | `pi-tasks/src/index.ts:300-310`, `:344-364`; pi-subagents `status-note-wiring.test.ts:293-295` guards only the parent's bus. "Child lineage" and "Top-level visibility" now scope events to the owner's bus; T8 events row and cases. |
| 29 | The 3 s teardown can expire inside `abort()` before `session_shutdown` runs. | Accepted | `agent-session.ts:4450-4469`; the teardown scratch probe after pass 3 reproduced it (0 calls) and proved the fix (1 call) (Appendix A). "Child teardown" rewritten; T3 case and mutation. |
| 30 | The RPC pool exemption freed background RPC work from `maxConcurrent`. | Accepted | pi-subagents `agent-manager.ts:110-113`; `pi-tasks/src/index.ts:1208-1210`. "Pool eligibility" rewritten; T4 and T8 cases. |
| 31 | Blocking: isolated agents could get nested tools and preloaded skills. | Accepted | pi-subagents `agent-runner.ts:710-715`, `:931`; `README.md:346`. New default "Isolated agents"; T3, T6 and T8 cases. |
| 32 | Cancelling a result wait had no contract. | Accepted | pi-subagents `README.md:471`; `test/wait-queued.test.ts:132-239`. New default "Result waits"; T4 and T5 cases. |
| 33 | Completeness, feasibility, validation: the candidate chain broke after T8 and on a no-change phase review. | Accepted | Regression rule now uses `latest.candidate`, seeded at setup step 7; T9, T11 and T12 run no candidate; T10 fixes are tasks `T10-F<n>`. |
| 34 | Blocking: T3 and T4 validated wiring that T5 introduces. | Accepted | `base-tools.ts:42-46` at the start commit registers no record. T3 checks `lineageForBus`; T4 tests construct the service directly; the reload, record-lineage and `usage` cases move to T5. |
| 35 | Child skill-fork ownership was untested. | Accepted | T8 now repeats the child cases through the typed skill-fork path, with a mutation. |
| 36 | `output-file-compaction-e2e` was mapped as covered with no compaction case. | Accepted | pi-subagents `output-file-compaction-e2e.test.ts:128-156`. New T3 compaction case and mutation. |
| 37 | T10 and T12 checks counted headings, not content. | Accepted | T10 checks the verdict line, `Applied:` ancestry and candidate count; T12 checks each candidate path, non-empty mutations, and verbatim review and phase-review lines. Both command sets ran against planted defects and caught each one. |

Sections changed: 2.1 (child lineage, child teardown, pool eligibility, top-level visibility, new isolated agents and result waits), 3, 5 (setup step 7, regression rule), shared review gate, T3, T4, T5, T6, T8, T10, T12, Appendix A. Changes made after this pass and not yet reviewed: all of the above.

### Pass 4: 2026-09-27, reviewer model openai-codex/gpt-6-astra (re-review, three angles)

Limited to traceability, completeness and feasibility, and to the sections changed after pass 3. Assumptions, validation and safety were not rerun.

| Angle | Verdict |
| --- | --- |
| Traceability | FAIL |
| Completeness | PASS_WITH_FINDINGS |
| Feasibility | PASS |

Pass-3 dispositions: the reviewers confirmed findings 28 to 37 as applied, with no new evidence to reopen any.

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| 38 | Blocking: the review gate skipped T11, which commits new executable code. | Accepted | Handoff D27: "Before each implementation commit". The gate now covers T11 and states why T0 and T12 take none; T12 records T11's review lines and checks them. |
| 39 | Child teardown had no rejection path, so a throwing extension error listener could skip disposal and leave an unhandled rejection. | Accepted | `test/agent-session-shutdown-emit.test.ts:184-217`; `agent-session.ts:1863-1874`. "Child teardown" now disposes in a `finally` and records the rejection; T3 case and mutation. |
| 40 | The retained service had no contract for reloading agent definitions or republishing collisions after an agent-file change. | Accepted | pi-subagents `src/index.ts:436-445`, `:786-796`, `:1967-1968`. New default "Definition refresh"; T4 service row and case; T8 publication row and case. |

Sections changed: 2.1 (child teardown, new definition refresh), 3, shared review gate, T3, T4, T8, T12. Changes made after this pass and not yet reviewed: all of the above.

# Native subagents, phase 1: results

Phase 1 rebuilt pi-subagents' headless core as fork-owned code in `packages/coding-agent/src/core/fork-builtins/subagents/`, on branch `feat/subagents-native`. This file records each task's commit, its candidate run, its mutation checks and its review, then the phase review, the SDK probe and the deviations. The plan is `docs/plans/subagents-native-phase1.plan.md`; the rulings are D16 to D34 in the session-control handoff. Every commit passed the pre-commit hook. The upstream footprint in `agent-session.ts` stays at two added lines.

## Commits

| Commit | Subject |
| --- | --- |
| `ea2e39c01` | docs: native subagents phase 1 plan |
| `8d5819d4e` | feat(coding-agent): native subagent definitions with a trust gate and frontmatter warnings |
| `2263a2457` | feat(coding-agent): subagent settings under forkBuiltins and model resolution |
| `cac5c5647` | feat(coding-agent): subagent child sessions scoped by agent definitions |
| `ee06618e2` | feat(coding-agent): per-session subagent service owned by its session |
| `3e008d934` | feat(coding-agent): Agent, get_subagent_result and steer_subagent as fork base tools |
| `bb9769ab0` | feat(coding-agent): nested subagents owned by their parent agent |
| `b1290f71f` | docs: amend native subagents phase 1 plan: worktree snapshot commit skips hooks |
| `a7311e22c` | feat(coding-agent): worktree isolation for subagents that never discards changes |
| `3f73063f2` | docs: amend native subagents phase 1 plan: a disabled agent keeps its name |
| `731c0d217` | feat(coding-agent): subagents bus adapter; skill-fork calls the service |
| `b25fb9754` | docs: amend native subagents phase 1 plan: task T8a closes uncovered old tests |
| `da147d1fb` | fix(coding-agent): cover the subagent tool veto, failed notifications and reported session usage |
| `572d4fd0a` | docs: amend native subagents phase 1 plan: task T8b fails an unstartable worktree spawn |
| `34bb93d1c` | docs: amend native subagents phase 1 plan: T8b loads agent files once per spawn |
| `1d255f62c` | fix(coding-agent): fail an Agent call whose worktree cannot start, and load agent files once per spawn |
| `89a971ecd` | docs: native subagents phase 1 README, ADR-0009 amendment and test checklist |
| `3b7f210b1` | fix(coding-agent): hold subagent notices after an abort inside a tool call or a retry |
| `2b0bceae9` | fix(coding-agent): run a child's RPC and fork-skill spawns in the child's directory |
| `917ad0a98` | fix(coding-agent): refuse nested spawns once the delegating agent's run has ended |
| `4837b7549` | fix(coding-agent): keep project and local subagent memory off in an untrusted project |
| `ee12225d1` | fix(coding-agent): refuse subagent extension paths inside an untrusted project |
| `0335ae7f2` | fix(coding-agent): run the worktree's git commands with no repository hook |
| `8c68c82ef` | fix(coding-agent): warn when a subagent inherits a model outside enabledModels |
| `3d064998d` | fix(coding-agent): stop a worktree agent's nested agents before its copy is saved |
| `e3efb85ec` | fix(coding-agent): test that subagent retention never evicts a queued record |
| `0e544b876` | docs: native subagents phase 1 SDK probe |

## Tasks

### T1 Agent definitions

Candidate: /tmp/sn-impl/T1-a2-2.json (4644 tests, 0 failed, 50 pending)
Mutations: each fails its test in test/fork-builtins/subagents/definitions.test.ts.
- T1-M1 session_dir not read: "reads every documented key"
- T1-M2 `tools: all` not spelled `*`: "reads the spelled-out forms ..."
- T1-M3 BOM not stripped: "parses a file that starts with a UTF-8 BOM"
- T1-M4 skill separator allowed: "refuses a type that holds the skill separator"
- T1-M5 strict ignores unknown keys: "warns once per file and unknown key ..."
- T1-M6 strict ignores an unparseable file: "skips an unparseable or reserved-name file ..."
- T1-M7 trust gate removed: "reads no project agent directory in an untrusted project"
- T1-M8 first source wins: "lets a project agent override a global one by name ..."
- T1-M9 Explore loses its model: "documents the three default agents"
- T1-M10 ambiguous case guesses: "resolves types case-insensitively ..."
- T1-M11 none does not refuse: "falls back to general-purpose, to a named agent, or refuses under none"
- T1-M12 alias ignores other claimants: "grants the bare alias only when the name is free ..."
- T1-M13 skill agents listed: "hides skill agents from listings ..."
- T1-M14 reserved name throws under strict: "skips an unparseable or reserved-name file ..."
- T1-M15 skill symlinks followed: "never loads a symlinked skill agent file ..."
- T1-M16 malformed visibility admitted: "loads no agent of a skill whose visibility is missing or malformed ..."
- T1-M17 strict applied to skill files: same test as T1-M16
- T1-M18 same-name skill files not collapsed: "keeps the last of two files in one skill ..."
Commit: `8d5819d4e`.

Review:
- F1 (Important) Two files in one skill declaring the same name left the bare alias and the qualified name on different definitions: Accepted. `loadSkillAgents` now keeps the last file per name within a skill; test "keeps the last of two files in one skill that declare the same name" (mutation T1-M18).
- F2 (Important) `strictAgentFiles` applied to third-party skill agent files and to reserved-name files, unlike pi-subagents (`src/skill-agents.ts` loads with strict off; the reserved name only warns): Accepted. Skill files always load non-strict; a reserved name warns even under strict (mutations T1-M14, T1-M17).
- F3 (Minor) No test guarded the symlink skip for skill agent directories: Accepted. New test "never loads a symlinked skill agent file" (mutation T1-M15).
- F4 (Minor) The fail-closed visibility gate was tested only with a boolean: Accepted. New test with missing and string-valued visibility (mutation T1-M16).

### T2 Settings and model resolution

Candidate: /tmp/sn-impl/T2-a2-1.json (4652 tests, 0 failed, 50 pending)
Mutations: each fails its test in test/fork-builtins/subagents/settings.test.ts or models.test.ts.
- T2-M1 global wins over project: "merges the global values under the project values"
- T2-M2 core's untrusted-project gate removed: "ignores the project values in an untrusted project"
- T2-M3 graceTurns range admits 0: "documents each key's default and drops a value ..."
- T2-M4 writer drops other keys: "writes only forkBuiltins.subagents in the project settings.json"
- T2-M5 no any-provider fallback: "prefers an exact match, then fuzzy under the provider, ..."
- T2-M6 caller's out-of-scope model runs: "refuses a caller's model outside enabledModels, ..."
- T2-M7 agent file's unresolvable model refuses: "runs an out-of-scope frontmatter or inherited model with a warning"
- T2-M8 parameter beats frontmatter thinking: "lets frontmatter win over a tool parameter for each locked field"
- T2-M9 prototype keys reach Object.prototype: "documents each key's default and drops a value ..."
- T2-M10 writer keeps the BOM: "writes only forkBuiltins.subagents in the project settings.json"
- T2-M11 no exact step: "prefers an exact match, then fuzzy under the provider, ..."
Commit: `2263a2457`.

Review:
- F1 (Minor) An unknown settings key named like an `Object.prototype` member (`toString`, `__proto__`) threw instead of warning: Accepted. The key lookup now uses `Object.hasOwn`; test assertion and mutation T2-M9.
- F2 (Minor) The project writer rejected a settings.json with a byte-order mark that core reads (`settings-manager.ts:477`): Accepted. The writer strips the BOM before parsing; test assertion and mutation T2-M10.
- F3 (Minor) No test guarded the exact-match step of model resolution: Accepted. New lookalike case and a date-stamp case; mutation T2-M11.

### T3 The child-session runner

Candidate: /tmp/sn-impl/T3-a2-1.json (4691 tests, 0 failed, 50 pending)
Mutations: each fails its test; runner suite test/suite/fork-subagents-runner.test.ts, module tests test/fork-builtins/subagents/{scope,prompt,memory}.test.ts.
- T3-M1 fork base tools not excluded: "gives a child a fork base tool only when tools: names it"
- T3-M2 subagent tools not excluded: "never gives a child Agent, even when tools: names it, ..."
- T3-M3 isolated keeps extensions: "drops inline built-ins, path extensions and skills under isolated"
- T3-M4 exclusion ignored: "drops an extension named by exclude_extensions"
- T3-M5 no re-narrow before a prompt: "narrows extension tools to the ext: selectors, including a tool registered after bind"
- T3-M6 no wrap-up message: "sends the wrap-up at the turn limit, then stops with the partial result"
- T3-M7 inherit_context ignored: "omits the parent prompt in replace mode, includes it in append mode, ..."
- T3-M8 skills not preloaded: "preloads a skills: list from the parent's loaded skills ..."
- T3-M9 memory always read-only: "gives an agent with write tools a memory directory it writes, ..."
- T3-M10 output_transcript ignored: "writes the child's messages to its .output transcript, ..."
- T3-M11 writer stops tracking after a compaction: "keeps the transcript going across a compaction ..."
- T3-M12 no .subagents directory: "persists a child's session under .subagents/, or exactly at session_dir:"
- T3-M13 startup failure leaks the loader: "reports a failing startup as an error with its cause ..."
- T3-M14 lineage not stored: "records the child's lineage for its loader's event bus"
- T3-M15 no session_shutdown emitted: the four teardown tests
- T3-M16 shutdown bound not 3 s: "cuts a session_shutdown handler that never settles at 3 s, ..."
- T3-M17 abort awaited before emitting: "delivers session_shutdown once within 3 s while a tool ignores its abort signal"
- T3-M18 disposal moved out of the finally: "disposes and records an extension-error when the shutdown handler and the error listener both throw"
- T3-M19 to T3-M27 scope.ts: Pi tools, disallowed tools, re-admitted nested tools, unknown names, read-only memory, ext: case, inline names, extension list, missing extension warnings
- T3-M28 to T3-M33 prompt.ts: replace header, append prefix, preloaded skills, skill frontmatter, compaction summary, branch detection
- T3-M34 to T3-M37 memory.ts: user scope, 200-line truncation, read-only creates nothing, symlinked directory
- T3-M38 parent's session directory ignored: "persists a child's session under .subagents/ below the parent's own session directory"
- T3-M39 session disposal not guarded: "still disposes the loader and resolves when disposing the session throws"
- T3-M40 shutdown timer holds the process: "cuts a session_shutdown handler that never settles at 3 s, ..."
- T3-M41 agent file's isolation ignored: the isolated and lineage tests
Commit: `cac5c5647`.

Review:
- F1 (Minor) Isolation and `allowed_subagents` came only from the caller, so a lineage could disagree with the agent file: Accepted. The runner now applies the agent file's `isolated: true` itself and builds the lineage's `isolated` and `allowedSubagents` from the definition; the caller passes only owner, parent record and depth (mutation T3-M41).
- F2 (Minor) A throwing `dispose()` (a failing session-resource cleanup, `packages/ai/src/session-resources.ts:21-23`) would skip the loader's disposal and reject the teardown: Accepted. Session disposal is guarded and reported as an `extension-error`, and the loader is disposed in a nested `finally`; new test "still disposes the loader and resolves when disposing the session throws" (mutation T3-M39).
- F3 (Minor) The 3 s teardown timer was not unref'd, unlike pi-subagents `agent-manager.ts` `shutdownChildSession`: Accepted. The timer is unref'd; the fake-timer teardown test checks `hasRef()` (mutation T3-M40).
- F4 (Minor) No test exercised the default below the parent's own session directory: Accepted. New test with the parent's `getSessionDir()` stubbed and `PI_CODING_AGENT_SESSION_DIR` emptied (mutation T3-M38).

### T4 The per-session service

Candidate: /tmp/sn-impl/T4-a2-1.json (4714 tests, 0 failed, 50 pending)
Mutations: each fails its test; suite test/suite/fork-subagents-service.test.ts, module test test/fork-builtins/subagents/service.test.ts.
- T4-M1 no flush when the parent settles; T4-M2 a consumed result still notifies: "delivers one notification after the parent settles, ..."
- T4-M3 no batch group: "notifies each agent under async, and one notification holding both under group"
- T4-M4 group timeout delivers nothing: "groups smart agents spawned together, ... delivers a late group at its timeout"
- T4-M5 background pool unlimited: "queues the eleventh background spawn at maxConcurrent 10, ..."
- T4-M6 detached spawn counted as blocking: "queues a second blocking spawn at maxConcurrentForeground 1, ..."
- T4-M7 cancelled waiter kept: "cancels only the wait on a running or queued agent, ..."
- T4-M8 steer not delivered to a running child: "steers a running child, and stops one with its partial output"
- T4-M9 resume builds a new child: "resumes a finished persisted agent in its session file"
- T4-M10 no definition reload at spawn: "spawns an agent file added after the service started, ..."
- T4-M11 usage not reported: "sums each assistant message once across resumes, ..."
- T4-M12 answered grace turn aborted: "records each terminal status"
- T4-M13 cleanup hook ignores the session; T4-M14 cleanup hook left registered; T4-M15 children not torn down: the two ownership tests
- T4-M16 retention shorter than 10 minutes: "keeps a finished record 10 minutes, then evicts it with a tombstone, ..."
- T4-M17 to T4-M22 module tests: main handle, tombstone cap, straggler timeout, preview truncation, notification shape, pending usage
- T4-M23 caller's signal never detached: "forgets a caller's signal when its run ends, ..."
- T4-M24 resume keeps the old tool call; T4-M25 background resumes not batched: "gives a background resume its own tool call and joins resumes of one turn"
- T4-M26 queued notice not discardable: "drops a notification held for the next prompt once the result is read"
Commit: `ee06618e2`.

Review:
- F1 (Important) A caller's abort signal stayed attached after its run, so an Esc later in the same parent run stopped a background resume (pi-subagents detaches it at settle, `agent-manager.ts:750-762`, `:1251-1264`): Accepted. The listener is removed when the run ends, when a queued record stops, at a resume and at dispose; new test "forgets a caller's signal when its run ends, ..." (mutation T4-M23).
- F2 (Important) A background resume kept the old `toolCallId` and never joined a smart batch (pi-subagents `index.ts:1478-1484`, `:1523-1527`): Accepted. `resume` takes the new tool call id, sets the join mode for a background resume and joins the batch; new test "gives a background resume its own tool call and joins resumes of one turn" (mutations T4-M24, T4-M25).
- F3 (Minor) Tests did not cover F1 and F2, asserted the queued record's notification only for the running one, and never exercised `discardIf` on a notice queued for the next prompt: Accepted. The wait test asserts both notifications; new test "drops a notification held for the next prompt once the result is read" (mutation T4-M26).

### T5 The three base tools

Candidate: /tmp/sn-impl/T5-a2-1.json (4733 tests, 0 failed, 50 pending)
Mutations: each fails its test; suite test/suite/fork-subagents-tools.test.ts, module test test/fork-builtins/base-tools.test.ts.
- T5-M1 foreground result drops the child's text: "runs a foreground agent from the model's tool call ..."
- T5-M2 background spawn waits for the agent: "starts a background agent, returns its id at once, ..."
- T5-M3 a refused spawn throws: "returns an unknown type under fallbackSubagent none as text ..."
- T5-M4 no fallback note: "notes an unknown type that fell back to the configured agent"
- T5-M5 a failed agent reads as completed: "returns a failed foreground agent's error with its partial output"
- T5-M6 resume ignores the call's run_in_background: "resumes a finished agent in the foreground, then in the background by default"
- T5-M7 no outcome note on a stopped foreground agent; T5-M22 a background spawn takes the call's signal: "stops a foreground agent with its call's abort signal, ..."
- T5-M8 usage not attached: "attaches the subagent spend to the result under reportUsage"
- T5-M9 a read result is not consumed: "reports a running agent, waits for its result, and consumes it ..."
- T5-M10 a cancelled wait stops the agent: "stops only the wait when its call is cancelled: ..."
- T5-M11 a steer to an unstarted agent reads as sent: "queues a message for an agent not yet started, ..."
- T5-M12 steer_subagent not registered: "registers the three tools as active builtins, ..." and the base-tools name tests
- T5-M13 the base Agent beats an extension's: "lets an extension tool named Agent override the base tool"
- T5-M14 a new service per lookup: "keeps one service across /reload, ..."
- T5-M15 the child record carries no lineage: "gives a child session the lineage its loader's bus holds, ..."
- T5-M16 compact mode ignored; T5-M17 isolation always offered: "follows toolDescriptionMode, and offers isolation only while worktrees are on"
- T5-M18 placeholders not rendered; T5-M21 warnings raised before the service are lost: "renders a custom template from the project, ..."
- T5-M19 an untrusted project's template is read: "ignores an untrusted project's custom template"
- T5-M20 the description is built at registration: the base-tools tests with the throwing session proxy
- T5-M23 a strict agent file breaks the description: "keeps a session whose strict agent file fails to load: ..."
Commit: `3e008d934`.

Review:
- F1 (Important) With `strictAgentFiles: true`, one unreadable or unknown-key agent file made the Agent description getter throw inside the session constructor and `/reload` (`definitions/load.ts:109`, `:118`, `:127` throw; `tools/tool-definition-wrapper.ts:12-13` reads the getters eagerly): Accepted. `buildSurface` catches the load error, lists only the default agents and warns; a spawn still reports the strict error as text. New test "keeps a session whose strict agent file fails to load: ..." (mutation T5-M23).

### T6 Nested subagents

Candidate: /tmp/sn-impl/T6-a2-1.json (4741 tests, 0 failed, 50 pending)
Mutations: each fails its test in test/suite/fork-subagents-nested.test.ts.
- T6-M1 no nested tools injected; T6-M2 an isolated agent may delegate: "gives an agent with allowed_subagents the three nested tools as SDK tools, and an isolated one none"
- T6-M3 the depth cap admits its own level: "removes the nested tools at the depth cap"
- T6-M4 the allowlist is not enforced; T6-M14 disabled or missing allowlist names are listed: "refuses a nested type outside allowed_subagents, naming the allowed list"
- T6-M5 a parent's end leaves its children running; T6-M6 nested records sit at depth 1: "steers a running nested agent, and aborts it when the parent's run ends"
- T6-M7 lookups ignore the owner: "lets no agent reach a nested agent it does not own, and hides it from the session"
- T6-M8 usage does not roll up; T6-M9 usage reported once per ancestor: "counts a nested agent's usage once in its parent's total ..."
- T6-M10 nested records take pool slots; T6-M11 nested spawns default to the background: "finishes a foreground parent that delegates in the foreground when both pools hold one slot"
- T6-M12 a nested agent takes the session model; T6-M13 a nested agent inherits the session conversation and prompt: "gives a nested agent the model, conversation and system prompt of the agent that delegated"
Commit: `bb9769ab0`.

Review:
- F1 (Important) A nested child inherited the main session's model, conversation (`inherit_context`) and appended system prompt instead of the delegating agent's (`service.ts` passed `this.session.model` and `parent: this.session`; pi-subagents reads all three from the child's own context, `src/nested-tools.ts:241`, `src/agent-runner.ts:703`, `:1187-1188`): Accepted. The service resolves the default model from the delegating agent's session, and `ChildRequest.inheritFrom` gives the runner that session for the conversation and the appended prompt. New test "gives a nested agent the model, conversation and system prompt of the agent that delegated" (mutations T6-M12, T6-M13).
- F2 (Minor) The nested `subagent_type` description and refusals listed allowlist names that are disabled or have no agent file (pi-subagents `availableIn` filters to available types): Accepted. `allowedTypes` keeps only enabled agents; the test agent `lead` now allows a missing `ghost`, and the refusal test expects `Allowed: worker.` (mutation T6-M14).

### T7 Worktree isolation

Candidate: /tmp/sn-impl/T7-a2-1.json (4753 tests, 0 failed, 50 pending)
Mutations: each fails its test; module test test/fork-builtins/subagents/worktree.test.ts, suite test test/suite/fork-subagents-worktree.test.ts.
- T7-M1 the snapshot commit runs hooks: "never runs the repository's hooks on the snapshot commit"
- T7-M2 changes are not committed; T7-M3 no branch is created; T7-M5 the subdirectory is not mapped: "commits a change to pi-agent-<id>, leaves the main tree unchanged, and removes the worktree"
- T7-M4 a failure removes the worktree: "keeps the worktree and names it when the commit fails" and "... when the branch already exists"
- T7-M6 the named error is lost: "refuses a directory outside a git repository with a named error"
- T7-M7 an unchanged worktree is kept: "removes an unchanged worktree and creates no branch"
- T7-M8 the child works in the main tree; T7-M9 the prompt does not name the worktree base; T7-M11 a worktree agent may resume; T7-M13 no outcome note: "runs the agent in a worktree and saves its change to the branch the result names"
- T7-M10 no repository check at spawn: "fails the spawn with a named error outside a git repository"
- T7-M12 the transcript is filed under the worktree; T7-M14 a stopped run leaves its worktree: "saves a stopped agent's change to its branch, then removes the worktree"
- T7-M15 removal runs from the spawn tree: "adds and removes through the main tree when the spawn came from a linked worktree removed first"
- T7-M16 an untracked spawn directory is missing in the copy: "creates the spawn's untracked directory inside the copy"
- T7-M17 session_dir resolves inside the worktree: "keeps a session_dir session file in the project, out of the worktree and its branch"
Commit: `a7311e22c`.

Review:
- F1 (Important) A worktree agent spawned from a linked worktree removed first (a nested worktree agent under a worktree lead) kept its worktree forever: `repo` came from `rev-parse --show-toplevel` of the spawn's cwd, so `git worktree remove` ran in a deleted directory, and the note named it (scratch reproduction by the reviewer; `git worktree list` names the main worktree first): Accepted. `worktreeBase` takes the main worktree from `git worktree list --porcelain` for adding, removal and the note, and keeps the spawn tree's own top level for the subdirectory. New test "adds and removes through the main tree when the spawn came from a linked worktree removed first" (mutation T7-M15).
- F2 (Important) A spawn from an untracked or ignored subdirectory gave the child a working directory missing from the copy, which holds tracked files only (verified with a scratch repository): Accepted. `createWorktree` creates the mapped directory. New test "creates the spawn's untracked directory inside the copy" (mutation T7-M16).
- F3 (Minor) A relative `session_dir:` resolved against the worktree copy, so a persisted child's session file was committed to the agent's branch and then deleted with the worktree (`runner/run.ts:97`): Accepted. `session_dir:` resolves against `configCwd`, the project. New test "keeps a session_dir session file in the project, out of the worktree and its branch" (mutation T7-M17).

### T8 Bus adapter, skill-fork over the service

Candidate: /tmp/sn-impl/T8-a2-1.json (4773 tests, 0 failed, 50 pending)
Mutations: each fails its test in test/suite/fork-subagents-adapter.test.ts.
- T8-M1 ping answers protocol 2: "answers ping with protocol 3 ..."
- T8-M2 an RPC spawn emits subagents:created: "spawns over RPC, replies before the agent's terminal event, ..."
- T8-M3 skill-fork pings despite the service: "runs a context: fork skill through the service without pinging"
- T8-M4 wrong terminal status in the completed payload; T8-M5 steered payload loses its message: "emits created, started, steered, completed and agent-ended ..."
- T8-M6 a stop reads as a success: "emits failed and agent-ended for an error, a stop and the session's end, ..."
- T8-M7 a settings change is not announced; T8-M8 no settings_loaded: "emits settings_loaded, settings_changed and compacted ..."
- T8-M9 agent-ended skips the spawn-reply gate: "holds an RPC-spawned agent's agent-ended until its spawn reply is out"
- T8-M10 skill-fork reads aborted as a success: "maps every terminal example to skill-fork's success value"
- T8-M11 consume replies success but leaves the result unread: "leaves no notification when a listener consumes the result ..."
- T8-M12 a detached spawn blocks: "starts an RPC spawn without isBackground while a blocking Agent call holds the only foreground slot"
- T8-M13 isBackground takes no background slot: "runs two background RPC spawns one at a time under maxConcurrent 1"
- T8-M14 child events emitted on the main session's bus; T8-M15 stop ignores ownership: "keeps a nested agent's events off the main bus and refuses its stop and consume there"
- T8-M16 a child's bus ignores its lineage: "refuses an RPC spawn from a child without allowed_subagents, an isolated child, and a child at the cap"
- T8-M17 a child's spawn skips the nested runtime: "spawns a nested agent from a permitted child's bus and reports it on that bus only"
- T8-M18 the typed skill-fork path ignores the child's lineage: "applies the same refusals and ownership to a context: fork skill run in a child"
- T8-M19 skills:changed republishes nothing: "republishes when a skill change frees a bare name, ..."
- T8-M20 a definition reload republishes nothing; T8-M21 unchanged maps are republished: "republishes after a definition reload changes a collision, ..."
- T8-M22 ready only at the first install; T8-M23 handlers installed on every registration: "announces subagents:ready at construction and on each /reload, ..."
- T8-M24 dispose leaves the handlers: "stops answering after dispose"
- T8-M25 a child builds its maps from its own directory: "builds a child's maps from the session's project, ..."
Commit: `731c0d217`.

Review:
- F1 (Minor) `lookup` sat between `get`'s doc comment and `get`, so `lookup` carried `get`'s contract and `get` had none (`service.ts:699-707`): Accepted. `lookup` and its one-line doc now come before `get`'s doc block.
- F2 (Minor) A child session's rewrite maps were built from the child's working directory (a worktree copy or an RPC `cwd`), while its spawns resolve agent types against the session's project, so the two could disagree on a collision (`skill-agents.ts:79`, `sessionCwd(child)` is the child's cwd): Accepted. A child builds its maps from its owner's project (`lineage.owner.defaultCwd()`). New test "builds a child's maps from the session's project, whatever directory the child works in" (mutation T8-M25).

### T8a Close the uncovered old-test files

Candidate: /tmp/sn-impl/T8a-a2-1.json (4776 tests, 1 failed, 50 pending)
Its failures are known flakes (plan Section 5, D28, D32): test/footer-data-provider.test.ts "updates the cached branch when the reftable directory changes".
Mutations: each fails its test.
- T8a-M1 no runtime veto; T8a-M2 the veto drops the earlier hook: "blocks an out-of-scope tool call at run time, ..." (test/suite/fork-subagents-runner.test.ts)
- T8a-M3 a failed notification is not reported: "turns a notification that fails to deliver into a warning, ..." (test/suite/fork-subagents-service.test.ts)
- T8a-M4 reported spend is not attached; T8a-M5 reported spend is handed out twice: "adds the reported spend to the session's stats once, ..." (test/suite/fork-subagents-tools.test.ts)
Commit: `da147d1fb`.

Review:
- F1 (Minor) The reported-usage test still passed when the child reported zero spend, because nothing required `record.usage` to be non-zero (`fork-subagents-tools.test.ts:225-235`; `PendingUsage.add` marks a zero delta dirty): Accepted. The test asserts `record.usage.input > 0` before comparing the stats.

### T8b Fail an Agent call whose worktree cannot start, and load agent files once per spawn

Candidate: /tmp/sn-impl/T8b-a2-3.json (4778 tests, 1 failed, 50 pending)
Its failures are known flakes (plan Section 5, D28, D32): test/exec.test.ts "captures finite inherited descendant output after the shell exits".
Mutations: each fails its test.
- T8b-M1 a worktree refusal returns text; T8b-M3 the repository check throws a plain error: "fails the spawn with a named error outside a git repository" (test/suite/fork-subagents-worktree.test.ts)
- T8b-M2 every spawn refusal throws: "returns an unknown type under fallbackSubagent none as text ...", "keeps a session whose strict agent file fails to load: ..." (test/suite/fork-subagents-tools.test.ts)
- T8b-M4 a child sweeps again; T8b-M5 the service keeps no agent files; T8b-M6 a spawn sweeps twice: "sweeps the agent directories once per call, ..." (test/suite/fork-subagents-tools.test.ts)
- T8b-M7 a failed worktree start does not fail the call; T8b-M8 it still notifies; T8b-M9 the tool does not wait; T8b-M10 the run keeps no worktree start: "fails the call when git cannot add the worktree of a run that starts at once, ..." (test/suite/fork-subagents-worktree.test.ts)
Commit: `1d255f62c`.

Review:
- F1 (Important) A run that started at once and failed `git worktree add` still returned text in the foreground and a started-in-background id in the background, so Pi recorded a successful call; pi-subagents fails that call through `awaitStartup` (`src/agent-manager.ts:716-720`, `src/index.ts:2276-2280` at 79a7c42): Accepted. The run stores its worktree creation before its first await, `SubagentService.worktreeStarted` throws the creation error and drops the record's notification, and the `Agent` tool awaits it after the spawn. New test "fails the call when git cannot add the worktree of a run that starts at once, and sends no notification" (mutations T8b-M7 to T8b-M10).

### T9 Documentation

The module README, the ADR-0009 amendment and the old-test checklist (`docs/plans/subagents-native-phase1-evidence/checklist.md`, checked by `check-checklist.mjs`). T9 runs no candidate. Validation: every settings key appears in the README, every required term in the ADR, and each of the 116 old test paths exactly once in the checklist. `check-checklist.mjs` exits 0 against T8b's candidate and 1 on a copy with one identity misspelled. The checklist maps 68 files as Covered, 12 to phase 2, 6 to phase 3 and 30 as Dropped, with 506 gap lines.
Commit: `89a971ecd`.

Review:
- F1 (Important) `agent-startup-error` was marked Covered, but its cited test asserted a text result, the reverse of pi-subagents #179, with no ruling (`tools/agent.ts:246`; `packages/agent/src/agent-loop.ts` marks a call failed only when `execute` throws): Accepted. Owner ruling D33 and plan amendment 4 added task T8b, which makes the `Agent` call fail (`1d255f62c`); the row now cites T8b's two worktree tests.
- F2 (Important) `perf/spawn-invariants` was marked Covered with no counterpart for either old case: Accepted. D33 put a load-count test in T8b; the count then showed a second sweep per spawn, which D34 and plan amendment 5 fixed in T8b; the row cites the new test.
- F3 (Important) ADR-0009 still said the four `agent-session.ts` hunks call into `base-tools.ts`, while `git diff 92294f229` shows five: Accepted. The ADR names four call-site hunks and the fifth `SkillForkClient` hunk, and the new evidence row notes the five hunks against `92294f229`.
- F4 (Minor) The README said a late group member is delivered at the group timeout, while `service/notifications.ts:201-211` delivers the finished members and re-batches the late one: Accepted. The Joins row is corrected.
- F5 (Minor) The README said a nested agent always inherits the conversation and the appended prompt, while `runner/run.ts:139` and `:358-359` take them only under `inherit_context` and `prompt_mode: append`: Accepted. The nesting paragraph is corrected.
- F6 (Minor) ADR-0009 called subagents "the one exception" to writing no file in the agent directory, which writing the project settings file does not break: Accepted. The ADR names both departures, reading the project file and writing a settings file, and states that subagents still write no file in the agent directory.
- F7 (Minor) `check-checklist.mjs` exited 1 instead of 2 on a report entry without `assertionResults`, and passed a row with an empty old-file cell: Accepted. A malformed report entry now exits 2, and a row whose old file is not `test/<name>.test.ts` is offending; both inputs were rerun.
- F8 (Minor) The checklist gap for "says it is queued in the live tool result" said only "not covered", while `tools/agent.ts` sends no live update at all: Accepted. The gap now says "not ported" and names it for the phase review.
- F9 (Minor) Durable-prose register: sentences over 25 words or holding several statements (README lines 3, 20, 47, 132 and 134; the ADR Control row) and passive voice (README lines 39, 63 and 138): Accepted. Each sentence is split or rewritten with its actor.

### T11 Validate the built outputs

`npm run build:offline` exits 0. `dist/index.js` exports every name the probe needs, and so does `@earendil-works/pi-ai/compat`. Each run uses `env -i` with `HOME=/tmp/sn-impl/home` and `PI_CODING_AGENT_DIR=/tmp/sn-impl/home/.pi/agent`. Mode `on` exits 0, mode `off` under `PI_FORK_BUILTINS=off` exits 0, and mode `off` without the switch exits 1. The live `settings.json` hash matches afterwards, and `git status --short` shows only the probe. The three JSON lines, in that order:

```json
{"switch":"unset","mode":"on","sources":{"Agent":"<builtin:Agent>","get_subagent_result":"<builtin:get_subagent_result>","steer_subagent":"<builtin:steer_subagent>"},"extensions":["<inline:tokensave>"],"childText":"Agent completed in 0.0s (0 tool uses, 8.8k token).\n\nprobe child text","errors":[],"pass":true}
{"switch":"off","mode":"off","sources":{"Agent":"none","get_subagent_result":"none","steer_subagent":"none"},"extensions":[],"childText":"","errors":[],"pass":true}
{"switch":"unset","mode":"off","sources":{"Agent":"<builtin:Agent>","get_subagent_result":"<builtin:get_subagent_result>","steer_subagent":"<builtin:steer_subagent>"},"extensions":["<inline:tokensave>"],"childText":"","errors":[],"pass":false}
```

Commit: `0e544b876`.

Review:
- F1 (Important) Each `on` run left the child's `.output` transcript under the OS temp directory (`/tmp/pi-subagents-<uid>/tmp-sn-sdk-cwd-*`), outside the probe's cleanup, because the in-memory settings kept `outputTranscript: true` (`settings/settings.ts:71`, `runner/transcript.ts:15-24`): Accepted. The probe's in-memory settings turn subagent transcripts off; the two leftover directories from the probe runs were removed, and a rerun leaves no residue.
- F2 (Minor) A nonexistent dist path failed the import outside `try` and exited 1 with a stack trace instead of 2: Accepted. The argument check also requires `<dist>/index.js`, and a bad path exits 2.
- F3 (Minor) Two header sentences broke the register (29 and 27 words, one with two statements) and claimed a cleanup F1 disproved: Accepted. The header is split into short sentences and names the transcript setting.

## Phase review

Verdict: With fixes

The `super-code-review` skill reviewed `452d35e62..89a971ecd` on 2026-09-28 in fan-out mode. Twelve lenses ran: requirements, correctness, guidelines, security, error handling, type design, test coverage, architecture, evolvability, performance, comments and docs impact. The spec was the phase 1 plan with amendments 1 to 5 and handoff rulings D16 to D34. Each finding below was checked against the source. Accepted findings wait for the owner's yes; each applied one becomes task `T10-F<n>`.

Strengths. Every plan task shipped with named suite tests on real sessions, and each new test has a mutation check. Ownership, teardown, pool eligibility, worktree preservation and the adapter's reply ordering have substantive tests. The upstream footprint is exactly two lines. The trust gate covers project agents, project settings and the custom tool description.

The owner approved applying F1 to F9 on 2026-09-28 and kept the Deferred and Rejected dispositions. Each applied finding names its commit on an `Applied:` line.

### F1: An Esc during a tool call lets a subagent notice start a new parent turn
Disposition: Accepted
Applied: 3b7f210b1
- Severity: Important. Sources: requirements, correctness, handoff open item.
- Where: `service/notifications.ts:255-260` sets `interrupted` only when the last message is an aborted assistant message.
- Evidence: an abort during a tool batch ends the run on a tool result. The flush then uses `followUp` with `triggerTurn: true`. pi-subagents also checked the run's signal (`src/index.ts:958` at `79a7c42`). `Agent.signal` is still set at `agent_end` (`packages/agent/src/agent.ts:437`).
- Fix: at `agent_end`, also treat `session.agent.signal?.aborted` as interrupted. Add a suite test that aborts during a tool call.

### F2: A child's RPC and skill-fork spawns run in the main project, not in the child's directory
Disposition: Accepted
Applied: 2b0bceae9
- Severity: Important. Source: correctness.
- Where: `service/service.ts:370` defaults `cwd` to the owner's `defaultCwd()`. `adapter/rpc.ts:67` promises "absent or null keeps the session's", and `skills/skill-fork.ts:419-424` passes no `cwd`.
- Evidence: a worktree agent's nested helpers started over its bus, or through a fork skill, work in the main checkout. The nested `Agent` tool passes the child's `ctx.cwd` instead. Plan Section 2.1 "Working directory" takes RPC and skill-fork `cwd` from the session's context.
- Fix: default an owned spawn's `cwd` to `sessionCwd(parent.child.session)`. Configuration keeps coming from the project.

### F3: A finished agent's child session can still spawn nested agents that outlive it
Disposition: Accepted
Applied: 917ad0a98
- Severity: Important. Sources: correctness, security.
- Where: `service/nested.ts:42-51` checks isolation, the allowlist and depth, never the parent's state. `service/service.ts:389-406` creates the record after its awaits without rechecking the parent.
- Evidence: a finished child session stays retained for 10 minutes with its adapter installed. An extension on its bus, such as pi-tasks advancing a task list, can spawn after `abortChildren()` ran. A spawn that awaits model resolution while the parent settles also survives.
- Fix: refuse owned spawns and resumes unless the parent record is running. Recheck after the spawn's awaits, before the record exists.

### F4: Project and local memory are read in an untrusted project
Disposition: Accepted
Applied: 4837b7549
- Severity: Important. Source: security.
- Where: `runner/run.ts:113-120` and `runner/memory.ts:24-30` read `<cwd>/.pi/agent-memory*/<name>/MEMORY.md` into the child's system prompt without a trust check.
- Evidence: core reads project `.pi/SYSTEM.md` and `.pi/APPEND_SYSTEM.md` only when trusted (`resource-loader.ts:1698`, `:1712`). Plan Section 2.1 "Project trust" gates the other project inputs the same way.
- Fix: in an untrusted project, `project` and `local` memory neither read nor create files, and the spawn warns once. `user` memory stays.

### F5: A relative `extensions:` path in a global or skill agent loads code from an untrusted project
Disposition: Accepted
Applied: ee12225d1
- Severity: Important. Source: security.
- Where: `runner/scope.ts:225-231` resolves a relative path against the project, and `runner/run.ts:160` loads it as an explicit extension path.
- Evidence: explicit paths bypass the loader's project trust gate. A global agent with `extensions: ["./.pi/extensions/helper.ts"]` therefore runs repository code in an untrusted project.
- Fix: in an untrusted project, refuse an extension path that resolves inside the project, after symlinks, and report it as a scoping warning.

### F6: Worktree creation and the snapshot commit still run repository hooks
Disposition: Accepted
Applied: 0335ae7f2
- Severity: Important. Source: security.
- Where: `runner/worktree.ts:91` (`git worktree add`) and `:108` (`git commit --no-verify`).
- Evidence: `--no-verify` skips only `pre-commit` and `commit-msg`. `prepare-commit-msg` and `post-commit` still run, and `worktree add` runs `post-checkout`. D29's intent is that repository hooks never run on the snapshot.
- Fix: run the service's own git commands with `-c core.hooksPath=<empty directory>`, and keep `--no-verify`.

### F7: An inherited out-of-scope model runs without the scope warning
Disposition: Accepted
Applied: 8c68c82ef
- Severity: Important. Source: requirements.
- Where: `service/service.ts:423` passes `available: []` when no model is named. `settings/models.ts:89-92` then finds no scoped model and treats the scope as unrestricted.
- Evidence: plan T2 requires "inherited (warning, runs)". The helper test passes, but the service path never warns.
- Fix: load the available models whenever `scopeModels` is on. Add a service-level test with an out-of-scope parent model.

### F8: A worktree run removes its worktree before its nested children stop
Disposition: Accepted
Applied: 3d064998d
- Severity: Minor. Source: correctness.
- Where: `service/service.ts:586` runs `finishWorktree()` inside `run()`. `settle()` calls `abortChildren()` afterwards (`:653`).
- Evidence: a background nested child started through `Agent` works in the parent's worktree copy. `git worktree remove` refuses a dirty tree, so the loss window is small. The child can still act in a removed directory until it is aborted.
- Fix: abort the run's children and wait for them, bounded, before `finishWorktree()`.

### F9: T4's retention test never checks that a queued record survives
Disposition: Accepted
Applied: e3efb85ec
- Severity: Minor. Source: requirements.
- Where: `test/suite/fork-subagents-service.test.ts:544`.
- Evidence: plan T4 names "running and queued records are never evicted". The test holds one running record and no queued one. `service.ts:890-907` skips queued records today, but no test guards it.
- Fix: add a queued record behind `maxConcurrent: 1` to the test.

### F10: Several kept behaviors have no behavioral test
Disposition: Deferred: the owner decides per item; the checklist Gaps section lists about 500 old cases, and these five carry the most risk.
- Severity: Minor. Sources: requirements, test coverage, handoff open items.
- Items: a real compaction inside a child reaching `subagents:compacted` (only the bridge is tested, `test/suite/fork-subagents-adapter.test.ts:384-417`); aborting a queued foreground call; `worktreeIsolation: false` at run time; RPC spawn input validation (`adapter/rpc.ts:67-155`); fixed sleeps in `fork-subagents-adapter.test.ts:735-746` and `fork-subagents-worktree.test.ts:176`.

### F11: `steer_subagent` reports success when the child's steer delivery fails
Disposition: Deferred: recorded T5 deviation; delivery failures are rare, and phase 4 revisits steering on the typed service.
- Severity: Minor. Source: error handling.
- Where: `service/service.ts:798-801` records the failure as activity after the tool already answered. pi-subagents answered "Failed to steer agent".

### F12: The `Agent` tool sends no live progress while it waits
Disposition: Deferred: phase 2 owns the tool's rendering; the checklist gap for `foreground-concurrency-wiring` names it.
- Severity: Minor. Sources: requirements, handoff open item.
- Where: `tools/agent.ts:234` ignores `onUpdate`, so a queued foreground call shows nothing until it returns.

### F13: Records, settings and definitions leave the service as live mutable objects
Disposition: Deferred: phase 2 defines the UI's read model and can switch consumers to snapshots then.
- Severity: Minor. Sources: type design, evolvability.
- Where: `service/records.ts:16-81`, `service/service.ts:137-143` (events carry the record), `:224-236` (settings and registry getters). `settings/settings.ts:181` also writes values the reader drops.

### F14: Layering drift in the service
Disposition: Deferred: phase 2 adds the UI factory's subscriptions; restructure before that, not in phase 1.
- Severity: Minor. Sources: architecture, evolvability.
- Items: a runtime import cycle `service.ts` to `adapter/events.ts` to `adapter/skill-agents.ts` to `service.ts`; `service/nested.ts` builds tool definitions from `tools/`; `runner/run.ts:23` imports `service/usage.ts`; `service.ts` holds about 1,000 lines; spawn modes ride on optional `detached` and `isBackground` flags (`service.ts:145-170`, `:377-403`).

### F15: Memory paths follow a symlinked ancestor directory
Disposition: Deferred: parity with pi-subagents (`src/memory.ts:84-97` at `79a7c42`); after F4 only a trusted project can plant the link.
- Severity: Minor. Source: security.
- Where: `runner/memory.ts:34`, `:49-53` check only the agent directory and `MEMORY.md`.

### F16: Skill docs still name the external pi-subagents as the provider
Disposition: Deferred: phase 3's cutover removes pi-subagents; the user docs change with it.
- Severity: Minor. Source: docs impact.
- Where: `docs/skills.md:162-168`, `:178-205`; `docs/skills-capability-matrix.md:44-45`.

### F17: Excluded extensions still run their factories
Disposition: Rejected: by design; handoff 14.6 "Loader order" states that the factory still runs once, and plan Section 3 records the probe (M2). The factories are the user's own configured extensions.
- Source: security. Where: `runner/scope.ts:237-245`.

### F18: Unawaited steer, abort and loader disposal in the runner
Disposition: Rejected: `Agent.steer` is synchronous (`packages/agent/src/agent.ts:389`); `AgentSession.abort()` only awaits idle (`agent-session.ts:4451-4464`); `DefaultResourceLoader.dispose()` only closes its watcher (`resource-loader.ts:637-643`). No reachable rejection exists.
- Source: error handling. Where: `runner/run.ts:266-270`, `:279`, `:294`, `:398`.

### F19: The skill-fork client's `stop()` swallows errors
Disposition: Rejected: the fire-and-forget contract predates the phase (`skills/skill-fork.ts:551`), and the typed `service.stop` returns a boolean without throwing.
- Source: error handling.

### F20: The README says RPC spawns emit no `subagents:created`
Disposition: Rejected: `service/service.ts:404` emits `created` only for a background spawn that is not detached, so the README is right.
- Source: docs impact.

### F21: The `Agent` tool texts use em dashes
Disposition: Rejected: the texts are ported model-facing prompt text from pi-subagents `src/index.ts:1561-1760` (T5 design), not durable prose.
- Source: guidelines. Where: `tools/description.ts:90-93`.

### F22: The phase results file is missing
Disposition: Rejected: T12 writes `docs/plans/subagents-native-phase1.results.md` after T10 and T11 (plan Section 6).
- Source: docs impact.

### F23: Stale comment headers in the worktree test and skill-fork
Disposition: Rejected: the worktree test header refers to the developer's global configuration, which the tests isolate (`test/fork-builtins/subagents/worktree.test.ts:2-4`). The skill-fork protocol lines predate the phase and lie outside the diff; the added paragraph is accurate.
- Source: comments.

### F24: Queue drain and child scans grow quadratically; transcripts write synchronously
Disposition: Rejected: the scans cost little at realistic sizes (`maxConcurrent` defaults to 10), and synchronous transcript appends match pi-subagents `src/output-file.ts:136` at `79a7c42`.
- Source: performance. Where: `service/service.ts:657`, `:704`; `runner/transcript.ts:43-52`.

### F25: A child's skill set includes the user's home skills
Disposition: Rejected: a child's loader discovers the same user skills its parent loads; only tests need to select skills by id. Explicit `skills:` lists come from the parent's loaded skills (`runner/run.ts:121-125`).
- Source: handoff open item.

### F26: The agent-ended ordering gate is tested only directly
Disposition: Rejected: an RPC suite test also checks that the spawn reply precedes the terminal event; only the forced early-completion branch is tested directly.
- Source: handoff open item.

### T10 fix tasks

Each applied finding ran as its own task under the regression rule and the review gate.

#### T10-F1

Candidate: /tmp/sn-impl/T10-F1-a2-3.json (4780 tests, 0 failed, 50 pending)

Review:
- F1 (Minor) The new comment said every abort during a tool batch ends the run on a tool result, while the loop usually makes one more aborted model call (`packages/agent/src/agent-loop.ts:327-336`, `:344-376`): Accepted. The comment names the terminating batch.
- F2 (Minor) An Esc during the retry backoff or during post-run auto-compaction emits no `agent_end`, so a parked notice still started a new parent turn (`agent-session.ts` `_prepareRetry`, `_finishCancelledRetry`); pi-subagents has the same gap: Accepted for the retry, by the owner's choice on 2026-09-28: `auto_retry_end` with "Retry cancelled" marks the run interrupted, with the test "holds a notice for the next prompt when an abort cancels the parent's retry" (mutation T10-F1-M2). The compaction case is Deferred with the owner's yes (2026-09-28): `compaction_end.aborted` also reports an extension's cancel (`_runAutoCompaction`: `aborted = signal.aborted || cancelledByExtension`), and telling them apart needs a core change.

#### T10-F2

Candidate: /tmp/sn-impl/T10-F2-a1-3.json (4781 tests, 1 failed, 50 pending)
Its failures are known flakes (plan Section 5, D28, D32): test/exec.test.ts "captures finite inherited descendant output after the shell exits".

Review:
- none

#### T10-F3

Candidate: /tmp/sn-impl/T10-F3-a1-3.json (4783 tests, 0 failed, 50 pending)

Review:
- none

#### T10-F4

Candidate: /tmp/sn-impl/T10-F4-a1-3.json (4784 tests, 1 failed, 50 pending)
Its failures are known flakes (plan Section 5, D28, D32): test/exec.test.ts "captures finite inherited descendant output after the shell exits".

Review:
- none

#### T10-F5

Candidate: /tmp/sn-impl/T10-F5-a2-1.json (4786 tests, 0 failed, 50 pending)

Review:
- F1 (Minor) A project directory whose name starts with `..` (for example `..helpers`) counted as outside the project, because `isInside` rejected any relative path starting with `..`; the repository's own check is `getCwdRelativePath` (`src/utils/paths.ts:112-114`): Accepted. `isInside` now leaves the root only for `..` itself or a `..` plus separator prefix. New module test "refuses every spelling of a path inside an untrusted project, and keeps one outside" (mutation T10-F5-M2).
- F2 (Minor) On a case-insensitive disk, an absolute or `~` path that differs from the session cwd only in case counted as outside, because the JavaScript `realpathSync` keeps the spelling's case: Accepted. `realOrSelf` uses `realpathSync.native`, which returns the on-disk case; the same module test covers it where the disk is case-insensitive (mutation T10-F5-M3).

#### T10-F6

Candidate: /tmp/sn-impl/T10-F6-a2-3.json (4787 tests, 1 failed, 50 pending)
Its failures are known flakes (plan Section 5, D28, D32): test/exec.test.ts "captures finite inherited descendant output after the shell exits".

Review:
- F1 (Minor) A `core.fsmonitor` program (for example `.git/hooks/fsmonitor-watchman`) still ran on `status`, `add -A` and `commit`, because `core.hooksPath` does not cover it, so "no repository hook runs" was too broad (the reviewer's scratch repository logged 12 calls with git 2.55.0): Accepted. `NO_HOOKS` also sets `core.fsmonitor=false`, and the test configures a monitor program (mutation T10-F6-M2).
- F2 (Minor) The `NO_HOOKS` comment joined two statements with a semicolon: Accepted. It is split into sentences.

#### T10-F7

Candidate: /tmp/sn-impl/T10-F7-a1-5.json (4788 tests, 0 failed, 50 pending)

Review:
- none

#### T10-F8

Candidate: /tmp/sn-impl/T10-F8-a2-2.json (4789 tests, 0 failed, 50 pending)

Review:
- F1 (Minor) Grandchildren were aborted but not awaited: `endChildren` waited only on direct children's runs, while a child's `settle` aborts its own children without waiting, so with `maxSubagentDepth` 3 or more a grandchild could still act in the copy when `finishWorktree` started (`service.ts` `settle`, `abortChildren`, `endRecord`): Accepted. `endDescendants` ends every agent below the worktree record and waits for all their runs under the same bound. The test now spawns a child and a grandchild and checks that none still runs when the worktree is saved (mutation T10-F8-M2).

#### T10-F9

Candidate: /tmp/sn-impl/T10-F9-a1-1.json (4790 tests, 0 failed, 50 pending)

Review:
- none

## Deviations

### Rulings made during the phase

Each ruling is a dated row in section 7 of `/Users/paolof/Developer/ai/_handoffs/2026-09-26-pi-session-control-consolidated.md`.

| Ruling | Date | Effect |
| --- | --- | --- |
| D28 | 2026-09-27 | From T6 on, `./test.sh` tolerates `exec.test.ts` and the footer reftable test when the file passes alone 3 times. |
| D29 | 2026-09-27 | The worktree snapshot commit runs with `--no-verify` (plan amendment 1). |
| D30 | 2026-09-27 | A user or project agent switched off keeps its bare name (plan amendment 2). |
| D31 | 2026-09-27 | Task T8a adds tests for three uncovered old-test files (plan amendment 3). |
| D32 | 2026-09-27 | From T8a on, candidate runs tolerate D28's two tests, and the attempt's last run is the candidate. |
| D33 | 2026-09-28 | Task T8b fails an `Agent` call whose worktree cannot start and counts definition loads (plan amendment 4). |
| D34 | 2026-09-28 | A child's adapter reuses its owner's agent files, so a spawn sweeps the agent directories once (plan amendment 5). |

### One-off decisions by the owner

- T5: the owner accepted `./test.sh` logs that failed only the footer and `exec.test.ts` flakes, before D28 existed.
- T8a: the owner asked for the commit without further runs. Its candidate `T8a-a2-1.json` fails the footer reftable test, and attempt 2 has no run without it.
- T8b: the owner accepted `./test.sh` logs that failed an `agent-session-concurrent` test, a plan-listed flake outside D28.
- T9: after the T9 commit, `~/.pi/agent/settings.json` no longer matched its setup hash. The file changed at 2026-09-27 22:08:54, and this session never writes it. The owner confirmed the change and approved a new baseline.
- T10-F1: the owner chose to fix a cancelled retry inside T10-F1. The owner deferred an abort during post-run compaction, because core reports an extension's cancel the same way.
- T10-F7: four runs at load averages of 18 to 28 failed `exec.test.ts`. The owner chose to wait for lower load, and the fifth run, at load 5, came out clean.

### Implementation differences from the plan text

- Baseline: `base-testsh.log` shows no `delta.test.ts` failure, which plan Appendix A had recorded.
- T2: core's `SettingsManager` already hides project settings in an untrusted project, so the reader adds no second check.
- T2: the model scope uses core's `resolveModelScopeFromModels`, so `enabledModels` globs work; pi-subagents matched exact entries only.
- T3: `*` and an omitted `tools:` select pi-subagents' seven coding tools; `powershell` joins only when named.
- T3: a persisted child defaults to `.subagents/` below the parent's own session directory.
- T4: a grace turn that answers without calling tools finishes `steered`. pi-subagents hard-aborted it, a defect left behind.
- T4: the service emits typed events (`created`, `started`, `ended`, `steered`, `compacted`, `definitions`, `warning`) for T8 and phase 2.
- T5: a background `Agent` spawn outlives its call's abort signal, as in pi-subagents.
- T5: a foreground resume returns the same text as a foreground spawn.
- T5: steer delivery stays fire-and-forget; phase review F11 records the gap.
- T6: `ChildRequest.inheritFrom` names the session a nested child inherits its conversation and appended prompt from.
- T6: nested transcripts use the root session id, and nested tool results carry no usage.
- T7: a run creates its worktree when it starts, after the queue.
- T7: a record that ran in a worktree refuses `resume`, because its session's directory is gone.
- T7: the transcript path and `session_dir:` resolve against the project, not the worktree copy.
- T7: the child-level worktree cases live in `test/suite/fork-subagents-worktree.test.ts`.
- T8: configuration, definitions and the transcript directory always come from the session's project.
- T8: a caller's signal stops every spawn except a background `Agent` one.
- T8: the typed skill-fork path describes its spawn as `skill <folder>`.
- T8: `subagents:compacted` is checked at the bridge only; no test drives a real compaction inside a child.
- T8b: `WorktreeStartError` marks a worktree that cannot be created. A queued run that meets it later ends as an error, as in pi-subagents.
- T9: the drafting agents' Partial rows became Covered, and their unmatched cases stay in the Gaps section.
- T10: `phase-review.md` lost its title and its Findings heading before T12 embedded it, and gained the approval line.
- T10-F1: in this fork an aborted tool batch usually ends on an aborted assistant message. The test uses a batch that terminates, which ends on a tool result.
- T10-F3: one guard in `spawnRecord`, after the spawn's awaits, covers a finished parent and a parent that ends mid-spawn.
- T10-F8: the worktree suite wraps `finishWorktree` in a passthrough mock to see the service when a worktree is saved.
- T11: the probe's settings turn subagent transcripts off, so no run leaves a file in the OS temp directory.

### Open items for later phases

- Phase review F10 to F16, each Deferred with its reason above.
- An abort during post-run auto-compaction does not mark the parent run interrupted (T10-F1 review).
- The 506 gap lines in `docs/plans/subagents-native-phase1-evidence/checklist.md`.
- Two tests stay load-sensitive: `exec.test.ts` "captures finite inherited descendant output after the shell exits" and every `agent-session-concurrent.test.ts` test.


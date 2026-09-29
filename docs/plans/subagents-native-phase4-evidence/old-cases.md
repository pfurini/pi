# Native subagents phase 4: old-test cases

This inventory lists every case of pi-tasks' 25 test files at commit `83480bd`. The phase 4 plan's `planning-changes` session wrote it with `extract-old-cases.mjs` (TypeScript parser) and assigned each case; a subagent proposed the statuses, and the planning session checked the drops against the rulings and the probe code.
A status `T<n>.<k>` names numbered case k of plan task T<n>; `Dropped: <reason>` names a deliberate drop under D46 to D49 or D53.
Each task T1 to T4 fills `Covering tests` for its own `T<n>.<k>` rows, in the commit that adds the tests, with vitest identities `<file relative to packages/coding-agent> > <full test name>` separated by `; `.
`check-cases.mjs coverage` (phase 2 evidence) checks that each identity passes and that at least one of them failed under a mutation entry of case T<n>.<k>. T5 checks every row.

| # | Old test | Status | Covering tests |
| --- | --- | --- | --- |
| 1 | test/agent-reattach.test.ts > reattaching subagents after reload > completes the task when the agent finishes after a reload | T3.9 | |
| 2 | test/agent-reattach.test.ts > reattaching subagents after reload > reverts the task to pending when the agent fails after a reload | T3.9 | |
| 3 | test/agent-reattach.test.ts > reattaching subagents after reload > keeps the partial result when the agent was stopped before a reload | T3.9 | |
| 4 | test/agent-reattach.test.ts > reattaching subagents after reload > lets a blocking TaskOutput resolve on the reattached agent's event | T3.9 | |
| 5 | test/agent-reattach.test.ts > reattaching subagents after reload > resolves an agent ID to its task after a reload | T3.9 | |
| 6 | test/agent-reattach.test.ts > reattaching subagents after reload > does not reattach a task that is no longer in progress | Dropped: D47, one service per session (re-linking agents after /reload) | |
| 7 | test/agent-reattach.test.ts > reattaching subagents after reload > ignores a duplicate event after the reattached agent already reported | T3.4 | |
| 8 | test/agent-reattach.test.ts > reattaching subagents after reload > does not carry an agent mapping into the next session | Dropped: D47, one service per session (agent mapping kept across /new in one instance) | |
| 9 | test/agent-reattach.test.ts > reattaching subagents after reload > reattaches every running agent, not just the first | T3.9 | |
| 10 | test/auto-cascade.test.ts > Auto-cascade (enabled) > starts a dependent task and records its agent when the blocker completes | Dropped: D49, auto-cascade | |
| 11 | test/auto-cascade.test.ts > Auto-cascade (enabled) > carries the launch model, turn limit, and thinking level into cascaded agents | Dropped: D49, auto-cascade | |
| 12 | test/auto-cascade.test.ts > Auto-cascade (enabled) > waits for every blocker, not just the one that completed | Dropped: D49, auto-cascade | |
| 13 | test/auto-cascade.test.ts > Auto-cascade (enabled) > does not cascade into tasks that do not depend on the completed one | Dropped: D49, auto-cascade | |
| 14 | test/auto-cascade.test.ts > Auto-cascade (enabled) > reverts a dependent to pending and records the error when its spawn fails | Dropped: D49, auto-cascade | |
| 15 | test/auto-cascade.test.ts > Auto-cascade (enabled) > chains through a three-task dependency line | Dropped: D49, auto-cascade | |
| 16 | test/auto-cascade.test.ts > Auto-cascade (enabled) > does not cascade when the blocker fails | Dropped: D49, auto-cascade | |
| 17 | test/auto-clear-lifecycle.test.ts > auto-clear across batches > keeps the finished list visible after the run that produced it | T2.10 | |
| 18 | test/auto-clear-lifecycle.test.ts > auto-clear across batches > keeps it through a follow-up that creates no work | T2.12 | |
| 19 | test/auto-clear-lifecycle.test.ts > auto-clear across batches > starts the next batch clean instead of appending to the finished one | T2.12 | |
| 20 | test/auto-clear-lifecycle.test.ts > auto-clear across batches > does the same after the session is resumed | T2.13 | |
| 21 | test/auto-clear-lifecycle.test.ts > auto-clear across batches > keeps every step of a list the agent builds one task at a time | T2.12 | |
| 22 | test/auto-clear-lifecycle.test.ts > auto-clear across batches > leaves unfinished work in place across the run boundary | T2.12 | |
| 23 | test/auto-clear-lifecycle.test.ts > auto-clear across batches > keeps the list when auto-clear is off | T2.12 | |
| 24 | test/auto-clear-lifecycle.test.ts > auto-clear across batches > removes the emptied session file when the countdown clears the list | T2.10 | |
| 25 | test/auto-clear.test.ts > auto-clear: on_task_complete mode > does not clear completed task before REMINDER_INTERVAL turns | T2.11 | |
| 26 | test/auto-clear.test.ts > auto-clear: on_task_complete mode > clears completed task after REMINDER_INTERVAL turns | T2.11 | |
| 27 | test/auto-clear.test.ts > auto-clear: on_task_complete mode > clears each task independently based on its own completion turn | T2.11 | |
| 28 | test/auto-clear.test.ts > auto-clear: on_task_complete mode > does not clear pending or in_progress tasks | T2.11 | |
| 29 | test/auto-clear.test.ts > auto-clear: on_task_complete mode > cleans up dependency edges when auto-clearing | T1.6 | |
| 30 | test/auto-clear.test.ts > auto-clear: on_task_complete mode > returns true when tasks are cleared | T2.11 | |
| 31 | test/auto-clear.test.ts > auto-clear: on_list_complete mode > does not clear when some tasks are still pending | T2.10 | |
| 32 | test/auto-clear.test.ts > auto-clear: on_list_complete mode > does not clear immediately when all tasks complete | T2.10 | |
| 33 | test/auto-clear.test.ts > auto-clear: on_list_complete mode > clears all completed tasks after REMINDER_INTERVAL turns when all are completed | T2.10 | |
| 34 | test/auto-clear.test.ts > auto-clear: on_list_complete mode > resets countdown when a new task is created before REMINDER_INTERVAL | T2.10 | |
| 35 | test/auto-clear.test.ts > auto-clear: on_list_complete mode > resets countdown when a task goes back to in_progress | T2.10 | |
| 36 | test/auto-clear.test.ts > auto-clear: on_list_complete mode > returns true when tasks are cleared | T2.10 | |
| 37 | test/auto-clear.test.ts > auto-clear: never mode > never clears completed tasks regardless of turns | T2.12 | |
| 38 | test/auto-clear.test.ts > auto-clear: never mode > trackCompletion is a no-op | T2.12 | |
| 39 | test/auto-clear.test.ts > auto-clear: dynamic mode switching > respects mode changes via getMode callback | T2.13 | |
| 40 | test/auto-clear.test.ts > auto-clear: store getter (session switch) > operates on the current store after swap | Dropped: D47, one service per session (store swap inside one instance) | |
| 41 | test/auto-clear.test.ts > auto-clear: store getter (session switch) > clears from new store, not old store | Dropped: D47, one service per session (store swap inside one instance) | |
| 42 | test/auto-clear.test.ts > auto-clear: reset (new session) > reset clears per-task tracking so old completions don't fire | Dropped: D47, one service per session (reset at a second session_start to the same instance) | |
| 43 | test/auto-clear.test.ts > auto-clear: reset (new session) > reset clears batch countdown so old all-completed state doesn't fire | Dropped: D47, one service per session (reset at a second session_start to the same instance) | |
| 44 | test/auto-clear.test.ts > auto-clear: reset (new session) > tracking works normally after reset | Dropped: D47, one service per session (reset at a second session_start to the same instance) | |
| 45 | test/auto-clear.test.ts > auto-clear: starting a new batch > retires a finished list before the new tasks land (${mode}) | T2.12 | |
| 46 | test/auto-clear.test.ts > auto-clear: starting a new batch > keeps a list the agent is still building in the same run | T2.12 | |
| 47 | test/auto-clear.test.ts > auto-clear: starting a new batch > keeps the list in never mode | T2.12 | |
| 48 | test/auto-clear.test.ts > auto-clear: starting a new batch > leaves a list with unfinished work alone | T2.12 | |
| 49 | test/auto-clear.test.ts > auto-clear: starting a new batch > does nothing on an empty store | T2.12 | |
| 50 | test/auto-clear.test.ts > auto-clear: starting a new batch > clears a list a subagent finished after its run ended | T2.12 | |
| 51 | test/auto-clear.test.ts > auto-clear: starting a new batch > arms once per run, so the batch it starts is not swept mid-build | T2.12 | |
| 52 | test/auto-clear.test.ts > auto-clear: starting a new batch > does not cut the new batch's own countdown short | T2.10 | |
| 53 | test/auto-clear.test.ts > auto-clear: starting a new batch > reset drops the armed boundary | Dropped: D47, one service per session (reset at a second session_start to the same instance) | |
| 54 | test/host-lifecycle.test.ts > pi-tasks in a real Pi runtime > loads cleanly and declares every task tool to the model | T3.10 | |
| 55 | test/host-lifecycle.test.ts > pi-tasks in a real Pi runtime > persists tasks the model creates and shows them in the widget | T2.6 | |
| 56 | test/host-lifecycle.test.ts > pi-tasks in a real Pi runtime > reminds the model of stale in-progress work without persisting the reminder | T4.2 | |
| 57 | test/host-lifecycle.test.ts > pi-tasks in a real Pi runtime > opens the /tasks menu and its settings panel | T4.8 | |
| 58 | test/host-lifecycle.test.ts > pi-tasks in a real Pi runtime > carries the parent's tasks into a fork (%s scope) | T2.14 | |
| 59 | test/host-lifecycle.test.ts > pi-tasks in a real Pi runtime > carries the parent's tasks into a fork of a session Pi does not persist | T2.14 | |
| 60 | test/host-lifecycle.test.ts > pi-tasks in a real Pi runtime > keeps a fork's tasks independent of its parent | T2.6 | |
| 61 | test/host-lifecycle.test.ts > pi-tasks in a real Pi runtime > stops the replaced instance's spinner on /new | T4.5 | |
| 62 | test/host-lifecycle.test.ts > pi-tasks in a real Pi runtime > restores tasks and task tools on /resume | T2.13 | |
| 63 | test/host-lifecycle.test.ts > pi-tasks in a real Pi runtime > keeps the task list across /reload and stops the old instance's spinner | T4.9 | |
| 64 | test/host-lifecycle.test.ts > pi-tasks in a real Pi runtime > keeps memory-scope tasks across /reload | T3.9 | |
| 65 | test/host-lifecycle.test.ts > pi-tasks in a real Pi runtime > keeps the tasks of a session Pi does not persist across /reload | T3.9 | |
| 66 | test/pi-versions.test.ts > Pi versions > peer-depends on every Pi package from one floor | Dropped: D46, packaging | |
| 67 | test/pi-versions.test.ts > Pi versions > pins every Pi package at one exact version, at or above the floor | Dropped: D46, packaging | |
| 68 | test/pi-versions.test.ts > Pi versions > pins every Pi package it peer-depends on | Dropped: D46, packaging | |
| 69 | test/pi-versions.test.ts > Pi versions > pins the typebox that the pinned Pi depends on | Dropped: D46, packaging | |
| 70 | test/pi-versions.test.ts > Pi versions > has a lockfile that matches package.json | Dropped: D46, packaging | |
| 71 | test/pi-versions.test.ts > Pi versions > states no version in CI, the install script or the compatibility rules | Dropped: D46, packaging | |
| 72 | test/pi-versions.test.ts > Pi versions > states no pinned Pi install or version range in the docs | Dropped: D46, packaging | |
| 73 | test/process-tracker.test.ts > ProcessTracker > returns undefined for untracked task | Dropped: D49, shell branches (ProcessTracker) | |
| 74 | test/process-tracker.test.ts > ProcessTracker > tracks a process and captures stdout | Dropped: D49, shell branches (ProcessTracker) | |
| 75 | test/process-tracker.test.ts > ProcessTracker > tracks a process and captures stderr | Dropped: D49, shell branches (ProcessTracker) | |
| 76 | test/process-tracker.test.ts > ProcessTracker > reports error status for non-zero exit | Dropped: D49, shell branches (ProcessTracker) | |
| 77 | test/process-tracker.test.ts > ProcessTracker > waitForCompletion returns immediately for already-completed process | Dropped: D49, shell branches (ProcessTracker) | |
| 78 | test/process-tracker.test.ts > ProcessTracker > waitForCompletion returns undefined for untracked task | Dropped: D49, shell branches (ProcessTracker) | |
| 79 | test/process-tracker.test.ts > ProcessTracker > waitForCompletion waits for process to finish | Dropped: D49, shell branches (ProcessTracker) | |
| 80 | test/process-tracker.test.ts > ProcessTracker > waitForCompletion times out if process takes too long | Dropped: D49, shell branches (ProcessTracker) | |
| 81 | test/process-tracker.test.ts > ProcessTracker > stop sends SIGTERM and marks process stopped | Dropped: D49, shell branches (ProcessTracker) | |
| 82 | test/process-tracker.test.ts > ProcessTracker > stop returns false for untracked task | Dropped: D49, shell branches (ProcessTracker) | |
| 83 | test/process-tracker.test.ts > ProcessTracker > stop returns false for already-completed process | Dropped: D49, shell branches (ProcessTracker) | |
| 84 | test/process-tracker.test.ts > ProcessTracker > getProcess returns the background process record | Dropped: D49, shell branches (ProcessTracker) | |
| 85 | test/process-tracker.test.ts > ProcessTracker > handles process error event | Dropped: D49, shell branches (ProcessTracker) | |
| 86 | test/process-tracker.test.ts > ProcessTracker > waitForCompletion respects abort signal | Dropped: D49, shell branches (ProcessTracker) | |
| 87 | test/process-tracker.test.ts > ProcessTracker > notifies waiters when process completes | Dropped: D49, shell branches (ProcessTracker) | |
| 88 | test/reminder-cadence.test.ts > reminder cadence (pure) > starts with reminder not due | T2.7 | |
| 89 | test/reminder-cadence.test.ts > reminder cadence (pure) > marks reminder due after REMINDER_INTERVAL non-task turns when tasks exist | T2.7 | |
| 90 | test/reminder-cadence.test.ts > reminder cadence (pure) > does NOT mark reminder due when no tasks exist | T2.7 | |
| 91 | test/reminder-cadence.test.ts > reminder cadence (pure) > does NOT mark reminder due before the interval elapses | T2.7 | |
| 92 | test/reminder-cadence.test.ts > reminder cadence (pure) > task tool usage resets cadence and clears any pending reminder | T2.7 | |
| 93 | test/reminder-cadence.test.ts > reminder cadence (pure) > does not re-fire within the same injection cycle | T2.7 | |
| 94 | test/reminder-cadence.test.ts > reminder cadence (pure) > re-arms after a task tool usage resets the cycle | T2.7 | |
| 95 | test/reminder-cadence.test.ts > reminder cadence (pure) > drainReminderForContext is a one-shot (only fires once per cycle) | T2.7 | |
| 96 | test/reminder-cadence.test.ts > reminder cadence (pure) > resetCadenceState wipes everything | Dropped: D47, one service per session (cadence reset at a second session_start) | |
| 97 | test/session-handoff.test.ts > session handoff > keys a persisted session by its file and an unpersisted one by its workspace | T2.14 | |
| 98 | test/session-handoff.test.ts > session handoff > hands a handoff over exactly once, with its source | T2.14 | |
| 99 | test/session-handoff.test.ts > session handoff > returns nothing for a key that has no handoff | T2.14 | |
| 100 | test/session-handoff.test.ts > session handoff > replaces an earlier handoff for the same key | T2.14 | |
| 101 | test/session-handoff.test.ts > session handoff > reads the source when taken, so changes made after leaving it are included | T3.8 | |
| 102 | test/session-handoff.test.ts > session handoff > returns a copy, so the next session cannot change the old one's tasks | T1.12 | |
| 103 | test/session-handoff.test.ts > session handoff > keeps the registry on globalThis, where a re-evaluated module still finds it | Dropped: D47, one service per session (globalThis registries) | |
| 104 | test/session-lifecycle.test.ts > fork across extension instances > seeds the forked session's file with the parent's tasks (session scope) | T2.14 | |
| 105 | test/session-lifecycle.test.ts > fork across extension instances > seeds the forked session's file under session-global scope | Dropped: D49, scopes (session-global scope) | |
| 106 | test/session-lifecycle.test.ts > fork across extension instances > carries in-memory tasks into the fork (memory scope) | T2.14 | |
| 107 | test/session-lifecycle.test.ts > fork across extension instances > carries tasks of a session Pi does not persist (--no-session) | T2.14 | |
| 108 | test/session-lifecycle.test.ts > fork across extension instances > does not duplicate a shared project list | Dropped: D49, scopes (project scope) | |
| 109 | test/session-lifecycle.test.ts > fork across extension instances > does not duplicate a list shared through a PI_TASKS path | Dropped: D49, scopes (PI_TASKS) | |
| 110 | test/session-lifecycle.test.ts > fork across extension instances > keeps the fork independent of the parent | T2.14 | |
| 111 | test/session-lifecycle.test.ts > fork across extension instances > leaves a fork target that already has tasks as it is | T1.12 | |
| 112 | test/session-lifecycle.test.ts > fork across extension instances > does not carry tasks into /new or /resume | T2.14 | |
| 113 | test/session-lifecycle.test.ts > fork across extension instances > relinks a subagent still running for a carried task | Dropped: D47, one service per session (re-linking agents across a fork; the session end now aborts them, T3.8) | |
| 114 | test/session-lifecycle.test.ts > fork across extension instances > still seeds a fork when the host reuses one instance | Dropped: D47, one service per session (a second session_start to the same instance) | |
| 115 | test/session-lifecycle.test.ts > reload across extension instances > keeps memory-scope tasks and shows them | T3.9 | |
| 116 | test/session-lifecycle.test.ts > reload across extension instances > keeps the tasks of a session Pi does not persist (--no-session) | T3.9 | |
| 117 | test/session-lifecycle.test.ts > reload across extension instances > keeps the tasks of an in-memory list forced by PI_TASKS=off | Dropped: D49, scopes (PI_TASKS) | |
| 118 | test/session-lifecycle.test.ts > reload across extension instances > continues task IDs after the carried tasks | T3.9 | |
| 119 | test/session-lifecycle.test.ts > reload across extension instances > re-reads a %s-scope file instead of restoring a copy | Dropped: D49, scopes (shared-file re-read) | |
| 120 | test/session-lifecycle.test.ts > reload across extension instances > never writes an in-memory list into a file when the scope changed | T2.6 | |
| 121 | test/session-lifecycle.test.ts > reload across extension instances > relinks a subagent still running for an in-memory task | T3.9 | |
| 122 | test/session-lifecycle.test.ts > a subagent cut short by the end of the session > reverts the fork's copy and the parent's task to pending (report first: %s) | T3.8 | |
| 123 | test/session-lifecycle.test.ts > a subagent cut short by the end of the session > reverts an in-memory task carried across /reload (report first: %s) | Dropped: D47, one service per session (handing an in-memory list over a reload; /reload no longer ends agents, T3.9) | |
| 124 | test/session-lifecycle.test.ts > session_shutdown > stops the spinner timer and clears the widget | T4.5 | |
| 125 | test/session-lifecycle.test.ts > session_shutdown > leaves the replaced instance unable to draw | T4.5 | |
| 126 | test/session-lifecycle.test.ts > widget failures > do not fail the tool call that changed the store | T4.5 | |
| 127 | test/stale-task-reminder.test.ts > stale in_progress task reminders > injects a task-specific reminder after text-only turns | T2.7 | |
| 128 | test/stale-task-reminder.test.ts > stale in_progress task reminders > uses a shorter reminder interval for non-task tools when a task is in_progress | T2.7 | |
| 129 | test/stale-task-reminder.test.ts > stale in_progress task reminders > sanitizes task subjects so they cannot break out of the reminder block | T2.8 | |
| 130 | test/stale-task-reminder.test.ts > stale in_progress task reminders > caps the echoed list and keeps in_progress tasks when over the limit | T2.8 | |
| 131 | test/stale-task-reminder.test.ts > stale in_progress task reminders > falls back to the empty-list nudge when the list is cleared before the next LLM call | T2.8 | |
| 132 | test/store-scope.test.ts > taskScope: project > persists to a single shared file | Dropped: D49, scopes (project scope) | |
| 133 | test/store-scope.test.ts > taskScope: project > stays on the same file when the session changes | Dropped: D49, scopes (project scope) | |
| 134 | test/store-scope.test.ts > taskScope: memory > never touches the filesystem | T2.6 | |
| 135 | test/store-scope.test.ts > taskScope: memory > clears tasks on /new, since there is no file to switch away from | T2.14 | |
| 136 | test/store-scope.test.ts > taskScope: memory > keeps tasks across a reload | T3.9 | |
| 137 | test/store-scope.test.ts > taskScope: session, without a persisted session > keeps tasks in memory and leaves nothing on disk | T2.6 | |
| 138 | test/store-scope.test.ts > taskScope: session, without a persisted session > still writes a session file when the session is persisted | T2.6 | |
| 139 | test/store-scope.test.ts > taskScope: session, without a persisted session > does not fall back to a file when a later lifecycle event fires | Dropped: D47, one service per session (before_agent_start fallbacks) | |
| 140 | test/store-scope.test.ts > PI_TASKS override > resolves a relative path against the session workspace | Dropped: D49, scopes (PI_TASKS) | |
| 141 | test/store-scope.test.ts > PI_TASKS override > keeps everything in memory when set to off, even in project scope | Dropped: D49, scopes (PI_TASKS) | |
| 142 | test/store-scope.test.ts > session_start with a persisted list > wipes an all-completed list on startup, leaving no session file behind | T2.13 | |
| 143 | test/store-scope.test.ts > session_start with a persisted list > keeps an all-completed list on resume and shows the widget | T2.13 | |
| 144 | test/store-scope.test.ts > session_start with a persisted list > keeps a partially finished list on startup | T2.13 | |
| 145 | test/store-scope.test.ts > session_start with a persisted list > keeps the default scope writing into the workspace | T2.6 | |
| 146 | test/store-scope.test.ts > session-global scope > keeps a new session's tasks out of the workspace | Dropped: D49, scopes (session-global scope) | |
| 147 | test/store-scope.test.ts > session-global scope > keeps using a session's existing workspace file instead of moving it | Dropped: D49, scopes (session-global scope) | |
| 148 | test/store-scope.test.ts > session-global scope > reclaims the global directory once its last session file is gone | Dropped: D49, scopes (session-global scope) | |
| 149 | test/subagent-integration.test.ts > Session task rehydration > renders default session-scoped tasks immediately after reload | T4.9 | |
| 150 | test/subagent-integration.test.ts > Session task rehydration > renders tasks from a PI_TASKS path override after reload | Dropped: D49, scopes (PI_TASKS) | |
| 151 | test/subagent-integration.test.ts > Session task rehydration > renders persisted tasks after /resume | T2.13 | |
| 152 | test/subagent-integration.test.ts > Session task rehydration > switches the session-scoped store to the new session on /new | Dropped: D47, one service per session (a second session_start to the same instance) | |
| 153 | test/subagent-integration.test.ts > Session task rehydration > seeds a forked session with an independent copy of the parent's tasks | T2.14 | |
| 154 | test/subagent-integration.test.ts > Workspace-scoped store resolution > namespaces session tasks by ctx.cwd instead of the host process cwd | T2.6 | |
| 155 | test/subagent-integration.test.ts > Workspace-scoped store resolution > keeps identical session IDs isolated between workspaces | T2.6 | |
| 156 | test/subagent-integration.test.ts > Workspace-scoped store resolution > loads project scope from ctx.cwd and stores the shared task list there | Dropped: D49, scopes (project scope) | |
| 157 | test/subagent-integration.test.ts > Workspace-scoped store resolution > resolves relative PI_TASKS paths from ctx.cwd | Dropped: D49, scopes (PI_TASKS) | |
| 158 | test/subagent-integration.test.ts > Workspace-scoped store resolution > switches session stores when the session ID changes in the same workspace | Dropped: D47, one service per session (a second session_start to the same instance) | |
| 159 | test/subagent-integration.test.ts > Workspace-scoped store resolution > keeps an in-memory store when the context cwd changes | Dropped: D47, one service per session (store re-resolved per context in one instance) | |
| 160 | test/subagent-integration.test.ts > TaskExecute > is registered as a tool | T3.10 | |
| 161 | test/subagent-integration.test.ts > TaskExecute > returns error when subagent extension is not loaded | Dropped: D49, protocol handshake (pi-subagents not loaded fallback) | |
| 162 | test/subagent-integration.test.ts > TaskExecute > rejects non-existent tasks | T3.2 | |
| 163 | test/subagent-integration.test.ts > TaskExecute > rejects tasks without agentType | T3.2 | |
| 164 | test/subagent-integration.test.ts > TaskExecute > rejects non-pending tasks | T3.2 | |
| 165 | test/subagent-integration.test.ts > TaskExecute > rejects tasks with unresolved blockers | T3.2 | |
| 166 | test/subagent-integration.test.ts > TaskExecute > spawns agent for valid task and updates metadata | T3.1 | |
| 167 | test/subagent-integration.test.ts > TaskExecute > passes additional_context, max_turns, and thinking to spawned agents | T3.1 | |
| 168 | test/subagent-integration.test.ts > TaskExecute > allows executing tasks whose blockers are all completed | T3.2 | |
| 169 | test/subagent-integration.test.ts > TaskExecute > handles mixed valid and invalid tasks in one call | T3.2 | |
| 170 | test/subagent-integration.test.ts > TaskExecute via ready broadcast > detects subagents when ready fires after tasks init | Dropped: D49, protocol handshake (ready broadcast) | |
| 171 | test/subagent-integration.test.ts > Completion listener > marks task completed on subagents:completed event | T3.4 | |
| 172 | test/subagent-integration.test.ts > Completion listener > reverts task to pending on subagents:failed event | T3.4 | |
| 173 | test/subagent-integration.test.ts > Completion listener > completes the task and keeps the partial result when the agent was stopped | T3.4 | |
| 174 | test/subagent-integration.test.ts > Completion listener > keeps an earlier result when a stopped agent reports none | T3.4 | |
| 175 | test/subagent-integration.test.ts > Completion listener > drops an earlier result when a retry fails | T3.4 | |
| 176 | test/subagent-integration.test.ts > Completion listener > ignores events for unknown agent IDs | T3.4 | |
| 177 | test/subagent-integration.test.ts > Auto-cascade > does NOT cascade when auto-cascade is off (default) | Dropped: D49, auto-cascade | |
| 178 | test/subagent-integration.test.ts > Auto-cascade > does NOT cascade on failure (branch stops) | Dropped: D49, auto-cascade | |
| 179 | test/subagent-integration.test.ts > Auto-cascade > tasks without agentType are not cascaded even if unblocked | Dropped: D49, auto-cascade | |
| 180 | test/subagent-integration.test.ts > Standalone operation (no subagents extension) > all core task tools are registered | T3.10 | |
| 181 | test/subagent-integration.test.ts > Standalone operation (no subagents extension) > TaskCreate works without subagents | T2.2 | |
| 182 | test/subagent-integration.test.ts > Standalone operation (no subagents extension) > TaskList works without subagents | T2.3 | |
| 183 | test/subagent-integration.test.ts > Standalone operation (no subagents extension) > TaskGet works without subagents | T2.4 | |
| 184 | test/subagent-integration.test.ts > Standalone operation (no subagents extension) > TaskUpdate works without subagents | T2.5 | |
| 185 | test/subagent-integration.test.ts > Standalone operation (no subagents extension) > TaskExecute gracefully refuses without subagents | Dropped: D49, protocol handshake (pi-subagents not loaded fallback) | |
| 186 | test/subagent-integration.test.ts > Standalone operation (no subagents extension) > subagents lifecycle events are silently ignored without mapped agents | T3.4 | |
| 187 | test/subagent-integration.test.ts > Standalone operation (no subagents extension) > task dependencies work without subagents | T2.4 | |
| 188 | test/subagent-integration.test.ts > RPC protocol correctness > ping uses scoped reply channel (not shared channel) | Dropped: D49, protocol handshake (ping) | |
| 189 | test/subagent-integration.test.ts > RPC protocol correctness > spawn reply cleans up listener and timer on success | Dropped: D46, pi-subagents bus | |
| 190 | test/subagent-integration.test.ts > RPC protocol correctness > spawn RPC rejects on timeout when no responder exists | Dropped: D46, pi-subagents bus | |
| 191 | test/subagent-integration.test.ts > RPC protocol correctness > ready broadcast sets subagentsAvailable even after init | Dropped: D49, protocol handshake (ready broadcast) | |
| 192 | test/subagent-integration.test.ts > RPC protocol correctness > spawn RPC rejects with error message from server | T3.2 | |
| 193 | test/subagent-integration.test.ts > RPC protocol correctness > stop RPC resolves on success | T3.6 | |
| 194 | test/subagent-integration.test.ts > RPC protocol correctness > stop RPC returns false on error (agent not found) without throwing | Dropped: D46, pi-subagents bus | |
| 195 | test/subagent-integration.test.ts > RPC protocol correctness > stop RPC returns false on timeout without throwing | Dropped: D46, pi-subagents bus | |
| 196 | test/subagent-integration.test.ts > Protocol version mismatch > matching version — no warning | Dropped: D49, protocol handshake (version warnings) | |
| 197 | test/subagent-integration.test.ts > Protocol version mismatch > old handler (no version) — warns about pi-subagents | Dropped: D49, protocol handshake (version warnings) | |
| 198 | test/subagent-integration.test.ts > Protocol version mismatch > handler ahead (v4) — warns about pi-tasks | Dropped: D49, protocol handshake (version warnings) | |
| 199 | test/subagent-integration.test.ts > Protocol version mismatch > handler behind (v2) — warns about pi-subagents | Dropped: D49, protocol handshake (version warnings) | |
| 200 | test/subagent-integration.test.ts > Protocol version mismatch > warning shown only once | Dropped: D49, protocol handshake (version warnings) | |
| 201 | test/subagent-integration.test.ts > Widget agent ID display > shows agent ID for active agent-backed tasks | T4.3 | |
| 202 | test/subagent-integration.test.ts > Widget agent ID display > shows agent ID for non-active in_progress agent-backed tasks | T4.3 | |
| 203 | test/subagent-integration.test.ts > Widget agent ID display > does not show agent ID for tasks without agentId | T4.3 | |
| 204 | test/subagent-integration.test.ts > Widget agent ID display > does not show agent ID for pending tasks | T4.3 | |
| 205 | test/subagent-integration.test.ts > Widget agent ID display > does not show agent ID for completed tasks | T4.3 | |
| 206 | test/subagent-integration.test.ts > Cascade data injection (buildTaskPrompt) > injects prerequisite result into cascaded agent prompt | T3.3 | |
| 207 | test/subagent-integration.test.ts > Cascade data injection (buildTaskPrompt) > truncates long prerequisite results at 4KB | T3.3 | |
| 208 | test/subagent-integration.test.ts > Cascade data injection (buildTaskPrompt) > handles dependencies with no stored result gracefully | T3.3 | |
| 209 | test/subagent-result-consumption.test.ts > TaskOutput result consumption > returns the agent's result to the blocking caller | T3.5 | |
| 210 | test/subagent-result-consumption.test.ts > TaskOutput result consumption > consumes the result, so no completion notification follows the answer | T3.5 | |
| 211 | test/subagent-result-consumption.test.ts > TaskOutput result consumption > consumes a result read after the fact, not only one waited for | T3.5 | |
| 212 | test/subagent-result-consumption.test.ts > TaskOutput result consumption > returns the failure and consumes it too | T3.5 | |
| 213 | test/subagent-result-consumption.test.ts > TaskOutput result consumption > leaves the notification alone while the agent is still running | T3.5 | |
| 214 | test/subagent-result-consumption.test.ts > TaskOutput result consumption > still hands over the result when pi-subagents predates the consume channel | Dropped: D46, pi-subagents bus (a pi-subagents without the consume channel) | |
| 215 | test/subagent-result-consumption.test.ts > TaskOutput result consumption > leaves the notification alone when the blocking wait times out | T3.5 | |
| 216 | test/subagents-e2e.test.ts > pi-tasks with the real pi-subagents > completes the protocol handshake and launches a subagent | T3.1 | |
| 217 | test/subagents-e2e.test.ts > pi-tasks with the real pi-subagents > closes the task with the subagent's result, which TaskOutput returns in the same turn | T3.5 | |
| 218 | test/subagents-e2e.test.ts > pi-tasks with the real pi-subagents > reverts the task to pending with the error when its subagent fails | T3.4 | |
| 219 | test/subagents-e2e.test.ts > pi-tasks with the real pi-subagents > stops a running subagent with TaskStop and keeps the task completed | T3.6 | |
| 220 | test/subagents-e2e.test.ts > pi-tasks with the real pi-subagents > auto-cascades into the dependent task, handing it the first task's result | Dropped: D49, auto-cascade | |
| 221 | test/subagents-e2e.test.ts > pi-tasks with the real pi-subagents > a subagent cut short by the session's end (%s) > /reload leaves the task pending in the reloaded session | Dropped: D47, one service per session (/reload no longer ends agents, T3.9) | |
| 222 | test/subagents-e2e.test.ts > pi-tasks with the real pi-subagents > a subagent cut short by the session's end (%s) > /fork leaves the task pending in the fork and in its parent | T3.8 | |
| 223 | test/subagents-e2e.test.ts > pi-tasks with the real pi-subagents > a subagent cut short by the session's end (%s) > /new leaves the task pending in the session it left | T3.8 | |
| 224 | test/subagents-e2e.test.ts > pi-tasks with the real pi-subagents > a subagent cut short by the session's end (%s) > quitting leaves the task pending in the session's file | T3.8 | |
| 225 | test/subagents-e2e.test.ts > pi-tasks with the real pi-subagents > a subagent cut short by the session's end (%s) > /%s carries a memory-scope task over as pending | T3.8 | |
| 226 | test/task-glyphs.test.ts > resolveTaskGlyphs > returns the built-in glyphs when nothing is configured | T4.3 | |
| 227 | test/task-glyphs.test.ts > resolveTaskGlyphs > returns the built-in glyphs for an empty glyph object | Dropped: D49, custom glyphs | |
| 228 | test/task-glyphs.test.ts > resolveTaskGlyphs > applies every configured glyph | Dropped: D49, custom glyphs | |
| 229 | test/task-glyphs.test.ts > resolveTaskGlyphs > keeps the default for glyphs that are not configured | Dropped: D49, custom glyphs | |
| 230 | test/task-glyphs.test.ts > resolveTaskGlyphs > falls back per glyph when a value is not a non-empty string | Dropped: D49, custom glyphs | |
| 231 | test/task-glyphs.test.ts > resolveTaskGlyphs > falls back per glyph for a control character or a bidi override | Dropped: D49, custom glyphs | |
| 232 | test/task-glyphs.test.ts > resolveTaskGlyphs > accepts a single space, which renders as spacing only | Dropped: D49, custom glyphs | |
| 233 | test/task-glyphs.test.ts > resolveTaskGlyphs > accepts glyphs that are more than one character | Dropped: D49, custom glyphs | |
| 234 | test/task-glyphs.test.ts > resolveTaskGlyphs > completedSummary > follows `completed` when only `completed` is set | Dropped: D49, custom glyphs | |
| 235 | test/task-glyphs.test.ts > resolveTaskGlyphs > completedSummary > wins over `completed` when set explicitly | Dropped: D49, custom glyphs | |
| 236 | test/task-glyphs.test.ts > resolveTaskGlyphs > completedSummary > falls back through `completed` to the default when both are unusable | Dropped: D49, custom glyphs | |
| 237 | test/task-glyphs.test.ts > resolveTaskGlyphs > spinner > accepts frames that are more than one glyph | Dropped: D49, custom glyphs | |
| 238 | test/task-glyphs.test.ts > resolveTaskGlyphs > spinner > falls back as a whole when the configured sequence is unusable | Dropped: D49, custom glyphs | |
| 239 | test/task-output-stop.test.ts > TaskOutput > returns the current status without waiting when block is false | T3.5 | |
| 240 | test/task-output-stop.test.ts > TaskOutput > resolves a blocking wait when the agent completes | T3.5 | |
| 241 | test/task-output-stop.test.ts > TaskOutput > resolves a blocking wait when the agent fails | T3.5 | |
| 242 | test/task-output-stop.test.ts > TaskOutput > gives up after the timeout when the agent never reports back | T3.5 | |
| 243 | test/task-output-stop.test.ts > TaskOutput > stops waiting when the tool call is aborted | T3.5 | |
| 244 | test/task-output-stop.test.ts > TaskOutput > does not wait for a task that is no longer in_progress | T3.5 | |
| 245 | test/task-output-stop.test.ts > TaskOutput > throws for an unknown ID | T3.5 | |
| 246 | test/task-output-stop.test.ts > TaskOutput > rejects an empty ID instead of matching an arbitrary agent | T3.5 | |
| 247 | test/task-output-stop.test.ts > TaskOutput > throws for a task with neither a process nor an agent | T3.5 | |
| 248 | test/task-output-stop.test.ts > TaskOutput — agent ID lookups > reports the resolved task, not a stale pre-wait snapshot | T3.5 | |
| 249 | test/task-output-stop.test.ts > TaskOutput — agent ID lookups > resolves an agent ID to its task when not blocking | T3.5 | |
| 250 | test/task-output-stop.test.ts > TaskOutput — agent ID lookups > resolves a unique agent ID prefix | T3.5 | |
| 251 | test/task-output-stop.test.ts > TaskStop > stops the agent and completes the task | T3.6 | |
| 252 | test/task-output-stop.test.ts > TaskStop > completes the task when stopped by agent ID | T3.6 | |
| 253 | test/task-output-stop.test.ts > TaskStop > completes the task when stopped by a unique agent ID prefix | T3.6 | |
| 254 | test/task-output-stop.test.ts > TaskStop > accepts the deprecated shell_id parameter | Dropped: D49, shell branches (shell_id) | |
| 255 | test/task-output-stop.test.ts > TaskStop > throws when neither task_id nor shell_id is given | T3.6 | |
| 256 | test/task-output-stop.test.ts > TaskStop > throws for a task with no running agent | T3.6 | |
| 257 | test/task-output-stop.test.ts > TaskStop > throws for an unknown ID | T3.6 | |
| 258 | test/task-output-stop.test.ts > TaskStop > does not re-stop an already completed agent task | T3.6 | |
| 259 | test/task-paths.test.ts > projectKey > names a workspace the way pi names it in its own session logs | Dropped: D49, scopes (session-global scope) | |
| 260 | test/task-paths.test.ts > projectKey > keeps different workspaces apart | Dropped: D49, scopes (session-global scope) | |
| 261 | test/task-paths.test.ts > projectKey > resolves a relative workspace against the process directory | Dropped: D49, scopes (session-global scope) | |
| 262 | test/task-paths.test.ts > sessionTaskFile under the default `session` scope > writes into the workspace, exactly where every release so far has | T2.6 | |
| 263 | test/task-paths.test.ts > sessionTaskFile under the default `session` scope > ignores the agent directory entirely | T2.6 | |
| 264 | test/task-paths.test.ts > sessionTaskFile under `session-global` > keeps a new session's tasks outside the workspace | Dropped: D49, scopes (session-global scope) | |
| 265 | test/task-paths.test.ts > sessionTaskFile under `session-global` > leaves a session that already has a workspace file where it is | Dropped: D49, scopes (session-global scope) | |
| 266 | test/task-paths.test.ts > sessionTaskFile under `session-global` > does not confuse one session's workspace file for another's | Dropped: D49, scopes (session-global scope) | |
| 267 | test/task-paths.test.ts > sessionTaskFile under `session-global` > follows a relocated agent directory | Dropped: D49, scopes (session-global scope) | |
| 268 | test/task-paths.test.ts > sessionTaskFile under `session-global` > keeps sessions in one workspace together | Dropped: D49, scopes (session-global scope) | |
| 269 | test/task-sort.test.ts > sortTasks presets > '%s' matches the original comparator | T1.15 | |
| 270 | test/task-sort.test.ts > sortTasks presets > 'status' keeps completed first with ids ascending inside each group | T1.15 | |
| 271 | test/task-sort.test.ts > sortTasks presets > 'active' puts in-progress first, then pending, then completed | T1.15 | |
| 272 | test/task-sort.test.ts > sortTasks presets > 'recent' breaks updatedAt ties by descending id | T1.15 | |
| 273 | test/task-sort.test.ts > sortTasks presets > defaults to id order | T1.15 | |
| 274 | test/task-sort.test.ts > sortTasks presets > returns a copy without mutating the input | T1.15 | |
| 275 | test/task-sort.test.ts > sortTasks custom specs > applies a custom status rank with an id tie-break | Dropped: D49, custom sort specs | |
| 276 | test/task-sort.test.ts > sortTasks custom specs > sorts statuses left out of the rank last, tied among themselves | Dropped: D49, custom sort specs | |
| 277 | test/task-sort.test.ts > sortTasks custom specs > reverses a single key with direction 'desc' | Dropped: D49, custom sort specs | |
| 278 | test/task-sort.test.ts > sortTasks custom specs > reverses the status rank when the status key is descending | Dropped: D49, custom sort specs | |
| 279 | test/task-sort.test.ts > sortTasks custom specs > falls through to later keys only on a tie | Dropped: D49, custom sort specs | |
| 280 | test/task-sort.test.ts > sortTasks custom specs > defaults an omitted rank to the 'status' preset order | Dropped: D49, custom sort specs | |
| 281 | test/task-sort.test.ts > sortTasks rejects malformed orders > falls back to id order for %s | Dropped: D49, custom sort specs | |
| 282 | test/task-sort.test.ts > sortTasks rejects malformed orders > rejects a spec if any key is invalid | Dropped: D49, custom sort specs | |
| 283 | test/task-store-concurrency.test.ts > TaskStore — shared file access > assigns distinct IDs when two sessions create tasks in turn | Dropped: D49, scopes (shared-file re-read) | |
| 284 | test/task-store-concurrency.test.ts > TaskStore — shared file access > does not lose the other session's writes when both mutate the same task | Dropped: D49, scopes (shared-file re-read) | |
| 285 | test/task-store-concurrency.test.ts > TaskStore — shared file access > sees another session's new tasks without being reconstructed | Dropped: D49, scopes (shared-file re-read) | |
| 286 | test/task-store-concurrency.test.ts > TaskStore — shared file access > sees another session's deletions | Dropped: D49, scopes (shared-file re-read) | |
| 287 | test/task-store-concurrency.test.ts > TaskStore — shared file access > reclaims a lock left behind by a dead process | Dropped: D49, scopes (cross-process lock) | |
| 288 | test/task-store-concurrency.test.ts > TaskStore — shared file access > reclaims a lock file that never got a PID written to it | Dropped: D49, scopes (cross-process lock) | |
| 289 | test/task-store-concurrency.test.ts > TaskStore — shared file access > reclaims a lock file holding garbage | Dropped: D49, scopes (cross-process lock) | |
| 290 | test/task-store-concurrency.test.ts > TaskStore — shared file access > still reads the PID out of a lock written in the pid:token format | Dropped: D49, scopes (cross-process lock) | |
| 291 | test/task-store-concurrency.test.ts > TaskStore — shared file access > does not delete a lock that a successor now holds | Dropped: D49, scopes (cross-process lock) | |
| 292 | test/task-store-concurrency.test.ts > TaskStore — shared file access > removes its own lock even after reclaiming a stale one | Dropped: D49, scopes (cross-process lock) | |
| 293 | test/task-store-concurrency.test.ts > TaskStore — shared file access > leaves no lock or temp file behind after a mutation | Dropped: D49, scopes (cross-process lock) | |
| 294 | test/task-store-concurrency.test.ts > TaskStore — snapshot and seed > snapshots the latest state written by another session | Dropped: D49, scopes (shared-file re-read) | |
| 295 | test/task-store-concurrency.test.ts > TaskStore — snapshot and seed > seeds an empty store and carries the ID counter over | T1.12 | |
| 296 | test/task-store-concurrency.test.ts > TaskStore — snapshot and seed > is a no-op on a store that already has tasks, so re-seeding never duplicates | T1.12 | |
| 297 | test/task-store-concurrency.test.ts > TaskStore — snapshot and seed > does not write the parent's file when the seeded copy is mutated | T1.12 | |
| 298 | test/task-store.test.ts > TaskStore (in-memory) > creates tasks with auto-incrementing IDs | T1.1 | |
| 299 | test/task-store.test.ts > TaskStore (in-memory) > creates tasks with optional fields | T1.1 | |
| 300 | test/task-store.test.ts > TaskStore (in-memory) > gets a task by ID | T1.2 | |
| 301 | test/task-store.test.ts > TaskStore (in-memory) > returns undefined for non-existent task | T1.2 | |
| 302 | test/task-store.test.ts > TaskStore (in-memory) > lists all tasks sorted by ID | T1.2 | |
| 303 | test/task-store.test.ts > TaskStore (in-memory) > lists tasks sorted by status when sortOrder is 'status' | T1.15 | |
| 304 | test/task-store.test.ts > TaskStore (in-memory) > lists tasks sorted by most recently updated when sortOrder is 'recent' | T1.15 | |
| 305 | test/task-store.test.ts > TaskStore (in-memory) > lists tasks sorted by least recently updated when sortOrder is 'oldest' | T1.15 | |
| 306 | test/task-store.test.ts > TaskStore (in-memory) > updates task status | T1.3 | |
| 307 | test/task-store.test.ts > TaskStore (in-memory) > updates multiple fields at once | T1.3 | |
| 308 | test/task-store.test.ts > TaskStore (in-memory) > deletes a task with status: deleted | T1.6 | |
| 309 | test/task-store.test.ts > TaskStore (in-memory) > preserves ID counter after deletion | T1.1 | |
| 310 | test/task-store.test.ts > TaskStore (in-memory) > merges metadata with null key deletion | T1.4 | |
| 311 | test/task-store.test.ts > TaskStore (in-memory) > sets up bidirectional blocks via addBlocks | T1.5 | |
| 312 | test/task-store.test.ts > TaskStore (in-memory) > sets up bidirectional blocks via addBlockedBy | T1.5 | |
| 313 | test/task-store.test.ts > TaskStore (in-memory) > does not duplicate dependency edges | T1.5 | |
| 314 | test/task-store.test.ts > TaskStore (in-memory) > cleans up dependency edges on deletion | T1.6 | |
| 315 | test/task-store.test.ts > TaskStore (in-memory) > clears completed tasks | T1.6 | |
| 316 | test/task-store.test.ts > TaskStore (in-memory) > returns not found for update on non-existent task | T1.3 | |
| 317 | test/task-store.test.ts > TaskStore (in-memory) > delete method works | T1.6 | |
| 318 | test/task-store.test.ts > TaskStore (in-memory) > creates tasks with metadata via TaskCreate | T1.1 | |
| 319 | test/task-store.test.ts > TaskStore (in-memory) > allows circular dependencies with warning | T1.5 | |
| 320 | test/task-store.test.ts > TaskStore (in-memory) > allows self-dependency with warning | T1.5 | |
| 321 | test/task-store.test.ts > TaskStore (in-memory) > stores dangling edge IDs with warning | T1.5 | |
| 322 | test/task-store.test.ts > TaskStore (in-memory) > returns no warnings for valid dependencies | T1.5 | |
| 323 | test/task-store.test.ts > TaskStore (in-memory) > accepts whitespace-only subjects (matches Claude Code) | T1.1 | |
| 324 | test/task-store.test.ts > TaskStore (in-memory) > updates activeForm field | T1.3 | |
| 325 | test/task-store.test.ts > TaskStore (in-memory) > updates description field | T1.3 | |
| 326 | test/task-store.test.ts > TaskStore (in-memory) > returns empty changedFields when updating non-existent task | T1.3 | |
| 327 | test/task-store.test.ts > TaskStore (in-memory) > clearCompleted cleans up dependency edges | T1.6 | |
| 328 | test/task-store.test.ts > TaskStore (in-memory) > handles multiple addBlocks in one call | T1.5 | |
| 329 | test/task-store.test.ts > TaskStore (in-memory) > addBlockedBy warns on self-dependency | T1.5 | |
| 330 | test/task-store.test.ts > TaskStore (in-memory) > addBlockedBy warns on dangling ref | T1.5 | |
| 331 | test/task-store.test.ts > TaskStore (in-memory) > addBlockedBy warns on cycle | T1.5 | |
| 332 | test/task-store.test.ts > TaskStore (in-memory) > clearCompleted returns 0 when no completed tasks | T1.6 | |
| 333 | test/task-store.test.ts > TaskStore (in-memory) > list sorts pending → in_progress → completed with all three present | T2.3 | |
| 334 | test/task-store.test.ts > TaskStore (file-backed) > persists tasks to disk | T1.7 | |
| 335 | test/task-store.test.ts > TaskStore (file-backed) > persists in_progress updates to disk | T1.7 | |
| 336 | test/task-store.test.ts > TaskStore (file-backed) > persists completed tasks to disk | T1.7 | |
| 337 | test/task-store.test.ts > TaskStore (file-backed) > restores all tasks across instances | T1.7 | |
| 338 | test/task-store.test.ts > TaskStore (file-backed) > persists ID counter across instances | T1.7 | |
| 339 | test/task-store.test.ts > TaskStore (absolute path) > accepts absolute path and persists tasks | T1.7 | |
| 340 | test/task-store.test.ts > TaskStore (absolute path) > persists completed tasks when using absolute path | T1.7 | |
| 341 | test/task-store.test.ts > TaskStore (absolute path) > recreates the parent directory before later mutations | Dropped: D53, a file another process deleted counts as a change | |
| 342 | test/task-store.test.ts > TaskStore (absolute path) > normalizes legacy task records missing blockedBy/blocks/metadata on load | T1.8 | |
| 343 | test/task-store.test.ts > TaskStore (absolute path) > creates the backing directory lazily — not on construction, but on first write | T1.7 | |
| 344 | test/task-store.test.ts > TaskStore (list ID resolution) > resolves a bare list ID under the user's home directory, not the working directory | Dropped: D49, scopes (PI_TASKS list name) | |
| 345 | test/task-store.test.ts > TaskStore (malformed files) > continues IDs after the highest existing task when nextId is missing | T1.8 | |
| 346 | test/task-store.test.ts > TaskStore (malformed files) > starts from 1 when nextId is missing and there are no tasks | T1.8 | |
| 347 | test/task-store.test.ts > TaskStore (malformed files) > does not reissue an ID that a task already holds | T1.8 | |
| 348 | test/task-store.test.ts > TaskStore (malformed files) > keeps the tasks it has when the file has no task array | Dropped: D49, scopes (shared-file re-read) | |
| 349 | test/task-store.test.ts > TaskStore (malformed files) > keeps the tasks it has when the file is not valid JSON | Dropped: D49, scopes (shared-file re-read) | |
| 350 | test/task-store.test.ts > TaskStore (malformed files) > keeps the tasks it has when the file holds a JSON array | Dropped: D49, scopes (shared-file re-read) | |
| 351 | test/task-store.test.ts > TaskStore (malformed files) > skips entries that are not task records | T1.8 | |
| 352 | test/task-store.test.ts > TaskStore (malformed files) > respects a valid nextId | T1.8 | |
| 353 | test/task-widget-lifecycle.test.ts > TaskWidget.dispose > stops the timer and leaves nothing that can reach the UI | T4.5 | |
| 354 | test/task-widget-lifecycle.test.ts > TaskWidget.dispose > draws again once a UI is handed back | T4.9 | |
| 355 | test/task-widget-lifecycle.test.ts > TaskWidget.dispose > swallows a UI that fails while the widget is cleared | T4.5 | |
| 356 | test/task-widget-lifecycle.test.ts > TaskWidget timer > starts no timer without a UI | T4.1 | |
| 357 | test/task-widget-lifecycle.test.ts > TaskWidget timer > stops the spinner instead of letting a failed redraw escape the tick | T4.5 | |
| 358 | test/task-widget-lifecycle.test.ts > TaskWidget.update > never throws, and retries on the next update | T4.5 | |
| 359 | test/task-widget.test.ts > TaskWidget > shows nothing when no tasks exist | T4.5 | |
| 360 | test/task-widget.test.ts > TaskWidget > renders pending tasks with ◻ icon | T4.3 | |
| 361 | test/task-widget.test.ts > TaskWidget > renders in-progress tasks with ◼ icon | T4.3 | |
| 362 | test/task-widget.test.ts > TaskWidget > renders completed tasks with ✔ icon and strikethrough | T4.3 | |
| 363 | test/task-widget.test.ts > TaskWidget > renders active tasks with spinner icon | T4.3 | |
| 364 | test/task-widget.test.ts > TaskWidget > shows blocked-by info for pending tasks | T4.3 | |
| 365 | test/task-widget.test.ts > TaskWidget > hides completed blockers in blocked-by suffix | T4.3 | |
| 366 | test/task-widget.test.ts > TaskWidget > does not crash the host when a task is missing legacy fields | T4.5 | |
| 367 | test/task-widget.test.ts > TaskWidget > shows status summary in header | T4.3 | |
| 368 | test/task-widget.test.ts > TaskWidget > clears widget when all tasks are deleted | T4.5 | |
| 369 | test/task-widget.test.ts > TaskWidget > limits visible tasks to MAX_VISIBLE_TASKS | T4.4 | |
| 370 | test/task-widget.test.ts > TaskWidget > respects maxVisible config | T4.4 | |
| 371 | test/task-widget.test.ts > TaskWidget > shows all tasks when limit exceeds task count | T4.4 | |
| 372 | test/task-widget.test.ts > TaskWidget > shows all tasks when showAll is true even with maxVisible set | T4.4 | |
| 373 | test/task-widget.test.ts > TaskWidget > truncates from top when hiddenAt is 'top' | T4.4 | |
| 374 | test/task-widget.test.ts > TaskWidget > truncates from bottom when hiddenAt holds an unrecognised value | T1.13 | |
| 375 | test/task-widget.test.ts > TaskWidget > truncates from bottom by default | T4.4 | |
| 376 | test/task-widget.test.ts > TaskWidget > collapseCompleted > replaces completed tasks with a single count line | T4.4 | |
| 377 | test/task-widget.test.ts > TaskWidget > collapseCompleted > leaves the header counts untouched | T4.4 | |
| 378 | test/task-widget.test.ts > TaskWidget > collapseCompleted > applies the visible limit to the remaining tasks only | T4.4 | |
| 379 | test/task-widget.test.ts > TaskWidget > collapseCompleted > emits no count line when nothing is completed | T4.4 | |
| 380 | test/task-widget.test.ts > TaskWidget > collapseCompleted > stays visible as header plus count line when everything is completed | T4.4 | |
| 381 | test/task-widget.test.ts > TaskWidget > collapseCompleted > lists completed tasks individually when off | T4.4 | |
| 382 | test/task-widget.test.ts > TaskWidget > sorts tasks by status when sortOrder is 'status' | T4.4 | |
| 383 | test/task-widget.test.ts > TaskWidget > sorts active work first when sortOrder is 'active' | T4.4 | |
| 384 | test/task-widget.test.ts > TaskWidget > honours a custom sort spec from config | Dropped: D49, custom sort specs | |
| 385 | test/task-widget.test.ts > TaskWidget > defaults to ID order when sortOrder is unset | T4.4 | |
| 386 | test/task-widget.test.ts > TaskWidget > keeps ID order when sortOrder is 'id' | T4.4 | |
| 387 | test/task-widget.test.ts > TaskWidget > tracks token usage for active tasks | T3.11 | |
| 388 | test/task-widget.test.ts > TaskWidget > deactivates a task with setActiveTask(id, false) | T4.3 | |
| 389 | test/task-widget.test.ts > TaskWidget > prunes stale active IDs on update | T4.3 | |
| 390 | test/task-widget.test.ts > TaskWidget > supports multiple active tasks simultaneously | T4.3 | |
| 391 | test/task-widget.test.ts > TaskWidget > distributes token usage across all active tasks | T3.11 | |
| 392 | test/task-widget.test.ts > TaskWidget > dispose clears widget and timer | T4.5 | |
| 393 | test/task-widget.test.ts > TaskWidget > uses subject as fallback when no activeForm | T4.3 | |
| 394 | test/task-widget.test.ts > TaskWidget > shows elapsed time but no token arrows when tokens are zero | T4.3 | |
| 395 | test/task-widget.test.ts > TaskWidget > cleans up metrics when stale active IDs are pruned | T3.11 | |
| 396 | test/task-widget.test.ts > TaskWidget > indents task lines under header | T4.3 | |
| 397 | test/task-widget.test.ts > TaskWidget > widget is placed aboveEditor | T4.1 | |
| 398 | test/task-widget.test.ts > formatDuration (via widget rendering) > shows seconds for short durations | T4.3 | |
| 399 | test/task-widget.test.ts > formatDuration (via widget rendering) > shows hours for long durations | T4.3 | |
| 400 | test/task-widget.test.ts > formatDuration (via widget rendering) > shows exact hours without minutes | T4.3 | |
| 401 | test/task-widget.test.ts > formatDuration (via widget rendering) > shows minutes and seconds | T4.3 | |
| 402 | test/task-widget.test.ts > formatDuration (via widget rendering) > formats small token counts without k suffix | T4.3 | |
| 403 | test/task-widget.test.ts > formatDuration (via widget rendering) > formats token counts with k suffix and removes .0 | T4.3 | |
| 404 | test/task-widget.test.ts > configurable glyphs > renders the default glyphs when none are configured | T4.3 | |
| 405 | test/task-widget.test.ts > configurable glyphs > renders configured status glyphs | Dropped: D49, custom glyphs | |
| 406 | test/task-widget.test.ts > configurable glyphs > renders a configured header glyph | Dropped: D49, custom glyphs | |
| 407 | test/task-widget.test.ts > configurable glyphs > follows the completed glyph on the collapsed count line | Dropped: D49, custom glyphs | |
| 408 | test/task-widget.test.ts > configurable glyphs > prefers an explicit completedSummary on the collapsed count line | Dropped: D49, custom glyphs | |
| 409 | test/task-widget.test.ts > configurable glyphs > cycles the configured spinner frames on the active task | Dropped: D49, custom glyphs | |
| 410 | test/task-widget.test.ts > configurable glyphs > renders a multi-glyph spinner frame whole | Dropped: D49, custom glyphs | |
| 411 | test/task-widget.test.ts > configurable glyphs > renders a configured overflow glyph | Dropped: D49, custom glyphs | |
| 412 | test/task-widget.test.ts > configurable glyphs > renders a configured blocked glyph | Dropped: D49, custom glyphs | |
| 413 | test/task-widget.test.ts > configurable glyphs > renders configured token, separator and trailing glyphs on the active row | Dropped: D49, custom glyphs | |
| 414 | test/task-widget.test.ts > configurable glyphs > clips over-wide lines with the configured truncation glyph | Dropped: D49, custom glyphs | |
| 415 | test/task-widget.test.ts > configurable glyphs > clips with three ASCII dots by default | T4.3 | |
| 416 | test/task-widget.test.ts > configurable glyphs > falls back to the defaults for unusable glyph values | Dropped: D49, custom glyphs | |
| 417 | test/task-widget.test.ts > configurable glyphs > never lets a glyph carry a control character into a rendered line | Dropped: D49, custom glyphs | |
| 418 | test/task-widget.test.ts > spinner animation timing > advances one frame per timer tick | T4.5 | |
| 419 | test/task-widget.test.ts > spinner animation timing > does not advance when task activity redraws the widget | T4.5 | |
| 420 | test/task-widget.test.ts > spinner animation timing > still animates after an unrelated redraw | T4.5 | |
| 421 | test/tasks-command.test.ts > /tasks main menu > offers only view and create when the list is empty | T4.7 | |
| 422 | test/tasks-command.test.ts > /tasks main menu > offers the clear actions with their counts once tasks exist | T4.7 | |
| 423 | test/tasks-command.test.ts > /tasks main menu > opens the settings panel and returns to the main menu afterwards | T4.8 | |
| 424 | test/tasks-command.test.ts > /tasks task detail > starts a pending task | T4.7 | |
| 425 | test/tasks-command.test.ts > /tasks task detail > completes an in-progress task | T4.7 | |
| 426 | test/tasks-command.test.ts > /tasks task detail > deletes a task | T4.7 | |
| 427 | test/tasks-command.test.ts > /tasks task detail > offers Complete only for in-progress tasks | T4.7 | |
| 428 | test/tasks-command.test.ts > /tasks task detail > acts on the task whose row was picked, not on an ID inside its subject | T4.7 | |
| 429 | test/tasks-command.test.ts > /tasks task detail > acts on the picked row even when the status glyph contains an ID | Dropped: D49, custom glyphs | |
| 430 | test/tasks-command.test.ts > /tasks task detail > lists tasks with the default status glyphs | T4.7 | |
| 431 | test/tasks-command.test.ts > /tasks task detail > lists tasks with the configured status glyphs | Dropped: D49, custom glyphs | |
| 432 | test/tasks-command.test.ts > /tasks task detail > shows a placeholder screen when there is nothing to view | T4.7 | |
| 433 | test/tasks-command.test.ts > /tasks clearing > clears only completed tasks | T4.7 | |
| 434 | test/tasks-command.test.ts > /tasks clearing > clears every task and removes the now-empty session file | T4.7 | |
| 435 | test/tasks-command.test.ts > /tasks clearing > keeps the file when clearing completed leaves work behind | T1.12 | |
| 436 | test/tasks-command.test.ts > /tasks create > creates a task from the subject and description prompts | T4.7 | |
| 437 | test/tasks-command.test.ts > /tasks create > creates nothing when the subject prompt is cancelled | T4.7 | |
| 438 | test/tasks-command.test.ts > /tasks create > creates nothing when the description prompt is cancelled | T4.7 | |
| 439 | test/tasks-config.test.ts > tasks config > returns an empty config when no files exist | T1.13 | |
| 440 | test/tasks-config.test.ts > tasks config > loads global defaults from the agent directory | T1.13 | |
| 441 | test/tasks-config.test.ts > tasks config > merges project overrides over global defaults | T1.13 | |
| 442 | test/tasks-config.test.ts > tasks config > ignores a malformed global config | Dropped: D48, tasks-config.json (malformed file) | |
| 443 | test/tasks-config.test.ts > tasks config > falls back to global defaults when the project config is malformed | Dropped: D48, tasks-config.json (malformed file) | |
| 444 | test/tasks-config.test.ts > tasks config > ignores non-object config values | T1.13 | |
| 445 | test/tasks-config.test.ts > tasks config > saves project settings when no global defaults exist | T1.14 | |
| 446 | test/tasks-config.test.ts > tasks config > saves only values that differ from global defaults | Dropped: D48, a changed value stays in the project file even when it equals the global one | |
| 447 | test/tasks-config.test.ts > tasks config > preserves a project override across save and reload cycles | T1.14 | |
| 448 | test/tasks-config.test.ts > tasks config > round-trips a custom sortOrder spec | Dropped: D49, custom sort specs | |
| 449 | test/tasks-config.test.ts > tasks config > does not copy a global sortOrder spec into the project override | Dropped: D49, custom sort specs | |
| 450 | test/tasks-config.test.ts > tasks config > writes a sortOrder spec that differs from the global default | Dropped: D49, custom sort specs | |
| 451 | test/tasks-config.test.ts > tasks config > writes an empty project override object when effective settings match global defaults | Dropped: D48, tasks-config.json (empty project override file) | |
| 452 | test/tasks-config.test.ts > tasks config > merges glyphs one by one rather than replacing the whole set | Dropped: D49, custom glyphs | |
| 453 | test/tasks-config.test.ts > tasks config > leaves glyphs absent when neither config sets any | Dropped: D49, custom glyphs | |
| 454 | test/tasks-config.test.ts > tasks config > does not copy global glyphs into the project override | Dropped: D49, custom glyphs | |
| 455 | test/tasks-config.test.ts > tasks config > writes only the glyphs that differ from the global ones | Dropped: D49, custom glyphs | |
| 456 | test/tasks-config.test.ts > tasks config > preserves a project glyph override across save and reload cycles | Dropped: D49, custom glyphs | |

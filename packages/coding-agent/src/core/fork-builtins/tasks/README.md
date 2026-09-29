# tasks (fork-owned service, base tools and presentation)

This module keeps a task list per session natively in Pi. Each `AgentSession` owns one headless task service. Seven base tools call that service, and `TaskExecute` runs tasks as subagents through the subagent service's typed API. One presentation factory, `<inline:tasks>`, shows the widget, offers `/tasks` and adds the task reminder. The fork rebuilt the feature from pi-tasks (`github.com/tintinweb/pi-tasks`, commit `83480bd`) and takes no upstream sync (D46). Rulings D46 to D53 in the session-control handoff govern it. `docs/plans/subagents-native-phase4.plan.md` records the port.

## Layout

| Path | Content |
| --- | --- |
| `names.ts` | The seven tool names. |
| `store.ts` | `TaskStore`: one list, its file, the memory fallback, the symlink refusal and the conflict check. |
| `settings.ts` | `forkBuiltins.tasks` settings and the project settings writer. |
| `sort.ts` | The widget's five sort orders. |
| `reminder.ts` | The reminder cadence and the reminder text. |
| `auto-clear.ts` | Turn-based clearing of completed tasks. |
| `service/` | `TaskService`, the per-session registry and the fork handoff. |
| `tools/` | The seven base tools and Claude Code's tool descriptions. |
| `ui/` | The presentation factory: the widget, `/tasks` with its settings list, and the `context` hook. |

Imports point down only: the module root, then `service/`, then `tools/`, and `ui/` last. The subagents module never imports this module, and `service/` imports no presentation code. `test/fork-builtins/tasks/layering.test.ts` checks the layers and the absence of import cycles. `../settings-section.ts` holds the value checks, the section lookup and the project writer both built-ins use.

## Wiring

The wiring follows D47, as the subagents module's follows D18:

- `../base-tools.ts` registers the seven tools next to the subagent tools, and registers the session for its task service.
- Registration reads nothing from the session. `taskServiceFor(session)` builds the service on first use: the first task tool call, or the presentation's top-level `session_start`.
- The service survives `/reload`. The session's resource cleanup disposes it when the session ends.
- `agent-session.ts` gains no line.
- `PI_FORK_BUILTINS=off` registers no task tool and no session, so no service exists.

## The service

`TaskService` holds one session's list in a `TaskStore` and follows the session's own events.

| Topic | Behavior |
| --- | --- |
| File | Under `taskScope: session`, a session Pi saves keeps its list in `<cwd>/.pi/tasks/tasks-<sessionId>.json`, in pi-tasks' format. An existing file resumes unchanged. |
| Memory | Under `taskScope: memory`, or for a session Pi does not save (`--no-session`), the list lives in memory. A changed `taskScope` takes effect at the next session. |
| Events | Turns tick the reminder cadence and the auto-clear countdowns. A settled run marks the end of a batch. |
| Session start | The presentation reports each `session_start`. Startup and `/new` clear a list whose tasks all completed, and delete its empty file. Resume, fork and `/reload` keep the list. |
| Fork | A disposed service leaves its list for a fork. A saved session's entry is keyed by its file, which the fork's `session_start` names; at most 16 are kept. An unsaved session's entry is keyed by its session manager, which its fork reuses. |
| `/reload` | The service rereads its settings and retries a failed write through `retryWrite` (D50). |
| Warnings | Each distinct warning goes out once. Warnings sent before any listener subscribed go to the first listener. |
| End | The session's end sends every task whose agent still runs back to pending with `The session ended before the agent finished.` (D21). |

## The tools

| Tool | Parameters | Behavior |
| --- | --- | --- |
| `TaskCreate` | `subject`, `description`, `activeForm`, `agentType`, `metadata` | Creates a pending task; `agentType` lands in `metadata.agentType`. |
| `TaskList` | none | Lists pending, then in-progress, then completed tasks, with owners and open blockers. |
| `TaskGet` | `taskId` | Shows one task's fields, open blockers, the tasks it blocks and its metadata. |
| `TaskUpdate` | `taskId`, `status`, `subject`, `description`, `activeForm`, `owner`, `metadata`, `addBlocks`, `addBlockedBy` | Changes a task; `deleted` removes it with every edge that points at it. |
| `TaskExecute` | `task_ids`, `additional_context`, `model`, `thinking`, `max_turns` | Starts one agent per ready task. |
| `TaskOutput` | `task_id`, `block`, `timeout` | Reports a task's agent outcome, and waits for it with `block`. |
| `TaskStop` | `task_id` | Stops a task's running agent and completes the task. |

The descriptions and prompt guidelines are Claude Code's, verbatim from pi-tasks. The service's own answers use a colon where pi-tasks used an em dash (`Task #1 [completed]: subagent <id>`).

`TaskExecute` spawns through the typed subagent API (D19):

- A task is ready when it is pending, has an `agentType` and has no open blocker. Every other task is skipped with its reason.
- The spawn is `detached-background`: it takes a background slot and notifies the session when nobody read its result.
- It goes through `subagentScope(session)`: the session's own subagent service, or in a child the nested runtime of the agent the child runs as.
- The agent's prompt holds the task, each completed prerequisite's result cut at 4,000 characters, and `additional_context`.
- The task records the agent id as its owner and as `metadata.agentId`.

An agent's end updates its task:

| Agent status | Task |
| --- | --- |
| `completed`, `steered` | Completed, with the agent's result. |
| `stopped` | Completed; keeps the partial result, or an earlier one. |
| `error`, `aborted` | Pending; the result is removed and `lastError` holds the error. |

`TaskOutput` and `TaskStop` find a task by its id, by its agent's id or by an id prefix. An agent that already ended is found through the task that records it. `TaskOutput` consumes a result only once the task holds it. `TaskStop` stops only an agent this service started for that task.

## Settings

Settings live under `forkBuiltins.tasks` in Pi's global and project `settings.json` (D48). The project value wins and applies only in a trusted project. The reader drops a value of the wrong type, out of range or under an unknown key, with one warning each. `writeProjectTaskSettings` replaces only the `forkBuiltins.tasks` object of the project file. It refuses a value the reader would drop and a symlinked `.pi` or `settings.json`. A failed write leaves the file byte-identical.

| Key | Default | Meaning |
| --- | --- | --- |
| `taskScope` | `session` | `session` saves a file per session in the workspace; `memory` saves nothing. |
| `autoClearCompleted` | `on_list_complete` | `never`, `on_list_complete` or `on_task_complete`. |
| `collapseCompleted` | false | The widget shows one `N completed` line instead of the completed rows. |
| `showAll` | false | The widget shows every row, whatever `maxVisible` says. |
| `maxVisible` | 10 | The widget's row limit (1 to 1000). |
| `sortOrder` | `id` | `id`, `status`, `active`, `recent` or `oldest`. |
| `hiddenAt` | `bottom` | Which end of the list the widget hides past `maxVisible`. |

## Files and their failures

The store reads its file once and writes it after every change through `writeFileAtomically`, so a failed write never truncates the file. It takes no lock. Each case below moves the session's list to memory with one warning, `Tasks are not saved: <reason>. The list stays in memory for this session.`:

| Case | Ruling | What happens |
| --- | --- | --- |
| A write fails | D50 | The file keeps its last content. `/reload` calls `retryWrite`, which saves the list there again once the write succeeds. |
| A path check cannot run | D50 | The same as a failed write, `retryWrite` included. |
| The file cannot be read, is not JSON or holds no `tasks` array | D50 | Nothing ever writes it, `retryWrite` included. A new session and a resume open it again. |
| A path component below the project root is a symlink, the file included | D52 | Nothing is read, written or deleted through the link. The project root itself may be a link. |
| Another process changed or deleted the file since the store last read or wrote it | D53 | The file stays as the other process left it; a deleted file is not recreated. |

## The reminder

After 4 turns without a task tool call, or 2 while a task is in progress, a reminder is due. It becomes due only when a tool other than a task tool ran and the list holds tasks. A text-only turn marks it due too while a task is in progress. The presentation's `context` hook appends it to the next model request as one user message, which no session keeps. The service gives a reminder only while `TaskCreate` is active. The text is Claude Code's: a nudge for an empty list, or the list itself with at most 10 tasks, unfinished ones first.

## Auto-clear

| Mode | Behavior |
| --- | --- |
| `on_list_complete` | The whole list leaves 4 turns after its last task completed; a task going back to work cancels the countdown. |
| `on_task_complete` | Each completed task leaves 4 turns after it completed; a reverted or deleted task is forgotten. |
| `never` | Nothing leaves on its own. |

The countdowns tick at a turn's start, so they stop with the agent. A finished list therefore leaves at once when a later run creates a task. A list that auto-clear, a deletion or a clear empties deletes its file and leaves `.pi/tasks/` in place.

## Presentation

`ui/index.ts` is the presentation factory, the third inline factory in `FORK_OWNED_BUILTINS` (`<inline:tasks>`, D47). It finds its session over the loader's event bus, as the subagents presentation does.

| Mode | Surfaces |
| --- | --- |
| `tui` | The `tasks` widget above the editor, `/tasks` with its settings list, and warnings as notifications. |
| `rpc` | The widget as plain lines, one snapshot per change; `/tasks` without the settings list; warnings as notifications. |
| `print`, `json` | None; the reminder still reaches the model. |

- The widget counts the tasks by status and shows one row per task: `✔` struck through, `◼` or `◻`, the id and the subject. A pending row names its open blockers.
- A task the session or an agent works on shows a spinner, its active form, its agent, its elapsed time and its tokens. An agent task shows the agent's own usage.
- Rows are clipped to the terminal width with `...`. Task text passes through `displayText`, so an escape sequence the model copied from a file never reaches the terminal.
- No UI failure escapes the widget. A failed registration is tried again at the next change.
- `/tasks` views, starts, completes, deletes, creates and clears tasks through `select` and `input` dialogs.
- The settings list shows the seven settings. A change writes the project's own values plus that key, never a global value, then reloads the settings. An untrusted project shows the values read-only.
- `session_shutdown` removes the widget. `/reload` loads the factory again, which rebinds the widget to the same service and list.

## Children

A task tool is active in a child session only when the agent's `tools:` names it (D22). A child's service starts with its first task tool call. A child's `TaskExecute` spawns through the nested runtime of the agent it runs as, so `allowed_subagents`, `isolated` and `maxSubagentDepth` apply. The factory registers only the `context` hook in a child, so a child whose service exists gets the reminder too.

## What D49 dropped

- The shell branches of `TaskOutput` and `TaskStop`, with `shell_id`; `shell_id` alone fails schema validation.
- The protocol handshake with pi-subagents.
- The `session-global` and `project` scopes, and `PI_TASKS`.
- The cross-process file lock; D53's conflict check replaces it.
- Custom sort specs and custom glyphs.
- Auto-cascade and `PI_TASKS_DEBUG`.
- `tasks-config.json`; D48's `forkBuiltins.tasks` replaces it.

## Known limitations

- A task left `in_progress` by an agent of an ended pi-tasks session stays so until the model or `/tasks` changes it.
- A custom `ResourceLoader`, or an `extensionsOverride` that drops `<inline:tasks>`, removes the widget, `/tasks` and the reminders. The tools still work.
- D53 compares the file before each write, then renames. Two processes that write within the same instant can still pass the comparison, and the later rename wins.
- The service's cleanup matches its session by id, as the subagent service's does. Two live sessions that share one session id would dispose each other's services.
- In RPC mode the widget sends one snapshot per change, so a running task's elapsed time and tokens do not tick between changes.

# subagents (fork-owned service, base tools and presentation)

This module runs subagents natively in Pi. Each `AgentSession` owns one headless subagent service. The base tools `Agent`, `get_subagent_result` and `steer_subagent` call that service. Skill-fork and the task service (`../tasks/`) are typed consumers of its API (D19). A bus adapter keeps pi-subagents' `subagents:*` events and RPC channels for third-party extensions. The fork rebuilt the feature from pi-subagents (`github.com/tintinweb/pi-subagents`, commit `79a7c42`) and takes no upstream sync. Rulings D16 to D53 in the session-control handoff govern it. The phase 1 to 4 plans (`docs/plans/subagents-native-phase<n>.plan.md`) record the port.

## Layout

| Directory | Content |
| --- | --- |
| `definitions/` | Agent files, the three default agents, skill-bundled agents and type resolution |
| `settings/` | `forkBuiltins.subagents` settings, the project settings writer, model resolution and the invocation merge |
| `runner/` | Child sessions: tool scoping, prompts, memory, transcripts, turn limits, lineage, worktrees and teardown |
| `service/` | `SubagentService`: records, pools, notifications, usage, the nested runtime, the mention grammar, mention resolution and reopening |
| `tools/` | The three base tools, the `Agent` tool description and the mention clone |
| `adapter/` | The `subagents:*` bus adapter and the skill-agent rewrite maps |
| `ui/` | The presentation factory: status line, widget, FleetView, conversation viewer, `/agents` with the create wizard and the settings menu, the `Agent` tool rows, the notification renderer, and the mention hook and `@` popup |

The module root holds leaves every layer may import: `binding.ts`, `names.ts`, `usage.ts` and `atomic-write.ts`. Imports point down only: the root, `definitions/` and `settings/`, then `runner/`, `service/`, `tools/` and `adapter/`, and `ui/` last. `test/fork-builtins/subagents/layering.test.ts` checks the layers and the absence of import cycles (F14).

## Wiring

`../base-tools.ts` registers the three tools next to `ask_user_question` and `vcc_recall`. `../base-tools.ts` also stores the session's per-session record. The record holds the agent directory, the event bus, and the bus's lineage when the session is itself a child. Registration reads nothing from the session. `subagentServiceFor(session)` builds the service from that record on first use: the first subagent tool call, RPC request or skill-fork spawn. In `tui` and `rpc` mode the presentation factory builds it at `session_start`. The service survives `/reload`.

`agent-session.ts` carries two added lines, both `session: this,`:

| Line | Purpose |
| --- | --- |
| In the `addForkBaseTools` options | Binds the base tools and the per-session record to the session. |
| In the `SkillForkClient` options | Sends `context: fork` skills through the service instead of the bus. |

`PI_FORK_BUILTINS=off` registers none of the tools and stores no record, so skill-fork keeps its event-bus path.

`subagentScope(session)` (`service/sessions.ts`) gives a typed caller its scope. In a top-level session, the scope is the session's own service. In a child, it is the owner's service, the record the child runs as, and that record's nested runtime. The task service's `TaskExecute`, `TaskOutput` and `TaskStop` go through it. The bus adapter (`adapter/rpc.ts`) and skill-fork resolve the same scope from the lineage.

## The service

`SubagentService` holds every record of one session: its own agents, and the nested agents they spawn. Its methods and events hand out `SubagentView`, a read-only view of a record that reaches no child session, run or waiter (F13). The settings it hands out are frozen, and its registry is typed read-only. The accessors `conversation(id)`, `contextPercent(id)`, `queuePosition(id)` and `ownerBusOf(view)` answer what callers used to read from a record's child.

| Topic | Behavior |
| --- | --- |
| Spawn | Reloads settings and agent definitions, resolves the type and the model, creates the record, and starts it or queues it. |
| Pools | Only the session's own agents take slots. The background pool (`maxConcurrent`) counts every background agent, RPC ones with `isBackground: true` included. The foreground pool (`maxConcurrentForeground`) counts only calls that wait inline. |
| Joins | `async` notifies per agent. `group` and `smart` join background agents spawned together into one notification. At the group timeout, the service delivers the finished members; a late member follows in a straggler batch. |
| Notifications | A finished background agent notifies through `session.sendCustomMessage` with `customType: "subagent-notification"`. Delivery waits for the parent to settle, and a result read first drops it. |
| Waits | `waitForResult(id, signal)` resolves when the run ends. Aborting the signal ends only the wait. |
| Usage | Each agent sums its assistant messages once, nested children included. With `reportUsage`, the next subagent tool result carries the unreported spend. |
| Retention | A finished record stays 10 minutes, then its child session is torn down. A persisted one leaves a tombstone; at most 100 remain. |
| Ownership | The session's `dispose()` aborts every running and queued agent and tears every child down (D21). A parent agent's run end aborts its running children. |
| Configuration | Settings, agent definitions and the transcript directory come from the session's project, whatever directory an agent works in. |

A child session ends through `teardownChild`: it starts `abort()`, gives the child's `session_shutdown` handlers 3 s, then disposes the session and the loader the runner owns.

## The tools

| Tool | Parameters | Behavior |
| --- | --- | --- |
| `Agent` | `prompt`, `description`, `name`, `subagent_type`, `model`, `thinking`, `max_turns`, `run_in_background`, `resume`, `isolated`, `inherit_context`, and `isolation` while `worktreeIsolation` is on | Starts an agent. A foreground call waits and returns the output; its abort signal stops the agent. A background call returns the id and notifies later. `resume` continues a finished agent. A refused spawn returns the reason as text. A worktree that cannot be created fails the call instead (D33). |
| `get_subagent_result` | `agent_id`, `wait`, `verbose` | Reports an agent by id, handle or alias. `wait` waits through the queue and the run; cancelling the call ends only the wait. Reading a finished result consumes it. |
| `steer_subagent` | `agent_id`, `message` | Sends a message to a running agent, or queues it until the child starts. A steer the child rejects, such as extension-command text, answers `Failed to steer agent: <error>`. |

Frontmatter outranks the tool's parameters. The agent file's `model`, `thinking`, `max_turns`, `inherit_context`, `run_in_background`, `isolated` and `isolation` win. `backgroundByDefault` decides an unset `run_in_background`.

The `Agent` description follows `toolDescriptionMode`. `full` is the default, and `compact` is shorter. `custom` reads `.pi/agent-tool-description.md` when the project is trusted, then `<agentDir>/agent-tool-description.md`. It falls back to `full` with a warning. Templates take `{{typeList}}`, `{{compactTypeList}}`, `{{agentDir}}` and `{{isolationGuideline}}`.

## Settings

Settings live under `forkBuiltins.subagents` in Pi's global and project `settings.json` (D20). The project value wins, and project values apply only in a trusted project. The reader drops a value of the wrong type or out of range, with one warning per key. `writeProjectSubagentSettings` writes the project object. The `/agents` settings menu (`ui/settings-menu.ts`) calls it with the project's own values plus the changed key, never a global value. The writer refuses any value the reader would drop, naming its key, and refuses a symlinked `.pi` or `settings.json`. It replaces an existing file whole (`atomic-write.ts`), so a failed write leaves it byte-identical.

| Key | Default | Meaning |
| --- | --- | --- |
| `maxConcurrent` | 10 | Background pool size (1 to 1024). |
| `maxConcurrentForeground` | 0 | Foreground pool size; 0 is unlimited. |
| `defaultMaxTurns` | 0 | Turn limit for agents that set none; 0 is unlimited. |
| `graceTurns` | 5 | Turns after the wrap-up message before a hard abort. |
| `defaultJoinMode` | `smart` | `async`, `group` or `smart`. |
| `backgroundByDefault` | true | What an unset `run_in_background` means. |
| `scopeModels` | false | Checks each spawn's model against `enabledModels`. |
| `strictAgentFiles` | false | Turns an unreadable agent file or an unknown frontmatter key into a load error. |
| `disableDefaultAgents` | false | Drops `general-purpose`, `Explore` and `Plan`. |
| `toolDescriptionMode` | `full` | `full`, `compact` or `custom`. |
| `fleetView` | true | Shows FleetView below the editor. |
| `agentMentions` | `model` | How an `@` mention starts an agent: `model`, `direct` or `off` (see Mentions). |
| `rememberAgents` | true | Persists the session's own agents unless an agent file's `persist_session` says otherwise. |
| `widgetMode` | `background` | The widget above the editor: `all` agents, `background` ones only, or `off`. |
| `outputTranscript` | true | Writes each agent's `.output` transcript unless its `output_transcript` says otherwise. |
| `worktreeIsolation` | true | Allows `isolation: "worktree"` and offers the parameter. |
| `maxSubagentDepth` | 2 | Nesting ceiling: the main session is 0, its agents 1. |
| `fallbackSubagent` | unset | The agent for an unresolved type; unset means `general-purpose`, `none` refuses. |
| `reportUsage` | false | Attaches subagent spend to tool results. |
| `showCost` | false | Shows estimated cost in results, notifications, the widget and FleetView. |
| `showModel` | false | Shows each running agent's model and thinking level on the widget. |
| `viewerMarkdown` | `assistant` | How much of the conversation viewer renders as Markdown: `off`, `assistant` or `all`. |

## Agent files

Agent files are Markdown with YAML frontmatter; the body is the system prompt.

| Location | Loaded when |
| --- | --- |
| `<agentDir>/agents/*.md` | Always. |
| `<cwd>/.agents/agents/*.md`, then `<cwd>/.pi/agents/*.md` | Only when the project is trusted. |
| `<skill>/agents/*.md` | For each loaded skill; the agent registers as `<skill>:<agent>`, and as its bare name only when no other agent holds it (ADR-0008). |

A later source overrides an earlier one by name. An agent switched off with `enabled: false` keeps its bare name (D30). An unknown key loads the agent and warns once per file and key.

| Key | Meaning |
| --- | --- |
| `name`, `display_name`, `description`, `color` | Identity and labels. |
| `tools` | Tool names, fork base tool names, `*` for Pi's seven coding tools, and `ext:<extension>` or `ext:<extension>/<tool>` selectors. |
| `disallowed_tools` | Tools removed whatever else applies. |
| `extensions`, `exclude_extensions` | Which extensions load: `true`, `false` or a list; the exclusion wins. |
| `skills` | `true` inherits the session's skills, `false` none, a list preloads those into the prompt. |
| `model`, `thinking`, `max_turns` | The run's model, thinking level and turn limit. |
| `persist_session`, `session_dir`, `output_transcript` | Session persistence and the `.output` transcript. |
| `allowed_subagents` | Nested delegation: absent means none, `all` or a list of types. |
| `prompt_mode` | `replace` (default) or `append` to the parent's system prompt. |
| `inherit_context`, `run_in_background` | Defaults the file locks for every call. |
| `isolated` | No extensions, no skills and no nested tools. |
| `memory` | `user`, `project` or `local` persistent memory; `project` and `local` apply only in a trusted project. A symlink at any path component below the scope root, `MEMORY.md` included, refuses read-write memory and gives read-only memory no content (F15). |
| `isolation` | `worktree`, or `off` to refuse one. |
| `enabled` | `false` keeps the agent out of spawns and listings. |

## Child sessions

A child is an `AgentSession` built from the parent's model runtime, with its own `DefaultResourceLoader` and a `SettingsManager` whose project trust follows the parent's.

- A fork base tool (`ask_user_question`, `vcc_recall`) is active in a child only when `tools:` names it (D22). Known names come from the parent's live registry.
- Inline built-ins such as tokensave follow `extensions:`, `exclude_extensions:` and `isolated`.
- `Agent`, `get_subagent_result` and `steer_subagent` reach a child only as nested tools (below). Naming them in `tools:` warns.
- Children leave `allowedToolNames` unset and scope through `excludeTools` and the active set, so tools extensions register late still obey `ext:` selectors.

## Nesting, lineage and visibility

An agent with `allowed_subagents` receives the three tools as custom tools (`tools/nested.ts`) bound to its own record's runtime (`service/nested.ts`), unless it is isolated or at `maxSubagentDepth`. Types resolve strictly against its allowlist. A nested agent sits one level deeper, has no handle, takes no pool slot and runs in the foreground by default. Its default model comes from the agent that spawned it. Under `inherit_context`, its conversation comes from that agent too, and under `prompt_mode: append`, its appended prompt. Its usage counts in every ancestor's total.

Before building a child, the runner stores the child's lineage for the child loader's event bus. The lineage holds the owning service, the record the child runs as, and its depth. The child's own adapter and skill-fork client read the lineage. A child's RPC and skill-fork spawns are therefore nested spawns of that agent, under the same rules.

The session cannot reach a nested agent:

- The session's tools treat its id as unknown.
- RPC `stop` and `consume` on the main bus refuse it.
- The nested agent emits nothing on the main bus.

## Worktree isolation

`isolation: "worktree"` needs a git repository with a commit. Elsewhere, or when git cannot add the worktree of a run that starts at once, the `Agent` call fails with a named error (D33). A queued run that meets the same failure ends as an error. The run works in a detached worktree under the OS temp directory, at the spawn's subdirectory. However the run ends, the service commits its changes with `--no-verify` (D29) to `pi-agent-<id>`. No repository hook runs on any of the service's git commands. The service then removes the worktree through the main worktree. A failed git step keeps the worktree, and the result names its path and the error. The service never runs a repository-wide `git worktree prune`. A worktree agent cannot be resumed.

## Events and RPC

The adapter keeps pi-subagents' names and payloads (`README.md` "Events" and `docs/rpc.md` at `79a7c42`). A top-level agent's events go to the session's bus; a nested agent's go to the bus of the child session its parent runs in.

| Event | When |
| --- | --- |
| `subagents:ready` | A microtask after each registration of the base tools: at construction and on each `/reload`. Payload `{ sessionId }`. |
| `subagents:created` | An `Agent` background spawn or a background resume; never an RPC spawn. |
| `subagents:started` | A run starts, including from the queue. |
| `subagents:completed` | A run ends `completed` or `steered`. |
| `subagents:failed` | A run ends `error`, `stopped` or `aborted`. |
| `subagents:agent-ended` | Every terminal transition, with the native status; for an RPC spawn, after its reply. |
| `subagents:steered` | A steer reached the child, or waits for a child that has not started. A steer the child rejects emits nothing. |
| `subagents:compacted` | A child compacts during a run. |
| `subagents:settings_loaded` | The service starts. |
| `subagents:settings_changed` | A reread finds different settings; `persisted` is true, because they come from the files. |

| Channel | Reply |
| --- | --- |
| `subagents:rpc:ping` | `{ version: 3, capabilities: { skillAgents: true } }` |
| `subagents:rpc:spawn` | `{ id }`. The spawn is detached: `isBackground` alone decides whether it takes a background slot. |
| `subagents:rpc:stop` | Success, or `Agent not found`, `Agent is owned by another agent or workflow`, `Agent is not running`. |
| `subagents:rpc:consume` | Success, or `Agent is owned by another agent or workflow`, `Agent not found or still running`. |

The adapter also publishes `skill-agents:rewrite-maps` when the maps change: at install, on `skills:changed`, and after a definition reload. It answers `skill-agents:query` with the latest revision. A child session builds its maps from the agent files its owner service loaded, so a spawn sweeps the agent directories once (D34).

## Presentation

`ui/index.ts` is the presentation factory, the second inline factory in `FORK_OWNED_BUILTINS` (`<inline:subagents>`, D18). The service imports no presentation code. The factory registers nothing in a child session: the parent owns the child's presentation (D22).

The factory finds its session over the loader's event bus (`binding.ts`). At load it asks whether its session is a child. At `session_start` it sends a bind request carrying `ctx.sessionManager`, and the adapter of the session that owns that manager answers with the session. A command, or a `session_shutdown` in a session that never started, binds on demand.

| Mode | Surfaces |
| --- | --- |
| `tui` | The status line, the `agents` widget above the editor, FleetView below it, the conversation viewer, `/agents`, and agent mentions with their `@` popup. |
| `rpc` | The status line only. `/agents` answers `/agents needs the interactive TUI.` |
| `print`, `json` | None. Quit still awaits the children. |

| Surface | Behavior |
| --- | --- |
| Status line | Key `subagents`: `N running`, then `, M queued` when agents wait, then ` agent` or ` agents`. Cleared when no agent runs or waits. |
| Widget (`ui/widget.ts`) | The session's own agents: two lines per running agent, one per finished agent, one summary for the queue, at most 12 lines. A completed agent lingers one parent turn, any other outcome two. `widgetMode`, `showModel` and `showCost` apply. |
| FleetView (`ui/fleet.ts`) | `main` and the agents that have a session, at most five agent rows. It shows while `fleetView` is on and opens the viewer on the selected agent. |
| Viewer (`ui/viewer.ts`) | An overlay with one agent's header, conversation and key hints. It stops and steers the agent while it runs. `viewerMarkdown` sets how much renders as Markdown. |
| `Agent` rows (`ui/tool-renderers.ts`) | `base-tools.ts` sets the renderers on the tool definition. A foreground call sends progress when its agent changes, at most once per 100 ms, and the row draws its spinner at render time (F12). |
| Notifications (`ui/notification.ts`) | The `subagent-notification` renderer: one heading, stats line and result per agent, and a total under `showCost`. |

Every `session_shutdown` unbinds the UI: timers, subscriptions, terminal input, widgets and the status line. A `reload` then keeps the service and its agents. Any other reason awaits the service's `shutdown()`, and never builds a service to do so. `shutdown()` runs `dispose()`, waits at most 3 s for children still starting, then awaits every teardown started by then. Each teardown bounds the child's `session_shutdown` handlers at 3 s. Quit and session replacement therefore wait for the children's teardown, within a bound (D21).

## Mentions

`@handle message` at the start of a prompt addresses an agent instead of the main model (`ui/mentions.ts`, `service/mentions.ts`). The handle names the agent across its life. Mentions act only in the interactive TUI (D44). In print, JSON and RPC mode, the input hook passes every prompt on unchanged.

The grammar follows Claude Code:

- A send is a leading `@handle`, whitespace, then a message. A bare `@handle`, a file path such as `@src/a.ts` and a mention after other text stay the main model's.
- `@main <text>` sends `<text>`, with its images, to the main model. No agent may hold the handle `main`, even a type that slugs to it.
- `@agent-<x>`, Claude Code's manual spelling, resolves `<x>` when the handle as typed resolves nothing. An agent named `agent-<x>` wins.
- Handles match whatever their casing. An agent's raw id reaches it too. A nested agent has no handle, and a mention never reaches it.

The first target that matches decides (`SubagentService.resolveMention`, then the hook):

| Target | Action | Notices |
| --- | --- | --- |
| A running or queued agent | Steers it. | `Sent to @<handle>`; `Could not send to @<handle>: <reason>` |
| A finished agent with a child session | Resumes it in the background, with no tool call. | `Resuming @<handle>`; `Could not resume @<handle>: <error>` |
| An evicted agent's tombstone | Reopens its session file as a detached background run that takes back the tombstone's handle, alias and description. | `Resuming @<handle>`; `Could not resume @<handle>: <error>` |
| A listed type with no agent under the handle | Starts it as `agentMentions` says. | See the table below. |
| Anything else | Passes the prompt to the main model. | None |

- A record whose run failed before its session existed yields to the tombstone, so a failed reopen can be retried on the same conversation.
- A tombstone whose session file is gone is dropped with `Could not resume @<handle>: its session is gone.`; the next mention starts afresh.
- A reopen accepts only the tombstone's exact type as an enabled agent. Otherwise it answers `The <type> agent is no longer available.`, and the tombstone stays.
- A second reopen of one tombstone while the first still starts joins it: its message steers the same agent.
- A reopened agent holds its tombstone's names under a new id. The tombstone's old id reaches that agent too, so the session never reopens twice.
- A finished record that never reached a session starts afresh as its own type, by any of its names.

| `agentMentions` | Start of a listed type |
| --- | --- |
| `model` (default) | `Prompting @<handle>…`, then a clone of the conversation writes the agent's prompt. When the clone starts nothing, the hook starts the agent directly with `Started @<handle> directly: <reason>`. |
| `direct` | `Started @<handle>`: the typed message is the prompt, its first line the description. |
| `off` | Every prompt goes to the main model, and the popup shows no agent row. |

A start runs `detached-background`: it takes a background slot, joins no batch and notifies on completion. A start takes exactly the listed type, with no `fallbackSubagent` substitute (`SubagentService.spawnListed`). A type no longer listed answers `Could not start @<handle>: The <type> agent is no longer available.` A start whose worktree fails is reported once, and nothing else starts. The hook rereads the settings only for a prompt shaped as a mention.

The clone (`tools/mention-clone.ts`) sends one model request, which no session keeps:

- the conversation the session would send next: `session.messages`, which holds the projection plus the skill bodies a compaction carried forward, through `convertToLlm`;
- one system message that leaves `Agent` as the only declared tool; before the session's first turn, it also carries the session's system prompt;
- the typed message, a blank line, then Claude Code's reminder that names the agent.

The request uses the session's model, thinking level and session id. The reply's first `Agent` call counts, after `prepareArguments` and schema validation. The spawn keeps the mentioned type. The spawn takes these fields of the call: `prompt`, `description`, `name`, `model`, `thinking`, `max_turns`, `inherit_context`, `isolated` and `isolation`. The spawn ignores `resume` and `run_in_background`. The clone never rejects, and each mention in `model` mode costs one model request.

The hook never waits. The hook claims the prompt at once and reports each outcome as a notification. After the session's end or `/reload`, the hook reports nothing, and the factory aborts a clone still waiting for its reply.

The `@` popup adds agent rows above Pi's file rows, under one prefix, and hands every other token to the provider it wraps:

- Rows list running and queued agents first, then the other agents from the earliest, then evicted agents, then listed types with no agent under their handle.
- A named agent lists once, under its alias, with its type label or `display_name`. A row names the action a send takes: `send message`, `resume` or `start agent`.
- Skill-bundled agents never list, running or evicted (ADR-0008), yet keep their handles reserved. The hook still reaches one by its exact handle.
- A disabled type never lists as a start; its existing agents still list.
- The popup reads the service's cached registry, so a keystroke reads no file. The factory refreshes it at a `tui` `session_start`, and every spawn refreshes it again.
- The factory registers the provider once per activation. Interactive mode drops every wrapper before `/reload` and a session replacement, and both load the factory again.

## Keys

`ui/keybindings.ts` defines four viewer ids. `fork-builtins/keybindings.ts` merges them with `ask_user_question`'s ids into `FORK_KEYBINDINGS`, and `core/keybindings.ts` spreads that object through its two fork lines (D37). Users rebind the ids in `keybindings.json`.

| Id | Default | Action |
| --- | --- | --- |
| `app.subagents.stop` | `x` | Stops the viewed agent; a second press confirms. |
| `app.subagents.markdownMode` | `m` | Cycles the viewer's Markdown mode for the rest of the session. |
| `app.subagents.top` | `home` | Scrolls the viewer to the top. |
| `app.subagents.bottom` | `end` | Scrolls the viewer to the bottom. |

Every other key reuses an existing id:

| Id | Surface | Action |
| --- | --- | --- |
| `tui.editor.cursorDown`, `tui.editor.cursorLeft` | FleetView | Activate the list at an empty, focused editor. `ctrl+b` is also a default of `tui.editor.cursorLeft`. |
| `tui.select.up`, `tui.select.down` | FleetView, viewer | Move the selection; scroll the viewer. |
| `tui.select.pageUp`, `tui.select.pageDown` | Viewer | Scroll a page. |
| `tui.select.confirm` | FleetView, viewer | Open the viewer; open the steer composer. |
| `tui.select.cancel` | FleetView, viewer | Close. |

FleetView matches keys through `getKeybindings()`. The viewer and the menus match through the manager `ctx.ui.custom` passes. The viewer's `q`, `k`, `j` and Shift+arrow aliases are gone (D37).

## /agents

`/agents` opens in `tui` mode (`ui/agents-menu.ts`). Every submenu returns to the top menu.

| Entry | Action |
| --- | --- |
| `Running agents (N)` | Shown while the session has agents. Opens the conversation viewer. |
| `Agent types (N)` | Lists the agents: `•` a project file, `◦` a global one, `✕` a disabled agent. Skill agents never show (ADR-0008). Each agent offers the actions that apply: edit, delete, reset to default, eject, disable and enable. |
| `Create new agent` | The create wizard (`ui/create-wizard.ts`). |
| `Settings` | The settings menu (`ui/settings-menu.ts`). |

- The menu reloads the definitions before it shows the roster, after every file change and after every settings save. A failed reload warns and keeps the last good roster.
- Project locations (`.pi/agents/`) exist only in a trusted project. Otherwise create, eject and the disable stub offer only `<agentDir>/agents/`.
- An agent-file write replaces the file whole through `writeFileAtomically` (`atomic-write.ts`), so a failed write changes nothing.
- A symlink on any path component below the location root refuses the change with `Refusing to change an agent file behind a symlink: <path>`. The root itself, the project directory or `<agentDir>`, is not checked, so a symlinked `~/.pi/agent` keeps working (Paolo, 2026-09-28).
- A change that landed but whose reload failed warns `Saved <path>, but agent definitions did not reload: <error>`.

The create wizard asks for the location, then the method:

| Method | Behavior |
| --- | --- |
| Manual | Asks for a name, a description, the tools, a model and a thinking level, and takes the system prompt from the editor. The model is inherited, one of the session's scoped models, or a typed `provider/model`. |
| Generate | Sends one completion to the session's current model, with no tools and the user's description as the only message; nothing joins the session (D40). The wizard parses the reply as an agent file. It writes nothing on a parse error, a reserved name, a missing `description:` or an invalid value. It also refuses an unknown key, or a `name:` other than the chosen name. The warning names each reason. |

The settings menu lists the 22 settings in pi-subagents' order. Booleans and enums cycle. A number is typed, and asked again until it passes the reader's checks. The fallback agent cycles through the enabled types and `none`. A save writes the project's own values plus the changed key through `writeProjectSubagentSettings`, never a global value. It then reloads the session's `SettingsManager`, the service's settings and the definitions, and shows a toast. Saving `viewerMarkdown` also clears the mode the viewer's key chose for the session. An untrusted project shows the effective values read-only, with a notice. A failed write warns and changes nothing.

## Known limitations

- An Esc during the parent's post-run auto-compaction goes undetected. A parked notice then starts a new parent turn instead of waiting for the next prompt (D35).
- Core reports a compaction the user aborted and one an extension cancelled in the same way. The service therefore cannot tell them apart, and the gap stays unfixed.
- A `pi -p` run aborts its background agents at exit: nothing holds the process for them (phase 2 plan P26).
- A child whose startup outlasts quit's 3 s wait is torn down when it attaches, after quit returned. A process that exits at once cuts that child's `session_shutdown` handlers short.
- A custom `ResourceLoader`, or an `extensionsOverride` that drops `<inline:subagents>`, removes the presentation and the awaited quit. The session's `dispose()` still ends every child, without awaiting its teardown.
- A mention's clone still waiting for its reply at `/reload` or at the session's end is aborted, and no agent starts.
- The CLI reads an argument that starts with `@` as a file to attach, so `pi "@explore …"` sends no mention. A mention reaches the hook only as typed or piped text.

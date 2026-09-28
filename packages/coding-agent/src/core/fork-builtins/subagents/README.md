# subagents (fork-owned service and base tools)

This module runs subagents natively in Pi. Each `AgentSession` owns one headless subagent service. The base tools `Agent`, `get_subagent_result` and `steer_subagent` call that service. A bus adapter keeps pi-subagents' `subagents:*` events and RPC channels for third-party extensions such as pi-tasks. The fork rebuilt the feature from pi-subagents (`github.com/tintinweb/pi-subagents`, commit `79a7c42`) and takes no upstream sync. Rulings D16 to D36 in the session-control handoff govern it, and `docs/plans/subagents-native-phase1.plan.md` records phase 1.

## Layout

| Directory | Content |
| --- | --- |
| `definitions/` | Agent files, the three default agents, skill-bundled agents and type resolution |
| `settings/` | `forkBuiltins.subagents` settings, the project settings writer, model resolution and the invocation merge |
| `runner/` | Child sessions: tool scoping, prompts, memory, transcripts, turn limits, lineage, worktrees and teardown |
| `service/` | `SubagentService`: records, pools, notifications, usage and the nested runtime |
| `tools/` | The three base tools and the `Agent` tool description |
| `adapter/` | The `subagents:*` bus adapter and the skill-agent rewrite maps |

Phase 2 adds `ui/`: the widget, FleetView, the conversation viewer, `/agents`, the create wizard, eject and the notification renderer.

## Wiring

`../base-tools.ts` registers the three tools next to `ask_user_question` and `vcc_recall`. `../base-tools.ts` also stores the session's per-session record. The record holds the agent directory, the event bus, and the bus's lineage when the session is itself a child. Registration reads nothing from the session. `subagentServiceFor(session)` builds the service from that record on first use: the first subagent tool call, RPC request or skill-fork spawn. The service survives `/reload`.

`agent-session.ts` carries two added lines, both `session: this,`:

| Line | Purpose |
| --- | --- |
| In the `addForkBaseTools` options | Binds the base tools and the per-session record to the session. |
| In the `SkillForkClient` options | Sends `context: fork` skills through the service instead of the bus. |

`PI_FORK_BUILTINS=off` registers none of the tools and stores no record, so skill-fork keeps its event-bus path.

## The service

`SubagentService` holds every record of one session: its own agents, and the nested agents they spawn.

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
| `steer_subagent` | `agent_id`, `message` | Sends a message to a running agent, or queues it until the child starts. |

Frontmatter outranks the tool's parameters. The agent file's `model`, `thinking`, `max_turns`, `inherit_context`, `run_in_background`, `isolated` and `isolation` win. `backgroundByDefault` decides an unset `run_in_background`.

The `Agent` description follows `toolDescriptionMode`. `full` is the default, and `compact` is shorter. `custom` reads `.pi/agent-tool-description.md` when the project is trusted, then `<agentDir>/agent-tool-description.md`. It falls back to `full` with a warning. Templates take `{{typeList}}`, `{{compactTypeList}}`, `{{agentDir}}` and `{{isolationGuideline}}`.

## Settings

Settings live under `forkBuiltins.subagents` in Pi's global and project `settings.json` (D20). The project value wins, and project values apply only in a trusted project. The reader drops a value of the wrong type or out of range, with one warning per key. `writeProjectSubagentSettings` writes the project object; phase 2's `/agents` menu calls it.

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
| `fleetView` | true | Phase 2: shows FleetView. |
| `agentMentions` | `model` | Phase 3: `model`, `direct` or `off`. |
| `rememberAgents` | true | Persists the session's own agents unless an agent file's `persist_session` says otherwise. |
| `widgetMode` | `background` | Phase 2: `all`, `background` or `off`. |
| `outputTranscript` | true | Writes each agent's `.output` transcript unless its `output_transcript` says otherwise. |
| `worktreeIsolation` | true | Allows `isolation: "worktree"` and offers the parameter. |
| `maxSubagentDepth` | 2 | Nesting ceiling: the main session is 0, its agents 1. |
| `fallbackSubagent` | unset | The agent for an unresolved type; unset means `general-purpose`, `none` refuses. |
| `reportUsage` | false | Attaches subagent spend to tool results. |
| `showCost` | false | Shows estimated cost in results and notifications. |
| `showModel` | false | Phase 2: shows each agent's model. |
| `viewerMarkdown` | `assistant` | Phase 2: `off`, `assistant` or `all`. |

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
| `memory` | `user`, `project` or `local` persistent memory; `project` and `local` apply only in a trusted project. |
| `isolation` | `worktree`, or `off` to refuse one. |
| `enabled` | `false` keeps the agent out of spawns and listings. |

## Child sessions

A child is an `AgentSession` built from the parent's model runtime, with its own `DefaultResourceLoader` and a `SettingsManager` whose project trust follows the parent's.

- A fork base tool (`ask_user_question`, `vcc_recall`) is active in a child only when `tools:` names it (D22). Known names come from the parent's live registry.
- Inline built-ins such as tokensave follow `extensions:`, `exclude_extensions:` and `isolated`.
- `Agent`, `get_subagent_result` and `steer_subagent` reach a child only as nested tools (below). Naming them in `tools:` warns.
- Children leave `allowedToolNames` unset and scope through `excludeTools` and the active set, so tools extensions register late still obey `ext:` selectors.

## Nesting, lineage and visibility

An agent with `allowed_subagents` receives the three tools as custom tools bound to its own record (`service/nested.ts`), unless it is isolated or at `maxSubagentDepth`. Types resolve strictly against its allowlist. A nested agent sits one level deeper, has no handle, takes no pool slot and runs in the foreground by default. Its default model comes from the agent that spawned it. Under `inherit_context`, its conversation comes from that agent too, and under `prompt_mode: append`, its appended prompt. Its usage counts in every ancestor's total.

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
| `subagents:steered` | A steer is accepted, delivered or queued. |
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

## Known limitations

- An Esc during the parent's post-run auto-compaction goes undetected. A parked notice then starts a new parent turn instead of waiting for the next prompt (D35).
- Core reports a compaction the user aborted and one an extension cancelled in the same way. The service therefore cannot tell them apart, and the gap stays unfixed.

## Later phases

| Phase | Adds |
| --- | --- |
| 2 | The inline presentation factory: widget, FleetView, conversation viewer, `/agents` with settings, create wizard, eject and the notification renderer. Its `session_shutdown` handler awaits the child teardown. |
| 3 | Agent mentions and the cutover that removes pi-subagents from the live settings. |
| 4 | pi-tasks on the typed service. |

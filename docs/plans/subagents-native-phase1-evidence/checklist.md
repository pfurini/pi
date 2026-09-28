# Native subagents phase 1: old-test checklist

This checklist maps each of the 116 pi-subagents test files at commit `79a7c42` to the phase 1 tests that cover its kept behavior, to a later phase, or to a deliberate drop (handoff D24, plan Section 7).
A `Covered` row lists vitest identities as `<file relative to packages/coding-agent> > <full test name>`, separated by `; `.
`check-checklist.mjs` checks each identity against a candidate run.
The Gaps section lists old test cases with no direct counterpart, or whose behavior the port changed on purpose.
Gap lines name the old file without its `test/` prefix.

## Rows

| Old file | Status | Covering tests |
| --- | --- | --- |
| test/abortable.test.ts | Covered | test/suite/fork-subagents-service.test.ts > waits, steering, stopping and resuming cancels only the wait on a running or queued agent, and leaves no listener behind; test/suite/fork-subagents-tools.test.ts > get_subagent_result stops only the wait when its call is cancelled: the agent keeps running and still notifies |
| test/agent-color-surfaces.test.ts | Phase 2 |  |
| test/agent-color.test.ts | Phase 2 |  |
| test/agent-dir-loader.test.ts | Covered | test/fork-builtins/subagents/definitions.test.ts > agent file frontmatter refuses a type that holds the skill separator; test/fork-builtins/subagents/definitions.test.ts > agent file discovery skips an unparseable or reserved-name file with a warning; strictAgentFiles fails only the unparseable one; test/fork-builtins/subagents/definitions.test.ts > skill-bundled agents never loads a symlinked skill agent file, while a user agent directory follows symlinks; test/fork-builtins/subagents/definitions.test.ts > skill-bundled agents keeps the last of two files in one skill that declare the same name, for the qualified name and the alias; test/fork-builtins/subagents/definitions.test.ts > skill-bundled agents hides skill agents from listings and resolves them by qualified name; test/fork-builtins/subagents/definitions.test.ts > agent file discovery lets a project agent override a global one by name, and .pi/agents win over .agents/agents |
| test/agent-ended-statuses.test.ts | Covered | test/suite/fork-subagents-adapter.test.ts > lifecycle payloads emits created, started, steered, completed and agent-ended as the fixture records them; test/suite/fork-subagents-adapter.test.ts > lifecycle payloads emits failed and agent-ended for an error, a stop and the session's end, as the fixture records them; test/suite/fork-subagents-service.test.ts > definitions, usage and statuses records each terminal status |
| test/agent-file-bom.test.ts | Covered | test/fork-builtins/subagents/definitions.test.ts > agent file frontmatter parses a file that starts with a UTF-8 BOM |
| test/agent-file-toggle.test.ts | Phase 2 |  |
| test/agent-manager-gc.test.ts | Covered | test/suite/fork-subagents-service.test.ts > ownership keeps a finished record 10 minutes, then evicts it with a tombstone, and never evicts a running one; test/suite/fork-subagents-runner.test.ts > child teardown delivers session_shutdown to a child extension, then disposes the session and its loader; test/fork-builtins/subagents/service.test.ts > tombstones keeps at most 100, dropping the oldest completion first, and holds their names |
| test/agent-manager.test.ts | Covered | test/suite/fork-subagents-service.test.ts > notifications delivers one notification after the parent settles, and none for a result fetched first; test/suite/fork-subagents-tools.test.ts > get_subagent_result reports a running agent, waits for its result, and consumes it so no notification arrives; test/suite/fork-subagents-adapter.test.ts > lifecycle payloads emits created, started, steered, completed and agent-ended as the fixture records them; test/suite/fork-subagents-adapter.test.ts > lifecycle payloads emits failed and agent-ended for an error, a stop and the session's end, as the fixture records them; test/suite/fork-subagents-runner.test.ts > child transcripts and sessions writes the child's messages to its .output transcript, and nothing under output_transcript: false; test/suite/fork-subagents-tools.test.ts > registration gives a child session the lineage its loader's bus holds, and the parent none; test/suite/fork-subagents-nested.test.ts > nested ownership steers a running nested agent, and aborts it when the parent's run ends; test/suite/fork-subagents-nested.test.ts > nested accounting finishes a foreground parent that delegates in the foreground when both pools hold one slot; test/suite/fork-subagents-nested.test.ts > nested accounting counts a nested agent's usage once in its parent's total and files its transcript beside the parent's; test/suite/fork-subagents-service.test.ts > definitions, usage and statuses sums each assistant message once across resumes, and reports it to the session under reportUsage; test/suite/fork-subagents-worktree.test.ts > worktree isolation through the service fails the spawn with a named error outside a git repository; test/suite/fork-subagents-adapter.test.ts > skill-agent rewrite maps builds a child's maps from the session's project, whatever directory the child works in; test/suite/fork-subagents-service.test.ts > waits, steering, stopping and resuming steers a running child, and stops one with its partial output; test/suite/fork-subagents-tools.test.ts > steer_subagent queues a message for an agent not yet started, sends one to a running agent, and refuses a finished one; test/suite/fork-subagents-tools.test.ts > Agent stops a foreground agent with its call's abort signal, and lets a background agent outlive it; test/suite/fork-subagents-service.test.ts > ownership ends running and queued children with the session, tears down every child, and leaves no cleanup hook; test/suite/fork-subagents-service.test.ts > definitions, usage and statuses records each terminal status; test/suite/fork-subagents-runner.test.ts > child transcripts and sessions reports a failing startup as an error with its cause and disposes the child's loader; test/suite/fork-subagents-tools.test.ts > Agent returns a failed foreground agent's error with its partial output; test/suite/fork-subagents-service.test.ts > pools queues the eleventh background spawn at maxConcurrent 10, detached background spawns included; test/suite/fork-subagents-adapter.test.ts > consume and pools runs two background RPC spawns one at a time under maxConcurrent 1; test/fork-builtins/subagents/settings.test.ts > subagent settings documents each key's default and drops a value out of range or of the wrong type with one warning; test/suite/fork-subagents-tools.test.ts > Agent resumes a finished agent in the foreground, then in the background by default; test/suite/fork-subagents-service.test.ts > waits, steering, stopping and resuming resumes a finished persisted agent in its session file; test/suite/fork-subagents-service.test.ts > resumes and interrupted turns forgets a caller's signal when its run ends, so a later background resume outlives it; test/fork-builtins/subagents/service.test.ts > handles slugs a type and numbers it on collision, never taking main; test/suite/fork-subagents-service.test.ts > ownership keeps a finished record 10 minutes, then evicts it with a tombstone, and never evicts a running one |
| test/agent-mention-provider.test.ts | Phase 3 |  |
| test/agent-mention-wiring.test.ts | Phase 3 |  |
| test/agent-model-display.test.ts | Phase 2 |  |
| test/agent-runner-e2e.test.ts | Covered | test/suite/fork-subagents-runner.test.ts > child tool scope narrows extension tools to the ext: selectors, including a tool registered after bind; test/suite/fork-subagents-runner.test.ts > child tool scope drops inline built-ins, path extensions and skills under isolated; test/fork-builtins/subagents/scope.test.ts > child extension plan loads nothing for extensions: false or isolated, and keeps listed names with the exclusion winning; test/fork-builtins/subagents/scope.test.ts > child tool scope keeps a named fork base tool and a named Pi tool, and lets disallowed_tools win |
| test/agent-runner-settings.test.ts | Covered | test/fork-builtins/subagents/settings.test.ts > subagent settings documents each key's default and drops a value out of range or of the wrong type with one warning |
| test/agent-runner.test.ts | Covered | test/suite/fork-subagents-tools.test.ts > Agent runs a foreground agent from the model's tool call and returns the child's text; test/suite/fork-subagents-runner.test.ts > child turns omits the parent prompt in replace mode, includes it in append mode, and inherits the conversation; test/fork-builtins/subagents/prompt.test.ts > child system prompt adds the worktree block, the memory block and the preloaded skills; test/suite/fork-subagents-worktree.test.ts > worktree isolation through the service runs the agent in a worktree and saves its change to the branch the result names; test/suite/fork-subagents-service.test.ts > definitions, usage and statuses records each terminal status; test/suite/fork-subagents-tools.test.ts > Agent returns a failed foreground agent's error with its partial output; test/suite/fork-subagents-runner.test.ts > child turns sends the wrap-up at the turn limit, then stops with the partial result; test/suite/fork-subagents-service.test.ts > definitions, usage and statuses sums each assistant message once across resumes, and reports it to the session under reportUsage; test/suite/fork-subagents-tools.test.ts > Agent stops a foreground agent with its call's abort signal, and lets a background agent outlive it; test/suite/fork-subagents-service.test.ts > resumes and interrupted turns forgets a caller's signal when its run ends, so a later background resume outlives it; test/suite/fork-subagents-tools.test.ts > Agent resumes a finished agent in the foreground, then in the background by default; test/suite/fork-subagents-service.test.ts > waits, steering, stopping and resuming resumes a finished persisted agent in its session file; test/suite/fork-subagents-runner.test.ts > child transcripts and sessions persists a child's session under .subagents/, or exactly at session_dir:; test/suite/fork-subagents-runner.test.ts > child transcripts and sessions persists a child's session under .subagents/ below the parent's own session directory; test/fork-builtins/subagents/scope.test.ts > child tool scope selects Pi's seven coding tools by default and excludes the rest, the fork base tools and the subagent tools; test/fork-builtins/subagents/scope.test.ts > child tool scope keeps a named fork base tool and a named Pi tool, and lets disallowed_tools win; test/fork-builtins/subagents/scope.test.ts > child tool scope leaves injected nested tools out of excludeTools and re-admits them, unless disallowed; test/fork-builtins/subagents/scope.test.ts > child tool scope warns about an unknown tools: name and about a subagent tool named in tools:; test/fork-builtins/subagents/scope.test.ts > child tool scope parses ext: selectors case-insensitively by extension, and drops them under isolated; test/fork-builtins/subagents/scope.test.ts > child extension plan names inline built-ins by their name, index entries by their directory, and packages by their short name; test/fork-builtins/subagents/scope.test.ts > child extension plan loads nothing for extensions: false or isolated, and keeps listed names with the exclusion winning; test/fork-builtins/subagents/scope.test.ts > child extension plan warns about a missing requested extension, an exclusion that matches nothing, and an unloaded ext: selector; test/suite/fork-subagents-runner.test.ts > child tool scope drops an extension named by exclude_extensions; test/suite/fork-subagents-runner.test.ts > child tool scope drops inline built-ins, path extensions and skills under isolated; test/suite/fork-subagents-runner.test.ts > child tool scope narrows extension tools to the ext: selectors, including a tool registered after bind; test/suite/fork-subagents-runner.test.ts > child tool scope never gives a child Agent, even when tools: names it, and warns about the naming; test/suite/fork-subagents-nested.test.ts > nested tools gives an agent with allowed_subagents the three nested tools as SDK tools, and an isolated one none; test/suite/fork-subagents-nested.test.ts > nested tools removes the nested tools at the depth cap; test/fork-builtins/subagents/models.test.ts > model scope runs an out-of-scope frontmatter or inherited model with a warning; test/suite/fork-subagents-runner.test.ts > child transcripts and sessions reports a failing startup as an error with its cause and disposes the child's loader; test/suite/fork-subagents-runner.test.ts > child teardown delivers session_shutdown to a child extension, then disposes the session and its loader; test/suite/fork-subagents-runner.test.ts > child teardown still disposes the loader and resolves when disposing the session throws; test/suite/fork-subagents-service.test.ts > ownership keeps a finished record 10 minutes, then evicts it with a tombstone, and never evicts a running one |
| test/agent-startup-error.test.ts | Covered | test/suite/fork-subagents-worktree.test.ts > worktree isolation through the service fails the spawn with a named error outside a git repository; test/suite/fork-subagents-worktree.test.ts > worktree isolation through the service fails the call when git cannot add the worktree of a run that starts at once, and sends no notification |
| test/agent-tool-error-rendering.test.ts | Covered | test/suite/fork-subagents-worktree.test.ts > worktree isolation through the service fails the spawn with a named error outside a git repository; test/suite/fork-subagents-tools.test.ts > Agent returns a failed foreground agent's error with its partial output |
| test/agent-types.test.ts | Covered | test/fork-builtins/subagents/definitions.test.ts > agent registry documents the three default agents; test/fork-builtins/subagents/definitions.test.ts > agent registry resolves types case-insensitively, refuses case-ambiguous and disabled ones; test/fork-builtins/subagents/definitions.test.ts > agent registry falls back to general-purpose, to a named agent, or refuses under none; test/fork-builtins/subagents/definitions.test.ts > agent file frontmatter reads the spelled-out forms: filename as name, none, all, booleans and isolation off; test/fork-builtins/subagents/definitions.test.ts > skill-bundled agents grants the bare alias only when the name is free and one skill claims it; test/fork-builtins/subagents/definitions.test.ts > skill-bundled agents hides skill agents from listings and resolves them by qualified name; test/fork-builtins/subagents/scope.test.ts > child tool scope adds the memory tools, and judges write access after disallowed_tools; test/fork-builtins/subagents/scope.test.ts > child tool scope selects Pi's seven coding tools by default and excludes the rest, the fork base tools and the subagent tools; test/suite/fork-subagents-nested.test.ts > nested tools refuses a nested type outside allowed_subagents, naming the allowed list; test/suite/fork-subagents-adapter.test.ts > skill-agent rewrite maps republishes after a definition reload changes a collision, and stays quiet when nothing changes |
| test/agent-widget.test.ts | Phase 2 |  |
| test/background-by-default.test.ts | Covered | test/suite/fork-subagents-tools.test.ts > Agent starts a background agent, returns its id at once, and notifies on completion; test/suite/fork-subagents-tools.test.ts > Agent runs a foreground agent from the model's tool call and returns the child's text; test/suite/fork-subagents-service.test.ts > pools queues the eleventh background spawn at maxConcurrent 10, detached background spawns included |
| test/background-resume-wiring.test.ts | Covered | test/suite/fork-subagents-service.test.ts > resumes and interrupted turns forgets a caller's signal when its run ends, so a later background resume outlives it; test/suite/fork-subagents-tools.test.ts > Agent resumes a finished agent in the foreground, then in the background by default; test/suite/fork-subagents-service.test.ts > waits, steering, stopping and resuming resumes a finished persisted agent in its session file |
| test/child-context.test.ts | Dropped: no child-session flag under wiring W2, where the service builds each child itself (D18) |  |
| test/child-session-shutdown.test.ts | Covered | test/suite/fork-subagents-runner.test.ts > child teardown delivers session_shutdown to a child extension, then disposes the session and its loader; test/suite/fork-subagents-runner.test.ts > child teardown cuts a session_shutdown handler that never settles at 3 s, and still disposes; test/suite/fork-subagents-runner.test.ts > child teardown delivers session_shutdown once within 3 s while a tool ignores its abort signal; test/suite/fork-subagents-runner.test.ts > child teardown disposes and records an extension-error when the shutdown handler and the error listener both throw; test/suite/fork-subagents-runner.test.ts > child teardown still disposes the loader and resolves when disposing the session throws; test/suite/fork-subagents-service.test.ts > ownership keeps a finished record 10 minutes, then evicts it with a tombstone, and never evicts a running one; test/suite/fork-subagents-service.test.ts > ownership ends running and queued children with the session, tears down every child, and leaves no cleanup hook |
| test/clear-completed-wiring.test.ts | Covered | test/suite/fork-subagents-tools.test.ts > registration keeps one service across /reload, which still returns an agent finished before it; test/suite/fork-subagents-service.test.ts > ownership ends the children of a session that the runtime replaces |
| test/context.test.ts | Covered | test/fork-builtins/subagents/prompt.test.ts > parent context renders user and assistant text and compaction summaries, and skips tool results; test/suite/fork-subagents-runner.test.ts > child turns omits the parent prompt in replace mode, includes it in append mode, and inherits the conversation |
| test/conversation-viewer-keybindings.test.ts | Phase 2 |  |
| test/conversation-viewer.test.ts | Phase 2 |  |
| test/cost-display.test.ts | Phase 2 |  |
| test/cross-extension-rpc.test.ts | Covered | test/suite/fork-subagents-adapter.test.ts > a cold session answers ping with protocol 3 before any subagent tool is called; test/suite/fork-subagents-adapter.test.ts > readiness announces subagents:ready at construction and on each /reload, and answers one ping once; test/suite/fork-subagents-adapter.test.ts > readiness stops answering after dispose; test/suite/fork-subagents-adapter.test.ts > a cold session spawns over RPC, replies before the agent's terminal event, and reports subagents:completed; test/suite/fork-subagents-adapter.test.ts > ownership across buses refuses an RPC spawn from a child without allowed_subagents, an isolated child, and a child at the cap; test/suite/fork-subagents-adapter.test.ts > lifecycle payloads emits failed and agent-ended for an error, a stop and the session's end, as the fixture records them; test/suite/fork-subagents-adapter.test.ts > ownership across buses keeps a nested agent's events off the main bus and refuses its stop and consume there; test/suite/fork-subagents-adapter.test.ts > consume and pools leaves no notification when a listener consumes the result inside its subagents:completed handler; test/suite/fork-subagents-adapter.test.ts > consume and pools runs two background RPC spawns one at a time under maxConcurrent 1; test/suite/fork-subagents-adapter.test.ts > lifecycle payloads holds an RPC-spawned agent's agent-ended until its spawn reply is out |
| test/custom-agents.test.ts | Covered | test/fork-builtins/subagents/definitions.test.ts > agent file frontmatter reads every documented key; test/fork-builtins/subagents/definitions.test.ts > agent file frontmatter reads the spelled-out forms: filename as name, none, all, booleans and isolation off; test/fork-builtins/subagents/definitions.test.ts > agent file frontmatter refuses a type that holds the skill separator; test/fork-builtins/subagents/definitions.test.ts > agent file discovery lets a project agent override a global one by name, and .pi/agents win over .agents/agents; test/fork-builtins/subagents/definitions.test.ts > agent file discovery reads no project agent directory in an untrusted project; test/fork-builtins/subagents/definitions.test.ts > agent file discovery skips an unparseable or reserved-name file with a warning; strictAgentFiles fails only the unparseable one; test/fork-builtins/subagents/definitions.test.ts > agent file discovery warns once per file and unknown key, naming both, and fails under strictAgentFiles; test/fork-builtins/subagents/definitions.test.ts > skill-bundled agents keeps the last of two files in one skill that declare the same name, for the qualified name and the alias; test/fork-builtins/subagents/scope.test.ts > child tool scope parses ext: selectors case-insensitively by extension, and drops them under isolated; test/fork-builtins/subagents/scope.test.ts > child tool scope warns about an unknown tools: name and about a subagent tool named in tools: |
| test/documented-defaults.test.ts | Covered | test/fork-builtins/subagents/settings.test.ts > subagent settings documents each key's default and drops a value out of range or of the wrong type with one warning; test/fork-builtins/subagents/models.test.ts > invocation merge lets frontmatter win over a tool parameter for each locked field |
| test/e2e/isolated-provider.e2e.test.ts | Covered | test/suite/fork-subagents-tools.test.ts > Agent runs a foreground agent from the model's tool call and returns the child's text; test/suite/fork-subagents-runner.test.ts > child turns omits the parent prompt in replace mode, includes it in append mode, and inherits the conversation |
| test/e2e/loader-lifecycle.e2e.test.ts | Covered | test/suite/fork-subagents-runner.test.ts > child teardown delivers session_shutdown to a child extension, then disposes the session and its loader; test/suite/fork-subagents-service.test.ts > ownership keeps a finished record 10 minutes, then evicts it with a tombstone, and never evicts a running one; test/suite/fork-subagents-tools.test.ts > Agent resumes a finished agent in the foreground, then in the background by default; test/suite/fork-subagents-service.test.ts > waits, steering, stopping and resuming resumes a finished persisted agent in its session file |
| test/e2e/mention-clone.e2e.test.ts | Phase 3 |  |
| test/e2e/output-transcript.e2e.test.ts | Covered | test/suite/fork-subagents-runner.test.ts > child transcripts and sessions writes the child's messages to its .output transcript, and nothing under output_transcript: false |
| test/e2e/tool-veto-reachability.e2e.test.ts | Covered | test/suite/fork-subagents-runner.test.ts > child tool scope blocks an out-of-scope tool call at run time, and hands an in-scope one to the hook installed before |
| test/e2e/turn-limit-steer.e2e.test.ts | Covered | test/suite/fork-subagents-runner.test.ts > child turns sends the wrap-up at the turn limit, then stops with the partial result; test/suite/fork-subagents-service.test.ts > definitions, usage and statuses records each terminal status |
| test/e2e/usage-reaches-session-stats.e2e.test.ts | Covered | test/suite/fork-subagents-tools.test.ts > Agent adds the reported spend to the session's stats once, and nothing for a result without usage |
| test/e2e/workflow.e2e.test.ts | Dropped: workflow code (R2, D17) |  |
| test/enabled-models.test.ts | Covered | test/fork-builtins/subagents/models.test.ts > model scope refuses a caller's model outside enabledModels, listing the allowed models; test/fork-builtins/subagents/models.test.ts > model scope runs an out-of-scope frontmatter or inherited model with a warning |
| test/env.test.ts | Covered | test/fork-builtins/subagents/prompt.test.ts > environment reports a git repository with its branch, and a plain directory as none |
| test/ext-templates-e2e.test.ts | Covered | test/fork-builtins/subagents/scope.test.ts > child tool scope selects Pi's seven coding tools by default and excludes the rest, the fork base tools and the subagent tools; test/suite/fork-subagents-runner.test.ts > child tool scope narrows extension tools to the ext: selectors, including a tool registered after bind; test/suite/fork-subagents-runner.test.ts > child tool scope drops an extension named by exclude_extensions; test/suite/fork-subagents-runner.test.ts > child tool scope drops inline built-ins, path extensions and skills under isolated; test/fork-builtins/subagents/scope.test.ts > child extension plan warns about a missing requested extension, an exclusion that matches nothing, and an unloaded ext: selector; test/fork-builtins/subagents/scope.test.ts > child tool scope adds the memory tools, and judges write access after disallowed_tools; test/suite/fork-subagents-runner.test.ts > child turns gives an agent with write tools a memory directory it writes, and a read-only agent the read-only block; test/suite/fork-subagents-runner.test.ts > child turns omits the parent prompt in replace mode, includes it in append mode, and inherits the conversation; test/suite/fork-subagents-runner.test.ts > child turns preloads a skills: list from the parent's loaded skills into the system prompt; test/fork-builtins/subagents/definitions.test.ts > agent file frontmatter reads every documented key |
| test/fallback-subagent-wiring.test.ts | Covered | test/suite/fork-subagents-tools.test.ts > Agent returns an unknown type under fallbackSubagent none as text naming the available types, and starts nothing; test/suite/fork-subagents-tools.test.ts > Agent notes an unknown type that fell back to the configured agent; test/fork-builtins/subagents/definitions.test.ts > agent registry falls back to general-purpose, to a named agent, or refuses under none; test/fork-builtins/subagents/definitions.test.ts > agent registry resolves types case-insensitively, refuses case-ambiguous and disabled ones; test/suite/fork-subagents-service.test.ts > definitions, usage and statuses spawns an agent file added after the service started, and refreshes a disabled one, without touching records |
| test/fleet-list.test.ts | Phase 2 |  |
| test/fleet-wiring.test.ts | Phase 2 |  |
| test/foreground-concurrency-print-mode-e2e.test.ts | Covered | test/suite/fork-subagents-service.test.ts > pools queues a second blocking spawn at maxConcurrentForeground 1, and starts a detached spawn at once |
| test/foreground-concurrency-wiring.test.ts | Covered | test/suite/fork-subagents-service.test.ts > pools queues a second blocking spawn at maxConcurrentForeground 1, and starts a detached spawn at once |
| test/foreground-concurrency.test.ts | Covered | test/suite/fork-subagents-service.test.ts > pools queues a second blocking spawn at maxConcurrentForeground 1, and starts a detached spawn at once; test/suite/fork-subagents-adapter.test.ts > consume and pools starts an RPC spawn without isBackground while a blocking Agent call holds the only foreground slot; test/suite/fork-subagents-nested.test.ts > nested accounting finishes a foreground parent that delegates in the foreground when both pools hold one slot; test/fork-builtins/subagents/settings.test.ts > subagent settings documents each key's default and drops a value out of range or of the wrong type with one warning; test/suite/fork-subagents-service.test.ts > ownership ends running and queued children with the session, tears down every child, and leaves no cleanup hook |
| test/foreground-result-retrieval.test.ts | Covered | test/suite/fork-subagents-tools.test.ts > registration keeps one service across /reload, which still returns an agent finished before it; test/suite/fork-subagents-tools.test.ts > Agent runs a foreground agent from the model's tool call and returns the child's text; test/suite/fork-subagents-service.test.ts > ownership ends the children of a session that the runtime replaces |
| test/group-join.test.ts | Covered | test/fork-builtins/subagents/service.test.ts > group join delivers a group when all finish, the finished members at the timeout, and stragglers after; test/suite/fork-subagents-service.test.ts > notifications groups smart agents spawned together, keeps a later one apart, and delivers a late group at its timeout; test/suite/fork-subagents-service.test.ts > notifications notifies each agent under async, and one notification holding both under group |
| test/invocation-config.test.ts | Covered | test/fork-builtins/subagents/models.test.ts > invocation merge lets frontmatter win over a tool parameter for each locked field; test/suite/fork-subagents-service.test.ts > notifications notifies each agent under async, and one notification holding both under group |
| test/isolation-param.test.ts | Covered | test/suite/fork-subagents-tools.test.ts > the Agent description follows toolDescriptionMode, and offers isolation only while worktrees are on |
| test/manager-registry-guard.test.ts | Dropped: no process-global manager registry; each session owns its service (D18) |  |
| test/memory-legacy-fallback.test.ts | Dropped: the legacy agent-memory directory is not read (plan Section 2.1) |  |
| test/memory.test.ts | Covered | test/fork-builtins/subagents/memory.test.ts > agent memory places each scope's directory and refuses a name that could leave it; test/fork-builtins/subagents/memory.test.ts > agent memory creates the read-write directory and shows MEMORY.md, truncated at 200 lines; test/fork-builtins/subagents/memory.test.ts > agent memory gives a read-only block without creating the directory; test/fork-builtins/subagents/memory.test.ts > agent memory refuses a symlinked memory directory and ignores a symlinked MEMORY.md; test/suite/fork-subagents-runner.test.ts > child turns gives an agent with write tools a memory directory it writes, and a read-only agent the read-only block |
| test/mention-clone.test.ts | Phase 3 |  |
| test/mention-start-notification.test.ts | Phase 3 |  |
| test/mention.test.ts | Phase 3 |  |
| test/model-resolver.test.ts | Covered | test/fork-builtins/subagents/models.test.ts > model resolution prefers an exact match, then fuzzy under the provider, then any provider, else reports unavailable |
| test/model-scope.test.ts | Covered | test/fork-builtins/subagents/models.test.ts > model scope refuses a caller's model outside enabledModels, listing the allowed models; test/fork-builtins/subagents/models.test.ts > model scope runs an out-of-scope frontmatter or inherited model with a warning |
| test/nested-delegation-e2e.test.ts | Covered | test/suite/fork-subagents-nested.test.ts > nested tools gives an agent with allowed_subagents the three nested tools as SDK tools, and an isolated one none; test/suite/fork-subagents-nested.test.ts > nested accounting finishes a foreground parent that delegates in the foreground when both pools hold one slot; test/suite/fork-subagents-runner.test.ts > child tool scope never gives a child Agent, even when tools: names it, and warns about the naming; test/suite/fork-subagents-nested.test.ts > nested accounting counts a nested agent's usage once in its parent's total and files its transcript beside the parent's |
| test/nested-tools.test.ts | Covered | test/suite/fork-subagents-nested.test.ts > nested tools refuses a nested type outside allowed_subagents, naming the allowed list; test/suite/fork-subagents-nested.test.ts > nested tools removes the nested tools at the depth cap; test/suite/fork-subagents-adapter.test.ts > ownership across buses refuses an RPC spawn from a child without allowed_subagents, an isolated child, and a child at the cap; test/suite/fork-subagents-nested.test.ts > nested ownership steers a running nested agent, and aborts it when the parent's run ends; test/suite/fork-subagents-nested.test.ts > nested ownership lets no agent reach a nested agent it does not own, and hides it from the session; test/suite/fork-subagents-nested.test.ts > nested accounting counts a nested agent's usage once in its parent's total and files its transcript beside the parent's; test/suite/fork-subagents-nested.test.ts > nested inheritance gives a nested agent the model, conversation and system prompt of the agent that delegated; test/fork-builtins/subagents/settings.test.ts > subagent settings documents each key's default and drops a value out of range or of the wrong type with one warning |
| test/notification-boundary.test.ts | Covered | test/suite/fork-subagents-service.test.ts > notifications delivers one notification after the parent settles, and none for a result fetched first; test/suite/fork-subagents-service.test.ts > resumes and interrupted turns drops a notification held for the next prompt once the result is read; test/suite/fork-subagents-tools.test.ts > Agent starts a background agent, returns its id at once, and notifies on completion |
| test/output-file-compaction-e2e.test.ts | Covered | test/suite/fork-subagents-runner.test.ts > child transcripts and sessions keeps the transcript going across a compaction without repeating a message |
| test/output-file-path.test.ts | Covered | test/suite/fork-subagents-runner.test.ts > child transcripts and sessions writes the child's messages to its .output transcript, and nothing under output_transcript: false |
| test/output-file.test.ts | Covered | test/suite/fork-subagents-runner.test.ts > child transcripts and sessions writes the child's messages to its .output transcript, and nothing under output_transcript: false; test/suite/fork-subagents-runner.test.ts > child transcripts and sessions keeps the transcript going across a compaction without repeating a message |
| test/output-transcript-wiring.test.ts | Covered | test/suite/fork-subagents-runner.test.ts > child transcripts and sessions writes the child's messages to its .output transcript, and nothing under output_transcript: false |
| test/perf/no-fs-on-render.perf.test.ts | Phase 2 |  |
| test/perf/render-invariants.perf.test.ts | Phase 2 |  |
| test/perf/spawn-invariants.perf.test.ts | Covered | test/suite/fork-subagents-tools.test.ts > Agent sweeps the agent directories once per call, the child's startup included, however many agents run |
| test/print-mode.test.ts | Covered | test/suite/fork-subagents-service.test.ts > notifications turns a notification that fails to deliver into a warning, never an unhandled rejection |
| test/prompts.test.ts | Covered | test/fork-builtins/subagents/prompt.test.ts > child system prompt builds replace mode from the header, the environment and the agent's prompt, without the parent's; test/fork-builtins/subagents/prompt.test.ts > child system prompt builds append mode on the parent's prompt as a verbatim prefix, or a generic base without one; test/fork-builtins/subagents/prompt.test.ts > child system prompt adds the worktree block, the memory block and the preloaded skills; test/suite/fork-subagents-runner.test.ts > child turns omits the parent prompt in replace mode, includes it in append mode, and inherits the conversation; test/fork-builtins/subagents/definitions.test.ts > agent registry documents the three default agents |
| test/rpc-lifecycle-gating.test.ts | Covered | test/suite/fork-subagents-adapter.test.ts > a cold session answers ping with protocol 3 before any subagent tool is called; test/suite/fork-subagents-adapter.test.ts > a cold session spawns over RPC, replies before the agent's terminal event, and reports subagents:completed; test/suite/fork-subagents-adapter.test.ts > readiness announces subagents:ready at construction and on each /reload, and answers one ping once; test/suite/fork-subagents-adapter.test.ts > readiness stops answering after dispose; test/suite/fork-subagents-adapter.test.ts > skill-agent rewrite maps republishes when a skill change frees a bare name, and answers a query with the latest revision; test/suite/fork-subagents-adapter.test.ts > skill-agent rewrite maps builds a child's maps from the session's project, whatever directory the child works in |
| test/rpc-result-consumption.test.ts | Covered | test/suite/fork-subagents-adapter.test.ts > consume and pools leaves no notification when a listener consumes the result inside its subagents:completed handler |
| test/schedule-e2e.test.ts | Dropped: scheduling (R2, D17) |  |
| test/schedule-menu.test.ts | Dropped: scheduling (R2, D17) |  |
| test/schedule-params-wiring.test.ts | Dropped: scheduling (R2, D17) |  |
| test/schedule-store.test.ts | Dropped: scheduling (R2, D17) |  |
| test/schedule.test.ts | Dropped: scheduling (R2, D17) |  |
| test/settings.test.ts | Covered | test/fork-builtins/subagents/settings.test.ts > subagent settings merges the global values under the project values; test/fork-builtins/subagents/settings.test.ts > subagent settings ignores the project values in an untrusted project; test/fork-builtins/subagents/settings.test.ts > subagent settings documents each key's default and drops a value out of range or of the wrong type with one warning; test/fork-builtins/subagents/settings.test.ts > subagent settings writes only forkBuiltins.subagents in the project settings.json; test/suite/fork-subagents-adapter.test.ts > lifecycle payloads emits settings_loaded, settings_changed and compacted as the fixture records them |
| test/skill-agents-e2e.test.ts | Covered | test/fork-builtins/subagents/definitions.test.ts > skill-bundled agents hides skill agents from listings and resolves them by qualified name; test/fork-builtins/subagents/definitions.test.ts > skill-bundled agents grants the bare alias only when the name is free and one skill claims it; test/fork-builtins/subagents/definitions.test.ts > agent registry falls back to general-purpose, to a named agent, or refuses under none; test/suite/fork-subagents-tools.test.ts > Agent returns an unknown type under fallbackSubagent none as text naming the available types, and starts nothing; test/suite/fork-subagents-adapter.test.ts > skill-agent rewrite maps republishes after a definition reload changes a collision, and stays quiet when nothing changes; test/suite/fork-subagents-adapter.test.ts > skill-agent rewrite maps republishes when a skill change frees a bare name, and answers a query with the latest revision |
| test/skill-agents.test.ts | Covered | test/fork-builtins/subagents/definitions.test.ts > skill-bundled agents hides skill agents from listings and resolves them by qualified name; test/fork-builtins/subagents/definitions.test.ts > skill-bundled agents grants the bare alias only when the name is free and one skill claims it; test/fork-builtins/subagents/definitions.test.ts > skill-bundled agents loads no agent of a skill whose visibility is missing or malformed, and never applies strict to skill files; test/fork-builtins/subagents/definitions.test.ts > agent file frontmatter refuses a type that holds the skill separator; test/suite/fork-subagents-adapter.test.ts > skill-agent rewrite maps republishes when a skill change frees a bare name, and answers a query with the latest revision; test/suite/fork-subagents-adapter.test.ts > skill-agent rewrite maps republishes after a definition reload changes a collision, and stays quiet when nothing changes |
| test/skill-loader.test.ts | Dropped: children preload skills from the session's loaded skills, not a separate scan (plan Section 2.1) |  |
| test/skills-contract.test.ts | Covered | test/suite/fork-subagents-adapter.test.ts > skill-agent rewrite maps republishes when a skill change frees a bare name, and answers a query with the latest revision |
| test/status-note-wiring.test.ts | Covered | test/suite/fork-subagents-tools.test.ts > Agent stops a foreground agent with its call's abort signal, and lets a background agent outlive it; test/fork-builtins/subagents/service.test.ts > notification text formats a task notification with a status note, a truncated preview and usage; test/suite/fork-subagents-runner.test.ts > child turns sends the wrap-up at the turn limit, then stops with the partial result; test/suite/fork-subagents-nested.test.ts > nested ownership lets no agent reach a nested agent it does not own, and hides it from the session; test/suite/fork-subagents-adapter.test.ts > ownership across buses keeps a nested agent's events off the main bus and refuses its stop and consume there; test/suite/fork-subagents-adapter.test.ts > lifecycle payloads emits settings_loaded, settings_changed and compacted as the fixture records them |
| test/steer-subagent-wiring.test.ts | Covered | test/suite/fork-subagents-tools.test.ts > steer_subagent queues a message for an agent not yet started, sends one to a running agent, and refuses a finished one; test/suite/fork-subagents-adapter.test.ts > lifecycle payloads emits created, started, steered, completed and agent-ended as the fixture records them; test/suite/fork-subagents-service.test.ts > waits, steering, stopping and resuming steers a running child, and stops one with its partial output |
| test/strict-agent-files-wiring.test.ts | Covered | test/fork-builtins/subagents/definitions.test.ts > agent file discovery skips an unparseable or reserved-name file with a warning; strictAgentFiles fails only the unparseable one; test/suite/fork-subagents-tools.test.ts > the Agent description keeps a session whose strict agent file fails to load: the description lists the defaults, and a spawn fails as text |
| test/structured-output.test.ts | Dropped: structured output serves only workflows (R2, D17) |  |
| test/subagent-error-status-e2e.test.ts | Covered | test/suite/fork-subagents-service.test.ts > definitions, usage and statuses records each terminal status; test/suite/fork-subagents-tools.test.ts > Agent returns a failed foreground agent's error with its partial output |
| test/subagents-nested-print-mode-e2e.test.ts | Covered | test/suite/fork-subagents-runner.test.ts > child tool scope never gives a child Agent, even when tools: names it, and warns about the naming; test/fork-builtins/subagents/scope.test.ts > child tool scope selects Pi's seven coding tools by default and excludes the rest, the fork base tools and the subagent tools; test/suite/fork-subagents-nested.test.ts > nested tools removes the nested tools at the depth cap; test/suite/fork-subagents-nested.test.ts > nested accounting finishes a foreground parent that delegates in the foreground when both pools hold one slot; test/suite/fork-subagents-nested.test.ts > nested ownership lets no agent reach a nested agent it does not own, and hides it from the session |
| test/subagents-print-mode-e2e.test.ts | Covered | test/suite/fork-subagents-tools.test.ts > Agent runs a foreground agent from the model's tool call and returns the child's text; test/suite/fork-subagents-service.test.ts > definitions, usage and statuses spawns an agent file added after the service started, and refreshes a disabled one, without touching records; test/fork-builtins/subagents/definitions.test.ts > agent file discovery lets a project agent override a global one by name, and .pi/agents win over .agents/agents; test/fork-builtins/subagents/prompt.test.ts > child system prompt builds replace mode from the header, the environment and the agent's prompt, without the parent's |
| test/tool-description-mode.test.ts | Covered | test/suite/fork-subagents-tools.test.ts > the Agent description follows toolDescriptionMode, and offers isolation only while worktrees are on; test/suite/fork-subagents-tools.test.ts > the Agent description renders a custom template from the project, then the agent directory, and falls back to full; test/suite/fork-subagents-tools.test.ts > the Agent description ignores an untrusted project's custom template; test/fork-builtins/subagents/settings.test.ts > subagent settings documents each key's default and drops a value out of range or of the wrong type with one warning; test/fork-builtins/subagents/definitions.test.ts > skill-bundled agents hides skill agents from listings and resolves them by qualified name |
| test/unnest-script.test.ts | Dropped: a migration script for old session layouts, with no counterpart in the port |  |
| test/usage-reporting.test.ts | Covered | test/suite/fork-subagents-tools.test.ts > Agent attaches the subagent spend to the result under reportUsage; test/suite/fork-subagents-service.test.ts > definitions, usage and statuses sums each assistant message once across resumes, and reports it to the session under reportUsage; test/fork-builtins/subagents/service.test.ts > pending usage hands out each delta once and nothing when nothing was spent; test/suite/fork-subagents-nested.test.ts > nested accounting counts a nested agent's usage once in its parent's total and files its transcript beside the parent's; test/suite/fork-subagents-adapter.test.ts > lifecycle payloads emits created, started, steered, completed and agent-ended as the fixture records them |
| test/usage.test.ts | Covered | test/fork-builtins/subagents/service.test.ts > pending usage hands out each delta once and nothing when nothing was spent; test/suite/fork-subagents-service.test.ts > definitions, usage and statuses sums each assistant message once across resumes, and reports it to the session under reportUsage; test/fork-builtins/subagents/service.test.ts > notification text formats a task notification with a status note, a truncated preview and usage |
| test/wait-queued.test.ts | Covered | test/suite/fork-subagents-service.test.ts > waits, steering, stopping and resuming cancels only the wait on a running or queued agent, and leaves no listener behind; test/suite/fork-subagents-tools.test.ts > get_subagent_result stops only the wait when its call is cancelled: the agent keeps running and still notifies |
| test/workflow-borrowed.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-claude-code-compat.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-collisions.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-command.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-dialog-open-agent.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-dialog.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-effective-config.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-examples.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-gate-worktree.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-journal.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-json-schema.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-meta.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-progress.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-render.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-runtime.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-task.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-tool-description.test.ts | Dropped: workflow code (R2, D17) |  |
| test/workflow-tool.test.ts | Dropped: workflow code (R2, D17) |  |
| test/worktree-isolation-e2e.test.ts | Covered | test/suite/fork-subagents-worktree.test.ts > worktree isolation through the service runs the agent in a worktree and saves its change to the branch the result names; test/suite/fork-subagents-tools.test.ts > the Agent description follows toolDescriptionMode, and offers isolation only while worktrees are on |
| test/worktree.test.ts | Covered | test/fork-builtins/subagents/worktree.test.ts > worktree isolation commits a change to pi-agent-<id>, leaves the main tree unchanged, and removes the worktree; test/fork-builtins/subagents/worktree.test.ts > worktree isolation removes an unchanged worktree and creates no branch; test/fork-builtins/subagents/worktree.test.ts > worktree isolation never runs the repository's hooks on the snapshot commit; test/fork-builtins/subagents/worktree.test.ts > worktree isolation keeps the worktree and names it when the commit fails; test/fork-builtins/subagents/worktree.test.ts > worktree isolation keeps the worktree and names it when the branch already exists; test/fork-builtins/subagents/worktree.test.ts > worktree isolation creates the spawn's untracked directory inside the copy; test/fork-builtins/subagents/worktree.test.ts > worktree isolation refuses a directory outside a git repository with a named error; test/fork-builtins/subagents/settings.test.ts > subagent settings documents each key's default and drops a value out of range or of the wrong type with one warning |

## Gaps

- abortable.test.ts: "returns the original promise untouched when there is no signal": dropped; the port has no abortable helper, and waitForResult takes an optional signal.
- abortable.test.ts: "rejects immediately with the signal's reason when already aborted": not covered.
- abortable.test.ts: "propagates a rejection from the wrapped promise": not covered.
- abortable.test.ts: "absorbs a late REJECTION of the wrapped promise after an abort": not covered.
- abortable.test.ts: "absorbs a late RESOLUTION of the wrapped promise after an abort": not covered.
- abortable.test.ts: "removes its abort listener once the promise rejects": not covered.
- abortable.test.ts: "a late abort after normal settlement is inert": not covered.
- agent-dir-loader.test.ts: "returns an empty map for a directory that does not exist": not covered by a direct assertion; the discovery tests only load while some project directories are absent, without asserting an empty result.
- agent-ended-statuses.test.ts: "emits error exactly once when the run rejects": not covered; the startup failure case checks the status, not the event count.
- agent-ended-statuses.test.ts: "emits stopped once for an agent aborted while still queued": not covered.
- agent-file-bom.test.ts: "handles BOM + CRLF together, which is what a Windows editor writes": not covered; no test parses a CRLF agent file, and the disable/enable half is the agent file toggle (Phase 2, `agent-file-toggle`).
- agent-file-bom.test.ts: "still refuses a BOM-prefixed file that has no frontmatter at all": deferred; `disableInContent` is the agent file toggle (Phase 2, `agent-file-toggle`).
- agent-file-bom.test.ts: "disables and re-enables on disk, leaving the file byte-identical": deferred; the toggle action is Phase 2 (`agent-file-toggle`, plan Section 7).
- agent-manager-gc.test.ts: "never evicts a queued agent": not covered; the retention case holds a running record only.
- agent-manager-gc.test.ts: "sweeps repeatedly, not just once": not covered.
- agent-manager-gc.test.ts: "leaves nothing behind when the session was only ever in memory": not covered.
- agent-manager-gc.test.ts: "prefers a live agent over a tombstone holding the same name": not covered.
- agent-manager-gc.test.ts: "hands a reclaimed name straight back, numbering nothing": not covered.
- agent-manager-gc.test.ts: "ignores a reclaim on a nested child, which has no name to hold": not covered.
- agent-manager-gc.test.ts: "stops answering a name once its tombstone is dropped": not covered.
- agent-manager-gc.test.ts: "frees a dropped name for the next agent of that type": not covered.
- agent-manager-gc.test.ts: "forgets every name when the session ends": not covered.
- agent-manager.test.ts: "fields set on the record in onSpawned are visible when onSessionCreated fires": dropped; the onSpawned and onSessionCreated callbacks have no counterpart in the rebuilt service (R1).
- agent-manager.test.ts: "onSpawned id matches the id returned by spawnAndWait": dropped; no onSpawned callback in the rebuilt service (R1).
- agent-manager.test.ts: "restores the shared onSpawned callback before awaiting the foreground run": dropped; no shared onSpawned callback in the rebuilt service (R1).
- agent-manager.test.ts: "tells the runner which spawns are nested, so only top-level ones persist": not covered.
- agent-manager.test.ts: "starts a workflow's children regardless of the concurrency pool": dropped with workflows (R2).
- agent-manager.test.ts: "gives a workflow's child no handle, so nothing can address it": dropped with workflows (R2).
- agent-manager.test.ts: "aborts children spawned during a resumed turn": not covered; the nested abort case covers a first run only.
- agent-manager.test.ts: "does not let onComplete errors turn a completed agent into a failed run": not covered; no test throws from a service listener.
- agent-manager.test.ts: "fires onComplete once with status 'stopped' when a queued agent is aborted": not covered; only the session's end aborts a queued record in tests.
- agent-manager.test.ts: "does not keep the process alive on its own": not covered; no test checks that the retention timer is unref'd.
- agent-manager.test.ts: "clearCompleted removes completed records": changed; no clearCompleted, records leave by retention or with the session (Section 2.1 "Record retention", R6).
- agent-manager.test.ts: "clearCompleted does not remove running or queued agents": changed; no clearCompleted (Section 2.1 "Record retention"); the retention case covers running records only.
- agent-manager.test.ts: "clearCompleted removes error and stopped records": changed; no clearCompleted (Section 2.1 "Record retention", R6).
- agent-manager.test.ts: "clearCompleted(true) preserves completed records with resultConsumed=false": changed; no clearCompleted (Section 2.1 "Record retention", R6).
- agent-manager.test.ts: "clearCompleted(true) removes completed records with resultConsumed=true": changed; no clearCompleted (Section 2.1 "Record retention", R6).
- agent-manager.test.ts: "clearCompleted(true) still removes running=false queued=false records when resultConsumed=false for error status": changed; no clearCompleted (Section 2.1 "Record retention", R6).
- agent-manager.test.ts: "spawn initializes lifetimeUsage to zeros and compactionCount to 0": not covered for compactionCount.
- agent-manager.test.ts: "onCompaction from runAgent increments record.compactionCount": not covered; the adapter compacted case sets the count by hand.
- agent-manager.test.ts: "keeps the concurrency slot accounting straight while the worktree is being created": not covered.
- agent-manager.test.ts: "keeps a structured payload parseable when the worktree note is appended": dropped with structured output (R2).
- agent-manager.test.ts: "a stop that lands during the copy discards the worktree instead of running": not covered.
- agent-manager.test.ts: "fires with the worktree path, before the worktree is cleaned up": not covered; the port has no onBeforeWorktreeCleanup hook.
- agent-manager.test.ts: "cleans up anyway when the hook throws": not covered; the port has no onBeforeWorktreeCleanup hook.
- agent-manager.test.ts: "does not fire on the error path, which still cleans up": not covered; the port has no onBeforeWorktreeCleanup hook.
- agent-manager.test.ts: "does not fire for a stop that lands while the repo is still being copied": not covered; the port has no onBeforeWorktreeCleanup hook.
- agent-manager.test.ts: "does not fire for an agent that has no worktree": not covered; the port has no onBeforeWorktreeCleanup hook.
- agent-manager.test.ts: "creates no worktree for an RPC-shaped spawn when the project disabled it": not covered; only the Agent description case checks worktreeIsolation: false.
- agent-manager.test.ts: "cwd: null (RPC 'unset') behaves exactly like omitting cwd": not covered.
- agent-manager.test.ts: "cwd + isolation: worktree — worktree created FROM cwd, session runs at the copy's workPath, cleanup targets cwd's repo": not covered.
- agent-manager.test.ts: "plain worktree (no cwd) keeps the historical root working dir even when workPath differs": not covered.
- agent-manager.test.ts: "no worktree — no worktreeBase, so no isolation block in the prompt": not covered through the service.
- agent-manager.test.ts: "passes `workflow` to the runner exactly when the spawn carries a workflowId": dropped with workflows (R2).
- agent-manager.test.ts: "relative cwd throws immediately; no orphan record": not covered; adapter/rpc.ts validates cwd without a test.
- agent-manager.test.ts: "nonexistent cwd throws immediately; no orphan record": not covered; adapter/rpc.ts validates cwd without a test.
- agent-manager.test.ts: "cwd pointing at a regular file throws a curated 'not a directory' error": not covered; adapter/rpc.ts validates cwd without a test.
- agent-manager.test.ts: "non-string cwd (RPC junk) throws the curated error, not a TypeError from path internals": not covered; adapter/rpc.ts validates cwd without a test.
- agent-manager.test.ts: "removes a queued agent from the queue and marks it stopped": not covered.
- agent-manager.test.ts: "returns records sorted by startedAt descending (most recent first)": not covered; no test asserts the order of list().
- agent-manager.test.ts: "does not report a run again, or change its status, when it settles afterwards": not covered after the session's end.
- agent-manager.test.ts: "does not report a run again when it rejects afterwards": not covered.
- agent-manager.test.ts: "reports a resumed run once, and lets a later resume report again": not covered.
- agent-manager.test.ts: "returns 0 when there are no running or queued agents": dropped; the service has no abortAll count.
- agent-manager.test.ts: "is true while a background agent is running, false after it completes": not covered; the service has no hasRunning for a print-mode hold.
- agent-manager.test.ts: "is true when an agent is queued behind the concurrency limit": not covered; the service has no hasRunning for a print-mode hold.
- agent-manager.test.ts: "an external stop still wins over a late failure resolution": not covered.
- agent-manager.test.ts: "resume(): a failed final turn on the resumed prompt maps to error too": not covered.
- agent-manager.test.ts: "resume(): partial text produced before the failure is kept as result": not covered.
- agent-manager.test.ts: "a nested child failing does not free a pool slot either": not covered.
- agent-manager.test.ts: "a spawn that throws at drain time errors that record and keeps draining": not covered.
- agent-manager.test.ts: "a cwd deleted between enqueue and drain is caught by the re-validation": not covered.
- agent-manager.test.ts: "raising maxConcurrent releases queued agents immediately": not covered; settings are read at each spawn (Section 2.1 "Definition refresh").
- agent-manager.test.ts: "a steer that rejects does not fail the run": not covered.
- agent-manager.test.ts: "waits for agents that were still QUEUED when it was called": not covered; the service has no waitForAll.
- agent-manager.test.ts: "resolves immediately when nothing is pending": not covered; the service has no waitForAll.
- agent-manager.test.ts: "waits for an agent whose worktree is still being created": not covered; the service has no waitForAll.
- agent-manager.test.ts: "does not reject when an agent fails": not covered; the service has no waitForAll.
- agent-manager.test.ts: "prunes the process cwd and every repo a worktree was created from": changed; the service never runs a repository-wide git worktree prune (Section 2.1 "Worktree preservation").
- agent-manager.test.ts: "a failed final turn on a background resume maps to error and still notifies": not covered.
- agent-manager.test.ts: "queues a background resume when the concurrency pool is full": not covered.
- agent-manager.test.ts: "refuses to background-resume an agent whose run is still in flight": not covered.
- agent-manager.test.ts: "refuses to background-resume an agent that is still queued": not covered.
- agent-manager.test.ts: "fires onStarted when the run starts, not when a queued resume is registered": not covered.
- agent-manager.test.ts: "never fires onStarted for a queued resume that is stopped before it drains": not covered.
- agent-manager.test.ts: "assigns the type handle as well as the alias": not covered; no test spawns with a name.
- agent-manager.test.ts: "reaches the same agent by either name": not covered; no test spawns with a name.
- agent-manager.test.ts: "numbers an alias that collides with its own type handle": not covered.
- agent-manager.test.ts: "stops a later type handle from colliding with an existing alias": not covered.
- agent-manager.test.ts: "gives an unnamed agent no alias at all": not covered.
- agent-manager.test.ts: "records no session file for an in-memory session": not covered.
- agent-manager.test.ts: "relabels the record with the model the session actually runs": not covered; the model display is phase 2 (Section 7, agent-model-display).
- agent-manager.test.ts: "keeps the requested level when pi clamps it to what the model supports": not covered; the model display is phase 2 (Section 7, agent-model-display).
- agent-manager.test.ts: "records no request when the level was honored": not covered; the model display is phase 2 (Section 7, agent-model-display).
- agent-manager.test.ts: "does not overwrite a request the agent file already overrode": not covered; the model display is phase 2 (Section 7, agent-model-display).
- agent-manager.test.ts: "gives a spawn that carried no invocation one to display": not covered; the model display is phase 2 (Section 7, agent-model-display).
- agent-manager.test.ts: "keeps the requested level when the session reports no level of its own": not covered; the model display is phase 2 (Section 7, agent-model-display).
- agent-manager.test.ts: "leaves the invocation alone when the session reports no model": not covered; the model display is phase 2 (Section 7, agent-model-display).
- agent-runner-e2e.test.ts: "disallowedTools removes a real extension tool from the live session": not covered; no test disallows an extension tool.
- agent-runner-e2e.test.ts: "the ext: allowlist flip mutes a loaded-but-unselected extension in real pi-mono": not covered; no test asserts that an unselected extension's tools leave the request.
- agent-runner-settings.test.ts: "clamps negative values to 1": changed; out-of-range values are dropped with one warning instead of clamped (plan T2 `settings.ts`).
- agent-runner-settings.test.ts: "clamps 0 to 1": changed; `graceTurns: 0` is dropped with one warning instead of clamped (plan T2 `settings.ts`).
- agent-runner-settings.test.ts: "treats 0 as unlimited": not covered at run time; the settings test documents the default 0, but no runner test runs with `maxTurns: 0`.
- agent-runner.test.ts: "marks a workflow child so its prompt says the final text is the return value": dropped with workflows (plan Section 2.1, R2).
- agent-runner.test.ts: "leaves the block off a schema-bearing child, which answers through StructuredOutput": dropped with structured output (R2).
- agent-runner.test.ts: "keeps StructuredOutput reachable with no tools: allowlist": dropped with structured output (R2).
- agent-runner.test.ts: "keeps StructuredOutput in the static allowlist when extensions are off": dropped with structured output (R2).
- agent-runner.test.ts: "does not let disallowed_tools remove StructuredOutput": dropped with structured output (R2).
- agent-runner.test.ts: "injects nothing when no schema was asked for": dropped with structured output (R2).
- agent-runner.test.ts: "returns the captured payload and does not retry when the child complies": dropped with structured output (R2).
- agent-runner.test.ts: "prompts once more when the child answered in prose, and fails if it still does": dropped with structured output (R2).
- agent-runner.test.ts: "recovers when the second prompt produces the payload": dropped with structured output (R2).
- agent-runner.test.ts: "carries the validation error into the retry prompt": dropped with structured output (R2).
- agent-runner.test.ts: "does not retry a child that was aborted": dropped with structured output (R2).
- agent-runner.test.ts: "omits modelRuntime when the legacy registry does not expose one": not applicable; the child always takes `parent.modelRuntime` (runner/run.ts), and no legacy registry exists in-tree.
- agent-runner.test.ts: "suppresses AGENTS.md/CLAUDE.md/APPEND_SYSTEM.md for subagents": not covered; runner/run.ts sets `noContextFiles` and `appendSystemPromptOverride`, but no test asserts either.
- agent-runner.test.ts: "sets the agent name as session name before binding extensions": not covered.
- agent-runner.test.ts: "suffixes the session name with a short agentId so parallel spawns are distinguishable": not covered.
- agent-runner.test.ts: "flags the failure even when an EARLIER turn produced text (no masking)": not covered; the fork-subagents-tools case puts the partial text in the failing message itself.
- agent-runner.test.ts: "flags a run whose final turn hit the token limit with no text (#144 residual)": not covered; runner/run.ts maps an empty `length` stop to an error, and no test drives it.
- agent-runner.test.ts: "does NOT flag a length stop that produced text (truncated answer completes)": not covered.
- agent-runner.test.ts: "does NOT flag an empty final turn that stopped cleanly (no false failures)": not covered.
- agent-runner.test.ts: "resumeAgent applies the same rule": not covered; no test fails a resumed turn.
- agent-runner.test.ts: "resume whose new turn fails empty does NOT return the previous turn's answer (#144)": not covered.
- agent-runner.test.ts: "resume that produces partial text before failing returns only THIS resume's text": not covered.
- agent-runner.test.ts: "collector: a toolResult/user message_start no longer wipes collected assistant text": not covered.
- agent-runner.test.ts: "runAgent normalizes partial usage objects to 0 for missing fields": not covered.
- agent-runner.test.ts: "runAgent skips the callback when message_end has no usage field": not covered.
- agent-runner.test.ts: "forwards compaction_end events to onCompaction (only when not aborted)": not covered; the adapter test injects the service's `compacted` event instead of compacting a child.
- agent-runner.test.ts: "returns an empty string for a session with no messages": not covered; tools/result.ts renders the conversation for `verbose`, and no test asserts it.
- agent-runner.test.ts: "formats a user-then-assistant exchange with role-prefixed lines joined by blank lines": not covered (same `verbose` rendering).
- agent-runner.test.ts: "accepts user content as content-blocks (not just strings)": not covered (same `verbose` rendering).
- agent-runner.test.ts: "emits a [Tool Calls] block listing each toolCall by name or toolName, falling back to 'unknown'": not covered (same `verbose` rendering).
- agent-runner.test.ts: "truncates toolResult content beyond 200 chars and tags it with the tool name": not covered (same `verbose` rendering).
- agent-runner.test.ts: "emits [Tool Calls] but no [Assistant] when the assistant only made tool calls": not covered (same `verbose` rendering).
- agent-runner.test.ts: "keeps the session in memory when rememberAgents is off": not covered.
- agent-runner.test.ts: "lets frontmatter override rememberAgents in both directions": not covered.
- agent-runner.test.ts: "leaves a nested child in memory, since nothing can address it later": not covered.
- agent-runner.test.ts: "still persists a nested child that asks for it in frontmatter": not covered.
- agent-runner.test.ts: "nests under the configured session directory, and links to the parent session": partial; the runner suite proves the nesting, but no test asserts the `parentSession` link.
- agent-runner.test.ts: "derives pi's project session directory when nothing configures one": superseded; the port nests under the parent session's own directory and does not re-derive pi's path encoding.
- agent-runner.test.ts: "gives create and open the same directory, so a /new off a resume stays nested": not covered.
- agent-runner.test.ts: "nests under PI_CODING_AGENT_SESSION_DIR, which still wins over the settings value": not covered.
- agent-runner.test.ts: "nests a persisted nested child exactly like a top-level one": not covered.
- agent-runner.test.ts: "enumerates tools across multiple loaded extensions": not covered; no test asserts two extensions' tools in one request.
- agent-runner.test.ts: "disallowedTools removes both built-ins and extension tools": partial; the scope test disallows a Pi tool only, and no test disallows an extension tool.
- agent-runner.test.ts: "blocks the tool at runtime even though it was injected as a customTool": not covered; no test calls the `beforeToolCall` veto in runner/scope.ts.
- agent-runner.test.ts: "a tool registered during session_start reaches the active set": not covered; the runner suite proves only that a late tool is narrowed out.
- agent-runner.test.ts: "a tool registered after bind is picked up on the next turn_end": not covered (same reason).
- agent-runner.test.ts: "ext: admits a late tool from the selected extension but not from others": not covered; the runner suite narrows within one extension.
- agent-runner.test.ts: "beforeToolCall blocks an out-of-scope tool and delegates otherwise": not covered.
- agent-runner.test.ts: "beforeToolCall preserves a hook pi installed before us": not covered.
- agent-runner.test.ts: "scope outlives runAgent so resumed turns stay narrowed": not covered.
- agent-runner.test.ts: "isolated keeps the static allowlist — no live scoping installed": changed; runner/run.ts installs live scoping for every child, and the runner suite proves an isolated child loads no extension.
- agent-runner.test.ts: "adds no alias for a loose file with no enclosing package.json": not covered; the scope test checks only the positive package alias.
- agent-runner.test.ts: "adds no alias when the nearest manifest does not declare this entry": not covered.
- agent-runner.test.ts: "adds no alias when the nearest package.json has no pi manifest": not covered.
- agent-runner.test.ts: "does not climb past a node_modules boundary into a consumer's manifest": not covered.
- agent-runner.test.ts: "keeps an absolute path as-is": not covered; the scope test resolves a relative path only.
- agent-runner.test.ts: "expands a leading ~ to the home directory": not covered.
- agent-runner.test.ts: "warns but proceeds when a path entry fails to load": not covered.
- agent-runner.test.ts: "isolated: true + exclude — excludes nulled, no warnings": not covered.
- agent-runner.test.ts: "exclude matches case-insensitively": not covered.
- agent-runner.test.ts: "splits on the first / so tool names may contain /": not covered.
- agent-runner.test.ts: "skips empty name and empty tool halves": not covered.
- agent-runner.test.ts: "lowercases the extension name but preserves tool-name case": partial; the scope test covers the extension half only.
- agent-runner.test.ts: "ext:foo/Bar narrowing is case-sensitive on the tool half": not covered.
- agent-runner.test.ts: "any ext: entry flips extension tools to an allowlist — non-selected extensions muted": not covered; no test asserts that a loaded, unselected extension's tools leave the request.
- agent-runner.test.ts: "'*' alongside ext: keeps all built-ins while the flip still applies": not covered.
- agent-runner.test.ts: "ext: composes with a path-loaded extension via its canonical name": not covered; the runner suite uses a discovered extension, not a path entry.
- agent-runner.test.ts: "disallowedTools removes a tool reached via an ext: selector": not covered.
- agent-runner.test.ts: "prefers an explicit value over the agent's own and the project default": changed by T2; frontmatter `max_turns` wins over the tool parameter (models.test.ts "invocation merge").
- agent-runner.test.ts: "falls back to the project default when the agent sets none": not covered; `defaultMaxTurns` reaches no runner or service test.
- agent-runner.test.ts: "treats an explicit 0 as unlimited rather than as 'no opinion'": not covered.
- agent-runner.test.ts: "is unlimited when nothing sets a limit": not covered.
- agent-runner.test.ts: "does not re-steer on every turn once the soft limit latched": not covered; the runner suite does not count the wrap-up messages.
- agent-runner.test.ts: "treats maxTurns 0 as unlimited": not covered.
- agent-runner.test.ts: "is unlimited when nothing configures a limit": not covered.
- agent-runner.test.ts: "falls back to the global default when the call sets no limit": not covered.
- agent-runner.test.ts: "an explicit maxTurns beats the global default": not covered.
- agent-runner.test.ts: "reports each turn to the caller's counter": not covered.
- agent-runner.test.ts: "registers nothing when no signal is supplied": not covered.
- agent-runner.test.ts: "trusts `find` when the registry cannot enumerate availability": not applicable; the port resolves against the available model list (T2).
- agent-runner.test.ts: "falls back to the parent for a model string with no provider prefix": changed by T2; the port fuzzy-matches a bare name (models.test.ts "model resolution").
- agent-runner.test.ts: "returns undefined when neither a config model nor a parent model exists": not covered.
- agent-runner.test.ts: "disposes the loader once the run completes": changed; the loader lives until teardown so a finished child stays resumable (plan Section 2.1 "Child teardown"); teardown and eviction tests prove the disposal.
- agent-runner.test.ts: "disposes the loader when the prompt rejects": not covered.
- agent-runner.test.ts: "runs on a pi whose loader has no dispose": not applicable; the in-tree `DefaultResourceLoader` always has `dispose`.
- agent-runner.test.ts: "keeps the run's result when dispose throws": partial; the runner suite throws from the session's `dispose`, not the loader's.
- agent-tool-error-rendering.test.ts: "shows a Pi tool error instead of structured terminal status": rendering is phase 2 (Section 7); phase 1 covers the result text only.
- agent-tool-error-rendering.test.ts: "shows the real result text for %s": rendering is phase 2 (Section 7); phase 1 covers the result text only.
- agent-types.test.ts: "default agents do not lock strategy fields (run_in_background / inherit_context / isolated)": not covered; the default-agent test does not assert that runInBackground, inheritContext and isolated stay unset.
- agent-types.test.ts: "user agents are unaffected when defaults are disabled": not covered; the disableDefaultAgents assertion builds a registry with no user agents.
- agent-types.test.ts: "getConfig falls back to the hardcoded config when defaults are disabled and no user agents exist": not covered; no test resolves a fallback while the defaults are disabled.
- agent-types.test.ts: "general-purpose can be disabled but fallback still works": not covered; no test disables general-purpose and then resolves an unknown type.
- agent-types.test.ts: "user agent overrides default with same name": not covered; no test registers a user agent named like a default agent.
- agent-types.test.ts: "clears the layer on the next registerAgents": changed; the port has no module-level skill layer, because `buildAgentRegistry` is pure and rebuilt per load (plan T1 `registry.ts`).
- background-resume-wiring.test.ts: "appends to the agent's existing transcript instead of truncating it": not covered for the .output transcript; the resume case checks the session file only.
- background-resume-wiring.test.ts: "reports the record's own type, not the caller's ignored subagent_type": not covered.
- background-resume-wiring.test.ts: "refuses a second background resume while the first run is in flight": not covered.
- child-session-shutdown.test.ts: "quit waits for the child's shutdown handlers to finish": deferred to phase 2; the parent's cleanup hook starts teardowns without awaiting them (plan Section 7 "Not proved by this plan", Section 8).
- child-session-shutdown.test.ts: "skips the emit when no extension handles session_shutdown": not covered.
- child-session-shutdown.test.ts: "degrades on a stubbed session instead of throwing": not applicable; children are always real `AgentSession`s, and the throwing-dispose and throwing-listener cases cover the no-unhandled-rejection part.
- clear-completed-wiring.test.ts: "session_before_switch (user switches sessions) does NOT wipe the unread result": changed; a session switch ends the session's service and its records (R6).
- clear-completed-wiring.test.ts: "session_start (/resume) does NOT wipe the unread result": changed for /resume, which replaces the session (R6); /reload keeps the records.
- context.test.ts: "joins multiple text blocks with newlines": not covered.
- context.test.ts: "treats a text block with missing text field as empty": not covered.
- context.test.ts: "returns empty string when no entries produce extractable content": not covered; the prompt test checks only an empty branch.
- context.test.ts: "trims and skips whitespace-only messages": not covered.
- context.test.ts: "ignores assistant messages whose only content is non-text blocks": not covered.
- cross-extension-rpc.test.ts: "returns error when no active session": changed; the adapter resolves the service per session and has no sessionless state to test.
- cross-extension-rpc.test.ts: "returns error when the agent fails to start after spawn returns": not covered over RPC.
- cross-extension-rpc.test.ts: "passes options through to manager.spawn": partly covered; `isBackground` and `cwd` are exercised, the other options are not.
- cross-extension-rpc.test.ts: "refuses to stop a workflow's agent": dropped with workflows (R2); the error string survives for nested agents.
- cross-extension-rpc.test.ts: "resolves a string model to a Model instance before manager.spawn": not covered over RPC.
- cross-extension-rpc.test.ts: "passes a Model object through unchanged": not covered over RPC.
- cross-extension-rpc.test.ts: "surfaces a clear error when the model string can't be resolved": not covered over RPC.
- cross-extension-rpc.test.ts: "treats an explicit null model as no override at all": not covered over RPC.
- cross-extension-rpc.test.ts: "errors when ctx has no modelRegistry but a string model is given": changed; the service resolves models through the session's model runtime, never through an absent registry.
- cross-extension-rpc.test.ts: "flushes a terminal event after a startup-error reply": not covered.
- cross-extension-rpc.test.ts: "refuses an out-of-scope string override, listing what is allowed": not covered over RPC; the resolver is covered by T2.
- cross-extension-rpc.test.ts: "refuses an out-of-scope Model object override too": not covered over RPC.
- cross-extension-rpc.test.ts: "spawns normally when the override is in scope": not covered over RPC.
- cross-extension-rpc.test.ts: "does not check scope while the setting is off": not covered over RPC.
- custom-agents.test.ts: "uses sensible defaults when no frontmatter at all": not covered; every parse test supplies a frontmatter block.
- custom-agents.test.ts: "exclude_extensions omitted or none → undefined": not covered; no test parses `exclude_extensions: none`.
- custom-agents.test.ts: "tools: 'all' is a case-insensitive alias for '*' (closes #75)": partly covered; only lowercase `all` is parsed, not `ALL` or `All`.
- custom-agents.test.ts: "partitions tools: ext: entries out of builtinToolNames into extSelectors": changed; the port keeps `ext:` selectors inside `tools` (plan T1 `types.ts`) and partitions them in the child tool scope.
- custom-agents.test.ts: "passes through thinking level as-is (no validation)": changed and not covered at parse time; the port's invocation merge drops an unknown thinking parameter (models.test.ts), and no test parses `thinking: turbo`.
- custom-agents.test.ts: "loads thinking: max (pi 0.80's top level) unchanged (#147)": not covered; no test parses `thinking: max`.
- custom-agents.test.ts: "accepts max_turns: 0 as unlimited": not covered; no test parses `max_turns: 0`.
- custom-agents.test.ts: "rejects negative max_turns": not covered; no test parses a negative `max_turns`.
- custom-agents.test.ts: "defaults unknown prompt_mode to replace": not covered; no test parses an unknown `prompt_mode`.
- custom-agents.test.ts: "skips non-.md files": not covered; no test places a non-.md file in an agent directory.
- custom-agents.test.ts: "allows agents with names matching defaults (overrides them)": not covered; no test loads a user file named like a default agent.
- custom-agents.test.ts: "handles empty body with frontmatter": not covered; no test asserts an empty systemPrompt from a body-less file.
- custom-agents.test.ts: "supports inherit_extensions as alternative to extensions": dropped; the aliases are legacy spellings (plan Section 2.1, "Frontmatter spellings"), and the unknown-key warning test proves the warning.
- custom-agents.test.ts: "falls back to the filename for an empty or blank declared name": not covered; no test parses a blank `name:`.
- custom-agents.test.ts: "trims a declared name so it matches what the user meant to type": not covered; no test parses a padded `name:`.
- custom-agents.test.ts: "leaves displayName unset so the badge falls back to the type": not covered for displayName; the badge itself is Phase 2 (`agent-color`).
- custom-agents.test.ts: "accepts a name Claude Code accepts, however unlike a type it looks": not covered; no test parses a name with spaces or capitals.
- custom-agents.test.ts: "does not claim the rejected file was overriding its filename's agent": not covered; no test asserts the absence of an override warning.
- custom-agents.test.ts: "lets a later file win a declared-name clash, as a filename clash always did": partly covered; only skill agent directories are tested, not a user agent directory.
- custom-agents.test.ts: "rejects invalid memory scope": not covered; no test parses an invalid `memory:` value.
- custom-agents.test.ts: "rejects invalid isolation mode": not covered; no test parses an invalid `isolation:` value.
- custom-agents.test.ts: "warns when a skipped file was overriding an agent that stays resolvable": not covered; no test asserts the "now loads from" warning.
- custom-agents.test.ts: "does not claim a fallback when the shadowed definition is disabled": not covered; no test asserts the absence of the fallback warning.
- custom-agents.test.ts: "does not claim a fallback when the skipped file overrode nothing": not covered; no test asserts the absence of the fallback warning.
- custom-agents.test.ts: "warns when a file breaks, not while it stays broken": not covered; no test reloads a broken file and counts its warnings.
- custom-agents.test.ts: "warns once per message, not on every reload": not covered; no test counts warnings across repeated loads of a broken file.
- custom-agents.test.ts: "honors PI_CODING_AGENT_DIR for global custom agent discovery": changed; the loader takes `agentDir` as an argument (plan T1 `load.ts`), which the discovery tests exercise.
- custom-agents.test.ts: "preserves an explicitly narrowed tool list": deferred; eject is Phase 2 (plan Section 2.1, R2 and "Definition refresh").
- custom-agents.test.ts: "preserves the full built-in set": deferred; eject is Phase 2.
- custom-agents.test.ts: "preserves an empty tool list instead of widening it to every built-in": deferred; eject is Phase 2.
- custom-agents.test.ts: "preserves the scalar and list fields it writes": deferred; eject is Phase 2.
- custom-agents.test.ts: "preserves an explicit run_in_background: false instead of dropping it": deferred; eject is Phase 2.
- custom-agents.test.ts: "leaves run_in_background unset when the config doesn't pin it": deferred; eject is Phase 2.
- custom-agents.test.ts: "preserves the extension and skill list fields": deferred; eject is Phase 2.
- custom-agents.test.ts: "preserves the boolean forms of extensions and skills": deferred; eject is Phase 2.
- custom-agents.test.ts: "preserves allowed_subagents in both its list and `all` forms": deferred; eject is Phase 2.
- custom-agents.test.ts: "preserves a description containing a colon": deferred; eject is Phase 2.
- e2e/isolated-provider.e2e.test.ts: "ctx.modelRegistry.runtime is reachable and IS the runtime it wraps": superseded; the child takes `parent.modelRuntime` directly, and every suite child reaches the parent's faux provider through it.
- e2e/loader-lifecycle.e2e.test.ts: "does not rescan once runAgent has returned": changed; the loader lives until teardown so a finished child stays resumable (plan Section 2.1 "Child teardown"); teardown and eviction tests prove the disposal.
- e2e/loader-lifecycle.e2e.test.ts: "control: a live loader rescans when a skill changes": not applicable; the control only calibrates the rescan probe.
- e2e/output-transcript.e2e.test.ts: "writes the prompt once, then the conversation, and no system messages": partial; the runner suite writes no tool turn, so the toolResult entry is unproven.
- e2e/turn-limit-steer.e2e.test.ts: "reaches the agent on its next turn and bypasses input handlers": partial; the runner suite proves the next-turn wrap-up, but no test proves the steer bypasses input handlers or checks the Agent result's "wrapped up at the turn limit" text.
- e2e/usage-reaches-session-stats.e2e.test.ts: "leaves the context-window percentage alone": not covered; core Pi computes the context percentage and the port leaves it unchanged, but no test compares it after a reported usage.
- enabled-models.test.ts: "readEnabledModels" (all 9 cases): changed; the port calls `settingsManager.getEnabledModels()` (plan Section 2.1, "`enabledModels`"), so no subagent test reads the settings files.
- enabled-models.test.ts: "resolves only against available models when getAvailable present": not covered; no scope test lists an enabled model missing from the available models.
- enabled-models.test.ts: "is case-insensitive": not covered; no scope test uses a differently cased enabledModels entry.
- enabled-models.test.ts: "returns undefined for bare id (pi always writes provider/modelId)": not covered; no scope test uses a bare id.
- enabled-models.test.ts: "skips empty string patterns": not covered; no scope test uses an empty pattern.
- ext-templates-e2e.test.ts: "every template on disk is discovered, registered, and self-describing": not applicable; the check guards the old fixture directory, which the port does not keep.
- ext-templates-e2e.test.ts: "$name → active tools and system prompt match the template" (lazy-no-selector, lazy-ext-selected): not covered; no test admits a tool registered at session_start.
- ext-templates-e2e.test.ts: "$name → active tools and system prompt match the template" (all-and-alpha-selected, beta-selected-mutes-alpha, lazy-ext-unselected): not covered; no test asserts that an unselected extension's tools leave the request.
- ext-templates-e2e.test.ts: "$name → active tools and system prompt match the template" (disallow-alpha-write): not covered; no test disallows an extension tool.
- ext-templates-e2e.test.ts: "$name → active tools and system prompt match the template" (tools-none): not covered; `tools: none` is parsed in definitions.test.ts, and no child test runs it.
- ext-templates-e2e.test.ts: "$name → active tools and system prompt match the template" (fmt-quoted-csv): not covered; definitions.test.ts reads unquoted CSV and a flow array only.
- fallback-subagent-wiring.test.ts: "carries the fallback note on the background branch too": not covered; the fallback note test runs in the foreground only.
- fallback-subagent-wiring.test.ts: "never persists a blank type into a scheduled job": dropped; scheduling is removed (R2, plan Section 2.3).
- fallback-subagent-wiring.test.ts: "never blocks resume, which ignores subagent_type entirely": not covered; no resume test passes an unknown type under `fallbackSubagent: none`.
- foreground-concurrency-print-mode-e2e.test.ts: "runs them concurrently when the limit is unset — the detector works": not covered.
- foreground-concurrency-wiring.test.ts: "resolves a queued call as STOPPED when the turn is interrupted": not covered.
- foreground-concurrency-wiring.test.ts: "says it is queued in the live tool result, then stops saying it": not ported; the phase 1 `Agent` tool sends no live update (`tools/agent.ts` ignores `onUpdate`), so a queued foreground call shows nothing until it returns. Open for the phase review.
- foreground-concurrency-wiring.test.ts: "leaves blocking calls unbounded when the setting is unset": not covered; the settings case checks the default value only.
- foreground-concurrency.test.ts: "never queues a workflow's children, which the run already bounds": dropped with workflows (R2).
- foreground-concurrency.test.ts: "is independent of the background pool, in both directions": not covered in both directions.
- foreground-concurrency.test.ts: "starts a bypassQueue spawn at the limit, and still counts its slot": not covered; the port has no bypassQueue.
- foreground-concurrency.test.ts: "resolves — never rejects — when a queued agent is aborted": not covered for a caller's abort; only the session's end is tested.
- foreground-concurrency.test.ts: "releases a queued agent when the caller's signal aborts (Esc)": not covered.
- foreground-concurrency.test.ts: "marks an aborted queued agent consumed when a caller is blocking on it": not covered.
- foreground-concurrency.test.ts: "leaves an aborted queued agent unconsumed when it is detached": not covered.
- foreground-concurrency.test.ts: "never enqueues a spawn whose signal is already aborted": not covered.
- foreground-concurrency.test.ts: "stops an immediate spawn whose signal is already aborted, pool off": not covered.
- foreground-concurrency.test.ts: "frees the slot when a foreground agent fails": not covered.
- foreground-concurrency.test.ts: "frees the slot exactly once when a running agent is aborted": not covered.
- foreground-concurrency.test.ts: "rethrows a drain-time startup failure, and keeps draining": not covered.
- foreground-concurrency.test.ts: "drains immediately when the limit is raised or cleared": not covered; settings are read at each spawn (Section 2.1 "Definition refresh").
- foreground-concurrency.test.ts: "releases the slot a cleared limit no longer describes": not covered.
- foreground-concurrency.test.ts: "does not release a slot a newly-set limit was never charged": not covered.
- foreground-concurrency.test.ts: "counts a queued foreground agent as active, and waitForAll waits it out": not covered; the service has no waitForAll.
- foreground-concurrency.test.ts: "fires each caller's onSpawned hook when its own deferred spawn starts": dropped; no onSpawned callback in the rebuilt service (R1).
- foreground-concurrency.test.ts: "reports how many are ahead when a spawn is queued": not covered.
- foreground-result-retrieval.test.ts: "survives a subagent session's OWN activation lifecycle (adversarial: cross-activation eviction)": not covered; R3 removes the shared manager whose lifecycle handlers caused the eviction.
- group-join.test.ts: "dispose() clears pending timers so a partial delivery never fires post-dispose": not covered.
- invocation-config.test.ts: "defaults booleans to false when neither config nor params set them": partly covered; only runInBackground is asserted with empty params, not inheritContext or isolated.
- invocation-config.test.ts: "collapses a param isolation of \"off\" to undefined": not covered; no test passes `isolation: "off"` as a tool parameter.
- invocation-config.test.ts: "records nothing when the caller got what they asked for": not covered; no test passes equal values on both sides.
- invocation-config.test.ts: "records each field independently": not covered; no test overrides only one of model and thinking.
- invocation-config.test.ts: "ignores join mode for foreground agents": not covered; no test asserts that a foreground agent carries no join mode.
- isolation-param.test.ts: "offers a value meaning 'no isolation', not just 'worktree'": not covered; tools/agent.ts declares "off", and no test asserts the schema values.
- isolation-param.test.ts: "lists the inert value first": not covered.
- isolation-param.test.ts: "warns that a worktree cannot see uncommitted work": not covered.
- memory.test.ts: "throws on names with backslash": not covered; the memory test refuses traversal, a leading dot, a slash, an empty name and 129 characters.
- memory.test.ts: "throws on names with null byte": not covered.
- memory.test.ts: "throws on names with spaces": not covered.
- memory.test.ts: "rejects names with spaces": not covered.
- memory.test.ts: "rejects names with special characters": not covered.
- memory.test.ts: "allows hyphens, underscores, and dots in names": not covered.
- memory.test.ts: "allows valid names": not covered beyond plain names such as "keeper".
- memory.test.ts: "buildMemoryBlock > includes scope label in header": not covered.
- memory.test.ts: "buildReadOnlyMemoryBlock > includes scope label in header": not covered.
- memory.test.ts: "does not mention memory directory path for write access": not covered.
- model-resolver.test.ts: "matches 'Opus 4.6' via model name": not covered; no test resolves by display name.
- model-resolver.test.ts: "matches 'anthropic opus' across provider and id": not covered; no test resolves a multi-part query.
- model-resolver.test.ts: "'sonnet 4.5' resolves to the 4.5 model via name": not covered; no test resolves by display name.
- model-resolver.test.ts: "'4-6' picks the 4.6 model": not covered; no test resolves a version-only query.
- model-resolver.test.ts: "empty string matches a model (multi-part vacuous truth)": not covered.
- model-resolver.test.ts: "uses getAvailable when present (filters to configured models)": changed; `resolveModel` takes the available list as an argument, and no test proves the caller passes only authenticated models.
- model-resolver.test.ts: "describeModel" (both cases): deferred; the model label is display code (Phase 2, `agent-model-display`).
- model-scope.test.ts: "is a no-op when no model was resolved": not covered; every scope case resolves a model.
- model-scope.test.ts: "is a no-op when enabledModels resolves to nothing usable": changed; the port resolves `anthropic/*` through Pi's enabledModels rules and refuses out-of-scope models (plan Section 2.1, "`enabledModels`").
- model-scope.test.ts: "treats scope as case-insensitive on both sides": not covered; no scope test uses differently cased entries.
- nested-tools.test.ts: "allows any enabled agent when allowed_subagents is omitted": changed; an agent without `allowed_subagents` cannot nest (T6, Section 2.1 "Child lineage"), and `allowed_subagents: all` on a non-isolated agent is not tested.
- nested-tools.test.ts: "keeps agent discovery rooted in inherited config, not the working directory": not covered for nested spawns; only the rewrite maps assert the owner's project.
- nested-tools.test.ts: "resolves nested types without touching the process-global registry": dropped; the port has no global registry (Section 7 drops `manager-registry-guard`).
- nested-tools.test.ts: "applies the scopeModels allowlist to a caller-supplied model": not covered for nested spawns.
- nested-tools.test.ts: "reports a background child that fails to start as a tool error": not covered.
- nested-tools.test.ts: "waits for a queued owned child to start and settle": changed; nested children occupy no pool slot and never queue (Section 2.1 "Pool eligibility").
- nested-tools.test.ts: "aborts a nested result wait without aborting the owned child": not covered for nested waits; the top-level case is covered by T5.
- nested-tools.test.ts: "still rejects unknown types when the project configures a fallback": partly covered; the refusal runs under the default fallback, not under a configured `fallbackSubagent`.
- nested-tools.test.ts: "flags a truncated child run instead of passing partial output off as complete": not covered for nested results.
- nested-tools.test.ts: "uses the fetchable wording when the parent polls a background child by id": not covered.
- nested-tools.test.ts: "keeps a failed child's partial output alongside the error": not covered for nested results; the top-level case is covered by T5.
- nested-tools.test.ts: "attributes spend up the whole ancestor chain, not just one level": not covered; the port test has one nesting level.
- nested-tools.test.ts: "files a nested transcript under the root session, honoring output_transcript": the `output_transcript: false` case is not covered for nested agents.
- nested-tools.test.ts: "floors a negative depth at 0 rather than storing it": changed; an out-of-range `maxSubagentDepth` is dropped with a warning (T2 settings), not clamped.
- nested-tools.test.ts: "truncates a fractional depth toward zero": changed; a non-integer `maxSubagentDepth` is dropped with a warning (T2 settings), not truncated.
- notification-boundary.test.ts: "delivers unread completions once, consolidated, when the turn ends": not covered; the turn-boundary case parks one agent per turn.
- notification-boundary.test.ts: "treats a run whose signal was aborted as interrupted even when the tail is a tool result": not covered; notifications.ts judges an interruption only from an aborted assistant message.
- notification-boundary.test.ts: "keeps completions parked across a provider error that pi retries": not covered; delivery waits for agent_settled (Section 2.1 "Notifications").
- notification-boundary.test.ts: "releases completions parked by an errored run once pi settles without a retry": not covered; delivery waits for agent_settled (Section 2.1 "Notifications").
- notification-boundary.test.ts: "retires a parked completion when its agent is resumed, and announces the new run when it ends": not covered.
- notification-boundary.test.ts: "keeps delivering to the next prompt after an abort until a new turn starts": not covered past the first held notification.
- output-file-path.test.ts: "keeps distinct cwds in separate subdirectories under the shared root": not covered.
- output-file-path.test.ts: "creates the root owner-only": not covered; runner/transcript.ts sets mode 0700, and no test checks it.
- output-file-path.test.ts: "re-tightens a pre-existing world-readable root": not covered.
- output-file.test.ts: "handles a POSIX root path": not covered; runner/transcript.ts inlines the cwd encoding, and the runner suite checks one POSIX path.
- output-file.test.ts: "encodes a Windows drive-letter path by stripping the drive prefix": not covered.
- output-file.test.ts: "handles lowercase Windows drives": not covered.
- output-file.test.ts: "handles a Windows path written with forward slashes": not covered.
- output-file.test.ts: "preserves server and share for UNC paths": not covered.
- output-file.test.ts: "handles mixed separators": not covered.
- output-file.test.ts: "collapses runs of leading dashes after separator replacement": not covered.
- output-file.test.ts: "returns an empty string for an empty cwd": not covered.
- output-file.test.ts: "leaves a relative-looking path with no leading separator alone": not covered.
- output-file.test.ts: "writes a resumed run's prompt, which no initial entry covers": not covered; no test reads a transcript after a resume.
- output-file.test.ts: "writes nothing past the initial entry until turn_end fires": not covered.
- output-file.test.ts: "tags assistant, user, and tool messages with the correct type field": partial; the runner suite writes user and assistant entries, and no toolResult entry.
- output-file.test.ts: "ignores session events other than turn_end": not covered.
- output-file.test.ts: "flushes the not-yet-written tail before compaction discards it (#145)": partial; the compaction case compacts between turns, after every message is flushed.
- output-file.test.ts: "re-anchors after the overflow-retry trim, not at compaction_end (#145)": not covered.
- output-file.test.ts: "does not re-anchor on aborted or failed compaction (#145)": not covered.
- output-file.test.ts: "cleanup() does a final flush and detaches the subscription": not covered.
- output-file.test.ts: "starts at the given index so a resume appends only its own turns": not covered.
- output-transcript-wiring.test.ts: "also suppresses the background transcript": not covered; the runner suite builds the child directly, with no background spawn.
- output-transcript-wiring.test.ts: "suppresses the transcript project-wide when subagents.json sets outputTranscript false": not covered; the settings test documents only the `outputTranscript` default.
- output-transcript-wiring.test.ts: "lets agent frontmatter output_transcript true override a project outputTranscript false": not covered.
- prompts.test.ts: "Plan prompt is read-only": not covered; the registry test asserts READ-ONLY for Explore only.
- prompts.test.ts: "append mode bridge contains tool reminders": not covered.
- prompts.test.ts: "append mode without parent prompt still has bridge": partial; the prompt test asserts the generic base, not the bridge or the agent's own prompt.
- prompts.test.ts: "tag appears before the env block in both modes": partial; the exact replace-mode string fixes the order in replace mode only.
- prompts.test.ts: "names the parent checkout and follows the env block in both modes": partial; the prompt test checks replace mode only.
- prompts.test.ts: "worktree isolation block > stays out of the cacheable inherited prefix": not covered.
- prompts.test.ts: "is absent for an ordinary subagent, whose output a person reads": dropped with workflows (R2).
- prompts.test.ts: "tells a workflow child its final message is the return value, in both modes": dropped with workflows (R2).
- prompts.test.ts: "workflow child block > stays out of the cacheable inherited prefix": dropped with workflows (R2).
- prompts.test.ts: "composes with worktree isolation rather than displacing it": dropped with workflows (R2).
- rpc-lifecycle-gating.test.ts: "does NOT advertise or register RPC at factory time (the filtered-out case)": changed; the adapter installs and announces when the session builds its base tools (Section 2.3).
- rpc-lifecycle-gating.test.ts: "renders an RPC-spawned agent in the native widget while it is running": the widget is phase 2 (Section 7).
- rpc-lifecycle-gating.test.ts: "shows live tool activity for an RPC-spawned background agent": the widget is phase 2 (Section 7).
- rpc-lifecycle-gating.test.ts: "is idempotent — a second session_start does not re-advertise or double-register": changed; `subagents:ready` is re-announced on each `/reload` (Section 2.3); single registration is covered by the one-reply ping.
- rpc-lifecycle-gating.test.ts: "wires no A.9 listeners at factory time": changed; the adapter installs at base-tool construction (Section 2.3).
- rpc-lifecycle-gating.test.ts: "on session_start subscribes to the seam and issues one skills:query pull": changed; the adapter reads the session's loaded skills in-process and publishes at install (T8), with no `skills:query` pull.
- rpc-lifecycle-gating.test.ts: "ignores a stale snapshot (lower revision)": changed; the adapter reads no snapshot revision, it rebuilds from the session's loaded skills on each `skills:changed` (T8).
- rpc-lifecycle-gating.test.ts: "widens the ready payload to carry the sessionId": not covered; the source sends `sessionId`, no test asserts the payload.
- rpc-lifecycle-gating.test.ts: "wires the seam exactly once across duplicate session_starts": not covered for the skill-agent listeners.
- rpc-lifecycle-gating.test.ts: "drops the skill layer on shutdown": not covered; only the ping listener is asserted gone after dispose.
- rpc-lifecycle-gating.test.ts: "wires the seam on the child's own bus": partly covered; the child's query answer is asserted, its `skills:changed` subscription is not.
- rpc-lifecycle-gating.test.ts: "registers nothing else: no tools, no RPC handlers, no readiness": changed; a child session gets its own adapter, which answers RPC under its lineage (Section 2.1 "Child lineage").
- rpc-lifecycle-gating.test.ts: "answers its own query with its own maps, leaving the global registry alone": changed; a child's maps come from its owner's project (Section 2.1 "Child lineage"), and no global registry exists.
- rpc-lifecycle-gating.test.ts: "unsubscribes on the child's shutdown": not covered.
- rpc-result-consumption.test.ts: "notifies for an RPC-spawned agent nobody consumed": not covered for RPC spawns; T4 covers notifications for tool spawns.
- rpc-result-consumption.test.ts: "reports an unknown agent rather than silently succeeding": not covered; `consume` is tested only on a running and a finished agent.
- settings.test.ts: "returns {} when both files are malformed JSON": changed; Pi's SettingsManager parses the files (R5), and `subagents.json` is not read (plan Section 2.3).
- settings.test.ts: "round-trips schedulingEnabled (true and false), and absence stays absent": dropped; scheduling is removed (R2, plan Section 2.3); the settings test warns on the key as unknown.
- settings.test.ts: "reads the pre-mode agentMentions booleans as their modes": dropped; boolean `agentMentions` is a legacy spelling (plan Section 2.1, "Frontmatter spellings"); the settings test drops `agentMentions: true`.
- settings.test.ts: "round-trips workflowsEnabled; drops non-boolean": dropped; workflows are removed (R2, plan Section 2.3).
- settings.test.ts: "sanitize drops non-boolean schedulingEnabled silently": dropped; scheduling is removed (R2).
- settings.test.ts: "drops values that aren't a string or `false`, without coercing them": partly covered; only an empty string is tested, not an array, null, a number or `true`.
- settings.test.ts: "accepts `none` and `false` as the disabled fallback, nothing else": partly covered; `false` and a trimmed name are tested, not `NONE` or `off`.
- settings.test.ts: "saveSettings returns false when the target dir cannot be created": not covered; no test makes `writeProjectSubagentSettings` fail.
- settings.test.ts: "warns to console.warn when an existing file is malformed": changed; Pi's SettingsManager owns file parsing and its errors (R5).
- settings.test.ts: "does NOT warn when a file is simply missing": not covered; no subagent settings test reads with both files absent.
- settings.test.ts: "applySettings" (all 26 cases): changed; the port has no module-level appliers, and the service reads settings from the session's SettingsManager at each spawn (plan Section 2.1, "Definition refresh"); the suite tests that set maxConcurrent, fallbackSubagent, reportUsage and strictAgentFiles exercise the consumers.
- settings.test.ts: "persistToastFor" (both cases): deferred; toasts belong to the settings menu (R5, Phase 2).
- settings.test.ts: "emits with persisted=false and returns warning toast on save failure": deferred; the settings menu and its save failure are Phase 2 (R5).
- skill-agents-e2e.test.ts: "registers four bundled agents with their bundled prompt and tools": the bundled `tools:` list is not asserted; the prompt and qualified name are.
- skill-agents-e2e.test.ts: "spawns a skill agent by qualified and by bare name through the spawn RPC": not covered over RPC; resolution is covered in the definitions tests.
- skill-agents-e2e.test.ts: "drops the agents and empties the map when the skill disappears from the snapshot": not covered; the port test removes one of two skills and never asserts an empty map.
- skill-agents-e2e.test.ts: "keeps a container skill's agents: only the `off` state suppresses them": not covered.
- skill-agents-e2e.test.ts: "ignores a snapshot whose revision is not a finite number": changed; the adapter reads no snapshot revision (T8).
- skill-agents-e2e.test.ts: "stays silent and inert under upstream pi, which has no skill-set seam": dropped; the port lives in-tree, where the seam always exists (Section 2.1 "Skill-bundled agents").
- skill-agents.test.ts: "treats a missing agents/ directory as the normal empty case (no warning)": not covered; every skill fixture has an agents directory.
- skill-agents.test.ts: "lets a sibling skill take a bare name a disabled agent would otherwise block": not covered; `registry.ts` skips disabled claimants, but no test has a disabled and an enabled skill claim one name.
- skill-agents.test.ts: "warns on a defensive duplicate qualified name and keeps the first": not covered; no test has two skills with one listing name, and the port emits no warning for it.
- skill-agents.test.ts: "ignores a stale snapshot (lower revision than one already processed)": not covered; no test sends a skill snapshot with an older revision.
- skills-contract.test.ts: "round-trips the committed fixture byte-for-byte": dropped; the port imports core's wire types, so no copied contract exists (Section 2.1 "Skill-bundled agents").
- skills-contract.test.ts: "parses the fixture into the copied wire types": dropped; the port imports core's wire types (Section 2.1 "Skill-bundled agents").
- skills-contract.test.ts: "skill-set-events wire declarations appear verbatim in core": dropped; the compiler checks the imported declarations (Section 2.1 "Skill-bundled agents").
- skills-contract.test.ts: "rewrite-map wire declarations appear verbatim in core": dropped; the compiler checks the imported declarations (Section 2.1 "Skill-bundled agents").
- status-note-wiring.test.ts: "foreground turn-limit abort → the Agent result flags an incomplete outcome": not covered for the Agent result text; the runner case checks the aborted status and partial text.
- status-note-wiring.test.ts: "background user-stop → get_subagent_result flags STOPPED BY THE USER (not completed)": not covered through get_subagent_result; the unit case checks the notification text.
- status-note-wiring.test.ts: "counts repeated compactions on the same agent": not covered.
- steer-subagent-wiring.test.ts: "queues the message on the record and says so": the `subagents:steered` event for a queued steer is not asserted; the queued reply text is.
- steer-subagent-wiring.test.ts: "appends a second queued steer instead of replacing the first": not covered; the port test queues one message only.
- steer-subagent-wiring.test.ts: "reports failure and emits no event when the steer throws": not covered.
- strict-agent-files-wiring.test.ts: "aborts activation naming the file when enabled": changed; base tools have no activation to abort (R3), so the session is kept, the description lists only the defaults, and a spawn fails as text naming the file.
- strict-agent-files-wiring.test.ts: "is a startup decision: a later reload of the same file does not throw": changed; the port applies `strictAgentFiles` at every definition load (plan Section 2.1, "Definition refresh"), and the failure never throws out of the session.
- subagent-error-status-e2e.test.ts: "a pure empty-error run shows no 'partial output' section": not covered; the terminal-status case checks the status only.
- subagents-nested-print-mode-e2e.test.ts: "holds a background child while it performs real nested delegation": not covered in print mode; the port tests nested delegation only on in-process harness sessions.
- subagents-print-mode-e2e.test.ts: "records the model and thinking level the child session actually resolved": not covered; the model display is phase 2 (Section 7, agent-model-display).
- subagents-print-mode-e2e.test.ts: "the hold condition is load-bearing: it keeps a BACKGROUND child alive (vs abandoned without it)": not covered; no phase 1 test runs print mode, and Section 2.3 notes print-mode shutdown differs until phase 2.
- subagents-print-mode-e2e.test.ts: "a colored agent's name badge never reaches print-mode text": not covered; agent colors are phase 2 (Section 7, agent-color).
- subagents-print-mode-e2e.test.ts: "errors clearly when faux mode is given no script": dropped; it tests pi-subagents' own print-mode runner, which is not ported.
- subagents-print-mode-e2e.test.ts: "times out with the runner's own descriptive error and restores the environment": dropped; it tests pi-subagents' own print-mode runner, which is not ported.
- subagents-print-mode-e2e.test.ts: "FOREGROUND spawn — real model spawns a subagent and reports its output": not covered; live-model behavior is not proved by this plan (Section 7).
- subagents-print-mode-e2e.test.ts: "BACKGROUND spawn + get_subagent_result — model backgrounds work then retrieves it": not covered; live-model behavior is not proved by this plan (Section 7).
- subagents-print-mode-e2e.test.ts: "Explore subagent_type — model dispatches a non-default agent type": not covered; live-model behavior is not proved by this plan (Section 7).
- subagents-print-mode-e2e.test.ts: "SELF-SMOKE — the agent drives a multi-feature smoke of its own Agent toolset": not covered; live-model behavior is not proved by this plan (Section 7).
- tool-description-mode.test.ts: "compact keeps every load-bearing contract — fails when a behavior change forgets compact": not covered; the compact case asserts only the header, the type list and the missing usage notes.
- tool-description-mode.test.ts: "full states every load-bearing contract in the description or the schema": not covered.
- tool-description-mode.test.ts: "every strategy param carries a real description of its own": not covered.
- tool-description-mode.test.ts: "custom mode renders the project template with placeholders substituted": the `$&` literal case is not covered; the placeholder cases are.
- tool-description-mode.test.ts: "{{scheduleGuideline}} expands to the schedule bullet when scheduling is on (default)": dropped with scheduling (R2); the port leaves the placeholder as written with a warning.
- tool-description-mode.test.ts: "{{scheduleGuideline}} expands to the empty string when scheduling is disabled": dropped with scheduling (R2); Section 2.3 removes `schedulingEnabled`.
- tool-description-mode.test.ts: "advertises `schedule` by default": dropped with scheduling (R2); Section 2.3 removes the `schedule` parameter.
- tool-description-mode.test.ts: "removes `schedule` from the tool schema when scheduling is disabled": dropped with scheduling (R2).
- tool-description-mode.test.ts: "{{isolationGuideline}} expands to the isolation bullet when worktrees are on (default)": not covered.
- tool-description-mode.test.ts: "{{isolationGuideline}} expands to the empty string when worktree isolation is disabled": not covered.
- tool-description-mode.test.ts: "every documented placeholder is replaced — no {{ }} residue": not covered; `{{isolationGuideline}}` is never rendered in a test.
- tool-description-mode.test.ts: "the shipped example template renders byte-identical to the full description": not covered.
- tool-description-mode.test.ts: "drops the compact description's bullet too": not covered; only full mode asserts the isolation bullet.
- tool-description-mode.test.ts: "compact mode says nothing about isolation when disabled": not covered; only full mode asserts the removal.
- tool-description-mode.test.ts: "`tools: none` never claims the full built-in set": not covered.
- tool-description-mode.test.ts: "`tools: none` says none only when the agent can call nothing at all": not covered.
- tool-description-mode.test.ts: "`tools: none` with extensions loaded is not described as having no tools": not covered.
- tool-description-mode.test.ts: "an ext:-only `tools:` is described by what it actually has": not covered.
- tool-description-mode.test.ts: "compact mode shares the suffix builder and must not diverge": not covered for the `none` suffix.
- tool-description-mode.test.ts: "adds the Claude Code Task-tool parenthetical to the full and compact descriptions": not covered; the source has the text, no test asserts it.
- usage-reporting.test.ts: "attaches nothing to a call with no tool-call id, and loses none of it": not covered.
- usage-reporting.test.ts: "reports an unpriced model's tokens with a zero cost rather than dropping them": not covered.
- usage-reporting.test.ts: "reports what a background resume spends, on the next call": not covered; the usage case resumes in the foreground.
- usage-reporting.test.ts: "omits usage entirely when nothing was spent": not covered for the lifecycle payload.
- usage-reporting.test.ts: "reports an unpriced model's tokens with a zero cost": not covered for the lifecycle payload.
- usage-reporting.test.ts: "reports spend through get_subagent_result too": not covered; the tools case checks only that get_subagent_result carries no second report.
- usage.test.ts: "returns 0 when session is undefined or stats throw": dropped; the port has no getSessionTokens helper.
- usage.test.ts: "returns null when contextUsage is unavailable": not covered; the context percentage is a display concern for phase 2.
- usage.test.ts: "returns null when percent is null (post-compaction)": not covered; the context percentage is a display concern for phase 2.
- usage.test.ts: "returns the upstream percent when available": not covered; the context percentage is a display concern for phase 2.
- usage.test.ts: "agrees with getSessionTokens pre-compaction, diverges after": not covered.
- usage.test.ts: "stays monotone across simulated compaction when fed via addUsage-style accumulation": not covered.
- usage.test.ts: "leaves cost absent when nothing priced anything": not covered.
- usage.test.ts: "reads a missing cost as 0": not covered.
- usage.test.ts: "handles an accumulator that never saw a cacheRead or a cost": not covered.
- usage.test.ts: "still reports tokens spent by a model with no pricing": not covered.
- worktree-isolation-e2e.test.ts: "downgrades to the main checkout when the project set worktreeIsolation: false": not covered at run time; only the hidden parameter and prose are asserted.
- worktree.test.ts: "returns undefined for git repo with no commits": not covered; the error text names the case, but no test uses an empty repository.
- worktree.test.ts: "returns undefined for non-git directory": changed; the port fails with a named error instead of returning undefined (T7).
- worktree.test.ts: "returns undefined when `git worktree add` reports a non-zero exit": not covered.
- worktree.test.ts: "returns undefined when a git call is killed by its timeout": not covered.
- worktree.test.ts: "workPath equals path when created from the repo root": not covered; only subdirectory workPaths are asserted.
- worktree.test.ts: "uses unique paths for multiple worktrees": not covered.
- worktree.test.ts: "creates worktrees concurrently — the git calls do not serialize on one another": not covered.
- worktree.test.ts: "creates branch when worktree is clean but HEAD moved": not covered; the source compares HEAD with the base commit, no test does.
- worktree.test.ts: "does not force-overwrite existing branch": changed; the port keeps the worktree and reports the error instead of a suffixed branch (Section 2.1 "Worktree preservation").
- worktree.test.ts: "handles already-deleted worktree gracefully": not covered.
- worktree.test.ts: "truncates commit message at 200 chars": not covered.
- worktree.test.ts: "falls back to pruning when `git worktree remove` fails": changed; the service never runs a repository-wide `git worktree prune` (Section 2.1 "Worktree preservation").
- worktree.test.ts: "does not reject on a clean repo": dropped; the port has no prune helper (Section 2.1 "Worktree preservation").
- worktree.test.ts: "does not reject on non-git directory": dropped; the port has no prune helper (Section 2.1 "Worktree preservation").
- worktree.test.ts: "short-circuits when the worktree directory is already gone": not covered.
- worktree.test.ts: "swallows a git failure inside a still-present worktree and reports no changes": changed; a failure keeps the worktree and never reports "no changes" (Section 2.1 "Worktree preservation").
- worktree.test.ts: "reports no changes when the preservation commit fails": changed; the port keeps the worktree and names its path and the error (Section 2.1 "Worktree preservation").
- worktree.test.ts: "round-trips both ways": dropped; the port has no process-global switch, settings are read per spawn (R5).
- worktree.test.ts: "does not disable createWorktree directly": dropped; the port has no process-global switch (R5).

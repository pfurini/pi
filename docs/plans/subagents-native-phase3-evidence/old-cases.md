# Native subagents phase 3: old-test cases

This inventory lists every case of the six pi-subagents test files at commit `79a7c42` that the phase 1 checklist marks `Phase 3`. The phase 3 plan's `planning-changes` session wrote it with `extract-old-cases.mjs` (TypeScript parser) and assigned each case.
A status `T<n>.<k>` names numbered case k of plan task T<n>; `Dropped: <reason>` names a deliberate drop.
Each task T1 to T5 fills `Covering tests` for its own `T<n>.<k>` rows, in the commit that adds the tests, with vitest identities `<file relative to packages/coding-agent> > <full test name>` separated by `; `.
`check-cases.mjs coverage` (phase 2 evidence) checks that each identity passes and that at least one of them failed under a mutation entry of case T<n>.<k>. T6 checks every row.

| # | Old test | Status | Covering tests |
| --- | --- | --- | --- |
| 1 | test/agent-mention-provider.test.ts > agent suggestions > lists matching handles above pi's files rather than instead of them | T5.1 |  |
| 2 | test/agent-mention-provider.test.ts > agent suggestions > offers every agent on a bare @, and still offers files | T5.1 |  |
| 3 | test/agent-mention-provider.test.ts > agent suggestions > offers agents alone when no file matched | T5.1 |  |
| 4 | test/agent-mention-provider.test.ts > agent suggestions > still offers agents when the wrapped provider throws | T5.2 |  |
| 5 | test/agent-mention-provider.test.ts > agent suggestions > still offers agents when the wrapped provider throws synchronously | T5.2 |  |
| 6 | test/agent-mention-provider.test.ts > agent suggestions > warns once about a failing inner provider, not once per keystroke | T5.2 |  |
| 7 | test/agent-mention-provider.test.ts > agent suggestions > returns pi's list untouched when no agent exists at all | T5.1 |  |
| 8 | test/agent-mention-provider.test.ts > agent suggestions > puts steerable agents first, then earliest-launched | T5.3 |  |
| 9 | test/agent-mention-provider.test.ts > agent suggestions > matches case-insensitively | T5.4 |  |
| 10 | test/agent-mention-provider.test.ts > agent suggestions > completes a mention typed mid-message | T5.4 |  |
| 11 | test/agent-mention-provider.test.ts > agents that have never run > offers a registered type with no live instance, and says it will start one | T5.5 |  |
| 12 | test/agent-mention-provider.test.ts > agents that have never run > lets a live agent own its handle instead of listing the type twice | T5.5 |  |
| 13 | test/agent-mention-provider.test.ts > agents that have never run > still offers the type once its only instance has finished, as a resume | T5.5 |  |
| 14 | test/agent-mention-provider.test.ts > agents that have never run > lists live agents before startable types | T5.3 |  |
| 15 | test/agent-mention-provider.test.ts > delegation to pi's provider > delegates when no handle matches the typed prefix | T5.1 |  |
| 16 | test/agent-mention-provider.test.ts > delegation to pi's provider > delegates a path-shaped token even when its first segment names an agent | T5.6 |  |
| 17 | test/agent-mention-provider.test.ts > delegation to pi's provider > delegates an @ that is not at a token boundary | T5.6 |  |
| 18 | test/agent-mention-provider.test.ts > delegation to pi's provider > never claims nested children — nothing can address them | T5.6 |  |
| 19 | test/agent-mention-provider.test.ts > delegation to pi's provider > delegates everything while mentions are disabled | T5.6 |  |
| 20 | test/agent-mention-provider.test.ts > composing with another extension's provider > delegates to a provider registered before us | T5.7 |  |
| 21 | test/agent-mention-provider.test.ts > composing with another extension's provider > is still reachable through a provider registered after us | T5.7 |  |
| 22 | test/agent-mention-provider.test.ts > composing with another extension's provider > lets pi union the chain's trigger characters, as it already does | T5.7 |  |
| 23 | test/agent-mention-provider.test.ts > composing with another extension's provider > can be rebuilt from the same factory without accumulating state | T5.7 |  |
| 24 | test/agent-mention-provider.test.ts > against pi's real provider > inserts the handle and a trailing space at the start of a line | T5.8 |  |
| 25 | test/agent-mention-provider.test.ts > against pi's real provider > replaces only the mention token when it sits mid-line | T5.8 |  |
| 26 | test/agent-mention-provider.test.ts > against pi's real provider > keeps text after the cursor intact | T5.8 |  |
| 27 | test/agent-mention-provider.test.ts > against pi's real provider > inserts a FILE-shaped row from OUR prefix, character for character | T5.8 |  |
| 28 | test/agent-mention-provider.test.ts > against pi's real provider > declares a trigger character the editor will actually accept | T5.8 |  |
| 29 | test/agent-mention-provider.test.ts > insertion and trigger plumbing > hands applyCompletion to pi — its @-branch already inserts value plus a space | T5.9 |  |
| 30 | test/agent-mention-provider.test.ts > insertion and trigger plumbing > keeps pi's file-completion gate rather than forcing it open | T5.9 |  |
| 31 | test/agent-mention-provider.test.ts > insertion and trigger plumbing > declares @ and nothing else | T5.9 |  |
| 32 | test/agent-mention-provider.test.ts > named agents and evicted ones > lists a named agent once, under its alias, and says what type it is | T5.10 |  |
| 33 | test/agent-mention-provider.test.ts > named agents and evicted ones > leaves an unnamed agent's row free of a redundant type | T5.10 |  |
| 34 | test/agent-mention-provider.test.ts > named agents and evicted ones > still resolves the unlisted type handle of a named agent | T5.10 |  |
| 35 | test/agent-mention-provider.test.ts > named agents and evicted ones > offers an evicted agent as a resume, after the live ones | T5.11 |  |
| 36 | test/agent-mention-provider.test.ts > named agents and evicted ones > puts live agents ahead of resumable ones | T5.3 |  |
| 37 | test/agent-mention-provider.test.ts > named agents and evicted ones > keeps an aliased tombstone's type handle reserved too | T5.11 |  |
| 38 | test/agent-mention-provider.test.ts > named agents and evicted ones > does not offer a startable type whose handle a tombstone still holds | T5.11 |  |
| 39 | test/agent-mention-provider.test.ts > rows carry the display name, not the raw type > names an aliased agent by its label | T5.12 |  |
| 40 | test/agent-mention-provider.test.ts > rows carry the display name, not the raw type > names a resumable agent by its label | T5.12 |  |
| 41 | test/agent-mention-provider.test.ts > rows carry the display name, not the raw type > falls back to the raw type when no resolver is supplied | T5.12 |  |
| 42 | test/agent-mention-wiring.test.ts > messaging a running agent > steers it, announces it, and spends no main-model turn | T4.3 |  |
| 43 | test/agent-mention-wiring.test.ts > messaging a running agent > un-consumes the result so the agent's reply is still relayed | Dropped: the native service never marks a running agent's result consumed: `consume` refuses a running record (`service/service.ts`, `consume`) |  |
| 44 | test/agent-mention-wiring.test.ts > messaging a running agent > addresses same-type siblings by their numbered handles | T4.3 |  |
| 45 | test/agent-mention-wiring.test.ts > messaging a finished agent > resumes it from its session in the background | T4.4 |  |
| 46 | test/agent-mention-wiring.test.ts > messaging a finished agent > honours the agent's output_transcript: false when resuming | T4.4 |  |
| 47 | test/agent-mention-wiring.test.ts > messaging a finished agent > does not attribute the new answer to the tool call that spawned it | T4.4 |  |
| 48 | test/agent-mention-wiring.test.ts > messaging a finished agent > relays the resumed answer through the ordinary completion notification | T4.4 |  |
| 49 | test/agent-mention-wiring.test.ts > stacking the suggestion provider on pi's > registers exactly once, however often session_start fires | T5.13 |  |
| 50 | test/agent-mention-wiring.test.ts > stacking the suggestion provider on pi's > stays out of non-TUI modes, which have no editor to complete into | T5.13 |  |
| 51 | test/agent-mention-wiring.test.ts > stacking the suggestion provider on pi's > hands pi a provider that answers a live handle | T5.13 |  |
| 52 | test/agent-mention-wiring.test.ts > resolving which agent a handle means > matches the handle case-insensitively | T4.11 |  |
| 53 | test/agent-mention-wiring.test.ts > resolving which agent a handle means > accepts the raw agent id, which the README offers as a fallback | T4.11 |  |
| 54 | test/agent-mention-wiring.test.ts > resolving which agent a handle means > queues the message for an agent still waiting on a concurrency slot | T4.3 |  |
| 55 | test/agent-mention-wiring.test.ts > resolving which agent a handle means > never reaches into a nested child, and starts a top-level agent instead | T4.11 |  |
| 56 | test/agent-mention-wiring.test.ts > resolving which agent a handle means > starts a fresh agent once the old record has been evicted | T4.11 |  |
| 57 | test/agent-mention-wiring.test.ts > mentioning an agent that has never run > starts one, using the message as its prompt | T4.1 |  |
| 58 | test/agent-mention-wiring.test.ts > mentioning an agent that has never run > leaves model, thinking and max turns to the agent's own config | T4.1 |  |
| 59 | test/agent-mention-wiring.test.ts > mentioning an agent that has never run > shows the turn limit it will actually be held to (#181) | T4.1 |  |
| 60 | test/agent-mention-wiring.test.ts > mentioning an agent that has never run > tracks its tool activity, so the widget shows what it is doing (#181) | T4.1 |  |
| 61 | test/agent-mention-wiring.test.ts > mentioning an agent that has never run > runs it in the background so the prompt is not blocked | T4.1 |  |
| 62 | test/agent-mention-wiring.test.ts > mentioning an agent that has never run > messages the running agent rather than starting a second one | T4.3 |  |
| 63 | test/agent-mention-wiring.test.ts > mentioning an agent that has never run > reports a failed start instead of silently doing nothing | T4.2 |  |
| 64 | test/agent-mention-wiring.test.ts > letting a clone of the conversation start the agent > claims the turn, so nothing about the mention reaches the chat | T4.6 |  |
| 65 | test/agent-mention-wiring.test.ts > letting a clone of the conversation start the agent > hands the clone the resolved type, the message and the real Agent tool | T4.6 |  |
| 66 | test/agent-mention-wiring.test.ts > letting a clone of the conversation start the agent > does not block the prompt on the clone's turn | T4.6 |  |
| 67 | test/agent-mention-wiring.test.ts > letting a clone of the conversation start the agent > says the agent is being prompted, not started — nothing runs yet | T4.6 |  |
| 68 | test/agent-mention-wiring.test.ts > letting a clone of the conversation start the agent > starts the agent directly when the clone cannot | T4.6 |  |
| 69 | test/agent-mention-wiring.test.ts > letting a clone of the conversation start the agent > reports a fallback that also fails rather than going quiet | T4.6 |  |
| 70 | test/agent-mention-wiring.test.ts > letting a clone of the conversation start the agent > still steers a running agent directly, without cloning anything | T4.6 |  |
| 71 | test/agent-mention-wiring.test.ts > letting a clone of the conversation start the agent > still resumes a finished agent directly, without cloning anything | T4.6 |  |
| 72 | test/agent-mention-wiring.test.ts > letting a clone of the conversation start the agent > does not clone for a handle that names no agent | T4.6 |  |
| 73 | test/agent-mention-wiring.test.ts > letting a clone of the conversation start the agent > works headlessly, where the visible-turn version never could | Dropped: D44, mentions act only in the TUI |  |
| 74 | test/agent-mention-wiring.test.ts > letting a clone of the conversation start the agent > leaves a running agent alone headlessly rather than starting a rival | T4.7 |  |
| 75 | test/agent-mention-wiring.test.ts > letting a clone of the conversation start the agent > clones nothing when mentions are off | T4.6 |  |
| 76 | test/agent-mention-wiring.test.ts > letting a clone of the conversation start the agent > starts the agent here instead when the mode is direct | T4.6 |  |
| 77 | test/agent-mention-wiring.test.ts > input that is not a mention > passes an unknown handle to the main model rather than eating it | T4.7 |  |
| 78 | test/agent-mention-wiring.test.ts > input that is not a mention > passes a bare handle to the main model | T4.7 |  |
| 79 | test/agent-mention-wiring.test.ts > input that is not a mention > leaves a leading file attachment alone | T4.7 |  |
| 80 | test/agent-mention-wiring.test.ts > input that is not a mention > ignores input the extension layer submitted | T4.7 |  |
| 81 | test/agent-mention-wiring.test.ts > input that is not a mention > leaves a headless prompt to the main model | T4.7 |  |
| 82 | test/agent-mention-wiring.test.ts > input that is not a mention > leaves an RPC-driven prompt to the main model | T4.7 |  |
| 83 | test/agent-mention-wiring.test.ts > input that is not a mention > falls through entirely when mentions are disabled | T4.8 |  |
| 84 | test/agent-mention-wiring.test.ts > input that is not a mention > disabled also blocks starting an agent, not just messaging one | T4.8 |  |
| 85 | test/agent-mention-wiring.test.ts > input that is not a mention > disabled also blocks resuming a finished agent | T4.8 |  |
| 86 | test/agent-mention-wiring.test.ts > input that is not a mention > the suggestion popup goes quiet too, so @ means only 'attach a file' | T5.6 |  |
| 87 | test/agent-mention-wiring.test.ts > @main — the escape hatch > strips the prefix and sends the rest to the main model | T4.9 |  |
| 88 | test/agent-mention-wiring.test.ts > @main — the escape hatch > carries attachments through with the text | T4.9 |  |
| 89 | test/agent-mention-wiring.test.ts > @main — the escape hatch > never starts an agent, even when a type would slug to main | T4.9 |  |
| 90 | test/agent-mention-wiring.test.ts > @main — the escape hatch > leaves a bare @main to the main model untouched | T4.9 |  |
| 91 | test/agent-mention-wiring.test.ts > @agent-<type> — Claude Code's manual spelling > starts the agent the unprefixed handle would have | T4.10 |  |
| 92 | test/agent-mention-wiring.test.ts > @agent-<type> — Claude Code's manual spelling > reaches a running agent, not a second copy of it | T4.10 |  |
| 93 | test/agent-mention-wiring.test.ts > @agent-<type> — Claude Code's manual spelling > prefers an agent literally named agent-<x> over the unwrapped spelling | T4.10 |  |
| 94 | test/agent-mention-wiring.test.ts > @agent-<type> — Claude Code's manual spelling > still falls through when nothing answers either spelling | T4.10 |  |
| 95 | test/agent-mention-wiring.test.ts > resuming an evicted agent by name > reopens the conversation instead of starting a fresh agent | T2.1 | test/suite/fork-subagents-mentions.test.ts > reopen reopens the evicted conversation: the child's first request holds the old user messages, then the new prompt |
| 96 | test/agent-mention-wiring.test.ts > resuming an evicted agent by name > hands the resumed agent the handle back instead of numbering it | T2.2 | test/suite/fork-subagents-mentions.test.ts > reopen gives the reopened agent its tombstone's handle and alias back |
| 97 | test/agent-mention-wiring.test.ts > resuming an evicted agent by name > stops resolving to the tombstone once the resume has taken the name | T2.3 | test/suite/fork-subagents-mentions.test.ts > reopen resolves the name to the reopened agent, not the tombstone |
| 98 | test/agent-mention-wiring.test.ts > resuming an evicted agent by name > gives a named agent its alias back too | T2.2 | test/suite/fork-subagents-mentions.test.ts > reopen gives the reopened agent its tombstone's handle and alias back |
| 99 | test/agent-mention-wiring.test.ts > resuming an evicted agent by name > refuses to reopen a conversation under a substitute agent | T2.4 | test/suite/fork-subagents-mentions.test.ts > reopen refuses a deleted or disabled type, creating no record and keeping the tombstone |
| 100 | test/agent-mention-wiring.test.ts > resuming an evicted agent by name > resumes again once the agent is re-enabled | T2.5 | test/suite/fork-subagents-mentions.test.ts > reopen reopens the same tombstone once its type is enabled again |
| 101 | test/agent-mention-wiring.test.ts > resuming an evicted agent by name > keeps the agent resolvable when the resume itself fails | T4.15 |  |
| 102 | test/agent-mention-wiring.test.ts > resuming an evicted agent by name > keeps the original description rather than relabelling from the message | T2.6 | test/suite/fork-subagents-mentions.test.ts > reopen keeps the tombstone's description rather than one derived from the prompt |
| 103 | test/agent-mention-wiring.test.ts > resuming an evicted agent by name > does not let the tools steer or read an agent that is gone | T1.10 | test/suite/fork-subagents-mentions.test.ts > handle resolution lets the tools report an evicted agent's handle and an unknown one as not found |
| 104 | test/agent-mention-wiring.test.ts > resuming an evicted agent by name > reports a session that is gone, rather than starting something else | T4.5 |  |
| 105 | test/agent-mention-wiring.test.ts > resuming an evicted agent by name > forgets an unopenable session so the next mention starts fresh | T4.5 |  |
| 106 | test/agent-mention-wiring.test.ts > handles as tool arguments > steers by handle, not just by raw id | T1.10 | test/suite/fork-subagents-mentions.test.ts > handle resolution lets steer_subagent and get_subagent_result reach an agent by its handle and its alias |
| 107 | test/agent-mention-wiring.test.ts > handles as tool arguments > steers by the name the model gave the agent | T1.10 | test/suite/fork-subagents-mentions.test.ts > handle resolution lets steer_subagent and get_subagent_result reach an agent by its handle and its alias |
| 108 | test/agent-mention-wiring.test.ts > handles as tool arguments > reads a result by handle | T1.10 | test/suite/fork-subagents-mentions.test.ts > handle resolution lets steer_subagent and get_subagent_result reach an agent by its handle and its alias |
| 109 | test/agent-mention-wiring.test.ts > handles as tool arguments > still reports an unknown reference as not found | T1.10 | test/suite/fork-subagents-mentions.test.ts > handle resolution lets the tools report an evicted agent's handle and an unknown one as not found |
| 110 | test/e2e/mention-clone.e2e.test.ts > mention clone over a real session > sends the conversation under the live system prompt, with Agent as the only tool | T3.3 | test/suite/fork-subagents-mention-clone.test.ts > the clone's request keeps the system prompt the session sent on its last turn, byte for byte; test/suite/fork-subagents-mention-clone.test.ts > the clone's request declares the Agent tool and nothing else |
| 111 | test/e2e/mention-clone.e2e.test.ts > mention clone over a real session > sends the compaction summary instead of the turns it replaced | T3.2 | test/suite/fork-subagents-mention-clone.test.ts > the clone's request carries the session's projected conversation: after a compaction, the summary instead of the turns it replaced |
| 112 | test/mention-clone.test.ts > the clone's request > is exactly one call | T3.1 | test/suite/fork-subagents-mention-clone.test.ts > the clone's request is exactly one model request |
| 113 | test/mention-clone.test.ts > the clone's request > carries the conversation pi would send, compaction summary included | T3.2 | test/suite/fork-subagents-mention-clone.test.ts > the clone's request carries the session's projected conversation: after a compaction, the summary instead of the turns it replaced |
| 114 | test/mention-clone.test.ts > the clone's request > keeps the parent's system prompt byte for byte | T3.3 | test/suite/fork-subagents-mention-clone.test.ts > the clone's request keeps the system prompt the session sent on its last turn, byte for byte |
| 115 | test/mention-clone.test.ts > the clone's request > declares the Agent tool and nothing else | T3.4 | test/suite/fork-subagents-mention-clone.test.ts > the clone's request declares the Agent tool and nothing else |
| 116 | test/mention-clone.test.ts > the clone's request > ends with the message, then the reminder | T3.5 | test/suite/fork-subagents-mention-clone.test.ts > the clone's request ends with one user message: the typed message, a blank line, then the reminder |
| 117 | test/mention-clone.test.ts > the clone's request > uses the parent's model, session id and thinking level | T3.6 | test/suite/fork-subagents-mention-clone.test.ts > the clone's request uses the session's model, session id and thinking level |
| 118 | test/mention-clone.test.ts > the clone's request > sends no reasoning level when the session thinks at off | T3.6 | test/suite/fork-subagents-mention-clone.test.ts > the clone's request sends no reasoning level when the session thinks at off |
| 119 | test/mention-clone.test.ts > the clone's request > leaves the parent's projection untouched | T3.7 | test/suite/fork-subagents-mention-clone.test.ts > the clone's request leaves the session's projection, messages and turns unchanged |
| 120 | test/mention-clone.test.ts > attributing the spawn to the real session > runs the real Agent handler with the MAIN context and no tool-call id | T3.8 | test/suite/fork-subagents-mention-clone.test.ts > the clone's spawn starts the mentioned type as the session's own detached background agent, with the call's prompt, description and name |
| 121 | test/mention-clone.test.ts > attributing the spawn to the real session > forwards the parameters the model chose, forced into the background | T3.8 | test/suite/fork-subagents-mention-clone.test.ts > the clone's spawn forwards the call's model, thinking, max_turns, inherit_context, isolated and isolation; test/suite/fork-subagents-mention-clone.test.ts > the clone's spawn starts a new detached background agent even when the call asks to resume or to run in the foreground |
| 122 | test/mention-clone.test.ts > attributing the spawn to the real session > honours only the first Agent call | T3.9 | test/suite/fork-subagents-mention-clone.test.ts > the clone's spawn honours only the first Agent call of the reply |
| 123 | test/mention-clone.test.ts > attributing the spawn to the real session > applies the tool's prepareArguments before validating, as pi's loop does | T3.10 | test/suite/fork-subagents-mention-clone.test.ts > the clone's spawn applies the tool's prepareArguments before validating |
| 124 | test/mention-clone.test.ts > when the clone cannot deliver > reports a reply that never called the tool | T3.11 | test/suite/fork-subagents-mention-clone.test.ts > when the clone cannot start the agent reports a reply that never called the tool |
| 125 | test/mention-clone.test.ts > when the clone cannot deliver > reports a provider error | T3.11 | test/suite/fork-subagents-mention-clone.test.ts > when the clone cannot start the agent reports a provider error |
| 126 | test/mention-clone.test.ts > when the clone cannot deliver > rejects arguments that do not match the tool schema | T3.11 | test/suite/fork-subagents-mention-clone.test.ts > when the clone cannot start the agent rejects arguments that do not match the tool schema |
| 127 | test/mention-clone.test.ts > when the clone cannot deliver > reports a missing model without calling anything | T3.11 | test/suite/fork-subagents-mention-clone.test.ts > when the clone cannot start the agent reports a missing model without sending a request |
| 128 | test/mention-clone.test.ts > when the clone cannot deliver > returns a thrown error rather than rejecting | T3.11 | test/suite/fork-subagents-mention-clone.test.ts > when the clone cannot start the agent returns a thrown error rather than rejecting |
| 129 | test/mention-clone.test.ts > when the clone cannot deliver > keeps a spawn the tool already started when the tool then throws | T4.2 |  |
| 130 | test/mention-start-notification.test.ts > an agent started by a mention > relays its answer through the ordinary completion notification (direct mode) | T4.1 |  |
| 131 | test/mention-start-notification.test.ts > an agent started by a mention > relays it when the clone fell back to a direct start (model mode) | T4.6 |  |
| 132 | test/mention.test.ts > handleBase > lowercases so the handle matches how it is typed | T1.1 | test/fork-builtins/subagents/mentions.test.ts > handleBase lowercases and keeps hyphens |
| 133 | test/mention.test.ts > handleBase > keeps a hyphenated type as-is | T1.1 | test/fork-builtins/subagents/mentions.test.ts > handleBase lowercases and keeps hyphens |
| 134 | test/mention.test.ts > handleBase > reduces anything outside [\w-] to hyphens, without leaving edge hyphens | T1.1 | test/fork-builtins/subagents/mentions.test.ts > handleBase turns other characters into single hyphens, without edge hyphens |
| 135 | test/mention.test.ts > handleBase > always produces something typeable | T1.1 | test/fork-builtins/subagents/mentions.test.ts > handleBase never returns an empty handle |
| 136 | test/mention.test.ts > handleBase > caps a long name so one agent can't own an unreadable row | T1.1 | test/fork-builtins/subagents/mentions.test.ts > handleBase caps a long name at 64 characters without a trailing hyphen |
| 137 | test/mention.test.ts > handleBase > never leaves a trailing hyphen the cap sliced into | T1.1 | test/fork-builtins/subagents/mentions.test.ts > handleBase caps a long name at 64 characters without a trailing hyphen |
| 138 | test/mention.test.ts > handleBase > only ever produces handles the suggestion trigger can match | T1.1 | test/fork-builtins/subagents/mentions.test.ts > handleBase only produces handles the suggestion trigger matches |
| 139 | test/mention.test.ts > assignHandle > takes the plain base when it is free | T1.2 | test/fork-builtins/subagents/mentions.test.ts > assignHandle takes the free base, then numbers from 2 past every taken form |
| 140 | test/mention.test.ts > assignHandle > numbers from 2 on the first collision | T1.2 | test/fork-builtins/subagents/mentions.test.ts > assignHandle takes the free base, then numbers from 2 past every taken form |
| 141 | test/mention.test.ts > assignHandle > keeps counting past every taken form | T1.2 | test/fork-builtins/subagents/mentions.test.ts > assignHandle takes the free base, then numbers from 2 past every taken form |
| 142 | test/mention.test.ts > assignHandle > never hands out the reserved main handle | T1.2 | test/fork-builtins/subagents/mentions.test.ts > assignHandle never hands out main |
| 143 | test/mention.test.ts > assignHandle > skips a gap rather than reusing a live handle | T1.2 | test/fork-builtins/subagents/mentions.test.ts > assignHandle skips a gap rather than reusing a live handle |
| 144 | test/mention.test.ts > resolveHandleToType > finds the type a handle was derived from, whatever its casing | T1.3 | test/fork-builtins/subagents/mentions.test.ts > resolveHandleToType finds the type a handle came from, whatever its casing |
| 145 | test/mention.test.ts > resolveHandleToType > resolves a type whose slug differs from its name | T1.3 | test/fork-builtins/subagents/mentions.test.ts > resolveHandleToType finds the type a handle came from, whatever its casing |
| 146 | test/mention.test.ts > resolveHandleToType > is exact, not a prefix match — a partial handle must not start an agent | T1.3 | test/fork-builtins/subagents/mentions.test.ts > resolveHandleToType matches exactly, never a prefix or a numbered handle |
| 147 | test/mention.test.ts > resolveHandleToType > round-trips every registered type | T1.3 | test/fork-builtins/subagents/mentions.test.ts > resolveHandleToType round-trips every registered type |
| 148 | test/mention.test.ts > resolveHandleToType > refuses to resolve the reserved handle, even to a type named for it | T1.3 | test/fork-builtins/subagents/mentions.test.ts > resolveHandleToType refuses main, even for a type named main |
| 149 | test/mention.test.ts > isReservedHandle > recognizes main whatever its casing | T1.4 | test/fork-builtins/subagents/mentions.test.ts > isReservedHandle recognizes main in any casing and nothing else |
| 150 | test/mention.test.ts > isReservedHandle > leaves every ordinary handle alone | T1.4 | test/fork-builtins/subagents/mentions.test.ts > isReservedHandle recognizes main in any casing and nothing else |
| 151 | test/mention.test.ts > stripAgentPrefix > unwraps Claude Code's manual @agent-<type> spelling | T1.5 | test/fork-builtins/subagents/mentions.test.ts > stripAgentPrefix unwraps agent-<x> once |
| 152 | test/mention.test.ts > stripAgentPrefix > keeps the remainder intact when it is itself prefixed | T1.5 | test/fork-builtins/subagents/mentions.test.ts > stripAgentPrefix unwraps agent-<x> once |
| 153 | test/mention.test.ts > stripAgentPrefix > returns nothing when there is no prefix or nothing behind it | T1.5 | test/fork-builtins/subagents/mentions.test.ts > stripAgentPrefix returns nothing without the prefix, without a remainder, or with the prefix inside |
| 154 | test/mention.test.ts > stripAgentPrefix > only unwraps a prefix at the very start | T1.5 | test/fork-builtins/subagents/mentions.test.ts > stripAgentPrefix returns nothing without the prefix, without a remainder, or with the prefix inside |
| 155 | test/mention.test.ts > describeMention > uses the message as the agent's short label | T1.6 | test/fork-builtins/subagents/mentions.test.ts > describeMention keeps the first line and collapses whitespace |
| 156 | test/mention.test.ts > describeMention > takes the first line and collapses whitespace | T1.6 | test/fork-builtins/subagents/mentions.test.ts > describeMention keeps the first line and collapses whitespace |
| 157 | test/mention.test.ts > describeMention > clips a long message rather than putting a paragraph in every agent surface | T1.6 | test/fork-builtins/subagents/mentions.test.ts > describeMention clips a long message at 40 characters with an ellipsis |
| 158 | test/mention.test.ts > parseMention > splits a leading handle from its message | T1.7 | test/fork-builtins/subagents/mentions.test.ts > parseMention splits a leading handle from a trimmed message |
| 159 | test/mention.test.ts > parseMention > trims the message and accepts a newline as the separator | T1.7 | test/fork-builtins/subagents/mentions.test.ts > parseMention splits a leading handle from a trimmed message; test/fork-builtins/subagents/mentions.test.ts > parseMention accepts a newline as the separator |
| 160 | test/mention.test.ts > parseMention > rejects a bare handle — that belongs to the main model | T1.7 | test/fork-builtins/subagents/mentions.test.ts > parseMention rejects a bare handle |
| 161 | test/mention.test.ts > parseMention > rejects a leading file path so pi's @-attachment keeps working | T1.7 | test/fork-builtins/subagents/mentions.test.ts > parseMention rejects a leading file path |
| 162 | test/mention.test.ts > parseMention > rejects a mention that is not at the start of the input | T1.7 | test/fork-builtins/subagents/mentions.test.ts > parseMention rejects a mention after other text |
| 163 | test/mention.test.ts > agentMentionReminder > is Claude Code's string, byte for byte | T1.8 | test/fork-builtins/subagents/mentions.test.ts > agentMentionReminder equals Claude Code's string byte for byte, trailing space included |
| 164 | test/mention.test.ts > agentMentionReminder > names the agent it was given | T1.8 | test/fork-builtins/subagents/mentions.test.ts > agentMentionReminder names its agent |

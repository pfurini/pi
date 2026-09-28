# Native subagents phase 2: old-test cases

This inventory lists every case of the 12 pi-subagents test files at commit `79a7c42` that the phase 1 checklist marks `Phase 2`. The phase 2 plan's `planning-changes` session wrote it with `extract-old-cases.mjs` (TypeScript parser) and assigned each case.
A status `T<n>.<k>` names numbered case k of plan task T<n>; `Phase 1` names a phase 1 test that already covers the case; `Dropped: <reason>` names a deliberate drop.
Each task T7 to T13 fills `Covering tests` for its own `T<n>.<k>` rows, in the commit that adds the tests, with vitest identities `<file relative to packages/coding-agent> > <full test name>` separated by `; `.
`check-cases.mjs coverage` checks that each identity passes and that at least one of them failed under a mutation entry of case T<n>.<k>. T16 checks every row.

| # | Old test | Status | Covering tests |
| --- | --- | --- | --- |
| 1 | test/agent-color.test.ts > resolveAgentColor > resolves Claude Code names and Agency Agents aliases | T7.1 | test/fork-builtins/subagents/ui-colors.test.ts > resolveAgentColor resolves Claude Code names and Agency Agents aliases |
| 2 | test/agent-color.test.ts > resolveAgentColor > normalizes six-digit hex and rejects unsupported values | T7.1 | test/fork-builtins/subagents/ui-colors.test.ts > resolveAgentColor normalizes six-digit hex and rejects unsupported values |
| 3 | test/agent-color.test.ts > renderAgentNameLabel > renders a padded truecolor badge with readable foreground | T7.2 | test/fork-builtins/subagents/ui-colors.test.ts > renderAgentNameLabel renders a padded truecolor badge with readable foreground |
| 4 | test/agent-color.test.ts > renderAgentNameLabel > judges contrast against the effective color in 256-color mode | T7.3 | test/fork-builtins/subagents/ui-colors.test.ts > renderAgentNameLabel judges contrast against the effective color in 256-color mode |
| 5 | test/agent-color.test.ts > renderAgentNameLabel > restores an enclosing tool background after the badge | T7.4 | test/fork-builtins/subagents/ui-colors.test.ts > renderAgentNameLabel restores an enclosing tool background after the badge |
| 6 | test/agent-color.test.ts > renderAgentNameLabel > resets the background when the caller paints none | T7.4 | test/fork-builtins/subagents/ui-colors.test.ts > renderAgentNameLabel resets the background when the caller paints none |
| 7 | test/agent-color.test.ts > renderAgentNameLabel > preserves existing theme styling without a valid color | T7.5 | test/fork-builtins/subagents/ui-colors.test.ts > renderAgentNameLabel preserves existing theme styling without a valid color |
| 8 | test/agent-color-surfaces.test.ts > custom agent color runtime surfaces > renders the registered Agent tool call header with the display name and color | T8.11 |  |
| 9 | test/agent-color-surfaces.test.ts > custom agent color runtime surfaces > renders the above-editor Agent widget with the display name and color | T10.10 |  |
| 10 | test/agent-color-surfaces.test.ts > custom agent color runtime surfaces > renders the FleetView row with the display name and color | T12.11 |  |
| 11 | test/agent-color-surfaces.test.ts > custom agent color runtime surfaces > renders the conversation viewer header with the display name and color | T11.16 |  |
| 12 | test/agent-file-toggle.test.ts > enableInContent > strips enabled: false when it is the first frontmatter line | T13.1 |  |
| 13 | test/agent-file-toggle.test.ts > enableInContent > strips enabled: false when another key precedes it | T13.1 |  |
| 14 | test/agent-file-toggle.test.ts > enableInContent > strips enabled: false when it is the last frontmatter line | T13.1 |  |
| 15 | test/agent-file-toggle.test.ts > enableInContent > reports changed: false when there is nothing to strip | T13.1 |  |
| 16 | test/agent-file-toggle.test.ts > enableInContent > leaves the body and other frontmatter keys untouched | T13.1 |  |
| 17 | test/agent-file-toggle.test.ts > enableInContent > handles CRLF line endings | T13.1 |  |
| 18 | test/agent-file-toggle.test.ts > disableInContent > inserts enabled: false into a normal frontmatter block | T13.2 |  |
| 19 | test/agent-file-toggle.test.ts > disableInContent > is idempotent when the key is already first | T13.2 |  |
| 20 | test/agent-file-toggle.test.ts > disableInContent > is idempotent when the key is already present mid-block | T13.2 |  |
| 21 | test/agent-file-toggle.test.ts > disableInContent > never writes a file the loader cannot parse | T13.2 |  |
| 22 | test/agent-file-toggle.test.ts > disableInContent > reports no-frontmatter rather than claiming success on a fence-less file | T13.2 |  |
| 23 | test/agent-file-toggle.test.ts > disableInContent > disables a CRLF file instead of misreporting it as frontmatter-less | T13.2 |  |
| 24 | test/agent-file-toggle.test.ts > disableInContent > toggles a BOM-prefixed file, and leaves the BOM where it found it | T13.2 |  |
| 25 | test/agent-file-toggle.test.ts > parseAgentFrontmatter > reads a BOM-prefixed file's fields instead of dropping them | Phase 1 | test/fork-builtins/subagents/definitions.test.ts > agent file frontmatter parses a file that starts with a UTF-8 BOM |
| 26 | test/agent-file-toggle.test.ts > parseAgentFrontmatter > leaves a file without a BOM exactly as the parser reads it | Phase 1 | test/fork-builtins/subagents/definitions.test.ts > agent file frontmatter reads every documented key |
| 27 | test/agent-file-toggle.test.ts > isDisabledContent > sees the key at the first frontmatter line | T13.3 |  |
| 28 | test/agent-file-toggle.test.ts > isDisabledContent > sees the key mid-block | T13.3 |  |
| 29 | test/agent-file-toggle.test.ts > isDisabledContent > sees the key in a CRLF file | T13.3 |  |
| 30 | test/agent-file-toggle.test.ts > isDisabledContent > is false for an enabled file | T13.3 |  |
| 31 | test/agent-file-toggle.test.ts > isDisabledContent > agrees with the loader: %s | T13.3 |  |
| 32 | test/agent-file-toggle.test.ts > read and write paths agree > a file the loader reads as disabled can be enabled — ${label} | T13.4 |  |
| 33 | test/agent-file-toggle.test.ts > read and write paths agree > disable → enable round-trips to the original hand-authored file | T13.4 |  |
| 34 | test/agent-file-toggle.test.ts > isEmptyStub > recognises the stub behind a BOM | T13.5 |  |
| 35 | test/agent-file-toggle.test.ts > isEmptyStub > recognizes the stub /agents writes to disable a built-in default | T13.5 |  |
| 36 | test/agent-file-toggle.test.ts > isEmptyStub > is false for a file with real frontmatter | T13.5 |  |
| 37 | test/agent-file-toggle.test.ts > findAgentFile > prefers .pi/agents over .agents/agents and the personal dir | T13.6 |  |
| 38 | test/agent-file-toggle.test.ts > findAgentFile > falls back to the workspace .agents/agents dir | T13.6 |  |
| 39 | test/agent-file-toggle.test.ts > findAgentFile > falls back to the personal agent dir | T13.6 |  |
| 40 | test/agent-file-toggle.test.ts > findAgentFile > returns undefined when the agent has no file anywhere | T13.6 |  |
| 41 | test/agent-file-toggle.test.ts > findAgentFile > locateAgentFile > uses the file the loader read, whatever it is called | T13.6 |  |
| 42 | test/agent-file-toggle.test.ts > findAgentFile > locateAgentFile > classifies a workspace and a personal source path | T13.6 |  |
| 43 | test/agent-file-toggle.test.ts > findAgentFile > locateAgentFile > falls back to the <type>.md probe for a built-in with no source file | T13.6 |  |
| 44 | test/agent-file-toggle.test.ts > findAgentFile > locateAgentFile > falls back when the recorded path has since been deleted | T13.6 |  |
| 45 | test/agent-file-toggle.test.ts > findAgentFile > locateAgentFile > finds nothing when neither the source path nor the probe resolves | T13.6 |  |
| 46 | test/agent-file-toggle.test.ts > buildNewAgentFile > round-trips an ordinary description | T13.8 |  |
| 47 | test/agent-file-toggle.test.ts > buildNewAgentFile > survives a description containing a colon | T13.8 |  |
| 48 | test/agent-file-toggle.test.ts > buildNewAgentFile > keeps a description containing a # instead of truncating it | T13.8 |  |
| 49 | test/agent-file-toggle.test.ts > buildNewAgentFile > leaves a `provider/model:thinking` suffix intact | T13.8 |  |
| 50 | test/agent-file-toggle.test.ts > buildNewAgentFile > survives a custom model containing a colon-space or a # | T13.8 |  |
| 51 | test/agent-file-toggle.test.ts > buildNewAgentFile > emits the fields the wizard collects, and omits the ones left on inherit | T13.8 |  |
| 52 | test/agent-file-toggle.test.ts > buildNewAgentFile > keeps the system prompt as the body | T13.8 |  |
| 53 | test/agent-model-display.test.ts > Agent tool result — effective model > names the model even when the child inherited the parent's | T8.4 |  |
| 54 | test/agent-model-display.test.ts > Agent tool result — effective model > names the inherited model while streaming, before a session exists | T8.4 |  |
| 55 | test/agent-model-display.test.ts > Agent tool result — effective model > keeps the twin label beside the model | T8.5 |  |
| 56 | test/agent-model-display.test.ts > Agent tool result — effective model > reports the session's level, and what was asked for, when pi clamps it | T8.6 |  |
| 57 | test/agent-model-display.test.ts > Agent tool result — effective model > discloses a level an agent file pinned over the caller's (#182) | T8.7 |  |
| 58 | test/agent-model-display.test.ts > Agent tool result — effective model > discloses a model an agent file pinned over the caller's (#182) | T8.7 |  |
| 59 | test/agent-model-display.test.ts > Agent tool result — effective model > stays quiet when the caller's spelling names the model that won | T8.7 |  |
| 60 | test/agent-model-display.test.ts > Agent tool result — effective model > discloses a spelling that names no available model at all | T8.7 |  |
| 61 | test/agent-model-display.test.ts > Agent tool result — effective model > says nothing about a request that was honored | T8.7 |  |
| 62 | test/agent-model-display.test.ts > Agent tool result — resume > renders the reopened session's settings, not the resume call's | T8.8 |  |
| 63 | test/agent-widget.test.ts > formatSessionTokens > applies threshold colors (<70 dim, 70–85 warning, ≥85 error) | T7.6 | test/fork-builtins/subagents/ui-format.test.ts > formatSessionTokens applies threshold colors (<70 dim, 70–85 warning, ≥85 error) |
| 64 | test/agent-widget.test.ts > formatSessionTokens > annotates compaction count alongside percent | T7.7 | test/fork-builtins/subagents/ui-format.test.ts > formatSessionTokens annotates compaction count alongside percent |
| 65 | test/agent-widget.test.ts > formatSessionTokens > preserves the outer style after nested annotation styles reset | T7.7 | test/fork-builtins/subagents/ui-format.test.ts > formatSessionTokens preserves the outer style after nested annotation styles reset |
| 66 | test/agent-widget.test.ts > renderRunningAgentStatus > renders running status as separate component lines | T10.1 |  |
| 67 | test/agent-widget.test.ts > AgentWidget > shows foreground agents in 'all' mode (and by default) | T10.2 |  |
| 68 | test/agent-widget.test.ts > AgentWidget > hides nested children in every coordinator widget mode | T10.2 |  |
| 69 | test/agent-widget.test.ts > AgentWidget > hides a workflow's agents in every coordinator widget mode | Dropped: workflow runs are gone (R1) |  |
| 70 | test/agent-widget.test.ts > AgentWidget > excludes foreground agents in 'background' mode | T10.2 |  |
| 71 | test/agent-widget.test.ts > AgentWidget > renders background agents in 'background' mode | T10.2 |  |
| 72 | test/agent-widget.test.ts > AgentWidget > keeps agents with no isBackground flag in 'background' mode | T10.2 |  |
| 73 | test/agent-widget.test.ts > AgentWidget > names the model and thinking on a running row under showModel | T10.3 |  |
| 74 | test/agent-widget.test.ts > AgentWidget > renders the row exactly as before when showModel is off | T10.3 |  |
| 75 | test/agent-widget.test.ts > AgentWidget > carries the short label, never the canonical id, onto the row | T10.3 |  |
| 76 | test/agent-widget.test.ts > AgentWidget > discloses a level the run did not honor | T10.3 |  |
| 77 | test/agent-widget.test.ts > AgentWidget > keeps queued agents on one summary line and finished agents visible | T10.4 |  |
| 78 | test/agent-widget.test.ts > AgentWidget > renders nothing in 'off' mode | T10.2 |  |
| 79 | test/agent-widget.test.ts > formatCost > keeps the precision that distinguishes one run from another | T7.8 | test/fork-builtins/subagents/ui-format.test.ts > formatCost keeps the precision that distinguishes one run from another |
| 80 | test/agent-widget.test.ts > formatCost > never pads a round figure with noise, nor cuts it below cents | T7.8 | test/fork-builtins/subagents/ui-format.test.ts > formatCost never pads a round figure with noise, nor cuts it below cents |
| 81 | test/agent-widget.test.ts > formatCost > shows nothing when there is nothing to show | T7.8 | test/fork-builtins/subagents/ui-format.test.ts > formatCost shows nothing when there is nothing to show |
| 82 | test/agent-widget.test.ts > formatCost > says a real but tiny cost is tiny, not zero | T7.8 | test/fork-builtins/subagents/ui-format.test.ts > formatCost says a real but tiny cost is tiny, not zero |
| 83 | test/agent-widget.test.ts > formatCost > marks the figure as an estimate | T7.8 | test/fork-builtins/subagents/ui-format.test.ts > formatCost marks the figure as an estimate |
| 84 | test/agent-widget.test.ts > AgentWidget cost display > shows the cost beside the token count when enabled | T10.5 |  |
| 85 | test/agent-widget.test.ts > AgentWidget cost display > shows no cost when disabled | T10.5 |  |
| 86 | test/agent-widget.test.ts > AgentWidget cost display > shows no cost for an unpriced model, even when enabled | T10.5 |  |
| 87 | test/agent-widget.test.ts > AgentWidget cost display > keeps the cost visible after the agent finishes | T10.5 |  |
| 88 | test/agent-widget.test.ts > AgentWidget cost display > shows stats for an agent nobody is tracking live | T10.5 |  |
| 89 | test/agent-widget.test.ts > AgentWidget cost display > defaults to hiding it | T10.5 |  |
| 90 | test/agent-widget.test.ts > AgentWidget overflow accounting > never exceeds the line cap, for any fleet shape | T10.6 |  |
| 91 | test/agent-widget.test.ts > AgentWidget overflow accounting > never prints a footer that miscounts what it hid, for any fleet shape | T10.6 |  |
| 92 | test/agent-widget.test.ts > AgentWidget overflow accounting > keeps the queued summary visible when the running agents fill the widget | T10.6 |  |
| 93 | test/agent-widget.test.ts > AgentWidget overflow accounting > counts everything it hid — the footer total matches what is missing | T10.6 |  |
| 94 | test/agent-widget.test.ts > AgentWidget overflow accounting > gives the queued summary priority over finished lines | T10.6 |  |
| 95 | test/agent-widget.test.ts > AgentWidget overflow accounting > renders everything with no footer when the fleet fits | T10.6 |  |
| 96 | test/agent-widget.test.ts > AgentWidget overflow accounting > shows the completion line again after a finished agent is resumed | T10.6 |  |
| 97 | test/conversation-viewer.test.ts > ConversationViewer invocation line > names the model with its provider | T11.1 |  |
| 98 | test/conversation-viewer.test.ts > ConversationViewer invocation line > falls back to the short label when no canonical id was captured | T11.1 |  |
| 99 | test/conversation-viewer.test.ts > ConversationViewer invocation line > discloses a model and level the run did not honor | T11.1 |  |
| 100 | test/conversation-viewer.test.ts > ConversationViewer invocation line > renders no row at all for a record with no invocation | T11.1 |  |
| 101 | test/conversation-viewer.test.ts > ConversationViewer cost display > shows the cost beside the token count when enabled | T11.2 |  |
| 102 | test/conversation-viewer.test.ts > ConversationViewer cost display > shows no cost when disabled | T11.2 |  |
| 103 | test/conversation-viewer.test.ts > ConversationViewer cost display > shows no cost for a model with no pricing data | T11.2 |  |
| 104 | test/conversation-viewer.test.ts > ConversationViewer > closes with Ctrl+C when not composing | T11.3 |  |
| 105 | test/conversation-viewer.test.ts > ConversationViewer > render width safety > no line exceeds width with empty messages | T11.4 |  |
| 106 | test/conversation-viewer.test.ts > ConversationViewer > render width safety > no line exceeds width with plain text messages | T11.4 |  |
| 107 | test/conversation-viewer.test.ts > ConversationViewer > render width safety > keeps bordered rows exact-width at a double-width truncation boundary | T11.4 |  |
| 108 | test/conversation-viewer.test.ts > ConversationViewer > render width safety > no line exceeds width when text is longer than viewport | T11.4 |  |
| 109 | test/conversation-viewer.test.ts > ConversationViewer > render width safety > no line exceeds width with embedded ANSI escape codes in content | T11.4 |  |
| 110 | test/conversation-viewer.test.ts > ConversationViewer > render width safety > no line exceeds width with long URLs | T11.4 |  |
| 111 | test/conversation-viewer.test.ts > ConversationViewer > render width safety > no line exceeds width with wide table-like content | T11.4 |  |
| 112 | test/conversation-viewer.test.ts > ConversationViewer > render width safety > no line exceeds width with bashExecution messages | T11.4 |  |
| 113 | test/conversation-viewer.test.ts > ConversationViewer > render width safety > no line exceeds width with running activity indicator | T11.4 |  |
| 114 | test/conversation-viewer.test.ts > ConversationViewer > render width safety > no line exceeds width with tool calls | T11.4 |  |
| 115 | test/conversation-viewer.test.ts > ConversationViewer > render width safety > no line exceeds width at narrow terminal | T11.4 |  |
| 116 | test/conversation-viewer.test.ts > ConversationViewer > render width safety > no line exceeds width with mixed ANSI + unicode content | T11.4 |  |
| 117 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > renders assistant Markdown by default instead of raw source markers | T11.5 |  |
| 118 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > leaves assistant text verbatim under `off` | T11.5 |  |
| 119 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > leaves tool results byte-exact under the default mode | T11.5 |  |
| 120 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > renders tool-result Markdown under `all` | T11.5 |  |
| 121 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > does not renumber ordered lists even when it does render them | T11.5 |  |
| 122 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > `m` cycles the mode, persists it, and shows it in the footer | T11.6 |  |
| 123 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > `m` still cycles when no persist hook is wired | T11.6 |  |
| 124 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > `m` disarms a pending stop rather than confirming it | T11.8 |  |
| 125 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > keeps the footer's navigation hints intact at 80 columns | T11.7 |  |
| 126 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > caps a tool result at RESULT_MAX_CHARS, not 500, and says what it dropped | T11.9 |  |
| 127 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > puts the truncation notice outside the code fence it cut into | T11.9 |  |
| 128 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > reports the exact omitted character count | T11.9 |  |
| 129 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > abbreviates a large omitted count so the notice fits a narrow frame | T11.9 |  |
| 130 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > rounds into the M bracket rather than reporting 1000k | T11.9 |  |
| 131 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > falls back to literal wrapping once for an unsafe streaming prefix | T11.10 |  |
| 132 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > tracks a tool result that keeps growing past the cap | T11.9 |  |
| 133 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > leaves a result under the cap untouched | T11.9 |  |
| 134 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > caps bash output with the same rule as a tool result | T11.9 |  |
| 135 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > keeps tool results dim even when rendering them as Markdown | T11.5 |  |
| 136 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > keeps tool results dim on the literal path too | T11.5 |  |
| 137 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > reuses one Markdown per message across renders | T11.10 |  |
| 138 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > re-renders a message whose text is still streaming | T11.10 |  |
| 139 | test/conversation-viewer.test.ts > ConversationViewer > Markdown rendering > renders Markdown to fit, so the overwidth clamp never has to cut it | T11.5 |  |
| 140 | test/conversation-viewer.test.ts > ConversationViewer > safety net against upstream wrapTextWithAnsi bugs > mock is intercepting wrapTextWithAnsi | Dropped: it checks the old test's own mock, not a behavior |  |
| 141 | test/conversation-viewer.test.ts > ConversationViewer > safety net against upstream wrapTextWithAnsi bugs > clamps overwidth lines from toolResult content | T11.4 |  |
| 142 | test/conversation-viewer.test.ts > ConversationViewer > safety net against upstream wrapTextWithAnsi bugs > clamps overwidth lines from user message content | T11.4 |  |
| 143 | test/conversation-viewer.test.ts > ConversationViewer > safety net against upstream wrapTextWithAnsi bugs > clamps overwidth lines from assistant message content | T11.4 |  |
| 144 | test/conversation-viewer.test.ts > ConversationViewer > safety net against upstream wrapTextWithAnsi bugs > clamps overwidth lines from bashExecution output | T11.4 |  |
| 145 | test/conversation-viewer.test.ts > ConversationViewer > safety net against upstream wrapTextWithAnsi bugs > clamps overwidth lines that also contain ANSI codes | T11.4 |  |
| 146 | test/conversation-viewer.test.ts > ConversationViewer > stop key > two-press x stops a running agent (first arms, second aborts) | T11.8 |  |
| 147 | test/conversation-viewer.test.ts > ConversationViewer > stop key > any other key disarms the confirm | T11.8 |  |
| 148 | test/conversation-viewer.test.ts > ConversationViewer > stop key > does not offer or perform stop once the agent is no longer running | T11.8 |  |
| 149 | test/conversation-viewer.test.ts > ConversationViewer > stop key > no stop affordance when no onStop handler is provided (read-only history) | Dropped: the viewer always wires the service's stop; T11.8 hides it once the agent stops running |  |
| 150 | test/conversation-viewer.test.ts > ConversationViewer > steer composer > offers the steer affordance for a running agent and opens on Enter | T11.11 |  |
| 151 | test/conversation-viewer.test.ts > ConversationViewer > steer composer > typing then Enter sends the trimmed message and closes the composer | T11.11 |  |
| 152 | test/conversation-viewer.test.ts > ConversationViewer > steer composer > Esc cancels the composer without sending | T11.11 |  |
| 153 | test/conversation-viewer.test.ts > ConversationViewer > steer composer > an empty submit just returns (like Esc), without calling onSteer | T11.11 |  |
| 154 | test/conversation-viewer.test.ts > ConversationViewer > steer composer > scroll keys are inert while composing (input owns them) | T11.11 |  |
| 155 | test/conversation-viewer.test.ts > ConversationViewer > steer composer > no steer affordance once the agent is no longer running | T11.11 |  |
| 156 | test/conversation-viewer.test.ts > ConversationViewer > steer composer > no steer affordance when no onSteer handler is provided | Dropped: the viewer always wires the service's steer; T11.11 hides it once the agent stops running |  |
| 157 | test/conversation-viewer.test.ts > ConversationViewer > steer composer > composer rows never exceed width | T11.11 |  |
| 158 | test/conversation-viewer-keybindings.test.ts > viewer-keys > honors user keybindings when a manager is provided | T11.13 |  |
| 159 | test/conversation-viewer-keybindings.test.ts > viewer-keys > falls back to hardcoded defaults without a manager | Dropped: the viewer always receives the TUI's keybinding manager (plan Section 2.3) |  |
| 160 | test/conversation-viewer-keybindings.test.ts > viewer-keys > keeps the k/j and shift+arrow aliases with and without a manager | Dropped: the k, j and Shift+arrow aliases are dropped (R12) |  |
| 161 | test/conversation-viewer-keybindings.test.ts > viewer-keys > manager with no user overrides behaves like the hardcoded defaults | T11.13 |  |
| 162 | test/conversation-viewer-keybindings.test.ts > viewer-keys > respects rebinding that removes a default key | T11.13 |  |
| 163 | test/conversation-viewer-keybindings.test.ts > ConversationViewer custom keybindings > scrolls with ctrl+p/ctrl+n when bound to tui.select.up/down | T11.13 |  |
| 164 | test/conversation-viewer-keybindings.test.ts > ConversationViewer custom keybindings > keeps arrows and k/j working alongside custom bindings | Dropped: the k and j aliases are dropped (R12); arrows bound through tui.select.* are case T11.13 |  |
| 165 | test/conversation-viewer-keybindings.test.ts > ConversationViewer custom keybindings > treats ctrl+p/ctrl+n as unbound without a keybindings manager | Dropped: the viewer always receives the TUI's keybinding manager (plan Section 2.3) |  |
| 166 | test/cost-display.test.ts > cost display > the foreground result the orchestrator reads > names the cost in the stats it already reports | T8.9 |  |
| 167 | test/cost-display.test.ts > cost display > the foreground result the orchestrator reads > says nothing when the setting is off | T8.9 |  |
| 168 | test/cost-display.test.ts > cost display > the foreground result the orchestrator reads > says nothing for a model with no pricing data | T8.9 |  |
| 169 | test/cost-display.test.ts > cost display > get_subagent_result > reports the cost as its own labelled field | T8.10 |  |
| 170 | test/cost-display.test.ts > cost display > get_subagent_result > omits the field entirely when unpriced | T8.10 |  |
| 171 | test/cost-display.test.ts > cost display > the background completion notification the model reads > includes the cost in the usage block when enabled | T9.6 |  |
| 172 | test/cost-display.test.ts > cost display > the background completion notification the model reads > omits it when disabled — this is LLM context, not a display | T9.6 |  |
| 173 | test/cost-display.test.ts > cost display > the background completion notification the model reads > omits it for a model with no pricing data | T9.6 |  |
| 174 | test/cost-display.test.ts > cost display > the completion notification > totals a group, so nobody adds four figures by hand | T9.5 |  |
| 175 | test/cost-display.test.ts > cost display > the completion notification > does not total a single agent — the line above already says it | T9.5 |  |
| 176 | test/cost-display.test.ts > cost display > the completion notification > shows no total, and no per-agent cost, when unpriced | T9.5 |  |
| 177 | test/cost-display.test.ts > cost display > the completion notification > shows nothing when the setting is off | T9.5 |  |
| 178 | test/fleet-list.test.ts > formatFleetElapsed > renders integer seconds (no decimal, no suffix) | T7.9 | test/fork-builtins/subagents/ui-format.test.ts > elapsed time writes tenths of a second, and FleetView's whole seconds |
| 179 | test/fleet-list.test.ts > formatFleetElapsed > floors negatives to 0s | T7.9 | test/fork-builtins/subagents/ui-format.test.ts > elapsed time floors FleetView's elapsed time at 0s |
| 180 | test/fleet-list.test.ts > formatFleetTokens > prefixes a down-arrow and uses plural 'tokens' | T7.10 | test/fork-builtins/subagents/ui-format.test.ts > token counts writes `33.8k token`, and FleetView's `↓ 13.1k tokens` |
| 181 | test/fleet-list.test.ts > FleetList navigation > does not register a widget when there are no agents | T12.1 |  |
| 182 | test/fleet-list.test.ts > FleetList navigation > hides nested child records from the coordinator fleet | T12.2 |  |
| 183 | test/fleet-list.test.ts > FleetList navigation > activates on ↓ at an empty prompt, consuming the key | T12.3 |  |
| 184 | test/fleet-list.test.ts > FleetList navigation > also activates on ← (matches the '← for agents' hint) | T12.3 |  |
| 185 | test/fleet-list.test.ts > FleetList navigation > does NOT activate when the prompt is non-empty (typing is preserved) | T12.3 |  |
| 186 | test/fleet-list.test.ts > FleetList navigation > ignores key-release events so one tap moves exactly one row | T12.3 |  |
| 187 | test/fleet-list.test.ts > FleetList navigation > renders the whole selected row in the theme's primary text color (#230) | T12.7 |  |
| 188 | test/fleet-list.test.ts > FleetList navigation > keeps a color badge on the selected row, bolded, without shifting it (#230) | T12.7 |  |
| 189 | test/fleet-list.test.ts > FleetList navigation > moves selection down/up and clamps at the ends | T12.5 |  |
| 190 | test/fleet-list.test.ts > FleetList navigation > ↑ above 'main' deactivates (returns to the prompt) | T12.5 |  |
| 191 | test/fleet-list.test.ts > FleetList navigation > Esc deactivates | T12.5 |  |
| 192 | test/fleet-list.test.ts > FleetList navigation > passes non-nav keys through and cancels navigation | T12.5 |  |
| 193 | test/fleet-list.test.ts > FleetList navigation > ignores all input while disabled and hides the widget | T12.6 |  |
| 194 | test/fleet-list.test.ts > FleetList navigation > re-arms the refresh timer when the list is re-shown (toggle off→on) | T12.6 |  |
| 195 | test/fleet-list.test.ts > FleetList vs other focused components (#123) > does not steal ↓ from a focused selector (activation) | T12.4 |  |
| 196 | test/fleet-list.test.ts > FleetList vs other focused components (#123) > does not steal navigation keys from a selector opened while the list was active | T12.4 |  |
| 197 | test/fleet-list.test.ts > FleetList vs other focused components (#123) > still activates when the prompt editor has focus | T12.4 |  |
| 198 | test/fleet-list.test.ts > FleetList vs other focused components (#123) > assumes the editor when focus is unknowable (no tui yet / nothing focused) | T12.4 |  |
| 199 | test/fleet-list.test.ts > FleetList rendering > renders main + agent rows with markers, type, description and right-aligned stats | T12.8 |  |
| 200 | test/fleet-list.test.ts > FleetList rendering > orders agents earliest-launched first (top) | T12.8 |  |
| 201 | test/fleet-list.test.ts > FleetList rendering > hides agents that have no session yet (pending) | T12.2 |  |
| 202 | test/fleet-list.test.ts > FleetList rendering > collapses overflow into a '↓ N more' indicator | T12.8 |  |
| 203 | test/fleet-list.test.ts > FleetList rendering > never emits a line wider than the terminal (guards wrap-induced flicker) | T12.8 |  |
| 204 | test/fleet-list.test.ts > FleetList rendering > windows the visible agents so the selection stays on screen | T12.8 |  |
| 205 | test/fleet-list.test.ts > FleetList overlay lifecycle > Enter on 'main' just deactivates (no overlay) | T12.9 |  |
| 206 | test/fleet-list.test.ts > FleetList overlay lifecycle > keeps the cursor on the viewed agent after closing, even if the list reordered | T12.9 |  |
| 207 | test/fleet-list.test.ts > FleetList overlay lifecycle > wires the viewer's steer composer to manager.steer with the agent id | T12.9 |  |
| 208 | test/fleet-list.test.ts > FleetList overlay lifecycle > hands the viewer the user's markdown setting, and persists a mode chosen with m | T12.9 |  |
| 209 | test/fleet-list.test.ts > FleetList overlay lifecycle > does NOT auto-close when the viewed agent finishes (final output stays readable) | T12.9 |  |
| 210 | test/fleet-list.test.ts > FleetList overlay lifecycle > lingers a finished agent in the list, then drops it after the window | T12.9 |  |
| 211 | test/fleet-list.test.ts > FleetList cost display > appends the cost after the token count when enabled | T12.10 |  |
| 212 | test/fleet-list.test.ts > FleetList cost display > shows no cost when disabled, and none for an unpriced model | T12.10 |  |
| 213 | test/fleet-list.test.ts > FleetList cost display > reads the record, so the figures do not change when the agent finishes | T12.10 |  |
| 214 | test/fleet-list.test.ts > FleetList workflow rows > renders identically with no workflow source and an empty one | Dropped: workflow runs are gone (R1) |  |
| 215 | test/fleet-list.test.ts > FleetList workflow rows > navigates agents exactly as before when no run is present | Dropped: workflow runs are gone (R1) |  |
| 216 | test/fleet-list.test.ts > FleetList workflow rows > clears the widget when the last run and the last agent both go | Dropped: workflow runs are gone (R1) |  |
| 217 | test/fleet-list.test.ts > FleetList workflow rows > lists a run above the agents, with its counts and stats | Dropped: workflow runs are gone (R1) |  |
| 218 | test/fleet-list.test.ts > FleetList workflow rows > agrees with itself about a single-agent run | Dropped: workflow runs are gone (R1) |  |
| 219 | test/fleet-list.test.ts > FleetList workflow rows > hides the run's own agents — the run is the row that represents them | Dropped: workflow runs are gone (R1) |  |
| 220 | test/fleet-list.test.ts > FleetList workflow rows > moves into the list when the only row is a run | Dropped: workflow runs are gone (R1) |  |
| 221 | test/fleet-list.test.ts > FleetList workflow rows > still does nothing at an empty prompt with no rows at all | Dropped: workflow runs are gone (R1) |  |
| 222 | test/fleet-list.test.ts > FleetList workflow rows > opens the selected run rather than a conversation viewer | Dropped: workflow runs are gone (R1) |  |
| 223 | test/fleet-list.test.ts > FleetList workflow rows > keeps its hands off the keyboard while the inspector is up | Dropped: workflow runs are gone (R1) |  |
| 224 | test/fleet-list.test.ts > FleetList workflow rows > comes back to the same run when the inspector closes | Dropped: workflow runs are gone (R1) |  |
| 225 | test/fleet-list.test.ts > FleetList workflow rows > still opens an agent's viewer when the selection is past the runs | Dropped: workflow runs are gone (R1) |  |
| 226 | test/fleet-list.test.ts > FleetList workflow rows > drops a settled run once it stops lingering, and keeps a live one | Dropped: workflow runs are gone (R1) |  |
| 227 | test/fleet-list.test.ts > FleetList workflow rows > freezes a finished run's clock the way an agent's is frozen | Dropped: workflow runs are gone (R1) |  |
| 228 | test/fleet-wiring.test.ts > FleetView wiring (real extension lifecycle) > captures terminal input on tool_execution_start (fleet hooked into the UI) | T12.12 |  |
| 229 | test/fleet-wiring.test.ts > FleetView wiring (real extension lifecycle) > registers the belowEditor widget once a spawned agent has a session, then clears it on shutdown | T12.1 |  |
| 230 | test/perf/no-fs-on-render.perf.test.ts > a rendered frame touches no filesystem > AgentWidget.render | T10.9 |  |
| 231 | test/perf/no-fs-on-render.perf.test.ts > a rendered frame touches no filesystem > ConversationViewer.render | T11.15 |  |
| 232 | test/perf/render-invariants.perf.test.ts > ConversationViewer — cost stays linear in transcript length > does ~10x the work for 10x the messages (raw wrap path) | T11.14 |  |
| 233 | test/perf/render-invariants.perf.test.ts > ConversationViewer — cost stays linear in transcript length > does ~10x the work for 10x the messages (markdown path) | T11.14 |  |
| 234 | test/perf/render-invariants.perf.test.ts > ConversationViewer — cost stays linear in transcript length > re-renders without re-parsing: the markdown cache survives a frame | T11.10 |  |
| 235 | test/perf/render-invariants.perf.test.ts > AgentWidget — one frame does not rescan per agent > asks the manager for the agent list a constant number of times | T10.9 |  |

## Notes

- Rows 122 and 208: the Markdown mode's persistence is dropped (plan P16). The kept half, cycling the mode and handing the setting to the viewer, maps to the row's case.
- Rows 67 to 72 and 78: the fork's widget takes its mode from the `widgetMode` setting, whose default is `background`. Row 67's "and by default" referred to pi-subagents' widget class default.

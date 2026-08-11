# Generic tool aliases in Pi core

Status: deferred (see ADR-0006 — superseded for now by the tool-name redirect map; kept ready for promotion if redirect retries prove insufficient for weaker models)

This proposal was prepared against revision `e25967936119f9c96cc1e1e497767f599f87cf33`. Re-locate symbols by name if the implementation begins from a different revision.

## Objective

Allow users to expose additional provider-facing names for existing Pi tools without modifying or wrapping the tool implementation.

The target configuration is:

```json
{
  "toolAliases": {
    "AskUserQuestion": "ask_user_question"
  }
}
```

The object maps an alias to a canonical tool name. When `ask_user_question` is active, the model receives both `ask_user_question` and `AskUserQuestion` with the same description and parameter schema. Calling either name validates and executes the same implementation.

## Problem

Pi currently identifies tools only by `Tool.name`:

1. `AgentSession._refreshToolRegistry()` builds definition and execution registries keyed by name.
2. `AgentSession.setActiveToolsByName()` selects active tools by exact name.
3. `streamAssistantResponse()` sends those tools to the provider.
4. `prepareToolCall()` finds the implementation with `tool.name === toolCall.name`.
5. Rendering resolves custom tool definitions by exact name.

A companion extension can register a cloned tool under another name, but that creates independent active-tool state. This is incorrect for tools that dynamically enable or disable themselves.

For example, `rpiv-ask-user-question` removes `ask_user_question` when no UI is available. An independently registered `AskUserQuestion` clone can remain active and offer a questionnaire that cannot be rendered. A core alias must follow the canonical tool's lifecycle instead of behaving like a second registration.

## Product semantics

### Configuration

Add this optional setting:

```ts
export interface Settings {
  toolAliases?: Record<string, string>;
}
```

Each property is `alias: canonicalName`.

Global and project settings use the existing deep-merge behavior. A project entry with the same alias overrides the global target.

### Resolution

Resolve aliases after built-in, extension, and SDK registrations have produced the final canonical tool registry. This makes an alias follow the effective implementation after normal override precedence is applied.

Rules:

- Alias targets must be concrete registered tool names.
- Alias-to-alias chains are rejected in the initial implementation.
- A concrete tool name always wins over an alias with the same name.
- Duplicate alias declarations use normal settings precedence.
- Missing targets, alias chains, and name collisions produce diagnostics and skip the invalid alias.
- Alias resolution reruns whenever dynamic tool registration refreshes the registry.

### Activation

Canonical active-tool state remains the source of truth:

- An alias is provider-visible exactly when its canonical tool is active.
- Enabling a canonical tool exposes all valid aliases.
- Disabling a canonical tool removes all aliases.
- `getActiveTools()` continues returning canonical names.
- `getAllTools()` reports `aliases?: string[]` on each canonical tool instead of returning duplicate tool entries.
- `--tools` and `--exclude-tools` accept aliases by resolving them to canonical names. Selecting or excluding an alias affects the whole canonical tool group.

Keeping aliases out of canonical active state ensures existing extension reconciliation continues to work unchanged.

### Prompt contributions

Aliases do not duplicate `promptSnippet` or `promptGuidelines`. Those contributions remain keyed to and controlled by the canonical tool.

Provider tool schemas are necessarily duplicated because providers dispatch by the advertised name. Each alias therefore adds the token cost of another tool definition.

### Transcript and extension events

Preserve both identities:

- Assistant tool calls, tool-result messages, and tool execution lifecycle events retain the invoked name. This preserves provider and transcript fidelity.
- `tool_call` and `tool_result` extension events keep `toolName` canonical so existing typed handlers continue to work.
- Add `invokedToolName?: string` to those extension events when the provider used an alias.

Example:

```ts
{
  toolName: "ask_user_question",
  invokedToolName: "AskUserQuestion"
}
```

This avoids breaking handlers such as `isToolCallEventType("bash", event)` while still exposing the exact model behavior.

## Architecture

### 1. Settings and public metadata

Modify:

- `packages/coding-agent/src/core/settings-manager.ts`
- `packages/coding-agent/src/core/extensions/types.ts`
- `packages/coding-agent/src/index.ts`

Add:

```ts
getToolAliases(): Readonly<Record<string, string>>;
```

Extend `ToolInfo` with:

```ts
aliases?: string[];
```

Do not add aliases directly to `ToolDefinition` in the initial implementation. The feature must work for third-party and built-in tools without changing their source.

### 2. Canonical alias index

Modify `packages/coding-agent/src/core/agent-session.ts`.

During `AgentSession._refreshToolRegistry()`:

1. Build the canonical definition and execution registries exactly as today.
2. Read `settingsManager.getToolAliases()`.
3. Validate every alias against the completed canonical registry.
4. Build both indexes:
   - alias to canonical name
   - canonical name to aliases
5. Attach the resolved aliases to the canonical runtime tool.
6. Include aliases in `getAllTools()` metadata.

Add internal helpers similar to:

```ts
resolveCanonicalToolName(name: string): string | undefined;
getAliasesForTool(name: string): readonly string[];
expandProviderToolNames(names: readonly string[]): string[];
```

`getToolDefinition(name)` must resolve an alias before reading `_toolDefinitions`. This preserves custom TUI and HTML rendering for aliased calls.

### 3. Runtime representation

Modify `packages/agent/src/types.ts`:

```ts
export interface AgentTool<...> extends Tool<...> {
  aliases?: string[];
  // Existing fields remain unchanged.
}
```

Aliases are runtime metadata on the canonical executable tool. They are not separate executable registrations.

### 4. Provider schema expansion

Modify `packages/agent/src/agent-loop.ts`.

Before constructing `llmContext`, expand each active canonical tool into provider-facing definitions:

```ts
function expandToolAliases(tools: AgentTool[] | undefined): Tool[] | undefined {
  return tools?.flatMap((tool) => [
    tool,
    ...(tool.aliases ?? []).map((alias) => ({
      ...tool,
      name: alias,
      aliases: undefined,
    })),
  ]);
}
```

Use the expanded list only for `llmContext.tools`. Keep `currentContext.tools` canonical so active state and execution remain stable.

Central expansion makes the feature provider-independent. Anthropic, OpenAI, Google, Mistral, Bedrock, and custom providers continue receiving ordinary `Tool` objects and require no alias-specific branches.

### 5. Alias-aware dispatch

Modify `prepareToolCall()` in `packages/agent/src/agent-loop.ts` to resolve exact canonical names first, then aliases:

```ts
const tool = currentContext.tools?.find(
  (candidate) =>
    candidate.name === toolCall.name ||
    candidate.aliases?.includes(toolCall.name),
);
```

The returned canonical tool supplies:

- `prepareArguments`
- parameter validation schema
- constrained-sampling metadata
- execution mode
- execute implementation

The original `toolCall.name` remains unchanged for transcript and provider protocol purposes.

Prefer a shared lookup helper over repeating the predicate in sequential-mode detection, preparation, and validation paths.

### 6. Extension hook identity

Modify:

- `packages/agent/src/types.ts`
- `packages/coding-agent/src/core/agent-session.ts`
- `packages/coding-agent/src/core/extensions/types.ts`

The agent runtime already knows the canonical `AgentTool` selected for a prepared call. Make the canonical name available to the coding-agent hooks, or resolve it through `AgentSession` before emitting extension events.

Emit:

- canonical `toolName`
- optional `invokedToolName` when it differs

Tool execution lifecycle events may continue using the invoked name because they describe the actual assistant message and drive transcript rendering.

### 7. Dynamic tool loading

Aliases must participate in deferred-tool loading.

Today `wrapRegisteredTool()` compares active names before and after execution and writes newly active names to `addedToolNames`. When a canonical tool becomes active, expand that list to include all provider-facing aliases:

```ts
["canonical_tool", "CompatibilityAlias"]
```

Add a runner/runtime action that expands canonical names through the session alias index. Do not make `getActiveTools()` return aliases, because that would reintroduce independent alias state and break extension reconciliation.

This preserves native Anthropic and OpenAI deferred loading and avoids introducing alias definitions at the wrong transcript position.

### 8. Diagnostics

Use the existing extension/resource diagnostics surface rather than throwing during startup.

Diagnostics should name:

- the invalid alias
- its configured target
- the reason it was skipped
- the settings scope or source when available

A malformed alias must not prevent unrelated tools from loading.

## Alternatives considered

### Clone tool registrations in `AgentSession._refreshToolRegistry()`

This is mechanically simple, but it makes aliases independent registry and active-state entries. Existing extensions that remove only their canonical name can leave aliases enabled. It also duplicates prompt contributions unless additional filtering is added.

Rejected.

### Rewrite alias calls to canonical names before execution

Dispatch rewriting alone is insufficient because the provider must receive an actual schema under the alias name. Rewriting persisted assistant content also loses transcript fidelity and can complicate provider replay.

Rejected as the primary design.

### Add `aliases` to `ToolDefinition`

This is useful for extension-authored aliases but does not solve the motivating case without changing the third-party extension. It can be added later as another source feeding the same canonical alias index.

Deferred.

### Add `pi.registerToolAlias(alias, target)`

This can be layered on the same resolver later. The settings form is sufficient for the initial user-controlled compatibility feature and requires no companion extension.

Deferred.

## Tests

### Settings

Add settings-manager tests covering:

- Global aliases.
- Project overrides of individual aliases.
- Empty configuration.
- Reloaded configuration.

### Registry and activation

Add coding-agent tests covering:

- Alias metadata returned by `getAllTools()`.
- Alias absent when its canonical target is absent.
- Alias follows a dynamically registered target.
- Concrete-name collision skips the alias.
- Missing target and alias-chain diagnostics.
- Extension or SDK override chosen before alias resolution.
- Disabling the canonical tool removes its aliases from the next provider request.
- Enabling the canonical tool adds its aliases.
- `getActiveTools()` remains canonical-only.

### Execution

Using the faux provider, verify:

- Both canonical and alias schemas are sent.
- Calling the alias validates against the canonical schema.
- `prepareArguments` runs exactly once.
- The canonical execute implementation runs exactly once.
- Sequential execution mode is preserved.
- Tool results retain the invoked alias.
- Extension hooks receive canonical `toolName` and alias `invokedToolName`.
- Custom TUI and HTML renderers resolve through an alias.

### Dynamic and deferred tools

Extend the dynamic-tool regression coverage to verify:

- Activating a tool after another tool call adds both canonical and alias names to `addedToolNames`.
- Native deferred-loading providers load both definitions at the same result position.
- Removing a tool does not report either name as added.

### Filters

Cover alias use with:

- `--tools`
- `--exclude-tools`
- built-in tools
- extension tools
- SDK custom tools

## Documentation

Update:

- `packages/coding-agent/docs/settings.md`
- `packages/coding-agent/docs/extensions.md`
- `packages/coding-agent/CHANGELOG.md`

Document:

- the `alias: canonicalName` direction
- activation coupling
- collision behavior
- provider schema token cost
- canonical versus invoked event names
- project override behavior

## Acceptance criteria

The feature is complete when:

1. The example configuration exposes `AskUserQuestion` and `ask_user_question` while registering only one executable implementation.
2. Calling either name validates and executes identically.
3. Alias visibility always follows canonical active state.
4. Existing extension reconciliation code does not need alias-specific changes.
5. Prompt snippets and guidelines are not duplicated.
6. Extension hooks retain canonical typed behavior and can inspect the invoked alias.
7. Custom tool rendering works for alias calls.
8. Dynamic and native deferred-tool loading expose aliases at the correct transcript position.
9. Invalid aliases produce diagnostics without blocking startup.
10. Existing behavior is unchanged when `toolAliases` is absent.
11. Targeted tests and `npm run check` pass.

## Suggested implementation order

1. Add settings types, getter, merge tests, and diagnostics model.
2. Build the alias indexes in `AgentSession` and expose metadata.
3. Add runtime alias metadata and provider schema expansion.
4. Make dispatch alias-aware.
5. Preserve canonical and invoked identities in hooks and rendering.
6. Integrate dynamic and deferred tool-name expansion.
7. Add filter handling, documentation, changelog entry, and full targeted validation.

# Provider session context: results

Pi commit `6ca73ea7f` (2026-09-30) added `StreamOptions.sessionContext`. A session-bound chat stream now tells its provider which AgentSession serves the request, and that session's directories. The claude-bridge merge needed it: an isolated subagent child loads no extensions but shares its parent's model runtime, so the bridge started Claude Code in the process cwd. This file records the contract, why no existing seam sufficed, its upstream-owned footprint, and the 2026-10-01 review that renamed the id field. The original plan lives in the bridge: `pi-claude-bridge/plans/pi-provider-session-context-2026-09-30.md`.

## Contract

`ProviderSessionContext` lives in the fork-owned module `packages/ai/src/provider-session-context.ts`.

| Field | Meaning |
| --- | --- |
| `agentSessionId` | Id of the AgentSession whose stream wrapper serves the request. A subagent child carries its own id, not its parent's. |
| `cwd` | That session's working directory. |
| `agentDir` | That session's agent configuration directory. |

| Rule | Where |
| --- | --- |
| `buildRequestOptions` in `packages/coding-agent/src/core/sdk.ts` sets a fresh snapshot per request and overrides a caller's value. | `sdk.ts` |
| `options.sessionId` stays the routing and caching identity, so summaries may use another id. | `sdk.ts` |
| The field is local metadata. No built-in provider serializes it into payloads or headers. | `packages/ai/test/provider-session-context.test.ts` |
| `piForkCapabilities` advertises it as `provider-session-context`. | `packages/coding-agent/src/core/fork-capabilities.ts` |

## Why Pi needed a change

Every seam that existed at `ab482a64a` failed for a child that loads no extension.

| Existing seam | Why it does not carry the child's directories |
| --- | --- |
| Default-stream scope (`default-stream-fn.ts`) | It holds no directories, and a session's own requests do not consult it. |
| Shared `ModelRuntime` | Parent and child share one runtime with no per-session state. |
| `Agent` options | The loop forwards only `sessionId`; adding a field still needs a Pi change. |
| Subagent runner | `createAgentSession` takes no stream-options hook, and replacing the stream function breaks summary auth. |
| `session-resources.ts` | It provides cleanup by id, not a lookup from id to directories. |
| `StreamOptions.metadata` | Providers forward it to vendors; Anthropic sends `metadata.user_id`. |
| Parsing the system prompt | A forced replacement prompt can omit the cwd section. |

## Callers that bypass the session wrapper

A call through `ModelRuntime` directly carries no `sessionContext` unless its caller supplies one.

| Caller | State |
| --- | --- |
| `/agents` create wizard (`fork-builtins/subagents/ui/create-wizard.ts`) | Supplies the context since 2026-10-01. Before, claude-bridge refused the generate path. |
| Agent mention clone (`fork-builtins/subagents/tools/mention-clone.ts`) | Routes by the parent's `sessionId`, which claude-bridge resolves to the parent's binding. |
| `compact()` without a `streamFn` (`core/compaction/compaction.ts`) | No fork caller does this. A third-party caller gets claude-bridge's explicit refusal. |

## Upstream-owned footprint

| File | Lines |
| --- | --- |
| `packages/ai/src/types.ts` | 6 added: one import and the documented optional field. |
| `packages/ai/src/index.ts` | 1 added: the type export. |
| `packages/coding-agent/src/core/sdk.ts` | 1 added in `buildRequestOptions`. |
| `packages/coding-agent/docs/custom-provider.md` | 16 added: the "Local session context" section. |
| `packages/coding-agent/test/sdk-stream-options.test.ts` | 16 added: the override test. |
| `packages/coding-agent/test/suite/agent-session-summary-auth.test.ts` | 5 added: the summary-request assertion. |

Every other file is fork-owned: the type module, both `provider-session-context.test.ts` files, `fork-capabilities.ts`, and the subagents wizard and its suite test.

## Review on 2026-10-01

| Check | Finding | Disposition |
| --- | --- | --- |
| Necessity | No existing seam works (section above). | The change stands. |
| ADR-0003 | New code sits in a new module; hot files got one-line call sites. | Conforms. |
| Fork record | The rationale lived only in the bridge repository. | This file. |
| Capability marker | Fork-only guarantees get a `piForkCapabilities` entry (precedent `c66ffc40f`). | Added `provider-session-context`. |
| Naming | `ownerSessionId` clashes with the session-control handoff, where a child's owner is its parent session. | Renamed to `agentSessionId`; claude-bridge is the only consumer and changed with it. |
| Commit scope | `6ca73ea7f` says `feat(ai)` but also changes coding-agent. | Recorded only; the commit is published. |
| Bypassing callers | The create wizard failed on claude-bridge models. | Fixed with a suite assertion. |

## Known gaps

- A worktree child's `cwd` is its worktree, while Pi loads the child's settings from the parent project (`configCwd` in `fork-builtins/subagents/runner/run.ts`). The contract carries no config directory. claude-bridge reads only prompt-level keys from a project file, so the gap cannot change a child's executable or Claude profile.
- When the session-control work defines owners and generations, this per-request snapshot stays a serving-session fact, not an ownership record.

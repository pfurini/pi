# Plan: Session-scoped default stream target (cross-session contamination fix)

Branch: `feat/default-stream-session-scope` (off `feat/default-stream-parity`).
Status: reviewed (GO-WITH-CHANGES, 2026-07-30); revisions below are incorporated.

## Problem

The composed default stream function (`packages/coding-agent/src/core/default-stream-fn.ts`)
resolves bare Agents (constructed without `streamFn`, typically by extensions) against a
process-global stack where the most recently installed live session wins. In a process with
several concurrent `AgentSession`s (SDK embedders; verified real in Archon's `PiProvider`,
which creates a fresh session per `sendQuery()` with deliberate concurrency and no dispose
on success), a bare Agent created by session A's extension resolves to session B's runtime:
B's credentials resolution, B's registered extension providers, B's models.json overlays.
The misroute succeeds silently because A and B usually share the same stored credentials.

The correct oracle is "which session is calling", not "which session was created last".

## Design

Use `AsyncLocalStorage` (node:async_hooks; supported by Node and Bun) to carry the calling
session's `DefaultStreamTarget` through its async call trees. Dispatch order in
`composedDefaultStreamFn` becomes:

1. **Scoped target**: `activeTarget.getStore()`; if present and `runtimeServesModel(target.runtime, model)`,
   use `target.streamFn`.
2. **Stack** (unchanged): most recently installed live target that serves the model.
3. **Raw compat** (unchanged).

The scoped check reuses the existing `runtimeServesModel` guard, so a model the calling
session cannot serve still falls through to the stack, then compat. Every current behavior
is preserved when no scope is active; the change is purely additive.

### Where the scope is entered

Two chokepoints cover the realistic spawn sites for bare Agents:

1. **`AgentSession._runAgentPrompt()` plus `prompt()`** (review change #2). `_runAgentPrompt`
   is the single entry for every agent run (reached from `prompt()` and from
   `sendCustomMessage({triggerTurn: true})`, which bypasses `prompt()` entirely), and covers
   `agent.continue()`, retries, `_handlePostAgentRun`, and `_emitAgentSettled` in one wrap.
   `prompt()` stays wrapped as well for its pre-run segment (extension command dispatch,
   `emitInput`, `emitBeforeAgentStart`). Together they cover **extension tool `execute()`**
   (the dominant place subagent-style extensions construct bare Agents), steering/follow-up
   drains, and timers scheduled within the tree (ALS propagates through timers and promise
   chains).

2. **`ExtensionRunner` handler dispatch**. Extension handlers also fire outside any prompt:
   `session_start` (bind), `session_shutdown`, `reload`, `session_before_switch`/`fork`
   (agent-session-runtime.ts), `agent_settled`, etc. Rather than wrapping ~15 scattered
   emit call sites, add one runner-level hook:
   - `ExtensionRunner.scopeRunner?: <T>(fn: () => T) => T` (set by the session when it
     binds the runner; rebind on reload wherever `_extensionRunner` is assigned).
   - Wrap the **bodies of the emit\* methods** (13 methods; reviewer-preferred over the
     inner `handler(event, ctx)` calls: same site count, but also scopes `createContext()`
     and inter-handler work, and is robust to future code added inside an emit method).
     `runScoped` applies `scopeRunner` when set. Known exceptions, accepted: extension
     keyboard-shortcut handlers fire from the TUI input path (single-session, stack
     resolves correctly) and `emitProjectTrustEvent` dispatches from a
     `LoadExtensionsResult` before any runner exists.

3. **Session replacement** (review change #1, a real regression otherwise):
   `AgentSessionRuntime.finishSessionReplacement`'s `withSession(...)` callback and
   `newSession`'s `setup(...)` run after the old session (whose ALS scope the triggering
   extension command is still inside) was disposed. Wrap both calls in the NEW session's
   scope (`this.session.runInDefaultStreamScope(...)`) so post-replacement work routes to
   the live session instead of the disposed one.

### Plumbing

- `default-stream-fn.ts`: module-level `new AsyncLocalStorage<DefaultStreamTarget>()`;
  export `runWithDefaultStreamTarget<T>(target, fn): T`. The scoped lookup goes first in
  `composedDefaultStreamFn`.
- `sdk.ts` (`createAgentSession`): name the target
  (`const defaultStreamTarget = { runtime: modelRuntime, streamFn: sessionStreamFn }`),
  install it as today, and pass `defaultStreamTarget` into `AgentSessionConfig` alongside
  the existing `releaseDefaultStreamRuntime`.
- `agent-session.ts`: store the target; add
  `runInDefaultStreamScope<T>(fn): T` (no-op passthrough when the session has no target,
  e.g. directly constructed test sessions); wrap `prompt()` and `_runAgentPrompt()`; set
  `runner.scopeRunner = (fn) => this.runInDefaultStreamScope(fn)` in `_buildRuntime`
  (the single point where `_extensionRunner` is assigned; `ctx.reload()` flows through it).
- Scoped dispatch injects the target's `onPayload`/`onResponse` defaults exactly like the
  stack dispatch (shared helper), so bare callers get extension provider hooks on both
  paths and direct session-stream callers stay hook-free.

### Explicitly out of scope / accepted limitations

- **Extension factory execution at load time** runs before the session (and its target)
  exists; a bare Agent constructed at factory top-level still resolves via the stack.
  Documented; unchanged from current behavior.
- **Nested `createAgentSession` inside a run**: an extension that creates a sub-session
  inside a tool call and then constructs a bare Agent now resolves to the OUTER session's
  scope (previously the sub-session won as stack top). No known consumer; accepted.
- **Extension keyboard shortcuts and `emitProjectTrustEvent`** dispatch outside the runner
  scope hook (see above); they fall back to the stack, which is correct in the
  single-session CLI.
- A disposed session's in-flight scoped work keeps using its own target (the closure keeps
  the runtime alive). This matches how the session's own Agent behaves after dispose.
- `agent-session-runtime.ts` emissions (`session_before_switch`/`fork`) are covered via
  the runner-level hook, not by touching that file.

## Tests (`test/default-stream-fn.test.ts` unless noted)

1. **Cross-session misroute regression (runner path)**: session A (created first) with
   overlay provider marker A and an extension whose `agent_settled` handler constructs a
   bare Agent and streams A's model; session B (created later) with the same provider id
   and marker B. Emit `agent_settled` through A's runner: marker A must fire, marker B must
   not. Without the fix, this test fails (B wins).
2. **Prompt-tree scoping (E2E, MANDATORY per review change #4)**: faux-provider session A
   whose extension registers a tool that constructs a bare Agent and streams a model served
   by A's overlay; session B newer; `sessionA.prompt(...)` triggers the tool; assert A's
   marker. This is the only test that validates the `_runAgentPrompt` chokepoint against
   extension tool execution. (Pattern: registerFauxProvider harness from
   `tool-output-policy.test.ts`.)
3. **Fallback preserved**: with a scope active whose runtime does not serve the model, the
   stack still resolves (assert stack target's marker fires); with no scope, all existing
   tests pass unchanged.
4. Existing suite green; `npm run check` green.

## Risks

- **Missed entry points**: any session-owned path not under the wrapped chokepoints falls
  back to today's stack behavior — degraded, never worse than current (with the one
  session-replacement exception above, which is fixed, not accepted). Note the handler
  invariant is NOT absolute: keyboard shortcuts and `emitProjectTrustEvent` dispatch
  outside runner.ts emit methods.
- **ALS overhead**: one `.run()` per prompt/dispatch; negligible against LLM I/O.
- **Bun compatibility (unverified assumption)**: Bun documents AsyncLocalStorage support;
  the compiled-binary path (`build:binary`) gets no test coverage under this plan's
  verification strategy. The Node suite is the verified surface; a Bun smoke run is a
  follow-up if the binary path matters.

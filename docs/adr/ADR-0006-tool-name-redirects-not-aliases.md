---
id: ADR-0006
status: accepted
---

# CC tool names are handled by redirects and local steering, not a tool-alias mechanism

When a model invokes an unregistered tool name, the error result consults a redirect map
(core-shipped defaults: `AskUserQuestion → ask_user_question`, `Task → Agent`, `Glob → find`,
capitalized→lowercase identities; user-extensible via settings; nearest-name fallback for
unmapped misses) and replies "not available — use X instead". An entry is only suggested when
its target is currently registered, which lets core safely carry defaults for extension-owned
tools without any extension API. Two narrowly-scoped steering aids complement it: description
parentheticals only where the name gap is real (`Agent` mentions "Task" in the pi-subagents
fork; `find` mentions "Glob"), and a render-pipeline note appended to a rendered skill only
when CC tool names are detected in its body. No global system-prompt mapping table.

## Considered options

A full core tool-alias mechanism was fully designed (`docs/plans/tool-aliases.md`, now status:
deferred, kept for possible promotion). Rejected for now because: a tool-name census across
ASE (47 skills), gstack, and installed third-party skills found only two names that matter and
both resolve semantically (models match prose names against in-context schemas — parameter
shapes like `subagent_type` are near-unique fingerprints); strict/constrained tool calling
cannot emit unregistered names at all, making misses rare; aliases duplicate full tool schemas
in every provider request (permanent token tax); and the plan modifies hot upstream files,
violating ADR-0003. Note: an alias is an alternate name over the *same schema*, never an
adapter — it could not have handled `Glob → find` anyway; the redirect can, because the model
re-invokes using the real tool's schema.

## Consequences

Skill `disallowed-tools` matching must consult the redirect map so `disallowed-tools: [Task]`
also blocks `Agent`. If real usage shows weaker models flailing on redirect retries, promote
the deferred alias plan.

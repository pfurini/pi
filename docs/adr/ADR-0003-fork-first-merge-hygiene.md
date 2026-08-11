---
id: ADR-0003
status: accepted
---

# New subsystems as new modules; hot upstream files get thin call sites only

This fork of pi-mono is long-term: upstream PRs happen only for bug fixes or generally useful
features, so every feature here must survive repeated merges from upstream. Rule: new subsystems
(skill render pipeline, commands engine, tokenizer, interop, redirect map) live in **new
files/modules**; existing high-churn upstream files — `agent-session.ts`,
`interactive-mode.ts`, `core/skills.ts`, `agent-loop.ts` — receive only thin, few-line call
sites into those modules. When a design choice trades elegance against smaller diffs in hot
files, smaller diffs win. This rule decided against the tool-aliases core plan (ADR-0006),
which would have modified `prepareToolCall` and `_refreshToolRegistry` in place.

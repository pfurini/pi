---
id: ADR-0005
status: accepted
---

# One command namespace: bare invocation, fixed precedence, prompt-producing vs control split

Skills and commands are invocable bare (`/name`), sharing one flat namespace with deterministic
precedence: built-ins > extension commands > commands/prompt templates > skills. The prefixes
(`/skill:`, `/prompt:`, and `/ext:` for extension commands) are demoted from mandatory to
disambiguators; collisions emit a
diagnostic and the loser stays reachable via its qualified form. Commands split into two kinds:
**prompt-producing** (skills, commands) are recognized and expanded anywhere in the message
(exact match against the registry, standalone tokens only, backslash-escapable, stacking capped
at 6); **control** commands (`/model`, `/reload`, `/skills`) stay message-initial. The commands
system is an evolution of the existing prompt-template engine — one engine, one render pipeline
shared with skills (ADR-0004) — not a parallel second system.

## Considered options

Keeping the mandatory `/skill:` prefix was rejected as the main daily friction for CC-authored
skills (their docs and skill-to-skill dispatch all use bare dir-derived names). The safety
property that makes bare + mid-prompt matching acceptable is exact-match-against-registry;
fuzzy or prefix matching is explicitly rejected (`/usr/bin` never matches because `usr` is not
a registered command).

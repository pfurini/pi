---
id: ADR-0004
status: accepted
---

# Deterministic skill render pipeline with provider-aware delivery transport

Pi's naive skill expansion (`_expandSkillCommand` raw-append) and the model-read convention
("the model should `read` the SKILL.md") are both retired. Every invocation path — user
command, model `skill` tool call, fork — goes through one deterministic render pipeline
(base-dir preamble → argument substitution → variable substitution → shell injection), and the
rendered content is delivered via a provider-aware transport: a **message block** (Claude
Code's own native delivery format) as the universal default, upgraded per provider to a
harness-fabricated **synthetic tool-use/result pair** once transcript-replay verification
passes for that provider. The claude-bridge provider always uses the message block — the CC SDK
owns its side of the session and cannot accept injected assistant tool_use blocks.

## Considered options

- **Model-read invocation** (keep/strengthen "read the file yourself"), motivated by a claimed
  ~30% attention advantage for tool-read content. Researched 2026-08-11: no controlled study
  supports the claim; the closest experiment (canary-string retention across delivery methods,
  March 2026) found no difference when content arrives intact, and OpenSkillEval (arXiv
  2605.23657) shows agents frequently fail to read available skill files at all. Decisive
  independent argument: raw file reads bypass the render pipeline entirely — the on-disk file
  contains unrendered `$ARGUMENTS`/`${..._SKILL_DIR}` templates — so delivery must be
  harness-mediated regardless.
- **Ask the model to invoke the skill tool on user `/name` invocation.** Rejected: reintroduces
  the "model might not do it" failure mode and an extra round trip; the synthetic pair gets the
  same tool-result channel deterministically.

## Consequences

The transport is a per-provider capability, not global behavior; adding a provider means
choosing its transport. Render and lifecycle (dedup, budgets, carry-forward) are
provider-independent and happen before transport, so no provider loses features.

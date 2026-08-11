---
id: ADR-0007
status: accepted
---

# Pi is CC skill-file compatible (documented subset), not CC framework compatible

A config-gated interop module in core makes standalone CC-authored skills work when placed in
Pi's own locations: the full CC frontmatter contract is parsed with lenient booleans (unknown
fields preserved), `${CLAUDE_SKILL_DIR}`/`${CLAUDE_PROJECT_DIR}`/`${CLAUDE_SESSION_ID}`/
`${CLAUDE_EFFORT}` are accepted as aliases of the `PI_*` substitution variables, and `CLAUDE_*`
environment variables are exported alongside `PI_*` to processes spawned during skill
execution. Deliberate limits of the subset: the `hooks` frontmatter field is parsed but never
executed (hook behavior belongs to per-framework extensions, ADR-0001); `allowed-tools` is
parsed but advisory — Pi has no tool-approval flow, so there is nothing to pre-approve against
and only *blocking* semantics (`disallowed-tools`, `tool_call` block) are real; `Skill(name)`
permission rules are unsupported. The support matrix ships in the docs so the boundary is an
honest statement, not a silent gap.

## Consequences

Do not "fix" `allowed-tools` to enforce anything without first introducing a permission layer —
its advisory status is deliberate, not an omission. Adding a permission layer is a separate
project, explicitly out of scope here.

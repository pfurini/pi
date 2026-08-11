---
id: ADR-0008
status: accepted
---

# Skill-bundled agents: qualified-always, bare-when-free, soft scoping

Skills may ship agent definitions in `<skill>/agents/*.md` as a first-class Pi feature
(implemented in the pi-subagents fork; CC itself only has this via skills-dir plugins).
Registration rule: every bundled agent is always registered under its qualified name
(`skillname:agentname`); its bare name is registered only when that name is globally free. On a
bare-name collision, the render pipeline (ADR-0004) rewrites exact matches of the skill's own
agent names inside SKILL.md to the qualified form, so the skill's prose always resolves to its
own agents. Scoping is soft: bundled agents are hidden from global agent listings/menus but
remain spawnable by qualified name from anywhere.

## Considered options

- **Installer-materialized agent files** (framework setup copies definitions into global
  discovery dirs). Rejected: cannot provide skill-scoped visibility or collision precedence.
- **Rewriting agent names in all files under the skill dir.** Rejected: `references/` files are
  read raw by the model, outside the render pipeline; intercepting read results is fragile. The
  bare-when-free rule covers raw reads in the no-collision case (the overwhelmingly common
  one), and the qualified name is always the escape hatch. Read-interception stays out unless
  real usage proves the residual gap matters.
- **Hard scoping** (reject spawns unless the owning skill is active). Rejected: active-skill
  tracking is ambiguous under stacking, background agents, and compaction, and it would break
  the documented portable-skill fallback pattern (a skill degrading gracefully when the Agent
  tool is unavailable, per the `simplify` reference skill).

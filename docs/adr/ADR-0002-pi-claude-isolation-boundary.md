---
id: ADR-0002
status: accepted
---

# Pi never reads Claude Code's directories or settings

Pi discovers skills, commands, and agents exclusively from Pi-owned locations (`~/.pi/agent/*`,
`~/.agents/*`, `.pi/*`, `.agents/*`); it never scans or reads `~/.claude/`, `.claude/`, or any
CC settings,
even opt-in. Interop is outbound-only: Pi may *export* `CLAUDE_*` environment variables and
accept `${CLAUDE_*}` substitution tokens inside skill content it loads from its own locations
(ADR-0007), but no CC-owned state ever flows in. This is a deliberate context-pollution
boundary; frameworks whose files hardcode `~/.claude/...` paths are handled by their fork's Pi
installation target, not by Pi reading CC's tree.

## Considered options

An explicit allowlist ("load exactly these named skills from `~/.claude/skills/` in place, with
precedence and a single aggregated conflict warning") was designed and rejected: it reopens the
CC-coupling the boundary exists to prevent, and the fork-based porting path (ADR-0001) removes
its motivation.

---
id: ADR-0001
status: accepted
---

# Native skill parity in Pi core, not a Claude Code compatibility layer

Pi's skill system is upgraded to feature parity with Claude Code as a native capability; we do
not build a compatibility layer that runs CC frameworks (ASE, gstack) as-is. Frameworks are
ported by forking them and adding a Pi installation target (skills installed to Pi dirs + agent
definitions + one small per-framework Pi extension that implements the framework's hook logic,
each framework maintaining its own Pi layer). Rationale: CC ships weekly, so an emulation layer
chasing it is permanent maintenance drag whose failure mode is skills that silently half-fire
mid-session; "almost works" is worse than an honest "not supported". Pi extensions already fill
the role of CC plugins, so a framework's Pi target needs no plugin system.

## Considered options

- **Generic CC-hooks-host extension** (read `hooks.json`, emulate CC's stdin/exit-code wire
  protocol, map events onto Pi extension events). Technically feasible — the event mapping is
  nearly total (SessionStart→`session_start`, SessionEnd→`session_shutdown`,
  UserPromptSubmit→`input`, PreToolUse→`tool_call`, PostToolUse→`tool_result`,
  Stop→`agent_end`) — but rejected: a per-framework extension (~80-100 lines) is more powerful
  (in-process, can transform, no subprocess per event) and avoids emulating a moving wire
  protocol.
- **Plugins-lite** (honor `plugin.json` `mcpServers`/`agents`/`hooks`). Rejected: plugin support
  is explicitly a non-goal; framework forks ship the equivalent natively.
- **Shared hook-bridge helper library across framework forks.** Rejected: each framework
  maintains its own Pi compat layer and setup scripts.

## Consequences

Third-party *standalone* CC skills (one folder, no plugin/hooks) remain drop-in usable through
the interop subset (ADR-0007). Anything beyond that subset is documented as unsupported rather
than approximated.

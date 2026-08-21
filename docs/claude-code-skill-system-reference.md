# Claude Code Skill System — External Reference

Binary-derived reference for **Claude Code's** skill system, kept because
re-deriving it means re-extracting a CC binary. Everything about Pi has been
removed: for Pi behavior read [`skills.md`](./skills.md), the side-by-side
comparison in [`skills-capability-matrix.md`](./skills-capability-matrix.md),
or the source.

> **Snapshot, not current truth.** Extracted from binary `2.1.220`
> (`~/.local/share/claude/versions/2.1.220`) on **2026-08-02**, and **not
> re-verified since**. CC ships frequently; re-check against a current binary
> before relying on any detail for a decision.

**Sources:** the binary above (frontmatter zod schema, render pipeline, hook
event schemas, skills-dir plugin mechanics); `code.claude.com/docs/en/` —
skills, commands, hooks, sub-agents, agent-sdk/slash-commands;
`agentskills.io/specification`; and the ASE framework (`~/Developer/ai/ase`,
47 skills) as the real-world benchmark.

**Evidence quality:** several behaviors here are **binary-only** — pipeline
ordering, `` !` `` permission-gating via the skill's own `allowed-tools`,
`user_config` masking, and hook wire details are documented nowhere. The rest
is documented, but scattered across at least six CC doc pages.

**Not examined:** the CC plugin system (manifest, `userConfig`, marketplaces),
the general hook system (31 events, 5 hook types) beyond the skill-embedded
seams below, statusline, bundled skills, subagent definition management, and
enterprise tiers.

---

## 1. Locations & discovery

- Tiers: enterprise (managed) > personal `~/.claude/skills/` > project `.claude/skills/` > bundled; higher tiers **override** on name match. Plugin skills are namespaced `plugin:skill`.
- Nested `.claude/skills/` below cwd discovered **dynamically at runtime** when the model touches files in that subtree; on name clash the nested skill gets a directory-qualified name (`apps/web:deploy`) and both stay available; invoking the unqualified name appends a note listing the qualified variants.
- Parent dirs up to repo root; `--add-dir` dirs also load `.claude/skills/`; symlinks followed and deduped.
- **Live file watching** picks up edits in-session; SessionStart hooks can request `reloadSkills`; a manual `/reload-skills` command exists.
- **Skills-directory plugins**: a folder under `~/.claude/skills/` containing `.claude-plugin/plugin.json` auto-loads as plugin `<name>@skills-dir` and can bundle `agents/`, hooks, MCP servers, and more. Binary-verified: `plugin init` scaffolds at `~/.claude/skills/<name>/` ("auto-loads next session as `<name>@skills-dir`").

## 2. Frontmatter (full zod schema extracted from binary)

Booleans accept `yes/no/on/off/1/0/true/false`.

## 3. Render pipeline (exact order, from binary `getPromptForCommand`)

1. Prepend `Base directory for this skill: <dir>` (skill mode only).
2. **Argument substitution** (`Tct`): `$ARGUMENTS`, `$ARGUMENTS[N]`, `$N`, `$name` (named args, longest-name-first), backslash escaping, `ARGUMENTS: <value>` append fallback when no placeholder consumed.
3. **Plugin path substitution**: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_DATA}`.
4. **Plugin user-config substitution**: `${user_config.KEY}` (sensitive values masked out of skill content).
5. `${CLAUDE_SKILL_DIR}` (skill mode only).
6. `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`.
7. **Shell injection**: `` !`cmd` `` and fenced ` ```! ` blocks executed **through the permission system** — the skill's own `allowed-tools` are injected as command allow-rules for this check; `disableSkillShellExecution` policy replaces each with `[shell command execution disabled by policy]`; output inlined once, never re-scanned; `shell` field picks bash/powershell.

**Notably absent: any `@file` inlining** — see the `@path` convention below.

## 4. Invocation

- **Dedicated `Skill` tool** (`{skill: string — "Do not guess names", args?: string}`). Permissions can target `Skill(name)` / `Skill(name *)`; denying the tool disables model skill use; invocations pass through `PreToolUse`/`PermissionRequest` hooks (frameworks like ASE auto-approve their own).
- **User:** `/skill-name args`; up to 6 skills stacked in one message; expansion stops at forked skills. Command name from directory (or `plugin:name`, or dir-qualified `nested:name`); frontmatter `name` is display-only (except plugin skills).

## 5. Execution modes

- **Inline** (default): rendered content enters the conversation as a message and persists for the session.
- **`context: fork`**: skill content becomes the prompt of a spawned subagent; `agent` selects the agent type (built-ins Explore/Plan/general-purpose — Explore/Plan skip CLAUDE.md — or a custom definition); `background` (default true) runs it as a background agent reporting back as a task notification, with a narrowed built-in toolset and outside `/rewind` checkpoints; auto-blocks in `-p`/SDK mode, scheduled tasks, and repeat invocations of the same skill. `agent: X` requires agent definitions to exist — CC resolves them from `.claude/agents/`, `~/.claude/agents/`, plugins, `--agents` JSON, managed settings.
- **Per-turn overrides:** `model`, `effort` apply for the invoking turn, then revert.

## 6. Lifecycle & budgets

- Content persists for the session; identical re-invocation → short "already loaded" note; changed content (new args / new injection output) → appended again.
- **Auto-compaction carry-forward:** most recent invocation per skill re-attached after summarization, 5,000 tokens each, 25,000 combined, most-recent-first.
- **Listing budget:** names+descriptions capped at 1% of the context window (`skillListingBudgetFraction`) or fixed `SLASH_COMMAND_TOOL_CHAR_BUDGET`; least-invoked skills' descriptions truncated first; per-skill cap `skillListingMaxDescChars` (1,536); `/doctor` estimates cost; `/context` shows post-budget size.
- **Management:** `/skills` menu (type to filter, `t` sorts by token count, Space cycles state, Enter persists); `skillOverrides` setting: `on | name-only | user-invocable-only | off`; hidden skills error when invoked by name; `off` also hides from Remote Control/SDK lists.

## 7. Skill-adjacent seams

### 7.1 `UserPromptExpansion` hook

CC's hook point **inside the skill/slash-command expansion pipeline**, and the most skill-relevant hook event.

- **When:** a user-typed slash command (including `/skill-name`, each stacked skill, and MCP prompts) expands into a prompt, before it reaches the model.
- **Input JSON:** `expansion_type` (`slash_command`|`mcp_prompt`), `command_name`, `command_args`, `command_source`, `prompt` (the fully expanded text). Matcher field: `command_name`.
- **What it can do:** inject `additionalContext` alongside the expanded prompt (plain stdout also reaches Claude), or **block the expansion** (exit 2 / `decision:"block"` + reason; binary shows stacked skills individually blockable: `Stacked skill /x blocked by UserPromptExpansion hook`). It **cannot rewrite** the expanded prompt — CC gives transformation power only to `PreToolUse` (`updatedInput`).

### 7.2 The `hooks` frontmatter field

Skills can carry settings.json-shaped hook config scoped to the skill's lifecycle (binary: hooks are registered when the skill loads, support `once`, and are removed after firing: `Registered N hooks from skill 'X'` / `Removing one-shot hook for event … in skill 'X'`).

### 7.3 The `@path` include convention

CC's render pipeline does **not** inline `@file` references in skill bodies. What actually happens: `${CLAUDE_SKILL_DIR}` substitution makes the paths absolute, the model interprets `@/abs/path.md` as a file reference and issues **Read** calls, and frameworks ship hooks that auto-approve those reads (ASE: "skill include files … auto-approved instead of prompting the user on every skill invocation"). `@file` *is* inlined at expansion time only for custom commands and CLAUDE.md. ASE additionally ships its **own** recursive inliner (`expandReferences`, used at session start for its constitution).

### 7.4 Skills-directory plugins

A folder under `~/.claude/skills/` containing `.claude-plugin/plugin.json`
auto-loads as plugin `<name>@skills-dir` and can bundle `agents/`, hooks, MCP
servers, and more. Binary-verified: `plugin init` scaffolds at
`~/.claude/skills/<name>/` ("auto-loads next session as `<name>@skills-dir`").
A *plain* skill folder does not auto-load an `agents/` subdirectory — but
"skill folder that also ships agent definitions" is the pattern real frameworks
use (ASE: `plugin/agents/*.md`, referenced as fork targets like
`ase:ase-meta-diagram`).

---

## 8. Appendix — ASE dependency census

What a production CC skill framework actually consumes, from
`~/Developer/ai/ase` (47 skills; skill-text and execution rows only).

| ASE usage | CC feature it depends on | Count |
| --- | --- | --- |
| `@${CLAUDE_SKILL_DIR}/../../meta/*.md` includes | `${CLAUDE_SKILL_DIR}` + `@` read convention (+ hook auto-approval) | 47/47 |
| `$ARGUMENTS` through model-side getopt | argument substitution | 47/47 |
| `effort:` frontmatter | per-skill effort override | 46/47 |
| `allowed-tools:` (108 Bash patterns) | turn-scoped grants | 24/47 |
| `argument-hint`, `user-invocable`, `disable-model-invocation` | invocation control + autocomplete | many |
| `<skill name args result/>` dispatch | `Skill` tool with args | 19 |
| `agents/*.md`, `ase:agent-name` fork targets | skill-bundled agent definitions | 8 |
| `CLAUDE_PLUGIN_ROOT` in hook scripts | execution-time env contract | all hooks |

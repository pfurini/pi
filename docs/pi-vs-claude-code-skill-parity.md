# Skill Support: Pi vs Claude Code — Gap Analysis and Feature-Parity Roadmap

**Version 5** (2026-08-02). Scope: **the skill system only**, framed to drive a multi-phase implementation plan. v5 changes the skill-bundled agents plan: the fragile materialize-into-discovery-dirs approach is dropped in favor of **forking pi-subagents and folding native support into it as a follow-up feature** — with v1 of the extension shipping the seams the fork will consume (§7.2, roadmap items 10–11, OQ-4). v4 added §7 (**implementation vehicle: extension-first feasibility**). Out of scope per direction: CC's plugin system, the general hook system, statusline, bundled skills, marketplaces (§3.8).
> **Status (2026-08-13, Phase C1 shipped):** this report is a pre-C1 snapshot. Since it was written, Pi shipped the C1 skill system: the full frontmatter contract is parsed and preserved (roadmap Phase 0), every invocation path renders through the A.3 pipeline (argument grammar, `${PI_*}`/`${CLAUDE_*}` variables, `@path` absolutization, tool-policy-gated `` !` `` shell injection), a dedicated `skill` tool gives reliable model invocation, and delivery uses the A.4 message-block/synthetic-pair transports with structured entry metadata. The "no dedicated `Skill` tool" and "the model must `read` the file" gap claims below are therefore retired, and the §2 `_expandSkillCommand`/`input`-hook description is historical. What remains open matches the later phases: turn-scoped `disallowed-tools`/`allowed-tools` enforcement, per-skill `model`/`effort` request overrides, `context: fork`/`agent`/`background`, `paths` activation, and hooks. Current behavior is documented in `packages/coding-agent/docs/skills.md`.
**Sources:**

- Pi: this repository (`packages/coding-agent/src/core/skills.ts`, `agent-session.ts`, `resource-loader.ts`, `settings-manager.ts`, `core/extensions/types.ts`, `packages/agent/src/harness/{skills,system-prompt,types}.ts`, `docs/skills.md`, CHANGELOG), plus the installed `@tintinweb/pi-subagents` extension source
- Claude Code: installed binary `~/.local/share/claude/versions/2.1.220` (v2.1.220 = latest on npm as of 2026-08-02; skill frontmatter schema, render pipeline, hook event schemas, skills-dir plugin mechanics extracted and verified)
- Docs: `code.claude.com/docs/en/` — skills, commands, hooks, sub-agents, agent-sdk/slash-commands; `agentskills.io/specification`
- ASE case study (`~/Developer/ai/ase`): production CC skill framework (47 skills) used as the compatibility benchmark

---

## 1. Executive summary

Both harnesses implement the Agent Skills standard (SKILL.md + YAML frontmatter + progressive disclosure) and expose skills as slash commands. The similarity ends there.

Claude Code treats a skill as a **first-class executable capability**: a dedicated `Skill` tool with structured arguments, per-turn tool grants, model/effort overrides, forked-subagent execution, dynamic shell injection, a 7-stage content-substitution pipeline, and full lifecycle management (live reload, listing budgets, compaction carry-forward, visibility states).

Pi treats a skill as **prompt expansion**: the model is told to `read` the SKILL.md file itself; `/skill:name` expands inline into the outgoing message. Pi's frontmatter parser reads exactly **three fields** (`name`, `description`, `disable-model-invocation`). `allowed-tools` is documented in `docs/skills.md` as experimental but is **not implemented anywhere in the code**. *(Pre-C1; see the status note at the top — the `skill` tool, full frontmatter parsing, and the render pipeline shipped in C1.)*

The ASE case study quantifies the consequence: dropped into `~/.pi/agent/skills/` as-is, **all 47 ASE skills are inert in Pi** — every one depends on `${CLAUDE_SKILL_DIR}` substitution, `$ARGUMENTS`, and CC's include-file convention.

**The good news:** Pi's extension API is rich enough that most of the parity roadmap — including a model-invocable `skill` tool, forked execution via pi-subagents' spawn RPC, substitution, inclusion, and lifecycle management — can be delivered **as an extension with zero core changes** (§7). A short list of small, optional core seams would make the result cleaner rather than possible.

---

## 2. What Pi had pre-C1 (verified in source; historical — see the status note at the top)

### Discovery & locations

- Global: `~/.pi/agent/skills/`, `~/.agents/skills/`; project: `.pi/skills/`, `.agents/skills/` (cwd + ancestors to git root, gated on project trust); packages (`skills/` dir or `pi.skills` in package.json); settings `skills` array; `--skill <path>` CLI flag (repeatable, works even with `--no-skills`); extensions can inject skills via `resources_discover`.
- Recursive `SKILL.md` discovery; direct root `.md` files in `~/.pi/agent/skills/` and `.pi/skills/` only; honors `.gitignore`/`.ignore`/`.fdignore`; symlink dedupe by canonical path.
- Name collision: first found wins + diagnostic. Precedence: project before user-global; CLI paths win.
- Reload: `/reload` re-scans skills along with extensions, prompts, themes, and context files (no file watching; no skills-only reload).

### Frontmatter actually parsed (`SkillFrontmatter` in `core/skills.ts`)

| Field | Behavior |
| --- | --- |
| `name` | Optional (falls back to parent dir name). Validated per spec, warnings only. Deliberately **not** required to match the directory. |
| `description` | Required in practice: missing/empty → skill not loaded. >1024 chars → warning only. |
| `disable-model-invocation` | Strict `=== true` → excluded from system prompt; still invocable via `/skill:name`. |
| everything else | Ignored (`[key: string]: unknown`). |

### Invocation

- **Model:** system prompt gets an XML `<available_skills>` block (name/description/location per agentskills.io). The model must `read` the file. No dedicated tool, no permission integration, no budgets — every description ships in full every session.
- **User:** `/skill:name args` (`enableSkillCommands`, default true). Expansion (`agent-session.ts:_expandSkillCommand`): read file → strip frontmatter → wrap in `<skill name=… location=…>` XML with a "references are relative to <dir>" hint → **append args raw at the end**. No `$ARGUMENTS`/positional/named substitution, no `${SKILL_DIR}` variable, no `@`-reference handling, no shell injection, no stacking. Works in steer/follow-up queues; exposed over RPC; collapsible invocation message in the TUI.
- Pi *does* have a `$ARGUMENTS`/`$1`/`${ARGUMENTS:-default}` engine, but it is wired only to **prompt templates** (`core/prompt-templates.ts`), not skills.

### Adjacent machinery relevant to this plan (verified extension API surface)

- `core/extensions/types.ts` gives extensions: **`input` (fires before `_expandSkillCommand`; `transform` can rewrite the text)**, **`before_agent_start` (per user prompt; chainable `systemPrompt` result)**, `session_start`, `session_shutdown`, `agent_end`, **`tool_call` (`block` + `reason`)**, **`session_before_compact` (cancellable/customizable) and `session_compact`**, **`ctx.reload()`**, **`registerTool()`**, `registerCommand()` (+ `getArgumentCompletions`), `ctx.setThinkingLevel()`, `resources_discover`, `ctx.ui` (status/footer/widgets).
- **No permission layer anywhere in core** — verified: "approve" in source refers only to trusting project-local files; there is no per-tool-call allow/ask/deny and no approval prompt flow.
- Subagents: `@tintinweb/pi-subagents` extension. Agent types are discovered **from files only** (`~/.pi/agent/agents/`, `.agents/agents/`, `.pi/agents/`; frontmatter: `model`, `thinking`, `disallowed_tools`, `skills`, `run_in_background`, `isolated`, `max_turns`, tool selectors). It exposes **cross-extension RPC on the event bus: `subagents:rpc:spawn` (type, prompt, options)**, `stop`, `ping` — so other extensions can run subagents without forking it.

---

## 3. Claude Code's skill system (docs + binary v2.1.220 verified)

### 3.1 Locations & discovery

- Tiers: enterprise (managed) > personal `~/.claude/skills/` > project `.claude/skills/` > bundled; higher tiers **override** on name match. (Plugin skills are namespaced `plugin:skill`; plugins are out of scope here, but the *namespace mechanics* matter for imported skills — see OQ-1.)
- Nested `.claude/skills/` below cwd discovered **dynamically at runtime** when the model touches files in that subtree; on name clash the nested skill gets a directory-qualified name (`apps/web:deploy`) and both stay available; invoking the unqualified name appends a note listing the qualified variants.
- Parent dirs up to repo root; `--add-dir` dirs also load `.claude/skills/`; symlinks followed and deduped.
- **Live file watching** picks up edits in-session; SessionStart hooks can request `reloadSkills`; a manual `/reload-skills` command exists (granular equivalent of pi's `/reload`, which already covers skills — confirmed: pi's reload description is "Reload keybindings, extensions, skills, prompts, themes, and context files").
- **Skills-directory plugins** (relevant to skill-bundled agents, §7.2): a folder under `~/.claude/skills/` containing `.claude-plugin/plugin.json` auto-loads as plugin `<name>@skills-dir` and can bundle `agents/`, hooks, MCP servers, and more. Binary-verified: `plugin init` scaffolds at `~/.claude/skills/<name>/` ("auto-loads next session as `<name>@skills-dir`").

### 3.2 Frontmatter (full zod schema extracted from binary)

Base: `name` (display label only — command name comes from the directory), `description` (optional; falls back to first paragraph; combined with `when_to_use` capped at 1,536 chars in listings), `model` (`haiku|sonnet|opus|fable|full ID|inherit`), `allowed-tools`, `disallowed-tools` (+ `disallowedTools` alias), `argument-hint`, `arguments` (@internal), `disable-model-invocation`, `user-invocable`, `effort` (`low|medium|high|max|integer`), `shell` (`bash|powershell`), `version` (@internal).
Skill extension: `when_to_use`, `paths` (glob-gated auto-activation), `hooks` (skill-scoped lifecycle hooks — see §3.7), `context` (`inline|fork`), `agent` (subagent type for fork), `background` (fork default true), plus @internal provenance and plugin-manifest fields (`agents`, `mcpServers`, … — how a plugin-root SKILL.md declares bundled components).
Booleans accept `yes/no/on/off/1/0/true/false`.

### 3.3 The skill render pipeline (exact order, from binary `getPromptForCommand`)

1. Prepend `Base directory for this skill: <dir>` (skill mode only).
2. **Argument substitution** (`Tct`): `$ARGUMENTS`, `$ARGUMENTS[N]`, `$N`, `$name` (named args, longest-name-first), backslash escaping, `ARGUMENTS: <value>` append fallback when no placeholder consumed.
3. **Plugin path substitution**: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_DATA}`.
4. **Plugin user-config substitution**: `${user_config.KEY}` (sensitive values masked out of skill content).
5. `${CLAUDE_SKILL_DIR}` (skill mode only).
6. `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`.
7. **Shell injection**: `` !`cmd` `` and fenced ` ```! ` blocks executed **through the permission system** — the skill's own `allowed-tools` are injected as command allow-rules for this check; `disableSkillShellExecution` policy replaces each with `[shell command execution disabled by policy]`; output inlined once, never re-scanned; `shell` field picks bash/powershell.

**Notably absent: any `@file` inlining** — see §3.7.3.

### 3.4 Invocation

- **Dedicated `Skill` tool** (`{skill: string — "Do not guess names", args?: string}`). Permissions can target `Skill(name)` / `Skill(name *)`; denying the tool disables model skill use; invocations pass through `PreToolUse`/`PermissionRequest` hooks (frameworks like ASE auto-approve their own).
- **User:** `/skill-name args`; up to 6 skills stacked in one message; expansion stops at forked skills. Command name from directory (or `plugin:name`, or dir-qualified `nested:name`); frontmatter `name` is display-only (except plugin skills).

### 3.5 Execution modes (subagent machinery as it relates to skills)

- **Inline** (default): rendered content enters the conversation as a message and persists for the session.
- **`context: fork`**: skill content becomes the prompt of a spawned subagent; `agent` selects the agent type (built-ins Explore/Plan/general-purpose — Explore/Plan skip CLAUDE.md — or a custom definition); `background` (default true) runs it as a background agent reporting back as a task notification, with a narrowed built-in toolset and outside `/rewind` checkpoints; auto-blocks in `-p`/SDK mode, scheduled tasks, and repeat invocations of the same skill. `agent: X` requires agent definitions to exist — CC resolves them from `.claude/agents/`, `~/.claude/agents/`, plugins, `--agents` JSON, managed settings (what matters for parity: fork targets are *named, configurable agent types*, and skill-adjacent folders can supply them — §7.2).
- **Per-turn overrides:** `model`, `effort` apply for the invoking turn, then revert.

### 3.6 Lifecycle & budgets

- Content persists for the session; identical re-invocation → short "already loaded" note; changed content (new args / new injection output) → appended again.
- **Auto-compaction carry-forward:** most recent invocation per skill re-attached after summarization, 5,000 tokens each, 25,000 combined, most-recent-first.
- **Listing budget:** names+descriptions capped at 1% of the context window (`skillListingBudgetFraction`) or fixed `SLASH_COMMAND_TOOL_CHAR_BUDGET`; least-invoked skills' descriptions truncated first; per-skill cap `skillListingMaxDescChars` (1,536); `/doctor` estimates cost; `/context` shows post-budget size.
- **Management:** `/skills` menu (type to filter, `t` sorts by token count, Space cycles state, Enter persists); `skillOverrides` setting: `on | name-only | user-invocable-only | off`; hidden skills error when invoked by name; `off` also hides from Remote Control/SDK lists.

### 3.7 Skill-adjacent seams (the only non-skill subsystems discussed here)

#### 3.7.1 `UserPromptExpansion` hook — elaborated

CC's hook point **inside the skill/slash-command expansion pipeline**, and the most skill-relevant hook event.

- **When:** a user-typed slash command (including `/skill-name`, each stacked skill, and MCP prompts) expands into a prompt, before it reaches the model.
- **Input JSON:** `expansion_type` (`slash_command`|`mcp_prompt`), `command_name`, `command_args`, `command_source`, `prompt` (the fully expanded text). Matcher field: `command_name`.
- **What it can do:** inject `additionalContext` alongside the expanded prompt (plain stdout also reaches Claude), or **block the expansion** (exit 2 / `decision:"block"` + reason; binary shows stacked skills individually blockable: `Stacked skill /x blocked by UserPromptExpansion hook`). It **cannot rewrite** the expanded prompt — CC gives transformation power only to `PreToolUse` (`updatedInput`).
- **Relevance to Pi:** pi's `input` event is the analog and is *stronger* in one way (it can `transform` the text) but fires **before** pi's `_expandSkillCommand`, so an extension that wants CC-style tokens translated must own the whole expansion itself. A dedicated post-expansion `skill_expansion` extension event (transform/block/augment) would be the clean seam for a CC-compat substrate — see OQ-1/OQ-3.

#### 3.7.2 The `hooks` frontmatter field

Skills can carry settings.json-shaped hook config scoped to the skill's lifecycle (binary: hooks are registered when the skill loads, support `once`, and are removed after firing: `Registered N hooks from skill 'X'` / `Removing one-shot hook for event … in skill 'X'`). Pi has nothing like it; whether the compat substrate should honor or ignore this field in imported skills is part of OQ-1.

#### 3.7.3 The `@path` include convention (corrected understanding)

CC's render pipeline does **not** inline `@file` references in skill bodies. What actually happens: `${CLAUDE_SKILL_DIR}` substitution makes the paths absolute, the model interprets `@/abs/path.md` as a file reference and issues **Read** calls, and frameworks ship hooks that auto-approve those reads (ASE: "skill include files … auto-approved instead of prompting the user on every skill invocation"). `@file` *is* inlined at expansion time only for custom commands and CLAUDE.md. ASE additionally ships its **own** recursive inliner (`expandReferences`, used at session start for its constitution) — evidence that install/load-time inlining is a viable substitute that needs no harness support.

### 3.8 Out of scope for this document (per direction)

The CC **plugin system** (components, manifest, `userConfig`, marketplaces, `plugin:*` namespacing as a distribution mechanism) — pi's extension/package marketplace occupies this role. The **general hook system** (31 events, 5 hook types) — only the skill-embedded seams above are kept, as compat-substrate questions. **Statusline**, **bundled skills**, **subagent definition management**, and **enterprise tiers** — excluded. Where plugin-originated tokens (`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${user_config.KEY}`, `plugin:skill` names) appear **inside imported skill text or bundled scripts**, they are not dropped — they feed OQ-1.

---

## 4. Side-by-side matrix (skills only)

| Capability | Claude Code | Pi |
| --- | --- | --- |
| SKILL.md + frontmatter + progressive disclosure | Yes | Yes |
| Model invocation | Dedicated `Skill` tool (structured, permissioned, hookable) | Prompt instruction to `read` the file |
| User invocation | `/name` (name = dir) | `/skill:name` (name = frontmatter) |
| Argument substitution | `$ARGUMENTS`, `$N`, named args, append fallback | Raw append (engine exists, wired to prompt templates only) |
| Variable substitution in skill text | `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}` (+ plugin vars) | None |
| Shell injection (`` !`cmd` ``) | Yes, permission-gated, policy kill-switch, `shell` field | No |
| `@file` include convention | Model-interpreted read + hook auto-approval; install-time inlining viable | No convention |
| Forked subagent execution | `context: fork`, `agent`, `background` | No |
| Skill-bundled agent definitions | Yes, via skills-dir plugins (`<skill-folder>/agents/`) | No |
| Per-skill model/effort | Yes (turn-scoped) | No |
| `allowed-tools` | Turn-scoped grants; also gates `` !` `` injection | Documented, **not implemented** (and see OQ-2: no approval flow to grant against) |
| `disallowed-tools` | Turn-scoped removal from tool pool | No |
| `user-invocable` | Yes | No (only `disable-model-invocation`) |
| `when_to_use` / `argument-hint` / `paths` / `hooks` / `shell` | Yes | No |
| Listing budget | 1% of window, per-skill 1,536 cap, least-invoked-first truncation | None |
| Compaction carry-forward | Re-attach MRU invocation per skill (5k/25k budgets) | None |
| Re-invocation dedup | "Already loaded" note | Full content re-appended |
| Live reload | Watchers + `/reload-skills` | `/reload` covers skills (no watching) |
| Nested/monorepo names | Runtime discovery + `dir:name` qualification | Ancestor discovery; first-wins collisions |
| Visibility management | `/skills` menu + 4-state `skillOverrides` | Enable/disable via `pi config` |
| Skill stacking (one message) | Up to 6 | No |
| Expansion-time extension seam | `UserPromptExpansion` hook (augment/block) | `input` transform (pre-expansion) |
| `--skill` CLI flag | No | Yes (pi-only) |
| `.agents/skills` cross-harness dirs | No | Yes (pi-only) |
| Ignore-file support in scanning | No | Yes (pi-only) |

---

## 5. Gaps (skills only, ordered by impact)

1. **No `Skill` tool** — model invocation is unreliable ("models don't always do this", per pi's own docs) and offers no seam for args, grants, hooks, fork, or skill-to-skill dispatch (ASE: 19 skills use `<skill name args result/>`).
2. **No argument substitution** in skills (ASE: 47/47 fatal).
3. **No variable substitution** (`${CLAUDE_SKILL_DIR}` etc.; ASE: 47/47 fatal).
4. **No `@`-include convention / load-time inlining** (ASE: 47/47 fatal — includes carry the control language).
5. **No `allowed-tools`/`disallowed-tools` implementation** (documented but dead; ASE: 24/47 declare 108 Bash patterns).
6. **No per-skill `effort`/`model`** (ASE: 46/47 set `effort: xhigh`).
7. **No `context: fork` / `agent` / `background`** subagent execution.
8. **No skill-bundled agent definitions** (`<skill>/agents/`; ASE ships 8 agents alongside its 47 skills).
9. **No `user-invocable`, `argument-hint`, `when_to_use`, `paths`, `shell`, `hooks` fields.**
10. **No shell injection** (`` !`cmd` ``) with policy control.
11. **No listing budget / compaction carry-forward / re-invocation dedup** (context-lifecycle hygiene).
12. **No `/skills` management UX** with 4-state visibility.
13. **No nested/monorepo runtime discovery** with dir-qualified names.
14. **No skill stacking.**
15. **No live watching** (manual `/reload` covers skills but requires user action).
16. **Interop warts**: strict boolean parsing; CC tool names (`Glob`, `Read`, `EnterPlanMode`) in imported skill prose need translation.

---

## 6. Roadmap (phased implementation plan)

Implementation vehicle note: per §7, Phases 1–2 are deliverable almost entirely as an extension; Phase 0 is *cleaner* as a small core change but can also be extension-side; Phase 3 is split (details in §7.3).

**Phase 0 — contract surface (low risk, quick):**

1. Parse (and retain, don't ignore) the full CC frontmatter contract in `core/skills.ts`: `when_to_use`, `argument-hint`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `background`, `paths`, `shell`, `hooks`, `arguments`. Lenient booleans. Unknown fields kept accessible to extensions. This makes imported skills *well-formed* in pi even before semantics land, and unblocks everything below.
2. `argument-hint` in `/skill:` autocomplete; `when_to_use` folded into the listing entry; `user-invocable: false` hides from the menu.
3. Lenient boolean parsing (yes/no/on/off/1/0).

**Phase 1 — invocation core (unblocks ASE-class frameworks):**
4. Argument & variable substitution in `_expandSkillCommand`/`formatSkillInvocation`: reuse the prompt-template engine (`$ARGUMENTS`, `$N`, defaults), named args via `arguments:`, and `${PI_SKILL_DIR}` + accepted aliases `${CLAUDE_SKILL_DIR}`, `${PI_SESSION_ID}`, `${PI_PROJECT_DIR}`.
5. Dedicated **`skill` tool** (`{name, args}`) — reliable model invocation + the seam for everything below. Deliverable as an extension-registered tool (§7.1).
6. Include convention: implement load/expansion-time inlining of `@<path>` lines (recursive, relative to skill dir, cycle-safe — ASE's `expandReferences` is the reference implementation), *or* adopt the model-read convention; decide in OQ-1.
7. Skill stacking (expand multiple `/skill:` prefixes, trailing text as args for each).

**Phase 2 — execution semantics:**
8. `disallowed-tools` (turn-scoped tool-pool restriction — implementable today; see OQ-2) and `allowed-tools` semantics per OQ-2's outcome.
9. Per-skill `effort`/`model` overrides for the invoking turn (`ctx.setThinkingLevel` exists).
10. `context: fork`/`agent`/`background` mapped onto pi's subagent machinery via `subagents:rpc:spawn` — **v1**, including the three seams that prepare the pi-subagents fork (§7.2): pass-through `agent:` name resolution with graceful fallback, RPC feature detection, and skill-set change events on the bus.
11. **Skill-bundled agents (follow-up, not v1)**: fork pi-subagents and fold in native `<skill>/agents/*.md` discovery with `skill:agent` namespacing (§7.2, OQ-4). v1 ships only the seams in item 10.
12. Shell injection (`` !`cmd` ``, ` ```! ` blocks) at expansion time, single-pass, gated by a `disableSkillShellExecution`-style setting; `shell` field.
13. `paths` glob-gated activation.

**Phase 3 — lifecycle & management:**
14. Listing budget (`skillListingBudgetFraction` ~1%, per-skill cap, least-invoked-first truncation) + cost visibility.
15. Compaction carry-forward (re-attach MRU invocation per skill, bounded budget) — investigate the `session_before_compact` customization surface first (§7.3).
16. Re-invocation dedup ("already loaded" note).
17. `/skills` menu + `skillOverrides`-style setting (on / name-only / user-invocable-only / off).
18. Live watching of skill dirs (`fs.watch` + `ctx.reload()` — extension-deliverable, §7.1).
19. Nested/monorepo dir-qualified names (`apps/web:deploy`).

**Phase 4 — ecosystem polish:**
20. Skill-scoped hooks (per OQ-1 decision), `shell` powershell support, eval/iteration tooling, CC tool-name translation guide for imported skills.

---

## 7. Implementation vehicle: extension-first feasibility

**Question:** can skill parity with Claude Code be achieved *without touching pi core*, writing only an extension?
**Answer:** mostly yes — roughly 85–90% of the roadmap, using a "shadow skill system" pattern. The remainder is a short list of small, *optional* core seams that make the result cleaner, not possible. The extension API surface below is verified in `core/extensions/types.ts` and the installed `@tintinweb/pi-subagents` source.

### 7.1 What the extension layer can deliver or prepare today (verified)

| Roadmap item | Extension mechanism |
| --- | --- |
| `$ARGUMENTS` / `${CLAUDE_SKILL_DIR}` / CC-token substitution, `` !`cmd` `` injection, include inlining, stacking | `input` event `transform` — fires **before** `_expandSkillCommand`, so the extension owns expansion end-to-end (precedent: `rpiv-args` does exactly this) |
| **The `skill` tool** (model-invocable, `{name, args}`) | `registerTool()` — the extension registers it like any tool; zero core change |
| `argument-hint`, `user-invocable` semantics | `registerCommand()` + `getArgumentCompletions`; with `enableSkillCommands: false` the extension owns the whole `/skill:` menu |
| `when_to_use`, listing budgets, `paths`-gating | `before_agent_start` fires per prompt with a chainable `systemPrompt` result — the extension can emit its own curated skill block every turn (tracking recently touched files from `tool_call` events) |
| `disallowed-tools` (turn-scoped) | Track active-skill state (set on invocation, cleared on next `input`); block matching calls via `tool_call` (`block` + `reason`) |
| `effort` per skill | `ctx.setThinkingLevel()` on invocation |
| **`context: fork` execution** | `subagents:rpc:spawn(type, prompt, options)` on the event bus — pi-subagents runs it; no fork needed |
| Live watching | `fs.watch` on skill dirs + programmatic `ctx.reload()` |
| Compaction carry-forward | `session_before_compact` is *cancellable/customizable*; `session_compact` fires after — strong candidate seam (customization surface needs API investigation) |
| Re-invocation dedup | Trivial inside extension-owned expansion/tool (hash last-rendered content) |
| `/skills` menu + visibility states | `registerCommand()` + `ctx.ui` widgets; persist states to settings |
| Full frontmatter contract (Phase 0) | Extension re-parses skill files from disk (it gets `filePath`); core's 3-field loader is not a blocker |
| Skill-bundled agents (follow-up) | v1 plants seams only: pass-through `agent:` name resolution, RPC feature detection, skill-set change events (§7.2); native support lands later in a pi-subagents fork |

### 7.2 Skill-bundled agents (`<skill>/agents/`) — deferred to a pi-subagents fork

**What CC does:** agents co-located with skills exist via the skills-directory plugin mechanism — a folder under `~/.claude/skills/` containing `.claude-plugin/plugin.json` auto-loads as plugin `<name>@skills-dir` and can bundle `agents/` (binary-verified: `plugin init` scaffolds exactly this). A *plain* skill folder does not auto-load an `agents/` subdir — but the real-world pattern "skill folder that also ships agent definitions" is what imported frameworks use (ASE: `plugin/agents/*.md` with `effort`, referenced as fork targets `ase:ase-meta-diagram`).

**Rejected approach:** materializing translated agent files into pi-subagents' discovery dirs from the compat extension. It works on paper but is fragile machinery: it mutates user-owned directories, inherits pi-subagents' filename-derived naming (no `skill:agent` namespacing), and creates cleanup, trust, and reload-sequencing races the extension would have to police forever.

**Decision:** fork `@tintinweb/pi-subagents` and fold native skill-bundled agent support directly into it — the fork discovers `<skill>/agents/*.md` itself, registers them under namespaced identifiers (`skill:agent`, no filename constraint), and owns lifecycle and trust internally. This is a **follow-up feature, not v1**.

**v1 seams (must ship in the v1 extension so the follow-up fork needs no v1 rework):**

1. **Pass-through `agent:` name resolution, isolated in one function.** CC `agent:` values — including qualified `plugin:agent` forms — flow verbatim from frontmatter to the spawn call. Pre-fork behavior: exact/built-in type names resolve; unknown types warn and fall back to `general-purpose`. When the fork lands registering native `skill:agent` types, the same resolution path starts working with zero v1 changes.
2. **RPC feature detection.** v1 pings `subagents:rpc:ping` and gates on `PROTOCOL_VERSION`/capabilities: today's contract is spawn-by-named-type; the fork will advertise an extended contract (skill-scoped names and/or inline definitions) that v1 adopts automatically when present.
3. **Skill-set change events on the bus.** v1 already owns skill-dir scanning and (per roadmap item 18) watching; it emits `skills-compat:skills-changed` (added/removed/updated, with paths) so the fork subscribes instead of re-implementing discovery and watching.

Design questions for the fork → **OQ-4**.

### 7.3 Optional core changes, and the benefit each one buys

None of these are required for the extension-first plan; each buys cleanliness or a capability the extension cannot reach. Ordered by value-for-effort.

| # | Core change | Effort | Benefit it buys | Extension-only fallback (if rejected) |
|---|---|---|---|---|
| C1 | Parse and preserve the full CC frontmatter contract in `core/skills.ts` (all CC fields + lenient booleans; unknown fields kept accessible to extensions) | one file, small | One parsed contract for the whole ecosystem; extensions stop re-parsing files and can't drift apart; future core features (listing, budgets) read rich fields directly | Extension re-parses skill files from disk (works; duplicated logic across extensions) |
| C2 | Expose a skill-listing seam (a `skillsOverride`-style hook — one exists internally in `ResourceLoader` options but is not exposed to extensions) | small | Extension *replaces* the core `<available_skills>` block: `when_to_use` in the listing, real listing-budget enforcement, `paths`-gating, no duplicate blocks, and no abusing `disable-model-invocation` to hide managed skills from the core listing | Shadow-listing: append a curated block via `before_agent_start` and hide managed skills from the core listing (awkward; changes that flag's semantics) |
| C3 | Turn-scoped `model` override API for extensions | small (needs API investigation) | Per-skill `model:` honored for the invoking turn, then reverted — full CC parity on per-skill model selection | Only `effort` honored (`setThinkingLevel`); `model:` stays advisory/ignored |
| C4 | Compaction re-attach seam (only if `session_before_compact` customization proves insufficient) | medium | Invoked skills survive compaction like CC (MRU invocation per skill, 5k/25k budgets) — skill behavior persists in long sessions | Skills silently lose influence after compaction; user must re-invoke (status quo) |
| C5 | Post-expansion `skill_expansion` extension event (transform/block/augment; OQ-3) | small–medium | Clean CC-parity seam (`UserPromptExpansion` analog): policy/audit/blocking of skill invocations without owning expansion; uniform coverage of `/skill:`, model-invoked, stacked, and fork paths | `input`-transform + extension-owned expansion (works for `/skill:`; uneven elsewhere) |
| C6 | Permission layer (allow/ask/deny + tool gates) | large — separate project | `Skill(name)` rules, `allowed-tools` enforcement, PreToolUse-style auto-approval, permission-gated `` !` `` injection like CC | `allowed-tools` stays advisory (OQ-2); `disallowed-tools` still ships extension-side |

**Verdict:** Phases 1–2 are ~fully extension-deliverable (substitution, includes, stacking, `skill` tool, `disallowed-tools`, `effort`, fork via RPC, shell injection). Phase 3 is ~60% extension-deliverable (menu, settings, watching, dedup yes; listing budget and compaction carry-forward need the shadow-listing pattern or core seams C2/C4). Phase 0 can be extension-side, but C1 is cheap and benefits every other extension, not just this one. Recommended core scope: **C1 + C2 now** (small, high leverage); C3 after API investigation; C4 only if the compaction seam proves insufficient; C5 optional; C6 deferred as its own project.

---

## 8. Open questions

### OQ-1 — The CC-compat substrate: what can an extension translate, and what needs core?

Imported CC skills embed harness-specific tokens and conventions **in skill text and in bundled scripts/commands**:

- **Substitution tokens in skill text:** `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${user_config.KEY}`, `$ARGUMENTS` family, `` !`cmd` `` / ` ```! ` blocks.
- **Conventions:** `@path` include lines; `plugin:skill` and `plugin:agent` qualified names; CC tool names in prose.
- **Embedded config:** the `hooks` frontmatter field (skill-scoped hook config); `allowed-tools` patterns.
- **Execution-time env contract for skill-bundled scripts:** which env vars do CC skill scripts read? (`CLAUDE_SKILL_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PROJECT_DIR`, `CLAUDE_SESSION_ID`, `CLAUDE_EFFORT` are candidates — e.g. ASE's hook scripts resolve `CLAUDE_PLUGIN_ROOT`; needs a census of what CC exports to subprocesses spawned from skill content.)

**Investigation:** which of these can a compat extension handle purely through the `input`-transform seam + a wrapper for script execution (e.g. aliasing env vars `PI_*`→`CLAUDE_*`, rewriting tokens in text), and which genuinely need core support — after §7, the only candidate left is the post-expansion `skill_expansion` event (C5), since the `skill` tool and fork execution are extension-deliverable (§7.1). Deliverable: a capability matrix per token/convention with owner (extension vs core) and a translation table. Note the `input` seam fires *before* pi's expansion, so an extension doing this today must own expansion end-to-end (rpiv-args proves this works for `$ARGUMENTS`/`${SKILL_DIR}`/`` !`cmd` `` on the `/skill:` path, but not for model-invoked skills).

### OQ-2 — Permissions contract: what's worth implementing now, and how?

CC's permission semantics around skills: `allowed-tools` = turn-scoped **grant of pre-approval** (clears on next user message; also pre-approves `` !` `` injection; project skills gated on workspace trust); `disallowed-tools` = turn-scoped **removal from the tool pool**; `Skill(name)`/`Skill(name *)` permission rules and PreToolUse auto-approval = integration with CC's allow/ask/deny layer.
**The asymmetry that shapes the pi decision:** pi has **no tool-approval flow at all** (verified — "approve" in pi source refers only to project-file trust). Therefore:

- `allowed-tools` (granting pre-approval) currently has **no referent** — there is nothing to pre-approve against. Implementing it is a no-op until pi grows a permission layer. Options: (a) parse-and-preserve only (Phase 0), documented as advisory; (b) defer to a future permission-layer project; (c) treat it as a *restriction-in-reverse* (only listed tools auto-run if pi ever adds prompts).
- `disallowed-tools` (removing tools while the skill is active) **is implementable today** as a pure restriction — including extension-side via `tool_call` blocking (§7.1) — and has immediate value for autonomous skills. Candidate for Phase 2.
- `Skill(name)` rules / PreToolUse auto-approval: **out of scope** without a permission layer; note as future work.
**Investigation:** confirm the above against real usage (are imported skills' `allowed-tools` lists mostly Bash patterns whose value is documentation, as ASE's 108 patterns suggest?), and decide the minimal viable semantics for pi.

### OQ-3 — Do we want a post-expansion skill event in pi's extension API?

CC's `UserPromptExpansion` (§3.7.1) augments/blocks at expansion time but cannot rewrite; pi's `input` event rewrites but fires pre-expansion. A dedicated `skill_expansion` event (after expansion; can transform, block, or attach context) would give the compat substrate a clean, single-responsibility seam and give extension authors CC-parity hook behavior for skills. **Investigation:** is `input`-transform + owning expansion sufficient in practice (rpiv-args says yes for `/skill:`), or does the missing post-expansion seam block real use cases (model-invoked skills via the future `skill` tool, stacking, fork)?

### OQ-4 — Skill-bundled agents: pi-subagents fork design

Design questions for the follow-up fork (§7.2): (a) **discovery scope** — skills load from many locations (global/project dirs, settings paths, packages, `--skill`); which of these may contribute `<skill>/agents/`, and is project trust re-evaluated before registering agents from a project skill? (b) **identifier scheme** — native `skill:agent` names free of filename constraints; collision rules with user-defined and built-in agent types; whether an unqualified `agent:` value in a CC skill resolves to that skill's own bundled types first. (c) **lifecycle** — register/unregister as skills load, reload, and unload; interaction with `disable-model-invocation` (a hidden skill's bundled agents: still spawnable? CC preloads skills into subagents independently of that flag's menu semantics). (d) **RPC contract** — extend spawn to accept skill-scoped names and/or inline definitions; `PROTOCOL_VERSION` bump with capability advertisement so v1's feature detection (seam 2) adopts it automatically. (e) **frontmatter translation** — CC agent fields (`effort`, `allowed-tools`, `hooks`, `mcpServers`, `permissionMode`, `memory`) mapped onto the fork's existing field set: which are supported, adapted, or deliberately dropped. (f) **fork governance** — re-sync strategy with upstream pi-subagents.

---

## 9. Corrections & status notes

- **`@file` in skills:** the first version of this report implied CC inlines `@path` at render time. It does not (§3.7.3) — the gap for pi is real but shaped as *convention + auto-approval*, or solvable by load-time inlining.
- **Upstream status (2026-08-02):** pi upstream has 151 commits since the local merge-base, zero touching skills machinery (verified by path + message scan). Claude Code `2.1.220` remains the latest release — the analyzed binary is current.
- **Docs caveat:** several behaviors described here are binary-only (pipeline ordering, `` !` `` permission-gating via the skill's own `allowed-tools`, `user_config` masking, hook wire details); the rest is documented but scattered across at least six doc pages.
- **C1 shipped (2026-08-13):** the "no dedicated `Skill` tool" and model-read-delivery gaps are retired (the `skill` tool plus the A.4 message-block/synthetic-pair delivery landed), and the `_expandSkillCommand` expansion described in §2 no longer exists. "Pi (pre-C1)" columns and §2/§7.1 statements to that effect are historical; the pre-C1 `input`-hook-fires-before-expansion observation is likewise superseded by the C1 consumption seam. Open items are the C2+ semantics listed in the status note at the top.

## 10. Appendix A — frontmatter field support

| Field | Spec | Claude Code | Pi (pre-C1) | Pi (Phase 0 target) |
| --- | --- | --- | --- | --- |
| `name` | required, == dir | optional display label; command = dir | optional; command name; needn't match dir | unchanged (deliberate) |
| `description` | required ≤1024 | optional (first-paragraph fallback); ≤1536 w/ `when_to_use` | required; ≤1024 warn | unchanged (deliberate) |
| `license` / `compatibility` / `metadata` | optional | parsed | ignored | parsed & preserved |
| `allowed-tools` | optional (exp.) | turn-scoped grants | ignored | parsed; semantics per OQ-2 |
| `disallowed-tools` | — | turn-scoped removal | ignored | parsed; Phase 2 semantics |
| `disable-model-invocation` | — | yes | yes | yes |
| `user-invocable` | — | yes | ignored | Phase 0 |
| `when_to_use` | — | yes | ignored | Phase 0 |
| `argument-hint` / `arguments` | — | yes | ignored | Phase 0/1 |
| `model` / `effort` | — | turn-scoped | ignored | Phase 2 |
| `context` / `agent` / `background` | — | fork execution | ignored | Phase 2 |
| `paths` | — | glob-gated activation | ignored | Phase 2 |
| `hooks` | — | skill-scoped hooks | ignored | per OQ-1 |
| `shell` | — | bash/powershell for injection | ignored | Phase 2 |
| Booleans | — | true/false/yes/no/on/off/1/0 | strict `true` | lenient (Phase 0) |

## 11. Appendix B — ASE skill-dependency inventory (skills-scoped)

What a real CC skill framework consumes, from `~/Developer/ai/ase` (47 skills; only skill-text/execution rows kept):

| ASE usage | CC feature | Count | Pi status |
| --- | --- | --- | --- |
| `@${CLAUDE_SKILL_DIR}/../../meta/*.md` includes | `${CLAUDE_SKILL_DIR}` + `@` read convention (+ hook auto-approval) | 47/47 | missing (OQ-1) |
| `$ARGUMENTS` through model-side getopt | argument substitution | 47/47 | missing (Phase 1) |
| `effort:` frontmatter | per-skill effort override | 46/47 | missing (Phase 2) |
| `allowed-tools:` (108 Bash patterns) | turn-scoped grants | 24/47 | parsed only; semantics per OQ-2 |
| `argument-hint`, `user-invocable`, `disable-model-invocation` | invocation control + autocomplete | many | partial (Phase 0) |
| `<skill name args result/>` dispatch | `Skill` tool with args | 19 | missing (Phase 1; extension-registered tool per §7.1) |
| `agents/*.md`, `ase:agent-name` fork targets | skill-bundled agent definitions | 8 | follow-up: pi-subagents fork (§7.2, OQ-4); v1 ships seams only |
| `CLAUDE_PLUGIN_ROOT` in hook scripts | execution-time env contract | all hooks | OQ-1 census |

> pi can create skills. Ask it to build one for your use case.

# Skills

Skills are self-contained capability packages that the agent loads on-demand. A skill provides specialized workflows, setup instructions, helper scripts, and reference documentation for specific tasks.

Pi implements the [Agent Skills standard](https://agentskills.io/specification) frontmatter contract, warning about most violations but remaining lenient. Pi allows skill names to differ from their parent directory even though the standard disallows it; that rule is suboptimal for shared skill directories used across multiple agent harnesses. Pi never reads Claude Code's own directories or settings (`~/.claude/`, `.claude/`); see [Locations](#locations).

## Table of Contents

- [Locations](#locations)
- [How Skills Work](#how-skills-work)
- [Skill Commands](#skill-commands)
- [The `skill` Tool](#the-skill-tool)
- [Rendering Pipeline](#rendering-pipeline)
- [Argument Grammar](#argument-grammar)
- [Skill Variables](#skill-variables)
- [Shell Command Injection](#shell-command-injection)
- [Delivery Transports](#delivery-transports)
- [Tool Name Redirects](#tool-name-redirects)
- [Claude Code Interop](#claude-code-interop)
- [Skill Structure](#skill-structure)
- [Frontmatter](#frontmatter)
- [Validation](#validation)
- [Listing and Visibility](#listing-and-visibility)
- [Extension Access to the Skill Set](#extension-access-to-the-skill-set)
- [Example](#example)
- [Skill Repositories](#skill-repositories)

## Locations

> **Security:** Skills can instruct the model to perform any action and may include executable code the model invokes. Review skill content before use.

Pi loads skills from Pi-owned locations only:

- Global:
  - `~/.pi/agent/skills/`
  - `~/.agents/skills/`
- Project (only after the project is trusted):
  - `.pi/skills/`
  - `.agents/skills/` in `cwd` and ancestor directories (up to git repo root, or filesystem root when not in a repo)
- Packages: `skills/` directories or `pi.skills` entries in `package.json`
- Settings: `skills` array with files or directories
- CLI: `--skill <path>` (repeatable, additive even with `--no-skills`)

Discovery rules:

- In `~/.pi/agent/skills/` and `.pi/skills/`, direct root `.md` files are discovered as individual skills
- In all skill locations, directories containing `SKILL.md` are discovered recursively
- In `~/.agents/skills/` and project `.agents/skills/`, root `.md` files are ignored

Disable discovery with `--no-skills` (explicit `--skill` paths still load).

Pi never scans or reads `~/.claude/`, `.claude/`, or any Claude Code settings, even opt-in (`skills` entries or `--skill` paths that resolve inside a `.claude` directory are rejected with a diagnostic and load nothing). Frameworks that ship Claude Code-style skills port to Pi through a fork whose Pi installation target copies skill content into a Pi-owned location above; Pi does not read a foreign framework's tree in place.

Every skill load path (`--skill`, the `skills` settings array, SDK sources, project directories) goes through the same project trust decision as `.pi/skills`: an untrusted project's skills are not loaded, so their shell injection blocks can never execute. Note that trusting a project is a durable decision — a later `git pull` that adds `` !` `` blocks to an already-loaded project skill executes them without a fresh prompt.

## How Skills Work

1. At startup, pi scans skill locations and extracts names, descriptions, and the rest of the [frontmatter contract](#frontmatter)
2. The system prompt includes a versioned listing of available skills; see [Listing and Visibility](#listing-and-visibility)
3. When a task matches, the model invokes the skill through the `skill` tool (or reads the SKILL.md with `read` on minimal tool sets); the user can force invocation with `/skill:name`
4. The skill body is rendered once (see [Rendering Pipeline](#rendering-pipeline)) and delivered to the model (see [Delivery Transports](#delivery-transports))
5. The agent follows the instructions, using relative paths to reference scripts and assets

This is progressive disclosure: only descriptions are always in context, full instructions load on-demand.

## Skill Commands

Skills join the unified command namespace when their name is command-eligible (see [Validation](#validation)) and `user-invocable` is not `false`. A skill is invocable bare as `/name` (also mid-prompt) and always via its `/skill:name` qualifier; on a bare-name collision with a higher-precedence tier (built-ins > extension commands > commands/templates > skills) only the qualifier form stays reachable:

```bash
/brave-search                # Bare invocation (enableSkillCommands on)
please /brave-search this    # Mid-prompt invocation (no arguments)
/skill:brave-search          # Qualifier — always resolves to the skill
/skill:pdf-tools extract     # Load skill with arguments
```

Argument ownership: a message that *starts* with the invocation hands it the whole remainder as the raw argument string `R`, passed verbatim through the [Argument Grammar](#argument-grammar); mid-prompt invocations take no arguments. A skill invocation typed while the agent is streaming can be queued with steer or follow-up; the invocation is then rendered and activated exactly when the queued message is consumed, never at queue time. `argument-hint` (if set) shows in autocomplete.

Toggle skill commands via `/settings` in interactive mode or in `settings.json`:

```json
{
  "enableSkillCommands": true
}
```

## The `skill` Tool

Pi registers a dedicated `skill` tool whenever at least one model-visible skill exists. A genuine model tool call takes `{name, args?}`, renders the skill once through the same pipeline as `/skill:name`, and returns the rendered content as its real tool result on any provider. Unknown or model-hidden (`disable-model-invocation: true`) names are a tool error that names the valid alternatives; the tool description tells the model not to guess names.

## Rendering Pipeline

Every invocation path (direct prompt, queued steer/follow-up, genuine `skill` tool call) renders through one pipeline with a deterministic, single-pass stage order (later stages never re-scan text produced by earlier stages for earlier-stage syntax):

1. **Base-dir preamble** — `Base directory for this skill: <dir>` is prepended.
2. **Argument substitution** — the [Argument Grammar](#argument-grammar) over `R`.
3. **Variable substitution** — `${PI_*}` plus `${CLAUDE_*}` aliases when interop is enabled; see [Skill Variables](#skill-variables).
4. **`@path` absolutization** — skill-relative `@path` references become absolute against the skill baseDir. Skills never inline file contents: the model reads referenced files itself.
5. **Agent-name rewrite** — reserved for harness-qualified agent names; a no-op in this repository.
6. **Shell injection** — `` !`command` `` blocks execute per [Shell Command Injection](#shell-command-injection).
7. **Tool-name steering note** — when the rendered body references Claude Code tool names, a note mapping them to the Pi equivalents is appended.

## Argument Grammar

The raw argument string `R` substitutes into the body in a single pass:

| Placeholder | Substitutes |
| ----------- | ----------- |
| `$ARGUMENTS`, `$@` | `R` verbatim (quotes, spacing, everything) |
| `$1`, `$2`, ... | Positional token N (1-based); out of range renders empty |
| `$name` | A bound declared value (see `arguments` frontmatter); undeclared names stay literal |
| `${@:N}`, `${@:N:L}` | Slice of the post-binding positional sequence, space-joined; N is 1-based and 0 means 1 |
| `${X:-default}` | The default when the value (`ARGUMENTS`, `@`, N, or name) is empty/absent |
| `\$...` | A literal `$...` (backslash removed) |

Tokenization splits on whitespace; double or single quotes group a token (quotes stripped); a backslash escapes the next character. Declared `name=value` tokens bind to `arguments` frontmatter names and are removed from the positional sequence (the rest compact); undeclared `x=y` tokens stay positional. If `R` is non-empty and no placeholder consumed it, `\n\nARGUMENTS: R` is appended so the input is never silently dropped.

## Skill Variables

Stage 3 substitutes these braced variables; the same values are injected into shell-injection executions:

| Pi variable | Claude Code alias | Value |
| ----------- | ----------------- | ----- |
| `${PI_SKILL_DIR}` | `${CLAUDE_SKILL_DIR}` | The skill's base directory |
| `${PI_PROJECT_DIR}` | `${CLAUDE_PROJECT_DIR}` | Nearest ancestor with a `.git` entry (covers worktrees), else `cwd` |
| `${PI_SESSION_ID}` | `${CLAUDE_SESSION_ID}` | Current session id |
| `${PI_EFFORT}` | `${CLAUDE_EFFORT}` | The invocation's `effort` frontmatter, else the session thinking level |

The `CLAUDE_*` aliases are accepted alongside the `PI_*` spellings only while the `skillInterop` setting is on (default); with `skillInterop: false` they stay literal. An integer `effort` budget clamp-maps to a level with a diagnostic (≤2048 → `low`, ≤8192 → `medium`, ≤24576 → `high`, above → `xhigh`). `${PI_EFFORT}`/`${CLAUDE_EFFORT}` then reflect the *effective* effort, clamped to the invocation's effective (possibly `model`-overridden) model's supported thinking levels, so the value equals the reasoning level the provider request actually runs with. Unknown `${...}` text is left untouched.

While a skill invocation is active (from consumption until the logical turn settles), its variables are also injected into `bash` tool executions — including extension/SDK replacement bash tools — as a turn-scoped environment overlay. `process.env` is never mutated. Set `disableSkillEnvInjection: true` to bypass this overlay (A.3.5 shell injection is unaffected: it always carries the rendering skill's own variables). See [environment-variables.md](environment-variables.md).

## Shell Command Injection

> **Security (authoring):** `` !`command` `` blocks execute real shell commands at render time with the skill's own `PI_*`/`CLAUDE_*` variables in the environment. A skill author can run anything the user can. Only load skills you trust, and treat project trust as the boundary: trusting a project authorizes its skills' shell blocks, including after a later `git pull`.

A body segment `` !`command` `` executes `command` and is replaced by its output. Execution is gated by tool policy — injection runs only when the session's active tool set includes `bash` and the invocation's `disallowed-tools` does not block it (`Bash` and `bash` both match). This render-time gate is separate from the turn-scoped enforcement of `disallowed-tools` on the model's own tool calls (see [Frontmatter](#frontmatter)). When blocked, the segment is replaced inline by `[shell command execution disabled by tool policy]`; when the `disableSkillShellExecution` kill switch is on, by `[shell command execution disabled by policy]`; a timed-out or aborted command inlines `[command aborted]`.

Per-command limits come from settings: `skillShellTimeoutMs` (default 30000) and `skillShellOutputLimitBytes` (default 16384). The `shell` frontmatter field selects `bash` (default) or `powershell`.

## Delivery Transports

A rendered invocation is delivered to the model on one of two transports, selected before the request is sent:

- **Message block** (default, universal fallback): one user message whose entire text is `<skill name="…" args="…">` + the verbatim body + `</skill>`, attribute values XML-escaped. There is no `location` attribute; identity travels as structured entry metadata, so parsing never depends on the text form.
- **Synthetic pair** (only for models whose provider converter path passed replay verification and carry the `syntheticToolResultReplay` capability flag): an assistant message with exactly one `skill` tool call, followed by its correlated tool result. Both persist as ordinary session messages sharing a `pairId`. Providers that own their side of the session (the `claude-bridge` provider) never receive a synthetic pair.

Transport selection happens once, before delivery; there is no runtime downgrade or retry if a provider rejects a synthetic pair. Set `forceSkillMessageBlock: true` to force the message block for new invocations. The switch is forward-only: it does not rewrite synthetic pairs already persisted in earlier sessions, and a pre-transports binary renders new-format blocks as raw text.

Every delivered invocation persists structured metadata on its session entries (invocation id, skill id, name, args, and block offsets or `pairId`), which is what the TUI, session resume, and HTML export read.

## Tool Name Redirects

Claude Code-trained models sometimes call tool names Pi does not register (`Task`, `Glob`, `AskUserQuestion`, ...). An unknown tool call returns an immediate error whose text is corrective prose; the mapped tool is never executed and no aliases exist:

- If the attempted name matches the redirect map and its target is currently registered and active, the error reads `Tool <attempted> is not available — use <target> instead`.
- Otherwise, when a registered name is within case-insensitive edit distance 2, the error suggests it: `Tool <attempted> not found — did you mean <name>?` (ties break deterministically by distance, then name ascending).
- Otherwise the plain `Tool <attempted> not found` error stands.

The default map: `AskUserQuestion` → `ask_user_question`, `Task` → `Agent`, `Glob` → `find`, `Skill` → `skill`, `SlashCommand` → `slash_command`, plus capitalized identities (`Read` → `read`, `Grep` → `grep`, `Edit` → `edit`, `Write` → `write`, `Bash` → `bash`, `Ls` → `ls`). A target that is not registered stays dormant (extension-owned targets activate when their extension registers the tool). Matching is exact first, then case-insensitive over map keys.

Extend or override entries with the `toolRedirects` setting (merged per-key over the defaults); disable the whole mechanism (no mapped target, no nearest-name suggestion) with `disableToolRedirects: true`. See [settings.md](settings.md#resources).

The same map canonicalizes `disallowed-tools` entries for the shell-injection gate, so `disallowed-tools: [Bash]` blocks the `bash` capability consistently.

## Claude Code Interop

Pi supports a deliberate subset of Claude Code skill semantics (ADR-0007). The boundary:

**Supported:**

- The Agent Skills frontmatter contract (lenient validation; see [Frontmatter](#frontmatter))
- The argument grammar, `${CLAUDE_*}` variable aliases, and `` !` `` shell injection (gated by tool policy)
- Per-invocation `model`/`effort` overrides (ephemeral, non-persistent per-turn; CC aliases `opus`/`sonnet`/`haiku`/`fable` resolve best-effort against available models) and turn-scoped `disallowed-tools` enforcement
- CC tool-name correction: the redirect map above plus the stage-7 steering note in rendered bodies
- Per-invocation `context: fork` execution: a sole message-initial skill (user-invoked or via the model `skill` tool) runs in a pi-subagents subagent instead of inline. `agent` selects the subagent type; `background` (default `true`) chooses background delivery (an acknowledgment plus a post-turn completion notice) vs foreground (awaits the subagent under a 15-minute cap). The fork body never enters the parent context. Falls back to inline delivery (with a diagnostic) when no subagents extension is present, on spawn failure, or in headless mode

**Not supported (no translation, by design):**

- Reading `~/.claude/`, `.claude/`, or any Claude Code settings
- `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${user_config.KEY}`, `plugin:skill` names
- Hook execution (`hooks` frontmatter is parsed and preserved, never executed)
- `allowed-tools` enforcement (parsed and preserved, advisory only)
- `Skill(name)` permission rules
- Per-invocation `paths` listing-boost activation (parsed and preserved; not yet implemented)

## Skill Structure

A skill is a directory with a `SKILL.md` file. Everything else is freeform.

```
my-skill/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/              # Helper scripts
│   └── process.sh
├── references/           # Detailed docs loaded on-demand
│   └── api-reference.md
└── assets/
    └── template.json
```

### SKILL.md Format

````markdown
---
name: my-skill
description: What this skill does and when to use it. Be specific.
---

# My Skill

## Setup

Run once before first use:
```bash
cd /path/to/skill && npm install
```

## Usage

```bash
./scripts/process.sh <input>
```
````

Use relative paths from the skill directory:

```markdown
See [the reference guide](references/REFERENCE.md) for details.
```

## Frontmatter

Booleans accept `true`/`false`, `yes`/`no`, `on`/`off`, and `1`/`0` (case-insensitive); an unrecognized value keeps the field's default and produces a diagnostic. Unknown frontmatter fields are preserved and accessible to extensions rather than dropped. Non-JSON-safe YAML (cycles, non-finite numbers, unsupported tags like binary blobs or custom sets) is diagnosed and substituted (dropped, or replaced with an empty mapping for cyclic objects) so the stored frontmatter always stays JSON-serializable.

| Field | Required | Description |
| ------- | ---------- | ------------- |
| `name` | Yes | Max 64 chars. Command name and listing display name. See [Name Rules](#name-rules). |
| `description` | Yes | Max 1024 chars (warning only past that). Missing or empty description means the skill is not loaded. |
| `when_to_use` | No | Appended to `description` in the listing entry, capped together at 1,536 UTF-16 code units. |
| `argument-hint` | No | Shown in `/skill:name` autocomplete. No semantic effect on expansion. |
| `arguments` | No | Declared named arguments; accepted as a string, list, or map. Consumed by the [Argument Grammar](#argument-grammar). |
| `disable-model-invocation` | No | When true, the skill is excluded from the listing and hidden from model-facing surfaces (including the `skill` tool); still user-invocable via `/skill:name`. |
| `user-invocable` | No | When false, hidden from `/skill:name` menus and command expansion; still model-invocable through the listing. |
| `license` | No | License name or reference to a bundled file. |
| `compatibility` | No | Max 500 chars. Environment requirements. |
| `metadata` | No | Arbitrary key-value mapping, preserved as-is. |
| `allowed-tools` | No | Tool names as a string or list. Parsed and preserved; **advisory only**, not enforced. |
| `disallowed-tools` (alias `disallowedTools`) | No | Tool names as a comma-separated string or a YAML list. Turn-scoped: while the invocation is active, matching tools are removed from the model's request schema and a matching tool call is blocked before lookup (case-insensitive after redirect canonicalization, so `Bash`, `bash`, and `Task` map to the registered `bash`/`Agent`); the same list also gates [shell command injection](#shell-command-injection). Stacked invocations union their lists; same-batch siblings of an invoking `skill` call are exempt (restriction starts with the next request). `Tool(pattern)` entries reduce to the bare name with a diagnostic; wildcards are unsupported (diagnostic, entry skipped). |
| `model` | No | A model id, `inherit`, or a CC alias (`opus`/`sonnet`/`haiku`/`fable`, best-effort against available models). Applied as an ephemeral, non-persistent per-turn override on the invocation's provider requests; `inherit`/empty keeps the session model; an unmatched value is a diagnostic + ignore. Session defaults are untouched. |
| `effort` | No | A `ThinkingLevel` string (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`) or an integer token budget. Applied as an ephemeral per-turn thinking-level override, clamped to the effective (possibly `model`-overridden) model's supported levels; integer budgets clamp-map with a diagnostic. Exposed as `${PI_EFFORT}` at the same clamped value. |
| `context` | No | `inline` (default) or `fork`. `fork` runs a sole message-initial skill (user-invoked or via the model `skill` tool) in a pi-subagents subagent instead of inline; its body never enters the parent context. Falls back to inline delivery (with a diagnostic) when no subagents extension is present, on spawn failure, or in headless mode. |
| `agent` | No | Subagent type name for `context: fork` (an unknown type still spawns, defaulting to `general-purpose` on the wire). Ignored for `inline`. |
| `background` | No | Fork-only; default `true`. `true` returns an acknowledgment and reports completion as a post-turn notice; `false` awaits the subagent under a 15-minute foreground cap. |
| `paths` | No | Glob list. Parsed and preserved; listing-boost activation is not yet implemented. |
| `shell` | No | `bash` (default) or `powershell`. Selects the interpreter for [shell command injection](#shell-command-injection). |
| `hooks` | No | Arbitrary nested hook configuration. **Parsed and preserved, never executed.** |

### Name Rules

- 1-64 characters
- Lowercase letters, numbers, hyphens only
- No leading/trailing hyphens
- No consecutive hyphens

Pi does not require the name to match the parent directory. The Agent Skills standard does, but that requirement is suboptimal for shared skill directories used by multiple tools.

Valid: `pdf-processing`, `data-analysis`, `code-review`
Invalid: `PDF-Processing`, `-pdf`, `pdf--processing`

A separate, looser check controls whether a name is eligible for the bare `/skill:name` command namespace: any name matching `[A-Za-z0-9][A-Za-z0-9._-]*`, not ending in `.`, and not starting with a reserved prefix (`skill:`, `prompt:`, `ext:`). A name can fail the (lowercase-only) Agent Skills rule above and still be command-eligible — it loads with an Agent Skills naming warning but still expands as `/skill:name`. A name that fails the command-eligibility check (for example one ending in `.`, or already starting with a reserved prefix) loads normally and appears in the model-facing listing, but is not registered as a `/skill:name` command.

### Description Best Practices

The description determines when the agent loads the skill. Be specific.

Good:

```yaml
description: Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents.
```

Poor:

```yaml
description: Helps with PDFs.
```

## Validation

Pi validates skills against the Agent Skills standard. Most issues produce warnings but still load the skill:

- Name exceeds 64 characters or contains invalid characters
- Name starts/ends with hyphen or has consecutive hyphens
- Description exceeds 1024 characters
- A boolean field has an unrecognized value (the field's default is used)
- A frontmatter value is not JSON-safe (cyclic, non-finite, or an unsupported YAML tag)

**Exception:** skills with a missing or empty description are not loaded.

Name collisions (same name from different locations) warn and keep the first skill found.

## Listing and Visibility

The system prompt includes a versioned listing of visible skills:

```xml
<available_skills version="2">
  <skill>
    <name>pdf-tools</name>
    <description>Extracts text from PDF files. Use when working with PDF documents.</description>
    <location>/home/user/.pi/agent/skills/pdf-tools/SKILL.md</location>
  </skill>
</available_skills>
```

`description` is the frontmatter `description`, plus a space and `when_to_use` when present, capped at 1,536 UTF-16 code units before XML-escaping. `location` (the `SKILL.md` path) is always present, including in future name-only entries, because it is the model-read access path for consumers that don't have a `skill` tool.

Effective visibility is the AND of two frontmatter flags and a persisted,
runtime-controlled state (A.6). The four persisted states, on each of the two
dimensions:

| state | model-facing (listing + `skill` tool) | user-facing (`/skill:name`) |
| --- | --- | --- |
| `on` (default) | listed with description | `/name` works |
| `name-only` | listed as name+location (no description) | `/name` works |
| `user-invocable-only` | not listed, `skill` tool rejects it | `/name` works |
| `off` | not listed, `skill` tool rejects it | `/name` **errors** (consumed, not literal) |

Settings can restrict further but never re-grant what frontmatter removed:
`disable-model-invocation` always hides from the model, and `user-invocable: false`
always hides from `/name` (see [Name Rules](#name-rules)). `off` is the only state
whose `/name` invocation becomes a consumed error rather than literal text, and it
does so for every valid name — bare, `skill:`-qualified, and collision-qualified —
even when frontmatter also sets `user-invocable: false`.

States persist under the `skillVisibility` settings key, keyed by canonical ID, at
both global and project scope (project precedence); a malformed value falls back to
`on` with one settings warning. Manage them at runtime with the **`/skills`** overlay,
which lists each loaded skill with its estimated listing cost, effective visibility, and
originating scope. Changes apply to the next request — listing, `skill` tool, and
`/name` — without a `/reload`, and are prospective-only (they never rewrite
already-delivered content or dedup/carry-forward records).

Each skill has a canonical ID: the symlink-resolved absolute path of its `SKILL.md`. This is the discovery dedupe key and the key used by the extension skill-set seam below.

`extractSkillListingBlock(systemPrompt)` (exported from the SDK) returns the first complete `<available_skills version="2">…</available_skills>` block from a system prompt string, byte-exact, for consumers that need to parse the listing back out.

## Extension Access to the Skill Set

There is no `getSkills()` extension API. Extensions read the effective skill set through the core event bus instead:

- `skills:changed` is emitted on load, `/reload`, and any future watch update, carrying the full snapshot: `{ revision, skills: [...], removed: [...] }`.
- `skills:query { requestId }` / `skills:query:reply:<requestId>` is a request/reply pair returning the same snapshot shape on demand, so a late-subscribing extension isn't stuck waiting for the next `skills:changed`.

Each entry carries `id`, `name`, `listingName`, `baseDir`, `source`, and the full parsed `frontmatter` (including preserved unknown fields). `source` is always the complete object `{path, source, scope, origin, baseDir?}` — never just the source string — with `baseDir` omitted (not `null`) when the skill has none. `revision` is a monotonic counter per event bus; consumers should ignore stale revisions.

This is the SDK/extension-facing wire contract; see [sdk.md](sdk.md#skills) for code examples, the canonical serialization rule, and the committed conformance fixture that companion repositories copy byte-for-byte.

## Example

```
brave-search/
├── SKILL.md
├── search.js
└── content.js
```

**SKILL.md:**

````markdown
---
name: brave-search
description: Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content.
when_to_use: Use when the user asks to search the web or fetch a page's content.
argument-hint: "[query]"
---

# Brave Search

## Setup

```bash
cd /path/to/brave-search && npm install
```

## Search

```bash
./search.js "query"              # Basic search
./search.js "query" --content    # Include page content
```

## Extract Page Content

```bash
./content.js https://example.com
```
````

## Skill Repositories

- [Anthropic Skills](https://github.com/anthropics/skills) - Document processing (docx, pdf, pptx, xlsx), web development
- [Pi Skills](https://github.com/badlogic/pi-skills) - Web search, browser automation, Google APIs, transcription

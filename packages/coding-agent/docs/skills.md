> pi can create skills. Ask it to build one for your use case.

# Skills

Skills are self-contained capability packages that the agent loads on-demand. A skill provides specialized workflows, setup instructions, helper scripts, and reference documentation for specific tasks.

Pi implements the [Agent Skills standard](https://agentskills.io/specification) frontmatter contract, warning about most violations but remaining lenient. Pi allows skill names to differ from their parent directory even though the standard disallows it; that rule is suboptimal for shared skill directories used across multiple agent harnesses. Pi never reads Claude Code's own directories or settings (`~/.claude/`, `.claude/`); see [Locations](#locations).

## Table of Contents

- [Locations](#locations)
- [How Skills Work](#how-skills-work)
- [Skill Commands](#skill-commands)
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

## How Skills Work

1. At startup, pi scans skill locations and extracts names, descriptions, and the rest of the [frontmatter contract](#frontmatter)
2. The system prompt includes a versioned listing of available skills; see [Listing and Visibility](#listing-and-visibility)
3. When a task matches, the agent uses `read` to load the full SKILL.md (models don't always do this; use prompting or `/skill:name` to force it)
4. The agent follows the instructions, using relative paths to reference scripts and assets

This is progressive disclosure: only descriptions are always in context, full instructions load on-demand.

## Skill Commands

Skills register as `/skill:name` commands when their name is command-eligible (see [Validation](#validation)) and `user-invocable` is not `false`:

```bash
/skill:brave-search           # Load and execute the skill
/skill:pdf-tools extract      # Load skill with arguments
```

Expansion wraps the skill body in a `<skill name="..." location="...">` block and appends any arguments as literal trailing text; there is no argument grammar or templating yet. `argument-hint` (if set) shows in autocomplete for `/skill:name`.

Toggle skill commands via `/settings` in interactive mode or in `settings.json`:

```json
{
  "enableSkillCommands": true
}
```

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
| `arguments` | No | Declared named arguments; accepted as a string, list, or map. Not yet consumed by an argument grammar. |
| `disable-model-invocation` | No | When true, the skill is excluded from the listing and hidden from model-facing surfaces; still user-invocable via `/skill:name`. |
| `user-invocable` | No | When false, hidden from `/skill:name` menus and command expansion; still model-invocable through the listing. |
| `license` | No | License name or reference to a bundled file. |
| `compatibility` | No | Max 500 chars. Environment requirements. |
| `metadata` | No | Arbitrary key-value mapping, preserved as-is. |
| `allowed-tools` | No | Tool names as a string or list. Parsed and preserved; **advisory only**, not enforced. |
| `disallowed-tools` (alias `disallowedTools`) | No | Tool names as a comma-separated string or a YAML list. Parsed and preserved; not yet enforced (turn-scoped blocking lands in a later phase). |
| `model` | No | A model id, or `inherit`. Parsed and preserved; not yet applied as a per-request override. |
| `effort` | No | A `ThinkingLevel` string (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`) or an integer token budget. Parsed and preserved; not yet applied as a per-request override. |
| `context` | No | `inline` (default) or `fork`. Parsed and preserved; fork execution is not yet implemented. |
| `agent` | No | Subagent type name for `context: fork`. Parsed and preserved; not yet consumed. |
| `background` | No | Fork-only; default `true`. Parsed and preserved; not yet consumed. |
| `paths` | No | Glob list. Parsed and preserved; listing-boost activation is not yet implemented. |
| `shell` | No | `bash` (default) or `powershell`. Parsed and preserved; shell-injection execution is not yet implemented. |
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

Visibility has two independent dimensions:

- **Model-facing** (the listing above): controlled by `disable-model-invocation`.
- **User-facing** (`/skill:name` menus and expansion): controlled by `user-invocable` and command-name eligibility (see [Name Rules](#name-rules)).

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

> pi can create prompt templates. Ask it to build one for your workflow.

# Prompt Templates

Prompt templates are Markdown snippets that expand into full prompts. Type `/name` in the editor to invoke a template, where `name` is the filename without `.md`.

## Locations

Pi loads prompt templates from:

- Global: `~/.pi/agent/prompts/*.md`
- Project: `.pi/prompts/*.md` (only after the project is trusted)
- Packages: `prompts/` directories or `pi.prompts` entries in `package.json`
- Settings: `prompts` array with files or directories
- CLI: `--prompt-template <path>` (repeatable)

Disable discovery with `--no-prompt-templates`.

## Format

```markdown
---
description: Review staged git changes
---
Review the staged changes (`git diff --cached`). Focus on:
- Bugs and logic errors
- Security issues
- Error handling gaps
```

- The filename becomes the command name. `review.md` becomes `/review`.
- `description` is optional. If missing, the first non-empty line is used.
- `argument-hint` is optional. When set, the hint is displayed before the description in the autocomplete dropdown.

### Argument Hints

Use `argument-hint` in frontmatter to show expected arguments in autocomplete. Use `<angle brackets>` for required arguments and `[square brackets]` for optional ones:

```markdown
---
description: Review PRs from URLs with structured issue and code analysis
argument-hint: "<PR-URL>"
---
```

This renders in the autocomplete dropdown as:

```
→ pr   <PR-URL>       — Review PRs from URLs with structured issue and code analysis
  is   <issue>        — Analyze GitHub issues (bugs or feature requests)
  wr   [instructions] — Finish the current task end-to-end
  cl   — Audit changelog entries before release
```

## Usage

Type `/` followed by the template name in the editor. Autocomplete shows available templates with descriptions.

```
/review                           # Expands review.md
/component Button                 # Expands with argument
/component Button "click handler" # Multiple arguments
```

## Arguments

Everything after `/name` is the raw argument string `R`, substituted into the body in a single pass with the Claude Code grammar (identical to skills):

- `$ARGUMENTS` — `R` verbatim (quotes and spacing preserved)
- `$ARGUMENTS[N]`, `$N` — positional token N, **0-based** (`$0` is the first); out of range leaves the whole placeholder literal
- `$name` — the positional token aliased by a declared `arguments` name, in declaration order; declared but unmatched renders empty, undeclared stays literal
- `\$...` — a literal `$...` when the backslash precedes a digit, `ARGUMENTS`, or a declared name (backslash removed)

`$@` and every braced form (`${@:N}`, `${@:N:L}`, `${N:-default}`, `${name:-default}`) are **not** placeholders and render literally, so shell snippets in a template survive untouched. If `R` is non-empty and no placeholder was substituted, `\n\nARGUMENTS: R` is appended so the input is never silently dropped.

Example:

```markdown
---
description: Create a component
---
Create a React component named $0 with features: $ARGUMENTS
```

Usage: `/component Button "onClick handler" "disabled support"`

## Loading Rules

- Template discovery in `prompts/` is non-recursive.
- If you want templates in subdirectories, add them explicitly via `prompts` settings or a package manifest.

## Migration to the Commands system

Prompt templates are now a source of the unified **Commands system**. Nothing in the layout above changes, but two behaviors are worth knowing.

### Commands directories

Alongside `prompts/`, Pi loads first-class commands from `~/.pi/agent/commands/` (user) and `.pi/commands/` (project, only after the project is trusted). Commands use the same Markdown + frontmatter format and the same argument grammar as templates, plus `@path` include inlining (the referenced file's text is spliced in at expansion time, with recursion/cycle/size guards). Existing prompt templates are **grandfathered** as command sources: a `/name` template still works exactly as before its filename dictates.

> **Security note:** `@path` includes may reference absolute or parent-relative paths by design. Project commands run under the project-trust boundary, so trusting a project authorizes its command files to read and inline any file the process can access (combined with `` !` `` shell injection this is exfiltration-capable). Only trust projects you would give shell access to.

### One namespace, qualifiers, and the `slash_command` tool

Commands, templates, skills, built-ins, and extension commands share one namespace. On a bare-name collision the higher tier wins and the loser stays reachable through its qualifier:

- Precedence: **built-ins > extension commands > commands/templates > skills**
- Qualifiers: `/prompt:name` (commands and templates), `/skill:name` (skills), `/ext:name` (extension commands)
- **Argument ownership:** a message that *starts* with a prompt-producing invocation hands it the whole remainder as arguments (`/review src/core`); invocations elsewhere in the message expand inline with no arguments
- The model can invoke model-visible commands through the `slash_command` tool, subject to `disable-model-invocation`

### Rendering now uses the A.3.2 argument engine

Template arguments previously ran through a legacy 1-based substitution (`$1`, `$@`, `${@:N}` slicing, `${…:-default}` defaults, and `name=value` binding). They now render through the shared **A.3.2** engine — the Claude Code grammar, the same one skills use (see [Arguments](#arguments)). This is a **breaking change**, not a superset:

- **0-based indices.** `$0` is the first argument, `$1` the second, and `$ARGUMENTS[N]` is now a real placeholder. A template using 1-based `$1`, `$2`, … shifts by one position.
- **Removed forms render literally.** `$@`, `${@:N}`, `${@:N:L}`, `${N:-default}`, and `${name:-default}` are no longer placeholders — they pass through verbatim, so shell snippets survive. A template relying on them stops expanding.
- **Named arguments are positional aliases.** A declared `arguments:` name maps to a positional slot in declaration order; the old `name=value` token binding is gone.
- **Backslash escaping is honored.** `\$0`, `\$ARGUMENTS`, and `\$name` render literally with the backslash removed. A template relying on a literal backslash immediately before a `$`-placeholder will now see it consumed.
- **No-placeholder append.** If arguments are supplied but no placeholder was substituted, the raw string is appended as `\n\nARGUMENTS: <raw>` (skill parity).

### Compatibility and rollback

There is **no persistent migration** and no on-disk change: your template files are untouched. Reverting this release restores the legacy rendering for the same files. Bare `/name` invocation, mid-prompt expansion, and the `slash_command` model tool are additive; the `enableSkillCommands` setting (unchanged) still governs whether skills join the bare namespace.

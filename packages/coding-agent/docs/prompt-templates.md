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

Templates support positional arguments, defaults, and simple slicing:

- `$1`, `$2`, ... positional args
- `$@` or `$ARGUMENTS` for all args joined
- `${1:-default}` uses arg 1 when present/non-empty, otherwise `default`
- `${@:-default}` or `${ARGUMENTS:-default}` uses all arguments when present/non-empty, otherwise `default`
- `${@:N}` for args from the Nth position (1-indexed)
- `${@:N:L}` for `L` args starting at N

Example:

```markdown
---
description: Create a component
---
Create a React component named $1 with features: $@
```

Default values are useful for optional arguments:

```markdown
Summarize the current state in ${1:-7} bullet points.
```

Usage: `/component Button "onClick handler" "disabled support"`

## Loading Rules

- Template discovery in `prompts/` is non-recursive.
- If you want templates in subdirectories, add them explicitly via `prompts` settings or a package manifest.

## Migration to the Commands system

Prompt templates are now a source of the unified **Commands system**. Nothing in the layout above changes, but two behaviors are worth knowing.

### Commands directories

Alongside `prompts/`, Pi loads first-class commands from `~/.pi/agent/commands/` (user) and `.pi/commands/` (project, only after the project is trusted). Commands use the same Markdown + frontmatter format and the same argument grammar as templates, plus `@path` include inlining (the referenced file's text is spliced in at expansion time, with recursion/cycle/size guards). Existing prompt templates are **grandfathered** as command sources: a `/name` template still works exactly as before its filename dictates.

### Rendering now uses the A.3.2 argument engine

Template arguments previously ran through a legacy substitution. They now render through the shared **A.3.2** engine (the same one skills use). The grammar is a superset of the old one, so `$1`, `$@`/`$ARGUMENTS`, `${@:N}`/`${@:N:L}` slicing, and `${…:-default}` behave as documented above. The differences to be aware of:

- **Backslash escaping is now honored.** In the raw argument string, `\` escapes the next character during tokenization (so `\"` is a literal quote inside a token, and an unterminated quote runs to end of input). On the template side, `\$1`, `\$@`, `\$ARGUMENTS`, and `\$name` render literally with the backslash removed. Templates that previously relied on a literal backslash immediately before a `$`-placeholder will now see it consumed.
- **`$ARGUMENTS`/`$@` substitute the raw string verbatim** (quotes and spacing preserved), matching the prior behavior.
- **No-placeholder append.** If arguments are supplied but the template contains no placeholder that consumes them, the raw argument string is appended as `\n\nARGUMENTS: <raw>` (skill parity). A template with no placeholders that was previously invoked with trailing text now gains this appended line.
- **Named arguments** (`arguments:` frontmatter) bind `name=value` tokens and remove them from the positional sequence.

### Compatibility and rollback

There is **no persistent migration** and no on-disk change: your template files are untouched. Reverting this release restores the legacy rendering for the same files. Bare `/name` invocation, mid-prompt expansion, and the `slash_command` model tool are additive; the `enableSkillCommands` setting (unchanged) still governs whether skills join the bare namespace.

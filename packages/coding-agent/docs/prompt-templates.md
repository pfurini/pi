# Prompt Templates

Prompt templates turn Markdown files into reusable `/` commands. Use one when you want to reuse the same prompt without adding executable behavior or a larger set of supporting instructions.

A template can accept arguments and appear in command completion. Pi can load templates from personal configuration, project configuration, an explicit path, or a Pi package. Project configuration loads only after project trust is granted.

## Create a template

Create `~/.pi/agent/prompts/review.md`:

```markdown
---
description: Review staged git changes
argument-hint: "[focus]"
---
Review the staged changes. Focus on ${1:-correctness, security, and error handling}.
```

The filename becomes the command name, so this template is available as `/review`. The `description` appears in command completion. If it is omitted, Pi uses the first non-empty line.

`argument-hint` is optional. Use `<angle brackets>` for required arguments and `[square brackets]` for optional arguments.

Run `/reload` after adding or changing a template in an active session.

<a id="invoke-a-template"></a>

## Use a template

Type the template command in the editor:

```text
/review
/review concurrency
```

Pi expands the template before the resulting text enters the agent. Extensions receive the raw input first through the `input` event unless an extension command with the same name handles it.

Templates use the same single-pass, Claude Code-compatible argument grammar as skills and commands:

| Syntax | Result |
|---|---|
| `$ARGUMENTS` | Raw argument string, preserving quotes and spacing |
| `$ARGUMENTS[N]` or `$N` | Zero-based positional token `N`; `$0` is the first token |
| A declared argument name, such as `$file` | The positional slot assigned by `arguments:` frontmatter |
| `\$` | Literal dollar sign |

`$@` and braced slice or default forms render literally. Arguments use shell-like tokenization only for positional placeholders; `$ARGUMENTS` remains verbatim.
Arguments follow shell-like quoting, so `/review "API compatibility"` supplies one argument containing a space.

<a id="choose-where-it-loads"></a>

## Add it to Pi

Place the template in your user or project prompt directory. Conventional prompt directories load direct `.md` children only.

Settings and packages can select nested Markdown files; a package manifest can narrow discovery with explicit paths and globs. See [Settings](settings.md#resources) and [Pi Packages](packages.md) for these options.

Project templates become commands in the editor after trust is granted. Review their content before trusting an unfamiliar project. See [Security](security.md#understand-project-trust).

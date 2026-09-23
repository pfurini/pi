# Prompt Templates

Prompt templates turn Markdown files into reusable `/` commands. Use one when you want to reuse the same prompt without writing an extension. A template body is prompt text; it can also inline other files and run `!`command`` shell injections at expansion time, under the same tool policy as skills (see [Render a template](#render-a-template)).

A template can accept arguments and appear in command completion. Pi can load templates from personal configuration, project configuration, an explicit path, or a Pi package. Project configuration loads only after project trust is granted.

## Create a template

Create `~/.pi/agent/prompts/review.md`:

```markdown
---
description: Review staged git changes
argument-hint: "[focus]"
---
Review the staged changes. Focus: $ARGUMENTS
When no focus is given, cover correctness, security, and error handling.
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

`$@` and braced slice or default forms such as `${1:-default}` render literally. Arguments use shell-like tokenization only for positional placeholders; `$ARGUMENTS` remains verbatim.
Arguments follow shell-like quoting, so `/review "API compatibility"` supplies one argument containing a space. When arguments are supplied but the body has no placeholder, Pi appends `ARGUMENTS: <raw arguments>` so the input is never dropped.

Templates, native commands, skills, built-ins, and extension commands share one `/` namespace. On a bare-name collision the higher tier wins (built-ins, then extension commands, then commands and templates, then skills) and the loser stays reachable through its qualifier: `/prompt:name` for commands and templates, `/skill:name` for skills, `/ext:name` for extension commands. A message that starts with a template invocation hands it the whole remainder as arguments; an invocation elsewhere in the message expands inline without arguments.

## Native commands

Alongside `prompts/`, Pi loads first-class commands from `~/.pi/agent/commands/` (user) and `.pi/commands/` (project, only after the project is trusted). Commands use the same Markdown and frontmatter format, the same argument grammar, and the same renderer as templates. Existing templates are grandfathered as command sources, so a `/name` template keeps working unchanged.

Command and template bodies can inline other files with `@path`. The referenced file's text is spliced in at expansion time, relative or absolute, with recursion, cycle, and size guards (depth 10, 64 KiB per file, 256 KiB in total). Write `\@path` for a literal `@path`. Includes inside fenced code blocks and inline code spans are left alone.

Trusting a project authorizes its command files to read and inline any file the process can access and, combined with shell injection, to run commands. Only trust projects you would give shell access to. See [Security](security.md#understand-project-trust).

## Render a template

Every invocation renders in one pass through a fixed stage order. Later stages never re-scan earlier output, so an argument can never introduce an include.

1. `@path` includes are inlined.
2. Arguments are substituted with the grammar above.
3. `${PI_SKILL_DIR}`, `${PI_PROJECT_DIR}`, `${PI_SESSION_ID}`, and `${PI_EFFORT}` are substituted; the `${CLAUDE_*}` spellings are aliases while the `skillInterop` setting is on. See [Skill variables](skills.md#skill-variables).
4. `!`command`` segments run and are replaced by their output. Injection runs only when the active tool set includes `bash` and the command's `disallowed-tools` frontmatter does not block it; otherwise the segment becomes `[shell command execution disabled by tool policy]`. The `disableSkillShellExecution`, `skillShellTimeoutMs`, and `skillShellOutputLimitBytes` settings apply. The `shell` frontmatter field selects the interpreter, `bash` (default) or `powershell`. See [Shell command injection](skills.md#shell-command-injection).

<a id="choose-where-it-loads"></a>

## Add it to Pi

Place the template in your user or project prompt directory. Conventional prompt directories load direct `.md` children only.

Settings and packages can select nested Markdown files; a package manifest can narrow discovery with explicit paths and globs. See [Settings](settings.md#resources) and [Pi Packages](packages.md) for these options.

Project templates and commands become commands in the editor after trust is granted. Review their content before trusting an unfamiliar project. See [Security](security.md#understand-project-trust).

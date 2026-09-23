# Skills

Skills give Pi specialized instructions and supporting files for a particular kind of work. Pi advertises each available skill by name and description, then loads its full instructions only when the task calls for them.

Use a skill when a workflow needs more context than a prompt template but does not need a new executable integration point. Skills can bundle scripts, references, and assets alongside their instructions.

Pi implements the [Agent Skills specification](https://agentskills.io/specification). Most invalid fields produce warnings rather than stopping startup.

## Create a skill

A skill is a directory containing `SKILL.md`:

```text
pdf-tools/
├── SKILL.md
├── scripts/
│   └── extract.sh
├── references/
│   └── formats.md
└── assets/
    └── template.json
```

Start `SKILL.md` with frontmatter followed by direct instructions:

```markdown
---
name: pdf-tools
description: Extract text and tables from PDF files. Use when reading, converting, or inspecting PDFs.
---

# PDF tools

Read `references/formats.md` before converting a document. Run scripts relative to this skill directory.
```

The description determines when the model considers loading the skill. State both what the skill does and when it applies. Avoid descriptions such as “Helps with PDFs,” which do not provide enough routing information.

Use relative paths from the skill directory when referring to bundled files. Pi tells the model where the skill lives so it can resolve those paths.

## Understand how skills load

At startup, Pi scans configured skill locations and adds a budgeted, versioned listing to the system prompt. The listing can expose a full description, name only, or nothing according to frontmatter and `skillVisibility`.

When a task matches, the model invokes the dedicated `skill` tool. Explicit `/name` and `/skill:name` commands use the same renderer. Verified model/provider combinations can receive a synthetic tool-call/result pair; other models receive a `<skill>` user-message block.

Arguments after an invocation use the same zero-based grammar as commands and prompt templates. Skill rendering then applies variable substitution, optional shell injection, tool-name guidance, model/effort overrides, and `disallowed-tools`. A `context: fork` skill can run through the subagent extension instead of entering parent context.

```text
/skill:pdf-tools extract report.pdf
```
Set `disable-model-invocation: true` in frontmatter when a skill should be available only through its explicit command. The `enableSkillCommands` [setting](settings.md) controls whether skill commands appear in interactive command discovery; manually entered `/skill:name` commands still work.

## Render a skill

Every invocation path (direct `/skill:name`, queued steer or follow-up, and the `skill` tool) renders the body once, in this order:

1. A `Base directory for this skill: <dir>` preamble is prepended.
2. Arguments are substituted with the grammar above. `$@` and braced forms such as `${1:-default}` stay literal.
3. Skill variables are substituted; see [Skill variables](#skill-variables).
4. `!`command`` shell injections run; see [Shell command injection](#shell-command-injection).
5. A tool-name note is appended when the body references Claude Code tool names.

Skills never inline file contents and there is no `@path` stage, so an argument that looks like a path is never resolved against the skill directory. Write a skill-local reference as `@${PI_SKILL_DIR}/references/x.md` when the model should read that file.

## Skill variables

Rendering substitutes these braced variables. The same values are set in the environment of shell injections and, while the invocation is active, of `bash` tool executions (`disableSkillEnvInjection: true` turns the tool overlay off).

| Pi variable | Claude Code alias | Value |
|---|---|---|
| `${PI_SKILL_DIR}` | `${CLAUDE_SKILL_DIR}` | The skill's base directory |
| `${PI_PROJECT_DIR}` | `${CLAUDE_PROJECT_DIR}` | Nearest ancestor with a `.git` entry, else the working directory |
| `${PI_SESSION_ID}` | `${CLAUDE_SESSION_ID}` | Current session id |
| `${PI_EFFORT}` | `${CLAUDE_EFFORT}` | The invocation's `effort` frontmatter, else the session thinking level, clamped to the effective model |

The `CLAUDE_*` aliases are accepted only while the `skillInterop` setting is on (the default); with `skillInterop: false` they stay literal. An integer `effort` budget maps to a level with a diagnostic (2048 or less to `low`, 8192 or less to `medium`, 24576 or less to `high`, above to `xhigh`). Unknown `${...}` text is left untouched.

## Shell command injection

A body segment `` !`command` `` runs `command` at render time and is replaced by its output. A skill author can run anything the user can, so load only skills you trust. Trusting a project authorizes its skills' shell blocks, including blocks added by a later `git pull`.

Execution is gated by tool policy. Injection runs only when the session's active tool set includes `bash` and the invocation's `disallowed-tools` does not block it (`Bash` and `bash` both match after redirect canonicalization). Blocked segments render as `[shell command execution disabled by tool policy]`. The `disableSkillShellExecution` setting disables injection everywhere and renders `[shell command execution disabled by policy]`. A timed-out or aborted command, a non-zero exit code, and truncated output are each marked inline in brackets.

Per-command limits come from `skillShellTimeoutMs` (default 30000) and `skillShellOutputLimitBytes` (default 16384). The `shell` frontmatter field selects the interpreter, `bash` (default) or `powershell`; it does not list the injections, which live in the body.

<a id="choose-where-it-loads"></a>

## Add it to Pi

Place the skill in your user or project skills directory. Directories containing `SKILL.md` are discovered recursively.

Pi also supports the Agent Skills locations `~/.agents/skills/` and `.agents/skills/`. Project `.agents/skills/` directories are discovered from the working directory through its ancestors, stopping at the repository root when one exists.

Pi accepts some standalone Markdown skills, but a directory containing `SKILL.md` is the portable form and should be preferred. See [Settings](settings.md#resources) and [Pi Packages](packages.md) for additional locations.

Project skills can instruct the model to run scripts or modify files. Review unfamiliar skills and their supporting files before granting project trust.

## Write portable frontmatter

The Agent Skills specification defines these fields:

| Field | Purpose |
|---|---|
| `name` | Command and display name |
| `description` | Routing description shown to the model |
| `license` | License name or bundled license file |
| `compatibility` | Environment requirements |
| `metadata` | Additional key-value metadata |
| `allowed-tools` | Experimental pre-approved tool list |
| `disable-model-invocation` | Hide the skill from automatic model selection |
| `when_to_use` | Additional routing guidance included with the description |
| `argument-hint` and `arguments` | Command completion and positional argument aliases |
| `disallowed-tools` | Tools removed and blocked while the invocation is active |
| `model` and `effort` | Ephemeral model and reasoning overrides for the invocation turn |
| `context`, `agent`, and `background` | Inline or subagent execution policy |
| `paths` | Recent-path listing boost patterns |
| `shell` | Interpreter for shell injection: `bash` (default) or `powershell` |

Names use lowercase letters, numbers, and hyphens, with no leading, trailing, or consecutive hyphens. They can contain at most 64 characters; descriptions can contain at most 1024.

Pi neither requires nor warns when the declared name differs from the parent directory. Other Agent Skills implementations may enforce that requirement, so matching names remain the portable choice.

Malformed `SKILL.md` files and declared skills without descriptions are not loaded. Collisions keep deterministic bare-name precedence and expose qualified alternatives where possible.

## Validate and share a skill

Run Pi from a location where the skill is discoverable, then inspect startup diagnostics and the `/skills` view. Pi watches discovered skill and command roots; use `/reload` when watching is unavailable or extension-provided resources changed.

Use a [Pi package](packages.md) to distribute one or more skills through npm or git. Keep environment setup inside the skill and declare any required runtime dependencies in the package.

For examples, see the [Anthropic skills collection](https://github.com/anthropics/skills) and [Pi skills collection](https://github.com/badlogic/pi-skills).

# pi-tokensave (fork-owned built-in)

This module makes the agent use [TokenSave](https://tokensave.dev) code intelligence before `grep`, `find` or speculative file reads. It registers six read-only tools, five commands and a guard, and it injects rules into the system prompt. It ships inside Pi as a fork-owned built-in (ADR-0009), so no package install is needed. It started as a copy of pi-tokensave at commit `2a626d3b` (MIT, see `LICENSE`). The plan `docs/plans/tokensave-builtin.plan.md` records every change since then.

## Requirements

- The `tokensave` binary on `PATH`, or `TOKENSAVE_BIN` set to its absolute path.
- A project indexed with `tokensave init`, which stores the index in `.tokensave/`.

The module never initializes a project on its own. `/tokensave-init` asks for confirmation first.

## Tools

All six tools are read-only. TokenSave's write tools (`str_replace`, `replace_symbol`, `ast_grep_rewrite` and others) are never exposed. Code changes still go through Pi's `edit` and `write` tools.

| Tool | Purpose |
| --- | --- |
| `tokensave_status` | Checks the binary, the project index and the graph counts. |
| `tokensave_context` | Builds task context: entry points, related symbols and snippets. |
| `tokensave_find_symbol` | Locates a named class, function, method or type, exact matches first. |
| `tokensave_search` | Runs a conceptual, keyword or literal search when no exact name is known. |
| `tokensave_symbol` | Shows a symbol's signature, body, callers, callees and implementations. |
| `tokensave_impact` | Reports the blast radius of changing a symbol or a file. |

TokenSave output is a starting point. The tool guidelines and the injected rules both tell the model to read the source file before it makes claims or edits.

### The `project` parameter

Every tool takes an optional `project`: a path, absolute or relative to the session cwd. Without it, a tool queries the session's project. With it, a tool queries another repository that holds `.tokensave/`.

| Aspect | Behavior |
| --- | --- |
| Resolution | The path resolves to the nearest ancestor with `.tokensave/`, or else the nearest Git root. |
| Uninitialized target | The tool returns an error that names the root, and it starts no process. |
| Result header | Every result starts with `Project: <root>`. |
| Output paths | A foreign root gives absolute file paths. The session's project keeps TokenSave's relative paths. |
| `tokensave_context` | Its text stays as TokenSave writes it. For a foreign root, the header adds `File paths below are relative to <root>.` |
| Input paths | A leading `<root>/` is stripped from `file`, `pathInclude` and `pathExclude`, because the TokenSave CLI accepts only root-relative paths. |

## Commands

| Command | Effect |
| --- | --- |
| `/tokensave-status [path]` | Shows the TokenSave status box for the session's project, or for the project at `path`. |
| `/tokensave-init [path]` | Asks for confirmation, then runs `tokensave init` on the resolved root. |
| `/tokensave-sync [path]` | Runs an incremental `tokensave sync` on the resolved root. |
| `/tokensave-mode` | Shows the current mode and its source (settings or session). |
| `/tokensave-mode prefer` or `/tokensave-mode enforce` | Changes the mode for the current session only, and writes nothing. |
| `/tokensave-doctor` | Shows the binary, the project index, the settings path, the mode and `autoManageBranches`. |

## Settings

The module reads its settings from `settings.json` in the session's agent directory, under `forkBuiltins["pi-tokensave"]`. The agent directory is `~/.pi/agent` unless the session reports another one. The module never reads a project's `.pi/settings.json`, and it writes no file in the agent directory.

```json
{
  "forkBuiltins": {
    "pi-tokensave": {
      "mode": "enforce",
      "autoManageBranches": true
    }
  }
}
```

| Key | Values | Default |
| --- | --- | --- |
| `mode` | `"enforce"` or `"prefer"` | `"enforce"` |
| `autoManageBranches` | `true` or `false` | `false` |

A value of the wrong type falls back to its default. A missing, unreadable or malformed file yields the defaults. Each new session starts from the settings mode.

## Modes

| Mode | Behavior |
| --- | --- |
| `enforce` (default) | Blocks a narrow set of manual searches that look like named-symbol discovery, such as `rg "WellModel" .` or `find . -iname "*wellmodel*"`. |
| `prefer` | Never blocks. It may show one short notice per session when a manual search could have used TokenSave. |

The guard in `enforce` mode blocks a search only when all of these hold:
- the search reads a project that holds `.tokensave/`, and whose index is not empty;
- TokenSave is installed;
- the model can call `tokensave_find_symbol`;
- TokenSave has not been consulted for that symbol in that project during the session.

Everything else passes unmodified: complex regular expressions, pipelines, `git grep`, logs, configuration, migrations, generated code, Markdown, JSON, YAML and TOML. After TokenSave returns no result or an error, a manual search for that symbol is allowed.

The guard inspects `bash`, `grep`, `find` and `anchor_grep` (from pi-hashline-edit-pro). It checks the project the search reads, not the session cwd. For `grep`, `find` and `anchor_grep`, that is the `path` input. For `bash`, it is the last non-flag argument that exists as a path, or else the cwd. When that project differs from the session's, the block message tells the model to pass `project`.

Both modes stand down when the model cannot call `tokensave_find_symbol`, because the block message and the notice point at it. That covers subagents whose tool list leaves the TokenSave tools out, and a running skill whose `disallowed-tools` blocks the tool (`pi.getCallableTools()` reports it). A worker's `toolSelection` therefore governs the guard.

## Empty indexes

An index whose `status` reports 0 nodes gets no rules injection and no guard, because the rules would send the model to tools that return nothing. The module caches the state per project root:

| State | Meaning |
| --- | --- |
| `unknown` | Not probed yet. The first consumer runs `status` once, with a 4 s timeout. |
| `empty` | `status` reported `node_count` 0. |
| `ready` | Any other answer, including an error or a timeout, so the rules and the guard stay on when the check fails. |

`session_start` starts the lookup of the session's project without waiting for it. A root stays `empty` or `ready` until something resets it to `unknown`:
- a successful `/tokensave-init` or `/tokensave-sync` of that root;
- a branch reconciliation whose `sync` step ran and succeeded.

The tools still run on an empty index, and `tokensave_status` reports the counts.

## Rules injection

The module injects its rules through `before_agent_start` as a `<tokensave>` prompt section. The rules sit between `<!-- pi-tokensave:start -->` and `<!-- pi-tokensave:end -->` markers. Injection happens only when all of these hold:
- the session's project holds `.tokensave/`, and its index is not empty;
- at least one `tokensave_*` tool is active;
- the prompt and the loaded context files do not already hold the start marker.

The rules cover the discover-then-verify workflow, the `project` parameter, the direct database fallback (`<root>/.tokensave/tokensave.db`, read-only) and the rule against subagents for codebase research in indexed repositories. A skill's `disallowed-tools` does not remove the rules, because toggling a recorded prompt section per turn would invalidate the provider's cached prefix. When an earlier handler already replaced the whole prompt, the rules are appended to the prompt text instead.

## Branch indexes

When `autoManageBranches` is `true`, the module keeps TokenSave's branch indexes aligned with local Git state. It reconciles when a local branch is created, checked out, renamed, deleted or moved to a new commit:

| Step | Effect |
| --- | --- |
| `tokensave branch add` | Tracks the checked-out branch. |
| `tokensave sync` | Refreshes the checked-out branch index. A detached HEAD skips this step. |
| `tokensave branch gc` | Removes the indexes of deleted local branches. |

The sync step does the work of TokenSave's `post-commit` hook, which never runs in a repository with its own `core.hooksPath` (husky, for example).

The session's project reconciles at session start, without delaying it, and again before each TokenSave tool call. A tool call that passes `project` reconciles that project first. Unchanged refs cost one `git branch` call and no TokenSave process. When another process holds TokenSave's sync lock, the step is skipped silently and retried at the next TokenSave tool call.

Every session in one Pi process shares the reconciliation state, keyed by project root. A subagent therefore reuses the work its parent already did. Uncommitted edits are never synced; run `/tokensave-sync` for them.

## Troubleshooting

| Message | Fix |
| --- | --- |
| "TokenSave binary not found" | Install `tokensave` on `PATH`, or set `TOKENSAVE_BIN` to its absolute path. |
| "TokenSave is not initialized at `<root>`" | Run `/tokensave-init` (with the path for another project), or omit `project`. |
| The guard blocks a legitimate search | Call `tokensave_find_symbol` first, or run `/tokensave-mode prefer` for this session. |

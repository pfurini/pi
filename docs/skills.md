# Skills

Skills are markdown instruction packs (`SKILL.md` plus supporting files) that
the model can invoke when a task matches their description, and that you can
invoke directly as `/name`. Commands are plain prompt files that share the same
namespace. This guide covers the operator-facing surface: where they live, the
frontmatter contract, how invocation and precedence work, what a skill may
change while it runs, and how to control visibility and listing cost.

## Locations and loading

Pi loads `SKILL.md` files recursively from its own locations (per ADR-0002,
`.claude/` is never read):

- `~/.pi/agent/skills/` (user scope) and `~/.agents/skills/`
- `.pi/skills/` and `.agents/skills/` in the project (trust-gated)
- Skills contributed by installed packages, extensions, the `skills` settings
  array, and `--skill` CLI flags

Frontmatter is normalized at load; unknown fields are preserved verbatim, and a
malformed value produces a load warning and falls back to the default, never a
load failure. See [Frontmatter reference](#frontmatter-reference) for the full
field set.

## Frontmatter reference

| field | type | effect |
| --- | --- | --- |
| `name` | string | Invocation name; defaults to the skill's directory name. |
| `description` | string | Listing text the model matches a task against. |
| `when_to_use` | string | Extra listing context beyond the description. |
| `argument-hint` | string | Placeholder shown in `/` autocomplete. |
| `arguments` | string \| string[] \| object | Declares argument names for body substitution (see [Arguments and variables](#arguments-and-variables)). |
| `disable-model-invocation` | boolean | Hides the skill from the listing and the `skill` tool. |
| `user-invocable` | boolean | `false` removes the skill from the `/name` namespace. |
| `paths` | string \| string[] | Globs that boost listing order when matching files are touched. |
| `model` | string | Runs the invocation under a different model. |
| `effort` | string \| number | Reasoning effort for the invocation; a number maps to a level. |
| `disallowed-tools` | string \| string[] | Tools the model may not call while the skill is active. Enforced. |
| `context` | `inline` \| `fork` | `fork` runs the skill in a subagent instead of the current context. |
| `agent` | string | Which subagent a forked skill runs in. |
| `background` | boolean | Runs a forked skill without blocking the session. |
| `shell` | string | Shell used for `!`-injected commands in the body (default `bash`). |
| `license`, `compatibility`, `metadata` | — | Carried for interop; no runtime effect. |

`disallowedTools` is accepted as a camelCase alias; when both spellings are
present the kebab-case `disallowed-tools` wins.

Two fields of the CC-class contract are **parsed but inert** in pi:

- **`allowed-tools`** — pi has no permission layer (ADR-0007). Use
  `disallowed-tools` to restrict a skill instead.
- **`hooks`** — retained in frontmatter, never executed.

Both are preserved rather than stripped so a ported skill round-trips unchanged.

## Arguments and variables

Everything after `/name` is the raw argument string `R`, substituted into the
body before delivery:

- `$ARGUMENTS` substitutes `R` verbatim.
- `$ARGUMENTS[N]` and `$N` substitute positional token N, **0-based** (`$0` is
  the first); `$name` substitutes a declared `arguments` alias. `$@` and every
  braced form render literally — they are not placeholders.
- `\$` renders a placeholder literally.
- If `R` is non-empty and no placeholder consumed it, `R` is appended to the
  body, so a skill that declares nothing still receives its arguments.

Four interop variables are substituted under both the `PI_` and `CLAUDE_`
prefixes, so a ported skill referencing either name works: `PI_SKILL_DIR`,
`PI_PROJECT_DIR`, `PI_SESSION_ID`, and `PI_EFFORT`.

## Watching

Every scanned skill root (the default user/project directories, package-,
settings-, and `--skill`-provided paths, extension-registered paths, and
nested roots discovered at runtime) and both command roots (`commands/` under
the agent config directory and the trust-gated `.pi/commands/`) are watched
live. Creating, editing, or deleting a skill or command on disk takes effect in
the running session without `/reload`: the next request's `<available_skills>`
listing, the `skill` tool's accepted set, the `/name` namespace, and the
`skills:changed` extension feed all converge to the on-disk state within a
short debounce window, and deletions unregister.

Watching needs no configuration and has no setting. If watching itself fails
(for example an OS watcher limit), Pi surfaces one diagnostic, retries in the
background, and the session degrades to pre-watch behavior: `/reload` still
picks up every change.

## Nested (monorepo) discovery

When a tool call touches a file whose ancestor directories between the project
root and the file contain a `.pi/skills/` or `.agents/skills/` directory that
has not been scanned yet — for example `apps/web/.pi/skills/` in a monorepo —
Pi scans and registers that root mid-session, trust-gated exactly like the
project's own roots. The new root is watched like every other scanned root,
and deleting it unregisters its skills.

On a name collision with an already-loaded skill, the nested skill keeps its
frontmatter `name` but is listed and invoked under a directory-qualified name
(`<root-relative-dir>:<name>`, e.g. `apps/web:deploy`). Both collide-ees stay
available: invoking the bare `/name` resolves to the incumbent and appends a
note listing the qualified variants.

## Invocation

- **Model invocation:** the model calls the `skill` tool with a name from the
  `<available_skills>` listing in the system prompt and receives the rendered
  instructions. Skills with `disable-model-invocation: true` are excluded from
  both the listing and the tool's accepted names.
- **User invocation:** `/name args` anywhere in a message (bare, `skill:name`,
  or a `dir:name` qualifier on same-name collisions). Skills with
  `user-invocable: false` stay out of the `/name` namespace and menus; typing
  their `/name` sends it as literal text. An unknown `/name` is likewise
  literal text — never an error.

The listing is budgeted: descriptions are trimmed to fit
`floor(contextWindow × skillListingBudgetFraction)` (default 0.01), falling
back to name+location entries at the floor. Skills whose `paths` glob matches
recently touched files are listed first and truncated last.

## Commands and the `/name` namespace

Commands are markdown prompt files that share one namespace with skills. They
load from `~/.pi/agent/commands/` (user scope) and the trust-gated
`.pi/commands/` (project scope), and are watched live like skills.

Everything invocable by `/name` — built-ins, extension commands, commands,
prompt templates, and skills — resolves through a single registry under a fixed
precedence. The lowest tier wins the bare name:

| tier | source |
| --- | --- |
| 0 | built-in control commands (`/model`, `/skills`, `/quit`, …) |
| 1 | extension commands |
| 2 | commands and prompt templates |
| 3 | skills |

A name claimed by a higher-precedence source is never silently swallowed: every
entry keeps a reserved qualifier, so the loser stays reachable explicitly.

- `skill:name` — the skill
- `prompt:name` — the prompt template
- `ext:name` — the extension command
- `dir:name` — a nested skill under its directory-qualified name

Control commands are **message-initial only**: `/model` at the start of a
message is a command, while the same text mid-message is literal. Skills and
commands, by contrast, expand anywhere in a message. An unknown `/name` is
always literal text, never an error.

## Execution semantics

An invocation can carry overrides that apply only for its duration:

- **`model` and `effort`** switch the model and reasoning effort for the
  invocation, then revert.
- **`disallowed-tools`** blocks the named tools while the skill is active. When
  several skills are active at once, their `disallowed-tools` are **unioned** —
  restrictions accumulate and never cancel each other out.
- **`context: fork`** runs the skill in a subagent over the pi-subagents RPC
  instead of the current context, optionally in a named `agent` and, with
  `background: true`, without blocking the session.

When invocations stack, the most recent one wins for the environment and for
the `model`/`effort` overrides; conflicting overrides on superseded records
produce a diagnostic and are preserved rather than applied. `disallowed-tools`
is the deliberate exception, since relaxing a restriction because a later skill
did not repeat it would be the unsafe direction.

## Re-invocation and compaction

Invoking the same skill twice does not re-send its body. Delivery is deduped on
the tuple of skill ID, raw arguments, and the byte-identical rendered body,
checked against the last full inline delivery of that skill still present in
context. Change the arguments or edit the skill and the next invocation
delivers in full again.

After compaction — automatic or `/compact` — the most recent inline delivery of
each invoked skill is re-attached, most-recently-used first, budgeted at 5,000
code units per skill and 25,000 combined. Skills you have actually been using
survive compaction; the rest fall away. The set is recomputed from the session
branch on every rebuild and never persisted, so it always reflects the current
history rather than a stale snapshot.

## Visibility (`skillVisibility` and `/skills`)

On top of the two frontmatter flags, each skill has a **persisted visibility
state** you control at runtime — four states (A.6):

| state | model-facing | user-facing |
| --- | --- | --- |
| `on` (default) | listed with description | `/name` works |
| `name-only` | listed as name+location (no description) | `/name` works |
| `user-invocable-only` | not listed, `skill` tool rejects it | `/name` works |
| `off` | not listed, `skill` tool rejects it | `/name` **errors** |

The effective visibility is the AND of frontmatter and the persisted state on
each dimension: settings can restrict further but can never re-grant what
frontmatter removed (`disable-model-invocation` always hides from the model,
`user-invocable: false` always hides from `/name`). `off` is the only state
that turns a `/name` invocation into an error rather than literal text, and it
does so for every valid name of the skill — bare, `skill:`-qualified, and
collision-qualified — even when frontmatter also sets `user-invocable: false`.

States persist in settings under `skillVisibility`, keyed by the skill's
**canonical ID** (its canonicalized `SKILL.md` path), at both global and
project scope with project precedence:

```json
{
  "skillVisibility": {
    "/absolute/path/to/skills/deploy/SKILL.md": "name-only"
  }
}
```

Keying by canonical ID means a listing-name change or a collision-winner
deletion can never silently re-grant (or transfer) a restriction.

Open **`/skills`** to manage this interactively. The overlay lists every
loaded skill with its estimated listing cost (the same `est` measure the
budget engine uses), its effective visibility, and the scope its state comes
from. The `app.skills.*` actions cycle the four states, toggle sorting by cost,
and toggle whether changes persist to global or project settings (all
configurable modified keys, so typing filters the list unambiguously). A
malformed persisted value falls back to `on`, shows an invalid-value
indicator, and produces one settings warning. Changes apply to the next
request across every surface — listing, `skill` tool, and `/name` — without a
`/reload`.

Visibility is **prospective-only**: restricting a skill gates the next
request's surfaces; it does not rewrite already-delivered skill content or
existing session records, and restoring `on` re-enables everything
immediately.

# Skills

Skills are markdown instruction packs (`SKILL.md` plus supporting files) that
the model can invoke when a task matches their description, and that you can
invoke directly as `/name` commands. This guide covers the operator-facing
surface: where skills live, how invocation works, and how to control
visibility and listing cost.

## Locations and loading

Pi loads `SKILL.md` files recursively from its own locations (per ADR-0002,
`.claude/` is never read):

- `~/.pi/agent/skills/` (user scope) and `~/.agents/skills/`
- `.pi/skills/` and `.agents/skills/` in the project (trust-gated)
- Skills contributed by installed packages, extensions, the `skills` settings
  array, and `--skill` CLI flags

A skill's frontmatter (`name`, `description`, `when_to_use`,
`disable-model-invocation`, `user-invocable`, `paths`, and the rest of the
CC-class contract) is normalized at load; unknown fields are preserved.
Malformed values produce load warnings, never load failures.

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
from. `Space` cycles the four states, `s` toggles sorting by cost, `g` toggles
whether changes persist to global or project settings, and typing filters the
list. A malformed persisted value falls back to `on`, shows an invalid-value
indicator, and produces one settings warning. Changes apply to the next
request across every surface — listing, `skill` tool, and `/name` — without a
`/reload`.

Visibility is **prospective-only**: restricting a skill gates the next
request's surfaces; it does not rewrite already-delivered skill content or
existing session records, and restoring `on` re-enables everything
immediately.

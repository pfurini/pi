# Skills: Claude Code vs Pi — Capability Matrix

A single reference for what **Claude Code** delivers and what **Pi** now does, so
one table answers both. Written for agents and authors who need to port a
CC-class skill to Pi, or reason about behavior in either harness.

## Provenance — read this before trusting a cell

The two columns have **different evidence strength**, deliberately:

| Column | Source | Strength |
| --- | --- | --- |
| **Pi** | Read from source at commit `9168d8a31` (2026-08-21), file references given per row | Verified now |
| **Claude Code** | Inherited from [`claude-code-skill-system-reference.md`](./claude-code-skill-system-reference.md), extracted from binary `2.1.220` on 2026-08-02 | **Not re-verified**; may have drifted |

Treat the CC column as a well-sourced snapshot, not current ground truth. Where
a decision depends on exact CC behavior today, re-check against a current
binary. The Pi column is authoritative as of the stated commit.

For CC-side depth beyond a table cell — the full frontmatter schema, the exact
render-pipeline ordering, hook wire formats — see
[`claude-code-skill-system-reference.md`](./claude-code-skill-system-reference.md).

---

## 1. Capability matrix

| Capability | Claude Code | Pi | Pi source |
| --- | --- | --- | --- |
| SKILL.md + frontmatter + progressive disclosure | Yes | Yes | `core/skills/frontmatter.ts` |
| **Model invocation** | Dedicated `Skill` tool (`{skill, args?}`) | Dedicated `skill` tool (`{name, args?}`); rejects names hidden from the model | `core/skills/skill-tool.ts:80` |
| **User invocation** | `/name args` | `/name args`, anywhere in a message | `core/commands/tokenizer.ts` |
| Command name source | Directory name; frontmatter `name` is display-only | Frontmatter `name`, falling back to the directory | `core/skills/frontmatter.ts` |
| Stacking per message | Up to 6 | Up to 6; extras stay literal and emit a diagnostic | `core/commands/tokenizer.ts:30` |
| Render pipeline | 7 ordered stages, single pass | 6 ordered stages, single pass — Pi has no `@path` stage (see below) | `core/skills/render.ts:1-27` |
| Argument substitution | `$ARGUMENTS`, `$ARGUMENTS[N]`, `$N`, `$name`, escaping, append fallback | Identical: `$ARGUMENTS`, 0-based `$ARGUMENTS[N]` / `$N`, declared `arguments` names as positional aliases, `\$` escaping, append fallback. `$@` and every braced form (`${@:N}`, `${X:-default}`) render literally — not placeholders | `core/skills/arguments.ts` |
| Variable substitution | `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, plus plugin vars | Same four under `PI_*`, with `CLAUDE_*` accepted as aliases. **No plugin vars** (`${CLAUDE_PLUGIN_ROOT}`, `${user_config.KEY}`) | `core/skills/interop.ts:21-26` |
| `@path` references | Not inlined and never rewritten; `${CLAUDE_SKILL_DIR}` makes them absolute and the model reads them | Identical: not inlined and never rewritten; `${PI_SKILL_DIR}` makes them absolute and the model reads them | `core/skills/interop.ts` |
| Shell injection | `` !`cmd` `` and fenced `` ```! ``, permission-gated, `disableSkillShellExecution` policy, `shell` field | `` !`cmd` `` and fenced `` ```! ``, tool-policy gated, `disableSkillShellExecution` kill switch, `shell` field | `core/skills/shell-injection.ts:104` |
| `allowed-tools` | Turn-scoped **grant** of pre-approval; also gates shell injection | **Parsed, never enforced.** Pi has no permission layer (ADR-0007) | declared only in `frontmatter.ts:26` |
| `disallowed-tools` | Turn-scoped removal from the tool pool | Enforced. Redirect-canonicalized, and **unioned** across stacked skills so restrictions accumulate | `core/skills/skill-overrides.ts:150` |
| `Skill(name)` permission rules | Yes, integrated with allow/ask/deny | **None** — no permission layer exists | — |
| Per-skill `model` / `effort` | Turn-scoped, then revert | Turn-scoped and ephemeral; last invocation wins when stacked | `core/skills/runtime.ts:170-171` |
| `context: fork` / `agent` / `background` | Yes; forks into a named agent type | Yes, over the pi-subagents RPC | `core/skills/skill-fork.ts` |
| Skill-bundled agent definitions | Yes, via skills-dir plugins (`<skill>/agents/`) | Yes, via pi-subagents (ADR-0008): registered qualified-always (`skill:agent`), bare only when globally free; the render pipeline rewrites the skill's own agent names to the qualified form; hidden from global listings, spawnable by qualified name | `core/skills/runtime.ts:27`, `core/skills/render.ts` stage 1 |
| `paths` | Glob-gated **auto-activation** | Glob-gated **listing boost** — matching skills sort first and truncate last. Not auto-activation | `core/skills/paths-boost.ts` |
| Listing budget | ~1% of context window; per-skill 1,536 cap; least-invoked truncated first | Same shape: `skillListingBudgetFraction` (default 0.01), `MAX_LISTING_DESCRIPTION_LENGTH` 1,536 | `packages/agent/src/harness/listing-budget.ts` (re-exported at `core/skills/listing-budget.ts`) |
| Re-invocation dedup | Short "already loaded" note | Deduped on `(skillId, raw args, byte-identical body)` against the last inline delivery still in context | `core/skills/dedup.ts:1-7` |
| Compaction carry-forward | Re-attach MRU invocation per skill; 5k each, 25k combined | Same: MRU-first, 5,000 per skill, 25,000 combined; recomputed per rebuild, never persisted | `core/skills/carry-forward.ts:19` |
| Live reload | File watchers + `/reload-skills` | Debounced per-directory watchers over every scanned skill and command root; `/reload` remains the fallback | `core/skills/resource-watch.ts` |
| Nested / monorepo discovery | Runtime discovery when the model touches the subtree; `dir:name` on clash | Same, triggered by a tool touching a file under an unscanned root; `dir:name` on collision | `core/skills/nested-discovery.ts` |
| Visibility management | `/skills` menu; 4-state `skillOverrides` | `/skills` overlay with listing cost; 4-state `skillVisibility` keyed by **canonical ID**, global + project scope | `core/skills/visibility.ts` |
| `when_to_use` | Yes, folded into the listing | Yes, folded into the capped listing description | `core/skills/listing.ts:18-20` |
| `argument-hint` | Yes | Yes, shown in `/` autocomplete | `packages/tui/src/autocomplete.ts:441` |
| `user-invocable` | Yes | Yes; independent of `disable-model-invocation` | `core/skills/skill-tool.ts:92-95` |
| `hooks` frontmatter | Skill-scoped lifecycle hooks, registered on load | **Parsed, never executed** | declared only in `frontmatter.ts:36` |
| Namespace precedence | Tiered, with `plugin:` namespacing | 4 tiers — builtin > extension > command/prompt > skill — with reserved `skill:` / `prompt:` / `ext:` / `dir:` qualifiers keeping every loser reachable | `core/commands/registry.ts:37-43` |
| Control-command scoping | — | Control commands are **message-initial only**; skills and commands expand anywhere | `core/commands/registry.ts` |
| Expansion-time extension seam | `UserPromptExpansion` hook: augment or block, **cannot rewrite** | `input` event `transform`: can rewrite, but fires **pre-expansion**. No post-expansion event | `core/extensions/types.ts` |
| CC tool-name translation | n/a | Redirect map (`Read`→`read`, `Task`→`Agent`, …) plus a conditional steering note (ADR-0006) | `core/skills/tool-redirects.ts` |
| `--skill` CLI flag | No | Yes, repeatable; works with `--no-skills` | `cli/args.ts:156` |
| `.agents/skills` cross-harness dirs | No | Yes, user and project scope | `core/package-manager.ts:442,2453` |
| Ignore-file support in scanning | No | Yes (`.gitignore` / `.ignore` / `.fdignore`) | `core/skills.ts:25` |
| Plugin system, marketplaces, `userConfig` | Yes | **No** — excluded by decision (ADR-0001), not a gap | — |
| Reads `~/.claude/` or `.claude/` | n/a | **Never** (ADR-0002) | — |

---

## 2. Frontmatter field support

| Field | Claude Code | Pi |
| --- | --- | --- |
| `name` | Display label; command name comes from the directory | Invocation name; falls back to the directory |
| `description` | Optional, first-paragraph fallback; ≤1,536 with `when_to_use` | Required in practice; capped with `when_to_use` at 1,536 in listings |
| `when_to_use` | Yes | Yes |
| `argument-hint` | Yes | Yes |
| `arguments` | Yes (@internal) | Yes — declares names for substitution |
| `disable-model-invocation` | Yes | Yes |
| `user-invocable` | Yes | Yes |
| `paths` | Glob auto-activation | Glob listing boost |
| `model` | Yes, turn-scoped | Yes, turn-scoped |
| `effort` | `low\|medium\|high\|max\|integer` | String or number; numbers map to a level |
| `disallowed-tools` (+ `disallowedTools`) | Turn-scoped removal | **Enforced**; kebab-case wins over the alias |
| `allowed-tools` | Turn-scoped grants | **Parsed, inert** |
| `context` | `inline\|fork` | `inline\|fork` |
| `agent` | Subagent type for fork | Subagent type for fork |
| `background` | Yes (fork default true) | Yes |
| `shell` | `bash\|powershell` | Shell for `!`-injected commands (default `bash`) |
| `hooks` | Skill-scoped hooks | **Parsed, inert** |
| `license` / `compatibility` / `metadata` | Parsed | Parsed and preserved; no runtime effect |
| `version` | @internal | Preserved as an unknown field |
| Unknown fields | — | Preserved verbatim |
| Booleans | `true/false/yes/no/on/off/1/0` | Lenient, same set |

---

## 3. Porting a CC skill to Pi

What transfers untouched, what degrades, and what breaks.

**Works as-is.** The SKILL.md format, the full 0-based argument grammar
(`$ARGUMENTS`, `$ARGUMENTS[N]`, `$N`, declared names, `\$` escaping, append
fallback), `${CLAUDE_SKILL_DIR}` and the other three interop variables (accepted
as aliases), `@path` includes, `` !`cmd` `` shell injection, `when_to_use`,
`argument-hint`, `user-invocable`, `disable-model-invocation`,
`disallowed-tools`, `model`, `effort`, `context: fork` with `agent` and
`background`, and lenient booleans. CC tool names in prose are redirected.

**Degrades quietly — check these.**

- Argument substitution is now byte-exact CC parity (0-based, `$ARGUMENTS[N]`
  supported), so no argument placeholder degrades on a CC→Pi port. A Pi-only
  skill authored against the *old* Pi grammar (1-based `$N`, `$@`, `${@:N}`
  slices, `${X:-default}` defaults, `name=value` binding) is the reverse case
  and breaks — see the CHANGELOG breaking-changes migration.
- `allowed-tools` is inert. A skill relying on it for pre-approval simply has no
  restriction applied; use `disallowed-tools` to restrict instead.
- `hooks` is inert. A skill whose behavior depends on its lifecycle hooks will
  load and run without them.
- `paths` boosts listing order rather than auto-activating, so a skill expecting
  activation-on-file-touch must be invoked.
- Skill-bundled agents (`<skill>/agents/`) register with different naming than CC
  plugins: always qualified (`skill:agent`), bare only when the name is globally
  free, hidden from global agent listings. Skills referencing their own agents by
  bare name still resolve (render-time rewrite), but cross-skill references need
  the qualified form.

**Breaks — needs rework.**

- Plugin-scoped tokens (`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`,
  `${user_config.KEY}`) have no Pi equivalent and are not substituted.
- `plugin:skill` / `plugin:agent` qualified names do not resolve.

---

## 4. Where Pi goes further

Not parity items — capabilities with no CC counterpart:

- `--skill <path>` CLI flag, repeatable, works even with `--no-skills`
- `.agents/skills/` cross-harness directories alongside `.pi/skills/`
- Ignore-file support (`.gitignore`, `.ignore`, `.fdignore`) during scanning
- Visibility keyed by **canonical ID**, so renaming a skill or deleting a
  collision winner can never silently re-grant or transfer a restriction
- `disallowed-tools` unioned across stacked skills rather than last-wins
- Reserved qualifiers on every namespace tier, so a shadowed entry always stays
  reachable rather than being unreachable

---

## 5. Fork-dead upstream symbols

The CC-exact argument engine (`substituteSkillArguments` in
`core/skills/arguments.ts`) is the only argument-substitution engine on Pi's live
path. The inherited legacy engine — `substituteArgs` and `expandPromptTemplate`
in `packages/coding-agent/src/core/prompt-templates.ts`, and `substituteArgs` /
`formatPromptTemplateInvocation` in `packages/agent/src/harness/prompt-templates.ts`
— is **fork-dead**: no module under any package's `src/` calls it. It is kept, not
deleted, because the engine functions are unmodified from `upstream/main` (the
harness copy is byte-identical; the coding-agent copy differs only in the live
`loadTemplateFromFile` / `PromptTemplate` loader that shares the file), upstream
still calls `expandPromptTemplate` live, and `@pi/agent` re-exports the harness
module wholesale. Deleting would convert clean merges into recurring
`deleted by us / modified by them` conflicts and break the public re-export.
A guard test
(`packages/coding-agent/test/fork-dead-engine.test.ts`) fails if any `src/` call
site is reintroduced, so a legacy 1-based grammar can never go live beside the
0-based one.

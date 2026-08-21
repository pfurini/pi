# Claude Code argument-grammar conformance corpus

Observed behavior of Claude Code's skill rendering, captured from a real CC install. This
is the **normative source** for the A.3.2 argument grammar: CC's published documentation is
silent on several of these rules and wrong about one of them (see "Where the docs disagree"
below), so the plan cites this corpus rather than the docs.

Probes 1-10 pin argument substitution. Probe 11 pins a neighbouring stage: it records that
CC performs no `@path` absolutization at all, which is the reference behavior for the stage-4
deviation tracked in issue #6. It lives here because it was captured by the same method and
would otherwise be lost, not because it constrains the argument grammar.

## Layout

- `manifest.json` — one entry per probe: the skill name, the argument string it was invoked
  with, and which rules it pins.
- `probes/<name>/SKILL.md` — the skill as authored.
- `probes/<name>/expected.txt` — what CC rendered, byte for byte.

`expected.txt` covers argument substitution only. The stage-1 base-directory preamble
(`Base directory for this skill: <abs path>`) is stripped, because it carries a
machine-local absolute path and belongs to a different render stage.

Body normalization a conformance test must apply before comparing against
`expected.txt`: remove the frontmatter and its trailing `---` separator, remove the blank
line between the separator and the body, and retain the body's trailing newline. This is
the raw transcript body minus frontmatter; `probe2/expected.txt`'s `done\n\n\nARGUMENTS:`
ending is only reproducible under this normalization (the Pi render pipeline trims the
skill body, which the corpus deliberately does not).
## Provenance

Captured 2026-08-21 against **Claude Code 2.1.237** on darwin. Method:

1. Skills placed in `<scratch>/.claude/skills/<name>/SKILL.md`.
2. Invoked with `claude -p --session-id <fixed-uuid> '/<name> <args>'` from `<scratch>`.
3. The rendered body read out of the session transcript at
   `~/.claude/projects/<escaped-cwd>/<session-id>.jsonl` — the first `type: "user"` entry
   whose content is a block array, taking the `text` block.

Step 3 matters: the transcript holds the literal bytes CC sent to the model. Reading the
model's *reply* instead would capture a paraphrase, and the model silently normalizes
things like stray backslashes.

## Re-running against a newer CC

This surface moves fast, and CC 2.1.220 (the build the repo's binary-extracted reference
came from) already differs from 2.1.237 in what it documents. Re-capture before relying on
these fixtures for a new change:

```bash
mkdir -p /tmp/cc-probe/.claude/skills
cp -R probes/* /tmp/cc-probe/.claude/skills/     # strips expected.txt harmlessly
cd /tmp/cc-probe
claude -p --session-id <uuid> '/probe1 alpha beta'
# then read ~/.claude/projects/-private-tmp-cc-probe/<uuid>.jsonl
```

Use the `args` field from `manifest.json` for each probe. A diff against `expected.txt`
is a CC behavior change and must be reconciled with the plan before any code moves.

## Where the docs disagree

`https://code.claude.com/docs/en/skills.md` states the append fallback fires "if
`$ARGUMENTS` is not present in the content". That is a simplification. `probe3` has no
`$ARGUMENTS` and gets no append; `probe6`'s only placeholder renders empty and still gets
no append; `probe2`'s only placeholder fails to match and does get one. The real rule is
that the fallback fires when *no placeholder was substituted*, where a substitution that
produces an empty string still counts.

The docs are also silent on: non-numeric bracket contents, the difference between an
out-of-range index and a malformed one, `arguments:` name collisions with `ARGUMENTS` or
with digits, whether `$@` is recognized (it is not), whether any braced form is recognized
(none is), and whether substitution reaches into fenced code blocks (it does).

`probe12` settles the one collision question probes 4 and 8 left open: a declared
`ARGUMENTS` shadows the bare built-in but does **not** shadow the indexed form — with
`arguments: [issue, ARGUMENTS, branch]` and args `a b c d`, `$ARGUMENTS` renders `b`
while `$ARGUMENTS[0]` still renders positional token `a` (and `$ARGUMENTS[01]` renders `b`).

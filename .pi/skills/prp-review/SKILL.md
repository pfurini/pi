---
name: prp-review
description: Reviews a pull request, branch, commit range, or working tree through specialist review agents, runs repository validation, and writes a converging review report. On local (non-PR) targets it also runs a behavior-preserving polish pass before judging and a human-gated apply cycle after the report. Use when the user asks to review a PR, review a branch or the current changes, close or review a plan step, check whether a change is ready to merge, run review agents, or invokes /skill:prp-review.
---

> **Arguments:** `$ARGUMENTS` (and `$1`, `$2`, ...) refer to the arguments given when this skill was invoked. Take them from the user's request; if absent, infer them from the conversation.

# Review a Change

Coordinate an evidence-based review of a PR, branch, commit range, staged or working-tree change.
Reviewer agents are the only path for judging the code: do not add an inline review pass before or
after them. On a PR the review is advisory and publishes to GitHub; on a local target it runs the
full step-close cycle — polish, judge, human-gated apply — and converges across re-reviews.

**Input**: $ARGUMENTS (if absent, use the current branch's open PR, else the current branch against
its merge base).

Always run:

- `code-reviewer` for correctness, project rules, and high-confidence defects;
- `seam-analyzer` for missing types, counterpart drift, and bypassed boundaries.

Named scopes are additive. Run their specialist agents only when explicitly requested; `all` adds
every specialist.

Resolve the canonical store before starting:

```bash
# --- PRP store resolver (canonical; keep byte-identical across skills) ---
_gd="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
case "$_gd" in */.git) _root="${_gd%/.git}" ;; "") _root="$PWD" ;; *) _root="$_gd" ;; esac
_root="$(cd "$_root" && pwd -P)"
_name="$(basename "$_root" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//;s/-*$//')"
PRP_DIR="${PRP_HOME:-$HOME/.prp}/${_name:-project}-$(printf %s "$_root" | git hash-object --stdin | cut -c1-8)"
mkdir -p "$PRP_DIR"; [ -f "$PRP_DIR/project.json" ] || printf '{"path": "%s", "name": "%s"}\n' "$_root" "${_name:-project}" > "$PRP_DIR/project.json"
```

Read `workflows/agents.md` and execute it end-to-end. Before producing the report, read
`templates/review-report.md` and follow its output contract exactly.

## Resources

- `workflows/agents.md` — PR resolution, validation, agent scopes, aggregation, and publication
- `templates/review-report.md` — canonical local and GitHub review format

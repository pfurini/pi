---
name: prp-plan-review
description: Adversarial review of an implementation plan by parallel attack agents - grades the plan against its source PRD (coverage, provenance, fidelity of acceptance criteria and user stories) and attacks its assumptions, completeness, feasibility of cited patterns, and validation coverage. Use when the user wants to "review this plan", "grade the plan against the PRD", "adversarially review the plan", "attack this plan before implementing", "check the plan satisfies the acceptance criteria", "does the plan cover the PRD", or invokes /prp-plan-review.
argument-hint: "[path/to/plan.md] [--prd <path/to/prd.md>] [--angles <traceability|assumptions|completeness|feasibility|validation|all>]"
---

# Plan Review — Adversarial Fan-out

Attack an implementation plan before any code is written. Parallel `plan-reviewer` agents each take one angle — PRD traceability first, then assumptions, completeness, feasibility, validation — and their findings aggregate into a verdict artifact that feeds `/prp-plan` revision or clears the plan for `/prp-implement`.

This skill is advisory: it never edits the plan, the PRD, or any code.

```bash
# --- PRP store resolver (canonical; keep byte-identical across skills) ---
_gd="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
case "$_gd" in */.git) _root="${_gd%/.git}" ;; "") _root="$PWD" ;; *) _root="$_gd" ;; esac
_root="$(cd "$_root" && pwd -P)"
_name="$(basename "$_root" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//;s/-*$//')"
PRP_DIR="${PRP_HOME:-$HOME/.prp}/${_name:-project}-$(printf %s "$_root" | git hash-object --stdin | cut -c1-8)"
mkdir -p "$PRP_DIR"; [ -f "$PRP_DIR/project.json" ] || printf '{"path": "%s", "name": "%s"}\n' "$_root" "${_name:-project}" > "$PRP_DIR/project.json"
```

## Phase 1: RESOLVE — the plan under review

1. If `$ARGUMENTS` contains a path to a `.md` file, use it. Otherwise list `$PRP_DIR/plans/*.plan.md` by modification time and propose the most recent; if several are plausible candidates for "the" plan, ask the user which one — do not guess.
2. Read the plan **in full**. Note its Metadata, Lifecycle (Back refs), NOT Building, Step-by-Step Tasks, Validation Commands, and Acceptance Criteria sections — the attack briefs reference them. Note the Amendments section too: a disposition table from a prior review there makes this pass a **re-review** (see Re-review passes).
3. If the plan does not exist or is empty, stop: `Error: no plan found. Create one first: /prp-plan "<feature>"`.

## Phase 2: SOURCE — locate the PRD

Resolve the source PRD in priority order; stop at the first hit:

1. `--prd <path>` in `$ARGUMENTS`.
2. A PRD path in the plan's Lifecycle **Back refs**.
3. Scan `$PRP_DIR/prds/*.prd.md` for an Implementation Phases table whose **PRP Plan** column references this plan's path or filename. When a hit is found, note **which phase row** links here — traceability grades the plan against that phase's Goal / Scope / Success signal plus the PRD-wide sections, not against every phase.
4. No hit → **traceability is skipped**. This must be loud, not silent: record `Traceability: SKIPPED — no source PRD found` in the report header and tell the user in the final summary. Never fabricate a traceability verdict without a PRD.

If a PRD is found, read it in full before dispatching.

## Phase 3: SELECT — choose the angles

| Angle | Agent focus | Runs when |
| ------- | ------------- | ----------- |
| `traceability` | PRD↔plan matrix: coverage, provenance, fidelity | PRD resolved (Phase 2). Skipped — loudly — otherwise |
| `assumptions` | Unstated premises, version/API drift, "surely X works" leaps | Always |
| `completeness` | Missing failure modes, migrations, rollback, observability | Always |
| `feasibility` | Ground-truth every cited `file:line` and pattern against the codebase | Always |
| `validation` | Do the plan's validation commands actually prove its acceptance criteria | Always |

**If `$ARGUMENTS` names angles, they ARE the list — run exactly those and nothing else.** A caller naming angles has already decided how much review this plan is worth. `all` is the only keyword that means "apply the table above". Naming `traceability` with no resolvable PRD is an error to surface, not a silent skip.

## Re-review passes

A re-review is any pass after findings were folded: the plan's Amendments carry a disposition table from a prior review, or the caller says so. A fresh full-depth attack on every section would re-litigate settled ground and keep the finding count high forever; a re-review instead:

1. **Verifies dispositions.** Every prior finding folded into the plan is checked as actually closed; every rejected finding's disproving evidence is checked as still holding. A disposition that does not hold is a finding.
2. **Attacks only new ground at full depth**: sections changed since the prior pass (named in the Amendments entry) and areas the prior pass did not reach. Unchanged, previously-verified sections are re-opened only on new evidence.
3. **Reports convergence honestly.** A re-review that finds nothing new says so — finding count is not review quality.

At dispatch (Phase 4), prepend this line to every brief (this is scoping, not rewording): "Re-review pass: prior findings and their dispositions are in the plan's Amendments. Verify the dispositions relevant to your angle, attack changed sections and previously unreached areas at full depth, and re-open closed findings only on new evidence."

## Phase 4: DISPATCH — parallel adversarial fan-out

Read `references/agent-prompts.md` now (mandatory) — it is the exact attack brief for every angle.

Launch **every selected angle** in a **single message with multiple Task tool calls**, one `plan-reviewer` agent per angle, each with its brief from the reference filled with the resolved plan path, PRD path, and phase row. Do not serialize: the angles are independent reads of the same artifacts. Run sequentially only if the user explicitly asks.

Wait for all agents to return.

## Phase 5: AGGREGATE — verdict and report

1. Collect every agent's finding blocks and `ANGLE_VERDICT` line.
2. Deduplicate: when two angles surface the same defect (common between completeness and validation), keep the finding under the angle with the stronger evidence and note the overlap.
3. Reclassify decisions: a finding whose resolution is a user choice — an unconfirmed `[DECISION REQUIRED]`/`[CONFIRM]` item, scope or slice ownership, a spec interpretation only the user can settle — is class **DECISION**, reported and counted separately from plan defects. It still forces REVISE (an undecided plan cannot be implemented), but the Next Step tells the user to decide, not the planner to fix.
4. Compute the overall verdict:
   - Any BLOCKING or DECISION finding, or any `ANGLE_VERDICT: FAIL` → **REVISE**.
   - Otherwise → **READY** (findings, if any, are advisory).
5. Read `templates/review-report.md` now (mandatory) and write the aggregated report in exactly that structure to:

```bash
mkdir -p "$PRP_DIR/reviews"
```

**Path**: `$PRP_DIR/reviews/plan-{plan-basename-without-extension}-review.md` — overwrite on re-run; the report is a snapshot of the latest review, not a log.

## Output

Report to the user:

- The expanded absolute report path.
- The verdict (READY / REVISE) with the one-line rationale.
- The traceability headline when it ran (N covered / N partial / N uncovered / N contradicted), or the loud SKIPPED note when it did not.
- Finding counts by class (blocking / decision / important / suggestion).
- Next step: **REVISE** → answer any Decisions Required, then `/prp-plan` revise-from-review with the report path; **READY** → `/prp-implement <plan path>`.

## Gotchas

- **Advisory only.** Never edit the plan, the PRD, or code, and never commit — findings feed a human or a `/prp-plan` revision pass.
- **Traceability is directional both ways.** Coverage (PRD→plan) alone is half the check; provenance (plan→PRD) catches scope creep the other direction. The brief encodes both — do not drop provenance to save tokens.
- **Feasibility findings require a codebase check.** A cited pattern flagged as missing without actually looking is worse than no review; the agent brief enforces this, hold the aggregate to it.
- **Do not soften on aggregation.** If an agent reports BLOCKING with solid evidence, it stays BLOCKING in the report even when the overall picture is positive.

## Resources

- `references/agent-prompts.md` — exact attack briefs per angle (mandatory read at Phase 4)
- `templates/review-report.md` — the aggregated report structure (mandatory read at Phase 5)

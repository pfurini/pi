# Plan Review Report Template

The exact structure of the aggregated report written to `$PRP_DIR/reviews/plan-{name}-review.md`. Fill every `{placeholder}`; keep every section heading. Omit only the Traceability Matrix section when traceability did not run (its SKIPPED status still appears in the header). The report is a snapshot — overwritten on re-run, no lifecycle to maintain.

---

# Plan Review: {plan title}

| Field | Value |
| ------- | ------- |
| Plan | `{absolute plan path}` |
| Source PRD | `{absolute PRD path}` + phase row, or `none found` |
| Traceability | RAN / **SKIPPED — no source PRD found** |
| Angles run | {comma-separated list} |
| Reviewed | {ISO-8601 date} |

## Verdict: {READY / REVISE}

{One-line rationale: what tipped the verdict. REVISE names the blocking findings by title; READY states what was checked and held.}

**Findings**: {N} blocking · {N} important · {N} suggestions

| Angle | Verdict |
|-------|---------|
| {angle} | {PASS / PASS_WITH_FINDINGS / FAIL / SKIPPED} |

## Traceability Matrix

{Coverage headline: N covered · N partial · N uncovered · N contradicted}

| PRD item | PRD section | Verdict | Plan location | Note |
|----------|-------------|---------|---------------|------|
| {item} | {section} | {covered/partial/uncovered/contradicted} | {task # / section, or —} | {what is missing or drifted} |

**Unjustified plan tasks (provenance)**: {list of task numbers with no PRD justification, each with a one-line note, or "none"}

**Fidelity drift**: {list: PRD commitment → plan wording, weakened or strengthened, or "none"}

## Blocking Findings

{Finding blocks from the agents, verbatim (angle, location, evidence, impact, recommendation). "None" when empty — then the verdict must be READY.}

## Important Findings

{Finding blocks, verbatim. "None" when empty.}

## Suggestions

{Condensed one-liners: `{angle}: {finding} — {location}`. "None" when empty.}

## Angle Summaries

{Per angle, the agent's 2-3 sentence summary, including the feasibility tally (N checked / N verified / N wrong / N missing) when that angle ran.}

## Next Step

{REVISE: `/prp-plan` revision with this report as input — paste this file's path and address the Blocking Findings; re-run `/prp-plan-review` after.
READY: `/prp-implement {plan path}`.}

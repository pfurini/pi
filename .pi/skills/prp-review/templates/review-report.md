# Review Report Contract

Write every review report in this shape. Omit empty finding rows, but keep all headings so humans and
downstream workflows can find the verdict and blocking categories reliably.

Severity bars — the aggregation maps every agent finding onto exactly one of these; the bar, not the
agent's own wording, decides the class:

- **Critical** — a reachable defect that breaks behavior, data, or security in real usage, or a
  PR-caused failure of required validation.
- **Important** — a violated repository rule, missing protection, or likely-rework gap with a
  concrete consequence that does not break the main path.
- **Decision** — the resolution is a product or scope choice only a human can make (contract shape,
  intentional behavior change, scope ownership). Never silently downgraded to a suggestion or
  inflated to a defect; it blocks READY TO MERGE until answered.
- **Suggestion** — optional improvement with evidence. Never blocks.

```markdown
---
pr: <number>
base: <base branch>
head: <head branch>
reviewed: <ISO timestamp>
verdict: <READY TO MERGE | NEEDS FIXES | REVIEW INCOMPLETE>
pass: <first review | re-review of <ISO date>>
scopes: [code, seams, ...]
publication: <verified GitHub comment/review URL | pending>
---

# PR Review: #<number> — <title>

## Outcome

<One concise paragraph explaining what the PR changes and the review result.>

## Validation

| Command | Result | Evidence |
|---|---|---|
| `<actual command>` | PASS / FAIL / NOT RUN | <decisive detail> |

## Prior Findings Resolution

<!-- Re-review only. One row per Critical/Important/Decision finding from the prior pass. -->

| Prior finding | Resolution | Evidence |
|---|---|---|
| <finding title> | RESOLVED / DISPUTED-UPHELD / STILL OPEN | <commit, `path:line`, or the disagreement evidence judged> |

## Decisions Required (<count>)

| Agent | Decision needed | Evidence | What it gates |
|---|---|---|---|
| `<agent>` | <the choice and its options> | `path:line` | <what cannot proceed until answered> |

## Critical Issues (<count>)

| Agent | Finding | Evidence | Required change |
|---|---|---|---|
| `<agent>` | <concrete defect and impact> | `path:line` | <smallest valid correction> |

## Important Issues (<count>)

| Agent | Finding | Evidence | Required change |
|---|---|---|---|

## Suggestions (<count>)

| Agent | Suggestion | Evidence | Why consider it |
|---|---|---|---|

## Strengths

- <Specific behavior or implementation choice supported by the review.>

## Verdict

**<READY TO MERGE | NEEDS FIXES | REVIEW INCOMPLETE>**

<What must happen next, or why the PR is ready.>
```

Rules:

- Every Critical or Important finding needs a concrete impact and file:line evidence.
- Omit the Prior Findings Resolution section on a first review; on a re-review it is mandatory and covers every prior Critical, Important, and Decision finding.
- Attribute findings to the agent that produced them; validation failures use `validation`.
- Keep suggestions genuinely optional. Never disguise a blocker as a suggestion or vice versa.
- Do not add generic praise, boilerplate checklists, confidence scores, or AI attribution.
- Write `publication: pending` before posting. After GitHub verification, replace it in the local report with the stable comment or review URL; downstream automation treats that URL as required delivery evidence.

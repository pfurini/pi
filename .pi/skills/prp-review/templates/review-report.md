# Review Report Contract

Write every review report in this shape. Omit empty finding rows, but keep all headings so humans and
downstream workflows can find the verdict and blocking categories reliably.

Severity bars — the aggregation maps every agent finding onto exactly one of these; the bar, not the
agent's own wording, decides the class:

- **Critical** — a reachable defect that breaks behavior, data, or security in real usage, or a
  change-caused failure of required validation.
- **Important** — a violated repository rule, missing protection, or likely-rework gap with a
  concrete consequence that does not break the main path.
- **Decision** — the resolution is a product or scope choice only a human can make (contract shape,
  intentional behavior change, scope ownership). Never silently downgraded to a suggestion or
  inflated to a defect; it blocks READY TO MERGE until answered.
- **Suggestion** — optional improvement with evidence. Never blocks.

```markdown
---
target: <pr #N | branch X vs base Y | range A..B | staged | working tree | files>
mode: <pr | local>
key: <review key, e.g. pr-123 or step label>
base: <base ref or SHA>
head: <head ref or SHA>
reviewed: <ISO-8601 timestamp with real time, never midnight-zeroed — archive suffixes derive from it>
verdict: <READY TO MERGE | NEEDS FIXES | REVIEW INCOMPLETE>
pass: <first review | re-review of <ISO date>>
scopes: [code, seams, ...]
publication: <verified GitHub comment/review URL | local | pending>
---

# Review: <target> — <title or step name>

## Outcome

<One concise paragraph explaining what the change does and the review result.>

## Validation

| Command | Result | Evidence |
|---|---|---|
| `<actual command>` | PASS / FAIL / NOT RUN | <decisive detail> |

## Polish Log

<!-- Local mode only, when the polish phase ran. One row per polish finding. -->

| Angle | Finding | Disposition |
|---|---|---|
| <reuse/machinery/efficiency/altitude> | <`path:line` — what disappeared> | APPLIED in <commit> / SKIPPED — <why> / CARRIED to review — <behavior-changing> |

## Prior Findings Resolution

<!-- Re-review only. One row per Critical/Important/Decision finding from the prior pass. -->

| Prior finding | Resolution | Evidence |
|---|---|---|
| <finding title> | RESOLVED / UPHELD / STILL OPEN | <commit, `path:line`, or the recorded human disposition judged> |

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

<What must happen next, or why the change is ready.>

## Resolution Log

<!-- Local mode only; appended by the apply cycle. One row per Critical/Important/Decision finding. -->

| Finding | Resolution | Evidence |
|---|---|---|
| <finding title> | APPLIED / ACCEPTED / DISPUTED / DEFERRED | <commit, accepted-risk rationale, disproving `path:line`, or tracking link> |
```

Rules:

- Every Critical or Important finding needs a concrete impact and file:line evidence.
- Omit the Prior Findings Resolution section on a first review; on a re-review it is mandatory and covers every prior Critical, Important, and Decision finding.
- Attribute findings to the agent that produced them; validation failures use `validation`, plan-fidelity checks use `plan`.
- Keep suggestions genuinely optional. Never disguise a blocker as a suggestion or vice versa.
- Do not add generic praise, boilerplate checklists, confidence scores, or AI attribution.
- Omit the Polish Log and Resolution Log outside local mode; in local mode the Resolution Log is appended by the apply cycle and verified by the next re-review.
- PR mode: write `publication: pending` before posting; after GitHub verification, replace it with the stable comment or review URL — downstream automation treats that URL as required delivery evidence. Local mode: `publication: local`, nothing is posted.

# Revise From Review — Fold a Review Report Into the Plan

Fold `/prp-plan-review` findings into an existing plan without regenerating it. The point of this workflow: fix-pass content (new mechanisms, new tasks, changed criteria) enters the plan through the same verification the original content earned in Phases 2–5.5 — content designed inside an unstructured fix pass drifts on every quality dimension, because nothing constrains it.

## Step 1 — Resolve inputs

1. Locate the plan and the review report (the request usually carries both; the report header names the plan path).
2. Read both in full, including the plan's Amendments section — earlier disposition tables may already cover some findings.

Done when: every finding in the report is listed with its severity and angle.

## Step 2 — Triage every finding

Build a disposition table before editing anything. Verify each finding against the actual source first — review agents over-flag by design, and a finding folded without verification imports its errors into the plan.

| # | Finding | Disposition | Evidence |
|---|---------|-------------|----------|

One disposition per finding:

- **accept-mechanical** — path or citation correction, missing Files-to-Change row, test addition, wording, task-pointer fix.
- **accept-design** — the fix requires new behavior, a new mechanism, or a new task.
- **needs-decision** — the fix depends on a scope change, a contract change, or a choice only the user can make (including every finding the review classed DECISION).
- **reject** — the finding is factually wrong or over-reach; the Evidence cell cites the disproving file:line.

Done when: every finding has a disposition, and every reject cites source evidence.

## Step 3 — Decisions before edits

Batch every needs-decision item into ONE user interaction, under Phase 5.5 rules (non-interactive runs keep them `[DECISION REQUIRED]` and the plan stays a DRAFT). A decision-dependent fix waits for its decision — folding it early bakes in a guess.

Done when: each needs-decision item is either answered or marked `[DECISION REQUIRED]` with its dependent fixes deferred.

## Step 4 — Apply by disposition class

- **accept-mechanical** → edit directly.
- **accept-design** → default to altitude (the Altitude rule in `references/task-block-format.md`): state the invariant the fix must guarantee, the seam to touch (symbol + file:line, verified in source now), and the falsifying test — the implementer designs the mechanism against real code. Specify mechanism internals only when several components must agree on the design; then verify every seam and pattern the design cites in source, exactly as Phase 2 would, and route any new public contract through Phase 5.5. A MIRROR instruction may only cite a pattern you just confirmed exists.
- **Descoping is a first-class outcome**: when a proper fix exceeds the phase's committed scope, narrow the acceptance criterion honestly, record the limitation, and defer the work to a named slice or follow-up. Half-designing it in prose is worse than either building it or deferring it.

Done when: every accepted finding maps to a concrete plan edit, and every new seam or pattern claim was verified in source.

## Step 5 — Re-verify the changed sections

Run the FINAL_VALIDATION groups from SKILL.md over the sections you touched (not the whole plan): INTERNAL_CONSISTENCY always; VALIDATION_COVERAGE for any new or changed criterion, test, or diagnostic; SOURCE_TRACEABILITY when scope moved.

Done when: every touched section passes its checklist.

## Step 6 — Record and hand off

1. Append one Amendments entry: date, the disposition table from Step 2, the sections changed, and the evidence for every reject.
2. Add a Lifecycle `Modified` entry.
3. Report to the user: dispositions by class, what was descoped or deferred, remaining `[DECISION REQUIRED]` items (the plan is a DRAFT while any remain), and the next step — re-run `/prp-plan-review`, telling it this is a re-review so it verifies the dispositions and attacks only changed or previously unreached surface.

Done when: the Amendments entry exists and the user has the report.

# Report Templates

- **Implementation Report** - written to `$PRP_DIR/reports/{plan-name}-report.md` in Phase 5.2.
- **Final user summary** - printed as the closing message in Phase 6.

## Implementation Report template

Use this exact structure: fill every `{placeholder}` and keep the section order.

```markdown
# Implementation Report

**Plan**: `$ARGUMENTS`
**Source Issue**: #{number} (if applicable)
**Branch**: `{branch-name}`
**Date**: {YYYY-MM-DD}
**Status**: {COMPLETE | PARTIAL}

---

## Summary

{Brief description of what was implemented}

---

## Assessment vs Reality

Compare the original investigation's assessment with what actually happened:

| Metric     | Predicted   | Actual   | Reasoning                                                                      |
| ---------- | ----------- | -------- | ------------------------------------------------------------------------------ |
| Complexity | {from plan} | {actual} | {Why it matched or differed - e.g., "discovered additional integration point"} |
| Confidence | {from plan} | {actual} | {e.g., "root cause was correct" or "had to pivot because X"}                   |

**If implementation deviated from the plan, explain why:**

- {What changed and why - based on what you discovered during implementation}

---

## Tasks Completed

| #   | Task               | File       | Status |
| --- | ------------------ | ---------- | ------ |
| 1   | {task description} | `src/x.ts` | ✅     |
| 2   | {task description} | `src/y.ts` | ✅     |

---

## Validation Results

| Check       | Result | Details               |
| ----------- | ------ | --------------------- |
| Type check  | ✅     | No errors             |
| Lint        | ✅     | 0 errors, N warnings  |
| Unit tests  | ✅     | X passed, 0 failed    |
| Build       | ✅     | Compiled successfully |
| Integration | ✅/⏭️  | {result or "N/A"}     |

---

## Files Changed

| File       | Action | Lines     |
| ---------- | ------ | --------- |
| `src/x.ts` | CREATE | +{N}      |
| `src/y.ts` | UPDATE | +{N}/-{M} |

---

## Deviations from Plan

{List any deviations with rationale, or "None"}

---

## Issues Encountered

{List any issues and how they were resolved, or "None"}

---

## Tests Written

| Test File       | Test Cases               |
| --------------- | ------------------------ |
| `src/x.test.ts` | {list of test functions} |

---

## Next Steps

- [ ] Review implementation
- [ ] Create PR: `gh pr create` (if applicable)
- [ ] Merge when approved
```

## Final user summary template

Sensible default: adapt to what actually happened, and drop the PRD block when the plan has no PRD source.

```markdown
## Implementation Complete

**Plan**: `$ARGUMENTS`
**Source Issue**: #{number} (if applicable)
**Branch**: `{branch-name}`
**Status**: ✅ Complete

### Validation Summary

| Check      | Result          |
| ---------- | --------------- |
| Type check | ✅              |
| Lint       | ✅              |
| Tests      | ✅ ({N} passed) |
| Build      | ✅              |

### Files Changed

- {N} files created
- {M} files updated
- {K} tests written

### Deviations

{If none: "Implementation matched the plan."}
{If any: Brief summary of what changed and why}

### Artifacts

- Report: `{expanded absolute path to $PRP_DIR/reports/{name}-report.md}`
- Plan archived to: `{expanded absolute path to $PRP_DIR/plans/completed/}` (only when the input plan already lives in the store)

{If from PRD:}
### PRD Progress

**PRD**: `{prd-file-path}`
**Phase Completed**: #{number} - {phase name}

| # | Phase | Status |
|---|-------|--------|
{Updated phases table showing progress}

**Next Phase**: {next pending phase, or "All phases complete!"}
{If next phase can parallel: "Note: Phase {X} can also start now (parallel)"}

To continue: `/prp-plan {prd-path}`

### Next Steps

1. Review the report (especially if deviations noted)
2. Create PR: `gh pr create` or `/prp-pr`
3. Merge when approved
{If more phases: "4. Continue with next phase: `/prp-plan {prd-path}`"}
```

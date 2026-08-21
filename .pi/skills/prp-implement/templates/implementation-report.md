# Implementation Report

**Plan:** `{absolute plan path}`
**Branch:** `{branch name}`
**Status:** `{COMPLETE | BLOCKED}`

## Outcome

{What now works and why it matters.}

## Validation

| Command or check | Result | Evidence |
| --- | --- | --- |
| `{actual command}` | `{passed | failed}` | {concise factual output} |

## Deviations and Decisions

{Only deviations from the plan, dispositioned review findings, and decisions downstream contexts must preserve, or "None."}

## Completion Gate

- **Plan tasks complete:** `{Yes | No}`
- **Acceptance criteria satisfied:** `{Yes | No}`
- **Unresolved blocker:** `{None | exact blocker and evidence}`
- **Recovery:** `{None | why it cannot be completed now and the concrete next action}`

## Intended Commit Scope

{The coherent outcome and changes included in the commit, or what should be committed after a blocker is resolved.}

## Delivery

- **Commits:** `{SHA and message for each delivery commit | Not created}`
- **Pull Request:** `{URL | Not opened}`
- **Base / Head:** `{base <- head | Not applicable}`
- **Source PRD:** `{absolute path and phase update | None}`
- **Tracked follow-ups:** `{None | human-visible GitHub issue links for actionable work outside this plan's scope}`

---

# Final User Summary

Print this as the closing chat message after the report is written; it is not written to disk. Adapt to what actually happened and omit non-applicable blocks.

## Implementation Complete

**Plan:** `{absolute plan path}`
**Branch:** `{branch name}`
**Status:** `{Complete | Blocked: concrete blocker}`

### Validation

| Check | Result |
| `{gate}` | `{pass | fail with cause}` |

### Changes

{One line: N files created, M updated, K tests written.}

### Deviations

{"Implementation matched the plan." | brief summary of what changed and why}

### Artifacts

- Report: `{absolute report path}`
- Pull request: `{URL | Not opened}`

{If from a PRD:}
### PRD Progress

**PRD:** `{path}` — phase {number} marked implemented. **Next phase:** {next pending phase | "All phases complete"}

### Next

{Review the PR; continue the next PRD phase via `/skill:prp-plan {prd-path}`; or the blocker's recovery action.}

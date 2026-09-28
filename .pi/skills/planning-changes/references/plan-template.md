# Plan template

A plan lives at `docs/plans/<slug>.plan.md`. Use the sections below in this order. Required sections always appear; a conditional section appears only when it has content. Replace every `<slot>`, so a saved plan holds no slot text. Review briefs and the handoff prompt cite these section numbers, so keep the numbering.

Contents: Structure (the plan skeleton), Task rules, Regression rule, Review history entry.

## Structure

```markdown
# <Outcome-oriented title>

<Opening paragraph, at most 100 words: what the plan delivers, its source document, what verified its claims, and which later phases exist.>

## 1. Authority and workflow

| Source | Role |
| --- | --- |
| This plan | The implementation contract. It overrides the source where Section 2 or Section 4 names a difference. |
| `<source document path>` | <What the implementer consults it for.> |
| `<ADR, spike record or rules file>` | <Its role.> |

<One sentence per workflow fact: how the plan was reviewed, and how it is implemented.>

## 2. Decisions

### 2.1 User rulings

| # | Ruling | Consequence |
| --- | --- | --- |
| R1 | <The ruling, dated.> | <What it changes in the tasks.> |

### 2.2 Source questions            (conditional: the source lists open questions)

| # | Status | Answer used |
| --- | --- | --- |
| <Q-id> | <Adopted recommendation / Resolved by Rn / Resolved by evidence / Deferred to phase N> | <The answer the tasks use.> |

### 2.3 Differences from the source  (conditional: any task departs from the source)

| Source item | This plan | Reason |
| --- | --- | --- |

### 2.4 Approvals

<Standing approvals: what the implementer may do without asking.>
<The actions that always need the user's explicit yes, as a list.>

## 3. Verified facts

<One paragraph: the start commit, the probe and baseline worktrees, and how tests ran.>

| Fact | Evidence |
| --- | --- |
| <A claim a task relies on.> | <`path:line`, a command with its result, or a row of Appendix A.> |

## 4. Scope

**In scope.** <One bullet per item, naming its task.>

**Out of scope.** <Items deferred to later phases or excluded.>

**Binding constraints.** <What stays untouched for every task.>

| Constraint | Exception in this plan |
| --- | --- |

## 5. Working setup

<Numbered steps: create the worktree, copy ignored files the check needs, install, record BASE, then run each affected suite three times and `./test.sh` once, one run at a time, each to a new output path.>

**Regression rule.** <This template's Regression rule, with the plan's suites and baseline paths filled in.>
<Environment facts the implementer meets before reading the tasks: hooks, trust dialogs, missing tools, shared checkouts.>

## 6. Tasks

### T0. Record the plan

Commit the source document and this plan on the feature branch. The handoff performs this task.

### T<n>. <Outcome>

**Changes.** <A `File | Change` table or short prose. Exact code appears only as a pointer to Appendix B.>

**Validation.** <Each command with its observable pass condition.>

**Commit.** `<message in the repository's format>`. <Lockfile, trailer or force-add notes, when they apply.>

<Stop conditions for this task, when it has any.>

## 7. Test plan

| Layer | What it proves | When it runs |
| --- | --- | --- |

<For each durable test: the mutation that makes it fail.>
<Conditional: a footprint or content check when the plan edits files another party owns, rerun after each merge.>

**Not proved by this plan.** <The claims no check here establishes.>

## 8. Risks

| Risk | Mitigation |
| --- | --- |

## 9. Done criteria

<Checkable bullets; each names the command or record that shows it.>

## 10. Later phases                  (conditional)

| Order | Item | Prerequisite |
| --- | --- | --- |

## Appendix A. Probe measurements   (conditional: a probe ran)

<Baseline and probe failure sets, totals, and each mutation check with its result.>

## Appendix B. Verified code        (conditional: a task reuses probe code)

<Each file verbatim as it passed the probe's checks, with its path.>

## Review history                   (appended by the Review branch)
```

## Task rules

- One task produces one commit. Order tasks by dependency, so each commit leaves the check passing.
- A task whose tests are expected to fail names the failure and the task that clears it.
- Pass conditions compare test runs against the baseline from Section 5 by the Regression rule below, never "all tests pass".
- A command appears in a task only as the probe ran it: exact flags, working directory and side effects. A command the probe could not run says so, and the task first runs the check that proves the command works.
- A precondition on mutable state (temporary files, running sessions, another repository's `HEAD`) is a check with a fallback, never a fact.
- A task that deletes files deletes only paths the plan or an earlier task recorded.
- A task that edits the live setup (configuration in the user's home, the shared checkout, a running service) comes with a rollback. The rollback works without the capability it rolls back, undoes steps in reverse order, and verifies each step before the next.
- A live check (a real session or the live setup) leaves evidence a command can find: a unique marker in its input, and the command that locates the one record holding it.
- A launch command names every flag that selects the mode it checks, such as fenced or unfenced.
- A backup refuses an existing destination, and its hash must equal the original's before the original changes.
- A commit in the shared checkout starts from an empty index and stages only the task's paths. A revert checks that its staged paths equal the reverted commit's.
- Removing a worktree first lists its expected status, confirms no process runs inside it, and inventories its ignored files. `--force` applies only when all three match.

## Regression rule

Every task that changes code applies this rule after its change:

1. Run each affected suite once and diff it against baseline run 1. The candidate runs at least as many tests as the baseline, plus the tests the task adds.
2. A failure absent from baseline run 1 triggers two more candidate runs. It is tolerated only when baseline run 2 or 3 also shows it, and the candidate fails it in no more of its three runs than the baseline did in its three. Otherwise, stop and ask.
3. For suites the diff script does not cover, compare the failing-test identities in the full `./test.sh` log with the baseline log. Rerun once, and stop and ask on any identity that recurs.

Run suites one at a time: suites run in parallel produce load-induced failures.

## Review history entry

Append one entry per review pass, newest last:

```markdown
### Pass <n>: <date>, reviewer model <model from the agent definition>

| Angle | Verdict |
| --- | --- |

| # | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| <n> | <One line.> | <Accepted / Rejected / Ruled Rn / Deferred to phase N> | <Source citation; required for Rejected.> |

Sections changed: <list>. Changes made after this pass and not yet reviewed: <list or "none">.
```

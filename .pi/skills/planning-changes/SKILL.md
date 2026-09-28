---
name: planning-changes
description: Writes evidence-grounded implementation plans into this repository's docs/plans/, reviews them with plan-reviewer agents, and hands them off to a fresh implementation session. Use when the user asks to plan a change, phase or port from a report, PRD, issue or description; to review or re-review a plan; or to commit a plan and write a handoff prompt.
argument-hint: "<source document | plan path> [review | handoff]"
---

# Planning changes

This skill produces a plan under `docs/plans/` that a fresh agent can implement without this conversation. The plan is a contract. Every claim carries evidence, every user decision is recorded, and every task has an observable pass condition. The Plan and Review branches edit only the plan and disposable probe worktrees; only the Handoff branch commits.

## Route the request

| The request | Branch |
| --- | --- |
| Names a source to plan from: a report, PRD, issue, handoff or description | Plan, then Review |
| Names an existing `docs/plans/*.plan.md` to review, re-review or check | Review |
| Asks to commit a plan, or for a prompt for a new implementation session | Handoff |

## Rules for every branch

- A plan lives at `docs/plans/<slug>.plan.md`, with a kebab-case slug named after the outcome. A later phase of the same source uses `<slug>-phase<N>`.
- Probes and baselines run in disposable worktrees: `git worktree add --detach /tmp/<slug>-<role> <commit>`. Other sessions share the main checkout, so run only read-only commands there.
- Record every temporary path you create, and delete only recorded paths. Before `git worktree remove`, run `git status --short --ignored` in the worktree, and confirm with `lsof -d cwd 2>/dev/null | grep -F <path>` that no process runs inside it.
- Ask the user in one `ask_user_question` round per decision point. Put the recommended option first, and state each option's consequence.

## Plan

### P1. Read the source

Read the source in full, with every document it names as authority: ADRs, spike records, earlier plans and their results. List four things:

1. the goal and scope;
2. the decisions already made;
3. the open questions, each with the source's recommendation;
4. every claim a task will rely on, tagged `proven` (with its evidence), `unverified` or `stated`.

Done when: every claim a task will rely on is on the list with its tag.

### P2. Cut the phase

Plan one independently deliverable phase. When the source spans several, choose the smallest phase that delivers a working outcome and unlocks the rest. Name the rest as later phases, each with its prerequisite.

Done when: the phase has a one-sentence outcome, and every source item sits in this phase or a named later one.

### P3. Verify in source

Check each claim against its ground truth: the code, other repositories, configuration and installed versions. Use TokenSave first where `.tokensave/` exists, then read the file. Re-derive counts, paths and line numbers; a copied number is an unverified claim.

Done when: each claim cites a `path:line` or a command result, or stays `unverified` with the task that will verify it.

### P4. Brief and decide

Present a brief before any probe or plan text, while the design is still cheap to change. The brief holds, in this order:

1. what exists today, with its P3 evidence;
2. the proposal, one numbered point per design choice;
3. a table of the real alternatives: what each gains, what it loses, and when it fits;
4. the rough size, in tasks.

Then sort every open item into one of two classes:

- **User decision:** it changes scope, a public contract, a safety boundary, files another party owns, or an expensive choice to reverse.
- **Planner default:** it is reversible and has an evidence-backed choice. Record the choice and its reason in the plan.

Ask all user decisions in one round, right after the brief. Adopt the source's recommendation on an uncontested item, and mark it adopted so the user can override it.

Done when: the user has seen the brief, and every open item is ruled, adopted with its reason, or deferred to a named later phase.

### P5. Probe

Run this step when a task changes code, build setup or tests; skip it for a plan that changes none of them. Reading code misses interactions that only the test suite shows, so apply the ruled design for real. Create a probe worktree at the plan's start commit, next to a clean baseline worktree at the same commit.

1. Run the repository check and every test suite the change can reach, one suite at a time; suites run in parallel produce load-induced failures. Run each baseline suite three times, so flaky tests show up before they read as regressions. For a vitest package, run `node ${PI_SKILL_DIR}/scripts/failing-tests.mjs run <worktree> <package-dir> <out.json>`, with a new output path each time. It uses `./test.sh` isolation. Then run `node ${PI_SKILL_DIR}/scripts/failing-tests.mjs diff <baseline.json> <probe.json>`. It lists new, fixed, unchanged and not-run failures, and exits 1 on any new failure. Judge the diff by the regression rule in `plan-template.md`, which the plan also carries.
2. Run every command a task will prescribe, with its exact flags and working directory, and note what it writes. Some commands need the live setup, credentials or the user. Mark each of those `unrun` in its task, and give the check the implementer runs first.
3. For each durable test the plan adds, break the code it guards and confirm the test fails. Then restore the code and confirm the test passes.
4. Write each precondition on mutable state as a check with a fallback: temporary files, running sessions, installed tools, another repository's state. That state will differ by implementation time.

A probe result that contradicts a ruling or the source becomes a new decision; ask it in one round before writing the plan. Probe code enters the plan only verbatim, in Appendix B, after its checks passed.

Done when: the baseline ran three times, every prescribed command ran or is marked `unrun`, the baseline-versus-probe failure diff is recorded, and every new test failed on its mutation.

### P6. Write the plan

Read `@${PI_SKILL_DIR}/references/plan-template.md` now, then write the plan in its structure.

Done when: no slot text remains, Section 2.3 holds every difference from the source, every Section 3 fact has evidence, and every task has changes, validation with observable pass conditions, and a commit message.

### P7. Review

Run the Review branch on the new plan as a first pass.

## Review

### R1. Resolve the pass

Read the plan and its source in full. The plan's Review history sets the pass type: no entry means a first pass, and any entry means a re-review. For a re-review, list the sections changed since the last pass.

Find the `plan-reviewer` definition the way pi-subagents does: the first of `<cwd>/.pi/agents/`, `<cwd>/.agents/agents/` and `~/.pi/agent/agents/` that holds an agent named `plan-reviewer` wins. Note its `model`; the user maintains the reviewer model there. Pass a `model` override only when the user names a model in this request.

Done when: the pass type, the changed sections and the effective reviewer model are known.

### R2. Dispatch

Read `@${PI_SKILL_DIR}/references/review-briefs.md` now. Dispatch one `plan-reviewer` per angle, all in one message, with `run_in_background: false`. Each prompt is the shared context block plus one angle brief. Never merge angles into one agent, because a reviewer holding several angles stops at its first blocker.

Done when: every dispatched angle has returned its verdict line.

### R3. Verify the findings

Check each finding against source before acting on it; reviewers over-flag, and some cite stale lines. Merge duplicates across angles. Give each finding one disposition:

- **Accepted:** its evidence holds.
- **Rejected:** its evidence fails, or it misreads a rule. Cite the disproving source.
- **Decision:** resolving it needs the user.

When an accepted finding changes code, a test or a command, rerun the affected probe step before editing the plan.

Done when: every finding has a disposition, every rejection cites evidence, and every accepted code change passed its probe step.

### R4. Decide and apply

Ask the decision findings in one round. Apply the accepted findings and the new rulings to the plan. Append a pass entry to the Review history, in the format that `plan-template.md` defines.

Done when: the plan holds every accepted change and ruling, and the pass entry lists every finding with its disposition.

### R5. Report

Tell the user the verdict per angle, the counts by disposition, what changed, each rejection with its reason, and the sections left unreviewed by this pass. Run one re-review after a first pass that had a blocking finding or a decision that changed tasks. Run further passes only when the user asks. A plan is ready for Handoff once its last pass has no open blocking finding and no open decision.

Done when: the user has the report, and the next step (re-review or Handoff) is stated.

## Handoff

### H1. Check readiness

Confirm that the plan's last review pass has no open blocking finding or decision, or that the user accepts the plan as it is. Record the main checkout's branch, head and local changes, using read-only commands.

Done when: readiness is confirmed, and the main checkout state is recorded.

### H2. Commit the plan

1. Create the implementation worktree: `git worktree add -b <feature-branch> /tmp/<slug> <target-branch>`. Take the branch name from the plan, or use `feat/<slug>`.
2. Make the worktree pass the commit hook. Install dependencies, and copy from the main checkout the ignored files the repository check needs; one run of the check names them.
3. Copy the plan, and the source document when git does not track it yet, into the worktree. Confirm each copy is byte-identical, then commit them as the plan's T0.

Done when: T0 exists on the feature branch, and the commit hook passed.

### H3. Write the handoff prompt

Read `@${PI_SKILL_DIR}/references/handoff-template.md` now and fill it. Take every value from this session's verified state: paths, hashes, the start commit, rulings, approvals and environment facts. Save the prompt to `/tmp/<slug>-handoff-prompt.txt`, and show it in a `text` code block.

Tell the user where to start the new session, and which line grants commit authority.

Done when: no slot remains, the file exists, and the user has the prompt.

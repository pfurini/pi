# Review Workflow

Review the target change through specialist agents, then either publish one evidence-based summary
(PR mode) or drive the human-gated apply cycle (local mode).

## 1. Resolve the target and review key

Accept any of: a PR number or URL, a branch (against an explicit or inferred base), a commit range
(`A..B` / `A...B`), `staged`, `working` (uncommitted tree), or file paths. With no argument, use the
current branch's open PR if one exists; otherwise review the current branch against its merge base.

Two modes follow from the target:

- **PR mode** — the subject is a pull request. Resolve it with `gh pr view` / `gh pr list`; read its
  title, body, author, state, base, head, files, reviews, comments, and complete diff. Stop when the
  PR is merged; warn before reviewing a closed PR; review a draft normally but post a comment rather
  than approving or requesting changes. Never move the current worktree for review: inspect PR refs with
  `gh pr diff`, `gh api`, and `git show <ref>:<path>`. The review never edits anything in PR mode.
- **Local mode** — everything else: the step-close flow. The working tree is the user's own work;
  the polish phase and apply phase are available.

**Review key** — the identity that convergence, archiving, and re-review detection hang off:
`pr-{NUMBER}` in PR mode; in local mode a caller-supplied label (e.g. the plan step name), else the
current branch name. Successive step cycles on one branch need distinct labels — reusing a key makes
this pass a re-review of that key, not a fresh review. A request that identifies itself as a
re-review without naming a label resumes the **most recent local-mode key** whose reviewed range
covers the target — do not fall back to the branch name and split one convergence thread across two
keys. When prior reports under *other* keys overlap the target range, read them as verified inputs
(their Resolution Logs count as prior findings to verify), never re-litigate them.

Capture the diff for the resolved scope (`gh pr diff`, `git diff <base>...HEAD`, `git diff
--staged`, `git diff`, or the named files) and state target, mode, and key out loud.

## 2. Gather context

- Read repository guidance at the root and in every directory the diff touches, plus the full
  changed files and directly relevant tests and precedents.
- **Intent.** Find what the change is supposed to do: matching implementation reports, completed
  plans, or issue artifacts under `$PRP_DIR`; otherwise the PR description, linked issue, or spec;
  otherwise infer it from the diff and say so. Treat documented deviations as context, not automatic
  defects. When a matching plan exists, verify delivery against its Acceptance section: every
  criterion is delivered by the change or explained by a documented deviation. Unexplained missing
  scope is a finding attributed to `plan` — Important by default, Critical when the PR or report
  claims that criterion complete.
- **History.** `git blame` / `git log -p` the touched lines — a shape history shows is intentional
  is context every agent needs; note prior PRs on these files and their review comments, and whether
  the change honors guidance written in the in-code comments it edits.
- If `$PRP_DIR/reviews/{key}-review.md` already exists, this pass is a **re-review**: read that
  report (including its Resolution Log) and any implementation-report dispositions, then apply the
  Re-reviews section below.
- If the only matching artifact is under a legacy `.claude/PRPs/` path, stop and tell the user to
  run the PRP home-store migration.

## 3. Polish (local mode only)

Behavior-preserving cleanup before judgment, so the review fan-out sees the final shape instead of
noise that is about to change. Skip when the user says skip or the diff is trivial.

1. Dispatch `code-simplifier` on the diff: one instance covering all four angles for a small or
   medium diff; for a large diff (roughly 400+ changed lines), four parallel instances, one assigned
   angle each (reuse, machinery, efficiency, altitude).
2. Present the findings inline in summary form — one line each: angle, `file:line`, what disappears.
   The user picks what to apply; do not auto-apply.
3. For each approved finding: verify the claimed primitive or simpler form against the source, apply
   the fix, and note any finding whose fix would change observable behavior — those are not polish;
   carry them into the review fan-out instead.
4. Re-run the focused validation for the touched behavior, then commit the polish via
   `/skill:prp-commit`. The polish commit joins the reviewed range.

Non-interactive runs skip the gate and the apply: carry polish findings into the report as
suggestions instead.

## 4. Run repository validation

Discover authoritative checks from repository guidance, package scripts, task runners, and CI.
Run the applicable type check, lint, tests, build, and any focused validation the changed behavior
requires. Do not invent a generic command merely to fill a category.

Record the exact command, result, and decisive output. A missing or inapplicable check is `not run`,
not a pass. Distinguish a change-caused failure from an unrelated or pre-existing failure when
evidence allows; otherwise report the uncertainty.

## 5. Select scopes

Always select `code` and `seams`. Add other scopes when the user or calling workflow names them,
plus the one stakes exception below:

| Scope | Agent | Focus |
| --- | --- | --- |
| `code` | `code-reviewer` | Correctness, repository rules, high-confidence defects |
| `seams` | `seam-analyzer` | Missing types, counterpart drift, bypassed boundaries |
| `simplify` | `code-simplifier` | Avoidable machinery across reuse, machinery, efficiency, altitude |
| `tests` | `pr-test-analyzer` | Behavioral coverage, regression protection, added-test quality |
| `comments` | `comment-analyzer` | Accuracy and long-term value of changed comments |
| `errors` | `silent-failure-hunter` | Swallowed failures, fallbacks, and actionable errors |
| `types` | `type-design-analyzer` | Invariant expression and enforcement in changed types |
| `docs` | `docs-impact-agent` | Stale or missing user and contributor documentation |
| `security` | `security-reviewer` | Reachable exploit paths with cross-layer verification |
| `arch` | `architecture-reviewer` | Dependency direction, boundaries, structure that compounds |

In local mode the simplification dimension runs as the polish phase; add the `simplify` scope to the
fan-out only in PR mode (advisory) or when polish was skipped. Add `security` unrequested when the
diff touches input handling, auth, secrets, spawned processes, or network surface — stakes beat
scope minimalism. For a tiny, low-stakes diff, the core scopes alone are enough; when unsure, run
the extra scope.

`all` adds every optional scope. Explicit `code` or `seams` is redundant but valid. Ignore
`--agents`; it exists only so older callers still receive the new default review.

## Re-reviews

A re-review is any pass where the canonical report already exists for this key. A fresh full-depth
attack on the whole target would re-litigate settled ground and keep the finding count high forever;
a re-review instead:

1. **Verifies prior findings.** Every prior Critical, Important, and Decision finding gets a
   resolution: RESOLVED (cite the commit and evidence), UPHELD (a recorded human disposition —
   accepted risk, deferred with tracking, or an evidence-backed dispute — stands; judge the record,
   and re-open only when new evidence defeats it), or STILL OPEN. A finding RESOLVED in any earlier
   pass that still holds stays RESOLVED — do not invent hybrid labels.
2. **Attacks only new ground at full depth**: commits since the previously reviewed head and areas
   the prior pass did not reach. Re-open settled findings only on new evidence.
3. **Reports convergence honestly.** A re-review that finds nothing new says so — finding count is
   not review quality.

**Re-review dispatch economy.** The "agents are the only path for judging the code" rule binds
first-pass judgment of new code; verifying already-reviewed ground is orchestrator work. On a
re-review: dispatch the mandatory pair scoped to the new ground; add optional scopes only when the
new ground implicates them (do not re-run the full first-pass fan-out by default); and when the new
ground is docs-only or trivially mechanical (applied fixes matching the prior findings' prescribed
corrections), verify inline and state in the report that no agents were dispatched and why. Polish
also runs only on new, not-yet-polished work — ground the prior pass already judged is never
re-polished.

Prepend this line to every agent brief: "Re-review pass: prior findings and their dispositions are
in the prior review report and its Resolution Log. Verify the ones relevant to your focus, attack
commits after <previously reviewed head SHA> and previously unreached areas at full depth, and
re-open settled findings only on new evidence."

## 6. Launch reviewers

Dispatch every selected agent in parallel when capacity permits, or sequentially when it does not.
Every selected role remains required; wait for all of them before aggregation.
All agents are advisory and must not modify files or post their own PR comments.

Prepend to every brief: the target and its base/head (or range), the intent summary from step 2, a
one-line validation summary that names any pre-existing failure — agents must be able to distinguish
a broken baseline from change-caused breakage — and, on a re-review, the scoping line from the
Re-reviews section.

When spawning each subagent:

**code-reviewer**:
> Review <target> against its actual base for reachable behavioral defects and explicit repository-rule violations. Read direct callers and consumers beyond the diff. Report only causal findings with concrete evidence and file:line locations. Do not modify files, commit, or post comments.

**seam-analyzer**:
> Analyze <target> for missing types at seams. Leave the diff to inspect direct counterparts of changed payloads, wire formats, persisted or resumed values, IPC/FFI and cross-language boundaries, syntax forms, validators, and synchronized enumerations. Enforce the two-sided evidence bar and documented carve-outs. Do not modify files, commit, or post comments.

**code-simplifier** (PR mode or skipped polish):
> Review <target> for avoidable machinery across all four angles — reuse, machinery, efficiency, altitude. Establish the required outcome and invariant, and report only when evidence proves a smaller or existing primitive preserves the behavior. Do not modify files, commit, or post comments.

**pr-test-analyzer**:
> Map changed behavior in <target> to existing unit, integration, and end-to-end assertions. Report gaps with a plausible faulty implementation that current tests allow and the smallest behavioral test that would catch it, and added tests that create false confidence. Do not modify files, commit, or post comments.

**comment-analyzer**:
> Verify comments and docstrings changed by <target> against actual code, contracts, and direct consumers. Report only materially false prose, a concrete maintenance trap, or missing durable knowledge that code and types cannot express. Do not modify files, commit, or post comments.

**silent-failure-hunter**:
> Trace changed failure and recovery paths in <target>. Report only reachable failures that become indistinguishable from success or lose evidence needed by the owner who can act; respect legitimate probes, retries, fallbacks, and propagation. Do not modify files, commit, or post comments.

**type-design-analyzer**:
> Analyze new or modified types in <target> for meaningful invariants they fail to enforce. Report only reachable invalid states with a concrete downstream consequence and the smallest proportional enforcement point. Do not modify files, commit, or post comments.

**docs-impact-agent**:
> Review repository documentation affected by <target>. Report only materially false guidance or missing instructions required to discover, use, operate, migrate, or maintain changed public behavior. Determine this repository's real documentation surfaces and authoritative sources; do not treat steering files as changelogs. Do not modify files, commit, or post comments.

**security-reviewer**:
> Review <target> for reachable security defects: auth bypass, injection, unsafe output, missing boundary validation, secret exposure, unsafe process or filesystem use. Verify compensating layers by reading them before assigning severity, and report only concrete exploit paths. Do not modify files, commit, or post comments.

**architecture-reviewer**:
> Review <target> for structure that compounds: dependency direction, circular dependencies, boundary violations, god modules, scattered responsibilities, cross-module state modeling, abstraction timing. Prioritize by evolution impact and name the smallest restructure. Do not modify files, commit, or post comments.

## 7. Aggregate without re-reviewing

Read `../templates/review-report.md` before writing. Synthesis is the product — raw agent output is
material, not the report:

1. **Dedup.** The same `file:line` flagged by several agents becomes one finding; note the angles.
2. **Reconcile cross-cutting.** For each finding, ask whether another layer or lens neutralizes or
   amplifies it (a writer-side gap covered by the render layer; a "missing test" already covered by
   an integration test). Verify the other layer by reading it before adjusting — never assume.
3. **Confidence gate.** Drop findings that cannot be confirmed real: pre-existing issues the change
   does not touch or worsen, linter/typecheck-catchable issues, findings on unmodified lines,
   changes git history shows are intentional, and rules explicitly silenced in code. When an
   agent's evidence is short of confirming the finding triggers, verify it yourself or drop it.
4. **Classify** every surviving finding against the template's severity bars — the bar decides, not
   the agent's wording. A finding whose resolution is a product or scope choice only a human can
   make is a Decision: list it under Decisions Required as a question for the user, not a correction
   for the implementer.
5. Keep specific strengths — accurate praise makes the rest trusted. Do not invent findings, raise
   severity without evidence, or perform another code review during aggregation.

Verdict rules:

- `READY TO MERGE`: no Critical, Important, or open Decision findings, and all required validation passed. A prior finding verified RESOLVED or UPHELD in Prior Findings Resolution is not open.
- `NEEDS FIXES`: at least one Critical or Important finding, or a change-caused required validation failure.
- `REVIEW INCOMPLETE`: required validation or decisive evidence could not be obtained, or only open
  Decisions remain — there is nothing to fix, but a human choice gates the judgment.
- Suggestions, including every `simplify` finding, never block by themselves.

Write the report to the expanded absolute path `$PRP_DIR/reviews/{key}-review.md`. If that path
already exists, archive it first: move it to `{key}-review.{reviewed-timestamp}.md` in the same
directory, taking the full timestamp (date plus time) from the old report's `reviewed` field —
same-day passes must not collide. Per-pass history is what convergence across review rounds is
measured against — never delete or overwrite a prior pass.

## 8. Deliver

**PR mode** — publish to GitHub:

Post the complete, unabridged canonical report with `gh pr comment` by default. Use the same
complete report body with `gh pr review --approve` only when `--approve` was explicitly requested
and the verdict is `READY TO MERGE`. Use `gh pr review --request-changes` when explicitly requested
or when the user explicitly asked the skill to submit blocking findings as a formal review. Never
formally approve or request changes on a draft.

Read the PR back to verify the comment or review exists and capture its stable URL. Replace
`publication: pending` in the local canonical report with that URL, then re-read the report and
GitHub state to verify both point to the same publication. Corrections flow through
`/skill:prp-implement review`, not through this skill.

**Local mode** — the apply cycle:

Set `publication: local`. Present the report summary inline: verdict, validation, and every finding
as one line (severity, agent, `file:line`, what and why). The user decides per finding — apply,
accept the risk, defer to a tracked follow-up, or dispute; propose applying every Critical and
Important finding as the default. Decisions
Required go to the user as questions first; their answers may reclassify or dismiss findings.

For each approved finding, in severity order:

1. Re-verify the finding's evidence at the cited source — review agents over-flag by design, and an
   applied false positive is worse than a skipped true one.
2. Apply the smallest correction from the finding; stay inside the finding's scope.
3. Run the finding's focused validation.

A finding that fails re-verification is recorded as disputed with the disproving evidence, not
applied. After all edits, re-run the project gate from step 4, then commit via `/skill:prp-commit`.

Append a **Resolution Log** to the canonical report — one row per Critical/Important/Decision
finding: APPLIED (commit), ACCEPTED (the user accepts the risk — record why), DEFERRED (where it is
tracked), or DISPUTED (disproving evidence). ACCEPTED, DEFERRED, and DISPUTED are settled human
dispositions: the next re-review verifies they were recorded and they no longer block the verdict
unless new evidence re-opens them.

Non-interactive runs stop after the report — never apply without the human gate.

## 9. Report to the user

Return the target, mode, and key; the verdict; finding counts by class (critical / decision /
important / suggestion); the validation summary; selected scopes; polish summary when it ran; the
absolute report path; and the publication URL (PR mode) or apply-cycle outcome (local mode). Name
the next step: open Decisions go to the user; PR-mode `NEEDS FIXES` goes to `/skill:prp-implement
review` with this report; local-mode findings resolve through the apply cycle, then re-run this
skill with the same key until the verdict is `READY TO MERGE`.

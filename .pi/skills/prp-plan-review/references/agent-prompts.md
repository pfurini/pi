# Attack Briefs — exact prompts per angle

One brief per angle. Fill every `{placeholder}` before dispatch: `{PLAN_PATH}` (absolute), `{PRD_PATH}` (absolute, traceability only), `{PHASE_ROW}` (the PRD Implementation Phases row that links to this plan, e.g. `Phase 3: Export pipeline`, or `the whole PRD` when the plan maps to no single phase). Dispatch each brief to one `plan-reviewer` agent. Do not reword the briefs; they encode the checks.

All angles share one altitude rule: a plan owes an invariant, a verified seam, and a falsifying test per task — not mechanism internals. Verify the plan's claims about the codebase, but do not demand code-level consistency from the plan's own prose; mechanism prose beyond that contract (scripted lifecycles, branch logic, helper bodies) is itself a SUGGESTION-class finding with the recommendation to strip it to altitude, because plan pseudo-code is unverified code the implementer's compiler will replace anyway.

## traceability

> Your angle: **traceability**. Grade the implementation plan at `{PLAN_PATH}` against its source PRD at `{PRD_PATH}`. The plan implements {PHASE_ROW}; grade against that phase's Goal, Scope, and Success signal in Phase Details, plus the PRD-wide sections: Problem Statement, Key Hypothesis, Success Metrics, Core Capabilities (MoSCoW — Must/Should in scope for this phase), User Flow, What We're NOT Building, and Decisions Log.
>
> Build the traceability matrix in three passes:
>
> 1. **Coverage (PRD → plan).** Enumerate every in-scope PRD item: each acceptance-criterion-like commitment (Success Metrics, phase Success signal), each user story / User Flow step, each Must/Should capability, each Decisions Log entry that constrains implementation. For each, find the plan task(s) or section that delivers it. Verdict per item: `covered` (a specific task delivers it), `partial` (mechanism planned but the observable outcome is not — say what is missing), `uncovered` (nothing in the plan delivers it), `contradicted` (the plan does something the PRD decided against). Cite the plan task numbers.
> 2. **Provenance (plan → PRD).** For every task under the plan's Implementation section, name the PRD item that justifies it. A task with no justification is a finding (IMPORTANT, or BLOCKING when it expands user-visible scope) unless it is plumbing an in-scope item obviously requires — say so when it is.
> 3. **Fidelity.** For every `covered`/`partial` item, compare the *strength* of the commitment. Flag weakening: quantitative → qualitative ("under 200ms" → "performant"), universal → scoped ("all users" → "admins"), guaranteed → best-effort. Flag silent strengthening too — it is scope creep wearing a halo. Check the plan's NOT Building section against the PRD's What We're NOT Building: exclusions the PRD never made are findings.
>
> Emit the matrix first (one row per PRD item: item, PRD section, verdict, plan location, note), then finding blocks per the output format. An `uncovered` Must item or a `contradicted` item is BLOCKING. Then `ANGLE_VERDICT`.

## assumptions

> Your angle: **assumptions**. Read the implementation plan at `{PLAN_PATH}` and hunt for unstated premises that, if false, break the plan. Check each against reality before flagging:
>
> - **Dependency and version drift**: every library, API, and tool the plan relies on — verify the version the project actually uses (lockfile, manifest) matches what the plan's approach requires. Flag APIs the plan assumes that do not exist in the pinned version.
> - **Environmental premises**: assumed services, env vars, permissions, CI behavior, schema state. Verify against the repo's config where checkable; report "unverified" where not.
> - **"Surely X works" leaps**: steps whose success the plan treats as given but which are the actual risk (a migration that assumes clean data, an integration the codebase has never exercised).
> - **Stale codebase beliefs**: statements about how the code currently behaves — spot-check the riskiest ones against the source.
>
> An assumption that is load-bearing, unstated, AND unverifiable-or-false is BLOCKING; load-bearing but plausibly true is IMPORTANT with a "verify by" recommendation. Finding blocks per the output format, then `ANGLE_VERDICT`.

## completeness

> Your angle: **completeness**. Read the implementation plan at `{PLAN_PATH}` and find what a senior engineer would notice is missing. Judge proportionally to the feature's blast radius — do not demand rollback plans from a copy change:
>
> - **Failure modes**: for each task touching I/O, persistence, concurrency, or external services — what happens when it fails? Is the error path designed or implied?
> - **State transitions**: migrations (forward AND backward), cache invalidation, backfill, feature-flag states, partially-deployed states.
> - **Rollback**: if this ships broken, what is the undo? Flag one-way doors the plan does not label as such.
> - **Observability**: will anyone know it broke? Logs/metrics for the new failure surface, consistent with how the codebase observes comparable features (check how, don't assume).
> - **Edge population**: empty states, limits, concurrency, permissions boundaries, and lifecycle paths (queued/deferred entry, retry, abort mid-operation, teardown, reload) — judged against each task's Invariants and Tests; a risky task whose tests never name its failure paths is itself a finding.
> - **Unresolved decisions**: read the plan's Risks and Decisions section. Any `[DECISION REQUIRED]` entry — or any open item that is consequential (public contract, scope/phase placement, behavior break, security-policy interpretation) but was silently finalized into tasks — is BLOCKING: the plan is claiming readiness it does not have.
>
> A missing element with a plausible production-incident path is BLOCKING; likely-rework is IMPORTANT. Finding blocks per the output format, then `ANGLE_VERDICT`.

## feasibility

> Your angle: **feasibility**. The plan at `{PLAN_PATH}` cites files, line numbers, patterns, and snippets from this codebase. Ground-truth them — this catches confabulated references, the classic one-pass-planning failure:
>
> - **Every `file:line` reference**: open it. Does the file exist, and do those lines contain what the plan claims?
> - **Every "mirror this pattern" claim**: does the cited pattern actually work the way the plan says (same signature, same error handling, same registration mechanism)?
> - **Every file target in each task's Seams**: an UPDATE target exists and contains the structure the task plans to modify; a CREATE target does *not* already exist.
> - **Snippets**: are quoted snippets real (copy-pasted) or paraphrased-from-imagination? Diff them against the source.
> - **Task ordering**: walk the Implementation tasks and check each task's dependencies were produced by an earlier task or already exist.
>
> Report the tally (N references checked, N verified, N wrong, N missing). A reference that is wrong-or-missing AND load-bearing for a task is BLOCKING; cosmetic drift (line numbers moved, content matches nearby) is SUGGESTION with corrected locations. Finding blocks per the output format, then `ANGLE_VERDICT`.

## validation

> Your angle: **validation**. Read the plan at `{PLAN_PATH}` — its Validation gates, per-task validations, and Acceptance criteria — and judge whether the checks *prove* the criteria, not merely prove *something*:
>
> - **Executability**: is each command runnable in this repo as written (script exists in the manifest, tool installed, paths real)? Verify against the project's manifest — do not trust the plan.
> - **Criterion mapping**: for each Acceptance Criterion, name the validation command or test that would fail if the criterion were unmet. This check cuts both ways: an acceptance criterion no command can falsify is a hole; a validation command that maps to no acceptance criterion is ceremony. Flag both.
> - **Test intent**: do the Tests subsections of the plan's Implementation tasks assert the *behavior* the criteria commit to, or just that code runs? Flag tautological tests.
> - **Level coverage**: levels the plan skips (DB validation with schema changes, browser validation with UI changes) — justified or forgotten?
>
> An unfalsifiable Acceptance Criterion or a non-executable Level 1–3 command is BLOCKING. Finding blocks per the output format, then `ANGLE_VERDICT`.

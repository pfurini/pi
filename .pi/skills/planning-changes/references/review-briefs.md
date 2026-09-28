# Review briefs

Each `plan-reviewer` prompt is the shared context block followed by exactly one angle brief. Fill every `<slot>` from facts you verified in this session. Keep the briefs' wording: they encode the checks.

## Angle selection

| Pass | Angles |
| --- | --- |
| First pass | All six: traceability, assumptions, completeness, feasibility, validation, safety. |
| Re-review | All six, each with the re-review line in the shared block. |
| The request names angles | Exactly the named angles. |
| The plan has no source document | Skip traceability, and say so in the report. |

## Shared context block

```text
Today is <date>. Adversarial plan review, one angle: <ANGLE IN CAPITALS>. Report findings only; never edit any file and never commit.

Repository: <repository path> (branch <branch>, head <short hash>). <When the repository has .tokensave/: It has .tokensave/; use the TokenSave tools first for code discovery, then read the source.>

Artifacts:
- Plan under review: <plan path>. Read it in full, including its appendices.
- Source it traces to: <source document path>. The plan overrides the source only where its Section 2 or its Section 4 exceptions say so.
- <Each ADR, rules file, script and other repository the plan cites, by path.>
- <Each probe worktree that still exists, marked read-only, with what it holds.>

User rulings (do not re-open them; attack only how the plan executes them): <R1 to Rn, one clause each>.

<Re-review only: Re-review pass. The plan's Review history holds the prior findings and their dispositions. Verify the dispositions that touch your angle. Attack these sections at full depth, because they changed since the last pass: <list>. Re-open a closed finding only on new evidence.>

Cite path:line or command output for every finding. Follow your output format and stay under 600 words. Report no style issue unless it changes meaning.
```

## traceability

```text
Attack:
1. Every source item in this phase's scope maps to a plan task. List anything dropped, weakened or changed without a declared difference in Section 2.3 or Section 4.
2. Every source decision and open question is honored, answered, or explicitly deferred. Flag silent contradictions.
3. The plan applies its rulings and answers the same way in every task, the test plan, the done criteria, and any record it amends.
4. Flag anything the plan attributes to the source that the source does not say.
```

## assumptions

```text
Attack every claim the plan depends on. Verify against the source of truth, not the plan's own text:
1. Each row of Section 3: re-derive it with reads and read-only commands.
2. Every count, footprint and expected total the plan states.
3. Test isolation: do the plan's switches, environment and configuration reach every test and process they must, including child processes and other workspaces' tests?
4. Runtime behavior: module resolution, packaging, entry points, and which environment variables survive each launcher.
5. Claims about other repositories and external tools.
You may run read-only commands and single test files in the probe worktrees. Never install, never run a full suite, and never write outside /tmp.
```

## completeness

```text
Attack what is missing, as if you had to implement from this plan alone:
1. Each task: are inputs, exact commands, outputs, commit contents and commit messages specified? Where would two implementers produce different results?
2. Every artifact the plan creates (code, skills, documents, records): is its required content stated in full, not only as changes against a draft?
3. Error paths: when a step fails midway, does the plan give a stop rule or a rollback?
4. Records: is every action the user must take written somewhere durable?
5. Later phases: does this phase leave its tools and tests usable by them without re-planning?
```

## feasibility

```text
Walk the tasks in order and execute each one mentally against the real files:
1. Ordering traps: commit hooks, lockfile rules, untracked files that block a merge, worktree state, build prerequisites, and when tests are expected to fail and pass.
2. Every cited script, harness and pattern: check its hardcoded paths, output directories, accepted flags, and any regular expression against the code as earlier tasks leave it.
3. Every command's exact syntax, working directory and side effects.
4. Every precondition on another repository: HEAD, cleanliness, fetch state.
5. <Re-review only: the changes made after the last pass, named in the shared block, get specific verification.>
```

## validation

```text
Attack:
1. Every task and step needs an observable pass condition a command can check. List those checked only by eyeballing.
2. Every claim that a test guards something: verify it against the actual test. Which regressions would pass every listed check?
3. The source's goal: which parts does the plan prove, and which does it leave unproven without saying so?
4. Pass conditions must compare against the recorded baseline, not against "tests pass".
```

## safety

```text
Attack:
1. Anything that can damage the shared main checkout, other running sessions, the user's home configuration, source repositories, or temporary files the plan did not create.
2. Commands that break the repository's AGENTS.md rules for git, lockfiles, installs and commits.
3. Every --force, rm -rf and glob deletion: is its target verified before it runs?
4. Rollback: is it complete and safe, and does it depend on a capability the plan never verified?
```

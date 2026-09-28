# Handoff prompt template

Use this exact structure. Fill every `<slot>` with a value verified in this session: paths, hashes and state come from commands you ran, and rulings, approvals and stop conditions come from the plan. Delete a bullet only when its slot does not apply. Add no fact that you did not verify.

```text
You are implementing <plan title> in <repository description>. Today is <date>. Work through the plan on your own, and stop only at the approval gates and stop conditions below.

WHERE THINGS ARE
- Implementation worktree: <worktree path>, branch <feature branch>. Work only here until task <first task that touches the main checkout>.
- Branch head: <short hash> "<T0 commit subject>". That commit is task T0, and it is done.
- BASE, the start commit for the plan's diff checks, is <40-hex commit> (the head of <target branch>).
- Main checkout: <path>, branch <branch> at <short hash>. Other sessions share it. Before task <n>, run only read-only commands there. <Expected local changes and untracked files, and the task that handles them.>
- Already done from plan Section 5: <the setup steps completed>. Steps <n> to <m> are yours. Save the baseline test output to <path>.
- <Read-only reference worktrees, what each holds, and the task that removes them.>

READ FIRST, IN FULL, BEFORE ANY EDIT (relative paths are inside <worktree path>)
1. <plan path> is the implementation contract. It wins wherever it differs from anything else below.
2. <source document path> holds <what the implementer needs from it>.
3. <Each ADR or record the plan cites as binding.>
4. AGENTS.md at the repository root, and ~/.pi/agent/AGENTS.md.
<Other inputs, with the exact command that reads each one.>
<Review status: the passes run, and whether changes after the last pass were re-reviewed.>

USER RULINGS ALREADY MADE (do not re-open them)
- <R1 to Rn, one line each.>
- <Where the plan answers the source's questions, and which ones are deferred.>
- <Workflow skills this plan replaces, which you must not invoke.>

EXECUTION
Do T1 to T<last> in order, exactly as the plan specifies each task's changes, validation and commit message. As you go, record everything the <results record> needs.

ALLOWED WITHOUT ASKING
- The per-task commits the plan lists on <feature branch>, except <the commits that need approval>. Stage explicit paths only.
- <Each standing approval from plan Section 2.4.>

ALWAYS ASK ME FIRST, AND WAIT FOR AN EXPLICIT YES
- <Each action on the approval list in plan Section 2.4.>
- Removing any worktree or deleting any branch.

NEVER
- git add -A or git add . at a repository root, git reset --hard, git checkout ., git clean -fd, git stash, git commit --no-verify, or any push.
- <Commands the repository forbids, each with the allowed replacement.>
- <Files and repositories that plan Section 4 protects.>

STOP AND ASK WHEN
- A test run shows a failure that is absent from the baseline output.
- A lockfile changes by more than the plan predicts.
- <Each task-specific stop condition from the plan.>
- The plan is wrong, ambiguous or impossible to follow as written. Report the defect with evidence and a proposed amendment. After my approval, amend the plan in its own commit before continuing.

ENVIRONMENT FACTS THAT WILL BITE
- <Each fact from plan Sections 3 and 5 that the implementer meets before reading it there.>
- This session starts in <directory>. <Where the code index lives, and how to address the worktree from there.>
- Durable text you write follows the register in ~/.pi/agent/AGENTS.md.

REPORTING
After each task, tell me in 3 to 6 lines: the commit hash, the checks you ran and their results, and any deviation. At the end, summarize the <results record> and list every open action for me.

Start by reading the files under READ FIRST. Then <the first remaining setup step>, then begin T1.
```

The first bullet under ALLOWED WITHOUT ASKING grants commit authority. Point the user at it, so they can delete it to approve each commit themselves.

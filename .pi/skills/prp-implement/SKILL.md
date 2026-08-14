---
name: prp-implement
description: Executes an implementation plan end-to-end with validation loops. Use when the user wants to implement or execute a plan file, build a planned feature, or invokes /prp-implement.
argument-hint: <path/to/plan.md> [--base <branch>]
---

# Implement Plan

**Plan**: $ARGUMENTS

---

## Your Mission

Execute the plan end-to-end with rigorous self-validation. You are autonomous.

**Core Philosophy**: Validation loops catch mistakes early. Run checks after every change. Fix issues immediately. The goal is a working implementation, not just code that exists.

**Golden Rule**: If a validation fails, fix it before moving on. Never accumulate broken state.

---

## Phase 0: DETECT - Project Environment

### 0.1 Identify Package Manager

Check for these files to determine the project's toolchain:

| File Found | Package Manager | Runner |
|------------|-----------------|--------|
| `bun.lockb` | bun | `bun` / `bun run` |
| `pnpm-lock.yaml` | pnpm | `pnpm` / `pnpm run` |
| `yarn.lock` | yarn | `yarn` / `yarn run` |
| `package-lock.json` | npm | `npm run` |
| `pyproject.toml` | uv/pip | `uv run` / `python` |
| `Cargo.toml` | cargo | `cargo` |
| `go.mod` | go | `go` |

**Store the detected runner** - use it for all subsequent commands.

### 0.2 Detect Base Branch

Determine the base branch for branching and syncing:

1. **Check arguments**: If `$ARGUMENTS` contains `--base <branch>`, extract that value and remove the flag from the plan path argument
2. **Auto-detect from remote**:
   ```bash
   git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
   ```
3. **Fallback if detection fails**:
   ```bash
   git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}'
   ```
4. **Last resort**: `main`

**Store as `{base-branch}`** — use this value for ALL branch comparisons, rebasing, and syncing. Never hardcode `main` or `master`.

### 0.3 Identify Validation Scripts

Check `package.json` (or equivalent) for available scripts:
- Type checking: `type-check`, `typecheck`, `tsc`
- Linting: `lint`, `lint:fix`
- Testing: `test`, `test:unit`, `test:integration`
- Building: `build`, `compile`

**Use the plan's "Validation Commands" section** - it should specify exact commands for this project. When the plan lacks a command, fall back to the detected toolchain's standard one (`{runner} run type-check`, `{runner} test`, `mypy .` / `pytest`, `cargo check` / `cargo clippy` / `cargo test`, `go vet` / `go build` / `go test ./...`).

---

## Phase 1: LOAD - Read the Plan

### 1.1 Load Plan File

```bash
cat $ARGUMENTS
```

**If the file does not exist**, stop and tell the user:

```
Error: Plan not found at $ARGUMENTS

Create a plan first: /prp-plan "feature description"
```

### 1.2 Extract Key Sections

Locate and understand:

- **Summary** - What we're building
- **Patterns to Mirror** - Code to copy from
- **Files to Change** - CREATE/UPDATE list
- **Step-by-Step Tasks** - Implementation order
- **Validation Commands** - How to verify
- **Acceptance Criteria** - Definition of done

**PHASE_1_CHECKPOINT:**

- [ ] Plan file loaded
- [ ] Key sections identified
- [ ] Tasks list extracted

---

## Phase 2: PREPARE - Git State

### 2.1 Check Current State

```bash
git branch --show-current
git status --porcelain
git worktree list
```

### 2.2 Branch Decision

| Current State              | Action                                               |
| -------------------------- | ---------------------------------------------------- |
| In worktree                | Use it (log: "Using worktree")                       |
| On {base-branch}, clean    | Create branch: `git checkout -b feature/{plan-slug}` |
| On {base-branch}, dirty    | STOP: "Stash or commit changes first"                |
| On feature branch          | Use it (log: "Using existing branch")                |

### 2.3 Sync with Remote

```bash
git fetch origin
git pull --rebase origin {base-branch} 2>/dev/null || true
```

**PHASE_2_CHECKPOINT:**

- [ ] On correct branch (not {base-branch} with uncommitted work)
- [ ] Working directory ready
- [ ] Up to date with remote

---

## Phase 3: EXECUTE - Implement Tasks

**For each task in the plan's Step-by-Step Tasks section:**

### 3.1 Read Context

1. Read the **MIRROR** file reference from the task
2. Understand the pattern to follow
3. Read any **IMPORTS** specified

### 3.2 Implement

1. Make the change exactly as specified
2. Follow the pattern from MIRROR reference
3. Handle any **GOTCHA** warnings
4. Write new code to the **forward rules** below

**Forward rules** (quality is built in at write time, not restored by refactoring later). Apply them to every line you add:

- **Reuse**: before writing a helper, grep shared/utility modules and the files adjacent to the change for an existing one; call what exists.
- **Simplicity**: derive values from existing state rather than storing copies; extract shared logic the moment a second variant of a block appears; keep nesting shallow with early returns; delete code your change obsoletes.
- **Efficiency**: compute once and pass the result down; run independent I/O concurrently or batched; keep blocking work out of startup and hot paths; build long-lived objects from copied fields rather than captured scopes (a closure keeps the entire enclosing scope alive for the object's lifetime).
- **Altitude**: implement each change at the depth where the problem lives; when a special case on shared infrastructure seems needed, generalize the underlying mechanism instead.
- **Contracts**: model state so invalid combinations cannot be constructed (a discriminated union or enum instead of boolean-flag combinations); validate in the constructor or factory so the type enforces its own invariants rather than relying on callers or comments; keep one source of truth and derive the rest.
- **Failure visibility**: make every failure path observable; catch only the error types you expect, log with enough context to debug months later, and surface actionable feedback to the caller or user; a fallback logs the original cause it replaces.
- **Boundaries** (when the change accepts external input, authenticates, or persists data): validate with a schema at the entry point, parameterize every query, allow-list the fields written to storage, resolve the acting user from the session rather than from request parameters, and read secrets from the environment.
- **Comments**: write comments only for why or for a constraint the code cannot show, and leave every comment in a file you touch true after your change.

### 3.3 Validate Immediately

**After EVERY file change, run the type-check command from the plan's Validation Commands section.**

**If types fail:**

1. Read the error
2. Fix the issue
3. Re-run type-check
4. Only proceed when passing

### 3.4 Track Progress

Log each task as you complete it:

```
Task 1: CREATE src/features/x/models.ts ✅
Task 2: CREATE src/features/x/service.ts ✅
Task 3: UPDATE src/routes/index.ts ✅
```

**Update the plan's status markers as you go** (newer templates use `[ ] / [wip] / [x] / [f]`): set a task to `[wip]` when you start it and `[x]` when its validation passes — or `[f]` if it cannot be made to pass (record why in the plan's Agent Notes and continue). Save the plan file after each change so progress survives an interruption. Plans without markers: skip this.

**Deviation Handling:**
If you must deviate from the plan:

- Note WHAT changed
- Note WHY it changed
- Continue with the deviation documented

**PHASE_3_CHECKPOINT:**

- [ ] All tasks executed in order
- [ ] Each task passed type-check
- [ ] New code written to the forward rules from 3.2
- [ ] Deviations documented

---

## Phase 4: VALIDATE - Full Verification

### 4.0 Forward-Rules Pass

Re-read the full diff (`git diff {base-branch}...HEAD`, plus `git diff HEAD` for uncommitted work) against the forward rules from 3.2. Per-task focus lets violations accumulate across tasks (a helper written in task 2 and re-implemented in task 5, state duplicated between files), and this is the moment they are cheapest to fix: the code is untested, so reshaping it breaks nothing. Fix each violation, re-run the type-check command, and proceed when a pass over the diff yields no new findings.

### 4.1 Static Analysis

**Run the type-check and lint commands from the plan's Validation Commands section.**

**Must pass with zero errors.**

If lint errors:

1. Run the lint fix command (e.g., `{runner} run lint:fix`, `ruff check --fix .`)
2. Re-check
3. Manual fix remaining issues

### 4.2 Unit Tests

**Write or update tests for every piece of new code.** A task without tests is not complete.

**Test requirements:**

1. Every new function/feature needs at least one test
2. Edge cases identified in the plan need tests
3. Update existing tests if behavior changed

**Write tests**, then run the test command from the plan.

**If tests fail:**

1. Read failure output
2. Determine: bug in implementation or bug in test?
3. Fix the actual issue
4. Re-run tests
5. Repeat until green

### 4.3 Build Check

**Run the build command from the plan's Validation Commands section.**

**Must complete without errors.**

### 4.4 Integration Testing (if applicable)

**If the plan involves API/server changes, use the integration test commands from the plan.**

Example pattern:
```bash
# Start server in background (command varies by project)
{runner} run dev &
SERVER_PID=$!
sleep 3

# Test endpoints (adjust URL/port per project config)
curl -s http://localhost:{port}/health | jq

# Stop server
kill $SERVER_PID
```

If an integration test fails, check that the server started, the endpoint exists, and the request format is right, then fix and retry.

**PHASE_4_CHECKPOINT:**

- [ ] Forward-rules pass complete (diff yields no new findings)
- [ ] Type-check passes (command from plan)
- [ ] Lint passes (0 errors)
- [ ] Tests pass (all green)
- [ ] Build succeeds
- [ ] Integration tests pass (if applicable)

---

## Phase 5: REPORT - Create Implementation Report

### 5.1 Create Report Directory

```bash
# --- PRP store resolver (canonical; keep byte-identical across skills) ---
_gd="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
case "$_gd" in */.git) _root="${_gd%/.git}" ;; "") _root="$PWD" ;; *) _root="$_gd" ;; esac
_root="$(cd "$_root" && pwd -P)"
_name="$(basename "$_root" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//;s/-*$//')"
PRP_DIR="${PRP_HOME:-$HOME/.prp}/${_name:-project}-$(printf %s "$_root" | git hash-object --stdin | cut -c1-8)"
mkdir -p "$PRP_DIR"; [ -f "$PRP_DIR/project.json" ] || printf '{"path": "%s", "name": "%s"}\n' "$_root" "${_name:-project}" > "$PRP_DIR/project.json"
mkdir -p "$PRP_DIR/reports"
```

### 5.2 Generate Report

**Path**: `$PRP_DIR/reports/{plan-name}-report.md`

Read [references/report-templates.md](references/report-templates.md) now and write the report following its **Implementation Report** template: every `{placeholder}` filled, section order kept.

### 5.3 Update Source PRD (if applicable)

**Check if plan was generated from a PRD:**
- Look in the plan file for `Source PRD:` reference
- Or check if plan filename matches a phase pattern

**If PRD source exists:**

1. Read the PRD file
2. Find the phase row in the Implementation Phases table
3. Update the phase:
   - Change Status from `in-progress` to `complete`
4. Save the PRD

### 5.4 Update Plan Lifecycle & Amendments

**If the plan has a `## Lifecycle (append-only)` / `## Amendments` section (newer template), update it before archiving — append-only, never overwrite existing entries:**

- Append today's ISO-8601 timestamp to **Modified**
- Append the implementing commit SHA(s) to **Commits**
- Append your agent/model + session id to **Agent / Session**
- Append one **Amendments** entry (newest at bottom) summarizing what was built and any deviations

Older plans without these sections: skip this step.

### 5.5 Archive Plan

Only archive a plan that already lives in the project's store; leave a plan supplied from any other path in place.

```bash
PLAN_PATH="$(cd "$(dirname "$ARGUMENTS")" && pwd -P)/$(basename "$ARGUMENTS")"
case "$PLAN_PATH" in
  "$PRP_DIR"/plans/*)
    mkdir -p "$PRP_DIR/plans/completed"
    mv "$PLAN_PATH" "$PRP_DIR/plans/completed/"
    ;;
  *) echo "Plan is outside the PRP store; leaving it in place: $PLAN_PATH" ;;
esac
```

**PHASE_5_CHECKPOINT:**

- [ ] Report created at `$PRP_DIR/reports/`
- [ ] PRD updated (if applicable) - phase marked complete
- [ ] Plan Lifecycle/Amendments updated (if the plan uses them)
- [ ] Plan moved to completed folder

---

## Phase 6: OUTPUT - Report to User

Fill the **Final user summary** template from [references/report-templates.md](references/report-templates.md) (read it now if you did not read it in Phase 5.2) and print the result as your closing message.

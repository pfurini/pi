# Implementation Task Format

Write tasks as executable outcomes, not a file inventory or a mechanism script. Size each task as the smallest coherent change that can be validated without leaving the system in a knowingly broken intermediate state.

## Altitude

A task pins WHAT must hold — invariants, the seams to touch, and the falsifying tests — never HOW to build the mechanism. The implementer designs the mechanism against real code with the compiler and test suite the plan does not have; mechanism prose in a plan is unverified code that reviews must attack, that drifts stale, and that implementation regularly overturns. Implementation reports' Deviations sections keep the score: a plan whose mechanisms get overturned there was written too low.

One case earns a **Design note**: several components must agree on one design before any of them can be built. Then verify in source every seam and pattern the note cites before writing it.

## Required content

```markdown
### N. <Outcome>

**Invariants**
- Observable properties that hold when this task is done — including the boundary,
  failure, and compatibility behavior worth pinning.

**Seams**
- `path/file.ext — symbol` — CREATE / UPDATE — why this location owns the change;
  the verified precedent to follow, when one exists.

**Tests**
- The test that fails while an invariant is unmet: the behavior and its test surface.

**Validation**
- `<focused command>` — expected observable result.
```

Add a **Design note** only under the rule above. Add imports, types, schemas, migrations, or gotchas only when they are load-bearing evidence from research; do not repeat what the implementer can read from the cited file, and do not script branch logic, lifecycles, helper bodies, or test internals.

## Ordering and sizing

- Order tasks by real dependency and preserve a working integration path.
- Combine files that implement one coherent behavior; split work with a distinct contract or validation boundary.
- Describe the outcome first. A task named “Add workflow capability selection” is more useful than “Update five files.”
- Cite the closest useful precedent, not an arbitrary number of examples.
- Make tests part of the behavior they validate, unless shared test infrastructure genuinely has to land first.
- Use the repository's actual commands. A task-level command should fail when that task's behavior is absent.

## Avoid

- Mechanism prose: pseudo-code, scripted lifecycles, exact helper bodies, channel designs, or test internals the implementer will re-derive against real source.
- Status markers that no workflow maintains.
- “Mirror exactly” when the precedent contains a known poor convention.
- Generic edge-case checklists unrelated to the feature.
- Validation that proves only syntax when behavior changed.
- Optional implementation tasks that allow agreed scope to disappear.
- “Fail and move on.” A blocked task blocks completion until the scope or prerequisite is resolved.

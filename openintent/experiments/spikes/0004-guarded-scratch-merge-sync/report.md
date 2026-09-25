---
id: SPIKE-0004
title: Can a guarded scratch-merge sync reproduce a fork's real upstream syncs for a ported package, report four distinct outcomes, and refuse an unverified or rewritten base?
status: open
kind: spike
date: 2026-09-25
verdict: null
frozen-at: de669e504d0cf32a40f6941d95c7742fcb073057
unblocks:
  - .pi/skills/sync-upstream/SKILL.md
  - .pi/skills/port-extension/SKILL.md
  - docs/adr/ADR-0009-built-in-extensions.md
---

# Can a guarded scratch-merge sync reproduce a fork's real upstream syncs for a ported package, report four distinct outcomes, and refuse an unverified or rewritten base?

## Verdict

_Pending. Written in pass 2, after the evidence. Everything between the frozen markers below is fixed once `run` stamps `frozen-at`; this section and everything after the end marker is pass 2._

<!-- opin-spike: pass 2. First paragraph, at most 100 words: the verdict token in backticks and the single piece of evidence that decided it. Then, as needed: the restrictions as a table (restriction, cost, claim); what survives or is unblocked, naming which unblocks entries the routing will edit and why any will not; why this verdict and not its neighbour, quoting the frozen sentences that decided it. No sentence over 25 words. Replace the pending line above as well. -->

<!-- OPENINTENT:FROZEN:START -->

## Why this spike exists

`.pi/skills/sync-upstream/SKILL.md` will run an unattended upstream sync for every package the Pi fork owns, first as a skill and later as a workflow, and it waits on this answer.
`.pi/skills/port-extension/SKILL.md` defines the upstream record each port writes, and `docs/adr/ADR-0009-built-in-extensions.md` records the sync method.

SPIKE-0002 (`openintent/experiments/spikes/0002-scoped-upstream-sync/report.md`) settled `DISPROVEN`.
Its scratch merge reproduced Git on every single merge, but its chain case mixed merges from different lines, so the chain claim failed as run.
It left two requirements unproven: a guard that refuses an unverified record or a base that is not an ancestor of the new commit, and a distinct no-change outcome.
A sync that fails either one corrupts owned code or misreports its work while nobody watches.
SPIKE-0002's other failure mode, a verified base that is an ancestor of the new commit while the Pi side comes from another line, stays outside this spike, because neither guard can detect it.

## The question

**Can a guarded scratch-merge sync reproduce a fork's real upstream syncs for a ported package, report four distinct outcomes, and refuse an unverified or rewritten base?**

| Term | Meaning in this spike |
| --- | --- |
| Guarded scratch-merge sync | One script, written in the run, that performs these steps in order. (1) It reads `repository`, `path` and `base` from the package's `UPSTREAM.json`. (2) It refuses when `git log -1 --format='%(trailers:key=Upstream-Base,valueonly)' -- <dir>/UPSTREAM.json` does not equal the recorded base as a 40-hex string. (3) It refuses when `git status --porcelain -- <dir>` is non-empty, which covers tracked and untracked files and excludes ignored ones. (4) It refuses when `git merge-base --is-ancestor <base> <new>` exits non-zero in the upstream clone; a commit counts as its own ancestor. (5) It reports up to date when the upstream subtree at the base equals the subtree at the new commit, and then rewrites only the base value in `UPSTREAM.json`. (6) Otherwise it merges in a scratch repository, with base as the upstream subtree at the recorded base, ours as the package directory as committed at `HEAD`, and theirs as the upstream subtree at the new commit. It copies the result back, writes the new base, and stages the directory with `git add -A -f -- <dir>`. It never commits and never fetches. |
| Upstream clone | The local fork repository the versions table names for the case. |
| Pi worktree under test | A disposable worktree created with `git worktree add --detach` from the `frozen-at` commit, outside `spike/`, one per chain or case. The harness's port and between-step commits land there, never on the spike branch. |
| Port | Before R1, R6, K1 and U2, the harness copies the fork state's package directory into `packages/builtins/<name>/` of the Pi worktree under test, writes `UPSTREAM.json` with the recorded base as a 40-hex string, runs `git add -A -f`, and commits with the trailer `Upstream-Base: <base>`. |
| Four distinct outcomes | Exit 0 for a clean merge, 1 for a merge with conflicts, 2 for a refusal, 3 for up to date, each with its own status line. |
| Real sync | A commit on the first-parent line of the fork's `personal` branch whose newest contained upstream commit differs from its first parent's, while the first parent is not itself an upstream commit. The newest contained upstream commit of a commit `c` is `git merge-base c upstream/main`. |
| Sync merge | The fork's merge whose two parents are the fork state before a real sync and the new upstream commit. The real sync contains it. |
| Fork state before a sync | The tree of the sync merge's first parent. |
| Git's automatic result | `git merge-tree --write-tree <first parent> <second parent>` of the case's merge, restricted to the package's directory. |
| Reproduce | Excluding `UPSTREAM.json`, the result's path set equals Git's automatic result's, its conflicted set equals Git's, and every other file is byte-identical with an equal file mode. A conflicted file is an unmerged path in the scratch repository. |
| Rewritten base | A recorded base for which step (4)'s ancestry command exits non-zero, including a base missing from the upstream clone. |
| Unverified record | An `UPSTREAM.json` for which step (2)'s trailer lookup differs from the recorded base. |
| Pi side between chain steps | After each of R1 to R4, the harness replaces the package directory with the next step's fork state before the sync. After R5 it uses the tree of `d233e0a`, the fork's own resolution of R5. Each time it keeps the `UPSTREAM.json` the sync wrote, runs `git add -A -f`, and commits with the trailer naming the new base. Each next fork state descends from the previous sync merge. |
| State after R5 | The Pi worktree under test after that last commit: `d233e0a`'s tree, and `UPSTREAM.json` with base `07507489c0c54f7f978ab752eb9beb5cc0960f24` and the matching trailer. U1, G1, G2a, G2b, G3 and G4 each start from a fresh worktree at the commit that holds this state. |

The replay set comes from the fork histories. The coordinator computed it on 2026-09-25 with the real-sync rule, and an independent reviewer re-derived it before freezing:

| Case | Source and directory | Merge (first parent, second parent) | Recorded base | New upstream commit | Git's result |
| --- | --- | --- | --- | --- | --- |
| R1 | pi-claude-bridge, root | sync merge `c4b759f` (`7260d85`, `0667673`) | `7e41218` | `0667673` | 11 conflicted files |
| R2 | pi-claude-bridge, root | sync merge `60efeb9` (`6d09f9e`, `fac372c`) | `0667673` | `fac372c` | 14 conflicted files |
| R3 | pi-claude-bridge, root | sync merge `6feed8f` (`e87c1c3`, `500eea1`), inside real sync `b0db315` | `fac372c` | `500eea1` | 11 conflicted files |
| R4 | pi-claude-bridge, root | sync merge `64e3c25` (`fcfe846`, `44fe582`) | `500eea1` | `44fe582` | 4 conflicted files |
| R5 | pi-claude-bridge, root | sync merge `d233e0a` (`3a83275`, `0750748`), inside real sync `a6e7053` | `44fe582` | `0750748` | 13 conflicted files |
| R6 | rpiv-mono, `packages/rpiv-ask-user-question` | sync merge `ce35c164` (`777beb8`, `d74b1c9`), inside real sync `05b6bb1` | `0fdf4f8` | `d74b1c9` | 1 conflicted file |
| K1 | pi-claude-bridge, root | upstream pull-request merge `402fa8d` (`7100c15`, `9203965`), a clean three-way case with 5 commits on its first side and 1 on its second; not a fork sync | `4a7920a` | `9203965` | 0 conflicted files |
| U1 | pi-claude-bridge, root | none; the state after R5 | `0750748` | `0750748` | up to date |
| U2 | rpiv-mono, `packages/rpiv-ask-user-question` | none; a port of `cb1ee6e`'s package directory | `cb1ee6e` | `7392135` | subtree unchanged |
| G1 | pi-claude-bridge, root | none; the state after R5 | `0750748` | `44fe582`, which does not descend from the base | refusal at step (4) |
| G2a | pi-claude-bridge, root | none; the state after R5, then a commit without a trailer that changes `UPSTREAM.json`'s base to `44fe582`'s full hash | `44fe582` | `0750748` | refusal at step (2) |
| G2b | pi-claude-bridge, root | none; the state after R5, then a commit that changes the base to `44fe582`'s full hash and carries the stale trailer `Upstream-Base: <0750748's full hash>` | `44fe582` | `0750748` | refusal at step (2) |
| G3 | pi-claude-bridge, root | none; the state after R5, then one uncommitted edit to the tracked file `README.md` | `0750748` | `227f5eb`, which descends from the base | refusal at step (3) |
| G4 | pi-claude-bridge, root | none; the state after R5, then a commit with the matching trailer that changes the base to `1111111111111111111111111111111111111111`, absent from the clone | the absent hash | `0750748` | refusal at step (4) |

R1 to R5 run in order as one chain, each reading the base the previous sync wrote.

## Claims

Each claim is independently falsifiable and is tested on its own. The verdict is a function of which ones hold, by the boundaries below. A claim states what must be true; its expected observation states what the harness is expected to show, and the observation can be refuted without the claim failing.

**C1, the fork's real sync chain.**
*Given* R1 to R5 in order, *when* the sync runs each step from the base the previous step wrote, *then* each recorded base equals `git merge-base` of the sync merge's parents, and each result reproduces Git's automatic result.
Expected observation: five base matches, five equal conflicted sets of 11, 14, 11, 4 and 13 files, no other differing path, and exit 1 each time.

**C2, monorepo sub-folder source.**
*Given* R6, *when* the sync runs, *then* its result reproduces Git's automatic result for `packages/rpiv-ask-user-question`.
Expected observation: one conflicted file equal to Git's, no other differing path, exit 1.

**C3, clean merge.**
*Given* K1, *when* the sync runs, *then* its result reproduces Git's automatic result and the sync reports a clean merge.
Expected observation: no conflicted file, no differing path, exit 0 with the clean status line.

**C4, up to date.**
*Given* U1 and U2, *when* the sync runs, *then* it reports up to date, and the package directory differs from its prior state only in `UPSTREAM.json`'s base value.
Expected observation: exit 3 twice with the up-to-date status line; after U1 the directory is byte-identical, and after U2 only the base value differs.

**C5, rewritten base.**
*Given* G1 and G4, *when* the sync runs, *then* it refuses and changes nothing.
Expected observation: exit 2 with a status line naming the ancestry refusal, `git status --porcelain --ignored` empty, and `HEAD` unchanged.

**C6, unverified record.**
*Given* G2a and G2b, *when* the sync runs, *then* it refuses and changes nothing.
Expected observation: exit 2 with a status line naming the trailer mismatch, `git status --porcelain --ignored` empty, and `HEAD` unchanged.

**C7, uncommitted edits.**
*Given* G3, *when* the sync runs, *then* it refuses and the uncommitted edit survives unchanged.
Expected observation: exit 2 with a status line naming the uncommitted changes, `README.md`'s bytes unchanged, and `HEAD` unchanged.

**C8, unattended outcomes.**
*Given* every run of C1 to C7, with stdin from `/dev/null` and no controlling terminal, *when* each finishes, *then* the four outcomes carry four distinct exit codes and status lines, and no process waits for input.
Expected observation: exit codes 0, 1, 2 and 3, each with its own status line; every run finishing within 60 seconds; no descendant process of the sync remaining after it exits.

**C9, containment.**
*Given* every run of C1 to C7, *when* each finishes, *then* no path outside the case's package directory changes in the Pi worktree under test, and neither fork working tree changes.
Expected observation: `git status --porcelain --ignored --untracked-files=all` in the Pi worktree under test lists only paths under the case's package directory, and both fork working trees show the same status before and after the run.

**C10, files Pi's `.gitignore` matches.**
*Given* R1 to R5 and K1, where each fork state carries `TODO.md` and Pi's `.gitignore` entry `todo.md` matches it case-insensitively, *when* the sync stages its result, *then* every path of the result is in the index.
Expected observation: after each of those runs, `git ls-files` for the package directory lists every path of the result, `TODO.md` included.

## Kill criteria

Written before any code, and not edited afterwards.

The spike is **DISPROVEN** if, after honest effort within the time box, the guarded scratch-merge sync fails, or cannot be marked **proved**, any one of C1, C2, C3, C4, C5 and C9.

Things that are explicitly **not** kill conditions, named now so they cannot be promoted into one later to manufacture a failure, nor dismissed later to manufacture a success:

- C6 fails or is inferred, so the record check needs another mechanism: `CONDITIONAL`.
- C7 fails or is inferred, so uncommitted edits need another guard: `CONDITIONAL`.
- C8 fails or is inferred, so the outcomes need a mapping outside the sync: `CONDITIONAL`.
- C10 fails or is inferred, so ported files need a Pi-side ignore rule or a port step: `CONDITIONAL`.
- Conflict markers differ from Git's only in labels or marker style while the conflicted set is equal: `PROVEN`.

## Verdict boundaries

Each outcome the kill criteria name maps to exactly one row here, and the two sections were checked against each other before freezing.

| Verdict | Condition |
| --- | --- |
| `PROVEN` | C1 to C10 are all proved on the frozen replay set. Conflict markers that differ only in labels or style do not prevent this row. |
| `CONDITIONAL` | C1, C2, C3, C4, C5 and C9 are proved, and one or more named restrictions apply: C6, C7, C8 or C10 failing or ending inferred. The verdict names each restriction, its cost and the claim that exposed it, and names each clause of the question that a failed claim leaves unanswered. |
| `DISPROVEN` | The kill criterion above is met. The verdict names what blocked it and what it would take to unblock it. |

A verdict of `PROVEN` requires every claim to be marked **proved**, observed running here. Any claim that ends the spike marked **inferred** forces `CONDITIONAL` at best, whatever the reasoning behind it.

## Versions under test

The verdict is only a verdict about these. This table holds the things the question is about; everything the harness installs is recorded in the evidence half.

| Thing | Version |
| --- | --- |
| Git | 2.55.0, `/opt/homebrew/bin/git` |
| pi-claude-bridge fork | branch `personal` at `edf19ed`, committed 2026-09-24, with `upstream/main` at `227f5eb`, working tree clean |
| rpiv-mono fork | branch `personal` at `8403bb09`, committed 2026-09-24, with `upstream/main` at `d74b1c99`, working tree clean apart from two untracked documents under `docs/` |
| Pi fork | the `frozen-at` commit on branch `personal`, descending from `0be71ca`; its `.gitignore` and `.gitattributes` equal `0be71ca`'s, with `core.ignorecase=true` and `core.autocrlf=input` |

## What was already known when the question was frozen

Recorded so the evidence table is honest about what this spike discovered versus what it confirmed. All of the following is documentation and source reading, not observation, and none of it is evidence until it is run.

| Prior | Source |
| --- | --- |
| SPIKE-0002's scratch merge reproduced Git on nine single merges, including 13 conflicted files and modify/delete conflicts. | SPIKE-0002 report, Claims table |
| SPIKE-0002's scratch merge reported an unchanged upstream as a clean merge, and exited 0 while dropping upstream changes under a base that misdescribed the Pi side. | SPIKE-0002 report, Verdict |
| The real-sync rule found 280 transitions on pi-claude-bridge's first-parent line and 1334 on rpiv-mono's; the rest were the fork tracking upstream commits directly. Only the five bridge syncs and the one rpiv sync with a change under `packages/rpiv-ask-user-question` have fork commits before them. Each has one merge base, equal to the recorded base, and each maps to one sync merge with an upstream parent. | The coordinator's `git merge-base` and `git merge-tree` runs, and the independent pre-freeze review, both on 2026-09-25 |
| SPIKE-0002's harness README says `b0db315` sits off the first-parent line. It lies on that line; its second parent is a fork branch, and its sync merge `6feed8f` sits on that branch. | SPIKE-0002 `evidence.patch`, `spike/README.md`; the computation above |
| Pi's `.gitignore` entry `todo.md` matches pi-claude-bridge's `TODO.md` under `core.ignorecase=true`; it is the only matched path in these fork trees. The only files carrying CR bytes are PNG and JPEG images, which Pi's `.gitattributes` marks binary. | SPIKE-0002 `evidence.patch`, `spike/runs/00-gitignore-probe.txt`; the pre-freeze review |

| Claim | Honest prior |
| --- | --- |
| C1, C2, C3 | Likely: the merge step equals SPIKE-0002's candidate B, and every base matches Git's. |
| C4, C5, C7, C8, C9 | Likely: each is a check the script performs before merging, or a property of running it in a disposable worktree. |
| C6 | Uncertain: trailer parsing depends on each commit message's layout. |
| C10 | Likely with `git add -A -f`. |

The spike is still worth running because C1 has never run on a real chain, and C4 to C8 are new code that decides whether the sync may run unattended.

## Time box and budget

| Item | Value |
| --- | --- |
| Time box | One session. |
| Model calls | None. |
| Harness runner | This session builds and runs every harness. |
| Pre-freeze review | One independent agent reviewed the draft of this block on 2026-09-25; its findings are folded in. |
<!-- OPENINTENT:FROZEN:END -->

## Evidence

Every conclusion is marked **proved** (observed running here) or **inferred** (reasoned, not run).

### Harness

<!-- opin-spike: each harness in evidence.patch: file, what it does, its command; where raw output lives (spike/runs/); how the thing under test was reached (absolute path, built from which commit) so there is no doubt what answered -->

### Harness versions

<!-- opin-spike: everything the harness installed or linked, with exact versions -->

### Budget spent

<!-- opin-spike: turns spent of the cap, per harness, and where the ledger is; or "no model was called" -->

### Claims

| Claim | Result | Status | What showed it |
| --- | --- | --- | --- |
| C1, <!-- opin-spike: name --> | <!-- opin-spike: holds, fails or partly --> | **<!-- opin-spike: proved or inferred -->** | <!-- opin-spike: the run file and the exact observation --> |

### Supporting conclusions

| Conclusion | Status | What showed it |
| --- | --- | --- |
| <!-- opin-spike: a fact learned on the way, marked proved or inferred; delete the table when there is none --> | | |

### Re-verified by the coordinator

<!-- opin-spike: when subagents ran harnesses: each claim re-read from the raw runs and the source, not from the subagent's report; or "no subagent ran a harness" -->

### What this spike did not test

<!-- opin-spike: the nearest things a reader might assume were covered, and where they belong -->

## Cleanup

<!-- opin-spike: every write outside the worktree the harnesses made, by path, so the human can remove it; or "nothing outside the worktree" -->

## Spike code

`evidence.patch`, beside this file: one squashed commit of the worktree branch. Built in an isolated worktree, never merged, never pushed as a branch, never opened as a pull request. To re-check a decayed verdict, run `/skill:opin-spike re-check` on this spike; it applies the patch into a fresh worktree.

<!-- opin-spike: how to run it from the applied patch. If the template had to be worked around, add a "## Template gaps" section above this one saying what and why. -->

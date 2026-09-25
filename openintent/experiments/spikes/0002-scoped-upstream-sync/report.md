---
id: SPIKE-0002
title: Can a merge scoped to one package directory, from a recorded upstream base, reproduce the result of a full Git merge in the fork repository?
status: open
kind: spike
date: 2026-09-25
verdict: null
unblocks:
  - .pi/skills/sync-upstream/SKILL.md
  - .pi/skills/port-extension/SKILL.md
  - docs/adr/ADR-0009-built-in-extensions.md
---

# Can a merge scoped to one package directory, from a recorded upstream base, reproduce the result of a full Git merge in the fork repository?

## Verdict

_Pending. Written in pass 2, after the evidence. Everything between the frozen markers below is fixed once `run` stamps `frozen-at`; this section and everything after the end marker is pass 2._

<!-- opin-spike: pass 2. First paragraph, at most 100 words: the verdict token in backticks and the single piece of evidence that decided it. Then, as needed: the restrictions as a table (restriction, cost, claim); what survives or is unblocked, naming which unblocks entries the routing will edit and why any will not; why this verdict and not its neighbour, quoting the frozen sentences that decided it. No sentence over 25 words. Replace the pending line above as well. -->

<!-- OPENINTENT:FROZEN:START -->

## Why this spike exists

`.pi/skills/sync-upstream/SKILL.md` will drive a scheduled upstream sync for every package the Pi fork owns, and it waits on this answer.
`.pi/skills/port-extension/SKILL.md` defines the upstream record each ported package carries, and `docs/adr/ADR-0009-built-in-extensions.md` records the sync method.
The scheduled sync later becomes a workflow on the OpenIntent engine, so a wrong method would run unattended every few days.

Today each fork merges upstream in its own repository, where Git knows the full history.
After the port, the package lives in one directory of the Pi repository, and Git no longer sees the upstream history there.
The sync must rebuild the three-way merge from a recorded base commit.
A method that silently drops a Pi-side edit, or misreports a conflict, corrupts owned code without any signal.

## The question

**Can a merge scoped to one package directory, from a recorded upstream base, reproduce the result of a full Git merge in the fork repository?**

| Term | Meaning in this spike |
| --- | --- |
| Scoped merge | A merge that changes only files under the package directory in a Pi worktree, using three inputs: the upstream tree at the recorded base, the Pi directory, and the upstream tree at the new commit. |
| Recorded base | The upstream commit stored in the package's upstream record at the previous sync or at the port. |
| Full Git merge | The fork repository's merge of an upstream commit, `git merge-tree --write-tree <first parent> <second parent>`, restricted to the package's files. |
| Automatic result | The tree that the full Git merge writes before any hand resolution. The spike compares against the automatic result, never against the committed resolution. |
| Reproduce | For a merge without conflicts, the package files are byte-identical with equal file modes. For a merge with conflicts, the set of conflicted files is equal, and every other file is byte-identical with an equal file mode. |
| Replay case | A real upstream merge commit from a fork's history, replayed into Pi by porting the merge's first parent and syncing to its second parent. |

The replay set comes from `pi-claude-bridge`, `pi-hashline-edit-pro` and rpiv-mono:

| Case | Source | Merge commit | Upstream commits | Fork commits | Conflicted files |
| --- | --- | --- | --- | --- | --- |
| R1 | `pi-claude-bridge` | `402fa8d` | 1 | 5 | 0 |
| R2 | `pi-claude-bridge` | `4a7920a` | 1 | 9 | 0 |
| R3 | `pi-claude-bridge` | `a41b434` | 28 | 1 | 0 |
| R4 | `pi-claude-bridge` | `efff473` | 6 | 1 | 1 |
| R5 | `pi-claude-bridge` | `7100c15` | 2 | 2 | 3 |
| R6 | `pi-claude-bridge` | `64e3c25` | 7 | 47 | 4 |
| R7 | `pi-claude-bridge` | `d233e0a` | 45 | 55 | 13 |
| R8 | `pi-claude-bridge` chain | `1149b63`, `7edc676`, `efff473`, `cd64b9f` in order | 3, 1, 6, 2 | 0, 0, 1, 0 | 0, 0, 1, 0 |
| R9 | `pi-hashline-edit-pro` rename | `cbd5fce`, synced from its first parent | 1 | one synthetic Pi-side edit | not applicable: the harness observes the rename, not a conflict count |
| R10 | rpiv-mono, directory `packages/rpiv-ask-user-question` | `e04fe7a4`, then separately `ce35c164` | 1, then 2 | 8, then 1 | 0, then 1 |

## Candidates

| Label | Package | Version | What we supply |
| --- | --- | --- | --- |
| A, three-way apply | Git | 2.55.0 | In the upstream clone, `git diff --binary -M <base> <new>` over the source directory with relative paths. In the Pi worktree, the new commit's objects are fetched without a ref, then `git apply -3 --directory=<package directory>` applies the diff. |
| B, scratch merge | Git | 2.55.0 | A temporary repository holds three commits: the base tree, the Pi directory as one branch, and the new upstream tree as the other branch. `git merge` runs there with its default rename detection, and the resulting files, conflict markers included, replace the Pi directory. |

## Claims

Each claim is independently falsifiable and is tested on its own. The verdict is a function of which ones hold, by the boundaries below. A claim states what must be true; its expected observation states what the harness is expected to show, and the observation can be refuted without the claim failing.

Every claim is observed once per candidate.

**C1, clean merges.**
*Given* replay cases R1, R2 and R3, *when* the candidate syncs the Pi directory from the recorded base to the merge's second parent, *then* the result reproduces the automatic result.
Expected observation: `diff -r` and a mode comparison against the automatic result report no difference for all three cases.

**C2, conflicted merges.**
*Given* replay cases R4, R5, R6 and R7, *when* the candidate syncs the Pi directory, *then* the result reproduces the automatic result.
Expected observation: the conflicted file set equals the set `git merge-tree --name-only` reports in the fork, and every other file is byte-identical.

**C3, upstream rename with a Pi-side edit.**
*Given* replay case R9 with one line edited in `prompts/replace-flat.md` on the Pi side, *when* the candidate syncs to `cbd5fce`, *then* the edited line survives in `prompts/replace.md` and `prompts/replace-flat.md` no longer exists.
Expected observation: `prompts/replace.md` contains the synthetic line and upstream's change, and `git status` shows the old path removed.

**C4, chained syncs.**
*Given* replay case R8, with the fork's own commits between merges committed on the Pi side, *when* the candidate syncs four times in order, reading and updating the recorded base each time, *then* each recorded base equals the merge base Git computes in the fork, and each result reproduces its automatic result.
Expected observation: four recorded bases equal four `git merge-base` outputs, and the four comparisons pass by the C1 and C2 rules. The harness applies the fork's committed resolution to R4's conflict before the next sync.

**C5, containment.**
*Given* any replay case, *when* the candidate syncs, *then* no file outside the package directory changes in the Pi worktree.
Expected observation: `git status --porcelain` lists only paths under the package directory, for every case.

**C6, unattended outcome.**
*Given* one up-to-date case, one clean case and one conflicted case, *when* the candidate runs with no terminal attached, *then* it finishes without waiting for input and reports three distinguishable outcomes.
Expected observation: three different exit codes or status lines, and no process left waiting on an editor or prompt.

**C7, subdirectory source.**
*Given* the two merges of replay case R10, where the source is one directory of the rpiv-mono monorepo, *when* the candidate syncs each one, *then* each result reproduces the automatic result for that directory.
Expected observation: the C1 comparison passes for `e04fe7a4`, and the C2 comparison passes for `ce35c164`.

## Kill criteria

Written before any code, and not edited afterwards.

The spike is **DISPROVEN** if, after honest effort within the time box, no candidate proves all of C1, C2, C4, C5 and C7. A candidate that fails any one of those five claims is `DISPROVEN` in the per-candidate verdicts.

Things that are explicitly **not** kill conditions, named now so they cannot be promoted into one later to manufacture a failure, nor dismissed later to manufacture a success:

- Candidate A needs the new commit's objects fetched into the Pi object store, with no ref created and nothing pushed: `PROVEN`.
- Conflict markers differ from the fork's markers in style or labels while the conflicted file set is equal: `PROVEN`.
- C3 fails, and the sync needs a documented manual step for upstream renames: `CONDITIONAL`.
- C6 fails, and the sync needs a wrapper that sets non-interactive flags or maps outcomes: `CONDITIONAL`.
- A replay case cannot be reconstructed because its commits are unreachable, and another case of the same kind replaces it: `CONDITIONAL`.

## Verdict boundaries

Each outcome the kill criteria name maps to exactly one row here, and the two sections were checked against each other before freezing.

| Verdict | Condition |
| --- | --- |
| `PROVEN` | For the candidate, C1 to C7 are all proved on the frozen replay set. Fetched objects without refs, and conflict markers that differ only in style or labels, do not prevent this row. |
| `CONDITIONAL` | For the candidate, C1, C2, C4, C5 and C7 are proved, and one or more named restrictions apply: a manual rename step, a wrapper for unattended runs, or a replaced replay case. The verdict names each restriction, its cost and the claim that exposed it. |
| `DISPROVEN` | The kill criterion above is met. The verdict names what blocked it and what it would take to unblock it. |

A verdict of `PROVEN` requires every claim to be marked **proved**, observed running here. Any claim that ends the spike marked **inferred** forces `CONDITIONAL` at best, whatever the reasoning behind it.

## Versions under test

The verdict is only a verdict about these. This table holds the things the question is about; everything the harness installs is recorded in the evidence half.

| Thing | Version |
| --- | --- |
| Git | 2.55.0 |
| `pi-claude-bridge` fork | branch `personal` at `edf19ed`, committed 2026-09-24, with `upstream/main` fetched at `227f5eb`, working tree clean |
| `pi-hashline-edit-pro` upstream clone | `origin/master` at `68346e7`, working tree clean apart from an untracked `.agents/` directory |
| rpiv-mono fork | branch `personal` at `8403bb09`, committed 2026-09-24 |
| Pi fork | branch `personal` at `c373029`, the SPIKE-0001 settle commit, committed 2026-09-25, working tree clean apart from this record |

## What was already known when the question was frozen

Recorded so the evidence table is honest about what this spike discovered versus what it confirmed. All of the following is documentation and source reading, not observation, and none of it is evidence until it is run.

| Prior | Source |
| --- | --- |
| `pi-claude-bridge` `personal` carries 26 upstream merges. `git merge-tree` reports conflicts in 11 of them, and none of their upstream ranges renames a file. | `git merge-tree --write-tree --name-only` over every merge on `personal`, run on 2026-09-25 before freezing. |
| `pi-hashline-edit-pro` upstream renamed 6 files in the 90 days before 2026-09-25, including `prompts/replace-flat.md` in `cbd5fce`. | `git log -M --diff-filter=R` on `origin/master`. |
| `git apply -3` falls back to a three-way merge only when the base blobs the patch names exist in the local object store. | Git documentation for `git apply --3way`. |
| `git merge` detects renames by default through the `ort` strategy, while a patch carries a rename only when the diff was produced with `-M`. | Git documentation for `git merge` and `git diff -M`. |
| When a fork merges upstream without cherry-picking, the merge base of each merge equals the upstream commit merged the previous time. | Git's merge-base definition; unverified on these histories. |

| Claim | Honest prior |
| --- | --- |
| C1 | Likely for both candidates. |
| C2 | Likely for B. Uncertain for A, because `git apply -3` merges per hunk and may report a different conflicted set. |
| C3 | Likely for B. Uncertain for A. |
| C4 | Likely, if the merge-base prior holds on the R8 history. |
| C5 | Likely for A, which applies inside the directory. Uncertain for B, whose copy-back step could touch other paths. |
| C6 | Uncertain for both, because `git merge` and `git apply` may open an editor or leave state behind. |
| C7 | Likely for both, given relative diffs and a scratch tree built from the subdirectory. |

The spike is still worth running because C2, C3 and C6 are uncertain, and they decide whether the scheduled sync can run without a person present.

## Time box and budget

| Item | Value |
| --- | --- |
| Time box | One session, run after SPIKE-0001 settles, because SPIKE-0001 decides the package directory this spike merges into. |
| Model calls | None. |
| Harness runner | This session builds and runs every harness. |

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

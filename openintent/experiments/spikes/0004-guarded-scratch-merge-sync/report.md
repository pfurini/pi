---
id: SPIKE-0004
title: Can a guarded scratch-merge sync reproduce a fork's real upstream syncs for a ported package, report four distinct outcomes, and refuse an unverified or rewritten base?
status: settled
kind: spike
date: 2026-09-25
verdict: PROVEN
settled: 2026-09-25
frozen-at: de669e504d0cf32a40f6941d95c7742fcb073057
unblocks:
  - .pi/skills/sync-upstream/SKILL.md
  - .pi/skills/port-extension/SKILL.md
  - docs/adr/ADR-0009-built-in-extensions.md
---

# Can a guarded scratch-merge sync reproduce a fork's real upstream syncs for a ported package, report four distinct outcomes, and refuse an unverified or rewritten base?

## Verdict

`PROVEN`. The guarded scratch-merge sync reproduced Git's automatic result on the fork's five real pi-claude-bridge syncs in order (`spike/runs/R1.txt` to `spike/runs/R5.txt`). Every recorded base equalled Git's merge base. All ten claims are proved. The sync reported four distinct outcomes, and refused every unverified, rewritten, missing or dirty case without changing anything. No restriction from the frozen list applies.

**Why `PROVEN` and not `CONDITIONAL`.**

The frozen `PROVEN` row reads: "C1 to C10 are all proved on the frozen replay set."
Every claim is marked proved in the Claims table, from the run files it names.
The conflict markers never mattered: every conflicted set equals Git's, and every other file is byte-identical.

**What the verdict establishes for the sync skill.**

| Rule | Evidence |
| --- | --- |
| The upstream record is `UPSTREAM.json` with `repository`, `path` and `base`, and every commit that changes it carries `Upstream-Base: <base>`. | `spike/runs/G2a.txt`, `spike/runs/G2b.txt` |
| A sync refuses before merging when the record is unverified, the package directory is dirty, or the base is not an ancestor of the new commit. | `spike/runs/G1.txt` to `spike/runs/G4.txt` |
| A sync reports up to date itself when the upstream subtree is unchanged, and advances only the base. | `spike/runs/U1.txt`, `spike/runs/U2.txt` |
| The merge runs in a scratch repository with Git's own rename and conflict handling, and its result replaces the package directory. | `spike/runs/R1.txt` to `spike/runs/R6.txt`, `spike/runs/K1.txt` |
| The sync stages its result with `git add -A -f`, so files Pi's `.gitignore` matches survive. | `spike/runs/R1.txt`, `spike/runs/K1.txt` |
| Exit 0, 1, 2 and 3 and their status lines are enough for an unattended caller to route the outcome. | Every run file's `SYNC OUTCOME` and `sync-exit` lines |

**Limits the verdict carries forward.**

| Limit | Where it belongs |
| --- | --- |
| SPIKE-0002's other failure mode, a verified ancestral base while the Pi side comes from another line, stays untested; no guard here detects it. | The sync skill's rules: only the sync and the port write the record. |
| The sync never fetches; a scheduled run must refresh the upstream clone first. | The sync skill. |
| Conflicts are left in the files for a person or an agent; resolution is outside this spike. | The sync skill and, later, the workflow. |

**Routing.**

The routing adds an upstream-sync section to `docs/adr/ADR-0009-built-in-extensions.md`, citing this report.
It creates `.pi/skills/sync-upstream/SKILL.md` and `.pi/skills/port-extension/SKILL.md`, both citing this report and SPIKE-0003.

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

The spike worktree was `~/.openintent/workspaces/pfurini/pi/worktrees/spike-0004`, branched from `frozen-at` `de669e5`.
The thing under test is `spike/sync-upstream.sh`. Every case ran it against a disposable worktree of the Pi repository created from `de669e5`, never against the spike branch.
The sources were the local fork repositories at the versions table's commits, reached by absolute path and read by hash.

| File | What it does | Command |
| --- | --- | --- |
| `spike/sync-upstream.sh` | The guarded scratch-merge sync, steps (1) to (6) of the frozen definition. | Called by the drivers through `run_sync`. |
| `spike/lib.sh` | Disposable worktrees, the port step, Git's automatic result, directory comparison, containment and index checks, and the run wrapper with its own process group, closed stdin and a 60-second alarm. | Sourced. |
| `spike/chain.sh` | C1: R1 to R5 in order. | `spike/chain.sh` |
| `spike/single.sh` | C2 and C3: R6 and K1. | `spike/single.sh <case> <repo> <subdir> <merge> <base> <name>` |
| `spike/uptodate-u2.sh` | C4, case U2. | `spike/uptodate-u2.sh` |
| `spike/guards.sh` | U1, G1, G2a, G2b, G3 and G4. | `spike/guards.sh` |
| `spike/all.sh` | Every case, with the fork working trees' status before and after. | `spike/all.sh` |

Raw output lives in `spike/runs/`, one file per case.

### Harness versions

| Thing | Version |
| --- | --- |
| Git | 2.55.0, `/opt/homebrew/bin/git` |
| Node.js | 26.10.0, for reading and writing `UPSTREAM.json` |
| bash, perl | GNU bash 5.3.20, perl 5.34.1 |

### Budget spent

No model was called.
The whole run took 28 seconds, within the one-session time box.

### Claims

| Claim | Result | Status | What showed it |
| --- | --- | --- | --- |
| C1, the fork's real sync chain | Holds: five base matches; conflicted sets of 11, 14, 11, 4 and 13 files equal Git's; every other file identical; exit 1 each time. | **proved** | `spike/runs/R1.txt` to `spike/runs/R5.txt` |
| C2, monorepo sub-folder source | Holds: one conflicted file, `CHANGELOG.md`, equal to Git's; comparison identical; exit 1. | **proved** | `spike/runs/R6.txt` |
| C3, clean merge | Holds: no conflicted file, comparison identical, exit 0 with `SYNC OUTCOME: clean`. | **proved** | `spike/runs/K1.txt` |
| C4, up to date | Holds: U1 exits 3 with an empty status; U2 exits 3 with only the base line changed. | **proved** | `spike/runs/U1.txt`, `spike/runs/U2.txt` |
| C5, rewritten base | Holds: G1 and G4 exit 2 with the ancestry refusal; status empty; `HEAD` unchanged. | **proved** | `spike/runs/G1.txt`, `spike/runs/G4.txt` |
| C6, unverified record | Holds: G2a and G2b exit 2 naming the trailer mismatch; status empty; `HEAD` unchanged. | **proved** | `spike/runs/G2a.txt`, `spike/runs/G2b.txt` |
| C7, uncommitted edits | Holds: G3 exits 2 naming the uncommitted changes; `README.md` and `HEAD` unchanged. | **proved** | `spike/runs/G3.txt` |
| C8, unattended outcomes | Holds: exit codes 0, 1, 2 and 3 with four status lines; every run under 1 second; no survivor in any process group. | **proved** | The `sync-exit` and `survivors` lines of every run file |
| C9, containment | Holds: no status entry outside the package directory in any run; both fork working trees unchanged. | **proved** | The containment lines of every run file; `spike/runs/00-fork-status.txt` |
| C10, files Pi's `.gitignore` matches | Holds: no result path missing from the index after R1 to R5 and K1; `TODO.md` tracked. | **proved** | `spike/runs/R1.txt` to `spike/runs/R5.txt`, `spike/runs/K1.txt` |

### Supporting conclusions

| Conclusion | Status | What showed it |
| --- | --- | --- |
| Before each chain step, the Pi side equals the fork state before the sync, so the chain replays the fork's real line. | **proved** | `spike/runs/R1.txt` to `spike/runs/R5.txt` |
| A base missing from the clone makes `git merge-base --is-ancestor` exit 128, which the sync treats as a refusal. | **proved** | `spike/runs/G4.txt` |
| Every disposable Pi worktree was removed and pruned. | **proved** | `spike/runs/00-fork-status.txt` |

### Re-verified by the coordinator

No subagent ran a harness.
The pre-freeze reviewer read the frozen block and re-derived the replay table only.
The coordinator read every claim from the raw run files that the Claims table names.

### What this spike did not test

| Not tested | Where it belongs |
| --- | --- |
| A verified ancestral base while the Pi side comes from another line | The sync skill's rule that only the sync and the port write the record. |
| Fetching upstream before a sync | The sync skill. |
| Resolving conflicts after a conflicted sync | The sync skill, later the workflow. |
| Binary-file conflicts, submodules and symlinks | A later spike, if a ported package carries them. |
| Git versions other than 2.55.0, and Linux | A release qualification. |

## Cleanup

| Path | What it holds | State |
| --- | --- | --- |
| `/tmp/spike-0004-scratch.*` | Seven scratch repositories and their merge logs | Present; safe to delete. |
| `/tmp/spike-0004-syncs.sh` | The coordinator's pre-freeze script that listed the real syncs | Present; safe to delete. |
| `/Users/paolof/Developer/ai/pi/.git/objects` | Commits from the disposable worktrees, now unreferenced | Present; `git gc` prunes them. |
| The disposable Pi worktrees under `/tmp/spike-0004-pi-*` | Removed and pruned | Gone. |

## Spike code

`evidence.patch`, beside this file: one squashed commit of the worktree branch. Built in an isolated worktree, never merged, never pushed as a branch, never opened as a pull request. To re-check a decayed verdict, run `/skill:opin-spike re-check` on this spike; it applies the patch into a fresh worktree.

Apply the patch onto `frozen-at` in a fresh worktree and run `spike/all.sh` from its root, with both fork repositories at the versions table's commits.
`spike/README.md` describes every script.

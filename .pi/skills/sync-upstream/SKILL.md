---
name: sync-upstream
description: Syncs one built-in package under packages/builtins/ with its upstream through the proven guarded merge. Use when the user asks to update, sync or backport upstream changes into a ported or built-in package, on a scheduled sync run, or when invoking /skill:sync-upstream.
---

# Sync a built-in package with its upstream

A package under `packages/builtins/<name>/` is fork-owned code copied from an upstream repository. `scripts/fork/sync-upstream.sh` merges new upstream commits into it through a guarded merge in a scratch repository. This skill runs the script in a disposable worktree, routes its exit code, verifies the result and commits it. Fast-forwarding `personal` needs the owner's approval. Built-ins load after the caller's factories, and `PI_FORK_BUILTINS=off` disables them; coding-agent's vitest config sets that switch, so upstream tests see no built-ins.

## Sources

| Source | Role |
| --- | --- |
| `docs/adr/ADR-0009-built-in-extensions.md` | The accepted decision. Its "Upstream sync" section holds the record, provenance and guard rules. |
| `openintent/experiments/spikes/0004-guarded-scratch-merge-sync/report.md` | SPIKE-0004: proof of the sync script on the fork's real sync history. |
| `openintent/experiments/spikes/0003-built-in-checkout-list/report.md` | SPIKE-0003: proof of the built-in mechanism and its mode harness. |
| `.pi/skills/port-extension/SKILL.md` | The port procedure, including mode validation and cutover. |
| `scripts/fork/sync-upstream.sh` | The sync itself. |

## Rules

- Only this skill and `.pi/skills/port-extension/SKILL.md` write `UPSTREAM.json`. Never edit the record by hand. The sync refuses a record without its trailer.
- Every commit that changes `UPSTREAM.json` carries the trailer `Upstream-Base: <base>` as its last paragraph. The base is the full 40-hex value the record holds.
- Sync one package per run, and commit one package per commit.
- Run unfenced. The sync reads upstream clones outside the fence's grants.
- Run in a disposable worktree on a sync branch. Never pass `.` in the main checkout, because other Pi sessions share it.
- The script never fetches. Refresh the upstream clone first. The clone stays read-only otherwise.
- Never change the script's behavior. The SPIKE-0004 verdict covers its exact steps; a change needs a new spike.
- Builds use `npm run build:offline`. `npm run build` regenerates model data over the network.
- Never run the release scripts (`version:*`, `release:*`, `publish`) on `personal`.
- `AGENTS.md` applies. Stage explicit paths. Commit a lockfile change only with the owner's approval and `PI_ALLOW_LOCKFILE_CHANGE=1`.
- The script's own `git add -A -f -- <dir>` is limited to one package directory in a disposable worktree. The `AGENTS.md` ban on `git add -A` still applies to every command you type.

## Steps

1. **Create the sync worktree.**
   - Run `git worktree add -b sync/<name>-<date> /tmp/pi-sync-<name> personal`.
   - Copy `packages/ai/src/providers/data/` from the main checkout, because Git ignores it.
   - Run `npm install --ignore-scripts`.
2. **Check the package.** `git status --porcelain -- packages/builtins/<name>` must print nothing. Read `repository`, `path` and `base` from `packages/builtins/<name>/UPSTREAM.json`.
3. **Refresh the clone.** Run `git -C <repository> fetch upstream`. Resolve the new commit to 40 hex, usually `git -C <repository> rev-parse upstream/main`. Ask the owner when the branch is unclear.
4. **Preview.** Run `git -C <repository> log --oneline <base>..<new> -- <path>`.
5. **Run the sync** from the worktree root: `scripts/fork/sync-upstream.sh /tmp/pi-sync-<name> packages/builtins/<name> <new>`. Keep its full output. Record the path on its `scratch:` line, when one appears.
6. **Route the outcome** by exit code.

| Exit | Status line | What to do |
| --- | --- | --- |
| 3 | `SYNC OUTCOME: up to date` | The script rewrote only the base and left `UPSTREAM.json` unstaged. When `git status --porcelain` lists it, commit it alone with the trailer. Otherwise nothing is due. |
| 0 | `SYNC OUTCOME: clean` | Review `git diff --cached -- packages/builtins/<name>`. Verify (step 7), then commit (step 8). |
| 1 | `SYNC OUTCOME: conflicts (n files)` | The conflicted files hold markers and are already staged. The `conflicted:` list is the only record. Resolve each listed file: keep the fork's intent and upstream's change. Stage with `git add -f -- <file>`. Ask the owner when a conflict needs a judgment call. Verify and commit. |
| 2, no `scratch:` line | `SYNC OUTCOME: refused (...)` | The script refused before any change. Stop and report the refusal line. Never work around it by editing the record or the working tree. |
| 2, with a `scratch:` line | `SYNC OUTCOME: refused (scratch merge failed without conflicts, ...)` | The script already rewrote and staged the package. Keep the scratch directory and its `.merge.log`. Restore the package with `git restore --source=HEAD --staged --worktree -- packages/builtins/<name>` in the sync worktree. Ask the owner before any retry. |

7. **Verify** after exit 0 or 1.
   - Run `npm install --ignore-scripts` first, always. The script's step (6) deletes every file in the package directory, ignored files and local `node_modules/` included. A lockfile-only install is not enough.
   - No marker remains: `grep -rnE '^(<{7}|={7}|>{7})( |$)' packages/builtins/<name>` prints nothing.
   - Read the `package-lock.json` diff. A lockfile change needs the owner's approval before its commit.
   - Run `npm run check`, and read its full output.
   - Run `./test.sh`. No failure may appear that is absent from a baseline run on the sync branch's start commit.
   - Run `packages/coding-agent/test/fork-builtins.test.ts` alone from `packages/coding-agent`: `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/fork-builtins.test.ts`.
   - When upstream changed tools, providers, commands or UI, validate every mode as `.pi/skills/port-extension/SKILL.md` describes.
8. **Commit.**
   - Stage with `git add -f -- packages/builtins/<name>`, plus `package-lock.json` when it changed.
   - Use `fix: sync <name> with upstream <short new>`, or `feat: ...` when upstream adds features. Use `fix: record <name> upstream base <short new>` after exit 3.
   - Record the outcome, the range and every conflict with its resolution in the commit body.
   - The last paragraph is `Upstream-Base: <new, 40 hex>`.
9. **Land.** Ask the owner before `git merge --ff-only <sync branch>` in the main checkout. A build there follows the port skill's cutover rules: a quiet interval, then `npm install --ignore-scripts` and `npm run build:offline`.
10. **Clean up.** Once the outcome is committed or discarded, delete only the scratch directory and `.merge.log` this run printed. Never delete `/tmp/spike-0004-*` by glob. Remove the sync worktree and branch with the owner's approval.
11. **Report** the outcome, the upstream range, each conflict and its resolution, and the verification results.

## Scheduled runs

A scheduled run reads `syncPolicy` from every `packages/builtins/*/UPSTREAM.json`, and handles one package at a time.

| `syncPolicy` | Scheduled behavior |
| --- | --- |
| `every-3-days` | Run steps 1 to 11 every 3 days. Commit up-to-date and clean outcomes that pass verification. |
| `monthly-review` | Once a month, run steps 3 and 4 only. Send the preview (`git log <base>..<new>`) to the owner, with no merge. |
| `none` | Skip the package. |

A run stops at a refusal, or at a conflict that needs a judgment call, and reports both. The OpenIntent workflow engine will take over scheduling later; the exit codes are its routing contract.

## Known limits

- A verified base that is an ancestor of the new commit, while the Pi side comes from another line, is undetectable (SPIKE-0004). The trailer rule prevents it.
- Binary conflicts, submodules, symlinks and Linux stay untested (SPIKE-0004).

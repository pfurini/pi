---
name: port-extension
description: Ports an extension from its fork repository into this Pi fork as a built-in package under packages/builtins/. Use when the user asks to port, vendor, integrate or bring an extension into Pi, to make an extension built-in or native, or when invoking /skill:port-extension.
---

# Port an extension into the Pi fork as a built-in

A built-in is an extension that this fork ships and owns. Its code lives in `packages/builtins/<name>/`. The fork-owned list in `packages/coding-agent/src/core/fork-builtins.ts` makes every `DefaultResourceLoader` load it, including under `noExtensions`. Built-ins load after the caller's factories, so upstream's `<inline:N>` numbering stays unchanged. `PI_FORK_BUILTINS=off` disables every built-in in one process. This skill copies the package, records its upstream, validates every mode, and cuts the live setup over. `docs/plans/built-in-extensions-phase1.plan.md` holds the worked example for `rpiv-ask-user-question`.

## Sources

| Source | Role |
| --- | --- |
| `docs/adr/ADR-0009-built-in-extensions.md` | The accepted decision, the footprint, the switch and the sync rules. |
| `openintent/experiments/spikes/0003-built-in-checkout-list/report.md` | SPIKE-0003: proof of the mechanism. Its `evidence.patch` holds the mode harness and the fixture provider. |
| `openintent/experiments/spikes/0004-guarded-scratch-merge-sync/report.md` | SPIKE-0004: proof of the sync that keeps a port current. |
| `.pi/skills/sync-upstream/SKILL.md` | The procedure for later upstream changes. |
| `docs/plans/built-in-extensions-phase1.plan.md` | Tasks T3 to T10 show this skill applied to the first port. |

## Rules

- The port commit holds the source bytes and file modes exactly, plus `UPSTREAM.json`. Later changes are separate fork-owned commits.
- A port changes no upstream-owned line. The first port installed the mechanism; ADR-0009's footprint table lists its lines.
- Only this skill and the sync skill write `UPSTREAM.json`. Every commit that changes it carries the trailer `Upstream-Base: <base>`.
- The upstream clone stays read-only, except for `git fetch upstream`.
- Never build the main checkout while `~/.pi/agent/settings.json` still lists the package. The live `pi` would load two copies, and duplicate tool handling is unverified.
- Builds use `npm run build:offline`. `npm run build` regenerates model data over the network and rewrites `packages/ai/src/models.generated.ts`.
- Never run the release scripts (`version:*`, `release:*`, `publish`) on `personal`. They would bump or publish the ported packages.
- `AGENTS.md` applies. Stage explicit paths. Commit a lockfile change only with the owner's approval and `PI_ALLOW_LOCKFILE_CHANGE=1`.

## Inputs

| Input | Example |
| --- | --- |
| Clone | `/Users/paolof/Developer/ai/rpiv-mono` |
| Subdirectory | `packages/rpiv-ask-user-question`, or empty for the repository root |
| Fork commit | 40-hex id, usually the fork branch head |
| Upstream ref | `upstream/main` |
| Target | `packages/builtins/<name>/` |
| Sync policy | `every-3-days` (default), `monthly-review` or `none` |

## Classify the extension first

Read the source and record each row before copying anything.

| Check | What to look for | Why it matters |
| --- | --- | --- |
| Registrations | `registerTool`, `registerProvider`, `registerCommand`, `registerFlag`, `registerShortcut`, renderers, `pi.on(...)` hooks | Everything must work through the extension API. Nothing moves into core. |
| UI | `ctx.ui.custom()` | RPC mode returns nothing from `custom()`. The extension needs its own RPC fallback, as `rpiv-ask-user-question` ships. |
| Providers | `registerProvider` inside the factory | Registration must finish in the factory, so model resolution sees it. |
| Dependencies | `dependencies` and `peerDependencies` | External packages change the lockfile. Peers such as `@earendil-works/*` and `typebox` must resolve to the monorepo's copies. |
| Runtime state | Files under `~/.pi/agent/`, `~/.config/`, caches, logs | A fenced session still needs grants for them. The port removes only the grant on the fork checkout. |
| External programs | `spawn`, `execFile`, network hosts, credentials | The fence needs the matching grants or proxy rules. |
| Names | Tool, command and provider names | A name must not collide with another built-in or a core tool. |
| Ignored paths | Files Pi's `.gitignore` matches, such as `TODO.md` | Stage with `git add -f`, or the file disappears from the commit. |
| Tests | The package's `test` script and its test imports | Tests that need the origin's tooling cannot run in Pi (step 11). |

## Steps

1. **Check the source.**
   - `git -C <clone> rev-parse HEAD` equals the fork commit. The live setup loads the clone's working tree, and the port copies the commit, so the two must match.
   - `git -C <clone> status --porcelain -- <subdir>` prints nothing.
   - Untracked files outside `<subdir>` are allowed. Record them for the results file.
2. **Compute the base.** Run `git -C <clone> merge-base <fork commit> <upstream ref>`, as 40 hex digits. For a source that is not a fork, the base is the upstream commit copied.
3. **Create the worktree.** Work on a feature branch in a disposable `/tmp` worktree, never in the main checkout.
   - `git worktree add -b feat/port-<name> /tmp/pi-port-<name> personal`.
   - Copy `packages/ai/src/providers/data/` from the main checkout, because Git ignores it.
4. **Extract.** Run `git -C <clone> archive <fork commit> <subdir> | tar -x -C <temp>`.
5. **Run the pre-checks** on the extracted copy, before moving it into place.
   - `git -C <Pi worktree> check-ignore --no-index <paths>` lists the files Pi's `.gitignore` would drop.
   - `grep -rlI $'\r' <copy>` lists text files with CR bytes. `.gitattributes` would normalize them at commit.
   - `find <copy> -type l` lists symlinks. `git -C <clone> ls-tree -r <fork commit> -- <subdir> | grep '^160000'` lists submodules.
   - Stop and ask the owner when any list is non-empty. Ignored paths alone only require `git add -f` at commit.
6. **Copy.**
   - Move the extracted package directory to `packages/builtins/<name>/`.
   - Extract a second archive into another temporary directory. `diff -r` against it must print nothing, and file modes must match.
   - Never reformat a ported file. Biome and `tsgo` skip `packages/builtins/`.
7. **Record.** Write `packages/builtins/<name>/UPSTREAM.json`. Keep `upstream` first, because the sync rewrites the first `"base"` key.

   ```json
   {
   	"upstream": {
   		"repository": "<absolute path of the local clone>",
   		"url": "<upstream remote URL>",
   		"path": "<subdirectory in the upstream repository, or empty>",
   		"base": "<40-hex base>"
   	},
   	"fork": {
   		"repository": "<fork remote URL>",
   		"branch": "<fork branch>",
   		"commit": "<40-hex fork commit>"
   	},
   	"syncPolicy": "every-3-days"
   }
   ```

   The sync script reads only `upstream.repository`, `upstream.path` and `upstream.base`. `url` and `fork` are informational. `syncPolicy` takes one of these values:

   | Value | Scheduled behavior |
   | --- | --- |
   | `every-3-days` | The default. The package syncs every 3 days. |
   | `monthly-review` | The owner receives a monthly preview of upstream commits, with no merge. |
   | `none` | The scheduled sync skips the package. |

8. **Register.**
   - Add the package name to `FORK_BUILTIN_PACKAGES` in `packages/coding-agent/src/core/fork-builtins.ts`.
   - Add one assertion to `packages/coding-agent/test/fork-builtins.test.ts` for each tool, provider and command the package registers. The rpiv test "registers the tools of rpiv-ask-user-question" is the pattern.
9. **Install and check.**
   - Run `npm install --ignore-scripts`. Do not use `npm ci`, because it refuses an out-of-sync lock.
   - Read the `package-lock.json` diff. Expect only the workspace link and the package's external dependencies.
   - Run `npm run check` and read its full output. It must pass with the shrinkwrap and install lock unchanged.
   - Run `./test.sh`. No failure may appear that is absent from a baseline `./test.sh` run on the start commit.
10. **Commit the port.**
   - Stage the package with `git add -f -- packages/builtins/<name>`, plus `fork-builtins.ts`, `fork-builtins.test.ts` and `package-lock.json`.
   - `git add -f` also stages ignored artifacts inside the package. A package `test` script run by `./test.sh` writes `node_modules/.vite/` there. Before staging, delete `packages/builtins/<name>/node_modules/` when it holds only such caches.
   - Before committing, compare the staged files with the source commit. `git ls-files -s -- packages/builtins/<name>` lists each staged mode, blob id and path. Without `UPSTREAM.json`, the list must equal `git -C <clone> ls-tree -r <fork commit>:<subdir>` in modes, blob ids and paths.
   - Use the message `feat(coding-agent): port <name> as a built-in`. Its last paragraph is `Upstream-Base: <base>`.
   - The lockfile needs the owner's approval and `PI_ALLOW_LOCKFILE_CHANGE=1`.
11. **Drop an unrunnable test script.** When the package's tests need the origin's tooling, remove its `test` script in a separate owned commit. `npm test --workspaces --if-present` then skips it, and `./test.sh` stays green. The commit does not touch `UPSTREAM.json`, so it needs no trailer.
12. **Sync once.** Run `.pi/skills/sync-upstream/SKILL.md` against the fresh port. Expect exit 3 when upstream has not changed the package since the base.
13. **Validate every mode** (step list below). A failed check blocks the cutover, unless the owner waives it explicitly.
14. **Cut over** (step list below), with the owner's approval for every action in the main checkout.
15. **Record** everything in a results file (last section).

## Validate every mode

Validate in a separate detached worktree, never in the implementation worktree. Never commit from it.

1. Run `git worktree add --detach /tmp/pi-validate-<name> <branch>`. Copy `packages/ai/src/providers/data/` into it.
2. Extract `spike/harness/` from SPIKE-0003's `evidence.patch` into the worktree. Create `spike/runs/`, because every script writes there and none creates it.
3. Apply `packages/builtins/spike-fixture-provider/` from the same patch, and append `"@pi-fork/spike-fixture-provider"` to `FORK_BUILTIN_PACKAGES`. Seven of the eight scripts select its network-free `spike-fixture/echo` model.
4. In `spike/harness/c9-missing.sh`, change both `npm run build` calls to `npm run build:offline`. The script also writes fixed `/tmp/spike-0003-*` paths, and earlier runs may have left files there. Rename those paths to names this port owns, such as `/tmp/pi-port-<name>-c9*`, and record them for cleanup.
5. Run `npm install --ignore-scripts` and `npm run build:offline`.
6. Adapt tool names and prompts in the harness to the package. Run each script from the worktree root, with a unique label per run.
7. Record the exit code of every command. A nonzero exit fails the check.

| Check | Harness | Pass condition |
| --- | --- | --- |
| Interactive TUI through the bundle | `c1-tui.sh`, which drives `pty_drive.py` through `uv run --with pyte` | The package's UI renders, and the tool result returns. |
| RPC mode | `c2-rpc.mjs` | Every UI call falls back to an RPC extension UI request. |
| SDK services and allowlist | `c3-c5-sdk.mjs`, `c3-registry-detail.mjs`, plus one services session created without a `tools` option | Each tool is present by default in `getAllTools()` and active. It is absent from `getAllTools()` when a `tools` allowlist omits it. Both SPIKE-0003 scripts always pass `tools`, so only the extra session proves the default. |
| Bare import and third-party loader | `c4-direct-import.mjs <label> bare-only` | The built-in loads. |
| Print mode | `c5-cli.sh` | Every command exits 0. The `-p` run prints the fixture's echo. |
| Outside consumer through a symlink | `c8-outside.sh` | The built-in loads through the linked checkout. |
| Missing package, end to end | `c9-missing.sh`, run last | The session starts, `errors` names the missing package, and the tools stay active. The rebuild after the restore succeeds. |
| Unbundled CLI | `PI_BIN=$PWD/packages/coding-agent/dist/cli.js spike/harness/c5-cli.sh <label>` | The same as print mode. `~/.pi-fence/entry.json` launches this entry. |
| `PI_FORK_BUILTINS=off` | The CLI with `--no-extensions -e <absolute path of packages/builtins/spike-fixture-provider/index.ts>`, and a copy of `c3-c5-sdk.mjs` with the fixture in `additionalExtensionPaths` | The CLI prints the fixture's echo. The SDK session holds none of the package's tools. A relative `-e` path fails when the CLI runs from another directory. |

The fenced check needs a `settings.json` without the package entry, so it runs at cutover.

## Cut over

Other Pi sessions share the main checkout. Every step there needs the owner's approval. Agree a quiet interval with the owner for steps 2 to 4: no new Pi session starts, and nobody edits the main checkout.

1. Confirm that the main checkout is on `personal`, and run `git status --short`. Any entry outside the expected set means stop and ask, because the build compiles the working tree.
2. Run `git merge --ff-only <branch>` in the main checkout.
3. Back up `~/.pi/agent/settings.json` and record its SHA-256. Remove the package entry and its adjoining comma. Verify with `JSON.parse`, and record the new SHA-256.
4. Run `npm install --ignore-scripts`, then `npm run build:offline`, in the main checkout.
5. Start a fresh fenced session with `pi --profile general`, and ask the model to call one of the package's tools. The `pi` on PATH is the pi-fence launcher, and it starts `~/.pi-fence/entry.json`'s `piEntry` with credentials. Do not use `pi-fence run`: it wraps other programs and passes no credentials. Grep that launch's journal under `~/.pi-fence/violations/` for the fork checkout's path; expect no hit. `auth.json` read denials are normal.
6. Start a fresh unfenced session with `pi --unfenced`, and confirm the tool once more. Plain `pi` is fenced, so it does not count.

Step 3 precedes step 4 on purpose. New sessions lack the tool until the build finishes, but they never load two copies.

**Rollback.** pi-fence does not forward `PI_FORK_BUILTINS`, so the rollback disables the built-in in code first. Every step needs the owner's approval.

1. Run `git revert --no-edit` on each port commit, newest first. The lockfile change needs `PI_ALLOW_LOCKFILE_CHANGE=1`.
2. Run `npm install --ignore-scripts` and `npm run build:offline`.
3. Restore the entry in `settings.json`. Copy the backup back when the file's hash still equals the post-edit hash. Otherwise re-add the one entry by hand.

Unfenced sessions may use `PI_FORK_BUILTINS=off` as a stopgap. Never use `git reset --hard`.

## Record the results

Write `docs/plans/<port>.results.md`, and copy the validation worktree's `spike/runs/` into an evidence directory beside it. The results file records these items:

- every commit, with its hash;
- the baseline `./test.sh` summary and each later comparison;
- the untracked source files found in step 1;
- the sync outcome, its range, its conflicts and its scratch path;
- each mode check, with its exit codes and any waiver;
- both `settings.json` hashes and the backup path;
- the cutover checks;
- every open owner action, such as fence grants and OpenIntent amendments.

Remove the worktrees and temporary paths only with the owner's approval. Delete only paths this port recorded, never a `/tmp/spike-000*` glob.

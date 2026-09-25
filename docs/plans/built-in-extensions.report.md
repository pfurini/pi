# Built-in extensions: handoff report for the implementation plan

This report is the input for `/skill:prp-plan`. The original session `01a0d784-32e9-7659-b244-25ac3231a26b` wrote Sections 1 to 8 on 2026-09-25. It wrote them from a fork taken at entry `cf915207`, after the four spikes and before any port. The model marks claims it could not verify as unverified. Section 9 records the repository state after the session; a later step verified it directly. Verify the rest against the cited sources before planning on it.

---

**Branch and state at handoff.** The Pi fork is at `/Users/paolof/Developer/ai/pi`, on branch `personal`, which is not pushed. Four spikes are settled. SPIKE-0001 and SPIKE-0002 are `DISPROVEN`. SPIKE-0003 and SPIKE-0004 are `PROVEN`. ADR-0009 records the proven mechanism and the sync method. `scripts/fork/sync-upstream.sh` holds the proven sync script. Nothing has been ported yet.

---

## 1. Goal and scope

### 1.1 Goal

The owner uses a set of Pi extensions every day. The goal is to make them part of the fork itself.

| Aspect | Target |
| --- | --- |
| Location | Each ported extension lives in the Pi monorepo as its own package, under `packages/builtins/<name>/`. |
| Loading | Pi loads it as a built-in. It needs no `settings.json` entry, no install, no CLI flag and no pi-fence grant. |
| Capability | Everything the extension provides must keep working: tools, providers, commands, flags, renderers, event hooks and UI, in the TUI, RPC, print and SDK modes. |
| Ownership | The fork owns each ported package's code and edits it freely. |
| Upstream | Each package takes upstream changes through a scheduled, directory-scoped three-way sync, driven by a skill now and by an OpenIntent workflow later. |
| Merge hygiene | Upstream Pi merges must stay nearly conflict-free, so hot upstream files receive only a few added lines (ADR-0003). |
| Consumers | Fenced sessions and the OpenIntent workflow engine treat these tools as always present. Neither needs exceptions, grants or approvals for them. |

### 1.2 Non-goals for the plan

- Publishing the fork to npm, or building a Bun or single-executable binary.
- Porting OpenIntent's kernel (`@juicesharp/rpiv-workflow`) or other rpiv packages beyond `rpiv-ask-user-question`.
- Editing pi-fence code. The owner edits pi-fence profiles personally.
- Editing the OpenIntent design directly. It changes only through its own amendment process (Section 5.6).

### 1.3 User requirements and decisions

| # | Decision | Reason given or implied |
| --- | --- | --- |
| D1 | Everything an extension provides must work, not just tools. | Extensions also supply providers, RPC UI and hooks. |
| D2 | Ported packages stay separate packages inside this monorepo. | Isolation from core packages and minimal upstream conflict. |
| D3 | The fork owns the code; ported packages drift from upstream from day zero. | Several sources are already the owner's forks. |
| D4 | Import by copying. No git subtree. | The owner chose it explicitly. |
| D5 | Upstream updates happen as a targeted three-way merge inside Pi, not as merge-then-copy in the fork repositories. | Copying from the fork would overwrite fixes made inside Pi. |
| D6 | Track each package's upstream source inside the monorepo (`UPSTREAM.json`). | Enables future targeted sync sessions. |
| D7 | Package names do not matter; keep upstream names. | The owner does not care, and keeping them minimizes sync conflicts. |
| D8 | Keep `@juicesharp/rpiv-config` as an npm dependency for now. | It is not fundamental; it can be ported later if needed. |
| D9 | Design choices are proven by spikes (opin-spike method) before an ADR records them. | The owner corrected the assistant for proposing to defer a decision into an ADR. |
| D10 | Injection mechanism: option C, the checkout list. | Chosen by the owner, then proven in SPIKE-0003. |
| D11 | Option B is disliked. If C had failed, the plan was a joint brainstorm, not a fallback to B. | Stated by the owner. |
| D12 | `pi-hashline-edit-pro`: copy and own it (option 3). Change the code directly, sync from upstream on a regular cadence. No patch queue. | Stated by the owner. |
| D13 | One sync skill drives upstream updates for every ported package on a schedule (for example every 3 days). It later becomes a workflow. | Stated by the owner. |
| D14 | `vcc_recall` is rewritten natively; the rest of `pi-vcc` is dropped. | The owner does not care about upstream or the other features. |
| D15 | Node 26.10.0, upgraded by Homebrew during the session, is the runtime. | The owner's ruling. |
| D16 | A fenced session never trusts a project. Trust is set once from an unfenced session with `pi trust --unfenced`, and the fence only reads it back. | The owner's design; not a bug. |
| D17 | The owner fixes pi-fence's base profile personally. | The owner's statement. |
| D18 | The workflow is: this report, then `/skill:prp-plan`, then `/skill:prp-plan-review`, then `/skill:prp-implement`. | The owner's scope change. |

### 1.4 Rejected options

| Option | Why rejected |
| --- | --- |
| Git subtree | The owner chose copying (D4). |
| Merge upstream in the fork repository, then copy into Pi | Overwrites Pi-side fixes, for example fixes made after an upstream Pi API rename. |
| CLI-only injection through `main.ts` `builtInExtensions` | Only the CLI's `main()` reads that list. SDK consumers such as the OpenIntent worker and pi-subagents' loader never see it. |
| Candidate A: coding-agent declares each ported package as a dependency | One upstream-owned line per port, next to a line upstream changes almost every release. It patches the lock generators. The published shrinkwrap would resolve to upstream's npm tarball. |
| Candidate B: an empty registry plus a fork-owned distribution package that owns `pi` | Every SDK consumer must import the fork entry, and forgetting it fails silently. The CLI leaves upstream's bundle. The owner dislikes it. |
| `git apply -3` sync (SPIKE-0002 candidate A) | Aborts the whole patch on a modify/delete conflict. Exit code 1 means both "applied with conflicts" and "applied nothing". |
| Hashline as a pinned npm dependency plus a patch file | The owner chose to own the code (D12). |
| Hashline via a patch queue | The owner rejected it (D12). |

### 1.5 Standing preferences and constraints

**From the owner's global instructions:**
- Durable prose follows the register: at most 25 words per sentence, active voice, one name per thing, no coined compounds, and tables for parallel items.
- Everything durable is in English.
- Python runs only through `uv` or `uvx`, never `pip`.
- GitHub content is read through `fetch_content`. Package versions are verified before use.
- Use TokenSave first for code discovery in repositories that have `.tokensave/`. The Pi repository has one.
- Use cmux, not tmux. Note that tmux is not installed on this machine.

**From the Pi repository's `AGENTS.md`:**
- Never commit unless asked. Stage explicit paths only.
- Never use `git add -A`, `git add .`, `git stash`, `git reset --hard`, `git checkout .` or `--no-verify` in the main checkout. Other sessions may share it.
- Run `npm run check` after code changes and fix everything it reports.
- Never run `npm run build` or `npm test` unless the user asks. Use `./test.sh` for tests.
- Install with `npm install --ignore-scripts`.
- Direct external dependencies use exact versions, except under `packages/builtins/` (Section 3.1).
- The pre-commit hook blocks lockfile commits unless `PI_ALLOW_LOCKFILE_CHANGE=1` is set.
- Commit messages follow `{feat,fix,docs}[(ai,tui,agent,coding-agent)]: <message>`.
- No changelog entries on branches other than `main`, and `personal` is not `main`.
- Use only erasable TypeScript, no `any`, and top-level imports only.
- Never edit `packages/ai/src/models.generated.ts` by hand.
- ADR-0003 applies: new subsystems go in new files, and hot upstream files get thin call sites only.

---

## 2. Spikes 0001 to 0004

**Tooling.** Every spike ran through the opin-spike scripts at `/Users/paolof/.openintent/workspaces/pfurini/OpenIntent/worktrees/workflow-engine/.pi/skills/opin-spike/`.
- **Records:** `openintent/experiments/spikes/NNNN-<slug>/report.md` in the Pi repository.
- **Registry:** `openintent/experiments/README.md`.
- **Evidence:** each settled spike's `evidence.patch` holds its whole harness and raw runs.

### 2.1 SPIKE-0001: `DISPROVEN`

| Field | Value |
| --- | --- |
| Record | `openintent/experiments/spikes/0001-built-in-extension-injection/report.md` |
| Commits | frozen `a63149b`, run `a6db39e`, settled `c373029` |
| Question | Can the Pi fork ship an extension as a built-in that every session path loads, within 15 added lines in upstream-owned files and without rewriting the ported files? |
| Candidates | A: loader list, with coding-agent depending on the ported package. B: registry plus distribution package. |
| Verdict | `DISPROVEN` for both candidates. |
| Deciding evidence | C3 used "tool registry" without defining it. The harder reading is `AgentSession.getAllTools()`, which the `tools` allowlist filters. A built-in outside the allowlist never enters that registry (`spike/runs/*-C3-registry-detail.json`). |
| Proved anyway | Every other claim, for both candidates: C1, C2, C4, C5, C6 and C7. |
| Measured facts | A added 12 upstream-owned lines, plus 1 per extra built-in, and patched both lock generators. B added 11 lines. Under B, a bare SDK import received no built-ins. |
| Restrictions and rulings | Node changed from 26.8.2 to 26.10.0 at 09:57:55 UTC, and the owner ruled to use 26.10.0. The coordinator drove C6 and edited `settings.json` with approval. tmux was absent, so a Python pseudo-terminal drove the TUI. |
| Artifacts of note | `evidence.patch` contains `spike/candidates/A.patch` and `spike/candidates/B.patch`. |
| Known error in record | Its versions table attributes two untracked documents to pi-fence. They are `docs/rpiv-mono-overview.md` and `.pdf` in rpiv-mono. SPIKE-0002 records the correction. |

### 2.2 SPIKE-0002: `DISPROVEN`

| Field | Value |
| --- | --- |
| Record | `openintent/experiments/spikes/0002-scoped-upstream-sync/report.md` |
| Commits | frozen `c2864a4`, run `319d8e4`, settled `0be71ca` |
| Question | Can a merge scoped to one package directory, from a recorded upstream base, reproduce the result of a full Git merge in the fork repository? |
| Candidates | A: `git apply -3`. B: a scratch merge in a temporary repository. |
| Verdict | `DISPROVEN` for both candidates. |
| Deciding evidence | The chain case R8 was not one downstream sync sequence. Two of its links did not descend from the previous merge (`spike/runs/00-replay-provenance.txt`). A also failed C2 on R6 and R7, aborting on modify/delete conflicts. |
| Findings kept | B matched Git on all nine single merges, including 13-file and modify/delete conflicts, and on an upstream rename. |
| Findings kept | B reported "up to date" as a clean merge. Under a wrong base, B exited 0 and silently dropped upstream changes. |
| Incident | A harness bug wrote 100 files into `/Users/paolof/Developer/ai/pi-claude-bridge/packages/`, because `checkout-index --prefix` resolves relative to the source repository. They were removed at once. That checkout is clean at `edf19ed`. |
| Known error in record | Its harness README says `b0db315` sits off the first-parent line. It lies on that line. SPIKE-0004's priors correct it. |

### 2.3 SPIKE-0003: `PROVEN`

| Field | Value |
| --- | --- |
| Record | `openintent/experiments/spikes/0003-built-in-checkout-list/report.md` |
| Commits | frozen `42cf76d`, run `8184c76`, settled `281c073` |
| Question | Can a fork-owned list inside coding-agent that resolves ported packages through the monorepo's workspace links make every session path load them, within 10 added upstream-owned lines and none per further built-in? |
| Verdict | `PROVEN`. All of C1 to C9 are proved, and no frozen restriction applies. |
| Deciding evidence | 9 added lines in upstream-owned files, and 0 added for the second built-in (`spike/runs/C7-measure-1-ported-only.txt`, `C7-measure-2-with-fixture.txt`). |
| Claims proved | C1 TUI through the esbuild bundle. C2 RPC `select`. C3 allowlist semantics. C4 in-process loader and bare import. C5 provider built-in. C6 fenced run with no `rpiv-mono` grant. C7 hygiene. C8 outside consumer through a symlink. C9 named error for a missing package. |
| Deliberate limits | Works only from this monorepo checkout. `check:runtime-deps` does not see names held as data. `check:pinned-deps` and `check:ts-relative-imports` skip `packages/builtins/`. |
| Open items | OpenIntent's real fenced worker entry. A second port with external dependencies. The release scripts. Bun, SEA and npm publishing. |
| Pre-freeze review | An independent agent reviewed the frozen block and found five blockers, all fixed before freezing. |

### 2.4 SPIKE-0004: `PROVEN`

| Field | Value |
| --- | --- |
| Record | `openintent/experiments/spikes/0004-guarded-scratch-merge-sync/report.md` |
| Commits | frozen `de669e5`, run `a2de934`, settled `c10503f` |
| Question | Can a guarded scratch-merge sync reproduce a fork's real upstream syncs for a ported package, report four distinct outcomes, and refuse an unverified or rewritten base? |
| Verdict | `PROVEN`. All of C1 to C10 are proved. |
| Deciding evidence | The five real pi-claude-bridge syncs, run in order, reproduced Git's automatic result. Every recorded base equalled Git's merge base. Conflict sets were 11, 14, 11, 4 and 13 files (`spike/runs/R1.txt` to `R5.txt`). |
| Other claims | R6 (rpiv sub-folder, 1 conflict). K1 clean merge, exit 0. U1 and U2 up to date, exit 3. G1 and G4 ancestry refusals. G2a and G2b trailer refusals. G3 refusal on a dirty directory. C8 distinct outcomes. C9 containment. C10 forced staging of `TODO.md`. |
| Open items | A verified ancestral base whose Pi side comes from another line (SPIKE-0002's mode) stays untested. The sync never fetches. It leaves conflict resolution to a person or agent. Binary conflicts, submodules, symlinks and Linux are untested. |
| Post-settle routing | Commit `384884d` added ADR-0009's "Upstream sync" section and `scripts/fork/sync-upstream.sh`, with a fork-owned header comment added to the script. |

### 2.5 Real-sync rule used by SPIKE-0004

This rule identifies which fork commits are real upstream syncs.
- Walk `git rev-list --first-parent personal`.
- For each commit `c`, compute `U(c) = git merge-base c upstream/main`.
- A real sync is a commit whose `U` differs from its first parent's, where the first parent `p` satisfies `p != U(p)`.

The rule found 5 real syncs on pi-claude-bridge. It found 1 real sync touching `packages/rpiv-ask-user-question` in rpiv-mono.

---

## 3. The proven design, as a specification

### 3.1 Built-in mechanism

**Files that change once, on the first real port.** Line counts come from SPIKE-0003's C7.

| File | Owner | Change |
| --- | --- | --- |
| `package.json` (root) | upstream-owned | Add `"packages/builtins/*",` after `"packages/*",` in `workspaces`. |
| `scripts/check-pinned-deps.mjs` | upstream-owned | After `const ignoredDirectories = new Set([".git", "dist", "node_modules"]);` add `ignoredDirectories.add("builtins");` |
| `scripts/check-ts-relative-imports.mjs` | upstream-owned | After `const ignoredDirectories = new Set([".git", "coverage", "dist", "node_modules"]);` add `ignoredDirectories.add("builtins");` |
| `packages/coding-agent/src/core/extensions/loader.ts` | upstream-owned | Append a blank line and the 3-line `loadExtensionFactoryFromPath` export shown below. |
| `packages/coding-agent/src/core/resource-loader.ts` | upstream-owned | Add `import { forkBuiltInExtensions } from "./fork-builtins.ts";`. After `this.extensionFactories = options.extensionFactories ?? [];` add `this.extensionFactories = [...forkBuiltInExtensions(), ...this.extensionFactories];` |
| `packages/coding-agent/src/core/fork-builtins.ts` | fork-owned, new | The list and its loader, shown below. |
| `package-lock.json` | generated | Rewritten by `npm install`. This needs `PI_ALLOW_LOCKFILE_CHANGE=1` at commit time. |

The total is 9 added lines in upstream-owned files, with none changed or removed. `packages/coding-agent/npm-shrinkwrap.json` and `packages/coding-agent/install-lock/` stay byte-identical.

**The export appended to `loader.ts`.** `ExtensionFactory` is already imported there.

```ts
export async function loadExtensionFactoryFromPath(extensionPath: string): Promise<ExtensionFactory | undefined> {
	return loadExtensionModule(extensionPath);
}
```

**The fork-owned `fork-builtins.ts`, as SPIKE-0003 built it.** Biome reformats the array onto multiple lines.

```ts
import { createRequire } from "node:module";
import { loadExtensionFactoryFromPath } from "./extensions/loader.ts";
import type { ExtensionFactory, InlineExtension } from "./extensions/types.ts";

const FORK_BUILTIN_PACKAGES: readonly string[] = ["@juicesharp/rpiv-ask-user-question"];

const requireFromHere = createRequire(import.meta.url);

function packageFactory(packageName: string): ExtensionFactory {
	return async (pi) => {
		const factory = await loadExtensionFactoryFromPath(requireFromHere.resolve(packageName));
		if (!factory) {
			throw new Error(`Built-in extension ${packageName} does not export a factory`);
		}
		await factory(pi);
	};
}

export function forkBuiltInExtensions(): InlineExtension[] {
	return FORK_BUILTIN_PACKAGES.map((name) => ({ name, factory: packageFactory(name), hidden: true }));
}
```

The exact committed file, as reformatted by Biome, is inside SPIKE-0003's `evidence.patch`. `npm run check` runs `biome check --write`. That command reformats this file and moves the new import in `resource-loader.ts` into alphabetical position. The line count stays unchanged.

**Each further port** adds one entry to `FORK_BUILTIN_PACKAGES`, one folder under `packages/builtins/`, and lockfile changes. It touches no upstream-owned line.

**Load order.** This is read from source, not re-measured.

1. `DefaultResourceLoader.reload()` runs `loadFinalExtensionSet`.
2. Path-based extensions load first through `loadExtensionsCached`. These are `settings.json` packages, discovered extensions, and `-e` or `additionalExtensionPaths`.
3. `loadExtensionFactories` then loads the factories. Fork built-ins come first, then the caller's factories. In the CLI, the caller's factories include `main.ts`'s upstream `builtInExtensions` (llama.cpp). In OpenIntent's worker, they include the approved selected factories.
4. Each built-in appears as `<inline:<package name>>` in `getExtensions().extensions`, with `hidden: true`.
5. A throwing factory lands in `getExtensions().errors` as `<inline:name>`, and loading continues.

**Modes proved (SPIKE-0003).**

| Mode | Entry that answered |
| --- | --- |
| Interactive TUI | `packages/coding-agent/dist/bundle/cli.js` |
| RPC mode | `packages/coding-agent/dist/bundle/cli.js --mode rpc` |
| Print mode (`-p`) | Same bundle, via C5 |
| SDK services, `createAgentSessionServices` | `packages/coding-agent/dist/index.js` |
| Third-party `DefaultResourceLoader` in the same process | `dist/index.js` |
| Bare `import "@earendil-works/pi-coding-agent"` | `dist/index.js` |
| Outside consumer through a `node_modules` symlink, OpenIntent's shape | `dist/index.js`, resolved through the symlink to its real path |
| Fenced, `pi-fence run --profile general` | Bundle |

**Not proved.**
- `packages/coding-agent/dist/cli.js`, the unbundled CLI that `~/.pi-fence/entry.json` launches. It uses the same module graph as `dist/index.js`, so this is inferred, not observed.
- `createAgentSession` via `sdk.ts:202`: inferred, because it constructs `DefaultResourceLoader`.
- The Bun binary, Node SEA and npm-published installs: expected to carry no built-ins.

**`noExtensions` behavior.**
- `noExtensions` and `--no-extensions` skip settings and discovered extension paths.
- They keep `-e` paths and every factory, so built-ins always load.
- A session's `tools` allowlist is the only proven control. A built-in tool outside the allowlist never enters `getAllTools()`, and `setActiveToolsByName` cannot enable it (SPIKE-0003 C3).
- A built-in's non-tool registrations run regardless of the allowlist. These include providers, commands, flags, renderers and event hooks. This follows from source reading and is unverified by a spike (Section 7, Q9).

**Visibility.** `hidden: true` removes a built-in from the interactive startup `[Extensions]` section (`interactive-mode.ts` near line 1731). The bug report still lists hidden extensions (`packages/coding-agent/src/core/bug-report.ts` near line 134).

**Resolution.** `createRequire(import.meta.url).resolve(name)` resolves through the root `node_modules` workspace link, and Node follows symlinks to real paths. The ported package's own dependencies, such as `@juicesharp/rpiv-config`, resolve from the checkout root. Peer imports of `@earendil-works/*` and `typebox` resolve through the loader's aliases or virtual modules. SPIKE-0001 and SPIKE-0003 observed both paths working.

### 3.2 Package layout, `UPSTREAM.json` and the trailer rule

**Layout.**
- `packages/builtins/<name>/` holds the package, byte-identical to its source commit at the port.
- The only addition at the port is `UPSTREAM.json`.
- File modes must match the source.
- Later edits are normal fork commits.

**`UPSTREAM.json` as the sync script reads it.** The script reads only the `upstream` object.

```json
{
	"upstream": {
		"repository": "<absolute path of a local Git clone that contains upstream history>",
		"path": "<subdirectory inside that clone, or empty string for the repository root>",
		"base": "<40-hex lowercase commit id>"
	}
}
```

| Rule | Why |
| --- | --- |
| `repository` must be a local clone path. The script runs `git -C "$repo"`. | SPIKE-0004 used local paths. **Conflict:** SPIKE-0003's port wrote a GitHub URL here. See Section 7, Q1. |
| `base` must match `^[0-9a-f]{40}$`. | Step (2) refuses any other form. |
| `upstream.base` must be the first `"base"` key in the file. | `write_base` rewrites the first match of `"base": "<hex>"` by regex. |
| At the port, `base` is `git -C <clone> merge-base <fork commit> upstream/main`. For non-forks, it is the upstream commit copied. | Makes the fork's own changes count as "ours" in the three-way merge. |
| Extra fields, such as `fork` or `url`, are allowed after `upstream`. | The script ignores them. Keep them after `upstream` to respect the first-`"base"` rule. |

**The `Upstream-Base` trailer rule.** Every commit that changes `packages/builtins/<name>/UPSTREAM.json` must carry this trailer in its message body:

```
Upstream-Base: <the 40-hex base now recorded in UPSTREAM.json>
```

The sync checks `git log -1 --format='%(trailers:key=Upstream-Base,valueonly)' -- <dir>/UPSTREAM.json`. The check applies to the port commit, every commit after a sync, and any hand edit of the record. Only the port and the sync may change the base (SPIKE-0004 limits).

### 3.3 Sync script interface

**Path.** `scripts/fork/sync-upstream.sh`. It is fork-owned, byte-identical to SPIKE-0004's `spike/sync-upstream.sh`, plus a header comment.

**Usage.**
```
scripts/fork/sync-upstream.sh <pi worktree> <package directory, relative> <new upstream commit>
```

It requires `git` and `node` on PATH. It never commits and never fetches.

| Step | Action | On failure |
| --- | --- | --- |
| (1) | Read `repository`, `path` and `base`. | exit 2, "record unreadable" |
| (2) | Compare the trailer of the latest commit touching `UPSTREAM.json` with `base`. | exit 2, "record: the latest commit of UPSTREAM.json carries Upstream-Base '...', not '...'" |
| (3) | `git status --porcelain -- <dir>` must be empty (tracked and untracked, ignored excluded). | exit 2, "uncommitted changes in <dir>" |
| (4) | `git merge-base --is-ancestor <base> <new>` in the clone. A commit counts as its own ancestor. | exit 2, "ancestry: ... (exit 1 or 128)". 128 means the base is missing from the clone. |
| (5) | If the upstream subtree at `base` equals the one at `new`, rewrite only the base value. | exit 3, "SYNC OUTCOME: up to date". The file is left modified and unstaged. |
| (6) | Three-way merge in a scratch repository: base subtree, `HEAD:<dir>` as ours, `new` subtree as theirs. Copy the result back, write the new base, run `git add -A -f -- <dir>`. | exit 0 "SYNC OUTCOME: clean". exit 1 "SYNC OUTCOME: conflicts (N files)", with the list after a `conflicted:` line. exit 2 if the merge fails with no conflicts. |

**Output conventions and side effects.**
- The script prints `record: ...`, `scratch: <dir> (merge exit N)` and `conflicted:` lines before the outcome line.
- Scratch repositories named `/tmp/spike-0004-scratch.XXXXXX` and their `.merge.log` are never deleted.
- Step (6) deletes everything in the package directory before copying, ignored files and any local `node_modules/` included.
- After exit 1, conflicted files contain markers **and are staged**. The Pi index shows no unmerged state. The script's `conflicted:` list is the only record.

### 3.4 What changes in pi-fence and OpenIntent

**pi-fence.**

| Item | Today | After the ports |
| --- | --- | --- |
| Read grants for fork checkouts | `derivedPackageReads` in `/Users/paolof/Developer/ai/pi-fence/src/profile/loader.ts` grants each local `settings.json` package's workspace root. Today it grants 7 checkouts, `rpiv-mono` included (SPIKE-0001 `spike/runs/C6-00-dry-run-general.txt`). | Removing a package from `~/.pi/agent/settings.json` removes its grant automatically. No pi-fence code change is needed. |
| Grant for the built-ins | Base profile read allow `~/Developer/ai/pi`. | Unchanged. It covers `packages/builtins/`. |
| Runtime-state grants | Base and store profiles grant, for example, `~/.pi/agent/claude`, `~/.pi/agent/claude-bridge-diag.log` (store only), `~/.pi/agent/pi-btw.json` and `~/.config/pi-hashline-edit-pro`. | Still needed. They cover files the extensions write, not their code. |
| Launch entry | `~/.pi-fence/entry.json` `piEntry` is `/Users/paolof/Developer/ai/pi/packages/coding-agent/dist/cli.js`. | Unchanged, but the main checkout must be rebuilt after each port. |
| Doorman | `extensions/lib/doorman.ts` `COVERED_TOOLS` decides which tool calls it inspects. | Unverified whether hashline's `read` or other ported tools need coverage. The plan must read this file. |
| Trust | `trust.json` is not writable inside the fence. Choosing "Trust" there crashes Pi with `EPERM` (SPIKE-0001 `spike/runs/B-C6-fenced-attempt1-trust-prompt.txt`). | Deliberate (D16). Trust new repositories and worktrees unfenced with `pi trust --unfenced`. |

**OpenIntent.** The work happens in the worktree `~/.openintent/workspaces/pfurini/OpenIntent/worktrees/workflow-engine`, branch `change/workflow-engine`. The design lives in `openintent/changes/workflow-engine/design.md`.

| Area | Current design | Needed change (via amendment, not direct edit) |
| --- | --- | --- |
| D8 worker resources | Discovery disabled; only selected, approved extensions load; missing resources refuse. | Built-ins load in every worker regardless (proved by C8). The design must name them as SDK-provided resources, governed by `toolSelection`. |
| D2 and D16 approval image | Extension sources are inventoried and approved. `acceptance-providers.json` roles `claude-bridge` and `glm-tweaks` select extension roots. | Once pi-claude-bridge is built in, the `claude-bridge` role selects no extension, only provider and model. Built-in code sits under the fork revision recorded as the SDK identity (inferred). |
| Readiness | `worker-policy-extension.ts` reports extensions and identities, and the host compares them with policy. | Unverified: whether unexpected `<inline:...>` extensions make readiness refuse. The plan must read `packages/workflow/src/pi/worker-entry.ts` and `worker-policy-extension.ts`. |
| ask-operator (D8, D11, Wave 9) | The worker transport refuses stray UI dialogs. | `ask_user_question` in RPC falls back to a `select` dialog, so worker `toolSelection` must exclude it. The ask-operator tool may reuse its question schema. |
| Setup | `scripts/setup-worktree.mjs` links `packages/workflow/node_modules/@earendil-works/pi-coding-agent` to the fork checkout. | Unchanged. This is exactly C8's shape. |

---

## 4. Port inventory

Upstream activity counts were measured with `git fetch` on 2026-09-25.

### 4.1 Summary

| Package | Local path | Origin (fork) | Upstream | Branch | Fork commit | Upstream base |
| --- | --- | --- | --- | --- | --- | --- |
| rpiv-ask-user-question | `/Users/paolof/Developer/ai/rpiv-mono`, subdir `packages/rpiv-ask-user-question` | `https://github.com/pfurini/rpiv-mono.git` | `https://github.com/juicesharp/rpiv-mono.git` | `personal` | `8403bb09464e956d01cb4caf957980aba670b5f2` (2026-09-24) | `d74b1c99830a565f3df3f37e0a36616d17ffc574` (verified merge-base) |
| pi-claude-bridge | `/Users/paolof/Developer/ai/pi-claude-bridge` | `https://github.com/pfurini/pi-claude-bridge` | `https://github.com/elidickinson/pi-claude-bridge.git` | `personal` | `edf19ed` (2026-09-24) | Unverified. Compute `merge-base edf19ed upstream/main`. The last real sync merged `07507489c0c54f7f978ab752eb9beb5cc0960f24`; `upstream/main` is `227f5eb`. |
| pi-hashline-edit-pro | `/Users/paolof/Developer/ai/pi-hashline-edit-pro` | none; clone of upstream | `https://github.com/YuGiMob/pi-hashline-edit-pro.git` | `master` | n/a; installed npm 4.4.1 plus patch | Unverified. The commit behind npm 4.4.1. Local `origin/master` is `68346e7`. |
| pi-subagents | `/Users/paolof/Developer/ai/pi-subagents` | `https://github.com/pfurini/pi-subagents.git` | `https://github.com/tintinweb/pi-subagents` | `personal` | Not recorded; read at port. | Compute merge-base; fork was 25 ahead, 0 behind. |
| pi-tasks | `/Users/paolof/Developer/ai/pi-tasks` | `https://github.com/pfurini/pi-tasks.git` | `https://github.com/tintinweb/pi-tasks` | `personal` | Not recorded | Compute; 6 ahead, 0 behind. |
| pi-tokensave | `/Users/paolof/Developer/ai/pi-tokensave` | `https://github.com/pfurini/pi-tokensave` | `https://github.com/dan-developer/pi-tokensave` | `personal` | Not recorded | Compute; 13 ahead, 0 behind. |
| pi-usage-bars | `/Users/paolof/Developer/ai/pi-usage-bars` | `https://github.com/pfurini/pi-usage-bars` | `https://github.com/hknet/pi-usage-bars` | `personal` | Not recorded | Compute; 41 ahead, **8 behind**. |
| vcc_recall (rewrite) | `/Users/paolof/Developer/ai/pi-vcc` (reference only) | none | `sting8k/pi-vcc` | `master` | Local clone 0.5.0; installed npm `@sting8k/pi-vcc` 0.8.0 | n/a; not a port |

### 4.2 Package facts

| Package | Name and version | Entry | Dependencies | Peers |
| --- | --- | --- | --- | --- |
| rpiv-ask-user-question | `@juicesharp/rpiv-ask-user-question` 2.11.0 | `index.ts` (TypeScript only) | `@juicesharp/rpiv-config ^2.11.0` | `@juicesharp/rpiv-i18n` (optional), `pi-coding-agent`, `pi-tui`, `typebox` |
| pi-claude-bridge | `pi-claude-bridge` 0.8.0 | `./src/index.ts`, no build | `@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk`, `cc-session-io`, `change-case` | `pi-ai`, `pi-coding-agent`, `pi-tui`, `typebox` |
| pi-hashline-edit-pro | `pi-hashline-edit-pro` 4.4.1 | `./index.ts` | `diff`, `file-type`, `typebox` (the patch moves it to peers), `xxhash-wasm` | `pi-coding-agent >=0.84.0`, `pi-tui` |
| pi-subagents | `@tintinweb/pi-subagents` 0.19.0 | `./src/index.ts` (has a `tsc` build script) | `croner`, `nanoid` | `pi-ai`, `pi-coding-agent`, `pi-tui`, `@sinclair/typebox`, `typebox` |
| pi-tasks | `@tintinweb/pi-tasks` 0.9.0 | `./src/index.ts` (has a `tsc` build script) | none | `pi-coding-agent`, `pi-tui`, `typebox` |
| pi-tokensave | `pi-tokensave` 0.1.0 | `src/index.ts` | none | `pi-coding-agent`, `pi-ai`, `typebox` |
| pi-usage-bars | `@hk_net/pi-usage-bars` 0.5.0 | `./extensions/usage-bars/index.ts` | none | `pi-coding-agent`, `pi-tui` |

### 4.3 Registrations, runtime state and external programs

These counts come from a grep survey. Tool names marked unverified need confirmation from source.

| Package | Registers | Runtime state | External programs |
| --- | --- | --- | --- |
| rpiv-ask-user-question | Tool `ask_user_question`, a reconciler, events `rpiv:ask-user:prompt` and `rpiv:ask-user:blocked`, an RPC `select` fallback | Config via `rpiv-config` under `~/.config`; the exact file name is unverified | Optional external editor (`state/external-editor.ts`) |
| pi-claude-bridge | 2 providers, 1 tool (name unverified), hooks `before_agent_start`, `session_start`, `session_shutdown`, `session_before_compact`, `session_compact`, `session_before_tree`, `session_tree` | `~/.pi/agent/claude-bridge.log`, `claude-bridge.json`, `claude-bridge-diag.log`, `~/.pi/agent/claude/`, `~/.claude/projects/`, `~/.claude/rules/` | The Claude Code executable (`pathToClaudeCodeExecutable`). `execFileSync` in `src/claude-credentials.ts`. |
| pi-hashline-edit-pro | 5 tools including `read` (overrides Pi's built-in `read`), `replace`, `insert`, `anchor_grep`, `undo_last_change`; 2 commands; `setActiveTools`; hooks `tool_call`, `tool_result`, `turn_end`, `message_end`, `before_agent_start`, `session_start`, `session_shutdown` | Hash store; `~/.config/pi-hashline-edit-pro`; `~/.pi/agent/bin` | Spawns in `src/auto-read-all.ts` and `src/grep.ts` (program unverified) |
| pi-subagents | 3 tools (names unverified; ADR-0006 mentions `Agent`), a command, a flag, message and entry renderers, `sendMessage`, `appendEntry`, 17 `events.emit` | `~/.pi/agent/agents/`, `workflows`, `subagents.json`, `skills`, `agent-memory/` | Spawns in `src/agent-manager.ts`, `src/cross-extension-rpc.ts`, `src/index.ts`. Constructs `DefaultResourceLoader` at `src/agent-runner.ts:822`. |
| pi-tasks | 7 tools (names unverified), a command; `events.on` and `emit` shared with pi-subagents | `getAgentDir()` usage (files unverified) | `src/process-tracker.ts` |
| pi-tokensave | Tools `tokensave_context`, `tokensave_find_symbol`, `tokensave_impact`, `tokensave_search`, `tokensave_status`, `tokensave_symbol`; 7 commands; hooks `before_agent_start`, `session_start`, `tool_call` | Reads `~/.pi/agent/AGENTS.md`; `.tokensave/` per repository | The `tokensave` CLI (`src/runner.ts`) |
| pi-usage-bars | A command, a flag, a widget, custom UI; hooks `model_select`, `session_start`, `session_shutdown` | `~/.pi/agent/usage-bars-debug.log` | none |
| vcc_recall | Only the `vcc_recall` tool is wanted | Reads `~/.pi/agent/sessions`; `~/.pi/agent/pi-vcc-config.json` | none |

### 4.4 Upstream activity and sync class

| Package | Upstream commits, 30 days / 90 days | Sync class |
| --- | --- | --- |
| rpiv-ask-user-question | 12 / 92 (this package only) | Scheduled sync |
| pi-claude-bridge | 46 / 154; 5 real syncs with 11, 14, 11, 4 and 13 conflicts | Scheduled sync, the heaviest |
| pi-hashline-edit-pro | 206 commits in 30 days; 10 npm releases from 2026-09-15 to 2026-09-23; 6 renames in 90 days | Scheduled sync, the most frequent |
| pi-subagents | 4 / 109; last on 2026-09-03 | The owner says mostly dead. Confirm the policy (Q6). |
| pi-tasks | 0 / 29; last on 2026-08-24 | Same as pi-subagents |
| pi-tokensave | 0 / 2; last on 2026-07-12 | Occasional or none |
| pi-usage-bars | 8 / 46; last on 2026-09-25 | Occasional review |

### 4.5 Name collisions and hazards

| Package | Collision or hazard |
| --- | --- |
| rpiv-ask-user-question | `settings.json` lists it (line 34), so it would load twice until removed. Pi maps `AskUserQuestion` to `ask_user_question` (`packages/coding-agent/src/core/skills/tool-redirects.ts:16`). |
| pi-claude-bridge | Pi's `.gitignore` entry `todo.md` matches its `TODO.md` under `core.ignorecase=true`, so ports need `git add -f`. It ships `.env.test`; whether the fence doorman treats it as secret-shaped is unverified. See ADR-0002 on the pi-claude isolation boundary. |
| pi-hashline-edit-pro | Its `read` overrides Pi's `read` in every session, OpenIntent workers included. It is installed today through `~/.pi/agent/npm/package.json` with `patches/pi-hashline-edit-pro.patch` and `~/.pi/agent/bin/npm-with-patches.mjs`. |
| pi-subagents and pi-tasks | They share an event bus and cross-extension RPC, so port them together or back to back. Subagent sessions will load every built-in, and `extensions: false` definitions still get them. |
| pi-tokensave | Tool names use a unique prefix. It injects rules into `AGENTS.md`. |
| vcc_recall | The npm `@sting8k/pi-vcc` also registers compaction hooks, and it must be uninstalled when the rewrite lands. |

### 4.6 Per-package risks

| Package | Risk |
| --- | --- |
| rpiv-ask-user-question | Low. Proven end to end in SPIKE-0003. Its tests (`*.test.ts`, `"test": "vitest run"`) may run under root `npm test`, and whether they pass there is unverified. |
| pi-claude-bridge | High. Heavy dependencies; whether they need install scripts is unverified. It is a provider used daily. It is the most conflict-prone sync. It touches credentials, and OpenIntent D16 acceptance depends on it. |
| pi-hashline-edit-pro | High. It replaces a core tool. Upstream churn is extreme, with renames. It is not a fork, so a base commit must be chosen. The two patch fixes become owned commits. Any native-module need is unverified. |
| pi-subagents | Medium. The largest code base at 22,722 lines. Its in-process loader interacts with built-ins. |
| pi-tasks | Low. No dependencies. |
| pi-tokensave | Low. It needs the `tokensave` binary to be available under the fence. |
| pi-usage-bars | Low. The fork is 8 behind upstream, which gives a natural first sync test. |
| vcc_recall | Low to medium. It is new code, and its design needs its own plan. |

### 4.7 Recommended order

| Order | Package | Why |
| --- | --- | --- |
| 1 | rpiv-ask-user-question | Already proven. It creates the 9-line mechanism, the first `UPSTREAM.json` and the port skill's first run. |
| 2 | pi-tasks | Small, with no dependencies. It proves a second port costs no upstream-owned line. |
| 3 | pi-subagents | Pairs with pi-tasks. It tests the in-process loader with built-ins. |
| 4 | pi-usage-bars | Small. Its 8 unsynced upstream commits give the first real sync after a port. |
| 5 | pi-tokensave | Nice to have; low risk. |
| 6 | pi-claude-bridge | Essential, but it carries the heaviest dependencies and the most conflict-prone sync. It needs the OpenIntent amendment ready. |
| 7 | pi-hashline-edit-pro | It replaces core `read`, and its override policy needs owner rulings first (Q5). |
| separate | vcc_recall rewrite | New feature work, not a port. |

The owner may prefer pi-claude-bridge earlier, because it is used daily (Q10).

### 4.8 Verified facts about `rpiv-ask-user-question` at the cut

| Fact | Evidence |
| --- | --- |
| Copied via `git -C /Users/paolof/Developer/ai/rpiv-mono archive 8403bb09 packages/rpiv-ask-user-question`. The result is byte-identical except `UPSTREAM.json`, and file modes are equal. | SPIKE-0003 `spike/runs/C7-measure-*.txt` |
| Base `d74b1c99830a565f3df3f37e0a36616d17ffc574` is `merge-base 8403bb09 upstream/main`. The fork is 6 commits ahead and 0 behind. | Session commands |
| `@juicesharp/rpiv-config` resolved to 2.11.0 with integrity `sha512-fjySBPar14qTPNMNPRYmH24YCaQ0r8xzW4P4jz8/Ph7JLFzIa+TM3ySzg9jRq0hh8wVqIAD4j4pcU66fdCkIag==`. | SPIKE-0003 lockfile |
| `@juicesharp/rpiv-i18n` is not installed, so the UI is English-only. | `index.ts` dynamic import fallback |
| It imports `getMarkdownTheme` and `DynamicBorder` as values from `@earendil-works/pi-coding-agent`. 69 files use relative `.js` imports. | Source reading; pre-freeze review |
| All modes work, and `npm run check` passes with the checkout list. | SPIKE-0003 C1 to C9 |
| Its one real sync, `ce35c164` inside `05b6bb1`, reproduces with 1 conflict in `CHANGELOG.md`. | SPIKE-0004 `spike/runs/R6.txt` |
| `~/.pi/agent/settings.json` lists `"../../Developer/ai/rpiv-mono/packages/rpiv-ask-user-question"` as the last package. The file's SHA-256 was `088a665e4f2bc895cce80927fb8ba4a45b138ea18637334409103e3b446c96bc`. | Session commands |
| rpiv-mono's working tree holds two untracked files: `docs/rpiv-mono-overview.md` and `.pdf`. | `git status` |

SPIKE-0003's `UPSTREAM.json` for this package used a URL as `repository`. It must be rewritten to the chosen schema (Q1).

---

## 5. Work the plan must cover

### 5.1 Skill: `.pi/skills/port-extension/SKILL.md`

It must cite ADR-0009, SPIKE-0003 and SPIKE-0004, and specify these steps:

1. **Inputs.** Package name, local clone path, subdirectory, fork commit, upstream ref.
2. **Pre-checks.**
   - The clone is clean and `upstream` is fetched.
   - Tool, command and provider names do not collide with Pi's built-ins or other built-ins.
   - `git check-ignore --no-index` lists files Pi's `.gitignore` would drop.
   - `grep -rl $'\r'` finds CR bytes outside binary files.
   - Symlinks and submodules are listed.
3. **Base.** `git -C <clone> merge-base <fork commit> upstream/main`, as 40 hex. For non-forks, the upstream commit copied.
4. **Copy.**
   - Use `git -C <clone> archive <commit> <subdir> | tar -x` into a temporary directory, then move the package into `packages/builtins/<name>/`.
   - Alternatively use `read-tree` plus `checkout-index` with an **absolute** `--prefix`.
   - Verify byte and mode parity with `diff -r` against a fresh archive.
5. **Record.** Write `UPSTREAM.json` per Section 3.2 and the chosen Q1 schema.
6. **Wire.** Add the name to `FORK_BUILTIN_PACKAGES`. On the first port only, apply the 9 upstream-owned lines and create `fork-builtins.ts`.
7. **Install and check.**
   - Run `npm install --ignore-scripts`. Do not use `npm ci` while the workspace list changes, because it refuses an out-of-sync lock.
   - Run `npm run check`.
   - Confirm the shrinkwrap and install lock are unchanged.
8. **Validate.** In a disposable worktree, run Section 5.8.
9. **Commit.**
   - Stage explicit paths with `git add -f -- packages/builtins/<name>` plus the edited files.
   - Set `PI_ALLOW_LOCKFILE_CHANGE=1` with owner approval.
   - The message follows repository format, with body trailer `Upstream-Base: <base>`.
10. **Cutover** (Section 5.5).

### 5.2 Skill: `.pi/skills/sync-upstream/SKILL.md`

It must cite ADR-0009 and SPIKE-0004, and specify this procedure:

1. **Refresh.** Run `git -C <clone> fetch upstream`, because the script never fetches. Resolve `new` to a 40-hex id, normally `upstream/main`.
2. **Isolate.** Run in a disposable worktree or branch, never in the shared main checkout.
3. **Run.** `scripts/fork/sync-upstream.sh <worktree> packages/builtins/<name> <new>`.
4. **Handle the outcome.**

| Exit | Required handling |
| --- | --- |
| 0 | Review the staged diff. Run `npm install --ignore-scripts`, because step (6) deletes ignored files in the directory. Run `npm run check` and tests. Commit with trailer `Upstream-Base: <new>`. |
| 1 | Resolve each file in the `conflicted:` list. Confirm no markers remain with `git grep -nE '^(<<<<<<<|=======|>>>>>>>)' -- packages/builtins/<name>`. Then handle as exit 0. |
| 2 | Stop and report the refusal line. Never edit the record to get past a refusal. |
| 3 | Commit the base-only change with the trailer, so the recorded base advances. |

5. **Schedule.** Every 3 days, one package at a time. Packages whose policy is "no sync" are skipped (Q6). Record each run's outcome.
6. **Clean up.** Delete `/tmp/spike-0004-scratch.*` after each run.
7. **Rules.**
   - Only the port and the sync write `upstream.base`.
   - A verified base whose Pi side comes from another line is undetectable (SPIKE-0004 limits).

### 5.3 Port steps per package

| Package | Steps beyond the generic skill |
| --- | --- |
| rpiv-ask-user-question | The first port: apply the 9 lines and create `fork-builtins.ts`. Fix the `UPSTREAM.json` schema (Q1). Cut over the `settings.json` entry. Confirm `~/.config` reads under the fence (unverified). |
| pi-tasks | Confirm tool names; check the bus contract with pi-subagents. |
| pi-subagents | Confirm tool names and behavior when subagents run with built-ins. Decide what `extensions: false` means now. Check ADR-0006 and ADR-0008 interactions. |
| pi-usage-bars | Port from the fork commit, then run the first real sync against its 8 upstream commits. |
| pi-tokensave | Confirm the `tokensave` binary's path under the fence and its `AGENTS.md` behavior. |
| pi-claude-bridge | Check dependency install scripts under `--ignore-scripts`. Force-add `TODO.md`. Assess `.env.test`. Coordinate the OpenIntent amendment and D16 acceptance selection. Check ADR-0002. |
| pi-hashline-edit-pro | Choose the base commit for npm 4.4.1. Apply the two patch fixes as owned commits. Resolve the `read` override policy (Q5). Remove `~/.pi/agent/npm` entries, the patch file and `npm-with-patches.mjs` usage. |
| vcc_recall | A separate feature plan (Q7). Uninstall `@sting8k/pi-vcc` after the rewrite. |

### 5.4 `~/.pi/agent/settings.json`

- Remove each ported package's entry in the same step that the rebuilt fork starts loading it. The owner must approve every edit.
- The SPIKE-0001 and SPIKE-0003 procedure: back up, remove one entry plus its comma, verify with `JSON.parse`, record SHA-256 before and after.
- Local-path entries today: pi-tokensave, pi-claude-bridge, pi-subagents, pi-tasks, pi-usage-bars, pi-fence, mail-tool and rpiv-ask-user-question.
- npm entries today: hashline and pi-vcc, among others.
- pi-fence, mail-tool and other packages stay.

### 5.5 Cutover order per package

1. Commit the port on `personal` in the main checkout. Use explicit paths, and coordinate with other sessions.
2. Run `npm install --ignore-scripts`, then `npm run build` in the main checkout, with owner approval. `~/.pi-fence/entry.json` launches `packages/coding-agent/dist/cli.js`.
3. Remove the `settings.json` entry.
4. Start a fresh fenced session. Confirm the tool works and the fence journal shows no denial under the old fork path.
5. The fork repository becomes a read-only upstream clone for syncs.

### 5.6 pi-fence and OpenIntent work

| Target | Plan item |
| --- | --- |
| pi-fence | No code edit. List the runtime grants each ported extension still needs, as a report for the owner to apply. Read `extensions/lib/doorman.ts` `COVERED_TOOLS` for hashline. |
| OpenIntent | Draft an amendment for `design.md` D2, D8, D14 and D16 covering the points in Section 3.4, then hand it to the owner. Do not edit the OpenIntent worktree. |

### 5.7 What must not be touched

- Upstream-owned files beyond the 9 lines (ADR-0003).
- `packages/coding-agent/npm-shrinkwrap.json`, `packages/coding-agent/install-lock/` and their generators.
- `packages/ai/src/models.generated.ts`.
- The ported package's bytes in the port commit itself. Later edits go in separate commits.
- The source fork repositories. They are read-only, except for `git fetch upstream`.
- pi-fence code and profiles. The owner edits these.
- The OpenIntent worktree. Amendments only.
- `~/.pi/agent/settings.json`, except the approved cutover edit.
- The existing `openintent/experiments/` records. They are frozen history.

### 5.8 Validation

| Check | How |
| --- | --- |
| Static | `npm run check`; full output, zero findings. |
| Footprint | SPIKE-0003's `spike/c7-measure.sh`, adapted: upstream-owned added lines, 0 removed, locks byte-identical, parity against `git archive`. |
| Modes | SPIKE-0003's harness from its `evidence.patch`: `c1-tui.sh`, `c2-rpc.mjs`, `c3-c5-sdk.mjs`, `c3-registry-detail.mjs`, `c4-direct-import.mjs`, `c5-cli.sh`, `c8-outside.sh`, `c9-missing.sh`, adapted to each package's tools. |
| Fenced, in C6 style | `spike/harness/c6-fenced.sh <label> <bin>` against a build whose `settings.json` lacks the package. Answer the trust prompt "Do not trust (this session only)", or pre-trust unfenced. Grep the launch's journal under `~/.pi-fence/violations/` for the checkout and the old fork path. `auth.json` read denials are normal. |
| Sync | Run `scripts/fork/sync-upstream.sh` against the fresh port. Expect exit 3 when upstream is unchanged, or a real merge otherwise. |
| Tests | `./test.sh`, and package tests only if they work in Pi (Q12). |

**The disposable-worktree rule.**
- Build and validate in a worktree created with `git worktree add --detach <tmp path> <commit>`, or under `~/.openintent/workspaces/pfurini/pi/worktrees/`.
- Never run harnesses in the main checkout.
- Remove the worktree with `git worktree remove --force` and `git worktree prune`.

---

## 6. Gotchas and environment facts

| Topic | Fact |
| --- | --- |
| Node | 26.10.0 (Homebrew `node 26.10.0_1`), upgraded mid-session. Pi requires at least 22.19.0; OpenIntent requires at least 26.0. |
| npm | 11.19.1. |
| Git | 2.55.0 at `/opt/homebrew/bin/git`. Pi repository settings: `core.ignorecase=true`, `core.autocrlf=input`, `.gitattributes` `* text=auto eol=lf`. |
| tmux | Not installed. SPIKE-0001's `spike/harness/pty_drive.py` drives the TUI via `uv run --with pyte` (pyte 0.8.2, Python 3.11.16). |
| Trust inside the fence | A worktree containing `.pi/` shows the trust dialog. Choosing "Trust" crashes Pi with uncaught `EPERM` on `~/.pi/agent/trust.json`. This is deliberate (D16). Pre-trust unfenced with `pi trust --unfenced`, or choose the session-only "Do not trust". |
| Fence environment | pi-fence drops `PI_CODING_AGENT_DIR` (`src/launch/env.ts` `DROPPED_ENV_NAMES`). Fenced runs always use the real `~/.pi/agent`. |
| Double loading | While `settings.json` lists a package that is also built in, both copies load. The path copy loads first; conflict handling for duplicate tool names is unverified. Recent fork commit `8d897ed` touched duplicate extension runtimes. Never test with both present. |
| Lockfile | Adding a workspace rewrites `package-lock.json`. The pre-commit hook blocks it without `PI_ALLOW_LOCKFILE_CHANGE=1`. `npm ci` fails until the lock is committed; use `npm install --ignore-scripts`. |
| Pinned dependencies | `check-pinned-deps.mjs` rejects `^` ranges unless `packages/builtins/` is excluded. The exclusion is part of the 9 lines. |
| Relative imports | `check-ts-relative-imports.mjs` rejects `.js` specifiers. The same exclusion applies. |
| Runtime dependencies | `check-runtime-deps.mjs` flags only string literals passed to `require.resolve`. Names held as data pass. |
| Biome | `npm run check` rewrites files, so run it before measuring or committing. |
| Pre-commit hook | Runs the full `npm run check`, as seen on commit `481cdfb`. |
| `.gitignore` | `todo.md` matches pi-claude-bridge's `TODO.md`. Always stage ported directories with `-f`. |
| Sync script | Leaves scratch directories in `/tmp`. Deletes ignored files in the package directory. Stages conflicted files with markers. Leaves `UPSTREAM.json` unstaged on exit 3. Rewrites the first `"base"` key only. |
| Relative prefixes | `git checkout-index --prefix` resolves relative paths against `-C <repo>`. SPIKE-0002 wrote into pi-claude-bridge this way. Always pass absolute paths. |
| `mktemp` | A template with text after `XXXXXX`, such as `.XXXXXX.json`, fails when the literal file exists. Keep `XXXXXX` last. |
| Newlines | `grep -v` changes a file's final-newline state. SPIKE-0004 used `perl -0pe` instead. |
| Reused harnesses | They carry old paths. SPIKE-0003's C6 journal grep looked for `spike-0001`, so a separate check was needed. |
| Replay provenance | Merges reachable from a branch are not its syncs. Use the real-sync rule (Section 2.5). |
| opin-spike usage | `node <opin-spike>/scripts/spike.mjs status\|new\|check\|freeze\|run\|settle`, from the Pi repository root. `settle` needs `--verdict` and, for candidates, `--verdicts "A=V;B=V"`. The Verdict's first paragraph is at most 100 words, and each sentence at most 25. |
| Shared checkout | Other Pi sessions may run in `/Users/paolof/Developer/ai/pi`. Stage explicit paths only. |
| Leftovers | `/tmp/spike-0001-*`, `/tmp/spike-0003-*`, `/tmp/spike-0004-scratch.*`, `/tmp/pi-port-survey.sh`, `/tmp/bridge-merges.sh`, `/tmp/spike-0004-syncs.sh`, `/tmp/spike4-derive.sh`, `/tmp/spike4-trees.sh`, `$TMPDIR/spike-000*`. Also session directories under `~/.pi/agent/sessions/*spike-000*`, fence journals from 2026-09-25, and unreferenced objects in Pi's `.git` (`git gc` prunes them). |

---

## 7. Open questions for the owner

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | What does `UPSTREAM.json` `repository` hold? | (a) Keep the script. `repository` is the absolute local clone path; add informational `url` and `fork` fields after `upstream`. (b) Edit the script to take the clone path as an argument, then re-run SPIKE-0004's harness. (c) Map a URL to a clone by convention. | (a). No change to proven code. The checkout-only design already ties the fork to this machine. |
| Q2 | Where do upstream clones live? | (a) Reuse `~/Developer/ai/<repo>` as read-only clones. (b) A dedicated mirror directory. | (a) now. Revisit if the fork repositories are archived. |
| Q3 | Is the base for a forked source `merge-base(fork commit, upstream/main)`? | Yes, or the fork commit itself. | Merge-base. SPIKE-0004 proved it. |
| Q4 | Where does the scheduled sync run? | (a) Unfenced, because it reads clones outside the fence's grants. (b) Fenced, with read grants for clone directories. | (a) until the workflow engine owns it. |
| Q5 | pi-hashline-edit-pro's `read` override. | (a) Always-on override everywhere. (b) Built in, but disabled in OpenIntent workers via `toolSelection`, while its hooks still run. (c) A settings switch, which is new fork code. | Decide before its port. (b) is cheapest, but hooks still run. |
| Q6 | Sync policy for pi-subagents and pi-tasks. Upstream is not dead: 109 and 29 commits in 90 days. | (a) No scheduled sync. (b) Monthly review. (c) Same cadence as the others. | (b). |
| Q7 | Where does `vcc_recall` live? | (a) A fork-owned built-in package `packages/builtins/vcc-recall/`, with no `UPSTREAM.json`. (b) A core tool inside `packages/coding-agent`. | (a). Zero upstream-owned lines. |
| Q8 | Can a built-in be disabled per session? Hooks and providers run regardless of the allowlist. | (a) Accept this. (b) Add an environment or settings opt-out in `fork-builtins.ts` (fork-owned). | (a) now. Revisit if OpenIntent needs (b). |
| Q9 | Should OpenIntent readiness accept `<inline:...>` built-ins? | Amend D8 and D16, or first verify the current behavior. | Verify by reading `worker-policy-extension.ts`, then amend. |
| Q10 | Port order. | Section 4.7 order, or pi-claude-bridge second. | Section 4.7. The bridge needs the OpenIntent amendment ready. |
| Q11 | Release scripts would bump non-private ported packages (`version:*` with `--workspaces`). | (a) Never run release scripts on `personal`. (b) Mark ported packages `private` in an owned commit. | (a), documented in ADR-0009. |
| Q12 | Root `npm test` may run built-ins' `test` scripts. | Remove the scripts, fix the tests, or ignore them. | First verify what `./test.sh` and `npm test` do. |
| Q13 | Standing approval for `npm run build` and lockfile commits during ports. | Per port, or standing. | Standing for disposable worktrees; per port for the main checkout. |
| Q14 | Commit the sync after exit 3? | Commit the base bump, or discard it. | Commit, so the record advances. |

---

## 8. Reading index

| Item | Why |
| --- | --- |
| `docs/adr/ADR-0009-built-in-extensions.md` (commits `481cdfb`, `384884d`) | The accepted decision and the upstream-sync section. |
| `docs/adr/ADR-0003-fork-first-merge-hygiene.md` | The thin-call-site rule. |
| `docs/adr/ADR-0002-pi-claude-isolation-boundary.md` | Constraints for porting pi-claude-bridge. |
| `docs/adr/ADR-0006-tool-name-redirects-not-aliases.md` | `AskUserQuestion` and `Agent` redirects. |
| `docs/adr/ADR-0008-skill-bundled-agents-scoping.md` | pi-subagents interactions. |
| `openintent/experiments/README.md` | Spike registry. |
| `openintent/experiments/spikes/0001-built-in-extension-injection/report.md` and `evidence.patch` | Candidates A and B, the harness, `spike/candidates/*.patch`. |
| `openintent/experiments/spikes/0002-scoped-upstream-sync/report.md` and `evidence.patch` | Why `git apply -3` failed; replay provenance lessons. |
| `openintent/experiments/spikes/0003-built-in-checkout-list/report.md` and `evidence.patch` | The exact implementation, all harnesses and runs. |
| `openintent/experiments/spikes/0004-guarded-scratch-merge-sync/report.md` and `evidence.patch` | Sync rules, harness, replay table. |
| `scripts/fork/sync-upstream.sh` | The sync to call. |
| Commits `a63149b` through `384884d` on `personal` | The session's history (Section 2). |
| `AGENTS.md` (Pi repository) | Commands, git, lockfile and commit rules. |
| `package.json` (root) | Workspaces and check scripts. |
| `scripts/check-pinned-deps.mjs`, `check-ts-relative-imports.mjs`, `check-runtime-deps.mjs`, `generate-coding-agent-shrinkwrap.mjs`, `generate-coding-agent-install-lock.mjs` | What the checks enforce. |
| `packages/coding-agent/src/core/resource-loader.ts` (constructor near line 479; `loadFinalExtensionSet`; `loadExtensionFactories` near line 1610) | Injection point and load order. |
| `packages/coding-agent/src/core/extensions/loader.ts` (`loadExtensionModule` near line 494) | Module loading, aliases, virtual modules. |
| `packages/coding-agent/src/core/agent-session.ts` (`_refreshToolRegistry` near line 5539; `getAllTools` near line 2019) | Allowlist semantics. |
| `packages/coding-agent/src/core/agent-session-services.ts:148`, `sdk.ts:202`, `main.ts:568`, `src/extensions/index.ts` | Loader construction sites and the upstream llama.cpp built-in. |
| `packages/coding-agent/src/modes/rpc/rpc-mode.ts` (`custom()` near line 238) | RPC UI limits. |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts:1731`, `src/core/bug-report.ts:134` | Hidden-extension behavior. |
| `packages/coding-agent/docs/extensions.md`, `sdk.md`, `rpc-extension-ui.md`, `custom-provider.md` | Extension, SDK and provider contracts. |
| `.pi/skills/prp-plan/`, `prp-plan-review/`, `prp-implement/`, `interactive-testing.md` | Workflow skills and TUI testing. |
| `/Users/paolof/.openintent/workspaces/pfurini/OpenIntent/worktrees/workflow-engine/.pi/skills/opin-spike/` | Spike method, if more spikes are needed. |
| Source repositories' `package.json` and entry files (Section 4) | Per-port facts to re-verify. |
| `~/.pi/agent/settings.json`, `~/.pi/agent/npm/package.json`, `~/.pi/agent/npm/patches/` | Cutover and hashline patch contents. |
| `/Users/paolof/Developer/ai/pi-fence/src/profile/loader.ts` (`derivedPackageReads`), `src/launch/effective.ts:83`, `src/launch/env.ts`, `profiles/base.template.json`, `extensions/lib/doorman.ts`, `README.md` | Fence behavior. |
| `~/.pi-fence/profiles/base.json`, `~/.pi-fence/entry.json` | The owner's live profile and launch entry. |
| OpenIntent `openintent/changes/workflow-engine/design.md` (D2, D8 including "SDK resolution", D11, D14, D16) | The amendment scope. |
| OpenIntent `packages/workflow/src/pi/worker-entry.ts`, `worker-policy-extension.ts`, `policy/tools.ts`, `acceptance-providers.json`, `scripts/setup-worktree.mjs` | Worker loading, readiness and tool policy. |

---

## 9. State after the session

A later step verified these facts on 2026-09-25, after the report was written.

| Item | State |
| --- | --- |
| Pi branch `personal` | At `384884dfe`, 14 commits ahead of `origin/personal`, not pushed. The working tree is clean. |
| Kept commits | `c10503ff2` settles SPIKE-0004 as `PROVEN`. `384884dfe` adds ADR-0009's "Upstream sync" section and `scripts/fork/sync-upstream.sh`. |
| Dropped commits | `c438cf47c` (draft `sync-upstream` skill) and `01209903b` (draft `port-extension` skill). Branch `backup/01a0d784-post-cut` keeps both. |
| Draft skills | The session wrote both drafts at about 95% context, without review. The planner may read them as input: `git show backup/01a0d784-post-cut:.pi/skills/sync-upstream/SKILL.md` and `git show backup/01a0d784-post-cut:.pi/skills/port-extension/SKILL.md`. They carry no authority. |
| Discarded inline port | `packages/builtins/` does not exist. The discarded copy of `rpiv-ask-user-question` (109 files, from rpiv-mono `8403bb09`) is archived in `~/.pi/agent/rewind-backups/01a0d784/packages-builtins.tar.gz`. |
| Draft `UPSTREAM.json` in the archive | It followed option (a) of Q1. `upstream.repository` held the local clone path, `upstream.url` the GitHub URL, and a `fork` object followed `upstream`. |
| SPIKE-0004 worktree and branch | Removed by `settle`. The dangling commit `83139b3ed` is the former `spike/0004` tip, and its tree equals the settled squash. `evidence.patch` stays the authoritative copy. |
| rpiv-mono | Unchanged. `personal` at `8403bb09`, `upstream/main` at `d74b1c99`. The only untracked files are `docs/rpiv-mono-overview.md` and `.pdf`. |
| `~/.pi/agent/settings.json` | Unchanged by the post-spike work. It still lists the rpiv-mono package. |
| Sessions | `01a0d784-32e9-7659-b244-25ac3231a26b` is the original and ends in a context overflow; do not resume it. `01a0d899-50e2-72a5-8ea9-ceafa86c8b12` holds this report's generation and a compaction whose summary is this report. Resume it only to ask the original agent questions. |

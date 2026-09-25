# Built-in extensions, phase 1: implementation and test plan

This plan implements phase 1 of the built-in extensions work. Phase 1 installs the ADR-0009 mechanism and writes the `port-extension` and `sync-upstream` skills. It then ports `rpiv-ask-user-question` through the new skill, exercises one upstream sync, and cuts the live setup over. The input is `docs/plans/built-in-extensions.report.md` (the report). On 2026-09-25, a probe worktree re-verified the report's open claims, and the owner ruled on five new decisions. This plan records both. Ports 2 to 7 reuse the phase-1 skills; Section 10 lists their prerequisites.

---

## 1. Authority and workflow

| Source | Role |
| --- | --- |
| This plan | The implementation contract for phase 1. It overrides the report where they differ, and Section 2 names each difference. |
| `docs/plans/built-in-extensions.report.md` | Background, inventory, gotchas (Section 6) and later-phase facts. |
| `docs/adr/ADR-0009-built-in-extensions.md` | The accepted decision. Task T7 amends it. |
| SPIKE-0003 and SPIKE-0004 records under `openintent/experiments/spikes/` | Proof of the mechanism and the sync. Their `evidence.patch` files hold the mode harness. |
| `scripts/fork/sync-upstream.sh` | The proven sync. Do not change its behavior. |
| `AGENTS.md` (repository) | Git, lockfile, check and test rules. |

The owner changed report decision D18 on 2026-09-25. This plan replaces `/skill:prp-plan`, and an independent agent review replaces `/skill:prp-plan-review`. Implementation follows this plan directly, without `/skill:prp-implement`.

---

## 2. Decisions

### 2.1 Owner rulings on 2026-09-25

| # | Ruling | Consequence |
| --- | --- | --- |
| R1 | Built-ins honor an environment switch. `PI_FORK_BUILTINS=off` disables all of them. `packages/coding-agent/vitest.config.ts` sets it in `test.env`. | Upstream tests stay green. The footprint grows by 1 changed upstream-owned line. The switch also answers report Q8 option (b). |
| R2 | Built-ins load after the caller's factories, not before. | Upstream's `<inline:N>` numbering for unnamed factories stays unchanged. The report's Section 3.1 "Load order" item 3 no longer holds. |
| R3 | The ported rpiv package keeps its tests in the tree but loses its `test` script, in an owned commit after the port. | `npm test --workspaces --if-present` skips it, so `./test.sh` stays green. |
| R4 | Standing approval covers install, build and test in disposable worktrees under `/tmp`. Ask before each of the actions listed below. | Inside `/tmp` worktrees, the implementer asks only before a lockfile commit. |
| R5 | Report decision D9 gets one exception. The probe measurements in Section 3 and Appendix A prove R1 and R2; no opin-spike runs for them. | T7 amends ADR-0009 citing this plan. `fork-builtins.test.ts` re-proves R1 and R2 on every `./test.sh`. |

Actions that always need the owner's approval under R4:
- any install or build in the main checkout;
- every commit that includes `package-lock.json`;
- the edit of `~/.pi/agent/settings.json`;
- the fast-forward of `personal` in the main checkout.

### 2.2 Report questions

| # | Status | Answer used |
| --- | --- | --- |
| Q1 | Adopted recommendation (a). | `upstream.repository` is the absolute local clone path. `upstream.url` and a `fork` object are informational. The script stays unchanged. |
| Q2 | Adopted recommendation (a). | Upstream clones are the existing checkouts under `~/Developer/ai/<repo>`. They stay read-only except for `git fetch upstream`. |
| Q3 | Adopted. | The base is `git merge-base <fork commit> upstream/main`. |
| Q4 | Adopted recommendation (a). | Syncs run unfenced. |
| Q8 | Resolved by R1. | `PI_FORK_BUILTINS=off` is the per-process opt-out. |
| Q9 | Resolved by source reading. | OpenIntent readiness cannot refuse because of built-ins. Section 3 has the evidence; T8 hands the consequences to the owner. |
| Q11 | Adopted recommendation (a). | Never run the release scripts on `personal`. T7 records the rule in ADR-0009. |
| Q12 | Resolved by R3. | See R3. |
| Q13 | Resolved by R4. | See R4. |
| Q14 | Adopted. | Commit the base bump after exit 3 when `UPSTREAM.json` changed. |
| Q5, Q6, Q7, Q10 | Deferred. | They concern later ports (Section 10). |

The owner may override any adopted recommendation before implementation starts.

### 2.3 Procedural differences from the report

| Report item | This plan | Reason |
| --- | --- | --- |
| 5.1 pre-check: the clone is clean and `upstream` is fetched | The clone's `HEAD` equals the fork commit, and the package subdirectory is clean. Untracked files elsewhere in the clone are allowed. T3 uses the pre-fetch `upstream/main`; T5 fetches. | rpiv-mono holds two expected untracked files outside the package (report Section 9). The recorded base is the verified merge-base, which a fetch cannot move. |
| 5.5 step 1: commit on `personal` in the main checkout | Commits land on `feat/builtins-phase1` in a `/tmp` worktree. T9 fast-forwards `personal`. | The main checkout is shared with other sessions (`AGENTS.md`). |
| 5.5 steps 2 and 3: build, then remove the `settings.json` entry | T9 removes the entry first, then builds. | Two copies never load together; duplicate tool handling is unverified (report Section 6). |
| 5.5 step 2: `npm run build` | `npm run build:offline` everywhere, harnesses included. | `npm run build` runs `generate-models` in `packages/ai`, which needs the network and rewrites `models.generated.ts` (Section 3). |
| 5.8 "Tests": `./test.sh`, and package tests only if they work in Pi | rpiv's tests do not run (R3). | They need rpiv-mono's tooling (Section 3). |

The sync script runs `git add -A` inside its own scratch repository, and `git add -A -f -- <dir>` in Pi. `AGENTS.md` forbids `git add -A` because it stages other sessions' files in the shared checkout. The script's Pi-side add is limited to one package directory, in a disposable worktree, so the rule's concern does not arise.

---

## 3. Verified facts

A probe on 2026-09-25 applied SPIKE-0003's mechanism and the rpiv package to `personal` at `384884dfe`. It ran in the disposable worktree `/tmp/pi-builtins-probe`, compared against the clean worktree `/tmp/pi-baseline-probe`. Both ran coding-agent's vitest suite with `./test.sh` isolation.

| Fact | Evidence |
| --- | --- |
| The report's 9 lines still apply cleanly to `384884dfe`. | `git apply --check` of SPIKE-0003's `evidence.patch`, limited to the mechanism and package paths, succeeded. |
| As spiked, the mechanism fails 23 upstream tests in 8 files. | Baseline: 4 failed, 3589 passed. Probe: 27 failed, 3566 passed. Appendix A lists the 23 tests. |
| Prepending renumbers callers' unnamed factories. | `resource-loader.ts` names an unnamed factory `<inline:${index + 1}>` over the merged list (near line 1622). |
| R1, R2 and the draft test file restore the baseline exactly. | Probe with R1 and R2: 4 failed, the same 4 as baseline, and 3593 passed. The 4 draft tests passed. The review added a fifth test (switch timing) and a sentinel factory to the missing-package test; all 5 pass in isolation. |
| The draft test catches a lost call site and a moved switch read. | With the `resource-loader.ts` call removed, 2 of the tests fail. With the switch read moved from the constructor into `loadExtensionFactories`, the switch-timing test fails. |
| `npm run check` passes on the R1 and R2 variant. | Exit 0. Shrinkwrap and install lock are reported up to date. |
| The built-in loads from source under vitest. | `<inline:@juicesharp/rpiv-ask-user-question>` appears, and its `ask_user_question` tool registers. |
| Biome and `tsgo` never touch `packages/builtins/`. | `biome.json` `files.includes` and `tsconfig.json` `include` match only `packages/*/src`, `packages/*/test` and listed paths. |
| rpiv's own tests cannot run in Pi. | 27 of 37 test files fail to load. They import `@juicesharp/rpiv-test-utils` and rely on rpiv-mono's `test/setup.ts`. |
| The release scripts would treat the rpiv package as publishable. | `scripts/release-packages.mjs` keeps every non-private package that `findPackageDirectories()` finds, recursively under `packages/`. |
| No other Pi package's tests construct a resource loader. | No `DefaultResourceLoader` or `createAgentSession` use in any other package's `test/` directory. |
| OpenIntent readiness reports policy extensions, not loaded ones. | `packages/workflow/src/pi/worker-policy-extension.ts` near line 179 publishes `extensions: policy.extensions`. |
| OpenIntent workers without a tool scope keep the SDK's active tool set. | Same file: `tools` absent means "this extension gates nothing". |
| OpenIntent's tests run under vitest. | `packages/workflow/package.json` `test` is `vitest run --passWithNoTests`. |
| rpiv reads one optional config file. | `$XDG_CONFIG_HOME/rpiv-ask-user-question/config.json`, then `~/.config/rpiv-ask-user-question/config.json`, else defaults. Neither exists on this machine. |
| The fence doorman inspects `bash`, `read`, `grep`, `find` and `ls` only. | `pi-fence/extensions/lib/doorman.ts` line 113. `ask_user_question` needs no coverage. |
| `~/.pi/agent/settings.json` is unchanged since the report. | SHA-256 `088a665e4f2bc895cce80927fb8ba4a45b138ea18637334409103e3b446c96bc`. The rpiv entry is the last of 17 packages. |
| rpiv-mono is unchanged. | `personal` at `8403bb09`, `upstream/main` at `d74b1c99` before any new fetch. |
| The scratch sync leaves scratch directories behind. | Every run leaves a `/tmp/spike-0004-scratch.*` directory (`scripts/fork/sync-upstream.sh` line 81) and prints its path on a `scratch:` line. `extract()` removes its `/tmp/spike-0004-idx.*` index file (line 78), so an index file remains only after an interrupted run. |
| The sync can exit 2 after it has rewritten the package. | When the scratch merge fails without conflicts, the script has already replaced and staged the package directory (lines 101 to 104) before it exits 2 (lines 109 to 111). Every other exit 2 happens before any change. |
| pi-fence drops `PI_FORK_BUILTINS`. | A fenced child receives only the `PI_*` names in `ALLOWED_PI_NAMES` (`pi-fence/src/profile/environment.ts` line 24; `src/launch/env.ts`). A reviewer confirmed that `buildChildEnv()` returns no `PI_FORK_BUILTINS` and that profile inheritance refuses the name. |
| A fenced session cannot read rpiv's config. | The fence base profile denies `~` and allows no `~/.config/rpiv-ask-user-question` (`pi-fence/profiles/base.template.json`, `~/.pi-fence/profiles/base.json`). rpiv then uses its defaults. The same was true before the port, and no config file exists today. |
| `npm run build` regenerates model data. | The `packages/ai` `build` script runs `generate-models` before `build:offline`. The root `build:offline` script skips generation. |
| The SPIKE-0003 harness needs setup. | Seven of its eight scripts select the `spike-fixture/echo` model. `c5-cli.sh` accepts `PI_BIN` to choose the CLI entry. Every script writes to `$PWD/spike/runs/`, which no script creates. `c9-missing.sh` runs `npm run build` twice and uses fixed `/tmp/spike-0003-*` paths. |

---

## 4. Scope

**In scope.**
- The built-in mechanism, with R1 and R2 (T1).
- The `port-extension` and `sync-upstream` skills (T2).
- The `rpiv-ask-user-question` port, its owned test-script commit and its durable test (T3, T4).
- One real sync exercise on the new port (T5).
- Validation in all modes (T6).
- The ADR-0009 amendment (T7).
- A handoff note for pi-fence and OpenIntent (T8).
- The cutover of the live setup (T9) and cleanup (T10).

**Out of scope.**
- Ports 2 to 7 and the `vcc_recall` rewrite (Section 10).
- A scheduler for syncs. The skill documents the scheduled procedure; scheduling itself comes later.

**Binding constraints.** The report's Section 5.7 list applies to every task. This plan makes three named exceptions:

| Report 5.7 item | Exception in this plan |
| --- | --- |
| Upstream-owned files beyond the 9 lines | R1 changes one more line, in `packages/coding-agent/vitest.config.ts`. |
| The ported package's bytes | T4 edits `package.json` in a separate owned commit after the port commit, as 5.7 allows. |
| `~/.pi/agent/settings.json` | T9 removes the rpiv entry, with the owner's approval. |

Nothing else in 5.7 changes. The sync script, the source fork repositories, pi-fence, the OpenIntent worktree, the shrinkwrap, the install lock, `models.generated.ts` and the `openintent/experiments/` records stay untouched. Every build uses `npm run build:offline`, which keeps `models.generated.ts` untouched.

---

## 5. Working setup

1. Create the implementation worktree from the current `personal` head:
   `git worktree add -b feat/builtins-phase1 /tmp/pi-builtins-phase1 personal`.
2. Copy the generated model data, which Git ignores:
   `cp -R /Users/paolof/Developer/ai/pi/packages/ai/src/providers/data /tmp/pi-builtins-phase1/packages/ai/src/providers/`.
3. Run `npm install --ignore-scripts` in the worktree.
4. Record the start commit as `BASE=$(git rev-parse HEAD)`. The footprint checks diff against it.
5. Run `./test.sh` on `BASE` and save its full output as the baseline. Appendix A holds only the coding-agent part of that baseline. The probe did not measure the other workspaces.
6. For a single test file, run `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run <file>` from the package root (`AGENTS.md`). Never run the full vitest suite without `./test.sh`.

Two worktree facts matter:
- Interactive `pi` in a worktree that holds `.pi/` shows the trust dialog. Choose "Do not trust (this session only)", or pre-trust unfenced with `pi trust --unfenced` (report D16).
- macOS may clean idle `/tmp` directories after 3 days. The branch keeps every commit. Recreate the worktree with `git worktree prune` and step 1 without `-b`.

Commits happen on `feat/builtins-phase1` only. `AGENTS.md` still applies: stage explicit paths, and commit only when the owner has asked.

---

## 6. Tasks

### T0. Record the plan

Copy `docs/plans/built-in-extensions.report.md` and this plan from the main checkout into the worktree. Commit them as `docs: built-in extensions report and phase-1 plan`.

### T1. Install the mechanism

**Upstream-owned changes.** These are 9 added lines and 1 changed line.

| File | Change |
| --- | --- |
| `package.json` | Add `"packages/builtins/*",` after `"packages/*",` in `workspaces`. |
| `scripts/check-pinned-deps.mjs` | After the `ignoredDirectories` declaration on line 6, add `ignoredDirectories.add("builtins");`. |
| `scripts/check-ts-relative-imports.mjs` | After the `ignoredDirectories` declaration on line 5, add `ignoredDirectories.add("builtins");`. |
| `packages/coding-agent/src/core/extensions/loader.ts` | Append a blank line and the 3-line `loadExtensionFactoryFromPath` export from report Section 3.1. |
| `packages/coding-agent/src/core/resource-loader.ts` | Add `import { forkBuiltInExtensions } from "./fork-builtins.ts";`. After line 479, add `this.extensionFactories = [...this.extensionFactories, ...forkBuiltInExtensions()];` (R2). |
| `packages/coding-agent/vitest.config.ts` | Change `env: { PI_OFFLINE: "1" },` to `env: { PI_OFFLINE: "1", PI_FORK_BUILTINS: "off" },` (R1). |

**Fork-owned `packages/coding-agent/src/core/fork-builtins.ts`.** This is the post-Biome content, with the list empty until T3.

```ts
/**
 * Fork-owned: the extensions this Pi fork ships as built-ins. Every DefaultResourceLoader
 * loads them after the caller's factories, including under `noExtensions`.
 *
 * The ported packages live under `packages/builtins/` as npm workspaces. No dependency is
 * declared on them: each name resolves through the monorepo's workspace links, and each
 * package loads through the jiti-backed module loader that loads any extension path.
 * `PI_FORK_BUILTINS=off` disables them; coding-agent's vitest config sets it (ADR-0009).
 */
import { createRequire } from "node:module";
import { loadExtensionFactoryFromPath } from "./extensions/loader.ts";
import type { ExtensionFactory, InlineExtension } from "./extensions/types.ts";

export const FORK_BUILTIN_PACKAGES: readonly string[] = [];

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

/** The built-ins for the given package names. Tests pass their own names; production uses the fork list. */
export function createForkBuiltInExtensions(packageNames: readonly string[]): InlineExtension[] {
	return packageNames.map((name) => ({ name, factory: packageFactory(name), hidden: true }));
}

/** The fork's built-ins, or none when `PI_FORK_BUILTINS=off`. Read at each loader construction. */
export function forkBuiltInExtensions(): InlineExtension[] {
	if (process.env.PI_FORK_BUILTINS === "off") {
		return [];
	}
	return createForkBuiltInExtensions(FORK_BUILTIN_PACKAGES);
}
```

**Fork-owned `packages/coding-agent/test/fork-builtins.test.ts`.** Appendix B holds the probe's full file, with 5 tests. T1 commits it without the rpiv registration test, and T3 adds that test. Each test builds a `DefaultResourceLoader` with `noExtensions`, `noSkills`, `noPromptTemplates` and `noThemes`, in a temporary `cwd` and `agentDir`. While the list stays empty (T1 to T2), the first test and the switch-timing test pass trivially. They cannot detect a lost call site or a moved switch read until T3 lists a package.

| Test | Setup | Assertion |
| --- | --- | --- |
| Every listed package loads after the caller's factories, hidden, under `noExtensions` | `vi.stubEnv("PI_FORK_BUILTINS", "on")`; one unnamed caller factory | `errors` is empty. Paths equal `["<inline:1>", ...FORK_BUILTIN_PACKAGES.map((name) => "<inline:" + name + ">")]`. Every built-in has `hidden === true`. |
| No built-in loads when the switch is off | `vi.stubEnv("PI_FORK_BUILTINS", "off")`; one unnamed caller factory | Paths equal `["<inline:1>"]`. |
| The switch is read at construction, not at reload | Construct one loader with the switch on and one with it off. Flip the switch before each reload. | The first loader holds every listed package; the second holds none. |
| A missing package is reported by name, and loading continues past it | Switch off; factories `[noop, ...createForkBuiltInExtensions(["@pi-fork/missing-builtin"]), { name: "sentinel", factory: noop }]` | Paths equal `["<inline:1>", "<inline:sentinel>"]`. One error, with path `<inline:@pi-fork/missing-builtin>`, whose message contains the package name. |
| rpiv registers its tool (added in T3) | Switch on; no caller factories | The extension at `<inline:@juicesharp/rpiv-ask-user-question>` has `tools.has("ask_user_question")`. |

Type the helper's parameter as `InlineExtension[]`. Otherwise `tsgo` rejects the mixed factory list.

**Validation.**
- `npm run check` passes, with full output read.
- `./test.sh` shows no failure that is absent from the Section 5 baseline. For coding-agent, that is exactly the 4 failures in Appendix A.
- The footprint command in Section 7 reports 10 insertions and 1 deletion.

**Commit.** `feat(coding-agent): load fork built-in extensions from packages/builtins`. Include `package-lock.json`. Its root `workspaces` array gains the one line `"packages/builtins/*",`, because the lockfile copies the root `package.json` workspaces. Any other lockfile change means stop and ask. The lockfile commit needs `PI_ALLOW_LOCKFILE_CHANGE=1` and the owner's approval (R4).

### T2. Write the two skills

Write `.pi/skills/port-extension/SKILL.md` and `.pi/skills/sync-upstream/SKILL.md`. Start from the drafts on `backup/01a0d784-post-cut`. They carry no authority, so apply the corrections below. Follow the durable-prose register in `~/.pi/agent/AGENTS.md`.

**`port-extension`.** Keep the draft's rules, its classification table and its `UPSTREAM.json` shape (Q1 option a). The final skill must also state these rules:
- The clone's `HEAD` equals the fork commit, and `git -C <clone> status --porcelain -- <subdir>` prints nothing. The live setup loads the working tree while the port copies the commit, so the two must match. Untracked files outside `<subdir>` are allowed and go into the results file.
- Run the report's pre-checks: `git check-ignore --no-index`, CR bytes, symlinks and submodules.
- Work on a feature branch in a disposable `/tmp` worktree. Copy with `git archive`, and verify byte and mode parity against a fresh archive.
- `UPSTREAM.json` carries `syncPolicy` after `upstream` and `fork`. The allowed values are `every-3-days`, `monthly-review` and `none`; the default is `every-3-days`.
- Run `npm install --ignore-scripts`, `npm run check` and `./test.sh` in the worktree.
- Drop the package's `test` script in an owned commit when its tests cannot run in Pi (R3).
- Add one `fork-builtins.test.ts` assertion for each tool, provider and command the package registers.
- Validate every mode as T6 does, in a validation worktree with the fixture provider, recording exit codes. A failed check blocks the cutover.
- Cut over as T9 does, including its quiet interval, its status check, `npm run build:offline` and its rollback.
- Record everything in a results file, as T10 does.

**`sync-upstream`.** Keep the draft's rules, its exit-code table and its verification list. The final skill must also state these rules:
- Run unfenced (Q4), in a disposable worktree on a sync branch, never with `.` in the main checkout. Fast-forward `personal` only with the owner's approval.
- The scheduled procedure reads each package's `syncPolicy`. An `every-3-days` package syncs every 3 days, one package at a time. A `monthly-review` package gets a monthly preview (`git log <base>..<new>`) for the owner, with no merge. A `none` package is skipped.
- After exit 0 or 1, always run `npm install --ignore-scripts` before any check, because step (6) deletes ignored files in the package directory. The draft's lockfile-only install is not enough. Then run `npm run check`, `./test.sh` and `fork-builtins.test.ts`.
- Exit 2 comes in two kinds. Without a `scratch:` line, the script refused before any change: stop and report. With a `scratch:` line, the merge failed after the script rewrote and staged the package. Keep the scratch directory and its `.merge.log`. Restore the package with `git restore --source=HEAD --staged --worktree -- <dir>` in the sync worktree, and ask the owner before any retry.
- Delete only the scratch directory and `.merge.log` that the run printed, once the outcome is committed or discarded. Never delete `/tmp/spike-0004-*` by glob.
- Builds use `npm run build:offline`.

Both skills cite ADR-0009, SPIKE-0003 and SPIKE-0004 by path, and state `PI_FORK_BUILTINS` and R2.

**Validation.** T3 runs the port skill for real, and T5 runs the sync skill. Fix the skills in their own commits wherever a run exposes a gap.

**Commit.** `docs: add port-extension and sync-upstream skills`.

### T3. Port `rpiv-ask-user-question` by following the port skill

| Input | Value |
| --- | --- |
| Clone | `/Users/paolof/Developer/ai/rpiv-mono` |
| Subdirectory | `packages/rpiv-ask-user-question` |
| Fork commit | `8403bb09464e956d01cb4caf957980aba670b5f2` |
| Base | `d74b1c99830a565f3df3f37e0a36616d17ffc574` (verified `merge-base 8403bb09 upstream/main`) |
| Target | `packages/builtins/rpiv-ask-user-question/` |

**Steps.**

1. Check the source. On 2026-09-25, rpiv-mono's `HEAD` was `8403bb09` on `personal`, and `git status --porcelain -- packages/rpiv-ask-user-question` printed nothing. The untracked `docs/rpiv-mono-overview.md` and `.pdf` sit outside the package, are expected (report Section 9), and stay untouched. Use the pre-fetch `upstream/main` for the base, as verified above; T5 fetches.
2. Copy with `git -C <clone> archive 8403bb09 packages/rpiv-ask-user-question | tar -x -C <temp>`, then move the directory into place. Check parity with `diff -r` against a second archive.
3. Write `UPSTREAM.json`:

   ```json
   {
   	"upstream": {
   		"repository": "/Users/paolof/Developer/ai/rpiv-mono",
   		"url": "https://github.com/juicesharp/rpiv-mono.git",
   		"path": "packages/rpiv-ask-user-question",
   		"base": "d74b1c99830a565f3df3f37e0a36616d17ffc574"
   	},
   	"fork": {
   		"repository": "https://github.com/pfurini/rpiv-mono.git",
   		"branch": "personal",
   		"commit": "8403bb09464e956d01cb4caf957980aba670b5f2"
   	},
   	"syncPolicy": "every-3-days"
   }
   ```

4. Set `FORK_BUILTIN_PACKAGES` to `["@juicesharp/rpiv-ask-user-question"]`.
5. Add the rpiv registration test from Appendix B, "registers the tools of rpiv-ask-user-question".
6. Run `npm install --ignore-scripts`. `@juicesharp/rpiv-config` must resolve to 2.11.0, with the integrity recorded in the report's Section 4.8.
7. Run `npm run check`, then `./test.sh`.

`./test.sh` fails at this point, because rpiv's `test` script still runs. T4 fixes that. Run coding-agent's suite alone to validate T3.

**Commit.** One commit with the package directory (`git add -f`), `fork-builtins.ts`, `fork-builtins.test.ts` and `package-lock.json`. The message is `feat(coding-agent): port rpiv-ask-user-question as a built-in`. Its last paragraph is `Upstream-Base: d74b1c99830a565f3df3f37e0a36616d17ffc574`. The lockfile needs `PI_ALLOW_LOCKFILE_CHANGE=1` and the owner's approval (R4).

### T4. Drop rpiv's test script (R3)

Remove the `"scripts": { "test": "vitest run" }` block from `packages/builtins/rpiv-ask-user-question/package.json`. Keep every other byte. Run `npm install --ignore-scripts` and confirm the lockfile does not change. Run `./test.sh` and confirm that no failure is absent from the Section 5 baseline.

**Commit.** `fix: skip rpiv-ask-user-question tests that need rpiv-mono tooling`. It does not touch `UPSTREAM.json`, so it needs no trailer.

### T5. Exercise the sync skill on the new port

1. Run `git -C /Users/paolof/Developer/ai/rpiv-mono fetch upstream`. Resolve `new` to the 40-hex id of `upstream/main`.
2. Preview with `git -C <clone> log --oneline <base>..<new> -- packages/rpiv-ask-user-question`.
3. From the worktree root, run `scripts/fork/sync-upstream.sh /tmp/pi-builtins-phase1 packages/builtins/rpiv-ask-user-question <new>`.
4. Route the exit code through the skill's table.

| Exit | Expected handling in phase 1 |
| --- | --- |
| 3 | Upstream has not changed the package since `d74b1c99`. Commit `UPSTREAM.json` only if it changed. |
| 0 or 1 | A real merge. Resolve conflicts first. Check whether T4's `package.json` edit conflicts; if it does, keep R3. Run `npm install --ignore-scripts`, then `npm run check` and `./test.sh`. Commit with the trailer. A lockfile change needs approval. |
| 2 | Without a `scratch:` line, the script refused before any change: stop and report; on a fresh port this indicates a T3 defect. With a `scratch:` line, follow the skill's recovery: keep the scratch evidence, restore the package, and ask the owner. |

Record the outcome, the range and every conflict in the commit body and in the results file (T10). Record the scratch path the script printed; T10 deletes only that path and its `.merge.log`.

### T6. Validate every mode

Run T6 in a separate validation worktree, never in `/tmp/pi-builtins-phase1`. Prepare it in this order:

1. Run `git worktree add --detach /tmp/pi-builtins-validate feat/builtins-phase1`, then copy the model data as in Section 5 step 2.
2. Extract `spike/harness/` from SPIKE-0003's `evidence.patch` into `/tmp/pi-builtins-validate/spike/harness/`. Create `/tmp/pi-builtins-validate/spike/runs/`, because every script writes there and none creates it.
3. Apply `packages/builtins/spike-fixture-provider/` from the same patch, and append `"@pi-fork/spike-fixture-provider"` to `FORK_BUILTIN_PACKAGES`. Seven of the eight scripts select its `spike-fixture/echo` model, a network-free faux provider. The fixture also re-proves two claims: a second built-in adds no upstream-owned line, and a built-in can register a provider.
4. In `c9-missing.sh`, change both `npm run build` calls to `npm run build:offline`. The script also writes fixed `/tmp/spike-0003-*` paths, and SPIKE-0003 left files there. Rename those paths to `/tmp/pi-builtins-c9*`, which this phase owns.
5. Run `npm install --ignore-scripts` and `npm run build:offline` (R4 standing approval).

Run every script from the validation worktree root, with a unique label per run. Adapt paths and expected tool names. Record the exit code of every command; a nonzero exit fails the check. Never commit anything from the validation worktree; T10 discards it.

| Check | Harness | Pass condition |
| --- | --- | --- |
| Interactive TUI through the bundle | `c1-tui.sh` with `pty_drive.py` via `uv run --with pyte` | The model's `ask_user_question` call renders the dialog, and the answer returns. |
| RPC mode | `c2-rpc.mjs` | The tool falls back to a `select` extension UI request. |
| SDK services and allowlist | `c3-c5-sdk.mjs`, `c3-registry-detail.mjs` | The tool is present by default. It is absent from `getAllTools()` when a `tools` allowlist omits it. |
| Bare import and third-party loader | `c4-direct-import.mjs` | The built-in loads. |
| Print mode | `c5-cli.sh` | Every command exits 0. `--list-models` lists `spike-fixture`, and the `-p` run prints `FIXTURE-ECHO: cli path hello`. |
| Outside consumer through a symlink | `c8-outside.sh` | The built-in loads through the linked checkout. |
| Missing package, end to end | `c9-missing.sh`, run last. It backs up the list, appends a missing name, rebuilds and starts SDK services. It then restores the list from its backup and rebuilds. | The session starts, `errors` names the missing package, and `ask_user_question` stays active. The harness reports a successful rebuild after the restore. |
| Unbundled CLI `dist/cli.js` | `PI_BIN=$PWD/packages/coding-agent/dist/cli.js spike/harness/c5-cli.sh <label>` | The same as print mode. This closes the report's "not proved" item, because `~/.pi-fence/entry.json` launches this entry. |
| `PI_FORK_BUILTINS=off` end to end | CLI: `PI_FORK_BUILTINS=off node packages/coding-agent/dist/bundle/cli.js --no-extensions -e packages/builtins/spike-fixture-provider/index.ts -p --model spike-fixture/echo "off check"`. SDK: a copy of `c3-c5-sdk.mjs` run with `PI_FORK_BUILTINS=off` and the fixture passed through `additionalExtensionPaths`. | The CLI exits 0 and prints `FIXTURE-ECHO: off check`. The SDK session starts, and `getAllTools()` holds no `ask_user_question`. The `-e` path supplies the model, so a missing model cannot pass for tool absence. |

The fenced check needs a `settings.json` without the rpiv entry, so it runs at cutover (T9 step 5).

Every check in this table must pass before T9 starts. A failing check blocks the cutover until it is fixed, or until the owner waives that check explicitly. Keep every run's output in `spike/runs/` until T10 copies it into the evidence directory.

**Not proved in phase 1.** The results file lists these as open:
- Print, RPC and SDK runs never execute `ask_user_question`, because the echo model calls no tool. Only the TUI check executes it.
- rpiv's non-tool registrations (its reconciler and its `rpiv:ask-user:*` events) run only in the TUI check.
- OpenIntent worker behavior. T8 documents it for the owner.
- A fenced session honoring `PI_FORK_BUILTINS`. Section 3 shows that it cannot.
- Bundle-only failures after later upstream merges. The mode checks run at each port, not on every `./test.sh`.

### T7. Amend ADR-0009

Edit `docs/adr/ADR-0009-built-in-extensions.md` in place, in the same register.

| Section | Amendment |
| --- | --- |
| Decision, "Reach" | Built-ins load after the caller's factories. Upstream's `<inline:N>` numbering stays unchanged. |
| Decision, new "Switch" row | `PI_FORK_BUILTINS=off` disables all built-ins in a process, read when each loader is constructed. `packages/coding-agent/vitest.config.ts` sets it, so upstream tests see no built-ins. pi-fence does not forward it, so fenced sessions always load the built-ins. |
| Footprint table | Add `packages/coding-agent/vitest.config.ts`: 1 changed line. The total becomes 9 added lines and 1 changed line, in six files. |
| Consequences, "Tests" | `packages/coding-agent/test/fork-builtins.test.ts` guards the call site, the order, the switch and each port's registrations. A ported package whose tests need its origin's tooling loses its `test` script in an owned commit. |
| Consequences, "Release scripts" | Never run `version:*`, `release:*` or `publish` on `personal`. They would bump or publish ported packages. |
| Evidence | Cite this plan's Section 3 and Appendix A for R1 and R2. Record R5: the owner accepted the probe as their proof instead of an opin-spike (report D9). |

**Commit.** `docs: amend ADR-0009 with load order, the built-in switch and test policy`.

### T8. Write the pi-fence and OpenIntent handoff

Write `docs/plans/built-in-extensions-phase1.handoff.md` for the owner. Do not edit pi-fence or OpenIntent.

**pi-fence.**
- rpiv's code and defaults need no new grant.
- Its optional config reads, `$XDG_CONFIG_HOME/rpiv-ask-user-question/config.json` and `~/.config/rpiv-ask-user-question/config.json`, are denied under the fence, so fenced sessions use the defaults (Section 3). Owner action, only if a config is ever created: add `~/.config/rpiv-ask-user-question` to the base profile's read allow list.
- Its external editor spawns only on user request; whether the fence allows it is unverified.
- Removing the `settings.json` entry drops the derived `rpiv-mono` read grant automatically.
- pi-fence drops `PI_FORK_BUILTINS` (Section 3). Owner action, if fenced sessions should honor the switch: add the name to `ALLOWED_PI_NAMES` in `pi-fence/src/profile/environment.ts`.

**OpenIntent amendment points.** The report's Section 5.6 names D2, D8, D14 and D16. Its Section 3.4 adds D11 for the ask-operator tool. The handoff covers all five.

| Decision in `design.md` | Amendment point |
| --- | --- |
| D2, executable identity | Built-in code is part of the fork revision that the SDK identity records. OpenIntent never inventories or approves it as an extension source. |
| D8, scoped workers | Built-ins load in every worker that links to the checkout. D8 must name them as SDK-provided resources, governed by the worker's tool selection. Readiness publishes `policy.extensions`, so built-ins never appear in readiness (`worker-policy-extension.ts` near line 179). |
| D11, operator questions | A model gate uses the ask-operator tool. A worker without a tool scope also exposes `ask_user_question`, which raises a `select` dialog in RPC that the worker transport refuses. Worker tool selections must exclude it. `PI_FORK_BUILTINS=off` works only for unfenced workers until pi-fence forwards the name. |
| D14, studio service | Built-ins load in the studio session regardless of operator setup. OpenIntent cannot exclude them, and D14 forbids it to disable another extension. The only switch is `PI_FORK_BUILTINS=off`, which removes every built-in and does not reach fenced sessions today. |
| D16, provider extensions | Unchanged in phase 1. The `claude-bridge` acceptance role changes only when pi-claude-bridge becomes a built-in (Section 10, order 6). |

OpenIntent's vitest tests see built-ins, because only Pi's coding-agent vitest config sets the switch. The handoff states that too.

**Acceptance.** The handoff names each of D2, D8, D11, D14 and D16. It gives each one an amendment point and cites the file and line behind it. It lists every unverified item as unverified.

**Commit.** `docs: phase-1 handoff for pi-fence and OpenIntent`.

### T9. Cut over the live setup

Start only when every T6 check passes or has an explicit owner waiver. Every step in the main checkout needs the owner's approval (R4). Other Pi sessions may be running there. Agree a quiet interval with the owner for steps 2 to 4: no new Pi session starts and nobody edits the main checkout.

1. Confirm the main checkout is on `personal`, and run `git status --short`. The output may list only the untracked report and plan, and files under `.pi/` such as the owner's `.pi/agents/*.md` edits. Any other entry means stop and ask, because the build compiles the working tree, not the validated commit. Move the report and plan aside with approval, so the fast-forward can create them. Compare the moved copies with the committed ones, then delete the copies.
2. Run `git merge --ff-only feat/builtins-phase1` in the main checkout.
3. Back up `~/.pi/agent/settings.json` and record its SHA-256. Remove the last `packages` entry, `"../../Developer/ai/rpiv-mono/packages/rpiv-ask-user-question"`, together with the preceding comma. Verify with `JSON.parse`, then record the new SHA-256. Both hashes and the backup path go into the results file.
4. Run `npm install --ignore-scripts`, then `npm run build:offline`, in the main checkout.
5. Start a fresh fenced session with `pi --profile general`. The `pi` on PATH is the pi-fence launcher; it starts `~/.pi-fence/entry.json`'s `piEntry` with credentials. `pi-fence run` wraps other programs and passes no credentials, so it cannot call a model. Ask the model to call `ask_user_question`. Grep that launch's journal under `~/.pi-fence/violations/` for `rpiv-mono`; expect no hit. `auth.json` read denials are normal.
6. Start a fresh unfenced session with `pi --unfenced`, and confirm the tool once more. Plain `pi` is fenced.

Step 3 precedes step 4 on purpose. Until the build finishes, new sessions lack `ask_user_question` but never load two copies. Duplicate tool handling is unverified (report Section 6, "Double loading").

**Rollback.** `PI_FORK_BUILTINS=off` cannot disable the built-in in fenced sessions (Section 3), so the rollback disables it in code first. Every step needs the owner's approval.

1. In the main checkout, run `git revert --no-edit` on the T5 sync commit if one exists, then on T4, then on T3. The list becomes empty, and the rpiv package leaves the tree. The lockfile change needs `PI_ALLOW_LOCKFILE_CHANGE=1`.
2. Run `npm install --ignore-scripts` and `npm run build:offline`.
3. Restore the rpiv entry in `settings.json`. If the file's hash still equals the post-edit hash from step 3, copy the backup back. Otherwise someone edited the file since, so re-add the one entry by hand.

Unfenced sessions may use `PI_FORK_BUILTINS=off` as a stopgap before step 1. Never use `git reset --hard`.

### T10. Clean up and report

1. Write `docs/plans/built-in-extensions-phase1.results.md`. It records every commit and the Section 5 baseline with each `./test.sh` comparison. It also records T5's outcome, range and conflicts, and each T6 check with its exit codes and any waiver. Add the untracked source files noted at T3, the settings hashes and backup path, the cutover checks, and every open owner action from T8 and T6's "Not proved" list.
2. Copy the T6 outputs from `/tmp/pi-builtins-validate/spike/runs/` into `docs/plans/built-in-extensions-phase1-evidence/`.
3. With the owner's approval, commit both on `personal` in the main checkout, staging those explicit paths. The message is `docs: phase-1 results and validation evidence`.
4. Before removing any worktree, run `git -C <worktree> status --short` and confirm that it holds only expected changes. Confirm that no Pi session runs inside it.
5. The probe worktrees `/tmp/pi-builtins-probe` and `/tmp/pi-baseline-probe` hold no unique content. Appendix B holds the probe's test file, and Section 6 holds its `fork-builtins.ts`. With the owner's approval, remove them, `/tmp/pi-builtins-validate` and `/tmp/pi-builtins-phase1`. Use `git worktree remove --force`, because the probe and validation worktrees are dirty by design. Then run `git worktree prune`.
6. Delete only the temporary paths this phase recorded: the T5 scratch directory and its `.merge.log`, if the sync printed one, and the `/tmp/pi-builtins-c9*` logs that `c9-missing.sh` wrote. Never delete `/tmp/spike-000*` by glob.
7. Delete the `feat/builtins-phase1` branch, with approval.
8. Ask whether to remove the report's older leftovers (report Section 6, "Leftovers").

---

## 7. Test plan

| Layer | What it proves | When it runs |
| --- | --- | --- |
| `fork-builtins.test.ts` | The upstream-owned call site survives merges. It also proves R2's order, R1's switch and its read at construction, the named error for a missing package with loading continuing past it, and each port's registrations. | Every `./test.sh`, and after each upstream Pi merge into `personal`. |
| Upstream test suites | The mechanism changes no upstream behavior while the switch is off. | Every `./test.sh`. The pass condition is no failure absent from the Section 5 baseline; for coding-agent, exactly the 4 in Appendix A. |
| `npm run check` | Types, lint, pinned dependencies, import style, shrinkwrap and install lock. | After every code change. |
| Footprint checks | After T1, the numstat command shows the planned footprint. After an upstream Pi merge, the content check shows every fork line present exactly once. | After T1, and after each upstream Pi merge. |
| Parity check | The port commit holds the source bytes and modes. | During T3. |
| SPIKE-0003 mode harness | TUI, RPC, SDK, print, bundle, unbundled CLI, outside consumer and the end-to-end switch. | During T6, and at each later port through the port skill. |
| Sync exercise | The skill routes a real outcome. | During T5, then on each scheduled sync. |
| Fenced cutover check | A fenced session loads the built-in with no `rpiv-mono` grant. | During T9. |

**Footprint command, after T1.** It diffs against `BASE` from Section 5.

```
git diff --numstat "$BASE"..HEAD -- package.json scripts/check-pinned-deps.mjs \
  scripts/check-ts-relative-imports.mjs packages/coding-agent/src/core/extensions/loader.ts \
  packages/coding-agent/src/core/resource-loader.ts packages/coding-agent/vitest.config.ts
git diff --quiet "$BASE"..HEAD -- packages/coding-agent/npm-shrinkwrap.json packages/coding-agent/install-lock
```

Expected output: 10 insertions and 1 deletion in total, and exit 0 from the second command.

**Content check, after each upstream Pi merge.** A numstat against `BASE` stops meaning anything once upstream edits these files. Each fixed string below must occur exactly once in its file:

| File | Fixed string |
| --- | --- |
| `package.json` | `"packages/builtins/*",` |
| `scripts/check-pinned-deps.mjs` | `ignoredDirectories.add("builtins");` |
| `scripts/check-ts-relative-imports.mjs` | `ignoredDirectories.add("builtins");` |
| `packages/coding-agent/src/core/extensions/loader.ts` | `export async function loadExtensionFactoryFromPath(` |
| `packages/coding-agent/src/core/resource-loader.ts` | `import { forkBuiltInExtensions } from "./fork-builtins.ts";` |
| `packages/coding-agent/src/core/resource-loader.ts` | `this.extensionFactories = [...this.extensionFactories, ...forkBuiltInExtensions()];` |
| `packages/coding-agent/vitest.config.ts` | `PI_FORK_BUILTINS: "off"` |

Run `grep -cF '<string>' <file>` for each row; every count must be 1. `npm run check` then confirms that the shrinkwrap and install lock match their generators. Both checks cover only these six files. Drift in other upstream-owned files is ADR-0003's concern, outside this plan.

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| An upstream Pi merge conflicts on the changed `vitest.config.ts` line. | Keep both sides and re-add `PI_FORK_BUILTINS: "off"`. If the switch is lost, the exact tool-list assertions in `test/default-tools-setting.test.ts` fail (Appendix A), and the Section 7 content check flags it. |
| An upstream merge moves or renames the loader constructor or `loadExtensionModule`. | `fork-builtins.test.ts` fails, and `tsgo` flags a missing export. |
| Two copies load during cutover. | T9 removes the `settings.json` entry before the build. |
| A build in the shared checkout races with a new session's launch. | T9's quiet interval covers the install and the build. Running sessions keep their loaded modules. |
| The sync script deletes ignored files in the package directory. | Run `npm install --ignore-scripts` after every sync (skill rule). |
| Release scripts bump or publish a ported package. | ADR-0009 forbids release scripts on `personal` (T7). |
| An OpenIntent worker without a tool scope calls `ask_user_question`. | T8 hands the amendment to the owner. `PI_FORK_BUILTINS=off` is the interim control for unfenced workers only; fenced workers need the pi-fence change in T8. |
| R1 and R2 rest on a probe, not an opin-spike (report D9). | The owner accepted the probe (R5). Appendix A records the measurements, and `fork-builtins.test.ts` re-proves them on every run. |
| A sync fails after rewriting the package (exit 2 with a `scratch:` line). | The sync skill restores the package from `HEAD`, keeps the scratch evidence, and asks the owner before a retry. |
| Cleanup deletes another session's temporary files. | T10 deletes only paths this phase recorded, never a `/tmp/spike-000*` glob. |
| A built-in misbehaves in fenced sessions. | The switch does not reach them. T9's rollback disables the built-in in code before it restores `settings.json`. |

---

## 9. Done criteria

- T0 to T10 are complete, with the commits listed in Section 6.
- `npm run check` passes on the final branch head.
- `./test.sh` shows no failure absent from the Section 5 baseline.
- After T1, the footprint command reports 10 insertions and 1 deletion, with shrinkwrap and install lock unchanged.
- Every T6 check passes, or the owner has waived it explicitly before T9.
- The fenced and unfenced cutover sessions call `ask_user_question` successfully.
- `~/.pi/agent/settings.json` no longer lists rpiv-mono, and its backup exists.
- `docs/plans/built-in-extensions-phase1.results.md` and `docs/plans/built-in-extensions-phase1-evidence/` are committed on `personal`.

---

## 10. Later phases

Each later port runs `.pi/skills/port-extension/SKILL.md`, plus the per-package steps in the report's Section 5.3.

| Order | Package | Prerequisite before its port |
| --- | --- | --- |
| 2 | pi-tasks | Confirm its tool names and its event-bus contract with pi-subagents. |
| 3 | pi-subagents | Q6 sync policy. Decide what `extensions: false` means when built-ins always load. |
| 4 | pi-usage-bars | None. Its 8 unsynced upstream commits make the first merge-heavy sync. |
| 5 | pi-tokensave | Confirm the `tokensave` binary's path under the fence. |
| 6 | pi-claude-bridge | The OpenIntent amendment from T8 is accepted. Check its dependencies' install scripts under `--ignore-scripts`. |
| 7 | pi-hashline-edit-pro | Q5 ruling on the `read` override. The doorman already covers the tool name `read`; `anchor_grep` is not covered. |
| Separate | `vcc_recall` | Q7, and its own feature plan. |

---

## Appendix A. Probe measurements

**Baseline failures.** These exist on `384884dfe` without any change. They are the pass condition's expected set.

| Test file | Test |
| --- | --- |
| `test/experimental-presentation-facets.test.ts` | builds conventional plugin entries into the server-owned plugin cache |
| `test/experimental-presentation-facets.test.ts` | builds the example plugin package without a package-owned build script |
| `test/experimental-remote-runtime.test.ts` | passes client plugin packages to a cold server and restores them for its next generation |
| `test/suite/regressions/2791-fswatch-error-crash.test.ts` | should survive an error event on the theme FSWatcher |

**Failures the spiked mechanism added.** These are 23 tests in 8 files. With R1 and R2 applied, none of them fails.

| Test file | Failing tests |
| --- | --- |
| `test/resource-loader.test.ts` | 6: project manifest ownership, host dependency warning, symlinked extensions loaded once, user extensions before trust, command name collision, untrusted project resources |
| `test/default-tools-setting.test.ts` | 5: initial built-in selection, powershell selection, custom tools enabled, explicit tool precedence, service-based creation |
| `test/suite/regressions/6260-inline-extension-naming.test.ts` | 4: bare `<inline:N>`, named wrappers, hidden state, mixed factories |
| `test/builtin-tool-strict-mode.test.ts` | 3: re-registration without strict sampling, for three tool sets |
| `test/suite/skill-contract.test.ts` | 2: allowed-tools advisory, disallowed-tools advisory |
| `test/suite/regressions/3592-no-builtin-tools-keeps-extension-tools.test.ts` | 2: extension tools stay active, noTools through services |
| `test/agent-session-dynamic-tools.test.ts` | 1: registry refresh after late registration |

**Totals.**

| Run | Failed | Passed | Skipped |
| --- | --- | --- | --- |
| Baseline `384884dfe` | 4 | 3589 | 50 |
| Spiked mechanism with rpiv | 27 | 3566 | 50 |
| R1 and R2 with the draft `fork-builtins.test.ts` | 4 | 3593 | 50 |
| R1 and R2, with the call site removed | 2 of the draft tests fail | | |
| R1 and R2, with the switch read moved into `loadExtensionFactories` | The switch-timing test fails | | |

## Appendix B. Probe test file

This is `packages/coding-agent/test/fork-builtins.test.ts` from `/tmp/pi-builtins-probe`, formatted by Biome and checked by `tsgo`. It holds 5 tests. T1 commits it without the test named "registers the tools of rpiv-ask-user-question", and T3 adds that test back. `tsgo` needs the `InlineExtension[]` annotation on the `loader` helper.

```ts
// Fork-owned: guards the built-in extension mechanism (ADR-0009) across upstream merges.
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InlineExtension } from "../src/core/extensions/types.ts";
import { createForkBuiltInExtensions, FORK_BUILTIN_PACKAGES } from "../src/core/fork-builtins.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import type { ExtensionAPI } from "../src/index.ts";

const noop: (pi: ExtensionAPI) => void = () => {};

describe("fork built-in extensions", () => {
	let root: string;
	let cwd: string;
	let agentDir: string;

	beforeEach(() => {
		root = join(tmpdir(), `pi-fork-builtins-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		cwd = join(root, "project");
		agentDir = join(root, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function loader(extensionFactories: InlineExtension[] = [noop]) {
		return new DefaultResourceLoader({
			cwd,
			agentDir,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			extensionFactories,
		});
	}

	it("loads every listed package after the caller's factories, hidden, under noExtensions", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const subject = loader();
		await subject.reload();

		const { extensions, errors } = subject.getExtensions();
		expect(errors).toEqual([]);
		expect(extensions.map((extension) => extension.path)).toEqual([
			"<inline:1>",
			...FORK_BUILTIN_PACKAGES.map((name) => `<inline:${name}>`),
		]);
		expect(extensions.slice(1).every((extension) => extension.hidden === true)).toBe(true);
	});

	it("registers the tools of rpiv-ask-user-question", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const subject = loader([]);
		await subject.reload();

		const builtIn = subject
			.getExtensions()
			.extensions.find((extension) => extension.path === "<inline:@juicesharp/rpiv-ask-user-question>");
		expect(builtIn?.tools.has("ask_user_question")).toBe(true);
	});

	it("loads no built-in when PI_FORK_BUILTINS is off", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "off");
		const subject = loader();
		await subject.reload();

		expect(subject.getExtensions().extensions.map((extension) => extension.path)).toEqual(["<inline:1>"]);
	});

	it("reads the switch when the loader is constructed, not when it reloads", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const constructedOn = loader([]);
		vi.stubEnv("PI_FORK_BUILTINS", "off");
		const constructedOff = loader([]);
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		await constructedOff.reload();
		vi.stubEnv("PI_FORK_BUILTINS", "off");
		await constructedOn.reload();

		expect(constructedOn.getExtensions().extensions).toHaveLength(FORK_BUILTIN_PACKAGES.length);
		expect(constructedOff.getExtensions().extensions).toEqual([]);
	});

	it("reports a missing package by name and keeps loading the factories after it", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "off");
		const subject = loader([
			noop,
			...createForkBuiltInExtensions(["@pi-fork/missing-builtin"]),
			{ name: "sentinel", factory: noop },
		]);
		await subject.reload();

		const { extensions, errors } = subject.getExtensions();
		expect(extensions.map((extension) => extension.path)).toEqual(["<inline:1>", "<inline:sentinel>"]);
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe("<inline:@pi-fork/missing-builtin>");
		expect(errors[0].error).toContain("@pi-fork/missing-builtin");
	});
});
```

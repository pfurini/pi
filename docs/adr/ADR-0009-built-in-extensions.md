---
id: ADR-0009
status: accepted
---

# Ported extensions ship as built-ins through a checkout list inside coding-agent

The fork ships the extensions its owner uses every day as built-ins, not as installed packages. Each ported package lives under `packages/builtins/<name>/` as an npm workspace, and the fork owns its code. A fork-owned list in `packages/coding-agent/src/core/fork-builtins.ts` names the packages, and every `DefaultResourceLoader` loads them through one call site. `packages/coding-agent` declares no dependency on them; the names resolve through the monorepo's workspace links. SPIKE-0003 proved the mechanism on every session path (`openintent/experiments/spikes/0003-built-in-checkout-list/report.md`, verdict `PROVEN`).

## Decision

| Part | Rule |
| --- | --- |
| Location | A ported package lives in `packages/builtins/<name>/`, byte-identical to its source at the port, plus an `UPSTREAM.json` that records its upstream. |
| Fork-owned built-ins | Code the fork writes or rewrites, with no upstream, lives in `packages/coding-agent/src/core/fork-builtins/<name>/`. `FORK_OWNED_BUILTINS` in `fork-builtins.ts` lists each one as an inline factory. It has no `UPSTREAM.json` and takes no sync. `vcc_recall` is the first. |
| Loading | `fork-builtins.ts` holds the package names as data. It resolves each name with `createRequire(import.meta.url).resolve` and loads it through the jiti-backed extension loader. |
| Reach | Every `DefaultResourceLoader` merges the list, so the CLI, RPC mode, SDK services, third-party loaders in the same process and consumers that link to the checkout all load the built-ins, including under `noExtensions`. Built-ins load after the caller's factories, so upstream's `<inline:N>` numbering for unnamed factories stays unchanged. |
| Visibility | Each built-in is marked hidden, so the interactive startup `[Extensions]` section does not list it. |
| Control | A session's `tools` allowlist decides which built-in tools a session sees. A built-in tool outside the allowlist never enters the session registry and cannot be enabled at runtime. |
| Switch | `PI_FORK_BUILTINS=off` disables all built-ins in a process. Each loader reads it when it is constructed. `packages/coding-agent/vitest.config.ts` sets it, so upstream tests see no built-ins. pi-fence forwards it to the fenced child since pi-fence commit `83fa852`, so fenced sessions honor it too. |
| Failure | A listed package that cannot be resolved appears by name in `getExtensions().errors`; the session starts and the other built-ins load. |

The upstream-owned footprint is 9 added lines and 1 changed line, in six files, with no removed line:

| File | Lines | Purpose |
| --- | --- | --- |
| `package.json` | 1 added | The `packages/builtins/*` workspace glob. |
| `scripts/check-pinned-deps.mjs` | 1 added | Exempts `packages/builtins/` from the exact-pin rule. |
| `scripts/check-ts-relative-imports.mjs` | 1 added | Exempts `packages/builtins/` from the `.ts` import rule. |
| `packages/coding-agent/src/core/extensions/loader.ts` | 4 added | Exports `loadExtensionFactoryFromPath`. |
| `packages/coding-agent/src/core/resource-loader.ts` | 2 added | Imports the list and appends it to the caller's factories in the constructor. |
| `packages/coding-agent/vitest.config.ts` | 1 changed | Sets `PI_FORK_BUILTINS: "off"` in the test environment. |

A further built-in adds one entry to the fork-owned list and one folder, and no upstream-owned line. The shrinkwrap, the install lock and their generators stay untouched. These rules apply ADR-0003 to packaging: new code lives in new files, and hot upstream files receive only added call sites. The one changed line is a test setting outside the hot files ADR-0003 names.

A fork-owned built-in adds no upstream-owned line. Its code and its tests live in new files, and its list entry lives in the fork-owned `fork-builtins.ts`.

## Considered options

| Option | Why not chosen |
| --- | --- |
| A: the same list, with `packages/coding-agent` declaring each ported package as a dependency (SPIKE-0001, candidate A) | Each port adds a line next to a dependency line upstream changes almost every release. The lock generators need patching, and the published shrinkwrap would point at upstream's npm tarball rather than the fork's code. |
| B: an empty registry in `coding-agent` filled by a fork-owned distribution package that owns the `pi` command (SPIKE-0001, candidate B) | Every SDK consumer, OpenIntent's worker included, must import the fork entry, and forgetting it fails silently. The CLI would leave upstream's bundle. The operator rejected it. |

## Consequences

- **Checkout only.** The mechanism works only from this monorepo checkout. A published `coding-agent`, a Bun binary or a Node single-executable build would carry no built-ins. Publishing the fork would need a new decision.
- **Checks.** Ported packages keep their own version ranges and import style. `check:runtime-deps` does not see names held as data.
- **pi-fence.** A ported package leaves `~/.pi/agent/settings.json`, so the fence stops deriving a read grant for its fork checkout. The base profile already grants `~/Developer/ai/pi`, which holds the built-ins.
- **OpenIntent.** A worker that links to the checkout receives the built-ins without selecting them as extensions; its `tools` allowlist governs them. The workflow-engine design changes through its own amendment process.
- **Tests.** `packages/coding-agent/test/fork-builtins.test.ts` guards the call site, the load order, the switch and its read at construction, and each port's registrations. A ported package whose tests need its origin's tooling loses its `test` script in an owned commit.
- **Fork-owned built-ins.** Biome, `tsgo`, the import check and vitest cover `packages/coding-agent/src/core/` and `packages/coding-agent/test/`. Fork-owned built-ins therefore get the full check and test coverage that ported packages under `packages/builtins/` lack. OpenIntent workers receive `vcc_recall` like every built-in, and their `tools` allowlist governs it.
- **Release scripts.** Never run `version:*`, `release:*` or `publish` on `personal`. They would bump or publish the ported packages.
- **Open items.** SPIKE-0003 did not test OpenIntent's fenced worker entry or a second port with external dependencies.

## Amendment evidence

The 2026-09-25 amendment added the load order, the switch and the test policy. `docs/plans/built-in-extensions-phase1.plan.md` records the proof: Section 3 lists the verified facts, and Appendix A holds the probe measurements.

| Rule | Evidence |
| --- | --- |
| Load after the caller's factories (R2) | Prepending renumbered callers' unnamed factories and failed 23 upstream tests in 8 files. Appending restored the baseline exactly: 4 failed, the same 4 as without the mechanism. |
| The switch (R1) | With the switch set in the vitest config, the upstream suites show no failure beyond the baseline. `fork-builtins.test.ts` fails when the switch read moves from construction to reload. |
| Test policy (R3) | 27 of rpiv-ask-user-question's 37 test files fail to load in Pi, because they need rpiv-mono's test utilities and setup. |

Report decision D9 requires a spike before an ADR records a design choice. The owner granted one exception (R5): the probe above proves R1 and R2 instead of an opin-spike. `fork-builtins.test.ts` re-proves both on every `./test.sh`.

A second 2026-09-25 amendment added fork-owned built-ins. `docs/plans/vcc-recall-builtin.plan.md` records the proof: Section 3 lists the verified facts, and Appendix A holds the probe measurements.

| Rule | Evidence |
| --- | --- |
| An inline factory registers the tool with no upstream-owned line | `fork-builtins.test.ts` passed 8 of 8 with the change, and `git diff` touched only fork-owned files. |
| The list entry is guarded | Without `FORK_OWNED_BUILTINS` in `forkBuiltInExtensions()`, 3 tests in `fork-builtins.test.ts` fail. |
| The built outputs carry the tool | After `npm run build:offline`, `dist/index.js` registers `vcc_recall`, and `PI_FORK_BUILTINS=off` removes it. |
| In-memory entries equal the session file | 3,455 session files and 292,626 message entries showed 0 mismatches between the file and `SessionManager.open().getEntries()`. |

## Upstream sync

A ported package takes upstream changes through `scripts/fork/sync-upstream.sh`, a guarded merge in a scratch repository. SPIKE-0004 proved it on the fork's real sync history: it reproduced Git's own merge result for five consecutive pi-claude-bridge syncs and one rpiv-mono sub-folder sync (`openintent/experiments/spikes/0004-guarded-scratch-merge-sync/report.md`, verdict `PROVEN`). `.pi/skills/sync-upstream/SKILL.md` gives the procedure.

| Part | Rule |
| --- | --- |
| Record | `packages/builtins/<name>/UPSTREAM.json` holds `repository` (the local upstream clone), `path` (the sub-folder, or empty) and `base` (the last upstream commit merged, as 40 hex digits). |
| Provenance | Every commit that changes `UPSTREAM.json` carries the trailer `Upstream-Base: <base>`. Only the port and the sync write the record; nobody edits it by hand. |
| Guards | The sync refuses (exit 2) when the trailer does not match, when the package directory has uncommitted changes, or when the base is not an ancestor of the new commit or is missing from the clone. |
| Up to date | When the upstream sub-folder is unchanged, the sync advances only the base and exits 3. |
| Merge | Otherwise the sync merges base, the package as committed at `HEAD`, and the new upstream tree in a scratch repository, with Git's own rename and conflict handling. The result replaces the package directory and is staged with `git add -A -f`, so files Pi's `.gitignore` matches survive. It exits 0 when clean and 1 with conflicts. |
| Commit | The sync never commits and never fetches. A person or an agent refreshes the upstream clone first, reviews or resolves the result, and commits it with the trailer. |

Rejected methods:

| Method | Why not chosen |
| --- | --- |
| `git apply -3` of upstream's diff (SPIKE-0002, candidate A) | It aborts the whole patch on a modify/delete conflict, and exits 1 both for that and for an applied patch with conflicts. |
| A merge without guards (SPIKE-0002, candidate B) | It reports an unchanged upstream as a clean merge, and exits 0 while dropping upstream changes when the recorded base misdescribes the Pi side. |
| Git subtree or a vendor branch | The operator ruled for copied, owned code on 2026-09-25. |

One failure mode stays untested: a verified base that is an ancestor of the new commit, while the Pi side comes from another line. The provenance rule above is what prevents it.

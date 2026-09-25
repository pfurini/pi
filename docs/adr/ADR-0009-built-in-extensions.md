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
| Loading | `fork-builtins.ts` holds the package names as data. It resolves each name with `createRequire(import.meta.url).resolve` and loads it through the jiti-backed extension loader. |
| Reach | Every `DefaultResourceLoader` merges the list, so the CLI, RPC mode, SDK services, third-party loaders in the same process and consumers that link to the checkout all load the built-ins, including under `noExtensions`. |
| Visibility | Each built-in is marked hidden, so the interactive startup `[Extensions]` section does not list it. |
| Control | A session's `tools` allowlist decides which built-in tools a session sees. A built-in tool outside the allowlist never enters the session registry and cannot be enabled at runtime. |
| Failure | A listed package that cannot be resolved appears by name in `getExtensions().errors`; the session starts and the other built-ins load. |

The upstream-owned footprint is 9 added lines in five files, with no changed or removed line:

| File | Added lines | Purpose |
| --- | --- | --- |
| `package.json` | 1 | The `packages/builtins/*` workspace glob. |
| `scripts/check-pinned-deps.mjs` | 1 | Exempts `packages/builtins/` from the exact-pin rule. |
| `scripts/check-ts-relative-imports.mjs` | 1 | Exempts `packages/builtins/` from the `.ts` import rule. |
| `packages/coding-agent/src/core/extensions/loader.ts` | 4 | Exports `loadExtensionFactoryFromPath`. |
| `packages/coding-agent/src/core/resource-loader.ts` | 2 | Imports the list and merges it in the constructor. |

A further built-in adds one entry to the fork-owned list and one folder, and no upstream-owned line. The shrinkwrap, the install lock and their generators stay untouched. These rules apply ADR-0003 to packaging: new code lives in new files, and hot upstream files receive only added call sites.

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
- **Upstream sync.** SPIKE-0004 (`openintent/experiments/spikes/0004-guarded-scratch-merge-sync/report.md`) decides how a ported package takes upstream changes. This record gains that section when SPIKE-0004 settles.
- **Open items.** SPIKE-0003 did not test OpenIntent's fenced worker entry, a second port with external dependencies, or the release scripts, which would bump a non-private ported package's version.

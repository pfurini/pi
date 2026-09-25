---
id: SPIKE-0001
title: Can the Pi fork ship an extension as a built-in that every session path loads, within 15 added lines in upstream-owned files and without rewriting the ported files?
status: settled
kind: spike
date: 2026-09-25
verdict: DISPROVEN
verdicts:
  A: DISPROVEN
  B: DISPROVEN
settled: 2026-09-25
frozen-at: a63149b1991959f803ef215a21bf4d77f58ff6f7
unblocks:
  - docs/adr/ADR-0009-built-in-extensions.md
  - .pi/skills/port-extension/SKILL.md
  - /Users/paolof/.openintent/workspaces/pfurini/OpenIntent/worktrees/workflow-engine/openintent/changes/workflow-engine/design.md
---

# Can the Pi fork ship an extension as a built-in that every session path loads, within 15 added lines in upstream-owned files and without rewriting the ported files?

## Verdict

`DISPROVEN` for both candidates, and C3 alone decided it. Under the harder reading, C3's "tool registry" is the session registry that `AgentSession.getAllTools()` reports. Pi's `tools` allowlist filters that registry, so a built-in outside the allowlist never enters it. `spike/runs/A2610-C3-registry-detail.json` and `spike/runs/B-C3-registry-detail.json` both show exactly that. The cause is Pi's own allowlist semantics, identical for every extension and both candidates. Every other frozen claim is proved for both candidates.

**What blocked it, and what unblocks it.**

| Blocker | Evidence | Unblocking |
| --- | --- | --- |
| C3 assumes the `tools` allowlist filters activation only. Pi filters registration as well. | `_refreshToolRegistry` in `packages/coding-agent/src/core/agent-session.ts` drops tools outside `allowedToolNames` before it builds the registry. The C3 detail runs show the same. | A new spike whose C3 names the extension-level registration, or states the allowlist as a registration filter. `spike/harness/c3-registry-detail.mjs` already records both levels, so the harness answers it unchanged. |

**Why `DISPROVEN` and not `CONDITIONAL`.**

The frozen C3 reads: "*then* the tool registry holds the tool both times and the allowlist alone decides whether it is active".
The frozen terms table defines no "tool registry", and two readings exist.
The loaded built-in registers `ask_user_question` in both sessions, while the session registry holds it only when allowlisted.
The report contract takes the reading that is harder on the result.
The frozen kill criteria read: "A candidate that fails any one of those six claims ... is `DISPROVEN` in the per-candidate verdicts."
The `CONDITIONAL` row requires C1 to C5 proved, so a failed C3 cannot reach it.

**What survives for the follow-up spike and the ADR.**

| Observed fact | Candidate A, loader list | Candidate B, registry and distribution |
| --- | --- | --- |
| C1, C2, C4, C5, C6 and C7 | Proved. | Proved. |
| Added lines in upstream-owned files | 12, plus 1 per further built-in. | 11, and none per further built-in. |
| Lock generators | Changed by one line each. The shrinkwrap resolves the ported package to upstream's npm tarball. | Unchanged. |
| A bare SDK import with no fork entry | Receives the built-ins. | Receives none. The consumer must import `packages/distribution/index.mjs` first. |
| CLI entry | Upstream's bundle, `dist/bundle/cli.js`. | The unbundled `dist/index.js`, through `packages/distribution/bin/pi.mjs`. |
| Allowlist behavior | A built-in outside the allowlist cannot be enabled at runtime. | The same. |

Under the extension-level reading, C3 would hold for both candidates.
Candidate A would then meet the `PROVEN` row, subject to the Node ruling below.
Candidate B would meet the `CONDITIONAL` row, because a bare SDK import receives no built-ins.
That reading is not the one this verdict applies.

**Rulings and departures recorded during the run.**

| Ruling or departure | Cost | Claim |
| --- | --- | --- |
| Homebrew replaced Node 26.8.2 with 26.10.0 at 09:57:55 UTC. The operator ruled to use 26.10.0. | The frozen versions table names 26.8.2. Candidate A proved C1 to C5 and C7 under both versions. Candidate B's behavioral claims and both C6 runs ran under 26.10.0 only. | C1 to C6 |
| The coordinator drove C6 and edited `~/.pi/agent/settings.json` for about four minutes, with approval. | The frozen time box named the operator for C6. The opin-spike harness rule forbids a harness starting a sandbox. | C6 |
| The coordinator answered the C1 questionnaire through a pseudo-terminal, because tmux is absent. | The frozen time box named the operator for C1. | C1 |

**Routing.**

`docs/adr/ADR-0009-built-in-extensions.md` and `.pi/skills/port-extension/SKILL.md` do not exist yet.
Neither can cite an injection decision this spike did not reach.
Both will cite this report and the follow-up spike when they are written.
The routing leaves `/Users/paolof/.openintent/workspaces/pfurini/OpenIntent/worktrees/workflow-engine/openintent/changes/workflow-engine/design.md` unedited for now.
Its D8 and D16 change only once an injection decision exists, and the follow-up spike's verdict routes there.

<!-- OPENINTENT:FROZEN:START -->

## Why this spike exists

`docs/adr/ADR-0009-built-in-extensions.md` records where the Pi fork injects its built-in extensions, and it waits on this answer.
`.pi/skills/port-extension/SKILL.md` repeats the injection step for every ported package, so a wrong choice multiplies across seven ports.
`/Users/paolof/.openintent/workspaces/pfurini/OpenIntent/worktrees/workflow-engine/openintent/changes/workflow-engine/design.md` D8 and D16 build worker sessions through the SDK with discovery off, and their resource policy changes with the answer.

Three places construct the extension loader: `packages/coding-agent/src/core/agent-session-services.ts:148`, `packages/coding-agent/src/core/sdk.ts:202` and `pi-subagents/src/agent-runner.ts:822`.
The existing built-in list reaches only the CLI, through `packages/coding-agent/src/main.ts:568`.
An injection point that misses one construction site leaves a session without its built-ins, and the failure is silent.
The ported packages also ship TypeScript only and import runtime values from `@earendil-works/pi-coding-agent`, so loading from compiled output is unverified.
OpenIntent's 2026-09-17 kernel-loading amendment measured the same class of failure: every gate stayed green while compiled output could not load the module.

## The question

**Can the Pi fork ship an extension as a built-in that every session path loads, within 15 added lines in upstream-owned files and without rewriting the ported files?**

| Term | Meaning in this spike |
| --- | --- |
| Built-in | An extension that a session loads with no `settings.json` package entry, no install, no CLI flag and no pi-fence grant, including when `noExtensions` is set. |
| Session path | One of four: the interactive CLI, RPC mode, `createAgentSessionServices`, and a `DefaultResourceLoader` that code outside `packages/coding-agent` constructs in the same process. |
| Every session path | All four session paths, each run from compiled output under plain Node, never through `tsx` or vitest. |
| Upstream-owned file | A file that exists at `earendil-works/main`. |
| Added lines | Lines that `git diff --numstat eda5a402a` reports as added in upstream-owned files, excluding `package-lock.json`, `packages/coding-agent/npm-shrinkwrap.json` and `packages/coding-agent/install-lock/`, which their generators rewrite after every merge. |
| Rewriting the ported files | Any byte difference between the ported directory and `packages/rpiv-ask-user-question` at rpiv-mono `8403bb09`, other than one added upstream-record file. |
| Ported package | `@juicesharp/rpiv-ask-user-question`, the test case for both candidates. |

## Candidates

| Label | Package | Version | What we supply |
| --- | --- | --- | --- |
| A, loader list | `@earendil-works/pi-coding-agent` | fork `personal` at `eda5a402a` | `packages/coding-agent` depends on the ported package. A fork-owned module lists the built-ins, and `DefaultResourceLoader` merges that list through one call site. |
| B, registry and distribution | `@earendil-works/pi-coding-agent` plus a new fork-owned distribution package | fork `personal` at `eda5a402a` | `packages/coding-agent` gains a fork-owned registry module and one call site in `DefaultResourceLoader`. The distribution package depends on `packages/coding-agent` and the ported package, registers the ported package on import, and owns the `pi` bin. |

## Claims

Each claim is independently falsifiable and is tested on its own. The verdict is a function of which ones hold, by the boundaries below. A claim states what must be true; its expected observation states what the harness is expected to show, and the observation can be refuted without the claim failing.

Every claim is observed once per candidate.

**C1, interactive CLI.**
*Given* the candidate's bundled `pi`, an agent directory whose `settings.json` lists no package, and `--no-extensions`, *when* a scripted provider requests `ask_user_question` and the operator answers in the TUI, *then* the next provider request carries the chosen answer as the tool result.
Expected observation: the scripted provider's request log shows the answer label, and the startup resource listing (`showLoadedResources` in `packages/coding-agent/src/modes/interactive/interactive-mode.ts`) does not show the built-in.

**C2, RPC mode.**
*Given* the setup of C1 under `pi --mode rpc`, *when* the scripted provider requests `ask_user_question`, *then* the tool reaches the RPC client as an `extension_ui_request` and the client's `extension_ui_response` becomes the tool result.
Expected observation: stdout carries one `extension_ui_request` with method `select`, and the matching `tool_execution_end` carries the chosen label.

**C3, SDK services path.**
*Given* `createAgentSessionServices` with `noExtensions: true`, loaded from compiled output under plain Node, *when* a session is created once with a `tools` allowlist that omits `ask_user_question` and once with one that includes it, *then* the tool registry holds the tool both times and the allowlist alone decides whether it is active.
Expected observation: the registry lists `ask_user_question` in both sessions, and the active tool list contains it only in the second.

**C4, third-party loader.**
*Given* a module outside `packages/coding-agent` that constructs `DefaultResourceLoader` with `noExtensions: true` in the same process as C3, *when* the loader reloads, *then* its extension list includes the built-in.
Expected observation: `getExtensions().extensions` contains one entry that registers `ask_user_question`.

**C5, provider built-in.**
*Given* a fixture built-in that registers the provider `spike-fixture`, shipped the way the candidate ships the ported package, *when* the CLI starts with `--model spike-fixture/echo` and C3's path resolves the same pair, *then* both resolve before the first turn and the CLI turn completes from the fixture.
Expected observation: `pi -p --model spike-fixture/echo` prints the fixture's reply, and `modelRuntime.getModel("spike-fixture", "echo")` returns a model.

**C6, fenced session.**
*Given* a fenced launch whose read grants cover the Pi checkout that holds the build and do not cover `~/Developer/ai/rpiv-mono`, *when* the operator repeats C1's flow, *then* the turn completes.
Expected observation: the violations journal of that launch records no denial for any path under the Pi checkout or under `~/Developer/ai/rpiv-mono`.

**C7, merge hygiene and byte parity.**
*Given* the candidate's complete change, *when* `npm run check` has run, *then* upstream-owned files carry at most 15 added lines and no changed or removed line, the ported files are not rewritten, and `npm run check` passes.
Expected observation: `git diff --numstat eda5a402a` over upstream-owned files sums to at most 15 added and 0 removed, and `diff -r` against the rpiv-mono `8403bb09` package lists only the upstream-record file.

## Kill criteria

Written before any code, and not edited afterwards.

The spike is **DISPROVEN** if, after honest effort within the time box, no candidate proves all of C1, C2, C3, C4, C5 and C7 while C6 records no denial under `~/Developer/ai/rpiv-mono`. A candidate that fails any one of those six claims, or whose C6 run records a denial under `~/Developer/ai/rpiv-mono`, is `DISPROVEN` in the per-candidate verdicts.

Things that are explicitly **not** kill conditions, named now so they cannot be promoted into one later to manufacture a failure, nor dismissed later to manufacture a success:

- C6 does not run within the time box, because the operator's fenced launch is unavailable: `CONDITIONAL`.
- C6 observes a denial that one named grant in pi-fence's base profile removes, and the grant covers a path other than `~/Developer/ai/rpiv-mono`: `CONDITIONAL`.
- An SDK consumer outside this repository, such as the OpenIntent worker, must import a fork entry point to receive the built-ins: `CONDITIONAL`.
- The built-in appears in an extension listing in any mode: `CONDITIONAL`.
- The ported package loads only after a `package.json` edit, with no other file changed: `CONDITIONAL`.
- The scripted provider for C1 and C2 is a harness extension passed with `-e`, because it is test apparatus and not the thing under test: `PROVEN`.

## Verdict boundaries

Each outcome the kill criteria name maps to exactly one row here, and the two sections were checked against each other before freezing.

| Verdict | Condition |
| --- | --- |
| `PROVEN` | For the candidate, C1 to C7 are all proved, with no patch to the ported package. A harness extension passed with `-e` as the scripted provider does not prevent this row. |
| `CONDITIONAL` | For the candidate, C1 to C5 and C7 are proved, and one or more named restrictions apply: C6 unrun, C6 needing one named grant outside `~/Developer/ai/rpiv-mono`, an external SDK consumer importing a fork entry point, the built-in appearing in an extension listing, or a `package.json` edit. The verdict names each restriction, its cost and the claim that exposed it. |
| `DISPROVEN` | The kill criterion above is met. The verdict names what blocked it and what it would take to unblock it. |

A verdict of `PROVEN` requires every claim to be marked **proved**, observed running here. Any claim that ends the spike marked **inferred** forces `CONDITIONAL` at best, whatever the reasoning behind it.

## Versions under test

The verdict is only a verdict about these. This table holds the things the question is about; everything the harness installs is recorded in the evidence half.

| Thing | Version |
| --- | --- |
| Pi fork, `@earendil-works/pi-coding-agent` | 0.87.1, branch `personal` at `eda5a402a`, committed 2026-09-24, working tree clean |
| `@juicesharp/rpiv-ask-user-question` | 2.11.0, rpiv-mono branch `personal` at `8403bb09`, committed 2026-09-24 |
| `@juicesharp/rpiv-config` | 2.11.0, the published npm release |
| pi-fence | branch `main` at `e8c0600`, committed 2026-09-24, working tree clean apart from two untracked documents under `docs/` |
| Node.js | 26.8.2 |

## What was already known when the question was frozen

Recorded so the evidence table is honest about what this spike discovered versus what it confirmed. All of the following is documentation and source reading, not observation, and none of it is evidence until it is run.

| Prior | Source |
| --- | --- |
| `DefaultResourceLoader` loads factory-supplied extensions even when `noExtensions` is set. | `packages/coding-agent/src/core/resource-loader.ts:1617`; the OpenIntent worker relies on it in `packages/workflow/src/pi/worker-entry.ts`. |
| `-e` extensions still load under `--no-extensions`. | `packages/coding-agent/src/core/resource-loader.ts:819` keeps the CLI paths when `noExtensions` is set. |
| The existing built-in llama.cpp registers a provider and a command, and a `hidden` flag keeps it out of the interactive listing. | `packages/coding-agent/src/extensions/llama/index.ts:44` and `:183`; `packages/coding-agent/src/modes/interactive/interactive-mode.ts:1731`. |
| RPC mode implements `select` but returns nothing from `custom()`. | `packages/coding-agent/src/modes/rpc/rpc-mode.ts:238`; the ported package ships `rpc-fallback.ts` for that reason. |
| The ported package imports `getMarkdownTheme` and `DynamicBorder` as values from `@earendil-works/pi-coding-agent`. | `state/build-questionnaire.ts:1` and `view/dialog-builder.ts:1` at rpiv-mono `8403bb09`. Candidate A therefore creates a package cycle. |
| `npm run check` rewrites files through `biome check --write` for `packages/*/src/**`, and `scripts/check-ts-relative-imports.mjs` rejects relative `.js` specifiers across the whole repository. | Root `package.json`, `biome.json` and the script source. The ported package uses `.js` specifiers throughout. |
| `@juicesharp/rpiv-config` reads configuration under `~/.config`, which pi-fence's base profile does not grant. | `packages/rpiv-config/config.ts:34` at rpiv-mono `8403bb09`. The read is runtime state, unrelated to where the code lives. |

| Claim | Honest prior |
| --- | --- |
| C1 | Likely for both candidates, because the CLI already loads llama.cpp as a built-in. |
| C2 | Likely, because the ported package ships an RPC fallback. |
| C3 | Likely from source, uncertain from compiled output because the ported package ships TypeScript only. |
| C4 | Likely for A. Uncertain for B, because two resolved copies of `packages/coding-agent` would give two registries. |
| C5 | Likely on the CLI path from the llama.cpp precedent; unverified on the SDK path. |
| C6 | Likely, because pi-fence's base profile grants `~/Developer/ai/pi` in full. |
| C7 | Uncertain for both, because the ignore entries, workspace entry and dependency edits compete for the 15-line limit. |

The spike is still worth running because C3, C4 and C7 are uncertain, and each of them decides the ADR on its own.

## Time box and budget

| Item | Value |
| --- | --- |
| Time box | One session. |
| Model calls | None. A scripted provider drives every turn, so the turn cap is zero live calls. |
| Harness runner | This session builds and runs the harnesses for C1 to C5 and C7. |
| Operator steps | The operator answers the TUI question in C1 and launches the fenced session for C6. |

<!-- OPENINTENT:FROZEN:END -->

## Evidence

Every conclusion is marked **proved** (observed running here) or **inferred** (reasoned, not run).

### Harness

The worktree was `~/.openintent/workspaces/pfurini/pi/worktrees/spike-0001`, branched from `frozen-at` `a63149b`.
Candidate A was built at worktree commit `c086f8385`; `spike/candidates/A.patch` preserves it, because the branch head holds candidate B.
Both candidates carry the ported package, copied by `git archive` from rpiv-mono `8403bb09` into `packages/builtins/rpiv-ask-user-question`.
Both carry the fixture built-in `packages/builtins/spike-fixture-provider`, shipped the way each candidate ships the ported package.

| File | What it does | Command, from the worktree root |
| --- | --- | --- |
| `spike/c7-measure.sh` | C7: counts added and removed lines per file against `eda5a402a`, classifies each file as upstream-owned when it exists at `earendil-works/main`, and diffs the ported directory and file modes against rpiv-mono `8403bb09`. | `spike/c7-measure.sh <label>` |
| `spike/harness/scripted-provider.ts` | Apparatus loaded with `-e`: a faux provider whose first turn calls `ask_user_question` and whose second turn records the tool result. | Loaded by the C1, C2 and C6 harnesses. |
| `spike/harness/pty_drive.py` | Drives an interactive program in a pseudo-terminal and renders its screens with pyte. | `uv run --with pyte python spike/harness/pty_drive.py <script.json>` |
| `spike/harness/c1-tui.sh` | C1: runs the candidate's `pi` with an agent directory that lists no package, under `--no-extensions`, and answers with Enter. | `PI_BIN=<bin> spike/harness/c1-tui.sh <label>` |
| `spike/harness/c2-rpc.mjs` | C2: runs `pi --mode rpc`, answers the `select` request with the option naming "Teal", and records every line. | `PI_BIN=<bin> node spike/harness/c2-rpc.mjs <label>` |
| `spike/harness/c3-c5-sdk.mjs` | C3, C4 and the SDK half of C5 under plain Node, with the OpenIntent worker's discovery settings. | `node spike/harness/c3-c5-sdk.mjs <label> [entry]` |
| `spike/harness/c3-registry-detail.mjs` | C3 detail: extension-level registration against `getAllTools()`, and a runtime attempt to enable the built-in. | `node spike/harness/c3-registry-detail.mjs <label> [entry]` |
| `spike/harness/c4-direct-import.mjs` | Supporting: constructs a loader after a bare-specifier SDK import, with and without a fork entry imported first. | `node spike/harness/c4-direct-import.mjs <label> bare-only\|after-entry=<entry>` |
| `spike/harness/c5-cli.sh` | C5, CLI half: `--list-models spike-fixture` and `-p --model spike-fixture/echo`. | `PI_BIN=<bin> spike/harness/c5-cli.sh <label>` |
| `spike/harness/c6-fenced.sh` | C6: C1's flow under `pi-fence run --profile general`, answering the trust dialog with "Do not trust (this session only)", then the launch's violations journal. | `spike/harness/c6-fenced.sh <label> <bin>` |

Raw output lives in `spike/runs/`, one file per run and never overwritten.
Label `A` marks candidate A under Node 26.8.2, `A2610` candidate A under Node 26.10.0, and `B` candidate B.

| Candidate | CLI and RPC bin, by absolute path | SDK entry, by absolute path |
| --- | --- | --- |
| A | `<worktree>/packages/coding-agent/dist/bundle/cli.js` | `<worktree>/packages/coding-agent/dist/index.js` |
| B | `<worktree>/packages/distribution/bin/pi.mjs` | `<worktree>/packages/distribution/index.mjs` |

Every run used compiled output under plain Node; no run used tsx or vitest.

### Harness versions

| Thing | Version |
| --- | --- |
| Node.js | 26.8.2 until 09:57:55 UTC, then 26.10.0 (Homebrew `node 26.10.0_1`) by the operator's ruling |
| npm | 11.19.1 |
| `@juicesharp/rpiv-config` | 2.11.0, installed from npm into the worktree |
| uv | 0.12.19 |
| Python and pyte | Python 3.11.16, pyte 0.8.2, resolved by `uv run --with pyte` |
| pi-fence | `e8c0600`, `dist/` built 2026-09-24 21:48, runtime `@anthropic-ai/sandbox-runtime` 0.0.75 |
| Git | 2.55.0 |
| mise Node 26.8.2 | Installed at 09:59 UTC to restore the frozen version, then removed after the operator's ruling; no run used it |

### Budget spent

No model was called.
Every turn ran on a faux provider: `spike/harness/scripted-provider.ts` for C1, C2 and C6, and `packages/builtins/spike-fixture-provider` for C5.
The run stayed within the one-session time box.

### Claims

| Claim | Result | Status | What showed it |
| --- | --- | --- | --- |
| C1, interactive CLI | Holds for A and B. The questionnaire renders, "Teal" reaches the scripted provider as the tool result, and `[Extensions]` lists only `scripted-provider.ts`. | **proved** | `spike/runs/A-C1-tui.txt`, `spike/runs/A2610-C1-tui.txt`, `spike/runs/B-C1-tui.txt` and their `-C1-scripted.jsonl` logs |
| C2, RPC mode | Holds for A and B. One `extension_ui_request` with method `select` arrives, and the response "1. Teal — The first option." becomes the tool result. | **proved** | `spike/runs/A-C2-rpc.jsonl`, `spike/runs/A2610-C2-rpc.jsonl`, `spike/runs/B-C2-rpc.jsonl` |
| C3, SDK services path | Fails for A and B under the harder reading. The built-in registers `ask_user_question` in both sessions, but `getAllTools()` lists it only when allowlisted. | **proved** | `spike/runs/A-C3-C5-sdk.json`, `spike/runs/A2610-C3-registry-detail.json`, `spike/runs/B-C3-C5-sdk.json`, `spike/runs/B-C3-registry-detail.json` |
| C4, third-party loader | Holds for A and B. A loader constructed in `spike/harness/` loads both hidden built-ins. Candidate B needs its distribution entry imported in the same process. | **proved** | `spike/runs/A2610-C3-C5-sdk.json`, `spike/runs/B-C3-C5-sdk.json`, `spike/runs/B-C4-direct-after-entry.json` |
| C5, provider built-in | Holds for A and B. `--list-models` lists `spike-fixture/echo`, `-p` prints `FIXTURE-ECHO: cli path hello`, and `getModel` resolves the pair. | **proved** | `spike/runs/A-C5-cli.txt`, `spike/runs/A2610-C5-cli.txt`, `spike/runs/B-C5-cli.txt`, the `-C3-C5-sdk.json` runs |
| C6, fenced session | Holds for A and B. With no grant on `rpiv-mono`, the flow completes, and the journal records only `auth.json` read denials and one DNS lookup. | **proved** | `spike/runs/C6-01-dry-run-after-edit.txt`, `spike/runs/A2610-C6-fenced.txt`, `spike/runs/B-C6-fenced.txt` |
| C7, merge hygiene and byte parity | Holds for A and B. A adds 12 lines and B adds 11 in upstream-owned files, none removed. The ported directory matches except `UPSTREAM.json`, and `npm run check` passes. | **proved** | `spike/runs/A-C7-measure.txt`, `spike/runs/A-07-check.log`, `spike/runs/B-C7-measure.txt`, `spike/runs/B-02-check.log`, `spike/runs/B-04-check-node2610.log` |

### Supporting conclusions

| Conclusion | Status | What showed it |
| --- | --- | --- |
| `scripts/check-pinned-deps.mjs` rejects `^2.11.0` in the ported `package.json`. One added exclusion line for `packages/builtins/` keeps byte parity and weakens the pin rule there. | **proved** | `spike/runs/A-04-check.log`, `spike/runs/A-05-check.log` |
| Candidate A needs one added line in each lock generator. Its shrinkwrap then resolves the ported package to upstream's npm tarball, so a published `coding-agent` would install upstream's code. | **proved** | `spike/runs/A-06-regenerate-locks.log`, `spike/runs/A-C7-measure.txt` |
| Candidate A costs one added line in `packages/coding-agent/package.json` per further built-in. Candidate B costs none. | **proved** | `spike/runs/A2610-C7-measure.txt`, `spike/runs/B-C7-measure.txt` |
| A bare-specifier SDK import receives the built-ins under A, and none under B until the distribution entry is imported. | **proved** | `spike/runs/A2610-C4-direct-bare-only.json`, `spike/runs/B-C4-direct-bare-only.json`, `spike/runs/B-C4-direct-after-entry.json` |
| `setActiveToolsByName` cannot enable a built-in outside the `tools` allowlist. | **proved** | `spike/runs/A2610-C3-registry-detail.json`, `spike/runs/B-C3-registry-detail.json` |
| Today's fence derives read grants on seven fork checkouts from `~/.pi/agent/settings.json` packages. | **proved** | `spike/runs/C6-00-dry-run-general.txt` |
| Choosing "Trust" in the project-trust dialog inside the fence crashes pi with an uncaught `EPERM` on `~/.pi/agent/trust.json`. | **proved** | `spike/runs/B-C6-fenced-attempt1-trust-prompt.txt` |
| pi-fence drops `PI_CODING_AGENT_DIR` from the child environment. | **inferred** | `DROPPED_ENV_NAMES` in pi-fence `src/launch/env.ts` |
| Candidate B's `pi` bin runs the unbundled `dist/index.js`, not upstream's esbuild bundle. | **proved** | `packages/distribution/bin/pi.mjs` imports `@earendil-works/pi-coding-agent`, whose export map selects `dist/index.js` |

### Re-verified by the coordinator

No subagent ran a harness.
The coordinator read every claim from the raw run files that the Claims table names.

### What this spike did not test

| Not tested | Where it belongs |
| --- | --- |
| `pi-claude-bridge` and `pi-hashline-edit-pro` | Their own port sessions. |
| Node 22.19, the declared floor, and Linux | A release qualification. |
| The Bun binary and the Node SEA build, where the fork module's `createRequire(...).resolve` is unverified | The follow-up spike, if either build matters. |
| npm publication of either candidate | The ADR, which decides whether the fork publishes. |
| Startup time of candidate B's unbundled bin against the bundle | The follow-up spike. |
| `pi-subagents`' real in-process loader | Its own port; C4 simulates it with a bare-specifier import. |
| The OpenIntent worker entry itself | The OpenIntent change; C3 reproduces only its discovery settings. |
| The `trust.json` crash inside the fence | pi-fence and the fork, as a separate issue. |
| The upstream sync method | SPIKE-0002. |

## Cleanup

| Path | What it holds | State |
| --- | --- | --- |
| `/tmp/spike-0001-*` | 18 entries: temporary agent directories, working directories and two C1 script files | Present; safe to delete. |
| `/var/folders/vf/p_cnzz_s1mjcy26fxr1k7c9m0000gn/T/spike-0001-*` | 28 temporary agent and working directories from the Node harnesses | Present; safe to delete. |
| `~/.pi/agent/sessions/--Users-paolof-.openintent-workspaces-pfurini-pi-worktrees-spike-0001--/` | Two session files from the C6 runs | Present; safe to delete. |
| `~/.pi-fence/violations/20260925T100715Z-429d2970.jsonl`, `20260925T100839Z-ed1d5feb.jsonl`, `20260925T100913Z-68fb263f.jsonl` | The three C6 launch journals, copied into the C6 run files | Present; removal is the operator's call. |
| `~/.pi/agent/settings.json` | Edited for C6, then restored byte-identical, SHA-256 `088a665e…` | Restored; the backup file is removed. |
| `~/.local/share/mise/installs/node/26.8.2` | Node 26.8.2 | Installed, then removed. |
| uv's cache | pyte 0.8.2 | Present in uv's cache. |

## Template gaps

| Gap | What the run did |
| --- | --- |
| The frozen versions table cannot follow a runtime the host upgrades during the run. | The operator's ruling sits in the Verdict and in Harness versions. |
| The harness rule forbids a harness starting a sandbox, and a fenced claim needed an edit to operator configuration. | The operator approved the coordinator driving C6 unfenced, with `pi-fence run` wrapping only the child. |
| The freeze check does not flag an undefined term inside a claim. | "Tool registry" stayed undefined in C3 and decided this verdict. |

## Spike code

`evidence.patch`, beside this file: one squashed commit of the worktree branch. Built in an isolated worktree, never merged, never pushed as a branch, never opened as a pull request. To re-check a decayed verdict, run `/skill:opin-spike re-check` on this spike; it applies the patch into a fresh worktree.

Apply the patch onto `frozen-at` in a fresh worktree, then run `npm install --ignore-scripts` and `npm run build`.
The patched tree holds candidate B; `spike/candidates/A.patch` rebuilds candidate A on a clean `eda5a402a` tree.
`spike/README.md` lists every harness command, and C6 needs `~/.pi/agent/settings.json` without the `rpiv-mono` package.

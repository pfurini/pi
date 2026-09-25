---
id: SPIKE-0001
title: Can the Pi fork ship an extension as a built-in that every session path loads, within 15 added lines in upstream-owned files and without rewriting the ported files?
status: open
kind: spike
date: 2026-09-25
verdict: null
unblocks:
  - docs/adr/ADR-0009-built-in-extensions.md
  - .pi/skills/port-extension/SKILL.md
  - /Users/paolof/.openintent/workspaces/pfurini/OpenIntent/worktrees/workflow-engine/openintent/changes/workflow-engine/design.md
---

# Can the Pi fork ship an extension as a built-in that every session path loads, within 15 added lines in upstream-owned files and without rewriting the ported files?

## Verdict

_Pending. Written in pass 2, after the evidence. Everything between the frozen markers below is fixed once `run` stamps `frozen-at`; this section and everything after the end marker is pass 2._

<!-- opin-spike: pass 2. First paragraph, at most 100 words: the verdict token in backticks and the single piece of evidence that decided it. Then, as needed: the restrictions as a table (restriction, cost, claim); what survives or is unblocked, naming which unblocks entries the routing will edit and why any will not; why this verdict and not its neighbour, quoting the frozen sentences that decided it. No sentence over 25 words. Replace the pending line above as well. -->

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

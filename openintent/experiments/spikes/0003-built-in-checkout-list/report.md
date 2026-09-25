---
id: SPIKE-0003
title: Can a fork-owned list inside coding-agent that resolves ported packages through the monorepo's workspace links make every session path load them, within 10 added upstream-owned lines and none per further built-in?
status: open
kind: spike
date: 2026-09-25
verdict: null
frozen-at: 42cf76d687eb64864be518c15b46a91e881b679b
unblocks:
  - docs/adr/ADR-0009-built-in-extensions.md
  - .pi/skills/port-extension/SKILL.md
  - /Users/paolof/.openintent/workspaces/pfurini/OpenIntent/worktrees/workflow-engine/openintent/changes/workflow-engine/design.md
---

# Can a fork-owned list inside coding-agent that resolves ported packages through the monorepo's workspace links make every session path load them, within 10 added upstream-owned lines and none per further built-in?

## Verdict

_Pending. Written in pass 2, after the evidence. Everything between the frozen markers below is fixed once `run` stamps `frozen-at`; this section and everything after the end marker is pass 2._

<!-- opin-spike: pass 2. First paragraph, at most 100 words: the verdict token in backticks and the single piece of evidence that decided it. Then, as needed: the restrictions as a table (restriction, cost, claim); what survives or is unblocked, naming which unblocks entries the routing will edit and why any will not; why this verdict and not its neighbour, quoting the frozen sentences that decided it. No sentence over 25 words. Replace the pending line above as well. -->

<!-- OPENINTENT:FROZEN:START -->

## Why this spike exists

`docs/adr/ADR-0009-built-in-extensions.md` will record how the Pi fork ships built-in extensions, and it waits on this answer.
`.pi/skills/port-extension/SKILL.md` will repeat the injection step for every ported package.
Neither file exists yet; the routing step after settle creates or edits them.
`/Users/paolof/.openintent/workspaces/pfurini/OpenIntent/worktrees/workflow-engine/openintent/changes/workflow-engine/design.md` D8 and D16 build worker sessions through the SDK, reached through a symbolic link to the fork's `packages/coding-agent`.

SPIKE-0001 (`openintent/experiments/spikes/0001-built-in-extension-injection/report.md`) settled `DISPROVEN` on an undefined term in its C3; its other claims were proved for two candidates.
The operator chose a third mechanism on 2026-09-25, recorded here as the checkout list, and ruled that a `DISPROVEN` verdict opens a joint design discussion rather than a fallback to SPIKE-0001's candidate B.
The checkout list declares no dependency from `packages/coding-agent` on the ported packages, so resolution rests on the monorepo's workspace links alone.
Without a declared dependency, that resolution is unobserved for three consumers: the esbuild bundle, a consumer outside the monorepo that links to the checkout, and a listed package that fails to resolve.

## The question

**Can a fork-owned list inside coding-agent that resolves ported packages through the monorepo's workspace links make every session path load them, within 10 added upstream-owned lines and none per further built-in?**

| Term | Meaning in this spike |
| --- | --- |
| Checkout | The spike worktree at `~/.openintent/workspaces/pfurini/pi/worktrees/spike-0003`, at the `frozen-at` commit, whose files outside `openintent/` and `spike/` equal `0be71ca`'s before the change, built there with `npm run build`. |
| Checkout list | A fork-owned module in `packages/coding-agent/src/core/` that holds the ported package names as data. It resolves each name with `createRequire(import.meta.url).resolve`, and `DefaultResourceLoader` merges the resulting factories through one call site. `packages/coding-agent/package.json` declares no dependency on any ported package. The spike accepts that `check:runtime-deps` does not see names passed as data. |
| Ported package | `@juicesharp/rpiv-ask-user-question`, copied from rpiv-mono `8403bb09` into `packages/builtins/rpiv-ask-user-question`, plus a fixture package under `packages/builtins/` that registers the provider `spike-fixture` with the model `echo`. |
| Built-in | An extension that a session loads with no `settings.json` package entry, no install, no CLI flag and no pi-fence grant beyond one that covers the checkout, including when `noExtensions` is set. |
| Session path | One of five: the interactive CLI, RPC mode, `createAgentSessionServices`, a `DefaultResourceLoader` constructed by code outside `packages/coding-agent` in the same process, and an outside consumer. |
| Outside consumer | A Node process whose working directory and `node_modules` lie outside the checkout, and whose `node_modules/@earendil-works/pi-coding-agent` is a symbolic link to the checkout's `packages/coding-agent`, the shape OpenIntent's worker uses. |
| Every session path | All five session paths, each run from compiled output under plain Node, never through `tsx` or vitest. |
| Discovery switches off | `noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes` and `noContextFiles` all set to `true`. |
| Extension registration | The tool names in the `tools` map of the built-in's entry in `resourceLoader.getExtensions().extensions`. |
| Session registry | The tool names `AgentSession.getAllTools()` returns. |
| Active tools | The tool names `AgentSession.getActiveToolNames()` returns. |
| Upstream-owned file | A file that exists at `earendil-works/main` commit `a7d17e39`. |
| Added lines | Lines that `git diff --numstat 0be71ca` reports as added in upstream-owned files. `package-lock.json`, `packages/coding-agent/npm-shrinkwrap.json` and `packages/coding-agent/install-lock/` are excluded from every C7 measurement. The exclusion lines for `packages/builtins/` in `scripts/check-pinned-deps.mjs` and `scripts/check-ts-relative-imports.mjs`, and the root `workspaces` line, count toward the limit. |
| None per further built-in | Adding the fixture package to the checkout list and the workspace changes the added-line count by zero. |
| Rewriting the ported files | Any byte or file-mode difference between `packages/builtins/rpiv-ask-user-question` and `git archive 8403bb09` of rpiv-mono's `packages/rpiv-ask-user-question`, ignoring `node_modules/`, other than one added `UPSTREAM.json`. |
| Loud failure | The session starts, and `resourceLoader.getExtensions().errors` holds an entry that names the unresolvable package. |

## Claims

Each claim is independently falsifiable and is tested on its own. The verdict is a function of which ones hold, by the boundaries below. A claim states what must be true; its expected observation states what the harness is expected to show, and the observation can be refuted without the claim failing.

**C1, interactive CLI.**
*Given* the checkout's esbuild bundle `packages/coding-agent/dist/bundle/cli.js`, an agent directory whose `settings.json` lists no package, and `--no-extensions`, *when* a scripted provider requests `ask_user_question` and the questionnaire is answered in the TUI, *then* the next provider request carries the chosen answer as the tool result.
Expected observation: the scripted provider's log shows the answer label, and the interactive startup `[Extensions]` section does not show the built-in.

**C2, RPC mode.**
*Given* the setup of C1 under `--mode rpc`, *when* the scripted provider requests `ask_user_question`, *then* the tool reaches the RPC client as an `extension_ui_request`, and the client's `extension_ui_response` becomes the tool result.
Expected observation: stdout carries one `extension_ui_request` with method `select`, and the matching `tool_execution_end` carries the chosen label.

**C3, SDK services path.**
*Given* two `createAgentSessionServices` calls with discovery switches off, loaded from the checkout's `packages/coding-agent/dist/index.js`, *when* the first creates a session with the `tools` allowlist `["read"]` and the second with `["read", "ask_user_question"]`, *then* the extension registration holds `ask_user_question` in both, the session registry holds it only in the second, and `setActiveToolsByName` cannot add it to the first session's active tools.
Expected observation: the extension registration lists `ask_user_question` in both services, `getAllTools()` lists it only in the second session, and the first session's active tools stay `read` after the runtime call.

**C4, third-party loader and bare import.**
*Given* a module outside `packages/coding-agent` in the same process as C3, and separately a fresh process that imports `@earendil-works/pi-coding-agent` by bare specifier and nothing else, *when* each constructs `DefaultResourceLoader` with `noExtensions: true` and reloads, *then* each loader's extensions include both built-ins.
Expected observation: both extension lists name `@juicesharp/rpiv-ask-user-question` and the fixture package, with no errors, and `import.meta.resolve('@earendil-works/pi-coding-agent')` in the fresh process names the checkout's `packages/coding-agent/dist/index.js`.

**C5, provider built-in.**
*Given* the fixture package in the checkout list, *when* the CLI starts with `--model spike-fixture/echo` and C3's path resolves the same pair, *then* both resolve before the first turn, and the CLI turn completes from the fixture.
Expected observation: `--list-models spike-fixture` lists `echo`, `-p` prints the fixture's reply, and `modelRuntime.getModel("spike-fixture", "echo")` returns a model.

**C6, fenced session.**
*Given* a `pi-fence run --profile general` launch of C1's command from the checkout as working directory, with the real `~/.pi/agent` whose `settings.json` has only the `rpiv-mono` package entry removed, and the trust dialog answered "Do not trust (this session only)", *when* C1's flow runs inside it, *then* the turn completes.
Expected observation: the answer reaches the scripted provider, and the launch's violations journal records no denial for any path under the checkout or under `~/Developer/ai/rpiv-mono`.

**C7, merge hygiene.**
*Given* the complete change with the ported package, *when* `npm run check` has run, and again after the fixture package joins the checkout list and the workspace, *then* upstream-owned files carry at most 10 added lines and no changed or removed line, the second measurement equals the first, `packages/coding-agent/npm-shrinkwrap.json` and every file under `packages/coding-agent/install-lock/` are byte-identical to `0be71ca`, the ported files are not rewritten, and `npm run check` passes both times.
Expected observation: two equal totals of at most 10 added and 0 removed, no difference in the shrinkwrap or the install lock, and a comparison of the ported directory that lists only `UPSTREAM.json`.

**C8, outside consumer.**
*Given* an outside consumer in a temporary directory, *when* it imports `@earendil-works/pi-coding-agent` by bare specifier, creates C3's second session, whose `tools` allowlist is `["read", "ask_user_question"]`, and constructs C4's loader, *then* both built-ins load and `ask_user_question` is active.
Expected observation: `import.meta.resolve` names the checkout's `packages/coding-agent/dist/index.js`, the consumer's extension list names both built-ins with no errors, and its active tools include `ask_user_question`.

**C9, loud failure.**
*Given* the checkout list naming one additional package that no workspace provides, *when* a session starts on C3's second path, *then* the session starts, the other built-ins load, and the failure is loud.
Expected observation: `getExtensions().errors` holds one entry naming the missing package, and `ask_user_question` still registers.

## Kill criteria

Written before any code, and not edited afterwards.

The spike is **DISPROVEN** if, after honest effort within the time box, the checkout list fails, or cannot be marked **proved**, any one of C1, C2, C3, C4, C5, C7 and C8, or C6 records a denial under `~/Developer/ai/rpiv-mono`. A `DISPROVEN` verdict opens a design discussion with the operator; it selects no fallback mechanism.

Things that are explicitly **not** kill conditions, named now so they cannot be promoted into one later to manufacture a failure, nor dismissed later to manufacture a success:

- C6 fails for any cause other than a denial under `~/Developer/ai/rpiv-mono`, does not run, or is inferred: `CONDITIONAL`.
- Denials that neither block C6's turn nor lie under the checkout or `~/Developer/ai/rpiv-mono`, such as `~/.pi/agent/auth.json`, are not counted against C6: `PROVEN`.
- C9 fails in any way, or is inferred: `CONDITIONAL`.
- The built-in appears in the interactive startup `[Extensions]` section: `CONDITIONAL`.
- The scripted provider for C1, C2 and C6 is a harness extension passed with `-e`, because it is test apparatus: `PROVEN`.
- The TUI answer in C1 and C6 comes from the coordinator through a pseudo-terminal rather than from the operator: `PROVEN`.

## Verdict boundaries

Each outcome the kill criteria name maps to exactly one row here, and the two sections were checked against each other before freezing.

| Verdict | Condition |
| --- | --- |
| `PROVEN` | C1 to C9 are all proved, with no patch to the ported package. A harness extension passed with `-e`, a TUI answered through a pseudo-terminal, or an uncounted denial does not prevent this row. |
| `CONDITIONAL` | C1 to C5, C7 and C8 are proved, and one or more named restrictions apply: C6 failing without a denial under `~/Developer/ai/rpiv-mono`, unrun or inferred; C9 failing or inferred; or the built-in appearing in the interactive startup `[Extensions]` section. The verdict names each restriction, its cost and the claim that exposed it. |
| `DISPROVEN` | The kill criterion above is met. The verdict names what blocked it and what it would take to unblock it. |

A verdict of `PROVEN` requires every claim to be marked **proved**, observed running here. Any claim that ends the spike marked **inferred** forces `CONDITIONAL` at best, whatever the reasoning behind it.

## Versions under test

The verdict is only a verdict about these. This table holds the things the question is about; everything the harness installs is recorded in the evidence half.

| Thing | Version |
| --- | --- |
| Pi fork, `@earendil-works/pi-coding-agent` | 0.87.1, the `frozen-at` commit on branch `personal`, descending from `0be71ca` (committed 2026-09-25), built in the checkout |
| `@juicesharp/rpiv-ask-user-question` | 2.11.0, rpiv-mono branch `personal` at `8403bb09`, committed 2026-09-24 |
| `@juicesharp/rpiv-config` | 2.11.0, integrity `sha512-fjySBPar14qTPNMNPRYmH24YCaQ0r8xzW4P4jz8/Ph7JLFzIa+TM3ySzg9jRq0hh8wVqIAD4j4pcU66fdCkIag==`, fixed through `package-lock.json` |
| npm | 11.19.1 |
| pi-fence | branch `main` at `e8c0600`, committed 2026-09-24; the operator's store profiles under `~/.pi-fence/profiles/` as they stand on 2026-09-25 |
| Node.js | 26.10.0, Homebrew `node 26.10.0_1` |

## What was already known when the question was frozen

Recorded so the evidence table is honest about what this spike discovered versus what it confirmed. All of the following is documentation and source reading, not observation, and none of it is evidence until it is run.

| Prior | Source |
| --- | --- |
| SPIKE-0001 candidate A resolved the ported package with `createRequire(import.meta.url).resolve` from `packages/coding-agent`, in both the bundle and the unbundled build. The resolution went through the root `node_modules` workspace link, and Node's resolution does not consult `package.json` dependencies. | SPIKE-0001 `evidence.patch`, `spike/runs/A-C1-tui.txt` and `spike/runs/A-C3-C5-sdk.json` |
| npm links every workspace into the root `node_modules`, whether or not another workspace depends on it. | npm workspaces documentation |
| Node resolves an imported module's symbolic link to its real path by default, so `import.meta.url` inside the checkout names the checkout, not the consumer's link. | Node.js module documentation, `--preserve-symlinks` |
| `DefaultResourceLoader` records a named factory that throws as `<inline:name>` in `getExtensions().errors` and continues with the other extensions; the CLI turns those errors into diagnostics. | `loadExtensionFactories` in `packages/coding-agent/src/core/resource-loader.ts`; `packages/coding-agent/src/main.ts`; the pre-freeze review |
| `check:runtime-deps` flags only string literals passed to a call written `require.resolve`, so names passed as data pass it. | `scripts/check-runtime-deps.mjs` |
| Without the dependency declaration and the lock-generator lines, SPIKE-0001 candidate A's upstream-owned lines drop from 12 to 9, including the root `workspaces` line and the two check-script exclusions. | SPIKE-0001 `evidence.patch`, `spike/candidates/A.patch` |
| Adding the `packages/builtins/*` workspace rewrites `package-lock.json`, and the shrinkwrap and install-lock generators follow only `packages/coding-agent`'s dependency closure. | SPIKE-0001 `evidence.patch`; the pre-freeze review |

| Claim | Honest prior |
| --- | --- |
| C1, C2, C3, C5 | Likely, because the load path equals SPIKE-0001 candidate A's. |
| C4 | Likely, including the bare import, which SPIKE-0001 observed for candidate A. |
| C6 | Likely, with `~/.pi/agent/settings.json` edited as in SPIKE-0001. |
| C7 | Likely at 9 lines. |
| C8 | Likely from Node's real-path rule, unobserved. |
| C9 | Likely from `loadExtensionFactories`, unobserved for an unresolvable name. |

The spike is still worth running because C7, C8 and C9 are unobserved without a declared dependency, and each decides the ADR on its own.

## Time box and budget

| Item | Value |
| --- | --- |
| Time box | One session. |
| Model calls | None. Scripted and fixture providers drive every turn. |
| Harness runner | This session builds and runs every harness, reusing SPIKE-0001's harness from its `evidence.patch` where it applies. |
| C6 procedure | The coordinator session runs unfenced. With the operator's approval at this spike's freeze gate on 2026-09-25, it removes only the `rpiv-mono` entry from `~/.pi/agent/settings.json` for the C6 run and restores the file byte-identically afterwards. It drives C1 and C6 through a pseudo-terminal, with `pi-fence run` wrapping only the child, so no sandbox nests. |
| Pre-freeze review | One independent agent reviewed the draft of this block on 2026-09-25; its findings are folded in. |
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

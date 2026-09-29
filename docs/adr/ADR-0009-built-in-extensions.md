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
| Fork-owned built-ins | Code the fork writes or rewrites, with no upstream, lives in `packages/coding-agent/src/core/fork-builtins/<name>/`. It has no `UPSTREAM.json` and takes no sync. `FORK_OWNED_BUILTINS` in `fork-builtins.ts` lists each extension-shaped one as an inline factory. pi-tokensave (`fork-builtins/tokensave/`) was the first inline factory. The fork took over its code, because the owner wrote 13 of its 15 commits. Since 2026-09-28 the subagents presentation (`<inline:subagents>`, `fork-builtins/subagents/ui/index.ts`) is the second (D18). `vcc_recall` (`fork-builtins/vcc-recall/`) and `ask_user_question` (`fork-builtins/ask-user-question/`) are fork-owned base tools instead. `AgentSession` registers them next to `read` through `fork-builtins/base-tools.ts`. No resource loader can drop them. `vcc_recall` was an inline factory until 2026-09-26. Since 2026-09-27, `Agent`, `get_subagent_result` and `steer_subagent` (`fork-builtins/subagents/`) are the third set of fork base tools, each bound to its session's subagent service. Since 2026-09-29, the tasks presentation (`<inline:tasks>`, `fork-builtins/tasks/ui/index.ts`) is the third inline factory. The seven task tools (`fork-builtins/tasks/`) are the fourth set of fork base tools, each bound to its session's task service (D47). |
| Loading | `fork-builtins.ts` holds the package names as data. It resolves each name with `createRequire(import.meta.url).resolve` and loads it through the jiti-backed extension loader. The package list is empty since the `ask_user_question` move; the mechanism stays for future ports. |
| Reach | Every `DefaultResourceLoader` merges the list, so the CLI, RPC mode, SDK services, third-party loaders in the same process and consumers that link to the checkout all load the built-ins, including under `noExtensions`. Built-ins load after the caller's factories, so upstream's `<inline:N>` numbering for unnamed factories stays unchanged. |
| Visibility | Each built-in is marked hidden, so the interactive startup `[Extensions]` section does not list it. |
| Control | A session's `tools` allowlist decides which built-in tools a session sees. A built-in tool outside the allowlist never enters the session registry and cannot be enabled at runtime. The fork's base tools follow the same allowlist and exclude rules. Otherwise they stay active. In a subagent's child session, a fork base tool is active only when the agent's `tools:` names it (D22, 2026-09-27). There the runner removes the other base tools through `excludeTools`. `--no-builtin-tools`, a `defaultTools` setting and a caller's `baseToolsOverride` leave them active, as they leave extension tools. A deactivation lasts until `/reload`. A resumed session or a tree navigation keeps it when the transcript recorded the removal. It activates a base tool the transcript never carried. |
| Switch | `PI_FORK_BUILTINS=off` disables all built-ins in a process. Each loader reads it when it is constructed. `packages/coding-agent/vitest.config.ts` sets it, so upstream tests see no built-ins. pi-fence forwards it to the fenced child since pi-fence commit `83fa852`, so fenced sessions honor it too. |
| Failure | A listed package that cannot be resolved appears by name in `getExtensions().errors`; the session starts and the other built-ins load. |

The upstream-owned footprint is 9 added lines and 1 changed line, in six files, with no removed line. The count excludes the root `package-lock.json`, where npm records the new workspace:

| File | Lines | Purpose |
| --- | --- | --- |
| `package.json` | 1 added | The `packages/builtins/*` workspace glob. |
| `scripts/check-pinned-deps.mjs` | 1 added | Exempts `packages/builtins/` from the exact-pin rule. |
| `scripts/check-ts-relative-imports.mjs` | 1 added | Exempts `packages/builtins/` from the `.ts` import rule. |
| `packages/coding-agent/src/core/extensions/loader.ts` | 4 added | Exports `loadExtensionFactoryFromPath`. |
| `packages/coding-agent/src/core/resource-loader.ts` | 2 added | Imports the list and appends it to the caller's factories in the constructor. |
| `packages/coding-agent/vitest.config.ts` | 1 changed | Sets `PI_FORK_BUILTINS: "off"` in the test environment. |

A further built-in adds one entry to the fork-owned list and one folder, and no upstream-owned line. The shrinkwrap, the install lock and their generators stay untouched. These rules apply ADR-0003 to packaging: new code lives in new files, and hot upstream files receive only added call sites. The one changed line is a test setting outside the hot files ADR-0003 names.

A fork-owned built-in adds no upstream-owned line, with one exception. The fork's base tools add 14 lines to `agent-session.ts` and 2 to `keybindings.ts`. Twelve serve `ask_user_question` and `vcc_recall`. Two serve subagents, both `session: this,`: one in the `addForkBaseTools` options and one in the fork's own `SkillForkClient` options (D25, D26). Their code and their tests live in new files. Since 2026-09-28 the two `keybindings.ts` lines import and spread `FORK_KEYBINDINGS` from the fork-owned `fork-builtins/keybindings.ts` (D37). The object holds the six `app.askUserQuestion.*` ids and the four `app.subagents.*` ids of the subagent conversation viewer. A later built-in adds its keys there, with no edit of `keybindings.ts`. An inline factory's list entry lives in the fork-owned `fork-builtins.ts`. The base tools have no list entry. Four of their five `agent-session.ts` hunks are thin call sites into `fork-builtins/base-tools.ts` (ADR-0003). The fifth hunk adds `session: this,` to the fork's own `SkillForkClient` options.

## Considered options

| Option | Why not chosen |
| --- | --- |
| A: the same list, with `packages/coding-agent` declaring each ported package as a dependency (SPIKE-0001, candidate A) | Each port adds a line next to a dependency line upstream changes almost every release. The lock generators need patching, and the published shrinkwrap would point at upstream's npm tarball rather than the fork's code. |
| B: an empty registry in `coding-agent` filled by a fork-owned distribution package that owns the `pi` command (SPIKE-0001, candidate B) | Every SDK consumer, OpenIntent's worker included, must import the fork entry, and forgetting it fails silently. The CLI would leave upstream's bundle. The operator rejected it. |

## Consequences

- **Checkout only.** The package mechanism works only from this monorepo checkout. A published `coding-agent`, a Bun binary or a Node single-executable build would carry no ported package. The fork-owned modules compile into `coding-agent` itself, so such a build would carry them. Publishing the fork would need a new decision.
- **Checks.** Ported packages keep their own version ranges and import style. `check:runtime-deps` does not see names held as data.
- **pi-fence.** A ported package leaves `~/.pi/agent/settings.json`, so the fence stops deriving a read grant for its fork checkout. The base profile already grants `~/Developer/ai/pi`, which holds the built-ins.
- **OpenIntent.** A worker that links to the checkout receives the built-ins without selecting them as extensions; its `tools` allowlist governs them. The workflow-engine design changes through its own amendment process.
- **Tests.** `packages/coding-agent/test/fork-builtins.test.ts` guards the call site, the load order, the switch and its read at construction, and each port's registrations. A ported package whose tests need its origin's tooling loses its `test` script in an owned commit.
- **Fork-owned built-ins.** Biome, `tsgo`, the import check and vitest cover `packages/coding-agent/src/core/` and `packages/coding-agent/test/`. Fork-owned built-ins therefore get the full check and test coverage that ported packages under `packages/builtins/` lack. OpenIntent workers receive `vcc_recall` and `ask_user_question` in every session, and their `tools` allowlist governs both.
- **Fork-owned settings.** A fork-owned built-in reads its settings from `forkBuiltins.<key>` in the session agent directory's `settings.json`. It writes no file in the agent directory. pi-tokensave uses the key `pi-tokensave`, and its `/tokensave-mode` command changes the mode for the current session only. Subagents are the one exception, ruled on 2026-09-27 (D20). They also read `forkBuiltins.subagents` from the project `settings.json`, and the project value wins. They also write a settings file: the `/agents` settings menu writes the project `settings.json` through `writeProjectSubagentSettings`. It writes the project's own values plus the changed key, never a global value, and only in a trusted project. It replaces an existing file whole and refuses a symlinked `.pi` or `settings.json`. They still write no file in the agent directory. Tasks are the second exception, ruled on 2026-09-29 (D48). They read `forkBuiltins.tasks` from both files, under the same trust rule, and the `/tasks` settings list writes the project file the same way. `fork-builtins/settings-section.ts` holds the value checks, the section lookup and the project writer both built-ins use.
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

A 2026-09-26 amendment added pi-tokensave as the second fork-owned built-in, and the settings rule for fork-owned built-ins. `docs/plans/tokensave-builtin.plan.md` records the proof: Section 3 lists the verified facts, and Appendix A holds the probe measurements.

| Rule | Evidence |
| --- | --- |
| A copied extension becomes a fork-owned module with no upstream-owned line | The copied module passed `tsgo` and Biome after two hand fixes, and its 148 tests passed under vitest after the test conversion. `git diff` touched only fork-owned files. |
| The list entry is guarded | Without the `tokensave` entry in `FORK_OWNED_BUILTINS`, 1 test in `fork-builtins.test.ts` fails. |
| The built outputs carry the module | The built SDK registers the six tools and runs `tokensave_status`. RPC and print mode run `/tokensave-status` with no model call, for both `dist/cli.js` and `dist/bundle/cli.js`. `PI_FORK_BUILTINS=off` removes the module. |
| Settings come from `forkBuiltins` and nothing is written | Tests read the settings from the session agent directory only, and a mode change leaves `settings.json` byte-identical. The fence lets Pi read `settings.json` and write neither `AGENTS.md` nor `pi-tokensave.json`. |

A second 2026-09-26 amendment made `ask_user_question` a fork-owned base tool and removed the ported rpiv-ask-user-question package. `docs/plans/ask-user-question-base-tool.plan.md` records the proof: Section 3 lists the verified facts, and Appendix A holds the probe measurements.

| Rule | Evidence |
| --- | --- |
| A custom `ResourceLoader` and an `extensionsOverride` both keep the tool | `sdk-probe.mjs` gives `<builtin:ask_user_question>`, active, with a custom loader, a `DefaultResourceLoader` and an override that removes every extension. The baseline gives `none` for the custom and override loaders (Appendix A, probe results). |
| The switch removes the base tool | With `PI_FORK_BUILTINS=off` the probe gives `none`; ignoring the switch fails the suite test and a module test (Appendix A, M5). |
| Registration never takes a tool it does not own | Overwriting a caller's tool fails a module test (M6); letting the base tool override a same-named extension tool fails a suite test (M8) (Appendix A). |
| Nothing hides the tool without a UI | The suite test reads the tool list the model receives, from the system messages' tool deltas. Hiding the tool without a UI, or dropping it at request time, fails that test (Appendix A, M3, M9 and M10). A call without a UI returns `no_ui` (M4). |
| The footprint is 11 lines in `agent-session.ts` and 2 in `keybindings.ts` | `git diff` of the final commits shows three `agent-session.ts` hunks and two `keybindings.ts` lines (Appendix A and Appendix B). |

A third 2026-09-26 amendment moved `vcc_recall` from an inline factory to a base tool. It also set one activation rule for both base tools. The owner ruled it on 2026-09-26: a fork base tool is active unless the allowlist or the exclude list removes it. Turning off Pi's own tools targets tools that act on files and the shell, and these two do neither. The earlier rule is superseded: under a caller's `baseToolsOverride`, the tool was registered but inactive, like `skill`.

| Rule | Evidence |
| --- | --- |
| Both tools register with a custom `ResourceLoader` and are sent to the model | `test/suite/fork-base-tools.test.ts` runs every case for both tools on the suite harness's custom loader. |
| Turning off Pi's own tools leaves them active | The same suite covers a caller's base tools, an empty initial active list and a narrowed one. Removing the activation line in `_refreshToolRegistry` fails 16 suite tests. |
| A restored transcript keeps a recorded removal and activates a tool it never carried | Two tree-navigation tests per tool in the same suite. Dropping the restore call fails both never-carried tests. Ignoring the transcript fails both removal tests. |
| The allowlist, the exclude list and the switch still remove them | The same suite, with `PI_FORK_BUILTINS=off` and both lists. A caller's same-named base tool is never activated. |
| `vcc_recall` works through the base-tool context | A suite test recalls the session's own prompt. The 114 module tests build the same definition. |
| The footprint is 12 lines in `agent-session.ts` and 2 in `keybindings.ts` | `git diff 92294f229 -- packages/coding-agent/src/core/agent-session.ts` shows four hunks. |

A 2026-09-27 amendment added native subagents, rebuilt from pi-subagents, as the third set of fork base tools. `docs/plans/subagents-native-phase1.plan.md` records the proof, and `docs/plans/subagents-native-phase1.results.md` its outcome. The rulings are D16 to D34 in the session-control handoff.

| Rule | Evidence |
| --- | --- |
| `Agent`, `get_subagent_result` and `steer_subagent` register as base tools, bound to one subagent service per session | `test/fork-builtins/base-tools.test.ts` registers them with a session that throws on any read. `test/suite/fork-subagents-tools.test.ts` covers the allowlist, the exclude list, the switch and an overriding extension tool. |
| Settings live under `forkBuiltins.subagents`, global and project, and the project file is the one written (D20) | `test/fork-builtins/subagents/settings.test.ts` merges both files and leaves every other key of the project file unchanged. |
| In a child session, a fork base tool is active only when `tools:` names it; the others go to `excludeTools` (D22) | `test/suite/fork-subagents-runner.test.ts` reads the tools each child's model receives. |
| The upstream footprint grows by two lines in `agent-session.ts`, both `session: this,` (D25, D26) | `git diff --numstat` of `agent-session.ts` against the phase's base prints `2` added lines and `0` removed. Against `92294f229`, which the third 2026-09-26 amendment measured, the diff now shows five hunks and 14 lines. |

A 2026-09-28 amendment added the subagents presentation as the second inline factory, `<inline:subagents>`. It also moved the fork's keys into `FORK_KEYBINDINGS` (D37), and the `/agents` settings menu became the caller of the subagent settings writer (D20). `docs/plans/subagents-native-phase2.plan.md` records the proof, and `docs/plans/subagents-native-phase2.results.md` its outcome. The rulings are D16 to D40 in the session-control handoff.

| Rule | Evidence |
| --- | --- |
| `<inline:subagents>` loads as a hidden fork-owned built-in with no tool, and registers nothing in a child session | `test/fork-builtins.test.ts` "registers the subagents presentation as a fork-owned built-in, with no tool"; `test/suite/fork-subagents-presentation.test.ts` "registers nothing in a child session". |
| Quit and session replacement await the children's teardown, within a bound | `test/suite/fork-subagents-presentation.test.ts` "makes quit wait for every child's session_shutdown handlers" and "makes a runtime's new session wait for the old session's children". |
| `FORK_KEYBINDINGS` keeps the `keybindings.ts` footprint at two lines | `git diff --numstat 941bec9ab -- packages/coding-agent/src/core/keybindings.ts` prints `2 2`: the two fork lines change text, and no line is added. `test/fork-builtins/keybindings.test.ts` puts every fork id into Pi's table and takes a user's binding for a subagent key. |
| The settings menu writes only the project's own subagent values plus the changed key, and nothing in an untrusted project | `test/suite/fork-subagents-settings-menu.test.ts`, on a file-backed session. |
| The upstream footprint in `agent-session.ts` is unchanged | `git diff --numstat 941bec9ab -- packages/coding-agent/src/core/agent-session.ts` prints nothing. |

A 2026-09-29 amendment added agent mentions to the subagents presentation. `<inline:subagents>` now also registers an `input` handler, and in the interactive TUI one autocomplete provider per activation. The handler routes a leading `@handle message` to an agent, and the provider adds agent rows to the `@` popup. Mentions act only in the interactive TUI; print, JSON and RPC prompts pass to the main model unchanged (D44). A scripted TUI smoke with an isolated home and a faux provider gates the first cutover step (D45). The cutover removes pi-subagents from the live settings. `docs/plans/subagents-native-phase3.plan.md` records the proof, and `docs/plans/subagents-native-phase3.results.md` its outcome. The rulings are D16 to D45 in the session-control handoff.

| Rule | Evidence |
| --- | --- |
| The mention hook and the `@` popup live in `<inline:subagents>`; the service imports no presentation code | `test/fork-builtins/subagents/layering.test.ts`; `test/suite/fork-subagents-mentions.test.ts`, describes "the input hook" and "the @ popup". |
| A mention acts only in the interactive TUI (D44) | `test/suite/fork-subagents-mentions.test.ts` "passes every mention on in print, JSON and RPC mode, and leaves a running agent alone". |
| The provider registers once per activation, only in `tui` mode, and again after `/reload` loads the factory anew | `test/suite/fork-subagents-mentions.test.ts` "registers the provider once per activation, in TUI mode only, and again after /reload". |
| The built CLI shows the mentions, the popup and the phase 2 surfaces before the cutover (D45) | `docs/plans/subagents-native-phase3-evidence/run-smoke.sh`, run by the phase 3 plan's T9 in `direct` and `model` mode. |
| The upstream footprint is unchanged | `git diff --numstat af021d3cc -- packages/coding-agent/src/core/agent-session.ts packages/coding-agent/src/modes/interactive/interactive-mode.ts packages/coding-agent/src/core/keybindings.ts` prints nothing. |

A 2026-09-29 amendment added native tasks, rebuilt from pi-tasks (D46). Seven task tools are fork base tools bound to one task service per session, and `<inline:tasks>` is the third inline factory (D47). Task settings live under `forkBuiltins.tasks` in the global and project `settings.json`, and the project value applies only in a trusted project (D48). `fork-builtins/settings-section.ts` now holds the settings checks and the project writer that subagents and tasks share. The cutover removes pi-tasks from the live settings. `docs/plans/subagents-native-phase4.plan.md` records the proof, and `docs/plans/subagents-native-phase4.results.md` its outcome. The rulings are D16 to D53 in the session-control handoff.

| Rule | Evidence |
| --- | --- |
| `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TaskExecute`, `TaskOutput` and `TaskStop` register as fork base tools, bound to one task service per session (D47) | `test/fork-builtins/base-tools.test.ts` registers them with a session that throws on any read. `test/suite/fork-tasks-service.test.ts` covers the switch and a caller's tool of the same name. |
| `<inline:tasks>` loads as a hidden fork-owned built-in; it registers only the `context` hook in a child session | `test/suite/fork-tasks-presentation.test.ts` "registers no command and builds no service in a child session at its start". |
| Settings live under `forkBuiltins.tasks`, global and project, and the project file is the one written (D48) | `test/fork-builtins/tasks/settings.test.ts` merges both files and leaves every other key of the project file unchanged. `test/fork-builtins/subagents/settings.test.ts` passes unchanged on the shared writer. |
| In a child session, a task tool is active only when `tools:` names it (D22) | `test/suite/fork-tasks-execute.test.ts` "reach a child only when its agent names them, and a child's TaskExecute obeys its spawn rights". |
| The upstream footprint is unchanged | `git diff --numstat cd8573e32 -- packages/coding-agent/src/core/agent-session.ts packages/coding-agent/src/modes/interactive/interactive-mode.ts packages/coding-agent/src/core/keybindings.ts` prints nothing. |

## Upstream sync

A ported package takes upstream changes through `scripts/fork/sync-upstream.sh`, a guarded merge in a scratch repository. SPIKE-0004 proved it on the fork's real sync history: it reproduced Git's own merge result for five consecutive pi-claude-bridge syncs and one rpiv-mono sub-folder sync (`openintent/experiments/spikes/0004-guarded-scratch-merge-sync/report.md`, verdict `PROVEN`). `.pi/skills/sync-upstream/SKILL.md` gives the procedure.

| Part | Rule |
| --- | --- |
| Record | `packages/builtins/<name>/UPSTREAM.json` holds an `upstream` object with `repository` (the local upstream clone), `path` (the sub-folder, or empty) and `base` (the last upstream commit merged, as 40 hex digits). |
| Provenance | Every commit that changes `UPSTREAM.json` carries the trailer `Upstream-Base: <base>`. Only the port and the sync write the record; nobody edits it by hand. |
| Guards | The sync refuses (exit 2) when the trailer does not match, when the package directory has uncommitted changes, or when the base is not an ancestor of the new commit or is missing from the clone. It also refuses when the upstream path is not a directory at the base or the new commit. |
| Failures | A failed command during the merge refuses (exit 2). Before the package directory is cleared, the package stays unchanged and no `scratch:` line appears. After that point, the `scratch:` line appears and the caller restores the package from `HEAD`. |
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

The owner ruled on 2026-09-26 to add the path guard and the failure checks without a new spike. Before them, a removed upstream path or a failed tree extraction produced a `clean` outcome that deleted the package. A replay of every SPIKE-0004 case with the changed script matched the recorded runs on all outcome, conflict-set, comparison, containment and index lines. A fault-injection fixture confirmed each new refusal. Any further change to the script's behavior needs a new spike or another recorded ruling, followed by the same replay.

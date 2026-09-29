# Native subagents, phase 3: results

Phase 3 added agent mentions to the native subagents on branch `feat/subagents-native`: the `@handle message` input hook, the `@` autocomplete rows, the conversation clone of `agentMentions: model`, and reopening an evicted agent. It pointed the skill docs at the native built-in (phase 1 F16, phase 2 F10) and amended ADR-0009. This file records each task's commit, test reports, mutation record and review, the phase runs, the phase review with its applied fixes, and the built-output checks. The plan is `docs/plans/subagents-native-phase3.plan.md`; the rulings are D16 to D45 in the session-control handoff. `## Cutover` follows with T17.

Every commit passed the pre-commit hook. `agent-session.ts`, `interactive-mode.ts` and `core/keybindings.ts` are unchanged against BASE `af021d3cc`.

## Commits

| Commit | Subject |
| --- | --- |
| `f63b33c1c` | docs: native subagents phase 3 plan |
| `0a8ca6c6e` | feat(coding-agent): subagent mention grammar and handle resolution |
| `19a42534b` | feat(coding-agent): reopen an evicted subagent from its tombstone |
| `f549e05b6` | feat(coding-agent): start a mentioned subagent from a clone of the conversation |
| `f38e75e7d` | feat(coding-agent): route @agent mentions at the prompt to subagents |
| `d15d7a1fb` | feat(coding-agent): @ autocomplete rows for subagents |
| `ad19ea4dc` | docs: native subagents phase 3 README, skill docs and ADR-0009 amendment |
| `e6582454b` | fix(coding-agent): an evicted subagent's old id reaches its reopened agent |
| `d0c790eae` | fix(coding-agent): a first-prompt mention clone carries the system prompt |
| `9ed3ccf59` | fix(coding-agent): a never-started subagent restarts as its own type by any of its names |
| `09d7afc23` | fix(coding-agent): the mention hook rereads settings only for a mention |
| `3cbb11f45` | docs(coding-agent): mention prose within the register, and a test title that says ids match exactly |
| `c27453bf6` | docs: ADR-0008 names the native subagent service for skill-bundled agents |

The results commit itself follows these.

## Tasks

Test reports, mutation specs and records sit in `/tmp/sn3-impl` during the phase. The results commit copies every mutation spec and record to `docs/plans/subagents-native-phase3-evidence/mutations/`.

### T1 Mention grammar and handle resolution

Commit: `0a8ca6c6e`

Tests: /tmp/sn3-impl/T1-1.json: 4 files, 65 tests, 65 passed, 0 failed, 0 pending.

Mutations: /tmp/sn3-impl/mutations/T1.txt: 35 entries, 11 cases, all caught; restored | 0 of 30 failed; clean: yes.

Review:

- Important: `resolveMention` compares live and tombstone ids with the original input, so an uppercase id resolves nothing, while T1 case 9 says "case-insensitively" (service.ts resolveMention). Rejected: pi-subagents matches ids exactly (`src/agent-manager.ts:1386` `this.agents.get(name)`, `:1390` `entry.id === name` at 79a7c42); the service's `find`, which the tools use, matches ids exactly; the probe patch the plan verified does the same. Case 9's "case-insensitively" qualifies handles and aliases, which are typed; ids are printed lowercase and copied.

Notes and deviations:

- Deviation: case 10's behavior (the tools reach agents by handle and alias; evicted and unknown ones are not found) is phase 1 code, and T1 adds none for it. Its mutations target the lookup the case exercises (`find` in service.ts) and the eviction (`records.delete` in retention.ts).
- Deviation: case 9's same-name records are made by renaming a record through `inspectRecord`, because only T2's reopen creates them naturally. A run that never reached a session is simulated by clearing the record's `child` for one assertion, then restoring it.
- Deviation: old cases 132 to 164 are covered by new module tests with new names. The handleBase and assignHandle mutations target phase 1 code in records.ts, because each inventory row needs a covering test that one of its case's mutations breaks.

### T2 Reopen an evicted agent

Commit: `19a42534b`

Tests: /tmp/sn3-impl/T2-1.json and T2-2.json: 2 files, 44 tests, 44 passed. /tmp/sn3-impl/T2-3.json (after the review fix): 2 files, 45 tests, 45 passed, 0 failed, 0 pending.

Mutations: /tmp/sn3-impl/mutations/T2.txt: 9 entries, 7 cases, all caught; restored | 0 of 14 failed; clean: yes. Pre-review record: T2-pre-review.txt (8 entries). A first run left T2-M6 missing the case 5 test, which reused its own tombstone object; the test now looks the tombstone up through `resolveMention`, and the record was rewritten before the review.

Review:

- Important: two reopens of one tombstone before either record exists both create a record with the same handle and both open the tombstone's session file, forking the conversation (service.ts reopen; spawnRecord awaits `resolveModel`, which awaits `modelRuntime.getAvailable()` and its auth refresh when the agent file sets `model:` or `scopeModels` is set, `model-runtime.ts:414-429`). Accepted: `reopen` reserves the tombstone's handle in a `reopening` map before its first await; a second reopen joins the first (`joinReopen`) and steers its prompt to that agent, or reopens the tombstone itself when the first failed; test "joins a reopen that is still starting, so one agent continues the conversation and gets both prompts" (mutation T2-M9).

Notes and deviations:

- Deviation (review finding, accepted): `reopen` joins an in-flight reopen of the same tombstone (`reopening` map, `joinReopen`), beyond probe.patch; one added test and mutation T2-M9, listed under case 3.

### T3 The conversation clone

Commit: `f549e05b6`

Tests: /tmp/sn3-impl/T3-1.json: 3 files, 22 tests, 22 passed. /tmp/sn3-impl/T3-2.json (after the review fix): 3 files, 23 tests, 23 passed, 0 failed, 0 pending.

Mutations: /tmp/sn3-impl/mutations/T3.txt: 22 entries, 12 cases, all caught; restored | 0 of 21 failed; clean: yes. Pre-review record: T3-pre-review.txt (21 entries).

Review:

- Important: the clone returns `ok: true` as soon as `service.spawn` returns, so a worktree whose `git worktree add` then fails is reported as a started agent (mention-clone.ts). Rejected: P7 and the plan's hook handle it; `start` in `ui/mentions.ts` (probe.patch, task T4) awaits `service.worktreeStarted(view)` after both the clone and a direct start and reports `Could not start @<handle>: <error>` once, with no second start.
- Important: an abort while `service.spawn` awaits model availability still starts the agent, because the signal is checked only before the spawn (mention-clone.ts). Rejected: P23 aborts a clone still waiting for its reply; at the session's end the service is disposed and `spawnRecord` throws through `assertLive()` after its awaits (`service/service.ts` spawnRecord); after `/reload` the service and its agents stay by design (phase 2 R4), and passing the signal to the spawn would stop the started agent at every later `/reload`.
- Important: the clone converts the persisted projection alone, so it lacks the skill bodies a compaction carried forward, which the parent's own requests carry (`agent-session.ts:1156-1165` `_withCarriedSkills`). Accepted: the clone converts `session.messages`, which the finalized refresh sets to the projection plus the carried skill bodies after each turn (`agent-session.ts:1287-1292`); test "carries the skill bodies the session re-attached after a compaction, as its own requests do" (mutation T3-M3).
- Important: a mentioned type removed or disabled before the spawn falls back to `general-purpose` through `resolveSpawnType` (mention-clone.ts). Rejected: a fresh start follows the user's `fallbackSubagent` policy, as every `Agent` spawn and pi-subagents' clone through the `Agent` tool did (`src/mention-clone.ts` at 79a7c42); P6's "keeps the mentioned type" sets it against the clone's `subagent_type`, and only a reopen resolves strictly (P12).

Notes and deviations:

- Deviation (review finding, accepted): the clone converts `session.messages` instead of `sessionManager.buildSessionProjection().messages` (P6's wording). The skill bodies a compaction carried forward thus reach the clone as they reach the parent's requests. One added test, mutation T3-M3. The probe's module test fake session gained `messages: []` in place of its `sessionManager`.
- Deviation: case 6's model check switches the session to a second faux model (`faux-2`); the harness registers two reasoning models, so the thinking level is not clamped.
- Note: the forwarding test of case 8 runs in a git repository it creates, with `worktreeIsolation: true`, so `isolation: "worktree"` reaches the record.
- The fourth review finding, rejected here, was accepted in T4 in another form (`spawnListed`).

### T4 The input hook

Commit: `f38e75e7d`

Tests: /tmp/sn3-impl/T4-1.json: 4 files, 72 tests, 69 passed, 3 failed (two expectation mistakes in new tests, and a fake PNG that Pi replaced with a note; all fixed). /tmp/sn3-impl/T4-2.json and T4-3.json: 4 files, 72 tests, 72 passed. /tmp/sn3-impl/T4-4.json (after the review fix, with the two clone test files the fix touched): 6 files, 95 tests, 95 passed, 0 failed, 0 pending.

Mutations: /tmp/sn3-impl/mutations/T4.txt: 49 entries, 16 cases, all caught; restored | 0 of 85 failed; clean: yes. Earlier records: T4-run1.txt (47 entries, T4-M34 not caught) and T4-pre-review.txt (46 entries, all caught).

Review:

- Important: a type disabled or removed after the hook read the cached registry still resolves in the hook, and `service.spawn` then applies `fallbackSubagent` against the reloaded definitions, so a `general-purpose` agent starts while the notice says `Started @worker` (ui/mentions.ts start; `service/service.ts` spawn, `definitions/registry.ts` resolveSpawnType). Accepted: P8 starts listed types only. `SubagentService.spawnListed` starts exactly the named type when it is still listed (enabled and not hidden) and otherwise throws `The <type> agent is no longer available.`; the hook's direct start and the clone's spawn (`tools/mention-clone.ts`) both use it, which also settles T3's rejected fallback finding. Tests "refuses a type disabled after the hook read the registry, rather than starting another type" and "starts nothing when the mentioned type is no longer a listed agent" (mutations T4-M9, T4-M10, T4-M11).

Notes and deviations:

- Deviation: T4-M34, dropping the `images` spread of the `@main` transform, is an equivalent mutation. `ExtensionRunner.emitInput` keeps the input's images when a transform omits them (`extensions/runner.ts`, `result.images ?? currentImages`). The entry left the spec; the spread stays as the probe wrote it.
- Deviation (review finding, accepted): `SubagentService.spawnListed` (the listed type only, no fallback) serves the hook's direct start and the clone's spawn; three tests and mutations. The clone module test's fake service names `spawnListed`.
- Deviation: case 14 is covered by the two phase 2 presentation tests whose fake UI contexts lack `addAutocompleteProvider` (probe Q13), not by a new mentions test.
- Deviation: several case 1, 4 and 11 mutations target phase 1 and phase 2 code the case exercises: the turn limit, the tool-use count, the transcript switch in runner/run.ts, resolveMention and retention. The hook adds no code for those behaviors.
- Note: the test fixture `holdChildInput` writes `extensions/hold-input.ts` into the agent directory; the worker file loads extensions, so its children pick the handler up.

### T5 The `@` autocomplete rows

Commit: `d15d7a1fb`

Tests: /tmp/sn3-impl/T5-1.json: 4 files, 102 tests, 101 passed, 1 failed (the `/reload` registration test; see the notes). /tmp/sn3-impl/T5-2.json: 102 passed. /tmp/sn3-impl/T5-3.json: 103 passed. /tmp/sn3-impl/T5-4.json (after the review fix): 4 files, 104 tests, 104 passed, 0 failed, 0 pending.

Mutations: /tmp/sn3-impl/mutations/T5.txt: 41 entries, 15 cases, all caught; restored | 0 of 87 failed; clean: yes. Pre-review record: T5-pre-review.txt (39 entries).

Review:

- Important: the roster drops hidden records and tombstones before it records their handles, so a listed type whose handle equals a skill agent's (`audit-checker` against `audit:checker`) lists as "start agent" while `@audit-checker` resolves to the skill agent (ui/mentions.ts mentionRoster; `service/service.ts` resolveMention). Accepted: every record and tombstone reserves its handle and alias first; a skill-bundled one only withholds its row. Test "keeps a skill-bundled agent's handle reserved, running or evicted, so no type row lists under it" (mutations T5-M37, T5-M38).

Notes and deviations:

- Deviation: the harness's test resource loader returns the same extension instance on `reload()`, so the factory never ran again. The registration test uses a loader whose `reload()` loads the factory anew, as interactive mode's `DefaultResourceLoader` does.
- Deviation (review finding, accepted): the roster reserves the handles of hidden records and tombstones before it withholds their rows; one test, mutations T5-M37 and T5-M38. Probe mutation Q16 now targets the moved `hidden` check.
- Deviation: the suite file mocks `node:fs` with pass-through spies on `readFileSync` and `readdirSync` for case 15.
- Note: old case 18 (nested agents) is covered by a module test with a handle-less view; the service's `list()` never hands out nested agents, and nested agents have no handle.

### T6 Documentation and the full inventory check

Commit: `ad19ea4dc`

Tests: /tmp/sn3-impl/T6-1.json: the 4 files the inventory's covering tests name, 132 tests, 132 passed, 0 failed.

Mutations: none; documentation only.

Inventory: `check-cases.mjs inventory` reports rows: 164 (T1 38, T2 7, T3 19, T4 53, T5 45, Dropped 2), offending: 0. `check-cases.mjs coverage $E3/old-cases.md $R/T6-1.json $R/mutations` exits 0 (162 rows checked).

Review:

- Important: the capability matrix pins its Pi column to commit `1e5666870`, which holds no native subagent service, so the rewritten `context: fork` and skill-bundled agent rows cite a revision that cannot substantiate them (docs/skills-capability-matrix.md:12-19, :44-45). Accepted: a note under the provenance table dates the two rows to a re-read on 2026-09-29 at `d15d7a1fb`.
- Important: new prose exceeds the 25-word sentence limit of the prose register (ADR-0009's D45 sentence at 27 words; the two new matrix cells) (`~/.pi/agent/AGENTS.md` "Voice"). Accepted: the ADR sentence, both matrix cells and the rewritten `context: fork` bullet of docs/skills.md are split into shorter sentences.

Notes and deviations:

- Deviation (review findings, accepted): the capability matrix gains a provenance note for its two re-read rows (2026-09-29 at `d15d7a1fb`), and new or rewritten sentences are split to the 25-word limit.
- Deviation: the README header names rulings D16 to D45 and the three phase plans; the layout rows name the mention grammar, the clone and the hook; the presentation's `tui` row names mentions.

### T9 Validate the built outputs and run the TUI smoke

T9 passed at commit `c27453bf6`.

Build: `npm run build:offline` exit 0 (/tmp/sn3-impl/T9-build.log).

on: exit 0: {"switch":"unset","mode":"on","sources":{"Agent":"<builtin:Agent>","get_subagent_result":"<builtin:get_subagent_result>","steer_subagent":"<builtin:steer_subagent>"},"presentation":{"loaded":true,"command":true,"renderer":true},"widget":true,"quitAwaited":true,"errors":[],"pass":true}

off with PI_FORK_BUILTINS=off: exit 0: {"switch":"off","mode":"off","sources":{"Agent":"none","get_subagent_result":"none","steer_subagent":"none"},"presentation":{"loaded":false,"command":false,"renderer":false},"widget":false,"quitAwaited":false,"errors":[],"pass":true}

off without the switch: exit 1: {"switch":"unset","mode":"off","sources":{"Agent":"<builtin:Agent>","get_subagent_result":"<builtin:get_subagent_result>","steer_subagent":"<builtin:steer_subagent>"},"presentation":{"loaded":true,"command":true,"renderer":true},"widget":false,"quitAwaited":false,"errors":[],"pass":false}

Smoke, `direct` mode (`$E3/run-smoke.sh "$PWD/packages/coding-agent/dist" direct /tmp/sn3-impl/smoke-direct`), exit 0:

```text
pass 00-print: smoke reply
surface surface:176
pass 01-start: smoke-1
pass 02-widget: smoke background
pass 03-status: 1 running agent
pass 04-fleet: Enter view
pass 05-viewer:  close
pass 06-popup: start agent
pass 07-mention: Started @explore
pass 09-main: smoke reply
pass 10-running: running
pass 11-quit: SMOKE-EXIT 0
```

Smoke, `model` mode (`/tmp/sn3-impl/smoke-model`), exit 0:

```text
pass 00-print: smoke reply
surface surface:178
pass 01-start: smoke-1
pass 02-widget: smoke background
pass 03-status: 1 running agent
pass 04-fleet: Enter view
pass 05-viewer:  close
pass 06-popup: start agent
pass 07-mention: Prompting @explore
pass 08-clone: smoke clone
pass 09-main: smoke reply
pass 10-running: running
pass 11-quit: SMOKE-EXIT 0
```

`find` counted 6 `.output` transcripts under the two runs' own `tmp/` directories. Afterwards `shasum -a 256 -c /tmp/sn3-impl/live-settings.sha256` passed, `ls -A /tmp/sn3-impl/home` printed nothing, and `git status --short` printed nothing.

## Phase runs

T7 ran the full coding-agent suite and `./test.sh` once, before the phase review (D36).

- Full coding-agent run: /tmp/sn3-impl/phase.json: 448 files, 5,276 tests, 5,226 passed, 0 failed, 50 pending. `failing-tests.mjs diff base-1.json phase.json` lists 0 new failures; the baseline's known flake (`exec.test.ts` "captures finite inherited descendant output after the shell exits") passed.
- ./test.sh: /tmp/sn3-impl/phase-testsh.log, exit 1. The failure ids equal the baseline's (only the same exec flake), and the package lists are identical.
- `check-identities.mjs base-1.json phase.json /tmp/sn3-impl`: baseline 5,137, phase 5,270, task reports 6, fix reports 0, offending 0; exit 0.
- Footprint: `git diff --numstat af021d3cc -- agent-session.ts interactive-mode.ts core/keybindings.ts` prints nothing.
- No T7-R task: no failure beyond the known flake.
- After T8, `check-identities.mjs` exits 0 with 5 fix reports and the rename in /tmp/sn3-impl/renamed.txt. The Section 9 coverage check over phase.json and the T8-F reports passes (162 rows, offending 0).

## Phase review

`/tmp/sn3-impl/phase-review.md`, verbatim:

Verdict: With fixes

Scope: super-code-review over af021d3cc5e1d444145ff4d061e08dc68f491cfa..ad19ea4dc (16 files outside docs/plans), fan-out mode, 12 lenses: requirements, correctness, guidelines, security, error handling, type design, test coverage, architecture, evolvability, performance, comments, docs impact (simplification skipped as opt-in). Spec: docs/plans/subagents-native-phase3.plan.md and the session-control handoff, rulings D16 to D45. Each finding below was checked against the source. Security, error handling and architecture reported no finding.

### F1: A mention by an evicted agent's original id reopens its session a second time after an earlier reopen started
Lens: correctness. Evidence: service/service.ts resolveMention matches a tombstone by `tombstone.id === name`, while the record a reopen creates has a new id and takes only the tombstone's handle and alias; the tombstone stays in the store, and the `reopening` reservation ends once the first record exists. A second `@<old id> message` therefore finds no record and reopens the same session file again, as a second record with the same handle. Fix: when a tombstone matches, look up records by the tombstone's handle and alias as well, so the reopened agent answers the old id; test two mentions by the old id, plus a mutation.
Disposition: Accepted
Approved: 2026-09-29, Paolo selected "F1 old-id mention never reopens a session twice (Recommended)"
Applied: e6582454b

### F2: A model-mode mention sent as the session's first prompt clones no system prompt
Lens: correctness. Evidence: tools/mention-clone.ts converts `session.messages`, which holds no system message before the first turn; agent-session.ts adds the system message per turn in `_preparePromptAndToolLoadout` (agent-session.ts:1257) after the input handlers ran, and the hook claims the prompt first. The clone then sends an empty system prompt, against P6 ("the live system prompt arrives byte for byte"). The suite's system-prompt test prompts "hello" first and hides the case. Fix: when the conversation carries no system prompt, the clone's system message carries `session.systemPrompt` (agent-session.ts:1985); test a first-prompt mention, plus a mutation.
Disposition: Accepted
Approved: 2026-09-29, Paolo selected "F2 clone carries the system prompt on a first prompt (Recommended)"
Applied: d0c790eae

### F3: A record that never reached a session, mentioned by its alias or numbered handle, passes to the main model instead of starting afresh
Lens: requirements. Evidence: ui/mentions.ts handleMentionInput: `dispatchExisting` returns false for a finished record without a child session, and the hook then resolves the typed handle as a type; `@reviewer retry` or `@worker-2 retry` resolves no type and falls through, and an alias that names another listed type would start that type. P2: "A finished agent that never reached a session starts afresh when no tombstone holds its name." Fix: the fresh start takes the resolved record's type, through `spawnListed`; test an alias and a numbered handle, plus a mutation.
Disposition: Accepted
Approved: 2026-09-29, Paolo selected "F3 never-started alias/numbered handle starts afresh (Recommended)"
Applied: 9ed3ccf59

### F4: The input hook rereads the settings for every prompt before it checks for a mention
Lens: performance. Evidence: ui/mentions.ts handleMentionInput calls `service.reloadSettings()` before `parseMention`; `readSubagentSettings` reads the global and project settings through the SettingsManager (structuredClone per read) for every submitted prompt, mention or not. Fix: parse first and reread the settings only for a syntactic mention; the existing off and @main tests keep the order of the checks.
Disposition: Accepted
Approved: 2026-09-29, Paolo selected "F4 hook rereads settings only for a mention (Recommended)"
Applied: 09d7afc23

### F5: New prose and one test title break the repository's writing rules
Lenses: guidelines, comments. Evidence: README.md `## Mentions` has a sentence over 25 words ("The spawn keeps the mentioned type and takes …"); the module docstrings of ui/mentions.ts and tools/mention-clone.ts and the `mentionRoster` docstring have sentences over 25 words (~/.pi/agent/AGENTS.md "Voice": "One statement per sentence, at most 25 words."); `label` in `mentionRoster` is a one-line helper with one call site (AGENTS.md: "Inline single-line helpers that have only one call site."); the T1 suite test "finds a top-level agent by handle, alias or id, whatever the casing, and never a nested one" suggests ids match whatever their casing, which they do not (F9). Fix: split the sentences, inline `label`, and rename the test (P16: `renamed.txt`; the test covers no inventory row).
Disposition: Accepted
Approved: 2026-09-29, Paolo selected "F5 prose limits, inline label, rename T1 test (Recommended)"
Applied: 3cbb11f45

### F6: ADR-0008 still says skill-bundled agents are implemented in the pi-subagents fork
Lens: docs impact. Evidence: docs/adr/ADR-0008-skill-bundled-agents-scoping.md:8-9, "(implemented in the pi-subagents fork; …)"; since phase 1 the native service loads and registers them (definitions/registry.ts), and this phase's cutover removes pi-subagents. Fix: name the fork's native subagent service, keeping the pi-subagents origin.
Disposition: Accepted
Approved: 2026-09-29, Paolo selected "F6 ADR-0008 names the native service (Recommended)"
Applied: c27453bf6

### F7: Tombstones leave the service as mutable objects, and reopen trusts the entry it receives
Lens: type design. Evidence: service/service.ts `listTombstones()`, `MentionTarget` and `reopen(entry, prompt)`; service/retention.ts `Tombstone`. An in-process caller could pass a fabricated or changed entry. The only caller, the input hook, passes the entry `resolveMention` returned.
Disposition: Deferred: an API hardening with no defect today, in the spirit of phase 2 F13; keying `reopen` by handle and handing out read-only tombstones fits the typed-API work of phase 4, when pi-tasks becomes a second in-process caller.

### F8: The popup and resolveMention each derive the mention targets
Lens: evolvability. Evidence: ui/mentions.ts `mentionRoster` reserves handles and picks record or tombstone rows; service/service.ts `resolveMention` holds the routing precedence. After a reopen that failed before its session existed, the popup shows the failed record, and the send reopens the tombstone; both promise and perform a resume. Fix: a service-level candidate list both use.
Disposition: Deferred: a refactor with no defect today; the one divergent state still promises and performs the same action, and a shared candidate API belongs with a change that adds a target state.

### F9: Raw agent ids should match whatever their casing
Lens: test coverage. Evidence: service/service.ts resolveMention compares ids exactly (`this.records.get(name)`, `tombstone.id === name`).
Disposition: Rejected: pi-subagents matches ids exactly (src/agent-manager.ts:1386 `this.agents.get(name)`, :1390 `entry.id === name` at 79a7c42), and the service's `find`, which the tools use, does the same; T1's review recorded the same disposition. Ids are printed lowercase and copied; F5 renames the test whose title suggested otherwise.

### F10: No user documentation outside the module README explains agent mentions or agentMentions
Lens: docs impact. Evidence: packages/coding-agent/docs/ has no subagents page; the behavior is documented in core/fork-builtins/subagents/README.md.
Disposition: Deferred: plan T6 scopes the phase's documentation, and the fork has documented its subagents in the module README since phase 1; a user-facing page covers every subagent surface, not mentions alone, and needs its own task.

### F11: MentionEnv should be a type alias instead of an interface
Lens: guidelines. Evidence: ui/mentions.ts `export interface MentionEnv`.
Disposition: Rejected: no repository rule prefers type aliases, and the module declares its object shapes as interfaces throughout (service/records.ts `SubagentView`, service/service.ts `SpawnRequest`, `SubagentSessionContext`).

- Phase review: super-code-review, fan-out mode, 12 lenses (simplification skipped as opt-in). Verdict: With fixes. 11 findings: F1 to F6 Accepted and approved by Paolo on 2026-09-29; F7, F8 and F10 Deferred; F9 and F11 Rejected.

### T8-F1 A mention by an evicted agent's original id reopens its session a second time

Commit: `e6582454b`

Tests: /tmp/sn3-impl/T8-F1-1.json: 11 files (every file T1 to T5 ran), 224 tests, 224 passed, 0 failed.

Mutations: /tmp/sn3-impl/mutations/T8-F1.txt: 1 entry, caught; restored | 0 of 55 failed; clean: yes.

Review:

- none

### T8-F2 A model-mode mention sent as the first prompt clones no system prompt

Commit: `d0c790eae`

Tests: /tmp/sn3-impl/T8-F2-1.json: 11 files, 225 tests, 225 passed, 0 failed.

Mutations: /tmp/sn3-impl/mutations/T8-F2.txt: 2 entries, caught; restored | 0 of 22 failed; clean: yes.

Review:

- none

### T8-F3 A never-started record, mentioned by its alias or numbered handle, passes to the main model

Commit: `9ed3ccf59`

Tests: /tmp/sn3-impl/T8-F3-1.json: 11 files, 226 tests, 226 passed, 0 failed.

Mutations: /tmp/sn3-impl/mutations/T8-F3.txt: 1 entry, caught; restored | 0 of 56 failed; clean: yes.

Review:

- none

Notes and deviations:

- A first review run reported an empty staged diff although both files were staged; the rerun read the saved diff and found nothing.

### T8-F4 The input hook rereads the settings for every prompt

Commit: `09d7afc23`

Tests: /tmp/sn3-impl/T8-F4-1.json: 11 files, 227 tests, 227 passed, 0 failed.

Mutations: /tmp/sn3-impl/mutations/T8-F4.txt: 1 entry, caught; restored | 0 of 57 failed; clean: yes.

Review:

- none

### T8-F5 New prose and one test title break the repository's writing rules

Commit: `3cbb11f45`

Tests: /tmp/sn3-impl/T8-F5-1.json and T8-F5-2.json (after the review fix): 11 files, 227 tests, 227 passed, 0 failed.

Mutations: none; no behavior changes.

Review:

- Important: the revised ui/mentions.ts module docstring joins two statements in one sentence ("`@handle message` addresses an agent instead of the main model, and the handle names the agent across its life:") (`~/.pi/agent/AGENTS.md` "Voice": "One statement per sentence"). Accepted: the sentence ends after "main model", and the next starts "The handle names the agent across its life:".

Notes and deviations:

- The renamed test, "handle resolution finds a top-level agent by handle or alias whatever the casing, or by its exact id, and never a nested one", is declared in /tmp/sn3-impl/renamed.txt (P16). It covers no inventory row, so no task mutation spec reran.
- Deviation: the commit subject starts `docs(coding-agent):` instead of plan T8's `fix(coding-agent): <finding>`, because the change touches no behavior.

### T8-F6 ADR-0008 still says the pi-subagents fork implements skill-bundled agents

Commit: `c27453bf6`

Tests: none; documentation only.

Mutations: none; no behavior changes.

Review:

- none

Notes and deviations:

- Deviation: the commit subject starts `docs:` instead of `fix(coding-agent): <finding>`.

## Decisions by Paolo

- 2026-09-29: Paolo approved phase review findings F1 to F6 for application, selecting each as recommended; F7 and F8, offered as optional pulls into this phase, stayed deferred.

## Deviations

Each task section above lists its own deviations. Across the phase:

- The regression runs follow D36: each task ran `npm run check`, the test files its changes touch and at least one mutation per case; the full suites ran once, in T7.
- Four accepted per-commit review findings changed the probe's verified code: the reopen join (T2), `session.messages` in the clone (T3), `spawnListed` (T4) and the reserved skill-agent handles (T5).
- The mutation specs carry more entries than one per case, because every inventory row needs a covering test that a mutation of its case breaks.
- The per-commit reviewer read `git diff --cached` for T1 to T8-F2. From T8-F3 on, it also received a saved copy of the staged diff, after one run reported an empty staged diff.

## Open items

- The workflow work excludes `Agent`, `get_subagent_result` and `steer_subagent` from worker sessions, with a test that a worker's model never receives them, before it resumes (D43).
- Phase 2's deferred findings F11 (viewer render caching), F13 (splitting the service) and F14 (a shared settings schema) stay open.
- Phase 3 review F7: read-only tombstones and a `reopen` keyed by handle, with the typed-API work of phase 4.
- Phase 3 review F8: one service-level list of mention candidates for the popup and `resolveMention`.
- Phase 3 review F10: a user-facing documentation page for subagents, mentions included.
- The agent files' `persistSession` and `thinkingLevel` keys in `~/.pi/agent/agents/` and `.pi/agents/` become `persist_session` and `thinking`, after Paolo's yes (plan Section 10).
- The plan's T1 case 9 says ids match "case-insensitively"; the code and phase review F9 keep exact ids. The plan's wording can say "case-insensitive handles and aliases; exact ids".

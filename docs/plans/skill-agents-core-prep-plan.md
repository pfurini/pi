# Skill-bundled agents — core-side prep (Workstream 2 prerequisites in `pi`)

## Purpose and scope

Workstream 2 (WS2) builds skill-bundled agent discovery, registration, soft
scoping, and the rewrite-map seam in the `pi-subagents` fork. Before that work
starts, a bounded set of prerequisites must land in this repo (`pi`). They are
the pieces WS2 conforms to: the wire payload the fork reads, the executable stub
that is WS2's spec, and the protocol negotiation the fork's v3 changes depend on.

This plan covers **only** those core-side prerequisites. It does not implement
discovery, naming, listing, or soft scoping — all of that is fork-side.

Scope was confirmed with the user: core prep first, in this repo.

Branch: `personal`. Per `AGENTS.md`, do not add changelog entries on a non-`main`
branch. All work is under `packages/coding-agent`.

This revision incorporates an adversarial review (see "Adversarial review
incorporated" at the end). Two blocking corrections changed the design of WI-3;
several loader/test-surface omissions were added to WI-1/WI-2.

## Settled decisions (from the design discussion)

Inputs, not open questions:

1. Two skills bundling the same otherwise-free bare name → **neither** gets the
   bare alias (fork-side).
2. No per-agent disable switch for skill-bundled agents (fork-side).
3. Skill agents **do** participate in `allowedSubagents: "all"` nested
   delegation (fork-side).
4. Bare alias hidden from `@handle` autocomplete; both names hidden from global
   listings (fork-side).
5. Case-only collisions are collisions (fork-side; core's rewrite already folds
   case in `rewriteAgentNames`).
6. **Hiding a skill hides its bundled agents iff the skill's resolved visibility
   is `off`** (`userInvokeError === true`). The one decision that reaches the
   wire; drives WI-1/WI-2. Rationale: `off` is the only state making a skill
   uninvocable by both model and user (verified: model path drops it from the
   `skill` tool at `agent-session.ts:2439`; user path leaves an erroring
   tombstone at `commands/registry.ts:233`). Author-set
   `disable-model-invocation` + `user-invocable: false` also yields an
   uninvocable skill, but that is a deliberate "container" skill shipping agents,
   not an operator switching the skill off — it must **not** suppress the agents.
   Keying on `off`/`userInvokeError` distinguishes the two.
7. Ship v3 + `agent-ended` now (WI-3).
8. Rewrite-map re-emit + query-reply is the model; core keeps the last-received
   map and ignores stale revisions (already in `runtime.ts`). The stub must both
   broadcast and answer pulls (WI-4).

## Verified anchors (as of this plan)

- A.9 seam: `src/core/skills/skill-set-events.ts` — `SkillSetSnapshotEntry`
  (`:42-49`), `SkillSetController.publish`, `canonicalSkillSetJson` (recursively
  sorts keys, `:128-152`), bus-scoped controller via `WeakMap` (`:209-220`).
- Publisher (sole production caller): `resource-loader.ts:1054`, inside
  `updateSkillsFromPaths`. Loader holds `this.settingsManager` (`:405`).
- Direct test callers of `publish`: `test/suite/skill-contract.test.ts:783,792`
  (atomicity test) call `controller.publish([...])` with one argument.
- Visibility resolver (pure): `skills/visibility.ts:62-78` —
  `resolveSkillVisibility`, `ResolvedSkillVisibility { model, user,
  userInvokeError }`; `defaultSkillVisibility` = the `on` row.
- Visibility state source: `settings-manager.ts` — `getSkillVisibilityState(id)`.
- Session visibility: `agent-session.ts` `_refreshSkillVisibilitySnapshot`
  (`:2300`) builds `this._skillVisibility: Map<id, ResolvedSkillVisibility>` from
  the **session's** settings manager; `applySkillVisibilityChange` (`:2403-2428`)
  writes the setting + refreshes local surfaces but never re-publishes.
- Session vs loader: `AgentSession.settingsManager = config.settingsManager`
  (`:630`) and `_resourceLoader = config.resourceLoader` (`:632`) are
  **independent** config fields — production passes one shared manager, but
  injected/test loaders can diverge (the harness builds them separately).
- Fork client: `skills/skill-fork.ts` — `probePresence` (`:172-205`, ignores
  `version`/`capabilities`; any `success===true` = present),
  `normalizeSubagentCompletion` (`ok` by channel, reads `id`),
  `deliverCompletion` buffers **unconditionally** while `awaitingSpawnReply>0`
  (`:393-397`).
- Qualified-type pass-through: `runtime.ts` `resolveForkAgentType` (`:251-266`)
  returns any `agent` containing `:` **unchanged, before consulting the map**;
  `agent-session.ts:2584-2588` sends that result as `agentType`. Existing test
  `skills-fork.test.ts:838-850` authors `agent: someskill:someagent` and asserts
  it reaches a **v2** stub verbatim.
- `ResourceLoader` interface (`resource-loader.ts:80-108`) has optional-method
  extension points but no `republishSkillSet`; many structural implementers
  exist (`test/utilities.ts` `createTestResourceLoader`).
- Public re-exports (copy set): `src/index.ts:329-343` (explicit named list).
- Stub: `test/suite/support/stub-subagents-extension.ts` (`STUB_PROTOCOL_VERSION
  = 2`, `:17`); existing tests depend on the v2 default shape.
- Fork repo `/Users/paolof/Developer/ai/pi-subagents`: `PROTOCOL_VERSION = 2`
  (`cross-extension-rpc.ts:25-26`), spawn reply `{id}` (`:111`), reply-channel
  template at `:62`; terminal status union includes `steered` (`types.ts:159`);
  `steered` is emitted on `subagents:completed` (`index.ts:515-520`, `isError`
  excludes it).
- Dead contract-pin: `skills-fork.test.ts:770-782` points at
  `~/Developer/ai/pi-subagents-tintin` (absent); `existsSync` guard makes it
  vacuous.
- Conformance test: `skill-contract.test.ts` "publishes the A.9 lifecycle…"
  (deep + byte compare, `:659-669`); its per-entry loop currently omits
  `visibility`. The `fields/` round-trip test (`:1094-1165`) inspects
  `getSkills()`/frontmatter only, **not** the A.9 entry shape.
- Frozen plan doc `docs/plans/pi-skill-system-plan.md` A.9 (`~947`); the
  conformance test pins specific substrings — amendments must not remove them.
  Note: A.9 lists agent-ended statuses as `completed|error|aborted|stopped` (no
  `steered`) yet also says "the fork's native status set" — an internal
  discrepancy WS2 must reconcile (see WI-3).

## Work items

Order: WI-1 → WI-4 → WI-3 → WI-2 → WI-5 → WI-6.

---

### WI-1 — Add resolved visibility to the A.9 skill-set payload

**Problem.** `SkillSetSnapshotEntry` carries no resolved visibility, so the fork
cannot tell an `off` skill from an `on` one (decision 6).

**Change.**

- `skill-set-events.ts`:
  - Add `readonly visibility: SkillSetVisibility` to `SkillSetSnapshotEntry`.
    Define `SkillSetVisibility` **locally** (JSON-safe structural copy of
    `ResolvedSkillVisibility`): `{ readonly model: "full" | "name" | "no";
    readonly user: "yes" | "no"; readonly userInvokeError: boolean }`. Do not
    import `ResolvedSkillVisibility` — keep the wire module self-contained for
    byte-for-byte copying (WI-6).
  - Change `publish` to
    `publish(skills: readonly LoadedSkill[], visibilityById?: ReadonlyMap<string, SkillSetVisibility>): SkillSetSnapshot`.
    The parameter is **optional** so the two direct test callers
    (`skill-contract.test.ts:783,792`) keep compiling and non-loader callers
    need not resolve visibility.
  - For each entry, take `visibilityById.get(skill.id)` when present; otherwise
    compute the `on`-row default **inline** from the entry's own frontmatter
    flags (no import of `visibility.ts`): `model = disableModelInvocation ? "no"
    : "full"`, `user = userInvocable ? "yes" : "no"`, `userInvokeError = false`.
    Comment it as mirroring the `on` row of `visibility.ts`. The production loader
    path always passes a complete map, so the inline default is only a defensive
    fallback for non-loader callers.
  - **Detach before freeze.** Construct a fresh object
    `{ model, user, userInvokeError }` per entry before `deepFreeze(snapshot)`,
    never assigning a caller-owned `ResolvedSkillVisibility`/map value directly
    (publication must not freeze loader-owned state — the existing isolation
    guarantee at `skill-set-events.ts:171-181`).
- `resource-loader.ts`:
  - Add a private `resolveSkillVisibilityById(): Map<string, SkillSetVisibility>`
    that maps each `this.skills` entry to
    `resolveSkillVisibility({ disableModelInvocation, userInvocable },
    this.settingsManager.getSkillVisibilityState(skill.id))`, projected to the
    wire shape. Import `resolveSkillVisibility` from `skills/visibility.ts`
    (pure, no cycle). A `satisfies`-style assignment guards the projection
    against `ResolvedSkillVisibility` drifting from `SkillSetVisibility`.
  - Pass its result to `publish` at `:1054`.
- `src/index.ts`: add `type SkillSetVisibility` to the explicit re-export list
  for the seam (`:329-343`) so the copy-set surface is complete.

**TDD.**

1. Extend the "publishes the A.9 lifecycle…" per-entry loop to assert
   `entry.visibility` deep-equals the resolver output for that skill. Add a
   fixture skill set to `off` in the session/loader settings and assert its
   entry carries `{ model: "no", user: "no", userInvokeError: true }`. (Red:
   field absent.)
2. Extend the isolation test ("isolates snapshots from subscriber mutation…")
   to assert the published `visibility` object is frozen while the loader-owned
   source value is not mutated/frozen. (Red before detach-before-freeze.)
3. Implement type + plumbing + export. (Green.)
4. Regenerate `skill-set-snapshot.json` (both fixture skills → `on` →
   `{ model: "full", user: "yes", userInvokeError: false }`). Regeneration =
   run the fixture test, write the emitted `canonicalSkillSetJson` (with the
   documented temp-root substitution) back to the fixture, re-run to confirm
   byte-exact.

**Acceptance.**

- `SkillSetSnapshotEntry` has `visibility`; `canonicalSkillSetJson` sorts it in;
  `SkillSetVisibility` is exported from `src/index.ts`.
- Conformance test passes deep- and byte-exact against the regenerated fixture,
  with an explicit per-entry `visibility` assertion.
- Published `visibility` objects are frozen; loader-owned state is not.
- An `off` skill's entry carries `userInvokeError: true`.
- `npm run check` passes (the two direct `publish` test callers still compile via
  the optional parameter).

---

### WI-4 — Extend the stub to v3 (executable spec for WS2)

Landed before WI-3 because WI-3's tests drive the v3 stub.

**Change.** Extend `createStubSubagentsExtension` (v2 stays the default so
existing tests are untouched):

- Options `protocolVersion?: 2 | 3` (default 2) and `skillAgents?: boolean`
  (advertised only at v3). At v3 the ping replies
  `{ success: true, data: { version: 3, capabilities: { skillAgents } } }`.
- `agent-ended` emission (v3 only): controller method `endAgent(agentId,
  { status, result?, error? })` emitting `subagents:agent-ended { agentId,
  status, result?, error? }`. Support the full fork status set including
  `steered` so WI-3 can test the `ok` mapping. Reuse the existing
  `autoComplete.when` (`before-reply` | `after-reply`) knob to emit
  `agent-ended` in place of the v2 broadcast when `protocolVersion === 3`;
  preserve the ordering guarantee (never before the spawn reply except via the
  explicit `before-reply` knob that exists to test the buffer).
- Rewrite-map publisher: `publishRewriteMaps(maps, revision?)` emitting
  `skill-agents:rewrite-maps { revision, maps }`.
- `skill-agents:query` responder: reply on `skill-agents:query:reply:<requestId>`
  with `{ success: true, data: { revision, maps } }` from the last published maps
  (default `{ revision: 0, maps: {} }`).
- Export `STUB_PROTOCOL_VERSION_V3 = 3` (keep `STUB_PROTOCOL_VERSION = 2`).
- Reuse channel constants from `runtime.ts`
  (`SKILL_AGENTS_REWRITE_MAPS_CHANNEL`, `SKILL_AGENTS_QUERY_CHANNEL`,
  `skillAgentsQueryReplyChannel`) so the stub and core cannot drift.

**TDD.** New focused test: v3 ping shape; `skill-agents:query` round-trip returns
the last published maps; `publishRewriteMaps` reaches a subscriber; `endAgent`
emits the correct channel/payload for `completed` and `steered`.

**Acceptance.** v2 default path unchanged (all existing stub-driven tests pass
untouched); v3 mode advertises version + capabilities, emits `agent-ended`
(incl. `steered`), publishes rewrite maps, answers `skill-agents:query`.

---

### WI-3 — v3 negotiation, capability gate, and `agent-ended` consumption

**Problem.** `probePresence` never reads `version`/`capabilities`;
`normalizeSubagentCompletion` knows only v2 completed/failed; `agent-ended` is
unconsumed. And **qualified `skill:agent` types already reach a v2 peer**:
`resolveForkAgentType` passes any colon-containing authored `agent:` value
straight to the wire (verified; `skills-fork.test.ts:838-850`). The frozen A.9
requires core to pass qualified types only to a version ≥ 3 + `skillAgents` peer.

**Change (a) — capture negotiation.** Read `version` and `capabilities` from the
ping reply's `data` envelope in `probePresence`; store `detectedVersion?: number`
and `skillAgentsCapable?: boolean`. `detectPresence` still resolves a boolean;
add accessors `getDetectedVersion()` / `isSkillAgentsCapable()`.

**Change (b) — capability gate (blocking correction).** Honor A.9: a qualified
(`:`-containing) `agentType` may be forwarded only when `detectedVersion >= 3 &&
skillAgentsCapable === true`. Implement the gate in `AgentSession` (it owns
diagnostics), reading the client accessors after presence detection has run
(`_shouldDegradeFork` already awaits `detectPresence` before the spawn is built).
When the type is qualified but the peer is not capable (including
version-unknown → **fail closed**), drop it to `general-purpose` for the wire and
emit one skill diagnostic explaining the degrade. Do **not** amend A.9 to claim
the gate is redundant (the earlier draft's justification was false).

*Consequence — existing test change.* `skills-fork.test.ts` "leaves an
already-qualified value untouched" (`:838-850`) currently asserts a qualified
value reaching a **v2** stub. That encodes the pre-gate (contract-violating)
behavior. Under the gate it must be updated to use a **v3 + skillAgents** stub
(qualified value passes) and a **new** sibling test must assert a v2 (or
non-`skillAgents`) peer receives `general-purpose` plus the diagnostic. This is a
deliberate behavior change to match the now-authoritative contract, not a test
weakened to pass a change — call it out in the commit message.

**Change (c) — `agent-ended` consumption.** Subscribe to `subagents:agent-ended`
in the constructor. Normalize with a sibling to `normalizeSubagentCompletion`
that reads `agentId` (not `id`) and derives `ok = !(status === "error" || status
=== "stopped" || status === "aborted")` — mirroring the fork's own `isError`
split so `completed` **and** `steered` are successes. This is robust whether or
not the fork carries `steered` in `agent-ended` (the frozen A.9 status list omits
it; the fork's native set includes it). Carry `result`/`error`/`status`; route
through `deliverCompletion`.

**Change (d) — buffer first-wins (correctness fix).** In `deliverCompletion`,
buffer only the first completion per agent in the pre-reply window: guard the
`completionBuffer.set` with `if (!this.completionBuffer.has(agentId))`. Today a
second channel for the same agent overwrites the first buffered event, so a v2
broadcast + `agent-ended` dual-emit before the reply would be last-wins, not
first-wins.

**TDD.**

1. Ping capture: v3 stub → `getDetectedVersion() === 3`,
   `isSkillAgentsCapable() === true`; v2 stub → version 2, capability false.
   (Red before capture.)
2. Gate: authored `agent: someskill:someagent` + v2 stub → spawn type is
   `general-purpose` and a diagnostic is emitted; same authored value + v3
   `skillAgents` stub → qualified value forwarded verbatim. (Red before the
   gate; also update the existing pass-through test to the v3 stub.)
3. `agent-ended` consumption: foreground spawn, emit only `agent-ended`
   (no v2 broadcast) with `status: "completed"` → outcome `completed`/`ok:true`;
   `status: "steered"` → `ok:true`; `status: "error"` → `ok:false` with the
   error carried; `status: "aborted"`/`"stopped"` → `ok:false`. Before-reply
   emission → buffered and delivered. (Red before the subscription — an
   agent-ended-only agent never settles today.)
4. First-wins dual-emit: before the spawn reply, emit a v2 broadcast and an
   `agent-ended` for one agent with **distinguishable** payloads; assert exactly
   one delivery carrying the first payload. (Red before change (d).)

**Acceptance.**

- Version/capabilities captured; accessors return them.
- Qualified types gated on v3 + `skillAgents` (fail-closed); v2 peer gets
  `general-purpose` + diagnostic; v3-capable peer gets the qualified type.
- `agent-ended` delivered with correct `ok` for all terminal statuses incl.
  `steered`.
- Pre-reply dual-emit deduped to one delivery, first payload wins.
- No change to v2 completion behavior when only v2 broadcasts arrive.

---

### WI-2 — Re-publish `skills:changed` on a visibility change

**Problem.** `applySkillVisibilityChange` never re-publishes the A.9 snapshot, so
with WI-1's visibility on the wire, toggling a skill `off` would not reach the
fork until the next `reload`.

**Change.**

- Add `republishSkillSet(visibilityById: ReadonlyMap<string, SkillSetVisibility>): void`
  to `DefaultResourceLoader` and as an **optional** method on the `ResourceLoader`
  interface (`republishSkillSet?`), so existing structural implementers/test
  doubles keep compiling. It re-runs `this.skillSetController.publish(this.skills,
  visibilityById)`. It intentionally bypasses the `updateSkillsFromPaths`
  coalescing guard (`skillsSemanticallyEqual` does not include persisted
  visibility, so a visibility-only change does not alter `this.skills`).
- **Authority.** `applySkillVisibilityChange` passes the **session's**
  already-refreshed visibility (`this._skillVisibility`, projected to the wire
  shape) into `republishSkillSet`, so the wire entry matches the session's local
  prompt/tool surfaces exactly — the two cannot disagree even if the loader was
  constructed with a different settings manager. Call it via optional chaining
  (`this._resourceLoader.republishSkillSet?.(map)`) on the **success path only**
  (after the settings write + local refresh succeed), so a failed write emits
  nothing.

**Design note.** `publish` computes `removed` against the previous snapshot;
skills are unchanged on a visibility republish, so `removed` is empty, `skills`
is identical except the toggled entry's `visibility`, and `revision` increments.
Correct: the fork keys off `id` and re-reads `visibility`. A same-state re-toggle
still emits (revision increments); consumers ignore stale revisions, so this is
benign.

**TDD.** Build a harness/session that **shares one event bus and one settings
manager** between session and loader (deliberate setup — the default harness does
not). Subscribe to `skills:changed`.

1. Toggle a skill to `off` via the visibility-change entry point → a new
   `skills:changed` with incremented revision and the entry's
   `visibility.userInvokeError === true`, without a reload. (Red before the
   call.)
2. Failed settings write (force a write error) → assert **zero** additional
   `skills:changed` events and unchanged revision. (Covers the acceptance
   criterion the earlier draft left unverified.)

**Acceptance.**

- Toggling visibility emits `skills:changed` with updated `visibility` and a
  higher revision, no reload; the wire matches the session's local surfaces.
- A failed settings write emits nothing.
- Interface change is optional; existing loaders/doubles compile unchanged.

---

### WI-5 — Repoint the dead contract-pin test

**Problem.** `skills-fork.test.ts:771` pins against the absent
`pi-subagents-tintin`; the `existsSync` guard makes it vacuous. The real fork is
`~/Developer/ai/pi-subagents` (`PROTOCOL_VERSION = 2`, reply template at
`cross-extension-rpc.ts:62`).

**Change.** Repoint to `~/Developer/ai/pi-subagents`. Keep the `existsSync` guard
(the checkout is developer-local, absent in CI) but make the skip **visible**
(annotate/log) rather than a silent return. Keep the existing assertions
(`PROTOCOL_VERSION`, reply-channel template, the three RPC channels). Do not bump
the pinned `STUB_PROTOCOL_VERSION` (still 2, matching the fork today; WS2 bumps
the fork side later).

**TDD.** Test-only fix. Verify with the real checkout present (asserts fire) and
by temporarily pointing at a nonexistent path (skip is now visible).

**Acceptance.** With `~/Developer/ai/pi-subagents` present the pin actively
asserts and passes; absence produces a visible skip.

---

### WI-6 — Mark the copy set as cross-repo contract

**Problem.** Core re-exports the seam publicly (`src/index.ts:329-343`), inviting
a fork-side `import` that would break the fork's independent buildability (the
published upstream `@earendil-works/pi-coding-agent@0.84.2` has none of this — the
entire skills subtree is absent at tag `v0.84.2`).

**Change (docs only, no behavior).**

- Header comment in `skill-set-events.ts` and on the rewrite-map section of
  `runtime.ts` naming the cross-repo copy set: the wire types (incl.
  `SkillSetVisibility`), `canonicalSkillSetJson`, the rewrite-map types, and the
  fixture `skill-set-snapshot.json`; companions copy byte-for-byte, never import.
- Append one dated, additive amendment sentence to A.9 stating companions copy
  these and naming the new `visibility` field as part of the copied entry.
  Preserve the substrings pinned by `skill-contract.test.ts` (source shape,
  fixture path, `canonicalSkillSetJson`, "sorted lexicographically", "2-space
  indentation", "trailing LF").

**Acceptance.** Copy set marked in code and named in A.9; the plan-pin test still
passes.

---

## Cross-cutting: A.9 doc amendments

Additive, dated, amendment-style edits to `docs/plans/pi-skill-system-plan.md`
A.9, preserving all pinned substrings:

1. Skill-set entry gains `visibility: { model, user, userInvokeError }` (resolved
   A.6 result); wire meaning of decision 6 (fork suppresses a skill's bundled
   agents iff `visibility.userInvokeError`).
2. Companions copy the wire types (incl. `SkillSetVisibility`) byte-for-byte
   (WI-6).
3. Reconcile the agent-ended status set: state that core derives success as
   `!(error|stopped|aborted)` so `steered` (a fork-native success emitted on the
   completed channel) is handled correctly, and note WS2 must decide whether the
   fork carries `steered` in `agent-ended` or normalizes it to `completed`.

Do **not** add the earlier draft's "capability gate is redundant" note — the gate
is implemented (WI-3), so A.9 stands as written on that point.

## Validation

- `npm run check` (full output) — fix all errors/warnings/infos.
- Targeted tests from `packages/coding-agent`:
  - `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/suite/skill-contract.test.ts`
  - `... --run test/suite/skills-fork.test.ts`
  - any new focused test files.
- Do not run the full vitest suite directly (e2e activation risk). `./test.sh`
  from repo root for a broader non-e2e pass if warranted.
- Regenerate `skill-set-snapshot.json` and confirm byte-exact round-trip.

## Residual risks

1. **Payload richness.** `visibility` carries the full resolved triple, not just
   `userInvokeError`. Kept because the seam is the general skill-set view and WS3
   (claude-bridge) plausibly wants model/user visibility; a bool would force a
   later breaking widening.
2. **Divergent settings managers.** WI-2 sidesteps this by publishing the
   session's own resolved map; WI-1's reload-time publish still uses the loader's
   manager. In production they are the same object; a divergent injected loader
   would see reload-time vs toggle-time visibility from different managers, but
   each publish is locally correct for its trigger. Acceptable; documented.
3. **Gate fail-closed timing.** The gate reads captured capabilities; if a spawn
   somehow runs before detection, it fails closed (no qualified forwarding). Safe
   default; `_shouldDegradeFork` awaits detection first in the normal path.

## Adversarial review incorporated

Reviewed by an adversarial subagent (model `openai-codex/gpt-5.6-sol`); all
findings verified against source and accepted:

- **Blocking, WI-3 gate:** the "no fork ⇒ no map ⇒ no qualified type" argument was
  false — authored qualified `agent:` values pass through `resolveForkAgentType`
  unchanged to any peer. Replaced the "gate is redundant" recommendation with an
  implemented capability gate (change (b)) and the required existing-test change.
- **Blocking, WI-3 `steered`:** deriving `ok` from `status === "completed"` would
  regress the fork's `steered` success. Changed to `ok = !(error|stopped|
  aborted)`. Also flagged the frozen-A.9 status-set discrepancy for WS2.
- **WI-3 buffer:** "first delivery wins" was false (unconditional buffer set).
  Added change (d) and a distinguishable-payload test.
- **WI-1:** added the optional `publish` param (two direct test callers),
  detach-before-freeze for the visibility object, and the `SkillSetVisibility`
  export from `src/index.ts`.
- **WI-2:** `republishSkillSet` must be optional on the `ResourceLoader`
  interface; authority moved to the session's resolved map; failed-write test now
  asserts zero events; test must wire a shared bus + settings manager.
- **Verified-correct claims** (unchanged): main anchors, coalescing excludes
  visibility, bus-scoped controller, `canonicalSkillSetJson` auto-sorts,
  `fields/` round-trip does not assert the A.9 entry shape, fixture skills
  default to `on`, stub v2 default, fork existence/version/reply-template, and
  the no-changelog rule for branch `personal`.

## Second adversarial review incorporated (2026-08-22, post-landing)

A second multi-lens review of the landed implementation (bd4bb3f91 + 37b4acfda)
produced one Important and several Minor findings; all except one deliberate
skip are fixed in the follow-up commit:

- **Important, stale negotiation:** `onReady` invalidated only a cached
  *negative* probe, so an extension upgrade/downgrade + `/reload` kept a stale
  version/capability verdict for the rest of the session (qualified types could
  leak to a v2 peer after a downgrade; falsely degraded after an upgrade, while
  the new peer's rewrite maps still applied). `onReady` now invalidates the
  probe and the captured negotiation unconditionally; a re-negotiation test
  covers upgrade and downgrade.
- **agent-ended without a status:** a payload lacking a string `status`
  normalized to `ok: true`; `normalizeAgentEnded` now returns `undefined` for
  it (dropped as malformed) instead of guessing success. Known statuses keep
  the open `!(error|stopped|aborted)` derivation so fork-native successes such
  as `steered` never become false failures.
- **Visibility parity guard:** the loader's one-way `ResolvedSkillVisibility ->
  SkillSetVisibility` assignment silently permitted resolver-side field
  additions; replaced with a bidirectional compile-time guard
  (`Record<Exclude<keyof ...>, never>` intersection on the projection).
- **Silent republish no-op:** a loader without `republishSkillSet` now triggers
  a one-time session diagnostic on a visibility change instead of silently
  leaving the wire snapshot stale while reporting success.
- **Test gaps closed:** `stopped` added to the agent-ended settlement matrix
  (with result/error carriage asserted per branch); the first-wins dual-emit
  race now also asserts exactly-one delivery via a background collector; the
  isolation test asserts a caller-owned visibility map value stays unfrozen and
  mutable after publish; the stub's `endAgent` default `completed` payload is
  pinned.
- **Copy-set guard placement:** the do-not-import warning now sits directly at
  the import block of `skill-set-events.ts`, and the "self-contained" claim is
  narrowed to the wire declarations.
- **Docs:** Appendix B.5's status set now notes the fork adds `steered`,
  restoring consistency with the A.9 core-prep clarification.
- **Deliberately not fixed:** accepting a non-finite `version` from a malformed
  ping reply (`typeof === "number"` without `Number.isInteger`); requires a
  broken same-bus peer to matter.

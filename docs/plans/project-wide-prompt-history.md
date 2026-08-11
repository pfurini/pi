# Project-wide prompt history in Pi core

## Objective

Implement configurable prompt-editor history in Pi core so Up/Down can recall user messages from every saved session for the same working directory, including sessions from months earlier. Preserve the current session-local behavior by default, and allow an explicit unlimited mode.

The target user configuration is:

```json
{
  "promptHistory": {
    "scope": "project",
    "maxEntries": 0
  }
}
```

`maxEntries: 0` means unlimited. It limits only the in-memory editor recall list; it must never delete or rewrite session JSONL files.

This plan was prepared against revision `1580da4fe90306b644ef667cc1585610d358c4bb` after re-reading the current upstream implementations, then re-verified against that same revision: every file path, symbol, API signature, call site, and shell command below was confirmed to exist as written. If `git rev-parse HEAD` still reports `1580da4f`, the line numbers cited here are live; otherwise re-locate the symbols by name, since line numbers move.

A second review pass re-verified all of that and added nine amendments, four of which are behavioral corrections without which the implementation ships real bugs. They are folded into the relevant steps below and summarized in "Second review pass" at the end. Read that summary before starting.

## Current behavior and constraints

1. `packages/tui/src/components/editor.ts`
   - `Editor` stores prompt history in a private `history: string[]` (line 317) with `historyIndex` (line 318) as the browse cursor.
   - `addToHistory()` (line 399) trims input, ignores empty values and consecutive duplicates, `unshift`es the new value, and hard-caps the list at 100 via a literal at line 406.
   - `EditorOptions` (line 233) currently holds exactly `paddingX?: number` and `autocompleteMaxVisible?: number`.
   - Up/Down navigation (`navigateHistory()`, line 427), multiline cursor placement, draft restoration, and undo behavior are already correct and should be reused rather than reimplemented.

2. `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
   - `renderInitialMessages()` (line 3463) calls `renderSessionEntries(..., { populateHistory: true })` at line 3467.
   - `addMessageToChat()` (line 3226) feeds only rendered user messages into the editor history, guarded by `options?.populateHistory` at line 3303.
   - The `populateHistory` flag threads through `renderSessionItems()` (line 3332) and `renderSessionEntries()` (line 3423, documented at line 3419).
   - Because `renderInitialMessages()` uses `SessionManager.buildContextEntries()`, the initial history is limited to the active session's compaction-aware context, not even necessarily every user entry in that session.
   - Live editor submissions are added at seven direct `this.editor.addToHistory?.(...)` call sites; they are enumerated in step 5.
   - Extensions can replace the editor before initial messages render. `setCustomEditorComponent()` (line 2364) currently transfers text, callbacks, appearance, autocomplete, and app actions, but not history.
   - Session replacement and `/reload` rebuild the editor and transcript through `rebindCurrentSession()` (line 1732) and `resetExtensionUI()` (line 1958).

3. `packages/coding-agent/src/core/settings-manager.ts`
   - There is no prompt-history setting. `Settings` is at line 83.
   - Nested settings already merge at one level through `deepMergeSettings()` (line 131).
   - UI settings use typed getters/setters and are surfaced through `/settings`.
   - `markModified(field: keyof Settings, nestedKey?: string)` (line 513) already supports per-nested-key dirty tracking, and `markProjectModified()` (line 524) mirrors it for project scope. `setCompactionEnabled()` (line 764) is the reference pattern for a nested setter: lazily create the nested object on `globalSettings`, assign only the one child key, `markModified(field, nestedKey)`, then `save()`.

4. `packages/coding-agent/src/core/session-manager.ts`
   - `SessionManager.list(cwd, sessionDir?)` (line 1632) finds same-working-directory sessions for both the default per-project directory and a custom flat session directory. It filters with `sessionCwdMatches()` (line 630) and builds records through `buildSessionInfo()` (line 687), which already streams with `createReadStream` + `readline`.
   - `SessionManager.open()` (line 1524) is not appropriate for history discovery: it routes into `_setSessionFile()` (line 895), which calls `loadEntriesFromFile()` and then `this._rewriteFile()` whenever `migrateToCurrentVersion(this.fileEntries)` returns true. Opening an old session therefore **can rewrite the file on disk**. History discovery must be read-only.
   - `SessionManager` exposes the public accessors the controller needs: `isPersisted()` (line 991), `getSessionDir()` (line 999), and `getSessionFile()` (line 1011). No new accessor is required for the `--no-session` check.
   - Session JSONL files are append-only trees. Reading every `message` entry captures prompts from all branches, which is desirable for “every message sent in this folder.” Compaction does not remove those original entries.

5. Existing third-party extensions work around this limitation but still inherit the TUI's hard cap of 100. The core implementation must not depend on or duplicate an extension.

## Product semantics

Add a nested setting:

```ts
export interface PromptHistorySettings {
  scope?: "session" | "project";
  maxEntries?: number;
}
```

Defaults and validation:

- `scope` defaults to `"session"` for backward compatibility.
- `maxEntries` defaults to `100`.
- `maxEntries: 0` means unlimited.
- Positive values are floored to integers.
- Negative, non-finite, and otherwise invalid values fall back to `100` rather than disabling history or crashing startup.
- Project settings may override either nested key independently of global settings.

Scope behavior:

- `session`: preserve current product behavior as closely as possible. Seed history from the current session's compaction-aware active context, then add new submitted editor input in memory.
- `project`: seed history from all persisted user `message` entries in every valid session whose header `cwd` resolves to the current working directory. Include all branches and entries hidden from current LLM context by compaction.
- In both scopes, the newest prompt appears on the first Up press.
- Preserve repeated prompts unless they are consecutive after chronological sorting, matching the current `Editor.addToHistory()` behavior.
- Include string user content and concatenate all text blocks from array content. Ignore image-only messages.
- Do not include assistant messages, tool results, extension custom messages, branch summaries, or compaction summaries.
- Cross-session recovery is based on persisted user messages. Slash-only commands and direct `!`/`!!` bash submissions that did not become user-message entries remain available during the live session but are not reconstructed from old sessions. Persisting a separate raw-input log is deliberately out of scope for this patch.
- `--no-session` remains ephemeral. Do not scan or persist project-wide history when the active `SessionManager` is not persisted; use session-local in-memory history only.

Limit behavior:

- Apply the configured limit after merging and chronologically sorting the selected scope.
- A finite limit keeps the newest N prompts.
- Unlimited mode may consume memory and increase startup time in projects with very large histories. Document this explicitly.
- The setting never deletes, truncates, migrates, or rewrites session files.

## Architecture

Separate the work into three layers:

1. **TUI history API**: make the existing editor history configurable and bulk-loadable while retaining native navigation behavior.
2. **Read-only prompt-history discovery**: stream saved session files and return normalized chronological prompt records without opening or mutating sessions.
3. **Interactive history controller**: own the authoritative in-memory list, refresh it on lifecycle changes, apply it to the active editor (including custom editors), and record live submissions.

Do not put filesystem discovery directly into the TUI package. Do not put history-refresh state directly into the 6,000-line `InteractiveMode` beyond a small controller field and delegation methods.

## Detailed implementation steps

### 1. Make TUI editor history configurable and replaceable

Modify:

- `packages/tui/src/components/editor.ts`
- `packages/tui/src/editor-component.ts`
- `packages/tui/test/editor.test.ts`
- `packages/tui/CHANGELOG.md`

In `EditorOptions`, add:

```ts
historyMaxEntries?: number;
```

Add a private normalized limit field initialized to 100. Use one normalization helper so constructor and runtime setter have identical semantics:

- `0` stays `0` and means unlimited.
- finite positive numbers are floored.
- all invalid values become 100.

Add public methods:

```ts
setHistory(entries: readonly string[]): void;
setHistoryMaxEntries(maxEntries: number): void;
```

Use `setHistory`, not repeated external calls to `addToHistory`, as the authoritative bulk-seeding operation. Its contract should be:

- Input order is chronological (oldest to newest).
- Trim each entry and discard empty entries.
- Collapse consecutive duplicate strings only.
- Store internally in the order expected by existing navigation (newest first).
- Apply the current finite limit after normalization.
- Leave the visible buffer exactly as the user left it, per the mid-browse rule below.

**Mid-browse semantics (must be implemented explicitly, not left to the tests).** `navigateHistory()` (line 427) stashes the real draft in `historyDraft` and puts a recalled entry into `state`; `exitHistoryBrowsing()` (line ~470) nulls `historyDraft`. So a naive `setHistory()` that just calls `exitHistoryBrowsing()` while `historyIndex >= 0` leaves a *history entry* on screen, throws the user's draft away, and breaks Down-to-draft. That is a direct violation of acceptance criterion 8. `setHistory()` must therefore:

1. If `historyIndex >= 0` and `historyDraft` is non-null, restore `historyDraft` into `this.state` first (the same restoration `navigateHistory()` performs when it returns to index `-1`), including the `preferredVisualCol` / `snappedFromCursorCol` / `scrollOffset` resets.
2. Then clear `historyIndex` and `historyDraft`.
3. Then swap in the new entries.
4. Do not fire `onChange` and do not push an undo snapshot for the restoration.

If `historyIndex === -1`, steps 1-2 are a no-op and the visible draft is already correct.

Update `addToHistory()` to enforce the configured limit rather than hard-coded 100. When the limit is reduced at runtime, trim the oldest in-memory entries immediately. When changed to zero, retain all currently loaded entries and stop future trimming.

Extend `EditorComponent` with optional methods, in the existing `// History support (optional)` block at `packages/tui/src/editor-component.ts:36-40` next to `addToHistory?()`:

```ts
setHistory?(entries: readonly string[]): void;
setHistoryMaxEntries?(maxEntries: number): void;
```

Keep them optional to avoid breaking third-party custom editors. `CustomEditor` inherits the implementation from `Editor` without extra code.

TUI tests must cover:

- The unchanged default cap of 100.
- A small configured cap supplied through `EditorOptions`.
- `0` retaining and navigating more than 100 entries.
- Reducing a limit trimming the oldest entries immediately.
- Switching from finite to unlimited.
- `setHistory()` order (first Up returns newest).
- Empty and consecutive-duplicate normalization.
- `setHistory()` called while **not** browsing preserves the visible draft.
- `setHistory()` called **mid-browse** (after one or more Up presses) restores the stashed draft to the buffer, resets the browse index, and leaves Down-to-draft working against the new list.
- Existing multiline cursor, Down-to-draft, and undo tests remaining green.

Add a TUI changelog entry under `[Unreleased]` stating that editor history now supports configurable limits and bulk replacement. Do not create duplicate subsection headings.

### 2. Add typed settings and validation

Modify:

- `packages/coding-agent/src/core/settings-manager.ts`
- `packages/coding-agent/src/index.ts`
- `packages/coding-agent/test/settings-manager.test.ts`

Add and export `PromptHistorySettings`, then add `promptHistory?: PromptHistorySettings` to `Settings`.

Add getters:

```ts
getPromptHistoryScope(): "session" | "project";
getPromptHistoryMaxEntries(): number;
getPromptHistorySettings(): { scope: "session" | "project"; maxEntries: number };
```

Add setters used by `/settings`:

```ts
setPromptHistoryScope(scope: "session" | "project"): void;
setPromptHistoryMaxEntries(maxEntries: number): void;
```

The setters must update only their nested key, call `markModified("promptHistory", nestedKey)` (the two-argument overload exists; see `setCompactionEnabled()` at settings-manager.ts:764), and use the existing save queue. Do not overwrite the sibling nested key. Use the same normalization semantics as the TUI, preferably through a small coding-agent helper rather than importing a private TUI helper.

Export `PromptHistorySettings` from `packages/coding-agent/src/index.ts` in the existing `from "./core/settings-manager.ts"` re-export block (around lines 249-257), keeping the block's alphabetical order (it belongs between `type PackageSource` and `type RetrySettings`).

Note that `packages/coding-agent/test/settings-manager-bug.test.ts` also exists alongside `settings-manager.test.ts`; check it for nested-merge regressions before assuming a merge bug is new.

Settings tests must cover:

- Defaults (`session`, 100).
- Explicit `project` and `0`.
- Positive fractional input flooring.
- Invalid scope fallback.
- Negative/non-finite/invalid maximum fallback.
- Global nested settings merged with a project override of only one child key.
- Each setter preserving the sibling key and unrelated externally added settings.

### 3. Implement a read-only project prompt collector

Create:

- `packages/coding-agent/src/core/prompt-history.ts`
- `packages/coding-agent/test/prompt-history.test.ts`

Keep this module independent from `InteractiveMode` and UI types.

Suggested internal types:

```ts
export interface PromptHistoryRecord {
  text: string;
  timestamp: number;
  sessionPath: string;
  ordinal: number;
}

export interface LoadProjectPromptHistoryOptions {
  cwd: string;
  sessionDir: string;
  excludeSessionFile?: string;
  currentEntries?: readonly SessionEntry[];
  maxEntries: number;
}
```

The public result may be `Promise<string[]>` if records are only needed internally, but keep records during collection so ordering is deterministic and testable.

Collector requirements:

1. Resolve `cwd` once using the existing path utility.
2. Read immediate `*.jsonl` files from `sessionDir`; ignore nested directories and non-JSONL files.

   **Never call `getDefaultSessionDir()` (session-manager.ts:483) to derive the directory.** It `mkdirSync`s the path as a side effect, which would create directories during a load this plan promises is read-only. Use the caller-supplied directory (`SessionManager.getSessionDir()`, which is already normalized in the constructor at line 877 and is *not* created when `persist` is false), or `getDefaultSessionDirPath()` semantics if a path must be recomputed.
3. Stream each file with `createReadStream` plus `readline`, as `buildSessionInfo()` (line 687) does. Do not use `readFileSync`, `loadEntriesFromFile()`, or `SessionManager.open()` for old sessions.
4. Parse each line independently and skip malformed lines. `parseSessionEntryLine()` (session-manager.ts:503) already does exactly this — blank-line skip plus `try/JSON.parse/return null` — and `buildSessionInfo()` uses it per line. It is currently module-private; export it (`/** Exported for testing */`-style, matching `loadEntriesFromFile`) and reuse it rather than writing a second JSON-parse-and-swallow helper.
5. Treat the first valid parsed entry as the required session header. Reject files without a valid `type: "session"` header.
6. Resolve and compare the header `cwd` to the requested cwd even when the default directory is already project-specific. This is required for custom flat session directories and protects against misplaced files.
7. For each `type: "message"`, accept only `message.role === "user"` and extract textual content.

   **Join text blocks with the empty string, not a space.** Two different extractors exist and they disagree: `InteractiveMode.getUserMessageText()` (interactive-mode.ts:3169) does `.join("")` and is what feeds editor history today; `extractTextContent()` (session-manager.ts:661) does `.join(" ")` and feeds `SessionInfo` previews. The collector must match `getUserMessageText()` exactly (`""`), so a multi-block prompt recalled from an old session is byte-identical to the same prompt recalled from the live session. Do not reuse `extractTextContent()`.
8. Derive ordering time from finite `message.timestamp`, then parse the entry ISO timestamp, then parse the session header timestamp, with file ordinal as the final deterministic tie-breaker.
9. Skip `excludeSessionFile` and merge `currentEntries` separately. This prevents duplicates while including an unflushed current session.
10. For `currentEntries`, project scope uses every raw message entry (all branches), not `buildContextEntries()`.
11. Sort oldest to newest by timestamp, then normalized session path, then per-file ordinal.
12. Collapse only consecutive duplicate text after sorting.
13. Apply the finite limit once at the end; zero means no slice.
14. Bound concurrent file scans so thousands of sessions do not exhaust file descriptors. `buildSessionInfosWithConcurrency()` (session-manager.ts:771) already encodes this pattern for the same directory and the same file type; mirror it (or lift its limit into a shared constant) instead of inventing a second scheduler.
15. Missing directories, unreadable files, and malformed sessions are skipped. One bad historical file must not prevent Pi startup.
16. The collector must not write anything. Add a test that snapshots file contents and modification times before and after loading.

Do not extend `SessionInfo` with all user messages. That would increase the memory cost of every `/resume` listing and duplicate a separate concern.

Collector tests must construct real temporary JSONL files and cover:

- Multiple sessions sorted chronologically.
- Default per-project and custom flat-directory layouts.
- Same custom directory containing a different cwd (must be excluded).
- String content, multiple text blocks, and image-only messages.
- Multiple text blocks joined with `""`, asserted against the exact string `getUserMessageText()` would produce for the same message.
- All branches included regardless of active leaf.
- Entries older than compaction boundaries included.
- Current unflushed entries merged while current file is excluded.
- Consecutive duplicates collapsed; non-consecutive repeats preserved.
- Finite newest-N and unlimited (>100) results.
- Malformed lines, invalid headers, unreadable/missing directories.
- Stable ordering when timestamps tie or are invalid.
- No mutation or migration of source files.

### 4. Add an interactive prompt-history controller

Create:

- `packages/coding-agent/src/modes/interactive/prompt-history-controller.ts`
- `packages/coding-agent/test/interactive-prompt-history.test.ts`

The controller exists to keep lifecycle, stale-load protection, and custom-editor behavior testable without constructing the full TUI.

Suggested responsibilities:

```ts
class PromptHistoryController {
  refresh(...): Promise<void>;
  applyToEditor(editor: EditorComponent): void;
  record(text: string, editor: EditorComponent): void;
  setEditor(editor: EditorComponent): void;
}
```

Maintain history internally in chronological order. `record()` must:

- Trim and ignore empty input.
- Collapse only a consecutive duplicate.
- Apply the configured finite limit to the cache.
- Call the active editor's `addToHistory()` for immediate native behavior.

`applyToEditor()` must:

1. Call `setHistoryMaxEntries()` when supported.
2. Call `setHistory()` with the authoritative chronological cache when supported.
3. For a newly created legacy custom editor that implements only `addToHistory()`, replay entries oldest to newest as a best-effort fallback.
4. Never replace or wrap an extension's editor implementation.

`refresh()` behavior:

- Read current settings on every refresh.
- For `session` scope, build from the current session's compaction-aware context so the default remains backward compatible.
- For `project` scope on a persisted session, call the new collector with the session manager's effective directory, current session path, and current raw entries.
- For an in-memory (`--no-session`) session, force session-local behavior even when settings say project.
- Preserve any draft currently in the editor. Bulk history application must not call `setText()`.
- Use a monotonically increasing generation/token so a slower refresh for an old cwd or old settings cannot overwrite a newer session after `/resume`, `/new`, `/fork`, or rapid settings changes.

**The generation token guards refresh-versus-refresh only. It does not guard refresh-versus-record, and that race loses user input.** Concrete failure: the user changes a value in `/settings`, which fires an asynchronous refresh (step 6); the overlay closes while the project scan is still in I/O; the user types a prompt and submits it; `record()` appends it to the cache and calls `editor.addToHistory()`; the collector then resolves and `refresh()` assigns the collected array over the cache and calls `setHistory()`. The just-submitted prompt is now gone from both the cache and the editor, and pressing Up will never surface it again in this session. **Startup is not immune.** `async init()` (line 679) wires the submit handler at line 723 via `setupEditorSubmitHandler()`, and only afterwards awaits `rebindCurrentSession()` at line 794 — both inside the same method, with no boundary between them. Input submitted in that window is accepted and parked in `pendingUserInputs` (line 344, drained at 3501); that is exactly the behavior `test/interactive-mode-startup-input.test.ts` exists to protect. So a prompt submitted during the awaited startup refresh calls `record()` and is then clobbered when the refresh resolves, identically to the `/settings` case. Treat the race as applying to **every** refresh.

Pick one of these and state it in the controller's doc comment:

- **Merge on completion (preferred).** Snapshot the cache length (or keep a separate `recordedSinceLoad` buffer) when the load starts. When it resolves, append the entries recorded during the load to the freshly collected list, re-apply consecutive-duplicate collapsing and the limit, then publish.
- **Invalidate on record.** Have `record()` bump the same generation counter, so an in-flight load's result is discarded and a fresh refresh is scheduled. Simpler, but it throws away completed I/O and can starve under fast typing, so only choose it with a debounce.

Either way, a prompt submitted at any point during an in-flight refresh must be present in the cache and reachable with one Up press once the refresh settles.
- Treat discovery failures as non-fatal and retain at least the current session history. Return a warning/result that `InteractiveMode` can surface once rather than throwing out of startup.

Controller tests must cover:

- Session and project scopes.
- Finite and unlimited application.
- Live recording after initial seed.
- Draft preservation.
- Modern custom editor (`setHistory`) and legacy custom editor (`addToHistory` only).
- Stale async refresh ignored after a newer refresh starts.
- A prompt recorded while a refresh is in flight survives the refresh completing (the race above), asserted on both the cache and the `setHistory()` payload.
- `setHistory()` is not called with a list that drops a recorded entry, even when the collector returns a full unlimited result.
- `--no-session` fallback.
- Loader failure falling back to current-session history.

### 5. Integrate the controller into `InteractiveMode`

Modify:

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `packages/coding-agent/test/interactive-mode-startup-input.test.ts`
- `packages/coding-agent/test/suite/regressions/4167-thinking-toggle-pending-tool-render.test.ts`

That last file was missing from earlier drafts of this list. It declares `populateHistory` in three structural mock types (lines 33, 52, 59) that mirror `renderSessionItems()`, `addMessageToChat()`, and `renderSessionEntries()`. It obtains each function through an `as unknown as { ... }` cast on `InteractiveMode.prototype` (lines 82, 148, 150, 171), so no structural comparison against the real signatures happens at all and `tsgo --noEmit` will **not** fail on the removal. That makes it cleanup, not a blocker — but it also means the mocks silently stop describing reality, which is the reason to fix them in the same commit rather than later.

Integration details:

1. Construct the controller after `defaultEditor` is created, using `settingsManager`, the current `SessionManager`, and the collector dependency. Keep dependency injection available in the controller tests.
2. Add one `recordPromptHistory(text)` helper and replace every direct `this.editor.addToHistory?.(text)` call used for accepted editor input. At revision `1580da4f` there are exactly seven such live-submission call sites in `interactive-mode.ts`. Re-grep to confirm, since the file is 6,037 lines and shifts easily:

   | Line | Context |
   | --- | --- |
   | 2789 | `!`/`!!` bash submission, after the "bash already running" guard |
   | 2800 | extension command submitted while `session.isCompacting` |
   | 2812 | submission while `session.isStreaming` (steer) |
   | 2829 | normal submission via the `onInputCallback` / `pendingUserInputs` path |
   | 3724 | `handleFollowUp()`, extension command while compacting |
   | 3736 | `handleFollowUp()`, Alt+Enter while streaming (follow-up) |
   | 4000 | `queueCompactionMessage()` |

   The eighth occurrence, line 3304 inside `addMessageToChat()`, is transcript-render population, not a live submission, so it is removed by item 4 below rather than routed through `recordPromptHistory()`.

3. Do not record programmatically injected user messages, assistant messages, or transcript rebuilds as new live submissions.
4. Remove history population from rendering:
   - Remove the `populateHistory` option from `addMessageToChat()` (declaration line 3226, use line 3303-3304), `renderSessionItems()` (line 3332), `renderSessionEntries()` (doc comment line 3419, declaration line 3423), and the `populateHistory: true` argument in `renderInitialMessages()` (line 3467).
   - Rendering chat and constructing editor history must become independent operations. This prevents compaction/re-render paths from duplicating or truncating history.
   - `AGENTS.md` requires asking before removing functionality that appears intentional. This is the one irreversible behavior removal in the whole change, so it needs explicit sign-off rather than being folded in silently. Approving this plan is that sign-off.
5. Refresh history during `rebindCurrentSession()` after runtime settings are applied and before or immediately after extension binding. Whichever ordering is chosen, guarantee that the final active editor receives the refreshed cache.
6. In `setCustomEditorComponent()`, apply the controller cache to every newly created custom editor after wiring callbacks/settings and before focus is moved. When restoring `defaultEditor`, reapply the same cache.
7. In `applyRuntimeSettings()`, apply both the maximum and current history cache to default and active editors as appropriate.
8. `/reload` must refresh after `settingsManager.reload()` and after extension editor replacement, without losing the current draft.
9. Session switches through `/resume`, `/new`, `/fork`, `/clone`, and runtime replacement already converge on rebind hooks; verify each path rather than adding parallel special cases.

   **`/tree` navigation does not converge on a rebind hook and needs an explicit refresh.** The `navigateTree` handler calls `this.renderInitialMessages()` directly at `interactive-mode.ts:1674`, outside `rebindCurrentSession()`. Today that call carries `populateHistory: true` and *appends* the new context's user messages onto the existing editor history (which is why repeated tree navigation currently duplicates entries). After item 4 removes render-coupled population, nothing refreshes history there at all, so session-scope history would silently describe the pre-navigation branch. Add a controller refresh to that handler. Note this is an amendment rather than a regression fix: the current append-with-duplicates behavior is also wrong, just wrong in a different direction.

   Startup needs no extra *hook*: `async init()` (line 679) awaits `rebindCurrentSession()` at line 794 and only then calls `renderInitialMessages()` at line 797, so a refresh placed inside `rebindCurrentSession()` covers startup without depending on the render path. It does still need the step-4 race handling, since the submit handler is already live by then. `renderInitialMessages()` has exactly three call sites at this revision — 797 (startup), 1674 (`navigateTree`), and 1765 (inside `renderCurrentSessionState()`, itself reached only from `rebindCurrentSession({ renderBeforeBind: true })`). Only 1674 needs a dedicated hook.
10. If project-history loading is visibly slow, show a transient status such as `Loading project prompt history...`, but do not add noisy output for normal fast loads. Do not run it as an untracked background promise because Up pressed immediately after startup must see a deterministic result.

Update the existing startup-input unit test mocks to route through `recordPromptHistory` (or the controller) and assert early submitted input is still retained exactly once. Add a second assertion that `"early prompt"` is **still present after a subsequent refresh resolves** — the existing "retained exactly once" check passes even when a later `setHistory()` drops the entry, which is precisely the startup instance of the refresh-versus-record race described in step 4.

### 6. Expose both settings in `/settings`

Modify:

- `packages/coding-agent/src/modes/interactive/components/settings-selector.ts`
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Create `packages/coding-agent/test/settings-selector.test.ts`. Verified: no settings-selector test exists at this revision, so this is a new file rather than an extension.

The selector is structured as `SettingsConfig` (line 52; carries the current values, including the analogous `editorPaddingX` at line 75 and `autocompleteMaxVisible` at line 77), `SettingsCallbacks` (line 85), and an `items` array built inside `SettingsSelectorComponent` (line 472). Simple enumerated settings use a plain `{ id, label, description, currentValue, values }` entry; only richer settings need a `submenu`. Both new entries fit the plain form. Add the two current values to `SettingsConfig`, the two change handlers to `SettingsCallbacks`, and the two items to the array.

Add two UI entries near the other editor options:

- **Prompt history scope**: `id: "prompt-history-scope"`, values `["session", "project"]`.
- **Prompt history max entries**: `id: "prompt-history-max-entries"`, values `["100", "500", "1000", "0"]`.

Important detail for the second entry: `values` strings are both the displayed label and the parsed value, and `currentValue` must compare equal to one of them for cycling to land on the right item. Follow the `image-width-cells` precedent (item at line 633, handler at line 746): set `currentValue: String(config.promptHistoryMaxEntries)` and parse with `parseInt(newValue, 10)` in the `switch` around line 743. Do **not** use a decorated string like `"0 (unlimited)"` as a value, since it will not match `String(0)`. Make zero unambiguous through the item's `description` instead, for example `Max prompts recalled with Up/Down (0 = unlimited)`.

Wire callbacks to the settings setters and trigger an asynchronous controller refresh immediately. Preserve the current draft and show a concise warning if historical loading fails.

Do not make project-wide/unlimited the default. The user's desired setup is enabled explicitly with the JSON shown at the top or through `/settings`.

### 7. Documentation, public types, and changelogs

Modify:

- `packages/coding-agent/docs/settings.md`
- `packages/coding-agent/docs/sessions.md`
- `packages/coding-agent/CHANGELOG.md`
- `packages/tui/CHANGELOG.md`
- `packages/coding-agent/src/index.ts`

Confirmed anchors at this revision: `settings.md` has `## All Settings` (line 24) with a `### UI & Display` subsection (line 50) and a `### Sessions` subsection (line 200), plus `## Example` (line 273) and `## Project Overrides` (line 298). Put the two new keys under `### UI & Display`, the copy-paste block in `## Example`, and the override note in `## Project Overrides`. `sessions.md` has `## Session Storage` (line 5) and `## Session Format` (line 141); place the new “Prompt history” section after `## Session Storage`. Both `CHANGELOG.md` files already have an empty `## [Unreleased]` heading at line 3; append under it, do not create a second one.

`settings.md` must document:

- Both keys, defaults, accepted values, and `0 = unlimited`.
- A copy-paste configuration for project-wide unlimited recall.
- Project settings overriding global nested keys.
- The distinction between editor recall history, saved session transcripts, and LLM context compaction.
- Unlimited startup/memory cost.
- No automatic deletion or rewriting of session files.
- `--no-session` behavior.

`sessions.md` must add a short “Prompt history” section explaining that Up/Down is session-local by default and how to enable same-cwd project history.

Under `packages/coding-agent/CHANGELOG.md` `[Unreleased]`, add an `Added` entry for configurable project-wide prompt history. Under the TUI changelog, add the lower-level editor API change. Preserve all released sections.

### 8. Targeted automated validation

Run modified tests immediately after each layer. Do not run the repository's unsafe full Vitest suite directly (per `AGENTS.md`, it activates e2e tests when endpoint/auth env vars are present).

The two packages use **different test runners**. Do not cross them.

`packages/tui` uses the Node built-in test runner (`"test": "node --test --test-reporter=dot ... test/*.test.ts"`). From `packages/tui`:

```bash
node --test --test-reporter=dot test/editor.test.ts
```

`packages/coding-agent` uses Vitest 4.1.9. From `packages/coding-agent` (adjust the list if files are named differently):

```bash
npx vitest --run \
  test/settings-manager.test.ts \
  test/settings-manager-bug.test.ts \
  test/prompt-history.test.ts \
  test/interactive-prompt-history.test.ts \
  test/interactive-mode-startup-input.test.ts \
  test/settings-selector.test.ts
```

Do **not** use the command printed in `AGENTS.md` line 30, `node ../../node_modules/vitest/dist/cli.js --run …`. That path does not exist at this revision: Vitest is installed at `packages/coding-agent/node_modules/vitest/vitest.mjs` and is not hoisted to the root `node_modules`. The `AGENTS.md` line is stale; `npx vitest --run <files>` from the package root was verified working. `node node_modules/vitest/vitest.mjs --run <files>` is an equivalent explicit form.

Both commands above were executed against this revision and confirmed to run real tests rather than reporting a vacuous pass.

Then run the repository-mandated check from the root:

```bash
npm run check
```

Fix every error, warning, and informational diagnostic. Do not run `npm run build`, `npm test`, or the full Vitest suite unless explicitly requested.

Before declaring completion, run:

```bash
./test.sh
```

This is the repository-approved isolated non-e2e suite. If it is prohibitively slow, report that clearly rather than substituting an unsafe test command.

### 9. Manual interactive smoke test

Use an isolated temporary agent directory and project directory so real user history is untouched. Use cmux for the interactive terminal if available.

Test both finite and unlimited modes:

1. Set `PI_CODING_AGENT_DIR` to a temporary directory. Verified: this is `ENV_AGENT_DIR` (`packages/coding-agent/src/config.ts:495`, derived as `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR` where `APP_NAME` is `"pi"`), and `getAgentDir()` (line 515) honors it ahead of `~/.pi/agent`. `PI_CODING_AGENT_SESSION_DIR` (`ENV_SESSION_DIR`, line 496) is available as a second isolation lever if you also want to force a flat session directory.

   **Confirm the override took effect before generating any data.** Start one throwaway session and check that its JSONL landed under the temporary directory, not under `~/.pi/agent/sessions`. If `APP_NAME` has been rebranded in this checkout, the variable name changes with it, and a silently-ignored variable would point every remaining step at the real user history that steps 6 and 7 then browse and reconfigure.

2. Create at least two persisted sessions in the same project and one session in a different project.
3. Put more than 100 uniquely identifiable user prompts across the same-project sessions.
4. Configure:

   ```json
   {
     "promptHistory": {
       "scope": "project",
       "maxEntries": 0
     }
   }
   ```

5. Start a new session in the first project.
6. Press Up repeatedly and confirm:
   - The newest prior-project prompt appears first.
   - History crosses session boundaries.
   - Entry 101 and older remain reachable.
   - The other project's prompt never appears.
   - Down returns through newer entries and restores the original draft.
   - Multiline prompts preserve native cursor behavior.
7. Change `maxEntries` to a small finite value via `/settings`; confirm older entries become unreachable without any session file changing.
8. Switch scope back to `session`; confirm project prompts disappear and the current draft survives.
9. Test `/reload` and `/resume`; history remains correct and is not duplicated.
10. If a custom `CustomEditor` extension is available, enable it and verify project history still works.
11. Start with `--no-session`; verify project history is not loaded and no history-related files are created.

Record session-file hashes before and after history browsing to prove the feature is read-only:

```bash
find "$PI_CODING_AGENT_DIR/sessions" -type f -name '*.jsonl' -print0 \
  | sort -z \
  | xargs -0 shasum -a 256
```

The hashes may change only for the active session when new messages are actually submitted, never merely from loading or browsing history.

## Performance and reliability requirements

- Default `session/100` startup performance must remain effectively unchanged and must not scan sibling session files.
- Project scope must use streaming reads and bounded concurrency.
- Unlimited mode must avoid quadratic concatenation and repeated full-array copies inside per-line loops.
- A single corrupt or unreadable session must not block startup.
- Old sessions must never be opened through mutating migration paths.
- Rapid session switches must not allow stale async results to pollute the new cwd.
- No new dependency is needed.
- Keep all TypeScript erasable under Node strip-only rules. Do not use `enum`, parameter properties, dynamic imports, inline import types, or `any`.

## Acceptance criteria

The implementation is complete only when all of the following are true:

1. With default settings, Pi retains current session-local history behavior and a 100-entry cap.
2. With `scope: "project"`, a new session can recall persisted user messages from every valid old session with exactly the same resolved cwd.
3. With `maxEntries: 0`, more than 100 prompts are reachable through Up/Down.
4. Finite limits retain only the newest configured number of entries.
5. Browsing or loading history never deletes, truncates, migrates, or rewrites session files.
6. Compacted-away and alternate-branch user entries remain discoverable in project scope.
7. Custom editors derived from `CustomEditor` receive the same history and limits.
8. Draft restoration, multiline navigation, autocomplete, undo, app shortcuts, and live queued-input behavior do not regress. This explicitly includes `setHistory()` arriving mid-browse: the stashed draft comes back, it is not replaced by the recalled entry.
   - A prompt submitted while a history refresh is in flight is still reachable with one Up press after that refresh settles.
   - `/tree` navigation leaves history consistent with the navigated-to branch and does not duplicate entries.
9. Project/global nested settings merge correctly and `/reload` applies changes.
10. Different cwd values never leak prompts into each other, including with a shared custom `sessionDir`.
11. `--no-session` remains ephemeral.
12. Targeted tests, `npm run check`, and `./test.sh` pass.
13. Documentation and both relevant changelogs are updated.

## Suggested implementation order

1. TUI history limit and bulk API plus TUI tests.
2. Settings types/getters/setters plus settings tests.
3. Read-only collector plus filesystem tests.
4. Interactive controller plus lifecycle/custom-editor tests.
5. `InteractiveMode` integration and removal of render-coupled population.
6. `/settings` controls.
7. Documentation and changelogs.
8. Targeted tests, diagnostics, repository check, isolated suite, and manual TUI smoke test.

If the updated upstream code has introduced an equivalent core feature or changed session/editor lifecycle substantially, stop and revise this plan before implementing rather than layering a second history system on top.

## Verification status

Every external fact this plan depends on was checked against `1580da4fe90306b644ef667cc1585610d358c4bb`:

| Claim | Status |
| --- | --- |
| All files listed under "Modify"/"Create" exist (or are correctly marked new) | confirmed |
| `Editor` history hard-capped at 100; `EditorOptions` has only `paddingX` / `autocompleteMaxVisible` | confirmed |
| `EditorComponent` exposes `addToHistory?()` in an optional History block | confirmed |
| `markModified(field, nestedKey?)` two-argument form exists | confirmed |
| `SessionManager.open()` can rewrite the file via `_setSessionFile` → `migrateToCurrentVersion` → `_rewriteFile` | confirmed; the read-only collector is required, not merely preferred |
| `isPersisted()`, `getSessionDir()`, `getSessionFile()` are public | confirmed; no new accessor needed for `--no-session` |
| Seven live `addToHistory` call sites + one render-path call site | confirmed and enumerated in step 5 |
| `packages/tui` runs `node --test`, `packages/coding-agent` runs Vitest 4.1.9 | confirmed, both commands executed |
| `AGENTS.md` line 30's Vitest path (`../../node_modules/vitest/dist/cli.js`) | **stale; that path does not exist.** Corrected in step 8 |
| `npm run check` and `./test.sh` exist at repo root | confirmed |
| No settings-selector test exists yet | confirmed; step 6 creates one |
| Selector `values` strings are compared against `currentValue` and parsed in a `switch` | confirmed; step 6 records the resulting constraint on the "unlimited" entry |
| `PI_CODING_AGENT_DIR` is the real agent-directory override used by step 9's isolation | confirmed by reading `ENV_AGENT_DIR` / `getAgentDir()` and by executing the override |

Nothing in the design was changed by this verification. The one correction that would have caused a silent failure is the Vitest invocation.

## Second review pass

A later review re-checked every anchor above against the same revision `1580da4f` and found them all still accurate, then added the following. The first four are behavioral corrections: implementing the plan without them ships two real bugs and two silent inconsistencies.

| # | Finding | Where it is now written down |
| --- | --- | --- |
| 1 | Refresh-versus-record race drops a prompt submitted during an in-flight project scan. The generation token only guards refresh-versus-refresh. Applies to startup too, not just `/settings`: the submit handler is wired at line 723 and the startup refresh is awaited at line 794, both inside `init()`. | Step 4, `refresh()` behavior; step 5's startup-input test note |
| 2 | `setHistory()` calling `exitHistoryBrowsing()` mid-browse discards the stashed draft and leaves a recalled entry on screen, violating acceptance criterion 8. The earlier test bullet ("preserve the draft *and* reset the browse index") was unsatisfiable as stated. | Step 1, "Mid-browse semantics" |
| 3 | `navigateTree` calls `renderInitialMessages()` directly at line 1674, outside any rebind hook, so it loses its history refresh once render-coupled population is removed. | Step 5 item 9 |
| 4 | Two disagreeing text extractors exist (`getUserMessageText()` joins with `""`, `extractTextContent()` joins with `" "`). The collector must match the former. | Step 3 item 7 |
| 5 | `test/suite/regressions/4167-thinking-toggle-pending-tool-render.test.ts` declares `populateHistory` in three mock types, but reaches the real functions through `as unknown as` prototype casts, so nothing type-checks against them and `tsgo --noEmit` still passes. Cleanup, not a blocker. | Step 5, "Modify" list |
| 6 | `getDefaultSessionDir()` `mkdirSync`s as a side effect; using it in the collector would create directories during a read-only load and violate the `--no-session` requirement. | Step 3 item 2 |
| 7 | `parseSessionEntryLine()` (line 503) and `buildSessionInfosWithConcurrency()` (line 771) already implement the malformed-line skipping and bounded concurrency the collector needs. Reuse rather than reimplement. | Step 3 items 4 and 14 |
| 8 | Startup needs no extra refresh *hook*: line 794 awaits `rebindCurrentSession()` before line 797's `renderInitialMessages()`, and `renderInitialMessages()` has exactly three call sites. It does need the finding-1 race handling. | Step 5 item 9 |
| 9 | Removing `populateHistory` is the only irreversible behavior removal here and needs explicit sign-off under `AGENTS.md`. | Step 5 item 4 |

With those amendments folded in, the plan is safe and sound to implement as written.
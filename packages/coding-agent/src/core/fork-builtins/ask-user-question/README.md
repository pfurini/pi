# ask_user_question (fork-owned base tool)

This module gives the model the `ask_user_question` tool, a structured questionnaire with typed options. `AgentSession` registers the tool as a base tool next to `read`, so no extension loader or custom `ResourceLoader` can drop it. The tool stays active when no UI is attached; a call without a UI returns the `no_ui` result. The fork owns the code and takes no upstream sync. The plan `docs/plans/ask-user-question-base-tool.plan.md` records the move, and ADR-0009 records the decision.

## Origin and licence

The code started as rpiv-ask-user-question 2.11.0 (`github.com/juicesharp/rpiv-mono`, path `packages/rpiv-ask-user-question`). The port took it from the fork `pfurini/rpiv-mono`, branch `personal`, at commit `8403bb09`. The licence is MIT; `LICENSE` in this directory holds the notice.

The move to a base tool changed the following:

| Upstream behavior | This module |
| --- | --- |
| An extension loaded through jiti, with a lazy import and a 2 s prewarm timer | A static import in `AgentSession` |
| Error paths `session_load_failed` and `stale_module_cache` | Removed, because a static import cannot hit jiti's module cache |
| A reconciler that hid the tool without a UI | Removed; nothing hides the tool |
| Locales and the `rpiv-i18n` bridge | Removed; the texts are English literals |
| The `collapseKey` setting | Replaced by six Pi keybinding ids |
| Events on `pi.events` | The same events on the resource loader's event bus |

## Registration

`base-tool.ts` holds the two call sites that `agent-session.ts` uses. `addAskUserQuestionBaseTool` registers the definition, and `askUserQuestionDefaultActive` makes it active by default.

The tool is absent or inactive in these cases:

| Case | Effect |
| --- | --- |
| `PI_FORK_BUILTINS=off` | The tool is not registered. |
| A `tools` allowlist (`--tools`) without `ask_user_question` | The tool never enters the session registry. |
| An `excludeTools` list (`--exclude-tools`) naming `ask_user_question` | The tool never enters the session registry. |
| A caller's `baseToolsOverride` | The tool stays registered but inactive, like `skill`. An allowlist or `setActiveToolsByName` can activate it. |
| `--no-builtin-tools`, or a `defaultTools` setting without the name | The tool stays registered but inactive. |
| A caller's base tool named `ask_user_question` | Registration skips; the caller's tool stays. |
| An extension tool named `ask_user_question` | The extension tool overrides the base tool. |

## Behavior without a UI

The tool stays registered and active when the session has no UI. A session nobody watches yet may gain a client later, so hiding the tool would be wrong. A call that finds `ctx.hasUI` false returns the `no_ui` result:

```json
{ "answers": [], "cancelled": true, "error": "no_ui" }
```

The result text tells the model that the UI was not available. Hosts that must avoid the wasted turn exclude the tool through their tool allowlist.

## OpenIntent workers

An OpenIntent worker runs under `runRpcMode()`, which binds a UI context. A call there takes the RPC dialog path below. Today's worker transport refuses every dialog method and fails the connection with `human-question`. An unattended worker therefore excludes `ask_user_question` through its tool allowlist until the D11 question primitive exists. The rpiv built-in behaved the same way before this move.

## Keybindings

The questionnaire keys are Pi app keybindings. `keybindings.ts` in this module defines them, and `core/keybindings.ts` spreads them into `KEYBINDINGS`.

| Keybinding id | Default | Action |
| --- | --- | --- |
| `app.askUserQuestion.collapse` | `ctrl+]` | Collapse or expand the questionnaire |
| `app.askUserQuestion.setAside` | `a` | Show the set-aside alternatives |
| `app.askUserQuestion.nextTab` | `tab`, `right` | Next questionnaire tab |
| `app.askUserQuestion.previousTab` | `shift+tab`, `left` | Previous questionnaire tab |
| `app.askUserQuestion.notes` | `n` | Add notes to an answer |
| `app.askUserQuestion.toggle` | `space` | Toggle a multi-select option |

Rebind a key in `<agent-dir>/keybindings.json`, which defaults to `~/.pi/agent/keybindings.json`. An empty list disables the action and drops its hint. An empty collapse binding turns collapsing off.

```json
{
  "app.askUserQuestion.notes": "m",
  "app.askUserQuestion.collapse": []
}
```

Hints show the first bound key. Upstream swapped the set-aside key to `ctrl+a` when the collapse key was `a`; this module does not. A user who binds collapse to `a` also rebinds `app.askUserQuestion.setAside`.

## Settings

The module reads `forkBuiltins["ask-user-question"]` from `settings.json` in the session agent directory. Only `guidance` is configurable. The module never reads a project's `.pi/settings.json`, and it writes no file.

| Field | Type | Replaces |
| --- | --- | --- |
| `description` | non-empty string | The tool description the model sees |
| `promptSnippet` | non-empty string | The one-line entry in the system prompt's tool list |
| `promptGuidelines` | non-empty array of non-empty strings | The guideline bullets in the system prompt |

A missing or invalid field keeps the built-in default. A missing, unreadable or malformed file keeps every default.

```json
{
  "forkBuiltins": {
    "ask-user-question": {
      "guidance": {
        "promptSnippet": "Ask the user structured questions when requirements are ambiguous",
        "promptGuidelines": ["Group all clarifying questions into one call."]
      }
    }
  }
}
```

## Events

The tool emits two channels on the resource loader's event bus, the bus extensions reach as `pi.events`. `events.ts` defines the contract: channel names never change, and payloads only gain optional fields.

| Channel | When | Payload |
| --- | --- | --- |
| `rpiv:ask-user:prompt` | After validation, before any dialog | `questions`: each has `question`, `header`, `multiSelect`, `options` and an optional `setAside` (`label`, `reason`). Each option has `label`, `description` and `hasPreview`. |
| `rpiv:ask-user:blocked` | When input starts to be awaited, and again when the wait ends | `active`: `true` while input is awaited, `false` after an answer, a cancel or an error |

A call without a UI emits neither event.

## RPC dialog fallback

RPC hosts (the VS Code pendant, ACP clients such as Zed or Paseo) cannot render `ui.custom()`. They do implement the `select` and `input` dialogs. In RPC mode, `rpc-fallback.ts` walks the questions one dialog at a time and returns the same result shape as the TUI.

The fallback has these limits:
- Previews fold into the select title, truncated to 600 characters.
- Each question gets its own dialog; there is no tabbed review.
- A multi-select question takes comma-separated option numbers in an input dialog. Any other text counts as a custom answer.
- Dismissing any dialog cancels the questionnaire.

Outside RPC mode, a `ui.custom()` that returns `undefined` also falls back to the dialogs when the host has them. Otherwise the result is `no_custom_ui`.

## Upstream fixes

The module takes no automatic sync, and it has no `UPSTREAM.json`. To bring in an upstream fix, compare `packages/rpiv-ask-user-question` in rpiv-mono after `8403bb09` with this directory, and port the change by hand. The fork `pfurini/rpiv-mono`, branch `personal`, stays the reference. Keep the static imports, the English literals and the keybinding ids.

## Next: the D11 question primitive

A later plan adds the D11 question primitive: `timeout`, `default`, `blocking` and `irreversible` on this tool's question shape, with a question service. It extends `tool/types.ts`, `tool/validate-questionnaire.ts` and `rpc-fallback.ts`, which hold the question types, their validation and the dialog walker. Until then this module has no question mode and no answer channel for headless hosts. The session-control handoff, `/Users/paolof/Developer/ai/_handoffs/2026-09-26-pi-session-control-consolidated.md`, is the authority for D11 (sections 4.7, 9 and 11.1).

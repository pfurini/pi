# Configuration

Every setting the package reads, where the file lives, and what happens when a value is
wrong.

## Where the settings live

In this Pi fork, the settings live in Pi's global settings file, under
`forkBuiltins.rpiv-ask-user-question`:

```
~/.pi/agent/settings.json
```

This replaces upstream's `~/.config/rpiv-ask-user-question/config.json`, which the fork
no longer reads. The fork keeps every built-in's settings in one file that fenced sessions
can already read. `packages/builtins/rpiv-ask-user-question/fork-settings.ts` reads it.

The entry is optional. Without it, every setting takes its default. The package only
reads the file; it never writes it.

A complete example, merged into your existing `settings.json`:

```json
{
  "forkBuiltins": {
    "rpiv-ask-user-question": {
      "collapseKey": "alt+o",
      "guidance": {
        "description": "Ask the user structured questions whenever requirements are ambiguous.",
        "promptSnippet": "Ask me before guessing on anything ambiguous",
        "promptGuidelines": [
          "Batch every clarifying question into one ask_user_question call.",
          "Put your recommended option first and suffix it with (Recommended)."
        ]
      }
    }
  }
}
```

### Which file is read

Only the global file is read: `$PI_CODING_AGENT_DIR/settings.json` when that variable is
set, else `~/.pi/agent/settings.json`. A project's `.pi/settings.json` is never read,
because the guidance text reaches the model's prompt.

### When the entry is invalid

A missing or malformed settings file, or an entry that is not an object, means defaults,
silently. Individual keys with the wrong type also fall back to their default without a
warning.

## Settings

| Setting | What it does | Default |
| --- | --- | --- |
| `collapseKey` | Key that collapses and expands the dialog overlay. | `"ctrl+]"` |
| `guidance.description` | Full text of the tool description the model sees. Replaces the built-in default entirely — no merging. | built-in description |
| `guidance.promptSnippet` | One-line snippet describing the tool in the system prompt. | built-in snippet |
| `guidance.promptGuidelines` | List of usage guidelines given to the model. | 4 built-in guidelines |

### `collapseKey`

The value uses Pi's keybinding id format: zero or more distinct modifiers from `ctrl`,
`shift`, `alt`, `super`, joined by `+`, followed by a base key. Values are trimmed and
lowercased before matching.

The base key is either a single printable character from
`a-z 0-9 _ - ! @ # $ % ^ & * ( ) | ~ \` ' " : ; , . / < > ? [ ] { } = \`, or one of the
named keys `escape`, `esc`, `enter`, `return`, `tab`, `space`, `backspace`, `delete`,
`insert`, `clear`, `home`, `end`, `pageup`, `pagedown`, `up`, `down`, `left`, `right`,
`f1`–`f12`.

Examples that work: `"ctrl+]"`, `"alt+o"`, `"ctrl+shift+h"`, `"f9"`, `"ctrl+}"`.

Set `"off"` (any casing) to disable the collapse shortcut entirely — no raw terminal
listener is registered in that case.

A spec that does not match the grammar is rejected and the default is used. This is
strict on purpose: Pi's parser takes the last `+`-separated part as the key and ignores
unknown parts, so a typo like `"ctr+]"` would otherwise silently capture every bare `]`
keypress at the terminal level.

The footer hint inside the dialog names whatever key you configure (`Alt+O to collapse`
for `"alt+o"`), as do the collapsed one-line footer and the one-shot notification shown
when the dialog is first hidden. With `"off"` the collapse hint is dropped from the
footer entirely, since no shortcut can fire.

### `guidance.description`, `guidance.promptSnippet` and `guidance.promptGuidelines`

`guidance.description` replaces the entire built-in description Pi registers for the
`ask_user_question` tool — the text the model reads when deciding how to use it. There is
no merging: a valid value wins wholesale. It is used only when it is a non-empty string;
anything else falls back to the built-in default. Like the other guidance fields it is read
once, when the extension registers the tool, so changes take effect on the next Pi restart.

These replace the text Pi puts in the system prompt about when to reach for
`ask_user_question`. Use them to make the model ask more or less often, or to enforce a
house style for options.

`promptSnippet` is used only when it is a non-empty string. `promptGuidelines` is used
only when it is a non-empty array whose entries are all non-empty strings. Anything else
falls back to the built-in defaults. Both are read once, when the extension registers the
tool, so changes take effect on the next Pi restart.

## Environment variables

| Variable | Effect |
| --- | --- |
| `PI_CODING_AGENT_DIR` | Pi's own variable. It relocates the settings file, as described above. |

`LANG` and `LC_ALL` influence the dialog language, but they are read by
[`@juicesharp/rpiv-i18n`](https://www.npmjs.com/package/@juicesharp/rpiv-i18n) rather than
by this package — see [localization.md](./localization.md).

No other environment variables are read. The package makes no model calls, so it needs no
API keys or model settings of its own.

# Tool schema

The complete programmatic surface of `ask_user_question`: what the model sends, what
validation rejects, what comes back, and the event other extensions can listen to.

## Parameters

```ts
ask_user_question({
  questions: [
    {
      question: string,            // full question text, ends with "?"
      header: string,              // chip label, max 16 chars
      options: [
        {
          label: string,           // 1-5 words, max 60 chars (+ " (Recommended)", 74 total)
          description: string,     // what the choice means / its trade-off
          preview?: string,        // markdown rendered next to the options
        },
        // … 2-8 options total (capacity, not a target)
      ],
      multiSelect?: boolean,       // default false
      setAside?: Array<{ label: string; reason: string }>, // rejected context, not answers
    },
    // … 1-4 questions total
  ]
})
```

### Limits

| Field | Constraint | Enforced by |
| --- | --- | --- |
| `questions` | 1-4 entries | TypeBox schema + `validateQuestionnaire` |
| `questions[].header` | max 16 characters | TypeBox schema only |
| `questions[].options` | 2-8 entries | TypeBox schema + `validateQuestionnaire` (both bounds) |
| `options[].label` | max 60 characters, plus an optional trailing ` (Recommended)` (hard cap 74) | TypeBox schema only |
| `options[].preview` | single-select questions only | tool description (multi-select tabs render checkbox rows) |
| `questions[].setAside` | Optional array; empty means no disclosure | TypeBox schema + runtime validator |
| `setAside[].label` | Nonblank, max 60 characters | TypeBox schema + runtime validator |
| `setAside[].reason` | Nonblank string | TypeBox schema + runtime validator |

The header and selectable-option label lengths are checked by the parameter schema only.
Both boundaries check the new rejected-alternative fields. Line terminators normalize before runtime validation.
The default guidance tells the model to append ` (Recommended)` to the option it recommends.
The option label cap budgets those 14 characters on top of the 60, so a full-length recommended label validates.
The schema cannot tell the marker apart from other text: any label up to 74 characters passes.
Set-aside labels never carry the marker and keep the 60-character limit.

### Rejected alternatives

Use `setAside` only for alternatives actually considered and rejected under the stated constraints.
Viable choices belong in `options`; eight is a capacity limit, not a requested count.
The tool neither invents choices nor silently truncates an oversized request.
Settled implementation choices need a recorded reason; consent, approval and genuine preferences still require a question.

```json
{
  "setAside": [
    {
      "label": "SDK builtins only",
      "reason": "Excludes the required extension-provided tools."
    }
  ]
}
```

The terminal exposes this context through a read-only disclosure. RPC dialogs include the full text in their titles.
The context never enters the answer envelope or `details.answers`; selecting an option does not approve the model's rejection reasons.

### Reserved option labels

Authoring any of `"Other"`, `"Type something."`, or `"Next"` as an option label is
rejected with `reserved_label`. The last two are the runtime sentinel rows the dialog
appends itself; `"Other"` is reserved because models are conditioned to reach for it.
Reservation is unconditional — a single-select question rejects `"Next"` even though
that row is never appended there.

## Validation errors

Every rejection returns `cancelled: true`, an empty `answers` array, and an `error`
code. The `content[0].text` string is written for the model, not for a log.

| `error` | Cause |
| --- | --- |
| `no_questions` | `questions` was empty |
| `too_many_questions` | more than 4 questions in one call |
| `duplicate_question` | two questions with identical text |
| `empty_options` | a question carried fewer than 2 options |
| `too_many_options` | a question carried more than 8 options; nothing is truncated |
| `invalid_set_aside` | rejected alternatives are malformed, blank, or have a label longer than 60 characters |
| `reserved_label` | an option used a reserved label |
| `duplicate_option_label` | two options in one question share a label |
| `no_ui` | the run has no UI (`ctx.hasUI === false`) |
| `no_custom_ui` | the host cannot render custom UI and exposes no `select`/`input` dialogs |
| `session_load_failed` | the dialog module failed to import (dependencies changed on disk mid-session) |
| `stale_module_cache` | the loader cached a broken module after an earlier failed import; needs a Pi restart |

`reserved_label` short-circuits before `duplicate_option_label`.

## Result

```ts
{
  content: [{ type: "text", text: string }], // envelope prose, or the decline message
  details: {
    answers: Array<{
      questionIndex: number,
      question: string,
      kind: "option" | "custom" | "multi",
      answer: string | null,       // option label, typed text, or null for multi
      selected?: string[],         // chosen labels, multi-select only
      notes?: string,              // free-text note, when you wrote one
      preview?: string,            // echoed back when the chosen option carried a preview
    }>,
    cancelled: boolean,
    globalNote?: string,          // Submit-tab note; present even when cancelled is true
    error?: QuestionnaireError,    // one of the codes above
  }
}
```

### Envelope text

On success the text reads `User has answered your questions: "<question>"="<answer>". …
You can now continue with the user's answers in mind.` A chosen option's `preview` is
appended as `selected preview: <markdown>`, a per-question note as `user notes: <text>`,
and the Submit tab's global note as a trailing `global note: <text>` segment. A global
note alone still yields the answered envelope — it counts as an answer even when every
question is blank.

Cancelling, and any result with neither answer segments nor a global note, both collapse
to the single string `User declined to answer questions` so the model sees one canonical
signal. Partial submission is allowed: unanswered questions simply contribute no segment.
A cancelled result always reads as the decline in text; its note, if any, survives only
in `details.globalNote`.

## Event contract

The package publishes one event on Pi's event bus, emitted after validation passes and
before the dialog is shown. Import it from the `/events` subpath:

```ts
import { ASK_USER_PROMPT_EVENT, type AskUserPromptEventPayload } from "@juicesharp/rpiv-ask-user-question/events";

pi.events.on(ASK_USER_PROMPT_EVENT, (payload: AskUserPromptEventPayload) => {
  // payload.questions[].{ question, header, multiSelect, options[] }
  // payload.questions[].options[].{ label, description, hasPreview }
  // payload.questions[].setAside?.{ label, reason }[] (full normalized text)
});
```

The channel name is `rpiv:ask-user:prompt`. Preview *content* is deliberately not shipped
in the payload — only `hasPreview: boolean` — so listeners forwarding the event across a
process or network boundary stay cheap.
The optional `setAside` field carries full normalized labels and reasons, copied independently from the request.
Legacy calls omit that field. Listeners should present it as model-authored context, never as a user answer.

Stability policy for the `rpiv:*` namespace: channel names are immutable, payload changes
are append-only and always optional, payloads stay JSON-safe, and any breaking change ships
as a new channel (e.g. `rpiv:ask-user:prompt.v2`) rather than a version field.

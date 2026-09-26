/**
 * Fork-owned: the keybindings of the ask_user_question questionnaire. `core/keybindings.ts`
 * spreads them into `KEYBINDINGS`, so users rebind them in `keybindings.json` like any
 * other Pi key. A binding set to `[]` disables its action; an empty collapse binding
 * turns collapsing off.
 */
import type { KeybindingDefinition } from "@earendil-works/pi-tui";

export const ASK_USER_QUESTION_KEYBINDING_IDS = {
	collapse: "app.askUserQuestion.collapse",
	setAside: "app.askUserQuestion.setAside",
	nextTab: "app.askUserQuestion.nextTab",
	previousTab: "app.askUserQuestion.previousTab",
	notes: "app.askUserQuestion.notes",
	toggle: "app.askUserQuestion.toggle",
} as const;

declare module "@earendil-works/pi-tui" {
	interface Keybindings {
		"app.askUserQuestion.collapse": true;
		"app.askUserQuestion.setAside": true;
		"app.askUserQuestion.nextTab": true;
		"app.askUserQuestion.previousTab": true;
		"app.askUserQuestion.notes": true;
		"app.askUserQuestion.toggle": true;
	}
}

export const ASK_USER_QUESTION_KEYBINDINGS = {
	[ASK_USER_QUESTION_KEYBINDING_IDS.collapse]: {
		defaultKeys: "ctrl+]",
		description: "Collapse or expand the questionnaire",
	},
	[ASK_USER_QUESTION_KEYBINDING_IDS.setAside]: {
		defaultKeys: "a",
		description: "Show the questionnaire's set-aside alternatives",
	},
	[ASK_USER_QUESTION_KEYBINDING_IDS.nextTab]: {
		defaultKeys: ["tab", "right"],
		description: "Next questionnaire tab",
	},
	[ASK_USER_QUESTION_KEYBINDING_IDS.previousTab]: {
		defaultKeys: ["shift+tab", "left"],
		description: "Previous questionnaire tab",
	},
	[ASK_USER_QUESTION_KEYBINDING_IDS.notes]: {
		defaultKeys: "n",
		description: "Add notes to a questionnaire answer",
	},
	[ASK_USER_QUESTION_KEYBINDING_IDS.toggle]: {
		defaultKeys: "space",
		description: "Toggle a multi-select option",
	},
} satisfies Record<string, KeybindingDefinition>;

export type QuestionnaireKeyName = keyof typeof ASK_USER_QUESTION_KEYBINDING_IDS;

/** The display text of each questionnaire key, e.g. `Ctrl+]` or `n`; `""` when the action has no key. */
export type QuestionnaireKeyTexts = Record<QuestionnaireKeyName, string>;

/** Hints show the first bound key. A bare character stays as typed; every other part is capitalized. */
function keyText(keys: readonly string[]): string {
	const first = keys[0];
	if (first === undefined) return "";
	if (first.length === 1) return first;
	return first
		.split("+")
		.map((part) => (part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
		.join("+");
}

export function questionnaireKeyTexts(keybindings: {
	getKeys(keybinding: string): readonly string[];
}): QuestionnaireKeyTexts {
	const texts = {} as QuestionnaireKeyTexts;
	for (const [name, id] of Object.entries(ASK_USER_QUESTION_KEYBINDING_IDS) as Array<[QuestionnaireKeyName, string]>) {
		texts[name] = keyText(keybindings.getKeys(id));
	}
	return texts;
}

/** The key texts under the default bindings. Hint constants and tests use them. */
export const DEFAULT_KEY_TEXTS: QuestionnaireKeyTexts = questionnaireKeyTexts({
	getKeys: (id) => {
		const keys = (ASK_USER_QUESTION_KEYBINDINGS as Record<string, { defaultKeys: string | string[] }>)[id]
			?.defaultKeys;
		return keys === undefined ? [] : Array.isArray(keys) ? keys : [keys];
	},
});

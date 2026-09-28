/**
 * Fork-owned: every keybinding the fork's built-ins add (D37). `core/keybindings.ts` spreads
 * `FORK_KEYBINDINGS` into `KEYBINDINGS` through its two fork lines, so a later built-in adds its keys
 * here, with no edit of an upstream-owned file.
 */
import { ASK_USER_QUESTION_KEYBINDINGS } from "./ask-user-question/keybindings.ts";
import { SUBAGENT_KEYBINDINGS } from "./subagents/ui/keybindings.ts";

export const FORK_KEYBINDINGS = {
	...ASK_USER_QUESTION_KEYBINDINGS,
	...SUBAGENT_KEYBINDINGS,
};

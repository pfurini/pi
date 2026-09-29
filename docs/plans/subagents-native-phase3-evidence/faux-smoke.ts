// Scripted faux provider for the phase 3 TUI smoke. It registers provider `smoke` with model `smoke-1`.
// A child (its system prompt holds `<active_agent`) waits 4 s, then answers. A mention clone (its last
// user message holds the reminder) calls Agent. A parent prompt holding `spawn` starts a background
// agent. Everything else gets `smoke reply`.
import {
	fauxAssistantMessage,
	fauxToolCall,
	getCurrentSystemPrompt,
	registerFauxProvider,
} from "@earendil-works/pi-ai/compat";

const textOf = (content) =>
	typeof content === "string" ? content : (content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");

export default function (pi) {
	const faux = registerFauxProvider({ provider: "smoke", models: [{ id: "smoke-1" }] });
	const respond = (context, options) => {
		const messages = context.messages;
		const last = messages.at(-1);
		if (getCurrentSystemPrompt(messages).includes("<active_agent")) {
			return new Promise((resolve) => {
				const timer = setTimeout(() => resolve(fauxAssistantMessage("smoke child done")), 4000);
				options?.signal?.addEventListener("abort", () => {
					clearTimeout(timer);
					resolve(fauxAssistantMessage(""));
				});
			});
		}
		if (last?.role === "user" && textOf(last.content).includes("<system-reminder>")) {
			return fauxAssistantMessage(
				[fauxToolCall("Agent", { subagent_type: "general-purpose", prompt: "smoke clone prompt", description: "smoke clone" })],
				{ stopReason: "toolUse" },
			);
		}
		if (last?.role === "user" && textOf(last.content).includes("spawn")) {
			return fauxAssistantMessage(
				[fauxToolCall("Agent", { subagent_type: "general-purpose", prompt: "smoke background", description: "smoke background", run_in_background: true })],
				{ stopReason: "toolUse" },
			);
		}
		return fauxAssistantMessage(last?.role === "toolResult" ? "spawned" : "smoke reply");
	};
	faux.setResponses(Array.from({ length: 500 }, () => respond));
	const model = faux.getModel();
	pi.registerProvider("smoke", {
		baseUrl: model.baseUrl,
		apiKey: "smoke-key",
		api: faux.api,
		models: faux.models.map((entry) => ({
			id: entry.id,
			name: entry.name,
			api: entry.api,
			reasoning: entry.reasoning,
			input: entry.input,
			cost: entry.cost,
			contextWindow: entry.contextWindow,
			maxTokens: entry.maxTokens,
		})),
	});
}

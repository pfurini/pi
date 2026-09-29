// Scripted faux provider for the phase 4 smoke. It registers provider `smoke` with model `smoke-1`.
// A child (its system prompt holds `<active_agent`) waits 4 s, then answers `smoke child done`.
// The parent prompt `plan work` calls TaskCreate for an agent task, then TaskExecute on task 1.
// `check it` calls TaskOutput on task 1, waits for it, and answers its text on one line. `stopshell now`
// calls TaskStop with only pi-tasks' old `shell_id` parameter, which the native schema rejects.
// Prompts match whole, so a completion notice that mentions a path never reads as a prompt. Everything
// else gets `smoke reply`.
import {
	fauxAssistantMessage,
	fauxToolCall,
	getCurrentSystemPrompt,
	registerFauxProvider,
} from "@earendil-works/pi-ai/compat";

const textOf = (content) =>
	typeof content === "string" ? content : (content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");

const use = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });

export default function (pi) {
	const faux = registerFauxProvider({ provider: "smoke", models: [{ id: "smoke-1" }] });
	const respond = (context, options) => {
		const messages = context.messages;
		if (getCurrentSystemPrompt(messages).includes("<active_agent")) {
			return new Promise((resolve) => {
				const timer = setTimeout(() => resolve(fauxAssistantMessage("smoke child done")), 4000);
				options?.signal?.addEventListener("abort", () => {
					clearTimeout(timer);
					resolve(fauxAssistantMessage(""));
				});
			});
		}
		const users = messages.filter((message) => message.role === "user").map((message) => textOf(message.content));
		const prompt = users.filter((text) => !text.includes("<system-reminder>")).at(-1) ?? "";
		const last = messages.at(-1);
		const results = [];
		for (let i = messages.length - 1; i >= 0 && messages[i].role !== "user"; i--) {
			if (messages[i].role === "toolResult") results.unshift(messages[i]);
		}
		if (prompt === "plan work") {
			if (results.length === 0) {
				return use("TaskCreate", { subject: "smoke task one", description: "survey", agentType: "general-purpose" });
			}
			if (results.length === 1) return use("TaskExecute", { task_ids: ["1"] });
			return fauxAssistantMessage(`executed: ${textOf(last?.content)}`);
		}
		if (prompt === "check it") {
			if (results.length === 0) return use("TaskOutput", { task_id: "1", block: true, timeout: 15000 });
			// One line: the smoke finds the agent's result right after TaskOutput's status.
			return fauxAssistantMessage(`checked: ${textOf(last?.content).replace(/\n+/g, " | ")}`);
		}
		if (prompt === "stopshell now") {
			if (results.length === 0) return use("TaskStop", { shell_id: "1" });
			return fauxAssistantMessage(`stopshell: ${textOf(last?.content)}`);
		}
		return fauxAssistantMessage("smoke reply");
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

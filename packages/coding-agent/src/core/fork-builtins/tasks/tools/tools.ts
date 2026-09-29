/**
 * Fork-owned: the task base tools (D47). pi-tasks `src/index.ts:570-1260` at 83480bd is the
 * behavior reference; the names, parameters and descriptions follow Claude Code's tools. Each tool
 * calls the session's `TaskService`.
 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { AgentSession } from "../../../agent-session.ts";
import type { ToolDefinition } from "../../../extensions/types.ts";
import { TASK_CREATE_TOOL_NAME, TASK_GET_TOOL_NAME, TASK_LIST_TOOL_NAME, TASK_UPDATE_TOOL_NAME } from "../names.ts";
import type { TaskService } from "../service/service.ts";
import { requireTaskService } from "../service/sessions.ts";
import type { Task } from "../store.ts";
import {
	TASK_CREATE_DESCRIPTION,
	TASK_CREATE_GUIDELINES,
	TASK_GET_DESCRIPTION,
	TASK_LIST_DESCRIPTION,
	TASK_UPDATE_DESCRIPTION,
} from "./descriptions.ts";

function textResult(text: string): AgentToolResult<undefined> {
	return { content: [{ type: "text", text }], details: undefined };
}

/** The blockers of a task that are not completed yet. */
function openBlockers(service: TaskService, task: Task): string[] {
	return task.blockedBy.filter((id) => {
		const blocker = service.get(id);
		return blocker && blocker.status !== "completed";
	});
}

const hashes = (ids: readonly string[]): string => ids.map((id) => `#${id}`).join(", ");

const CREATE_PARAMETERS = Type.Object({
	subject: Type.String({ description: "A brief title for the task" }),
	description: Type.String({ description: "A detailed description of what needs to be done" }),
	activeForm: Type.Optional(
		Type.String({ description: "Present continuous form shown in spinner when in_progress (e.g., 'Running tests')" }),
	),
	agentType: Type.Optional(
		Type.String({
			description:
				"Agent type for subagent execution (e.g., 'general-purpose', 'Explore'). Tasks with agentType can be started via TaskExecute.",
		}),
	),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Any(), { description: "Arbitrary metadata to attach to the task" }),
	),
});

const GET_PARAMETERS = Type.Object({
	taskId: Type.String({ description: "The ID of the task to retrieve" }),
});

const UPDATE_PARAMETERS = Type.Object({
	taskId: Type.String({ description: "The ID of the task to update" }),
	status: Type.Optional(
		Type.Unsafe<"pending" | "in_progress" | "completed" | "deleted">({
			type: "string",
			enum: ["pending", "in_progress", "completed", "deleted"],
			description: "New status for the task",
		}),
	),
	subject: Type.Optional(Type.String({ description: "New subject for the task" })),
	description: Type.Optional(Type.String({ description: "New description for the task" })),
	activeForm: Type.Optional(Type.String({ description: "Present continuous form shown in spinner when in_progress" })),
	owner: Type.Optional(Type.String({ description: "New owner for the task" })),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Any(), {
			description: "Metadata keys to merge into the task. Set a key to null to delete it.",
		}),
	),
	addBlocks: Type.Optional(Type.Array(Type.String(), { description: "Task IDs that this task blocks" })),
	addBlockedBy: Type.Optional(Type.Array(Type.String(), { description: "Task IDs that block this task" })),
});

export function createTaskCreateToolDefinition(session: AgentSession): ToolDefinition<typeof CREATE_PARAMETERS> {
	return {
		name: TASK_CREATE_TOOL_NAME,
		label: TASK_CREATE_TOOL_NAME,
		description: TASK_CREATE_DESCRIPTION,
		promptGuidelines: [...TASK_CREATE_GUIDELINES],
		parameters: CREATE_PARAMETERS,
		async execute(_toolCallId, params) {
			const task = requireTaskService(session).create(
				params.subject,
				params.description,
				params.activeForm,
				params.agentType,
				params.metadata,
			);
			return textResult(`Task #${task.id} created successfully: ${task.subject}`);
		},
	};
}

const STATUS_ORDER: Record<string, number> = { pending: 0, in_progress: 1, completed: 2 };

export function createTaskListToolDefinition(session: AgentSession): ToolDefinition {
	return {
		name: TASK_LIST_TOOL_NAME,
		label: TASK_LIST_TOOL_NAME,
		description: TASK_LIST_DESCRIPTION,
		parameters: Type.Object({}),
		async execute() {
			const service = requireTaskService(session);
			const tasks = service.list();
			if (tasks.length === 0) return textResult("No tasks found");
			const sorted = [...tasks].sort(
				(a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || Number(a.id) - Number(b.id),
			);
			const lines = sorted.map((task) => {
				let line = `#${task.id} [${task.status}] ${task.subject}`;
				if (task.owner) line += ` (${task.owner})`;
				const open = openBlockers(service, task);
				if (open.length > 0) line += ` [blocked by ${hashes(open)}]`;
				return line;
			});
			return textResult(lines.join("\n"));
		},
	};
}

export function createTaskGetToolDefinition(session: AgentSession): ToolDefinition<typeof GET_PARAMETERS> {
	return {
		name: TASK_GET_TOOL_NAME,
		label: TASK_GET_TOOL_NAME,
		description: TASK_GET_DESCRIPTION,
		parameters: GET_PARAMETERS,
		async execute(_toolCallId, params) {
			const service = requireTaskService(session);
			const task = service.get(params.taskId);
			if (!task) return textResult("Task not found");
			const lines = [`Task #${task.id}: ${task.subject}`, `Status: ${task.status}`];
			if (task.owner) lines.push(`Owner: ${task.owner}`);
			// A model sometimes double-escapes newlines in its JSON arguments.
			lines.push(`Description: ${task.description.replace(/\\n/g, "\n")}`);
			const open = openBlockers(service, task);
			if (open.length > 0) lines.push(`Blocked by: ${hashes(open)}`);
			if (task.blocks.length > 0) lines.push(`Blocks: ${hashes(task.blocks)}`);
			if (Object.keys(task.metadata).length > 0) lines.push(`Metadata: ${JSON.stringify(task.metadata)}`);
			return textResult(lines.join("\n"));
		},
	};
}

export function createTaskUpdateToolDefinition(session: AgentSession): ToolDefinition<typeof UPDATE_PARAMETERS> {
	return {
		name: TASK_UPDATE_TOOL_NAME,
		label: TASK_UPDATE_TOOL_NAME,
		description: TASK_UPDATE_DESCRIPTION,
		parameters: UPDATE_PARAMETERS,
		async execute(_toolCallId, params) {
			const { taskId, ...fields } = params;
			const { task, changedFields, warnings } = requireTaskService(session).update(taskId, fields);
			if (changedFields.length === 0 && !task) return textResult(`Task #${taskId} not found`);
			let text = `Updated task #${taskId} ${changedFields.join(", ")}`;
			if (warnings.length > 0) text += ` (warning: ${warnings.join("; ")})`;
			return textResult(text);
		},
	};
}

/** Each task tool's name and factory, in registration order. */
export const TASK_TOOL_FACTORIES: ReadonlyArray<readonly [string, (session: AgentSession) => ToolDefinition]> = [
	[TASK_CREATE_TOOL_NAME, createTaskCreateToolDefinition],
	[TASK_LIST_TOOL_NAME, createTaskListToolDefinition],
	[TASK_GET_TOOL_NAME, createTaskGetToolDefinition],
	[TASK_UPDATE_TOOL_NAME, createTaskUpdateToolDefinition],
] as ReadonlyArray<readonly [string, (session: AgentSession) => ToolDefinition]>;

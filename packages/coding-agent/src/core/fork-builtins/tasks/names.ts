/** Fork-owned: the names of the seven task base tools (D46). They keep pi-tasks' Claude Code names. */
export const TASK_CREATE_TOOL_NAME = "TaskCreate";
export const TASK_LIST_TOOL_NAME = "TaskList";
export const TASK_GET_TOOL_NAME = "TaskGet";
export const TASK_UPDATE_TOOL_NAME = "TaskUpdate";
export const TASK_EXECUTE_TOOL_NAME = "TaskExecute";
export const TASK_OUTPUT_TOOL_NAME = "TaskOutput";
export const TASK_STOP_TOOL_NAME = "TaskStop";

/** Every task tool; a call of any of them resets the reminder cadence. */
export const TASK_TOOL_NAMES: ReadonlySet<string> = new Set([
	TASK_CREATE_TOOL_NAME,
	TASK_LIST_TOOL_NAME,
	TASK_GET_TOOL_NAME,
	TASK_UPDATE_TOOL_NAME,
	TASK_EXECUTE_TOOL_NAME,
	TASK_OUTPUT_TOOL_NAME,
	TASK_STOP_TOOL_NAME,
]);

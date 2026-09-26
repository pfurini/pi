/**
 * Types for the tests' fake ExtensionAPI. Each type covers only what the tests read from
 * a registered tool, command or event handler. The fakes are cast to `ExtensionAPI`, so
 * these shapes stay narrow on purpose.
 */

export interface FakeToolResult {
	content: Array<{ type: string; text: string }>;
	details: Record<string, unknown>;
}

export interface FakeTool {
	name: string;
	parameters: unknown;
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: unknown,
	): Promise<FakeToolResult>;
}

export interface FakeCommand {
	handler(args: string, ctx: unknown): Promise<void>;
}

/** What `tool_call` and `before_agent_start` handlers return. */
export interface FakeHandlerResult {
	block?: boolean;
	reason?: string;
	systemPrompt?: string;
}

export type FakeHandler = (event: unknown, ctx: unknown) => Promise<FakeHandlerResult | undefined>;

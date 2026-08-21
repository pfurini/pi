/**
 * Canonical `slash_command` model tool (A.7). Asserts the canonical definition,
 * alias absence, model-visibility filtering, the actionable miss error, the hit
 * render path, and diagnostic forwarding. No provider — the tool is exercised
 * directly.
 */

import { describe, expect, it } from "vitest";
import type { LoadedCommand } from "../../src/core/commands/loader.ts";
import {
	createSlashCommandToolDefinition,
	SLASH_COMMAND_TOOL_NAME,
} from "../../src/core/commands/slash-command-tool.ts";

function command(name: string, opts: Partial<LoadedCommand> = {}): LoadedCommand {
	return {
		kind: "command",
		name,
		frontmatter: {},
		body: "body",
		filePath: `/commands/${name}.md`,
		baseDir: "/commands",
		sourceInfo: { path: `/commands/${name}.md`, source: "local", scope: "user", origin: "top-level" },
		commandNameValid: true,
		userInvocable: true,
		disableModelInvocation: opts.disableModelInvocation ?? false,
		...opts,
	};
}

const noopRender = async () => ({ text: "", diagnostics: [] });

type ExecuteArgs = Parameters<ReturnType<typeof createSlashCommandToolDefinition>["execute"]>;
function runTool(
	def: ReturnType<typeof createSlashCommandToolDefinition>,
	toolCallId: string,
	params: { command: string; args?: string },
) {
	const ctx = {} as ExecuteArgs[4];
	return def.execute(toolCallId, params, undefined, undefined, ctx);
}

describe("slash_command tool", () => {
	it("uses the canonical name and is not the CC alias", () => {
		const def = createSlashCommandToolDefinition({ getCommands: () => [], render: noopRender });
		expect(def.name).toBe("slash_command");
		expect(SLASH_COMMAND_TOOL_NAME).toBe("slash_command");
		expect(def.name).not.toBe("SlashCommand");
	});

	it("renders a model-visible command on hit and returns its text", async () => {
		let renderedArgs: string | undefined;
		const def = createSlashCommandToolDefinition({
			getCommands: () => [command("deploy")],
			render: async (cmd, rawArgs) => {
				expect(cmd.name).toBe("deploy");
				renderedArgs = rawArgs;
				return { text: "RENDERED web", diagnostics: [] };
			},
		});
		const result = await runTool(def, "id-1", { command: "deploy", args: "web" });
		expect(renderedArgs).toBe("web");
		expect(result.content).toEqual([{ type: "text", text: "RENDERED web" }]);
		expect(result.details).toEqual({ command: "deploy" });
	});

	it("throws naming valid alternatives for a hidden command", async () => {
		const def = createSlashCommandToolDefinition({
			getCommands: () => [command("deploy"), command("secret", { disableModelInvocation: true })],
			render: noopRender,
		});
		await expect(runTool(def, "id-2", { command: "secret" })).rejects.toThrow(
			/Unknown or model-hidden command "secret"/,
		);
		await expect(runTool(def, "id-2", { command: "secret" })).rejects.toThrow(/Valid commands: deploy/);
	});

	it("reports when no model-invocable commands exist", async () => {
		const def = createSlashCommandToolDefinition({ getCommands: () => [], render: noopRender });
		await expect(runTool(def, "id-3", { command: "x" })).rejects.toThrow(/No model-invocable commands/);
	});

	it("forwards render diagnostics to the sink", async () => {
		const seen: string[] = [];
		const def = createSlashCommandToolDefinition({
			getCommands: () => [command("deploy")],
			render: async () => ({ text: "ok", diagnostics: [{ type: "warning", message: "watch out" }] }),
			onDiagnostics: (diagnostics) => {
				for (const diagnostic of diagnostics) {
					seen.push(diagnostic.message);
				}
			},
		});
		await runTool(def, "id-4", { command: "deploy" });
		expect(seen).toEqual(["watch out"]);
	});
});

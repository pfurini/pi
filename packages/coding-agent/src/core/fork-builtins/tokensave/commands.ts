// Ported from pi-tokensave (github.com/pfurini/pi-tokensave) commit 2a626d3b, src/commands.ts.
// Copyright (c) 2026 pi-tokensave contributors. MIT licence: see LICENSE in this directory.

/**
 * Slash commands: status, init, sync, mode switch, doctor.
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "../../extensions/types.ts";
import { isProjectInitialized, resolveProjectRoot, resolveTokensaveBinary } from "./project.ts";
import { checkTokensaveAvailable, runTokensaveCommand } from "./runner.ts";
import {
	type TokensaveConfig,
	type TokensaveMode,
	type TokensaveSessionState,
	tokensaveSettingsPath,
} from "./state.ts";

type GetState = () => Pick<TokensaveSessionState, "mode" | "modeSource">;
type SetMode = (mode: TokensaveMode) => void;
type GetConfig = () => TokensaveConfig;

async function handleStatus(ctx: ExtensionCommandContext): Promise<void> {
	const root = resolveProjectRoot(ctx.cwd);
	const available = await checkTokensaveAvailable();
	if (!available) {
		ctx.ui.notify("TokenSave binary not found on PATH.", "error");
		return;
	}
	if (!isProjectInitialized(root)) {
		ctx.ui.notify("TokenSave is not initialized for this project. Run /tokensave-init.", "warning");
		return;
	}
	const result = await runTokensaveCommand(["status", root], root);
	ctx.ui.notify(result.stdout || result.stderr || "No output.", result.ok ? "info" : "error");
}

async function handleInit(ctx: ExtensionCommandContext): Promise<void> {
	const root = resolveProjectRoot(ctx.cwd);
	if (isProjectInitialized(root)) {
		ctx.ui.notify("TokenSave is already initialized for this project.", "info");
		return;
	}
	const confirmed = await ctx.ui.confirm("Initialize TokenSave", `Run 'tokensave init' in ${root}?`);
	if (!confirmed) {
		ctx.ui.notify("Cancelled.", "info");
		return;
	}
	const result = await runTokensaveCommand(["init", root], root);
	ctx.ui.notify(result.stdout || result.stderr || "No output.", result.ok ? "info" : "error");
}

async function handleSync(ctx: ExtensionCommandContext): Promise<void> {
	const root = resolveProjectRoot(ctx.cwd);
	if (!isProjectInitialized(root)) {
		ctx.ui.notify("TokenSave is not initialized. Run /tokensave-init first.", "warning");
		return;
	}
	const result = await runTokensaveCommand(["sync", root, "--doctor"], root);
	ctx.ui.notify(result.stdout || result.stderr || "No output.", result.ok ? "info" : "error");
}

async function handleDoctor(ctx: ExtensionCommandContext, getState: GetState, getConfig: GetConfig): Promise<void> {
	const root = resolveProjectRoot(ctx.cwd);
	const lines: string[] = [];

	const binaryPath = resolveTokensaveBinary();
	const available = await checkTokensaveAvailable();
	lines.push(available ? `✔ Binary found: ${binaryPath}` : `✘ Binary not found: ${binaryPath}`);

	const initialized = isProjectInitialized(root);
	lines.push(
		initialized
			? `✔ Project initialized (${join(root, ".tokensave")})`
			: "✘ Project not initialized. Run /tokensave-init.",
	);

	const state = getState();
	lines.push(`Settings: forkBuiltins["pi-tokensave"] in ${tokensaveSettingsPath(ctx.agentDir)}`);
	lines.push(`Mode: ${state.mode} (source: ${state.modeSource})`);
	lines.push(`autoManageBranches: ${getConfig().autoManageBranches}`);

	ctx.ui.notify(lines.join("\n"), "info");
}

export function registerTokensaveCommands(
	pi: ExtensionAPI,
	getState: GetState,
	setMode: SetMode,
	getConfig: GetConfig,
): void {
	pi.registerCommand("tokensave-status", {
		description: "Show TokenSave binary, project init, and graph status",
		handler: async (_args, ctx) => handleStatus(ctx),
	});

	pi.registerCommand("tokensave-init", {
		description: "Initialize TokenSave for the current project (asks for confirmation)",
		handler: async (_args, ctx) => handleInit(ctx),
	});

	pi.registerCommand("tokensave-sync", {
		description: "Incrementally sync the TokenSave index for the current project",
		handler: async (_args, ctx) => handleSync(ctx),
	});

	pi.registerCommand("tokensave-mode", {
		description: "Show or set the enforcement mode for this session: prefer | enforce",
		getArgumentCompletions: (prefix: string) => {
			const options = ["prefer", "enforce"].filter((option) => option.startsWith(prefix));
			return options.length > 0 ? options.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const value = args.trim();
			if (!value) {
				const state = getState();
				ctx.ui.notify(`Current mode: ${state.mode} (source: ${state.modeSource})`, "info");
				return;
			}
			if (value !== "prefer" && value !== "enforce") {
				ctx.ui.notify("Usage: /tokensave-mode prefer|enforce", "error");
				return;
			}
			setMode(value);
			ctx.ui.notify(
				`pi-tokensave mode set to '${value}' for this session. A new session starts from the settings mode.`,
				"info",
			);
		},
	});

	pi.registerCommand("tokensave-doctor", {
		description: "Diagnose TokenSave binary, project init, settings, and mode",
		handler: async (_args, ctx) => handleDoctor(ctx, getState, getConfig),
	});
}

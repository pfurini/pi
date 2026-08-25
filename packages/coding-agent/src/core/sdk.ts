import { join } from "node:path";
import {
	Agent,
	type AgentMessage,
	type StreamFn,
	setDefaultStreamFn,
	type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { ModelsRequestTransforms, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { clampThinkingLevel, type Message, type Model } from "@earendil-works/pi-ai/compat";
import { getAgentDir } from "../config.ts";
import { resolvePath } from "../utils/paths.ts";
import { AgentSession } from "./agent-session.ts";
import { formatNoModelsAvailableMessage } from "./auth-guidance.ts";
import { composedDefaultStreamFn, type DefaultStreamTarget, installDefaultStreamTarget } from "./default-stream-fn.ts";
import { DEFAULT_THINKING_LEVEL } from "./defaults.ts";
import type { ExtensionRunner, LoadExtensionsResult, SessionStartEvent, ToolDefinition } from "./extensions/index.ts";
import { convertToLlm } from "./messages.ts";
import { findInitialModel } from "./model-resolver.ts";
import { ModelRuntime } from "./model-runtime.ts";
import { mergeProviderAttributionHeaders } from "./provider-attribution.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import { DefaultResourceLoader } from "./resource-loader.ts";
import { getDefaultSessionDir, SessionManager } from "./session-manager.ts";
import { SettingsManager } from "./settings-manager.ts";
import { time } from "./timings.ts";
import {
	createBashTool,
	createCodingTools,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createPowerShellTool,
	createReadOnlyTools,
	createReadTool,
	createWriteTool,
	withFileMutationQueue,
} from "./tools/index.ts";

// Default fallback for extensions that construct Agent instances or invoke low-level
// agent loops without supplying streamFn. The composed default routes served models
// through the session's ModelRuntime once one exists (installed below in
// createAgentSession), so bare Agents get provider composition (extension overlay
// middleware, configured auth) instead of pi-ai's raw compat path. Agent core remains
// provider-agnostic and does not import pi-ai/compat itself.
setDefaultStreamFn(composedDefaultStreamFn);

export interface CreateAgentSessionOptions {
	/** Working directory for project-local discovery. Default: process.cwd() */
	cwd?: string;
	/** Global config directory. Default: ~/.pi/agent */
	agentDir?: string;

	/** Canonical model/auth runtime. Defaults to a runtime using agentDir/auth.json and models.json. */
	modelRuntime?: ModelRuntime;

	/** Model to use. Default: from settings, else first available */
	model?: Model<any>;
	/** Thinking level. Default: from settings, else 'medium' (clamped to model capabilities) */
	thinkingLevel?: ThinkingLevel;
	/** Models available for cycling (Ctrl+P in interactive mode) */
	scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;

	/**
	 * Optional default tool suppression mode when no explicit allowlist is provided.
	 *
	 * - "all": start with no tools enabled
	 * - "builtin": disable the default built-in tools (read, bash, edit, write)
	 *   but keep extension/custom tools enabled
	 */
	noTools?: "all" | "builtin";
	/**
	 * Optional allowlist of tool names.
	 *
	 * When omitted, pi uses the `defaultTools` setting for the initial built-in
	 * selection when configured. Otherwise it enables the default built-in tools
	 * (read, bash, edit, write) — plus the `skill` / `slash_command` tools when a
	 * model-visible skill or command exists. Extension/custom tools remain enabled
	 * unless `noTools` changes that default. When provided, only the listed tool
	 * names are enabled.
	 */
	tools?: string[];
	/** Optional denylist of tool names to disable. Applies after `tools` when both are provided. */
	excludeTools?: string[];
	/** Custom tools to register (in addition to built-in tools). */
	customTools?: ToolDefinition[];

	/** Resource loader. When omitted, DefaultResourceLoader is used. */
	resourceLoader?: ResourceLoader;

	/** Session manager. Default: SessionManager.create(cwd) */
	sessionManager?: SessionManager;

	/** Settings manager. Default: SettingsManager.create(cwd, agentDir) */
	settingsManager?: SettingsManager;
	/** Session start event metadata for extension runtime startup. */
	sessionStartEvent?: SessionStartEvent;
}

/** Result from createAgentSession */
export interface CreateAgentSessionResult {
	/** The created session */
	session: AgentSession;
	/** Extensions result (for UI context setup in interactive mode) */
	extensionsResult: LoadExtensionsResult;
	/** Warning if session was restored with a different model than saved */
	modelFallbackMessage?: string;
}

// Re-exports

export * from "./agent-session-runtime.ts";
export type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionFactory,
	InlineExtension,
	SlashCommandInfo,
	SlashCommandSource,
	ToolDefinition,
} from "./extensions/index.ts";
export type { PromptTemplate } from "./prompt-templates.ts";
export type { Skill } from "./skills.ts";
export type { Tool } from "./tools/index.ts";

export {
	withFileMutationQueue,
	// Tool factories (for custom cwd)
	createCodingTools,
	createReadOnlyTools,
	createReadTool,
	createBashTool,
	createEditTool,
	createWriteTool,
	createGrepTool,
	createFindTool,
	createLsTool,
	createPowerShellTool,
};

// Helper Functions

function getDefaultAgentDir(): string {
	return getAgentDir();
}

/**
 * Create an AgentSession with the specified options.
 *
 * @example
 * ```typescript
 * // Minimal - uses defaults
 * const { session } = await createAgentSession();
 *
 * // With explicit model
 * import { getModel } from '@earendil-works/pi-ai';
 * const { session } = await createAgentSession({
 *   model: getModel('anthropic', 'claude-opus-4-5'),
 *   thinkingLevel: 'high',
 * });
 *
 * // Continue previous session
 * const { session, modelFallbackMessage } = await createAgentSession({
 *   continueSession: true,
 * });
 *
 * // Full control
 * const loader = new DefaultResourceLoader({
 *   cwd: process.cwd(),
 *   agentDir: getAgentDir(),
 *   settingsManager: SettingsManager.create(),
 * });
 * await loader.reload();
 * const { session } = await createAgentSession({
 *   model: myModel,
 *   tools: ["read", "bash"],
 *   resourceLoader: loader,
 *   sessionManager: SessionManager.inMemory(),
 * });
 * ```
 */
export async function createAgentSession(options: CreateAgentSessionOptions = {}): Promise<CreateAgentSessionResult> {
	const cwd = resolvePath(options.cwd ?? options.sessionManager?.getCwd() ?? process.cwd());
	const agentDir = options.agentDir ? resolvePath(options.agentDir) : getDefaultAgentDir();
	let resourceLoader = options.resourceLoader;

	const authPath = options.agentDir ? join(agentDir, "auth.json") : undefined;
	const modelsPath = options.agentDir ? join(agentDir, "models.json") : undefined;
	const modelRuntime = options.modelRuntime ?? (await ModelRuntime.create({ authPath, modelsPath }));

	const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
	const sessionManager = options.sessionManager ?? SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir));

	// c4d: a loader this function constructs is internally owned — it is disposed on a
	// construction failure and when the returned session is disposed. A caller-injected
	// options.resourceLoader stays caller-owned and is never disposed here.
	const ownsResourceLoader = resourceLoader === undefined;
	if (!resourceLoader) {
		resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
		});
		await resourceLoader.reload();
		time("resourceLoader.reload");
	}

	// Check if session has existing data to restore
	const existingSession = sessionManager.buildSessionContext();
	const hasExistingSession = existingSession.messages.length > 0;
	const hasThinkingEntry = sessionManager.getBranch().some((entry) => entry.type === "thinking_level_change");

	let model = options.model;
	let modelFallbackMessage: string | undefined;

	// If session has data, try to restore model from it
	if (!model && hasExistingSession && existingSession.model) {
		const restoredModel = modelRuntime.getModel(existingSession.model.provider, existingSession.model.modelId);
		if (restoredModel && modelRuntime.hasConfiguredAuth(restoredModel.provider)) {
			model = restoredModel;
		}
		if (!model) {
			modelFallbackMessage = `Could not restore model ${existingSession.model.provider}/${existingSession.model.modelId}`;
		}
	}

	// If still no model, use findInitialModel (checks settings default, then provider defaults)
	if (!model) {
		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: hasExistingSession,
			defaultProvider: settingsManager.getDefaultProvider(),
			defaultModelId: settingsManager.getDefaultModel(),
			defaultThinkingLevel: settingsManager.getDefaultThinkingLevel(),
			modelThinkingLevels: settingsManager.getAllModelThinkingLevels(),
			modelRuntime,
		});
		model = result.model;
		if (!model) {
			modelFallbackMessage = formatNoModelsAvailableMessage();
		} else if (modelFallbackMessage) {
			modelFallbackMessage += `. Using ${model.provider}/${model.id}`;
		}
	}

	let thinkingLevel = options.thinkingLevel;

	// If session has data, restore thinking level from it
	if (thinkingLevel === undefined && hasExistingSession) {
		thinkingLevel = hasThinkingEntry
			? (existingSession.thinkingLevel as ThinkingLevel)
			: (settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL);
	}

	// Fall back to per-model override, then global default
	if (thinkingLevel === undefined && model) {
		const perModel = settingsManager.getModelThinkingLevel(model.provider, model.id);
		if (perModel) {
			thinkingLevel = perModel;
		}
	}
	if (thinkingLevel === undefined) {
		thinkingLevel = settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
	}

	// Clamp to model capabilities
	if (!model) {
		thinkingLevel = "off";
	} else {
		thinkingLevel = clampThinkingLevel(model, thinkingLevel) as ThinkingLevel;
	}

	const allowedToolNames = options.tools ?? (options.noTools === "all" ? [] : undefined);
	const excludedToolNames = options.excludeTools;
	const excludedToolNameSet = excludedToolNames ? new Set(excludedToolNames) : undefined;
	const configuredDefaultToolNames = settingsManager.getDefaultTools();
	// Default launch (no --tools / --no-tools / --no-builtin-tools and no `defaultTools`
	// setting) passes `undefined` so AgentSession._buildRuntime uses its own default active
	// set, which appends the `skill` / `slash_command` tools when a model-visible skill or
	// command exists. A hardcoded ["read","bash","edit","write"] here shadowed that branch, so
	// those two tools were never active on a real launch (only in harnesses that set
	// baseToolsOverride).
	const initialActiveToolNames: string[] | undefined = options.tools
		? [...options.tools].filter((name) => !excludedToolNameSet?.has(name))
		: options.noTools
			? []
			: configuredDefaultToolNames
				? configuredDefaultToolNames.filter((name) => !excludedToolNameSet?.has(name))
				: undefined;

	let agent: Agent;

	// Create convertToLlm wrapper that filters images if blockImages is enabled (defense-in-depth)
	const convertToLlmWithBlockImages = (messages: AgentMessage[]): Message[] => {
		const converted = convertToLlm(messages);
		// Check setting dynamically so mid-session changes take effect
		if (!settingsManager.getBlockImages()) {
			return converted;
		}
		// Filter out ImageContent from all messages, replacing with text placeholder
		return converted.map((msg) => {
			if (msg.role === "user" || msg.role === "toolResult") {
				const content = msg.content;
				if (Array.isArray(content)) {
					const hasImages = content.some((c) => c.type === "image");
					if (hasImages) {
						const filteredContent = content
							.map((c) =>
								c.type === "image" ? { type: "text" as const, text: "Image reading is disabled." } : c,
							)
							.filter(
								(c, i, arr) =>
									// Dedupe consecutive "Image reading is disabled." texts
									!(
										c.type === "text" &&
										c.text === "Image reading is disabled." &&
										i > 0 &&
										arr[i - 1].type === "text" &&
										(arr[i - 1] as { type: "text"; text: string }).text === "Image reading is disabled."
									),
							);
						return { ...msg, content: filteredContent };
					}
				}
			}
			return msg;
		});
	};

	const extensionRunnerRef: { current?: ExtensionRunner } = {};

	// The model pi-ai hands these hooks is the request's model — for bare Agents and
	// subagents it can differ from the session's selected model, so it (and never
	// ctx.model) is what reaches the provider events for handler scoping.
	const onProviderPayload: SimpleStreamOptions["onPayload"] = async (payload, model) => {
		const runner = extensionRunnerRef.current;
		if (!runner?.hasHandlers("before_provider_request")) {
			return payload;
		}
		return runner.emitBeforeProviderRequest(payload, model);
	};
	const onProviderResponse: SimpleStreamOptions["onResponse"] = async (response, model) => {
		const runner = extensionRunnerRef.current;
		if (!runner?.hasHandlers("after_provider_response")) {
			return;
		}
		await runner.emit({
			type: "after_provider_response",
			model,
			status: response.status,
			headers: response.headers,
		});
	};

	// Session-scoped abort controller. Its signal is combined into every stream this
	// session issues (below), so AgentSession.dispose() can abort an in-flight model
	// stream even after the run that started it has settled — agent.abort() only fires
	// the active run's controller, so a subagent parked at a tool boundary under a
	// settled run would otherwise never see an abort and its provider child would leak.
	const sessionAbortController = new AbortController();

	// The single definition of how this session streams: used by the session's Agent below
	// and installed as the process-default stream target for bare Agent/loop callers, so
	// both get retry settings, timeouts, attribution headers, and the before_provider_headers
	// hook. Extension payload/response hooks are NOT injected here: the session's Agent
	// carries them itself (they arrive via options), direct callers like compaction and
	// branch summarization must stay hook-free, and bare callers get them from the
	// default-stream target's dispatch.
	const sessionStreamFn: StreamFn = async (model, context, options) => {
		const providerRetrySettings = settingsManager.getProviderRetrySettings();
		const httpIdleTimeoutMs = settingsManager.getHttpIdleTimeoutMs();
		// SDKs treat timeout=0 as 0ms (immediate timeout), not "no timeout".
		// Use max int32 to effectively disable the timeout.
		const effectiveTimeoutMs = httpIdleTimeoutMs === 0 ? 2147483647 : httpIdleTimeoutMs;
		const timeoutMs = options?.timeoutMs ?? providerRetrySettings.timeoutMs ?? effectiveTimeoutMs;
		const websocketConnectTimeoutMs =
			options?.websocketConnectTimeoutMs ?? settingsManager.getWebSocketConnectTimeoutMs();
		const headerRunner = extensionRunnerRef.current;
		// Callers that pass their own transformHeaders (only possible untyped; the runtime
		// honors it) keep it, matching the pre-wrapper composed-default behavior.
		const callerTransformHeaders = (options as ModelsRequestTransforms | undefined)?.transformHeaders;
		// Combine the caller's signal with the session signal so dispose() aborts this
		// stream regardless of the run's state. AbortSignal.any retains references to its
		// sources; the combined signal is per-call, so nothing here accumulates it — but a
		// provider may retain the signal it was handed beyond stream completion, so its
		// lifetime is bounded by the provider, not guaranteed by this wrapper.
		// (Node engine is >=22.19, so AbortSignal.any is available.)
		const signal = options?.signal
			? AbortSignal.any([options.signal, sessionAbortController.signal])
			: sessionAbortController.signal;
		return modelRuntime.streamSimple(model, context, {
			...options,
			signal,
			timeoutMs,
			websocketConnectTimeoutMs,
			maxRetries: options?.maxRetries ?? providerRetrySettings.maxRetries,
			maxRetryDelayMs: options?.maxRetryDelayMs ?? providerRetrySettings.maxRetryDelayMs,
			transformHeaders:
				callerTransformHeaders ??
				(async (requestHeaders) => {
					const headers = mergeProviderAttributionHeaders(
						model,
						settingsManager,
						options?.sessionId,
						requestHeaders,
					);
					return headerRunner?.hasHandlers("before_provider_headers")
						? headerRunner.emitBeforeProviderHeaders(headers ?? {}, model)
						: (headers ?? {});
				}),
		});
	};

	agent = new Agent({
		initialState: {
			systemPrompt: "",
			model,
			thinkingLevel,
			tools: [],
		},
		convertToLlm: convertToLlmWithBlockImages,
		streamFn: sessionStreamFn,
		onPayload: onProviderPayload,
		onResponse: onProviderResponse,
		sessionId: sessionManager.getSessionId(),
		transformContext: async (messages) => {
			const runner = extensionRunnerRef.current;
			if (!runner) return messages;
			return runner.emitContext(messages);
		},
		steeringMode: settingsManager.getSteeringMode(),
		followUpMode: settingsManager.getFollowUpMode(),
		transport: settingsManager.getTransport(),
		thinkingBudgets: settingsManager.getThinkingBudgets(),
		maxRetryDelayMs: settingsManager.getProviderRetrySettings().maxRetryDelayMs,
	});

	// Restore messages if session has existing data
	if (hasExistingSession) {
		agent.state.messages = existingSession.messages;
		if (!hasThinkingEntry) {
			sessionManager.appendThinkingLevelChange(thinkingLevel);
		}
	} else {
		// Save initial model and thinking level for new sessions so they can be restored on resume
		if (model) {
			sessionManager.appendModelChange(model.provider, model.id);
		}
		sessionManager.appendThinkingLevelChange(thinkingLevel);
	}

	// Make this session the process-default stream target for bare Agent/loop callers
	// (last-created session wins). The session releases the installation on dispose;
	// if construction fails before the caller ever receives the session, release here
	// so the failed session's runtime does not stay the process default.
	const defaultStreamTarget: DefaultStreamTarget = {
		runtime: modelRuntime,
		streamFn: sessionStreamFn,
		onPayload: onProviderPayload,
		onResponse: onProviderResponse,
	};
	const releaseDefaultStreamRuntime = installDefaultStreamTarget(defaultStreamTarget);
	try {
		const session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd,
			agentDir,
			scopedModels: options.scopedModels,
			resourceLoader,
			customTools: options.customTools,
			modelRuntime,
			initialActiveToolNames,
			allowedToolNames,
			excludedToolNames,
			extensionRunnerRef,
			sessionStartEvent: options.sessionStartEvent,
			defaultStreamTarget,
			releaseDefaultStreamRuntime,
			sessionAbortController,
			ownsResourceLoader,
		});
		// A.6 compaction carry-forward (c4b): the message restore above (`agent.state.messages =
		// existingSession.messages`) runs before this session exists, so the reattach seam runs here
		// instead — before `bindExtensions` binds a diagnostic listener; `_deliverSkillListingDiagnostics`
		// buffers until then. Also covers `switchSession` (routes through `createRuntime` → this function).
		if (hasExistingSession) {
			session.reattachCarriedSkills();
		}
		const extensionsResult = resourceLoader.getExtensions();

		return {
			session,
			extensionsResult,
			modelFallbackMessage,
		};
	} catch (error) {
		releaseDefaultStreamRuntime();
		if (ownsResourceLoader) {
			resourceLoader.dispose?.();
		}
		throw error;
	}
}

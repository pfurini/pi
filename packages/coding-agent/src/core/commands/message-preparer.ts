/**
 * Invocation-preparation coordinator (extracted from `AgentSession`). Owns the
 * tokenize → compose → render → activate → fallback flow for both the direct
 * send path and the queued consumption path, behind narrow injected ports so
 * it never references the session. Behavior is identical to the inlined
 * original: skill records activate only after the whole composition succeeds
 * (A.5), and any render failure falls back to the whole original literal
 * message (never silently dropped).
 *
 * The message-initial single-skill path is returned as a discriminated
 * `sole-skill` result; the caller (AgentSession) chooses the A.4 transport
 * (message block vs synthetic pair) and owns its fallback.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai/compat";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { SkillInvocationEntry } from "../session-manager.ts";
import { buildSkillMessageBlock } from "../skills/delivery.ts";
import type { LoadedSkill } from "../skills/frontmatter.ts";
import type { RenderedSkillInvocation } from "../skills/render.ts";
import type { SkillInvocation } from "../skills/runtime.ts";
import type { LoadedCommand } from "./loader.ts";
import type { ResolvedSkillInvocation } from "./registry.ts";
import type { RenderedCommand } from "./render.ts";
import type { InvocationSpan, MessageSpan, TokenizeResult } from "./tokenizer.ts";

/** Immutable queued-invocation snapshot (captured at queue time, rendered on consumption). */
export interface QueuedInvocationSnapshot {
	/** The tokenize result captured at queue time (spans + messageInitial stay correlated). */
	snapshot: TokenizeResult;
	/** Whole original message text: delivered literally on any render/abort failure. */
	originalText: string;
	images?: ImageContent[];
}

/** Narrow ports the preparer needs; AgentSession binds closures over its runtime/renderers. */
export interface CommandMessagePreparerDeps {
	createSkillInvocation(skill: LoadedSkill, rawArgs: string): SkillInvocation;
	renderSkill(skill: LoadedSkill, invocation: SkillInvocation, signal?: AbortSignal): Promise<RenderedSkillInvocation>;
	renderCommand(command: LoadedCommand, rawArgs: string, signal?: AbortSignal): Promise<RenderedCommand>;
	/** Activate a rendered invocation for the rest of the logical turn; returns diagnostics. */
	activateSkill(invocation: SkillInvocation): readonly ResourceDiagnostic[];
	emitDiagnostics(diagnostics: readonly ResourceDiagnostic[]): void;
	emitRenderError(extensionPath: string, event: "skill_expansion" | "command_expansion", error: unknown): void;
	/** Build a plain literal user message (whole-message fallback). */
	literalMessage(text: string, images?: ImageContent[]): AgentMessage;
	/** Attach B.12 delivery metadata to a composed message. */
	attachInvocations(message: AgentMessage, invocations: SkillInvocationEntry[]): void;
}

export interface SoleSkillPreparation {
	kind: "sole-skill";
	skill: LoadedSkill;
	rawArgs: string;
}

export interface ComposedPreparation {
	kind: "message";
	message: AgentMessage;
	textForm: string;
}

export type PreparedInvocationMessage = SoleSkillPreparation | ComposedPreparation;

export class CommandMessagePreparer {
	private readonly deps: CommandMessagePreparerDeps;

	constructor(deps: CommandMessagePreparerDeps) {
		this.deps = deps;
	}

	/** Concatenate the plain-text form of tokenized spans (no invocations expanded). */
	plainText(spans: MessageSpan[]): string {
		return spans.map((span) => (span.kind === "text" ? span.text : "")).join("");
	}

	/**
	 * Direct (non-streaming) preparation: a message-initial single skill comes
	 * back as `sole-skill` for transport selection; everything else composes one
	 * user message (or the literal fallback).
	 */
	async prepareDirect(input: {
		tokenized: TokenizeResult | undefined;
		text: string;
		images?: ImageContent[];
		signal?: AbortSignal;
	}): Promise<PreparedInvocationMessage> {
		const { tokenized, text, images, signal } = input;
		const soleSkill = tokenized ? this.soleSkillSpan(tokenized.spans, tokenized.messageInitial) : undefined;
		if (soleSkill) {
			return { kind: "sole-skill", skill: soleSkill.invocation.skill, rawArgs: soleSkill.rawArgs };
		}
		const invocationSpans = tokenized
			? tokenized.spans.filter((span): span is InvocationSpan => span.kind === "invocation")
			: [];
		if (tokenized && invocationSpans.length > 0) {
			const composed = await this.composeSpans(tokenized.spans, images, signal);
			if (composed) {
				return composed;
			}
			return { kind: "message", message: this.deps.literalMessage(text, images), textForm: text };
		}
		const finalText = tokenized ? this.plainText(tokenized.spans) : text;
		return { kind: "message", message: this.deps.literalMessage(finalText, images), textForm: finalText };
	}

	/**
	 * Queued consumption: same branching as the direct path against the
	 * immutable snapshot. Throws propagate to the caller's defensive catch,
	 * which falls back to the literal original text.
	 */
	async prepareQueued(queued: QueuedInvocationSnapshot, signal?: AbortSignal): Promise<PreparedInvocationMessage> {
		const soleSkill = this.soleSkillSpan(queued.snapshot.spans, queued.snapshot.messageInitial);
		if (soleSkill) {
			return { kind: "sole-skill", skill: soleSkill.invocation.skill, rawArgs: soleSkill.rawArgs };
		}
		const composed = await this.composeSpans(queued.snapshot.spans, queued.images, signal);
		if (composed) {
			return composed;
		}
		return {
			kind: "message",
			message: this.deps.literalMessage(queued.originalText, queued.images),
			textForm: queued.originalText,
		};
	}

	/**
	 * The message-initial single-skill invocation, when it is the only invocation
	 * and carries no real leading text. A collapsed-backslash prefix (`\\/skill`)
	 * is content: it falls through to composition so the literal `\` survives.
	 */
	private soleSkillSpan(
		spans: MessageSpan[],
		messageInitial: boolean,
	): { invocation: ResolvedSkillInvocation; rawArgs: string } | undefined {
		const invocationSpans = spans.filter((span): span is InvocationSpan => span.kind === "invocation");
		if (!messageInitial || invocationSpans.length !== 1) {
			return undefined;
		}
		const hasLiteralPrefix = spans.some((span) => span.kind === "text" && /\S/.test(span.text));
		if (hasLiteralPrefix) {
			return undefined;
		}
		const invocation = invocationSpans[0].invocation;
		return invocation.source === "skill" ? { invocation, rawArgs: invocationSpans[0].rawArgs } : undefined;
	}

	/**
	 * Compose tokenized spans (mid-prompt / mixed) into one user message: command
	 * spans splice rendered text, skill spans splice `<skill>` blocks with B.12
	 * UTF-16 offsets. Skill records activate only after the whole composition
	 * succeeds (A.5). Returns undefined after emitting a diagnostic on any render
	 * failure, so the caller falls back to the whole original literal message.
	 */
	private async composeSpans(
		spans: MessageSpan[],
		images: ImageContent[] | undefined,
		signal?: AbortSignal,
	): Promise<ComposedPreparation | undefined> {
		let text = "";
		const invocations: SkillInvocationEntry[] = [];
		const activations: SkillInvocation[] = [];
		for (const span of spans) {
			if (span.kind === "text") {
				text += span.text;
				continue;
			}
			if (span.invocation.source === "skill") {
				const skill = span.invocation.skill;
				const invocation = this.deps.createSkillInvocation(skill, span.rawArgs);
				let rendered: RenderedSkillInvocation;
				try {
					rendered = await this.deps.renderSkill(skill, invocation, signal);
					this.deps.emitDiagnostics(rendered.diagnostics);
				} catch (err) {
					this.deps.emitRenderError(skill.filePath, "skill_expansion", err);
					return undefined;
				}
				const block = buildSkillMessageBlock(rendered.invocation, rendered.body);
				const blockStart = text.length;
				text += block.text;
				invocations.push({ ...block.invocation, blockStart, blockEnd: text.length });
				activations.push(invocation);
			} else if (span.invocation.source === "command" || span.invocation.source === "prompt") {
				const command = span.invocation.command;
				let rendered: RenderedCommand;
				try {
					rendered = await this.deps.renderCommand(command, span.rawArgs, signal);
					this.deps.emitDiagnostics(rendered.diagnostics);
				} catch (err) {
					this.deps.emitRenderError(command.filePath, "command_expansion", err);
					return undefined;
				}
				text += rendered.text;
			}
		}
		for (const invocation of activations) {
			this.deps.emitDiagnostics(this.deps.activateSkill(invocation));
		}
		const message = this.deps.literalMessage(text, images);
		if (invocations.length > 0) {
			this.deps.attachInvocations(message, invocations);
		}
		return { kind: "message", message, textForm: text };
	}
}

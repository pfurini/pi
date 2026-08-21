/**
 * Invocation coordinator (extracted from `AgentSession`). Owns the shared
 * render+activate primitive for all three invocation sites — the direct/queued
 * user-message composition (tokenize → compose → render → activate → fallback),
 * the sole-skill delivery, and the genuine `skill` tool — behind narrow injected
 * ports so it never references the session. Behavior is identical to the inlined
 * original: composed skill records activate only after the whole composition
 * succeeds (A.5), and any render failure falls back to the whole original literal
 * message (never silently dropped).
 *
 * The message-initial single-skill path is returned as a discriminated
 * `sole-skill` result; the caller (AgentSession) chooses the A.4 transport
 * (message block vs synthetic pair) and owns its fallback. The lower
 * `prepare`/`activate` primitive is consumed directly by the sole-skill delivery
 * and the `skill` tool, which render a body rather than a delivery message.
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
import { formatNestedVariantsNote, type ResolvedSkillInvocation } from "./registry.ts";
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

/** Narrow ports the coordinator needs; AgentSession binds closures over its runtime/renderers. */
export interface InvocationCoordinatorDeps {
	createSkillInvocation(skill: LoadedSkill, rawArgs: string): SkillInvocation;
	renderSkill(skill: LoadedSkill, invocation: SkillInvocation, signal?: AbortSignal): Promise<RenderedSkillInvocation>;
	renderCommand(command: LoadedCommand, rawArgs: string, signal?: AbortSignal): Promise<RenderedCommand>;
	/** Activate a rendered invocation for the rest of the logical turn; returns diagnostics. */
	activateSkill(invocation: SkillInvocation): readonly ResourceDiagnostic[];
	/** A.6 re-invocation dedup (c4b): a hit returns the short "already loaded" note to splice in place of the full block. */
	checkDedup(rendered: RenderedSkillInvocation): { note: string } | undefined;
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
	/** A.1 nested-collision variants of the bare name (c4d): the caller appends the variant note. */
	nestedVariants?: string[];
}

export interface ComposedPreparation {
	kind: "message";
	message: AgentMessage;
	textForm: string;
}

export type PreparedInvocationMessage = SoleSkillPreparation | ComposedPreparation;

/** Result of the shared render primitive: an inert record plus its rendered body. */
export interface PreparedSkillInvocation {
	record: SkillInvocation;
	rendered: RenderedSkillInvocation;
}

export class InvocationCoordinator {
	private readonly deps: InvocationCoordinatorDeps;

	constructor(deps: InvocationCoordinatorDeps) {
		this.deps = deps;
	}

	/**
	 * Shared render primitive: create the inert record and render it once. Does
	 * NOT emit diagnostics or activate — the caller chooses when to do both, so
	 * each site keeps its own activation timing (compose-then-activate-all for the
	 * user message; activate-after-transport for delivery; activate-after-render
	 * for the `skill` tool).
	 */
	async prepare(skill: LoadedSkill, rawArgs: string, signal?: AbortSignal): Promise<PreparedSkillInvocation> {
		const record = this.deps.createSkillInvocation(skill, rawArgs);
		const rendered = await this.deps.renderSkill(skill, record, signal);
		return { record, rendered };
	}

	/** Activate a prepared record for the rest of the logical turn; returns diagnostics. */
	activate(record: SkillInvocation): readonly ResourceDiagnostic[] {
		return this.deps.activateSkill(record);
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
			return {
				kind: "sole-skill",
				skill: soleSkill.invocation.skill,
				rawArgs: soleSkill.rawArgs,
				...(soleSkill.invocation.nestedVariants !== undefined && {
					nestedVariants: soleSkill.invocation.nestedVariants,
				}),
			};
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
			return {
				kind: "sole-skill",
				skill: soleSkill.invocation.skill,
				rawArgs: soleSkill.rawArgs,
				...(soleSkill.invocation.nestedVariants !== undefined && {
					nestedVariants: soleSkill.invocation.nestedVariants,
				}),
			};
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
			// A.6 `off` tombstone span (c4c): consumed — contributes no text and
			// no invocation; its diagnostic was emitted by the caller.
			if (span.kind === "disabled") {
				continue;
			}
			if (span.invocation.source === "skill") {
				const skill = span.invocation.skill;
				let prepared: PreparedSkillInvocation;
				try {
					prepared = await this.prepare(skill, span.rawArgs, signal);
					this.deps.emitDiagnostics(prepared.rendered.diagnostics);
				} catch (err) {
					this.deps.emitRenderError(skill.filePath, "skill_expansion", err);
					return undefined;
				}
				const dedup = this.deps.checkDedup(prepared.rendered);
				const metadata = prepared.rendered.invocation;
				if (dedup) {
					text += dedup.note;
					invocations.push({
						skillId: metadata.skillId,
						name: metadata.name,
						args: metadata.args,
						blockStart: 0,
						blockEnd: 0,
					});
				} else {
					const block = buildSkillMessageBlock(metadata, prepared.rendered.body);
					const blockStart = text.length;
					text += block.text;
					invocations.push({ ...block.invocation, blockStart, blockEnd: text.length });
				}
				activations.push(prepared.record);
				// A.1 (c4d): an unqualified invocation with nested variants carries a note listing them.
				if (span.invocation.nestedVariants !== undefined && span.invocation.nestedVariants.length > 0) {
					text += `\n\n${formatNestedVariantsNote(span.invocation.name, span.invocation.nestedVariants)}`;
				}
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
		for (const record of activations) {
			this.deps.emitDiagnostics(this.activate(record));
		}
		const message = this.deps.literalMessage(text, images);
		if (invocations.length > 0) {
			this.deps.attachInvocations(message, invocations);
		}
		return { kind: "message", message, textForm: text };
	}
}

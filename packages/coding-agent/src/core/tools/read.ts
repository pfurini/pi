import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Api, ImageContent, Model, TextContent } from "@earendil-works/pi-ai";
import { constants } from "fs";
import { access as fsAccess, open as fsOpen, readFile as fsReadFile, stat as fsStat } from "fs/promises";
import { type Static, Type } from "typebox";
import { processImage } from "../../utils/image-process.ts";
import { detectSupportedImageMimeTypeFromFile } from "../../utils/mime.ts";
import { trimIncompleteTrailingUtf8 } from "../../utils/utf8.ts";
import { getExperimentalToolSampling } from "../experimental.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { resolveReadPathAsync } from "./path-utils.ts";
import { readRenderers } from "./renderers/read.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateHead } from "./truncate.ts";

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export const readToolSystemPromptContribution = {
	snippet: "Read file contents",
	guidelines: ["Use read to examine files instead of cat or sed."],
} as const;

export type ReadToolInput = Static<typeof readSchema>;

export interface ReadToolDetails {
	truncation?: TruncationResult;
}

/**
 * Pluggable operations for the read tool.
 * Override these to delegate file reading to remote systems (for example SSH).
 */
export interface ReadOperations {
	/** Read file contents as a Buffer */
	readFile: (absolutePath: string) => Promise<Buffer>;
	/** Check if file is readable (throw if not) */
	access: (absolutePath: string) => Promise<void>;
	/** Detect image MIME type, return null or undefined for non-images */
	detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
	/**
	 * File size in bytes, used to avoid loading an arbitrarily large file into memory.
	 * Optional together with `readFilePrefix`: a backend that provides neither keeps the
	 * unbounded whole-file read, so existing remote operations stay source-compatible.
	 */
	fileSize?: (absolutePath: string) => Promise<number>;
	/** Read at most `maxBytes` from the start of the file. */
	readFilePrefix?: (absolutePath: string, maxBytes: number) => Promise<Buffer>;
}

/**
 * Largest text file read whole. Above this only a prefix is loaded: the tool caps its own output
 * at DEFAULT_MAX_BYTES anyway, and decoding a multi-gigabyte file costs several times its size in
 * memory (Buffer, then a JS string, then the split line array) before that cap is ever applied.
 * Matches the retained-output bound pi.exec applies to foreign input.
 */
export const MAX_READ_FILE_BYTES = 4 * 1024 * 1024;

const defaultReadOperations: ReadOperations = {
	readFile: (path) => fsReadFile(path),
	access: (path) => fsAccess(path, constants.R_OK),
	detectImageMimeType: detectSupportedImageMimeTypeFromFile,
	fileSize: async (path) => (await fsStat(path)).size,
	readFilePrefix: async (path, maxBytes) => {
		const handle = await fsOpen(path, "r");
		try {
			const buffer = Buffer.allocUnsafe(maxBytes);
			const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
			return buffer.subarray(0, bytesRead);
		} finally {
			await handle.close();
		}
	},
};

export interface ReadToolOptions {
	/** Whether to auto-resize images to 2000x2000 max. Default: true */
	autoResizeImages?: boolean;
	/** Custom operations for file reading. Default: local filesystem */
	operations?: ReadOperations;
}

function getNonVisionImageNote(model: Model<Api> | undefined): string | undefined {
	if (!model || model.input.includes("image")) {
		return undefined;
	}
	return "[Current model does not support images. The image will be omitted from this request.]";
}

export function createReadToolDefinition(
	cwd: string,
	options?: ReadToolOptions,
): ToolDefinition<typeof readSchema, ReadToolDetails | undefined> {
	const autoResizeImages = options?.autoResizeImages ?? true;
	const ops = options?.operations ?? defaultReadOperations;
	return {
		name: "read",
		label: "read",
		description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete. Only the first ${MAX_READ_FILE_BYTES / (1024 * 1024)}MB of a text file is reachable through this tool; use bash (sed/awk) beyond that.`,
		promptSnippet: readToolSystemPromptContribution.snippet,
		promptGuidelines: [...readToolSystemPromptContribution.guidelines],
		parameters: readSchema,
		constrainedSampling: getExperimentalToolSampling(),
		async execute(
			_toolCallId,
			{ path, offset, limit }: { path: string; offset?: number; limit?: number },
			signal?: AbortSignal,
			_onUpdate?,
			ctx?: ExtensionContext,
		) {
			return new Promise<{ content: (TextContent | ImageContent)[]; details: ReadToolDetails | undefined }>(
				(resolve, reject) => {
					if (signal?.aborted) {
						reject(new Error("Operation aborted"));
						return;
					}
					let aborted = false;
					const onAbort = () => {
						aborted = true;
						reject(new Error("Operation aborted"));
					};
					signal?.addEventListener("abort", onAbort, { once: true });

					(async () => {
						try {
							const absolutePath = await resolveReadPathAsync(path, ctx?.cwd || cwd);
							if (aborted) return;
							// Check if file exists and is readable.
							await ops.access(absolutePath);
							if (aborted) return;
							const mimeType = ops.detectImageMimeType ? await ops.detectImageMimeType(absolutePath) : undefined;
							let content: (TextContent | ImageContent)[];
							let details: ReadToolDetails | undefined;
							const nonVisionImageNote = getNonVisionImageNote(ctx?.model);
							if (mimeType) {
								// Read image as binary.
								const buffer = await ops.readFile(absolutePath);
								const processed = await processImage(buffer, mimeType, { autoResizeImages });
								if (!processed.ok) {
									let textNote = `Read image file [${mimeType}]\n${processed.message}`;
									if (nonVisionImageNote) textNote += `\n${nonVisionImageNote}`;
									content = [{ type: "text", text: textNote }];
								} else {
									let textNote = `Read image file [${processed.mimeType}]`;
									if (processed.hints.length > 0) textNote += `\n${processed.hints.join("\n")}`;
									if (nonVisionImageNote) textNote += `\n${nonVisionImageNote}`;
									content = [
										{ type: "text", text: textNote },
										{ type: "image", data: processed.data, mimeType: processed.mimeType },
									];
								}
							} else {
								// Read text content, loading only a prefix when the file is too large to hold whole.
								const readPrefix = ops.readFilePrefix;
								const measuredSize = ops.fileSize && readPrefix ? await ops.fileSize(absolutePath) : undefined;
								// Set only when the file is both measurable and too large, which is exactly when the
								// prefix path applies; keeping the size in the variable lets it be reported truthfully.
								const oversizedBytes =
									readPrefix && measuredSize !== undefined && measuredSize > MAX_READ_FILE_BYTES
										? measuredSize
										: undefined;
								const buffer =
									oversizedBytes !== undefined && readPrefix
										? trimIncompleteTrailingUtf8(await readPrefix(absolutePath, MAX_READ_FILE_BYTES))
										: await ops.readFile(absolutePath);
								const textContent = buffer.toString("utf-8");
								const allLines = textContent.split("\n");
								// The prefix almost certainly ends mid-line; drop that partial line rather than
								// presenting it as a complete one.
								if (oversizedBytes !== undefined && allLines.length > 1) allLines.pop();
								const totalFileLines = allLines.length;
								const prefixNote =
									oversizedBytes !== undefined
										? `\n\n[File is ${formatSize(oversizedBytes)}, above the ${formatSize(MAX_READ_FILE_BYTES)} read limit: only its first ${allLines.length} lines are reachable here. Use bash for the rest, e.g. sed -n 'START,ENDp' ${path}]`
										: "";
								// A bounded read only knows the lines it loaded, so counts are reported as a floor.
								const totalLinesDisplay =
									oversizedBytes !== undefined ? `${totalFileLines}+` : `${totalFileLines}`;
								// Apply offset if specified. Convert from 1-indexed input to 0-indexed array access.
								const startLine = offset ? Math.max(0, offset - 1) : 0;
								const startLineDisplay = startLine + 1;
								// Check if offset is out of bounds.
								if (startLine >= allLines.length) {
									throw new Error(
										oversizedBytes !== undefined
											? `Offset ${offset} is beyond the first ${allLines.length} lines, the most this tool can read from a ${formatSize(oversizedBytes)} file. Use bash: sed -n '${offset},${(offset ?? 1) + 200}p' ${path}`
											: `Offset ${offset} is beyond end of file (${allLines.length} lines total)`,
									);
								}
								let selectedContent: string;
								let userLimitedLines: number | undefined;
								// If limit is specified by the user, honor it first. Otherwise truncateHead decides.
								if (limit !== undefined) {
									const endLine = Math.min(startLine + limit, allLines.length);
									selectedContent = allLines.slice(startLine, endLine).join("\n");
									userLimitedLines = endLine - startLine;
								} else {
									selectedContent = allLines.slice(startLine).join("\n");
								}
								// Apply truncation, respecting both line and byte limits.
								const truncation = truncateHead(selectedContent);
								let outputText: string;
								if (truncation.firstLineExceedsLimit) {
									// First line alone exceeds the byte limit. Point the model at a bash fallback.
									const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
									outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`;
									details = { truncation };
								} else if (truncation.truncated) {
									// Truncation occurred. Build an actionable continuation notice.
									const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
									const nextOffset = endLineDisplay + 1;
									outputText = truncation.content;
									if (truncation.truncatedBy === "lines") {
										outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalLinesDisplay}. Use offset=${nextOffset} to continue.]`;
									} else {
										outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalLinesDisplay} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
									}
									details = { truncation };
								} else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
									// User-specified limit stopped early, but the file still has more content.
									const remaining = allLines.length - (startLine + userLimitedLines);
									const nextOffset = startLine + userLimitedLines + 1;
									outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
								} else {
									// No truncation and no remaining user-limited content.
									outputText = truncation.content;
								}
								content = [{ type: "text", text: outputText + prefixNote }];
							}

							if (aborted) return;
							signal?.removeEventListener("abort", onAbort);
							resolve({ content, details });
						} catch (error: any) {
							signal?.removeEventListener("abort", onAbort);
							if (!aborted) reject(error);
						}
					})();
				},
			);
		},
		...readRenderers,
	};
}

export function createReadTool(cwd: string, options?: ReadToolOptions): AgentTool<typeof readSchema> {
	return wrapToolDefinition(createReadToolDefinition(cwd, options));
}

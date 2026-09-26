/**
 * Fork-owned: resolves the TokenSave project a tool call or command targets.
 *
 * Every tool takes an optional `project` path, absolute or relative to the session cwd.
 * Without it, the tool targets the session's project, as before. With it, the tool
 * queries another indexed repository. TokenSave's CLI accepts and returns file paths
 * relative to the project root, so a foreign root needs two conversions:
 *
 * - inputs: a leading `<root>/` is stripped from every file path the model passes;
 * - outputs: every structured file path becomes absolute, so the model reads the
 *   right file from a cwd in another repository.
 *
 * The session's own project keeps TokenSave's relative paths.
 */

import { isAbsolute, join, resolve, sep } from "node:path";
import { isProjectInitialized, resolveProjectRoot } from "./project.ts";

export interface ToolProject {
	/** The project the call targets. */
	root: string;
	/** The session cwd's project. */
	sessionRoot: string;
	/** True when `root` differs from `sessionRoot`. */
	foreign: boolean;
	initialized: boolean;
}

export function resolveToolProject(cwd: string, project?: string): ToolProject {
	const root = resolveProjectRoot(resolve(cwd, project ?? "."));
	const sessionRoot = resolveProjectRoot(cwd);
	return { root, sessionRoot, foreign: root !== sessionRoot, initialized: isProjectInitialized(root) };
}

/** Strips a leading `<root>/` so TokenSave receives the root-relative path it expects. */
export function toRootRelative(project: ToolProject, path: string): string {
	const prefix = project.root.endsWith(sep) ? project.root : `${project.root}${sep}`;
	return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function toRootRelativeList(project: ToolProject, paths: string[] | undefined): string[] | undefined {
	return paths?.map((path) => toRootRelative(project, path));
}

/** The path shown to the model: absolute for a foreign root, unchanged for the session's project. */
export function displayPath(project: ToolProject, file: string): string;
export function displayPath(project: ToolProject, file: string | undefined): string | undefined;
export function displayPath(project: ToolProject, file: string | undefined): string | undefined {
	if (file === undefined || !project.foreign || isAbsolute(file)) return file;
	return join(project.root, file);
}

/** The first line of every tool result, plus the relative-path note `tokensave_context` needs. */
export function projectHeader(project: ToolProject, relativePathsNote = false): string {
	const lines = [`Project: ${project.root}`];
	if (relativePathsNote && project.foreign) lines.push(`File paths below are relative to ${project.root}.`);
	return lines.join("\n");
}

// Ported from pi-vcc 0.8.0 (npm @sting8k/pi-vcc), src/core/tool-args.ts.
// Copyright (c) 2026 sting8k. MIT licence: see LICENSE in this directory.

export const PATH_KEYS = ["path", "file_path", "filePath", "file"] as const;

export const extractPath = (args: Record<string, unknown>): string | null => {
	for (const key of ["path", "file_path", "filePath", "file"]) {
		if (typeof args[key] === "string") return args[key] as string;
	}
	return null;
};

export const summarizeToolArgs = (args: Record<string, unknown>): string => {
	const path = extractPath(args);
	if (path) return `path=${path}`;
	if (typeof args.command === "string") return `command=${args.command}`;
	if (typeof args.query === "string") return `query=${args.query}`;
	return Object.keys(args).join(", ");
};

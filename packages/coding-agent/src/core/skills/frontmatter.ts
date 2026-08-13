import { canonicalizePath } from "../../utils/paths.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { SourceInfo } from "../source-info.ts";

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const RESERVED_COMMAND_PREFIXES = ["skill:", "prompt:", "ext:"];
const OMIT_VALUE = Symbol("omit-skill-frontmatter-value");

export type SkillBooleanInput = boolean | string | number;
export type SkillArguments = string | string[] | Record<string, unknown>;
export type SkillToolList = string | string[];
export type SkillPathList = string | string[];

export interface SkillFrontmatter {
	name?: string;
	description?: string;
	license?: string;
	compatibility?: string;
	metadata?: Record<string, unknown>;
	when_to_use?: string;
	"argument-hint"?: string;
	arguments?: SkillArguments;
	"disable-model-invocation"?: SkillBooleanInput;
	"user-invocable"?: SkillBooleanInput;
	"allowed-tools"?: SkillToolList;
	"disallowed-tools"?: SkillToolList;
	disallowedTools?: SkillToolList;
	model?: string;
	effort?: string | number;
	context?: string;
	agent?: string;
	background?: SkillBooleanInput;
	paths?: SkillPathList;
	shell?: string;
	hooks?: unknown;
	[key: string]: unknown;
}

/** Backward-compatible construction shape accepted from SDK and resource-loader callers. */
export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	sourceInfo: SourceInfo;
	disableModelInvocation: boolean;
	id?: string;
	listingName?: string;
	frontmatter?: SkillFrontmatter;
	argumentHint?: string;
	userInvocable?: boolean;
	commandNameValid?: boolean;
}

export type SkillInput = Skill;

/** Complete normalized shape returned for file-loaded and default-loader skills. */
export interface LoadedSkill extends Skill {
	id: string;
	listingName: string;
	frontmatter: SkillFrontmatter;
	argumentHint: string | undefined;
	userInvocable: boolean;
	commandNameValid: boolean;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function diagnostic(message: string, path: string): ResourceDiagnostic {
	return { type: "warning", message, path };
}

function formatValuePath(parent: string, key: string | number): string {
	return typeof key === "number" ? `${parent}[${key}]` : `${parent}.${key}`;
}

function cloneJsonSafeValue(
	value: unknown,
	valuePath: string,
	filePath: string,
	activeObjects: Set<object>,
	diagnostics: ResourceDiagnostic[],
): JsonValue | typeof OMIT_VALUE {
	if (value === null || typeof value === "string" || typeof value === "boolean") {
		return value;
	}

	if (typeof value === "number") {
		if (Number.isFinite(value)) {
			return value;
		}
		diagnostics.push(
			diagnostic(`frontmatter value at ${valuePath} is not a finite number and was omitted`, filePath),
		);
		return OMIT_VALUE;
	}

	if (typeof value !== "object") {
		diagnostics.push(
			diagnostic(`frontmatter value at ${valuePath} is not JSON-serializable and was omitted`, filePath),
		);
		return OMIT_VALUE;
	}

	if (activeObjects.has(value)) {
		diagnostics.push(diagnostic(`frontmatter value at ${valuePath} is cyclic and was omitted`, filePath));
		return OMIT_VALUE;
	}

	if (Array.isArray(value)) {
		activeObjects.add(value);
		const result: JsonValue[] = [];
		for (const [index, item] of value.entries()) {
			const cloned = cloneJsonSafeValue(
				item,
				formatValuePath(valuePath, index),
				filePath,
				activeObjects,
				diagnostics,
			);
			if (cloned !== OMIT_VALUE) {
				result.push(cloned);
			}
		}
		activeObjects.delete(value);
		return result;
	}

	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		const typeName = value.constructor?.name ?? "unknown object";
		diagnostics.push(
			diagnostic(
				`frontmatter value at ${valuePath} uses unsupported container ${typeName} and was omitted`,
				filePath,
			),
		);
		return OMIT_VALUE;
	}

	activeObjects.add(value);
	const result: { [key: string]: JsonValue } = {};
	for (const [key, item] of Object.entries(value)) {
		const cloned = cloneJsonSafeValue(item, formatValuePath(valuePath, key), filePath, activeObjects, diagnostics);
		if (cloned !== OMIT_VALUE) {
			result[key] = cloned;
		}
	}
	activeObjects.delete(value);
	return result;
}

export function makeSkillFrontmatterJsonSafe(
	value: unknown,
	filePath: string,
): { frontmatter: SkillFrontmatter; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];
	const cloned = cloneJsonSafeValue(value, "frontmatter", filePath, new Set(), diagnostics);
	if (cloned === OMIT_VALUE || Array.isArray(cloned) || cloned === null || typeof cloned !== "object") {
		if (cloned !== OMIT_VALUE) {
			diagnostics.push(
				diagnostic("frontmatter must be a mapping; the parsed value was replaced with an empty mapping", filePath),
			);
		}
		return { frontmatter: {}, diagnostics };
	}
	return { frontmatter: cloned as SkillFrontmatter, diagnostics };
}

export function normalizeBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") {
		return value;
	}
	if (value === 1) {
		return true;
	}
	if (value === 0) {
		return false;
	}
	if (typeof value !== "string") {
		return undefined;
	}

	switch (value.toLowerCase()) {
		case "true":
		case "yes":
		case "on":
		case "1":
			return true;
		case "false":
		case "no":
		case "off":
		case "0":
			return false;
		default:
			return undefined;
	}
}

function normalizeKnownBoolean(
	frontmatter: SkillFrontmatter,
	field: "disable-model-invocation" | "user-invocable" | "background",
	defaultValue: boolean,
	filePath: string,
	diagnostics: ResourceDiagnostic[],
): boolean {
	const rawValue = frontmatter[field];
	if (rawValue === undefined) {
		return defaultValue;
	}
	const normalized = normalizeBoolean(rawValue);
	if (normalized === undefined) {
		diagnostics.push(
			diagnostic(
				`${field} must be true/false, yes/no, on/off, or 1/0; using default ${String(defaultValue)}`,
				filePath,
			),
		);
		return defaultValue;
	}
	frontmatter[field] = normalized;
	return normalized;
}

export function validateAgentSkillName(name: string): string[] {
	const errors: string[] = [];
	if (name.length < 1) {
		errors.push("name is required");
	} else if (name.length > MAX_NAME_LENGTH) {
		errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
	}
	if (!/^[a-z0-9-]+$/.test(name)) {
		errors.push("name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)");
	}
	if (name.startsWith("-") || name.endsWith("-")) {
		errors.push("name must not start or end with a hyphen");
	}
	if (name.includes("--")) {
		errors.push("name must not contain consecutive hyphens");
	}
	return errors;
}

export function validateSkillDescription(description: string | undefined): string[] {
	if (!description || description.trim() === "") {
		return ["description is required"];
	}
	if (description.length > MAX_DESCRIPTION_LENGTH) {
		return [`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`];
	}
	return [];
}

export function isBareSkillCommandName(name: string): boolean {
	return (
		/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) &&
		!name.endsWith(".") &&
		!RESERVED_COMMAND_PREFIXES.some((prefix) => name.startsWith(prefix))
	);
}

function isLoadedSkill(input: SkillInput): input is LoadedSkill {
	return (
		typeof input.id === "string" &&
		typeof input.listingName === "string" &&
		typeof input.frontmatter === "object" &&
		input.frontmatter !== null &&
		Object.hasOwn(input, "argumentHint") &&
		typeof input.userInvocable === "boolean" &&
		typeof input.commandNameValid === "boolean"
	);
}

export function normalizeSkillInput(input: SkillInput): {
	skill: LoadedSkill;
	diagnostics: ResourceDiagnostic[];
} {
	if (isLoadedSkill(input)) {
		return { skill: input, diagnostics: [] };
	}

	const rawFrontmatter: SkillFrontmatter = input.frontmatter
		? { ...input.frontmatter }
		: {
				name: input.name,
				description: input.description,
				"disable-model-invocation": input.disableModelInvocation,
				...(input.argumentHint !== undefined && { "argument-hint": input.argumentHint }),
				...(input.userInvocable !== undefined && { "user-invocable": input.userInvocable }),
			};
	rawFrontmatter.name = input.name;
	rawFrontmatter.description = input.description;
	if (rawFrontmatter["disable-model-invocation"] === undefined) {
		rawFrontmatter["disable-model-invocation"] = input.disableModelInvocation;
	}
	if (rawFrontmatter["argument-hint"] === undefined && input.argumentHint !== undefined) {
		rawFrontmatter["argument-hint"] = input.argumentHint;
	}
	if (rawFrontmatter["user-invocable"] === undefined && input.userInvocable !== undefined) {
		rawFrontmatter["user-invocable"] = input.userInvocable;
	}

	const safeResult = makeSkillFrontmatterJsonSafe(rawFrontmatter, input.filePath);
	const frontmatter = safeResult.frontmatter;
	const diagnostics = [...safeResult.diagnostics];
	const disableModelInvocation = normalizeKnownBoolean(
		frontmatter,
		"disable-model-invocation",
		false,
		input.filePath,
		diagnostics,
	);
	const userInvocable = normalizeKnownBoolean(frontmatter, "user-invocable", true, input.filePath, diagnostics);
	normalizeKnownBoolean(frontmatter, "background", true, input.filePath, diagnostics);

	for (const error of validateAgentSkillName(input.name)) {
		diagnostics.push(diagnostic(error, input.filePath));
	}
	for (const error of validateSkillDescription(input.description)) {
		diagnostics.push(diagnostic(error, input.filePath));
	}
	const commandNameValid = isBareSkillCommandName(input.name);
	if (!commandNameValid) {
		diagnostics.push(
			diagnostic(`name "${input.name}" is not eligible for the bare skill command namespace`, input.filePath),
		);
	}

	return {
		skill: {
			...input,
			id: canonicalizePath(input.filePath),
			listingName: input.listingName ?? input.name,
			frontmatter,
			argumentHint:
				typeof frontmatter["argument-hint"] === "string" ? frontmatter["argument-hint"] : input.argumentHint,
			userInvocable,
			disableModelInvocation,
			commandNameValid,
		},
		diagnostics,
	};
}

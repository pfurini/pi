/**
 * Fork-owned: agent name badges (plan T7). pi-subagents `src/agent-color.ts` at 79a7c42 is the
 * behavior reference. An agent file's `color:` takes Claude Code's eight subagent color names, the
 * Agency Agents palette aliases, or six-digit hex. A valid color renders the name as a padded badge
 * on that background, with black or white text chosen by WCAG contrast; any other value keeps the
 * caller's theme styling.
 */

const NAMED_AGENT_COLORS: Readonly<Record<string, string>> = {
	// Claude Code's eight subagent colors, as its default theme renders them.
	red: "#DC2626",
	blue: "#6A9BCC",
	green: "#16A34A",
	yellow: "#CA8A04",
	purple: "#827DBD",
	orange: "#D97757",
	pink: "#C46686",
	cyan: "#0891B2",
	// Agency Agents palette aliases.
	amber: "#F59E0B",
	teal: "#008080",
	indigo: "#6366F1",
	gold: "#EAB308",
	"neon-green": "#10B981",
	"neon-cyan": "#06B6D4",
	"metallic-blue": "#3B82F6",
	violet: "#8B5CF6",
	rose: "#F43F5E",
	lime: "#84CC16",
	gray: "#6B7280",
	grey: "#6B7280",
	fuchsia: "#D946EF",
	slate: "#64748B",
	navy: "#1E3A8A",
};

const CUBE_VALUES = [0, 95, 135, 175, 215, 255];
const GRAY_VALUES = Array.from({ length: 24 }, (_, index) => 8 + index * 10);
const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
/** Relative luminance above which black text reads better than white (WCAG). */
const LUMINANCE_THRESHOLD = 0.179;

interface Rgb {
	r: number;
	g: number;
	b: number;
}

/** What the badge needs from Pi's theme. */
export interface BadgeTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
	getColorMode?(): "truecolor" | "256color";
}

export interface AgentNameStyle {
	/** The theme foreground the name keeps when the agent has no valid color. */
	fallbackColor?: string;
	/** An enclosing background to reapply after the badge, instead of resetting it. */
	restoreBackground?: string;
	bold?: boolean;
}

/** A color name or `#RRGGBB`, as `#RRGGBB` in upper case; undefined for anything else. */
export function resolveAgentColor(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const normalized = value.trim().toLowerCase();
	const resolved = NAMED_AGENT_COLORS[normalized] ?? normalized;
	return /^#[0-9a-f]{6}$/i.test(resolved) ? resolved.toUpperCase() : undefined;
}

function parseHex(hex: string): Rgb {
	return {
		r: Number.parseInt(hex.slice(1, 3), 16),
		g: Number.parseInt(hex.slice(3, 5), 16),
		b: Number.parseInt(hex.slice(5, 7), 16),
	};
}

/** The index of the entry of `values` closest to `value`. */
function nearest(values: readonly number[], value: number): number {
	return values.reduce(
		(best, candidate, index) => (Math.abs(value - candidate) < Math.abs(value - values[best]) ? index : best),
		0,
	);
}

/**
 * The xterm-256 index Pi's theme would pick for a color, and the color the terminal then shows.
 * The badge judges contrast against the shown color.
 */
function to256({ r, g, b }: Rgb): { index: number; rgb: Rgb } {
	const [red, green, blue] = [r, g, b].map((channel) => nearest(CUBE_VALUES, channel));
	const distance = (other: Rgb) =>
		0.299 * (r - other.r) ** 2 + 0.587 * (g - other.g) ** 2 + 0.114 * (b - other.b) ** 2;
	const grayIndex = nearest(GRAY_VALUES, Math.round(0.299 * r + 0.587 * g + 0.114 * b));
	const gray = { r: GRAY_VALUES[grayIndex], g: GRAY_VALUES[grayIndex], b: GRAY_VALUES[grayIndex] };
	const cube = { r: CUBE_VALUES[red], g: CUBE_VALUES[green], b: CUBE_VALUES[blue] };
	// Only a near-neutral color takes the gray ramp; any other keeps its tint.
	if (Math.max(r, g, b) - Math.min(r, g, b) < 10 && distance(gray) < distance(cube)) {
		return { index: 232 + grayIndex, rgb: gray };
	}
	return { index: 16 + 36 * red + 6 * green + blue, rgb: cube };
}

function ansi(layer: "foreground" | "background", color: Rgb | number): string {
	const code = layer === "foreground" ? 38 : 48;
	return typeof color === "number"
		? `\u001b[${code};5;${color}m`
		: `\u001b[${code};2;${color.r};${color.g};${color.b}m`;
}

function relativeLuminance({ r, g, b }: Rgb): number {
	const linear = (value: number) => {
		const channel = value / 255;
		return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * `name` as a padded badge when `color` is valid, else in the caller's styling. After the badge the
 * foreground resets and the background either resets or returns to `restoreBackground`.
 */
export function renderAgentNameLabel(
	name: string,
	color: string | undefined,
	theme: BadgeTheme,
	style: AgentNameStyle = {},
): string {
	const resolved = resolveAgentColor(color);
	if (!resolved) {
		const text = style.bold ? theme.bold(name) : name;
		return style.fallbackColor ? theme.fg(style.fallbackColor, text) : text;
	}
	const rgb = parseHex(resolved);
	const quantized = (theme.getColorMode?.() ?? "truecolor") === "256color" ? to256(rgb) : undefined;
	const text = relativeLuminance(quantized?.rgb ?? rgb) > LUMINANCE_THRESHOLD ? BLACK : WHITE;
	const label = style.bold ? theme.bold(` ${name} `) : ` ${name} `;
	return (
		ansi("background", quantized?.index ?? rgb) +
		ansi("foreground", quantized ? to256(text).index : text) +
		label +
		"\u001b[39m" +
		(style.restoreBackground ?? "\u001b[49m")
	);
}

/** An agent's display name, in its configured color. */
export function renderAgentName(
	definition: { readonly name: string; readonly displayName?: string; readonly color?: string },
	theme: BadgeTheme,
	style: AgentNameStyle = {},
): string {
	return renderAgentNameLabel(definition.displayName ?? definition.name, definition.color, theme, style);
}

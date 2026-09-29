// Fork-owned: the `@` roster and the autocomplete provider (phase 3 plan T5) over a fake service, a
// fake wrapped provider and Pi's real CombinedAutocompleteProvider. The provider stacks on Pi's file
// completion and must not take it away: agent rows come first, Pi's rows follow under one prefix.
// Old pi-subagents tests at 79a7c42 this covers: agent-mention-provider (see
// docs/plans/subagents-native-phase3-evidence/old-cases.md).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AutocompleteProvider, CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "../../../src/core/fork-builtins/subagents/definitions/types.ts";
import type { SubagentView } from "../../../src/core/fork-builtins/subagents/service/records.ts";
import type { Tombstone } from "../../../src/core/fork-builtins/subagents/service/retention.ts";
import type { SubagentService } from "../../../src/core/fork-builtins/subagents/service/service.ts";
import {
	createMentionProvider,
	type MentionRow,
	mentionRoster,
} from "../../../src/core/fork-builtins/subagents/ui/mentions.ts";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function definition(name: string, over: Partial<AgentDefinition> = {}): AgentDefinition {
	return { name, description: `${name} agent.`, enabled: true, hidden: false, ...over } as unknown as AgentDefinition;
}

const EXPLORE = definition("Explore", { description: "Fast codebase exploration. Read-only, medium breadth." });

function view(over: Partial<SubagentView> & { handle: string }): SubagentView {
	return {
		id: `id-${over.handle}`,
		type: "Explore",
		definition: EXPLORE,
		description: "find flaky tests",
		status: "running",
		startedAt: 1000,
		...over,
	} as unknown as SubagentView;
}

function tombstone(over: Partial<Tombstone> = {}): Tombstone {
	return {
		handle: "explore",
		id: "t1",
		type: "Explore",
		description: "audit the RPC path",
		sessionFile: "/sessions/explore.jsonl",
		completedAt: 5000,
		...over,
	};
}

/** A service with the session's agents (newest first, as `list()` returns them), tombstones and agent types. */
function fakeService(views: SubagentView[], tombstones: Tombstone[] = [], definitions: AgentDefinition[] = []) {
	return {
		registry: { agents: new Map(definitions.map((entry) => [entry.name, entry])) },
		list: () => [...views].sort((a, b) => b.startedAt - a.startedAt),
		listTombstones: () => [...tombstones].sort((a, b) => b.completedAt - a.completedAt),
	} as unknown as SubagentService;
}

const roster =
	(...args: Parameters<typeof fakeService>) =>
	(): MentionRow[] =>
		mentionRoster(fakeService(...args));

const FILES = { items: [{ value: "@src/index.ts", label: "src/index.ts" }], prefix: "@src/" };

/** A stand-in for the provider below ours. */
function builtIn() {
	return {
		triggerCharacters: ["@", "#"],
		getSuggestions: vi.fn(async (): Promise<typeof FILES | null> => FILES),
		applyCompletion: vi.fn(() => ({ lines: ["applied"], cursorLine: 0, cursorCol: 7 })),
		shouldTriggerFileCompletion: vi.fn(() => false),
	};
}

const provide = (current: AutocompleteProvider, rows: () => readonly MentionRow[], enabled = true) =>
	createMentionProvider(
		current,
		rows,
		() => enabled,
		() => {},
	);

const suggest = (provider: AutocompleteProvider, line: string) =>
	provider.getSuggestions([line], 0, line.length, { signal: new AbortController().signal });

/** Only the rows the agents contributed. */
const agentRows = (result: Awaited<ReturnType<typeof suggest>>) =>
	(result?.items ?? []).filter((item) => !(FILES.items as unknown[]).includes(item));

const values = (result: Awaited<ReturnType<typeof suggest>>) => agentRows(result).map((item) => item.value);

describe("agent rows", () => {
	it("lists matching agents above the wrapped provider's rows, under the agents' prefix", async () => {
		const current = builtIn();
		const result = await suggest(provide(current, roster([view({ handle: "explore" })])), "@ex");
		expect(result).toEqual({
			items: [
				{ value: "@explore", label: "@explore", description: "send message · running · find flaky tests" },
				...FILES.items,
			],
			prefix: "@ex",
		});
		expect(current.getSuggestions).toHaveBeenCalledWith(
			["@ex"],
			0,
			3,
			expect.objectContaining({ signal: expect.anything() }),
		);
	});

	it("offers every agent on a bare @, and still the files", async () => {
		const rows = roster([view({ handle: "explore" }), view({ handle: "plan", startedAt: 2000 })]);
		expect((await suggest(provide(builtIn(), rows), "@"))?.items.map((item) => item.value)).toEqual([
			"@explore",
			"@plan",
			"@src/index.ts",
		]);
	});

	it("offers agents alone when no file matched", async () => {
		const current = builtIn();
		current.getSuggestions.mockResolvedValue(null);
		expect(await suggest(provide(current, roster([view({ handle: "explore" })])), "@ex")).toEqual({
			items: [{ value: "@explore", label: "@explore", description: "send message · running · find flaky tests" }],
			prefix: "@ex",
		});
	});

	it("returns the wrapped list unchanged when no handle matches or no agent exists", async () => {
		expect(await suggest(provide(builtIn(), roster([view({ handle: "explore" })])), "@zz")).toBe(FILES);
		expect(
			await suggest(
				provide(builtIn(), () => []),
				"@ex",
			),
		).toBe(FILES);
	});
});

describe("a failing wrapped provider", () => {
	it("costs its own rows, never the agents', whether it rejects or throws synchronously", async () => {
		const rejecting = builtIn();
		rejecting.getSuggestions.mockRejectedValue(new Error("inner provider exploded"));
		const throwing = builtIn();
		throwing.getSuggestions.mockImplementation(() => {
			throw new Error("sync boom");
		});
		for (const current of [rejecting, throwing]) {
			expect(values(await suggest(provide(current, roster([view({ handle: "explore" })])), "@ex"))).toEqual([
				"@explore",
			]);
		}
	});

	it("reports every failure with the same text, so the service warns once", async () => {
		const current = builtIn();
		current.getSuggestions.mockRejectedValue(new Error("inner provider exploded"));
		const warnings: string[] = [];
		const provider = createMentionProvider(
			current,
			roster([view({ handle: "explore" })]),
			() => true,
			(message) => warnings.push(message),
		);
		for (const line of ["@e", "@ex", "@exp"]) await suggest(provider, line);
		expect(new Set(warnings)).toEqual(
			new Set(["The autocomplete provider below agent mentions failed: inner provider exploded"]),
		);
	});
});

describe("row order", () => {
	it("puts running and queued agents first, then the others from the earliest", async () => {
		const rows = roster([
			view({ handle: "explore", status: "completed", startedAt: 1000 }),
			view({ handle: "explore-3", status: "running", startedAt: 3000 }),
			view({ handle: "explore-2", status: "queued", startedAt: 2000 }),
			view({ handle: "explore-4", status: "stopped", startedAt: 1500 }),
		]);
		expect(values(await suggest(provide(builtIn(), rows), "@ex"))).toEqual([
			"@explore-2",
			"@explore-3",
			"@explore",
			"@explore-4",
		]);
	});

	it("lists live agents before evicted ones, and both before startable types", async () => {
		const rows = roster(
			[view({ handle: "plan", type: "Plan", definition: definition("Plan") })],
			[tombstone()],
			[definition("code-review", { description: "Reviews a diff." })],
		);
		expect(values(await suggest(provide(builtIn(), rows), "@"))).toEqual(["@plan", "@explore", "@code-review"]);
	});
});

describe("matching", () => {
	it("matches a case-insensitive prefix", async () => {
		expect(values(await suggest(provide(builtIn(), roster([view({ handle: "explore" })])), "@EX"))).toEqual([
			"@explore",
		]);
	});

	it("completes a mention typed mid-message", async () => {
		expect((await suggest(provide(builtIn(), roster([view({ handle: "explore" })])), "ask @ex"))?.prefix).toBe("@ex");
	});
});

describe("agent types", () => {
	it("lists a type with no agent as a start, with its description's first sentence", async () => {
		const result = await suggest(provide(builtIn(), roster([], [], [EXPLORE])), "@ex");
		expect(agentRows(result)).toEqual([
			{ value: "@explore", label: "@explore", description: "start agent · Fast codebase exploration." },
		]);
		expect(result?.prefix).toBe("@ex");
	});

	it("lets a live agent own its handle, so the type does not list twice", async () => {
		const result = await suggest(provide(builtIn(), roster([view({ handle: "explore" })], [], [EXPLORE])), "@ex");
		expect(agentRows(result)).toEqual([
			{ value: "@explore", label: "@explore", description: "send message · running · find flaky tests" },
		]);
	});

	it("lists a finished agent as a resume", async () => {
		const rows = roster([view({ handle: "explore", status: "completed" })], [], [EXPLORE]);
		expect((await suggest(provide(builtIn(), rows), "@ex"))?.items[0]?.description).toBe(
			"resume · completed · find flaky tests",
		);
	});
});

describe("what the wrapped provider answers alone", () => {
	it("a path-shaped token, an @ inside a word, and every token while mentions are off", async () => {
		const rows = roster([view({ handle: "explore" })]);
		expect(await suggest(provide(builtIn(), rows), "@explore/notes.md")).toBe(FILES);
		expect(await suggest(provide(builtIn(), rows), "mail@ex")).toBe(FILES);
		expect(await suggest(provide(builtIn(), rows, false), "@ex")).toBe(FILES);
		expect(await suggest(provide(builtIn(), rows, false), "@")).toBe(FILES);
	});

	it("never lists a nested agent, which has no handle", async () => {
		const nested = view({ handle: "unused", parentId: "id-lead" });
		const rows = roster([{ ...nested, handle: undefined } as SubagentView]);
		expect(await suggest(provide(builtIn(), rows), "@")).toBe(FILES);
	});
});

describe("composing with other providers", () => {
	const types = roster([], [], [definition("Explore", { description: "Fast codebase exploration." })]);

	/** A foreign wrapper that owns `#` and delegates everything else. */
	function hashWrapper(current: AutocompleteProvider): AutocompleteProvider {
		return {
			triggerCharacters: ["#"],
			getSuggestions: async (lines, line, col, options) =>
				/(^|\s)#\w*$/.test((lines[line] ?? "").slice(0, col))
					? { items: [{ value: "#general", label: "#general" }], prefix: "#" }
					: current.getSuggestions(lines, line, col, options),
			applyCompletion: (...args) => current.applyCompletion(...args),
		};
	}

	it("wraps a provider registered before it, and is reached through one registered after it", async () => {
		const inner = provide(hashWrapper(builtIn()), types);
		expect(values(await suggest(inner, "@ex"))).toEqual(["@explore"]);
		expect((await suggest(inner, "#gen"))?.items.map((item) => item.value)).toEqual(["#general"]);
		expect(await suggest(inner, "@src/")).toBe(FILES);
		const outer = hashWrapper(provide(builtIn(), types));
		expect(values(await suggest(outer, "@ex"))).toEqual(["@explore"]);
		expect((await suggest(outer, "#g"))?.items.map((item) => item.value)).toEqual(["#general"]);
	});

	it("declares only @, so Pi unions the chain's characters", () => {
		const wrappers = [hashWrapper, (current: AutocompleteProvider) => provide(current, types)];
		let provider: AutocompleteProvider = builtIn();
		const collected: string[] = [];
		for (const wrap of wrappers) {
			provider = wrap(provider);
			collected.push(...(provider.triggerCharacters ?? []));
		}
		expect(provider.triggerCharacters).toEqual(["@"]);
		expect([...new Set(collected)]).toEqual(["#", "@"]);
	});

	it("carries no state from one build of the chain to the next", async () => {
		const first = provide(builtIn(), roster([view({ handle: "explore" })]));
		expect(values(await suggest(first, "@ex"))).toEqual(["@explore"]);
		const plan = view({ handle: "plan", type: "Plan", definition: definition("Plan") });
		const second = provide(builtIn(), roster([plan]));
		expect(values(await suggest(second, "@pl"))).toEqual(["@plan"]);
		expect(second.triggerCharacters).toEqual(first.triggerCharacters);
	});
});

describe("against Pi's real provider", () => {
	function real(): CombinedAutocompleteProvider {
		const dir = mkdtempSync(join(tmpdir(), "pi-mention-provider-"));
		dirs.push(dir);
		return new CombinedAutocompleteProvider([], dir, null);
	}
	const provider = () => provide(real(), roster([view({ handle: "explore" })]));

	it("inserts the handle and a space at a line's start and mid-line", async () => {
		const start = provider();
		const atStart = await suggest(start, "@ex");
		if (!atStart) throw new Error("no suggestions");
		expect(start.applyCompletion(["@ex"], 0, 3, atStart.items[0], atStart.prefix)).toEqual({
			lines: ["@explore "],
			cursorLine: 0,
			cursorCol: 9,
		});
		const middle = provider();
		const midLine = await suggest(middle, "ask @ex");
		if (!midLine) throw new Error("no suggestions");
		expect(middle.applyCompletion(["ask @ex"], 0, 7, midLine.items[0], midLine.prefix)).toEqual({
			lines: ["ask @explore "],
			cursorLine: 0,
			cursorCol: 13,
		});
	});

	it("keeps the text after the cursor", async () => {
		const p = provider();
		const suggestions = await suggest(p, "@ex");
		if (!suggestions) throw new Error("no suggestions");
		expect(p.applyCompletion(["@ex please"], 0, 3, suggestions.items[0], suggestions.prefix).lines).toEqual([
			"@explore  please",
		]);
	});

	it("inserts a file row from the agents' prefix, character for character", async () => {
		const p = provider();
		const suggestions = await suggest(p, "@ex");
		if (!suggestions) throw new Error("no suggestions");
		const fileRow = { value: "@examples/agent-tool-description.md", label: "agent-tool-description.md" };
		expect(p.applyCompletion(["@ex"], 0, 3, fileRow, suggestions.prefix).lines).toEqual([
			"@examples/agent-tool-description.md ",
		]);
		expect(p.applyCompletion(["ask @ex now"], 0, 7, fileRow, suggestions.prefix).lines).toEqual([
			"ask @examples/agent-tool-description.md  now",
		]);
	});

	it("declares trigger characters the editor accepts", () => {
		for (const character of provider().triggerCharacters ?? []) {
			expect(character).toHaveLength(1);
			expect(character).not.toBe("/");
			expect(character.trim()).toBe(character);
		}
	});
});

describe("delegation", () => {
	it("hands applyCompletion and the file-completion gate to the wrapped provider, and declares @ alone", () => {
		const current = builtIn();
		const provider = provide(current, () => []);
		const item = { value: "@explore", label: "@explore" };
		expect(provider.applyCompletion(["@ex"], 0, 3, item, "@ex")).toEqual({
			lines: ["applied"],
			cursorLine: 0,
			cursorCol: 7,
		});
		expect(current.applyCompletion).toHaveBeenCalledWith(["@ex"], 0, 3, item, "@ex");
		expect(provider.shouldTriggerFileCompletion?.(["/model"], 0, 6)).toBe(false);
		expect(provider.triggerCharacters).toEqual(["@"]);
	});
});

describe("named and evicted agents", () => {
	const named = view({ handle: "explore", alias: "auth-audit", description: "audit the auth flow" });

	it("lists a named agent once, under its alias, with its type", async () => {
		expect(agentRows(await suggest(provide(builtIn(), roster([named])), "@"))).toEqual([
			{
				value: "@auth-audit",
				label: "@auth-audit",
				description: "send message · Explore · running · audit the auth flow",
			},
		]);
	});

	it("repeats no type for an unnamed agent", async () => {
		expect(
			(await suggest(provide(builtIn(), roster([view({ handle: "explore" })])), "@"))?.items[0]?.description,
		).toBe("send message · running · find flaky tests");
	});

	it("keeps a named agent's type handle out of the startable types", () => {
		expect(mentionRoster(fakeService([named], [], [EXPLORE])).map((row) => row.handle)).toEqual(["auth-audit"]);
	});

	it("lists an evicted agent as a resume, after the live ones", async () => {
		expect(agentRows(await suggest(provide(builtIn(), roster([], [tombstone()])), "@"))).toEqual([
			{ value: "@explore", label: "@explore", description: "resume · Explore · audit the RPC path" },
		]);
		const both = roster([view({ handle: "plan", type: "Plan", definition: definition("Plan") })], [tombstone()]);
		expect(values(await suggest(provide(builtIn(), both), "@"))).toEqual(["@plan", "@explore"]);
	});

	it("keeps an aliased tombstone's type handle reserved, and lists no type whose handle a tombstone holds", () => {
		expect(
			mentionRoster(fakeService([], [tombstone({ alias: "auth-audit" })], [EXPLORE])).map((row) => row.handle),
		).toEqual(["auth-audit"]);
		const rows = mentionRoster(fakeService([], [tombstone()], [EXPLORE]));
		expect(rows.map((row) => `${row.kind} ${row.handle}`)).toEqual(["tombstone explore"]);
	});
});

describe("display names", () => {
	const auditor = definition("Explore", { displayName: "Auth Auditor" });

	it("names a named agent and an evicted one by the agent's display_name", async () => {
		const named = view({
			handle: "explore",
			alias: "auth-audit",
			definition: auditor,
			description: "audit the auth flow",
		});
		expect((await suggest(provide(builtIn(), roster([named])), "@"))?.items[0]?.description).toBe(
			"send message · Auth Auditor · running · audit the auth flow",
		);
		expect(
			(await suggest(provide(builtIn(), roster([], [tombstone()], [auditor])), "@"))?.items[0]?.description,
		).toBe("resume · Auth Auditor · audit the RPC path");
	});

	it("falls back to the raw type without a display_name", async () => {
		expect(
			(await suggest(provide(builtIn(), roster([], [tombstone()], [EXPLORE])), "@"))?.items[0]?.description,
		).toBe("resume · Explore · audit the RPC path");
	});
});

describe("hidden and disabled agents", () => {
	it("lists no skill-bundled agent, running or evicted", () => {
		const skill = definition("skill:worker", { hidden: true });
		const plain = definition("worker");
		const running = view({ handle: "skill-worker", type: skill.name, definition: skill, description: "skill work" });
		const evicted = tombstone({ handle: "skill-worker-2", id: "b", type: skill.name, description: "old skill work" });
		expect(mentionRoster(fakeService([running], [evicted], [skill, plain])).map((row) => row.handle)).toEqual([
			"worker",
		]);
	});

	it("keeps a skill-bundled agent's handle reserved, running or evicted, so no type row lists under it", () => {
		const skill = definition("audit:checker", { hidden: true });
		const plain = definition("audit-checker");
		const running = view({ handle: "audit-checker", type: skill.name, definition: skill });
		expect(mentionRoster(fakeService([running], [], [skill, plain]))).toEqual([]);
		const evicted = tombstone({ handle: "audit-checker", type: skill.name });
		expect(mentionRoster(fakeService([], [evicted], [skill, plain]))).toEqual([]);
	});

	it("never lists a disabled type as a start, but still lists its existing agent", () => {
		const disabled = definition("idle", { enabled: false });
		const existing = view({ handle: "idle", type: "idle", definition: disabled, status: "completed" });
		expect(mentionRoster(fakeService([], [], [disabled])).map((row) => row.handle)).toEqual([]);
		expect(mentionRoster(fakeService([existing], [], [disabled])).map((row) => `${row.kind} ${row.handle}`)).toEqual([
			"record idle",
		]);
	});
});

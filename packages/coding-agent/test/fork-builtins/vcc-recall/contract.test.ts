// Fork-owned: the model-facing definition of vcc_recall equals pi-vcc 0.8.0's src/tools/recall.ts:19-54.
// The literals below were recorded from pi-vcc 0.8.0 on 2026-09-25 (docs/plans/vcc-recall-builtin.plan.md, R3).
import { describe, expect, it } from "vitest";
import { recallTool } from "./session.ts";

const PI_VCC_DESCRIPTION =
	"Recall earlier parts of the current session — decisions made, files touched, commands run, including anything dropped by compaction. Reach for this before telling the user you no longer have the context. Plain keywords work best; a regex pattern is also accepted. Results are paged (page); pass expand with entry indices to read full untruncated content. Use mode:'touched' to list files worked on in this session with their entry indices, and #N:path to drill into a file's content from an entry (#N:path:full for all lines). Note: apply_patch paths (inside the diff payload) and bash redirects do not appear in the touched index. Only the current session is searchable — earlier sessions are not.";

const PI_VCC_PROMPT_SNIPPET =
	"vcc_recall: recall earlier parts of this session before saying the context is gone. Plain keywords work best; scope:'all' widens to other conversation branches. mode:'touched' lists files worked on; #N:path drills into a file's content from an entry.";

const PI_VCC_PARAMETERS = {
	type: "object",
	properties: {
		query: {
			type: "string",
			description:
				"What to recall, in plain keywords (e.g. 'redis cache decision'). Multi-word queries are ranked by relevance. A regex pattern also works.",
		},
		expand: {
			type: "array",
			items: { type: "number" },
			description: "Entry indices to return full untruncated content for",
		},
		page: {
			type: "number",
			description: "Page number (1-based) for paginated search results. Default: 1.",
		},
		scope: {
			anyOf: [
				{ type: "string", const: "lineage" },
				{ type: "string", const: "all" },
			],
			description:
				"Default 'lineage' covers the active conversation path. Use 'all' to also reach messages from other branches, such as turns that were edited or retried.",
		},
		mode: {
			anyOf: [
				{ type: "string", const: "hybrid" },
				{ type: "string", const: "touched" },
			],
			description:
				"What to show. hybrid (default) = normal search; touched = aggregated files-by-path with entry indices.",
		},
	},
};

describe("vcc_recall contract", () => {
	it("keeps pi-vcc 0.8.0's name, label, description, prompt snippet and parameter schema", () => {
		const tool = recallTool();
		expect(tool.name).toBe("vcc_recall");
		expect(tool.label).toBe("VCC Recall");
		expect(tool.description).toBe(PI_VCC_DESCRIPTION);
		expect(tool.promptSnippet).toBe(PI_VCC_PROMPT_SNIPPET);
		expect(JSON.parse(JSON.stringify(tool.parameters))).toEqual(PI_VCC_PARAMETERS);
	});
});

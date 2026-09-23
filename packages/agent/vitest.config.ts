import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const telemetrySrcIndex = fileURLToPath(new URL("../telemetry/src/index.ts", import.meta.url));
const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const aiSrcCompat = fileURLToPath(new URL("../ai/src/compat.ts", import.meta.url));
const aiEstimate = fileURLToPath(new URL("../ai/src/utils/estimate.ts", import.meta.url));
const aiUuid = fileURLToPath(new URL("../ai/src/utils/uuid.ts", import.meta.url));
const chordSrcIndex = fileURLToPath(new URL("../chord/src/index.ts", import.meta.url));
const chordSrcContext = fileURLToPath(new URL("../chord/src/context/index.ts", import.meta.url));
const chordSrcDelta = fileURLToPath(new URL("../chord/src/delta/index.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("./src/index.ts", import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000, // 30 seconds for API calls
		reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
		silent: "passed-only",
	},
	resolve: {
		conditions: ["source"],
		alias: [
			{ find: /^@earendil-works\/pi-telemetry$/, replacement: telemetrySrcIndex },
			{ find: /^@earendil-works\/chord$/, replacement: chordSrcIndex },
			{ find: /^@earendil-works\/chord\/context$/, replacement: chordSrcContext },
			{ find: /^@earendil-works\/chord\/delta$/, replacement: chordSrcDelta },
			{ find: /^@earendil-works\/pi-agent-core$/, replacement: agentSrcIndex },
			{ find: /^@earendil-works\/pi-ai$/, replacement: aiSrcIndex },
			{ find: /^@earendil-works\/pi-ai\/utils\/estimate$/, replacement: aiEstimate },
			{ find: /^@earendil-works\/pi-ai\/utils\/uuid$/, replacement: aiUuid },
			{ find: /^@earendil-works\/pi-ai\/compat$/, replacement: aiSrcCompat },
		],
	},
	ssr: { resolve: { conditions: ["source"] } },
});

/**
 * Fork-owned: subagent usage (pi-subagents `src/usage.ts` at 79a7c42). A record's usage sums
 * every assistant message of every run exactly once, so a resume adds only its new turns. The
 * display total leaves out `cacheRead`, which each call re-reads in full; reported usage keeps it,
 * because Pi bills and counts it that way for the session's own messages.
 *
 * `reportUsage` hands subagent spend to the parent session: Pi folds a tool result's `usage` into
 * the session's totals. Background agents finish between tool calls, so their spend waits in a
 * pool until the next subagent tool result carries it.
 */
import type { Usage } from "@earendil-works/pi-ai";

export function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function addUsage(total: Usage, delta: Usage): void {
	total.input += delta.input;
	total.output += delta.output;
	total.cacheRead += delta.cacheRead;
	total.cacheWrite += delta.cacheWrite;
	total.totalTokens += delta.totalTokens;
	total.cost.input += delta.cost.input;
	total.cost.output += delta.cost.output;
	total.cost.cacheRead += delta.cost.cacheRead;
	total.cost.cacheWrite += delta.cost.cacheWrite;
	total.cost.total += delta.cost.total;
}

/** The display total: input, output and cache writes, without the re-read cached prefix. */
export function displayTokens(usage: Usage): number {
	return usage.input + usage.output + usage.cacheWrite;
}

/** Spend not yet reported to the parent session. `take` empties it, so each message is reported once. */
export class PendingUsage {
	private pending = emptyUsage();
	private dirty = false;

	add(delta: Usage): void {
		addUsage(this.pending, delta);
		this.dirty = true;
	}

	/** Everything accumulated since the last take, or undefined when nothing was spent. */
	take(): Usage | undefined {
		if (!this.dirty) return undefined;
		const taken = this.pending;
		this.pending = emptyUsage();
		this.dirty = false;
		return taken;
	}
}

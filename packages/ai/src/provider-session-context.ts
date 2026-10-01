/** Local execution metadata for a provider request, never model input or vendor metadata. */
export interface ProviderSessionContext {
	/**
	 * Id of the AgentSession whose stream wrapper serves the request, independent of the routing sessionId.
	 * A subagent child carries its own id here, not its parent's.
	 */
	readonly agentSessionId: string;
	/** Serving session's working directory. */
	readonly cwd: string;
	/** Serving session's agent configuration directory. */
	readonly agentDir: string;
}

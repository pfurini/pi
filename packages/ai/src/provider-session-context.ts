/** Local execution metadata for a provider request, never model input or vendor metadata. */
export interface ProviderSessionContext {
	/** Session whose stream wrapper serves the request, independent of the routing sessionId. */
	readonly ownerSessionId: string;
	/** Serving session's working directory. */
	readonly cwd: string;
	/** Serving session's agent configuration directory. */
	readonly agentDir: string;
}

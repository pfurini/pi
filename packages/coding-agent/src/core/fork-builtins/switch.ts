/**
 * Fork-owned: the `PI_FORK_BUILTINS` switch (ADR-0009). This leaf module has no imports, so the
 * base-tool path reads the switch without loading the fork's built-in extensions.
 */

/** False when `PI_FORK_BUILTINS=off`. The loader reads it at construction; the fork's base tools at each runtime build. */
export function forkBuiltinsEnabled(): boolean {
	return process.env.PI_FORK_BUILTINS !== "off";
}

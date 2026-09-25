/**
 * Fork-owned: the extensions this Pi fork ships as built-ins. Every DefaultResourceLoader
 * loads them after the caller's factories, including under `noExtensions`.
 *
 * The ported packages live under `packages/builtins/` as npm workspaces. No dependency is
 * declared on them: each name resolves through the monorepo's workspace links, and each
 * package loads through the jiti-backed module loader that loads any extension path.
 * `PI_FORK_BUILTINS=off` disables them; coding-agent's vitest config sets it (ADR-0009).
 */
import { createRequire } from "node:module";
import { loadExtensionFactoryFromPath } from "./extensions/loader.ts";
import type { ExtensionFactory, InlineExtension } from "./extensions/types.ts";

export const FORK_BUILTIN_PACKAGES: readonly string[] = ["@juicesharp/rpiv-ask-user-question"];

const requireFromHere = createRequire(import.meta.url);

function packageFactory(packageName: string): ExtensionFactory {
	return async (pi) => {
		const factory = await loadExtensionFactoryFromPath(requireFromHere.resolve(packageName));
		if (!factory) {
			throw new Error(`Built-in extension ${packageName} does not export a factory`);
		}
		await factory(pi);
	};
}

/** The built-ins for the given package names. Tests pass their own names; production uses the fork list. */
export function createForkBuiltInExtensions(packageNames: readonly string[]): InlineExtension[] {
	return packageNames.map((name) => ({ name, factory: packageFactory(name), hidden: true }));
}

/** The fork's built-ins, or none when `PI_FORK_BUILTINS=off`. Read at each loader construction. */
export function forkBuiltInExtensions(): InlineExtension[] {
	if (process.env.PI_FORK_BUILTINS === "off") {
		return [];
	}
	return createForkBuiltInExtensions(FORK_BUILTIN_PACKAGES);
}

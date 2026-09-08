/**
 * The two switches for pi's startup network operations.
 *
 * PI_OFFLINE disables every startup network operation: package installs and
 * update checks, tool downloads, the version check, install telemetry and
 * the model catalog refresh.
 *
 * PI_SKIP_STARTUP_INSTALL disables only the operations that write code or
 * caches the next session executes or trusts: package installs and update
 * checks, tool downloads, the version check and install telemetry. The model
 * catalog refresh stays on. A sandboxed session (pi-fence) sets it, because
 * those writes are denied inside the sandbox while the catalog is wanted.
 */

function isTruthy(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function isOfflineModeEnabled(): boolean {
	return isTruthy(process.env.PI_OFFLINE);
}

/** True under PI_OFFLINE or PI_SKIP_STARTUP_INSTALL. */
export function isStartupInstallSkipped(): boolean {
	return isOfflineModeEnabled() || isTruthy(process.env.PI_SKIP_STARTUP_INSTALL);
}

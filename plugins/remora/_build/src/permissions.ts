import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

import type { BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";

/**
 * Path-confinement gate.
 *
 * pi's tools (`@earendil-works/pi-coding-agent`) resolve `~/`, absolute, and
 * `../` paths without confining to the workspace root — `resolveToCwd` only
 * detects escapes for display, it does not prevent them; it also expands `~/`
 * to the user's homedir (via `normalizePath({ expandTilde: true })`). remora
 * enforces confinement here, as a `beforeToolCall` policy gate, mirroring pi's
 * resolution so the gate sees the same path pi will ultimately read.
 *
 * Write-gating is handled structurally instead of by a gate: in read-only mode
 * remora simply does not register `bash` / `edit` / `write` (see `tools.ts`),
 * so there is no mutating tool to block and no bash command to whitelist.
 * `bash` in `--write` mode is unrestricted by design (the user opted in).
 */
interface GateArgs {
	path?: unknown;
}

/**
 * Build the `beforeToolCall` gate. Returning `{ block: true, reason }` makes pi
 * feed the reason back to the model as an error tool result.
 */
export function makeBeforeToolCall(workspaceRoot: string) {
	const root = resolve(workspaceRoot);

	return async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
		const args = (ctx.args ?? {}) as GateArgs;
		if (typeof args.path === "string" && escapesRoot(args.path, root)) {
			return { block: true, reason: "permission denied: path escapes the workspace root" };
		}
		return undefined;
	};
}

/**
 * Expand a leading `~` / `~/` to the user's homedir, matching pi's
 * `normalizePath({ expandTilde: true })`. `~user/` (other users) is not
 * expanded — it stays literal and is then confined by `resolve` (rare; pi
 * itself only special-cases the current user's `~`).
 */
function expandTilde(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

/**
 * True when `target` resolves outside `root`.
 *
 * Mirrors pi's resolution: `~` is expanded first, then the path is resolved
 * against `root` (absolute paths ignore `root`, so they escape → blocked).
 * For paths that already exist on disk, symlinks are resolved (`realpathSync`)
 * so an in-root symlink pointing outside root cannot bypass the gate; paths
 * that do not yet exist (e.g. a file `write` is about to create) fall back to
 * the lexical resolution.
 */
export function escapesRoot(target: string, root: string): boolean {
	const expanded = target.startsWith("~") ? expandTilde(target) : target;
	let resolved = resolve(root, expanded);
	try {
		resolved = realpathSync(resolved);
	} catch {
		// Path does not exist yet — keep the lexical resolution (new-file case).
	}
	return resolved !== root && !resolved.startsWith(root + sep);
}

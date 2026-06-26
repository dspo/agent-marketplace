import { resolve, sep } from "node:path";

import type { BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";

/**
 * Path-confinement gate.
 *
 * pi's tools (`@earendil-works/pi-coding-agent`) resolve `~/`, absolute, and
 * `../` paths without confining to the workspace root — `resolveToCwd` only
 * detects escapes for display, it does not prevent them. remora enforces
 * confinement here, as a `beforeToolCall` policy gate, for every tool whose
 * schema takes a `path` argument (read / edit / write / grep / find / ls).
 *
 * Write-gating is handled structurally instead of by a gate: in read-only mode
 * remora simply does not register `bash` / `edit` / `write` (see `tools.ts`),
 * so there is no mutating tool to block and no bash command to whitelist.
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

/** True when `target` resolves outside `root`. */
export function escapesRoot(target: string, root: string): boolean {
	const resolved = resolve(root, target);
	return resolved !== root && !resolved.startsWith(root + sep);
}

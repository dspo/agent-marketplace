import { resolve, sep } from "node:path";

import type { BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";

/**
 * Tools that write to disk. Unavailable in read-only mode. `bash` is NOT here:
 * it is always registered and gated by the read-only command whitelist below.
 */
export const MUTATING_TOOLS = new Set(["write_file", "edit_file"]);

/** Shell metacharacters that enable chaining/substitution; reject before whitelisting. */
const SHELL_METACHARS = /[;&|`$(){}<>\n\r]/;

/** First-word whitelist for `bash` while in read-only mode. */
const READONLY_BASH = /^\s*(ls|cat|head|tail|wc|grep|rg|find|fd|tree|stat|file|git\s+(diff|log|status|show|blame))\b/;

/** True when a shell command is safe to run in read-only mode. */
export function isReadOnlyCommand(command: string): boolean {
	if (SHELL_METACHARS.test(command)) return false;
	return READONLY_BASH.test(command);
}

interface GateArgs {
	path?: unknown;
	command?: unknown;
}

/**
 * Build the `beforeToolCall` gate. Returning `{ block: true, reason }` makes pi
 * feed the reason back to the model as an error tool result.
 */
export function makeBeforeToolCall(write: boolean, workspaceRoot: string) {
	const root = resolve(workspaceRoot);

	return async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
		const name = ctx.toolCall.name;
		const args = (ctx.args ?? {}) as GateArgs;

		if (!write && MUTATING_TOOLS.has(name)) {
			return { block: true, reason: `permission denied: ${name} is unavailable in read-only mode` };
		}

		if (!write && name === "bash") {
			const command = typeof args.command === "string" ? args.command : "";
			if (!isReadOnlyCommand(command)) {
				return { block: true, reason: "permission denied: only simple read-only shell commands are allowed in read-only mode" };
			}
		}

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

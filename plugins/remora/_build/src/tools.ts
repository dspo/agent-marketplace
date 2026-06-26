import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	createBashTool,
	createEditTool,
	createReadOnlyTools,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";

/** Options controlling which tools are exposed. */
export interface ToolOptions {
	write?: boolean;
}

/**
 * Build the tool set, confined to `cwd`.
 *
 * Tools are not hand-rolled — they come from `@earendil-works/pi-coding-agent`
 * (a normal npm dependency, bundled by esbuild). pi's read-only preset is
 * `read / grep / find / ls` (no bash); write mode additionally registers
 * `bash / edit / write`. Path confinement to the workspace root is enforced
 * separately by `permissions.ts`'s `beforeToolCall` gate (pi resolves `~/`,
 * absolute, and `../` paths without confining).
 */
export function buildTools(cwd: string, opts: ToolOptions = {}): AgentTool[] {
	const readOnly = createReadOnlyTools(cwd); // read, grep, find, ls
	if (!opts.write) return readOnly;
	return [...readOnly, createBashTool(cwd), createEditTool(cwd), createWriteTool(cwd)];
}

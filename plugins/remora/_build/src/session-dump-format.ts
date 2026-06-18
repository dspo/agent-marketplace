import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

/**
 * Full plain-text/markdown session dump, ported from oh-my-pi's
 * `session-dump-format.ts` and trimmed to remora's deps.
 *
 * Renders a prelude (system prompt, configuration, tool inventory) followed by
 * the message history as per-message markdown headings: `## User`, `## Assistant`
 * (with `<thinking>` blocks and `### Tool Call: <name>` + JSON args), and
 * `### Tool Result: <name>`. Meant for `/dump`, manual review, bug reports.
 *
 * Trimmed vs oh-my-pi: no `renderToolInventory`/`renderDelimitedThinking`
 * (pi-ai dialect helpers) and no `YAML from "bun"` — tool args render as JSON,
 * thinking renders in a fenced `<thinking>` block. The bashExecution/custom/
 * branchSummary message roles are absent from remora (it only produces
 * user/assistant/toolResult), so those branches are omitted.
 */
export interface SessionDumpToolInfo {
	name: string;
	description: string;
}

export interface FormatSessionDumpTextOptions {
	messages: readonly AgentMessage[];
	systemPrompt?: string | null;
	model?: Model<any> | null;
	tools?: readonly SessionDumpToolInfo[];
}

function renderDumpHeader(options: FormatSessionDumpTextOptions): string[] {
	const lines: string[] = [];

	if (options.systemPrompt && options.systemPrompt.length > 0) {
		lines.push("## System Prompt", "", options.systemPrompt, "");
	}

	lines.push("## Configuration", "");
	lines.push(`Model: ${options.model ? `${options.model.provider}/${options.model.id}` : "(not selected)"}`);
	lines.push("");

	const tools = options.tools ?? [];
	if (tools.length > 0) {
		lines.push("## Available Tools", "");
		for (const tool of tools) {
			lines.push(`- **${tool.name}**: ${tool.description.replace(/\s+/g, " ").trim()}`);
		}
		lines.push("");
	}

	return lines;
}

/** Render a tool call's args as a fenced JSON block, eliding empty. */
function renderArgs(args: Record<string, unknown> | undefined): string[] {
	if (!args || typeof args !== "object") return [];
	const entries = Object.entries(args);
	if (entries.length === 0) return [];
	return ["```json", JSON.stringify(args, null, 2), "```"];
}

/** Append the per-message markdown-heading transcript. */
function appendMarkdownTranscript(lines: string[], messages: readonly AgentMessage[]): void {
	for (const msg of messages) {
		if (msg.role === "user") {
			lines.push("## User", "");
			if (typeof msg.content === "string") {
				lines.push(msg.content);
			} else {
				for (const c of msg.content) {
					if (c.type === "text") lines.push(c.text);
					else lines.push("[Image]");
				}
			}
			lines.push("");
		} else if (msg.role === "assistant") {
			lines.push("## Assistant", "");
			for (const c of msg.content) {
				if (c.type === "text") {
					lines.push(c.text);
				} else if (c.type === "thinking") {
					if (c.thinking.trim().length === 0) continue;
					lines.push("<thinking>", c.thinking, "</thinking>", "");
				} else if (c.type === "toolCall") {
					lines.push(`### Tool Call: ${c.name}`, "");
					lines.push(...renderArgs(c.arguments));
					lines.push("");
				}
			}
		} else if (msg.role === "toolResult") {
			lines.push(`### Tool Result: ${msg.toolName}${msg.isError ? " (error)" : ""}`, "");
			for (const c of msg.content) {
				if (c.type === "text") {
					lines.push("```", c.text, "```");
				} else if (c.type === "image") {
					lines.push("[Image output]");
				}
			}
			lines.push("");
		}
	}
}

/**
 * Format messages and session metadata as markdown/plain text.
 *
 * `messages` is a session's message array. `systemPrompt`/`model`/`tools` are
 * the session's resolved config (optional — omitted for a message-only dump).
 */
export function formatSessionDumpText(options: FormatSessionDumpTextOptions): string {
	const lines = renderDumpHeader(options);
	appendMarkdownTranscript(lines, options.messages);
	return lines.join("\n").trim();
}

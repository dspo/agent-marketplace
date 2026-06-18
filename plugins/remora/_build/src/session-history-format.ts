import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";

/**
 * Concise markdown transcript serializer, ported from oh-my-pi's
 * `session-history-format.ts` and trimmed to remora's message types.
 *
 * Emits a compressed transcript: full user/assistant text, each tool call +
 * its result collapsed to a single line `→ name(primaryArg) ⇒ ok · N lines`,
 * thinking elided by default. No system prompt, no tool catalog — this is the
 * density you'd feed to another LLM (an advisor) or scan by eye.
 *
 * (oh-my-pi also renders bashExecution/pythonExecution/custom/hookMessage/
 * branchSummary/compactionSummary message roles; remora only produces
 * user/assistant/toolResult, so those branches are omitted.)
 */
export interface HistoryFormatOptions {
	/** Optional H1 prepended to the transcript. */
	title?: string;
	/** Render assistant thinking blocks (default: elided). */
	includeThinking?: boolean;
}

/** Max length of the primary-arg summary inside `→ tool(...)` lines. */
const PRIMARY_ARG_MAX = 120;

/** Per-tool preference order for the most informative scalar argument. */
const PRIMARY_ARG_KEYS = [
	"path",
	"file_path",
	"filePath",
	"command",
	"cmd",
	"pattern",
	"url",
	"query",
	"prompt",
	"assignment",
	"message",
	"op",
	"name",
	"id",
] as const;

/** Collapse whitespace runs and truncate to `max` chars with an ellipsis. */
function oneLine(text: string, max = PRIMARY_ARG_MAX): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Minimal content-block shape — text/image blocks carry displayable text. */
type ContentBlock = { type: string; text?: string };

/** Join the text blocks of a string-or-blocks content field. Images become `[image]`. */
function contentToText(content: string | readonly ContentBlock[]): string {
	if (typeof content === "string") return content;
	const parts: string[] = [];
	for (const block of content) {
		if (block.type === "text" && block.text) parts.push(block.text);
		else parts.push("[image]");
	}
	return parts.join("\n");
}

function lineCount(text: string): number {
	return text ? text.split("\n").length : 0;
}

/** Pick the most informative scalar argument of a tool call. */
function primaryArg(args: Record<string, unknown> | undefined): string {
	if (!args || typeof args !== "object") return "";
	for (const key of PRIMARY_ARG_KEYS) {
		const value = args[key];
		if (typeof value === "string" && value.length > 0) return oneLine(value);
		if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")) {
			return oneLine(value.join(", "));
		}
	}
	// Fallback: first scalar string arg, then a compact JSON of the rest.
	const rest: Record<string, unknown> = {};
	let restCount = 0;
	for (const key in args) {
		const value = args[key];
		if (typeof value === "string" && value.length > 0) return oneLine(value);
		rest[key] = value;
		restCount++;
	}
	if (restCount === 0) return "";
	try {
		return oneLine(JSON.stringify(rest));
	} catch {
		return "";
	}
}

/** One line per tool call: `→ read(src/foo.ts:50-80) ⇒ ok · 31 lines`. */
function toolCallLine(
	name: string,
	args: Record<string, unknown> | undefined,
	result: ToolResultMessage | undefined,
): string {
	const head = `→ ${name}(${primaryArg(args)})`;
	if (!result) return `${head} ⇒ pending`;
	const text = contentToText(result.content);
	const lines = lineCount(text);
	const count = `${lines} ${lines === 1 ? "line" : "lines"}`;
	if (result.isError) {
		const firstLine = oneLine(text.split("\n", 1)[0] ?? "");
		return firstLine ? `${head} ⇒ error · ${count} — ${firstLine}` : `${head} ⇒ error · ${count}`;
	}
	return `${head} ⇒ ok · ${count}`;
}

/**
 * Format a message array as a concise markdown transcript.
 *
 * `messages` is a session's message array (the same shape loaded from a session
 * file for resume, or held in `agent.state.messages`).
 */
export function formatSessionHistoryMarkdown(messages: AgentMessage[], opts?: HistoryFormatOptions): string {
	const lines: string[] = [];
	if (opts?.title) lines.push(`# ${opts.title}`, "");

	// Index tool results by call id so each toolCall collapses to one line.
	const resultsByCallId = new Map<string, ToolResultMessage>();
	for (const msg of messages) {
		if (msg.role === "toolResult") resultsByCallId.set(msg.toolCallId, msg);
	}
	const consumed = new Set<string>();

	for (const msg of messages) {
		switch (msg.role) {
			case "user": {
				const text = contentToText(msg.content);
				if (!text.trim()) break;
				lines.push(`## user`, "", text, "");
				break;
			}
			case "assistant": {
				const body: string[] = [];
				for (const block of (msg as AssistantMessage).content) {
					if (block.type === "text") {
						if (block.text.trim()) body.push(block.text);
					} else if (block.type === "toolCall") {
						const result = resultsByCallId.get(block.id);
						if (result) consumed.add(block.id);
						body.push(toolCallLine(block.name, block.arguments, result));
					} else if (opts?.includeThinking && block.type === "thinking" && block.thinking.trim()) {
						body.push(`_thinking:_ ${block.thinking}`);
					}
				}
				if (body.length > 0) lines.push("## assistant", "", ...body, "");
				break;
			}
			case "toolResult": {
				// Normally consumed by its toolCall; orphans (e.g. truncated history) get a line.
				if (consumed.has(msg.toolCallId)) break;
				lines.push(toolCallLine(msg.toolName, undefined, msg), "");
				break;
			}
		}
	}

	return `${lines.join("\n").trim()}\n`;
}

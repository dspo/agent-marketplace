import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";

import { loadConfig, resolveModel } from "./config.ts";
import { makeTransformContext } from "./compaction.ts";
import type { FileEdit } from "./diff.ts";
import { makeBeforeToolCall } from "./permissions.ts";
import { loadSession, saveSession } from "./session.ts";
import { buildTools } from "./tools.ts";

export interface RunTurnOptions {
	prompt: string;
	system: string;
	write?: boolean;
	model?: string;
	sessionId: string;
	resume?: boolean;
	onProgress: (event: ProgressEvent) => void;
}

/** A compact, JSON-friendly progress event written to stderr as NDJSON. */
export interface ProgressEvent {
	type: string;
	tool?: string;
	detail?: string;
}

export interface TurnResult {
	status: number;
	finalMessage: string;
	touchedFiles: string[];
	edits: FileEdit[];
	droppedMessages: number;
	errorMessage: string | null;
}

/** Run a single task turn end-to-end and return a structured result. */
export async function runTurn(cwd: string, opts: RunTurnOptions): Promise<TurnResult> {
	const cfg = loadConfig(cwd, opts.model);
	const history = opts.resume ? loadSession(cwd, opts.sessionId) : [];

	const edits: FileEdit[] = [];
	const model = resolveModel(cfg);
	const agent = new Agent({
		initialState: {
			systemPrompt: opts.system,
			model,
			tools: buildTools(cwd, { write: Boolean(opts.write), onEdit: (e) => edits.push(e) }),
			messages: history,
		},
		beforeToolCall: makeBeforeToolCall(Boolean(opts.write), cwd),
		transformContext: makeTransformContext(model, cfg.apiKey, (note) => opts.onProgress({ type: "compaction", detail: note })),
		getApiKey: async () => cfg.apiKey,
	});

	agent.subscribe((ev) => {
		const progress = bridgeEvent(ev);
		if (progress) opts.onProgress(progress);
	});

	if (opts.resume && history.length > 0) {
		agent.state.messages = [...history, { role: "user", content: opts.prompt, timestamp: 0 }];
		await agent.continue();
	} else {
		await agent.prompt(opts.prompt);
	}

	const dropped = saveSession(cwd, opts.sessionId, agent.state.messages);
	const error = agent.state.errorMessage ?? null;
	return {
		status: error ? 1 : 0,
		finalMessage: extractFinalText(agent.state.messages),
		touchedFiles: [...new Set(edits.map((e) => e.path))],
		edits,
		droppedMessages: dropped,
		errorMessage: error,
	};
}

/** Map a pi AgentEvent to a compact progress event, or null to suppress noise. */
function bridgeEvent(ev: AgentEvent): ProgressEvent | null {
	switch (ev.type) {
		case "tool_execution_start":
			return { type: "tool_start", tool: ev.toolName };
		case "tool_execution_end":
			return { type: "tool_end", tool: ev.toolName, detail: ev.isError ? "error" : "ok" };
		case "turn_start":
			return { type: "turn_start" };
		case "agent_end":
			return { type: "agent_end" };
		case "message_update":
		case "message_start":
			return null; // token-level streaming noise; not useful as progress
		default:
			return { type: ev.type };
	}
}

/** Extract the final assistant text from the transcript. */
function extractFinalText(messages: AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: string; content?: unknown };
		if (m.role !== "assistant") continue;
		if (typeof m.content === "string") return m.content;
		if (Array.isArray(m.content)) {
			const parts = m.content
				.filter((c): c is { type: "text"; text: string } => (c as { type?: string }).type === "text")
				.map((c) => c.text);
			if (parts.length > 0) return parts.join("\n");
		}
	}
	return "";
}

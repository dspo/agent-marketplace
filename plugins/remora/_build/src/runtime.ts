import { type AgentMessage, Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent } from "@earendil-works/pi-agent-core";

import { buildModels, loadConfig, resolveModel } from "./config.ts";
import { COMPACTED_SUMMARY, makeTransformContext } from "./compaction.ts";
import { makeBeforeToolCall } from "./permissions.ts";
import {
	appendActiveToolsChangeEntry,
	appendCompactionEntry,
	appendLineageEntry,
	appendMessageEntry,
	appendModelChangeEntry,
	appendTitleEntry,
	loadMessagesWithEntryIds,
	openOrCreateSession,
	type ResumeMode,
} from "./session.ts";
import { buildTools } from "./tools.ts";

export interface RunTurnOptions {
	prompt: string;
	system: string;
	write?: boolean;
	model?: string;
	resumeMode: ResumeMode;
	resumeId?: string;
	onProgress: (event: ProgressEvent) => void;
}

/** A compact, JSON-friendly progress event written to stderr as NDJSON. */
export interface ProgressEvent {
	type: string;
	tool?: string;
	detail?: string;
	id?: string;
	path?: string;
}

export interface TurnResult {
	status: number;
	sessionId: string;
	sessionPath: string;
	finalMessage: string;
	errorMessage: string | null;
}

/** Run a single task turn end-to-end and return a structured result. */
export async function runTurn(cwd: string, opts: RunTurnOptions): Promise<TurnResult> {
	const cfg = loadConfig(cwd, opts.model);

	const { session, metadata, isNew } = await openOrCreateSession(cwd, opts.resumeMode, opts.resumeId);
	opts.onProgress({ type: "session", id: metadata.id, path: metadata.path });

	const { messages: history, entryIdByMessage } = isNew
		? { messages: [] as AgentMessage[], entryIdByMessage: new WeakMap<object, string>() }
		: await loadMessagesWithEntryIds(session);

	// Idempotent persistence tracker: by message reference, so a compacted
	// history never re-appends already-persisted messages and originals are
	// captured exactly once (the compaction callback persists the summarized
	// tail before it is discarded from state.messages). Message objects keep
	// their reference even when pi appends streaming content blocks in place —
	// in-place mutation does not change identity, so the WeakSet stays valid.
	const persisted = new WeakSet<object>();
	for (const m of history) persisted.add(m);

	async function flush(messages: AgentMessage[]): Promise<void> {
		for (const m of messages) {
			if (persisted.has(m)) continue;
			// The synthetic compaction-summary message is represented on resume by
			// the `compaction` entry, not a `message` entry — skip it.
			if (isCompactedSummary(m)) {
				persisted.add(m);
				continue;
			}
			await appendMessageEntry(session, m);
			persisted.add(m);
		}
	}

	const model = resolveModel(cfg);
	const models = buildModels(cfg, model);
	const tools = buildTools(cwd, { write: Boolean(opts.write) });
	const agent = new Agent({
		initialState: {
			systemPrompt: opts.system,
			model,
			tools,
			messages: history,
		},
		beforeToolCall: makeBeforeToolCall(cwd),
		transformContext: makeTransformContext(
			model,
			models,
			(note) => opts.onProgress({ type: "compaction", detail: note }),
			async (info) => {
				await flush(info.summarized);
				// Record an exact cut point so resume slices the history to
				// [summary, ...recent] instead of reloading the summarized originals
				// (which would inflate the context past the window on resume).
				await appendCompactionEntry(session, {
					summary: info.summary,
					firstKeptEntryId: info.firstKeptEntryId,
					tokensBefore: info.tokensBefore,
				});
			},
			// Resolve a kept history message → its persisted entry id (from the
			// load-time map). Brand-new-this-turn messages have no id yet and fall
			// back to "", which loadMessages treats as "cut at session start".
			(m) => entryIdByMessage.get(m as object),
		),
		getApiKey: async () => cfg.apiKey,
	});

	agent.subscribe((ev) => {
		const progress = bridgeEvent(ev);
		if (progress) opts.onProgress(progress);
	});

	if (isNew) {
		await appendLineageEntry(session);
		await appendModelChangeEntry(session, cfg.provider, cfg.model);
		await appendActiveToolsChangeEntry(session, tools.map((t) => t.name));
		await appendTitleEntry(session, opts.prompt);
	}

	if (!isNew && history.length > 0) {
		agent.state.messages = [...history, { role: "user", content: opts.prompt, timestamp: 0 }];
		await agent.continue();
	} else {
		await agent.prompt(opts.prompt);
	}

	await flush(agent.state.messages);

	const error = agent.state.errorMessage ?? null;
	return {
		status: error ? 1 : 0,
		sessionId: metadata.id,
		sessionPath: metadata.path,
		finalMessage: extractFinalText(agent.state.messages),
		errorMessage: error,
	};
}

/** True for the synthetic message emitted by `transformContext` after a compaction. */
function isCompactedSummary(message: AgentMessage): boolean {
	return (message as unknown as Record<symbol, unknown>)[COMPACTED_SUMMARY] === true;
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

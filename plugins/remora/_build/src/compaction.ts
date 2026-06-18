import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	DEFAULT_COMPACTION_SETTINGS,
	estimateContextTokens,
	estimateTokens,
	generateSummary,
	shouldCompact,
} from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

/** Marker set on the synthetic summary message so it isn't double-persisted as a `message` entry. */
export const COMPACTED_SUMMARY = Symbol("remora:compactedSummary");

/** A compaction event handed to the caller before the summarized messages are discarded. */
export interface CompactInfo {
	summary: string;
	tokensBefore: number;
	/** Index in the (pre-compaction) messages array of the first kept message. */
	keepFromIndex: number;
	/** The original messages being summarized (the caller persists these as `message` entries). */
	summarized: AgentMessage[];
}

/**
 * Build a `transformContext` hook that compacts long histories before each LLM
 * call. Below the threshold it returns the messages untouched (zero cost — the
 * common case for a single-turn task). Above it, recent messages are kept and
 * the older middle is replaced by a generated summary. Summarization failure
 * degrades gracefully to the original messages rather than aborting the turn.
 *
 * When compaction actually fires, `onCompact` is awaited with the originals
 * BEFORE they are discarded, so the caller can persist them + record a
 * `compaction` entry. The synthetic summary message carries {@link
 * COMPACTED_SUMMARY} so the caller skips re-persisting it (the compaction entry
 * stands in for it on resume).
 */
export function makeTransformContext(
	model: Model<"openai-completions">,
	apiKey: string,
	onNotice?: (note: string) => void,
	onCompact?: (info: CompactInfo) => Promise<void> | void,
): (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]> {
	const settings = DEFAULT_COMPACTION_SETTINGS;

	return async (messages, signal) => {
		if (messages.length < 4) return messages;

		const estimate = estimateContextTokens(messages);
		if (!shouldCompact(estimate.tokens, model.contextWindow, settings)) {
			return messages;
		}

		// Keep the most recent messages within the retention budget; summarize the rest.
		const keepFrom = recentCutIndex(messages, settings.keepRecentTokens);
		if (keepFrom <= 0) return messages; // nothing old enough to compact

		const toSummarize = messages.slice(0, keepFrom);
		const recent = messages.slice(keepFrom);

		const result = await generateSummary(toSummarize, model, settings.reserveTokens, apiKey, undefined, signal);
		if (!result.ok) {
			onNotice?.(`compaction skipped: ${result.error.message}`);
			return messages;
		}

		// Persist the originals + emit the audit event before discarding them.
		if (onCompact) {
			await onCompact({ summary: result.value, tokensBefore: estimate.tokens, keepFromIndex: keepFrom, summarized: toSummarize });
		}

		onNotice?.(`compacted ${toSummarize.length} messages (~${estimate.tokens} ctx tokens)`);
		// Synthetic message standing in for the summarized history. `timestamp: 0`
		// flags it as non-real (it was never produced at a wall-clock instant); it
		// also carries the COMPACTED_SUMMARY marker so runtime skips persisting it
		// as a `message` entry — the `compaction` entry stands in for it on resume.
		const summaryMessage = {
			role: "user" as const,
			content: `[Earlier conversation summarized]\n\n${result.value}`,
			timestamp: 0,
			[COMPACTED_SUMMARY]: true,
		};
		return [summaryMessage, ...recent];
	};
}

/**
 * Walk backward accumulating estimated tokens; return the index of the first
 * message to keep so the kept tail stays within `keepRecentTokens`.
 */
function recentCutIndex(messages: AgentMessage[], keepRecentTokens: number): number {
	let acc = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		acc += estimateTokens(messages[i]);
		if (acc > keepRecentTokens) return i + 1;
	}
	return 0;
}

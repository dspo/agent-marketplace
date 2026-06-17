import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	DEFAULT_COMPACTION_SETTINGS,
	estimateContextTokens,
	estimateTokens,
	generateSummary,
	shouldCompact,
} from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

/**
 * Build a `transformContext` hook that compacts long histories before each LLM
 * call. Below the threshold it returns the messages untouched (zero cost — the
 * common case for a single-turn rescue). Above it, recent messages are kept and
 * the older middle is replaced by a generated summary. Summarization failure
 * degrades gracefully to the original messages rather than aborting the turn.
 */
export function makeTransformContext(
	model: Model<"openai-completions">,
	apiKey: string,
	onNotice?: (note: string) => void,
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

		onNotice?.(`compacted ${toSummarize.length} messages (~${estimate.tokens} ctx tokens)`);
		const summaryMessage: AgentMessage = {
			role: "user",
			content: `[Earlier conversation summarized]\n\n${result.value}`,
			timestamp: 0,
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

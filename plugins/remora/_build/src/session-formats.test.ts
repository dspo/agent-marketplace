import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { formatSessionHistoryMarkdown } from "./session-history-format.ts";
import { formatSessionDumpText } from "./session-dump-format.ts";
import { deriveSessionStatus } from "./session-listing.ts";

/** A user message that's just text. */
function user(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: 0 } as AgentMessage;
}

/** An assistant turn with the given content blocks. */
function assistant(content: unknown[]): AgentMessage {
	return { role: "assistant", content, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 0, api: "openai-completions", provider: "dashscope", model: "qwen3.7-max" } as unknown as AgentMessage;
}

function toolResult(callId: string, name: string, text: string, isError = false): AgentMessage {
	return { role: "toolResult", toolCallId: callId, toolName: name, content: [{ type: "text", text }], isError, timestamp: 0 } as unknown as AgentMessage;
}

test("history format collapses tool call + result into one line", () => {
	const msgs: AgentMessage[] = [
		user("find the bug"),
		assistant([
			{ type: "text", text: "Reading the file..." },
			{ type: "toolCall", id: "c1", name: "read_file", arguments: { path: "src/cli.ts", limit: 50 } },
		]),
		toolResult("c1", "read_file", "line1\nline2\nline3"),
	];
	const out = formatSessionHistoryMarkdown(msgs);
	assert.match(out, /## user/);
	assert.match(out, /find the bug/);
	assert.match(out, /## assistant/);
	assert.match(out, /Reading the file\.\.\./);
	assert.match(out, /→ read_file\(src\/cli\.ts\) ⇒ ok · 3 lines/);
});

test("history format renders tool errors", () => {
	const msgs: AgentMessage[] = [
		assistant([{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "make build" } }]),
		toolResult("c1", "bash", "Error: ENOENT", true),
	];
	const out = formatSessionHistoryMarkdown(msgs);
	assert.match(out, /→ bash\(make build\) ⇒ error ·/);
});

test("history format elides thinking by default, includes with opt", () => {
	const msgs: AgentMessage[] = [
		assistant([
			{ type: "thinking", thinking: "secret deliberation" },
			{ type: "text", text: "answer" },
		]),
	];
	const def = formatSessionHistoryMarkdown(msgs);
	assert.ok(!def.includes("secret deliberation"), "thinking elided by default");
	const withThinking = formatSessionHistoryMarkdown(msgs, { includeThinking: true });
	assert.ok(withThinking.includes("secret deliberation"), "thinking shown with opt");
});

test("dump format renders header + per-message blocks", () => {
	const msgs: AgentMessage[] = [
		user("do the thing"),
		assistant([{ type: "toolCall", id: "c1", name: "grep", arguments: { pattern: "TODO" } }]),
		toolResult("c1", "grep", "found TODOs"),
	];
	const out = formatSessionDumpText({ messages: msgs, systemPrompt: "you are remora", model: { provider: "dashscope", id: "qwen3.7-max" } as never, tools: [{ name: "grep", description: "search" }] });
	assert.match(out, /## System Prompt/);
	assert.match(out, /Model: dashscope\/qwen3\.7-max/);
	assert.match(out, /## Available Tools/);
	assert.match(out, /- \*\*grep\*\*: search/);
	assert.match(out, /## User/);
	assert.match(out, /### Tool Call: grep/);
	assert.match(out, /### Tool Result: grep/);
	assert.match(out, /"pattern": "TODO"/);
});

test("deriveSessionStatus classifies the tail message", () => {
	const line = (type: string, extra: string) => JSON.stringify({ type, ...JSON.parse(extra) });
	// complete: assistant stopReason=stop, no trailing toolCall
	assert.equal(deriveSessionStatus(line("message", '{"message":{"role":"assistant","stopReason":"stop","content":[{"type":"text","text":"done"}]}}')), "complete");
	// interrupted: assistant with trailing toolCall (no result)
	assert.equal(deriveSessionStatus(line("message", '{"message":{"role":"assistant","stopReason":"toolUse","content":[{"type":"toolCall","id":"x","name":"r","arguments":{}}]}}')), "interrupted");
	// error
	assert.equal(deriveSessionStatus(line("message", '{"message":{"role":"assistant","stopReason":"error","content":[]}}')), "error");
	// aborted
	assert.equal(deriveSessionStatus(line("message", '{"message":{"role":"assistant","stopReason":"aborted","content":[]}}')), "aborted");
	// pending: user message last
	assert.equal(deriveSessionStatus(line("message", '{"message":{"role":"user","content":"hi"}}')), "pending");
	// unknown: empty
	assert.equal(deriveSessionStatus(""), "unknown");
	// unknown: no message entries
	assert.equal(deriveSessionStatus(line("session_info", '{"name":"x"}')), "unknown");
	// skips a partial leading fragment, finds the message line
	assert.equal(deriveSessionStatus('{"partial... \n' + line("message", '{"message":{"role":"user","content":"hi"}}')), "pending");
});

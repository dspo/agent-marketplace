import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { JsonlSessionRepo, type AgentMessage } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

import { loadAllMessages, loadMessages, loadMessagesWithEntryIds } from "./session.ts";

/** Build a real pi JsonlSessionRepo against a temp sessions root, scoped to one cwd. */
function makeRepo(): { repo: JsonlSessionRepo; cwd: string } {
	const root = mkdtempSync(join(tmpdir(), "remora-slice-"));
	const cwd = mkdtempSync(join(tmpdir(), "remora-slice-cwd-"));
	const repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd }), sessionsRoot: root });
	return { repo, cwd };
}

function user(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: 0 } as AgentMessage;
}

test("loadMessages: no compaction → all message entries", async () => {
	const { repo, cwd } = makeRepo();
	const session = await repo.create({ cwd, id: "s1" });
	await session.appendMessage(user("alpha"));
	await session.appendMessage(user("beta"));
	const msgs = await loadMessages(session);
	assert.equal(msgs.length, 2);
	assert.equal((msgs[0] as AgentMessage & { content: string }).content, "alpha");
});

test("loadMessages: one compaction with exact firstKeptEntryId → [summary, kept, after]", async () => {
	const { repo, cwd } = makeRepo();
	const session = await repo.create({ cwd, id: "s2" });
	// m0..m4 will be summarized; m5..m9 kept.
	const ids: string[] = [];
	for (let i = 0; i < 10; i++) ids.push(await session.appendMessage(user(`m${i}`)));
	const firstKeptId = ids[5]; // entry id of m5
	await session.appendCompaction("summary of m0..m4", firstKeptId, 1000, undefined, true);
	// messages produced AFTER compaction
	await session.appendMessage(user("after1"));

	const msgs = await loadMessages(session);
	// summary + m5..m9 (5) + after1 = 1 + 5 + 1 = 7
	assert.equal(msgs.length, 7);
	// First is the synthetic summary.
	assert.match((msgs[0] as AgentMessage & { content: string }).content, /Earlier conversation summarized/);
	assert.match((msgs[0] as AgentMessage & { content: string }).content, /summary of m0\.\.m4/);
	// Then the kept tail, in order.
	assert.equal((msgs[1] as AgentMessage & { content: string }).content, "m5");
	assert.equal((msgs[5] as AgentMessage & { content: string }).content, "m9");
	assert.equal((msgs[6] as AgentMessage & { content: string }).content, "after1");
	// The summarized originals must NOT be present.
	for (const m of msgs) {
		const c = (m as AgentMessage & { content: string }).content;
		assert.ok(!/^m[0-4]$/.test(c), `summarized original ${c} should be dropped`);
	}
});

test("loadMessages: firstKeptEntryId='' cuts at session start (summary + after only)", async () => {
	const { repo, cwd } = makeRepo();
	const session = await repo.create({ cwd, id: "s3" });
	for (let i = 0; i < 5; i++) await session.appendMessage(user(`m${i}`));
	await session.appendCompaction("full summary", "", 1000, undefined, true);
	await session.appendMessage(user("after1"));
	const msgs = await loadMessages(session);
	// summary + after1 = 2; m0..m4 dropped.
	assert.equal(msgs.length, 2);
	assert.match((msgs[0] as AgentMessage & { content: string }).content, /full summary/);
	assert.equal((msgs[1] as AgentMessage & { content: string }).content, "after1");
});

test("loadMessagesWithEntryIds: kept messages map back to entry ids", async () => {
	const { repo, cwd } = makeRepo();
	const session = await repo.create({ cwd, id: "s4" });
	const ids: string[] = [];
	for (let i = 0; i < 8; i++) ids.push(await session.appendMessage(user(`m${i}`)));
	await session.appendCompaction("sum", ids[4], 1000, undefined, true);
	await session.appendMessage(user("after"));
	const { messages, entryIdByMessage } = await loadMessagesWithEntryIds(session);
	// m4..m7 (kept) must resolve to their real entry ids; summary + after have none.
	const m4 = messages.find((m) => (m as AgentMessage & { content: string }).content === "m4")!;
	assert.equal(entryIdByMessage.get(m4 as object), ids[4]);
	const summary = messages[0]!;
	assert.equal(entryIdByMessage.get(summary as object), undefined);
});

test("loadMessages: multi-round — last compaction governs the slice", async () => {
	const { repo, cwd } = makeRepo();
	const session = await repo.create({ cwd, id: "s5" });
	const ids: string[] = [];
	for (let i = 0; i < 12; i++) ids.push(await session.appendMessage(user(`m${i}`)));
	// round 1: summarize m0..m3, keep from m4
	await session.appendCompaction("sum1", ids[4], 1000, undefined, true);
	await session.appendMessage(user("after1"));
	// round 2: summarize up to some later point, keep from m6
	await session.appendCompaction("sum2", ids[6], 2000, undefined, true);
	await session.appendMessage(user("after2"));
	const msgs = await loadMessages(session);
	// LAST compaction wins: sum2 + m6..m11 + after1 + after2.
	assert.match((msgs[0] as AgentMessage & { content: string }).content, /sum2/);
	const contents = msgs.map((m) => (m as AgentMessage & { content: string }).content);
	assert.deepEqual(contents, ["[Earlier conversation summarized]\n\nsum2", "m6", "m7", "m8", "m9", "m10", "m11", "after1", "after2"]);
});

test("loadAllMessages: ignores compaction, returns every raw message entry", async () => {
	const { repo, cwd } = makeRepo();
	const session = await repo.create({ cwd, id: "s6" });
	for (let i = 0; i < 5; i++) await session.appendMessage(user(`m${i}`));
	await session.appendCompaction("sum", "ignored", 1000, undefined, true);
	const msgs = await loadAllMessages(session);
	assert.equal(msgs.length, 5); // no summary injection, no slicing
	assert.equal((msgs[0] as AgentMessage & { content: string }).content, "m0");
});

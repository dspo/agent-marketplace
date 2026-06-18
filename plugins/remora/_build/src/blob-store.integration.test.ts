import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { JsonlSessionRepo } from "@earendil-works/pi-agent-core";

import { appendMessageEntry, loadMessages } from "./session.ts";

const TMP = join(homedir(), `.remora-blob-itest-${process.pid}`);
process.env.REMORA_SESSIONS_DIR = join(TMP, "projects");
process.env.REMORA_BLOBS_DIR = join(TMP, "blobs");

// Valid base64 of real bytes (>= threshold), so the externalize→bytes→rehydrate
// round-trip is exact — unlike a hand-rolled base64-looking string.
const imgBytes = Buffer.alloc(2048, 0x89);
const BIG_PNG_B64 = imgBytes.toString("base64");

function newRepo(cwd: string) {
	return new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd }), sessionsRoot: process.env.REMORA_SESSIONS_DIR! });
}

test("image block externalized on persist, blob written, rehydrated on load", async () => {
	const cwd = join(TMP, "ws");
	const repo = newRepo(cwd);
	const session = await repo.create({ cwd, id: "itest-1" });
	const meta = await session.getMetadata();

	await appendMessageEntry(session, {
		role: "user",
		content: [{ type: "image", data: BIG_PNG_B64, mimeType: "image/png" }],
		timestamp: 0,
	} as never);

	// JSONL must reference a blob, not carry the raw base64.
	const persisted = readFileSync(meta.path, "utf8");
	assert.ok(!persisted.includes(BIG_PNG_B64), "raw base64 must not be in JSONL");
	const ref = persisted.match(/blob:sha256:[0-9a-f]+/)?.[0];
	assert.ok(ref, "JSONL carries a blob:sha256: ref");
	const hash = ref!.slice("blob:sha256:".length);

	// Blob bytes on disk, round-trip exact.
	const blobPath = join(process.env.REMORA_BLOBS_DIR!, hash);
	assert.ok(existsSync(blobPath), "blob file written");
	assert.deepEqual(readFileSync(blobPath), imgBytes);

	// Reopen + load rehydrates the ref back to the original base64.
	const reopened = await repo.open(meta);
	const msgs = await loadMessages(reopened);
	const block = (msgs[0] as unknown as { content: Array<{ type: string; data: string }> }).content[0];
	assert.equal(block.type, "image");
	assert.equal(block.data, BIG_PNG_B64, "rehydrated back to original base64");
});

test("dedup: identical image across messages → one blob", async () => {
	const cwd = join(TMP, "ws2");
	const repo = newRepo(cwd);
	const session = await repo.create({ cwd, id: "itest-2" });
	await appendMessageEntry(session, { role: "user", content: [{ type: "image", data: BIG_PNG_B64, mimeType: "image/png" }], timestamp: 0 } as never);
	await appendMessageEntry(session, { role: "assistant", content: [{ type: "image", data: BIG_PNG_B64, mimeType: "image/png" }], timestamp: 0 } as never);
	const entries = readdirSync(process.env.REMORA_BLOBS_DIR!);
	assert.equal(entries.length, 1, "one blob for identical content");
});

test("cleanup", () => rmSync(TMP, { recursive: true, force: true }));

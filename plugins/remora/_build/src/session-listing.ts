import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { type JsonlSessionMetadata, JsonlSessionRepo } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

/** Lifecycle state of a session file, derived from its tail. */
export type SessionStatus = "complete" | "interrupted" | "aborted" | "error" | "pending" | "unknown";

/** Tail window read to derive status. Captures the last message entry. */
const STATUS_SUFFIX_BYTES = 32 * 1024;

/** Session metadata + derived status + title, for listing. */
export interface SessionListItem {
	id: string;
	createdAt: string;
	title?: string;
	status: SessionStatus;
}

interface TailMessage {
	role?: string;
	stopReason?: string;
	content?: unknown;
}

function isToolCallBlock(block: unknown): boolean {
	return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "toolCall";
}

/** Classify a session's status from the last persisted message entry's role/stopReason. Ported from oh-my-pi. */
function statusFromTailMessage(message: TailMessage): SessionStatus {
	switch (message.role) {
		case "assistant": {
			switch (message.stopReason) {
				case "error":
					return "error";
				case "aborted":
					return "aborted";
				case "length":
					return "interrupted";
			}
			const content = message.content;
			if (Array.isArray(content) && content.some(isToolCallBlock)) return "interrupted";
			return "complete";
		}
		case "toolResult":
			return "interrupted";
		case "user":
			return "pending";
		default:
			return "unknown";
	}
}

/**
 * Derive a {@link SessionStatus} from a tail window of a session file. Entries
 * are newline-terminated on write; within the window only the first line can be
 * a partial fragment (it fails to parse and is skipped). Walk backwards to the
 * last `message` entry and classify. Ported from oh-my-pi's `deriveSessionStatus`.
 */
export function deriveSessionStatus(suffix: string): SessionStatus {
	if (!suffix) return "unknown";
	const lines = suffix.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		// Every persisted entry is `JSON.stringify(obj)` → starts with `{`. Cheaply
		// rejects blank lines and the leading partial fragment without parsing it.
		if (line.charCodeAt(0) !== 123) continue;
		let entry: { type?: string; message?: TailMessage };
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (entry.type === "message" && entry.message) {
			return statusFromTailMessage(entry.message);
		}
	}
	return "unknown";
}

/** Read the tail bytes of a file as UTF-8 (best-effort; returns "" on read error). */
function readTail(path: string, bytes: number): string {
	try {
		const fd = readFileSync(path);
		return fd.subarray(Math.max(0, fd.length - bytes)).toString("utf8");
	} catch {
		return "";
	}
}

/** Read the first `session_info` entry's name from a session file (the auto/user title). */
function readTitle(path: string): string | undefined {
	try {
		const content = readFileSync(path, "utf8");
		for (const line of content.split("\n")) {
			if (line.charCodeAt(0) !== 123) continue;
			try {
				const entry = JSON.parse(line) as { type?: string; name?: string };
				if (entry.type === "session_info" && entry.name) return entry.name;
			} catch {
				// skip malformed line
			}
		}
	} catch {
		// unreadable file
	}
	return undefined;
}

function newRepo(cwd: string): JsonlSessionRepo {
	const sessionsRoot = process.env.REMORA_SESSIONS_DIR ?? join(homedir(), ".pi", "agent", "sessions");
	return new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd }), sessionsRoot });
}

/**
 * List sessions for `cwd`, newest-first, each enriched with its derived
 * {@link SessionStatus} (from the file tail) and auto-title (from the first
 * `session_info` entry). Mirrors oh-my-pi's `listSessions` at remora's scale
 * (serial scan — no parallel stride workers needed for short task sessions).
 */
export async function listSessions(cwd: string): Promise<SessionListItem[]> {
	const repo = newRepo(cwd);
	const metas = await repo.list({ cwd });
	return metas.map((meta: JsonlSessionMetadata) => ({
		id: meta.id,
		createdAt: meta.createdAt,
		title: readTitle(meta.path),
		status: deriveSessionStatus(readTail(meta.path, STATUS_SUFFIX_BYTES)),
	}));
}

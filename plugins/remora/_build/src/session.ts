import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

const MAX_SERIALIZED_BYTES = 2 * 1024 * 1024; // 2 MiB

function sessionsDir(cwd: string): string {
	return join(cwd, ".remora", "sessions");
}

function sessionPath(cwd: string, id: string): string {
	return join(sessionsDir(cwd), `${id}.json`);
}

/** Load a persisted message history. Returns [] when the session is absent. */
export function loadSession(cwd: string, id: string): AgentMessage[] {
	try {
		return JSON.parse(readFileSync(sessionPath(cwd, id), "utf8")) as AgentMessage[];
	} catch {
		return [];
	}
}

/**
 * Persist message history, capped at 2 MiB serialized. When over the cap, drop
 * the oldest messages until it fits (the system prompt lives on the Agent, not
 * in this array, so it is never at risk). Returns the number dropped.
 *
 * This is a coarse size guard; semantic compaction happens in-turn via the
 * Agent's `transformContext` hook (see compaction.ts).
 */
export function saveSession(cwd: string, id: string, messages: AgentMessage[]): number {
	mkdirSync(sessionsDir(cwd), { recursive: true });

	// Common case: serialize once and write. Only when over the cap do we drop
	// oldest messages, re-serializing the (now smaller) tail per drop.
	let serialized = JSON.stringify(messages);
	let kept = messages;
	let dropped = 0;
	if (Buffer.byteLength(serialized, "utf8") > MAX_SERIALIZED_BYTES) {
		kept = messages.slice();
		while (kept.length > 1) {
			kept.shift();
			dropped++;
			serialized = JSON.stringify(kept);
			if (Buffer.byteLength(serialized, "utf8") <= MAX_SERIALIZED_BYTES) break;
		}
	}

	writeFileSync(sessionPath(cwd, id), serialized, "utf8");
	return dropped;
}

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

import {
	type AgentMessage,
	type JsonlSessionMetadata,
	JsonlSessionRepo,
	type Session,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

const MAX_PERSIST_CHARS = 500_000;
const TRUNCATION_NOTICE = "\n\n[remora: session content truncated]";

/** How a turn wants to open its session: fresh, most-recent-for-cwd, or a specific id. */
export type ResumeMode = "new" | "continue" | "id";

/**
 * Sessions root: centralized under the global `~/.remora` dir (consistent with
 * remora's own `~/.remora/config.json`), overridable via `REMORA_SESSIONS_DIR`.
 * The per-cwd subdir below this is named by pi's `JsonlSessionRepo.encodeCwd`
 * (`--<cwd with /\:→->--`).
 */
export function sessionsRoot(): string {
	return process.env.REMORA_SESSIONS_DIR ?? join(homedir(), ".remora", "projects");
}

function newRepo(cwd: string): JsonlSessionRepo {
	return new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd }), sessionsRoot: sessionsRoot() });
}

export interface OpenedSession {
	session: Session<JsonlSessionMetadata>;
	metadata: JsonlSessionMetadata;
	isNew: boolean;
}

/**
 * Open or create a session for `cwd` according to `mode`:
 *   - `new`      → create a fresh session with a UUIDv4 id
 *   - `continue` → reopen the most-recent session for this cwd (create if none)
 *   - `id`       → reopen the specific session whose id == resumeId
 *
 * `repo.list` returns sessions newest-first by createdAt, so `--continue` is `[0]`.
 */
export async function openOrCreateSession(
	cwd: string,
	mode: ResumeMode,
	resumeId?: string,
): Promise<OpenedSession> {
	const repo = newRepo(cwd);

	if (mode === "id") {
		if (!resumeId) throw new Error("--resume requires a session id");
		const list = await repo.list({ cwd });
		const meta = list.find((m) => m.id === resumeId);
		if (!meta) throw new Error(`session not found in ${cwd}: ${resumeId}`);
		return { session: await repo.open(meta), metadata: meta, isNew: false };
	}

	if (mode === "continue") {
		const list = await repo.list({ cwd });
		if (list.length > 0) return { session: await repo.open(list[0]), metadata: list[0], isNew: false };
	}

	const session = await repo.create({ cwd, id: randomUUID() });
	return { session, metadata: await session.getMetadata(), isNew: true };
}

/** Reconstruct the message history from the session's typed entries (for resume). */
export async function loadMessages(session: Session<JsonlSessionMetadata>): Promise<AgentMessage[]> {
	return (await session.buildContext()).messages;
}

/**
 * Append `message` as a `message` entry. Returns the entry id (used to back-fill
 * a compaction entry's `firstKeptEntryId` when a message is later kept).
 */
export async function appendMessageEntry(
	session: Session<JsonlSessionMetadata>,
	message: AgentMessage,
): Promise<string> {
	return session.appendMessage(prepareForPersistence(message) as AgentMessage);
}

export interface CompactionRecord {
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
}

/** Persist a `compaction` entry marking where history was summarized. `fromHook=true`. */
export function appendCompactionEntry(
	session: Session<JsonlSessionMetadata>,
	record: CompactionRecord,
): Promise<string> {
	return session.appendCompaction(record.summary, record.firstKeptEntryId, record.tokensBefore, undefined, true);
}

/** Record the resolved model at session start (fidelity — tracks provider/model changes). */
export function appendModelChangeEntry(
	session: Session<JsonlSessionMetadata>,
	provider: string,
	modelId: string,
): Promise<string> {
	return session.appendModelChange(provider, modelId);
}

/** Auto-title derived from the first prompt, stored as a `session_info` entry. */
export function appendTitleEntry(session: Session<JsonlSessionMetadata>, firstPrompt: string): Promise<string> | undefined {
	const title = deriveTitle(firstPrompt);
	return title ? session.appendSessionName(title) : undefined;
}

/**
 * Record the parent Claude Code session id this rescue was spawned from, as a
 * `custom` entry (pi's escape hatch for extension-private data). Claude Code
 * injects `CLAUDE_CODE_SESSION_ID` (UUIDv4) into the subprocess env; when remora
 * runs outside Claude Code the env is absent and nothing is recorded.
 */
export function appendLineageEntry(session: Session<JsonlSessionMetadata>): Promise<string> | undefined {
	const claudeCodeSessionId = process.env.CLAUDE_CODE_SESSION_ID;
	return claudeCodeSessionId
		? session.appendCustomEntry("remora:lineage", { claudeCodeSessionId })
		: undefined;
}

function deriveTitle(prompt: string): string {
	const flat = prompt.replace(/\s+/g, " ").trim();
	return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}

/**
 * Deep-truncate any oversized strings before persistence (text-only guard; no
 * blob store — remora is text-centric and tool outputs are already bounded).
 * Structural sharing: returns the original value untouched when nothing changed.
 */
function prepareForPersistence<T>(value: T): T {
	if (typeof value === "string") {
		return (value.length > MAX_PERSIST_CHARS ? truncateString(value) : value) as T;
	}
	if (Array.isArray(value)) {
		let changed = false;
		const out: unknown[] = new Array(value.length);
		for (let i = 0; i < value.length; i++) {
			const item = prepareForPersistence(value[i]);
			if (item !== value[i]) changed = true;
			out[i] = item;
		}
		return (changed ? out : value) as T;
	}
	if (value && typeof value === "object") {
		let changed = false;
		const entries: Array<[string, unknown]> = [];
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			const nv = prepareForPersistence(v);
			if (nv !== v) changed = true;
			entries.push([k, nv]);
		}
		return (changed ? Object.fromEntries(entries) : value) as T;
	}
	return value;
}

function truncateString(value: string): string {
	const limit = Math.max(0, MAX_PERSIST_CHARS - TRUNCATION_NOTICE.length);
	return `${value.slice(0, limit)}${TRUNCATION_NOTICE}`;
}

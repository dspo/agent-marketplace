import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

import {
	type AgentMessage,
	type JsonlSessionMetadata,
	JsonlSessionRepo,
	type MessageEntry,
	type Session,
} from "@earendil-works/pi-agent-core";
import {
	BLOB_EXTERNALIZE_THRESHOLD,
	BlobStore,
	externalizeImageBlockSync,
	externalizeImageDataUrlSync,
	isBlobRef,
	isImageBlock,
	isImageDataUrl,
	resolveImageData,
	resolveImageDataUrl,
} from "./blob-store.ts";

/** Shared content-addressed blob store, mirroring oh-my-pi. See blob-store.ts. */
let _blobStore: BlobStore | undefined;
function blobStore(): BlobStore {
	// Lazily constructed so REMORA_BLOBS_DIR set at runtime (or in tests) is honored.
	return (_blobStore ??= new BlobStore());
}
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

/**
 * Reconstruct the message history from the session's typed entries (for resume).
 *
 * Unlike oh-my-pi (which relies on pi's `buildContext` to apply persisted
 * `compaction` entries), remora loads the **raw message entries** and lets its
 * own `transformContext` hook re-compact fresh when over threshold. This makes
 * compaction entries **audit-only** for remora — they are never used to
 * reconstruct messages — which sidesteps the multi-compaction-resume pitfall
 * (where `firstKeptEntryId=""` would wrongly drop kept messages that precede a
 * later compaction entry). Below threshold there is zero cost: `transformContext`
 * returns the messages untouched, so no summary is regenerated.
 *
 * Blob refs (`blob:sha256:<hash>`) persisted in image blocks / `image_url` fields
 * are rehydrated back to base64 / data URLs so the agent resumes with real
 * images. Missing blobs degrade gracefully (the ref string is kept as-is).
 */
export async function loadMessages(session: Session<JsonlSessionMetadata>): Promise<AgentMessage[]> {
	const entries = await session.getEntries();
	const messages = entries
		.filter((e): e is MessageEntry => e.type === "message")
		.map((e) => e.message);
	rehydrateBlobRefs(messages);
	return messages;
}

/**
 * Walk messages and resolve any `blob:sha256:<hash>` references back to their
 * base64 (image block `data`) or original data-URL (`image_url`) form. Mirrors
 * oh-my-pi's `resolveBlobRefsInEntries`, in place.
 */
function rehydrateBlobRefs(messages: AgentMessage[]): void {
	for (const msg of messages) {
		const content = (msg as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (isImageBlock(block) && isBlobRef(block.data)) {
				block.data = resolveImageData(blobStore(), block.data);
			}
		}
		const imageUrl = (msg as { image_url?: string }).image_url;
		if (typeof imageUrl === "string" && isBlobRef(imageUrl)) {
			(msg as { image_url?: string }).image_url = resolveImageDataUrl(blobStore(), imageUrl);
		}
	}
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

/** Record the active tool set at session start (aligns with oh-my-pi's tool-tracking entry). */
export function appendActiveToolsChangeEntry(
	session: Session<JsonlSessionMetadata>,
	toolNames: string[],
): Promise<string> {
	return session.appendActiveToolsChange(toolNames);
}

/**
 * Auto-title derived from the first prompt, stored as a `session_info` entry.
 * `deriveTitle` can return "" for blank/whitespace input; the guard skips the
 * entry in that case so `appendSessionName("")` is never called. (In practice
 * the prompt is validated non-empty upstream, so this is purely defensive.)
 */
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
 * Prepare a value for persistence: truncate oversized strings AND externalize
 * large image payloads to the blob store (mirroring oh-my-pi).
 *
 * - `content` arrays: image blocks whose base64 `data` is ≥ threshold become
 *   `{ …, data: "blob:sha256:<hash>" }`.
 * - `image_url` strings that are `data:image/...;base64,...` → `blob:sha256:<hash>`.
 * - any other string > MAX_PERSIST_CHARS is truncated (crypto signatures cleared,
 *   not truncated, since a partial signature is invalid).
 *
 * Structural sharing: returns the original value untouched when nothing changed.
 * The blob write is synchronous so bytes land in the page cache before the JSONL
 * line referencing them is appended (OOM-safe).
 */
function prepareForPersistence<T>(value: T, key?: string): T {
	if (typeof value === "string") {
		if (key === "image_url" && isImageDataUrl(value)) {
			return externalizeImageDataUrlSync(blobStore(), value) as T;
		}
		if (value.length > MAX_PERSIST_CHARS) {
			// Signatures must be exact or absent — truncating produces an invalid sig.
			if (key === "thinkingSignature" || key === "thoughtSignature" || key === "textSignature") {
				return "" as T;
			}
			return truncateString(value) as T;
		}
		return value;
	}
	if (Array.isArray(value)) {
		let changed = false;
		const out: unknown[] = new Array(value.length);
		for (let i = 0; i < value.length; i++) {
			// Image block inside a `content` array → externalize its base64 data.
			if (
				key === "content" &&
				isImageBlock(value[i]) &&
				!isBlobRef((value[i] as { data: string }).data) &&
				(value[i] as { data: string }).data.length >= BLOB_EXTERNALIZE_THRESHOLD
			) {
				out[i] = externalizeImageBlockSync(blobStore(), value[i]);
				changed = true;
				continue;
			}
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
			const nv = prepareForPersistence(v, k);
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

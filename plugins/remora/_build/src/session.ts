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
import { COMPACTED_SUMMARY } from "./compaction.ts";

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
 * Sessions root: shared with Pi's `~/.pi/agent/sessions/` so that `pi --session`
 * can resume a remora session. Overridable via `REMORA_SESSIONS_DIR`.
 * The per-cwd subdir below this is named by pi's `JsonlSessionRepo.encodeCwd`
 * (`--<cwd with /\:→->--`).
 */
export function sessionsRoot(): string {
	return process.env.REMORA_SESSIONS_DIR ?? join(homedir(), ".pi", "agent", "sessions");
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
 * Reconstruct the message history from the session's typed entries (for resume),
 * applying the **last** `compaction` entry the same way pi's `buildContext` does:
 * a summary message stands in for everything summarized, then only messages at
 * or after `firstKeptEntryId` (before the compaction entry) plus everything after
 * it are kept. This keeps the resumed history bounded — without it, every
 * summarized original would reload on resume and inflate the context past the
 * window, defeating the compaction that recorded the summary.
 *
 * Unlike calling pi's `buildContext()` directly, this keeps the **raw
 * `entry.message` references** so the runtime can back-fill a subsequent
 * compaction's `firstKeptEntryId` via the {@link loadMessagesWithEntryIds} map.
 *
 * Blob refs (`blob:sha256:<hash>`) are rehydrated back to base64 / data URLs so
 * the agent resumes with real images. Missing blobs degrade gracefully (the ref
 * string is kept as-is).
 */
export async function loadMessages(session: Session<JsonlSessionMetadata>): Promise<AgentMessage[]> {
	const { messages } = await loadMessagesWithEntryIds(session);
	return messages;
}

/**
 * Load **every** raw `message` entry, ignoring compaction slicing. Used for
 * `dump`/transcript review where completeness matters (shows summarized
 * originals too), as opposed to {@link loadMessages} which is compaction-aware
 * for agent resume.
 */
export async function loadAllMessages(session: Session<JsonlSessionMetadata>): Promise<AgentMessage[]> {
	const entries = await session.getEntries();
	const messages = entries
		.filter((e): e is MessageEntry => e.type === "message")
		.map((e) => e.message);
	rehydrateBlobRefs(messages);
	return messages;
}

/**
 * Like {@link loadMessages} but also returns a reference-keyed map from each raw
 * kept message to its entry id. The compaction hook uses this to record an exact
 * `firstKeptEntryId` when it keeps a history message — so the *next* resume slices
 * correctly. (Multi-round safe: the map is rebuilt every resume over that turn's
 * raw entry objects, and the compaction callback runs within the same turn, so
 * the lookup resolves to a real entry id.)
 */
export async function loadMessagesWithEntryIds(
	session: Session<JsonlSessionMetadata>,
): Promise<{ messages: AgentMessage[]; entryIdByMessage: WeakMap<object, string> }> {
	const entries = await session.getEntries();
	const entryIdByMessage = new WeakMap<object, string>();

	// Last compaction entry wins (matches pi's buildSessionContext: the loop keeps
	// overwriting `compaction`, so the most recent one governs the slice).
	let lastCompactionIdx = -1;
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i].type === "compaction") {
			lastCompactionIdx = i;
			break;
		}
	}

	const messages: AgentMessage[] = [];
	const take = (e: MessageEntry) => {
		messages.push(e.message);
		entryIdByMessage.set(e.message as object, e.id);
	};

	if (lastCompactionIdx === -1) {
		for (const e of entries) if (e.type === "message") take(e as MessageEntry);
	} else {
		const compaction = entries[lastCompactionIdx] as Extract<(typeof entries)[number], { type: "compaction" }>;
		// Summary stands in for everything dropped before the kept tail. It is a
		// runtime-only synthetic (marked), so flush never persists it as a `message`
		// entry — the `compaction` entry is its durable record.
		messages.push(summaryMessage(compaction.summary));
		// `firstKeptEntryId=""` → no entry matches, so nothing before the compaction
		// entry is kept (matches pi's buildSessionContext: the cut point is the
		// session start). Otherwise keep from the matched entry onward.
		const firstKeptId = compaction.firstKeptEntryId;
		let keeping = false;
		for (let i = 0; i < lastCompactionIdx; i++) {
			const e = entries[i];
			if (e.type !== "message") continue;
			if (!keeping && firstKeptId && e.id === firstKeptId) keeping = true;
			if (keeping) take(e as MessageEntry);
		}
		for (let i = lastCompactionIdx + 1; i < entries.length; i++) {
			const e = entries[i];
			if (e.type === "message") take(e as MessageEntry);
		}
	}

	rehydrateBlobRefs(messages);
	return { messages, entryIdByMessage };
}

/** Synthetic summary message standing in for a compaction's dropped history (resume only). */
function summaryMessage(summary: string): AgentMessage {
	return {
		role: "user",
		content: `[Earlier conversation summarized]\n\n${summary}`,
		// `timestamp: 0` flags it as non-real; COMPACTED_SUMMARY makes flush skip it.
		timestamp: 0,
		[COMPACTED_SUMMARY]: true,
	} as AgentMessage;
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

/** Record that this session was created by remora, so pi's resume can distinguish the source.
 * Uses pi's native `custom` entry mechanism — zero monkey-patching needed.
 */
export function appendAgentEntry(
	session: Session<JsonlSessionMetadata>,
): Promise<string> {
	return session.appendCustomEntry("remora:agent", "remora");
}

/**
 * Record the parent Claude Code session id this task was spawned from, as a
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

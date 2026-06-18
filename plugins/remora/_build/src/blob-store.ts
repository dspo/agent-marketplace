import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { homedir } from "node:os";

/** Reference prefix used in persisted JSONL for an externalized binary payload. */
export const BLOB_PREFIX = "blob:sha256:";

/** Minimum base64 length (≈0.75 KiB) to bother externalizing — skip tiny inline images. */
export const BLOB_EXTERNALIZE_THRESHOLD = 1024;

/** Root dir for blobs: lives under remora's global `~/.remora/`, overridable. */
export function blobsDir(): string {
	return process.env.REMORA_BLOBS_DIR ?? join(homedir(), ".remora", "blobs");
}

export interface BlobPutResult {
	hash: string;
	/** Canonical content-addressed path `<dir>/<sha256-hex>` (no extension). */
	path: string;
	/** `blob:sha256:<hash>` — the reference stored in session JSONL. */
	ref: string;
}

/**
 * Content-addressed blob store for externalizing large binary payloads (images)
 * out of session JSONL. Files are stored at `<dir>/<sha256-hex>`; the hash is
 * computed over the raw bytes (not base64). Content-addressing makes writes
 * idempotent and dedupes across sessions.
 *
 * Unlike oh-my-pi we do not write a typed sidecar (`.png` etc.): remora has no
 * `file://` consumers, the canonical hash path is what refs address, and the
 * image block already carries its `mimeType` alongside the ref. Writes are
 * synchronous so bytes reach the kernel page cache before the JSONL line that
 * references them — an OOM/SIGKILL right after cannot leave a dangling ref.
 */
export class BlobStore {
	readonly dir: string;

	constructor(dir: string = blobsDir()) {
		this.dir = dir;
	}

	/** Write raw bytes; returns the ref string `blob:sha256:<hash>`. */
	putSync(data: Buffer): BlobPutResult {
		const hash = createHash("sha256").update(data).digest("hex");
		const blobPath = join(this.dir, hash);
		// Idempotent: same content → same hash. Skip the write if already present.
		if (!existsSync(blobPath)) {
			mkdirSync(this.dir, { recursive: true });
			writeFileSync(blobPath, data);
		}
		return { hash, path: blobPath, ref: `${BLOB_PREFIX}${hash}` };
	}

	/** Read blob bytes by hash, or null if absent. */
	get(hash: string): Buffer | null {
		const blobPath = join(this.dir, hash);
		try {
			if (statSync(blobPath).isFile()) return readFileSync(blobPath);
		} catch {
			return null;
		}
		return null;
	}

	has(hash: string): boolean {
		try {
			return statSync(join(this.dir, hash)).isFile();
		} catch {
			return false;
		}
	}
}

export function isBlobRef(data: unknown): boolean {
	return typeof data === "string" && data.startsWith(BLOB_PREFIX);
}

export function parseBlobRef(data: string): string | null {
	return data.startsWith(BLOB_PREFIX) ? data.slice(BLOB_PREFIX.length) : null;
}

/** Provider transport image data URL (`data:image/...;base64,...`). */
export function isImageDataUrl(data: string): boolean {
	return data.startsWith("data:image/") && data.includes(";base64,");
}

function isImageBlock(value: unknown): value is { type: "image"; data: string; mimeType?: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: string }).type === "image" &&
		typeof (value as { data?: unknown }).data === "string"
	);
}

/**
 * Externalize an image block's base64 `data` to the blob store, returning a NEW
 * block whose `data` is the `blob:sha256:<hash>` ref. Returns the input unchanged
 * if already a ref, under threshold, or not an image block.
 */
export function externalizeImageBlockSync(
	blobStore: BlobStore,
	block: { type: "image"; data: string; mimeType?: string },
): { type: "image"; data: string; mimeType?: string } {
	if (isBlobRef(block.data) || block.data.length < BLOB_EXTERNALIZE_THRESHOLD) return block;
	const ref = blobStore.putSync(Buffer.from(block.data, "base64")).ref;
	return { ...block, data: ref };
}

/** Externalize a provider `image_url` data URL string to a blob ref (stored as UTF-8). */
export function externalizeImageDataUrlSync(blobStore: BlobStore, dataUrl: string): string {
	if (isBlobRef(dataUrl) || !isImageDataUrl(dataUrl)) return dataUrl;
	return blobStore.putSync(Buffer.from(dataUrl, "utf8")).ref;
}

/** Resolve a `blob:sha256:<hash>` ref back to base64 (image block `data`). Missing → ref as-is. */
export function resolveImageData(blobStore: BlobStore, data: string): string {
	const hash = parseBlobRef(data);
	if (!hash) return data;
	const buffer = blobStore.get(hash);
	return buffer ? buffer.toString("base64") : data;
}

/** Resolve a `blob:sha256:<hash>` ref back to the original data-URL string. Missing → ref as-is. */
export function resolveImageDataUrl(blobStore: BlobStore, data: string): string {
	const hash = parseBlobRef(data);
	if (!hash) return data;
	const buffer = blobStore.get(hash);
	return buffer ? buffer.toString("utf8") : data;
}

export { isImageBlock };

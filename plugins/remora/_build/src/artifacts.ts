import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Session-scoped artifact storage for large/truncated tool outputs, ported from
 * oh-my-pi's `artifacts.ts`.
 *
 * Artifacts are stored in a directory alongside the session JSONL file — named
 * by stripping the `.jsonl` suffix from the session file path. They are
 * addressable via `artifact://<id>` URLs: the LLM-facing tool result keeps a
 * bounded head+tail and a pointer; the full, untruncated output lives on disk
 * for recovery / dump / read-back. Unlike blobs (content-addressed, shared
 * across sessions), artifacts are session-local and sequentially numbered.
 *
 * Node port: the only change from oh-my-pi is `Bun.write(path, content)` →
 * `writeFile`; the rest already used `node:fs/promises`.
 */
function sanitizeToolType(toolType: string): string {
	const sanitized = toolType
		.replace(/[^A-Za-z0-9_-]+/g, "_")
		.slice(0, 64)
		.replace(/^_+|_+$/g, "");
	return sanitized.length > 0 ? sanitized : "tool";
}

export class ArtifactManager {
	private nextId = 0;
	private readonly dir: string;
	private dirCreated = false;
	private initialized = false;
	/**
	 * Initialization in-flight promise. `read_file` runs in parallel (pi's agent
	 * loop uses Promise.all over a message's tool calls), so multiple callers can
	 * hit `ensureDir` concurrently before the first finishes — without this guard
	 * they'd each scan existing ids from the same fs state and collide on nextId.
	 */
	private initPromise: Promise<void> | null = null;

	/** @param dir Directory holding artifact files. Created lazily on first save. */
	constructor(dir: string) {
		this.dir = dir;
	}

	get artifactsDir(): string {
		return this.dir;
	}

	/** Ensure the dir exists and nextId is scanned exactly once, even under concurrency. */
	private ensureDir(): Promise<void> {
		if (!this.initPromise) {
			// On resolve AND reject, clear the cached promise so a later call re-inits
			// (e.g. after a transient mkdir/scan failure, or if the dir is removed
			// externally). Caching a rejection would permanently wedge the manager.
			this.initPromise = (async () => {
				try {
					if (!this.dirCreated) {
						await mkdir(this.dir, { recursive: true });
						this.dirCreated = true;
					}
					if (!this.initialized) {
						await this.scanExistingIds();
						this.initialized = true;
					}
				} finally {
					this.initPromise = null;
				}
			})();
		}
		return this.initPromise;
	}

	/** Scan existing `{id}.{tool}.log` files so a resumed session continues numbering. */
	private async scanExistingIds(): Promise<void> {
		const files = await this.listFiles();
		let maxId = -1;
		for (const file of files) {
			const match = file.match(/^(\d+)\..*\.log$/);
			if (match) {
				const id = Number.parseInt(match[1], 10);
				if (id > maxId) maxId = id;
			}
		}
		this.nextId = maxId + 1;
	}

	/** Allocate a new artifact path + id without writing content. */
	async allocatePath(toolType: string): Promise<{ id: string; path: string }> {
		await this.ensureDir();
		const id = String(this.nextId++);
		return { id, path: join(this.dir, `${id}.${sanitizeToolType(toolType)}.log`) };
	}

	/** Save full content as an artifact; returns the artifact id. */
	async save(content: string, toolType: string): Promise<string> {
		const { id, path } = await this.allocatePath(toolType);
		await writeFile(path, content, "utf8");
		return id;
	}

	/** List artifact filenames; [] if the directory is absent. */
	async listFiles(): Promise<string[]> {
		try {
			return await readdir(this.dir);
		} catch {
			return [];
		}
	}

	/** Full path for an artifact id, or null if absent. */
	async getPath(id: string): Promise<string | null> {
		const files = await this.listFiles();
		const match = files.find((f) => f.startsWith(`${id}.`));
		return match ? join(this.dir, match) : null;
	}

	/** Read an artifact's content, or null if absent. */
	async read(id: string): Promise<string | null> {
		const path = await this.getPath(id);
		if (!path) return null;
		try {
			return await readFile(path, "utf8");
		} catch {
			return null;
		}
	}
}

/** Derive the artifact directory from a session JSONL path (strip `.jsonl`). */
export function artifactsDirForSession(sessionPath: string): string {
	// Defensive: if the path doesn't end in .jsonl (a cross-module implicit contract),
	// don't mkdir a dir named like the session file itself (ENOTDIR). Append a suffix.
	if (/\.jsonl$/i.test(sessionPath)) return sessionPath.replace(/\.jsonl$/i, "");
	return `${sessionPath}.artifacts`;
}

/** True for an `artifact://<id>` URL string. */
export function isArtifactUrl(value: string): boolean {
	return value.startsWith("artifact://");
}

/** Parse `artifact://<id>` → id, or null. */
export function parseArtifactUrl(value: string): string | null {
	return value.startsWith("artifact://") ? value.slice("artifact://".length) : null;
}

/** Synchronous existence check for an artifact path (used by read tool's artifact:// fast path). */
export function artifactExists(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

export { dirname };
export { existsSync };

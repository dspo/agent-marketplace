import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { type Static, type TSchema, Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";

import { type ArtifactManager, isArtifactUrl, parseArtifactUrl } from "./artifacts.ts";
import { captureOutput } from "./capture-output.ts";
import { type FileEdit, unifiedDiff } from "./diff.ts";

const MAX_READ_BYTES = 256 * 1024;
const MAX_MATCHES = 200;
const MAX_ENTRIES = 1000;
const MAX_WRITE_BYTES = 1024 * 1024;
const BASH_TIMEOUT_MS = 120_000;
const BASH_OUTPUT_CAP = 64 * 1024;
/** Inline cap for read_file: over this → spill full file to an artifact, keep head+tail. */
const READ_INLINE_CAP = 64 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules", ".remora", "dist", "build", ".next", ".cache"]);

/** Options controlling which tools are exposed and where edits are reported. */
export interface ToolOptions {
	write?: boolean;
	onEdit?: (edit: FileEdit) => void;
	/** Artifact sink for spilling oversized outputs; undefined disables artifact spilling (hard truncation). */
	artifacts?: ArtifactManager;
}

/** Resolve a user-supplied path and reject anything outside the root. */
function safeResolve(root: string, p: string): string {
	const abs = resolve(root, p);
	if (abs !== root && !abs.startsWith(root + sep)) {
		throw new Error(`path escapes workspace root: ${p}`);
	}
	return abs;
}

function text(content: string): AgentToolResult<unknown> {
	return { content: [{ type: "text", text: content }], details: undefined };
}

/** Recursively walk `dir`, yielding files relative to `root`, pruning noisy dirs. */
function* walk(root: string, dir: string, depth: number): Generator<string> {
	if (depth < 0) return;
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of entries) {
		if (SKIP_DIRS.has(name)) continue;
		const abs = resolve(dir, name);
		let isDir = false;
		try {
			isDir = statSync(abs).isDirectory();
		} catch {
			continue;
		}
		if (isDir) {
			yield* walk(root, abs, depth - 1);
		} else {
			yield relative(root, abs);
		}
	}
}

function tool<S extends TSchema>(t: {
	name: string;
	label: string;
	description: string;
	parameters: S;
	executionMode?: "sequential" | "parallel";
	run: (p: Static<S>) => AgentToolResult<unknown> | Promise<AgentToolResult<unknown>>;
}): AgentTool {
	return {
		name: t.name,
		label: t.label,
		description: t.description,
		parameters: t.parameters,
		executionMode: t.executionMode ?? "parallel",
		execute: async (_id, params) => t.run(params as Static<S>),
	};
}

const readParams = Type.Object({
	path: Type.String({ description: "File path relative to the workspace root." }),
});

const lsParams = Type.Object({
	path: Type.Optional(Type.String({ description: "Directory relative to root. Defaults to root." })),
});

const grepParams = Type.Object({
	pattern: Type.String({ description: "JavaScript regular expression to search for." }),
	path: Type.Optional(Type.String({ description: "Directory to search under, relative to root. Defaults to root." })),
	maxDepth: Type.Optional(Type.Number({ description: "Max directory depth. Defaults to 12." })),
});

const findParams = Type.Object({
	glob: Type.String({ description: "Substring or simple *-glob matched against relative file paths." }),
	maxDepth: Type.Optional(Type.Number({ description: "Max directory depth. Defaults to 12." })),
});

const writeParams = Type.Object({
	path: Type.String({ description: "File path relative to the workspace root." }),
	content: Type.String({ description: "The full new file contents (UTF-8)." }),
});

const editParams = Type.Object({
	path: Type.String({ description: "File path relative to the workspace root." }),
	oldText: Type.String({ description: "Exact existing substring to replace. Must occur exactly once." }),
	newText: Type.String({ description: "Replacement text." }),
});

const bashParams = Type.Object({
	command: Type.String({ description: "Shell command to run from the workspace root." }),
});

/** Compile a simple `*`-glob (path-substring if no `*`) into a RegExp. */
function globToRegExp(glob: string): RegExp {
	const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(glob.includes("*") ? `^${escaped}$` : escaped);
}

/** Build the tool set, confined to `root`. Write tools are added only when `opts.write`. */
export function buildTools(root: string, opts: ToolOptions = {}): AgentTool[] {
	const base = resolve(root);
	const artifacts = opts.artifacts;

	const read = tool({
		name: "read_file",
		label: "Read file",
		description: "Read a UTF-8 text file within the workspace, or an `artifact://<id>` URL from a prior overflow. Large outputs are spilled to an artifact (head + pointer + tail).",
		parameters: readParams,
		run: async (p) => {
			// artifact://<id> readback: recover a previously spilled full output.
			if (isArtifactUrl(p.path)) {
				const id = parseArtifactUrl(p.path);
				if (!id) throw new Error(`invalid artifact URL: ${p.path}`);
				if (!artifacts) throw new Error("artifact readback is not available in this session");
				const body = await artifacts.read(id);
				if (body === null) throw new Error(`artifact not found: ${p.path}`);
				return text(body);
			}
			const abs = safeResolve(base, p.path);
			const buf = readFileSync(abs);
			const content = buf.toString("utf8");
			// Spill oversized files: keep a bounded head+tail inline, full bytes in an artifact.
			if (artifacts && buf.byteLength > READ_INLINE_CAP) {
				const res = await captureOutput(content, artifacts, { maxBytes: READ_INLINE_CAP, toolType: "read_file" });
				return text(res.text);
			}
			const slice = content.slice(0, MAX_READ_BYTES);
			const suffix = buf.byteLength > MAX_READ_BYTES ? "\n… [truncated at 256 KiB]" : "";
			return text(slice + suffix);
		},
	});

	const ls = tool({
		name: "list_dir",
		label: "List directory",
		description: "List immediate entries of a directory within the workspace.",
		parameters: lsParams,
		run: (p) => {
			const abs = safeResolve(base, p.path ?? ".");
			const out = readdirSync(abs).map((name) => {
				let dir = false;
				try {
					dir = statSync(resolve(abs, name)).isDirectory();
				} catch {
					/* ignore */
				}
				return dir ? `${name}/` : name;
			});
			return text(out.sort().join("\n") || "(empty)");
		},
	});

	const find = tool({
		name: "find_files",
		label: "Find files",
		description: "Find files whose relative path matches a substring or *-glob.",
		parameters: findParams,
		run: (p) => {
			const re = globToRegExp(p.glob);
			const hits: string[] = [];
			for (const rel of walk(base, base, p.maxDepth ?? 12)) {
				if (re.test(rel)) hits.push(rel);
				if (hits.length >= MAX_ENTRIES) break;
			}
			return text(hits.join("\n") || "(no matches)");
		},
	});

	const grep = tool({
		name: "grep",
		label: "Search file contents",
		description: "Search file contents by regular expression. Returns path:line:text matches.",
		parameters: grepParams,
		run: (p) => {
			const re = new RegExp(p.pattern);
			const start = safeResolve(base, p.path ?? ".");
			const out: string[] = [];
			outer: for (const rel of walk(base, start, p.maxDepth ?? 12)) {
				let body: string;
				try {
					const buf = readFileSync(resolve(base, rel));
					if (buf.includes(0)) continue; // skip binary
					body = buf.toString("utf8");
				} catch {
					continue;
				}
				const lines = body.split("\n");
				for (let i = 0; i < lines.length; i++) {
					if (re.test(lines[i])) {
						out.push(`${rel}:${i + 1}:${lines[i].slice(0, 300)}`);
						if (out.length >= MAX_MATCHES) break outer;
					}
				}
			}
			return text(out.join("\n") || "(no matches)");
		},
	});

	const readOnly = [read, ls, find, grep, makeBash(base, artifacts)];
	if (!opts.write) return readOnly;
	return [...readOnly, ...buildMutators(base, opts.onEdit)];
}

/**
 * The `bash` tool. Always registered; the read-only/write restriction is
 * enforced by `beforeToolCall` (read-only mode allows only whitelisted commands).
 */
function makeBash(base: string, artifacts?: ArtifactManager): AgentTool {
	return tool({
		name: "bash",
		label: "Run shell command",
		description: "Run a shell command from the workspace root. Combined stdout/stderr is captured; oversized output spills to an artifact (head + pointer + tail).",
		parameters: bashParams,
		executionMode: "sequential",
		run: async (p) => {
			const res = spawnSync("/bin/sh", ["-c", p.command], {
				cwd: base,
				timeout: BASH_TIMEOUT_MS,
				// Capture generously; the LLM-facing bound + spill is handled below by
				// captureOutput (so oversized output is preserved on disk, not lost).
				maxBuffer: 8 * 1024 * 1024,
				encoding: "utf8",
			});
			if (res.error) throw new Error(`command failed to start: ${res.error.message}`);
			const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
			const code = res.status ?? (res.signal ? `signal ${res.signal}` : "unknown");
			const header = `exit ${code}\n`;
			if (artifacts && out.length > BASH_OUTPUT_CAP) {
				const res2 = await captureOutput(out, artifacts, { maxBytes: BASH_OUTPUT_CAP, toolType: "bash" });
				return text(`${header}${res2.text}`);
			}
			return text(`${header}${out.slice(0, BASH_OUTPUT_CAP) || "(no output)"}`);
		},
	});
}

/** Build the write-only mutating tools (write_file / edit_file). */
function buildMutators(base: string, onEdit?: (edit: FileEdit) => void): AgentTool[] {
	const report = (path: string, before: string, after: string): FileEdit => {
		const edit = unifiedDiff(relative(base, path) || path, before, after);
		onEdit?.(edit);
		return edit;
	};

	const writeFile = tool({
		name: "write_file",
		label: "Write file",
		description: "Create or overwrite a UTF-8 text file with the given full contents. Returns a unified diff.",
		parameters: writeParams,
		executionMode: "sequential",
		run: (p) => {
			if (Buffer.byteLength(p.content, "utf8") > MAX_WRITE_BYTES) {
				throw new Error("refusing to write more than 1 MiB");
			}
			const abs = safeResolve(base, p.path);
			const before = existsSync(abs) ? readFileSync(abs, "utf8") : "";
			mkdirSync(dirname(abs), { recursive: true });
			writeFileSync(abs, p.content, "utf8");
			const edit = report(abs, before, p.content);
			return text(`${before ? "updated" : "created"} ${edit.path} (+${edit.added} -${edit.removed})\n${edit.diff}`);
		},
	});

	const editFile = tool({
		name: "edit_file",
		label: "Edit file",
		description: "Replace an exact, unique substring in an existing file. Returns a unified diff.",
		parameters: editParams,
		executionMode: "sequential",
		run: (p) => {
			const abs = safeResolve(base, p.path);
			if (!existsSync(abs)) throw new Error(`file does not exist: ${p.path}`);
			const before = readFileSync(abs, "utf8");
			const first = before.indexOf(p.oldText);
			if (first === -1) throw new Error("oldText not found in file");
			if (before.indexOf(p.oldText, first + 1) !== -1) throw new Error("oldText is not unique; include more context");
			const after = before.slice(0, first) + p.newText + before.slice(first + p.oldText.length);
			writeFileSync(abs, after, "utf8");
			const edit = report(abs, before, after);
			return text(`edited ${edit.path} (+${edit.added} -${edit.removed})\n${edit.diff}`);
		},
	});

	return [writeFile, editFile];
}

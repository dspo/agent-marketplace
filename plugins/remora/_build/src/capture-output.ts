import type { ArtifactManager } from "./artifacts.ts";

/**
 * Capture a tool's complete output, spilling the full bytes to an artifact
 * file when it exceeds `maxBytes` and returning a bounded head + pointer + tail.
 *
 * remora's tools produce *complete* outputs (not streamed), so this is a leaner
 * take on oh-my-pi's `OutputSink` (which does streaming head/tail/rolling with
 * `Bun.FileSink`). The contract is the same: the LLM-facing buffer stays bounded
 * (head + elision notice + tail) while the full output is preserved on disk,
 * addressable as `artifact://<id>` — no data loss.
 */
export interface CaptureResult {
	/** The LLM-facing text: full output when small, or head + notice + tail when large. */
	text: string;
	/** Artifact id when the output was spilled; undefined when it fit inline. */
	artifactId?: string;
	/** Whether the output exceeded `maxBytes` and was spilled. */
	truncated: boolean;
}

export interface CaptureOptions {
	/** Byte cap for the inline (LLM-facing) output. Over this → spill. */
	maxBytes: number;
	/** Line budget for the head/tail of the truncated inline view (named after the rough char window). */
	headLines?: number;
	tailLines?: number;
	/** Tool name used for the artifact filename (`${id}.${tool}.log`). */
	toolType: string;
}

/** Default byte cap, mirroring oh-my-pi's spill threshold. */
export const DEFAULT_OUTPUT_CAP_BYTES = 64 * 1024;

function utf8Bytes(s: string): number {
	return Buffer.byteLength(s, "utf8");
}

/**
 * Return the bounded view (head + notice + tail) for an over-cap output,
 * referencing the artifact id so the LLM knows where the full text lives.
 *
 * `headChars`/`tailChars` are line budgets (named for the rough char window
 * they trace to). When the line count is small enough that head and tail would
 * overlap, we fall back to a single head slice so the middle is never doubled.
 */
function truncatedView(text: string, opts: CaptureOptions, artifactId: string, totalBytes: number): string {
	const headLines = opts.headLines ?? 4000;
	const tailLines = opts.tailLines ?? 4000;
	const lines = text.split("\n");
	const totalLines = lines.length;
	// If head and tail would overlap, just take the head — avoids rendering the
	// middle twice. (We're still spilling the full bytes to the artifact.)
	const head = lines.slice(0, Math.min(headLines, totalLines)).join("\n");
	const overlap = totalLines <= headLines + tailLines;
	const tail = overlap ? "" : `\n${lines.slice(Math.max(0, totalLines - tailLines)).join("\n")}`;
	const kb = Math.max(1, Math.round(totalBytes / 1024));
	const notice = `\n\n[… ${totalLines} lines / ~${kb} KiB truncated — full output saved to artifact://${artifactId} …]\n\n`;
	return `${head}${notice}${tail}`;
}

/**
 * Capture `text`. If it fits within `maxBytes`, returns it unchanged.
 * Otherwise spills the full text to `artifacts` and returns the truncated view.
 */
export async function captureOutput(
	text: string,
	artifacts: ArtifactManager,
	opts: CaptureOptions,
): Promise<CaptureResult> {
	const totalBytes = utf8Bytes(text);
	if (totalBytes <= opts.maxBytes) {
		return { text, truncated: false };
	}
	const artifactId = await artifacts.save(text, opts.toolType);
	const view = truncatedView(text, opts, artifactId, totalBytes);
	return { text: view, artifactId, truncated: true };
}

/**
 * A minimal, dependency-free line-level unified diff. Used to report what the
 * write/edit tools changed. Caps work on large files to keep it cheap.
 */

const MAX_DIFF_LINES = 4000;

/** A single change a write/edit tool applied to a file. */
export interface FileEdit {
	path: string;
	added: number;
	removed: number;
	diff: string;
}

/**
 * Produce a unified-diff-style string for `before` → `after`. Returns a short
 * placeholder when either side is too large to diff cheaply.
 */
export function unifiedDiff(path: string, before: string, after: string): FileEdit {
	const a = before.length ? before.split("\n") : [];
	const b = after.length ? after.split("\n") : [];

	if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
		return { path, added: b.length, removed: a.length, diff: `@@ file too large to diff (${a.length} → ${b.length} lines) @@` };
	}

	const ops = lcsDiff(a, b);
	const lines: string[] = [`--- ${path}`, `+++ ${path}`];
	let added = 0;
	let removed = 0;
	for (const op of ops) {
		if (op.kind === "del") {
			lines.push(`-${op.text}`);
			removed++;
		} else if (op.kind === "add") {
			lines.push(`+${op.text}`);
			added++;
		} else {
			lines.push(` ${op.text}`);
		}
	}
	return { path, added, removed, diff: lines.join("\n") };
}

interface DiffOp {
	kind: "eq" | "add" | "del";
	text: string;
}

/** Classic LCS-table diff over two line arrays. O(n*m) time and space. */
function lcsDiff(a: string[], b: string[]): DiffOp[] {
	const n = a.length;
	const m = b.length;
	const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}

	const ops: DiffOp[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			ops.push({ kind: "eq", text: a[i] });
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
			ops.push({ kind: "del", text: a[i] });
			i++;
		} else {
			ops.push({ kind: "add", text: b[j] });
			j++;
		}
	}
	while (i < n) ops.push({ kind: "del", text: a[i++] });
	while (j < m) ops.push({ kind: "add", text: b[j++] });
	return ops;
}

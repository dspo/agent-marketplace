import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unifiedDiff } from "./diff.ts";

describe("unifiedDiff", () => {
	it("reports an added line", () => {
		const e = unifiedDiff("f.txt", "a\nb\n", "a\nx\nb\n");
		assert.equal(e.added, 1);
		assert.equal(e.removed, 0);
		assert.match(e.diff, /\+x/);
	});

	it("reports a replaced line as add + remove", () => {
		const e = unifiedDiff("f.txt", "return a - b;\n", "return a + b;\n");
		assert.equal(e.added, 1);
		assert.equal(e.removed, 1);
		assert.match(e.diff, /-return a - b;/);
		assert.match(e.diff, /\+return a \+ b;/);
	});

	it("handles empty → content (file creation)", () => {
		const e = unifiedDiff("new.txt", "", "hello\nworld\n");
		assert.equal(e.removed, 0);
		assert.ok(e.added >= 2);
	});

	it("handles content → empty (file emptied)", () => {
		const e = unifiedDiff("old.txt", "hello\nworld\n", "");
		assert.equal(e.added, 0);
		assert.ok(e.removed >= 2);
	});

	it("emits no +/- lines when unchanged", () => {
		const e = unifiedDiff("f.txt", "same\n", "same\n");
		assert.equal(e.added, 0);
		assert.equal(e.removed, 0);
	});

	it("caps very large files instead of diffing", () => {
		const big = `${"x\n".repeat(5000)}`;
		const e = unifiedDiff("big.txt", big, `${big}y\n`);
		assert.match(e.diff, /too large to diff/);
	});
});

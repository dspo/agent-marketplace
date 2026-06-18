import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ArtifactManager, artifactsDirForSession, isArtifactUrl, parseArtifactUrl } from "./artifacts.ts";
import { captureOutput, DEFAULT_OUTPUT_CAP_BYTES } from "./capture-output.ts";

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "remora-art-"));
}

test("artifactsDirForSession strips .jsonl", () => {
	assert.equal(artifactsDirForSession("/x/y/sess.jsonl"), "/x/y/sess");
	assert.equal(artifactsDirForSession("/x/y/sess"), "/x/y/sess");
});

test("artifact URL helpers", () => {
	assert.equal(isArtifactUrl("artifact://3"), true);
	assert.equal(isArtifactUrl("file://3"), false);
	assert.equal(parseArtifactUrl("artifact://3"), "3");
	assert.equal(parseArtifactUrl("not-a-url"), null);
});

test("ArtifactManager saves, numbers sequentially, reads back", async () => {
	const dir = tmpDir();
	const am = new ArtifactManager(dir);
	const id0 = await am.save("hello", "bash");
	const id1 = await am.save("world", "bash");
	assert.equal(id0, "0");
	assert.equal(id1, "1");
	assert.equal(await am.read(id0), "hello");
	assert.equal(await am.read(id1), "world");
	assert.equal(await am.read("99"), null);
	// File laid out as <id>.<tool>.log alongside the (mocked) session dir.
	assert.equal(readFileSync(join(dir, "0.bash.log"), "utf8"), "hello");
});

test("ArtifactManager resumes numbering from existing files", async () => {
	const dir = tmpDir();
	writeFileSync(join(dir, "0.bash.log"), "a");
	writeFileSync(join(dir, "2.read_file.log"), "b");
	const am = new ArtifactManager(dir);
	const id = await am.save("c", "bash"); // should be 3
	assert.equal(id, "3");
});

test("captureOutput keeps small output inline", async () => {
	const dir = tmpDir();
	const am = new ArtifactManager(dir);
	const res = await captureOutput("tiny", am, { maxBytes: 1024, toolType: "t" });
	assert.equal(res.text, "tiny");
	assert.equal(res.truncated, false);
	assert.equal(res.artifactId, undefined);
});

test("captureOutput spills large output with head + pointer + tail", async () => {
	const dir = tmpDir();
	const am = new ArtifactManager(dir);
	const head = "HEAD_LINE\n".repeat(5);
	const tail = "TAIL_LINE\n".repeat(5);
	const huge = `${head}${"x".repeat(DEFAULT_OUTPUT_CAP_BYTES)}\n${tail}`;
	const res = await captureOutput(huge, am, { maxBytes: 1024, toolType: "bash", headChars: 2, tailChars: 2 });
	assert.equal(res.truncated, true);
	assert.ok(res.artifactId);
	assert.match(res.text, /HEAD_LINE/);
	assert.match(res.text, /TAIL_LINE/);
	assert.match(res.text, /artifact:\/\//);
	// Full output preserved on disk, recoverable via the artifact id.
	assert.equal(await am.read(res.artifactId!), huge);
});

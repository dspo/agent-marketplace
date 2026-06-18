import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	BLOB_EXTERNALIZE_THRESHOLD,
	BLOB_PREFIX,
	BlobStore,
	externalizeImageBlockSync,
	externalizeImageDataUrlSync,
	isBlobRef,
	isImageDataUrl,
	parseBlobRef,
	resolveImageData,
	resolveImageDataUrl,
} from "./blob-store.ts";

/** Unique temp dir per process so parallel test runs don't collide. */
const dir = join(tmpdir(), `remora-blob-test-${process.pid}`);
const blobs = new BlobStore(dir);

test("BlobStore.putSync is content-addressed + idempotent", () => {
	const data = Buffer.from("hello remora blobs");
	const a = blobs.putSync(data);
	const b = blobs.putSync(data);
	assert.equal(a.hash, b.hash);
	assert.equal(a.ref, `${BLOB_PREFIX}${a.hash}`);
	assert.ok(blobs.has(a.hash));
	// Same content → same canonical path; deduped.
	assert.equal(a.path, b.path);
	assert.equal(blobs.get(a.hash)?.toString("utf8"), "hello remora blobs");
});

test("externalizeImageBlockSync externalizes large base64, leaves small inline", () => {
	// Build a base64 string just over the threshold.
	const big = "A".repeat(BLOB_EXTERNALIZE_THRESHOLD + 8);
	const small = "B".repeat(BLOB_EXTERNALIZE_THRESHOLD - 1);

	const bigBlock = { type: "image" as const, data: big, mimeType: "image/png" };
	const out = externalizeImageBlockSync(blobs, bigBlock);
	assert.ok(isBlobRef(out.data), "large image data externalized to a blob ref");
	assert.equal(out.type, "image");
	assert.equal(out.mimeType, "image/png");
	// Round-trips through resolveImageData back to the original base64.
	assert.equal(resolveImageData(blobs, out.data), big);

	const smallBlock = { type: "image" as const, data: small };
	const kept = externalizeImageBlockSync(blobs, smallBlock);
	assert.equal(kept.data, small, "sub-threshold data stays inline");
	assert.ok(!isBlobRef(kept.data));
});

test("externalizeImageBlockSync is idempotent (already a ref is unchanged)", () => {
	const big = "C".repeat(BLOB_EXTERNALIZE_THRESHOLD + 4);
	const once = externalizeImageBlockSync(blobs, { type: "image", data: big });
	const twice = externalizeImageBlockSync(blobs, { type: "image", data: once.data });
	assert.equal(twice.data, once.data, "re-externalizing a ref is a no-op");
});

test("image data URL externalization round-trips losslessly", () => {
	const url = "data:image/png;base64," + "D".repeat(BLOB_EXTERNALIZE_THRESHOLD + 4);
	assert.ok(isImageDataUrl(url));
	const ref = externalizeImageDataUrlSync(blobs, url);
	assert.ok(isBlobRef(ref));
	assert.equal(resolveImageDataUrl(blobs, ref), url, "data URL restored verbatim");
});

test("parseBlobRef extracts the hash, isBlobRef guards non-refs", () => {
	const ref = blobs.putSync(Buffer.from("x")).ref;
	assert.equal(parseBlobRef(ref), parseBlobRef(ref));
	assert.equal(parseBlobRef("not a ref"), null);
	assert.ok(isBlobRef(ref));
	assert.ok(!isBlobRef("plain string"));
	assert.ok(!isBlobRef(123 as unknown));
});

test("resolveImageData returns ref as-is when blob missing (graceful)", () => {
	const missing = `${BLOB_PREFIX}0`.repeat(1).slice(0, 0) + `${BLOB_PREFIX}deadbeefdeadbeef`;
	assert.equal(resolveImageData(blobs, missing), missing, "missing blob → keep ref string");
	assert.equal(resolveImageData(blobs, "not-a-ref"), "not-a-ref", "non-ref passes through");
});

// Clean up the temp blob dir we created.
test("cleanup", () => rmSync(dir, { recursive: true, force: true }));

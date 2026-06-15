import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { generateJobId, getConfig, listJobs, loadState, setConfig, upsertJob } from "./.build/state.mjs";

function makeWorkspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimo-state-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("default state has the review gate disabled and no jobs", (t) => {
  const cwd = makeWorkspace(t);
  const state = loadState(cwd);
  assert.equal(state.config.stopReviewGate, false);
  assert.deepEqual(state.jobs, []);
});

test("setConfig persists the stop review gate", (t) => {
  const cwd = makeWorkspace(t);
  setConfig(cwd, "stopReviewGate", true);
  assert.equal(getConfig(cwd).stopReviewGate, true);
});

test("upsertJob inserts then patches a job record", (t) => {
  const cwd = makeWorkspace(t);
  const id = generateJobId("test");

  upsertJob(cwd, { id, status: "queued", title: "Test Job" });
  let jobs = listJobs(cwd);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "queued");

  upsertJob(cwd, { id, status: "completed", mimoSessionID: "ses_x" });
  jobs = listJobs(cwd);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "completed");
  assert.equal(jobs[0].mimoSessionID, "ses_x");
  assert.equal(jobs[0].title, "Test Job");
});

test("generateJobId uses the prefix and is unique", () => {
  const a = generateJobId("review");
  const b = generateJobId("review");
  assert.ok(a.startsWith("review-"));
  assert.notEqual(a, b);
});

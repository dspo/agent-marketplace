import assert from "node:assert/strict";
import { test } from "node:test";

import { renderReviewResult, renderTaskResult } from "./.build/render.mjs";

test("renderReviewResult renders findings sorted by severity", () => {
  const rendered = renderReviewResult(
    {
      parsed: {
        verdict: "needs-attention",
        summary: "Two problems found.",
        findings: [
          { severity: "low", title: "Minor", body: "b", file: "a.ts", line_start: 1, line_end: 1, confidence: 0.5, recommendation: "" },
          { severity: "critical", title: "Major", body: "b", file: "b.ts", line_start: 2, line_end: 4, confidence: 0.9, recommendation: "fix it" }
        ],
        next_steps: ["do the fix"]
      },
      parseError: null,
      rawOutput: ""
    },
    { reviewLabel: "Review", targetLabel: "working tree diff" }
  );

  assert.match(rendered, /Verdict: needs-attention/);
  const majorIndex = rendered.indexOf("[critical] Major");
  const minorIndex = rendered.indexOf("[low] Minor");
  assert.ok(majorIndex !== -1 && minorIndex !== -1 && majorIndex < minorIndex);
  assert.match(rendered, /b\.ts:2-4/);
  assert.match(rendered, /Next steps:/);
});

test("renderReviewResult reports parse errors with raw output", () => {
  const rendered = renderReviewResult(
    { parsed: null, parseError: "boom", rawOutput: "raw text" },
    { reviewLabel: "Review", targetLabel: "x" }
  );
  assert.match(rendered, /did not return valid structured JSON/);
  assert.match(rendered, /boom/);
  assert.match(rendered, /raw text/);
});

test("renderReviewResult rejects wrong shapes", () => {
  const rendered = renderReviewResult(
    { parsed: { nope: true }, parseError: null, rawOutput: "{}" },
    { reviewLabel: "Review", targetLabel: "x" }
  );
  assert.match(rendered, /unexpected review shape/);
});

test("renderTaskResult prefers raw output and falls back to failure message", () => {
  assert.equal(renderTaskResult({ rawOutput: "all done" }), "all done\n");
  assert.equal(renderTaskResult({ failureMessage: "it broke" }), "it broke\n");
  assert.match(renderTaskResult({}), /did not return a final message/);
});

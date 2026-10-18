"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const workspace = fs.readFileSync(
  "src/services/teacher-workspace-service.js",
  "utf8",
);

test("class submission qualifies the result version in UPDATE FROM", () => {
  assert.match(
    workspace,
    /UPDATE results r SET status='SUBMITTED',version=r\.version\+1 FROM result_batches rb/,
  );
  assert.doesNotMatch(
    workspace,
    /UPDATE results r SET status='SUBMITTED',version=version\+1 FROM result_batches rb/,
  );
});

test("known compile blockers retain specific safe validation messages", () => {
  assert.match(workspace, /Cannot compile result/);
  assert.match(workspace, /Report cannot be compiled\. Incomplete subjects/);
  assert.match(workspace, /results are already in workflow and cannot be recompiled/);
  assert.match(workspace, /No active grading rules are configured/);
});

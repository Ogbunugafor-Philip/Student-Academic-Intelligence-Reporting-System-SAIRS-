"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const workspace = fs.readFileSync(
  "src/services/teacher-workspace-service.js",
  "utf8",
);
const portal = fs.readFileSync("public/js/modules/portals.js", "utf8");

test("assignment progress returns stored component workflow statuses", () => {
  for (const field of [
    "ca1_component_status",
    "ca2_component_status",
    "exam_component_status",
  ])
    assert.match(workspace, new RegExp(field));
  assert.match(workspace, /assessment_component_submissions acs/);
});

test("completed requires all three component statuses to be approved", () => {
  assert.match(
    portal,
    /Ca1ComponentStatus, p\?\.Ca2ComponentStatus, p\?\.ExamComponentStatus/,
  );
  assert.match(portal, /\.every\(\(status\) => status === "APPROVED"\)/);
  assert.match(portal, /if \(isCompleted\(p\)\) return "Completed"/);
});

test("completed assignment offers read-only score inspection", () => {
  assert.match(portal, /completed \? "View Scores"/);
  assert.match(portal, /completed \? "btn-secondary"/);
  assert.match(portal, /locked\(code\) \? "disabled"/);
});

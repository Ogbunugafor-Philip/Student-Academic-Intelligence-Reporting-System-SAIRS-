"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { gradeFor } = require("../src/services/result-engine");
const {
  componentsApproved,
} = require("../src/services/teacher-workspace-service");

const workspace = fs.readFileSync(
  "src/services/teacher-workspace-service.js",
  "utf8",
);
const portal = fs.readFileSync("public/js/modules/portals.js", "utf8");
const rules = [
  { grade: "A", minimum_score: 70, maximum_score: 100, sort_order: 1 },
  { grade: "B", minimum_score: 60, maximum_score: 69, sort_order: 2 },
  { grade: "C", minimum_score: 50, maximum_score: 59, sort_order: 3 },
  { grade: "D", minimum_score: 45, maximum_score: 49, sort_order: 4 },
  { grade: "E", minimum_score: 40, maximum_score: 44, sort_order: 5 },
  { grade: "F", minimum_score: 0, maximum_score: 39, sort_order: 6 },
];

test("teacher score sheet grades only after every component is approved", () => {
  assert.match(workspace, /if \(componentsApproved\(componentStatuses\)\)/);
  assert.match(workspace, /student\.grade = gradeFor\(rules, total\)\.grade/);
});

test("draft, partial, submitted, and returned sheets keep Grade unavailable", () => {
  const states = ["NOT_STARTED", "DRAFT", "SUBMITTED", "RETURNED"];
  for (const status of states)
    assert.equal(
      componentsApproved({
        CA1: { status: "APPROVED" },
        CA2: { status },
        EXAM: { status: "APPROVED" },
      }),
      false,
      status,
    );
  assert.equal(
    componentsApproved({
      CA1: { status: "APPROVED" },
      CA2: { status: "APPROVED" },
      EXAM: { status: "APPROVED" },
    }),
    true,
  );
});

test("teacher grade cell renders the backend grade and otherwise remains blank", () => {
  assert.match(portal, /data-grade>\$\{escapeHtml\(x\.Grade \|\| "—"\)\}/);
});

test("shared grading engine maps the requested approved-score samples", () => {
  const expected = new Map([
    [54, "C"],
    [82, "A"],
    [75, "A"],
    [65, "B"],
    [71, "A"],
    [45, "D"],
  ]);
  for (const [total, grade] of expected)
    assert.equal(gradeFor(rules, total).grade, grade);
});

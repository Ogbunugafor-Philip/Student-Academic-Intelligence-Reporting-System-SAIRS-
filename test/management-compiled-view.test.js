"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const view = fs.readFileSync("public/js/modules/generated-reports.js", "utf8");

test("compiled-result view consumes the serialized nested subject shape", () => {
  for (const field of ["Subject", "Ca1", "Ca2", "Exam", "Total", "Grade", "Position"])
    assert.match(view, new RegExp(`y\\.${field}\\b`));
  for (const oldField of ["subject", "ca1", "ca2", "exam", "total", "grade", "position"])
    assert.doesNotMatch(view, new RegExp(`y\\.${oldField}\\b`));
});

test("compiled-result view formats whole scores without rendering NaN", () => {
  assert.match(view, /const whole = \(value\) =>/);
  assert.match(view, /Number\.isFinite\(Number\(value\)\)/);
  assert.match(view, /<td>\$\{whole\(y\.Ca1\)\}<\/td>/);
  assert.match(view, /<td>\$\{whole\(y\.Total\)\}<\/td>/);
});

test("compiled-result view uses collapsible student tables", () => {
  assert.match(view, /dialog\.className = "dialog compiled-result-dialog"/);
  assert.match(view, /<details class="compiled-student-card"/);
  assert.match(view, /<th>Subject<\/th><th>CA1 \/20<\/th><th>CA2 \/20<\/th><th>Exam \/60<\/th><th>Total \/100<\/th><th>Grade<\/th><th>Position<\/th>/);
  assert.match(view, /index === 0 \? "open" : ""/);
  assert.match(view, /View Subjects/);
  assert.match(view, /Collapse/);
});

test("compiled-result positions use ordinal labels", () => {
  assert.match(view, /ordinal = \(value\) =>/);
  assert.match(view, /ordinal\(x\.OverallPosition\)/);
  assert.match(view, /ordinal\(y\.Position\)/);
});

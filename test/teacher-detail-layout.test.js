"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const teachers = fs.readFileSync("public/js/modules/teachers.js", "utf8");
const css = fs.readFileSync("public/css/app.css", "utf8");

test("teacher profile follows the sectioned student-detail hierarchy", () => {
  assert.match(teachers, /teacher-profile-dialog/);
  assert.match(teachers, /<h3>Teacher Information<\/h3>/);
  for (const label of [
    "Teacher Name",
    "Staff Number",
    "Email / Username",
    "Phone",
    "Status",
  ])
    assert.match(teachers, new RegExp(label.replace("/", "\\/")));
});

test("each assignment has distinct type, subject, class, and arm fields", () => {
  assert.match(teachers, /<h3>Teaching Assignments<\/h3>/);
  for (const label of ["Assignment Type", "Subject", "Class", "Arm"])
    assert.match(teachers, new RegExp(`<small>${label}<\\/small>`));
  assert.match(teachers, /x\.SubjectName \|\| "—"/);
  assert.match(teachers, /FORM_TEACHER/);
});

test("teacher assignments wrap safely across desktop, tablet, and mobile", () => {
  assert.match(css, /\.teacher-profile-dialog\{width:min\(940px/);
  assert.match(css, /grid-template-columns:minmax\(145px/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /\.assignment-type strong\{[^}]*white-space:nowrap/);
  assert.match(css, /@media\(max-width:780px\)[^{]*\{/);
  assert.match(
    css,
    /\.subject-assignment-row,\.teacher-assignment-row\{grid-template-columns:1fr\}/,
  );
});

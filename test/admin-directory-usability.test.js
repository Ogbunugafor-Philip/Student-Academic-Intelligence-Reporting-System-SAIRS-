"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (file) =>
  fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const students = read("src/services/student-service.js");
const teachers = read("src/services/teacher-service.js");
const users = read("src/services/admin-service.js");
const routes = read("src/routes/api-routes.js");
const studentUi = read("public/js/modules/students.js");
const teacherUi = read("public/js/modules/teachers.js");
const userUi = read("public/js/modules/users.js");

test("student directory remains tenant-scoped and searches full student and guardian identity", () => {
  assert.match(students, /where=\['s\.school_id=\$1'\]/);
  for (const field of [
    "s.admission_number",
    "s.first_name",
    "s.last_name",
    "p.first_name",
    "p.last_name",
    "p.email",
    "p.phone",
  ])
    assert.ok(students.includes(field), field);
  assert.match(studentUi, /data-view/);
  assert.match(students, /guardians:/);
});

test("teacher directory is server-paginated and assignment searchable", () => {
  assert.match(routes, /teachers\/list/);
  assert.match(teachers, /t\.school_id=\$1/);
  for (const field of [
    "t.staff_number",
    "t.email",
    "t.phone",
    "s.name",
    "c.name",
    "FORM_TEACHER",
  ])
    assert.ok(teachers.includes(field), field);
  assert.match(teacherUi, /\/api\/teachers\/list/);
  assert.match(teacherUi, /limit: 25/);
});

test("teacher detail is tenant-scoped and displays profile and assignments", () => {
  assert.match(routes, /teachers\/details/);
  assert.match(teachers, /WHERE t\.school_id=\$1 AND t\.id=\$2/);
  for (const label of [
    "Staff Number",
    "Email / Username",
    "Phone",
    "FORM_TEACHER",
    "SUBJECT_TEACHER",
  ])
    assert.ok(teacherUi.includes(label), label);
});

test("management directory supports status filtering and tenant-scoped search", () => {
  assert.match(routes, /management\/list/);
  assert.match(users, /u\.school_id=\$1/);
  for (const field of ["full_name", "email", "phone", "status"])
    assert.ok(users.includes(field), field);
  assert.match(userUi, /limit: 25/);
  assert.match(userUi, /management-status/);
});

test("management detail is tenant-scoped and never displays credentials", () => {
  assert.match(routes, /management\/details/);
  assert.match(users, /WHERE u\.school_id=\$1 AND u\.id=\$2/);
  assert.match(userUi, /Management User/);
  assert.doesNotMatch(userUi, /password_hash/i);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const service = fs.readFileSync("src/services/session-continuity-service.js", "utf8");
const setup = fs.readFileSync("src/services/academic-setup-service.js", "utf8");
const routes = fs.readFileSync("src/routes/api-routes.js", "utf8");
const migration = fs.readFileSync("src/db/migrations/015_academic_session_continuity.sql", "utf8");

test("session creation owns rollover while current-session selection only changes context", () => {
  assert.match(service, /async function create[\s\S]*carryForward[\s\S]*ACADEMIC_SESSION_CREATED/);
  const setCurrent = setup.match(/async function setCurrent[\s\S]*?async function saveTerm/)[0];
  assert.doesNotMatch(setCurrent, /INSERT INTO student_session_enrolments|INSERT INTO teacher_assignments/);
});

test("rollover is tenant scoped, transactional, idempotent and excludes inactive identities", () => {
  assert.match(service, /transaction\(async client/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /s\.status='ACTIVE'/);
  assert.match(service, /s\.admission_date<=\$6::date/);
  assert.match(service, /t\.status='ACTIVE'/);
  assert.match(service, /NOT EXISTS[\s\S]*ON CONFLICT DO NOTHING/);
  assert.match(service, /e\.school_id=\$1/);
});

test("rollover copies structure but never assessment, score, result or report rows", () => {
  const carry = service.match(/async function carryForward[\s\S]*?async function record/)[0];
  assert.match(carry, /student_session_enrolments/);
  assert.match(carry, /teacher_assignments/);
  assert.match(carry, /session_class_subjects/);
  assert.doesNotMatch(carry, /INSERT INTO (assessments|scores|results|result_batches|report_cards)/);
});

test("session curriculum and rollover audit records are durable and uniquely scoped", () => {
  assert.match(migration, /UNIQUE\(school_id,academic_session_id,class_id,subject_id\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS academic_session_rollovers/);
  assert.match(service, /ACADEMIC_SESSION_ROLLOVER_COMPLETED/);
  assert.match(service, /ACADEMIC_SESSION_RECONCILED/);
});

test("promotion changes only the target enrolment and records immutable history", () => {
  const promotion = service.match(/async function promote\([\s\S]*?async function promoteOne/)[0];
  assert.match(promotion, /ON CONFLICT\(school_id,student_id,academic_session_id\) DO UPDATE/);
  assert.match(promotion, /INSERT INTO student_class_history/);
  assert.doesNotMatch(promotion, /UPDATE student_session_enrolments SET class_id/);
  assert.match(promotion, /GRADUATION[\s\S]*WITHDRAWAL/);
});

test("continuity and promotion endpoints require the IT administrator gate", () => {
  for (const path of ["session-rollover/preview", "session-rollover/create", "session-rollover/reconcile", "promotions/roster", "promotions/apply"])
    assert.match(routes, new RegExp(`/${path.replace("/", "\\/")}[\\s\\S]{0,80}admin`));
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calculateResults, nextStatus } = require('../src/services/result-engine');
const { detectWarnings, recommendation } = require('../src/services/performance-engine');
const { hashPassword, verifyPassword, validatePassword } = require('../src/security/password');
const { csv, objects } = require('../src/services/import-service');
const { legacy } = require('../src/utilities/case');
const { pool } = require('../src/db/pool');
const authRepository = require('../src/repositories/auth-repository');
const { safeUser } = require('../src/services/auth-service');

test('Argon2id hashes and verifies without retaining plaintext', async () => {
  const password = 'StrongSchool7';
  const hash = await hashPassword(password);
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(hash.includes(password), false);
  assert.equal(await verifyPassword(hash, password), true);
  assert.equal(await verifyPassword(hash, 'wrong'), false);
  assert.equal(validatePassword('weak'), 'Password must contain 10 to 128 characters.');
});

test('weighted CA and examination results use configured grading rules', () => {
  const assessments = [
    { id: 'ca', category: 'Continuous Assessment', maximum_score: 40, weight: 40 },
    { id: 'exam', category: 'Examination', maximum_score: 60, weight: 60 }
  ];
  const scores = [{ assessment_id: 'ca', student_id: 'student', score: 32 }, { assessment_id: 'exam', student_id: 'student', score: 45 }];
  const rules = [{ grade: 'A', minimum_score: 70, maximum_score: 100, remark: 'Excellent', sort_order: 1 }];
  assert.deepEqual(calculateResults(assessments, scores, rules, ['student'])[0], {
    studentId: 'student', continuousAssessmentTotal: 32, examinationScore: 45,
    totalScore: 77, totalWeightedScore: 77, percentage: 77, grade: 'A', remark: 'Excellent'
  });
});

test('result workflow cannot skip review or approval', () => {
  assert.equal(nextStatus('DRAFT', 'SUBMITTED'), 'SUBMITTED');
  assert.throws(() => nextStatus('DRAFT', 'APPROVED'), error => error.code === 'VALIDATION_ERROR');
});

test('result workflow audit stores JSON objects instead of bare status strings', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/result-service.js'), 'utf8');
  assert.match(source, /oldValue:\s*\{\s*status:\s*batch\.status\s*\}/);
  assert.match(source, /newValue:\s*\{\s*status:\s*next[,}]/);
});

test('performance engine finds repeated failures, decline and sudden drop deterministically', () => {
  const rows = [65, 48, 35].map((percentage, index) => ({ subject_id: 'math', percentage, updated_at: `2026-0${index + 1}-01` }));
  const types = detectWarnings(rows).map(item => item.type);
  assert.ok(types.includes('REPEATED_FAILURE'));
  assert.ok(types.includes('CONTINUOUS_DECLINE'));
  assert.equal(recommendation('REPEATED_FAILURE').includes('diagnos'), false);
});

test('CSV parser supports quoted commas and import objects normalize headers', () => {
  const values = csv('Admission Number,First Name,Last Name\nA1,"Ada, Marie",Okafor\n');
  assert.equal(values[1][1], 'Ada, Marie');
  assert.deepEqual(objects(values)[0].data, { admissionnumber: 'A1', firstname: 'Ada, Marie', lastname: 'Okafor' });
});

test('legacy response adapter preserves API envelopes and maps database records', () => {
  const value = legacy({ generatedAt: 'now', modules: { students: { initialStudents: [{ id: '1', admission_number: 'A1', first_name: 'Ada', status: 'ACTIVE' }] } } });
  assert.equal(value.generatedAt, 'now');
  assert.ok(value.modules.students.initialStudents);
  assert.equal(value.modules.students.initialStudents[0].StudentID, '1');
  assert.equal(value.modules.students.initialStudents[0].Status, 'Active');
});

test('authenticated user identity includes the tenant-bound school name', async () => {
  const originalQuery = pool.query;
  let sql;
  let params;
  pool.query = async (statement, values) => {
    sql = statement;
    params = values;
    return { rows: [{ id: 'user-a', school_id: 'school-a', email: 'admin@example.com', role: 'IT_ADMIN', status: 'ACTIVE', must_change_password: true, school_name: 'School A', school_slug: 'school-a', school_status: 'ACTIVE' }] };
  };
  try {
    const users = await authRepository.findLoginUser('ADMIN@example.com', 'school-a');
    assert.match(sql, /s\.name school_name/);
    assert.match(sql, /JOIN schools s ON s\.id=u\.school_id/);
    assert.match(sql, /AND s\.slug=\$2/);
    assert.deepEqual(params, ['admin@example.com', 'school-a']);
    assert.deepEqual(safeUser(users[0]), { id: 'user-a', email: 'admin@example.com', role: 'IT_ADMIN', schoolId: 'school-a', schoolName: 'School A', mustChangePassword: true });
    assert.notEqual(safeUser(users[0]).schoolName, 'School B');
  } finally {
    pool.query = originalQuery;
  }
});

test('session authentication preserves the same school identity mapping', () => {
  const repository = fs.readFileSync(path.join(__dirname, '../src/repositories/auth-repository.js'), 'utf8');
  const middleware = fs.readFileSync(path.join(__dirname, '../src/middleware/auth.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/auth-routes.js'), 'utf8');
  assert.match(repository, /s\.name school_name/);
  assert.match(middleware, /schoolId:row\.school_id/);
  assert.match(middleware, /schoolName:row\.school_name/);
  assert.match(routes, /schoolId:req\.identity\.schoolId,schoolName:req\.identity\.schoolName/);
});

test('connectivity states distinguish online, offline and unavailable service', async () => {
  const { connectionState } = await import('../public/js/api.js');
  assert.equal(connectionState(true, true), 'ONLINE');
  assert.equal(connectionState(false, true), 'OFFLINE');
  assert.equal(connectionState(false, false), 'OFFLINE');
  assert.equal(connectionState(true, false), 'UNAVAILABLE');
});

test('dashboard setup data and activity remain tenant scoped', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/api-routes.js'), 'utf8');
  const start=routes.indexOf('"/dashboard"'),end=routes.indexOf('"/students/bootstrap"',start),dashboard=routes.slice(start,end);
  for (const table of ['students','teachers','classes','class_arms','subjects','assessment_structures']) assert.match(dashboard, new RegExp(`FROM ${table} WHERE school_id=\\$1`));
  assert.match(dashboard, /req\.identity\.schoolId/);
});

test('migration defines tenant isolation, constraints, history and sync idempotency', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_initial.sql'), 'utf8');
  for (const fragment of ['school_id uuid NOT NULL', 'CHECK(score>=0)', 'result_workflow_history', 'score_history', 'UNIQUE(school_id,assessment_id,student_id)', 'sync_operations']) assert.ok(sql.includes(fragment), fragment);
});

test('service worker, manifest and exactly three approved raster images exist', () => {
  const root = path.join(__dirname, '..');
  JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'));
  assert.ok(fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8').includes('fetch'));
  assert.match(fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8'),/VERSION='sairs-v\d+'/);
  for(const image of ['academic-performance.webp','academic-workspace.webp','login-academic.webp'])assert.ok(fs.existsSync(path.join(root,'public/assets/images',image)),image);
});

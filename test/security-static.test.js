'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('cookie authentication, CSRF, Helmet, role gates and login throttling are wired', () => {
  assert.match(read('src/routes/auth-routes.js'), /httpOnly:\s*true/);
  assert.match(read('src/routes/auth-routes.js'), /rateLimit/);
  assert.match(read('src/routes/api-routes.js'), /router\.use\(authenticate, csrf, requirePasswordChanged\)/);
  assert.match(read('src/routes/api-routes.js'), /requireRoles/);
  assert.match(read('src/app.js'), /helmet/);
});

test('parent, teacher, report and tenant authorization are server-side', () => {
  const authorization = read('src/services/authorization-service.js');
  assert.match(authorization, /assertParentStudent/);
  assert.match(authorization, /assertTeacherAssessment/);
  assert.match(read('src/services/report-service.js'), /["']PUBLISHED["']\s*!==?\s*row\.status/);
  assert.match(read('src/repositories/entity-repository.js'), /school_id=\$1/);
});

test('sync reserves operation UUIDs and returns conflicts for newer records', () => {
  const sync = read('src/services/sync-service.js');
  assert.match(sync, /INSERT INTO sync_operations/);
  assert.match(sync, /existing\.result/);
  assert.match(read('src/services/assessment-service.js'), /baseUpdatedAt/);
  assert.match(read('src/services/assessment-service.js'), /errors\.conflict/);
});

test('direct identifier access is scoped before sensitive reads and assessment mutation', () => {
  const routes = read('src/routes/api-routes.js');
  const authorization = read('src/services/authorization-service.js');
  const results = read('src/services/result-service.js');
  assert.match(routes, /assertTeacherBatch\(req\.identity,\s*batch\)/);
  assert.match(routes, /assertTeacherScore\(req\.identity,\s*req\.body\.scoreId\)/);
  assert.match(read('src/services/assessment-service.js'), /SELECT \* FROM assessments WHERE school_id=\$1 AND id=\$2 FOR UPDATE/);
  assert.match(authorization, /assignment_type='SUBJECT_TEACHER' AND subject_id=\$6/);
  assert.match(results, /parent_student_links/);
  assert.match(results, /teacher_assignments/);
});

test('offline fixed-score workspace is encrypted, conflict-aware and queued automatically', () => {
  const syncService = read('src/services/sync-service.js');
  const syncClient = read('public/js/sync.js');
  const portal = read('public/js/modules/portals.js');
  const workspace = read('src/services/teacher-workspace-service.js');
  assert.match(syncService, /teacherWorkspaceSheets/);
  assert.match(syncService, /teacherWorkspace\.save/);
  assert.match(syncService, /payload_hash\s*!==\s*payloadHash/);
  assert.match(syncClient, /action\s*===\s*['"]teacherWorkspace\.save['"]/);
  assert.match(portal, /queueOperation/);
  assert.match(portal, /saveSnapshot\(pack,\s*false\)/);
  assert.match(workspace, /changed after the offline copy was saved/);
});

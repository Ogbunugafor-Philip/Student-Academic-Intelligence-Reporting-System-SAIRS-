'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/js/app.js');
const dashboard = read('public/js/modules/dashboard.js');
const portal = read('public/js/modules/portals.js');
const performance = read('src/services/performance-service.js');
const reports = read('src/services/report-service.js');
const workspace = read('src/services/teacher-workspace-service.js');
const audits = read('src/services/audit-service.js');
const routes = read('src/routes/api-routes.js');

test('Parent navigation is exactly the final four modules', () => {
  assert.match(app, /PARENT:\s*\["dashboard", "portals", "performance", "audits"\]/);
  assert.match(app, /portals: "Approved Assessments"/);
});

test('Parent dashboard contains only parent-scoped MVP metrics', () => {
  for (const label of ['Children / Wards', 'Published Reports', 'Approved Assessments', 'Current Academic Session', 'Current Term'])
    assert.ok(dashboard.includes(label), label);
  assert.match(routes, /count\(DISTINCT l\.student_id\)[\s\S]*p\.user_id=\$2/);
  assert.match(routes, /rc\.status='PUBLISHED'[\s\S]*p\.user_id=\$2/);
  assert.match(routes, /count\(DISTINCT \(sc\.student_id,acs\.assessment_id\)\)[\s\S]*acs\.status='APPROVED'/);
});

test('Approved Assessments is linked-child scoped and renders approved values only', () => {
  assert.match(workspace, /parentProgress[\s\S]*parent_student_links[\s\S]*cs\.status='APPROVED'/);
  assert.match(portal, /Current Term Progress/);
  assert.match(portal, /Approved components/);
  assert.doesNotMatch(portal.slice(portal.indexOf('function renderParentProgress'), portal.indexOf('function period')), />Pending</);
});

test('Parent performance and reports enforce linked-child and publication boundaries', () => {
  assert.match(performance, /"PARENT"===identity\.role&&await authz\.assertParentStudent/);
  assert.match(performance, /rb\.status='PUBLISHED'/);
  assert.match(performance, /report_cards WHERE school_id=\$1 AND student_id=\$2 AND status='PUBLISHED'/);
  assert.match(reports, /authz\.assertParentStudent\(identity, row\.student_id\)/);
  assert.match(reports, /"PUBLISHED" !== row\.status/);
  assert.match(reports,/superseded by the current published report/);
});

test('Parent audits are school-and-user isolated for list and detail', () => {
  assert.match(audits, /WHERE a\.school_id=\$1 AND a\.user_id=\$2/);
  assert.match(audits, /WHERE school_id=\$1 AND user_id=\$2 AND id=\$3/);
  assert.match(routes, /"\/parent\/audits",requireRoles\("PARENT"\)/);
  assert.match(routes, /APPROVED_ASSESSMENT_VIEWED/);
  assert.match(routes, /CHILD_PERFORMANCE_VIEWED/);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=file=>fs.readFileSync(file,'utf8');
const app=read('public/js/app.js'),dashboard=read('public/js/modules/dashboard.js'),portal=read('public/js/modules/portals.js'),performance=read('src/services/performance-service.js'),audits=read('src/services/audit-service.js'),routes=read('src/routes/api-routes.js'),reports=read('src/services/report-service.js');

test('teacher navigation is exactly the focused four-module experience',()=>{
  assert.match(app,/TEACHER:\s*\["dashboard",\s*"portals",\s*"performance",\s*"audits"\]/);
});
test('teacher dashboard uses assignment-scoped metrics and no school-wide teacher cards',()=>{
  assert.match(dashboard,/Subjects Taught/);assert.match(dashboard,/Classes \/ Arms Assigned/);assert.match(dashboard,/Students Within Assigned Classes/);assert.match(dashboard,/Form Teacher/);assert.match(routes,/dashboardSummary/);
});
test('score entry separates student name and admission number while preserving fixed scoring',()=>{
  assert.match(portal,/Student Name<\/th><th>Admission Number/);assert.match(portal,/CA1 \/20/);assert.match(portal,/CA2 \/20/);assert.match(portal,/Exam \/60/);assert.match(portal,/Total \/100/);assert.match(portal,/data-grade/);
});
test('teacher performance list and history are tenant, assignment and enrolment scoped',()=>{
  assert.match(performance,/student_session_enrolments/);assert.match(performance,/ta\.teacher_id=\$2/);assert.match(performance,/ta\.teacher_id=\$3/);assert.match(performance,/e\.student_id=s\.id/);assert.match(performance,/rb\.status='PUBLISHED'/);
});
test('teacher report downloads remain limited to published Form Class reports',()=>{
  assert.match(reports,/Only published report cards are available/);assert.match(reports,/assignment_type='CLASS_TEACHER'/);assert.match(reports,/outside your Form Class scope/);
});
test('teacher audits are isolated by exact actor user id in list and detail',()=>{
  assert.match(routes,/teacher\/audits/);assert.match(routes,/searchOwn/);assert.match(routes,/detailOwn/);assert.match(audits,/a\.user_id=\$2/);assert.match(audits,/user_id=\$2 AND id=\$3/);
});

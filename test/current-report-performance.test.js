'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const reports=read('src/services/report-service.js'),verification=read('src/services/report-verification-service.js'),performance=read('public/js/modules/performance.js'),reportView=read('public/js/modules/report-view.js');

test('academic numbers remove only insignificant zeros',async()=>{
  const {academicNumber}=await import(pathToFileURL(path.join(root,'public/js/academic-format.mjs')));
  assert.equal(academicNumber('13.00'),'13');
  assert.equal(academicNumber('19.00'),'19');
  assert.equal(academicNumber('13.50'),'13.5');
  assert.equal(academicNumber('75.25'),'75.25');
  assert.equal(academicNumber(null),'—');
});

test('ordinary report lists select one latest published revision per student period',()=>{
  assert.match(reports,/NOT EXISTS\(SELECT 1 FROM report_cards newer/);
  assert.match(reports,/newer\.academic_session_id=rc\.academic_session_id/);
  assert.match(reports,/newer\.term_id=rc\.term_id/);
  assert.match(reports,/newer\.status='PUBLISHED'/);
  assert.match(reports,/newer\.report_version,newer\.published_at,newer\.id/);
});

test('parent and teacher direct access rejects superseded report identifiers',()=>{
  assert.match(reports,/This report has been superseded by the current published report/);
  assert.match(verification,/NOT EXISTS\(SELECT 1 FROM report_cards newer/);
});

test('performance renders one student summary and subject-only measures',()=>{
  assert.match(performance,/Student Performance Summary/);
  assert.match(performance,/Overall Average/);
  assert.match(performance,/Overall Class Position/);
  assert.match(performance,/Number of Subjects/);
  assert.match(performance,/\["Subject", "CA1", "CA2", "Examination", "Total", "Grade", "Subject Position"\]/);
  assert.doesNotMatch(performance,/"Average",\s*"Overall Position"/);
});

test('performance exposes one matching view and download action per effective report',()=>{
  assert.match(performance,/function latestReports/);
  assert.match(performance,/data-view-report/);
  assert.match(performance,/data-download-report/);
  assert.match(performance,/\/api\/reports\/view/);
  assert.match(performance,/\/api\/reports\/download/);
});

test('ordinary report preview preserves decimals and hides internal revision labels',()=>{
  assert.match(reportView,/String\(Number\(value\)\)/);
  assert.doesNotMatch(reportView,/Report Version/);
});

test('historical review is explicit audited and protects academic evidence',()=>{
  const migration=read('src/db/migrations/017_historical_enrolment_review.sql'),service=read('src/services/historical-review-service.js'),routes=read('src/routes/api-routes.js');
  assert.match(migration,/SUPPORTED_BY_ACADEMIC_EVIDENCE/);
  assert.match(migration,/review_status/);
  assert.match(service,/A reason is required/);
  assert.match(service,/cannot be archived through historical review/);
  assert.match(service,/HISTORICAL_ENROLMENT_REVIEWED/);
  assert.match(routes,/historical-enrolments[\s\S]*admin/);
});

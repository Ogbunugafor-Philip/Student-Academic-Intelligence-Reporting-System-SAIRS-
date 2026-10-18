'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const portals=fs.readFileSync(path.join(__dirname,'../public/js/modules/portals.js'),'utf8');
test('teacher workspace renders assignments from the explicitly selected session',()=>{
  assert.match(portals,/x\.SessionID === current\.SessionID/);
  assert.match(portals,/sessionId=.*termId=/);
});
test('teacher period selection reloads the read-only session context',()=>{
  assert.match(portals,/selectedPeriod = \{ sessionId, termId \}/);
});
test('teacher workspace distinguishes loading error empty and unconfigured states',()=>{
  assert.match(portals,/Loading teaching assignments/);
  assert.match(portals,/Teaching assignments could not be retrieved/);
  assert.match(portals,/No valid teaching assignments exist/);
  assert.match(portals,/No academic period is configured/);
  assert.match(portals,/generation !== renderGeneration/);
});
test('teacher dashboard counts distinct subjects from serialized assignment records',()=>{
  assert.match(portals,/new Set\(subjects\.map\(\(x\) => x\.SubjectID\)\)\.size/);
  assert.match(portals,/\["My Subjects", distinctSubjects\]/);
});
test('assignment progress and score actions use the serialized assignment identifier',()=>{
  assert.match(portals,/progress\.get\(x\.AssignmentID\)/);
  assert.match(portals,/data-open="\$\{x\.AssignmentID\}"/);
  assert.doesNotMatch(portals,/progress\.get\(x\.ID\)/);
});

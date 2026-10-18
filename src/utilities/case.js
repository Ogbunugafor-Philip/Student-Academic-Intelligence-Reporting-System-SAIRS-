'use strict';

const snake = value => String(value).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const snakeObject = obj => Object.fromEntries(Object.entries(obj || {}).map(([key, value]) => [snake(key), value === '' ? null : value]));
const camel = value => String(value).replace(/_([a-z])/g, (_, character) => character.toUpperCase());
const camelObject = obj => Object.fromEntries(Object.entries(obj || {}).map(([key, value]) => [camel(key), value]));
const pascal = value => String(value).split('_').map(part => part === 'id' ? 'ID' : part.charAt(0).toUpperCase() + part.slice(1)).join('').replace(/Id$/, 'ID');

const envelopeObjects = new Set(['identity', 'user', 'profile', 'modules', 'config', 'counts', 'portals']);
const recordObjects = new Set(['assessment', 'batch', 'student', 'teacher', 'reportCard']);

function recordAliases(value, output) {
  if (!value.id) return;
  if (value.admission_number) output.StudentID = value.id;
  if (value.staff_number) output.TeacherID = value.id;
  if (value.assignment_type) output.AssignmentID = value.id;
  if (value.structure_id && value.maximum_score != null) output.AssessmentID = value.id;
  if (value.storage_key) output.ReportCardID = value.id;
  if (value.total_weighted_score != null) output.ResultID = value.id;
  if (value.academic_session_id && value.subject_id && value.status && !value.structure_id) output.BatchID = value.id;
  if (value.name && value.start_date !== undefined && value.end_date !== undefined && !value.academic_session_id) { output.SessionID = value.id; output.SessionName = value.name; }
  if (value.academic_session_id && value.name && value.start_date !== undefined) { output.TermID = value.id; output.TermName = value.name; }
  if (value.class_id && value.name && value.start_date === undefined && !value.category) { output.ClassArmID = value.id; output.ArmName = value.name; }
  if (value.name && value.sort_order !== undefined && !value.grade) { output.ClassID = value.id; output.ClassName = value.name; }
  if (value.code && value.category) { output.StructureID = value.id; output.AssessmentCode = value.code; output.AssessmentName = value.name; }
  if (value.code && !value.category) { output.SubjectID = value.id; output.SubjectCode = value.code; output.SubjectName = value.name; }
  if (value.grade && value.minimum_score != null) output.GradingRuleID = value.id;
  if (value.email && value.role) output.UserID = value.id;
}

function legacy(value, mode = 'auto') {
  if (Array.isArray(value)) return value.map(item => legacy(item, 'record'));
  if (!value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;
  const keys = Object.keys(value);
  const isRecord = mode === 'record' || (mode === 'auto' && (keys.some(key => key.includes('_')) || (value.id && value.status)));
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    const outputKey = isRecord ? (key === 'academic_session_id' ? 'SessionID' : pascal(key)) : key;
    const childMode = envelopeObjects.has(key) ? 'envelope' : recordObjects.has(key) ? 'record' : 'auto';
    output[outputKey] = isRecord && key === 'status' && typeof child === 'string'
      ? child.charAt(0) + child.slice(1).toLowerCase()
      : legacy(child, childMode);
  }
  if (isRecord) recordAliases(value, output);
  return output;
}

module.exports = { snake, snakeObject, camel, camelObject, pascal, legacy };

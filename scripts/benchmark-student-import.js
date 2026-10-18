'use strict';

// Run only against an explicitly named non-production database.
if (!process.env.DATABASE_NAME || !/benchmark|rehearsal|test/i.test(process.env.DATABASE_NAME)) {
  throw new Error('DATABASE_NAME must explicitly identify a benchmark, rehearsal, or test database.');
}

require('dotenv').config({ quiet: true });
const { pool, transaction } = require('../src/db/pool');
const imports = require('../src/services/import-service');
const bulk = require('../src/services/bulk-student-import-service');

const headers = imports.STUDENT_HEADERS.join(',');
const now = () => Number(process.hrtime.bigint()) / 1e6;
const one = async (query, parameters = []) => (await pool.query(query, parameters)).rows[0];

function fileFor(rows, guardians, prefix) {
  const lines = [headers];
  for (let index = 1; index <= rows; index += 1) {
    const guardian = ((index - 1) % guardians) + 1;
    const values = [
      `${prefix}/${String(index).padStart(5, '0')}`, `First${index}`, '', `Last${index}`,
      '2022-09-01', `Class ${((index - 1) % 12) + 1}`, `Arm ${((index - 1) % 4) + 1}`,
      `Guardian ${guardian}`, `${prefix.toLowerCase()}-guardian-${guardian}@bench.invalid`,
      '+491234567890', 'Benchmark address'
    ];
    lines.push(values.map(value => `"${String(value).replaceAll('"', '""')}"`).join(','));
  }
  return { fileName: `${prefix}.csv`, base64: Buffer.from(lines.join('\n')).toString('base64') };
}

async function fixture(label) {
  const slug = `bulk-bench-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const school = await one('INSERT INTO schools(name,slug) VALUES($1,$2) RETURNING id', [`Bulk benchmark ${label}`, slug]);
  const admin = await one("INSERT INTO users(school_id,email,role,status) VALUES($1,$2,'IT_ADMIN','ACTIVE') RETURNING id", [school.id, `admin-${slug}@bench.invalid`]);
  await pool.query("INSERT INTO academic_sessions(school_id,name,is_current,status) VALUES($1,'2022/2023',true,'ACTIVE')", [school.id]);
  await pool.query("INSERT INTO terms(school_id,academic_session_id,name,is_current,status) SELECT $1,id,'First Term',true,'ACTIVE' FROM academic_sessions WHERE school_id=$1", [school.id]);
  return { identity: { schoolId: school.id, id: admin.id }, schoolId: school.id };
}

async function cleanup(schoolId) {
  const tables = ['audit_logs', 'student_class_history', 'student_session_enrolments', 'parent_student_links', 'parents', 'students', 'class_arms', 'classes', 'terms', 'academic_sessions', 'refresh_sessions', 'users'];
  for (const table of tables) {
    try { await pool.query(`DELETE FROM ${table} WHERE school_id=$1`, [schoolId]); }
    catch (error) { if (error.code !== '42P01') throw error; }
  }
  await pool.query('DELETE FROM schools WHERE id=$1', [schoolId]);
}

async function counts(schoolId) {
  return one(`SELECT
    (SELECT count(*)::int FROM students WHERE school_id=$1) students,
    (SELECT count(*)::int FROM users WHERE school_id=$1 AND role='PARENT') guardian_users,
    (SELECT count(*)::int FROM parents WHERE school_id=$1) parents,
    (SELECT count(*)::int FROM parent_student_links WHERE school_id=$1) links,
    (SELECT count(*)::int FROM student_session_enrolments WHERE school_id=$1) enrolments,
    (SELECT count(*)::int FROM student_class_history WHERE school_id=$1) history,
    (SELECT count(*)-count(DISTINCT lower(admission_number)) FROM students WHERE school_id=$1)::int duplicate_admissions,
    (SELECT count(*)-count(DISTINCT lower(email::text)) FROM users WHERE school_id=$1 AND role='PARENT')::int duplicate_guardian_users,
    (SELECT count(*)-count(DISTINCT (parent_id,student_id)) FROM parent_student_links WHERE school_id=$1)::int duplicate_links,
    (SELECT count(*)-count(DISTINCT (student_id,academic_session_id)) FROM student_session_enrolments WHERE school_id=$1)::int duplicate_enrolments,
    (SELECT count(*)::int FROM student_session_enrolments e JOIN academic_sessions s ON s.id=e.academic_session_id JOIN classes c ON c.id=e.class_id JOIN class_arms a ON a.id=e.class_arm_id WHERE e.school_id=$1 AND s.name='2022/2023' AND c.id=a.class_id) correct_placements`, [schoolId]);
}

async function benchmark(rows, guardians) {
  const fixtureData = await fixture(`${rows}`);
  const file = fileFor(rows, guardians, `B${rows}`);
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 20);
  const started = now();
  try {
    const preparationStarted = now();
    const preview = await imports.validateStudentImport(fixtureData.identity, file);
    const preparationMs = now() - preparationStarted;
    const hashingStarted = now();
    const prepared = await bulk.prepareCredentials(preview);
    const hashingMs = now() - hashingStarted;
    let queryCount = 0;
    const transactionStarted = now();
    const result = await transaction(async client => {
      const measuredClient = { query(...args) { queryCount += 1; return client.query(...args); } };
      await measuredClient.query("SET LOCAL statement_timeout='5min'; SET LOCAL idle_in_transaction_session_timeout='5min'");
      const validation = await imports.validateStudentImport(fixtureData.identity, file, measuredClient, { autoCreateStructure: true });
      validation.sessionId = (await measuredClient.query("SELECT id FROM academic_sessions WHERE school_id=$1 AND is_current=true AND status='ACTIVE'", [fixtureData.schoolId])).rows[0].id;
      const context = (await measuredClient.query('SELECT se.name session_name,t.name term_name FROM academic_sessions se LEFT JOIN terms t ON t.school_id=se.school_id AND t.is_current=true WHERE se.school_id=$1 AND se.id=$2', [fixtureData.schoolId, validation.sessionId])).rows[0];
      validation.sessionName = context.session_name;
      validation.termName = context.term_name;
      return bulk.executeBulkImport({ identity: fixtureData.identity, validation, prepared, client: measuredClient });
    });
    const transactionMs = now() - transactionStarted;
    return { rows, guardians, preparationMs, hashingMs, transactionMs, totalMs: now() - started, queryCount, peakRssBytes: peakRss, summary: result.summary, counts: await counts(fixtureData.schoolId) };
  } finally {
    clearInterval(sampler);
    await cleanup(fixtureData.schoolId);
  }
}

async function main() {
  const sizes = process.argv.slice(2).map(Number);
  for (const rows of (sizes.length ? sizes : [1700, 2000])) {
    const guardians = rows === 1700 ? 1320 : Math.min(1600, rows);
    console.log(JSON.stringify(await benchmark(rows, guardians)));
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => pool.end());

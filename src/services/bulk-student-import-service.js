'use strict';

const { transaction } = require('../db/pool');
const { hashPassword, generateTemporaryPassword } = require('../security/password');
const { audit } = require('./audit-service');
const students = require('./student-service');
const { env } = require('../config/env');
const { errors } = require('../utilities/errors');

async function parallelMap(values, concurrency, work) {
  const output = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      output[index] = await work(values[index], index);
    }
  }));
  return output;
}

async function prepareCredentials(validation) {
  const firstByEmail = new Map();
  for (const item of validation.records) if (!item.guardianExisting && !firstByEmail.has(item.data.guardianEmail)) firstByEmail.set(item.data.guardianEmail, item.data);
  const prepared = await parallelMap([...firstByEmail.values()], 4, async data => {
    const temporaryPassword = generateTemporaryPassword();
    return { email: data.guardianEmail, temporaryPassword, passwordHash: await hashPassword(temporaryPassword), guardianFullName: data.guardianFullName };
  });
  return new Map(prepared.map(item => [item.email, item]));
}

async function executeBulkImport({ identity, validation, prepared, req, client }) {
  const schoolId = identity.schoolId, actor = identity.id;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${schoolId}:student-bulk-import`]);
  const firstByEmail = new Map();
  for (const item of validation.records) if (!firstByEmail.has(item.data.guardianEmail)) firstByEmail.set(item.data.guardianEmail, item.data);
  const existing = (await client.query(`SELECT lower(email::text) email FROM users WHERE school_id=$1`, [schoolId])).rows;
  const existingEmails = new Set(existing.map(row => row.email));
  const newUsers = [...prepared.values()].filter(item => !existingEmails.has(item.email)).map(item => ({ email: item.email, passwordHash: item.passwordHash }));
  if (newUsers.length) await client.query(`INSERT INTO users(school_id,email,role,status,password_hash,must_change_password,created_by)
    SELECT $1,x.email,'PARENT','ACTIVE',x.password_hash,true,$2 FROM jsonb_to_recordset($3::jsonb) x(email text,password_hash text)
    ON CONFLICT(school_id,email) DO NOTHING`, [schoolId, actor, JSON.stringify(newUsers.map(x => ({ email: x.email, password_hash: x.passwordHash })))]);
  const users = (await client.query(`SELECT id,lower(email::text) email,role FROM users WHERE school_id=$1`, [schoolId])).rows;
  const userByEmail = new Map(users.map(row => [row.email, row]));
  for (const email of firstByEmail.keys()) if (userByEmail.get(email)?.role !== 'PARENT') throw new Error(`Guardian account ${email} is unavailable.`);
  const parentRows = [...firstByEmail.entries()].map(([email, data]) => ({ email, user_id: userByEmail.get(email).id, ...students.guardianNameParts(data.guardianFullName), phone: data.guardianPhone, address: data.guardianAddress || null }));
  await client.query(`INSERT INTO parents(school_id,user_id,first_name,middle_name,last_name,email,phone,address,status)
    SELECT $1,x.user_id,x.first_name,NULLIF(x.middle_name,''),x.last_name,x.email,x.phone,x.address,'ACTIVE'
    FROM jsonb_to_recordset($2::jsonb) x(user_id uuid,first_name text,middle_name text,last_name text,email text,phone text,address text)
    WHERE NOT EXISTS(SELECT 1 FROM parents p WHERE p.school_id=$1 AND lower(p.email::text)=lower(x.email))`, [schoolId, JSON.stringify(parentRows.map(x => ({ user_id: x.user_id, first_name: x.firstName, middle_name: x.middleName, last_name: x.lastName, email: x.email, phone: x.phone, address: x.address })))]);
  await client.query(`UPDATE parents p SET user_id=u.id,status='ACTIVE',updated_at=now() FROM users u WHERE p.school_id=$1 AND u.school_id=p.school_id AND lower(u.email::text)=lower(p.email::text) AND p.user_id IS NULL`, [schoolId]);
  const parentByEmail = new Map((await client.query(`SELECT id,lower(email::text) email FROM parents WHERE school_id=$1`, [schoolId])).rows.map(row => [row.email, row.id]));
  const records = validation.records.map(item => ({ admission_number: item.data.admissionNumber, first_name: item.data.firstName, middle_name: item.data.middleName || null, last_name: item.data.lastName, admission_date: item.data.admissionDate, admission_session_id: validation.sessionId, class_id: item.data.classId, class_arm_id: item.data.classArmId, guardian_email: item.data.guardianEmail }));
  await client.query(`INSERT INTO students(school_id,admission_number,first_name,middle_name,last_name,admission_date,admission_session_id,class_id,class_arm_id,status,created_by,updated_by)
    SELECT $1,x.admission_number,x.first_name,x.middle_name,x.last_name,x.admission_date,x.admission_session_id,x.class_id,x.class_arm_id,'ACTIVE',$2,$2
    FROM jsonb_to_recordset($3::jsonb) x(admission_number text,first_name text,middle_name text,last_name text,admission_date date,admission_session_id uuid,class_id uuid,class_arm_id uuid)`, [schoolId, actor, JSON.stringify(records)]);
  const studentByAdmission = new Map((await client.query(`SELECT id,admission_number FROM students WHERE school_id=$1`, [schoolId])).rows.map(row => [row.admission_number, row.id]));
  const relations = records.map(row => ({ student_id: studentByAdmission.get(row.admission_number), parent_id: parentByEmail.get(row.guardian_email), session_id: row.admission_session_id, class_id: row.class_id, arm_id: row.class_arm_id, date: row.admission_date }));
  const json = JSON.stringify(relations);
  await client.query(`INSERT INTO parent_student_links(school_id,parent_id,student_id,relationship,is_primary,status) SELECT $1,x.parent_id,x.student_id,'Guardian',true,'ACTIVE' FROM jsonb_to_recordset($2::jsonb) x(parent_id uuid,student_id uuid) ON CONFLICT(school_id,parent_id,student_id) DO UPDATE SET status='ACTIVE'`, [schoolId, json]);
  await client.query(`INSERT INTO student_session_enrolments(school_id,student_id,academic_session_id,class_id,class_arm_id,status,enrolment_date,created_by,updated_by) SELECT $1,x.student_id,x.session_id,x.class_id,x.arm_id,'ACTIVE',x.date,$2,$2 FROM jsonb_to_recordset($3::jsonb) x(student_id uuid,session_id uuid,class_id uuid,arm_id uuid,date date) ON CONFLICT(school_id,student_id,academic_session_id) DO NOTHING`, [schoolId, actor, json]);
  await client.query(`INSERT INTO student_class_history(school_id,student_id,academic_session_id,to_class_id,to_class_arm_id,action,effective_date,created_by) SELECT $1,x.student_id,x.session_id,x.class_id,x.arm_id,'ADMISSION',x.date,$2 FROM jsonb_to_recordset($3::jsonb) x(student_id uuid,session_id uuid,class_id uuid,arm_id uuid,date date)`, [schoolId, actor, json]);
  const createdEmails = new Set(newUsers.map(x => x.email));
  const createdGuardianCredentials = [...prepared.values()].filter(x => createdEmails.has(x.email));
  const credentials = validation.records.filter(item => createdEmails.has(item.data.guardianEmail)).map(item => { const credential = prepared.get(item.data.guardianEmail); return { studentName: [item.data.firstName,item.data.middleName,item.data.lastName].filter(Boolean).join(' '), admissionNumber: item.data.admissionNumber, guardianFullName: item.data.guardianFullName, guardianEmail: item.data.guardianEmail, temporaryPassword: credential.temporaryPassword, loginUrl: env.origin }; });
  const summary = { studentsImported: records.length, newGuardiansCreated: createdGuardianCredentials.length, existingGuardiansLinked: firstByEmail.size - createdGuardianCredentials.length, parentAccountsCreated: createdGuardianCredentials.length, guardianLinksCreated: relations.length, enrolmentsCreated: relations.length, classPlacementsCreated: relations.length, sessionName: validation.sessionName, termName: validation.termName };
  await audit({ schoolId, userId: actor, action: 'STUDENT_BULK_IMPORT', entityType: 'StudentImport', newValue: summary, req, client });
  return { summary, credentials };
}

async function run({ identity, file, req, validate, onComplete }) {
  const preview = await validate(identity, file);
  if (preview.summary.invalidRows) throw errors.validation('The student and guardian file contains validation errors.');
  const prepared = await prepareCredentials(preview);
  return transaction(async client => {
    await client.query(`SET LOCAL statement_timeout='5min'; SET LOCAL idle_in_transaction_session_timeout='5min'`);
    const validation = await validate(identity, file, client, { autoCreateStructure: true });
    validation.sessionId = (await client.query(`SELECT id FROM academic_sessions WHERE school_id=$1 AND is_current=true AND status='ACTIVE'`, [identity.schoolId])).rows[0].id;
    const context = (await client.query(`SELECT se.name session_name,t.name term_name FROM academic_sessions se LEFT JOIN terms t ON t.school_id=se.school_id AND t.is_current=true WHERE se.school_id=$1 AND se.id=$2`, [identity.schoolId, validation.sessionId])).rows[0];
    validation.sessionName = context.session_name; validation.termName = context.term_name;
    const result = await executeBulkImport({ identity, validation, prepared, req, client });
    if(onComplete)await onComplete({client,result,validation});
    return result;
  });
}

module.exports = { run, prepareCredentials, parallelMap, executeBulkImport };

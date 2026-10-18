'use strict';
const crypto = require('crypto');
const { pool, transaction } = require('../db/pool');
const imports = require('./import-service');
const bulk = require('./bulk-student-import-service');
const { audit } = require('./audit-service');
const artifacts = require('../security/import-artifacts');
const { errors } = require('../utilities/errors');

const running = new Set();
const safeFailure = error => error?.status && error.status < 500 ? error.message : 'The import could not be completed. No student records were created.';
const csvCell = value => `"${String(value ?? '').replaceAll('"','""')}"`;

function fingerprint(file, sessionId, termId) {
  return crypto.createHash('sha256').update(sessionId).update('\0').update(termId).update('\0').update(Buffer.from(file?.base64 || '', 'base64')).digest('hex');
}

async function create(identity, file, req) {
  const context = (await pool.query(`SELECT s.id session_id,t.id term_id,s.name session_name,t.name term_name
    FROM academic_sessions s JOIN terms t ON t.school_id=s.school_id AND t.academic_session_id=s.id AND t.is_current=true AND t.status='ACTIVE'
    WHERE s.school_id=$1 AND s.is_current=true AND s.status='ACTIVE' LIMIT 1`, [identity.schoolId])).rows[0];
  if (!context) throw errors.validation(imports.IMPORT_SESSION_ERROR);
  const digest = fingerprint(file, context.session_id, context.term_id);
  const previous=(await pool.query(`SELECT * FROM student_import_jobs WHERE school_id=$1 AND fingerprint=$2 AND status IN('PENDING','PROCESSING','COMPLETED') ORDER BY started_at DESC LIMIT 1`,[identity.schoolId,digest])).rows[0];
  if(previous)return{job:await get(identity,previous.id),duplicate:true};
  const validation = await imports.validateStudentImport(identity, file);
  if (validation.summary.invalidRows) throw errors.validation('The student and guardian file contains validation errors.');
  const encrypted = artifacts.encrypt(file);
  let job, duplicate = false;
  try {
    job = await transaction(async client => {
      const row = (await client.query(`INSERT INTO student_import_jobs(school_id,started_by,academic_session_id,term_id,import_reference,original_filename,total_rows,fingerprint,source_ciphertext,source_iv,source_auth_tag)
        VALUES($1,$2,$3,$4,format('IMP-%s-%s',extract(year from current_date)::int,lpad(nextval('student_import_reference_seq')::text,6,'0')),$5,$6,$7,$8,$9,$10) RETURNING *`,
      [identity.schoolId, identity.id, context.session_id, context.term_id, String(file.fileName || 'student-import'), validation.summary.totalRows, digest, encrypted.ciphertext, encrypted.iv, encrypted.authTag])).rows[0];
      await audit({schoolId:identity.schoolId,userId:identity.id,action:'IMPORT_STARTED',entityType:'StudentImportJob',entityId:row.id,newValue:{importReference:row.import_reference,filename:row.original_filename,totalRows:row.total_rows,sessionName:context.session_name,termName:context.term_name},req,client});
      return row;
    });
  } catch (error) {
    if (error.code !== '23505') throw error;
    job = (await pool.query(`SELECT * FROM student_import_jobs WHERE school_id=$1 AND fingerprint=$2 AND status IN('PENDING','PROCESSING','COMPLETED') ORDER BY started_at DESC LIMIT 1`, [identity.schoolId,digest])).rows[0];
    if (!job) throw error;
    duplicate = true;
  }
  if (!duplicate) setImmediate(() => processJob(job.id).catch(() => {}));
  return { job: await get(identity, job.id), duplicate };
}

async function processJob(jobId) {
  if (running.has(jobId)) return;
  running.add(jobId);
  let job;
  try {
    job = (await pool.query(`UPDATE student_import_jobs SET status='PROCESSING',error_message=NULL WHERE id=$1 AND status='PENDING' RETURNING *`, [jobId])).rows[0];
    if (!job) return;
    const user = (await pool.query(`SELECT id,school_id FROM users WHERE id=$1 AND school_id=$2 AND status='ACTIVE'`, [job.started_by,job.school_id])).rows[0];
    if (!user) throw errors.forbidden('The administrator who started this import is no longer active.');
    const file = artifacts.decrypt({ciphertext:job.source_ciphertext,iv:job.source_iv,auth_tag:job.source_auth_tag});
    await bulk.run({identity:{id:user.id,schoolId:user.school_id},file,validate:imports.validateStudentImport,onComplete:async({client,result})=>{
      if(result.credentials.length){const encrypted=artifacts.encrypt(result.credentials);await client.query(`INSERT INTO student_import_credentials(job_id,school_id,ciphertext,iv,auth_tag) VALUES($1,$2,$3,$4,$5)`,[job.id,job.school_id,encrypted.ciphertext,encrypted.iv,encrypted.authTag]);}
      await client.query(`UPDATE student_import_jobs SET status='COMPLETED',completed_at=now(),students_created=$1,guardians_created=$2,guardian_links_created=$3,enrolments_created=$4,error_message=NULL,source_ciphertext=NULL,source_iv=NULL,source_auth_tag=NULL WHERE id=$5 AND school_id=$6`,[result.summary.studentsImported,result.summary.newGuardiansCreated,result.summary.guardianLinksCreated,result.summary.enrolmentsCreated,job.id,job.school_id]);
      await audit({schoolId:job.school_id,userId:job.started_by,action:'IMPORT_COMPLETED',entityType:'StudentImportJob',entityId:job.id,newValue:{importReference:job.import_reference,...result.summary},client});
    }});
  } catch (error) {
    if (job) await transaction(async client => {
      const message=safeFailure(error);
      await client.query(`UPDATE student_import_jobs SET status='FAILED',completed_at=now(),students_created=0,guardians_created=0,guardian_links_created=0,enrolments_created=0,error_message=$1,source_ciphertext=NULL,source_iv=NULL,source_auth_tag=NULL WHERE id=$2 AND school_id=$3`,[message,job.id,job.school_id]);
      await audit({schoolId:job.school_id,userId:job.started_by,action:'IMPORT_FAILED',entityType:'StudentImportJob',entityId:job.id,newValue:{importReference:job.import_reference,error:message},client});
    });
  } finally { running.delete(jobId); }
}

async function list(identity) {
  return (await pool.query(`SELECT j.id,j.import_reference,j.original_filename,j.total_rows,j.status,j.started_at,j.completed_at,j.students_created,j.guardians_created,j.guardian_links_created,j.enrolments_created,j.error_message,s.name session_name,t.name term_name,u.email started_by_email,EXISTS(SELECT 1 FROM student_import_credentials c WHERE c.job_id=j.id AND c.school_id=j.school_id) credentials_available
    FROM student_import_jobs j JOIN academic_sessions s ON s.id=j.academic_session_id AND s.school_id=j.school_id JOIN terms t ON t.id=j.term_id AND t.school_id=j.school_id JOIN users u ON u.id=j.started_by AND u.school_id=j.school_id
    WHERE j.school_id=$1 ORDER BY j.started_at DESC LIMIT 100`, [identity.schoolId])).rows;
}

async function get(identity, jobId) {
  const row = (await pool.query(`SELECT j.id,j.import_reference,j.original_filename,j.total_rows,j.status,j.started_at,j.completed_at,j.students_created,j.guardians_created,j.guardian_links_created,j.enrolments_created,j.error_message,s.name session_name,t.name term_name,u.email started_by_email,EXISTS(SELECT 1 FROM student_import_credentials c WHERE c.job_id=j.id AND c.school_id=j.school_id) credentials_available
    FROM student_import_jobs j JOIN academic_sessions s ON s.id=j.academic_session_id AND s.school_id=j.school_id JOIN terms t ON t.id=j.term_id AND t.school_id=j.school_id JOIN users u ON u.id=j.started_by AND u.school_id=j.school_id
    WHERE j.school_id=$1 AND j.id=$2`, [identity.schoolId,jobId])).rows[0];
  if(!row)throw errors.notFound('Import job not found.');
  return row;
}

async function credentials(identity, jobId, req) {
  const job = await get(identity,jobId);
  if(job.status!=='COMPLETED')throw errors.conflict('Guardian credentials are available only after an import completes.');
  const artifact=(await pool.query(`SELECT ciphertext,iv,auth_tag FROM student_import_credentials WHERE school_id=$1 AND job_id=$2`,[identity.schoolId,jobId])).rows[0];
  if(!artifact)throw errors.notFound('This import did not create new guardian credentials.');
  const rows=artifacts.decrypt(artifact),content='\uFEFF'+[['Student Name','Admission Number','Guardian Name','Guardian Email','Temporary Password','Login URL'],...rows.map(row=>[row.studentName,row.admissionNumber,row.guardianFullName,row.guardianEmail,row.temporaryPassword,row.loginUrl])].map(row=>row.map(csvCell).join(',')).join('\r\n');
  await transaction(async client=>{await client.query(`UPDATE student_import_credentials SET last_downloaded_at=now() WHERE school_id=$1 AND job_id=$2`,[identity.schoolId,jobId]);await audit({schoolId:identity.schoolId,userId:identity.id,action:'GUARDIAN_CREDENTIALS_DOWNLOADED',entityType:'StudentImportJob',entityId:jobId,newValue:{importReference:job.import_reference,rowCount:rows.length},req,client});});
  return {fileName:`${job.import_reference}-Guardian-Credentials.csv`,mimeType:'text/csv;charset=utf-8',base64:Buffer.from(content).toString('base64')};
}

async function resumeUnfinished() {
  const rows=(await pool.query(`UPDATE student_import_jobs SET status='PENDING' WHERE status='PROCESSING' AND source_ciphertext IS NOT NULL RETURNING id`)).rows;
  const pending=(await pool.query(`SELECT id FROM student_import_jobs WHERE status='PENDING' AND source_ciphertext IS NOT NULL ORDER BY started_at`)).rows;
  for(const row of [...rows,...pending])setImmediate(()=>processJob(row.id).catch(()=>{}));
}

module.exports={create,list,get,credentials,processJob,resumeUnfinished,fingerprint};

"use strict";

const { pool, transaction } = require("../db/pool");
const { audit } = require("./audit-service");
const { errors } = require("../utilities/errors");

const clean = (value) => String(value ?? "").trim();

async function sourceSession(client, schoolId, target, requestedId) {
  if (requestedId) {
    const row = (await client.query(
      `SELECT * FROM academic_sessions WHERE school_id=$1 AND id=$2 AND id<>$3 AND status<>'ARCHIVED'`,
      [schoolId, requestedId, target.id],
    )).rows[0];
    if (!row) throw errors.validation("Select a valid source session from this school.");
    return row;
  }
  return (await client.query(
    `SELECT * FROM academic_sessions
     WHERE school_id=$1 AND id<>$2 AND status<>'ARCHIVED'
       AND ($3::date IS NULL OR start_date IS NULL OR start_date<$3::date)
       AND ($3::date IS NOT NULL OR $4::int IS NULL OR
            CASE WHEN name ~ '^[0-9]{4}' THEN substring(name from 1 for 4)::int END < $4::int)
     ORDER BY COALESCE(end_date,make_date(CASE WHEN name ~ '^[0-9]{4}' THEN substring(name from 1 for 4)::int END+1,12,31)) DESC NULLS LAST,
              COALESCE(start_date,make_date(CASE WHEN name ~ '^[0-9]{4}' THEN substring(name from 1 for 4)::int END,1,1)) DESC NULLS LAST,
              created_at DESC
     LIMIT 1`,
    [schoolId, target.id, target.start_date, /^\d{4}/.test(target.name || "") ? Number(String(target.name).slice(0, 4)) : null],
  )).rows[0] || null;
}

async function counts(client, schoolId, sourceId) {
  if (!sourceId) return { eligibleStudents: 0, subjectTeachers: 0, subjectTeacherAssignments: 0, formTeacherAssignments: 0, curriculumMappings: 0 };
  return (await client.query(
    `SELECT
       (SELECT count(*)::int FROM student_session_enrolments e JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id WHERE e.school_id=$1 AND e.academic_session_id=$2 AND e.status='ACTIVE' AND s.status='ACTIVE') eligible_students,
       (SELECT count(DISTINCT ta.teacher_id)::int FROM teacher_assignments ta JOIN teachers t ON t.id=ta.teacher_id AND t.school_id=ta.school_id WHERE ta.school_id=$1 AND ta.academic_session_id=$2 AND ta.assignment_type='SUBJECT_TEACHER' AND ta.status='ACTIVE' AND t.status='ACTIVE') subject_teachers,
       (SELECT count(*)::int FROM teacher_assignments ta JOIN teachers t ON t.id=ta.teacher_id AND t.school_id=ta.school_id WHERE ta.school_id=$1 AND ta.academic_session_id=$2 AND ta.assignment_type='SUBJECT_TEACHER' AND ta.status='ACTIVE' AND t.status='ACTIVE') subject_teacher_assignments,
       (SELECT count(*)::int FROM teacher_assignments ta JOIN teachers t ON t.id=ta.teacher_id AND t.school_id=ta.school_id WHERE ta.school_id=$1 AND ta.academic_session_id=$2 AND ta.assignment_type='CLASS_TEACHER' AND ta.status='ACTIVE' AND t.status='ACTIVE') form_teacher_assignments,
       (SELECT count(*)::int FROM session_class_subjects WHERE school_id=$1 AND academic_session_id=$2 AND status='ACTIVE') curriculum_mappings`,
    [schoolId, sourceId],
  )).rows[0];
}

async function preview(identity, data = {}) {
  const target = data.targetSessionId
    ? (await pool.query(`SELECT * FROM academic_sessions WHERE school_id=$1 AND id=$2`, [identity.schoolId, data.targetSessionId])).rows[0]
    : { id: "00000000-0000-0000-0000-000000000000", name: clean(data.sessionName), start_date: data.startDate || null };
  if (data.targetSessionId && !target) throw errors.notFound("Target academic session not found.");
  const source = await sourceSession(pool, identity.schoolId, target, data.sourceSessionId);
  return { sourceSession: source, targetSession: data.targetSessionId ? target : null, counts: await counts(pool, identity.schoolId, source?.id) };
}

async function carryForward(client, identity, source, target, mode, req) {
  const schoolId = identity.schoolId;
  const targetYear = /^\d{4}/.test(target.name || "") ? Number(String(target.name).slice(0, 4)) : null;
  const eligibilityEnd = target.end_date || (targetYear ? `${targetYear + 1}-12-31` : null);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${schoolId}:rollover:${target.id}`]);
  if (!source) {
    const empty = { sourceSessionId: null, targetSessionId: target.id, studentsCreated: 0, subjectAssignmentsCreated: 0, formTeacherAssignmentsCreated: 0, curriculumMappingsCreated: 0 };
    await record(client, identity, empty, mode, req);
    return empty;
  }
  const curriculum = await client.query(
    `INSERT INTO session_class_subjects(school_id,academic_session_id,class_id,subject_id,status,source_session_class_subject_id)
     SELECT scs.school_id,$3,scs.class_id,scs.subject_id,'ACTIVE',scs.id
     FROM session_class_subjects scs
     WHERE scs.school_id=$1 AND scs.academic_session_id=$2 AND scs.status='ACTIVE'
       AND NOT EXISTS(SELECT 1 FROM session_class_subjects x WHERE x.school_id=$1 AND x.academic_session_id=$3 AND x.class_id=scs.class_id AND x.subject_id=scs.subject_id)
     ON CONFLICT DO NOTHING RETURNING id`, [schoolId, source.id, target.id]);
  const enrolments = await client.query(
    `INSERT INTO student_session_enrolments(school_id,student_id,academic_session_id,class_id,class_arm_id,status,enrolment_date,created_by,updated_by)
     SELECT e.school_id,e.student_id,$3,e.class_id,e.class_arm_id,'ACTIVE',COALESCE($4::date,CURRENT_DATE),$5,$5
     FROM student_session_enrolments e JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id
     WHERE e.school_id=$1 AND e.academic_session_id=$2 AND e.status='ACTIVE' AND s.status='ACTIVE'
       AND ($6::date IS NULL OR s.admission_date<=$6::date)
       AND NOT EXISTS(SELECT 1 FROM student_session_enrolments x WHERE x.school_id=$1 AND x.student_id=e.student_id AND x.academic_session_id=$3)
     ON CONFLICT DO NOTHING RETURNING id`, [schoolId, source.id, target.id, target.start_date, identity.id, eligibilityEnd]);
  const assignments = await client.query(
    `INSERT INTO teacher_assignments(school_id,teacher_id,academic_session_id,term_id,class_id,class_arm_id,subject_id,assignment_type,status)
     SELECT ta.school_id,ta.teacher_id,$3,NULL,ta.class_id,ta.class_arm_id,ta.subject_id,ta.assignment_type,'ACTIVE'
     FROM teacher_assignments ta JOIN teachers t ON t.id=ta.teacher_id AND t.school_id=ta.school_id
     WHERE ta.school_id=$1 AND ta.academic_session_id=$2 AND ta.status='ACTIVE' AND t.status='ACTIVE'
       AND NOT EXISTS(SELECT 1 FROM teacher_assignments x WHERE x.school_id=$1 AND x.academic_session_id=$3 AND x.teacher_id=ta.teacher_id AND x.class_id=ta.class_id AND x.class_arm_id IS NOT DISTINCT FROM ta.class_arm_id AND x.subject_id IS NOT DISTINCT FROM ta.subject_id AND x.assignment_type=ta.assignment_type AND x.status='ACTIVE')
       AND (ta.assignment_type<>'CLASS_TEACHER' OR NOT EXISTS(SELECT 1 FROM teacher_assignments x WHERE x.school_id=$1 AND x.academic_session_id=$3 AND x.class_id=ta.class_id AND x.class_arm_id IS NOT DISTINCT FROM ta.class_arm_id AND x.assignment_type='CLASS_TEACHER' AND x.status='ACTIVE'))
     ON CONFLICT DO NOTHING RETURNING assignment_type`, [schoolId, source.id, target.id]);
  const result = {
    sourceSessionId: source.id, targetSessionId: target.id,
    studentsCreated: enrolments.rowCount,
    subjectAssignmentsCreated: assignments.rows.filter(x => x.assignment_type === "SUBJECT_TEACHER").length,
    formTeacherAssignmentsCreated: assignments.rows.filter(x => x.assignment_type === "CLASS_TEACHER").length,
    curriculumMappingsCreated: curriculum.rowCount,
  };
  await record(client, identity, result, mode, req);
  return result;
}

async function record(client, identity, result, mode, req) {
  const row = (await client.query(
    `INSERT INTO academic_session_rollovers(school_id,source_session_id,target_session_id,mode,status,students_created,subject_assignments_created,form_teacher_assignments_created,curriculum_mappings_created,initiated_by,details)
     VALUES($1,$2,$3,$4,'COMPLETED',$5,$6,$7,$8,$9,$10) RETURNING *`,
    [identity.schoolId,result.sourceSessionId,result.targetSessionId,mode,result.studentsCreated,result.subjectAssignmentsCreated,result.formTeacherAssignmentsCreated,result.curriculumMappingsCreated,identity.id,result],
  )).rows[0];
  await audit({ schoolId: identity.schoolId, userId: identity.id, action: mode === "CREATE" ? "ACADEMIC_SESSION_ROLLOVER_COMPLETED" : "ACADEMIC_SESSION_RECONCILED", entityType: "AcademicSessionRollover", entityId: row.id, newValue: result, req, client });
}

async function create(identity, data, req) {
  if (!clean(data.sessionName)) throw errors.validation("Session name is required.");
  return transaction(async client => {
    const target = (await client.query(
      `INSERT INTO academic_sessions(school_id,name,start_date,end_date,status) VALUES($1,$2,$3,$4,'ACTIVE') RETURNING *`,
      [identity.schoolId, clean(data.sessionName), data.startDate || null, data.endDate || null],
    )).rows[0];
    const source = await sourceSession(client, identity.schoolId, target, data.sourceSessionId);
    const rollover = await carryForward(client, identity, source, target, "CREATE", req);
    await audit({ schoolId: identity.schoolId, userId: identity.id, action: "ACADEMIC_SESSION_CREATED", entityType: "AcademicSession", entityId: target.id, newValue: target, req, client });
    return { session: target, sourceSession: source, rollover };
  });
}

async function reconcile(identity, data, req) {
  return transaction(async client => {
    const target = (await client.query(`SELECT * FROM academic_sessions WHERE school_id=$1 AND id=$2 FOR UPDATE`, [identity.schoolId, data.targetSessionId])).rows[0];
    if (!target) throw errors.notFound("Target academic session not found.");
    const source = await sourceSession(client, identity.schoolId, target, data.sourceSessionId);
    if (!source) throw errors.validation("No earlier source session is available.");
    return { session: target, sourceSession: source, rollover: await carryForward(client, identity, source, target, "RECONCILE", req) };
  });
}

async function promotionRoster(identity, data) {
  const rows = (await pool.query(
    `SELECT e.student_id,s.admission_number,s.first_name,s.middle_name,s.last_name,e.class_id,e.class_arm_id,e.status
     FROM student_session_enrolments e JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id
     WHERE e.school_id=$1 AND e.academic_session_id=$2 AND e.class_id=$3 AND e.class_arm_id IS NOT DISTINCT FROM $4 AND e.status<>'ARCHIVED'
     ORDER BY s.last_name,s.first_name,s.admission_number`, [identity.schoolId,data.sessionId,data.classId,data.classArmId || null])).rows;
  return { rows, total: rows.length };
}

async function promote(identity, data, req) {
  const ids = [...new Set((data.studentIds || []).map(String))];
  if (!ids.length) throw errors.validation("Select at least one student.");
  const operation = String(data.action || "PROMOTION").toUpperCase();
  const exitOperation = ["GRADUATION", "WITHDRAWAL"].includes(operation);
  if (!data.sourceSessionId) throw errors.validation("Source session is required.");
  if (!exitOperation && (!data.targetSessionId || !data.targetClassId)) throw errors.validation("Target session and class are required.");
  return transaction(async client => {
    if (!exitOperation) {
      const validTarget = (await client.query(`SELECT 1 FROM academic_sessions se JOIN classes c ON c.school_id=se.school_id WHERE se.school_id=$1 AND se.id=$2 AND c.id=$3`, [identity.schoolId,data.targetSessionId,data.targetClassId])).rows[0];
      if (!validTarget) throw errors.validation("Select a valid target session and class from this school.");
    }
    const selected = (await client.query(`SELECT e.*,s.status student_status FROM student_session_enrolments e JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id WHERE e.school_id=$1 AND e.academic_session_id=$2 AND e.student_id=ANY($3::uuid[]) FOR UPDATE OF e`, [identity.schoolId,data.sourceSessionId,ids])).rows;
    if (selected.length !== ids.length) throw errors.validation("One or more selected students are not enrolled in the source session.");
    let updated = 0;
    for (const old of selected) {
      if (old.student_status !== "ACTIVE") continue;
      if (exitOperation) {
        const studentStatus = operation === "GRADUATION" ? "GRADUATED" : "TRANSFERRED";
        const enrolmentStatus = operation === "GRADUATION" ? "GRADUATED" : "TRANSFERRED";
        await client.query(`UPDATE student_session_enrolments SET status=$1,updated_by=$2,updated_at=now() WHERE id=$3 AND school_id=$4`, [enrolmentStatus,identity.id,old.id,identity.schoolId]);
        await client.query(`UPDATE students SET status=$1,exit_date=$2,exit_reason=$3,updated_by=$4,updated_at=now() WHERE school_id=$5 AND id=$6`, [studentStatus,data.effectiveDate || new Date(),data.reason || operation,identity.id,identity.schoolId,old.student_id]);
        await client.query(`INSERT INTO student_class_history(school_id,student_id,academic_session_id,from_class_id,from_class_arm_id,to_class_id,to_class_arm_id,action,effective_date,reason,created_by) VALUES($1,$2,$3,$4,$5,$4,$5,$6,$7,$8,$9)`, [identity.schoolId,old.student_id,data.sourceSessionId,old.class_id,old.class_arm_id,operation === "GRADUATION" ? "GRADUATION" : "TRANSFER",data.effectiveDate || new Date(),data.reason || operation,identity.id]);
        updated++;
        continue;
      }
      const target = (await client.query(`INSERT INTO student_session_enrolments(school_id,student_id,academic_session_id,class_id,class_arm_id,status,enrolment_date,created_by,updated_by) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$7) ON CONFLICT(school_id,student_id,academic_session_id) DO UPDATE SET class_id=EXCLUDED.class_id,class_arm_id=EXCLUDED.class_arm_id,status='ACTIVE',enrolment_date=COALESCE(EXCLUDED.enrolment_date,student_session_enrolments.enrolment_date),updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`, [identity.schoolId,old.student_id,data.targetSessionId,data.targetClassId,data.targetClassArmId || null,data.effectiveDate || null,identity.id])).rows[0];
      await client.query(`UPDATE students SET class_id=$1,class_arm_id=$2,updated_by=$3,updated_at=now() WHERE school_id=$4 AND id=$5`, [target.class_id,target.class_arm_id,identity.id,identity.schoolId,old.student_id]);
      const historyAction = operation === "PROMOTION" ? "PROMOTION" : operation === "TRANSFER" ? "TRANSFER" : "PLACEMENT_CHANGE";
      await client.query(`INSERT INTO student_class_history(school_id,student_id,academic_session_id,from_class_id,from_class_arm_id,to_class_id,to_class_arm_id,action,effective_date,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [identity.schoolId,old.student_id,data.targetSessionId,old.class_id,old.class_arm_id,target.class_id,target.class_arm_id,historyAction,data.effectiveDate || new Date(),data.reason || "",identity.id]);
      updated++;
    }
    const summary = { action: operation, selected: ids.length, updated, excluded: ids.length - updated, sourceSessionId: data.sourceSessionId, targetSessionId: data.targetSessionId || null, targetClassId: data.targetClassId || null, targetClassArmId: data.targetClassArmId || null };
    await audit({ schoolId: identity.schoolId, userId: identity.id, action: "STUDENT_BULK_PROMOTION_COMPLETED", entityType: "StudentSessionEnrolment", newValue: summary, req, client });
    return summary;
  });
}

async function promoteOne(identity, data, req) {
  const source = (await pool.query(
    `SELECT e.academic_session_id FROM student_session_enrolments e
     JOIN academic_sessions se ON se.id=e.academic_session_id AND se.school_id=e.school_id
     WHERE e.school_id=$1 AND e.student_id=$2 AND e.academic_session_id<>$3
     ORDER BY se.start_date DESC NULLS LAST,se.created_at DESC LIMIT 1`,
    [identity.schoolId, data.studentId, data.targetSessionId],
  )).rows[0];
  if (!source) throw errors.validation("The student has no earlier session enrolment to promote from.");
  return promote(identity, { ...data, sourceSessionId: source.academic_session_id, studentIds: [data.studentId] }, req);
}

module.exports = { preview, create, reconcile, promotionRoster, promote, promoteOne, carryForward };

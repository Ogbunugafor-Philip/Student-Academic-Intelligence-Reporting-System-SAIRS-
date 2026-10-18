"use strict";
const { pool, transaction } = require("../db/pool");
const authz = require("./authorization-service");
const { errors } = require("../utilities/errors");
const { audit } = require("./audit-service");
async function list(identity) {
  let params = [identity.schoolId],
    scope = "";
  if (identity.role === "TEACHER") {
    const teacher = await authz.teacher(identity);
    params.push(teacher.id);
    scope = `AND EXISTS(SELECT 1 FROM teacher_assignments ta WHERE ta.school_id=a.school_id AND ta.teacher_id=$2 AND ta.status='ACTIVE' AND ta.academic_session_id=a.academic_session_id AND ta.class_id=a.class_id AND (ta.class_arm_id IS NULL OR ta.class_arm_id IS NOT DISTINCT FROM a.class_arm_id) AND (ta.assignment_type='CLASS_TEACHER' OR ta.subject_id=a.subject_id))`;
  }
  return (
    await pool.query(
      `SELECT a.* FROM assessments a WHERE a.school_id=$1 ${scope} ORDER BY a.created_at DESC`,
      params,
    )
  ).rows;
}
async function update(identity,data,req){return transaction(async client=>{const existing=(await client.query(`SELECT * FROM assessments WHERE school_id=$1 AND id=$2 FOR UPDATE`,[identity.schoolId,data.assessmentId])).rows[0];if(!existing)throw errors.notFound();await authz.assertTeacherAssessment(identity,existing,client);const next={academic_session_id:data.sessionId,term_id:data.termId,class_id:data.classId,class_arm_id:data.classArmId||null,subject_id:data.subjectId,structure_id:data.structureId};const changed=Object.entries(next).some(([key,value])=>String(existing[key]||'')!==String(value||''));if(changed){const score=(await client.query(`SELECT 1 FROM scores WHERE school_id=$1 AND assessment_id=$2 LIMIT 1`,[identity.schoolId,existing.id])).rows[0],batch=(await client.query(`SELECT 1 FROM result_batches WHERE school_id=$1 AND academic_session_id=$2 AND term_id=$3 AND class_id=$4 AND class_arm_id IS NOT DISTINCT FROM $5 AND subject_id=$6 LIMIT 1`,[identity.schoolId,existing.academic_session_id,existing.term_id,existing.class_id,existing.class_arm_id,existing.subject_id])).rows[0];if(score||batch)throw errors.validation('Assessment academic context cannot be changed after scores or result workflow records exist.');}const term=(await client.query(`SELECT 1 FROM terms WHERE school_id=$1 AND id=$2 AND academic_session_id=$3`,[identity.schoolId,data.termId,data.sessionId])).rows[0];if(!term)throw errors.validation('The selected term does not belong to the selected academic session.');await authz.assertTeacherAssessment(identity,next,client);const row=(await client.query(`UPDATE assessments SET structure_id=$1,academic_session_id=$2,term_id=$3,class_id=$4,class_arm_id=$5,subject_id=$6,teacher_id=$7,name=$8,maximum_score=$9,weight=$10,status=$11,version=version+1 WHERE school_id=$12 AND id=$13 RETURNING *`,[data.structureId,data.sessionId,data.termId,data.classId,data.classArmId||null,data.subjectId,data.teacherId||null,data.assessmentName,data.maximumScore,data.weight,String(data.status).toUpperCase(),identity.schoolId,data.assessmentId])).rows[0];await audit({schoolId:identity.schoolId,userId:identity.id,action:'ASSESSMENT_UPDATED',entityType:'Assessment',entityId:row.id,oldValue:existing,newValue:row,req,client});return row;});}
async function scoreSheet(identity, assessmentId, client = pool) {
  const { rows } = await client.query(
      "SELECT * FROM assessments WHERE school_id=$1 AND id=$2",
      [identity.schoolId, assessmentId],
    ),
    assessment = rows[0];
  if (!assessment) throw errors.notFound("Assessment not found.");
  await authz.assertTeacherAssessment(identity, assessment, client);
  const students = (
    await client.query(
      `SELECT s.id,s.admission_number,s.first_name||' '||s.last_name student_name,sc.id score_id,sc.score,sc.status score_status,sc.version score_version,sc.updated_at score_updated_at FROM student_session_enrolments e JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id LEFT JOIN scores sc ON sc.student_id=s.id AND sc.assessment_id=$2 WHERE e.school_id=$1 AND e.academic_session_id=$5 AND e.class_id=$3 AND (e.class_arm_id IS NOT DISTINCT FROM $4 OR $4 IS NULL) AND e.status<>'ARCHIVED' ORDER BY s.last_name,s.first_name`,
      [
        identity.schoolId,
        assessment.id,
        assessment.class_id,
        assessment.class_arm_id,
        assessment.academic_session_id,
      ],
    )
  ).rows;
  return {
    assessment,
    students: students.map((s) => ({
      id: s.id,
      admission_number: s.admission_number,
      student_name: s.student_name,
      score: s.score_id
        ? {
            id: s.score_id,
            score: s.score,
            status: s.score_status,
            version: s.score_version,
            updated_at: s.score_updated_at,
          }
        : null,
    })),
  };
}
async function saveScores(identity, input, req, clientOverride) {
  const execute = async (client) => {
    const sheet = await scoreSheet(identity, input.assessmentId, client),
      max = Number(sheet.assessment.maximum_score),
      results = [];
    for (const item of input.scores || []) {
      const value = Number(item.score);
      if (!Number.isFinite(value) || value < 0 || value > max)
        throw errors.validation(`Score must be between 0 and ${max}.`);
      const student = sheet.students.find((x) => x.id === item.studentId);
      if (!student)
        throw errors.forbidden("A student is outside this assessment scope.");
      if (
        item.baseUpdatedAt &&
        student.score?.updated_at &&
        new Date(student.score?.updated_at) > new Date(item.baseUpdatedAt)
      )
        throw errors.conflict(
          "This score changed after the offline copy was created.",
          student,
        );
      let record;
      if (student.score?.id)
        record = (
          await client.query(
            `UPDATE scores SET score=$1,status=$2,updated_by=$3,version=version+1 WHERE id=$4 AND school_id=$5 RETURNING *`,
            [
              value,
              String(input.status || "DRAFT").toUpperCase(),
              identity.id,
              student.score?.id,
              identity.schoolId,
            ],
          )
        ).rows[0];
      else
        record = (
          await client.query(
            `INSERT INTO scores(school_id,assessment_id,student_id,score,status,entered_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
            [
              identity.schoolId,
              sheet.assessment.id,
              student.id,
              value,
              String(input.status || "DRAFT").toUpperCase(),
              identity.id,
            ],
          )
        ).rows[0];
      await client.query(
        `INSERT INTO score_history(school_id,score_id,assessment_id,student_id,previous_score,new_score,action,changed_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          identity.schoolId,
          record.id,
          sheet.assessment.id,
          student.id,
          student.score?.score,
          value,
          student.score?.id ? "UPDATED" : "CREATED",
          identity.id,
          item.reason || "Score entry",
        ],
      );
      results.push(record);
    }
    await audit({
      schoolId: identity.schoolId,
      userId: identity.id,
      action: "CLASS_SCORES_SAVED",
      entityType: "Assessment",
      entityId: sheet.assessment.id,
      newValue: { count: results.length },
      req,
      client,
    });
    return { saved: results.length, records: results };
  };
  return clientOverride ? execute(clientOverride) : transaction(execute);
}
module.exports = { list, update, scoreSheet, saveScores };

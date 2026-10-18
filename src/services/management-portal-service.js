"use strict";
const { pool, transaction } = require("../db/pool"),
  { errors } = require("../utilities/errors"),
  { audit } = require("./audit-service"),
  reports = require("./report-service");
const pageOf = (data) => ({
  limit: Math.min(100, Math.max(10, Number(data?.limit) || 25)),
  offset: Math.max(0, Number(data?.offset) || 0),
});
async function dashboard(identity) {
  const {
    rows: [counts],
  } = await pool.query(
    `SELECT
    (SELECT count(*) FROM students WHERE school_id=$1 AND status='ACTIVE') students,
    (SELECT count(*) FROM teachers WHERE school_id=$1 AND status='ACTIVE') teachers,
    (SELECT count(*) FROM classes WHERE school_id=$1 AND status='ACTIVE') classes,
    (SELECT count(*) FROM subjects WHERE school_id=$1 AND status='ACTIVE') subjects,
    (SELECT count(*) FROM assessment_component_submissions WHERE school_id=$1 AND routed_management_user_id=$2 AND status='SUBMITTED') pending_components,
    (SELECT count(*) FROM class_result_submissions WHERE school_id=$1 AND routed_management_user_id=$2 AND status IN('SUBMITTED','REVIEWED')) pending_reports,
    (SELECT count(*) FROM report_cards WHERE school_id=$1 AND status='PUBLISHED') published_reports`,
    [identity.schoolId, identity.id],
  );
  const components = (
    await pool.query(
      `SELECT acs.id,s.name subject_name,c.name class_name,ca.name arm_name,ast.code component,acs.status,acs.submitted_at,concat_ws(' ',tr.first_name,tr.middle_name,tr.last_name) teacher_name
    FROM assessment_component_submissions acs JOIN assessments a ON a.id=acs.assessment_id AND a.school_id=acs.school_id JOIN assessment_structures ast ON ast.id=a.structure_id JOIN subjects s ON s.id=a.subject_id JOIN classes c ON c.id=a.class_id LEFT JOIN class_arms ca ON ca.id=a.class_arm_id LEFT JOIN teachers tr ON tr.user_id=acs.submitted_by AND tr.school_id=acs.school_id
    WHERE acs.school_id=$1 AND acs.routed_management_user_id=$2 AND acs.status='SUBMITTED' ORDER BY acs.submitted_at DESC LIMIT 5`,
      [identity.schoolId, identity.id],
    )
  ).rows;
  const compiled = (
    await pool.query(
      `SELECT crs.id,c.name class_name,ca.name arm_name,crs.status,crs.submitted_at,concat_ws(' ',tr.first_name,tr.middle_name,tr.last_name) teacher_name FROM class_result_submissions crs JOIN classes c ON c.id=crs.class_id LEFT JOIN class_arms ca ON ca.id=crs.class_arm_id JOIN teachers tr ON tr.id=crs.form_teacher_id WHERE crs.school_id=$1 AND crs.routed_management_user_id=$2 AND crs.status IN('SUBMITTED','REVIEWED') ORDER BY crs.submitted_at DESC LIMIT 5`,
      [identity.schoolId, identity.id],
    )
  ).rows;
  return { counts, pending: { components, compiled } };
}
async function compiledList(identity, data = {}) {
  const { limit, offset } = pageOf(data),
    values = [identity.schoolId, identity.id],
    where = ["crs.school_id=$1", "crs.routed_management_user_id=$2"];
  if (data.status) {
    values.push(String(data.status).toUpperCase());
    where.push(`crs.status=$${values.length}`);
  }
  values.push(limit, offset);
  const rows = (
    await pool.query(
      `SELECT crs.*,c.name class_name,ca.name arm_name,se.name session_name,t.name term_name,concat_ws(' ',tr.first_name,tr.middle_name,tr.last_name) form_teacher_name,(SELECT count(*) FROM student_session_enrolments e WHERE e.school_id=crs.school_id AND e.academic_session_id=crs.academic_session_id AND e.class_id=crs.class_id AND e.class_arm_id IS NOT DISTINCT FROM crs.class_arm_id AND e.status<>'ARCHIVED')::int student_count,count(*) OVER()::int total_count FROM class_result_submissions crs JOIN classes c ON c.id=crs.class_id LEFT JOIN class_arms ca ON ca.id=crs.class_arm_id JOIN academic_sessions se ON se.id=crs.academic_session_id JOIN terms t ON t.id=crs.term_id JOIN teachers tr ON tr.id=crs.form_teacher_id WHERE ${where.join(" AND ")} ORDER BY CASE crs.status WHEN 'SUBMITTED' THEN 0 WHEN 'REVIEWED' THEN 1 WHEN 'RETURNED' THEN 2 WHEN 'APPROVED' THEN 3 ELSE 4 END,crs.submitted_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    )
  ).rows;
  return { rows, total: rows[0]?.total_count || 0, limit, offset };
}
async function compiledDetail(identity, id) {
  const row = (
    await pool.query(
      `SELECT crs.*,sch.name school_name,c.name class_name,ca.name arm_name,se.name session_name,t.name term_name,concat_ws(' ',tr.first_name,tr.middle_name,tr.last_name) form_teacher_name FROM class_result_submissions crs JOIN schools sch ON sch.id=crs.school_id JOIN classes c ON c.id=crs.class_id LEFT JOIN class_arms ca ON ca.id=crs.class_arm_id JOIN academic_sessions se ON se.id=crs.academic_session_id JOIN terms t ON t.id=crs.term_id JOIN teachers tr ON tr.id=crs.form_teacher_id WHERE crs.school_id=$1 AND crs.routed_management_user_id=$2 AND crs.id=$3`,
      [identity.schoolId, identity.id, id],
    )
  ).rows[0];
  if (!row) throw errors.notFound("Compiled result not found.");
  const students = (
      await pool.query(
        `SELECT st.id student_id,st.admission_number,concat_ws(' ',st.first_name,st.middle_name,st.last_name) student_name,max(r.student_average) student_average,max(r.overall_position) overall_position,json_agg(json_build_object('subject',s.name,'ca1',r.ca1_score,'ca2',r.ca2_score,'exam',r.examination_score,'total',r.total_score,'grade',r.grade,'position',r.subject_position) ORDER BY s.name) subjects FROM result_batches rb JOIN results r ON r.batch_id=rb.id JOIN students st ON st.id=r.student_id JOIN subjects s ON s.id=rb.subject_id WHERE rb.school_id=$1 AND rb.academic_session_id=$2 AND rb.term_id=$3 AND rb.class_id=$4 AND rb.class_arm_id IS NOT DISTINCT FROM $5 GROUP BY st.id ORDER BY st.last_name,st.first_name`,
        [
          identity.schoolId,
          row.academic_session_id,
          row.term_id,
          row.class_id,
          row.class_arm_id,
        ],
      )
    ).rows,
    cards = (
      await pool.query(
        "SELECT DISTINCT ON(student_id) id,student_id,report_version,published_at,file_name FROM report_cards WHERE school_id=$1 AND academic_session_id=$2 AND term_id=$3 AND class_id=$4 AND class_arm_id IS NOT DISTINCT FROM $5 AND status='PUBLISHED' ORDER BY student_id,report_version DESC",
        [
          identity.schoolId,
          row.academic_session_id,
          row.term_id,
          row.class_id,
          row.class_arm_id,
        ],
      )
    ).rows,
    byStudent = new Map(cards.map((card) => [card.student_id, card]));
  return {
    submission: row,
    students: students.map((student) => ({
      ...student,
      reportCard: byStudent.get(student.student_id) || null,
    })),
  };
}
async function workflowContext(client, row) {
  return (
    (
      await client.query(
        `SELECT c.name "class",ca.name arm,se.name session,t.name term,concat_ws(' ',tr.first_name,tr.middle_name,tr.last_name) "formTeacher" FROM classes c LEFT JOIN class_arms ca ON ca.id=$2 JOIN academic_sessions se ON se.id=$3 JOIN terms t ON t.id=$4 JOIN teachers tr ON tr.id=$5 WHERE c.id=$1`,
        [
          row.class_id,
          row.class_arm_id,
          row.academic_session_id,
          row.term_id,
          row.form_teacher_id,
        ],
      )
    ).rows[0] || {}
  );
}
async function decision(identity, data, req, clientOverride) {
  const target = String(data.decision || "").toUpperCase();
  if (!["REVIEWED", "APPROVED", "RETURNED"].includes(target))
    throw errors.validation("Select a valid decision.");
  if (target === "RETURNED" && !String(data.comment || "").trim())
    throw errors.validation("Enter a reason for returning this report.");
  const execute = async (client) => {
    const row = (
      await client.query(
        "SELECT * FROM class_result_submissions WHERE school_id=$1 AND routed_management_user_id=$2 AND id=$3 FOR UPDATE",
        [identity.schoolId, identity.id, data.submissionId],
      )
    ).rows[0];
    if (!row) throw errors.notFound("Compiled result not found.");
    const allowed = {
      SUBMITTED: ["REVIEWED", "RETURNED"],
      REVIEWED: ["APPROVED", "RETURNED"],
    };
    if (!allowed[row.status]?.includes(target))
      throw errors.conflict(
        "This compiled result cannot move to the requested status.",
      );
    const comment = String(data.comment || "").trim() || null,
      context = await workflowContext(client, row);
    await client.query(
      "UPDATE class_result_submissions SET status=$1,reviewed_by=$2,reviewed_at=now(),review_comment=$3,version=version+1 WHERE id=$4",
      [target, identity.id, comment, row.id],
    );
    const batchTarget = target === "RETURNED" ? "DRAFT" : target;
    await client.query(
      "UPDATE result_batches SET status=$1,version=version+1 WHERE school_id=$2 AND academic_session_id=$3 AND term_id=$4 AND class_id=$5 AND class_arm_id IS NOT DISTINCT FROM $6",
      [
        batchTarget,
        identity.schoolId,
        row.academic_session_id,
        row.term_id,
        row.class_id,
        row.class_arm_id,
      ],
    );
    await client.query(
      "UPDATE results r SET status=$1,version=r.version+1 FROM result_batches rb WHERE r.batch_id=rb.id AND rb.school_id=$2 AND rb.academic_session_id=$3 AND rb.term_id=$4 AND rb.class_id=$5 AND rb.class_arm_id IS NOT DISTINCT FROM $6",
      [
        batchTarget,
        identity.schoolId,
        row.academic_session_id,
        row.term_id,
        row.class_id,
        row.class_arm_id,
      ],
    );
    await audit({
      schoolId: identity.schoolId,
      userId: identity.id,
      action: `COMPILED_RESULT_${target}`,
      entityType: "ClassResultSubmission",
      entityId: row.id,
      oldValue: { status: row.status },
      newValue: { status: target, comment, ...context },
      req,
      client,
    });
    return { status: target };
  };
  return clientOverride ? execute(clientOverride) : transaction(execute);
}

async function approveAndPublish(identity, data, req, options = {}) {
  const storedKeys = options.storedKeys || [],
    ownsClient = !options.client,
    client = options.client || (await pool.connect());
  try {
    if (ownsClient) await client.query("BEGIN");
    const s = (
      await client.query(
        "SELECT * FROM class_result_submissions WHERE school_id=$1 AND routed_management_user_id=$2 AND id=$3 FOR UPDATE",
        [identity.schoolId, identity.id, data.submissionId],
      )
    ).rows[0];
    if (!s) throw errors.notFound("Compiled result not found.");
    if (s.status === "PUBLISHED")
      throw errors.conflict("This report has already been published.");
    if (!["SUBMITTED", "REVIEWED", "APPROVED"].includes(s.status))
      throw errors.conflict(
        "Only a submitted compiled report can be approved.",
      );
    const reportContext = {
        classId: s.class_id,
        classArmId: s.class_arm_id,
        sessionId: s.academic_session_id,
        termId: s.term_id,
      },
      context = { ...reportContext, ...(await workflowContext(client, s)) };
    if (s.status === "SUBMITTED") {
      await client.query(
        "UPDATE class_result_submissions SET status='REVIEWED',reviewed_by=$1,reviewed_at=now(),version=version+1 WHERE id=$2",
        [identity.id, s.id],
      );
      await client.query(
        "UPDATE result_batches SET status='REVIEWED',version=version+1 WHERE school_id=$1 AND academic_session_id=$2 AND term_id=$3 AND class_id=$4 AND class_arm_id IS NOT DISTINCT FROM $5",
        [
          identity.schoolId,
          s.academic_session_id,
          s.term_id,
          s.class_id,
          s.class_arm_id,
        ],
      );
      await client.query(
        "UPDATE results r SET status='REVIEWED',version=r.version+1 FROM result_batches rb WHERE r.batch_id=rb.id AND rb.school_id=$1 AND rb.academic_session_id=$2 AND rb.term_id=$3 AND rb.class_id=$4 AND rb.class_arm_id IS NOT DISTINCT FROM $5",
        [
          identity.schoolId,
          s.academic_session_id,
          s.term_id,
          s.class_id,
          s.class_arm_id,
        ],
      );
      await audit({
        schoolId: identity.schoolId,
        userId: identity.id,
        action: "COMPILED_RESULT_REVIEWED",
        entityType: "ClassResultSubmission",
        entityId: s.id,
        newValue: context,
        req,
        client,
      });
      s.status = "REVIEWED";
    }
    if (s.status === "REVIEWED") {
      await client.query(
        "UPDATE class_result_submissions SET status='APPROVED',version=version+1 WHERE id=$1",
        [s.id],
      );
      await client.query(
        "UPDATE result_batches SET status='APPROVED',version=version+1 WHERE school_id=$1 AND academic_session_id=$2 AND term_id=$3 AND class_id=$4 AND class_arm_id IS NOT DISTINCT FROM $5",
        [
          identity.schoolId,
          s.academic_session_id,
          s.term_id,
          s.class_id,
          s.class_arm_id,
        ],
      );
      await client.query(
        "UPDATE results r SET status='APPROVED',version=r.version+1 FROM result_batches rb WHERE r.batch_id=rb.id AND rb.school_id=$1 AND rb.academic_session_id=$2 AND rb.term_id=$3 AND rb.class_id=$4 AND rb.class_arm_id IS NOT DISTINCT FROM $5",
        [
          identity.schoolId,
          s.academic_session_id,
          s.term_id,
          s.class_id,
          s.class_arm_id,
        ],
      );
      await audit({
        schoolId: identity.schoolId,
        userId: identity.id,
        action: "COMPILED_RESULT_APPROVED",
        entityType: "ClassResultSubmission",
        entityId: s.id,
        newValue: context,
        req,
        client,
      });
      s.status = "APPROVED";
    }
    await client.query(
      "UPDATE result_batches SET status='PUBLISHED',version=version+1 WHERE school_id=$1 AND academic_session_id=$2 AND term_id=$3 AND class_id=$4 AND class_arm_id IS NOT DISTINCT FROM $5",
      [
        identity.schoolId,
        s.academic_session_id,
        s.term_id,
        s.class_id,
        s.class_arm_id,
      ],
    );
    await client.query(
      "UPDATE results r SET status='PUBLISHED',version=r.version+1 FROM result_batches rb WHERE r.batch_id=rb.id AND rb.school_id=$1 AND rb.academic_session_id=$2 AND rb.term_id=$3 AND rb.class_id=$4 AND rb.class_arm_id IS NOT DISTINCT FROM $5",
      [
        identity.schoolId,
        s.academic_session_id,
        s.term_id,
        s.class_id,
        s.class_arm_id,
      ],
    );
    const students = (
      await client.query(
        "SELECT DISTINCT r.student_id FROM results r JOIN result_batches rb ON rb.id=r.batch_id WHERE rb.school_id=$1 AND rb.academic_session_id=$2 AND rb.term_id=$3 AND rb.class_id=$4 AND rb.class_arm_id IS NOT DISTINCT FROM $5 ORDER BY r.student_id",
        [
          identity.schoolId,
          s.academic_session_id,
          s.term_id,
          s.class_id,
          s.class_arm_id,
        ],
      )
    ).rows;
    for (const student of students) {
      const card = await reports.generate(
        identity,
        { studentId: student.student_id, ...reportContext },
        req,
        client,
        storedKeys,
      );
      await reports.publish(identity, card.id, req, client);
    }
    await client.query(
      "UPDATE class_result_submissions SET status='PUBLISHED',published_at=now(),version=version+1 WHERE id=$1",
      [s.id],
    );
    await audit({
      schoolId: identity.schoolId,
      userId: identity.id,
      action: "REPORT_PUBLISHED",
      entityType: "ClassResultSubmission",
      entityId: s.id,
      newValue: { ...context, students: students.length },
      req,
      client,
    });
    if (ownsClient) await client.query("COMMIT");
    return {
      status: "PUBLISHED",
      reports: students.length,
      className: context.class,
      armName: context.arm,
      termName: context.term,
    };
  } catch (error) {
    if (ownsClient) await client.query("ROLLBACK").catch(() => {});
    await Promise.all(
      storedKeys.map((key) =>
        require("../reports/storage")
          .remove(key)
          .catch(() => {}),
      ),
    );
    throw error;
  } finally {
    if (ownsClient) client.release();
  }
}
async function publish(identity, data, req) {
  const detail = await compiledDetail(identity, data.submissionId),
    s = detail.submission;
  if (s.status !== "APPROVED")
    throw errors.conflict("Only an approved compiled result can be published.");
  await transaction(async (client) => {
    await client.query(
      "UPDATE result_batches SET status='PUBLISHED',version=version+1 WHERE school_id=$1 AND academic_session_id=$2 AND term_id=$3 AND class_id=$4 AND class_arm_id IS NOT DISTINCT FROM $5",
      [
        identity.schoolId,
        s.academic_session_id,
        s.term_id,
        s.class_id,
        s.class_arm_id,
      ],
    );
    await client.query(
      "UPDATE results r SET status='PUBLISHED',version=r.version+1 FROM result_batches rb WHERE r.batch_id=rb.id AND rb.school_id=$1 AND rb.academic_session_id=$2 AND rb.term_id=$3 AND rb.class_id=$4 AND rb.class_arm_id IS NOT DISTINCT FROM $5",
      [
        identity.schoolId,
        s.academic_session_id,
        s.term_id,
        s.class_id,
        s.class_arm_id,
      ],
    );
  });
  for (const student of detail.students) {
    const card = await reports.generate(
      identity,
      {
        studentId: student.student_id,
        sessionId: s.academic_session_id,
        termId: s.term_id,
        classId: s.class_id,
        classArmId: s.class_arm_id,
      },
      req,
    );
    await reports.publish(identity, card.id, req);
  }
  await pool.query(
    "UPDATE class_result_submissions SET status='PUBLISHED',published_at=now(),version=version+1 WHERE school_id=$1 AND routed_management_user_id=$2 AND id=$3",
    [identity.schoolId, identity.id, s.id],
  );
  await audit({
    schoolId: identity.schoolId,
    userId: identity.id,
    action: "REPORT_PUBLISHED",
    entityType: "ClassResultSubmission",
    entityId: s.id,
    newValue: { students: detail.students.length },
    req,
  });
  return { status: "PUBLISHED", reports: detail.students.length };
}
module.exports = {
  dashboard,
  compiledList,
  compiledDetail,
  decision,
  publish,
  approveAndPublish,
};

"use strict";
const crypto = require("crypto"),
  fs = require("fs"),
  { pool: pool, transaction: transaction } = require("../db/pool"),
  { errors: errors } = require("../utilities/errors"),
  authz = require("./authorization-service"),
  storage = require("../reports/storage"),
  { reportPdf: reportPdf, logoFor } = require("../reports/pdf"),
  mail = require("./mail-service"),
  { reportClassSize } = require("./report-class-size-service"),
  { audit: audit } = require("./audit-service"),
  { ordinal: ordinal } = require("../utilities/ordinal"),
  { randomToken, hash, seal, open } = require("../security/crypto"),
  { env } = require("../config/env");
async function list(identity) {
  let join = "",
    where = "";
  const params = [identity.schoolId];
  return (
    "PARENT" === identity.role
      ? ((join =
          "JOIN parent_student_links l ON l.student_id=rc.student_id AND l.status='ACTIVE' JOIN parents p ON p.id=l.parent_id AND p.user_id=$2 AND p.status='ACTIVE'"),
        params.push(identity.id),
        (where = "AND rc.status='PUBLISHED'"))
      : "TEACHER" === identity.role &&
        ((join =
          "JOIN teachers tr ON tr.school_id=rc.school_id AND tr.user_id=$2 JOIN teacher_assignments ta ON ta.teacher_id=tr.id AND ta.academic_session_id=rc.academic_session_id AND ta.class_id=rc.class_id AND ta.class_arm_id=rc.class_arm_id AND ta.assignment_type='CLASS_TEACHER' AND ta.status='ACTIVE'"),
        params.push(identity.id)),
    (where += " AND (rc.status<>'PUBLISHED' OR NOT EXISTS(SELECT 1 FROM report_cards newer WHERE newer.school_id=rc.school_id AND newer.student_id=rc.student_id AND newer.academic_session_id=rc.academic_session_id AND newer.term_id=rc.term_id AND newer.status='PUBLISHED' AND (newer.report_version,newer.published_at,newer.id)>(rc.report_version,rc.published_at,rc.id)))"),
    (
      await pool.query(
        `SELECT DISTINCT rc.*,st.first_name,st.middle_name,st.last_name,se.name session_name,t.name term_name,c.name class_name,ca.name arm_name,se.start_date session_start_date,t.start_date term_start_date FROM report_cards rc JOIN students st ON st.id=rc.student_id JOIN academic_sessions se ON se.id=rc.academic_session_id JOIN terms t ON t.id=rc.term_id LEFT JOIN classes c ON c.id=rc.class_id LEFT JOIN class_arms ca ON ca.id=rc.class_arm_id ${join} WHERE rc.school_id=$1 ${where} ORDER BY session_start_date DESC,term_start_date,st.last_name,st.first_name,rc.report_version DESC`,
        params,
      )
    ).rows
  );
}
async function catalog(identity) {
  const params = [identity.schoolId];
  let scope = "";
  if ("TEACHER" === identity.role) {
    const teacher = await authz.teacher(identity);
    (params.push(teacher.id),
      (scope =
        "AND EXISTS(SELECT 1 FROM teacher_assignments ta WHERE ta.school_id=rb.school_id AND ta.teacher_id=$2 AND ta.academic_session_id=rb.academic_session_id AND ta.class_id=rb.class_id AND ta.class_arm_id=rb.class_arm_id AND ta.assignment_type='CLASS_TEACHER' AND ta.status='ACTIVE')"));
  } else
    "PARENT" === identity.role &&
      (params.push(identity.id),
      (scope =
        "AND EXISTS(SELECT 1 FROM parents p JOIN parent_student_links l ON l.parent_id=p.id AND l.student_id=r.student_id AND l.status='ACTIVE' JOIN report_cards rc ON rc.school_id=r.school_id AND rc.student_id=r.student_id AND rc.academic_session_id=rb.academic_session_id AND rc.term_id=rb.term_id AND rc.status='PUBLISHED' WHERE p.school_id=rb.school_id AND p.user_id=$2 AND p.status='ACTIVE') AND rb.status='PUBLISHED'"));
  return {
    records: (
      await pool.query(
        `SELECT rb.academic_session_id,rb.term_id,rb.class_id,rb.class_arm_id,r.student_id,se.name session_name,t.name term_name,c.name class_name,ca.name arm_name,st.admission_number,st.first_name,st.middle_name,st.last_name,min(rb.status) workflow_status,max(r.student_average) student_average,max(r.overall_position) overall_position\n    FROM results r JOIN result_batches rb ON rb.id=r.batch_id JOIN students st ON st.id=r.student_id JOIN academic_sessions se ON se.id=rb.academic_session_id JOIN terms t ON t.id=rb.term_id JOIN classes c ON c.id=rb.class_id LEFT JOIN class_arms ca ON ca.id=rb.class_arm_id\n    WHERE rb.school_id=$1 ${scope} GROUP BY rb.academic_session_id,rb.term_id,rb.class_id,rb.class_arm_id,r.student_id,se.name,t.name,c.name,ca.name,st.admission_number,st.first_name,st.middle_name,st.last_name,se.start_date,t.start_date ORDER BY se.start_date DESC,t.start_date,c.name,ca.name,st.last_name,st.first_name`,
        params,
      )
    ).rows.map((row) => ({
      ...row,
      overall_position_label: ordinal(row.overall_position),
    })),
  };
}
async function context(identity, data, client = pool) {
  if (
    !(
      await client.query(
        "SELECT 1 FROM terms WHERE school_id=$1 AND id=$2 AND academic_session_id=$3",
        [identity.schoolId, data.termId, data.sessionId],
      )
    ).rows[0]
  )
    throw errors.validation(
      "The selected term does not belong to the selected academic session.",
    );
  const params = [
      identity.schoolId,
      data.studentId,
      data.sessionId,
      data.termId,
    ],
    extra = [];
  (data.classId &&
    (params.push(data.classId), extra.push(`rb.class_id=$${params.length}`)),
    data.classArmId &&
      (params.push(data.classArmId),
      extra.push(`rb.class_arm_id=$${params.length}`)));
  const results = (
    await client.query(
      `SELECT r.*,s.name subject_name,rb.academic_session_id,rb.term_id,rb.class_id,rb.class_arm_id,rb.status batch_status FROM results r JOIN result_batches rb ON rb.id=r.batch_id JOIN subjects s ON s.id=rb.subject_id WHERE r.school_id=$1 AND r.student_id=$2 AND rb.academic_session_id=$3 AND rb.term_id=$4 ${extra.length ? "AND " + extra.join(" AND ") : ""} ORDER BY s.name`,
      params,
    )
  ).rows;
  if (!results.length)
    throw errors.notFound(
      "No compiled result exists for this student and period.",
    );
  const first = results[0];
  if ("PARENT" === identity.role) {
    await authz.assertParentStudent(identity, data.studentId, client);
    if (
      !(
        await client.query(
          "SELECT 1 FROM report_cards WHERE school_id=$1 AND student_id=$2 AND academic_session_id=$3 AND term_id=$4 AND status='PUBLISHED'",
          [identity.schoolId, data.studentId, data.sessionId, data.termId],
        )
      ).rows[0] ||
      results.some((x) => "PUBLISHED" !== x.batch_status)
    )
      throw errors.forbidden("Only published reports are available.");
  } else
    "TEACHER" === identity.role &&
      (await authz.assertClassTeacher(
        identity,
        {
          academic_session_id: first.academic_session_id,
          class_id: first.class_id,
          class_arm_id: first.class_arm_id,
        },
        client,
      ));
  const formTeacher =
      (
        await client.query(
          "SELECT concat_ws(' ',tr.first_name,tr.middle_name,tr.last_name) name FROM class_result_submissions crs JOIN teachers tr ON tr.id=crs.form_teacher_id AND tr.school_id=crs.school_id WHERE crs.school_id=$1 AND crs.academic_session_id=$2 AND crs.term_id=$3 AND crs.class_id=$4 AND crs.class_arm_id IS NOT DISTINCT FROM $5 LIMIT 1",
          [
            identity.schoolId,
            data.sessionId,
            data.termId,
            first.class_id,
            first.class_arm_id,
          ],
        )
      ).rows[0]?.name || null,
    classSize = await reportClassSize(client, {
      schoolId: identity.schoolId,
      sessionId: data.sessionId,
      termId: data.termId,
      classId: first.class_id,
      classArmId: first.class_arm_id,
    }),
    gradingRules = (
      await client.query(
        "SELECT grade,minimum_score,maximum_score,remark,sort_order FROM grading_rules WHERE school_id=$1 AND status='ACTIVE' ORDER BY sort_order",
        [identity.schoolId],
      )
    ).rows;
  return {
    school: (
      await client.query("SELECT * FROM schools WHERE id=$1", [
        identity.schoolId,
      ])
    ).rows[0],
    student: (
      await client.query(
        "SELECT * FROM students WHERE school_id=$1 AND id=$2",
        [identity.schoolId, data.studentId],
      )
    ).rows[0],
    session: (
      await client.query(
        "SELECT * FROM academic_sessions WHERE school_id=$1 AND id=$2",
        [identity.schoolId, data.sessionId],
      )
    ).rows[0],
    term: (
      await client.query("SELECT * FROM terms WHERE school_id=$1 AND id=$2", [
        identity.schoolId,
        data.termId,
      ])
    ).rows[0],
    classRow: (
      await client.query("SELECT * FROM classes WHERE school_id=$1 AND id=$2", [
        identity.schoolId,
        first.class_id,
      ])
    ).rows[0],
    arm: (
      await client.query(
        "SELECT * FROM class_arms WHERE school_id=$1 AND id=$2",
        [identity.schoolId, first.class_arm_id],
      )
    ).rows[0],
    formTeacher,
    gradingRules,
    results: results,
    summary: {
      studentAverage: Number(results[0].student_average),
      overallPosition: results[0].overall_position,
      overallPositionLabel: ordinal(results[0].overall_position),
      classSize,
    },
    displayResults: results.map((row) => ({
      ...row,
      subject_position_label: ordinal(row.subject_position),
    })),
  };
}
async function view(identity, data, req) {
  let report, card;
  if (data.reportCardId) {
    card = await authorized(identity, data.reportCardId);
    "PUBLISHED" === card.status &&
      card.publication_snapshot &&
      (report = card.publication_snapshot);
  }
  if ("PARENT" === identity.role && !report) {
    await authz.assertParentStudent(identity, data.studentId);
    card = (
      await pool.query(
        "SELECT * FROM report_cards WHERE school_id=$1 AND student_id=$2 AND academic_session_id=$3 AND term_id=$4 AND status='PUBLISHED' AND publication_snapshot IS NOT NULL ORDER BY report_version DESC LIMIT 1",
        [identity.schoolId, data.studentId, data.sessionId, data.termId],
      )
    ).rows[0];
    card?.publication_snapshot && (report = card.publication_snapshot);
  }
  return (
    (report = report || (await context(identity, data))),
    (report.summary ||= {}),
    (report.summary.classSize ||= await reportClassSize(pool, {
      schoolId: identity.schoolId,
      sessionId: report.session?.id || data.sessionId,
      termId: report.term?.id || data.termId,
      classId: report.classRow?.id || card?.class_id || data.classId,
      classArmId: report.arm?.id ?? card?.class_arm_id ?? data.classArmId,
    })),
    card?.verification_token_encrypted &&
      (report.verificationUrl = `${env.origin}/verify/report/${open(card.verification_token_encrypted)}`),
    await audit({
      schoolId: identity.schoolId,
      userId: identity.id,
      action:
        "PARENT" === identity.role
          ? "PARENT_VIEWED_PUBLISHED_REPORT"
          : "REPORT_VIEWED",
      entityType: "ReportCard",
      entityId: data.reportCardId || null,
      entityReference: report.student?.admission_number,
      newValue: {
        studentId: report.student?.id,
        admissionNumber: report.student?.admission_number,
        studentName: [
          report.student?.first_name,
          report.student?.middle_name,
          report.student?.last_name,
        ]
          .filter(Boolean)
          .join(" "),
        class: report.classRow?.name,
        arm: report.arm?.name,
        session: report.session?.name,
        term: report.term?.name,
      },
      req: req,
    }),
    report
  );
}
async function generate(identity, data, req, clientOverride, storedKeys) {
  const execute = async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${identity.schoolId}:${data.studentId}:${data.sessionId}:${data.termId}:${data.classId || ""}:${data.classArmId || ""}:report`,
    ]);
    const report = await context(identity, data, client);
    if (report.results.some((row) => "PUBLISHED" !== row.batch_status))
      throw errors.validation(
        "All subject results must be published before generating the report card.",
      );
    const id = crypto.randomUUID(),
      token = randomToken(32),
      tokenHash = hash(token),
      encryptedToken = seal(token),
      previous = (
        await client.query(
          "SELECT id,report_version FROM report_cards WHERE school_id=$1 AND student_id=$2 AND academic_session_id=$3 AND term_id=$4 AND class_id=$5 AND class_arm_id IS NOT DISTINCT FROM $6 ORDER BY report_version DESC LIMIT 1",
          [
            identity.schoolId,
            report.student.id,
            report.session.id,
            report.term.id,
            report.classRow.id,
            report.arm?.id || null,
          ],
        )
      ).rows[0],
      reportVersion = Number(previous?.report_version || 0) + 1,
      publication = {
        reportCardId: id,
        version: reportVersion,
        publishedAt: null,
        publishedBy: null,
      },
      verificationUrl = `${env.origin}/verify/report/${token}`,
      logoPath = logoFor(report.school),
      logoData =
        logoPath && fs.existsSync(logoPath)
          ? `data:image/${logoPath.toLowerCase().endsWith(".svg") ? "svg+xml" : "png"};base64,${fs.readFileSync(logoPath).toString("base64")}`
          : null,
      snapshot = { ...report, logoData, publication },
      buffer = await reportPdf({ ...snapshot, verificationUrl }),
      checksum = crypto.createHash("sha256").update(buffer).digest("hex"),
      key = `${identity.schoolId}/${report.session.id}/${report.term.id}/${id}.pdf`,
      studentName = [
        report.student.first_name,
        report.student.middle_name,
        report.student.last_name,
      ]
        .filter(Boolean)
        .join(" "),
      className = [report.classRow.name, report.arm?.name]
        .filter(Boolean)
        .join(" "),
      fileName =
        `${studentName}_${className}_${report.session.name}_${report.term.name}.pdf`
          .replace(/[^a-z0-9.]+/gi, "_")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, "");
    await storage.put(key, buffer);
    storedKeys?.push(key);
    const row = (
      await client.query(
        "INSERT INTO report_cards(id,school_id,student_id,academic_session_id,term_id,class_id,class_arm_id,storage_key,file_name,checksum,generated_by,report_version,supersedes_report_card_id,publication_snapshot,verification_token_hash,verification_token_encrypted) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *",
        [
          id,
          identity.schoolId,
          report.student.id,
          report.session.id,
          report.term.id,
          report.classRow.id,
          report.arm?.id || null,
          key,
          fileName,
          checksum,
          identity.id,
          reportVersion,
          previous?.id || null,
          snapshot,
          tokenHash,
          encryptedToken,
        ],
      )
    ).rows[0];
    return (
      await audit({
        schoolId: identity.schoolId,
        userId: identity.id,
        action: "REPORT_GENERATED",
        entityType: "ReportCard",
        entityId: row.id,
        newValue: {
          studentId: report.student.id,
          sessionId: report.session.id,
          termId: report.term.id,
        },
        req: req,
        client: client,
      }),
      row
    );
  };
  return clientOverride ? execute(clientOverride) : transaction(execute);
}
async function authorized(identity, id) {
  const row = (
    await pool.query(
      "SELECT * FROM report_cards WHERE school_id=$1 AND id=$2",
      [identity.schoolId, id],
    )
  ).rows[0];
  if (!row) throw errors.notFound();
  if ("PARENT" === identity.role) {
    if (
      (await authz.assertParentStudent(identity, row.student_id),
      "PUBLISHED" !== row.status)
    )
      throw errors.forbidden("Only published report cards are available.");
    if ((await pool.query("SELECT 1 FROM report_cards newer WHERE newer.school_id=$1 AND newer.student_id=$2 AND newer.academic_session_id=$3 AND newer.term_id=$4 AND newer.status='PUBLISHED' AND (newer.report_version,newer.published_at,newer.id)>($5,$6,$7) LIMIT 1",[row.school_id,row.student_id,row.academic_session_id,row.term_id,row.report_version,row.published_at,row.id])).rows[0])
      throw errors.forbidden("This report has been superseded by the current published report.");
  } else if ("TEACHER" === identity.role) {
    if ("PUBLISHED" !== row.status)
      throw errors.forbidden("Only published report cards are available.");
    if ((await pool.query("SELECT 1 FROM report_cards newer WHERE newer.school_id=$1 AND newer.student_id=$2 AND newer.academic_session_id=$3 AND newer.term_id=$4 AND newer.status='PUBLISHED' AND (newer.report_version,newer.published_at,newer.id)>($5,$6,$7) LIMIT 1",[row.school_id,row.student_id,row.academic_session_id,row.term_id,row.report_version,row.published_at,row.id])).rows[0])
      throw errors.forbidden("This report has been superseded by the current published report.");
    const teacher = await authz.teacher(identity);
    if (
      !(
        await pool.query(
          "SELECT 1 FROM teacher_assignments WHERE school_id=$1 AND teacher_id=$2 AND academic_session_id=$3 AND class_id=$4 AND class_arm_id IS NOT DISTINCT FROM $5 AND assignment_type='CLASS_TEACHER' AND status='ACTIVE' LIMIT 1",
          [
            identity.schoolId,
            teacher.id,
            row.academic_session_id,
            row.class_id,
            row.class_arm_id,
          ],
        )
      ).rows[0]
    )
      throw errors.forbidden(
        "This published report is outside your Form Class scope.",
      );
  }
  return row;
}
async function download(identity, id, req) {
  const row = await authorized(identity, id),
    buffer = await storage.get(row.storage_key);
  return (
    await audit({
      schoolId: identity.schoolId,
      userId: identity.id,
      action:
        "PARENT" === identity.role
          ? "PARENT_DOWNLOADED_PUBLISHED_REPORT"
          : "REPORT_DOWNLOADED",
      entityType: "ReportCard",
      entityId: row.id,
      entityReference: row.file_name,
      newValue: {
        studentId: row.student_id,
        sessionId: row.academic_session_id,
        termId: row.term_id,
        classId: row.class_id,
        classArmId: row.class_arm_id,
        fileName: row.file_name,
      },
      req: req,
    }),
    { row: row, buffer: buffer }
  );
}
async function publish(identity, id, req, clientOverride) {
  const execute = async (client) => {
    const pending = (
      await client.query(
        "SELECT * FROM report_cards WHERE id=$1 AND school_id=$2 AND status='GENERATED' FOR UPDATE",
        [id, identity.schoolId],
      )
    ).rows[0];
    if (!pending)
      throw errors.conflict(
        "Only a generated, unpublished report version can be published.",
      );
    const publishedAt = new Date(),
      snapshot = {
        ...pending.publication_snapshot,
        publication: {
          reportCardId: pending.id,
          version: pending.report_version,
          publishedAt: publishedAt.toISOString(),
          publishedBy: identity.id,
        },
      },
      verificationUrl = `${env.origin}/verify/report/${open(pending.verification_token_encrypted)}`,
      buffer = await reportPdf({ ...snapshot, verificationUrl }),
      checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    await storage.put(pending.storage_key, buffer);
    const row = (
      await client.query(
        "UPDATE report_cards SET status='PUBLISHED',published_by=$1,published_at=$2,publication_snapshot=$3,checksum=$4,version=version+1 WHERE id=$5 AND school_id=$6 AND status='GENERATED' RETURNING *",
        [identity.id, publishedAt, snapshot, checksum, id, identity.schoolId],
      )
    ).rows[0];
    if (!row)
      throw errors.conflict(
        "Only a generated, unpublished report version can be published.",
      );
    return (
      await audit({
        schoolId: identity.schoolId,
        userId: identity.id,
        action: row.report_version > 1 ? "REPORT_REISSUED" : "REPORT_PUBLISHED",
        entityType: "ReportCard",
        entityId: id,
        req: req,
        client: client,
      }),
      row
    );
  };
  return clientOverride ? execute(clientOverride) : transaction(execute);
}
async function email(identity, id, req) {
  const row = await authorized(identity, id);
  if ("PUBLISHED" !== row.status)
    throw errors.validation("Publish the report card before emailing it.");
  const recipient = (
    await pool.query(
      "SELECT p.email FROM parents p JOIN parent_student_links l ON l.parent_id=p.id AND l.student_id=$1 AND l.status='ACTIVE' WHERE p.school_id=$2 AND p.status='ACTIVE' AND p.email IS NOT NULL ORDER BY l.is_primary DESC LIMIT 1",
      [row.student_id, identity.schoolId],
    )
  ).rows[0];
  if (!recipient)
    throw errors.validation("No active guardian email is configured.");
  const buffer = await storage.get(row.storage_key);
  return (
    await mail.sendReport({
      to: recipient.email,
      subject: "Published academic report card",
      text: "Your authorized SAIRS report card is attached.",
      fileName: row.file_name,
      buffer: buffer,
    }),
    await pool.query("UPDATE report_cards SET emailed_at=now() WHERE id=$1", [
      row.id,
    ]),
    await audit({
      schoolId: identity.schoolId,
      userId: identity.id,
      action: "REPORT_EMAILED",
      entityType: "ReportCard",
      entityId: id,
      req: req,
    }),
    { emailed: !0 }
  );
}
module.exports = {
  list: list,
  catalog: catalog,
  view: view,
  context: context,
  generate: generate,
  download: download,
  publish: publish,
  email: email,
};

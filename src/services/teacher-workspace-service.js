"use strict";
const { pool: pool, transaction: transaction } = require("../db/pool"),
  { errors: errors } = require("../utilities/errors"),
  { audit: audit } = require("./audit-service"),
  authz = require("./authorization-service"),
  { gradeFor: gradeFor } = require("./result-engine"),
  COMPONENTS = [
    {
      code: "CA1",
      name: "CA1",
      category: "CONTINUOUS_ASSESSMENT",
      maximum: 20,
      weight: 20,
    },
    {
      code: "CA2",
      name: "CA2",
      category: "CONTINUOUS_ASSESSMENT",
      maximum: 20,
      weight: 20,
    },
    {
      code: "EXAM",
      name: "Examination",
      category: "EXAMINATION",
      maximum: 60,
      weight: 60,
    },
  ];
function componentsApproved(componentStatuses) {
  return COMPONENTS.every(
    ({ code }) => componentStatuses[code]?.status === "APPROVED",
  );
}
async function dashboardSummary(identity) {
  const teacher = await authz.teacher(identity),
    current = (
      await pool.query(
        "SELECT id FROM academic_sessions WHERE school_id=$1 AND is_current=true AND status='ACTIVE' LIMIT 1",
        [identity.schoolId],
      )
    ).rows[0];
  if (!current)
    return {
      subjectsTaught: 0,
      classesAssigned: 0,
      students: 0,
      isFormTeacher: !1,
      formClass: null,
    };
  return (
    await pool.query(
      "SELECT\n      count(DISTINCT ta.subject_id) FILTER (WHERE ta.assignment_type='SUBJECT_TEACHER')::int subjects_taught,\n      count(DISTINCT (ta.class_id,ta.class_arm_id))::int classes_assigned,\n      EXISTS(SELECT 1 FROM teacher_assignments ft WHERE ft.school_id=$1 AND ft.teacher_id=$2 AND ft.academic_session_id=$3 AND ft.assignment_type='CLASS_TEACHER' AND ft.status='ACTIVE') is_form_teacher,\n      (SELECT concat_ws(' ',c.name,ca.name) FROM teacher_assignments ft JOIN classes c ON c.id=ft.class_id AND c.school_id=ft.school_id LEFT JOIN class_arms ca ON ca.id=ft.class_arm_id AND ca.school_id=ft.school_id WHERE ft.school_id=$1 AND ft.teacher_id=$2 AND ft.academic_session_id=$3 AND ft.assignment_type='CLASS_TEACHER' AND ft.status='ACTIVE' ORDER BY c.sort_order,c.name,ca.name LIMIT 1) form_class,\n      (SELECT count(DISTINCT e.student_id)::int FROM student_session_enrolments e WHERE e.school_id=$1 AND e.academic_session_id=$3 AND e.status<>'ARCHIVED' AND EXISTS(SELECT 1 FROM teacher_assignments scoped WHERE scoped.school_id=e.school_id AND scoped.teacher_id=$2 AND scoped.academic_session_id=e.academic_session_id AND scoped.class_id=e.class_id AND scoped.class_arm_id IS NOT DISTINCT FROM e.class_arm_id AND scoped.status='ACTIVE')) students\n    FROM teacher_assignments ta WHERE ta.school_id=$1 AND ta.teacher_id=$2 AND ta.academic_session_id=$3 AND ta.status='ACTIVE'",
      [identity.schoolId, teacher.id, current.id],
    )
  ).rows[0];
}
async function bootstrap(identity, selection = {}) {
  const teacher = await authz.teacher(identity),
    [assignments, periods, current] = await Promise.all([
      pool.query(
        "SELECT ta.id,ta.assignment_type,ta.academic_session_id,ta.class_id,ta.class_arm_id,ta.subject_id,c.name class_name,ca.name arm_name,s.name subject_name\n      FROM teacher_assignments ta JOIN classes c ON c.id=ta.class_id JOIN class_arms ca ON ca.id=ta.class_arm_id\n      LEFT JOIN subjects s ON s.id=ta.subject_id WHERE ta.school_id=$1 AND ta.teacher_id=$2 AND ta.status='ACTIVE'\n      ORDER BY c.sort_order,c.name,ca.name,s.name",
        [identity.schoolId, teacher.id],
      ),
      pool.query(
        "SELECT se.id session_id,se.name session_name,se.is_current,t.id term_id,t.name term_name,t.is_current term_is_current\n      FROM academic_sessions se JOIN terms t ON t.academic_session_id=se.id AND t.school_id=se.school_id\n      WHERE se.school_id=$1 AND se.status='ACTIVE' AND t.status='ACTIVE' ORDER BY se.start_date DESC,t.start_date",
        [identity.schoolId],
      ),
      pool.query(
        "SELECT se.id session_id,se.name session_name,t.id term_id,t.name term_name FROM academic_sessions se JOIN terms t ON t.academic_session_id=se.id AND t.school_id=se.school_id WHERE se.school_id=$1 AND se.status='ACTIVE' AND t.status='ACTIVE' AND (($2::uuid IS NOT NULL AND $3::uuid IS NOT NULL AND se.id=$2 AND t.id=$3) OR ($2::uuid IS NULL AND $3::uuid IS NULL AND se.is_current=true AND t.is_current=true)) LIMIT 1",
        [identity.schoolId, selection.sessionId || null, selection.termId || null],
      ),
    ]),
    period = current.rows[0],
    progress = [];
  if ((selection.sessionId || selection.termId) && !period)
    throw errors.validation("Select an active term belonging to the selected academic session.");
  if (period)
    for (const assignment of assignments.rows.filter(
      (x) =>
        "SUBJECT_TEACHER" === x.assignment_type &&
        x.academic_session_id === period.session_id,
    )) {
      const row = (
          await pool.query(
            "SELECT\n      (SELECT count(*) FROM student_session_enrolments e WHERE e.school_id=$1 AND e.academic_session_id=$4 AND e.class_id=$2 AND e.class_arm_id=$3 AND e.status<>'ARCHIVED')::int student_count,\n      count(DISTINCT sc.student_id) FILTER(WHERE ast.code='CA1')::int ca1_count,\n      count(DISTINCT sc.student_id) FILTER(WHERE ast.code='CA2')::int ca2_count,\n      count(DISTINCT sc.student_id) FILTER(WHERE ast.code='EXAM')::int exam_count,\n      max(acs.status) FILTER(WHERE ast.code='CA1') ca1_component_status,\n      max(acs.status) FILTER(WHERE ast.code='CA2') ca2_component_status,\n      max(acs.status) FILTER(WHERE ast.code='EXAM') exam_component_status,\n      (SELECT count(*) FROM(SELECT submitted.student_id FROM scores submitted JOIN assessments sa ON sa.id=submitted.assessment_id JOIN assessment_structures ss ON ss.id=sa.structure_id WHERE submitted.school_id=$1 AND sa.academic_session_id=$4 AND sa.term_id=$5 AND sa.class_id=$2 AND sa.class_arm_id=$3 AND sa.subject_id=$6 AND submitted.status='SUBMITTED' AND ss.code IN('CA1','CA2','EXAM') GROUP BY submitted.student_id HAVING count(DISTINCT ss.code)=3) complete)::int submitted_students\n      FROM assessments a JOIN assessment_structures ast ON ast.id=a.structure_id LEFT JOIN scores sc ON sc.assessment_id=a.id AND sc.school_id=a.school_id LEFT JOIN assessment_component_submissions acs ON acs.school_id=a.school_id AND acs.assessment_id=a.id\n      WHERE a.school_id=$1 AND a.academic_session_id=$4 AND a.term_id=$5 AND a.class_id=$2 AND a.class_arm_id=$3 AND a.subject_id=$6",
            [
              identity.schoolId,
              assignment.class_id,
              assignment.class_arm_id,
              period.session_id,
              period.term_id,
              assignment.subject_id,
            ],
          )
        ).rows[0],
        batch = (
          await pool.query(
            "SELECT status FROM result_batches WHERE school_id=$1 AND academic_session_id=$2 AND term_id=$3 AND class_id=$4 AND class_arm_id=$5 AND subject_id=$6",
            [
              identity.schoolId,
              period.session_id,
              period.term_id,
              assignment.class_id,
              assignment.class_arm_id,
              assignment.subject_id,
            ],
          )
        ).rows[0];
      progress.push({
        assignmentId: assignment.id,
        ...row,
        resultStatus: batch?.status || null,
      });
    }
  const formClasses = [];
  if (period)
    for (const form of assignments.rows.filter(
      (x) =>
        "CLASS_TEACHER" === x.assignment_type &&
        x.academic_session_id === period.session_id,
    )) {
      const students = Number(
          (
            await pool.query(
              "SELECT count(*) count FROM student_session_enrolments WHERE school_id=$1 AND academic_session_id=$2 AND class_id=$3 AND class_arm_id=$4 AND status<>'ARCHIVED'",
              [
                identity.schoolId,
                period.session_id,
                form.class_id,
                form.class_arm_id,
              ],
            )
          ).rows[0].count,
        ),
        subjects = (
          await pool.query(
            "SELECT s.id subject_id,s.name subject_name,(SELECT count(*) FROM(SELECT sc.student_id FROM scores sc JOIN assessments a ON a.id=sc.assessment_id JOIN assessment_component_submissions acs ON acs.school_id=a.school_id AND acs.assessment_id=a.id AND acs.status='APPROVED' JOIN assessment_structures ast ON ast.id=a.structure_id WHERE sc.school_id=$1 AND a.academic_session_id=$2 AND a.term_id=$3 AND a.class_id=$4 AND a.class_arm_id=$5 AND a.subject_id=s.id AND ast.code IN('CA1','CA2','EXAM') GROUP BY sc.student_id HAVING count(DISTINCT ast.code)=3) complete)::int complete_students FROM session_class_subjects cs JOIN subjects s ON s.id=cs.subject_id AND s.school_id=cs.school_id WHERE cs.school_id=$1 AND cs.academic_session_id=$2 AND cs.class_id=$4 AND cs.status='ACTIVE' AND s.status='ACTIVE' ORDER BY s.name",
            [
              identity.schoolId,
              period.session_id,
              period.term_id,
              form.class_id,
              form.class_arm_id,
            ],
          )
        ).rows;
      for (const subject of subjects) {
        const rows = (
            await pool.query(
              `SELECT ast.code,COALESCE(acs.status,CASE WHEN EXISTS(SELECT 1 FROM scores sc WHERE sc.school_id=a.school_id AND sc.assessment_id=a.id) THEN 'DRAFT' ELSE 'NOT_STARTED' END) status,concat_ws(' ',teacher.first_name,teacher.middle_name,teacher.last_name) teacher_name
               FROM assessment_structures ast
               LEFT JOIN assessments a ON a.school_id=$1 AND a.structure_id=ast.id AND a.academic_session_id=$2 AND a.term_id=$3 AND a.class_id=$4 AND a.class_arm_id=$5 AND a.subject_id=$6 AND a.status<>'ARCHIVED'
               LEFT JOIN assessment_component_submissions acs ON acs.school_id=a.school_id AND acs.assessment_id=a.id
               LEFT JOIN teachers teacher ON teacher.school_id=a.school_id AND teacher.id=a.teacher_id
               WHERE ast.school_id=$1 AND ast.code IN('CA1','CA2','EXAM')`,
              [
                identity.schoolId,
                period.session_id,
                period.term_id,
                form.class_id,
                form.class_arm_id,
                subject.subject_id,
              ],
            )
          ).rows,
          assigned = (
            await pool.query(
              `SELECT concat_ws(' ',teacher.first_name,teacher.middle_name,teacher.last_name) teacher_name FROM teacher_assignments ta JOIN teachers teacher ON teacher.id=ta.teacher_id AND teacher.school_id=ta.school_id WHERE ta.school_id=$1 AND ta.academic_session_id=$2 AND ta.class_id=$3 AND ta.class_arm_id=$4 AND ta.subject_id=$5 AND ta.assignment_type='SUBJECT_TEACHER' AND ta.status='ACTIVE' ORDER BY teacher.last_name,teacher.first_name LIMIT 1`,
              [
                identity.schoolId,
                period.session_id,
                form.class_id,
                form.class_arm_id,
                subject.subject_id,
              ],
            )
          ).rows[0];
        subject.teacher_name =
          rows.find((row) => row.teacher_name)?.teacher_name ||
          assigned?.teacher_name ||
          null;
        subject.components = Object.fromEntries(
          ["CA1", "CA2", "EXAM"].map((code) => [
            code,
            rows.find((row) => row.code === code)?.status || "NOT_STARTED",
          ]),
        );
      }
      const classSubmission=(await pool.query("SELECT status,review_comment,submitted_at,reviewed_at FROM class_result_submissions WHERE school_id=$1 AND academic_session_id=$2 AND term_id=$3 AND class_id=$4 AND class_arm_id IS NOT DISTINCT FROM $5",[identity.schoolId,period.session_id,period.term_id,form.class_id,form.class_arm_id])).rows[0]||null;
      formClasses.push({
        assignmentId: form.id,
        classId: form.class_id,
        classArmId: form.class_arm_id,
        className: form.class_name,
        armName: form.arm_name,
        studentCount: students,
        subjects: subjects,
        resultSubmission: classSubmission,
        ready:
          subjects.length > 0 &&
          subjects.every((x) => Number(x.complete_students) === students),
      });
    }
  return {
    teacher: {
      id: teacher.id,
      firstName: teacher.first_name,
      middleName: teacher.middle_name,
      lastName: teacher.last_name,
    },
    assignments: assignments.rows,
    periods: periods.rows,
    currentPeriod: period || null,
    progress: progress,
    formClasses: formClasses,
  };
}
async function subjectAssignment(identity, id, sessionId, client = pool) {
  const teacher = await authz.teacher(identity),
    row = (
      await client.query(
        "SELECT ta.*,c.name class_name,ca.name arm_name,s.name subject_name FROM teacher_assignments ta\n    JOIN classes c ON c.id=ta.class_id JOIN class_arms ca ON ca.id=ta.class_arm_id JOIN subjects s ON s.id=ta.subject_id\n    WHERE ta.school_id=$1 AND ta.id=$2 AND ta.teacher_id=$3 AND ta.assignment_type='SUBJECT_TEACHER' AND ta.status='ACTIVE'",
        [identity.schoolId, id, teacher.id],
      )
    ).rows[0];
  if (!row) throw errors.forbidden("This subject is not assigned to you.");
  if (row.academic_session_id !== sessionId)
    throw errors.validation(
      "This teaching assignment does not belong to the selected academic session.",
    );
  return row;
}
async function ensureComponents(client, identity, assignment, termId) {
  if (
    !(
      await client.query(
        "SELECT id FROM terms WHERE school_id=$1 AND id=$2 AND academic_session_id=$3 AND status='ACTIVE'",
        [identity.schoolId, termId, assignment.academic_session_id],
      )
    ).rows[0]
  )
    throw errors.validation("Select a valid term in this academic session.");
  const output = {};
  for (const component of COMPONENTS) {
    const structure = (
      await client.query(
        "INSERT INTO assessment_structures(school_id,code,name,category,maximum_score,weight,status)\n      VALUES($1,$2,$3,$4,$5,$6,'ACTIVE') ON CONFLICT(school_id,code) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,maximum_score=EXCLUDED.maximum_score,weight=EXCLUDED.weight,status='ACTIVE' RETURNING id",
        [
          identity.schoolId,
          component.code,
          component.name,
          component.category,
          component.maximum,
          component.weight,
        ],
      )
    ).rows[0];
    let assessment = (
      await client.query(
        "SELECT * FROM assessments WHERE school_id=$1 AND structure_id=$2 AND academic_session_id=$3 AND term_id=$4 AND class_id=$5 AND class_arm_id=$6 AND subject_id=$7 AND status<>'ARCHIVED' LIMIT 1",
        [
          identity.schoolId,
          structure.id,
          assignment.academic_session_id,
          termId,
          assignment.class_id,
          assignment.class_arm_id,
          assignment.subject_id,
        ],
      )
    ).rows[0];
    (assessment ||
      (assessment = (
        await client.query(
          "INSERT INTO assessments(school_id,structure_id,academic_session_id,term_id,class_id,class_arm_id,subject_id,teacher_id,name,maximum_score,weight,status)\n      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'OPEN') RETURNING *",
          [
            identity.schoolId,
            structure.id,
            assignment.academic_session_id,
            termId,
            assignment.class_id,
            assignment.class_arm_id,
            assignment.subject_id,
            assignment.teacher_id,
            component.name,
            component.maximum,
            component.weight,
          ],
        )
      ).rows[0]),
      (output[component.code] = assessment));
  }
  return output;
}
async function scoreSheet(identity, data, clientOverride) {
  const execute = async (client) => {
    const assignment = await subjectAssignment(
        identity,
        data.assignmentId,
        data.sessionId,
        client,
      ),
      components = await ensureComponents(
        client,
        identity,
        assignment,
        data.termId,
      ),
      students = (
        await client.query(
          "SELECT s.id,s.admission_number,s.first_name,s.middle_name,s.last_name,\n      max(sc.score) FILTER(WHERE sc.assessment_id=$4) ca1,max(sc.status) FILTER(WHERE sc.assessment_id=$4) ca1_status,max(sc.updated_at) FILTER(WHERE sc.assessment_id=$4) ca1_updated_at,\n      max(sc.score) FILTER(WHERE sc.assessment_id=$5) ca2,max(sc.status) FILTER(WHERE sc.assessment_id=$5) ca2_status,max(sc.updated_at) FILTER(WHERE sc.assessment_id=$5) ca2_updated_at,\n      max(sc.score) FILTER(WHERE sc.assessment_id=$6) exam,max(sc.status) FILTER(WHERE sc.assessment_id=$6) exam_status,max(sc.updated_at) FILTER(WHERE sc.assessment_id=$6) exam_updated_at\n      FROM student_session_enrolments e JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id LEFT JOIN scores sc ON sc.student_id=s.id AND sc.school_id=s.school_id\n      WHERE e.school_id=$1 AND e.academic_session_id=$7 AND e.class_id=$2 AND e.class_arm_id=$3 AND e.status<>'ARCHIVED'\n      GROUP BY s.id ORDER BY s.last_name,s.first_name,s.admission_number",
          [
            identity.schoolId,
            assignment.class_id,
            assignment.class_arm_id,
            components.CA1.id,
            components.CA2.id,
            components.EXAM.id,
            data.sessionId,
          ],
        )
      ).rows,
      componentStatuses = {};
    for (const [code, assessment] of Object.entries(components)) {
      const submission = (
        await client.query(
          "SELECT status,submitted_at,reviewed_at,review_comment FROM assessment_component_submissions WHERE school_id=$1 AND assessment_id=$2",
          [identity.schoolId, assessment.id],
        )
      ).rows[0];
      componentStatuses[code] = submission || {
        status: students.some((row) => row[code.toLowerCase()] != null)
          ? "DRAFT"
          : "NOT_STARTED",
      };
    }
    if (componentsApproved(componentStatuses)) {
      const rules = (
        await client.query(
          "SELECT * FROM grading_rules WHERE school_id=$1 AND status='ACTIVE' ORDER BY sort_order",
          [identity.schoolId],
        )
      ).rows;
      for (const student of students) {
        const total =
          Number(student.ca1) + Number(student.ca2) + Number(student.exam);
        student.grade = gradeFor(rules, total).grade;
      }
    }
    return {
      assignment: assignment,
      sessionId: data.sessionId,
      termId: data.termId,
      students: students,
      componentStatuses,
    };
  };
  return clientOverride ? execute(clientOverride) : transaction(execute);
}
async function save(identity, data, submit, req, clientOverride) {
  const execute = async (client) => {
    const assignment = await subjectAssignment(
        identity,
        data.assignmentId,
        data.sessionId,
        client,
      ),
      components = await ensureComponents(
        client,
        identity,
        assignment,
        data.termId,
      ),
      students = new Set(
        (
          await client.query(
            "SELECT student_id id FROM student_session_enrolments WHERE school_id=$1 AND academic_session_id=$2 AND class_id=$3 AND class_arm_id=$4 AND status<>'ARCHIVED'",
            [
              identity.schoolId,
              data.sessionId,
              assignment.class_id,
              assignment.class_arm_id,
            ],
          )
        ).rows.map((x) => x.id),
      ),
      submissions = new Map(
        (
          await client.query(
            "SELECT assessment_id,status FROM assessment_component_submissions WHERE school_id=$1 AND assessment_id=ANY($2::uuid[])",
            [identity.schoolId, Object.values(components).map((x) => x.id)],
          )
        ).rows.map((row) => [row.assessment_id, row.status]),
      ),
      savedComponents = new Set();
    for (const item of data.scores || []) {
      if (!students.has(item.studentId))
        throw errors.forbidden("A student is outside your assigned class.");
      for (const [code, field, max] of [
        ["CA1", "ca1", 20],
        ["CA2", "ca2", 20],
        ["EXAM", "exam", 60],
      ]) {
        if ("" === item[field] || null == item[field]) {
          if (submit)
            throw errors.validation(
              `Complete ${code} for every student before submitting.`,
            );
          continue;
        }
        const value = Number(item[field]);
        if (!Number.isFinite(value) || value < 0 || value > max)
          throw errors.validation(
            `${code} scores must be between 0 and ${max}.`,
          );
        const previous = (
            await client.query(
              "SELECT id,score,updated_at FROM scores WHERE school_id=$1 AND assessment_id=$2 AND student_id=$3 FOR UPDATE",
              [identity.schoolId, components[code].id, item.studentId],
            )
          ).rows[0],
          base = item[`${field}UpdatedAt`],
          componentStatus = submissions.get(components[code].id);
        if (["SUBMITTED", "APPROVED"].includes(componentStatus)) {
          if (!previous || Number(previous.score) !== value)
            throw errors.forbidden(
              `${code} is ${componentStatus.toLowerCase()} and cannot be changed by the teacher.`,
            );
          continue;
        }
        if (
          base &&
          previous?.updated_at &&
          new Date(previous.updated_at) > new Date(base)
        )
          throw errors.conflict(
            `${code} for this student changed after the offline copy was saved.`,
            {
              studentId: item.studentId,
              component: code,
              score: previous.score,
              updatedAt: previous.updated_at,
            },
          );
        const row = previous
          ? (
              await client.query(
                "UPDATE scores SET score=$1,status=$2,updated_by=$3,version=version+1 WHERE id=$4 RETURNING *",
                [
                  value,
                  submit ? "SUBMITTED" : "DRAFT",
                  identity.id,
                  previous.id,
                ],
              )
            ).rows[0]
          : (
              await client.query(
                "INSERT INTO scores(school_id,assessment_id,student_id,score,status,entered_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *",
                [
                  identity.schoolId,
                  components[code].id,
                  item.studentId,
                  value,
                  submit ? "SUBMITTED" : "DRAFT",
                  identity.id,
                ],
              )
            ).rows[0];
        await client.query(
          "INSERT INTO score_history(school_id,score_id,assessment_id,student_id,previous_score,new_score,action,changed_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            identity.schoolId,
            row.id,
            components[code].id,
            item.studentId,
            previous?.score,
            value,
            previous ? "UPDATED" : "CREATED",
            identity.id,
            submit ? "Score submission" : "Draft score entry",
          ],
        );
        savedComponents.add(code);
      }
    }
    if (submit)
      await client.query(
        "UPDATE assessments SET status='CLOSED' WHERE id=ANY($1::uuid[])",
        [Object.values(components).map((x) => x.id)],
      );
    for (const code of savedComponents)
      await audit({
        schoolId: identity.schoolId,
        userId: identity.id,
        action: `${code}_${submit ? "SUBMITTED" : "SAVED"}`,
        entityType: "Assessment",
        entityId: components[code].id,
        newValue: { students: (data.scores || []).length },
        context: {
          component: code,
          class: assignment.class_name,
          arm: assignment.arm_name,
          subject: assignment.subject_name,
          sessionId: data.sessionId,
          termId: data.termId,
        },
        req: req,
        client: client,
      });
    return { saved: (data.scores || []).length, submitted: submit };
  };
  return clientOverride ? execute(clientOverride) : transaction(execute);
}

async function chooseManagement(client, schoolId) {
  const selected = (
    await client.query(
      `SELECT u.id FROM users u LEFT JOIN assessment_component_submissions cs ON cs.school_id=u.school_id AND cs.routed_management_user_id=u.id WHERE u.school_id=$1 AND u.role='MANAGEMENT' AND u.status='ACTIVE' GROUP BY u.id,u.email ORDER BY max(cs.submitted_at) ASC NULLS FIRST,u.email LIMIT 1`,
      [schoolId],
    )
  ).rows[0];
  if (!selected)
    throw errors.validation(
      "Create and activate a Management user before submitting scores.",
    );
  return selected.id;
}

async function submitComponent(identity, data, req, clientOverride) {
  if (!clientOverride) await save(identity, data, false, req);
  const execute = async (client) => {
    if (clientOverride) await save(identity, data, false, req, client);
    const assignment = await subjectAssignment(
        identity,
        data.assignmentId,
        data.sessionId,
        client,
      ),
      components = await ensureComponents(
        client,
        identity,
        assignment,
        data.termId,
      ),
      code = String(data.component || "").toUpperCase();
    if (!components[code]) throw errors.validation("Select CA1, CA2 or Exam.");
    const roster = Number(
      (
        await client.query(
          "SELECT count(*) FROM student_session_enrolments WHERE school_id=$1 AND academic_session_id=$2 AND class_id=$3 AND class_arm_id=$4 AND status<>'ARCHIVED'",
          [
            identity.schoolId,
            data.sessionId,
            assignment.class_id,
            assignment.class_arm_id,
          ],
        )
      ).rows[0].count,
    );
    const completed = Number(
      (
        await client.query(
          "SELECT count(DISTINCT student_id) FROM scores WHERE school_id=$1 AND assessment_id=$2",
          [identity.schoolId, components[code].id],
        )
      ).rows[0].count,
    );
    if (!roster || completed !== roster)
      throw errors.validation(
        `Complete ${code} for every student before submitting.`,
      );
    const existing = (
      await client.query(
        "SELECT * FROM assessment_component_submissions WHERE school_id=$1 AND assessment_id=$2 FOR UPDATE",
        [identity.schoolId, components[code].id],
      )
    ).rows[0];
    if (existing && !["DRAFT", "RETURNED"].includes(existing.status))
      throw errors.conflict(
        `${code} has already been ${existing.status.toLowerCase()}.`,
      );
    const managerId = await chooseManagement(client, identity.schoolId);
    const row = (
      await client.query(
        `INSERT INTO assessment_component_submissions(school_id,assessment_id,status,routed_management_user_id,submitted_by,submitted_at) VALUES($1,$2,'SUBMITTED',$3,$4,now()) ON CONFLICT(school_id,assessment_id) DO UPDATE SET status='SUBMITTED',routed_management_user_id=EXCLUDED.routed_management_user_id,submitted_by=EXCLUDED.submitted_by,submitted_at=now(),reviewed_by=NULL,reviewed_at=NULL,decision=NULL,review_comment=NULL,version=assessment_component_submissions.version+1 RETURNING *`,
        [identity.schoolId, components[code].id, managerId, identity.id],
      )
    ).rows[0];
    await client.query(
      "UPDATE scores SET status='SUBMITTED' WHERE school_id=$1 AND assessment_id=$2",
      [identity.schoolId, components[code].id],
    );
    await audit({
      schoolId: identity.schoolId,
      userId: identity.id,
      action: `${code}_${existing?.status === "RETURNED" ? "RESUBMITTED" : "SUBMITTED"}`,
      entityType: "Assessment",
      entityId: components[code].id,
      newValue: { status: "SUBMITTED", students: completed },
      context: {
        component: code,
        class: assignment.class_name,
        arm: assignment.arm_name,
        subject: assignment.subject_name,
        sessionId: data.sessionId,
        termId: data.termId,
      },
      req,
      client,
    });
    return row;
  };
  return clientOverride ? execute(clientOverride) : transaction(execute);
}

async function managementQueue(identity, data) {
  const paged = data && Object.keys(data).length,
    limit = Math.min(100, Math.max(10, Number(data?.limit) || 25)),
    offset = Math.max(0, Number(data?.offset) || 0),
    values = [identity.schoolId, identity.id],
    where = ["cs.school_id=$1", "cs.routed_management_user_id=$2"];
  if (data?.status) {
    values.push(String(data.status).toUpperCase());
    where.push(`cs.status=$${values.length}`);
  }
  const base = `FROM assessment_component_submissions cs JOIN assessments a ON a.id=cs.assessment_id AND a.school_id=cs.school_id JOIN assessment_structures ast ON ast.id=a.structure_id JOIN teachers t ON t.id=a.teacher_id AND t.school_id=a.school_id JOIN subjects s ON s.id=a.subject_id JOIN classes c ON c.id=a.class_id LEFT JOIN class_arms ca ON ca.id=a.class_arm_id JOIN academic_sessions se ON se.id=a.academic_session_id JOIN terms tr ON tr.id=a.term_id WHERE ${where.join(" AND ")}`;
  if (!paged)
    return (await pool.query(`SELECT cs.*,ast.code component,t.first_name teacher_first_name,t.middle_name teacher_middle_name,t.last_name teacher_last_name,s.name subject_name,c.name class_name,ca.name arm_name,se.name session_name,tr.name term_name,(SELECT json_agg(json_build_object('studentId',st.id,'admissionNumber',st.admission_number,'studentName',concat_ws(' ',st.first_name,st.middle_name,st.last_name),'score',sc.score) ORDER BY st.last_name,st.first_name,st.admission_number) FROM scores sc JOIN students st ON st.id=sc.student_id AND st.school_id=sc.school_id WHERE sc.school_id=a.school_id AND sc.assessment_id=a.id) scores ${base} ORDER BY cs.submitted_at DESC`,values)).rows;
  const total=Number((await pool.query(`SELECT count(*) ${base}`,values)).rows[0].count);
  values.push(limit,offset);
  const rows=(await pool.query(`SELECT cs.*,ast.code component,t.first_name teacher_first_name,t.middle_name teacher_middle_name,t.last_name teacher_last_name,s.name subject_name,c.name class_name,ca.name arm_name,se.name session_name,tr.name term_name,(SELECT json_agg(json_build_object('studentId',st.id,'admissionNumber',st.admission_number,'studentName',concat_ws(' ',st.first_name,st.middle_name,st.last_name),'score',sc.score) ORDER BY st.last_name,st.first_name,st.admission_number) FROM scores sc JOIN students st ON st.id=sc.student_id AND st.school_id=sc.school_id WHERE sc.school_id=a.school_id AND sc.assessment_id=a.id) scores ${base} ORDER BY CASE cs.status WHEN 'SUBMITTED' THEN 0 WHEN 'RETURNED' THEN 1 ELSE 2 END,cs.submitted_at DESC LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
  return {rows,total,limit,offset};
}

async function reviewComponent(identity, data, req, clientOverride) {
  const execute = async (client) => {
    const decision = String(data.decision || "").toUpperCase();
    if (!["APPROVED", "RETURNED"].includes(decision))
      throw errors.validation("Choose Approve or Return.");
    const current = (
      await client.query(
        `SELECT cs.*,ast.code component,c.name class_name,ca.name arm_name,s.name subject_name,se.name session_name,tr.name term_name,concat_ws(' ',teacher.first_name,teacher.middle_name,teacher.last_name) teacher_name FROM assessment_component_submissions cs JOIN assessments a ON a.id=cs.assessment_id AND a.school_id=cs.school_id JOIN assessment_structures ast ON ast.id=a.structure_id JOIN classes c ON c.id=a.class_id LEFT JOIN class_arms ca ON ca.id=a.class_arm_id JOIN subjects s ON s.id=a.subject_id JOIN academic_sessions se ON se.id=a.academic_session_id JOIN terms tr ON tr.id=a.term_id LEFT JOIN teachers teacher ON teacher.id=a.teacher_id AND teacher.school_id=a.school_id WHERE cs.school_id=$1 AND cs.id=$2 AND cs.routed_management_user_id=$3 FOR UPDATE OF cs`,
        [identity.schoolId, data.submissionId, identity.id],
      )
    ).rows[0];
    if (!current) throw errors.notFound("Component submission not found.");
    if (current.status !== "SUBMITTED")
      throw errors.conflict("Only submitted components can be reviewed.");
    const row = (
      await client.query(
        "UPDATE assessment_component_submissions SET status=$1,decision=$1,reviewed_by=$2,reviewed_at=now(),review_comment=$3,version=version+1 WHERE id=$4 RETURNING *",
        [decision, identity.id, data.comment || null, current.id],
      )
    ).rows[0];
    if (decision === "RETURNED")
      await client.query(
        "UPDATE scores SET status='DRAFT' WHERE school_id=$1 AND assessment_id=$2",
        [identity.schoolId, current.assessment_id],
      );
    await audit({
      schoolId: identity.schoolId,
      userId: identity.id,
      action: `${current.component}_${decision}`,
      entityType: "Assessment",
      entityId: current.assessment_id,
      oldValue: { status: current.status },
      newValue: { status: decision },
      context: {
        component: current.component,
        teacher: current.teacher_name,
        class: current.class_name,
        arm: current.arm_name,
        subject: current.subject_name,
        session: current.session_name,
        term: current.term_name,
        reviewerUserId: identity.id,
        comment: data.comment || null,
      },
      req,
      client,
    });
    return row;
  };
  return clientOverride ? execute(clientOverride) : transaction(execute);
}

async function parentProgress(identity) {
  return (
    await pool.query(
      `SELECT st.id student_id,st.first_name,st.middle_name,st.last_name,s.name subject_name,ast.code component,ast.maximum_score,max(sc.score) score,c.name class_name,ca.name arm_name,se.name session_name,tr.name term_name FROM parents p JOIN parent_student_links l ON l.parent_id=p.id AND l.school_id=p.school_id AND l.status='ACTIVE' JOIN students st ON st.id=l.student_id AND st.school_id=l.school_id JOIN scores sc ON sc.student_id=st.id AND sc.school_id=st.school_id JOIN assessments a ON a.id=sc.assessment_id AND a.school_id=sc.school_id JOIN assessment_component_submissions cs ON cs.school_id=a.school_id AND cs.assessment_id=a.id AND cs.status='APPROVED' JOIN assessment_structures ast ON ast.id=a.structure_id JOIN subjects s ON s.id=a.subject_id JOIN classes c ON c.id=a.class_id LEFT JOIN class_arms ca ON ca.id=a.class_arm_id JOIN academic_sessions se ON se.id=a.academic_session_id AND se.is_current=true JOIN terms tr ON tr.id=a.term_id AND tr.is_current=true WHERE p.school_id=$1 AND p.user_id=$2 AND p.status='ACTIVE' GROUP BY st.id,s.name,ast.code,ast.maximum_score,c.name,ca.name,se.name,tr.name ORDER BY st.last_name,st.first_name,s.name,ast.code`,
      [identity.schoolId, identity.id],
    )
  ).rows;
}
function ranks(rows, value) {
  let rank = 0,
    last = null;
  return new Map(
    [...rows]
      .sort(
        (a, b) =>
          value(b) - value(a) ||
          String(a.admission_number).localeCompare(String(b.admission_number)),
      )
      .map(
        (row, index) => (
          (null !== last && value(row) === last) || (rank = index + 1),
          (last = value(row)),
          [row.student_id || row.id, rank]
        ),
      ),
  );
}
async function compile(identity, data, req) {
  return transaction(async (client) => {
    const teacher = await authz.teacher(identity),
      form = (
        await client.query(
          "SELECT * FROM teacher_assignments WHERE school_id=$1 AND id=$2 AND teacher_id=$3 AND assignment_type='CLASS_TEACHER' AND status='ACTIVE'",
          [identity.schoolId, data.assignmentId, teacher.id],
        )
      ).rows[0];
    if (!form)
      throw errors.forbidden(
        "Only the assigned Form Teacher can compile this report.",
      );
    if (form.academic_session_id !== data.sessionId)
      throw errors.validation(
        "This Form Teacher assignment does not belong to the selected session.",
      );
    if (
      !(
        await client.query(
          "SELECT id FROM terms WHERE school_id=$1 AND id=$2 AND academic_session_id=$3 AND status='ACTIVE'",
          [identity.schoolId, data.termId, data.sessionId],
        )
      ).rows[0]
    )
      throw errors.validation("Select a valid term.");
    const students = (
        await client.query(
          "SELECT s.id,s.admission_number FROM student_session_enrolments e JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id WHERE e.school_id=$1 AND e.academic_session_id=$2 AND e.class_id=$3 AND e.class_arm_id=$4 AND e.status<>'ARCHIVED' ORDER BY s.admission_number",
          [identity.schoolId, data.sessionId, form.class_id, form.class_arm_id],
        )
      ).rows,
      subjects = (
        await client.query(
          "SELECT s.id,s.name FROM session_class_subjects cs JOIN subjects s ON s.id=cs.subject_id AND s.school_id=cs.school_id WHERE cs.school_id=$1 AND cs.academic_session_id=$2 AND cs.class_id=$3 AND cs.status='ACTIVE' AND s.status='ACTIVE' ORDER BY s.name",
          [identity.schoolId, data.sessionId, form.class_id],
        )
      ).rows;
    if (!subjects.length)
      throw errors.validation(
        "No required subjects are mapped to this class. Import the Teacher Master File first.",
      );
    const componentIncomplete = [];
    for (const subject of subjects) {
      const states = (
        await client.query(
          `SELECT ast.code,acs.status FROM assessment_structures ast LEFT JOIN assessments a ON a.school_id=$1 AND a.structure_id=ast.id AND a.academic_session_id=$2 AND a.term_id=$3 AND a.class_id=$4 AND a.class_arm_id=$5 AND a.subject_id=$6 AND a.status<>'ARCHIVED' LEFT JOIN assessment_component_submissions acs ON acs.school_id=a.school_id AND acs.assessment_id=a.id WHERE ast.school_id=$1 AND ast.code IN('CA1','CA2','EXAM')`,
          [
            identity.schoolId,
            data.sessionId,
            data.termId,
            form.class_id,
            form.class_arm_id,
            subject.id,
          ],
        )
      ).rows;
      for (const code of ["CA1", "CA2", "EXAM"]) {
        const status =
          states.find((row) => row.code === code)?.status || "NOT_STARTED";
        if (status !== "APPROVED") {
          const detail =
            status === "SUBMITTED"
              ? "awaiting approval"
              : status === "RETURNED"
                ? "returned for correction"
                : "not submitted";
          componentIncomplete.push(
            `${subject.name} — ${code === "EXAM" ? "Exam" : code} ${detail}`,
          );
        }
      }
    }
    if (componentIncomplete.length)
      throw errors.validation(
        `Cannot compile result. ${componentIncomplete.length} assessment component${componentIncomplete.length === 1 ? " is" : "s are"} still incomplete: ${componentIncomplete.join("; ")}`,
        componentIncomplete,
      );
    const incomplete = [];
    for (const subject of subjects) {
      const count = Number(
        (
          await client.query(
            "SELECT count(DISTINCT sc.student_id) count FROM scores sc JOIN assessments a ON a.id=sc.assessment_id JOIN assessment_component_submissions acs ON acs.school_id=a.school_id AND acs.assessment_id=a.id AND acs.status='APPROVED' JOIN assessment_structures st ON st.id=a.structure_id WHERE sc.school_id=$1 AND a.academic_session_id=$2 AND a.term_id=$3 AND a.class_id=$4 AND a.class_arm_id=$5 AND a.subject_id=$6 AND st.code IN('CA1','CA2','EXAM') GROUP BY sc.student_id HAVING count(DISTINCT st.code)=3",
            [
              identity.schoolId,
              data.sessionId,
              data.termId,
              form.class_id,
              form.class_arm_id,
              subject.id,
            ],
          )
        ).rowCount,
      );
      count < students.length &&
        incomplete.push(
          `${subject.name} – ${students.length - count} student${students.length - count === 1 ? "" : "s"} incomplete`,
        );
    }
    if (incomplete.length)
      throw errors.validation(
        `Report cannot be compiled. Incomplete subjects: ${incomplete.join("; ")}`,
        incomplete,
      );
    const rules = (
      await client.query(
        "SELECT * FROM grading_rules WHERE school_id=$1 AND status='ACTIVE' ORDER BY sort_order",
        [identity.schoolId],
      )
    ).rows;
    if (!rules.length)
      throw errors.validation("No active grading rules are configured.");
    const compiled = [];
    for (const subject of subjects) {
      const rows = (
          await client.query(
            "SELECT s.id student_id,s.admission_number,\n      max(sc.score) FILTER(WHERE st.code='CA1') ca1,max(sc.score) FILTER(WHERE st.code='CA2') ca2,max(sc.score) FILTER(WHERE st.code='EXAM') exam\n      FROM student_session_enrolments e JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id JOIN scores sc ON sc.student_id=s.id JOIN assessments a ON a.id=sc.assessment_id JOIN assessment_structures st ON st.id=a.structure_id\n      WHERE e.school_id=$1 AND e.class_id=$2 AND e.class_arm_id=$3 AND e.academic_session_id=$4 AND e.status<>'ARCHIVED' AND a.academic_session_id=$4 AND a.term_id=$5 AND a.subject_id=$6 AND sc.status='SUBMITTED'\n      GROUP BY s.id",
            [
              identity.schoolId,
              form.class_id,
              form.class_arm_id,
              data.sessionId,
              data.termId,
              subject.id,
            ],
          )
        ).rows.map((x) => ({
          ...x,
          total: Number(x.ca1) + Number(x.ca2) + Number(x.exam),
        })),
        subjectRanks = ranks(rows, (x) => x.total),
        batch = (
          await client.query(
            "INSERT INTO result_batches(school_id,academic_session_id,term_id,class_id,class_arm_id,subject_id,status,calculated_by,calculated_at) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,now()) ON CONFLICT(school_id,academic_session_id,term_id,class_id,class_arm_id,subject_id) DO UPDATE SET status='DRAFT',calculated_by=EXCLUDED.calculated_by,calculated_at=now(),version=result_batches.version+1,updated_at=now() WHERE result_batches.status IN('DRAFT','RETURNED') RETURNING *",
            [
              identity.schoolId,
              data.sessionId,
              data.termId,
              form.class_id,
              form.class_arm_id,
              subject.id,
              identity.id,
            ],
          )
        ).rows[0];
      if (!batch)
        throw errors.conflict(
          `${subject.name} results are already in workflow and cannot be recompiled.`,
        );
      for (const row of rows) {
        const grade = gradeFor(rules, row.total);
        (await client.query(
          "INSERT INTO results(school_id,batch_id,student_id,ca1_score,ca2_score,continuous_assessment_total,examination_score,total_score,total_weighted_score,percentage,grade,remark,subject_position,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$8,$9,$10,$11,'DRAFT') ON CONFLICT(school_id,batch_id,student_id) DO UPDATE SET ca1_score=EXCLUDED.ca1_score,ca2_score=EXCLUDED.ca2_score,continuous_assessment_total=EXCLUDED.continuous_assessment_total,examination_score=EXCLUDED.examination_score,total_score=EXCLUDED.total_score,total_weighted_score=EXCLUDED.total_weighted_score,percentage=EXCLUDED.percentage,grade=EXCLUDED.grade,remark=EXCLUDED.remark,subject_position=EXCLUDED.subject_position,version=results.version+1,updated_at=now()",
          [
            identity.schoolId,
            batch.id,
            row.student_id,
            row.ca1,
            row.ca2,
            Number(row.ca1) + Number(row.ca2),
            row.exam,
            row.total,
            grade.grade,
            grade.remark,
            subjectRanks.get(row.student_id),
          ],
        ),
          compiled.push({ studentId: row.student_id, total: row.total }));
      }
    }
    const averages = students.map((s) => {
        const own = compiled.filter((x) => x.studentId === s.id);
        return {
          id: s.id,
          admission_number: s.admission_number,
          average: own.reduce((n, x) => n + x.total, 0) / own.length,
        };
      }),
      overall = ranks(averages, (x) => x.average);
    for (const row of averages)
      await client.query(
        "UPDATE results r SET student_average=$1,overall_position=$2 FROM result_batches rb WHERE r.batch_id=rb.id AND r.school_id=$3 AND r.student_id=$4 AND rb.academic_session_id=$5 AND rb.term_id=$6 AND rb.class_id=$7 AND rb.class_arm_id=$8",
        [
          Math.round(100 * row.average) / 100,
          overall.get(row.id),
          identity.schoolId,
          row.id,
          data.sessionId,
          data.termId,
          form.class_id,
          form.class_arm_id,
        ],
      );
    const managerId = await chooseManagement(client, identity.schoolId);
    await client.query(
      `INSERT INTO class_result_submissions(school_id,academic_session_id,term_id,class_id,class_arm_id,form_teacher_id,status,routed_management_user_id,submitted_by,submitted_at)
       VALUES($1,$2,$3,$4,$5,$6,'SUBMITTED',$7,$8,now())
       ON CONFLICT(school_id,academic_session_id,term_id,class_id,class_arm_id) DO UPDATE SET status='SUBMITTED',form_teacher_id=EXCLUDED.form_teacher_id,routed_management_user_id=EXCLUDED.routed_management_user_id,submitted_by=EXCLUDED.submitted_by,submitted_at=now(),reviewed_by=NULL,reviewed_at=NULL,review_comment=NULL,published_at=NULL,version=class_result_submissions.version+1`,
      [identity.schoolId,data.sessionId,data.termId,form.class_id,form.class_arm_id,teacher.id,managerId,identity.id],
    );
    await client.query(
      "UPDATE result_batches SET status='SUBMITTED',routed_management_user_id=$1,submitted_by=$2,submitted_at=now(),version=version+1 WHERE school_id=$3 AND academic_session_id=$4 AND term_id=$5 AND class_id=$6 AND class_arm_id IS NOT DISTINCT FROM $7",
      [managerId,identity.id,identity.schoolId,data.sessionId,data.termId,form.class_id,form.class_arm_id],
    );
    await client.query(
      "UPDATE results r SET status='SUBMITTED',version=r.version+1 FROM result_batches rb WHERE r.batch_id=rb.id AND rb.school_id=$1 AND rb.academic_session_id=$2 AND rb.term_id=$3 AND rb.class_id=$4 AND rb.class_arm_id IS NOT DISTINCT FROM $5",
      [identity.schoolId,data.sessionId,data.termId,form.class_id,form.class_arm_id],
    );
    return (
      await audit({
        schoolId: identity.schoolId,
        userId: identity.id,
        action: "CLASS_REPORT_COMPILED",
        entityType: "TeacherAssignment",
        entityId: form.id,
        newValue: {
          students: students.length,
          subjects: subjects.length,
          sessionId: data.sessionId,
          termId: data.termId,
        },
        context: {
          class: form.class_name,
          arm: form.arm_name,
          sessionId: data.sessionId,
          termId: data.termId,
        },
        req: req,
        client: client,
      }),
      { compiled: !0, submitted: !0, students: students.length, subjects: subjects.length }
    );
  });
}
module.exports = {
  COMPONENTS: COMPONENTS,
  componentsApproved: componentsApproved,
  dashboardSummary: dashboardSummary,
  bootstrap: bootstrap,
  scoreSheet: scoreSheet,
  save: save,
  submitComponent: submitComponent,
  managementQueue: managementQueue,
  reviewComponent: reviewComponent,
  parentProgress: parentProgress,
  compile: compile,
  ranks: ranks,
};

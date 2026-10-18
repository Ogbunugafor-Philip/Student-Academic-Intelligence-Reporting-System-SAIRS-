"use strict";
const express = require("express"),
  asyncHandler = require("../utilities/async-handler"),
  {
    authenticate: authenticate,
    requireRoles: requireRoles,
    requirePasswordChanged: requirePasswordChanged,
    csrf: csrf,
  } = require("../middleware/auth"),
  validate = require("../middleware/validate"),
  schemas = require("../validators/schemas"),
  c = require("../controllers/api-controller"),
  { pool: pool } = require("../db/pool"),
  { errors: errors } = require("../utilities/errors"),
  imports = require("../services/import-service"),
  importJobs = require("../services/student-import-job-service"),
  teacherImports = require("../services/teacher-import-service"),
  adminService = require("../services/admin-service"),
  academicSetup = require("../services/academic-setup-service"),
  continuity = require("../services/session-continuity-service"),
  historicalReview = require("../services/historical-review-service"),
  auditService = require("../services/audit-service"),
  setupImports = require("../services/academic-setup-import-service"),
  authz = require("../services/authorization-service"),
  teacherWorkspace = require("../services/teacher-workspace-service"),
  managementPortal = require("../services/management-portal-service"),
  router = express.Router();
router.use(authenticate, csrf, requirePasswordChanged);
const admin = requireRoles("IT_ADMIN"),
  academic = requireRoles("IT_ADMIN", "MANAGEMENT", "TEACHER"),
  teacherWrite = requireRoles("IT_ADMIN", "TEACHER"),
  management = requireRoles("IT_ADMIN", "MANAGEMENT");
(router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const current = (
      await pool.query(
        "SELECT (SELECT name FROM academic_sessions WHERE school_id=$1 AND is_current=true AND status='ACTIVE' LIMIT 1) current_session,(SELECT name FROM terms WHERE school_id=$1 AND is_current=true AND status='ACTIVE' LIMIT 1) current_term",
        [req.identity.schoolId],
      )
    ).rows[0];
    let counts = {},
      setup = {},
      teacher = null;
    (["IT_ADMIN", "MANAGEMENT"].includes(req.identity.role) &&
      ((counts = (
        await pool.query(
          "SELECT (SELECT count(*) FROM students WHERE school_id=$1 AND status='ACTIVE') students,(SELECT count(*) FROM teachers WHERE school_id=$1 AND status='ACTIVE') teachers,(SELECT count(*) FROM users WHERE school_id=$1 AND role='MANAGEMENT' AND status='ACTIVE') management,(SELECT count(*) FROM parents WHERE school_id=$1 AND status='ACTIVE') parents,(SELECT count(*) FROM report_cards WHERE school_id=$1 AND status='PUBLISHED') published_reports,(SELECT count(*) FROM result_batches WHERE school_id=$1 AND routed_management_user_id IS NOT NULL AND status IN('SUBMITTED','REVIEWED','APPROVED')) pending_reviews",
          [req.identity.schoolId],
        )
      ).rows[0]),
      (setup = (
        await pool.query(
          "SELECT (SELECT count(*) FROM classes WHERE school_id=$1 AND status='ACTIVE') classes,(SELECT count(*) FROM class_arms WHERE school_id=$1 AND status='ACTIVE') class_arms,(SELECT count(*) FROM subjects WHERE school_id=$1 AND status='ACTIVE') subjects,(SELECT count(*) FROM assessment_structures WHERE school_id=$1 AND status='ACTIVE') assessment_structures",
          [req.identity.schoolId],
        )
      ).rows[0])),
      "TEACHER" === req.identity.role &&
        (teacher = await teacherWorkspace.dashboardSummary(req.identity)),
      "PARENT" === req.identity.role &&
        (counts = (
          await pool.query(
            `SELECT
              (SELECT count(DISTINCT l.student_id) FROM parents p JOIN parent_student_links l ON l.parent_id=p.id AND l.school_id=p.school_id AND l.status='ACTIVE' JOIN students s ON s.id=l.student_id AND s.school_id=l.school_id WHERE p.school_id=$1 AND p.user_id=$2 AND p.status='ACTIVE') children,
              (SELECT count(*) FROM report_cards rc WHERE rc.school_id=$1 AND rc.status='PUBLISHED' AND EXISTS(SELECT 1 FROM parents p JOIN parent_student_links l ON l.parent_id=p.id AND l.school_id=p.school_id AND l.student_id=rc.student_id AND l.status='ACTIVE' WHERE p.school_id=$1 AND p.user_id=$2 AND p.status='ACTIVE')) published_reports,
              (SELECT count(DISTINCT (sc.student_id,acs.assessment_id)) FROM assessment_component_submissions acs JOIN assessments a ON a.id=acs.assessment_id AND a.school_id=acs.school_id JOIN scores sc ON sc.school_id=acs.school_id AND sc.assessment_id=acs.assessment_id JOIN parents p ON p.school_id=sc.school_id AND p.user_id=$2 AND p.status='ACTIVE' JOIN parent_student_links l ON l.school_id=p.school_id AND l.parent_id=p.id AND l.student_id=sc.student_id AND l.status='ACTIVE' WHERE acs.school_id=$1 AND acs.status='APPROVED') approved_assessments`,
            [req.identity.schoolId, req.identity.id],
          )
        ).rows[0]),
      c.ok(res, {
        config: {
          schoolName: req.identity.schoolName,
          currentSession: current.current_session,
          currentTerm: current.current_term,
        },
        user: { role: req.identity.role },
        counts: counts,
        setup: setup,
        teacher: teacher,
      }));
  }),
),
  router.get(
    "/students/bootstrap",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.students.bootstrap(req.identity)),
    ),
  ),
  router.post(
    "/students/list",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.students.search(req.identity, req.body)),
    ),
  ),
  router.post(
    "/students/history",
    requireRoles("IT_ADMIN", "MANAGEMENT", "PARENT"),
    asyncHandler(async (req, res) =>
      c.ok(res, await c.students.history(req.identity, req.body.studentId)),
    ),
  ),
  router.post(
    "/administration/historical-enrolments",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await historicalReview.list(req.identity, req.body)),
    ),
  ),
  router.post(
    "/administration/historical-enrolments/decision",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await historicalReview.decide(req.identity, req.body, req)),
    ),
  ),
  router.post(
    "/students/create",
    admin,
    validate(schemas.studentGuardian),
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await c.students.createWithGuardian(req.identity, req.validated, req),
      ),
    ),
  ),
  router.post(
    "/students/update",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await c.entities.update(
          req.identity,
          "students",
          req.body.studentId,
          req.body,
          req,
        ),
      ),
    ),
  ),
  router.post(
    "/students/status",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.students.changeStatus(req.identity, req.body, req)),
    ),
  ),
  router.post(
    "/students/promote",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await continuity.promoteOne(req.identity, req.body, req)),
    ),
  ),
  router.post(
    "/students/academic-context",
    admin,
    validate(schemas.academicContext),
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await c.students.setAcademicContext(req.identity, req.validated, req),
      ),
    ),
  ),
  router.get(
    "/students/import/template",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await imports.studentTemplate()),
    ),
  ),
  router.post(
    "/students/import/preview",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await imports.studentImportPreview(req.identity, req.body.file),
      ),
    ),
  ),
  router.post(
    "/students/import",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await importJobs.create(req.identity, req.body.file, req)),
    ),
  ),
  router.get(
    "/students/import/jobs",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await importJobs.list(req.identity)),
    ),
  ),
  router.post(
    "/students/import/jobs/status",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await importJobs.get(req.identity, req.body.jobId)),
    ),
  ),
  router.post(
    "/students/import/jobs/credentials",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await importJobs.credentials(req.identity, req.body.jobId, req),
      ),
    ),
  ),
  router.get(
    "/students/export",
    admin,
    asyncHandler(async (req, res) => {
      const csv = [
        "AdmissionNumber,FirstName,MiddleName,LastName,Status",
        ...(
          await c.entities.list(req.identity, "students", { limit: 500 })
        ).map((x) =>
          [
            x.admission_number,
            x.first_name,
            x.middle_name,
            x.last_name,
            x.status,
          ]
            .map((v) => `"${String(v || "").replaceAll('"', '""')}"`)
            .join(","),
        ),
      ].join("\n");
      res.type("text/csv").attachment("students.csv").send(csv);
    }),
  ),
  router.post(
    "/parents/create",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await c.entities.create(req.identity, "parents", req.body, req),
      ),
    ),
  ),
  router.post(
    "/parents/update",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await c.entities.update(
          req.identity,
          "parents",
          req.body.parentId,
          req.body,
          req,
        ),
      ),
    ),
  ),
  router.post(
    "/parents/link",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.students.linkParent(req.identity, req.body, req)),
    ),
  ),
  router.get(
    "/teachers/bootstrap",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.teachers.bootstrap(req.identity)),
    ),
  ),
  router.post(
    "/teachers/list",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.teachers.search(req.identity, req.body)),
    ),
  ),
  router.post(
    "/teachers/details",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.teachers.details(req.identity, req.body.teacherId)),
    ),
  ),
  router.post(
    "/teachers/create",
    admin,
    validate(schemas.teacherOnboarding),
    asyncHandler(async (req, res) =>
      c.ok(res, await c.teachers.create(req.identity, req.validated, req)),
    ),
  ),
  router.post(
    "/teachers/update",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.teachers.update(req.identity, req.body, req)),
    ),
  ),
  router.post(
    "/teachers/status",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await c.entities.update(
          req.identity,
          "teachers",
          req.body.teacherId,
          { status: req.body.status },
          req,
        ),
      ),
    ),
  ),
  router.post(
    "/teachers/assign",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.teachers.assignment(req.identity, req.body, req)),
    ),
  ),
  router.post(
    "/teachers/assignment-status",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.teachers.assignmentStatus(req.identity, req.body, req)),
    ),
  ),
  router.get(
    "/teachers/import/template",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await teacherImports.template()),
    ),
  ),
  router.post(
    "/teachers/import/preview",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await teacherImports.preview(req.identity, req.body.file)),
    ),
  ),
  router.post(
    "/teachers/import",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await teacherImports.importTeachers(req.identity, req.body.file, req),
      ),
    ),
  ),
  router.get(
    "/assessments/bootstrap",
    academic,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.assessments.list(req.identity)),
    ),
  ),
  router.post(
    "/assessments/create",
    teacherWrite,
    asyncHandler(async (req, res) => {
      const d = req.body;
      if (
        !(
          await pool.query(
            "SELECT 1 FROM terms WHERE school_id=$1 AND id=$2 AND academic_session_id=$3",
            [req.identity.schoolId, d.termId, d.sessionId],
          )
        ).rows[0]
      )
        throw errors.validation(
          "The selected term does not belong to the selected academic session.",
        );
      await authz.assertTeacherAssessment(req.identity, {
        academic_session_id: d.sessionId,
        class_id: d.classId,
        class_arm_id: d.classArmId || null,
        subject_id: d.subjectId,
      });
      const row = (
        await pool.query(
          "INSERT INTO assessments(school_id,structure_id,academic_session_id,term_id,class_id,class_arm_id,subject_id,teacher_id,name,maximum_score,weight,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
          [
            req.identity.schoolId,
            d.structureId,
            d.sessionId,
            d.termId,
            d.classId,
            d.classArmId || null,
            d.subjectId,
            d.teacherId || null,
            d.assessmentName,
            d.maximumScore,
            d.weight,
            String(d.status || "DRAFT").toUpperCase(),
          ],
        )
      ).rows[0];
      c.ok(res, row);
    }),
  ),
  router.post(
    "/assessments/update",
    teacherWrite,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.assessments.update(req.identity, req.body, req)),
    ),
  ),
  router.post(
    "/assessments/scores",
    academic,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await c.assessments.scoreSheet(req.identity, req.body.assessmentId),
      ),
    ),
  ),
  router.post(
    "/assessments/history",
    academic,
    asyncHandler(async (req, res) => {
      ("TEACHER" === req.identity.role &&
        (await authz.assertTeacherScore(req.identity, req.body.scoreId)),
        c.ok(
          res,
          (
            await pool.query(
              "SELECT * FROM score_history WHERE school_id=$1 AND score_id=$2 ORDER BY changed_at",
              [req.identity.schoolId, req.body.scoreId],
            )
          ).rows,
        ));
    }),
  ),
  router.post(
    "/assessments/import",
    teacherWrite,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await imports.scoreImport(
          req.identity,
          req.body.file,
          req.body.assessmentId,
          req,
        ),
      ),
    ),
  ),
  router.post(
    "/sync/push",
    asyncHandler(async (req, res) =>
      c.ok(res, await c.sync.push(req.identity, req.body.operations, req)),
    ),
  ),
  router.get(
    "/sync/snapshot",
    asyncHandler(async (req, res) =>
      c.ok(res, await c.sync.snapshot(req.identity)),
    ),
  ),
  router.get(
    "/results/bootstrap",
    asyncHandler(async (req, res) =>
      c.ok(res, await c.results.list(req.identity)),
    ),
  ),
  router.get(
    "/results/management-options",
    academic,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.results.activeManagers(req.identity)),
    ),
  ),
  router.post(
    "/results/calculate",
    teacherWrite,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.results.calculate(req.identity, req.body, req)),
    ),
  ));
for (const action of ["submit", "review", "approve", "publish"])
  router.post(
    `/results/${action}`,
    academic,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await c.results.transition(
          req.identity,
          req.body.batchId,
          action.toUpperCase() +
            ("submit" === action
              ? "TED"
              : "review" === action
                ? "ED"
                : "approve" === action
                  ? "D"
                  : "ED"),
          req.body.comment,
          req.body.managementUserId,
          req,
        ),
      ),
    ),
  );
(router.post(
  "/results/details",
  academic,
  asyncHandler(async (req, res) => {
    const batch = (
      await pool.query(
        "SELECT * FROM result_batches WHERE school_id=$1 AND id=$2",
        [req.identity.schoolId, req.body.batchId],
      )
    ).rows[0];
    if (!batch) throw errors.notFound();
    await authz.assertTeacherBatch(req.identity, batch);
    const history = (
      await pool.query(
        "SELECT * FROM result_workflow_history WHERE school_id=$1 AND batch_id=$2 ORDER BY action_at",
        [req.identity.schoolId, batch.id],
      )
    ).rows;
    c.ok(res, { batch: batch, history: history });
  }),
),
  router.post(
    "/performance/student",
    asyncHandler(async (req, res) => {
      const result = await c.performance.student(req.identity, req.body.studentId);
      const effectiveReports = new Map();
      for (const report of result.reports || []) {
        const key = `${report.student_id || req.body.studentId}:${report.academic_session_id}:${report.term_id}`,
          prior = effectiveReports.get(key);
        if (!prior || Number(report.report_version || 0) > Number(prior.report_version || 0) || (Number(report.report_version || 0) === Number(prior.report_version || 0) && String(report.published_at || "") > String(prior.published_at || "")))
          effectiveReports.set(key, report);
      }
      result.reports = [...effectiveReports.values()];
      if (req.identity.role === "PARENT")
        await auditService.audit({schoolId:req.identity.schoolId,userId:req.identity.id,action:"CHILD_PERFORMANCE_VIEWED",entityType:"Student",entityId:req.body.studentId,entityReference:result.profile?.admission_number,newValue:{studentId:req.body.studentId,studentName:[result.profile?.first_name,result.profile?.middle_name,result.profile?.last_name].filter(Boolean).join(" ")},req});
      c.ok(res, result);
    }),
  ),
  router.post(
    "/performance/timeline",
    asyncHandler(async (req, res) => {
      const d = await c.performance.student(req.identity, req.body.studentId);
      c.ok(
        res,
        [
          ...d.results.map((x) => ({
            type: `RESULT_${x.status}`,
            date: x.updated_at,
            detail: `${x.percentage}%`,
          })),
          ...d.warnings.map((x) => ({
            type: `WARNING_${x.warning_type}`,
            date: x.generated_at,
            detail: x.description,
          })),
          ...d.recommendations.map((x) => ({
            type: "RECOMMENDATION",
            date: x.created_at,
            detail: x.recommendation_text,
          })),
        ].sort((a, b) => new Date(a.date) - new Date(b.date)),
      );
    }),
  ),
  router.get(
    "/performance/overview",
    requireRoles("IT_ADMIN", "MANAGEMENT", "TEACHER"),
    asyncHandler(async (req, res) =>
      c.ok(res, await c.performance.overview(req.identity)),
    ),
  ),
  router.get(
    "/performance/students",
    asyncHandler(async (req, res) =>
      c.ok(res, await c.performance.students(req.identity)),
    ),
  ),
  router.post(
    "/performance/students",
    asyncHandler(async (req, res) =>
      c.ok(res, await c.performance.students(req.identity, req.body)),
    ),
  ),
  router.get(
    "/reports",
    asyncHandler(async (req, res) =>
      c.ok(res, await c.reports.list(req.identity)),
    ),
  ),
  router.post(
    "/reports/generate",
    management,
    asyncHandler(async (req, res) =>
      c.ok(res, await c.reports.generate(req.identity, req.body, req)),
    ),
  ),
  router.post(
    "/reports/publish",
    management,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await c.reports.publish(req.identity, req.body.reportCardId, req),
      ),
    ),
  ),
  router.post(
    "/reports/email",
    management,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await c.reports.email(req.identity, req.body.reportCardId, req),
      ),
    ),
  ),
  router.post(
    "/reports/download",
    asyncHandler(async (req, res) => {
      const { row: row, buffer: buffer } = await c.reports.download(
        req.identity,
        req.body.reportCardId,
        req,
      );
      c.ok(res, {
        reportCardId: row.id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        base64: buffer.toString("base64"),
      });
    }),
  ),
  router.get(
    "/reports/catalog",
    asyncHandler(async (req, res) =>
      c.ok(res, await c.reports.catalog(req.identity)),
    ),
  ),
  router.post(
    "/reports/view",
    asyncHandler(async (req, res) =>
      c.ok(res, await c.reports.view(req.identity, req.body, req)),
    ),
  ),
  router.get(
    "/portals/bootstrap",
    asyncHandler(async (req, res) => {
      const assignments =
          "TEACHER" === req.identity.role
            ? await c.teachers.ownResponsibilities(req.identity)
            : [],
        children =
          "PARENT" === req.identity.role
            ? await c.students.parentChildren(req.identity)
            : [],
        parent =
          "PARENT" === req.identity.role
            ? (
                await pool.query(
                  "SELECT first_name,middle_name,last_name FROM parents WHERE school_id=$1 AND user_id=$2 AND status='ACTIVE' LIMIT 1",
                  [req.identity.schoolId, req.identity.id],
                )
              ).rows[0]
            : null,
        current =
          "PARENT" === req.identity.role
            ? (
                await pool.query(
                  "SELECT (SELECT name FROM academic_sessions WHERE school_id=$1 AND is_current=true AND status='ACTIVE' LIMIT 1) session_name,(SELECT name FROM terms WHERE school_id=$1 AND is_current=true AND status='ACTIVE' LIMIT 1) term_name",
                  [req.identity.schoolId],
                )
              ).rows[0]
            : null;
      c.ok(res, {
        role: req.identity.role,
        children: children,
        assignments: assignments,
        parent: parent,
        current: current,
      });
    }),
  ),
  router.get(
    "/teacher-workspace/bootstrap",
    requireRoles("TEACHER"),
    asyncHandler(async (req, res) =>
      c.ok(res, await teacherWorkspace.bootstrap(req.identity, req.query)),
    ),
  ),
  router.post(
    "/teacher-workspace/scores",
    requireRoles("TEACHER"),
    asyncHandler(async (req, res) =>
      c.ok(res, await teacherWorkspace.scoreSheet(req.identity, req.body)),
    ),
  ),
  router.post(
    "/teacher-workspace/save",
    requireRoles("TEACHER"),
    asyncHandler(async (req, res) =>
      c.ok(res, await teacherWorkspace.save(req.identity, req.body, !1, req)),
    ),
  ),
  router.post(
    "/teacher-workspace/submit",
    requireRoles("TEACHER"),
    asyncHandler(async (req, res) =>
      c.ok(res, await teacherWorkspace.save(req.identity, req.body, !0, req)),
    ),
  ),
  router.post(
    "/teacher-workspace/submit-component",
    requireRoles("TEACHER"),
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await teacherWorkspace.submitComponent(req.identity, req.body, req),
      ),
    ),
  ),
  router.post(
    "/teacher-workspace/compile",
    requireRoles("TEACHER"),
    asyncHandler(async (req, res) =>
      c.ok(res, await teacherWorkspace.compile(req.identity, req.body, req)),
    ),
  ),
  router.get(
    "/management/bootstrap",
    admin,
    asyncHandler(async (req, res) => c.ok(res, [])),
  ),
  router.get("/management/dashboard",requireRoles("MANAGEMENT"),asyncHandler(async(req,res)=>c.ok(res,await managementPortal.dashboard(req.identity)))),
  router.post("/management/compiled-results",requireRoles("MANAGEMENT"),asyncHandler(async(req,res)=>c.ok(res,await managementPortal.compiledList(req.identity,req.body)))),
  router.post("/management/compiled-results/detail",requireRoles("MANAGEMENT"),asyncHandler(async(req,res)=>c.ok(res,await managementPortal.compiledDetail(req.identity,req.body.submissionId)))),
  router.post("/management/compiled-results/decision",requireRoles("MANAGEMENT"),asyncHandler(async(req,res)=>c.ok(res,await managementPortal.decision(req.identity,req.body,req)))),
  router.post("/management/compiled-results/publish",requireRoles("MANAGEMENT"),asyncHandler(async(req,res)=>c.ok(res,await managementPortal.publish(req.identity,req.body,req)))),
  router.post("/management/compiled-results/approve",requireRoles("MANAGEMENT"),asyncHandler(async(req,res)=>c.ok(res,await managementPortal.approveAndPublish(req.identity,req.body,req)))),
  router.get(
    "/management/component-reviews",
    requireRoles("MANAGEMENT"),
    asyncHandler(async (req, res) =>
      c.ok(res, await teacherWorkspace.managementQueue(req.identity)),
    ),
  ),
  router.post(
    "/management/component-reviews",
    requireRoles("MANAGEMENT"),
    asyncHandler(async (req, res) => c.ok(res, await teacherWorkspace.managementQueue(req.identity, req.body))),
  ),
  router.post(
    "/management/component-reviews/decision",
    requireRoles("MANAGEMENT"),
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await teacherWorkspace.reviewComponent(req.identity, req.body, req),
      ),
    ),
  ),
  router.get(
    "/parent/current-progress",
    requireRoles("PARENT"),
    asyncHandler(async (req, res) => {
      const progress = await teacherWorkspace.parentProgress(req.identity);
      await auditService.audit({schoolId:req.identity.schoolId,userId:req.identity.id,action:"APPROVED_ASSESSMENT_VIEWED",entityType:"ApprovedAssessment",newValue:{approvedComponentCount:progress.length},req});
      c.ok(res, progress);
    }),
  ),
  router.post(
    "/management/list",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await adminService.searchManagement(req.identity, req.body)),
    ),
  ),
  router.post(
    "/management/details",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await adminService.managementDetails(req.identity, req.body.userId),
      ),
    ),
  ),
  router.post(
    "/management/save",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await adminService.saveManagement(
          req.identity,
          req.body,
          req.body.userId,
          req,
        ),
      ),
    ),
  ),
  router.post(
    "/management/status",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await adminService.managementStatus(
          req.identity,
          req.body.userId,
          req.body.status,
          req,
        ),
      ),
    ),
  ),
  router.post(
    "/management/reset-password",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await adminService.resetManagement(req.identity, req.body.userId, req),
      ),
    ),
  ),
  router.get(
    "/academic-periods",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, {
        sessions: (
          await pool.query(
            "SELECT * FROM academic_sessions WHERE school_id=$1 ORDER BY start_date DESC,name DESC",
            [req.identity.schoolId],
          )
        ).rows,
        terms: (
          await pool.query(
            "SELECT * FROM terms WHERE school_id=$1 ORDER BY start_date,name",
            [req.identity.schoolId],
          )
        ).rows,
      }),
    ),
  ),
  router.post(
    "/academic-periods/save",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await academicSetup.mutate(
          req.identity,
          req.body.operation,
          req.body.entity,
          req.body.data || {},
          req,
        ),
      ),
    ),
  ),
  router.get(
    "/administration/bootstrap",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await academicSetup.bootstrap(req.identity)),
    ),
  ),
  router.post(
    "/administration/mutate",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await academicSetup.mutate(
          req.identity,
          req.body.operation,
          req.body.entity,
          req.body.data || {},
          req,
        ),
      ),
    ),
  ),
  router.post(
    "/administration/session-rollover/preview",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await continuity.preview(req.identity, req.body)),
    ),
  ),
  router.post(
    "/administration/session-rollover/create",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await continuity.create(req.identity, req.body, req)),
    ),
  ),
  router.post(
    "/administration/session-rollover/reconcile",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await continuity.reconcile(req.identity, req.body, req)),
    ),
  ),
  router.post(
    "/administration/promotions/roster",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await continuity.promotionRoster(req.identity, req.body)),
    ),
  ),
  router.post(
    "/administration/promotions/apply",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await continuity.promote(req.identity, req.body, req)),
    ),
  ),
  router.post(
    "/administration/curriculum",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await academicSetup.curriculum(req.identity, req.body, req)),
    ),
  ),
  router.post(
    "/administration/curriculum-status",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await academicSetup.curriculumStatus(
          req.identity,
          req.body.id,
          req.body.status,
          req,
        ),
      ),
    ),
  ),
  router.get(
    "/administration/import/template",
    admin,
    asyncHandler(async (req, res) => c.ok(res, await setupImports.template())),
  ),
  router.post(
    "/administration/import/preview",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await setupImports.preview(req.identity, req.body.file)),
    ),
  ),
  router.post(
    "/administration/import",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await setupImports.confirm(req.identity, req.body.file, req)),
    ),
  ),
  router.post(
    "/administration/reset-password",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await adminService.resetPassword(req.identity, req.body.userId, req),
      ),
    ),
  ),
  router.post(
    "/administration/status",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(
        res,
        await adminService.status(
          req.identity,
          req.body.entity,
          req.body.id,
          req.body.status,
          req,
        ),
      ),
    ),
  ),
  router.post(
    "/administration/audits",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await auditService.search(req.identity, req.body)),
    ),
  ),
  router.post(
    "/administration/audits/detail",
    admin,
    asyncHandler(async (req, res) =>
      c.ok(res, await auditService.detail(req.identity, req.body.auditId)),
    ),
  ),
  router.post(
    "/teacher/audits",
    requireRoles("TEACHER"),
    asyncHandler(async (req, res) =>
      c.ok(res, await auditService.searchOwn(req.identity, req.body)),
    ),
  ),
  router.post(
    "/teacher/audits/detail",
    requireRoles("TEACHER"),
    asyncHandler(async (req, res) =>
      c.ok(res, await auditService.detailOwn(req.identity, req.body.auditId)),
    ),
  ),
  router.post("/parent/audits",requireRoles("PARENT"),asyncHandler(async(req,res)=>c.ok(res,await auditService.searchOwn(req.identity,req.body)))),
  router.post("/parent/audits/detail",requireRoles("PARENT"),asyncHandler(async(req,res)=>c.ok(res,await auditService.detailOwn(req.identity,req.body.auditId)))),
  router.post("/management/audits",requireRoles("MANAGEMENT"),asyncHandler(async(req,res)=>c.ok(res,await auditService.searchOwn(req.identity,req.body)))),
  router.post("/management/audits/detail",requireRoles("MANAGEMENT"),asyncHandler(async(req,res)=>c.ok(res,await auditService.detailOwn(req.identity,req.body.auditId)))),
  (module.exports = router));

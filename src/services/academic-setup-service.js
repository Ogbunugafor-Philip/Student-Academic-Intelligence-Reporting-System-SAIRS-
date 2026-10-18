"use strict";
const { pool, transaction } = require("../db/pool");
const repo = require("../repositories/entity-repository");
const entities = require("./entity-service");
const admin = require("./admin-service");
const { audit } = require("./audit-service");
const { errors } = require("../utilities/errors");
const clean = (value) => String(value ?? "").trim();
const active = (value) => String(value || "ACTIVE").toUpperCase();
async function bootstrap(identity) {
  const schoolId = identity.schoolId;
  const [
    profile,
    users,
    sessions,
    terms,
    classes,
    arms,
    subjects,
    mappings,
    structures,
    rules,
  ] = await Promise.all([
    pool
      .query(
        `SELECT id,name,address,email,phone,motto,principal_name,logo_path,status FROM schools WHERE id=$1`,
        [schoolId],
      )
      .then((x) => x.rows[0]),
    pool
      .query(
        `SELECT id,email,role,status,created_at,updated_at FROM users WHERE school_id=$1 ORDER BY email`,
        [schoolId],
      )
      .then((x) => x.rows),
    repo.list("academicSessions", schoolId, { limit: 500 }),
    repo.list("terms", schoolId, { limit: 500 }),
    repo.list("classes", schoolId, { limit: 500 }),
    repo.list("classArms", schoolId, { limit: 500 }),
    repo.list("subjects", schoolId, { limit: 500 }),
    pool
      .query(
        `SELECT cs.*,c.name class_name,s.code subject_code,s.name subject_name FROM class_subjects cs JOIN classes c ON c.id=cs.class_id AND c.school_id=cs.school_id JOIN subjects s ON s.id=cs.subject_id AND s.school_id=cs.school_id WHERE cs.school_id=$1 ORDER BY c.sort_order,c.name,s.name`,
        [schoolId],
      )
      .then((x) => x.rows),
    repo.list("assessmentStructures", schoolId, { limit: 500 }),
    repo.list("gradingRules", schoolId, { limit: 500 }),
  ]);
  const currentSession =
      sessions.find((x) => x.is_current && x.status === "ACTIVE") || null,
    currentTerm =
      terms.find((x) => x.is_current && x.status === "ACTIVE") || null;
  const checks = [
    ["School profile", Boolean(profile?.name)],
    ["Current academic session", Boolean(currentSession)],
    [
      "Current term",
      Boolean(
        currentTerm && currentTerm.academic_session_id === currentSession?.id,
      ),
    ],
    [
      "Classes and arms",
      classes.some((x) => x.status === "ACTIVE") &&
        arms.some((x) => x.status === "ACTIVE"),
    ],
    ["Subjects", subjects.some((x) => x.status === "ACTIVE")],
    ["Curriculum mapping", mappings.some((x) => x.status === "ACTIVE")],
    ["Grading rules", rules.some((x) => x.status === "ACTIVE")],
  ];
  return {
    profile,
    users,
    academicSessions: sessions,
    terms,
    classes,
    classArms: arms,
    subjects,
    classSubjects: mappings,
    assessmentStructures: structures,
    gradingRules: rules,
    currentSession,
    currentTerm,
    setup: {
      complete: checks.filter((x) => x[1]).length,
      total: checks.length,
      checks: checks.map(([name, complete]) => ({ name, complete })),
    },
    counts: {
      academicSessions: sessions.length,
      classes: classes.length,
      arms: arms.length,
      subjects: subjects.length,
      classSubjectMappings: mappings.length,
      systemUsers: users.length,
    },
  };
}
async function school(identity, data, req) {
  if (!clean(data.schoolName))
    throw errors.validation("School name is required.");
  return transaction(async (client) => {
    const old = (
      await client.query(`SELECT * FROM schools WHERE id=$1 FOR UPDATE`, [
        identity.schoolId,
      ])
    ).rows[0];
    const row = (
      await client.query(
        `UPDATE schools SET name=$1,address=$2,email=$3,phone=$4,motto=$5,principal_name=$6,updated_at=now() WHERE id=$7 RETURNING *`,
        [
          clean(data.schoolName),
          clean(data.schoolAddress) || null,
          clean(data.schoolEmail) || null,
          clean(data.schoolPhone) || null,
          clean(data.schoolMotto) || null,
          clean(data.principalName) || null,
          identity.schoolId,
        ],
      )
    ).rows[0];
    await audit({
      schoolId: identity.schoolId,
      userId: identity.id,
      action: "SCHOOL_PROFILE_UPDATED",
      entityType: "School",
      entityId: row.id,
      oldValue: old,
      newValue: row,
      req,
      client,
    });
    return row;
  });
}
async function setCurrent(identity, type, id, req) {
  if (!["session", "term"].includes(type))
    throw errors.validation("Only a session or term can be made current.");
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${identity.schoolId}:academic-period`,
    ]);
    const table = type === "session" ? "academic_sessions" : "terms";
    const previous =
      type === "session"
        ? (
            await client.query(
              `SELECT * FROM academic_sessions WHERE school_id=$1 AND is_current=true AND status='ACTIVE' FOR UPDATE`,
              [identity.schoolId],
            )
          ).rows[0]
        : null;
    const row = (
      await client.query(
        `SELECT * FROM ${table} WHERE school_id=$1 AND id=$2 AND status='ACTIVE' FOR UPDATE`,
        [identity.schoolId, id],
      )
    ).rows[0];
    if (!row) throw errors.notFound(`Active ${type} not found.`);
    if (type === "term") {
      const session = (
        await client.query(
          `SELECT id FROM academic_sessions WHERE school_id=$1 AND id=$2 AND is_current=true AND status='ACTIVE'`,
          [identity.schoolId, row.academic_session_id],
        )
      ).rows[0];
      if (!session)
        throw errors.validation(
          "The current term must belong to the current active academic session.",
        );
    }
    await client.query(
      `UPDATE ${table} SET is_current=false,updated_at=now() WHERE school_id=$1`,
      [identity.schoolId],
    );
    const current = (
      await client.query(
        `UPDATE ${table} SET is_current=true,updated_at=now() WHERE school_id=$1 AND id=$2 RETURNING *`,
        [identity.schoolId, id],
      )
    ).rows[0];
    await audit({
      schoolId: identity.schoolId,
      userId: identity.id,
      action: `CURRENT_${type.toUpperCase()}_CHANGED`,
      entityType: type,
      entityId: id,
      newValue: current,
      req,
      client,
    });
    return current;
  });
}
async function saveTerm(identity, data, id, req) {
  return transaction(async (client) => {
    let sessionId = data.sessionId;
    if (!sessionId)
      sessionId = (
        await client.query(
          `SELECT id FROM academic_sessions WHERE school_id=$1 AND is_current=true AND status='ACTIVE'`,
          [identity.schoolId],
        )
      ).rows[0]?.id;
    if (!sessionId)
      throw errors.validation(
        "Configure a current academic session before adding a term.",
      );
    if (
      !(
        await client.query(
          `SELECT 1 FROM academic_sessions WHERE school_id=$1 AND id=$2`,
          [identity.schoolId, sessionId],
        )
      ).rows[0]
    )
      throw errors.validation("Select a session belonging to this school.");
    const normalized = entities.normalize("terms", { ...data, sessionId });
    let old = null,
      row;
    if (id) {
      old = await repo.get("terms", identity.schoolId, id, client, true);
      row = await repo.update(
        "terms",
        identity.schoolId,
        id,
        normalized,
        client,
      );
    } else
      row = await repo.create("terms", identity.schoolId, normalized, client);
    await audit({
      schoolId: identity.schoolId,
      userId: identity.id,
      action: id ? "TERMS_UPDATED" : "TERMS_CREATED",
      entityType: "terms",
      entityId: row.id,
      oldValue: old,
      newValue: row,
      req,
      client,
    });
    return row;
  });
}
async function curriculum(identity, data, req) {
  return transaction(async (client) => {
    const [classRow, subject] = await Promise.all([
      client.query(
        `SELECT id FROM classes WHERE school_id=$1 AND id=$2 AND status='ACTIVE'`,
        [identity.schoolId, data.classId],
      ),
      client.query(
        `SELECT id FROM subjects WHERE school_id=$1 AND id=$2 AND status='ACTIVE'`,
        [identity.schoolId, data.subjectId],
      ),
    ]);
    if (!classRow.rows[0] || !subject.rows[0])
      throw errors.validation(
        "Select an active class and subject belonging to this school.",
      );
    const row = (
      await client.query(
        `INSERT INTO class_subjects(school_id,class_id,subject_id,status) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(school_id,class_id,subject_id) DO UPDATE SET status='ACTIVE',updated_at=now() RETURNING *`,
        [identity.schoolId, data.classId, data.subjectId],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO session_class_subjects(school_id,academic_session_id,class_id,subject_id,status)
       SELECT $1,id,$2,$3,'ACTIVE' FROM academic_sessions WHERE school_id=$1 AND is_current=true AND status='ACTIVE'
       ON CONFLICT(school_id,academic_session_id,class_id,subject_id) DO UPDATE SET status='ACTIVE',updated_at=now()`,
      [identity.schoolId, data.classId, data.subjectId],
    );
    await audit({
      schoolId: identity.schoolId,
      userId: identity.id,
      action: "CURRICULUM_MAPPING_SAVED",
      entityType: "ClassSubject",
      entityId: row.id,
      newValue: row,
      req,
      client,
    });
    return row;
  });
}
async function curriculumStatus(identity, id, status, req) {
  return transaction(async (client) => {
    const row = (
      await client.query(
        `UPDATE class_subjects SET status=$1,updated_at=now() WHERE school_id=$2 AND id=$3 RETURNING *`,
        [active(status), identity.schoolId, id],
      )
    ).rows[0];
    if (!row) throw errors.notFound();
    await audit({
      schoolId: identity.schoolId,
      userId: identity.id,
      action: "CURRICULUM_MAPPING_STATUS_CHANGED",
      entityType: "ClassSubject",
      entityId: id,
      newValue: { status: row.status },
      req,
      client,
    });
    return row;
  });
}
async function validateAssessment(identity, data, id) {
  const maximum = Number(data.maximumScore),
    weight = Number(data.weight);
  if (!(maximum > 0) || weight < 0 || weight > 100)
    throw errors.validation(
      "Maximum score must be positive and weight must be between 0 and 100.",
    );
  const params = [identity.schoolId],
    where = [`school_id=$1`, `status='ACTIVE'`];
  if (id) {
    params.push(id);
    where.push(`id<>$2`);
  }
  const total =
    Number(
      (
        await pool.query(
          `SELECT COALESCE(sum(weight),0) total FROM assessment_structures WHERE ${where.join(" AND ")}`,
          params,
        )
      ).rows[0].total,
    ) + weight;
  if (active(data.status) === "ACTIVE" && total > 100)
    throw errors.validation(
      `Active assessment weights cannot exceed 100. The proposed total is ${total}.`,
    );
  return total;
}
async function validateGrade(identity, data, id) {
  const min = Number(data.minimumScore),
    max = Number(data.maximumScore);
  if (min < 0 || max > 100 || min > max)
    throw errors.validation(
      "Grade ranges must be between 0 and 100, with minimum not greater than maximum.",
    );
  if (active(data.status) !== "ACTIVE") return;
  const params = [identity.schoolId, min, max],
    extra = id ? (params.push(id), ` AND id<>$4`) : "";
  if (
    (
      await pool.query(
        `SELECT grade FROM grading_rules WHERE school_id=$1 AND status='ACTIVE' AND minimum_score<=$3 AND maximum_score>=$2${extra} LIMIT 1`,
        params,
      )
    ).rows[0]
  )
    throw errors.validation(
      "This grading range overlaps an existing active rule.",
    );
}
function validateGradingScheme(rules) {
  if (!Array.isArray(rules) || !rules.length)
    throw errors.validation("At least one grading rule is required.");
  const normalized = rules.map((rule, index) => ({
    grade: clean(rule.grade).toUpperCase(),
    minimumScore: Number(rule.minimumScore),
    maximumScore: Number(rule.maximumScore),
    remark: clean(rule.remark) || null,
    sortOrder: index + 1,
  }));
  if (normalized.some((rule) => !rule.grade || !Number.isFinite(rule.minimumScore) || !Number.isFinite(rule.maximumScore) || rule.minimumScore < 0 || rule.maximumScore > 100 || rule.minimumScore > rule.maximumScore))
    throw errors.validation("Every grade must have a valid inclusive range between 0 and 100.");
  if (new Set(normalized.map((rule) => rule.grade)).size !== normalized.length)
    throw errors.validation("Grade entries must be unique.");
  const ordered = [...normalized].sort((a, b) => a.minimumScore - b.minimumScore);
  if (ordered[0].minimumScore !== 0 || ordered.at(-1).maximumScore !== 100)
    throw errors.validation("Active grading rules must cover the complete 0–100 range.");
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].minimumScore !== ordered[index - 1].maximumScore + 1)
      throw errors.validation(ordered[index].minimumScore <= ordered[index - 1].maximumScore ? "Grading ranges must not overlap." : "Grading ranges must not contain gaps.");
  }
  return normalized;
}
async function saveGradingRules(identity, rules, req) {
  const normalized = validateGradingScheme(rules);
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${identity.schoolId}:grading-rules`]);
    const old = (await client.query("SELECT * FROM grading_rules WHERE school_id=$1 ORDER BY sort_order,grade", [identity.schoolId])).rows;
    await client.query("UPDATE grading_rules SET status='INACTIVE' WHERE school_id=$1", [identity.schoolId]);
    for (const rule of normalized)
      await client.query(`INSERT INTO grading_rules(school_id,grade,minimum_score,maximum_score,remark,sort_order,status) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE') ON CONFLICT(school_id,grade) DO UPDATE SET minimum_score=EXCLUDED.minimum_score,maximum_score=EXCLUDED.maximum_score,remark=EXCLUDED.remark,sort_order=EXCLUDED.sort_order,status='ACTIVE',updated_at=now()`, [identity.schoolId, rule.grade, rule.minimumScore, rule.maximumScore, rule.remark, rule.sortOrder]);
    const saved = (await client.query("SELECT * FROM grading_rules WHERE school_id=$1 AND status='ACTIVE' ORDER BY sort_order,grade", [identity.schoolId])).rows;
    await audit({schoolId: identity.schoolId, userId: identity.id, action: "GRADING_RULES_UPDATED", entityType: "GradingRules", oldValue: {rules: old}, newValue: {rules: saved}, req, client});
    return saved;
  });
}
async function mutate(identity, operation, entity, data, req) {
  const map = {
    session: "academicSessions",
    class: "classes",
    arm: "classArms",
    subject: "subjects",
    assessmentStructure: "assessmentStructures",
    gradingRule: "gradingRules",
  };
  if (entity === "school") return school(identity, data, req);
  if (entity === "session" && operation === "create")
    return require("./session-continuity-service").create(identity, data, req);
  if (entity === "user")
    return admin.saveUser(identity, data, data.userId, req);
  const id =
    data[`${entity}Id`] ||
    data.classArmId ||
    data.structureId ||
    data.gradingRuleId;
  if (operation === "current") return setCurrent(identity, entity, id, req);
  if (entity === "term") return saveTerm(identity, data, id, req);
  if (entity === "gradingRules") return saveGradingRules(identity, data.rules, req);
  const name = map[entity];
  if (!name) throw errors.validation("Unsupported administration entity.");
  if (entity === "assessmentStructure")
    await validateAssessment(identity, data, id);
  if (entity === "gradingRule") await validateGrade(identity, data, id);
  return operation === "create"
    ? entities.create(identity, name, data, req)
    : entities.update(identity, name, id, data, req);
}
module.exports = {
  bootstrap,
  mutate,
  setCurrent,
  curriculum,
  curriculumStatus,
  validateAssessment,
  validateGrade,
  validateGradingScheme,
  saveGradingRules,
};

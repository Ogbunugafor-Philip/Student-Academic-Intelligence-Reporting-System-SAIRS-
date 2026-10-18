"use strict";
const { pool } = require("../db/pool");
const { errors } = require("../utilities/errors");
const entities = {
  students: {
    table: "students",
    fields: [
      "admission_number",
      "first_name",
      "middle_name",
      "last_name",
      "gender",
      "date_of_birth",
      "admission_date",
      "admission_session_id",
      "class_id",
      "class_arm_id",
      "status",
      "exit_date",
      "exit_reason",
      "updated_by",
    ],
  },
  parents: {
    table: "parents",
    fields: [
      "user_id",
      "first_name",
      "middle_name",
      "last_name",
      "email",
      "phone",
      "address",
      "status",
    ],
  },
  teachers: {
    table: "teachers",
    fields: [
      "user_id",
      "staff_number",
      "first_name",
      "middle_name",
      "last_name",
      "email",
      "phone",
      "status",
    ],
  },
  academicSessions: {
    table: "academic_sessions",
    fields: ["name", "start_date", "end_date", "status"],
  },
  terms: {
    table: "terms",
    fields: ["academic_session_id", "name", "start_date", "end_date", "status"],
  },
  classes: { table: "classes", fields: ["name", "sort_order", "status"] },
  classArms: { table: "class_arms", fields: ["class_id", "name", "status"] },
  subjects: { table: "subjects", fields: ["code", "name", "status"] },
  assessmentStructures: {
    table: "assessment_structures",
    fields: ["code", "name", "category", "maximum_score", "weight", "status"],
  },
  gradingRules: {
    table: "grading_rules",
    fields: [
      "grade",
      "minimum_score",
      "maximum_score",
      "remark",
      "sort_order",
      "status",
    ],
  },
};
const config = (name) => {
  const value = entities[name];
  if (!value) throw errors.validation("Unsupported entity.");
  return value;
};
async function list(
  name,
  schoolId,
  { search = "", status = "", limit = 200, offset = 0 } = {},
) {
  const e = config(name),
    params = [schoolId],
    where = ["school_id=$1"];
  if (status) {
    params.push(status.toUpperCase());
    where.push(`status=$${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const searchable = e.fields.filter((x) =>
      [
        "name",
        "first_name",
        "middle_name",
        "last_name",
        "admission_number",
        "staff_number",
        "email",
        "code",
      ].includes(x),
    );
    if (searchable.length)
      where.push(
        `(${searchable.map((x) => `${x}::text ILIKE $${params.length}`).join(" OR ")})`,
      );
  }
  params.push(Math.min(Number(limit) || 200, 500), Number(offset) || 0);
  return (
    await pool.query(
      `SELECT * FROM ${e.table} WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
  ).rows;
}
async function get(name, schoolId, id, client = pool, lock = false) {
  const e = config(name),
    { rows } = await client.query(
      `SELECT * FROM ${e.table} WHERE school_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
      [schoolId, id],
    );
  if (!rows[0]) throw errors.notFound();
  return rows[0];
}
async function create(name, schoolId, data, client = pool) {
  const e = config(name),
    fields = e.fields.filter((x) => Object.hasOwn(data, x));
  const values = [schoolId, ...fields.map((x) => data[x])],
    columns = ["school_id", ...fields];
  return (
    await client.query(
      `INSERT INTO ${e.table}(${columns.join(",")}) VALUES(${values.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
      values,
    )
  ).rows[0];
}
async function update(name, schoolId, id, data, client = pool) {
  const e = config(name),
    fields = e.fields.filter((x) => Object.hasOwn(data, x));
  if (!fields.length) return get(name, schoolId, id, client);
  const values = fields.map((x) => data[x]);
  values.push(schoolId, id);
  const version = e.table === "students" ? ",version=version+1" : "";
  const { rows } = await client.query(
    `UPDATE ${e.table} SET ${fields.map((x, i) => `${x}=$${i + 1}`).join(",")}${version} WHERE school_id=$${fields.length + 1} AND id=$${fields.length + 2} RETURNING *`,
    values,
  );
  if (!rows[0]) throw errors.notFound();
  return rows[0];
}
module.exports = { entities, list, get, create, update };

"use strict";
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const { env } = require("../config/env");
const { pool, transaction } = require("../db/pool");
const { errors } = require("../utilities/errors");
const { audit } = require("./audit-service");
const { logger } = require("../utilities/logger");
const teachers = require("./teacher-service");
const MAX_TEACHERS = 1000;
const TEACHER_HEADERS = [
  "Staff Number",
  "First Name",
  "Middle Name",
  "Last Name",
  "Email",
  "Phone",
];
const ASSIGNMENT_HEADERS = [
  "Staff Number",
  "Assignment Type",
  "Subject",
  "Class",
  "Class Arm",
];
const normalize = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
const key = (value) => normalize(value).toLowerCase();
const headerKey = (value) => key(value).replace(/[\s_-]+/g, "");
const emailValid = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const phoneValid = (value) => /^\+?[0-9][0-9 ()\-.]{1,78}[0-9]$/.test(value);
function cellText(cell) {
  const value = cell?.value ?? cell ?? "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const format = String(cell?.numFmt || "");
    if (/^0+$/.test(format)) return String(value).padStart(format.length, "0");
    return String(value);
  }
  if (value && typeof value === "object")
    return (
      value.text ??
      value.result ??
      value.richText?.map((part) => part.text).join("") ??
      ""
    );
  return String(value);
}
function records(sheet, headers) {
  if (!sheet)
    throw errors.validation(
      `${headers === TEACHER_HEADERS ? "Teachers" : "Assignments"} worksheet is missing.`,
    );
  const actual = Array.from({ length: sheet.columnCount }, (_, index) =>
      headerKey(cellText(sheet.getCell(1, index + 1))),
    ),
    missing = headers.filter((x) => !actual.includes(headerKey(x)));
  if (missing.length)
    throw errors.validation(
      `${sheet.name} is missing columns: ${missing.join(", ")}.`,
    );
  return Array.from({ length: Math.max(0, sheet.rowCount - 1) }, (_, index) => {
    const row = sheet.getRow(index + 2);
    return {
      sheet: sheet.name,
      row: index + 2,
      data: Object.fromEntries(
        actual.map((header, column) => [
          header,
          cellText(row.getCell(column + 1)),
        ]),
      ),
      populated: actual.some((_, column) =>
        normalize(cellText(row.getCell(column + 1))),
      ),
    };
  }).filter((x) => x.populated);
}
async function normalizeWorkbookNamespace(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;
  await Promise.all(
    Object.values(zip.files)
      .filter((entry) => !entry.dir && entry.name.endsWith(".xml"))
      .map(async (entry) => {
        const xml = await entry.async("string");
        const match = xml.match(
          /xmlns:([A-Za-z_][\w.-]*)=["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/,
        );
        if (!match) return;
        const prefix = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const normalized = xml.replace(
          new RegExp(`<(/?)${prefix}:`, "g"),
          "<$1",
        );
        if (normalized !== xml) {
          zip.file(entry.name, normalized);
          changed = true;
        }
      }),
  );
  if (!changed) return null;
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
async function workbook(file) {
  const buffer = Buffer.from(file?.base64 || "", "base64");
  if (!buffer.length)
    throw errors.validation("Choose a non-empty XLSX workbook.");
  if (buffer.length > env.maxImportBytes)
    throw errors.validation(
      `The import file must be smaller than ${Math.round(env.maxImportBytes / 1024 / 1024)} MB.`,
    );
  if (
    !String(file.fileName || "")
      .toLowerCase()
      .endsWith(".xlsx")
  )
    throw errors.validation("Teacher import supports XLSX workbooks only.");
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(buffer);
  } catch (error) {
    const details = {
      fileName: String(file.fileName || ""),
      mimeType: String(file.mimeType || ""),
      bufferLength: buffer.length,
      signature: buffer.subarray(0, 8).toString("hex"),
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      error: error.message,
      errorName: error.name,
      stack: error.stack,
    };
    logger.error("teacher_workbook_read_failed", {
      ...details,
    });
    try {
      const normalized = await normalizeWorkbookNamespace(buffer);
      if (normalized) {
        const compatibleBook = new ExcelJS.Workbook();
        await compatibleBook.xlsx.load(normalized);
        logger.info(
          "teacher_workbook_namespace_compatibility_applied",
          details,
        );
        const findSheet = (name) =>
          compatibleBook.worksheets.find(
            (sheet) => key(sheet.name) === key(name),
          );
        return {
          teachers: records(findSheet("Teachers"), TEACHER_HEADERS),
          assignments: records(findSheet("Assignments"), ASSIGNMENT_HEADERS),
        };
      }
    } catch (compatibilityError) {
      logger.error("teacher_workbook_compatibility_failed", {
        ...details,
        compatibilityError: compatibilityError.message,
        compatibilityStack: compatibilityError.stack,
      });
    }
    throw errors.validation("The teacher workbook could not be read.");
  }
  const findSheet = (name) =>
    book.worksheets.find((sheet) => key(sheet.name) === key(name));
  return {
    teachers: records(findSheet("Teachers"), TEACHER_HEADERS),
    assignments: records(findSheet("Assignments"), ASSIGNMENT_HEADERS),
  };
}
async function template() {
  const book = new ExcelJS.Workbook();
  book.creator = "SAIRS";
  const style = (sheet) => {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF315C4C" },
    };
    sheet.autoFilter = {
      from: "A1",
      to: `${String.fromCharCode(64 + sheet.columnCount)}1`,
    };
  };
  const teacherSheet = book.addWorksheet("Teachers");
  teacherSheet.addRow(TEACHER_HEADERS);
  teacherSheet.columns = [18, 20, 20, 20, 30, 22].map((width) => ({ width }));
  style(teacherSheet);
  const assignmentSheet = book.addWorksheet("Assignments");
  assignmentSheet.addRow(ASSIGNMENT_HEADERS);
  assignmentSheet.columns = [18, 22, 28, 22, 18].map((width) => ({ width }));
  style(assignmentSheet);
  const instructions = book.addWorksheet("Instructions");
  instructions.columns = [{ width: 28 }, { width: 100 }];
  instructions.addRows([
    [
      "Teacher Import",
      "Use one row per new teacher in Teachers and one row per responsibility in Assignments.",
    ],
    [
      "FORM_TEACHER",
      "Leave Subject blank. Class Arm must be one specific configured arm.",
    ],
    [
      "SUBJECT_TEACHER",
      "Subject, Class and Class Arm are required. Class Arm may be All Arms.",
    ],
    [
      "All Arms",
      "Expands to one real assignment for every active arm configured under that class.",
    ],
    [
      "Generic example",
      "T/001 | SUBJECT_TEACHER | Mathematics | JSS 1 | All Arms",
    ],
  ]);
  style(instructions);
  const buffer = await book.xlsx.writeBuffer();
  return {
    fileName: "SAIRS-Teacher-Assignment-Import-Template.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: Buffer.from(buffer).toString("base64"),
  };
}
async function validate(identity, file, client = pool) {
  const parsed = await workbook(file);
  if (!parsed.teachers.length)
    throw errors.validation("The Teachers sheet does not contain any rows.");
  if (parsed.teachers.length > MAX_TEACHERS)
    throw errors.validation(
      `A maximum of ${MAX_TEACHERS} teachers can be imported at once.`,
    );
  const schoolId = identity.schoolId,
    [
      session,
      classes,
      arms,
      subjects,
      existingTeachers,
      users,
      formAssignments,
    ] = await Promise.all([
      client.query(
        `SELECT id,name FROM academic_sessions WHERE school_id=$1 AND is_current=true AND status='ACTIVE' LIMIT 1`,
        [schoolId],
      ),
      client.query(
        `SELECT id,name FROM classes WHERE school_id=$1 AND status='ACTIVE'`,
        [schoolId],
      ),
      client.query(
        `SELECT id,class_id,name FROM class_arms WHERE school_id=$1 AND status='ACTIVE'`,
        [schoolId],
      ),
      client.query(
        `SELECT id,name FROM subjects WHERE school_id=$1 AND status='ACTIVE'`,
        [schoolId],
      ),
      client.query(
        `SELECT staff_number,user_id FROM teachers WHERE school_id=$1`,
        [schoolId],
      ),
      client.query(`SELECT id,email,role FROM users WHERE school_id=$1`, [
        schoolId,
      ]),
      client.query(
        `SELECT ta.class_id,ta.class_arm_id,t.first_name||' '||t.last_name teacher_name FROM teacher_assignments ta JOIN teachers t ON t.id=ta.teacher_id WHERE ta.school_id=$1 AND ta.academic_session_id=(SELECT id FROM academic_sessions WHERE school_id=$1 AND is_current=true AND status='ACTIVE' LIMIT 1) AND ta.assignment_type='CLASS_TEACHER' AND ta.status='ACTIVE'`,
        [schoolId],
      ),
    ]);
  if (!session.rows[0] && parsed.assignments.length)
    throw errors.validation(
      "No current academic session is configured. Configure it before importing teacher assignments.",
    );
  const classMap = new Map(classes.rows.map((x) => [key(x.name), x])),
    armsByClass = new Map(),
    armMap = new Map();
  for (const arm of arms.rows) {
    if (!armsByClass.has(arm.class_id)) armsByClass.set(arm.class_id, []);
    armsByClass.get(arm.class_id).push(arm);
    armMap.set(`${arm.class_id}:${key(arm.name)}`, arm);
  }
  const subjectMap = new Map(subjects.rows.map((x) => [key(x.name), x])),
    existingStaff = new Set(
      existingTeachers.rows.map((x) => key(x.staff_number)),
    ),
    userMap = new Map(users.rows.map((x) => [key(x.email), x])),
    occupied = new Map(
      formAssignments.rows.map((x) => [
        `${x.class_id}:${x.class_arm_id}`,
        x.teacher_name,
      ]),
    ),
    seenStaff = new Set(),
    teacherRows = [],
    teacherMap = new Map(),
    errorsOut = [];
  const seenEmails = new Set();
  for (const item of parsed.teachers) {
    const d = item.data,
      staffNumber = normalize(d.staffnumber),
      firstName = normalize(d.firstname),
      middleName = normalize(d.middlename),
      lastName = normalize(d.lastname),
      email = key(d.email),
      phone = normalize(d.phone),
      issues = [];
    if (!staffNumber) issues.push("Staff Number is required.");
    else if (seenStaff.has(key(staffNumber)))
      issues.push("Staff Number is duplicated in the Teachers sheet.");
    else if (existingStaff.has(key(staffNumber)))
      issues.push(`Teacher with Staff Number ${staffNumber} already exists.`);
    seenStaff.add(key(staffNumber));
    if (!firstName) issues.push("First Name is required.");
    if (!lastName) issues.push("Last Name is required.");
    if (!emailValid(email)) issues.push("Email is invalid.");
    else if (seenEmails.has(email))
      issues.push("Email is duplicated in the Teachers sheet.");
    seenEmails.add(email);
    const user = userMap.get(email);
    if (user && user.role !== "TEACHER")
      issues.push("Email belongs to an incompatible account.");
    if (!phone || !phoneValid(phone))
      issues.push("Phone is required and must be valid.");
    const data = {
      staffNumber,
      firstName,
      middleName,
      lastName,
      email,
      phone,
      formTeacher: null,
      subjectAssignments: [],
    };
    teacherRows.push({
      sheet: "Teachers",
      row: item.row,
      staffNumber,
      status: issues.length ? "INVALID" : "VALID",
      issue: issues.join(" "),
      data,
      newAccount: !user,
    });
    if (!teacherMap.has(key(staffNumber)))
      teacherMap.set(key(staffNumber), data);
    if (issues.length)
      errorsOut.push({
        sheet: "Teachers",
        row: item.row,
        staffNumber,
        issue: issues.join(" "),
      });
  }
  const assignmentRows = [],
    seenAssignments = new Set();
  let formCount = 0,
    subjectCount = 0,
    expandedCount = 0,
    detectedFormCount = 0,
    detectedSubjectCount = 0;
  for (const item of parsed.assignments) {
    const d = item.data,
      staffNumber = normalize(d.staffnumber),
      type = normalize(d.assignmenttype).toUpperCase(),
      subjectName = normalize(d.subject),
      className = normalize(d.class),
      armName = normalize(d.classarm),
      issues = [],
      teacher = teacherMap.get(key(staffNumber)),
      classRow = classMap.get(key(className));
    if (type === "FORM_TEACHER") detectedFormCount++;
    if (type === "SUBJECT_TEACHER") detectedSubjectCount++;
    if (!teacher)
      issues.push(
        `Assignments row ${item.row} references unknown teacher ${staffNumber || "(blank)"}.`,
      );
    if (!["FORM_TEACHER", "SUBJECT_TEACHER"].includes(type))
      issues.push("Assignment Type must be FORM_TEACHER or SUBJECT_TEACHER.");
    if (!classRow)
      issues.push(
        `Class '${className}' is not configured (Assignments row ${item.row}, teacher ${staffNumber || "(blank)"}).`,
      );
    let resolvedArms = [];
    if (classRow) {
      if (key(armName) === "all arms") {
        if (type === "FORM_TEACHER")
          issues.push("All Arms is not allowed for FORM_TEACHER.");
        else {
          resolvedArms = armsByClass.get(classRow.id) || [];
          if (!resolvedArms.length)
            issues.push(
              `Class '${className}' has no configured arms (Assignments row ${item.row}, teacher ${staffNumber}).`,
            );
        }
      } else {
        const arm = armMap.get(`${classRow.id}:${key(armName)}`);
        if (!arm)
          issues.push(
            `Class arm '${armName}' is not configured for ${className} (Assignments row ${item.row}, teacher ${staffNumber}).`,
          );
        else resolvedArms = [arm];
      }
    }
    let subject = null;
    if (type === "FORM_TEACHER" && subjectName)
      issues.push("Subject must be blank for FORM_TEACHER.");
    if (type === "SUBJECT_TEACHER") {
      subject = subjectMap.get(key(subjectName));
      if (!subject)
        issues.push(
          `Subject '${subjectName}' is not configured for ${className || "the selected class"} (Assignments row ${item.row}, teacher ${staffNumber}).`,
        );
    }
    for (const arm of resolvedArms) {
      const signature = `${key(staffNumber)}:${type}:${subject?.id || ""}:${classRow?.id}:${arm.id}`;
      if (seenAssignments.has(signature))
        issues.push("Duplicate assignment row.");
      seenAssignments.add(signature);
      if (type === "FORM_TEACHER" && occupied.has(`${classRow.id}:${arm.id}`))
        issues.push(
          `${className}${arm.name} already has a Form Teacher: ${occupied.get(`${classRow.id}:${arm.id}`)}.`,
        );
    }
    if (!issues.length && teacher) {
      if (type === "FORM_TEACHER") {
        teacher.formTeacher = {
          classId: classRow.id,
          classArmId: resolvedArms[0].id,
        };
        formCount++;
        occupied.set(
          `${classRow.id}:${resolvedArms[0].id}`,
          `${teacher.firstName} ${teacher.lastName}`,
        );
      } else {
        teacher.subjectAssignments.push({
          subjectId: subject.id,
          classId: classRow.id,
          classArmId: key(armName) === "all arms" ? "ALL" : resolvedArms[0].id,
        });
        subjectCount += resolvedArms.length;
        if (key(armName) === "all arms") expandedCount += resolvedArms.length;
      }
    }
    const issue = issues.join(" ");
    assignmentRows.push({
      sheet: "Assignments",
      row: item.row,
      staffNumber,
      assignmentType: type,
      subject: subjectName,
      className,
      armName,
      status: issues.length ? "INVALID" : "VALID",
      issue,
    });
    if (issues.length)
      errorsOut.push({
        sheet: "Assignments",
        row: item.row,
        staffNumber,
        issue,
      });
  }
  const validAssignments = assignmentRows.filter((x) => x.status === "VALID");
  return {
    teacherRows,
    assignmentRows,
    teachers: [...teacherMap.values()],
    errors: errorsOut,
    summary: {
      teachersInFile: parsed.teachers.length,
      validTeachers: teacherRows.filter((x) => x.status === "VALID").length,
      invalidTeachers: teacherRows.filter((x) => x.status === "INVALID").length,
      assignments: parsed.assignments.length,
      assignmentsDetected: parsed.assignments.length,
      classesDetected: new Set(
        assignmentRows.map((x) => key(x.className)).filter(Boolean),
      ).size,
      subjectsDetected: new Set(
        assignmentRows
          .filter((x) => x.assignmentType === "SUBJECT_TEACHER")
          .map((x) => key(x.subject)),
      ).size,
      formTeacherAssignments: detectedFormCount,
      subjectAssignments: detectedSubjectCount,
      resolvedFormTeacherAssignments: formCount,
      resolvedSubjectAssignments: subjectCount,
      newTeacherAccounts: teacherRows.filter(
        (x) => x.status === "VALID" && x.newAccount,
      ).length,
      existingTeacherAccounts: teacherRows.filter(
        (x) => x.status === "VALID" && !x.newAccount,
      ).length,
      expandedAllArmsAssignments: expandedCount,
    },
  };
}
async function preview(identity, file) {
  const result = await validate(identity, file);
  return {
    summary: result.summary,
    teachers: result.teacherRows,
    assignments: result.assignmentRows,
    errors: result.errors,
  };
}
async function importTeachers(identity, file, req) {
  return transaction(async (client) => {
    const validation = await validate(identity, file, client);
    if (validation.errors.length)
      throw errors.validation(
        "The teacher workbook contains validation errors.",
        validation.errors,
      );
    const credentials = [];
    let forms = 0,
      subjects = 0;
    for (const data of validation.teachers) {
      const result = await teachers.onboardTeacher(client, identity, data, req);
      forms += result.assignments.filter(
        (x) => x.assignment_type === "CLASS_TEACHER",
      ).length;
      subjects += result.assignments.filter(
        (x) => x.assignment_type === "SUBJECT_TEACHER",
      ).length;
      if (result.temporaryPassword)
        credentials.push({
          staffNumber: data.staffNumber,
          teacherName: `${data.firstName} ${data.lastName}`,
          email: data.email,
          temporaryPassword: result.temporaryPassword,
          loginUrl: env.origin,
        });
    }
    const summary = {
      teachersImported: validation.teachers.length,
      teacherAccountsCreated: credentials.length,
      formTeacherAssignments: forms,
      subjectAssignments: subjects,
      expandedAllArmsAssignments: validation.summary.expandedAllArmsAssignments,
    };
    await audit({
      schoolId: identity.schoolId,
      userId: identity.id,
      action: "TEACHER_BULK_IMPORT",
      entityType: "TeacherImport",
      newValue: summary,
      req,
      client,
    });
    return { summary, credentials };
  });
}
module.exports = {
  MAX_TEACHERS,
  TEACHER_HEADERS,
  ASSIGNMENT_HEADERS,
  template,
  workbook,
  validate,
  preview,
  importTeachers,
};

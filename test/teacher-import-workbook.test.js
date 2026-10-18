"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const teacherImports = require("../src/services/teacher-import-service");

async function fileFrom(sheets) {
  const book = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const page = book.addWorksheet(sheet.name);
    for (const row of sheet.rows) page.addRow(row);
  }
  const buffer = await book.xlsx.writeBuffer();
  return {
    fileName: "teachers.xlsx",
    base64: Buffer.from(buffer).toString("base64"),
  };
}

const teacherRows = [
  teacherImports.TEACHER_HEADERS,
  [
    "GEDS/T/001",
    "Rebecca",
    "",
    "Mker",
    "rebecca.mker01@example.com",
    "08174308347",
  ],
];
const assignmentRows = [
  teacherImports.ASSIGNMENT_HEADERS,
  ["GEDS/T/001", "FORM_TEACHER", "", "Primary 1", "A"],
];
const instructions = { name: "Instructions", rows: [["Information only"]] };

test("teacher workbook accepts two data sheets and harmless extra sheets in any order", async () => {
  for (const sheets of [
    [
      { name: "Teachers", rows: teacherRows },
      { name: "Assignments", rows: assignmentRows },
    ],
    [
      { name: "Teachers", rows: teacherRows },
      { name: "Assignments", rows: assignmentRows },
      instructions,
    ],
    [
      instructions,
      { name: "Teachers", rows: teacherRows },
      { name: "Assignments", rows: assignmentRows },
    ],
  ]) {
    const parsed = await teacherImports.workbook(await fileFrom(sheets));
    assert.equal(parsed.teachers.length, 1);
    assert.equal(parsed.assignments.length, 1);
  }
});

test("missing required worksheets produce specific schema errors", async () => {
  await assert.rejects(
    teacherImports.workbook(
      await fileFrom([{ name: "Assignments", rows: assignmentRows }]),
    ),
    /Teachers worksheet is missing/,
  );
  await assert.rejects(
    teacherImports.workbook(
      await fileFrom([{ name: "Teachers", rows: teacherRows }]),
    ),
    /Assignments worksheet is missing/,
  );
});

test("namespace-prefixed Excel workbook XML uses the compatibility parser", async () => {
  const file = await fileFrom([
    { name: "Teachers", rows: teacherRows },
    { name: "Assignments", rows: assignmentRows },
    instructions,
  ]);
  const zip = await JSZip.loadAsync(Buffer.from(file.base64, "base64"));
  for (const entry of Object.values(zip.files).filter(
    (item) =>
      !item.dir && item.name.startsWith("xl/") && item.name.endsWith(".xml"),
  )) {
    let xml = await entry.async("string");
    if (
      !xml.includes(
        'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
      )
    )
      continue;
    xml = xml.replace(
      /<(\/?)(?![A-Za-z_][\w.-]*:)([A-Za-z_][\w.-]*)(?=[\s/>])/g,
      "<$1x:$2",
    );
    xml = xml.replace(
      'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
      'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
    );
    zip.file(entry.name, xml);
  }
  const prefixed = await zip.generateAsync({ type: "nodebuffer" });
  await assert.rejects(new ExcelJS.Workbook().xlsx.load(prefixed));
  file.base64 = prefixed.toString("base64");
  const parsed = await teacherImports.workbook(file);
  assert.equal(parsed.teachers.length, 1);
  assert.equal(parsed.assignments.length, 1);
});

function configuredSchool() {
  const names = [
    "Primary 1",
    "Primary 2",
    "Primary 3",
    "Primary 4",
    "Primary 5",
    "Primary 6",
    "JSS 1",
    "JSS 2",
    "JSS 3",
    "SS 1",
    "SS 2",
    "SS 3",
  ];
  const counts = [4, 4, 4, 4, 4, 4, 5, 4, 4, 4, 3, 3];
  const classes = names.map((name, index) => ({
    id: `class-${index + 1}`,
    name,
  }));
  const arms = classes.flatMap((item, index) =>
    Array.from({ length: counts[index] }, (_, arm) => ({
      id: `${item.id}-arm-${arm + 1}`,
      class_id: item.id,
      name: String.fromCharCode(65 + arm),
    })),
  );
  const subjects = [
    "English Language",
    "Mathematics",
    "Basic Science",
    "Social Studies",
    "Civic Education",
  ].map((name, index) => ({ id: `subject-${index + 1}`, name }));
  return { classes, arms, subjects };
}

function fakeClient(config = configuredSchool()) {
  return {
    async query(sql) {
      if (sql.includes("FROM academic_sessions"))
        return { rows: [{ id: "session-1", name: "2026/2027" }] };
      if (sql.includes("FROM classes")) return { rows: config.classes };
      if (sql.includes("FROM class_arms")) return { rows: config.arms };
      if (sql.includes("FROM subjects")) return { rows: config.subjects };
      if (sql.includes("FROM teacher_assignments")) return { rows: [] };
      if (sql.includes("FROM teachers")) return { rows: [] };
      if (sql.includes("FROM users")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

async function exactFixture() {
  const config = configuredSchool();
  const teachers = [teacherImports.TEACHER_HEADERS];
  for (let index = 1; index <= 68; index++) {
    teachers.push([
      `GEDS/T/${String(index).padStart(3, "0")}`,
      index === 1 ? "Rebecca" : `First${index}`,
      index % 2 ? "" : `Middle${index}`,
      index === 1 ? "Mker" : `Last${index}`,
      `teacher${index}@example.com`,
      index === 1 ? 8174308347 : `0817000${String(index).padStart(4, "0")}`,
    ]);
  }
  const assignments = [teacherImports.ASSIGNMENT_HEADERS];
  config.arms.forEach((arm, index) => {
    const classRow = config.classes.find((item) => item.id === arm.class_id);
    assignments.push([
      `GEDS/T/${String(index + 1).padStart(3, "0")}`,
      "FORM_TEACHER",
      "",
      classRow.name,
      arm.name,
    ]);
  });
  for (let index = 0; index < 165; index++) {
    assignments.push([
      `GEDS/T/${String((index % 68) + 1).padStart(3, "0")}`,
      "SUBJECT_TEACHER",
      config.subjects[index % config.subjects.length].name,
      config.classes[index % config.classes.length].name,
      "All Arms",
    ]);
  }
  const file = await fileFrom([
    instructions,
    { name: "Teachers", rows: teachers },
    { name: "Assignments", rows: assignments },
  ]);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(file.base64, "base64"));
  book.getWorksheet("Teachers").getCell("F2").numFmt = "00000000000";
  file.base64 = Buffer.from(await book.xlsx.writeBuffer()).toString("base64");
  return { file, config };
}

test("exact three-sheet fixture reaches validation with 68 teachers and 212 assignments", async () => {
  const { file, config } = await exactFixture();
  const result = await teacherImports.validate(
    { schoolId: "school-1" },
    file,
    fakeClient(config),
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.summary.teachersInFile, 68);
  assert.equal(result.summary.assignmentsDetected, 212);
  assert.equal(result.summary.formTeacherAssignments, 47);
  assert.equal(result.summary.subjectAssignments, 165);
  assert.equal(result.summary.classesDetected, 12);
  assert.equal(result.summary.subjectsDetected, 5);
  assert.equal(result.teacherRows[0].data.middleName, "");
  assert.equal(result.teacherRows[0].data.phone, "08174308347");
  assert.ok(
    result.summary.resolvedSubjectAssignments > 165,
    "All Arms must expand to real arms",
  );
});

test("mapping and orphan failures report the assignment row and offending value", async () => {
  const file = await fileFrom([
    { name: "Teachers", rows: teacherRows },
    {
      name: "Assignments",
      rows: [
        teacherImports.ASSIGNMENT_HEADERS,
        [
          "GEDS/T/001",
          "SUBJECT_TEACHER",
          "Unknown Subject",
          "Unknown Class",
          "Z",
        ],
        ["GEDS/T/099", "SUBJECT_TEACHER", "English Language", "Primary 1", "Z"],
      ],
    },
  ]);
  const result = await teacherImports.validate(
    { schoolId: "school-1" },
    file,
    fakeClient(),
  );
  const issues = result.errors.map((item) => item.issue).join(" ");
  assert.match(
    issues,
    /Class 'Unknown Class' is not configured \(Assignments row 2, teacher GEDS\/T\/001\)/,
  );
  assert.match(
    issues,
    /Subject 'Unknown Subject' is not configured for Unknown Class \(Assignments row 2, teacher GEDS\/T\/001\)/,
  );
  assert.match(
    issues,
    /Assignments row 3 references unknown teacher GEDS\/T\/099/,
  );
  assert.match(
    issues,
    /Class arm 'Z' is not configured for Primary 1 \(Assignments row 3, teacher GEDS\/T\/099\)/,
  );
});

import {
  hero,
  setMain,
  cards,
  table,
  escapeHtml,
  badge,
  formDialog,
  showToast,
  confirmDialog,
} from "../ui.js";
import { cachedThenNetwork } from "./_shared.js";
import { api } from "../api.js";
const importSetup = () =>
  import("./administration-import.js?v=sairs-v10").then((x) =>
    x.openSetupImport(() => render(context)),
  );
let data, context;
const e = escapeHtml,
  fmt = (value) =>
    value ? new Date(`${value}T00:00:00`).toLocaleDateString() : "—",
  status = (x) => badge(x.Status || "Active");
const option = (rows, id, label) =>
  rows
    .filter((x) => x.Status === "Active")
    .map((x) => ({ value: x[id], label: label(x) }));
export async function render(ctx) {
  context = ctx;
  const response = await cachedThenNetwork(
    "administration",
    "/api/administration/bootstrap",
    ctx.offline,
  );
  data = response.data || {};
  setMain(
    hero(
      "administration",
      "Institutional control",
      "School & Academic Setup",
      "Manage academic structure, curriculum, grading rules, access and the system audit trail.",
      [],
    ) +
      cards([
        [
          "Classes",
          data.counts?.classes || 0,
        ],
        ["Arms", data.counts?.arms || 0],
        ["Subjects", data.counts?.subjects || 0],
        ["Class-subject mappings", data.counts?.classSubjectMappings || 0],
      ]) +
      structure() +
      continuityManagement() +
      historicalReview() +
      curriculum() +
      results() +
      access(),
    "Administration",
  );
  bind();
}
function setupStatus() {
  return `<section class="card setup-overview"><div class="section-head"><div><p class="eyebrow">Configuration health</p><h2>Setup status</h2></div><strong>${data.setup?.complete || 0} of ${data.setup?.total || 8} complete</strong></div><div class="setup-checks">${(data.setup?.checks || []).map((x) => `<span class="${x.complete ? "complete" : "warning"}">${x.complete ? "✓" : "!"} ${e(x.name)}</span>`).join("")}</div></section>`;
}
function school() {
  const p = data.profile || {};
  return `<section class="card" id="school-setup"><div class="section-head"><div><p class="eyebrow">School setup</p><h2>${e(p.name || "School name not configured")}</h2></div>${button("Edit profile", "edit-school", "secondary")}</div><div class="profile-grid"><div><small>Address</small><strong>${e(p.address || "Not configured")}</strong></div><div><small>Email</small><strong>${e(p.email || "Not configured")}</strong></div><div><small>Phone</small><strong>${e(p.phone || "Not configured")}</strong></div><div><small>Principal / Head Teacher</small><strong>${e(p.principal_name || "Not configured")}</strong></div><div><small>Motto</small><strong>${e(p.motto || "Not configured")}</strong></div></div></section>`;
}
function calendar() {
  const sessions = data.academicSessions || [];
  return section(
    "Academic Year",
    `<div class="subsection-head"><h3>Academic sessions</h3>${button("Add session", "add-session")}</div>${table(
      ["Session", "Dates", "Status", "Actions"],
      sessions.map((x) => [
        e(x.SessionName),
        `${fmt(x.StartDate)} – ${fmt(x.EndDate)}`,
        status(x),
        `${x.IsCurrent ? "<strong>Current</strong>" : actions("session", x.SessionID, x.Status)} <button class="btn btn-quiet" data-reconcile="${x.SessionID}">Reconcile</button>`,
      ]),
      "No academic session is configured.",
    )}<div class="subsection-head"><h3>Terms</h3>${button("Add term", "add-term")}</div>${table(
      ["Term", "Session", "Dates", "Status", "Actions"],
      (data.terms || []).map((x) => [
        e(x.TermName),
        e(
          sessions.find((s) => s.SessionID === x.SessionID)?.SessionName ||
            "Unknown session",
        ),
        `${fmt(x.StartDate)} – ${fmt(x.EndDate)}`,
        status(x),
        x.IsCurrent
          ? "<strong>Current</strong>"
          : actions("term", x.TermID, x.Status),
      ]),
      "No term is configured.",
    )}`,
  );
}
function continuityManagement() {
  return section(
    "Academic Session Rollover & Continuity Management",
    `<div class="subsection-head"><div><h3>Create sessions with continuity</h3><p>New sessions carry forward active enrolments, teaching responsibilities, form teachers and curriculum. Scores and results remain in their original period.</p></div>${button("Create academic session", "create-session-rollover")}</div>
     <div class="subsection-head"><div><h3>Student Promotion Management</h3><p>Place selected students in a target session after reviewing the source roster.</p></div>${button("Manage promotions", "manage-promotions", "secondary")}</div>`,
  );
}
function structure() {
  const classes = data.classes || [];
  return section(
    "Classes & Arms",
    `<div class="subsection-head"><div><h3>Classes</h3><p>Import classes, arms, subjects and curriculum with one validated workbook.</p></div><div>${button("Import XLSX", "import-setup", "secondary")} ${button("Add class", "add-class")}</div></div>${table(
      ["Class", "Order", "Status", "Actions"],
      classes.map((x) => [
        e(x.ClassName),
        e(x.SortOrder),
        status(x),
        actions("class", x.ClassID, x.Status),
      ]),
      "No classes configured.",
    )}<div class="subsection-head"><h3>Class arms</h3>${button("Add class arm", "add-arm")}</div>${table(
      ["Class", "Arm", "Status", "Actions"],
      (data.classArms || []).map((x) => [
        e(classes.find((c) => c.ClassID === x.ClassID)?.ClassName || "Unknown"),
        e(x.ArmName),
        status(x),
        actions("arm", x.ClassArmID, x.Status),
      ]),
      "No class arms configured.",
    )}`,
  );
}
function curriculum() {
  const subjects = data.subjects || [],
    classes = data.classes || [];
  return section(
    "Subjects & Curriculum",
    `<div class="subsection-head"><div><h3>Subject catalogue</h3><p>Maintain reusable subject codes and names.</p></div>${button("Add subject", "add-subject")}</div>${table(
      ["Code", "Subject", "Status", "Actions"],
      subjects.map((x) => [
        e(x.SubjectCode),
        e(x.SubjectName),
        status(x),
        actions("subject", x.SubjectID, x.Status),
      ]),
      "No subjects configured.",
    )}<div class="subsection-head"><div><h3>Class-subject mapping</h3><p>Controls which subjects may be assigned and assessed in each class.</p></div>${button("Map subject", "add-mapping")}</div>${table(
      ["Class", "Code", "Subject", "Status", "Actions"],
      (data.classSubjects || []).map((x) => [
        e(
          x.ClassName ||
            classes.find((c) => c.ClassID === x.ClassID)?.ClassName,
        ),
        e(x.SubjectCode),
        e(x.SubjectName),
        status(x),
        `<button class="btn btn-quiet" data-map-status="${x.ID}" data-current="${x.Status}">${x.Status === "Active" ? "Deactivate" : "Activate"}</button>`,
      ]),
      "No curriculum mappings configured. Until mappings are added, legacy teacher assignments remain unrestricted.",
    )}`,
  );
}
function results() {
  const rules = (data.gradingRules || []).filter((x) => x.Status === "Active");
  return section(
    "Grading Rules",
    `<div class="subsection-head"><div><h3>Grading rules</h3><p>Inclusive ranges must cover every score from 0 to 100 without gaps or overlaps.</p></div>${button("Edit grading rules", "edit-grading-rules")}</div>${table(
      ["Grade", "Minimum", "Maximum", "Remark"],
      rules.map((x) => [
        e(x.Grade),
        e(wholeNumber(x.MinimumScore)),
        e(wholeNumber(x.MaximumScore)),
        e(x.Remark || "—"),
      ]),
      "No grading rules configured.",
    )}`,
  );
}
function access() {
  return section(
    "Access Management",
    `<div class="subsection-head"><div><h3>System users</h3><p>Manage administrative, management, teacher and parent access.</p></div>${button("Add user", "add-user")}</div>${table(
      ["Email", "Role", "Status", "Actions"],
      (data.users || []).map((x) => [
        e(x.Email),
        e(String(x.Role).replaceAll("_", " ")),
        status(x),
        `${actions("user", x.UserID, x.Status)} <button class="btn btn-quiet" data-reset="${x.UserID}">Reset password</button>`,
      ]),
      "No system users configured.",
    )}`,
  );
}
function historicalReview() {
  return section(
    "Historical Enrolment Review",
    `<div class="subsection-head"><div><h3>Evidence-based historical review</h3><p>Inspect flagged enrolments without changing scores, results, reports or guardian links.</p></div>${button("Open review queue", "historical-review", "secondary")}</div>`,
  );
}
const wholeNumber = (value) => Number.isFinite(Number(value)) ? String(Math.trunc(Number(value))) : "";
function section(title, body) {
  return `<section class="card admin-section"><div class="section-head"><p class="eyebrow">${e(title)}</p></div>${body}</section>`;
}
function button(label, id, kind = "primary") {
  return context.offline
    ? ""
    : `<button class="btn btn-${kind}" id="${id}">${e(label)}</button>`;
}
function actions(entity, id, current) {
  return context.offline
    ? "Offline copy"
    : `<button class="btn btn-quiet" data-edit="${entity}:${id}">Edit</button><button class="btn btn-quiet" data-status="${entity}:${id}:${current}">${current === "Active" ? "Deactivate" : "Activate"}</button>${["session", "term"].includes(entity) ? `<button class="btn btn-quiet" data-current-record="${entity}:${id}">Set current</button>` : ""}`;
}
function bind() {
  if (context.offline) return;
  document.querySelector("#edit-school")?.addEventListener("click", editSchool);
  document
    .querySelector("#import-setup")
    ?.addEventListener("click", importSetup);
  for (const [type, id] of [
    ["session", "add-session"],
    ["term", "add-term"],
    ["class", "add-class"],
    ["arm", "add-arm"],
    ["subject", "add-subject"],
    ["user", "add-user"],
  ])
    document
      .querySelector(`#${id}`)
      ?.addEventListener("click", () => editEntity(type));
  document.querySelector("#edit-grading-rules")?.addEventListener("click", editGradingRules);
  document.querySelector("#add-mapping")?.addEventListener("click", mapping);
  document.querySelectorAll("[data-edit]").forEach(
    (b) =>
      (b.onclick = () => {
        const [type, id] = b.dataset.edit.split(":");
        editEntity(type, find(type, id));
      }),
  );
  document
    .querySelectorAll("[data-status]")
    .forEach((b) => (b.onclick = () => changeStatus(b)));
  document
    .querySelectorAll("[data-current-record]")
    .forEach((b) => (b.onclick = () => makeCurrent(b)));
  document.querySelector("#create-session-rollover")?.addEventListener("click", () => editEntity("session"));
  document.querySelector("#manage-promotions")?.addEventListener("click", promotionManagement);
  document.querySelector("#historical-review")?.addEventListener("click", openHistoricalReview);
  document.querySelectorAll("[data-reconcile]").forEach((b) => (b.onclick = () => reconcileSession(b.dataset.reconcile)));
  document.querySelectorAll("[data-map-status]").forEach(
    (b) =>
      (b.onclick = async () => {
        await api.post("/api/administration/curriculum-status", {
          id: b.dataset.mapStatus,
          status: b.dataset.current === "Active" ? "Inactive" : "Active",
        });
        showToast("Curriculum mapping updated.");
        render(context);
      }),
  );
  document
    .querySelectorAll("[data-reset]")
    .forEach((b) => (b.onclick = () => reset(b.dataset.reset)));
}
async function openHistoricalReview(filters = {}) {
  const result = await api.post("/api/administration/historical-enrolments", { limit: 100, ...filters }),
    dialog = document.createElement("dialog"), rows = result.rows || [];
  dialog.className = "dialog compiled-result-dialog";
  dialog.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">Historical Enrolment Review</p><h2>Administrator review queue</h2><p>${rows.length} of ${result.total || 0} flagged records</p></div><button class="icon-btn" data-close>×</button></div><div class="toolbar"><input id="history-search" aria-label="Search historical enrolments" placeholder="Student, admission number, class or session" value="${e(filters.search||"")}"><select id="history-status"><option value="">All statuses</option><option value="PENDING">Pending</option><option value="CONFIRMED">Confirmed</option><option value="CORRECTED">Corrected</option><option value="ARCHIVED">Archived</option></select><select id="history-classification"><option value="">All evidence classes</option><option value="AMBIGUOUS">Ambiguous</option><option value="SUPPORTED_BY_ACADEMIC_EVIDENCE">Supported by academic evidence</option></select><button class="btn btn-secondary" id="history-filter">Apply filters</button></div>${table(["Student", "Admission date", "Session", "Class and arm", "Status", "Evidence", "Action"], rows.map((x) => { const d=x.Details||{}, evidence=Number(d.scoreCount||0)+Number(d.resultCount||0)+Number(d.reportCount||0)+Number(d.historyCount||0); return [e(`${x.FirstName||""} ${x.MiddleName||""} ${x.LastName||""}`),e(x.AdmissionDate||d.admissionDate||"—"),e(x.SessionName||d.sessionName||"—"),e(`${x.ClassName||"—"} ${x.ArmName||""}`),badge(x.ReviewStatus||"Pending"),e(`${d.classification||"AMBIGUOUS"} · ${evidence} evidence records`),`<button class="btn btn-primary" data-review="${x.ID}">Review</button>`]; }),"No historical enrolments require review.")}<div class="dialog-actions"><button class="btn btn-primary" data-close>Done</button></div>`;
  document.body.appendChild(dialog);
  dialog.querySelectorAll("[data-close]").forEach((b) => b.onclick = () => dialog.close());
  dialog.querySelectorAll("[data-review]").forEach((b) => b.onclick = () => reviewHistoricalRecord(rows.find((x) => x.ID === b.dataset.review), dialog));
  dialog.querySelector("#history-status").value = filters.status || "";
  dialog.querySelector("#history-classification").value = filters.classification || "";
  dialog.querySelector("#history-filter").onclick = () => { const next={search:dialog.querySelector("#history-search").value,status:dialog.querySelector("#history-status").value,classification:dialog.querySelector("#history-classification").value}; dialog.close(); openHistoricalReview(next); };
  dialog.onclose = () => dialog.remove(); dialog.showModal();
}
function reviewHistoricalRecord(row, parentDialog) {
  const classes = option(data.classes || [], "ClassID", (x) => x.ClassName), arms = option(data.classArms || [], "ClassArmID", (x) => `${x.ClassName||""} ${x.ArmName}`);
  formDialog("Review historical enrolment", [
    {name:"decision",label:"Decision",required:true,options:[{value:"PENDING",label:"Keep pending review"},{value:"CONFIRM",label:"Confirm historical enrolment"},{value:"CORRECT_ADMISSION_DATE",label:"Correct admission date"},{value:"CORRECT_PLACEMENT",label:"Correct historical placement"},{value:"ARCHIVE",label:"Archive invalid enrolment"}]},
    {name:"reason",label:"Reason and supporting evidence",required:true},
    {name:"admissionDate",label:"Corrected admission date",type:"date"},
    {name:"classId",label:"Corrected class",options:classes},
    {name:"classArmId",label:"Corrected arm",options:arms},
  ], async (values) => {
    if (!(await confirmDialog("Apply historical review decision", "This action is audited and may change the student's historical placement or admission date.", {confirmLabel:"Apply decision",danger:values.decision==="ARCHIVE"}))) return;
    await api.post("/api/administration/historical-enrolments/decision", {conflictId:row.ID,...values});
    showToast("Historical review decision recorded."); parentDialog.close(); await openHistoricalReview();
  });
}
function editGradingRules() {
  const rules = (data.gradingRules || []).filter((x) => x.Status === "Active");
  const dialog = document.createElement("dialog");
  dialog.className = "dialog grading-dialog";
  dialog.innerHTML = `<form><div class="dialog-head"><div><p class="eyebrow">0–100 inclusive</p><h2>Edit Grading Rules</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></div><p class="support">Adjust the boundaries as one complete scheme. Every score must belong to exactly one grade.</p><div class="grading-editor">${rules.map((rule,index)=>`<div class="grading-row"><label>Grade<input name="grade-${index}" value="${e(rule.Grade)}" required maxlength="30"></label><label>Minimum<input name="minimum-${index}" type="number" min="0" max="100" step="1" value="${e(wholeNumber(rule.MinimumScore))}" required></label><label>Maximum<input name="maximum-${index}" type="number" min="0" max="100" step="1" value="${e(wholeNumber(rule.MaximumScore))}" required></label><label>Remark<input name="remark-${index}" value="${e(rule.Remark||"")}"></label></div>`).join("")}</div><div class="form-error" role="alert"></div><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save Grading Rules</button></div></form>`;
  document.body.appendChild(dialog);
  dialog.querySelectorAll("[data-close]").forEach((button)=>button.onclick=()=>dialog.close());
  dialog.addEventListener("close",()=>dialog.remove(),{once:true});
  dialog.querySelector("form").onsubmit=async(event)=>{event.preventDefault();const form=event.currentTarget,values=new FormData(form),payload=rules.map((_,index)=>({grade:values.get(`grade-${index}`),minimumScore:values.get(`minimum-${index}`),maximumScore:values.get(`maximum-${index}`),remark:values.get(`remark-${index}`)})),button=event.submitter,error=form.querySelector(".form-error");error.textContent="";button.disabled=true;try{await api.post("/api/administration/mutate",{operation:"update",entity:"gradingRules",data:{rules:payload}});dialog.close();showToast("Grading rules updated.");await render(context);}catch(problem){error.textContent=problem.message||"The grading rules could not be saved.";}finally{button.disabled=false;}};
  dialog.showModal();
}
function editSchool() {
  const p = data.profile || {};
  formDialog(
    "School profile",
    [
      {
        name: "schoolName",
        label: "School name",
        value: p.name,
        required: true,
      },
      { name: "schoolAddress", label: "Address", value: p.address },
      { name: "schoolEmail", label: "Email", type: "email", value: p.email },
      { name: "schoolPhone", label: "Phone", value: p.phone },
      { name: "schoolMotto", label: "Motto", value: p.motto },
      {
        name: "principalName",
        label: "Principal / Head Teacher",
        value: p.principal_name,
      },
    ],
    saveSchool,
  );
}
const definitions = {
  session: {
    title: "academic session",
    fields: (r) => [
      {
        name: "sessionName",
        label: "Session name",
        value: r?.SessionName,
        required: true,
      },
      {
        name: "startDate",
        label: "Start date",
        type: "date",
        value: r?.StartDate,
      },
      { name: "endDate", label: "End date", type: "date", value: r?.EndDate },
      {
        name: "sourceSessionId",
        label: "Carry forward from",
        options: [{ value: "", label: "Automatically select previous session" }, ...(data.academicSessions || []).filter(x => x.SessionID !== r?.SessionID).map(x => ({ value: x.SessionID, label: x.SessionName }))],
        value: "",
      },
    ],
  },
  term: {
    title: "term",
    fields: (r) => [
      {
        name: "sessionId",
        label: "Academic session",
        options: option(
          data.academicSessions || [],
          "SessionID",
          (x) => x.SessionName,
        ),
        value: r?.SessionID || data.currentSession?.SessionID,
        required: true,
      },
      {
        name: "termName",
        label: "Term name",
        value: r?.TermName,
        required: true,
      },
      {
        name: "startDate",
        label: "Start date",
        type: "date",
        value: r?.StartDate,
      },
      { name: "endDate", label: "End date", type: "date", value: r?.EndDate },
    ],
  },
  class: {
    title: "class",
    fields: (r) => [
      {
        name: "className",
        label: "Class name",
        value: r?.ClassName,
        required: true,
      },
      {
        name: "sortOrder",
        label: "Display order",
        type: "number",
        value: r?.SortOrder ?? 0,
        required: true,
      },
    ],
  },
  arm: {
    title: "class arm",
    fields: (r) => [
      {
        name: "classId",
        label: "Class",
        options: option(data.classes || [], "ClassID", (x) => x.ClassName),
        value: r?.ClassID,
        required: true,
      },
      { name: "armName", label: "Arm name", value: r?.ArmName, required: true },
    ],
  },
  subject: {
    title: "subject",
    fields: (r) => [
      {
        name: "subjectCode",
        label: "Subject code",
        value: r?.SubjectCode,
        required: true,
      },
      {
        name: "subjectName",
        label: "Subject name",
        value: r?.SubjectName,
        required: true,
      },
    ],
  },
  assessmentStructure: {
    title: "assessment component",
    fields: (r) => [
      {
        name: "assessmentCode",
        label: "Code",
        value: r?.AssessmentCode,
        required: true,
      },
      {
        name: "assessmentName",
        label: "Component name",
        value: r?.AssessmentName,
        required: true,
      },
      {
        name: "category",
        label: "Category",
        value: r?.Category,
        required: true,
      },
      {
        name: "maximumScore",
        label: "Maximum score",
        type: "number",
        value: r?.MaximumScore,
        required: true,
      },
      {
        name: "weight",
        label: "Weight (%)",
        type: "number",
        value: r?.Weight,
        required: true,
      },
    ],
  },
  gradingRule: {
    title: "grading rule",
    fields: (r) => [
      { name: "grade", label: "Grade", value: r?.Grade, required: true },
      {
        name: "minimumScore",
        label: "Minimum score",
        type: "number",
        value: r?.MinimumScore,
        required: true,
      },
      {
        name: "maximumScore",
        label: "Maximum score",
        type: "number",
        value: r?.MaximumScore,
        required: true,
      },
      { name: "remark", label: "Remark", value: r?.Remark },
      {
        name: "sortOrder",
        label: "Display order",
        type: "number",
        value: r?.SortOrder ?? 0,
        required: true,
      },
    ],
  },
  user: {
    title: "system user",
    fields: (r) => [
      {
        name: "email",
        label: "Email",
        type: "email",
        value: r?.Email,
        required: true,
      },
      {
        name: "role",
        label: "Role",
        options: ["IT_ADMIN", "MANAGEMENT", "TEACHER", "PARENT"].map((x) => ({
          value: x,
          label: x.replaceAll("_", " "),
        })),
        value: r?.Role,
        required: true,
      },
    ],
  },
};
function editEntity(type, row) {
  const def = definitions[type];
  formDialog(
    `${row ? "Edit" : "Add"} ${def.title}`,
    def.fields(row),
    async (values) => {
      if (row) values[idName(type)] = recordId(type, row);
      else values.status = "Active";
      if (type === "session" && !row) {
        const preview = await api.post("/api/administration/session-rollover/preview", values);
        const count = preview.counts || {};
        const confirmed = await confirmDialog(
          "Create session and carry forward structure",
          `Source: ${preview.sourceSession?.SessionName || "None (first session)"}\nEligible students: ${count.eligibleStudents || 0}\nSubject teachers: ${count.subjectTeachers || 0}\nSubject assignments: ${count.subjectTeacherAssignments || 0}\nForm teachers: ${count.formTeacherAssignments || 0}\nCurriculum mappings: ${count.curriculumMappings || 0}`,
          { confirmLabel: "Create session" },
        );
        if (!confirmed) return;
        const result = await api.post("/api/administration/session-rollover/create", values);
        const copied = result.rollover || {};
        showToast(`Session created: ${copied.studentsCreated || 0} students, ${(copied.subjectAssignmentsCreated || 0) + (copied.formTeacherAssignmentsCreated || 0)} teacher assignments and ${copied.curriculumMappingsCreated || 0} curriculum mappings carried forward.`, 9000);
        await render(context);
        return;
      }
      const result = await api.post("/api/administration/mutate", {
        operation: row ? "update" : "create",
        entity: type,
        data: values,
      });
      showToast(
        result?.temporaryPassword
          ? `User created. Temporary password: ${result.temporaryPassword}`
          : `${def.title} saved.`,
        result?.temporaryPassword ? 12000 : 4500,
      );
      await render(context);
    },
  );
}

async function reconcileSession(targetSessionId) {
  const preview = await api.post("/api/administration/session-rollover/preview", { targetSessionId });
  if (!preview.sourceSession) return showToast("No earlier source session is available.");
  if (!(await confirmDialog("Reconcile session", `Restore only missing continuity records from ${preview.sourceSession.SessionName}. Existing placements, assignments and results will remain unchanged.`, { confirmLabel: "Reconcile missing records" }))) return;
  const result = await api.post("/api/administration/session-rollover/reconcile", { targetSessionId, sourceSessionId: preview.sourceSession.SessionID });
  const copied = result.rollover || {};
  showToast(`Reconciled ${copied.studentsCreated || 0} enrolments, ${(copied.subjectAssignmentsCreated || 0) + (copied.formTeacherAssignmentsCreated || 0)} assignments and ${copied.curriculumMappingsCreated || 0} mappings.`, 8000);
  await render(context);
}

function promotionManagement() {
  const sessions = (data.academicSessions || []).filter(x => x.Status === "Active"), classes = (data.classes || []).filter(x => x.Status === "Active"), arms = (data.classArms || []).filter(x => x.Status === "Active");
  formDialog("Student Promotion Management", [
    { name: "action", label: "Action", required: true, options: [
      { value: "PROMOTION", label: "Promote" }, { value: "RETENTION", label: "Retain in class" },
      { value: "TRANSFER", label: "Transfer class or arm" }, { value: "CORRECTION", label: "Correct placement" },
      { value: "GRADUATION", label: "Mark graduated" }, { value: "WITHDRAWAL", label: "Mark withdrawn" },
    ] },
    { name: "sourceSessionId", label: "Source session", required: true, options: sessions.map(x => ({ value: x.SessionID, label: x.SessionName })) },
    { name: "sourceClassId", label: "Source class", required: true, options: classes.map(x => ({ value: x.ClassID, label: x.ClassName })) },
    { name: "sourceClassArmId", label: "Source arm", options: [{ value: "", label: "No arm" }, ...arms.map(x => ({ value: x.ClassArmID, label: `${classes.find(c => c.ClassID === x.ClassID)?.ClassName || "Class"} — ${x.ArmName}` }))] },
    { name: "targetSessionId", label: "Target session", required: true, options: sessions.map(x => ({ value: x.SessionID, label: x.SessionName })) },
    { name: "targetClassId", label: "Destination class", required: true, options: classes.map(x => ({ value: x.ClassID, label: x.ClassName })) },
    { name: "targetClassArmId", label: "Destination arm", options: [{ value: "", label: "No arm" }, ...arms.map(x => ({ value: x.ClassArmID, label: `${classes.find(c => c.ClassID === x.ClassID)?.ClassName || "Class"} — ${x.ArmName}` }))] },
    { name: "effectiveDate", label: "Effective date", type: "date", required: true },
    { name: "reason", label: "Reason" },
  ], async values => {
    const roster = await api.post("/api/administration/promotions/roster", { sessionId: values.sourceSessionId, classId: values.sourceClassId, classArmId: values.sourceClassArmId || null });
    if (!roster.rows?.length) throw new Error("No students are enrolled in the selected source class.");
    const sourceClass = classes.find(x => x.ClassID === values.sourceClassId)?.ClassName || "Selected class", targetClass = classes.find(x => x.ClassID === values.targetClassId)?.ClassName || "destination";
    if (!(await confirmDialog("Confirm bulk promotion", `${roster.rows.length} students selected\nCurrent class: ${sourceClass}\nDestination: ${targetClass}\nExcluded inactive students will be reported.`, { confirmLabel: `Promote ${roster.rows.length} students` }))) return;
    const result = await api.post("/api/administration/promotions/apply", { ...values, studentIds: roster.rows.map(x => x.StudentID) });
    showToast(`${result.updated || 0} students placed; ${result.excluded || 0} excluded.`, 7000);
  });
}
function mapping() {
  formDialog(
    "Map subject to class",
    [
      {
        name: "classId",
        label: "Class",
        options: option(data.classes || [], "ClassID", (x) => x.ClassName),
        required: true,
      },
      {
        name: "subjectId",
        label: "Subject",
        options: option(
          data.subjects || [],
          "SubjectID",
          (x) => `${x.SubjectCode} — ${x.SubjectName}`,
        ),
        required: true,
      },
    ],
    async (values) => {
      await api.post("/api/administration/curriculum", values);
      showToast("Curriculum mapping saved.");
      await render(context);
    },
  );
}
async function saveSchool(values) {
  await api.post("/api/administration/mutate", {
    operation: "update",
    entity: "school",
    data: values,
  });
  showToast("School profile updated.");
  await render(context);
}
async function changeStatus(button) {
  const [type, id, current] = button.dataset.status.split(":"),
    next = current === "Active" ? "Inactive" : "Active";
  if (
    !(await confirmDialog("Change status", `Set this record to ${next}?`, {
      confirmLabel: `Set ${next}`,
    }))
  )
    return;
  await api.post("/api/administration/status", {
    entity: type,
    id,
    status: next,
  });
  showToast("Status updated.");
  await render(context);
}
async function makeCurrent(button) {
  const [type, id] = button.dataset.currentRecord.split(":");
  await api.post("/api/administration/mutate", {
    operation: "current",
    entity: type,
    data: { [idName(type)]: id },
  });
  showToast(`Current ${type} updated.`);
  await render(context);
}
async function reset(id) {
  if (
    !(await confirmDialog(
      "Reset password",
      "Create a new temporary password and revoke active sessions?",
      { confirmLabel: "Reset password" },
    ))
  )
    return;
  const result = await api.post("/api/administration/reset-password", {
    userId: id,
  });
  showToast(`Temporary password: ${result.temporaryPassword}`, 12000);
}
const collections = {
    session: "academicSessions",
    term: "terms",
    class: "classes",
    arm: "classArms",
    subject: "subjects",
    assessmentStructure: "assessmentStructures",
    gradingRule: "gradingRules",
    user: "users",
  },
  ids = {
    session: "SessionID",
    term: "TermID",
    class: "ClassID",
    arm: "ClassArmID",
    subject: "SubjectID",
    assessmentStructure: "StructureID",
    gradingRule: "GradingRuleID",
    user: "UserID",
  };
const idName = (x) =>
  ({
    session: "sessionId",
    term: "termId",
    class: "classId",
    arm: "classArmId",
    subject: "subjectId",
    assessmentStructure: "structureId",
    gradingRule: "gradingRuleId",
    user: "userId",
  })[x];
const recordId = (type, row) => row[ids[type]],
  find = (type, id) =>
    (data[collections[type]] || []).find(
      (x) => String(recordId(type, x)) === id,
    );

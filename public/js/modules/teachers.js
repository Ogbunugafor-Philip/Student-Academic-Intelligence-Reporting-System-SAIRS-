import {
  hero,
  setMain,
  table,
  badge,
  escapeHtml,
  formDialog,
  showToast,
  confirmDialog,
} from "../ui.js";
import { cachedThenNetwork, name } from "./_shared.js";
import { api } from "../api.js";
import { file, LIMITS } from "../validation.js";

export async function render(ctx) {
  const response = await cachedThenNetwork(
      "teachers",
      "/api/teachers/bootstrap",
      ctx.offline,
    ),
    data = response.data || {},
    assignments = data.initialAssignments || [],
    classes = (data.classes || []).filter((x) => x.Status === "Active"),
    arms = (data.classArms || []).filter((x) => x.Status === "Active"),
    subjects = (data.subjects || []).filter((x) => x.Status === "Active"),
    classNames = new Map(classes.map((x) => [x.ClassID, x.ClassName]));
  let teachers = data.initialTeachers || data.teachers || [];
  const actions = ctx.offline
    ? ""
    : `<div><button class="btn btn-secondary" id="import-teachers">Import Teachers</button> <button class="btn btn-primary" id="add-teacher">Add Teacher</button></div>`;
  const coverage = (data.formTeacherCoverage || []).map((item) => [
    escapeHtml(classNames.get(item.ClassID) || "—"),
    escapeHtml(item.ArmName),
    item.Assigned
      ? `<span class="coverage-ok">✓ ${escapeHtml(item.TeacherName || "Assigned")}</span>`
      : '<span class="coverage-missing">Missing</span>',
  ]);
  setMain(
    hero(
      "teachers",
      "Teaching workforce",
      "Teachers & responsibilities",
      "Teaching profiles, form-class leadership and subject assignments.",
      [data.currentSession?.SessionName || "Session not configured"],
    ) +
      `<section class="card"><div class="section-head"><div><h2>Teaching workforce</h2><p>Create teacher accounts and manage academic responsibilities.</p></div>${actions}</div><div class="toolbar"><input id="teacher-search" aria-label="Search teachers" placeholder="Search staff, teacher, subject, class or assignment type"></div><div id="teacher-table">${table(
        ["Staff no.", "Teacher", "Email", "Status", "Actions"],
        teachers.map((t) => [
          escapeHtml(t.StaffNumber),
          escapeHtml(name(t)),
          escapeHtml(t.Email || "—"),
          badge(t.Status),
          ctx.offline
            ? "Offline copy"
            : `<button class="btn btn-quiet" data-view="${t.TeacherID}">View</button><button class="btn btn-quiet" data-edit="${t.TeacherID}">Edit</button><button class="btn btn-quiet" data-assign="${t.TeacherID}">Add responsibility</button><button class="btn btn-quiet" data-status="${t.TeacherID}" data-current="${t.Status}">${t.Status === "Active" ? "Deactivate" : "Activate"}</button>`,
        ]),
        "No teacher records are available.",
      )}</div><div class="dialog-actions" id="teacher-pages"><button class="btn btn-secondary" data-page="previous" disabled>Previous</button><span>Page 1</span><button class="btn btn-secondary" data-page="next">Next</button></div></section><section class="card"><div class="section-head"><div><p class="eyebrow">Academic readiness</p><h2>Form Teacher Coverage</h2><p>Every active class arm should have one active Form Teacher.</p></div><span class="progress-label">${coverage.filter((x) => x[2].includes("coverage-ok")).length} of ${coverage.length} assigned</span></div>${table(["Class", "Arm", "Coverage"], coverage, "Configure active class arms to track coverage.")}</section>`,
    "Teachers",
  );
  document
    .querySelector("#add-teacher")
    ?.addEventListener("click", () => teacherOnboardingDialog());
  document
    .querySelector("#import-teachers")
    ?.addEventListener("click", teacherImportDialog);
  let page = 0,
    total = teachers.length,
    searchTimer;
  const drawTeachers = () => {
    document.querySelector("#teacher-table").innerHTML = table(
      ["Staff no.", "Teacher", "Email", "Status", "Actions"],
      teachers.map((t) => [
        escapeHtml(t.StaffNumber),
        escapeHtml(name(t)),
        escapeHtml(t.Email || "—"),
        badge(t.Status),
        ctx.offline
          ? "Offline copy"
          : `<button class="btn btn-quiet" data-view="${t.TeacherID}">View</button><button class="btn btn-quiet" data-edit="${t.TeacherID}">Edit</button><button class="btn btn-quiet" data-assign="${t.TeacherID}">Add responsibility</button><button class="btn btn-quiet" data-status="${t.TeacherID}" data-current="${t.Status}">${t.Status === "Active" ? "Deactivate" : "Activate"}</button>`,
      ]),
      "No matching teachers.",
    );
    bindTeacherRows();
  };
  const loadTeachers = async (nextPage = 0) => {
    if (ctx.offline) return;
    const result = await api.post("/api/teachers/list", {
      search: document.querySelector("#teacher-search").value,
      limit: 25,
      offset: nextPage * 25,
    });
    teachers = result.rows || [];
    total = Number(result.total || 0);
    page = nextPage;
    drawTeachers();
    const pages = document.querySelector("#teacher-pages");
    pages.querySelector("span").textContent =
      `Page ${page + 1} of ${Math.max(1, Math.ceil(total / 25))}`;
    pages.querySelector('[data-page="previous"]').disabled = page === 0;
    pages.querySelector('[data-page="next"]').disabled =
      (page + 1) * 25 >= total;
  };
  document.querySelector("#teacher-search")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadTeachers(0), 250);
  });
  document
    .querySelector('#teacher-pages [data-page="previous"]')
    ?.addEventListener("click", () => loadTeachers(page - 1));
  document
    .querySelector('#teacher-pages [data-page="next"]')
    ?.addEventListener("click", () => loadTeachers(page + 1));
  function bindTeacherRows() {
    document
      .querySelectorAll("[data-view]")
      .forEach(
        (button) => (button.onclick = () => detailDialog(button.dataset.view)),
      );
    document
      .querySelectorAll("[data-edit]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            editDialog(
              teachers.find((x) => x.TeacherID === button.dataset.edit),
            )),
      );
    document
      .querySelectorAll("[data-assign]")
      .forEach(
        (button) =>
          (button.onclick = () => responsibilityDialog(button.dataset.assign)),
      );
    document.querySelectorAll("[data-status]").forEach(
      (button) =>
        (button.onclick = async () => {
          const next =
            button.dataset.current === "Active" ? "Inactive" : "Active";
          if (
            !(await confirmDialog(
              "Change teacher status",
              `Set this teacher to ${next}?`,
              { confirmLabel: `Set ${next}` },
            ))
          )
            return;
          await api.post("/api/teachers/status", {
            teacherId: button.dataset.status,
            status: next,
          });
          showToast("Teacher status updated.");
          await render(ctx);
        }),
    );
  }
  bindTeacherRows();
  if (!ctx.offline) loadTeachers(0);
  const option = (value, label) =>
      `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`,
    classOptions = () =>
      classes.map((x) => option(x.ClassID, x.ClassName)).join(""),
    subjectOptions = () =>
      subjects.map((x) => option(x.SubjectID, x.SubjectName)).join(""),
    armOptions = (classId) =>
      arms
        .filter((x) => x.ClassID === classId)
        .map((x) => option(x.ClassArmID, x.ArmName))
        .join("");
  function teacherOnboardingDialog() {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog teacher-dialog";
    dialog.innerHTML = `<form novalidate><div class="dialog-head"><div><p class="eyebrow">Teacher onboarding</p><h2>Add Teacher</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></div><fieldset><legend>Teacher information</legend><div class="onboarding-grid"><label>Staff Number *<input name="staffNumber" required maxlength="80"></label><label>Email Address *<input name="email" type="email" required maxlength="254" autocomplete="email"></label><label>First Name *<input name="firstName" required maxlength="100"></label><label>Middle Name<input name="middleName" maxlength="100"></label><label>Last Name *<input name="lastName" required maxlength="100"></label><label>Phone Number *<input name="phone" type="tel" required maxlength="80"></label></div></fieldset><fieldset><legend>Form class responsibility</legend><label class="check-label"><input type="checkbox" name="isFormTeacher"> Is this teacher a Form/Class Teacher?</label><div class="onboarding-grid form-scope" hidden><label>Class *<select name="formClassId"><option value="">Select class</option>${classOptions()}</select></label><label>Class Arm *<select name="formClassArmId" disabled><option value="">Select a class first</option></select></label></div></fieldset><fieldset><legend>Subject responsibilities</legend><div class="subject-builder"></div><button class="btn btn-secondary" type="button" data-add-subject>+ Add Subject Assignment</button></fieldset><div class="form-error" role="alert"></div><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Create Teacher &amp; Account</button></div></form>`;
    document.body.appendChild(dialog);
    const form = dialog.querySelector("form"),
      formScope = dialog.querySelector(".form-scope"),
      formClass = form.elements.formClassId,
      formArm = form.elements.formClassArmId,
      builder = dialog.querySelector(".subject-builder");
    form.elements.isFormTeacher.onchange = () => {
      formScope.hidden = !form.elements.isFormTeacher.checked;
    };
    formClass.onchange = () => {
      formArm.innerHTML = formClass.value
        ? `<option value="">Select class arm</option>${armOptions(formClass.value)}`
        : '<option value="">Select a class first</option>';
      formArm.disabled = !formClass.value;
    };
    const addRow = () => {
      const row = document.createElement("div");
      row.className = "subject-assignment-row";
      row.innerHTML = `<label>Subject *<select data-subject><option value="">Select subject</option>${subjectOptions()}</select></label><label>Class *<select data-class><option value="">Select class</option>${classOptions()}</select></label><label>Class Arm *<select data-arm disabled><option value="">Select a class first</option></select></label><button class="btn btn-quiet" type="button" data-remove>Remove</button>`;
      const classSelect = row.querySelector("[data-class]"),
        armSelect = row.querySelector("[data-arm]");
      classSelect.onchange = () => {
        armSelect.innerHTML = classSelect.value
          ? `<option value="">Select class arm</option><option value="ALL">All Arms</option>${armOptions(classSelect.value)}`
          : '<option value="">Select a class first</option>';
        armSelect.disabled = !classSelect.value;
      };
      row.querySelector("[data-remove]").onclick = () => row.remove();
      builder.appendChild(row);
    };
    dialog.querySelector("[data-add-subject]").onclick = addRow;
    dialog
      .querySelectorAll("[data-close]")
      .forEach((x) => (x.onclick = () => dialog.close()));
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    form.onsubmit = async (event) => {
      event.preventDefault();
      const error = dialog.querySelector(".form-error");
      error.textContent = "";
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form)),
        subjectAssignments = [
          ...builder.querySelectorAll(".subject-assignment-row"),
        ].map((row) => ({
          subjectId: row.querySelector("[data-subject]").value,
          classId: row.querySelector("[data-class]").value,
          classArmId: row.querySelector("[data-arm]").value,
        }));
      if (
        subjectAssignments.some(
          (x) => !x.subjectId || !x.classId || !x.classArmId,
        )
      ) {
        error.textContent =
          "Complete every subject assignment or remove the incomplete row.";
        return;
      }
      const payload = {
        staffNumber: values.staffNumber,
        firstName: values.firstName,
        middleName: values.middleName,
        lastName: values.lastName,
        email: values.email,
        phone: values.phone,
        formTeacher: values.isFormTeacher
          ? { classId: values.formClassId, classArmId: values.formClassArmId }
          : null,
        subjectAssignments,
      };
      if (
        values.isFormTeacher &&
        (!values.formClassId || !values.formClassArmId)
      ) {
        error.textContent = "Select the Form Teacher class and class arm.";
        return;
      }
      const button = event.submitter;
      button.disabled = true;
      button.textContent = "Creating…";
      try {
        const result = await api.post("/api/teachers/create", payload);
        dialog.close();
        await teacherCredentialsDialog(result);
        await render(ctx);
      } catch (problem) {
        error.textContent =
          problem.message || "The teacher could not be created.";
        button.disabled = false;
        button.textContent = "Create Teacher & Account";
      }
    };
    dialog.showModal();
    form.elements.staffNumber.focus();
  }
  function editDialog(teacher) {
    formDialog(
      "Edit Teacher",
      [
        {
          name: "staffNumber",
          label: "Staff Number",
          value: teacher.StaffNumber,
          required: true,
        },
        {
          name: "firstName",
          label: "First Name",
          value: teacher.FirstName,
          required: true,
        },
        {
          name: "middleName",
          label: "Middle Name",
          value: teacher.MiddleName || "",
        },
        {
          name: "lastName",
          label: "Last Name",
          value: teacher.LastName,
          required: true,
        },
        {
          name: "email",
          label: "Email Address",
          type: "email",
          value: teacher.Email,
          required: true,
        },
        {
          name: "phone",
          label: "Phone Number",
          value: teacher.Phone,
          required: true,
        },
      ],
      async (values) => {
        await api.post("/api/teachers/update", {
          teacherId: teacher.TeacherID,
          ...values,
        });
        showToast("Teacher details updated.");
        await render(ctx);
      },
    );
  }
  function responsibilityDialog(teacherId) {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog";
    dialog.innerHTML = `<form><div class="dialog-head"><h2>Add Teaching Responsibility</h2><button class="icon-btn" type="button" data-close>×</button></div><div class="grid"><label>Responsibility Type<select name="assignmentType"><option value="FORM_TEACHER">Form / Class Teacher</option><option value="SUBJECT_TEACHER">Subject Teacher</option></select></label><label data-subject-wrap hidden>Subject<select name="subjectId"><option value="">Select subject</option>${subjectOptions()}</select></label><label>Class<select name="classId"><option value="">Select class</option>${classOptions()}</select></label><label>Class Arm<select name="classArmId" disabled><option value="">Select a class first</option></select></label></div><div class="form-error"></div><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary">Add Responsibility</button></div></form>`;
    document.body.appendChild(dialog);
    const form = dialog.querySelector("form"),
      type = form.elements.assignmentType,
      classSelect = form.elements.classId,
      armSelect = form.elements.classArmId,
      subjectWrap = dialog.querySelector("[data-subject-wrap]");
    const updateType = () => {
      subjectWrap.hidden = type.value !== "SUBJECT_TEACHER";
      if (classSelect.value) {
        armSelect.innerHTML = `<option value="">Select class arm</option>${type.value === "SUBJECT_TEACHER" ? '<option value="ALL">All Arms</option>' : ""}${armOptions(classSelect.value)}`;
      }
    };
    type.onchange = updateType;
    classSelect.onchange = () => {
      armSelect.disabled = !classSelect.value;
      updateType();
    };
    dialog
      .querySelectorAll("[data-close]")
      .forEach((x) => (x.onclick = () => dialog.close()));
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form)),
        error = dialog.querySelector(".form-error");
      if (
        !values.classId ||
        !values.classArmId ||
        (values.assignmentType === "SUBJECT_TEACHER" && !values.subjectId)
      ) {
        error.textContent = "Complete the responsibility details.";
        return;
      }
      try {
        await api.post("/api/teachers/assign", { teacherId, ...values });
        dialog.close();
        showToast("Responsibility added.");
        await render(ctx);
      } catch (problem) {
        error.textContent = problem.message;
      }
    };
    dialog.showModal();
  }
  async function detailDialog(teacherId) {
    const result = await api.post("/api/teachers/details", { teacherId }),
      teacher = result.teacher,
      own = (result.assignments || []).filter((x) => x.Status === "Active"),
      assignmentCards = own.length
        ? `<div class="teacher-assignment-list">${own
            .map((x) => {
              const type =
                x.DisplayAssignmentType ||
                (x.AssignmentType === "CLASS_TEACHER"
                  ? "FORM_TEACHER"
                  : x.AssignmentType);
              return `<article class="teacher-assignment-row"><div class="assignment-field assignment-type"><small>Assignment Type</small><strong>${escapeHtml(String(type).replaceAll("_", " "))}</strong></div><div class="assignment-field assignment-subject"><small>Subject</small><strong>${escapeHtml(x.SubjectName || "—")}</strong></div><div class="assignment-field"><small>Class</small><strong>${escapeHtml(x.ClassName || "—")}</strong></div><div class="assignment-field"><small>Arm</small><strong>${escapeHtml(x.ArmName || "—")}</strong></div><button class="btn btn-quiet" data-deactivate="${x.AssignmentID}">Deactivate</button></article>`;
            })
            .join("")}</div>`
        : '<p class="support">No active teaching assignments.</p>';
    const dialog = document.createElement("dialog");
    dialog.className = "dialog teacher-detail teacher-profile-dialog";
    dialog.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">Teacher profile</p><h2>${escapeHtml(name(teacher))}</h2></div><button class="icon-btn" data-close aria-label="Close">×</button></div><section><h3>Teacher Information</h3><dl class="detail-list"><div><dt>Teacher Name</dt><dd>${escapeHtml(name(teacher))}</dd></div><div><dt>Staff Number</dt><dd>${escapeHtml(teacher.StaffNumber || "—")}</dd></div><div><dt>Email / Username</dt><dd>${escapeHtml(teacher.Username || teacher.Email || "—")}</dd></div><div><dt>Phone</dt><dd>${escapeHtml(teacher.Phone || "—")}</dd></div><div><dt>Status</dt><dd>${escapeHtml(teacher.Status || "—")}</dd></div></dl></section><section><h3>Teaching Assignments</h3>${assignmentCards}</section><div class="dialog-actions"><button class="btn btn-primary" data-close>Done</button></div>`;
    document.body.appendChild(dialog);
    dialog
      .querySelectorAll("[data-close]")
      .forEach((x) => (x.onclick = () => dialog.close()));
    dialog.querySelectorAll("[data-deactivate]").forEach(
      (button) =>
        (button.onclick = async () => {
          if (
            !(await confirmDialog(
              "Deactivate responsibility",
              "Remove this active teaching responsibility?",
              { confirmLabel: "Deactivate" },
            ))
          )
            return;
          await api.post("/api/teachers/assignment-status", {
            assignmentId: button.dataset.deactivate,
            status: "Inactive",
          });
          dialog.close();
          showToast("Responsibility deactivated.");
          await render(ctx);
        }),
    );
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
  }
  function teacherImportDialog() {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog import-dialog";
    dialog.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">Bulk teacher onboarding</p><h2>Import Teachers &amp; Assignments</h2></div><button class="icon-btn" data-close>×</button></div><div class="import-actions"><button class="btn btn-secondary" data-template>Download Teacher Import Template</button><button class="btn btn-primary" data-upload>Choose XLSX Workbook</button><input type="file" accept=".xlsx" hidden></div><div class="import-feedback form-error"></div><div class="import-preview"></div><div class="dialog-actions"><button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" data-confirm disabled>Confirm Import</button></div>`;
    document.body.appendChild(dialog);
    const input = dialog.querySelector("input"),
      feedback = dialog.querySelector(".import-feedback"),
      preview = dialog.querySelector(".import-preview"),
      confirm = dialog.querySelector("[data-confirm]");
    let upload, result;
    dialog
      .querySelectorAll("[data-close]")
      .forEach((x) => (x.onclick = () => dialog.close()));
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.querySelector("[data-template]").onclick = async () => {
      try {
        const value = await api.get("/api/teachers/import/template");
        downloadBase64(value.base64, value.fileName, value.mimeType);
      } catch (error) {
        feedback.textContent = error.message;
      }
    };
    dialog.querySelector("[data-upload]").onclick = () => input.click();
    input.onchange = async () => {
      const selected = input.files[0],
        problem = file(selected, {
          types: [".xlsx"],
          maxSize: LIMITS.bulkFile,
        });
      if (problem) return (feedback.textContent = problem);
      feedback.textContent = "Validating workbook…";
      confirm.disabled = true;
      try {
        upload = {
          fileName: selected.name,
          mimeType: selected.type,
          base64: await readBase64(selected),
        };
        result = await api.post("/api/teachers/import/preview", {
          file: upload,
        });
        drawTeacherPreview(preview, result);
        feedback.textContent = result.errors.length
          ? "Correct all errors and upload the workbook again. No data was imported."
          : "Validation passed. Review and confirm the import.";
        confirm.disabled = Boolean(result.errors.length);
      } catch (error) {
        feedback.textContent = error.message;
      }
    };
    confirm.onclick = async () => {
      if (!upload || result?.errors?.length) return;
      if (
        !(await confirmDialog(
          "Confirm teacher import",
          `Import ${result.summary.teachersInFile} teachers and their responsibilities?`,
          { confirmLabel: "Import all" },
        ))
      )
        return;
      confirm.disabled = true;
      try {
        const imported = await api.post("/api/teachers/import", {
          file: upload,
        });
        dialog.close();
        await bulkTeacherResult(imported);
        await render(ctx);
      } catch (error) {
        feedback.textContent = error.message;
        confirm.disabled = false;
      }
    };
    dialog.showModal();
  }
}

const readBase64 = (value) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(value);
  });
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadBase64(base64, name, type) {
  downloadBlob(
    new Blob([Uint8Array.from(atob(base64), (x) => x.charCodeAt(0))], { type }),
    name,
  );
}
const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
function downloadCsv(name, headers, rows) {
  downloadBlob(
    new Blob(
      [
        "\uFEFF" +
          [headers, ...rows]
            .map((row) => row.map(csvCell).join(","))
            .join("\r\n"),
      ],
      { type: "text/csv" },
    ),
    name,
  );
}
function drawTeacherPreview(container, result) {
  const s = result.summary,
    errors = result.errors || [];
  container.innerHTML = `<div class="import-summary"><div><span>Teachers detected</span><strong>${s.teachersInFile}</strong></div><div><span>New teachers</span><strong>${s.newTeacherAccounts}</strong></div><div><span>Existing teachers</span><strong>${s.existingTeacherAccounts}</strong></div><div><span>Assignments detected</span><strong>${s.assignmentsDetected}</strong></div><div><span>Form Teacher assignments</span><strong>${s.formTeacherAssignments}</strong></div><div><span>Subject Teacher assignments</span><strong>${s.subjectAssignments}</strong></div><div><span>Classes detected</span><strong>${s.classesDetected}</strong></div><div><span>Subjects detected</span><strong>${s.subjectsDetected}</strong></div><div><span>Errors</span><strong>${errors.length}</strong></div></div>${errors.length ? '<button class="btn btn-secondary" data-errors>Download Error Report</button>' : ""}${table(
    ["Sheet", "Row", "Staff Number", "Status", "Issue"],
    [...(result.teachers || []), ...(result.assignments || [])].map((x) => [
      escapeHtml(x.Sheet),
      escapeHtml(x.Row),
      escapeHtml(x.StaffNumber),
      badge(x.Status),
      escapeHtml(x.Issue || "—"),
    ]),
    "No rows found.",
  )}`;
  container.querySelector("[data-errors]")?.addEventListener("click", () =>
    downloadCsv(
      "SAIRS-Teacher-Import-Errors.csv",
      ["Sheet", "Row", "Staff Number", "Issue"],
      errors.map((x) => [x.Sheet, x.Row, x.StaffNumber, x.Issue]),
    ),
  );
}
async function teacherCredentialsDialog(result) {
  const teacher = result.teacher,
    password = result.temporaryPassword,
    dialog = document.createElement("dialog");
  dialog.className = "dialog credential-dialog";
  dialog.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">Teacher onboarding complete</p><h2>Teacher created successfully</h2></div><button class="icon-btn" data-close>×</button></div>${password ? `<div class="success-panel"><p>Login Email</p><code>${escapeHtml(teacher.Email)}</code><p>Temporary Password</p><code>${escapeHtml(password)}</code><p class="credential-warning">The teacher must change this password on first login. It cannot be retrieved again.</p></div>` : '<div class="notice">The compatible existing teacher account was linked. Its password was not changed.</div>'}<div class="dialog-actions">${password ? '<button class="btn btn-secondary" data-copy>Copy Credentials</button>' : ""}<button class="btn btn-primary" data-close>Done</button></div>`;
  document.body.appendChild(dialog);
  dialog
    .querySelector("[data-copy]")
    ?.addEventListener("click", () =>
      navigator.clipboard.writeText(`${teacher.Email}\n${password}`),
    );
  dialog
    .querySelectorAll("[data-close]")
    .forEach((x) => (x.onclick = () => dialog.close()));
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}
async function bulkTeacherResult(result) {
  const s = result.summary,
    c = result.credentials || [],
    dialog = document.createElement("dialog");
  dialog.className = "dialog credential-dialog";
  dialog.innerHTML = `<div class="dialog-head"><h2>Teacher import completed</h2><button class="icon-btn" data-close>×</button></div><div class="import-result"><p><span>Teachers imported</span><strong>${s.teachersImported}</strong></p><p><span>Teacher accounts created</span><strong>${s.teacherAccountsCreated}</strong></p><p><span>Form Teacher assignments</span><strong>${s.formTeacherAssignments}</strong></p><p><span>Subject assignments</span><strong>${s.subjectAssignments}</strong></p><p><span>Expanded All-Arms assignments</span><strong>${s.expandedAllArmsAssignments}</strong></p></div>${c.length ? '<div class="notice"><strong>Download these teacher credentials now.</strong><br>Temporary passwords cannot be retrieved again after leaving this page.</div>' : ""}<div class="dialog-actions">${c.length ? '<button class="btn btn-secondary" data-download>Download New Teacher Credentials</button>' : ""}<button class="btn btn-primary" data-close>Done</button></div>`;
  document.body.appendChild(dialog);
  dialog.querySelector("[data-download]")?.addEventListener("click", () =>
    downloadCsv(
      "SAIRS-New-Teacher-Credentials.csv",
      [
        "Staff Number",
        "Teacher Name",
        "Email",
        "Temporary Password",
        "Login URL",
      ],
      c.map((x) => [
        x.StaffNumber,
        x.TeacherName,
        x.Email,
        x.TemporaryPassword,
        x.LoginUrl,
      ]),
    ),
  );
  dialog
    .querySelectorAll("[data-close]")
    .forEach((x) => (x.onclick = () => dialog.close()));
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

import {
  hero,
  setMain,
  table,
  badge,
  escapeHtml,
  formDialog,
  showToast,
  confirmDialog,
  showError,
} from "../ui.js";
import { cachedThenNetwork, name } from "./_shared.js";
import { api } from "../api.js";
import { file, LIMITS } from "../validation.js";
export async function render(ctx) {
  const r = await cachedThenNetwork(
      "students",
      "/api/students/bootstrap",
      ctx.offline,
    ),
    d = r.data || {};
  let list = d.initialStudents || d.students || [],
    classes = (d.classes || []).filter((x) => x.Status === "Active"),
    arms = (d.classArms || []).filter((x) => x.Status === "Active"),
    classNames = new Map(classes.map((x) => [x.ClassID, x.ClassName])),
    currentSession = (d.academicSessions || []).find(
      (x) => x.IsCurrent && x.Status === "Active",
    ),
    currentTerm = (d.terms || []).find(
      (x) =>
        x.IsCurrent &&
        x.Status === "Active" &&
        x.SessionID === currentSession?.SessionID,
    );
  const draw = () => {
    const q = ctx.offline
        ? (document.querySelector("#student-search")?.value || "").toLowerCase()
        : "",
      status = document.querySelector("#student-filter")?.value || "";
    const filtered = list.filter(
      (s) =>
        (!status || s.Status === status) &&
        [s.AdmissionNumber, name(s), classNames.get(s.ClassID)]
          .join(" ")
          .toLowerCase()
          .includes(q),
    );
    document.querySelector("#student-table").innerHTML = table(
      ["Admission no.", "Student", "Class", "Status", "Actions"],
      filtered.map((s) => [
        escapeHtml(s.AdmissionNumber),
        escapeHtml(name(s)),
        escapeHtml(classNames.get(s.ClassID) || "—"),
        badge(s.Status),
        ctx.offline
          ? "Offline copy"
          : `<button class="btn btn-quiet" data-view="${s.StudentID}">View</button><button class="btn btn-quiet" data-history="${s.StudentID}">Academic History</button><button class="btn btn-quiet" data-edit="${s.StudentID}">Edit</button><button class="btn btn-quiet" data-parent="${s.StudentID}">Link parent</button><button class="btn btn-quiet" data-promote="${s.StudentID}">Promote</button>${s.Status === "Active" ? `<button class="btn btn-quiet" data-graduate="${s.StudentID}">Mark as Graduated</button>` : ""}<button class="btn btn-quiet" data-status="${s.StudentID}" data-current="${s.Status}">${s.Status === "Active" ? "Deactivate" : "Activate"}</button>`,
      ]),
      "No matching students.",
    );
    bind();
  };
  setMain(
    hero(
      "students",
      "Student records",
      "Students & guardians",
      "Admissions, placements and each learner’s academic journey.",
      [r.cached ? "Offline copy" : "Current records"],
    ) +
      academicContextSection(ctx, d, currentSession, currentTerm) +
      `<section class="card"><div class="section-head"><h2>Student register</h2>${ctx.offline ? "" : `<div><button class="btn btn-quiet" id="student-import-history">Import History</button> <button class="btn btn-secondary" id="import-students">Import Students &amp; Guardians</button> <button class="btn btn-primary" id="add-student">Add Student &amp; Guardian</button></div>`}</div><div class="toolbar"><input id="student-search" aria-label="Search students" placeholder="Search students"><select id="student-filter" aria-label="Filter student status"><option value="">All statuses</option><option>Active</option><option>Inactive</option><option>Graduated</option><option>Transferred</option><option>Archived</option></select></div><div id="student-table"></div><div class="dialog-actions" id="student-pages"><button class="btn btn-secondary" data-page="previous" disabled>Previous</button><span>Page 1</span><button class="btn btn-secondary" data-page="next">Next</button></div></section>`,
    "Students",
  );
  draw();
  let searchTimer,
    page = 0,
    total = list.length;
  const loadStudents = async (nextPage = 0) => {
    if (ctx.offline) return draw();
    const search = document.querySelector("#student-search").value,
      status = document.querySelector("#student-filter").value,
      response = await api.post("/api/students/list", {
        search,
        status,
        limit: 25,
        offset: nextPage * 25,
      });
    list = response.rows || [];
    total = Number(response.total || 0);
    page = nextPage;
    draw();
    const pages = document.querySelector("#student-pages");
    pages.querySelector("span").textContent =
      `Page ${page + 1} of ${Math.max(1, Math.ceil(total / 25))}`;
    pages.querySelector('[data-page="previous"]').disabled = page === 0;
    pages.querySelector('[data-page="next"]').disabled =
      (page + 1) * 25 >= total;
  };
  document.querySelector("#student-search")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadStudents(0).catch(showError), 250);
  });
  document
    .querySelector("#student-filter")
    ?.addEventListener("change", () => loadStudents(0).catch(showError));
  document
    .querySelector('[data-page="previous"]')
    ?.addEventListener("click", () => loadStudents(page - 1).catch(showError));
  document
    .querySelector('[data-page="next"]')
    ?.addEventListener("click", () => loadStudents(page + 1).catch(showError));
  if (!ctx.offline) loadStudents(0).catch(showError);
  document
    .querySelector("#add-student")
    ?.addEventListener("click", () => studentGuardianDialog());
  document
    .querySelector("#import-students")
    ?.addEventListener("click", importDialog);
  document
    .querySelector("#student-import-history")
    ?.addEventListener("click", importHistoryDialog);
  document
    .querySelector("#academic-context-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget,
        feedback = form.querySelector(".form-error"),
        button = event.submitter,
        values = Object.fromEntries(new FormData(form));
      feedback.textContent = "";
      if (
        !/^\d{4}\/\d{4}$/.test(values.sessionName) ||
        Number(values.sessionName.slice(5)) !==
          Number(values.sessionName.slice(0, 4)) + 1
      ) {
        feedback.textContent =
          "Academic session must use consecutive years in the format YYYY/YYYY.";
        return form.elements.sessionName.focus();
      }
      button.disabled = true;
      button.textContent = "Saving…";
      try {
        await api.post("/api/students/academic-context", values);
        showToast("Academic context saved.");
        await render(ctx);
      } catch (error) {
        feedback.textContent =
          error.message || "The academic context could not be saved.";
        button.disabled = false;
        button.textContent = "Save Academic Context";
      }
    });
  function bind() {
    document
      .querySelectorAll("[data-view]")
      .forEach((b) => (b.onclick = () => viewDialog(b.dataset.view)));
    document
      .querySelectorAll("[data-history]")
      .forEach((b) => (b.onclick = () => historyDialog(b.dataset.history)));
    document.querySelectorAll("[data-graduate]").forEach(
      (b) =>
        (b.onclick = () =>
          formDialog(
            "Mark student as Graduated",
            [
              {
                name: "exitDate",
                label: "Graduation / Exit Date",
                type: "date",
                required: true,
              },
              { name: "exitReason", label: "Exit Reason / Note" },
            ],
            async (details) => {
              if (
                !(await confirmDialog(
                  "Confirm graduation",
                  "Mark this student as graduated while preserving all academic history?",
                  { confirmLabel: "Mark Graduated" },
                ))
              )
                return;
              await api.post("/api/students/status", {
                studentId: b.dataset.graduate,
                status: "GRADUATED",
                details,
              });
              showToast("Student marked as graduated.");
              await loadStudents(page);
            },
          )),
    );
    document
      .querySelectorAll("[data-edit]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            editStudentDialog(
              list.find((x) => x.StudentID === b.dataset.edit),
            )),
      );
    document.querySelectorAll("[data-parent]").forEach(
      (b) =>
        (b.onclick = () =>
          formDialog(
            "Link guardian",
            [
              {
                name: "parentId",
                label: "Guardian",
                required: true,
                options: (d.parents || []).map((p) => ({
                  value: p.Id,
                  label: [name(p), p.Email].filter(Boolean).join(" — "),
                })),
              },
              { name: "relationship", label: "Relationship", required: true },
            ],
            async (data) => {
              await api.post("/api/parents/link", {
                studentId: b.dataset.parent,
                ...data,
              });
              showToast("Guardian linked.");
            },
          )),
    );
    document.querySelectorAll("[data-promote]").forEach(
      (b) =>
        (b.onclick = () =>
          formDialog(
            "Promote student",
            [
              {
                name: "targetClassId",
                label: "Target class",
                required: true,
                options: classes.map((x) => ({
                  value: x.ClassID,
                  label: x.ClassName,
                })),
              },
              {
                name: "targetClassArmId",
                label: "Target class arm",
                options: arms.map((x) => ({
                  value: x.ClassArmID,
                  label: `${classNames.get(x.ClassID) || "Class"} — ${x.ArmName}`,
                })),
              },
              {
                name: "targetSessionId",
                label: "Target academic session",
                required: true,
                options: (d.academicSessions || [])
                  .filter((x) => x.Status === "Active")
                  .map((x) => ({ value: x.SessionID, label: x.SessionName })),
              },
              {
                name: "effectiveDate",
                label: "Effective date",
                type: "date",
                required: true,
              },
              { name: "reason", label: "Reason" },
            ],
            async (data) => {
              if (
                !(await confirmDialog(
                  "Confirm promotion",
                  "Promote this student to the selected class?",
                  { confirmLabel: "Promote" },
                ))
              )
                return;
              await api.post("/api/students/promote", {
                studentId: b.dataset.promote,
                ...data,
              });
              showToast("Student promoted.");
              await render(ctx);
            },
          )),
    );
    document.querySelectorAll("[data-status]").forEach(
      (b) =>
        (b.onclick = async () => {
          const next = b.dataset.current === "Active" ? "Inactive" : "Active";
          if (
            !(await confirmDialog(
              "Change student status",
              `Set this student to ${next}?`,
              { confirmLabel: `Set ${next}` },
            ))
          )
            return;
          await api.post("/api/students/status", {
            studentId: b.dataset.status,
            status: next,
          });
          showToast("Student status updated.");
          await render(ctx);
        }),
    );
  }
  async function viewDialog(studentId) {
    try {
      const h = await api.post("/api/students/history", { studentId }),
        s = h.student || {},
        current = h.current || {},
        guardians = h.guardians || [],
        enrolments = h.enrolments || [],
        dialog = document.createElement("dialog"),
        date = (value) => (value ? new Date(value).toLocaleDateString() : "—"),
        guardianCards=guardians.length?`<div class="guardian-grid">${guardians.map(g=>`<article class="guardian-card"><dl><div><dt>Guardian Name</dt><dd>${escapeHtml(name(g))}</dd></div><div><dt>Relationship</dt><dd>${escapeHtml(g.Relationship||"Guardian")}</dd></div><div><dt>Email / Username</dt><dd>${escapeHtml(g.Username||g.Email||"—")}</dd></div><div><dt>Phone</dt><dd>${escapeHtml(g.Phone||"—")}</dd></div><div><dt>Status</dt><dd>${escapeHtml(g.ParentStatus||g.LinkStatus||"—")}</dd></div></dl></article>`).join("")}</div>`:'<p class="support">No guardian is linked.</p>';
      dialog.className = "dialog teacher-detail student-profile-dialog";
      dialog.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">Student profile</p><h2>${escapeHtml(name(s))}</h2></div><button class="icon-btn" data-close>×</button></div><section><h3>Student Details</h3><dl class="detail-list"><div><dt>Admission Number</dt><dd>${escapeHtml(s.AdmissionNumber || "—")}</dd></div><div><dt>Full Name</dt><dd>${escapeHtml(name(s))}</dd></div><div><dt>Gender</dt><dd>${escapeHtml(s.Gender || "—")}</dd></div><div><dt>Date of Birth</dt><dd>${escapeHtml(date(s.DateOfBirth))}</dd></div><div><dt>Admission Date</dt><dd>${escapeHtml(date(s.AdmissionDate))}</dd></div><div><dt>Status</dt><dd>${escapeHtml(s.Status || "—")}</dd></div><div><dt>Current Session</dt><dd>${escapeHtml(current.SessionName || "—")}</dd></div><div><dt>Current Term</dt><dd>${escapeHtml(current.TermName || "—")}</dd></div><div><dt>Current Class</dt><dd>${escapeHtml(current.ClassName || "—")}</dd></div><div><dt>Current Arm</dt><dd>${escapeHtml(current.ArmName || "—")}</dd></div></dl></section><section><h3>Parents / Guardians</h3>${guardianCards}</section><section><h3>Academic Links</h3><p>${enrolments.length} historical session enrolment${enrolments.length === 1 ? "" : "s"} available.</p><button class="btn btn-secondary" data-academic>View Academic History</button></section><div class="dialog-actions"><button class="btn btn-primary" data-close>Done</button></div>`;
      document.body.appendChild(dialog);
      dialog.querySelector("[data-academic]").onclick = () => {
        dialog.close();
        historyDialog(studentId);
      };
      dialog
        .querySelectorAll("[data-close]")
        .forEach((x) => (x.onclick = () => dialog.close()));
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      dialog.showModal();
    } catch (error) {
      showError(error);
    }
  }
  async function historyDialog(studentId) {
    try {
      const h = await api.post("/api/students/history", { studentId }),
        student = h.student || {},
        reports = h.reports || [],
        periods = h.periods || [],
        dialog = document.createElement("dialog");
      dialog.className = "dialog onboarding-dialog";
      const sessions = (h.enrolments || [])
        .map((enrolment) => {
          const own = periods.filter(
            (p) => p.SessionID === enrolment.SessionID,
          );
          return `<section class="history-session"><div class="section-head"><div><h3>${escapeHtml(enrolment.SessionName)}</h3><p>${escapeHtml(enrolment.ClassName)} ${escapeHtml(enrolment.ArmName || "")}</p></div></div>${
            own.length
              ? own
                  .map((period) => {
                    const published = reports
                      .filter(
                        (r) =>
                          r.SessionID === period.SessionID &&
                          r.TermID === period.TermID &&
                          r.Status === "Published",
                      )
                      .sort((a, b) => b.ReportVersion - a.ReportVersion)
                      .slice(0, 1);
                    return `<article class="responsibility-card"><div><strong>${escapeHtml(period.TermName)}</strong><small>Result ${escapeHtml(period.ResultStatus)}</small></div><span>${published.length ? "Published report available" : "No published report"}</span></article>`;
                  })
                  .join("")
              : '<p class="support">No compiled terms for this session.</p>'
          }</section>`;
        })
        .join("");
      dialog.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">Academic History</p><h2>${escapeHtml(name(student))}</h2><p>${escapeHtml(student.AdmissionNumber || "")}</p></div><button class="icon-btn" data-close>×</button></div>${sessions || '<div class="refined-empty">No academic history is available.</div>'}<div class="dialog-actions"><button class="btn btn-primary" data-close>Done</button></div>`;
      document.body.appendChild(dialog);
      dialog
        .querySelectorAll("[data-close]")
        .forEach((x) => (x.onclick = () => dialog.close()));
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      dialog.showModal();
    } catch (error) {
      showError(error);
    }
  }
  function editStudentDialog(s) {
    formDialog(
      "Edit student",
      [
        {
          name: "admissionNumber",
          label: "Admission number",
          value: s?.AdmissionNumber || "",
          required: true,
        },
        {
          name: "firstName",
          label: "Student first name",
          value: s?.FirstName || "",
          required: true,
        },
        {
          name: "middleName",
          label: "Student middle name",
          value: s?.MiddleName || "",
        },
        {
          name: "lastName",
          label: "Student last name",
          value: s?.LastName || "",
          required: true,
        },
        {
          name: "admissionDate",
          label: "Admission date",
          type: "date",
          value: s?.AdmissionDate?.slice?.(0, 10) || "",
          required: true,
        },
      ],
      async (data) => {
        data.studentId = s.StudentID;
        await api.post("/api/students/update", data);
        showToast("Student updated.");
        await render(ctx);
      },
    );
  }
  function studentGuardianDialog() {
    const current = currentSession,
      dialog = document.createElement("dialog");
    dialog.className = "dialog onboarding-dialog";
    const options = classes
      .map(
        (x) =>
          `<option value="${escapeHtml(x.ClassID)}">${escapeHtml(x.ClassName)}</option>`,
      )
      .join("");
    dialog.innerHTML = `<form novalidate><div class="dialog-head"><div><p class="eyebrow">Enrollment workflow</p><h2>Add Student &amp; Guardian</h2></div><button class="icon-btn" type="button" data-cancel aria-label="Close">×</button></div>${current ? `<p class="session-note">Admission session: <strong>${escapeHtml(current.SessionName)}</strong> (set automatically)</p>` : `<div class="notice">No current academic session is configured. Configure it in Administration before adding students.</div>`}<fieldset><legend>Student information</legend><div class="onboarding-grid"><label class="field-wide">Admission Number <span aria-hidden="true">*</span><input name="admissionNumber" required maxlength="80" autocomplete="off"></label><label>Student First Name <span aria-hidden="true">*</span><input name="firstName" required maxlength="100" autocomplete="given-name"></label><label>Student Middle Name<input name="middleName" maxlength="100" autocomplete="additional-name"></label><label>Student Last Name <span aria-hidden="true">*</span><input name="lastName" required maxlength="100" autocomplete="family-name"></label><label>Admission Date <span aria-hidden="true">*</span><input name="admissionDate" type="date" required></label><label>Class <span aria-hidden="true">*</span><select name="classId" required><option value="">Select class</option>${options}</select></label><label>Class Arm <span aria-hidden="true">*</span><select name="classArmId" required disabled><option value="">Select a class first</option></select></label></div></fieldset><fieldset><legend>Guardian information</legend><div class="onboarding-grid"><label>Guardian Full Name <span aria-hidden="true">*</span><input name="guardianFullName" required maxlength="300" autocomplete="name"></label><label>Guardian Email <span aria-hidden="true">*</span><input name="guardianEmail" type="email" required maxlength="254" autocomplete="email"></label><label>Guardian Phone Number <span aria-hidden="true">*</span><input name="guardianPhone" type="tel" required maxlength="80" autocomplete="tel"></label><label>Guardian Address<textarea name="guardianAddress" maxlength="1000" autocomplete="street-address"></textarea></label></div></fieldset><div class="form-error" role="alert"></div><div class="dialog-actions">${current ? "" : '<button class="btn btn-quiet" type="button" data-admin>Open Administration</button>'}<button class="btn btn-secondary" type="button" data-cancel>Cancel</button><button class="btn btn-primary" type="submit" ${current ? "" : "disabled"}>Create Student &amp; Guardian</button></div></form>`;
    const contextNote = dialog.querySelector(".session-note");
    if (contextNote && currentTerm)
      contextNote.innerHTML = `Academic Session: <strong>${escapeHtml(current.SessionName)}</strong> &nbsp;•&nbsp; Term: <strong>${escapeHtml(currentTerm.TermName)}</strong> (set automatically)`;
    document.body.appendChild(dialog);
    const form = dialog.querySelector("form"),
      classSelect = form.elements.classId,
      armSelect = form.elements.classArmId;
    form.querySelector('[type="submit"]').disabled = !(current && currentTerm);
    const updateArms = () => {
      const available = arms.filter((x) => x.ClassID === classSelect.value);
      armSelect.innerHTML = classSelect.value
        ? `<option value="">Select arm</option>${available.map((x) => `<option value="${escapeHtml(x.ClassArmID)}">${escapeHtml(x.ArmName)}</option>`).join("")}`
        : '<option value="">Select a class first</option>';
      armSelect.disabled = !classSelect.value;
    };
    classSelect.onchange = updateArms;
    dialog
      .querySelectorAll("[data-cancel]")
      .forEach((x) => (x.onclick = () => dialog.close()));
    dialog.querySelector("[data-admin]")?.addEventListener("click", () => {
      dialog.close();
      location.hash = "#/administration";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    dialog.addEventListener("close", () => dialog.remove());
    form.onsubmit = async (event) => {
      event.preventDefault();
      const error = form.querySelector(".form-error");
      error.textContent = "";
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form));
      data.guardianEmail = data.guardianEmail.trim().toLowerCase();
      if (!/^\+?[0-9][0-9 ()\-.]{1,78}[0-9]$/.test(data.guardianPhone.trim())) {
        error.textContent = "Enter a valid guardian phone number.";
        form.elements.guardianPhone.focus();
        return;
      }
      const button = event.submitter;
      button.disabled = true;
      button.textContent = "Creating…";
      try {
        const result = await api.post("/api/students/create", data);
        dialog.close();
        await credentialDialog(result);
        await render(ctx);
      } catch (problem) {
        error.textContent =
          problem?.message || "The operation could not be completed.";
        button.disabled = false;
        button.textContent = "Create Student & Guardian";
      }
    };
    dialog.showModal();
    form.elements.admissionNumber?.focus();
  }
  function importDialog() {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog import-dialog";
    dialog.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">Bulk enrollment</p><h2>Import Students &amp; Guardians</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></div><div class="import-steps"><span class="active">1. Template</span><span>2. Upload</span><span>3. Validate</span><span>4. Confirm</span></div><section class="import-start"><p>Download the formatted workbook, complete it, then upload an XLSX or CSV file. The import is limited to 2,000 student rows and 5 MB.</p><div class="import-actions"><button class="btn btn-secondary" type="button" data-template>Download Student &amp; Guardian Template</button><button class="btn btn-primary" type="button" data-upload>Choose Import File</button><input type="file" accept=".xlsx,.csv" hidden></div></section><div class="import-feedback form-error" role="alert"></div><div class="import-preview"></div><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="button" data-confirm disabled>Confirm Import</button></div>`;
    dialog
      .querySelector(".import-start")
      .insertAdjacentHTML(
        "afterbegin",
        currentSession && currentTerm
          ? `<p class="session-note">Importing into: <strong>${escapeHtml(currentSession.SessionName)} • ${escapeHtml(currentTerm.TermName)}</strong></p>`
          : '<div class="notice">Select the Academic Session and Term above before importing students.</div>',
      );
    document.body.appendChild(dialog);
    const input = dialog.querySelector("input[type=file]"),
      feedback = dialog.querySelector(".import-feedback"),
      preview = dialog.querySelector(".import-preview"),
      confirm = dialog.querySelector("[data-confirm]");
    let upload = null,
      validation = null;
    dialog
      .querySelectorAll("[data-close]")
      .forEach((x) => (x.onclick = () => dialog.close()));
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.querySelector("[data-template]").onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const template = await api.get("/api/students/import/template");
        downloadBase64(template.base64, template.fileName, template.mimeType);
      } catch (error) {
        feedback.textContent =
          error.message || "The template could not be downloaded.";
      } finally {
        button.disabled = false;
      }
    };
    dialog.querySelector("[data-upload]").disabled = !(
      currentSession && currentTerm
    );
    dialog.querySelector("[data-upload]").onclick = () => input.click();
    input.onchange = async () => {
      const selected = input.files[0],
        problem = file(selected, {
          types: [".csv", ".xlsx"],
          maxSize: LIMITS.bulkFile,
        });
      if (problem) {
        feedback.textContent = problem;
        return;
      }
      feedback.textContent = "Validating the complete file…";
      preview.innerHTML = "";
      confirm.disabled = true;
      try {
        upload = {
          fileName: selected.name,
          mimeType: selected.type,
          base64: await readBase64(selected),
        };
        validation = await api.post("/api/students/import/preview", {
          file: upload,
        });
        drawImportPreview(preview, validation);
        feedback.textContent = validation.summary.invalidRows
          ? "Correct every invalid row and upload the file again. No records have been imported."
          : "Validation passed. Review the rows, then confirm the import.";
        confirm.disabled = Boolean(validation.summary.invalidRows);
      } catch (error) {
        upload = null;
        validation = null;
        feedback.textContent =
          error.message || "The file could not be validated.";
      }
    };
    confirm.onclick = async () => {
      if (!upload || !validation || validation.summary.invalidRows) return;
      if (
        !(await confirmDialog(
          "Confirm student import",
          `Import ${validation.summary.totalRows} students and their guardians?`,
          { confirmLabel: "Import all" },
        ))
      )
        return;
      confirm.disabled = true;
      confirm.textContent = `Importing ${validation.summary.totalRows.toLocaleString()} students…`;
      feedback.textContent = `Importing ${validation.summary.totalRows.toLocaleString()} students… Please do not close this window.`;
      try {
        const created = await api.post("/api/students/import", {
            file: upload,
          }),
          job = created.job;
        feedback.textContent = `${created.duplicate ? "This file already has an import job." : `Importing ${validation.summary.totalRows.toLocaleString()} students…`} Import Reference: ${job.ImportReference}`;
        confirm.textContent = `Import Reference: ${job.ImportReference}`;
        let current = job;
        while (
          dialog.open &&
          ["Pending", "Processing"].includes(current.Status)
        ) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          current = await api.post("/api/students/import/jobs/status", {
            jobId: current.ID,
          });
          feedback.textContent = `${current.Status === "Processing" ? `Importing ${current.TotalRows.toLocaleString()} students…` : "Import queued…"} Import Reference: ${current.ImportReference}. You may close this window and check Import History later.`;
        }
        if (!dialog.open) return;
        if (current.Status === "Failed")
          throw new Error(
            `${current.ImportReference}: ${current.ErrorMessage || "The import failed."}`,
          );
        dialog.close();
        upload = null;
        validation = null;
        await importJobResultDialog(current);
        await render(ctx);
      } catch (error) {
        feedback.textContent =
          error.message ||
          "The import could not be completed. No records were created.";
        confirm.disabled = false;
        confirm.textContent = "Confirm Import";
      }
    };
    dialog.showModal();
  }
}

async function importHistoryDialog() {
  const jobs = await api.get("/api/students/import/jobs"),
    dialog = document.createElement("dialog");
  dialog.className = "dialog import-dialog";
  dialog.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">Students</p><h2>Import History</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></div>${table(
    [
      "Import Reference",
      "Filename",
      "Session",
      "Term",
      "Rows",
      "Students",
      "Guardians",
      "Status",
      "Started",
      "Completed",
      "Started By",
      "Actions",
    ],
    jobs.map((job) => [
      escapeHtml(job.ImportReference),
      escapeHtml(job.OriginalFilename),
      escapeHtml(job.SessionName),
      escapeHtml(job.TermName),
      job.TotalRows,
      job.StudentsCreated,
      job.GuardiansCreated,
      badge(job.Status),
      escapeHtml(new Date(job.StartedAt).toLocaleString()),
      job.CompletedAt
        ? escapeHtml(new Date(job.CompletedAt).toLocaleString())
        : "—",
      escapeHtml(job.StartedByEmail),
      `<button class="btn btn-quiet" data-import-job="${job.ID}">Open</button>`,
    ]),
    "No imports have been started.",
  )}<div class="dialog-actions"><button class="btn btn-primary" type="button" data-close>Done</button></div>`;
  document.body.appendChild(dialog);
  dialog
    .querySelectorAll("[data-close]")
    .forEach((button) => (button.onclick = () => dialog.close()));
  dialog.querySelectorAll("[data-import-job]").forEach(
    (button) =>
      (button.onclick = async () =>
        importJobResultDialog(
          await api.post("/api/students/import/jobs/status", {
            jobId: button.dataset.importJob,
          }),
        )),
  );
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

async function importJobResultDialog(job) {
  const dialog = document.createElement("dialog"),
    completed = job.Status === "Completed";
  dialog.className = "dialog credential-dialog";
  dialog.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">${escapeHtml(job.ImportReference)}</p><h2>${completed ? "Import completed successfully" : `Import ${escapeHtml(job.Status)}`}</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></div><div class="import-result"><p><span>Filename</span><strong>${escapeHtml(job.OriginalFilename)}</strong></p><p><span>Academic Session</span><strong>${escapeHtml(job.SessionName)}</strong></p><p><span>Term</span><strong>${escapeHtml(job.TermName)}</strong></p><p><span>Rows</span><strong>${job.TotalRows}</strong></p><p><span>Students imported</span><strong>${job.StudentsCreated}</strong></p><p><span>Guardians created</span><strong>${job.GuardiansCreated}</strong></p><p><span>Guardian links created</span><strong>${job.GuardianLinksCreated}</strong></p><p><span>Enrolments created</span><strong>${job.EnrolmentsCreated}</strong></p><p><span>Started By</span><strong>${escapeHtml(job.StartedByEmail)}</strong></p></div>${job.ErrorMessage ? `<div class="form-error">${escapeHtml(job.ErrorMessage)}</div>` : ""}<div class="dialog-actions">${job.CredentialsAvailable ? '<button class="btn btn-secondary" type="button" data-credentials>Download Guardian Credentials</button>' : ""}<button class="btn btn-primary" type="button" data-close>Done</button></div>`;
  document.body.appendChild(dialog);
  dialog
    .querySelectorAll("[data-close]")
    .forEach((button) => (button.onclick = () => dialog.close()));
  dialog
    .querySelector("[data-credentials]")
    ?.addEventListener("click", async () => {
      const file = await api.post("/api/students/import/jobs/credentials", {
        jobId: job.ID,
      });
      downloadBase64(file.base64, file.fileName, file.mimeType);
    });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}
function academicContextSection(ctx, data, currentSession, currentTerm) {
  const sessionNames = [
    ...new Set((data.academicSessions || []).map((x) => x.SessionName)),
  ];
  if (ctx.offline)
    return `<section class="card academic-context-card"><div><p class="eyebrow">Current Academic Context</p><h2>${escapeHtml(currentSession?.SessionName || "Not configured")} <span>•</span> ${escapeHtml(currentTerm?.TermName || "Term not configured")}</h2></div></section>`;
  const terms = ["First Term", "Second Term", "Third Term"];
  return `<section class="card academic-context-card"><div class="academic-context-copy"><p class="eyebrow">Current Academic Context</p><h2>${escapeHtml(currentSession?.SessionName || "Select a session")} <span>•</span> ${escapeHtml(currentTerm?.TermName || "Select a term")}</h2><p>New registrations and imports use this academic period automatically.</p></div><form id="academic-context-form"><label>Academic Session<input name="sessionName" list="academic-session-options" value="${escapeHtml(currentSession?.SessionName || "")}" placeholder="2026/2027" required inputmode="numeric"><datalist id="academic-session-options">${sessionNames.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("")}</datalist></label><label>Term<select name="termName" required><option value="">Select term</option>${terms.map((value) => `<option value="${value}" ${value === currentTerm?.TermName ? "selected" : ""}>${value}</option>`).join("")}</select></label><button class="btn btn-primary" type="submit">Save Academic Context</button><div class="form-error" role="alert"></div></form></section>`;
}
const readBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("The file could not be read."));
    r.readAsDataURL(file);
  });

function downloadBase64(base64, fileName, mimeType) {
  const bytes = Uint8Array.from(atob(base64), (character) =>
    character.charCodeAt(0),
  );
  downloadBlob(new Blob([bytes], { type: mimeType }), fileName);
}
function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
function downloadCsv(fileName, headers, rows) {
  const content =
    "\uFEFF" +
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  downloadBlob(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
    fileName,
  );
}
function drawImportPreview(container, result) {
  const summary = result.summary,
    rows = result.rows || [];
  container.innerHTML = `<div class="import-summary"><div><span>Students detected</span><strong>${summary.studentsDetected}</strong></div><div><span>New students</span><strong>${summary.newStudents}</strong></div><div><span>Guardians detected</span><strong>${summary.guardiansDetected}</strong></div><div><span>New guardian users</span><strong>${summary.newGuardians}</strong></div><div><span>Existing guardian users</span><strong>${summary.existingGuardians}</strong></div><div><span>Classes detected</span><strong>${summary.classesDetected}</strong></div><div><span>Arms detected</span><strong>${summary.armsDetected}</strong></div><div><span>Errors</span><strong>${summary.invalidRows}</strong></div></div>${summary.invalidRows ? '<button class="btn btn-secondary import-error-download" type="button">Download Error Report</button>' : ""}${table(
    [
      "Row",
      "Admission Number",
      "Student Name",
      "Class",
      "Arm",
      "Guardian",
      "Guardian Email",
      "Status",
      "Issue",
    ],
    rows.map((row) => [
      escapeHtml(row.Row),
      escapeHtml(row.AdmissionNumber),
      escapeHtml(row.StudentName),
      escapeHtml(row.ClassName),
      escapeHtml(row.ArmName),
      escapeHtml(row.GuardianFullName),
      escapeHtml(row.GuardianEmail),
      badge(row.Status),
      escapeHtml(row.Issue || "—"),
    ]),
    "No import rows were found.",
  )}`;
  container
    .querySelector(".import-error-download")
    ?.addEventListener("click", () =>
      downloadCsv(
        "SAIRS-Student-Import-Errors.csv",
        ["Row Number", "Admission Number", "Issue"],
        rows
          .filter((row) => String(row.Status).toUpperCase() === "INVALID")
          .map((row) => [row.Row, row.AdmissionNumber, row.Issue]),
      ),
    );
}
async function bulkResultDialog(result) {
  const summary = result.summary || {},
    credentials = result.credentials || [],
    dialog = document.createElement("dialog");
  dialog.className = "dialog credential-dialog";
  dialog.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">Bulk enrollment complete</p><h2>Import completed successfully</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></div><div class="import-result"><p><span>Students imported</span><strong>${summary.studentsImported || 0}</strong></p><p><span>New guardians created</span><strong>${summary.newGuardiansCreated || 0}</strong></p><p><span>Existing guardians linked</span><strong>${summary.existingGuardiansLinked || 0}</strong></p><p><span>Guardian links created</span><strong>${summary.guardianLinksCreated || 0}</strong></p><p><span>Enrolments created</span><strong>${summary.enrolmentsCreated || 0}</strong></p><p><span>Class placements created</span><strong>${summary.classPlacementsCreated || 0}</strong></p><p><span>Academic Session</span><strong>${escapeHtml(summary.sessionName || "—")}</strong></p><p><span>Term</span><strong>${escapeHtml(summary.termName || "—")}</strong></p></div>${credentials.length ? '<div class="notice credential-notice"><strong>Download the guardian credentials now.</strong><br>For security, temporary passwords will not be available again after leaving this page.</div>' : ""}<div class="dialog-actions">${credentials.length ? '<button class="btn btn-secondary" type="button" data-credentials>Download New Guardian Credentials</button>' : ""}<button class="btn btn-primary" type="button" data-close>Done</button></div>`;
  document.body.appendChild(dialog);
  dialog
    .querySelectorAll("[data-close]")
    .forEach((x) => (x.onclick = () => dialog.close()));
  dialog.querySelector("[data-credentials]")?.addEventListener("click", () =>
    downloadCsv(
      "SAIRS-New-Guardian-Credentials.csv",
      [
        "Guardian Full Name",
        "Guardian Email",
        "Temporary Password",
        "Login URL",
      ],
      credentials.map((row) => [
        row.GuardianFullName,
        row.GuardianEmail,
        row.TemporaryPassword,
        row.LoginUrl,
      ]),
    ),
  );
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

async function credentialDialog(result) {
  const guardian = result.guardian || {},
    password = result.temporaryPassword,
    dialog = document.createElement("dialog");
  dialog.className = "dialog credential-dialog";
  const credentials = password ? `${guardian.email}\n${password}` : "";
  dialog.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">Enrollment complete</p><h2>Student created successfully</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></div>${password ? `<div class="success-panel"><strong>Guardian account created.</strong><p>Guardian login</p><code>${escapeHtml(guardian.email)}</code><p>Temporary password</p><code>${escapeHtml(password)}</code><p class="credential-warning">This password must be changed on first login. It will not be shown again after this dialog is closed.</p></div>` : `<div class="success-panel"><strong>Existing guardian: ${escapeHtml(guardian.email)}</strong><p>The student has been linked to the existing guardian account. No password was changed.</p></div>`}<div class="form-error" role="status"></div><div class="dialog-actions">${password ? '<button class="btn btn-secondary" type="button" data-copy>Copy credentials</button>' : ""}<button class="btn btn-primary" type="button" data-close>Done</button></div>`;
  document.body.appendChild(dialog);
  dialog
    .querySelectorAll("[data-close]")
    .forEach((x) => (x.onclick = () => dialog.close()));
  dialog.querySelector("[data-copy]")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(credentials);
      dialog.querySelector(".form-error").textContent = "Credentials copied.";
    } catch {
      dialog.querySelector(".form-error").textContent =
        "Copy was unavailable. Select and copy the credentials above.";
    }
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

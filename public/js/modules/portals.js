import {
  hero,
  setMain,
  cards,
  table,
  escapeHtml,
  showToast,
  showError,
  confirmDialog,
} from "../ui.js";
import { cachedThenNetwork, name } from "./_shared.js";
import { api } from "../api.js";
import { queueOperation, readSnapshot, saveSnapshot } from "../sync.js";
import { reportHtml, printReport } from "./report-view.js?v=sairs-v44";
import { openFile } from "../offline-files.js";
let context, selected, selectedPeriod, renderGeneration = 0;
export async function render(ctx) {
  context = ctx;
  const generation = ++renderGeneration;
  const query = selectedPeriod ? `?sessionId=${encodeURIComponent(selectedPeriod.sessionId)}&termId=${encodeURIComponent(selectedPeriod.termId)}` : "";
  if (ctx.user?.role !== "TEACHER") return legacy(ctx);
  setMain(`<section class="card refined-empty" aria-live="polite"><strong>Loading teaching assignments…</strong><p>Please wait while SAIRS retrieves the selected academic period.</p></section>`, "My Teaching");
  let r;
  try {
    r = await cachedThenNetwork(
      `teacherWorkspace${query}`,
      `/api/teacher-workspace/bootstrap${query}`,
      ctx.offline,
    );
  } catch (error) {
    if (generation !== renderGeneration) return;
    setMain(`<section class="card refined-empty error-state" role="alert"><strong>Teaching assignments could not be retrieved.</strong><p>${escapeHtml(error?.message || "Check your connection or sign in again, then retry.")}</p><button class="btn btn-primary" id="retry-teacher-workspace">Retry</button></section>`, "My Teaching");
    document.querySelector("#retry-teacher-workspace")?.addEventListener("click", () => render(context));
    return;
  }
  if (generation !== renderGeneration) return;
  const d = r.data || {},
    a = d.assignments || [],
    current = d.currentPeriod || {},
    subjects = a.filter(
      (x) =>
        x.AssignmentType === "SUBJECT_TEACHER" &&
        x.SessionID === current.SessionID,
    ),
    forms = d.formClasses || [],
    periods = d.periods || [],
    progress = new Map((d.progress || []).map((x) => [x.AssignmentID, x])),
    teacher = name(d.teacher || {}) || "Teacher",
    isCompleted = (p) =>
      [p?.Ca1ComponentStatus, p?.Ca2ComponentStatus, p?.ExamComponentStatus]
        .map((value) => String(value || "").toUpperCase())
        .every((status) => status === "APPROVED"),
    state = (p) => {
      const n = Number(p?.StudentCount || 0);
      if (isCompleted(p)) return "Completed";
      if (p?.ResultStatus) return `Results ${p.ResultStatus}`;
      if (n && Number(p.SubmittedStudents) === n) return "Submitted";
      if (n && Number(p.ExamCount) === n) return "Ready to Submit";
      if (Number(p?.ExamCount)) return "Exam in progress";
      if (n && Number(p.Ca2Count) === n) return "Exam Pending";
      if (Number(p?.Ca2Count)) return "CA2 in progress";
      if (n && Number(p.Ca1Count) === n) return "CA2 Pending";
      if (Number(p?.Ca1Count)) return "CA1 in progress";
      return "CA1 Not Started";
    },
    complete = subjects.filter((x) => isCompleted(progress.get(x.AssignmentID))).length,
    distinctSubjects = new Set(subjects.map((x) => x.SubjectID)).size,
    retrievalWarning = r.error
      ? `<section class="notice" role="status"><strong>Live refresh failed.</strong> Showing the most recent synchronized workspace. <button class="btn btn-quiet" id="retry-teacher-workspace">Retry</button></section>`
      : "";
  const assignmentCards = subjects.length
    ? subjects
        .map((x) => {
          const p = progress.get(x.AssignmentID) || {},
            n = Number(p.StudentCount || 0),
            completed = isCompleted(p),
            done =
              Number(p.Ca1Count || 0) +
              Number(p.Ca2Count || 0) +
              Number(p.ExamCount || 0);
          return `<article class="assignment-card"><div><p class="eyebrow">${escapeHtml(x.ClassName)} ${escapeHtml(x.ArmName)}</p><h3>${escapeHtml(x.SubjectName)}</h3></div><span class="status-pill ${completed ? "ready" : ""}">${escapeHtml(state(p))}</span><div class="component-progress">${[
            ["CA1", p.Ca1ComponentStatus],
            ["CA2", p.Ca2ComponentStatus],
            ["Exam", p.ExamComponentStatus],
          ]
            .map(
              ([label, value]) =>
                `<span class="${String(value).toUpperCase() === "APPROVED" ? "done" : ""}">${label} ${String(value).toUpperCase() === "APPROVED" ? "✓" : "Pending"}</span>`,
            )
            .join(
              "",
            )}</div><div class="assignment-meter"><i style="width:${completed ? 100 : n ? Math.round((done / (n * 3)) * 100) : 0}%"></i></div><button class="btn ${completed ? "btn-secondary" : "btn-primary"}" data-open="${x.AssignmentID}">${completed ? "View Scores" : done ? "Continue Score Entry" : "Start Score Entry"}</button></article>`;
        })
        .join("")
    : `<div class="refined-empty"><strong>No valid teaching assignments exist for this academic session.</strong><p>Please contact your IT Administrator to review your session-specific teaching allocation.</p></div>`;
  const formSection = forms.length
    ? `<section class="card form-workspace"><div class="section-head"><div><p class="eyebrow">Form Teacher</p><h2>My Form Class</h2><p>Subject completion is calculated automatically.</p></div></div>${forms
        .map(
          (f) =>
            `<article class="form-class"><div class="form-class-head"><div><h3>${escapeHtml(f.ClassName)} ${escapeHtml(f.ArmName)}</h3><p>${f.StudentCount} students · ${(f.Subjects || []).length} subjects</p>${f.ResultSubmission?`<p><strong>Compiled result:</strong> ${escapeHtml(String(f.ResultSubmission.Status).replaceAll("_"," "))}${f.ResultSubmission.ReviewComment?` — ${escapeHtml(f.ResultSubmission.ReviewComment)}`:""}</p>`:""}</div><span class="status-pill ${f.Ready ? "ready" : ""}">${f.ResultSubmission?.Status==="Submitted"?"Awaiting Management review":f.ResultSubmission?.Status==="Reviewed"?"Reviewed by Management":f.ResultSubmission?.Status==="Approved"?"Approved":f.ResultSubmission?.Status==="Published"?"Published":f.ResultSubmission?.Status==="Returned"?"Returned for correction":f.Ready?"Ready to compile":"Compilation not ready"}</span></div>${table(
              ["Subject", "Assigned Teacher", "CA1", "CA2", "Exam"],
              (f.Subjects || []).map((s) => [
                escapeHtml(s.SubjectName),
                escapeHtml(s.TeacherName || "Not assigned"),
                componentStatus(s.Components?.CA1),
                componentStatus(s.Components?.CA2),
                componentStatus(s.Components?.EXAM),
              ]),
            )}<div class="dialog-actions"><button class="btn btn-primary" data-compile="${f.AssignmentID}" ${f.Ready&&(!f.ResultSubmission||f.ResultSubmission.Status==="Returned") ? "" : "disabled"}>${f.ResultSubmission?.Status==="Returned"?"Correct and Resubmit":"Compile and Submit to Management"}</button></div></article>`,
        )
        .join("")}</section>`
    : "";
  setMain(
    hero(
      "portals",
      "Welcome",
      teacher,
      "See what you teach, what is pending, and what to do next.",
      [
        current.SessionName || "Session not configured",
        current.TermName || "Term not configured",
      ],
    ) +
      cards([
        [
          "My Classes",
          new Set(subjects.map((x) => `${x.ClassID}:${x.ClassArmID}`)).size,
        ],
        ["My Subjects", distinctSubjects],
        ["Pending Score Entry", subjects.length - complete],
        ["Completed Subjects", complete],
      ]) +
      `${retrievalWarning}<section class="card"><div class="section-head"><div><h2>My Teaching Assignments</h2><p>Enter each assessment when it happens. Saved work remains available.</p></div><label class="compact-select">Academic Period<select id="period" ${periods.length ? "" : "disabled"}>${periods.map((x) => `<option value="${x.SessionID}:${x.TermID}" ${x.SessionID === current.SessionID && x.TermID === current.TermID ? "selected" : ""}>${escapeHtml(x.SessionName)} — ${escapeHtml(x.TermName)}</option>`).join("")}</select></label></div>${periods.length ? `<div class="assignment-grid">${assignmentCards}</div>` : `<div class="refined-empty"><strong>No academic period is configured.</strong><p>Please contact your IT Administrator to configure an active session and term.</p></div>`}<div id="score-area"></div></section>${formSection}`,
    "My Teaching",
  );
  document
    .querySelectorAll("[data-open]")
    .forEach((b) => (b.onclick = () => openScores(b.dataset.open)));
  document
    .querySelectorAll("[data-compile]")
    .forEach((b) => (b.onclick = () => compile(b.dataset.compile)));
  document.querySelector("#academic-context") && (document.querySelector("#academic-context").textContent = [current.SessionName, current.TermName].filter(Boolean).join(" · ") || "Academic period not configured");
  document.querySelector("#retry-teacher-workspace")?.addEventListener("click", () => render(context));
  document.querySelector("#period")?.addEventListener("change", async (event) => {
    const [sessionId, termId] = event.target.value.split(":");
    selectedPeriod = { sessionId, termId };
    await render(context);
  });
}
function componentStatus(value = "NOT_STARTED") {
  const status = String(value).toUpperCase(),
    label = status.replaceAll("_", " ");
  return `<span class="status-pill component-state ${status.toLowerCase()}">${escapeHtml(label)}</span>`;
}
async function legacy(ctx) {
  const r = await cachedThenNetwork(
      "portals",
      "/api/portals/bootstrap",
      ctx.offline,
    ),
    d = r.data || {};
  if ((d.role || ctx.user?.role) === "PARENT" && !ctx.offline)
    return parentPortal(d);
  setMain(
    hero(
      "portals",
      "Focused workspace",
      "Management Overview",
      "School-wide academic information.",
    ) +
      cards([
        ["Students", d.studentCount || 0],
        ["Teachers", d.teacherCount || 0],
      ]),
    "Academic Workspace",
  );
}
async function parentPortal(d) {
  const [catalog, reports, progress] = await Promise.all([
      api.get("/api/reports/catalog"),
      api.get("/api/reports"),
      api.get("/api/parent/current-progress"),
    ]),
    records = catalog.records || [],
    children = d.children || [],
    current = d.current || {},
    parent = name(d.parent || {}) || "Parent",
    progressRows = progress || [],
    childCards = children.length
      ? children
          .map((x) => {
            const latest = records.find((r) => r.StudentID === x.StudentID);
            return `<article class="child-card"><div class="child-avatar">${escapeHtml(String(x.FirstName || "?")[0])}</div><div><p class="eyebrow">My child</p><h3>${escapeHtml(name(x))}</h3><p>${escapeHtml(x.ClassName || "")} ${escapeHtml(x.ArmName || "")}</p></div><dl><div><dt>Current Session</dt><dd>${escapeHtml(current.SessionName || "Not configured")}</dd></div><div><dt>Current Term</dt><dd>${escapeHtml(current.TermName || "Not configured")}</dd></div><div><dt>Latest Report</dt><dd>${latest ? `<span class="coverage-ok">${escapeHtml(latest.TermName)} Report Available</span>` : "Not published yet"}</dd></div></dl><button class="btn btn-primary" data-child="${x.StudentID}">Check Reports</button></article>`;
          })
          .join("")
      : `<div class="refined-empty"><strong>No children are currently linked to this account.</strong><p>Please contact your school administrator.</p></div>`;
  setMain(
    hero(
      "portals",
      "Welcome",
      parent,
      "Select a child and view published academic reports.",
      [
        current.SessionName || "Session not configured",
        current.TermName || "Term not configured",
      ],
    ) +
      `<section class="card"><div class="section-head"><div><h2>My Children</h2><p>Each child has a private academic record.</p></div></div><div class="children-grid">${childCards}</div></section><section class="card"><div class="section-head"><div><h2>Current Term Progress</h2><p>Only components approved by Management are shown.</p></div></div>${renderParentProgress(children, progressRows)}</section><section class="card report-picker" id="picker" hidden><div class="section-head"><div><h2 id="child-title">Published Final Reports</h2><p>Browse current and historical published reports.</p></div></div><div class="toolbar"><label>Academic Session<select id="parent-session"></select></label><label>Term<select id="parent-term"></select></label><button class="btn btn-primary" id="parent-view">View Report</button></div><div id="parent-report"></div></section>`,
    "Approved Assessments",
  );
  let childId = "";
  const session = document.querySelector("#parent-session"),
    term = document.querySelector("#parent-term");
  document.querySelectorAll("[data-child]").forEach(
    (b) =>
      (b.onclick = () => {
        childId = b.dataset.child;
        const child = children.find((x) => x.StudentID === childId),
          rows = records.filter((x) => x.StudentID === childId),
          values = [
            ...new Map(rows.map((x) => [x.SessionID, x.SessionName])).entries(),
          ];
        document.querySelector("#picker").hidden = false;
        document.querySelector("#child-title").textContent =
          `${name(child)} — Published Reports`;
        session.innerHTML = `<option value="">Select session</option>${values.map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join("")}`;
        term.innerHTML = '<option value="">Select a session first</option>';
        document
          .querySelector("#picker")
          .scrollIntoView({ behavior: "smooth" });
      }),
  );
  session.onchange = () => {
    const values = [
      ...new Map(
        records
          .filter(
            (x) => x.StudentID === childId && x.SessionID === session.value,
          )
          .map((x) => [x.TermID, x.TermName]),
      ).entries(),
    ];
    term.innerHTML = `<option value="">Select term</option>${values.map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join("")}`;
  };
  document.querySelector("#parent-view").onclick = async () => {
    const record = records.find(
      (x) =>
        x.StudentID === childId &&
        x.SessionID === session.value &&
        x.TermID === term.value,
    );
    if (!record) return showToast("This report has not been published yet.");
    try {
      const versions = reports
          .filter(
            (x) =>
              x.StudentID === record.StudentID &&
              x.SessionID === record.SessionID &&
              x.TermID === record.TermID &&
              x.Status === "Published",
          )
          .sort(
            (a, b) =>
              Number(b.ReportVersion || 1) - Number(a.ReportVersion || 1),
          ),
        card = versions[0],
        report = await api.post("/api/reports/view", {
          reportCardId: card?.ReportCardID,
          studentId: record.StudentID,
          sessionId: record.SessionID,
          termId: record.TermID,
          classId: record.ClassID,
          classArmId: record.ClassArmID,
        });
      document.querySelector("#parent-report").innerHTML =
        `${reportHtml(report)}<div class="dialog-actions"><button class="btn btn-secondary" id="parent-print">Print</button>${card ? '<button class="btn btn-primary" id="parent-download">Download PDF</button>' : ""}</div>`;
      document.querySelector("#parent-print").onclick = () =>
        printReport(report);
      document
        .querySelector("#parent-download")
        ?.addEventListener("click", async () => {
          const f = await api.post("/api/reports/download", {
            reportCardId: card.ReportCardID,
          });
          openFile({
            meta: { MimeType: f.mimeType, FileName: f.fileName },
            buffer: Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))
              .buffer,
          });
        });
    } catch (e) {
      showError(e);
    }
  };
}
function renderParentProgress(children, rows) {
  if (!rows.length)
    return '<div class="refined-empty"><strong>No approved current-term components yet.</strong><p>Draft and submitted scores remain private until Management approval.</p></div>';
  return children
    .map((child) => {
      const own = rows.filter((row) => row.StudentID === child.StudentID),
        subjects = new Map();
      for (const row of own) {
        if (!subjects.has(row.SubjectName)) subjects.set(row.SubjectName, {});
        subjects.get(row.SubjectName)[row.Component] = row;
      }
      if (!subjects.size) return "";
      return `<article class="form-class"><h3>${escapeHtml(name(child))}</h3>${table(
        ["Subject", "Approved components"],
        [...subjects.entries()].map(([subject, values]) => [
          escapeHtml(subject),
          ["CA1", "CA2", "EXAM"]
            .filter((component) => values[component])
            .map((component) => `<span class="status-pill ready">${component === "EXAM" ? "Exam" : component}: ${progressValue(values[component])}</span>`)
            .join(" "),
        ]),
      )}</article>`;
    })
    .join("");
}
const progressValue = (row) =>
  `${Number(row.Score)} / ${Number(row.MaximumScore)}`;
function period() {
  const [sessionId, termId] = document
    .querySelector("#period")
    .value.split(":");
  return { sessionId, termId };
}
async function openScores(assignmentId) {
  try {
    selected = { assignmentId, ...period() };
    const key = `${selected.assignmentId}:${selected.sessionId}:${selected.termId}`,
      pack = context.offline ? await readSnapshot() : null,
      s = context.offline
        ? pack?.modules?.teacherWorkspaceSheets?.[key]
        : await api.post("/api/teacher-workspace/scores", selected);
    if (!s)
      throw new Error(
        "This score sheet is not available offline yet. Connect once to synchronize it.",
      );
    selected.sheet = s;
    const rows = s.students || [],
      statuses = Object.fromEntries(
        ["CA1", "CA2", "EXAM"].map((code) => {
          const item = s.componentStatuses?.[code] || {};
          return [
            code,
            String(item.Status || item.status || "NOT_STARTED").toUpperCase(),
          ];
        }),
      ),
      locked = (code) => ["SUBMITTED", "APPROVED"].includes(statuses[code]),
      statusLabel = (status) =>
        status
          .replaceAll("_", " ")
          .toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase());
    document.querySelector("#score-area").innerHTML =
      `<section class="score-workspace"><div class="section-head"><div><p class="eyebrow">Progressive score entry</p><h2>${escapeHtml(s.assignment.SubjectName)}</h2><p>${escapeHtml(s.assignment.ClassName)} ${escapeHtml(s.assignment.ArmName)} · Complete and submit each component independently.</p></div></div><div class="component-progress component-statuses">${["CA1", "CA2", "EXAM"].map((code) => `<span class="${statuses[code] === "APPROVED" ? "done" : ""}">${code} — ${escapeHtml(statusLabel(statuses[code]))}</span>`).join("")}</div><div class="notice"><strong>Save Draft</strong> keeps editable component scores for later. Submitted components remain locked while Management reviews them.</div><div id="score-validation-summary" class="form-error score-validation-summary" hidden></div><div class="table-wrap score-table"><table><thead><tr><th>Student Name</th><th>Admission Number</th><th>CA1 /20</th><th>CA2 /20</th><th>Exam /60</th><th>Total /100</th><th>Grade</th></tr></thead><tbody>${rows
        .map(
          (x) =>
            `<tr data-student="${x.StudentID}"><td class="score-student-name"><strong>${escapeHtml(name(x))}</strong></td><td class="score-admission">${escapeHtml(x.AdmissionNumber)}</td>${[
              ["ca1", 20, x.Ca1],
              ["ca2", 20, x.Ca2],
              ["exam", 60, x.Exam],
            ]
              .map(([component, max, value]) => {
                const code =
                  component === "exam" ? "EXAM" : component.toUpperCase();
                return `<td><input inputmode="numeric" type="number" min="0" max="${max}" step="1" data-score="${component}" value="${value == null || value === "" ? "" : Number(value)}" ${locked(code) ? "disabled" : ""}></td>`;
              })
              .join("")}<td data-total>0</td><td data-grade>${escapeHtml(x.Grade || "—")}</td></tr>`,
        )
        .join(
          "",
        )}</tbody></table></div><div class="score-actions component-score-actions"><div><strong>Progressive submission</strong><span>Only complete, editable components can be submitted.</span></div><button class="btn btn-secondary" id="save-draft">Save Draft</button>${[
        ["CA1", "CA1"],
        ["CA2", "CA2"],
        ["EXAM", "Exam"],
      ]
        .map(
          ([code, label]) =>
            `<button class="btn btn-primary" data-submit-component="${code}" ${context.offline || locked(code) ? "disabled" : ""}>Submit ${label}</button>`,
        )
        .join("")}</div></section>`;
    document.querySelectorAll("[data-score]").forEach(
      (x) =>
        (x.oninput = () => {
          validateScoreInput(x);
          totals();
        }),
    );
    totals();
    document.querySelector("#save-draft").onclick = () => save(false);
    document
      .querySelectorAll("[data-submit-component]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            submitComponent(button.dataset.submitComponent, button)),
      );
    document
      .querySelector("#score-area")
      .scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    showError(e);
  }
}
function totals() {
  document
    .querySelectorAll("[data-student]")
    .forEach(
      (row) =>
        (row.querySelector("[data-total]").textContent = [
          ...row.querySelectorAll("[data-score]"),
        ]
          .reduce((n, x) => n + Number(x.value || 0), 0)
          .toFixed(0)),
    );
}
async function submitComponent(component, button) {
  const field = component === "EXAM" ? "exam" : component.toLowerCase(),
    inputs = [...document.querySelectorAll(`[data-score="${field}"]`)];
  const invalid = inputs.filter(
    (input) => input.value === "" || !validateScoreInput(input),
  );
  if (invalid.length) {
    invalid
      .filter((input) => input.value === "")
      .forEach((input) => input.classList.add("score-invalid"));
    const max = component === "EXAM" ? 60 : 20,
      over = invalid.some((input) => Number(input.value) > max),
      message = over
        ? `${component} cannot exceed ${max}. Please correct the highlighted score(s) before submission.`
        : `Please complete ${invalid.length} highlighted ${component} score${invalid.length === 1 ? "" : "s"} before submission.`;
    const summary = document.querySelector("#score-validation-summary");
    summary.textContent = message;
    summary.hidden = false;
    showToast(message);
    invalid[0].scrollIntoView({ behavior: "smooth", block: "center" });
    invalid[0].focus();
    return;
  }
  if (
    !(await confirmDialog(
      `Submit ${component}`,
      `Submit the completed ${component} scores to Management for review?`,
      { confirmLabel: `Submit ${component}` },
    ))
  )
    return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Submitting…";
  try {
    await api.post("/api/teacher-workspace/submit-component", {
      ...payload(),
      component,
    });
    showToast(`${component} submitted to Management.`);
    await openScores(selected.assignmentId);
  } catch (error) {
    showError(error);
  } finally {
    button.textContent = label;
  }
}
function validateScoreInput(input) {
  const invalid = input.value !== "" && !input.checkValidity(),
    cell = input.closest("td");
  input.classList.toggle("score-invalid", invalid);
  cell?.querySelector(".score-field-error")?.remove();
  if (invalid) {
    const error = document.createElement("small");
    error.className = "score-field-error";
    error.textContent = `Maximum ${input.dataset.score === "exam" ? "Exam" : input.dataset.score.toUpperCase()} score is ${input.max}.`;
    cell?.appendChild(error);
  }
  if (!document.querySelector(".score-invalid")) {
    const summary = document.querySelector("#score-validation-summary");
    if (summary) summary.hidden = true;
  }
  return !invalid;
}
function payload() {
  const originals = new Map(
    (selected.sheet?.students || []).map((x) => [x.StudentID, x]),
  );
  return {
    assignmentId: selected.assignmentId,
    sessionId: selected.sessionId,
    termId: selected.termId,
    scores: [...document.querySelectorAll("[data-student]")].map((r) => {
      const old = originals.get(r.dataset.student) || {};
      return {
        studentId: r.dataset.student,
        ca1: r.querySelector('[data-score="ca1"]').value,
        ca2: r.querySelector('[data-score="ca2"]').value,
        exam: r.querySelector('[data-score="exam"]').value,
        ca1UpdatedAt: old.Ca1UpdatedAt || "",
        ca2UpdatedAt: old.Ca2UpdatedAt || "",
        examUpdatedAt: old.ExamUpdatedAt || "",
      };
    }),
  };
}
async function save(submit) {
  if (
    submit &&
    !(await confirmDialog(
      "Submit complete scores",
      "Submit only when CA1, CA2 and Exam are complete for every student.",
      { confirmLabel: "Submit Scores" },
    ))
  )
    return;
  const b = document.querySelector(submit ? "#submit-scores" : "#save-draft"),
    label = b.textContent;
  b.disabled = true;
  b.textContent = submit ? "Submitting scores…" : "Saving scores…";
  try {
    const data = payload();
    if (context.offline) {
      if (submit) throw new Error("Reconnect to submit final scores.");
      await queueOperation({
        entityType: "TeacherAssignment",
        action: "teacherWorkspace.save",
        payload: data,
      });
      const pack = await readSnapshot(),
        key = `${data.assignmentId}:${data.sessionId}:${data.termId}`,
        sheet = pack?.modules?.teacherWorkspaceSheets?.[key];
      if (sheet) {
        const values = new Map(data.scores.map((x) => [x.studentId, x]));
        for (const row of sheet.students || []) {
          const value = values.get(row.StudentID);
          if (value) {
            row.Ca1 = value.ca1;
            row.Ca2 = value.ca2;
            row.Exam = value.exam;
          }
        }
        await saveSnapshot(pack, false);
      }
      selected.sheet = sheet || selected.sheet;
      showToast(
        "You're offline. Your changes are safely stored on this device.",
      );
    } else {
      await api.post(
        `/api/teacher-workspace/${submit ? "submit" : "save"}`,
        data,
      );
      showToast(
        submit
          ? "Scores submitted successfully."
          : "Scores saved successfully. You can return later.",
      );
      await openScores(selected.assignmentId);
    }
  } catch (e) {
    showError(e);
  } finally {
    b.disabled = context.offline && submit;
    b.textContent = label;
  }
}
async function compile(assignmentId) {
  if (
    !(await confirmDialog(
      "Compile reports",
      "Compile after every required subject is submitted?",
      { confirmLabel: "Compile Reports" },
    ))
  )
    return;
  try {
    const r = await api.post("/api/teacher-workspace/compile", {
      assignmentId,
      ...period(),
    });
    showToast(`Reports compiled successfully for ${r.students} students.`);
    await render(context);
  } catch (e) {
    showError(e);
  }
}

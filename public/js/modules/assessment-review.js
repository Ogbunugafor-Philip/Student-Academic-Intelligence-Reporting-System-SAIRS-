import {
  hero,
  setMain,
  table,
  badge,
  escapeHtml,
  showToast,
  showError,
  formDialog,
  confirmDialog,
} from "../ui.js";
import { api } from "../api.js";
import { openCompiledReport } from "./generated-reports.js";
let componentPage = 0,
  reportPage = 0,
  status = "SUBMITTED",
  activeTab = "components";
const e = escapeHtml,
  name = (x) =>
    [x.TeacherFirstName, x.TeacherMiddleName, x.TeacherLastName]
      .filter(Boolean)
      .join(" ");
export async function render() {
  setMain(
    hero(
      "results",
      "Management review",
      "Assessment Review",
      "Review submitted assessment components and make the final decision on compiled class reports.",
    ) +
      `<section class="card review-workspace"><div class="review-tabs" role="tablist"><button class="review-tab is-active" data-tab="components" role="tab">Assessment Components</button><button class="review-tab" data-tab="reports" role="tab">Compiled Class Reports</button></div><div id="component-panel" class="review-panel"><div class="toolbar"><label>Status<select id="component-status"><option value="SUBMITTED" selected>Pending submitted</option><option value="APPROVED">Approved</option><option value="RETURNED">Returned</option><option value="">All decisions</option></select></label></div><div id="component-list"></div><div class="dialog-actions" id="component-pages"></div></div><div id="report-panel" class="review-panel" hidden><div class="review-panel-intro"><div><p class="eyebrow">Final Management Decision</p><h2>Compiled Class Reports</h2><p>Inspect the complete class result, then approve and publish it in one protected action or return it with a correction reason.</p></div></div><div id="report-list"></div><div class="dialog-actions" id="report-pages"></div></div></section>`,
    "Assessment Review",
  );
  document.querySelector("#component-status").onchange = (ev) => {
    status = ev.target.value;
    loadComponents(0);
  };
  document
    .querySelectorAll("[data-tab]")
    .forEach(
      (button) => (button.onclick = () => switchTab(button.dataset.tab)),
    );
  await loadComponents(0);
}
async function switchTab(tab) {
  activeTab = tab;
  document
    .querySelectorAll("[data-tab]")
    .forEach((button) =>
      button.classList.toggle("is-active", button.dataset.tab === tab),
    );
  document.querySelector("#component-panel").hidden = tab !== "components";
  document.querySelector("#report-panel").hidden = tab !== "reports";
  if (tab === "reports") await loadReports(0);
}
async function loadComponents(next) {
  try {
    const d = await api.post("/api/management/component-reviews", {
      status,
      limit: 25,
      offset: next * 25,
    });
    componentPage = next;
    document.querySelector("#component-list").innerHTML = table(
      [
        "Teacher",
        "Subject",
        "Class",
        "Arm",
        "Academic Session",
        "Term",
        "Component",
        "Submitted Date",
        "Status",
        "Actions",
      ],
      (d.rows || []).map((x) => [
        e(name(x)),
        e(x.SubjectName),
        e(x.ClassName),
        e(x.ArmName || "—"),
        e(x.SessionName),
        e(x.TermName),
        e(x.Component),
        x.SubmittedAt ? new Date(x.SubmittedAt).toLocaleString() : "—",
        badge(x.Status),
        `<button class="btn btn-quiet" data-view="${x.ID}">View Scores</button>${x.Status === "Submitted" ? ` <button class="btn btn-primary" data-decide="APPROVED" data-id="${x.ID}">Approve</button> <button class="btn btn-secondary" data-decide="RETURNED" data-id="${x.ID}">Return</button>` : ""}`,
      ]),
      "No component submissions match this status.",
    );
    bindComponents(d.rows || []);
    pages("component-pages", d.total, componentPage, loadComponents);
  } catch (err) {
    showError(err);
  }
}
function pages(target, total, current, loader) {
  const count = Math.max(1, Math.ceil(total / 25)),
    container = document.querySelector(`#${target}`);
  container.innerHTML = `<button class="btn btn-secondary" data-page="${current - 1}" ${current < 1 ? "disabled" : ""}>Previous</button><span>Page ${current + 1} of ${count}</span><button class="btn btn-secondary" data-page="${current + 1}" ${current + 1 >= count ? "disabled" : ""}>Next</button>`;
  container
    .querySelectorAll("[data-page]")
    .forEach(
      (button) => (button.onclick = () => loader(Number(button.dataset.page))),
    );
}
function bindComponents(rows) {
  document
    .querySelectorAll("[data-view]")
    .forEach(
      (b) =>
        (b.onclick = () => scores(rows.find((x) => x.ID === b.dataset.view))),
    );
  document
    .querySelectorAll("[data-decide]")
    .forEach(
      (b) =>
        (b.onclick = () => decideComponent(b.dataset.id, b.dataset.decide)),
    );
}
function scores(item) {
  const max = item.Component === "EXAM" ? 60 : 20,
    dialog = document.createElement("dialog");
  dialog.className = "dialog management-score-dialog";
  dialog.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">Submitted scores</p><h2>${e(item.SubjectName)} — ${e(item.Component)}</h2></div><button class="icon-btn" data-close>×</button></div>${table(
    ["Student Name", "Admission Number", `Component Score /${max}`],
    (item.Scores || []).map((x) => [
      e(x.StudentName),
      e(x.AdmissionNumber),
      Number(x.Score),
    ]),
    "No stored scores found.",
  )}`;
  document.body.appendChild(dialog);
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.onclose = () => dialog.remove();
  dialog.showModal();
}
async function decideComponent(id, decision) {
  formDialog(
    decision === "RETURNED" ? "Return for correction" : "Approve component",
    [
      {
        name: "comment",
        label: decision === "RETURNED" ? "Return reason" : "Review note",
        type: "textarea",
        required: decision === "RETURNED",
        value: "",
      },
    ],
    async (v) => {
      await api.post("/api/management/component-reviews/decision", {
        submissionId: id,
        decision,
        comment: v.comment,
      });
      showToast(
        decision === "RETURNED"
          ? "Component returned for correction."
          : "Component approved.",
      );
      await loadComponents(componentPage);
    },
  );
}
async function loadReports(next) {
  try {
    const d = await api.post("/api/management/compiled-results", {
      status: "SUBMITTED",
      limit: 25,
      offset: next * 25,
    });
    reportPage = next;
    document.querySelector("#report-list").innerHTML = table(
      [
        "Class",
        "Arm",
        "Form Teacher",
        "Academic Session",
        "Term",
        "Students",
        "Submitted Date",
        "Status",
        "Actions",
      ],
      (d.rows || []).map((x) => [
        e(x.ClassName),
        e(x.ArmName || "—"),
        e(x.FormTeacherName),
        e(x.SessionName),
        e(x.TermName),
        x.StudentCount,
        x.SubmittedAt ? new Date(x.SubmittedAt).toLocaleString() : "—",
        badge(x.Status),
        `<button class="btn btn-quiet" data-view-report="${x.ID}">View Report</button> <button class="btn btn-primary" data-approve-report="${x.ID}" data-label="${e(`${x.ClassName} ${x.ArmName || ""} · ${x.SessionName} · ${x.TermName} · ${x.StudentCount} students`)}">Approve Report</button> <button class="btn btn-secondary" data-return-report="${x.ID}">Return for Correction</button>`,
      ]),
      "No compiled class reports are awaiting Management approval.",
    );
    document
      .querySelectorAll("[data-view-report]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            openCompiledReport(button.dataset.viewReport)),
      );
    document
      .querySelectorAll("[data-approve-report]")
      .forEach((button) => (button.onclick = () => approveReport(button)));
    document
      .querySelectorAll("[data-return-report]")
      .forEach(
        (button) =>
          (button.onclick = () => returnReport(button.dataset.returnReport)),
      );
    pages("report-pages", d.total, reportPage, loadReports);
  } catch (error) {
    showError(error);
  }
}
async function approveReport(button) {
  if (
    !(await confirmDialog(
      "Approve and publish report",
      `Confirm final approval for ${button.dataset.label}. This publishes every student's versioned report card and makes it visible to authorised parents and teachers.`,
      { confirmLabel: "Approve Report" },
    ))
  )
    return;
  button.disabled = true;
  try {
    const d = await api.post("/api/management/compiled-results/approve", {
      submissionId: button.dataset.approveReport,
    });
    showToast(
      `${d.className}${d.armName ? ` ${d.armName}` : ""} ${d.termName} reports have been approved and published successfully.`,
    );
    await loadReports(reportPage);
  } catch (error) {
    button.disabled = false;
    showError(error);
  }
}
async function returnReport(id) {
  formDialog(
    "Return for correction",
    [
      {
        name: "comment",
        label: "Correction reason",
        type: "textarea",
        required: true,
        value: "",
      },
    ],
    async (values) => {
      await api.post("/api/management/compiled-results/decision", {
        submissionId: id,
        decision: "RETURNED",
        comment: values.comment,
      });
      showToast("Compiled report returned to the Form Teacher for correction.");
      await loadReports(reportPage);
    },
  );
}

import { hero, setMain, table, badge, escapeHtml, showError } from "../ui.js";
import { api } from "../api.js";
import { reportHtml } from "./report-view.js?v=sairs-v44";
let page = 0;
const e = escapeHtml;
const whole = (value) =>
    value == null || value === "" || !Number.isFinite(Number(value))
      ? "—"
      : String(Number(value)),
  value = (value) => (value == null || value === "" ? "—" : String(value)),
  ordinal = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    const mod100 = n % 100,
      suffix =
        mod100 >= 11 && mod100 <= 13
          ? "th"
          : n % 10 === 1
            ? "st"
            : n % 10 === 2
              ? "nd"
              : n % 10 === 3
                ? "rd"
                : "th";
    return `${n}${suffix}`;
  };
export async function render() {
  setMain(
    hero(
      "reports",
      "Published results archive",
      "Generated Report Cards",
      "View and download report cards that Management has already approved and published.",
    ) +
      `<section class="card"><div id="compiled-list"></div><div class="dialog-actions" id="compiled-pages"></div></section>`,
    "Generated Report Cards",
  );
  await load(0);
}
async function load(next) {
  try {
    const d = await api.post("/api/management/compiled-results", {
      status: "PUBLISHED",
      limit: 25,
      offset: next * 25,
    });
    page = next;
    document.querySelector("#compiled-list").innerHTML = table(
      [
        "Class",
        "Arm",
        "Form Teacher",
        "Academic Session",
        "Term",
        "Students",
        "Published Date",
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
        x.PublishedAt ? new Date(x.PublishedAt).toLocaleString() : "—",
        badge(x.Status),
        `<button class="btn btn-primary" data-open="${x.ID}">View Reports</button>`,
      ]),
      "No report cards have been published yet.",
    );
    document
      .querySelectorAll("[data-open]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            openCompiledReport(b.dataset.open, { archive: true })),
      );
    const pages = Math.max(1, Math.ceil(d.total / 25));
    document.querySelector("#compiled-pages").innerHTML =
      `<button class="btn btn-secondary" data-page="${page - 1}" ${page < 1 ? "disabled" : ""}>Previous</button><span>Page ${page + 1} of ${pages}</span><button class="btn btn-secondary" data-page="${page + 1}" ${page + 1 >= pages ? "disabled" : ""}>Next</button>`;
    document
      .querySelectorAll("[data-page]")
      .forEach((b) => (b.onclick = () => load(Number(b.dataset.page))));
  } catch (err) {
    showError(err);
  }
}
export async function openCompiledReport(id, { archive = false } = {}) {
  try {
    const d = await api.post("/api/management/compiled-results/detail", {
        submissionId: id,
      }),
      s = d.submission,
      dialog = document.createElement("dialog");
    dialog.className = "dialog compiled-result-dialog";
    dialog.innerHTML = `<div class="dialog-head compiled-result-head"><div><p class="eyebrow">${archive ? "Published Report Cards" : "Compiled Class Report"}</p><h2>${e(s.ClassName)} ${e(s.ArmName || "")}</h2><p>${e(s.SchoolName)}</p></div><button class="icon-btn" data-close aria-label="Close">×</button></div><dl class="compiled-class-summary"><div><dt>Academic Session</dt><dd>${e(s.SessionName)}</dd></div><div><dt>Term</dt><dd>${e(s.TermName)}</dd></div><div><dt>Form Teacher</dt><dd>${e(s.FormTeacherName)}</dd></div><div><dt>Students</dt><dd>${d.students.length}</dd></div><div><dt>Status</dt><dd>${badge(s.Status)}</dd></div></dl><section class="compiled-student-list"><div class="compiled-section-title"><p class="eyebrow">Student Results</p><h3>Academic Performance</h3><span>${archive ? "Open a published report card or download its stored PDF." : "Select a student to inspect the submitted subject scores."}</span></div>${d.students.map((x, index) => `<details class="compiled-student-card" ${index === 0 ? "open" : ""}><summary><div><strong>${e(x.StudentName)}</strong><span>Admission No: ${e(x.AdmissionNumber)}</span></div><dl><div><dt>Average</dt><dd>${Number(x.StudentAverage).toFixed(2)}</dd></div><div><dt>Overall Position</dt><dd>${ordinal(x.OverallPosition)}</dd></div></dl><span class="compiled-toggle"><i class="when-closed">View Subjects</i><i class="when-open">Collapse</i></span></summary><div class="compiled-table-wrap"><table class="compiled-subject-table"><thead><tr><th>Subject</th><th>CA1 /20</th><th>CA2 /20</th><th>Exam /60</th><th>Total /100</th><th>Grade</th><th>Position</th></tr></thead><tbody>${(x.Subjects || []).map((y) => `<tr><td>${e(value(y.Subject))}</td><td>${whole(y.Ca1)}</td><td>${whole(y.Ca2)}</td><td>${whole(y.Exam)}</td><td>${whole(y.Total)}</td><td>${e(value(y.Grade))}</td><td>${ordinal(y.Position)}</td></tr>`).join("")}</tbody></table></div>${archive && x.ReportCard ? `<div class="compiled-report-actions"><span>Published version ${e(x.ReportCard.ReportVersion)} · ${new Date(x.ReportCard.PublishedAt).toLocaleString()}</span><button class="btn btn-secondary" data-view-report="${x.ReportCard.ID}">View Report</button><button class="btn btn-primary" data-download-report="${x.ReportCard.ID}">Download PDF</button></div>` : archive ? `<p class="empty-state">Published report file unavailable for this student.</p>` : ""}</details>`).join("")}</section><div class="dialog-actions"><button class="btn btn-primary" data-close>Done</button></div>`;
    document.body.appendChild(dialog);
    dialog
      .querySelectorAll("[data-close]")
      .forEach((button) => (button.onclick = () => dialog.close()));
    dialog
      .querySelectorAll("[data-view-report]")
      .forEach(
        (button) =>
          (button.onclick = () => viewReport(button.dataset.viewReport)),
      );
    dialog
      .querySelectorAll("[data-download-report]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            downloadReport(button.dataset.downloadReport)),
      );
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
  } catch (err) {
    showError(err);
  }
}
async function viewReport(reportCardId) {
  try {
    const report = await api.post("/api/reports/view", { reportCardId }),
      dialog = document.createElement("dialog");
    dialog.className = "dialog report-preview-dialog";
    dialog.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">Published report card</p><h2>Report Preview</h2></div><button class="icon-btn" data-close aria-label="Close">×</button></div>${reportHtml(report)}<div class="dialog-actions"><button class="btn btn-primary" data-close>Done</button></div>`;
    document.body.appendChild(dialog);
    dialog
      .querySelectorAll("[data-close]")
      .forEach((button) => (button.onclick = () => dialog.close()));
    dialog.onclose = () => dialog.remove();
    dialog.showModal();
  } catch (error) {
    showError(error);
  }
}
async function downloadReport(reportCardId) {
  try {
    const file = await api.post("/api/reports/download", { reportCardId }),
      bytes = Uint8Array.from(atob(file.base64), (character) =>
        character.charCodeAt(0),
      ),
      url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType })),
      link = document.createElement("a");
    link.href = url;
    link.download = file.fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    showError(error);
  }
}

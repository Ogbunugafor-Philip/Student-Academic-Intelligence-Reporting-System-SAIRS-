import { hero, setMain, table, escapeHtml, badge, showError } from "../ui.js";
import { api } from "../api.js";
import { name, academicNumber, ordinal } from "./_shared.js";
import { reportHtml } from "./report-view.js?v=sairs-v44";

let page = 0, total = 0, students = [];

export async function render(ctx) {
  if (ctx.offline)
    return setMain(hero("performance", "Academic history", "Performance Reports", "Connect to search published student performance history.") + '<section class="card"><div class="empty">Performance search is available online.</div></section>', "Performance Reports");
  const parentMode = ctx.user?.role === "PARENT";
  setMain(hero("performance", "Academic history", "Performance Reports", parentMode ? "View permitted academic history for your linked children." : "Search a student and inspect published performance across sessions and terms.") +
    `<section class="card performance-directory"><div class="section-head"><div><h2>${parentMode ? "My Children" : "Search Students"}</h2><p>${parentMode ? "Only children linked to your parent account are listed." : "Search by student name, admission number, guardian, class or arm."}</p></div></div>${parentMode ? "" : '<div class="toolbar performance-search"><input id="performance-search" aria-label="Search students" placeholder="Search Students"></div>'}<div id="performance-students"></div><div class="dialog-actions" id="performance-pages"><button class="btn btn-secondary" data-page="previous" disabled>Previous</button><span>Page 1</span><button class="btn btn-secondary" data-page="next">Next</button></div><div id="performance-output"></div></section>`, "Performance Reports");
  let timer;
  if (!parentMode) document.querySelector("#performance-search").oninput = () => { clearTimeout(timer); timer = setTimeout(() => load(0), 250); };
  document.querySelector('[data-page="previous"]').onclick = () => load(page - 1);
  document.querySelector('[data-page="next"]').onclick = () => load(page + 1);
  await load(0);
}

async function load(next) {
  try {
    const result = await api.post("/api/performance/students", { search: document.querySelector("#performance-search")?.value || "", limit: 25, offset: next * 25 });
    students = result.rows || []; total = Number(result.total || 0); page = next;
    document.querySelector("#performance-students").innerHTML = table(["Admission Number", "Student Name", "Current Class", "Current Arm", "Status", "Action"], students.map((x) => [escapeHtml(x.AdmissionNumber), escapeHtml(name(x)), escapeHtml(x.ClassName || "—"), escapeHtml(x.ArmName || "—"), badge(x.Status || "—"), `<button class="btn btn-primary" data-student="${x.StudentID}">View Performance</button>`]), "No matching students.");
    document.querySelectorAll("[data-student]").forEach((b) => b.onclick = () => view(b.dataset.student));
    const pages = document.querySelector("#performance-pages");
    pages.querySelector("span").textContent = `Page ${page + 1} of ${Math.max(1, Math.ceil(total / 25))}`;
    pages.querySelector('[data-page="previous"]').disabled = page === 0;
    pages.querySelector('[data-page="next"]').disabled = (page + 1) * 25 >= total;
  } catch (error) { showError(error); }
}

function latestReports(rows) {
  const effective = new Map();
  for (const report of rows || []) {
    if (report.Status !== "Published") continue;
    const key = `${report.SessionID}:${report.TermID}`, prior = effective.get(key);
    if (!prior || Number(report.ReportVersion || 0) > Number(prior.ReportVersion || 0) || (Number(report.ReportVersion || 0) === Number(prior.ReportVersion || 0) && String(report.PublishedAt || "") > String(prior.PublishedAt || ""))) effective.set(key, report);
  }
  return effective;
}

async function view(studentId) {
  try {
    const d = await api.post("/api/performance/student", { studentId }), p = d.profile || {}, groups = new Map(), reports = latestReports(d.reports);
    for (const row of d.results || []) {
      const key = `${row.SessionID}:${row.TermID}:${row.ClassID}:${row.ClassArmID || ""}`;
      if (!groups.has(key)) groups.set(key, { sessionId: row.SessionID, termId: row.TermID, session: row.SessionName, term: row.TermName, className: row.ClassName || p.ClassName, armName: row.ArmName || p.ArmName, rows: [] });
      groups.get(key).rows.push(row);
    }
    const history = [...groups.values()].map((g) => {
      const first = g.rows[0] || {}, card = reports.get(`${g.sessionId}:${g.termId}`);
      return `<article class="history-term performance-period"><h3>${escapeHtml(g.session)} — ${escapeHtml(g.term)}</h3><dl class="performance-profile performance-summary"><div><dt>Student</dt><dd>${escapeHtml(name(p))}</dd></div><div><dt>Class and Arm</dt><dd>${escapeHtml(`${g.className || "—"} ${g.armName || ""}`)}</dd></div><div><dt>Academic Session</dt><dd>${escapeHtml(g.session)}</dd></div><div><dt>Academic Term</dt><dd>${escapeHtml(g.term)}</dd></div><div><dt>Overall Average</dt><dd>${academicNumber(first.StudentAverage, "%")}</dd></div><div><dt>Overall Class Position</dt><dd>${ordinal(first.OverallPosition)}</dd></div><div><dt>Number of Subjects</dt><dd>${g.rows.length}</dd></div></dl>${table(["Subject", "CA1", "CA2", "Examination", "Total", "Grade", "Subject Position"], g.rows.map((x) => [escapeHtml(x.SubjectName), academicNumber(x.Ca1Score), academicNumber(x.Ca2Score), academicNumber(x.ExaminationScore), academicNumber(x.TotalScore), escapeHtml(x.Grade || "—"), ordinal(x.SubjectPosition)]), "No published subjects.")}${card ? `<div class="dialog-actions"><button class="btn btn-secondary" data-view-report="${card.ID}">View Report</button><button class="btn btn-primary" data-download-report="${card.ID}">Download Report</button></div>` : ""}</article>`;
    }).join("");
    document.querySelector("#performance-output").innerHTML = `<section class="performance-history"><div class="student-performance-head"><p class="eyebrow">Student Performance Summary</p><h2>${escapeHtml(name(p))}</h2><p>${escapeHtml(p.AdmissionNumber || "")}</p></div><div class="academic-history">${history || '<div class="empty">No published performance history is available.</div>'}</div></section>`;
    document.querySelectorAll("[data-view-report]").forEach((b) => b.onclick = () => viewReport(b.dataset.viewReport));
    document.querySelectorAll("[data-download-report]").forEach((b) => b.onclick = () => downloadReport(b.dataset.downloadReport));
  } catch (error) { showError(error); }
}

async function viewReport(reportCardId) {
  try {
    const report = await api.post("/api/reports/view", { reportCardId }), dialog = document.createElement("dialog");
    dialog.className = "dialog report-preview-dialog";
    dialog.innerHTML = `<div class="dialog-head"><h2>Published Report</h2><button class="icon-btn" data-close>×</button></div>${reportHtml(report)}<div class="dialog-actions"><button class="btn btn-primary" data-close>Done</button></div>`;
    document.body.appendChild(dialog); dialog.querySelectorAll("[data-close]").forEach((b) => b.onclick = () => dialog.close()); dialog.onclose = () => dialog.remove(); dialog.showModal();
  } catch (error) { showError(error); }
}

async function downloadReport(reportCardId) {
  try {
    const file = await api.post("/api/reports/download", { reportCardId }), bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0)), url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType })), link = document.createElement("a");
    link.href = url; link.download = file.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { showError(error); }
}

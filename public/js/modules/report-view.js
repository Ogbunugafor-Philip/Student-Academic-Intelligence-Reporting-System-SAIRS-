import { escapeHtml } from "../ui.js";
const e = escapeHtml,
  fullName = (value) =>
    [value?.FirstName, value?.MiddleName, value?.LastName]
      .filter(Boolean)
      .join(" "),
  score = (value) =>
    value == null || value === "" || !Number.isFinite(Number(value))
      ? "—"
      : String(Number(value)),
  date = (value) =>
    value
      ? new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(value))
      : "—",
  ordinal = (value) => {
    const n = Number(value);
    if (!n) return "—";
    const mod100 = n % 100;
    return `${n}${mod100 >= 11 && mod100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
  },
  positionInClass = (position, classSize) =>
    classSize ? `${ordinal(position)} out of ${classSize}` : ordinal(position);
export function reportHtml(report) {
  const rows = report.displayResults || report.results || [],
    summary = report.summary || {},
    publication = report.publication || {},
    rules = report.gradingRules || [],
    verificationUrl = report.verificationUrl || "",
    token = verificationUrl.split("/").pop(),
    logo =
      report.logoData ||
      (/growthengine demonstration school/i.test(report.school?.Name || "")
        ? "/assets/images/growthengine-demo-crest.svg"
        : "");
  return `<article class="report-browser premium-report-browser"><header class="premium-school-head">${logo ? `<img src="${logo}" alt="${e(report.school?.Name)} crest">` : ""}<div><h2>${e(report.school?.Name || "School")}</h2><p>${e(report.school?.Motto || "")}</p></div></header><section class="premium-report-band"><h3>ACADEMIC REPORT CARD</h3><p>${e(report.session?.Name)} ACADEMIC SESSION &nbsp; | &nbsp; ${e(report.term?.Name)}</p></section><h4 class="premium-section-title">STUDENT INFORMATION</h4><dl class="premium-student-grid"><div><dt>Name</dt><dd>${e(fullName(report.student))}</dd></div><div><dt>Academic Session</dt><dd>${e(report.session?.Name)}</dd></div><div><dt>Admission No.</dt><dd>${e(report.student?.AdmissionNumber)}</dd></div><div><dt>Term</dt><dd>${e(report.term?.Name)}</dd></div><div><dt>Class</dt><dd>${e(report.classRow?.Name)}</dd></div><div><dt>Number of Subjects</dt><dd>${rows.length}</dd></div><div><dt>Arm</dt><dd>${e(report.arm?.Name || "—")}</dd></div><div><dt>Students in Class</dt><dd>${e(summary.classSize || "—")}</dd></div></dl><h4 class="premium-section-title">ACADEMIC PERFORMANCE</h4><div class="premium-table-wrap"><table><thead><tr><th>S/N</th><th>Subject</th><th>CA1<br>/20</th><th>CA2<br>/20</th><th>Exam<br>/60</th><th>Total<br>/100</th><th>Grade</th><th>Remark</th><th>Position</th></tr></thead><tbody>${rows.map((x, index) => `<tr><td>${index + 1}</td><td>${e(x.SubjectName)}</td><td>${score(x.Ca1Score)}</td><td>${score(x.Ca2Score)}</td><td>${score(x.ExaminationScore)}</td><td>${score(x.TotalScore)}</td><td>${e(x.Grade)}</td><td>${e(x.Remark || "—")}</td><td>${e(x.SubjectPositionLabel || ordinal(x.SubjectPosition))}</td></tr>`).join("")}</tbody></table></div><section class="premium-summary-row"><div><h4>PERFORMANCE SUMMARY</h4><dl><div><dt>Total Subjects</dt><dd>${rows.length}</dd></div><div><dt>Student Average</dt><dd>${score(summary.studentAverage ?? rows[0]?.StudentAverage)}</dd></div><div><dt>Overall Position</dt><dd>${e(positionInClass(summary.overallPosition ?? rows[0]?.OverallPosition, summary.classSize))}</dd></div></dl></div><div><h4>GRADE KEY</h4><table><thead><tr><th>Grade</th><th>Score Range</th><th>Remark</th></tr></thead><tbody>${rules.map((x) => `<tr><td>${e(x.Grade)}</td><td>${Number(x.MinimumScore)} – ${Number(x.MaximumScore)}</td><td>${e(x.Remark)}</td></tr>`).join("")}</tbody></table></div></section><section class="premium-publication-row"><div><span>Form Teacher</span><strong>${e(report.formTeacher || "—")}</strong></div><div><span>Date Published</span><strong>${e(date(publication.publishedAt))}</strong></div>${verificationUrl ? `<div class="premium-qr"><img src="/verify/report/${encodeURIComponent(token)}/qr" alt="Report verification QR code"><strong>Scan to Verify</strong></div>` : ""}</section><footer class="premium-report-footer">GENERATED SECURELY BY SAIRS</footer></article>`;
}
export function printReport(report) {
  const win = open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  win.document.write(
    `<!doctype html><html><head><title>Report Card</title><link rel="stylesheet" href="/css/app.css?v=sairs-v44"></head><body><main class="main">${reportHtml(report)}</main><script>addEventListener('load',()=>print())<\/script></body></html>`,
  );
  win.document.close();
}

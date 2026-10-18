import {
  hero,
  setMain,
  table,
  badge,
  escapeHtml,
  showToast,
  confirmDialog,
  showError,
  infoDialog,
  formDialog,
} from "../ui.js";
import { cachedThenNetwork } from "./_shared.js";
import { api } from "../api.js";
import { reportHtml, printReport } from "./report-view.js?v=sairs-v44";
let context,
  records = [],
  batches = [],
  managers = [],
  componentReviews = [],
  currentReport;
const unique = (items, key, label) => [
  ...new Map(
    items.map((x) => [x[key], { value: x[key], label: label(x) }]),
  ).values(),
];
const options = (items) =>
  items
    .map((x) => `<option value="${x.value}">${escapeHtml(x.label)}</option>`)
    .join("");
export async function render(ctx) {
  context = ctx;
  const [batchResponse, catalog, managementOptions, componentQueue] =
    await Promise.all([
      cachedThenNetwork("results", "/api/results/bootstrap", ctx.offline),
      ctx.offline
        ? Promise.resolve({ records: [] })
        : api.get("/api/reports/catalog"),
      ctx.offline || ctx.user?.role !== "TEACHER"
        ? Promise.resolve([])
        : api.get("/api/results/management-options"),
      ctx.offline || ctx.user?.role !== "MANAGEMENT"
        ? Promise.resolve([])
        : api.get("/api/management/component-reviews"),
    ]);
  batches = Array.isArray(batchResponse.data) ? batchResponse.data : [];
  records = catalog.records || [];
  managers = managementOptions || [];
  componentReviews = componentQueue || [];
  const next = {
    Draft: ["Submit", "submit"],
    Submitted: ["Review", "review"],
    Reviewed: ["Approve", "approve"],
    Approved: ["Publish", "publish"],
  };
  setMain(
    hero(
      "results",
      "Verified outcomes",
      "Results",
      "Select an academic period and student to view the compiled report.",
    ) +
      `<section class="card"><div class="section-head"><h2>Compiled student results</h2></div><div class="toolbar" id="result-selectors"><label>Academic Session<select data-field="SessionID"><option value="">Select session</option>${options(unique(records, "SessionID", (x) => x.SessionName))}</select></label><label>Term<select data-field="TermID" disabled><option value="">Select term</option></select></label><label>Class<select data-field="ClassID" disabled><option value="">Select class</option></select></label><label>Arm<select data-field="ClassArmID" disabled><option value="">Select arm</option></select></label><label>Student<select data-field="StudentID" disabled><option value="">Select student</option></select></label><button class="btn btn-primary" id="view-result">View Report</button></div><div id="class-results"></div><div id="result-report"></div></section>${ctx.user?.role === "MANAGEMENT" ? componentReviewSection() : ""}<section class="card"><div class="section-head"><h2>Approval workflow</h2></div>${table(
        ["Session / Term", "Class / Arm", "Subject", "Status", "Actions"],
        batches.map((x) => {
          const n = next[x.Status],
            actions = [
              `<button class="btn btn-quiet" data-history="${x.BatchID}">History</button>`,
            ];
          if (n && !ctx.offline)
            actions.push(
              `<button class="btn btn-quiet" data-transition="${n[1]}" data-label="${n[0]}" data-batch="${x.BatchID}">${n[0]}</button>`,
            );
          return [
            `${escapeHtml(x.SessionName)} — ${escapeHtml(x.TermName)}`,
            `${escapeHtml(x.ClassName)} ${escapeHtml(x.ArmName || "")}`,
            escapeHtml(x.SubjectName),
            badge(x.Status),
            actions.join(" "),
          ];
        }),
        "No compiled result batches are available.",
      )}</section>`,
    "Results",
  );
  bindSelectors();
  bindWorkflow();
  bindComponentReviews();
}
function componentReviewSection() {
  return `<section class="card"><div class="section-head"><div><h2>Assessment Component Review</h2><p>Approve or return submitted CA1, CA2 and Examination scores.</p></div></div>${table(
    [
      "Teacher",
      "Subject",
      "Class / Arm",
      "Session / Term",
      "Component",
      "Status",
      "Actions",
    ],
    componentReviews.map((x) => [
      [x.TeacherFirstName, x.TeacherMiddleName, x.TeacherLastName]
        .filter(Boolean)
        .join(" "),
      escapeHtml(x.SubjectName),
      `${escapeHtml(x.ClassName)} ${escapeHtml(x.ArmName || "")}`,
      `${escapeHtml(x.SessionName)} — ${escapeHtml(x.TermName)}`,
      escapeHtml(x.Component),
      badge(x.Status),
      `<button class="btn btn-quiet" data-component-scores="${x.ID}">View Scores</button> ${x.Status === "Submitted" ? `<button class="btn btn-primary" data-component-decision="APPROVED" data-submission="${x.ID}">Approve</button> <button class="btn btn-secondary" data-component-decision="RETURNED" data-submission="${x.ID}">Return</button>` : ""}`,
    ]),
    "No component submissions are awaiting review.",
  )}</section>`;
}
function bindComponentReviews() {
  document.querySelectorAll("[data-component-scores]").forEach(
    (button) =>
      (button.onclick = async () => {
        const submission = componentReviews.find(
            (item) => item.ID === button.dataset.componentScores,
          ),
          scores = submission?.Scores || [];
        await infoDialog(
          `${submission?.Component || "Component"} submitted scores`,
          scores
            .map(
              (row) =>
                `${row.AdmissionNumber} — ${row.StudentName}: ${Number(row.Score)}`,
            )
            .join("\n") || "No stored scores were found.",
        );
      }),
  );
  document.querySelectorAll("[data-component-decision]").forEach(
    (button) =>
      (button.onclick = async () => {
        const decision = button.dataset.componentDecision,
          returning = decision === "RETURNED";
        if (
          !(await confirmDialog(
            returning ? "Return component" : "Approve component",
            returning
              ? "Return this component to the teacher for correction?"
              : "Approve and lock this component for parent visibility?",
            { confirmLabel: returning ? "Return" : "Approve" },
          ))
        )
          return;
        try {
          await api.post("/api/management/component-reviews/decision", {
            submissionId: button.dataset.submission,
            decision,
            comment: returning
              ? "Returned by Management"
              : "Approved by Management",
          });
          showToast(
            returning
              ? "Component returned to teacher."
              : "Component approved.",
          );
          render(context);
        } catch (error) {
          showError(error);
        }
      }),
  );
}
function filtered(until) {
  const order = ["SessionID", "TermID", "ClassID", "ClassArmID", "StudentID"],
    values = Object.fromEntries(
      order.map((key) => [
        key,
        document.querySelector(`[data-field="${key}"]`)?.value || "",
      ]),
    );
  return records.filter((row) =>
    order
      .slice(0, order.indexOf(until))
      .every((key) => !values[key] || row[key] === values[key]),
  );
}
function bindSelectors() {
  const fields = [
    ["SessionID", "TermID", (x) => x.TermName],
    ["TermID", "ClassID", (x) => x.ClassName],
    ["ClassID", "ClassArmID", (x) => x.ArmName || "No arm"],
    [
      "ClassArmID",
      "StudentID",
      (x) => [x.FirstName, x.MiddleName, x.LastName].filter(Boolean).join(" "),
    ],
  ];
  for (const [current, next, label] of fields)
    document.querySelector(`[data-field="${current}"]`).onchange = () => {
      const target = document.querySelector(`[data-field="${next}"]`),
        list = filtered(next);
      target.innerHTML = `<option value="">Select ${next === "StudentID" ? "student" : next.replace("ID", "").toLowerCase()}</option>${options(unique(list, next, label))}`;
      target.disabled = !document.querySelector(`[data-field="${current}"]`)
        .value;
      const following = [
        "SessionID",
        "TermID",
        "ClassID",
        "ClassArmID",
        "StudentID",
      ].slice(
        ["SessionID", "TermID", "ClassID", "ClassArmID", "StudentID"].indexOf(
          next,
        ) + 1,
      );
      following.forEach((key) => {
        const element = document.querySelector(`[data-field="${key}"]`);
        element.innerHTML = '<option value="">Select</option>';
        element.disabled = true;
      });
      if (next === "StudentID") drawClass(list);
    };
  document.querySelector("#view-result").onclick = viewSelected;
}
function drawClass(list) {
  document.querySelector("#class-results").innerHTML = table(
    ["Student", "Average", "Overall Position", "Compilation status"],
    list.map((x) => [
      [x.FirstName, x.MiddleName, x.LastName].filter(Boolean).join(" "),
      `${Number(x.StudentAverage || 0).toFixed(2)}%`,
      x.OverallPositionLabel || "—",
      badge(x.WorkflowStatus),
    ]),
    "No compiled students for this selection.",
  );
}
function selection() {
  return Object.fromEntries(
    ["SessionID", "TermID", "ClassID", "ClassArmID", "StudentID"].map((key) => [
      key.charAt(0).toLowerCase() + key.slice(1, -2) + "Id",
      document.querySelector(`[data-field="${key}"]`).value,
    ]),
  );
}
async function viewSelected() {
  const data = selection();
  if (!data.studentId) return showToast("Select a student first.");
  try {
    currentReport = await api.post("/api/reports/view", data);
    document.querySelector("#result-report").innerHTML =
      `${reportHtml(currentReport)}<div class="dialog-actions"><button class="btn btn-secondary" id="print-result">Print</button></div>`;
    document.querySelector("#print-result").onclick = () =>
      printReport(currentReport);
  } catch (error) {
    showError(error);
  }
}
function bindWorkflow() {
  document.querySelectorAll("[data-history]").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          const data = await api.post("/api/results/details", {
            batchId: button.dataset.history,
          });
          await infoDialog(
            "Workflow history",
            (data.history || [])
              .map(
                (x) =>
                  `${new Date(x.ActionAt).toLocaleString()}: ${x.FromStatus || "Created"} → ${x.ToStatus}`,
              )
              .join("\n") || "No workflow history.",
          );
        } catch (error) {
          showError(error);
        }
      }),
  );
  document.querySelectorAll("[data-transition]").forEach(
    (button) =>
      (button.onclick = async () => {
        if (button.dataset.transition === "submit") {
          return formDialog(
            "Submit for Management Review",
            [
              {
                name: "managementUserId",
                label: "Route To",
                options: [
                  { value: "", label: "Automatic assignment" },
                  ...managers.map((x) => ({
                    value: x.UserID,
                    label: x.FullName || x.Email,
                  })),
                ],
              },
            ],
            async (values) => {
              await api.post("/api/results/submit", {
                batchId: button.dataset.batch,
                managementUserId: values.managementUserId || null,
                comment: "Submitted for Management review",
              });
              showToast("Results submitted to Management.");
              render(context);
            },
          );
        }
        if (
          !(await confirmDialog(
            `${button.dataset.label} results`,
            `${button.dataset.label} this subject result batch?`,
            { confirmLabel: button.dataset.label },
          ))
        )
          return;
        try {
          await api.post(`/api/results/${button.dataset.transition}`, {
            batchId: button.dataset.batch,
            comment: `${button.dataset.label} from Results`,
          });
          showToast(`Results ${button.dataset.transition}ed.`);
          render(context);
        } catch (error) {
          showError(error);
        }
      }),
  );
}

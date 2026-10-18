import { hero, cards, setMain, escapeHtml } from "../ui.js";
import { cachedThenNetwork } from "./_shared.js";
import { navigate } from "../router.js";
import { api } from "../api.js";
const action = (label, route, detail) =>
  `<button class="quick-action" data-dashboard-route="${route}"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></button>`;
export async function render(ctx) {
  const response = await cachedThenNetwork(
      "dashboard",
      "/api/dashboard",
      ctx.offline,
    ),
    d = response.data || {},
    c = d.config || {},
    role = d.user?.role || ctx.user?.role,
    admin = role === "IT_ADMIN",
    teacher = role === "TEACHER",
    management = role === "MANAGEMENT",
    parent = role === "PARENT";
  if (management && !ctx.offline)
    d.management = await api.get("/api/management/dashboard");
  const metrics = admin
      ? [
          ["Active Students", d.counts?.students || 0],
          ["Active Teachers", d.counts?.teachers || 0],
          ["Active Management Users", d.counts?.management || 0],
          ["Parents / Guardians", d.counts?.parents || 0],
          ["Classes", d.setup?.Classes || 0],
          ["Subjects", d.setup?.Subjects || 0],
          ["Published Reports", d.counts?.published_reports || 0],
          ["Pending Management Reviews", d.counts?.pending_reviews || 0],
        ]
      : teacher
        ? [
            ["Subjects Taught", d.teacher?.SubjectsTaught || 0],
            ["Classes / Arms Assigned", d.teacher?.ClassesAssigned || 0],
            ["Students Within Assigned Classes", d.teacher?.Students || 0],
            ["Form Teacher", d.teacher?.IsFormTeacher ? "Yes" : "No"],
            ["Form Class", d.teacher?.FormClass || "—"],
            ["Current Academic Session", c.currentSession || "Not configured"],
            ["Current Term", c.currentTerm || "Not configured"],
          ]
        : management
          ? [["Total Active Students",d.management?.counts?.students||0],["Total Active Teachers",d.management?.counts?.teachers||0],["Total Classes",d.management?.counts?.classes||0],["Total Subjects",d.management?.counts?.subjects||0],["Pending Assessment Components",d.management?.counts?.pending_components||0],["Compiled Reports Awaiting Management Review",d.management?.counts?.pending_reports||0],["Published Reports",d.management?.counts?.published_reports||0],["Current Academic Session",c.currentSession||"Not configured"],["Current Term",c.currentTerm||"Not configured"]]
          : parent
            ? [
                ["Children / Wards", d.counts?.children || 0],
                ["Published Reports", d.counts?.published_reports || 0],
                ["Approved Assessments", d.counts?.approved_assessments || 0],
                ["Current Academic Session", c.currentSession || "Not configured"],
                ["Current Term", c.currentTerm || "Not configured"],
              ]
            : [];
  setMain(
    hero(
      "dashboard",
      "Academic context",
      c.schoolName || "SAIRS",
      teacher
        ? "Your teaching responsibilities for the current academic session."
        : parent
          ? "A private overview of your linked children and their available academic records."
        : "Operational school records and academic workflow.",
      [
        c.currentSession || "Session not configured",
        c.currentTerm || "Term not configured",
      ],
    ) +
      cards(metrics) +
      (admin
        ? `<section class="card"><div class="section-head"><div><h2>Core areas</h2><p>Go directly to the production workflows used by the school.</p></div></div><div class="quick-grid">${action("Students", "students", "Registration, guardians and history")}${action("Teachers", "teachers", "Profiles and assignments")}${action("Management", "management", "Review and publishing accounts")}${action("Performance Reports", "performance", "Student academic history")}${action("School & Academic Setup", "administration", "Sessions, classes, subjects and assessment setup")}</div></section>`
        : management ? pendingAttention(d.management?.pending||{}) : ""),
    "Dashboard",
  );
  document
    .querySelectorAll("[data-dashboard-route]")
    .forEach(
      (b) => (b.onclick = () => navigate(b.dataset.dashboardRoute, ctx)),
    );
}
function pendingAttention(pending){
  const classArm=x=>`${x.ClassName||"—"}${x.ArmName||""}`,
    items=[
      ...(pending.components||[]).map(x=>({route:"componentReview",title:x.SubjectName,meta:`${classArm(x)} • ${x.Component}`,owner:`Teacher: ${x.TeacherName||"—"}`,status:x.Status||"Submitted"})),
      ...(pending.compiled||[]).map(x=>({route:"generatedReports",title:`${classArm(x)} Compiled Result`,meta:`${x.ClassName||"—"}${x.ArmName?` • ${x.ArmName}`:""}`,owner:`Form Teacher: ${x.TeacherName||"—"}`,status:"Awaiting Review"})),
    ];
  return `<section class="card"><div class="section-head"><div><h2>Pending Attention</h2><p>Recent items requiring your action.</p></div></div><div class="pending-attention">${items.map(x=>`<article class="pending-attention-item"><div class="pending-attention-copy"><strong class="pending-attention-subject">${escapeHtml(x.title)}</strong><span class="pending-attention-meta">${escapeHtml(x.meta)}</span><span class="pending-attention-owner">${escapeHtml(x.owner)}</span></div><div class="pending-attention-actions"><span class="pending-attention-status">${escapeHtml(String(x.status).toUpperCase())}</span><button class="btn btn-primary" data-dashboard-route="${x.route}">Review</button></div></article>`).join("")||'<div class="refined-empty pending-attention-empty"><strong>You’re all caught up.</strong><p>No items currently require Management attention.</p></div>'}</div></section>`;
}

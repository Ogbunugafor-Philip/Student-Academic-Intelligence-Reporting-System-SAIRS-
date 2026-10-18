import { hero, setMain, escapeHtml } from "../ui.js";
import { api } from "../api.js";

const e = escapeHtml;
let auditPage = 1,
  auditActions = [],
  teacherMode = false,
  managementMode = false,
  parentMode = false;
const modules = [
  "Authentication",
  "Students",
  "Parents",
  "Teachers",
  "Management",
  "Scores",
  "Results",
  "Reports",
  "Imports",
  "Academic Setup",
];
const choices = (items) =>
  `<option value="">All</option>${items.map((x) => `<option value="${e(x)}">${e(label(x))}</option>`).join("")}`;
const label = (value = "") =>
  String(value)
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (x) => x.toUpperCase());
const malformedDates = new Set();
const first = (source, ...keys) =>
  keys
    .map((key) => source?.[key])
    .find((value) => value !== undefined && value !== null);
function normalizeAudit(source = {}) {
  return {
    id: first(source, "ID", "id"),
    createdAt: first(
      source,
      "CreatedAt",
      "created_at",
      "createdAt",
      "Timestamp",
      "timestamp",
    ),
    actorName: first(source, "ActorName", "actor_name", "actorName"),
    actorEmail: first(source, "ActorEmail", "actor_email", "actorEmail"),
    actorRole: first(
      source,
      "ActorRole",
      "actor_role",
      "actorRole",
      "Role",
      "role",
    ),
    action: first(source, "Action", "action"),
    module: first(source, "Module", "module"),
    description: first(source, "Description", "description"),
    entityType: first(source, "EntityType", "entity_type", "entityType"),
    entityReference: first(
      source,
      "EntityReference",
      "entity_reference",
      "entityReference",
    ),
    resultStatus: first(
      source,
      "ResultStatus",
      "result_status",
      "resultStatus",
      "Status",
      "status",
    ),
    context: first(source, "Context", "context") || {},
    oldValue: first(source, "OldValue", "old_value", "oldValue"),
    newValue: first(source, "NewValue", "new_value", "newValue") || {},
  };
}
function auditDate(row) {
  const date = new Date(row.createdAt);
  if (!row.createdAt || Number.isNaN(date.getTime())) {
    if (!malformedDates.has(row.id)) {
      malformedDates.add(row.id);
      console.warn("Malformed audit timestamp", {
        auditId: row.id || "unknown",
      });
    }
    return null;
  }
  return date;
}

export async function render(ctx) {
  teacherMode = ctx.user?.role === "TEACHER";
  managementMode = ctx.user?.role === "MANAGEMENT";
  parentMode = ctx.user?.role === "PARENT";
  setMain(
    hero(
      "audits",
      teacherMode || parentMode ? "My activity" : "System evidence",
      "Audits",
      teacherMode || parentMode
        ? "Review your own recorded account and academic-view activity."
        : "Review immutable activity across the school.",
      [],
    ) +
      `<div class="audit-mobile-bar"><button class="btn btn-secondary" id="audit-filter-open" aria-controls="audit-filters">Filters</button><span>Newest activity first</span></div>
    <div class="audit-workspace">
      <div class="audit-filter-scrim" id="audit-filter-scrim"></div>
      <aside class="audit-filter-panel" id="audit-filters" aria-label="Audit filters">
        <div class="audit-filter-head"><div><p class="eyebrow">Refine activity</p><h2>Filters</h2></div><button class="icon-btn audit-filter-close" type="button" aria-label="Close filters">×</button></div>
        <label>Search Audits<input id="audit-search" placeholder="Name, action, student…"></label>
        <label>Date<select id="audit-date"><option value="">All</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">This Week</option><option value="month">This Month</option><option value="custom">Custom</option></select></label>
        <div class="audit-custom-dates" hidden><label>Custom From<input id="audit-from" type="date"></label><label>Custom To<input id="audit-to" type="date"></label></div>
        ${teacherMode||managementMode||parentMode ? '<label>Child<input id="audit-child" placeholder="Child name"></label><label>Class<input id="audit-class" placeholder="Class"></label><label>Subject<input id="audit-subject" placeholder="Subject"></label><label>Component<input id="audit-component" placeholder="CA1, CA2 or Exam"></label><label>Session<input id="audit-session" placeholder="Academic session"></label><label>Term<input id="audit-term" placeholder="Term"></label>' : `<label>Role<select id="audit-role">${choices(["IT_ADMIN", "MANAGEMENT", "TEACHER", "PARENT"])}</select></label>`}
        <label>Module<select id="audit-module">${choices(modules)}</select></label>
        <label>Action<select id="audit-action">${choices(auditActions)}</select></label>
        <label>Status<select id="audit-status">${choices(["SUCCESS", "FAILED"])}</select></label>
        <div class="audit-filter-actions"><button class="btn btn-primary" id="audit-apply">Apply Filters</button><button class="btn btn-secondary" id="audit-clear">Clear Filters</button></div>
      </aside>
      <main class="audit-activity" aria-label="Audit activity"><div class="audit-activity-head"><div><p class="eyebrow">System-wide trail</p><h2>Audit Activity</h2></div><span>Newest first</span></div><div id="audit-summary"></div><div id="audit-list"><p class="support">${ctx.offline ? "Audits require an online connection." : "Loading activity…"}</p></div></main>
    </div>`,
    "Audits",
  );
  bind(ctx);
  if (!ctx.offline) await loadAudits(1);
}

function bind(ctx) {
  const panel = document.querySelector("#audit-filters"),
    scrim = document.querySelector("#audit-filter-scrim");
  const close = () => {
    panel.classList.remove("open");
    scrim.classList.remove("open");
  };
  document.querySelector("#audit-filter-open").onclick = () => {
    panel.classList.add("open");
    scrim.classList.add("open");
  };
  document.querySelector(".audit-filter-close").onclick = close;
  scrim.onclick = close;
  if (ctx.offline) return;
  document.querySelector("#audit-date").onchange = toggleCustomDates;
  document.querySelector("#audit-apply").onclick = () => {
    close();
    loadAudits(1);
  };
  document.querySelector("#audit-clear").onclick = () => {
    panel
      .querySelectorAll("input,select")
      .forEach((field) => (field.value = ""));
    toggleCustomDates();
    close();
    loadAudits(1);
  };
  document.querySelector("#audit-search").onkeydown = (event) => {
    if (event.key === "Enter") {
      close();
      loadAudits(1);
    }
  };
}

function toggleCustomDates() {
  document.querySelector(".audit-custom-dates").hidden =
    document.querySelector("#audit-date").value !== "custom";
}
function filters(page = 1) {
  const value = (selector) => document.querySelector(selector)?.value || "";
  return {
    page,
    limit: 25,
    search: [value("#audit-search"), value("#audit-child"), value("#audit-component")].filter(Boolean).join(" "),
    datePreset: value("#audit-date"),
    dateFrom: value("#audit-from"),
    dateTo: value("#audit-to"),
    role: value("#audit-role"),
    module: value("#audit-module"),
    action: value("#audit-action"),
    status: value("#audit-status"),
    class: value("#audit-class"),
    subject: value("#audit-subject"),
    component: value("#audit-component"),
    session: value("#audit-session"),
    term: value("#audit-term"),
    child: value("#audit-child"),
  };
}
function activeFilters() {
  const current = filters(auditPage),
    names = {
      search: "Search",
      datePreset: "Date",
      dateFrom: "From",
      dateTo: "To",
      role: "Role",
      module: "Module",
      action: "Action",
      status: "Status",
      class: "Class",
      subject: "Subject",
      component: "Component",
      session: "Session",
      term: "Term",
      child: "Child",
    };
  return Object.entries(names)
    .filter(([key]) => current[key])
    .map(([key, name]) => ({ key, name, value: current[key] }));
}
function renderSummary() {
  const host = document.querySelector("#audit-summary"),
    active = activeFilters();
  host.innerHTML = active.length
    ? `<div class="audit-filter-summary"><strong>Filters:</strong>${active.map((x) => `<button type="button" data-remove-filter="${e(x.key)}">${e(x.name)}: ${e(label(x.value))} <span>×</span></button>`).join("")}<button type="button" class="audit-clear-all" id="audit-clear-all">Clear All</button></div>`
    : "";
  host.querySelectorAll("[data-remove-filter]").forEach(
    (button) =>
      (button.onclick = () => {
        const key = button.dataset.removeFilter,
          ids = {
            search: "search",
            datePreset: "date",
            dateFrom: "from",
            dateTo: "to",
            role: "role",
            module: "module",
            action: "action",
            status: "status",
            class: "class",
            subject: "subject",
            session: "session",
            term: "term",
          };
        document.querySelector(`#audit-${ids[key]}`).value = "";
        toggleCustomDates();
        loadAudits(1);
      }),
  );
  host
    .querySelector("#audit-clear-all")
    ?.addEventListener("click", () =>
      document.querySelector("#audit-clear").click(),
    );
}

const dayKey = (date) =>
  date
    ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    : "unavailable";
function dayHeading(row) {
  const date = auditDate(row);
  if (!date) return "Time unavailable";
  const today = new Date(),
    yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const prefix =
    dayKey(date) === dayKey(today)
      ? "Today"
      : dayKey(date) === dayKey(yesterday)
        ? "Yesterday"
        : date.toLocaleDateString(undefined, { weekday: "long" });
  return `${prefix} — ${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}
function timeParts(row) {
  const date = auditDate(row);
  if (!date) return { machine: "", date: "", time: "Time unavailable" };
  const today = new Date(),
    isToday = dayKey(date) === dayKey(today);
  return {
    machine: date.toISOString(),
    date: isToday
      ? ""
      : date.toLocaleDateString(undefined, {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
    time: date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}
function actionLabel(action) {
  const exact = {
    LOGIN_SUCCESS: "Logged In",
    LOGIN_FAILED: "Login Failed",
    LOGOUT: "Logged Out",
    PASSWORD_CHANGED: "Changed Password",
    RESULT_SUBMITTED: "Submitted Result",
    RESULT_REVIEWED: "Reviewed Result",
    RESULT_APPROVED: "Approved Result",
    RESULT_PUBLISHED: "Published Result",
    REPORT_VIEWED: "Viewed Published Report",
    REPORT_DOWNLOADED: "Downloaded Published Report",
    PARENT_VIEWED_PUBLISHED_REPORT: "Viewed Published Report",
    PARENT_DOWNLOADED_PUBLISHED_REPORT: "Downloaded Published Report",
    STUDENT_CREATED: "Created Student",
  };
  return exact[action] || label(action);
}
function detailText(row) {
  const context = row.context,
    next = row.newValue;
  const parts = [
    row.entityReference,
    first(context, "StudentName", "student_name", "studentName") ||
      first(next, "StudentName", "student_name", "studentName"),
    first(context, "Class", "class", "ClassName", "className") ||
      first(next, "Class", "class", "ClassName", "className"),
    first(context, "Arm", "arm", "ArmName", "armName") ||
      first(next, "Arm", "arm", "ArmName", "armName"),
    first(context, "Subject", "subject", "SubjectName", "subjectName") ||
      first(next, "Subject", "subject", "SubjectName", "subjectName"),
    first(context, "Session", "session", "SessionName", "sessionName") ||
      first(next, "Session", "session", "SessionName", "sessionName"),
    first(context, "Term", "term", "TermName", "termName") ||
      first(next, "Term", "term", "TermName", "termName"),
    first(next, "AdmissionNumber", "admission_number", "admissionNumber"),
    first(next, "ImportReference", "import_reference", "importReference"),
  ].filter(Boolean);
  return (
    [...new Set(parts)].join(" • ") ||
    row.description ||
    label(row.entityType || row.module || "Activity details unavailable")
  );
}
function auditRow(row) {
  const actor = row.actorName || row.actorEmail || "System",
    role = label(row.actorRole || "SYSTEM"),
    when = timeParts(row),
    action = row.action ? actionLabel(row.action) : "Action unavailable";
  return `<article class="audit-row ${teacherMode ? "teacher-audit-row" : ""}"><time datetime="${e(when.machine)}">${when.date ? `<span>${e(when.date)}<br></span>` : ""}<strong>${e(when.time)}</strong></time>${teacherMode ? "" : `<div class="audit-actor"><strong>${e(actor)}</strong><span>${e(role)}</span></div>`}<div class="audit-event"><strong>${e(action)}</strong><span>${e(row.module || "Module unavailable")}</span></div><div class="audit-context">${e(detailText(row))}</div><span class="audit-status ${row.resultStatus === "FAILED" ? "failed" : "success"}">${e(row.resultStatus || "Status unavailable")}</span><button class="btn btn-quiet" data-audit-view="${e(row.id)}">View</button></article>`;
}
function pagination(result) {
  const pages = new Set([
    1,
    result.pages,
    result.page - 2,
    result.page - 1,
    result.page,
    result.page + 1,
    result.page + 2,
  ]);
  const visible = [...pages]
    .filter((x) => x >= 1 && x <= result.pages)
    .sort((a, b) => a - b);
  let previous = 0,
    buttons = "";
  for (const page of visible) {
    if (previous && page - previous > 1)
      buttons += '<span class="audit-page-gap">…</span>';
    buttons += `<button class="btn ${page === result.page ? "btn-primary" : "btn-secondary"}" data-audit-page="${page}" ${page === result.page ? 'aria-current="page"' : ""}>${page}</button>`;
    previous = page;
  }
  const start = result.total ? (result.page - 1) * result.limit + 1 : 0,
    end = Math.min(result.page * result.limit, result.total);
  return `<nav class="audit-pagination" aria-label="Audit pages"><span>Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${Number(result.total).toLocaleString()} activities</span><div><button class="btn btn-secondary" data-audit-page="${result.page - 1}" ${result.page <= 1 ? "disabled" : ""}>Previous</button>${buttons}<button class="btn btn-secondary" data-audit-page="${result.page + 1}" ${result.page >= result.pages ? "disabled" : ""}>Next</button></div></nav>`;
}

async function loadAudits(page) {
  const host = document.querySelector("#audit-list");
  host.innerHTML = '<p class="support">Loading activity…</p>';
  try {
    const result = await api.post(
      teacherMode ? "/api/teacher/audits" : managementMode ? "/api/management/audits" : parentMode ? "/api/parent/audits" : "/api/administration/audits",
      filters(page),
    );
    auditPage = result.page;
    auditActions = result.actions || auditActions;
    const select = document.querySelector("#audit-action"),
      selected = select.value;
    select.innerHTML = choices(auditActions);
    select.value = selected;
    renderSummary();
    if (!result.records.length)
      host.innerHTML =
        '<div class="audit-empty"><strong>No matching activity</strong><span>Adjust or clear the current filters.</span></div>';
    else {
      let currentDay = "";
      host.innerHTML = `<div class="audit-feed">${result.records
        .map(normalizeAudit)
        .map((row) => {
          const key = dayKey(auditDate(row)),
            heading =
              key !== currentDay
                ? `<h3 class="audit-day">${e(dayHeading(row))}</h3>`
                : "";
          currentDay = key;
          return heading + auditRow(row);
        })
        .join("")}</div>${pagination(result)}`;
    }
    host
      .querySelectorAll("[data-audit-page]")
      .forEach(
        (button) =>
          (button.onclick = () => loadAudits(Number(button.dataset.auditPage))),
      );
    host
      .querySelectorAll("[data-audit-view]")
      .forEach(
        (button) =>
          (button.onclick = () => viewAudit(button.dataset.auditView)),
      );
  } catch (problem) {
    host.innerHTML = `<p class="form-error">${e(problem.message || "Audits could not be loaded.")}</p>`;
  }
}

async function viewAudit(id) {
  const response = await api.post(
      teacherMode
        ? "/api/teacher/audits/detail"
        : managementMode ? "/api/management/audits/detail" : parentMode ? "/api/parent/audits/detail" : "/api/administration/audits/detail",
      { auditId: id },
    ),
    row = normalizeAudit(response),
    dialog = document.createElement("dialog");
  dialog.className = "dialog audit-detail";
  const date = auditDate(row),
    fields = [
      ["Date & Time", date ? date.toLocaleString() : "Time unavailable"],
      ...(teacherMode
        ? []
        : [
            ["Actor", row.actorName],
            ["Email", row.actorEmail],
            ["Role", label(row.actorRole)],
          ]),
      ["Action", row.action ? actionLabel(row.action) : "Action unavailable"],
      ["Module", row.module],
      ["Entity", row.entityType],
      ["Reference", row.entityReference],
      ["Description", row.description],
      ...Object.entries(row.context).map(([key, value]) => [label(key), value]),
      ["Previous State", row.oldValue],
      ["New State", row.newValue],
      ["Result", row.resultStatus],
    ].filter(
      (x) =>
        x[1] !== null &&
        x[1] !== undefined &&
        x[1] !== "" &&
        (!Array.isArray(x[1]) || x[1].length),
    );
  dialog.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">Audit details</p><h2>${e(actionLabel(row.action))}</h2></div><button class="icon-btn" data-close aria-label="Close">×</button></div><dl class="audit-detail-grid">${fields.map(([name, value]) => `<div><dt>${e(name)}</dt><dd>${e(typeof value === "object" ? JSON.stringify(value, null, 2) : value)}</dd></div>`).join("")}</dl>`;
  document.body.appendChild(dialog);
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

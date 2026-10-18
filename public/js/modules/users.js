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
  infoDialog,
} from "../ui.js";
import { api } from "../api.js";
let records = [],
  page = 0,
  total = 0;
export async function render() {
  setMain(
    hero(
      "management",
      "Results governance",
      "Management",
      "Create and manage the people who review, approve and publish results.",
    ) +
      `<section class="card"><div class="section-head"><div><h2>Management users</h2><p>Parent accounts are managed from Students; teacher accounts are managed from Teachers.</p></div><button class="btn btn-primary" id="add-management">Add Management User</button></div><div class="toolbar"><input id="management-search" aria-label="Search management users" placeholder="Search name, email, phone or status"><select id="management-status" aria-label="Filter management status"><option value="">All statuses</option><option>Active</option><option>Inactive</option><option>Locked</option></select></div><div id="management-table"></div><div class="dialog-actions" id="management-pages"><button class="btn btn-secondary" data-page="previous" disabled>Previous</button><span>Page 1</span><button class="btn btn-secondary" data-page="next">Next</button></div></section>`,
    "Management",
  );
  document.querySelector("#add-management").onclick = () => edit();
  let timer;
  document.querySelector("#management-search").oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(0), 250);
  };
  document.querySelector("#management-status").onchange = () => load(0);
  document.querySelector('[data-page="previous"]').onclick = () =>
    load(page - 1);
  document.querySelector('[data-page="next"]').onclick = () => load(page + 1);
  await load(0);
}
async function load(next) {
  try {
    const result = await api.post("/api/management/list", {
      search: document.querySelector("#management-search").value,
      status: document.querySelector("#management-status").value,
      limit: 25,
      offset: next * 25,
    });
    records = result.rows || [];
    total = Number(result.total || 0);
    page = next;
    draw();
  } catch (error) {
    showError(error);
  }
}
function draw() {
  document.querySelector("#management-table").innerHTML = table(
    ["Name", "Email / Username", "Phone", "Status", "Actions"],
    records.map((user) => [
      escapeHtml(user.FullName || "—"),
      escapeHtml(user.Email),
      escapeHtml(user.Phone || "—"),
      badge(user.Status),
      `<button class="btn btn-quiet" data-view="${user.UserID}">View</button><button class="btn btn-quiet" data-edit="${user.UserID}">Edit</button><button class="btn btn-quiet" data-status="${user.UserID}" data-current="${user.Status}">${user.Status === "Active" ? "Deactivate" : "Activate"}</button><button class="btn btn-quiet" data-reset="${user.UserID}">Reset password</button>`,
    ]),
    "No Management users match this search.",
  );
  const pages = document.querySelector("#management-pages");
  pages.querySelector("span").textContent =
    `Page ${page + 1} of ${Math.max(1, Math.ceil(total / 25))}`;
  pages.querySelector('[data-page="previous"]').disabled = page === 0;
  pages.querySelector('[data-page="next"]').disabled = (page + 1) * 25 >= total;
  bind();
}
function bind() {
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => (b.onclick = () => view(b.dataset.view)));
  document
    .querySelectorAll("[data-edit]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          edit(records.find((x) => x.UserID === b.dataset.edit))),
    );
  document.querySelectorAll("[data-status]").forEach(
    (b) =>
      (b.onclick = async () => {
        const next = b.dataset.current === "Active" ? "Inactive" : "Active";
        if (
          !(await confirmDialog(
            "Change Management user status",
            `Set this Management user to ${next}?`,
            { confirmLabel: `Set ${next}` },
          ))
        )
          return;
        await api.post("/api/management/status", {
          userId: b.dataset.status,
          status: next,
        });
        showToast("Management user status updated.");
        load(page);
      }),
  );
  document.querySelectorAll("[data-reset]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          !(await confirmDialog(
            "Reset password",
            "Issue a new temporary password for this Management user?",
            { confirmLabel: "Reset password" },
          ))
        )
          return;
        const result = await api.post("/api/management/reset-password", {
          userId: b.dataset.reset,
        });
        showToast(`Temporary password: ${result.temporaryPassword}`, 12000);
      }),
  );
}
async function view(userId) {
  try {
    const { user } = await api.post("/api/management/details", { userId });
    await infoDialog(
      "Management User",
      `Name: ${user.FullName || "—"}\nEmail / Username: ${user.Email}\nPhone: ${user.Phone || "—"}\nRole: Management\nStatus: ${user.Status}`,
    );
  } catch (error) {
    showError(error);
  }
}
function edit(user) {
  formDialog(
    user ? "Edit Management User" : "Add Management User",
    [
      {
        name: "fullName",
        label: "Full Name",
        required: true,
        value: user?.FullName || "",
      },
      {
        name: "email",
        label: "Email / Username",
        type: "email",
        required: true,
        value: user?.Email || "",
      },
      { name: "phone", label: "Phone", value: user?.Phone || "" },
    ],
    async (values) => {
      const result = await api.post("/api/management/save", {
        ...values,
        userId: user?.UserID,
      });
      showToast(
        result.temporaryPassword
          ? `Temporary password: ${result.temporaryPassword}`
          : "Management user updated.",
        12000,
      );
      await load(page);
    },
  );
}

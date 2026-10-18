import { auth } from "./auth.js";
import { register, navigate, initialRoute } from "./router.js";
import { $, showToast, confirmDialog, showError } from "./ui.js";
import { enableOffline, isUnlocked } from "./offline-auth.js";
import {
  onSyncState,
  status,
  syncNow,
  refreshSnapshot,
  readSnapshot,
  startAutomaticSync,
  stopAutomaticSync,
  outbox,
  resolveConflict,
  retryFailed,
  probe,
} from "./sync.js";
import { offlinePin, password, email, firstError } from "./validation.js";
import { normalizeApiError } from "./sync-core.js";

const modules = {
  dashboard: () => import("./modules/dashboard.js?v=sairs-v32"),
  students: () => import("./modules/students.js?v=sairs-v44"),
  teachers: () => import("./modules/teachers.js?v=sairs-v12"),
  results: () => import("./modules/results.js?v=sairs-v40"),
  componentReview: () => import("./modules/assessment-review.js?v=sairs-v31"),
  generatedReports: () => import("./modules/generated-reports.js?v=sairs-v44"),
  performance: () => import("./modules/performance.js?v=sairs-v44"),
  management: () => import("./modules/users.js?v=sairs-v3"),
  administration: () => import("./modules/administration.js?v=sairs-v42"),
  audits: () => import("./modules/audits.js?v=sairs-v32"),
  reports: () => import("./modules/reports.js"),
  portals: () => import("./modules/portals.js?v=sairs-v44"),
};
Object.entries(modules).forEach(([name, loader]) =>
  register(name, async (ctx) => (await loader()).render(ctx)),
);
const labels = {
  dashboard: "Dashboard",
  students: "Students",
  teachers: "Teachers",
  management: "Management",
  results: "Results",
  componentReview: "Assessment Component Review",
  generatedReports: "Generated Report Cards",
  performance: "Performance Reports",
  reports: "Reports",
  administration: "School & Academic Setup",
  audits: "Audits",
  portals: "Approved Assessments",
};
const icons = {
  dashboard: "◫",
  students: "▣",
  teachers: "▤",
  management: "◎",
  results: "▥",
  componentReview: "▥",
  generatedReports: "▧",
  performance: "↗",
  reports: "▧",
  administration: "▦",
  audits: "≡",
  portals: "◇",
};
let context = { offline: false, user: null, pack: null },
  deferredInstall,
  unlockFailures = 0,
  unlockBlockedUntil = 0;

function initLoginParallax() {
  const panel = $(".auth-panel"),
    layers = [...document.querySelectorAll("[data-parallax-depth]")],
    reduced = matchMedia("(prefers-reduced-motion: reduce)"),
    desktop = matchMedia("(min-width: 901px) and (pointer: fine)");
  if (!panel || !layers.length) return;
  let frame;
  const reset = () => layers.forEach((layer) => (layer.style.transform = ""));
  panel.addEventListener(
    "pointermove",
    (event) => {
      if (reduced.matches || !desktop.matches || $("#auth").hidden)
        return reset();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = panel.getBoundingClientRect(),
          x = (event.clientX - rect.left) / rect.width - 0.5,
          y = (event.clientY - rect.top) / rect.height - 0.5;
        layers.forEach((layer) => {
          const depth = Number(layer.dataset.parallaxDepth) || 1;
          layer.style.transform = `translate3d(${(x * depth * 4).toFixed(2)}px,${(y * depth * 4).toFixed(2)}px,0)`;
        });
      });
    },
    { passive: true },
  );
  panel.addEventListener("pointerleave", reset, { passive: true });
  reduced.addEventListener?.("change", reset);
  desktop.addEventListener?.("change", reset);
}

function allowed(role) {
  const map = {
    IT_ADMIN: [
      "dashboard",
      "students",
      "teachers",
      "management",
      "performance",
      "administration",
      "audits",
    ],
    TEACHER: ["dashboard", "portals", "performance", "audits"],
    MANAGEMENT: ["dashboard", "componentReview", "performance", "generatedReports", "audits"],
    PARENT: ["dashboard", "portals", "performance", "audits"],
  };
  return (
    map[role] || ["dashboard"]
  );
}
function buildNav(role) {
  $("#nav").innerHTML = allowed(role)
    .map(
      (name) =>
        `<button class="nav-button" data-route="${name}"><span class="nav-icon">${icons[name]}</span>${labels[name]}</button>`,
    )
    .join("");
  $("#nav").onclick = (e) => {
    const button = e.target.closest("[data-route]");
    if (button) {
      navigate(button.dataset.route, context).catch(handleError);
      $("#sidebar").classList.remove("open");
    }
  };
}
async function openApp(session, offline = false) {
  context.offline = offline;
  context.pack = offline ? await readSnapshot() : null;
  context.user = session?.user || context.pack?.identity?.user || auth.user;
  const role = context.user?.role || context.pack?.identity?.role || "TEACHER",
    schoolName =
      context.user?.schoolName ||
      context.pack?.profile?.schoolName ||
      "Academic workspace";
  $("#auth").hidden = true;
  $("#app").hidden = false;
  $("#role-label").textContent = String(role).replaceAll("_", " ");
  let academicContext = "";
  if (offline) {
    const config =
      context.pack?.modules?.dashboard?.config || context.pack?.config || {};
    academicContext = [config.currentSession, config.currentTerm]
      .filter(Boolean)
      .join(" · ");
  } else
    try {
      const dashboard = await (
        await import("./api.js")
      ).api.get("/api/dashboard");
      academicContext = [
        dashboard.config?.currentSession,
        dashboard.config?.currentTerm,
      ]
        .filter(Boolean)
        .join(" · ");
    } catch {}
  $("#academic-context").textContent = academicContext || schoolName;
  buildNav(role);
  await navigate(initialRoute(), context);
  renderSync(await status());
  if (!offline) startAutomaticSync();
}
function showLogin() {
  stopAutomaticSync();
  $("#app").hidden = true;
  $("#auth").hidden = false;
  $("#login-form").hidden = false;
  $("#unlock-form").hidden = true;
  $("#change-password-form").hidden = true;
  auth.canUnlock().then((v) => ($("#offline-unlock-option").hidden = !v));
}
function handleError(error) {
  const safe = normalizeApiError(error);
  showError(safe);
  if (safe.code === "AUTH_REQUIRED") showLogin();
}

$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  const button = e.submitter,
    f = new FormData(e.target),
    problem = firstError({
      email: email(f.get("email")),
      password: f.get("password") ? "" : "Password is required.",
    });
  $("#login-error").textContent = problem;
  if (problem) return;
  button.disabled = true;
  try {
    const session = await auth.login(f.get("email"), f.get("password"));
    if (session.mustChangePassword) {
      $("#login-form").hidden = true;
      $("#change-password-form").hidden = false;
      return;
    }
    await openApp(session, false);
  } catch (error) {
    $("#login-error").textContent = normalizeApiError(error).message;
  } finally {
    button.disabled = false;
  }
};
$("#change-password-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target),
    next = f.get("newPassword");
  $("#change-password-error").textContent = password(next) || "";
  if ($("#change-password-error").textContent) return;
  if (next !== f.get("confirmPassword"))
    return ($("#change-password-error").textContent =
      "The new passwords do not match.");
  try {
    const session = await auth.changePassword(f.get("currentPassword"), next);
    await openApp(session, false);
  } catch (error) {
    $("#change-password-error").textContent = normalizeApiError(error).message;
  }
};
$("#offline-unlock-option").onclick = () => {
  $("#login-form").hidden = true;
  $("#unlock-form").hidden = false;
};
$("#back-to-login").onclick = () => {
  $("#unlock-form").hidden = true;
  $("#login-form").hidden = false;
};
$("#unlock-form").onsubmit = async (e) => {
  e.preventDefault();
  if (Date.now() < unlockBlockedUntil)
    return ($("#unlock-error").textContent =
      "Wait briefly before trying again.");
  try {
    await auth.unlock(new FormData(e.target).get("pin"));
    unlockFailures = 0;
    await openApp(null, true);
  } catch {
    unlockFailures += 1;
    if (unlockFailures >= 5) {
      unlockBlockedUntil = Date.now() + 30000;
      unlockFailures = 0;
    }
    $("#unlock-error").textContent = "Unable to unlock. Check the offline PIN.";
  }
};
$("#logout").onclick = async () => {
  if (
    !(await confirmDialog(
      "Sign out",
      "Sign out and remove sensitive offline data from this device?",
      { confirmLabel: "Sign out", danger: true },
    ))
  )
    return;
  await auth.logout();
  showLogin();
};
$("#lock").onclick = () => {
  auth.lock();
  stopAutomaticSync();
  showLogin();
  $("#login-form").hidden = true;
  $("#unlock-form").hidden = false;
  showToast(
    "SAIRS is locked. Encrypted device data remains available after unlock.",
  );
};
$("#menu").onclick = () => $("#sidebar").classList.toggle("open");
$("#sync-status").onclick = async () => {
  await renderSyncCenter();
  $("#sync-dialog").showModal();
};
document
  .querySelectorAll("[data-close]")
  .forEach((x) => (x.onclick = () => x.closest("dialog").close()));
$("#sync-now").onclick = () => syncNow().catch(handleError);
$("#enable-offline").onclick = () => {
  $("#sync-dialog").close();
  $("#offline-dialog").showModal();
};
$("#retry-failed").onclick = () => retryFailed().catch(handleError);
$("#refresh-offline").onclick = async () => {
  try {
    const pack = await refreshSnapshot();
    showToast(
      pack
        ? "Offline data refreshed. Unsynced changes were preserved."
        : "Unlock offline access and connect to the server first.",
    );
    await renderSync(await status());
  } catch (error) {
    handleError(error);
  }
};
$("#offline-pin-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target),
    pin = f.get("pin"),
    problem = offlinePin(pin);
  $("#offline-pin-error").textContent = problem || "";
  if (problem) return;
  if (pin !== f.get("confirm"))
    return ($("#offline-pin-error").textContent =
      "The PIN entries do not match.");
  try {
    await enableOffline(pin);
    await refreshSnapshot();
    $("#offline-dialog").close();
    showToast("Offline workspace encrypted and ready.");
    renderSync(await status());
  } catch (error) {
    $("#offline-pin-error").textContent = normalizeApiError(error).message;
  }
};

function renderSync(s) {
  const button = $("#sync-status"),
    label = button.querySelector("span"),
    state = s.syncing
      ? "syncing"
      : s.connection === "CHECKING"
        ? "checking"
        : s.connection === "OFFLINE"
          ? "offline"
          : s.connection === "UNAVAILABLE" || s.failed || s.conflicts
            ? "error"
            : "";
  button.className = `sync-pill ${state}`.trim();
  label.textContent = s.syncing
    ? "Syncing"
    : s.connection === "CHECKING"
      ? "Checking connection…"
      : s.connection === "UNAVAILABLE"
        ? "Server unavailable"
        : s.connection === "OFFLINE"
          ? "Offline"
          : s.conflicts
            ? `${s.conflicts} conflict${s.conflicts === 1 ? "" : "s"}`
            : s.pending
              ? `${s.pending} pending change${s.pending === 1 ? "" : "s"}`
              : "Online";
  button.setAttribute(
    "aria-label",
    `Connection and synchronization status: ${label.textContent}`,
  );
  renderSyncCenter(s);
}
async function renderSyncCenter(s) {
  s = s || (await status());
  const when = s.lastSync ? new Date(s.lastSync).toLocaleString() : "Not yet",
    ops = await outbox(),
    connection =
      {
        ONLINE: "Online",
        OFFLINE: "Device offline",
        UNAVAILABLE: "Internet available; SAIRS server unavailable",
      }[s.connection] || "Checking";
  $("#sync-detail").innerHTML =
    `<div class="sync-list"><div class="sync-row"><span>Connection</span><strong>${connection}</strong></div><div class="sync-row"><span>Last successful sync</span><strong>${when}</strong></div><div class="sync-row"><span>Pending</span><strong>${s.pending}</strong></div><div class="sync-row"><span>Synchronizing</span><strong>${s.syncingCount}</strong></div><div class="sync-row"><span>Failed</span><strong>${s.failed}</strong></div><div class="sync-row"><span>Conflicts</span><strong>${s.conflicts}</strong></div></div>${ops.map((x) => `<article class="notice"><strong>${x.entityType}: ${String(x.action).replaceAll(".", " ")}</strong><p>${x.status === "CONFLICT" ? "Server and device versions differ." : x.status === "FAILED" ? x.lastError || "Synchronization failed." : `${x.status.toLowerCase()} • saved ${new Date(x.createdAt).toLocaleString()}`}</p>${x.status === "CONFLICT" ? `<button class="btn btn-secondary" data-server="${x.operationId}">Keep server version</button> <button class="btn btn-primary" data-retry="${x.operationId}">Retry my change</button>` : ""}</article>`).join("")}`;
  document.querySelectorAll("[data-server]").forEach(
    (b) =>
      (b.onclick = async () => {
        await resolveConflict(b.dataset.server, "SERVER");
        await renderSync(await status());
      }),
  );
  document.querySelectorAll("[data-retry]").forEach(
    (b) =>
      (b.onclick = async () => {
        await resolveConflict(b.dataset.retry, "RETRY");
        await syncNow();
        await renderSync(await status());
      }),
  );
}
onSyncState(renderSync);
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (!localStorage.getItem("sairs-install-dismissed"))
    $("#install").hidden = false;
});
$("#install").onclick = async () => {
  if (deferredInstall) {
    deferredInstall.prompt();
    const choice = await deferredInstall.userChoice;
    if (choice.outcome !== "accepted")
      localStorage.setItem("sairs-install-dismissed", Date.now());
    deferredInstall = null;
    $("#install").hidden = true;
  } else
    showToast(
      "Use your browser menu and choose Install app or Add to Home Screen.",
    );
};
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    const announce = (worker) => {
      if (!worker) return;
      worker.addEventListener("statechange", async () => {
        if (
          worker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          const s = await status();
          $("#update-app").hidden = false;
          $("#update-app").textContent =
            s.pending || s.conflicts ? "Sync before update" : "Update now";
          showToast(
            s.pending || s.conflicts
              ? "Update available. You have unsynced changes."
              : "New SAIRS version available.",
            8000,
          );
        }
      });
    };
    announce(reg.installing);
    reg.addEventListener("updatefound", () => announce(reg.installing));
    $("#update-app").onclick = async () => {
      let s = await status();
      if (s.pending && !s.conflicts) {
        showToast("Synchronizing before update…");
        await syncNow();
        s = await status();
      }
      if (s.pending || s.conflicts)
        return showToast(
          "Update later: resolve remaining unsynced changes in Sync Center first.",
          7000,
        );
      (reg.waiting || reg.installing)?.postMessage({ type: "SKIP_WAITING" });
    };
  });
  navigator.serviceWorker.addEventListener("controllerchange", () =>
    location.reload(),
  );
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "SYNC_REQUESTED") syncNow().catch(() => {});
  });
}
addEventListener("offline", async () => renderSync(await status()));
document.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-password-toggle]");
  if (!toggle) return;
  const input = document.getElementById(toggle.dataset.passwordToggle);
  if (!input) return;
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  toggle.textContent = showing ? "Show" : "Hide";
  toggle.setAttribute("aria-pressed", String(!showing));
});
initLoginParallax();
auth
  .restore()
  .then((session) => {
    if (!session) return showLogin();
    if (session.mustChangePassword) {
      showLogin();
      $("#login-form").hidden = true;
      $("#change-password-form").hidden = false;
      return;
    }
    return openApp(session, false);
  })
  .catch(() => showLogin());

import { canAccessRoute, landingRoute, resolveRoute, ROUTE_LABELS } from "./auth/role-access.js";
import { createLocalStorageRepository } from "./repositories/local-storage-repository.js";

const COLLAPSED_STORAGE_KEY = "nusantara-pos-sidebar-collapsed";
const workspaceRepository = createLocalStorageRepository();

function readCollapsedPreference() {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function updateIdentity(session) {
  const user = session?.user;
  const isCashier = user?.role === "CASHIER";
  let cashierBranchName = user?.branch_id ?? "cabang belum ditentukan";
  if (isCashier && user?.branch_id) {
    try {
      const branch = workspaceRepository.load().branches.find((item) => item.branch_id === user.branch_id);
      cashierBranchName = branch?.name?.replace(/^Cabang +/u, "") ?? cashierBranchName;
    } catch { /* Identitas tetap menyebut ID cabang jika workspace belum dapat dibaca. */ }
  }
  const name = user?.display_name ?? "Belum masuk";
  const role = user?.role_label ?? "Mode simulasi";
  const avatar = name.slice(0, 1).toLocaleUpperCase("id-ID");
  document.querySelectorAll("[data-profile-name]").forEach((element) => { element.textContent = name; });
  document.querySelectorAll("[data-profile-role]").forEach((element) => { element.textContent = role; });
  document.querySelectorAll("[data-profile-avatar], [data-sidebar-avatar]").forEach((element) => { element.textContent = avatar; });
  document.querySelectorAll("[data-sidebar-user]").forEach((element) => { element.textContent = name; });
  document.querySelectorAll("[data-sidebar-role]").forEach((element) => {
    element.textContent = isCashier ? `Kasir · ${cashierBranchName}` : user ? "Admin Pusat · semua cabang" : "Masuk untuk melanjutkan";
  });

  const branchContext = isCashier ? `Kasir: Cabang ${cashierBranchName}` : user ? "Pusat · semua cabang" : "Belum ada sesi aktif";
  const accessibleContext = isCashier
    ? `Konteks kasir simulasi: Cabang ${cashierBranchName}`
    : user ? "Konteks Admin Pusat: seluruh cabang" : "Belum ada sesi aktif";
  document.querySelectorAll("[data-cashier-branch-context]").forEach((element) => {
    const target = element.querySelector(".scope-pill__cashier-label") ?? element;
    target.textContent = element.classList.contains("scope-pill--cashier") && isCashier ? "Kasir: " + cashierBranchName : branchContext;
    element.setAttribute("aria-label", accessibleContext);
    element.title = accessibleContext;
  });
}

export function initializeNavigation({ authService } = {}) {
  const shell = document.querySelector(".app-shell");
  const toggle = document.querySelector("[data-sidebar-toggle]");
  const collapseToggle = document.querySelector("[data-sidebar-collapse]");
  const closeButton = document.querySelector("[data-sidebar-close]");
  const sidebar = document.querySelector("[data-sidebar]");
  if (!shell || !toggle || !sidebar || !authService) return null;

  let pendingRoute = null;
  let blockedRoute = null;
  let currentPageRoute = "login";

  const updateRoute = () => {
    const views = [...document.querySelectorAll("[data-page-view]")];
    if (!views.length) return;
    const requestedRoute = window.location.hash.slice(1) || "overview";
    const session = authService.getSession();
    const resolution = resolveRoute(requestedRoute, session);
    if (!session && resolution.returnTo) pendingRoute = resolution.returnTo;
    if (resolution.route === "access-denied") {
      pendingRoute = null;
      if (resolution.deniedRoute) blockedRoute = resolution.deniedRoute;
    } else {
      blockedRoute = null;
    }
    currentPageRoute = resolution.route;

    if (requestedRoute !== currentPageRoute) {
      window.history.replaceState(null, "", `#${currentPageRoute}`);
    }

    views.forEach((view) => { view.hidden = view.dataset.pageView !== currentPageRoute; });
    shell.classList.toggle("is-auth-route", currentPageRoute === "login");
    document.body.classList.toggle("is-auth-route", currentPageRoute === "login");

    document.querySelectorAll("[data-app-route]").forEach((link) => {
      const route = link.dataset.appRoute;
      link.hidden = !canAccessRoute(session, route);
      const active = route === currentPageRoute;
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
      link.classList.toggle("is-active", active && link.classList.contains("nav-link"));
    });
    document.querySelectorAll(".nav-link--upcoming[data-role]").forEach((button) => {
      button.hidden = button.dataset.role !== session?.user?.role;
    });
    document.querySelectorAll(".nav-group").forEach((group) => {
      group.hidden = ![...group.querySelectorAll("[data-app-route], .nav-link--upcoming")].some((item) => !item.hidden);
    });
    const logoutButton = document.querySelector("[data-logout]");
    if (logoutButton) logoutButton.hidden = !session;

    updateIdentity(session);
    const home = document.querySelector("#access-denied-home");
    if (home) home.href = `#${landingRoute(session)}`;
    const deniedDescription = document.querySelector("#access-denied-description");
    if (deniedDescription) {
      const deniedRoute = resolution.deniedRoute ?? blockedRoute;
      const deniedLabel = ROUTE_LABELS[deniedRoute] ?? "halaman yang diminta";
      const roleLabel = session?.user?.role_label ?? "akun ini";
      deniedDescription.textContent = deniedRoute
        ? `${roleLabel} tidak memiliki akses demo ke “${deniedLabel}”. Kembali ke halaman utama yang tersedia untuk peran ini.`
        : "Route yang diminta dibatasi oleh guard frontend demo.";
    }

    const title = views.find((view) => view.dataset.pageView === currentPageRoute)?.querySelector("h1")?.textContent.trim() ?? "Masuk";
    const breadcrumb = document.querySelector("[data-breadcrumb-page]");
    if (breadcrumb) breadcrumb.textContent = title;
    document.title = `${title} · Nusantara POS`;
    document.dispatchEvent(new CustomEvent("app:routechange", { detail: { route: currentPageRoute } }));
  };

  updateRoute();
  window.addEventListener("hashchange", updateRoute);
  document.addEventListener("app:authchange", updateRoute);

  const mobileQuery = window.matchMedia("(max-width: 1100px)");
  const applyCollapsed = (collapsed, persist = false) => {
    const nextCollapsed = Boolean(collapsed) && !mobileQuery.matches;
    shell.classList.toggle("is-sidebar-collapsed", nextCollapsed);
    collapseToggle?.setAttribute("aria-pressed", String(nextCollapsed));
    const label = nextCollapsed ? "Lebarkan sidebar" : "Ciutkan sidebar";
    collapseToggle?.setAttribute("aria-label", label);
    collapseToggle?.setAttribute("title", label);
    if (persist) {
      try { window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(nextCollapsed)); } catch { /* Preferensi sesi ini tetap aktif. */ }
    }
  };

  const setMenuOpen = (open, restoreFocus = true) => {
    const nextOpen = Boolean(open) && mobileQuery.matches;
    shell.classList.toggle("is-menu-open", nextOpen);
    document.body.classList.toggle("is-menu-open", nextOpen);
    toggle.setAttribute("aria-expanded", String(nextOpen));
    toggle.setAttribute("aria-label", nextOpen ? "Tutup navigasi" : "Buka navigasi");
    closeButton?.setAttribute("aria-hidden", String(!nextOpen));
    sidebar.inert = mobileQuery.matches && !nextOpen;
    sidebar.setAttribute("aria-hidden", String(mobileQuery.matches && !nextOpen));

    if (nextOpen) {
      const currentLink = sidebar.querySelector('a[aria-current="page"]');
      (currentLink || sidebar.querySelector("a[href]:not([hidden])"))?.focus({ preventScroll: true });
    } else if (restoreFocus && mobileQuery.matches) {
      toggle.focus({ preventScroll: true });
    }
  };

  applyCollapsed(readCollapsedPreference());
  setMenuOpen(false, false);
  sidebar.querySelectorAll(".nav-link--upcoming").forEach((button) => {
    const label = button.getAttribute("aria-label") || button.textContent.trim();
    button.setAttribute("title", `${label} · Segera`);
  });

  toggle.addEventListener("click", () => setMenuOpen(toggle.getAttribute("aria-expanded") !== "true"));
  closeButton?.addEventListener("click", () => setMenuOpen(false));
  collapseToggle?.addEventListener("click", () => applyCollapsed(!shell.classList.contains("is-sidebar-collapsed"), true));

  sidebar.querySelectorAll("a[href]").forEach((link) => {
    link.addEventListener("click", () => {
      if (!mobileQuery.matches) return;
      setMenuOpen(false, false);
      window.requestAnimationFrame(() => document.querySelector("#main-content")?.focus({ preventScroll: true }));
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && shell.classList.contains("is-menu-open")) {
      setMenuOpen(false);
      return;
    }
    if (event.key !== "Tab" || !shell.classList.contains("is-menu-open")) return;
    const focusable = [...sidebar.querySelectorAll('a[href]:not([hidden]), button:not(:disabled):not([hidden]), input:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hidden && !element.closest("[hidden]"));
    if (!focusable.length) {
      event.preventDefault();
      sidebar.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === sidebar)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  mobileQuery.addEventListener("change", (event) => {
    if (event.matches) {
      applyCollapsed(false);
      setMenuOpen(false, false);
    } else {
      setMenuOpen(false, false);
      applyCollapsed(readCollapsedPreference());
    }
  });

  return Object.freeze({
    navigate(route) {
      if (route === "login") pendingRoute = null;
      const target = `#${route}`;
      if (window.location.hash === target) updateRoute();
      else window.location.hash = target;
    },
    getPostLoginRoute(session) {
      const target = pendingRoute;
      pendingRoute = null;
      if (target && canAccessRoute(session, target)) return target;
      if (target && ROUTE_LABELS[target]) {
        blockedRoute = target;
        return "access-denied";
      }
      return landingRoute(session);
    },
    update: updateRoute,
    get currentRoute() { return currentPageRoute; },
  });
}

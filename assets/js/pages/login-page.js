import { showToast } from "../components.js";
import { ADMINISTRATION_STORAGE_KEY } from "../repositories/administration-repository.js";

export function initializeLoginPage({ authService, onAuthenticated, onLogout } = {}) {
  const form = document.querySelector("#login-form");
  const username = document.querySelector("#login-username");
  const password = document.querySelector("#login-password");
  const error = document.querySelector("#login-error");
  if (!form || !authService) return null;

  const clearError = () => {
    error.hidden = true;
    error.textContent = "";
    username.removeAttribute("aria-invalid");
    password.removeAttribute("aria-invalid");
  };
  const showError = (message) => {
    error.textContent = message;
    error.hidden = false;
    username.setAttribute("aria-invalid", "true");
    password.setAttribute("aria-invalid", "true");
    error.focus();
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearError();
    if (!username.value.trim() || !password.value) {
      showError("Masukkan nama pengguna dan kata sandi akun presentasi.");
      (username.value.trim() ? password : username).focus();
      return;
    }
    try {
      const session = authService.login({ username: username.value, password: password.value });
      form.reset();
      showToast(`Masuk sebagai ${session.user.display_name}. Sesi ini hanya simulasi frontend.`, "success");
      onAuthenticated?.(session);
    } catch (authError) {
      showError(authError.message || "Nama pengguna atau kata sandi tidak sesuai.");
      if (authError.code === "AUTH_SESSION_SAVE_FAILED") showToast(authError.message, "error");
    }
  });

  [username, password].forEach((input) => input.addEventListener("input", clearError));
  document.querySelector("[data-password-toggle]")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    const revealing = password.type === "password";
    password.type = revealing ? "text" : "password";
    button.textContent = revealing ? "Sembunyikan" : "Tampilkan";
    button.setAttribute("aria-pressed", String(revealing));
    password.focus();
  });

  const branchLabels = Object.freeze({
    "BR-JKT-01": "Jakarta Pusat",
    "BR-BDG-01": "Bandung Kota",
    "BR-MDN-01": "Medan",
    "BR-SBY-01": "Surabaya",
    "BR-MKS-01": "Makassar",
  });

  function getAvailablePresentationAccounts() {
    try {
      const branchOrder = Object.keys(branchLabels);
      return authService.getDemoAccounts()
        .filter((account) => account.status === "active"
          && ((account.role === "HQ_ADMIN" && account.branch_id === null)
            || (account.role === "CASHIER" && Boolean(account.branch_id))))
        .sort((left, right) => {
          if (left.role !== right.role) return left.role === "HQ_ADMIN" ? -1 : 1;
          if (left.role === "CASHIER" && right.role === "CASHIER") {
            const branchDifference = branchOrder.indexOf(left.branch_id) - branchOrder.indexOf(right.branch_id);
            if (branchDifference) return branchDifference;
          }
          return left.display_name.localeCompare(right.display_name, "id-ID");
        });
    } catch {
      return [];
    }
  }

  function selectPresentationAccount(userId) {
    // Re-read the shared directory at activation time so stale/inactive entries
    // cannot be selected from an old rendering.
    const account = getAvailablePresentationAccounts().find((entry) => entry.user_id === userId);
    if (!account) {
      renderPresentationAccounts();
      const selection = document.querySelector("#login-demo-selection");
      if (selection) {
        selection.textContent = "Akun ini tidak lagi aktif atau tidak tersedia.";
        selection.hidden = false;
      }
      return;
    }
    username.value = account.username;
    password.value = "";
    clearError();
    const selection = document.querySelector("#login-demo-selection");
    if (selection) {
      selection.textContent = `Nama pengguna ${account.username} terisi. Masukkan kata sandi presentasi yang berlaku.`;
      selection.hidden = false;
    }
    password.focus();
  }

  function renderPresentationAccounts() {
    const list = document.querySelector("#login-demo-accounts-list");
    const empty = document.querySelector("#login-demo-accounts-empty");
    if (!list) return;
    const accounts = getAvailablePresentationAccounts();
    list.replaceChildren();
    for (const account of accounts) {
      const article = document.createElement("article");
      article.setAttribute("role", "listitem");
      const description = document.createElement("div");
      const title = document.createElement("strong");
      const credentials = document.createElement("span");
      const button = document.createElement("button");
      const branchName = branchLabels[account.branch_id];
      title.textContent = account.role === "HQ_ADMIN" ? "Admin Pusat" : `Kasir${branchName ? ` · ${branchName}` : ""}`;
      credentials.textContent = `${account.display_name} · Nama pengguna: ${account.username}`;
      button.className = "button button--secondary";
      button.type = "button";
      button.dataset.demoFill = account.user_id;
      button.setAttribute("aria-label", `Isi nama pengguna ${account.role === "HQ_ADMIN" ? "Admin Pusat" : `Kasir ${branchName ?? "cabang"}`}`);
      button.textContent = "Isi nama pengguna";
      button.addEventListener("click", () => selectPresentationAccount(account.user_id));
      description.append(title, credentials);
      article.append(description, button);
      list.append(article);
    }
    if (empty) {
      empty.hidden = accounts.length > 0;
      empty.textContent = accounts.length ? "" : "Belum ada akun presentasi aktif yang dapat digunakan.";
    }
  }

  renderPresentationAccounts();
  document.addEventListener("app:authchange", renderPresentationAccounts);
  document.addEventListener("app:routechange", (event) => {
    if (event.detail?.route === "login") renderPresentationAccounts();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === ADMINISTRATION_STORAGE_KEY) renderPresentationAccounts();
  });

  document.querySelector("[data-logout]")?.addEventListener("click", () => {
    try {
      authService.logout();
      form.reset();
      clearError();
      document.dispatchEvent(new CustomEvent("app:authchange", { detail: { session: null } }));
      onLogout?.();
      window.requestAnimationFrame(() => username.focus({ preventScroll: true }));
      showToast("Sesi pada browser ini telah berakhir.", "info");
    } catch (authError) {
      showToast(authError.message || "Sesi tidak dapat dihapus.", "error");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || error.hidden) return;
    clearError();
    username.focus();
  });

  if (window.location.hash === "#login" && !authService.getSession()) {
    window.requestAnimationFrame(() => username.focus({ preventScroll: true }));
  }
  return Object.freeze({ focus: () => username.focus({ preventScroll: true }) });
}

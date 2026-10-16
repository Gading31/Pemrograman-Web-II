import { showToast } from "../components.js";
import { hasPermission } from "../auth/role-access.js";
import { ADMINISTRATION_STORAGE_KEY } from "../repositories/administration-repository.js";

const ROLE_LABELS = { HQ_ADMIN: "Admin Pusat", CASHIER: "Kasir" };
const STATUS_LABELS = { active: "Aktif", inactive: "Nonaktif" };

function make(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

export function initializeUsersPage({ administrationService, authService } = {}) {
  const page = document.querySelector('#users[data-page-view="users"]');
  if (!page || !administrationService || !authService) return null;
  const form = page.querySelector("#user-form");
  const dialog = page.querySelector("#user-dialog");
  const confirmDialog = page.querySelector("#user-confirm-dialog");
  const passwordResetDialog = page.querySelector("#user-password-reset-dialog");
  const passwordResetForm = page.querySelector("#user-password-reset-form");
  const provisioningDialog = page.querySelector("#users-provision-dialog");
  const search = page.querySelector("#users-search");
  const roleFilter = page.querySelector("#users-role-filter");
  const branchFilter = page.querySelector("#users-branch-filter");
  const statusFilter = page.querySelector("#users-status-filter");
  const body = page.querySelector("#users-table-body");
  const empty = page.querySelector("#users-empty");
  const loadError = page.querySelector("#users-load-error");
  const error = page.querySelector("#user-form-error");
  let editingId = null;
  let pendingSensitiveSave = null;
  let pendingPasswordReset = null;
  let pendingCashierProvisioning = null;
  let returnFocus = null;
  let provisioningReturnFocus = null;
  let branches = [];

  const isAdmin = () => hasPermission(authService.getSession(), "users:manage");
  const clearError = () => { error.hidden = true; error.textContent = ""; };
  const showError = (message) => { error.textContent = message; error.hidden = false; error.focus(); };
  const clearFieldErrors = () => form.querySelectorAll("[aria-invalid='true']").forEach((field) => field.removeAttribute("aria-invalid"));

  function branchLabel(id) { return branches.find((branch) => branch.branch_id === id)?.name ?? "Cabang tidak tersedia"; }

  function syncBranchOptions() {
    const result = administrationService.getSettings();
    branches = result.branches.filter((branch) => branch.status === "active");
    for (const select of [branchFilter, form.elements.branch_id]) {
      const current = select.value;
      const first = select.options[0];
      select.replaceChildren(first);
      branches.forEach((branch) => {
        const option = document.createElement("option");
        option.value = branch.branch_id;
        option.textContent = `${branch.name} · ${branch.code}`;
        select.append(option);
      });
      if ([...select.options].some((option) => option.value === current)) select.value = current;
    }
  }

  function render() {
    if (!isAdmin()) {
      body.replaceChildren();
      empty.hidden = true;
      loadError.hidden = false;
      loadError.textContent = "Akses administrasi hanya tersedia untuk Admin Pusat.";
      page.querySelector("#users-result-count").textContent = "Halaman administrasi hanya untuk Admin Pusat.";
      return;
    }
    try {
      syncBranchOptions();
      const users = administrationService.listUsers({ search: search.value, role: roleFilter.value, branch_id: branchFilter.value, status: statusFilter.value });
      loadError.hidden = true;
      loadError.textContent = "";
      body.replaceChildren();
      users.forEach((user) => {
        const row = document.createElement("tr");
        const identity = make("td", "admin-user-identity");
        identity.append(make("strong", "", user.display_name), make("span", "", user.username));
        const role = make("td");
        role.append(make("span", `badge ${user.role === "HQ_ADMIN" ? "badge--accent" : "badge--neutral"}`, ROLE_LABELS[user.role]));
        const assignment = make("td", "", user.role === "HQ_ADMIN" ? "Seluruh cabang" : user.branch_name);
        if (user.role === "CASHIER") assignment.append(make("small", "admin-user-code", user.branch_id));
        const status = make("td");
        status.append(make("span", `badge ${user.status === "active" ? "badge--success" : "badge--neutral"}`, STATUS_LABELS[user.status]));
        const actions = make("td", "admin-user-actions");
        const edit = make("button", "button button--secondary button--small", "Edit");
        edit.type = "button";
        edit.dataset.editUser = user.user_id;
        edit.setAttribute("aria-label", `Edit ${user.display_name}`);
        actions.append(edit);
        row.append(identity, role, assignment, status, actions);
        body.append(row);
      });
      empty.hidden = users.length > 0;
      page.querySelector("#users-result-count").textContent = `${users.length} akun`;
    } catch (loadError) {
      body.replaceChildren();
      empty.hidden = true;
      const message = page.querySelector("#users-load-error");
      message.textContent = loadError.message || "Direktori pengguna tidak dapat dimuat.";
      message.hidden = false;
      page.querySelector("#users-result-count").textContent = "Direktori belum dapat dibaca.";
      showToast(loadError.message || "Direktori pengguna tidak dapat dimuat.", "error");
    }
  }

  function payloadFromForm() {
    return {
      display_name: form.elements.display_name.value,
      username: form.elements.username.value,
      role: form.elements.role.value,
      branch_id: form.elements.role.value === "CASHIER" ? form.elements.branch_id.value : null,
      status: form.elements.status.value,
      ...(editingId ? {} : { password: form.elements.password.value }),
    };
  }

  function closeEditor(saved = false) {
    clearError();
    clearFieldErrors();
    form.reset();
    form.elements.password.required = false;
    form.elements.password.disabled = false;
    form.elements.password.closest(".field").hidden = false;
    editingId = null;
    dialog.close(saved ? "saved" : "cancel");
  }

  function openEditor(userId = null, trigger = null) {
    if (!isAdmin()) { showToast("Akses administrasi hanya untuk Admin Pusat.", "error"); return; }
    clearError();
    clearFieldErrors();
    form.reset();
    editingId = userId;
    returnFocus = trigger ?? document.activeElement;
    const user = userId ? administrationService.getUser(userId) : null;
    if (userId && !user) { showToast("Pengguna tidak ditemukan.", "error"); return; }
    page.querySelector("#user-dialog-title").textContent = user ? "Edit pengguna" : "Tambah pengguna";
    page.querySelector("#user-dialog-description").textContent = user
      ? "Perubahan role, cabang, atau status akan meminta konfirmasi sebelum commit."
      : "Gunakan hanya kredensial buatan untuk presentasi lokal.";
    form.elements.display_name.value = user?.display_name ?? "";
    form.elements.username.value = user?.username ?? "";
    form.elements.username.readOnly = false;
    form.elements.role.value = user?.role ?? "CASHIER";
    form.elements.branch_id.value = user?.branch_id ?? "";
    form.elements.status.value = user?.status ?? "active";
    form.elements.password.value = "";
    form.elements.password.required = !user;
    form.elements.password.closest(".field").hidden = Boolean(user);
    form.elements.password.disabled = Boolean(user);
    page.querySelector("#user-reset-password-row").hidden = !user;
    page.querySelector("#user-save").textContent = user ? "Simpan perubahan" : "Buat akun presentasi";
    updateRoleFields();
    dialog.returnValue = "";
    dialog.showModal();
    requestAnimationFrame(() => form.elements.display_name.focus({ preventScroll: true }));
  }

  function updateRoleFields() {
    const isCashier = form.elements.role.value === "CASHIER";
    form.elements.branch_id.closest(".field").hidden = !isCashier;
    form.elements.branch_id.required = isCashier;
    page.querySelector("#user-branch-hint").textContent = isCashier
      ? "Kasir dibatasi ke cabang yang ditugaskan."
      : "Admin Pusat mencakup seluruh cabang.";
  }

  function fieldFocus(fieldErrors = {}) {
    const fieldMap = { display_name: form.elements.display_name, username: form.elements.username, role: form.elements.role, branch_id: form.elements.branch_id, status: form.elements.status, password: form.elements.password };
    const first = Object.keys(fieldErrors)[0];
    fieldMap[first]?.focus();
    fieldMap[first]?.setAttribute("aria-invalid", "true");
  }

  function labelValue(change) {
    const format = (value) => change.field === "username" ? value
      : change.field === "role" ? ROLE_LABELS[value]
      : change.field === "status" ? STATUS_LABELS[value]
        : value ? `${branchLabel(value)} (${value})` : "Seluruh cabang";
    return `${format(change.before)} → ${format(change.after)}`;
  }

  function showSensitiveConfirmation(changes, payload) {
    const list = page.querySelector("#user-confirm-changes");
    list.replaceChildren();
    changes.forEach((change) => {
      const item = document.createElement("li");
      item.append(make("strong", "", change.label), make("span", "", labelValue(change)));
      list.append(item);
    });
    pendingSensitiveSave = { userId: editingId, payload };
    confirmDialog.showModal();
    page.querySelector("#user-confirm-save").focus({ preventScroll: true });
  }

  function commitEdit(userId, payload, confirmedSensitive = false) {
    try {
      administrationService.updateUser(userId, payload, { confirmedSensitive });
      closeEditor(true);
      render();
      const session = authService.refreshSession();
      document.dispatchEvent(new CustomEvent("app:authchange", { detail: { session, reason: session ? "user-updated" : "stale-session" } }));
      showToast(session ? "Perubahan akun tersimpan." : "Perubahan akses tersimpan. Sesi Anda berakhir karena peran atau cabang berubah.", session ? "success" : "info");
    } catch (saveError) {
      if (saveError.code === "ADMIN_CONFIRMATION_REQUIRED" && !confirmedSensitive) {
        showSensitiveConfirmation(saveError.cause?.changes ?? [], payload);
        return;
      }
      showError(saveError.message || "Perubahan pengguna gagal disimpan.");
      fieldFocus(saveError.fieldErrors);
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    clearError();
    clearFieldErrors();
    if (!isAdmin()) { showError("Akses administrasi hanya untuk Admin Pusat."); return; }
    const payload = payloadFromForm();
    if (!editingId) {
      try {
        const created = administrationService.createUser(payload);
        closeEditor(true);
        render();
        showToast(`Akun demo ${created.username} berhasil dibuat.`, "success");
      } catch (saveError) {
        showError(saveError.message || "Akun demo gagal dibuat.");
        fieldFocus(saveError.fieldErrors);
      }
      return;
    }
    commitEdit(editingId, payload);
  }

  function openCashierProvisioning(event) {
    if (!isAdmin()) { showToast("Penyiapan akun kasir cabang hanya tersedia untuk Admin Pusat.", "error"); return; }
    try {
      pendingCashierProvisioning = administrationService.previewBranchCashierProvisioning({ actorRole: authService.getSession()?.user?.role });
      provisioningReturnFocus = event?.currentTarget ?? page.querySelector("#users-provision-cashiers");
      const preview = pendingCashierProvisioning;
      const hasMismatch = preview.accounts.some((account) => !["active-correct", "will-add"].includes(account.status));
      page.querySelector("#users-provision-summary").textContent = hasMismatch
        ? "Ada ketidaksesuaian yang perlu diselesaikan Admin secara manual. Provisioning tidak akan mengaktifkan atau memindahkan akun, maupun menimpa username/password."
        : preview.toAdd
          ? preview.toAdd + " akun belum tersedia dan akan ditambahkan. Akun aktif yang sudah sesuai beserta perubahan Admin tetap dipertahankan."
          : "Semua akun aktif dan sudah sesuai cabang. Tidak ada akun atau kata sandi yang akan diubah.";
      const list = page.querySelector("#users-provision-list");
      list.replaceChildren();
      const labels = {
        "will-add": "Belum tersedia",
        "active-correct": "Aktif dan sesuai cabang",
        "inactive": "Akun nonaktif",
        "assignment-mismatch": "Penugasan berbeda",
        "username-conflict": "Konflik username; perlu ditinjau",
        "branch-unavailable": "Cabang tidak aktif atau tidak tersedia",
      };
      preview.accounts.forEach((account) => {
        const item = make("li");
        item.append(
          make("strong", "", account.branch_name),
          make("span", "", account.display_name + " · " + account.username + " — " + (labels[account.status] ?? account.status) + ". " + account.reason),
        );
        list.append(item);
      });
      const error = page.querySelector("#users-provision-error");
      error.hidden = true;
      error.textContent = "";
      const confirmButton = page.querySelector("#users-provision-confirm");
      confirmButton.disabled = !preview.canProvision || preview.toAdd === 0;
      confirmButton.textContent = hasMismatch
        ? "Selesaikan ketidaksesuaian manual"
        : preview.toAdd ? "Konfirmasi tambah " + preview.toAdd + " akun" : "Semua akun sudah sesuai";
      provisioningDialog.showModal();
      requestAnimationFrame(() => (confirmButton.disabled ? page.querySelector("[data-close-users-provision]") : confirmButton).focus({ preventScroll: true }));
    } catch (previewError) {
      showToast(previewError.message || "Pratinjau akun kasir gagal dimuat.", "error");
    }
  }

  function confirmCashierProvisioning() {
    if (!pendingCashierProvisioning || !isAdmin()) {
      provisioningDialog.close("denied");
      showToast("Akses Admin Pusat tidak lagi aktif; akun tidak ditambahkan.", "error");
      return;
    }
    try {
      const result = administrationService.provisionBranchCashiers({
        actorRole: authService.getSession()?.user?.role,
        confirmed: true,
      });
      pendingCashierProvisioning = null;
      provisioningDialog.close("confirmed");
      render();
      showToast(result.addedCount
        ? result.addedCount + " akun kasir cabang ditambahkan ke daftar pengguna."
        : "Akun kasir cabang sudah tersedia; tidak ada data yang diubah.", "success");
    } catch (provisionError) {
      const error = page.querySelector("#users-provision-error");
      error.textContent = provisionError.message || "Akun kasir cabang gagal disiapkan.";
      error.hidden = false;
      error.focus();
    }
  }

  function openPasswordReset() {
    if (!isAdmin() || !editingId) { showToast("Reset kata sandi demo hanya tersedia bagi Admin Pusat pada akun yang dipilih.", "error"); return; }
    const user = administrationService.getUser(editingId);
    if (!user) { showToast("Pengguna tidak ditemukan.", "error"); return; }
    pendingPasswordReset = null;
    passwordResetForm.reset();
    page.querySelector("#user-password-reset-name").textContent = `${user.display_name} (${user.username})`;
    page.querySelector("#user-password-reset-confirm-target").textContent = `${user.display_name} (${user.username})`;
    page.querySelector("#user-password-reset-entry").hidden = false;
    page.querySelector("#user-password-reset-confirmation").hidden = true;
    const resetError = page.querySelector("#user-password-reset-error");
    resetError.hidden = true;
    resetError.textContent = "";
    dialog.close("reset-password");
    passwordResetDialog.showModal();
    requestAnimationFrame(() => passwordResetForm.elements.password.focus({ preventScroll: true }));
  }

  function closePasswordReset() {
    pendingPasswordReset = null;
    passwordResetForm.reset();
    passwordResetDialog.close("cancel");
  }

  function continuePasswordReset(event) {
    event.preventDefault();
    const resetError = page.querySelector("#user-password-reset-error");
    resetError.hidden = true;
    resetError.textContent = "";
    const password = passwordResetForm.elements.password.value;
    const confirmation = passwordResetForm.elements.password_confirmation.value;
    if (password.trim().length < 8 || password.length > 128) {
      resetError.textContent = "Kata sandi demo baru harus 8–128 karakter.";
      resetError.hidden = false;
      passwordResetForm.elements.password.setAttribute("aria-invalid", "true");
      passwordResetForm.elements.password.focus();
      return;
    }
    if (password !== confirmation) {
      resetError.textContent = "Kedua kata sandi belum sama.";
      resetError.hidden = false;
      passwordResetForm.elements.password_confirmation.setAttribute("aria-invalid", "true");
      passwordResetForm.elements.password_confirmation.focus();
      return;
    }
    if (!isAdmin() || !editingId || !administrationService.getUser(editingId)) {
      resetError.textContent = "Akses Admin Pusat atau akun yang dipilih sudah berubah.";
      resetError.hidden = false;
      return;
    }
    pendingPasswordReset = { userId: editingId, password };
    passwordResetForm.elements.password.value = "";
    passwordResetForm.elements.password_confirmation.value = "";
    passwordResetForm.elements.password.removeAttribute("aria-invalid");
    passwordResetForm.elements.password_confirmation.removeAttribute("aria-invalid");
    page.querySelector("#user-password-reset-entry").hidden = true;
    page.querySelector("#user-password-reset-confirmation").hidden = false;
    page.querySelector("#user-password-reset-confirm").focus({ preventScroll: true });
  }

  function commitPasswordReset() {
    const pending = pendingPasswordReset;
    if (!pending) return;
    pendingPasswordReset = null;
    if (!isAdmin()) { closePasswordReset(); showToast("Akses administrasi sudah berakhir; reset tidak disimpan.", "error"); return; }
    try {
      administrationService.resetDemoPassword(pending.userId, pending.password, { confirmed: true });
      passwordResetDialog.close("confirmed");
      passwordResetForm.reset();
      const session = authService.refreshSession();
      if (session && editingId) {
        dialog.showModal();
        requestAnimationFrame(() => page.querySelector("#user-reset-password").focus({ preventScroll: true }));
      } else if (!session) {
        form.reset();
        editingId = null;
      }
      document.dispatchEvent(new CustomEvent("app:authchange", { detail: { session, reason: session ? "demo-password-reset" : "credential-session-invalidated" } }));
      render();
      showToast(session ? "Kata sandi demo akun terpilih telah direset. Sesi lamanya sudah tidak berlaku." : "Kata sandi demo direset; sesi akun yang dipilih berakhir.", "success");
    } catch (saveError) {
      page.querySelector("#user-password-reset-confirmation").hidden = true;
      page.querySelector("#user-password-reset-entry").hidden = false;
      page.querySelector("#user-password-reset-error").textContent = saveError.message || "Reset kata sandi demo gagal disimpan.";
      page.querySelector("#user-password-reset-error").hidden = false;
      pendingPasswordReset = null;
      page.querySelector("#user-password-reset-error").focus();
    }
  }

  page.querySelector("#users-add").addEventListener("click", (event) => openEditor(null, event.currentTarget));
  page.querySelector("#users-provision-cashiers").addEventListener("click", openCashierProvisioning);
  page.querySelector("#users-provision-confirm").addEventListener("click", confirmCashierProvisioning);
  page.querySelectorAll("[data-close-users-provision]").forEach((button) => button.addEventListener("click", () => provisioningDialog.close("cancel")));
  provisioningDialog.addEventListener("click", (event) => { if (event.target === provisioningDialog) provisioningDialog.close("cancel"); });
  provisioningDialog.addEventListener("close", () => {
    pendingCashierProvisioning = null;
    const focusTarget = provisioningReturnFocus;
    provisioningReturnFocus = null;
    if (focusTarget?.isConnected) requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  });
  page.querySelector("#users-clear-filters").addEventListener("click", () => {
    search.value = ""; roleFilter.value = "all"; branchFilter.value = "all"; statusFilter.value = "all"; render(); search.focus();
  });
  [search, roleFilter, branchFilter, statusFilter].forEach((control) => control.addEventListener(control === search ? "input" : "change", render));
  body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-user]");
    if (button) openEditor(button.dataset.editUser, button);
  });
  form.addEventListener("submit", onSubmit);
  form.elements.role.addEventListener("change", updateRoleFields);
  page.querySelectorAll("[data-close-user-dialog]").forEach((button) => button.addEventListener("click", () => closeEditor(false)));
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeEditor(false); });
  page.querySelectorAll("[data-close-user-confirm]").forEach((button) => button.addEventListener("click", () => confirmDialog.close("back")));
  confirmDialog.addEventListener("click", (event) => { if (event.target === confirmDialog) confirmDialog.close("back"); });
  confirmDialog.addEventListener("close", () => { if (confirmDialog.returnValue !== "confirm") pendingSensitiveSave = null; });
  page.querySelector("#user-confirm-save").addEventListener("click", () => {
    const pending = pendingSensitiveSave;
    pendingSensitiveSave = null;
    confirmDialog.close("confirm");
    if (pending) commitEdit(pending.userId, pending.payload, true);
  });
  page.querySelector("#user-reset-password").addEventListener("click", openPasswordReset);
  passwordResetForm.addEventListener("submit", continuePasswordReset);
  page.querySelectorAll("[data-cancel-password-reset]").forEach((button) => button.addEventListener("click", closePasswordReset));
  passwordResetDialog.addEventListener("click", (event) => { if (event.target === passwordResetDialog) closePasswordReset(); });
  passwordResetDialog.addEventListener("close", () => {
    const confirmed = passwordResetDialog.returnValue === "confirmed";
    if (!confirmed) pendingPasswordReset = null;
    passwordResetForm.reset();
    page.querySelector("#user-password-reset-entry").hidden = false;
    page.querySelector("#user-password-reset-confirmation").hidden = true;
    if (!confirmed && isAdmin() && editingId) {
      dialog.showModal();
      requestAnimationFrame(() => page.querySelector("#user-reset-password").focus({ preventScroll: true }));
    }
  });
  page.querySelector("#user-password-reset-back").addEventListener("click", () => {
    pendingPasswordReset = null;
    page.querySelector("#user-password-reset-confirmation").hidden = true;
    page.querySelector("#user-password-reset-entry").hidden = false;
    passwordResetForm.elements.password.focus({ preventScroll: true });
  });
  page.querySelector("#user-password-reset-confirm").addEventListener("click", commitPasswordReset);
  document.addEventListener("app:routechange", (event) => {
    if (event.detail?.route !== "users" && provisioningDialog.open) provisioningDialog.close("route-change");
    if (event.detail?.route === "users") render();
  });
  document.addEventListener("app:authchange", () => {
    if (provisioningDialog.open && !isAdmin()) provisioningDialog.close("access-revoked");
    if (!dialog.open && !confirmDialog.open && !passwordResetDialog.open && !provisioningDialog.open) render();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== ADMINISTRATION_STORAGE_KEY) return;
    const refreshed = authService.refreshSession();
    document.dispatchEvent(new CustomEvent("app:authchange", { detail: { session: refreshed, reason: refreshed ? "directory-updated" : "stale-session" } }));
    if (page.isConnected) render();
  });
  render();
  return Object.freeze({ render, openEditor });
}

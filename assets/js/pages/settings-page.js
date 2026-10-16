import { showToast } from "../components.js";
import { hasPermission } from "../auth/role-access.js";

function make(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

export function initializeSettingsPage({ administrationService, authService, setTheme } = {}) {
  const page = document.querySelector('#settings[data-page-view="settings"]');
  if (!page || !administrationService || !authService) return null;
  const form = page.querySelector("#settings-form");
  const error = page.querySelector("#settings-error");
  const success = page.querySelector("#settings-success");
  const isAdmin = () => hasPermission(authService.getSession(), "settings:manage");

  function render() {
    if (!isAdmin()) return;
    try {
      const data = administrationService.getSettings();
      form.elements.display_name.value = data.settings.display_name;
      form.elements.contact_email.value = data.settings.contact_email;
      form.elements.contact_phone.value = data.settings.contact_phone;
      form.elements.receipt_footer.value = data.settings.receipt_footer;
      form.elements.theme.value = document.documentElement.dataset.theme === "light" ? "light" : "dark";
      page.querySelector("#settings-org-id").textContent = data.settings.organization_id;
      page.querySelector("#settings-timezone").textContent = `${data.timezone} (UTC+07:00)`;
      const branchList = page.querySelector("#settings-branch-list");
      branchList.replaceChildren();
      data.branches.forEach((branch) => {
        const article = make("article", "settings-branch");
        const heading = make("div", "settings-branch__heading");
        heading.append(make("strong", "", branch.name), make("span", "badge badge--neutral", branch.status === "active" ? "Aktif" : "Nonaktif"));
        article.append(heading, make("p", "", `${branch.code} · ${branch.region_name}`), make("code", "", branch.branch_id));
        branchList.append(article);
      });
      error.hidden = true;
      success.hidden = true;
    } catch (loadError) {
      error.textContent = loadError.message || "Pengaturan tidak dapat dimuat.";
      error.hidden = false;
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    error.hidden = true;
    success.hidden = true;
    if (!isAdmin()) { error.textContent = "Pengaturan hanya dapat diubah oleh Admin Pusat."; error.hidden = false; error.focus(); return; }
    try {
      administrationService.saveSettings({
        display_name: form.elements.display_name.value,
        contact_email: form.elements.contact_email.value,
        contact_phone: form.elements.contact_phone.value,
        receipt_footer: form.elements.receipt_footer.value,
      });
      setTheme?.(form.elements.theme.value);
      success.textContent = "Pengaturan tersimpan. Catatan baru berlaku pada transaksi berikutnya; transaksi yang sudah selesai tetap.";
      success.hidden = false;
      showToast("Pengaturan organisasi tersimpan.", "success");
    } catch (saveError) {
      error.textContent = saveError.message || "Pengaturan gagal disimpan.";
      error.hidden = false;
      const fieldNames = { display_name: "display_name", contact_email: "contact_email", contact_phone: "contact_phone", receipt_footer: "receipt_footer" };
      const firstField = fieldNames[Object.keys(saveError.fieldErrors ?? {})[0]];
      if (firstField) form.elements[firstField].focus(); else error.focus();
    }
  }

  form.addEventListener("submit", onSubmit);
  document.addEventListener("app:routechange", (event) => { if (event.detail?.route === "settings") render(); });
  document.addEventListener("app:authchange", render);
  document.addEventListener("app:themechange", (event) => { form.elements.theme.value = event.detail?.theme ?? "dark"; });
  window.addEventListener("storage", render);
  render();
  return Object.freeze({ render });
}

let toastSequence = 0;

export function setCashierBranchContext(branch = null) {
  const label = branch ? `Kasir: ${branch.name}` : "Kasir: belum aktif";
  const accessibleLabel = branch
    ? `Cabang kasir aktif: ${branch.name} (${branch.branch_id})`
    : "Belum ada cabang kasir aktif. Workspace demo mencakup beberapa cabang.";
  document.querySelectorAll("[data-cashier-branch-context]").forEach((element) => {
    const textTarget = element.querySelector(".scope-pill__cashier-label") ?? element;
    const compactLabel = branch
      ? `Kasir: ${branch.name.replace(/^Cabang\s+/i, "").split(/\s+/)[0]}`
      : label;
    textTarget.textContent = element.classList.contains("scope-pill--cashier") ? compactLabel : label;
    element.setAttribute("aria-label", accessibleLabel);
    element.title = accessibleLabel;
  });
}

export function showToast(message, kind = "info") {
  const region = document.querySelector("#toast-region");
  if (!region || !message) return;

  const toast = document.createElement("div");
  const mark = document.createElement("span");
  const text = document.createElement("span");
  const id = ++toastSequence;

  const allowedKinds = new Set(["success", "warning", "error"]);
  const toastKind = allowedKinds.has(kind) ? kind : "info";
  toast.className = `toast${toastKind === "info" ? "" : ` toast--${toastKind}`}`;
  toast.setAttribute("role", toastKind === "error" ? "alert" : "status");
  toast.dataset.toastId = String(id);
  mark.className = "toast__mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = toastKind === "success" ? "✓" : toastKind === "warning" || toastKind === "error" ? "!" : "i";
  text.textContent = message;
  toast.append(mark, text);
  region.append(toast);

  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 160);
  }, 3600);
}

export function initializeComponents() {
  document.querySelectorAll("[data-toast]").forEach((button) => {
    button.addEventListener("click", () => {
      showToast(button.dataset.toastMessage || "Aksi demo ini belum terhubung.");
    });
  });

  const sampleInput = document.querySelector("#sample-input");
  const sampleHint = document.querySelector("#sample-input-hint");
  sampleInput?.addEventListener("input", () => {
    if (!sampleHint) return;
    sampleHint.textContent = sampleInput.value.trim()
      ? "Input demo diterima; pencarian data toko belum aktif."
      : "Contoh komponen saja; tidak mencari data toko.";
  });

  const dialog = document.querySelector("#demo-dialog");
  if (!dialog) return;

  document.querySelectorAll("[data-modal-open]").forEach((button) => {
    button.addEventListener("click", () => {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        showToast("Dialog membutuhkan browser modern yang mendukung elemen dialog.", "warning");
      }
    });
  });

  document.querySelectorAll("[data-modal-close]").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

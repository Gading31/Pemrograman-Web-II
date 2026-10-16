import { createLocalStorageRepository } from "../repositories/local-storage-repository.js";
import { DEMO_CASHIER_ID, PosService } from "../services/pos-service.js";
import { setCashierBranchContext, showToast } from "../components.js";

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
function formatMoney(value) { return money.format(value).replace(/\s/g, ""); }
function formatDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "—" : dateTime.format(parsed);
}
function node(tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined && text !== null) item.textContent = text;
  return item;
}

export function initializeShiftReconciliationPage({ repository = createLocalStorageRepository(), now = () => new Date(), authService = null } = {}) {
  const page = document.querySelector("#shifts[data-page-view]");
  if (!page) return null;
  let authUser = authService?.getSession()?.user ?? null;
  let cashierId = authUser?.user_id ?? DEMO_CASHIER_ID;
  let branchScopeId = authUser?.role === "CASHIER" ? authUser.branch_id : null;
  let service = new PosService({ repository, now, cashierId, branchScopeId });
  const form = page.querySelector("#shift-close-form");
  const physicalCash = page.querySelector("#shift-physical-cash");
  const errorBox = page.querySelector("#shift-close-error");
  const closeButton = page.querySelector("#shift-close-submit");
  const branchFilter = page.querySelector("#shift-branch-filter");
  const historyBody = page.querySelector("#shift-history-body");
  const historyCount = page.querySelector("#shift-history-count");
  const historyEmpty = page.querySelector("#shift-history-empty");
  const closeDialog = document.querySelector("#shift-close-confirm-dialog");
  const confirmCloseButton = document.querySelector("#shift-close-confirm-submit");
  const confirmCloseError = document.querySelector("#shift-close-confirm-error");
  let activeShift = null;
  let pendingClosePreview = null;
  let submitting = false;

  function fillBranches() {
    branchFilter.replaceChildren();
    if (!branchScopeId) branchFilter.append(new Option("Semua cabang", "all"));
    for (const branch of service.getWorkspace().branches.filter((item) => !branchScopeId || item.branch_id === branchScopeId)) {
      const option = node("option", "", branch.name);
      option.value = branch.branch_id;
      branchFilter.append(option);
    }
    branchFilter.value = branchScopeId ?? "all";
    branchFilter.disabled = Boolean(branchScopeId);
  }

  function showError(message = "") {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function renderActiveShift() {
    const workspace = service.getWorkspace();
    activeShift = workspace.shift;
    const status = page.querySelector("#shift-active-status");
    const description = page.querySelector("#shift-active-description");
    const isCashierContext = !authService || authService.getSession()?.user?.role === "CASHIER";
    if (workspace.branchScopeMismatch) {
      const assignedBranch = repository.load().branches.find((branch) => branch.branch_id === branchScopeId);
      if (isCashierContext) setCashierBranchContext(assignedBranch ?? { name: branchScopeId, branch_id: branchScopeId });
      form.hidden = true;
      status.className = "badge badge--critical";
      status.textContent = "Di luar cabang";
      page.querySelector("#active-shift-title").textContent = "Shift tidak tersedia untuk sesi ini";
      description.textContent = "Shift " + workspace.branchScopeMismatch.shift_id + " tercatat pada " + workspace.branchScopeMismatch.branch_id
        + ". Sesi kasir hanya dapat melihat atau menutup shift cabang yang ditugaskan (" + (assignedBranch?.name ?? branchScopeId) + ").";
      page.querySelector("#shift-opening-cash").textContent = "—";
      page.querySelector("#shift-confirmed-cash").textContent = "—";
      page.querySelector("#shift-expected-cash").textContent = "—";
      physicalCash.value = "";
      physicalCash.disabled = true;
      closeButton.disabled = true;
      return;
    }
    if (!activeShift) {
      if (isCashierContext) setCashierBranchContext(null);
      form.hidden = true;
      status.className = "badge badge--neutral";
      status.textContent = "Tidak aktif";
      page.querySelector("#active-shift-title").textContent = "Tidak ada shift aktif";
      description.textContent = "Tidak ada shift aktif untuk kasir ini. Buka shift dari halaman Kasir / POS.";
      page.querySelector("#shift-opening-cash").textContent = "—";
      page.querySelector("#shift-confirmed-cash").textContent = "—";
      page.querySelector("#shift-expected-cash").textContent = "—";
      physicalCash.value = "";
      physicalCash.disabled = true;
      closeButton.disabled = true;
      return;
    }
    const branch = workspace.branches.find((item) => item.branch_id === activeShift.branch_id);
    if (isCashierContext) setCashierBranchContext(branch ?? { name: activeShift.branch_id, branch_id: activeShift.branch_id });
    form.hidden = false;
    page.querySelector("#active-shift-title").textContent = "Tutup shift aktif";
    const details = service.getShiftHistory().find((item) => item.shift_id === activeShift.shift_id);
    status.className = "badge badge--success";
    status.textContent = "Aktif";
    description.textContent = `${branch?.name ?? activeShift.branch_id} · ${activeShift.shift_id} · dibuka ${formatDate(activeShift.opened_at)} · aktor ${activeShift.cashier_id}`;
    page.querySelector("#shift-opening-cash").textContent = formatMoney(activeShift.opening_cash_idr);
    page.querySelector("#shift-confirmed-cash").textContent = formatMoney(details?.confirmed_cash_movement_idr ?? 0);
    page.querySelector("#shift-expected-cash").textContent = formatMoney(activeShift.expected_cash_idr);
    physicalCash.disabled = false;
    closeButton.disabled = submitting || physicalCash.value === "";
  }

  function renderHistory() {
    historyBody.replaceChildren();
    try {
      const shifts = service.getShiftHistory({ branchId: branchFilter.value });
      historyCount.textContent = `${integer.format(shifts.length)} shift tersimpan`;
      historyEmpty.hidden = shifts.length > 0;
      for (const shift of shifts) {
        const row = node("tr");
        const shiftCell = node("td", "m6-transaction-id");
        shiftCell.append(node("strong", "", shift.shift_id), node("small", "", `${formatDate(shift.opened_at)}${shift.closed_at ? ` → ${formatDate(shift.closed_at)}` : " · masih aktif"}`));
        const branchCell = node("td");
        branchCell.append(node("strong", "", shift.branch_name), node("small", "", `Aktor ${shift.closed_by ?? shift.cashier_id}`));
        row.append(shiftCell, branchCell, node("td", "", `${integer.format(shift.transaction_count)} transaksi · ${integer.format(shift.confirmed_cash_movement_count)} mutasi terkonfirmasi`), node("td", "m6-money", formatMoney(shift.opening_cash_idr)), node("td", "m6-money", formatMoney(shift.expected_cash_idr)));
        row.append(node("td", "m6-money", shift.status === "closed" ? formatMoney(shift.closing_cash_idr) : "—"));
        const difference = shift.status === "closed" ? shift.cash_difference_idr : null;
        row.append(node("td", difference === null ? "" : difference < 0 ? "m6-money m6-negative" : difference > 0 ? "m6-money m6-positive" : "m6-money", difference === null ? "—" : formatMoney(difference)));
        const statusCell = node("td");
        statusCell.append(node("span", shift.status === "closed" ? "badge badge--neutral" : "badge badge--success", shift.status === "closed" ? "Ditutup" : "Aktif"));
        row.append(statusCell);
        historyBody.append(row);
      }
    } catch (error) {
      historyCount.textContent = "Riwayat shift tidak dapat dibaca";
      historyEmpty.hidden = false;
      historyEmpty.querySelector("h3").textContent = "Riwayat gagal dimuat";
      historyEmpty.querySelector("p").textContent = error.message || "Repository demo tidak dapat dibaca.";
      showToast("Riwayat shift gagal dimuat dari penyimpanan lokal.", "error");
    }
  }

  function render() {
    fillBranches();
    renderActiveShift();
    renderHistory();
  }

  physicalCash.addEventListener("input", () => {
    closeButton.disabled = !activeShift || submitting || physicalCash.value === "";
  });
  branchFilter.addEventListener("change", renderHistory);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!activeShift || submitting) return;
    showError();
    try {
      pendingClosePreview = service.previewShiftClose({ shiftId: activeShift.shift_id, physicalCashIdr: physicalCash.value });
      confirmCloseError.textContent = "";
      confirmCloseError.hidden = true;
      page.ownerDocument.querySelector("#shift-close-confirm-expected").textContent = formatMoney(pendingClosePreview.expected_cash_idr);
      page.ownerDocument.querySelector("#shift-close-confirm-physical").textContent = formatMoney(pendingClosePreview.physical_cash_idr);
      page.ownerDocument.querySelector("#shift-close-confirm-difference").textContent = formatMoney(pendingClosePreview.cash_difference_idr);
      confirmCloseButton.disabled = false;
      closeDialog.showModal();
    } catch (error) {
      showError(error.message || "Shift tidak dapat ditutup.");
      errorBox.focus();
      showToast("Pratinjau penutupan gagal. Data tersimpan tidak berubah.", "error");
    }
  });
  page.ownerDocument.querySelectorAll("[data-shift-close-cancel]").forEach((button) => button.addEventListener("click", () => closeDialog.close()));
  closeDialog.addEventListener("close", () => {
    pendingClosePreview = null;
    confirmCloseError.textContent = "";
    confirmCloseError.hidden = true;
    confirmCloseButton.disabled = false;
  });
  confirmCloseButton.addEventListener("click", () => {
    if (!pendingClosePreview || submitting) return;
    submitting = true;
    confirmCloseButton.disabled = true;
    confirmCloseError.textContent = "";
    confirmCloseError.hidden = true;
    try {
      const closed = service.closeShift({
        shiftId: pendingClosePreview.shift_id,
        physicalCashIdr: pendingClosePreview.physical_cash_idr,
        previewExpectedCashIdr: pendingClosePreview.expected_cash_idr,
        previewDifferenceIdr: pendingClosePreview.cash_difference_idr,
      });
      closeDialog.close();
      physicalCash.value = "";
      showToast(`Shift ditutup. Selisih kas ${formatMoney(closed.cash_difference_idr)}.`, closed.cash_difference_idr === 0 ? "success" : "warning");
      render();
    } catch (error) {
      confirmCloseError.textContent = error.message || "Shift tidak dapat ditutup.";
      confirmCloseError.hidden = false;
      confirmCloseError.focus();
      showToast("Penutupan shift gagal. Data tersimpan tidak berubah.", "error");
    } finally {
      submitting = false;
      if (closeDialog.open) confirmCloseButton.disabled = false;
      renderActiveShift();
    }
  });
  window.addEventListener("hashchange", () => { if (window.location.hash === "#shifts") render(); });
  document.addEventListener("app:authchange", () => {
    authUser = authService?.getSession()?.user ?? null;
    cashierId = authUser?.user_id ?? DEMO_CASHIER_ID;
    branchScopeId = authUser?.role === "CASHIER" ? authUser.branch_id : null;
    service = new PosService({ repository, now, cashierId, branchScopeId });
    render();
  });
  render();
  return { service, render };
}

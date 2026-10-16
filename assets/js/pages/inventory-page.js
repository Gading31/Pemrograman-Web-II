import { showToast } from "../components.js";
import { createInventoryRepository } from "../repositories/inventory-repository.js";
import { createLocalStorageRepository } from "../repositories/local-storage-repository.js";
import { InventoryError, InventoryService } from "../services/inventory-service.js";
import { DemoStockProvisioningService } from "../services/demo-stock-provisioning-service.js";
import { PresentationTransactionProvisioningService } from "../services/presentation-transaction-provisioning-service.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const numberFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const bucketLabels = { AVAILABLE: "Layak jual", QUARANTINE: "Karantina", DAMAGED: "Rusak", EXPIRED: "Kedaluwarsa", IN_TRANSIT: "Dalam transit" };
const movementLabels = { OPENING_BALANCE: "Saldo awal", ADJUSTMENT: "Penyesuaian", CONDITION_TRANSFER: "Pindah kondisi" };

const workspaceRepository = createLocalStorageRepository();
const repository = createInventoryRepository({ repository: workspaceRepository });
const inventory = new InventoryService({ repository });
const stockProvisioning = new DemoStockProvisioningService({ repository: workspaceRepository });
const presentationSalesProvisioning = new PresentationTransactionProvisioningService({ repository: workspaceRepository });
const state = { warehouseId: "all", productId: "all", bucket: "all", selectedBatchId: null, workspace: null, returnFocus: null, discardTarget: null, discardReturnFocus: null, formBaselines: new WeakMap(), provisioningReturnFocus: null, provisioningPreview: null, salesProvisioningReturnFocus: null, salesProvisioningPreview: null };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function formatDate(value) {
  if (!value) return "Tidak berlaku";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatTimestamp(value) {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value));
}

function syncSelect(selector, options, valueKey, labelFor, placeholder, value) {
  const select = $(selector);
  if (!select) return;
  const currentValue = value ?? select.value;
  const fragment = document.createDocumentFragment();
  const first = document.createElement("option");
  first.value = placeholder.startsWith("Semua ") ? "all" : "";
  first.textContent = placeholder;
  fragment.append(first);
  options.forEach((option) => {
    const node = document.createElement("option");
    node.value = option[valueKey];
    node.textContent = labelFor(option);
    fragment.append(node);
  });
  select.replaceChildren(fragment);
  if ([...select.options].some((option) => option.value === currentValue)) select.value = currentValue;
  else select.selectedIndex = 0;
}

function setStorageError(error) {
  const panel = $("#inventory-storage-error");
  if (panel) {
    panel.hidden = false;
    $("[data-inventory-error-message]", panel).textContent = error?.message || "Penyimpanan persediaan demo tidak dapat dibaca.";
  }
  [".inventory-summary-grid", ".inventory-toolbar", ".inventory-workspace-grid", ".inventory-movements-card"].forEach((selector) => {
    const element = $(selector);
    if (element) element.hidden = true;
  });
}

function clearStorageError() {
  $("#inventory-storage-error").hidden = true;
  [".inventory-summary-grid", ".inventory-toolbar", ".inventory-workspace-grid", ".inventory-movements-card"].forEach((selector) => {
    const element = $(selector);
    if (element) element.hidden = false;
  });
}

function renderSummary(summary) {
  $("#inventory-summary-physical").textContent = `${numberFormat.format(summary.physical)} unit`;
  $("#inventory-summary-sellable").textContent = `${numberFormat.format(summary.sellable)} unit`;
  $("#inventory-summary-held").textContent = `${numberFormat.format(summary.quarantine + summary.damaged)} unit`;
  $("#inventory-summary-held-detail").textContent = `${numberFormat.format(summary.quarantine)} karantina · ${numberFormat.format(summary.damaged)} rusak`;
  $("#inventory-summary-expired").textContent = `${numberFormat.format(summary.expired)} unit`;
  $("#inventory-summary-transit").textContent = `${numberFormat.format(summary.inTransit)} unit`;
}

function renderBatches(workspace) {
  const tableBody = $("#inventory-batch-table-body");
  const empty = $("#inventory-empty-state");
  tableBody.replaceChildren();
  const count = workspace.batches.length;
  $("#inventory-batch-count").textContent = `${numberFormat.format(count)} batch pada filter ini`;
  empty.hidden = count > 0;
  workspace.batches.forEach((batch) => {
    const otherBuckets = ["QUARANTINE", "DAMAGED", "EXPIRED", "IN_TRANSIT"]
      .filter((bucket) => batch.balances[bucket] > 0)
      .map((bucket) => `${bucketLabels[bucket]} ${numberFormat.format(batch.balances[bucket])}`);
    if (batch.expiryState === "expired-by-date" && batch.balances.AVAILABLE > 0) {
      otherBuckets.unshift(`Lewat kedaluwarsa ${numberFormat.format(batch.balances.AVAILABLE)}`);
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="inventory-product-cell"><strong>${escapeHtml(batch.product?.name)}</strong><span>${escapeHtml(batch.product?.sku)} · Lot ${escapeHtml(batch.lot_number)}</span></td>
      <td class="inventory-location-cell"><strong>${escapeHtml(batch.warehouse?.name)}</strong><span>${escapeHtml(batch.location?.name)} · ${escapeHtml(batch.warehouse?.branch_id ?? "Gudang pusat")}</span></td>
      <td class="inventory-expiry-cell"><strong>${escapeHtml(formatDate(batch.expiry_date))}</strong><span class="badge ${batch.expiryState === "expired-by-date" ? "badge--critical" : "badge--neutral"}">${escapeHtml(batch.rotation_policy)}</span></td>
      <td class="inventory-quantity-cell"><strong>${numberFormat.format(batch.sellableQuantity)}</strong><span>unit layak jual</span></td>
      <td class="inventory-other-buckets">${otherBuckets.length ? otherBuckets.map((item) => `<span>${escapeHtml(item)}</span>`).join("") : '<span class="inventory-zero">Tidak ada saldo lain</span>'}</td>
      <td><button class="button button--secondary inventory-row-action" type="button" data-select-inventory-batch="${escapeHtml(batch.inventory_batch_id)}" aria-label="Lihat mutasi untuk lot ${escapeHtml(batch.lot_number)}">Lihat mutasi</button></td>`;
    tableBody.append(tr);
  });
}

function renderMovements(workspace) {
  const selectedBatch = state.selectedBatchId && workspace.batches.find((item) => item.inventory_batch_id === state.selectedBatchId);
  if (state.selectedBatchId && !selectedBatch) state.selectedBatchId = null;
  const visible = state.selectedBatchId
    ? workspace.movements.filter((item) => item.inventory_batch_id === state.selectedBatchId)
    : workspace.movements;
  const scopeButton = $("#inventory-movement-scope");
  scopeButton.hidden = !selectedBatch;
  scopeButton.textContent = selectedBatch ? `Lot ${selectedBatch.lot_number} · tampilkan semua mutasi` : "Semua batch terfilter";
  scopeButton.setAttribute("aria-label", selectedBatch ? `Tampilkan semua mutasi, saat ini hanya lot ${selectedBatch.lot_number}` : "Semua batch terfilter");
  $("#inventory-movement-count").textContent = `${numberFormat.format(visible.length)} mutasi · histori sebelumnya tetap`;
  const tableBody = $("#inventory-movement-table-body");
  tableBody.replaceChildren();
  $("#inventory-movement-empty").hidden = visible.length > 0;
  visible.forEach((movement) => {
    const tr = document.createElement("tr");
    const delta = movement.quantity_delta > 0 ? `+${numberFormat.format(movement.quantity_delta)}` : numberFormat.format(movement.quantity_delta);
    tr.innerHTML = `
      <td class="inventory-movement-time"><strong>${escapeHtml(formatTimestamp(movement.occurred_at))}</strong><span>Efektif ${escapeHtml(formatDate(movement.effective_date))} · ${escapeHtml(movement.reference_type)} · ${escapeHtml(movement.reference_id)}</span></td>
      <td class="inventory-product-cell"><strong>${escapeHtml(movement.batch?.product?.name)}</strong><span>${escapeHtml(movement.batch?.lot_number)} · ${escapeHtml(movement.batch?.warehouse?.name)}</span></td>
      <td>${escapeHtml(movementLabels[movement.movement_type] ?? movement.movement_type)}</td>
      <td><span class="badge badge--neutral">${escapeHtml(bucketLabels[movement.stock_bucket] ?? movement.stock_bucket)}</span></td>
      <td class="inventory-delta ${movement.quantity_delta < 0 ? "inventory-delta--negative" : ""}">${escapeHtml(delta)} unit</td>
      <td class="inventory-movement-reason"><strong>${escapeHtml(movement.reason)}</strong><span>${escapeHtml(movement.actor_id)}</span></td>`;
    tableBody.append(tr);
  });
}

function syncWorkspaceSelects(workspace) {
  const warehouses = workspace.warehouses.filter((item) => item.status === "active");
  const branches = new Map(workspace.branches.map((item) => [item.branch_id, item.name]));
  const warehouseLabel = (item) => item.branch_id ? `${item.name} · ${branches.get(item.branch_id) ?? item.branch_id}` : item.name;
  syncSelect("#inventory-warehouse-filter", warehouses, "warehouse_id", warehouseLabel, "Semua gudang", state.warehouseId);
  syncSelect("#inventory-product-filter", workspace.products, "product_id", (item) => `${item.name} · ${item.sku}`, "Semua produk", state.productId);
  syncSelect("#inventory-simulator-product", workspace.products.filter((item) => item.status === "active"), "product_id", (item) => `${item.name} · ${item.sku}`, "Pilih produk aktif", $("#inventory-simulator-product").value || "PRD-001");
  syncSelect("#inventory-simulator-warehouse", warehouses, "warehouse_id", warehouseLabel, "Pilih gudang", $("#inventory-simulator-warehouse").value || "WH-JKT-01");
  syncSelect("#inventory-opening-product", workspace.products.filter((item) => item.status === "active"), "product_id", (item) => `${item.name} · ${item.sku}`, "Pilih produk aktif", $("#inventory-opening-product").value);
  syncSelect("#inventory-opening-warehouse", warehouses, "warehouse_id", warehouseLabel, "Pilih gudang", $("#inventory-opening-warehouse").value || "WH-JKT-01");
  syncOpeningLocations(workspace);
  syncSelect("#inventory-adjustment-batch", workspace.batches, "inventory_batch_id", (item) => `${item.product?.sku} · ${item.lot_number} · ${item.warehouse?.name} · layak jual ${item.sellableQuantity}`, "Pilih batch", state.selectedBatchId ?? $("#inventory-adjustment-batch").value);
}

function syncOpeningLocations(workspace) {
  const warehouseId = $("#inventory-opening-warehouse").value;
  const locations = workspace.stockLocations.filter((item) => item.warehouse_id === warehouseId && item.status === "active");
  const currentLocation = $("#inventory-opening-location").value;
  const selectedLocation = locations.some((item) => item.stock_location_id === currentLocation)
    ? currentLocation
    : locations[0]?.stock_location_id ?? "";
  syncSelect("#inventory-opening-location", locations, "stock_location_id", (item) => `${item.name} · ${item.code}`, "Pilih lokasi", selectedLocation);
}

function render() {
  try {
    const workspace = inventory.getWorkspace({ warehouseId: state.warehouseId, productId: state.productId, bucket: state.bucket });
    state.workspace = workspace;
    clearStorageError();
    const presentationSeedNotice = $("#inventory-presentation-seed-notice");
    const notice = workspaceRepository.load().meta?.presentation_sales_seed_notice;
    presentationSeedNotice.textContent = notice?.message ?? "";
    presentationSeedNotice.hidden = !notice?.message;
    const effectiveDate = $("#inventory-effective-date");
    effectiveDate.textContent = formatDate(workspace.effectiveDate);
    effectiveDate.dateTime = workspace.effectiveDate;
    syncWorkspaceSelects(workspace);
    renderSummary(workspace.summary);
    renderBatches(workspace);
    renderMovements(workspace);
  } catch (error) {
    setStorageError(error);
  }
}

function clearFormErrors(form, errorSelector, fieldSelector) {
  const error = $(errorSelector);
  if (error) {
    error.hidden = true;
    error.textContent = "";
  }
  $$(fieldSelector, form).forEach((element) => { element.textContent = ""; });
  $$('input, select, textarea', form).forEach((element) => element.removeAttribute("aria-invalid"));
}

function showFormError(form, errorSelector, fieldSelector, error) {
  const formError = $(errorSelector);
  const fieldErrors = error?.fieldErrors ?? {};
  let firstField = null;
  Object.entries(fieldErrors).forEach(([field, message]) => {
    const node = $(`[${fieldSelector}="${field}"]`, form);
    if (node) node.textContent = message;
    const inputName = field.startsWith("quantity_") ? field.slice("quantity_".length)
      : field === "productId" ? "product_id"
        : field === "warehouseId" ? "warehouse_id"
          : field === "stockLocationId" ? "stock_location_id"
            : field === "lotNumber" ? "lot_number"
              : field === "receivedAt" ? "received_at"
                : field === "expiryDate" ? "expiry_date"
                  : field === "rotationPolicy" ? "rotation_policy"
                    : field === "inventoryBatchId" ? "inventory_batch_id" : field;
    const input = $(`[name="${inputName}"]`, form);
    if (input) {
      input.setAttribute("aria-invalid", "true");
      firstField ??= input;
    }
  });
  if (formError) {
    formError.textContent = error?.message ?? "Perubahan persediaan gagal disimpan.";
    formError.hidden = false;
    (firstField ?? formError).focus();
  }
}

function openDialog(dialog) {
  if (!dialog || dialog.open) return;
  state.returnFocus = document.activeElement;
  render();
  dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function formSignature(form) {
  return JSON.stringify([...form.elements]
    .filter((element) => element.name && !["button", "submit", "reset"].includes(element.type))
    .map((element) => [element.name, element.type, element.type === "checkbox" || element.type === "radio" ? element.checked : element.value]));
}

function captureFormBaseline(form) {
  state.formBaselines.set(form, formSignature(form));
}

function isFormDirty(form) {
  const baseline = state.formBaselines.get(form);
  return baseline !== undefined && baseline !== formSignature(form);
}

function showDiscardConfirmation(dialog) {
  const confirmation = $("#inventory-discard-dialog");
  if (!confirmation || confirmation.open) return;
  state.discardTarget = dialog;
  state.discardReturnFocus = document.activeElement;
  confirmation.showModal();
}

function attemptCloseInventoryDialog(dialog) {
  const form = $("form", dialog);
  if (form && isFormDirty(form)) {
    showDiscardConfirmation(dialog);
    return;
  }
  closeDialog(dialog);
}

function keepEditingInventoryForm() {
  const focusTarget = state.discardReturnFocus;
  state.discardTarget = null;
  state.discardReturnFocus = null;
  closeDialog($("#inventory-discard-dialog"));
  if (focusTarget?.isConnected) requestAnimationFrame(() => focusTarget.focus());
}

function discardInventoryFormChanges() {
  const dialog = state.discardTarget;
  state.discardTarget = null;
  state.discardReturnFocus = null;
  if (dialog) {
    const form = $("form", dialog);
    if (form) state.formBaselines.delete(form);
  }
  closeDialog($("#inventory-discard-dialog"));
  closeDialog(dialog);
}

function updateExpiryRequirement() {
  const productId = $("#inventory-opening-product").value;
  const product = state.workspace?.products.find((item) => item.product_id === productId);
  const rotation = $("#inventory-opening-policy").value;
  const expiry = $("#inventory-opening-expiry");
  const note = $("#inventory-expiry-requirement");
  const noExpiry = product?.expiry_policy === "not_required";
  expiry.disabled = Boolean(noExpiry);
  if (noExpiry) expiry.value = "";
  expiry.required = !noExpiry && (product?.expiry_policy === "required" || rotation === "FEFO");
  note.textContent = noExpiry ? "Tidak berlaku" : expiry.required ? "Wajib untuk produk / FEFO" : "Opsional sesuai produk";
}

function syncAdjustmentMode() {
  const transferMode = $("#inventory-adjustment-mode").value === "transfer";
  const destinationField = $("#inventory-adjustment-destination-field");
  const sourceBucket = $("#inventory-adjustment-bucket");
  const destinationBucket = $("#inventory-adjustment-destination");
  destinationField.hidden = !transferMode;
  destinationBucket.required = transferMode;
  $("#inventory-adjustment-bucket-label").textContent = transferMode ? "Kondisi asal" : "Kondisi stok";
  $("#inventory-adjustment-delta-label").textContent = transferMode ? "Jumlah unit dipindah" : "Perubahan unit";
  $("#inventory-adjustment-delta-hint").textContent = transferMode
    ? "Jumlah yang sama keluar dari kondisi asal dan masuk ke tujuan dalam satu pencatatan."
    : "Gunakan angka positif untuk tambah dan negatif untuk koreksi turun.";
  $("#inventory-adjustment-submit").textContent = transferMode ? "Pindahkan kondisi stok" : "Tambahkan mutasi";
  if (transferMode) {
    [...destinationBucket.options].forEach((option) => { option.disabled = option.value === sourceBucket.value; });
    if (destinationBucket.value === sourceBucket.value) {
      destinationBucket.value = [...destinationBucket.options].find((option) => !option.disabled)?.value ?? "";
    }
  } else {
    [...destinationBucket.options].forEach((option) => { option.disabled = false; });
  }
}

function bindFilters() {
  $("#inventory-warehouse-filter")?.addEventListener("change", (event) => { state.warehouseId = event.currentTarget.value; state.selectedBatchId = null; render(); });
  $("#inventory-product-filter")?.addEventListener("change", (event) => { state.productId = event.currentTarget.value; state.selectedBatchId = null; render(); });
  $("#inventory-bucket-filter")?.addEventListener("change", (event) => { state.bucket = event.currentTarget.value; state.selectedBatchId = null; render(); });
  $("[data-clear-inventory-filters]")?.addEventListener("click", () => {
    state.warehouseId = "all";
    state.productId = "all";
    state.bucket = "all";
    state.selectedBatchId = null;
    render();
    $("#inventory-warehouse-filter")?.focus();
  });
  $("#inventory-batch-table-body")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-select-inventory-batch]");
    if (!button) return;
    state.selectedBatchId = button.dataset.selectInventoryBatch;
    renderMovements(state.workspace);
    $("#inventory-movements-title")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  $("[data-clear-inventory-batch]")?.addEventListener("click", () => {
    state.selectedBatchId = null;
    renderMovements(state.workspace);
  });
}

function bindDialogs() {
  const openingDialog = $("#inventory-opening-dialog");
  const adjustmentDialog = $("#inventory-adjustment-dialog");
  $("[data-open-inventory-opening]")?.addEventListener("click", (event) => {
    state.returnFocus = event.currentTarget;
    $("#inventory-opening-form").reset();
    clearFormErrors($("#inventory-opening-form"), "#inventory-opening-error", "[data-inventory-field-error]");
    openDialog(openingDialog);
    updateExpiryRequirement();
    captureFormBaseline($("#inventory-opening-form"));
  });
  $("[data-open-inventory-adjustment]")?.addEventListener("click", (event) => {
    state.returnFocus = event.currentTarget;
    $("#inventory-adjustment-form").reset();
    clearFormErrors($("#inventory-adjustment-form"), "#inventory-adjustment-error", "[data-inventory-adjustment-error]");
    syncAdjustmentMode();
    openDialog(adjustmentDialog);
    captureFormBaseline($("#inventory-adjustment-form"));
  });
  $$("[data-close-inventory-dialog]").forEach((button) => button.addEventListener("click", () => attemptCloseInventoryDialog(button.closest("dialog"))));
  [openingDialog, adjustmentDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => { if (event.target === dialog) attemptCloseInventoryDialog(dialog); });
    dialog.addEventListener("cancel", (event) => {
      const form = $("form", dialog);
      if (form && isFormDirty(form)) {
        event.preventDefault();
        showDiscardConfirmation(dialog);
      }
    });
    dialog.addEventListener("close", () => {
      const form = $("form", dialog);
      if (form) state.formBaselines.delete(form);
      const focusTarget = state.returnFocus;
      state.returnFocus = null;
      if (focusTarget?.isConnected) requestAnimationFrame(() => focusTarget.focus());
    });
  });
  const discardDialog = $("#inventory-discard-dialog");
  $$('[data-stay-inventory]').forEach((button) => button.addEventListener("click", keepEditingInventoryForm));
  $("[data-discard-inventory]")?.addEventListener("click", discardInventoryFormChanges);
  discardDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    keepEditingInventoryForm();
  });
  discardDialog?.addEventListener("click", (event) => { if (event.target === discardDialog) keepEditingInventoryForm(); });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (discardDialog?.open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      keepEditingInventoryForm();
      return;
    }
    const activeInventoryDialog = [openingDialog, adjustmentDialog].find((dialog) => dialog?.open);
    if (activeInventoryDialog) {
      event.preventDefault();
      event.stopImmediatePropagation();
      attemptCloseInventoryDialog(activeInventoryDialog);
    }
  }, true);
  $("#inventory-opening-warehouse")?.addEventListener("change", () => syncOpeningLocations(state.workspace));
  $("#inventory-opening-product")?.addEventListener("change", updateExpiryRequirement);
  $("#inventory-opening-policy")?.addEventListener("change", updateExpiryRequirement);
  $("#inventory-opening-form")?.addEventListener("submit", submitOpeningStock);
  $("#inventory-adjustment-form")?.addEventListener("submit", submitAdjustment);
  $("#inventory-adjustment-mode")?.addEventListener("change", syncAdjustmentMode);
  $("#inventory-adjustment-bucket")?.addEventListener("change", syncAdjustmentMode);
}

function bindDemoStockProvisioning(authService) {
  const dialog = $("#inventory-demo-provision-dialog");
  const trigger = $("[data-open-demo-provision]");
  const confirmButton = $("#inventory-demo-provision-confirm");
  if (!dialog || !trigger || !confirmButton) return;
  trigger.addEventListener("click", () => {
    const role = authService?.getSession()?.user?.role;
    try {
      state.provisioningPreview = stockProvisioning.preview({ role });
      state.provisioningReturnFocus = trigger;
      const preview = state.provisioningPreview;
      $("#inventory-demo-provision-summary").textContent = preview.alreadyProvisioned
        ? "Provisioning stok demo untuk katalog kanonis sudah lengkap. Tidak ada saldo atau histori yang akan ditulis."
        : "Akan menambahkan " + preview.batchCount + " batch dan opening movement ledger (stok lintas cabang: " + preview.baseBatchCount + ", stok katalog: " + preview.catalogBatchCount + ", cakupan produk per cabang: " + preview.coverageBatchCount + "), total " + numberFormat.format(preview.totalUnits) + " unit pada lima cabang.";
      const branches = $("#inventory-demo-provision-branches");
      branches.replaceChildren();
      preview.branchSummaries.forEach((branch) => {
        const item = document.createElement("li");
        item.textContent = branch.branchName + " · " + branch.productCount + " produk · " + numberFormat.format(preview.alreadyProvisioned ? 0 : branch.units) + " unit demo";
        branches.append(item);
      });
      const effects = $("#inventory-demo-provision-effects");
      effects.replaceChildren();
      preview.effects.forEach((effect) => {
        const item = document.createElement("li");
        item.textContent = effect;
        effects.append(item);
      });
      const error = $("#inventory-demo-provision-error");
      error.hidden = true;
      error.textContent = "";
      confirmButton.disabled = preview.alreadyProvisioned;
      confirmButton.textContent = preview.alreadyProvisioned
        ? "Stok demo sudah tersedia"
        : preview.batchCount ? "Konfirmasi provisioning stok" : "Konfirmasi penanda provisioning";
      dialog.showModal();
      requestAnimationFrame(() => (confirmButton.disabled ? $("[data-close-demo-provision]", dialog) : confirmButton).focus({ preventScroll: true }));
    } catch (error) {
      showToast(error.message || "Pratinjau stok demo gagal dimuat.", "error");
    }
  });

  confirmButton.addEventListener("click", () => {
    const role = authService?.getSession()?.user?.role;
    if (!state.provisioningPreview || role !== "HQ_ADMIN") {
      dialog.close("denied");
      showToast("Sesi Admin Pusat tidak lagi aktif; stok demo tidak berubah.", "error");
      return;
    }
    try {
      const result = stockProvisioning.provision({ role, confirmed: true, expectedPreviewToken: state.provisioningPreview.confirmationToken });
      state.provisioningPreview = null;
      dialog.close("confirmed");
      render();
      showToast(result.alreadyProvisioned
        ? "Stok demo sudah disiapkan; tidak ada mutasi baru."
        : result.addedBatchCount + " batch dan " + numberFormat.format(result.addedUnits) + " unit stok demo ditambahkan melalui ledger.", "success");
    } catch (error) {
      const errorBox = $("#inventory-demo-provision-error");
      errorBox.textContent = error.message || "Provisioning stok demo gagal disimpan.";
      errorBox.hidden = false;
      errorBox.focus();
    }
  });
  $$("[data-close-demo-provision]", dialog).forEach((button) => button.addEventListener("click", () => dialog.close("cancel")));
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close("cancel"); });
  dialog.addEventListener("close", () => {
    state.provisioningPreview = null;
    const focusTarget = state.provisioningReturnFocus;
    state.provisioningReturnFocus = null;
    if (focusTarget?.isConnected) requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  });
}

function bindPresentationSalesProvisioning(authService) {
  const dialog = $("#inventory-presentation-sales-dialog");
  const trigger = $("[data-open-presentation-sales]");
  const confirmButton = $("#inventory-presentation-sales-confirm");
  if (!dialog || !trigger || !confirmButton) return;
  trigger.addEventListener("click", () => {
    const role = authService?.getSession()?.user?.role;
    try {
      state.salesProvisioningPreview = presentationSalesProvisioning.preview({ role });
      state.salesProvisioningReturnFocus = trigger;
      const preview = state.salesProvisioningPreview;
      $("#inventory-presentation-sales-summary").textContent = preview.alreadyProvisioned
        ? "Dataset simulasi sudah lengkap: 100 transaksi completed tersimpan. Tidak ada transaksi, shift, pembayaran, saldo, atau ledger yang akan ditulis ulang."
        : "Akan menambahkan " + numberFormat.format(preview.transactionCount) + " transaksi completed, sekitar " + numberFormat.format(preview.estimatedUnits) + " unit, pada " + preview.branchCount + " cabang dari " + formatDate(preview.dateFrom) + " sampai " + formatDate(preview.dateTo) + ". Akan dibuat " + preview.shiftCount + " shift dan seluruhnya ditutup dengan rekonsiliasi kas seimbang.";
      const branches = $("#inventory-presentation-sales-branches");
      branches.replaceChildren();
      preview.transactionsPerBranch.forEach((branch) => {
        const item = document.createElement("li");
        const record = state.workspace?.branches.find((candidate) => candidate.branch_id === branch.branchId);
        item.textContent = (record?.name ?? branch.branchId) + " · " + numberFormat.format(branch.count) + " transaksi simulasi";
        branches.append(item);
      });
      const effects = $("#inventory-presentation-sales-effects");
      effects.replaceChildren();
      preview.effects.forEach((effect) => {
        const item = document.createElement("li");
        item.textContent = effect;
        effects.append(item);
      });
      const error = $("#inventory-presentation-sales-error");
      error.hidden = true;
      error.textContent = "";
      confirmButton.disabled = preview.alreadyProvisioned;
      confirmButton.textContent = preview.alreadyProvisioned ? "Transaksi simulasi sudah tersedia" : "Konfirmasi transaksi simulasi";
      dialog.showModal();
      requestAnimationFrame(() => (confirmButton.disabled ? $("[data-close-presentation-sales]", dialog) : confirmButton).focus({ preventScroll: true }));
    } catch (error) {
      showToast(error.message || "Pratinjau transaksi presentasi gagal dimuat.", "error");
    }
  });

  confirmButton.addEventListener("click", () => {
    const role = authService?.getSession()?.user?.role;
    const preview = state.salesProvisioningPreview;
    if (!preview || role !== "HQ_ADMIN") {
      dialog.close("denied");
      showToast("Sesi Admin Pusat tidak lagi aktif; repository tidak berubah.", "error");
      return;
    }
    try {
      const result = presentationSalesProvisioning.provision({
        role,
        confirmed: true,
        expectedDateFrom: preview.dateFrom,
        expectedDateTo: preview.dateTo,
        expectedPreviewToken: preview.confirmationToken,
      });
      state.salesProvisioningPreview = null;
      dialog.close("confirmed");
      render();
      showToast(result.alreadyProvisioned
        ? "Dataset transaksi simulasi sudah tersedia; tidak ada duplikasi."
        : result.addedTransactionCount + " transaksi simulasi dan " + result.addedShiftCount + " shift tertutup berhasil disimpan.", "success");
    } catch (error) {
      const errorBox = $("#inventory-presentation-sales-error");
      errorBox.textContent = error.message || "Transaksi presentasi gagal disimpan.";
      errorBox.hidden = false;
      errorBox.focus();
    }
  });
  $$("[data-close-presentation-sales]", dialog).forEach((button) => button.addEventListener("click", () => dialog.close("cancel")));
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close("cancel"); });
  dialog.addEventListener("close", () => {
    state.salesProvisioningPreview = null;
    const focusTarget = state.salesProvisioningReturnFocus;
    state.salesProvisioningReturnFocus = null;
    if (focusTarget?.isConnected) requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  });
}

function submitOpeningStock(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFormErrors(form, "#inventory-opening-error", "[data-inventory-field-error]");
  const data = new FormData(form);
  const receivedDate = String(data.get("received_at") ?? "");
  try {
    const result = inventory.recordOpeningStock({
      productId: data.get("product_id"),
      warehouseId: data.get("warehouse_id"),
      stockLocationId: data.get("stock_location_id"),
      lotNumber: data.get("lot_number"),
      receivedAt: receivedDate ? `${receivedDate}T09:00:00+07:00` : "",
      expiryDate: data.get("expiry_date"),
      rotationPolicy: data.get("rotation_policy"),
      quantities: Object.fromEntries(["AVAILABLE", "QUARANTINE", "DAMAGED", "EXPIRED"].map((bucket) => [bucket, data.get(bucket)])),
      reason: data.get("reason"),
    });
    state.formBaselines.delete(form);
    closeDialog($("#inventory-opening-dialog"));
    state.selectedBatchId = result.batch.inventory_batch_id;
    render();
    showToast(`Stok awal lot ${result.batch.lot_number} berhasil disimpan sebagai ${result.movements.length} mutasi.`, "success");
  } catch (error) {
    showFormError(form, "#inventory-opening-error", "data-inventory-field-error", error);
  }
}

function submitAdjustment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFormErrors(form, "#inventory-adjustment-error", "[data-inventory-adjustment-error]");
  const data = new FormData(form);
  try {
    const isTransfer = data.get("adjustment_mode") === "transfer";
    const result = isTransfer
      ? inventory.transferStock({
        inventoryBatchId: data.get("inventory_batch_id"),
        fromBucket: data.get("bucket"),
        toBucket: data.get("destination_bucket"),
        quantity: data.get("delta"),
        reason: data.get("reason"),
      })
      : inventory.adjustStock({
        inventoryBatchId: data.get("inventory_batch_id"),
        bucket: data.get("bucket"),
        delta: data.get("delta"),
        reason: data.get("reason"),
      });
    state.formBaselines.delete(form);
    closeDialog($("#inventory-adjustment-dialog"));
    state.selectedBatchId = data.get("inventory_batch_id");
    render();
    const message = isTransfer
      ? `${numberFormat.format(Number(data.get("delta")))} unit dipindahkan dari ${bucketLabels[data.get("bucket")]} ke ${bucketLabels[data.get("destination_bucket")]}, total fisik tetap.`
      : `Mutasi stok tersimpan. Saldo ${bucketLabels[data.get("bucket")]} sekarang ${numberFormat.format(result.balance)} unit.`;
    showToast(message, "success");
  } catch (error) {
    showFormError(form, "#inventory-adjustment-error", "data-inventory-adjustment-error", error);
  }
}

function bindSimulator() {
  const form = $("#inventory-simulator-form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const error = $("#inventory-simulation-error");
    const empty = $("#inventory-simulation-empty");
    const result = $("#inventory-simulation-result");
    error.hidden = true;
    empty.hidden = true;
    result.hidden = true;
    try {
      const simulation = inventory.simulateAllocation({
        warehouseId: data.get("warehouse_id"),
        productId: data.get("product_id"),
        quantity: data.get("quantity"),
        effectiveDate: data.get("effective_date"),
      });
      $("#inventory-simulation-summary").textContent = `${simulation.product.name} · ${simulation.requestedQuantity} unit`;
      $("#inventory-simulation-policy").textContent = simulation.rotationPolicy ?? "Tidak ada stok layak jual";
      const list = $("#inventory-simulation-allocations");
      list.replaceChildren();
      simulation.allocations.forEach((allocation) => {
        const item = document.createElement("li");
        item.textContent = `${allocation.lot_number} · ${numberFormat.format(allocation.allocated_quantity)} unit · kedaluwarsa ${formatDate(allocation.expiry_date)} · ${allocation.rotation_policy}`;
        list.append(item);
      });
      result.hidden = false;
    } catch (simulationError) {
      error.textContent = simulationError?.message ?? "Simulasi stok tidak berhasil.";
      error.hidden = false;
      error.focus();
    }
  });
}

export function initializeInventoryPage({ authService = null } = {}) {
  if (!$("#inventory")) return;
  bindFilters();
  bindDialogs();
  bindDemoStockProvisioning(authService);
  bindPresentationSalesProvisioning(authService);
  bindSimulator();
  $("[data-retry-inventory]")?.addEventListener("click", render);
  window.addEventListener("storage", render);
  window.addEventListener("hashchange", () => { if (window.location.hash === "#inventory") render(); });
  $("#inventory-opening-product")?.addEventListener("change", updateExpiryRequirement);
  $("#inventory-opening-policy")?.addEventListener("change", updateExpiryRequirement);
  render();
}

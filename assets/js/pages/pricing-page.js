import { showToast } from "../components.js";
import { DEMO_REFERENCE_DATE } from "../data/demo-seed.js";
import { DEMO_STORAGE_KEY, createLocalStorageRepository } from "../repositories/local-storage-repository.js";
import { PricingService } from "../services/pricing-service.js";

const repository = createLocalStorageRepository();
const pricing = new PricingService({ repository });
const state = {
  search: "",
  regionId: "all",
  categoryId: "all",
  status: "all",
  currentRuleId: null,
  initialFormSnapshot: null,
  dirty: false,
  returnFocusElement: null,
  pendingRoute: null,
  workspace: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const currency = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

function formatIDR(value) {
  return `Rp${currency.format(value)}`;
}

function formatPercent(value) {
  const number = Number(value);
  const sign = number > 0 ? "+" : number < 0 ? "−" : "";
  return `${sign}${String(Math.abs(number)).replace(".", ",")}%`;
}

function formatDate(value) {
  return dateFormatter.format(new Date(`${value}T00:00:00.000Z`));
}

export function initializePricingPage() {
  if (!$("#pricing")) return;
  bindFilters();
  bindRuleDialog();
  bindSimulator();
  bindUnsavedNavigation();
  $("[data-retry-pricing]")?.addEventListener("click", render);
  window.addEventListener("storage", onStorageChange);
  window.addEventListener("beforeunload", onBeforeUnload);
  render();
}

function bindFilters() {
  $("#pricing-search")?.addEventListener("input", (event) => {
    state.search = event.currentTarget.value;
    render();
  });
  $("#pricing-region-filter")?.addEventListener("change", (event) => {
    state.regionId = event.currentTarget.value;
    render();
  });
  $("#pricing-category-filter")?.addEventListener("change", (event) => {
    state.categoryId = event.currentTarget.value;
    render();
  });
  $("#pricing-status-filter")?.addEventListener("change", (event) => {
    state.status = event.currentTarget.value;
    render();
  });
  $("[data-clear-pricing-filters]")?.addEventListener("click", () => {
    state.search = "";
    state.regionId = "all";
    state.categoryId = "all";
    state.status = "all";
    $("#pricing-search").value = "";
    $("#pricing-region-filter").value = "all";
    $("#pricing-category-filter").value = "all";
    $("#pricing-status-filter").value = "all";
    render();
    requestAnimationFrame(() => $("#pricing-search")?.focus());
  });
  $("#pricing-rule-table-body")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-price-rule]");
    if (button) openRuleDialog(button.dataset.editPriceRule, button);
  });
}

function bindRuleDialog() {
  const dialog = $("#pricing-rule-dialog");
  const discardDialog = $("#pricing-discard-dialog");
  const form = $("#pricing-rule-form");
  if (!dialog || !discardDialog || !form) return;

  $("[data-open-pricing-rule]")?.addEventListener("click", (event) => openRuleDialog(null, event.currentTarget));
  $$("[data-close-pricing-rule]").forEach((button) => button.addEventListener("click", requestCloseRuleDialog));
  $$("[data-stay-pricing]").forEach((button) => button.addEventListener("click", () => {
    state.pendingRoute = null;
    discardDialog.close("stay");
  }));
  $("[data-discard-pricing]")?.addEventListener("click", discardRuleChanges);
  form.addEventListener("input", markRuleDirty);
  form.addEventListener("change", markRuleDirty);
  form.addEventListener("submit", onRuleSubmit);
  dialog.addEventListener("cancel", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    requestCloseRuleDialog();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) requestCloseRuleDialog();
  });
  dialog.addEventListener("close", () => {
    const saved = dialog.returnValue === "saved";
    const focusTarget = state.returnFocusElement;
    resetRuleForm();
    state.returnFocusElement = null;
    if (focusTarget?.isConnected) requestAnimationFrame(() => focusTarget.focus());
    if (!saved) state.pendingRoute = null;
  });
  discardDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    state.pendingRoute = null;
    discardDialog.close("stay");
  });
  discardDialog.addEventListener("click", (event) => {
    if (event.target === discardDialog) {
      state.pendingRoute = null;
      discardDialog.close("stay");
    }
  });
}

function bindSimulator() {
  const form = $("#pricing-simulator-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    runSimulation();
  });
  ["#pricing-simulator-product", "#pricing-simulator-branch", "#pricing-simulator-date"].forEach((selector) => {
    $(selector)?.addEventListener("change", clearSimulation);
  });
}

function bindUnsavedNavigation() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || !state.dirty || link.hash === "#pricing") return;
    event.preventDefault();
    state.pendingRoute = link.hash;
    $("#pricing-discard-dialog")?.showModal();
  }, true);
}

function render() {
  try {
    const result = pricing.listRules(state);
    state.workspace = result;
    syncSelect("#pricing-region-filter", result.regions, "region_id", (item) => item.name, "Semua wilayah", "all", state.regionId);
    syncSelect("#pricing-category-filter", result.categories, "category_id", (item) => item.name, "Semua kategori", "all", state.categoryId);
    syncSelect("#pricing-simulator-product", result.products.filter((item) => item.status === "active"), "product_id", (item) => `${item.name} · ${item.sku}`, "Pilih produk aktif", "", $("#pricing-simulator-product").value);
    syncSelect("#pricing-simulator-branch", result.branches.filter((item) => item.status === "active"), "branch_id", (item) => `${item.name} · ${result.regions.find((region) => region.region_id === item.region_id)?.name ?? item.region_id}`, "Pilih cabang", "", $("#pricing-simulator-branch").value);
    renderRuleRows(result.items, result);
    $("#pricing-result-count").textContent = `${result.total} ${result.total === 1 ? "aturan" : "aturan"} ditampilkan`;
    $("#pricing-coverage-title").textContent = `${result.coverage.covered} dari ${result.coverage.total} kombinasi terpetakan`;
    $("#pricing-coverage-detail").textContent = `Aturan aktif pada tanggal demo ${formatDate(result.coverage.referenceDate)}.`;
    $("#pricing-rule-total").textContent = `${result.items.length} aturan`;
    $("#pricing-storage-error").hidden = true;
    $("#pricing-coverage").hidden = false;
    $(".pricing-layout").hidden = false;
    $(".pricing-toolbar").hidden = false;
  } catch (error) {
    $("#pricing-storage-error").hidden = false;
    $("[data-pricing-error-message]").textContent = error.message || "Penyimpanan browser mengalami kendala.";
    $("#pricing-coverage").hidden = true;
    $(".pricing-layout").hidden = true;
  }
}

function syncSelect(selector, records, key, getLabel, firstLabel, firstValue = "", selectedValue = "") {
  const select = $(selector);
  if (!select) return;
  const first = document.createElement("option");
  first.value = firstValue;
  first.textContent = firstLabel;
  const options = records.map((record) => {
    const option = document.createElement("option");
    option.value = record[key];
    option.textContent = getLabel(record);
    return option;
  });
  select.replaceChildren(first, ...options);
  select.value = records.some((record) => record[key] === selectedValue) ? selectedValue : firstValue || records[0]?.[key] || "";
}

function renderRuleRows(rules, workspace) {
  const body = $("#pricing-rule-table-body");
  const fragment = document.createDocumentFragment();
  for (const rule of rules) {
    const region = workspace.regions.find((item) => item.region_id === rule.region_id);
    const category = workspace.categories.find((item) => item.category_id === rule.category_id);
    const row = document.createElement("tr");
    appendCell(row, region?.name ?? rule.region_id, rule.region_id);
    appendCell(row, category?.name ?? rule.category_id, rule.category_id);

    const percentCell = document.createElement("td");
    percentCell.dataset.label = "Penyesuaian";
    const percent = document.createElement("span");
    percent.className = `pricing-percent${rule.adjustment_percent < 0 ? " pricing-percent--negative" : ""}`;
    percent.textContent = formatPercent(rule.adjustment_percent);
    percentCell.append(percent);
    row.append(percentCell);

    const periodCell = document.createElement("td");
    periodCell.dataset.label = "Berlaku";
    periodCell.className = "pricing-period-cell";
    const from = document.createElement("strong");
    from.textContent = formatDate(rule.valid_from);
    const until = document.createElement("span");
    until.textContent = rule.valid_until ? `s.d. ${formatDate(rule.valid_until)}` : "Tanpa batas akhir";
    periodCell.append(from, until);
    row.append(periodCell);

    const statusCell = document.createElement("td");
    statusCell.dataset.label = "Status / versi";
    const badge = document.createElement("span");
    badge.className = `badge ${rule.status === "active" ? "badge--success" : "badge--neutral"}`;
    badge.textContent = rule.status === "active" ? "Aktif" : "Nonaktif";
    const version = document.createElement("span");
    version.className = "pricing-version";
    version.textContent = `v${rule.version}`;
    statusCell.append(badge, version);
    row.append(statusCell);

    const actionCell = document.createElement("td");
    actionCell.dataset.label = "Aksi";
    actionCell.className = "pricing-action-cell";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "button button--quiet pricing-edit-button";
    edit.dataset.editPriceRule = rule.price_rule_id;
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", `Edit aturan ${region?.name ?? rule.region_id}, ${category?.name ?? rule.category_id}`);
    actionCell.append(edit);
    row.append(actionCell);
    fragment.append(row);
  }
  body.replaceChildren(fragment);
  const empty = rules.length === 0;
  $("#pricing-empty-state").hidden = !empty;
  $(".pricing-table").hidden = empty;
}

function appendCell(row, value, code) {
  const cell = document.createElement("td");
  const label = document.createElement("strong");
  label.textContent = value;
  const detail = document.createElement("span");
  detail.className = "pricing-code";
  detail.textContent = code;
  cell.append(label, detail);
  row.append(cell);
}

function openRuleDialog(ruleId = null, trigger = null) {
  try {
    const workspace = pricing.listRules();
    const dialog = $("#pricing-rule-dialog");
    const form = $("#pricing-rule-form");
    const rule = ruleId ? workspace.items.find((item) => item.price_rule_id === ruleId) ?? repository.load().pricingRules.find((item) => item.price_rule_id === ruleId) : null;
    if (ruleId && !rule) throw new Error("Aturan harga tidak ditemukan.");
    state.returnFocusElement = trigger ?? document.activeElement;
    state.currentRuleId = rule?.price_rule_id ?? null;
    form.reset();
    clearRuleErrors();
    syncSelect("#pricing-rule-region", workspace.regions, "region_id", (item) => item.name, "Pilih wilayah", "", rule?.region_id ?? "");
    syncSelect("#pricing-rule-category", workspace.categories, "category_id", (item) => item.name, "Pilih kategori", "", rule?.category_id ?? "");
    $("#pricing-rule-dialog-title").textContent = rule ? "Edit aturan regional" : "Tambah aturan regional";
    $("#pricing-rule-dialog-description").textContent = rule
      ? `Perbarui aturan ${rule.price_rule_id}. Versi berikutnya bertambah otomatis jika ada perubahan.`
      : "Tentukan wilayah, kategori, persentase, status, dan tanggal efektif yang tidak bertumpang tindih.";
    $("#pricing-rule-save-button").textContent = rule ? "Simpan perubahan" : "Simpan aturan";
    dialog.returnValue = "";
    if (rule) {
      form.elements.region_id.value = rule.region_id;
      form.elements.category_id.value = rule.category_id;
      form.elements.adjustment_percent.value = String(rule.adjustment_percent);
      form.elements.valid_from.value = rule.valid_from;
      form.elements.valid_until.value = rule.valid_until ?? "";
      form.elements.status.value = rule.status;
    } else {
      form.elements.region_id.value = "";
      form.elements.category_id.value = "";
      form.elements.status.value = "active";
    }
    state.dirty = false;
    state.initialFormSnapshot = captureRuleForm();
    dialog.showModal();
    requestAnimationFrame(() => $("#pricing-rule-region").focus());
  } catch (error) {
    showToast(error.message || "Form aturan harga tidak dapat dibuka.", "error");
  }
}

function requestCloseRuleDialog() {
  const dialog = $("#pricing-rule-dialog");
  if (state.dirty) {
    $("#pricing-discard-dialog").showModal();
    return;
  }
  dialog.close("cancel");
}

function discardRuleChanges() {
  const pendingRoute = state.pendingRoute;
  state.pendingRoute = null;
  $("#pricing-discard-dialog").close("discard");
  state.dirty = false;
  $("#pricing-rule-dialog").close("discard");
  if (pendingRoute) window.location.hash = pendingRoute;
}

function resetRuleForm() {
  $("#pricing-rule-form")?.reset();
  state.currentRuleId = null;
  state.initialFormSnapshot = null;
  state.dirty = false;
  clearRuleErrors();
}

function markRuleDirty() {
  state.dirty = state.initialFormSnapshot !== captureRuleForm();
  clearRuleErrors();
}

function captureRuleForm() {
  const form = $("#pricing-rule-form");
  if (!form) return null;
  const values = Object.fromEntries(new FormData(form).entries());
  const rawAdjustment = String(values.adjustment_percent ?? "").trim();
  const adjustment = rawAdjustment !== "" && Number.isFinite(Number(rawAdjustment)) ? String(Number(rawAdjustment)) : rawAdjustment;
  return JSON.stringify([
    values.region_id ?? "",
    values.category_id ?? "",
    adjustment,
    values.valid_from ?? "",
    values.valid_until ?? "",
    values.status ?? "",
  ]);
}

function clearRuleErrors() {
  $$(".field-error", $("#pricing-rule-form")).forEach((element) => { element.textContent = ""; });
  $$("#pricing-rule-form [aria-invalid='true']").forEach((element) => element.removeAttribute("aria-invalid"));
  const summary = $("#pricing-form-error");
  if (summary) {
    summary.hidden = true;
    summary.textContent = "";
  }
}

function onRuleSubmit(event) {
  event.preventDefault();
  clearRuleErrors();
  const input = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const rule = state.currentRuleId
      ? pricing.updateRule(state.currentRuleId, input)
      : pricing.createRule(input);
    const wasEditing = Boolean(state.currentRuleId);
    state.dirty = false;
    $("#pricing-rule-dialog").close("saved");
    render();
    clearSimulation();
    showToast(`Aturan ${rule.price_rule_id} berhasil ${wasEditing ? "diperbarui" : "ditambahkan"}.`, "success");
  } catch (error) {
    const fieldErrors = { ...(error.fieldErrors ?? {}) };
    if (error.code === "PRICE_RULE_UNSAFE") fieldErrors.adjustment_percent = error.message;
    for (const [field, message] of Object.entries(fieldErrors)) {
      const control = $(`#pricing-rule-form [name="${field}"]`);
      const errorMessage = $(`#pricing-error-${field}`);
      control?.setAttribute("aria-invalid", "true");
      if (errorMessage) errorMessage.textContent = message;
    }
    const summary = $("#pricing-form-error");
    summary.textContent = error.code === "PRICE_RULE_MISSING"
      ? `${error.message} Cakupan aktif pada tanggal demo harus tetap lengkap untuk delapan kombinasi.`
      : error.message || "Aturan gagal disimpan.";
    summary.hidden = false;
    summary.focus();
  }
}

function runSimulation() {
  const form = $("#pricing-simulator-form");
  const errorElement = $("#pricing-simulation-error");
  errorElement.hidden = true;
  errorElement.textContent = "";
  try {
    const quote = pricing.resolvePrice({
      productId: form.elements.product_id.value,
      branchId: form.elements.branch_id.value,
      effectiveDate: form.elements.effective_date.value,
    });
    const category = state.workspace.categories.find((item) => item.category_id === quote.product.category_id);
    const branch = state.workspace.branches.find((item) => item.branch_id === quote.branch.branch_id);
    $("#pricing-quote-product").textContent = `${quote.product.name} · ${quote.product.sku}`;
    $("#pricing-quote-branch").textContent = `${branch?.name ?? quote.branch.name} · ${quote.region.name}`;
    $("#pricing-quote-category").textContent = category?.name ?? quote.product.category_id;
    $("#pricing-quote-base").textContent = formatIDR(quote.basePriceIdr);
    $("#pricing-quote-adjustment").textContent = formatPercent(quote.adjustmentPercent);
    $("#pricing-quote-rule").textContent = `${quote.rule.price_rule_id} · v${quote.rule.version}`;
    $("#pricing-quote-period").textContent = `${formatDate(quote.rule.valid_from)} – ${quote.rule.valid_until ? formatDate(quote.rule.valid_until) : "Tanpa batas akhir"}`;
    $("#pricing-quote-total").textContent = formatIDR(quote.regularPriceIdr);
    $("#pricing-quote").hidden = false;
    $("#pricing-simulation-empty").hidden = true;
  } catch (error) {
    $("#pricing-quote").hidden = true;
    $("#pricing-simulation-empty").hidden = false;
    errorElement.textContent = error.code === "PRICE_RULE_MISSING"
      ? `${error.message} Harga dasar tidak digunakan sebagai fallback.`
      : error.message || "Simulasi harga gagal dihitung.";
    errorElement.hidden = false;
  }
}

function clearSimulation() {
  $("#pricing-quote").hidden = true;
  $("#pricing-simulation-empty").hidden = false;
  $("#pricing-simulation-error").hidden = true;
  $("#pricing-simulation-error").textContent = "";
}

function onStorageChange(event) {
  if (event.key === DEMO_STORAGE_KEY || event.key === null) {
    render();
    clearSimulation();
  }
}

function onBeforeUnload(event) {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
}

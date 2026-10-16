import { showToast } from "../components.js";
import { createLocalStorageRepository, DEMO_STORAGE_KEY } from "../repositories/local-storage-repository.js";
import { ProductService, ProductValidationError } from "../services/product-service.js";

const repository = createLocalStorageRepository();
const products = new ProductService({ repository });
const state = {
  search: "",
  categoryId: "all",
  status: "all",
  sortBy: "name",
  direction: "asc",
  page: 1,
  pageSize: 5,
  dirty: false,
  initialFormSnapshot: null,
  currentProductId: null,
  pendingAction: null,
  pendingDiscard: null,
  imageService: null,
  authService: null,
  imageDraft: null,
  imageDeletePending: false,
  hasStoredImage: false,
  imagePreviewUrl: null,
  imageRequest: 0,
  saving: false,
  categories: [],
  units: [],
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const currency = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const expiryNames = { required: "Wajib dicatat", optional: "Opsional", not_required: "Tidak berlaku" };

export function initializeProductsPage({ productImageService = null, authService = null } = {}) {
  const page = $("#products");
  if (!page) return;

  state.imageService = productImageService;
  state.authService = authService;

  bindRoutes();
  bindFilters();
  bindTableActions();
  bindProductDialog();
  bindConfirmationDialog();
  bindResetAndRetry();
  document.addEventListener("app:authchange", syncProductImagePermissions);
  window.addEventListener("storage", onStorageChange);
  window.addEventListener("beforeunload", onBeforeUnload);
  render();
}

function bindRoutes() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || !state.dirty || link.hash === "#products") return;
    event.preventDefault();
    requestDiscard(() => { window.location.hash = link.hash; });
  }, true);
}

function bindFilters() {
  $("#product-search")?.addEventListener("input", (event) => {
    state.search = event.currentTarget.value;
    state.page = 1;
    render();
  });
  $("#product-category-filter")?.addEventListener("change", (event) => {
    state.categoryId = event.currentTarget.value;
    state.page = 1;
    render();
  });
  $("#product-status-filter")?.addEventListener("change", (event) => {
    state.status = event.currentTarget.value;
    state.page = 1;
    render();
  });
  $("#product-page-size")?.addEventListener("change", (event) => {
    state.pageSize = Number(event.currentTarget.value);
    state.page = 1;
    render();
  });
  $$("[data-product-sort]").forEach((button) => button.addEventListener("click", () => {
    const nextSort = button.dataset.productSort;
    state.direction = state.sortBy === nextSort && state.direction === "asc" ? "desc" : "asc";
    state.sortBy = nextSort;
    state.page = 1;
    render();
  }));
  $$("[data-product-page]").forEach((button) => button.addEventListener("click", () => {
    state.page += button.dataset.productPage === "next" ? 1 : -1;
    render();
  }));
  $("[data-clear-product-filters]")?.addEventListener("click", () => {
    if (!$("#product-table-body").children.length && !state.search && state.categoryId === "all" && state.status === "all") {
      openProductForm();
      return;
    }
    state.search = "";
    state.categoryId = "all";
    state.status = "all";
    state.page = 1;
    $("#product-search").value = "";
    $("#product-category-filter").value = "all";
    $("#product-status-filter").value = "all";
    render();
    requestAnimationFrame(() => $("#product-search")?.focus());
  });
}

function bindTableActions() {
  $("#product-table-body")?.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-product]");
    if (editButton) {
      openProductForm(editButton.dataset.editProduct);
      return;
    }
    const statusButton = event.target.closest("[data-toggle-product-status]");
    if (!statusButton) return;
    const product = readProduct(statusButton.dataset.toggleProductStatus);
    if (!product) return;
    const nextActive = product.status !== "active";
    const action = nextActive ? "mengaktifkan" : "menonaktifkan";
    openConfirmation({
      title: `${nextActive ? "Aktifkan" : "Nonaktifkan"} produk?`,
      description: `Anda akan ${action} “${product.name}”. Data produk tetap tersimpan; aksi ini tidak mengubah atau menghapus histori.`,
      confirmLabel: nextActive ? "Aktifkan produk" : "Nonaktifkan produk",
      destructive: !nextActive,
      run: () => {
        products.setActive(product.product_id, nextActive);
        render();
        showToast(`${product.name} berhasil ${nextActive ? "diaktifkan" : "dinonaktifkan"}.`, "success");
        requestAnimationFrame(() => {
          const nextAction = $(`[data-toggle-product-status="${CSS.escape(product.product_id)}"]`);
          (nextAction || $("#product-search"))?.focus();
        });
      },
    });
  });
}

function bindProductDialog() {
  const dialog = $("#product-dialog");
  const form = $("#product-form");
  if (!dialog || !form) return;

  $("[data-open-product-form]")?.addEventListener("click", () => openProductForm());
  $$("[data-close-product-form]").forEach((button) => button.addEventListener("click", closeProductForm));
  form.addEventListener("input", markDirty);
  form.addEventListener("change", markDirty);
  $("#product-category")?.addEventListener("change", (event) => {
    void showProductImage(state.currentProductId, event.currentTarget.value || null);
  });
  $("#product-image-file")?.addEventListener("change", onProductImageSelected);
  $("#product-image-remove")?.addEventListener("click", stageProductImageRemoval);
  form.addEventListener("submit", (event) => { void onProductSubmit(event); });
  dialog.addEventListener("cancel", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    requestDiscard();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeProductForm();
  });
  dialog.addEventListener("close", () => {
    const result = dialog.returnValue;
    if (result !== "saved" && result !== "suspend") resetProductForm();
  });
}

function bindConfirmationDialog() {
  const dialog = $("#action-confirm-dialog");
  dialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dialog.close("cancel");
  });
  $("[data-confirm-action]")?.addEventListener("click", () => {
    const action = state.pendingAction;
    state.pendingAction = null;
    dialog.close("confirm");
    if (!action) return;
    try {
      action.run();
    } catch (error) {
      showToast(error.message || "Perubahan gagal disimpan.", "error");
      render();
    }
  });
  $$("[data-cancel-action]").forEach((button) => button.addEventListener("click", () => dialog.close("cancel")));
  dialog?.addEventListener("close", () => {
    state.pendingAction = null;
    const pendingDiscard = state.pendingDiscard;
    if (!pendingDiscard) return;
    state.pendingDiscard = null;
    if (!pendingDiscard.reopen) return;
    const productDialog = $("#product-dialog");
    productDialog.showModal();
    requestAnimationFrame(() => {
      const restoreFocus = pendingDiscard.restoreFocus;
      if (restoreFocus?.isConnected && productDialog.contains(restoreFocus)) restoreFocus.focus();
      else $("#product-name")?.focus();
    });
  });
}

function bindResetAndRetry() {
  $("[data-open-reset]")?.addEventListener("click", () => openConfirmation({
    title: "Reset seluruh data demo?",
    description: "Reset akan mengganti perubahan katalog lokal dengan seed kanonis: 5 wilayah, 5 cabang, 10 kategori, dan 60 produk. Tindakan ini tidak dapat dibatalkan.",
    confirmLabel: "Reset data demo",
    destructive: true,
    run: () => {
      repository.reset();
      state.search = "";
      state.categoryId = "all";
      state.status = "all";
      state.sortBy = "name";
      state.direction = "asc";
      state.page = 1;
      $("#product-search").value = "";
      $("#product-category-filter").value = "all";
      $("#product-status-filter").value = "all";
      $("#product-page-size").value = "5";
      state.pageSize = 5;
      render();
      showToast("Data demo dikembalikan ke seed kanonis.", "success");
    },
  }));
  $("[data-retry-products]")?.addEventListener("click", render);
}

function openConfirmation({ title, description, confirmLabel, cancelLabel = "Batal", destructive, focusCancel = true, run }) {
  const dialog = $("#action-confirm-dialog");
  $("#action-dialog-title").textContent = title;
  $("#action-dialog-description").textContent = description;
  const confirmButton = $("[data-confirm-action]");
  confirmButton.textContent = confirmLabel;
  confirmButton.classList.toggle("button--danger", Boolean(destructive));
  $("#action-confirm-dialog .modal__footer [data-cancel-action]").textContent = cancelLabel;
  state.pendingAction = { run };
  dialog.showModal();
  requestAnimationFrame(() => {
    const initialFocus = focusCancel
      ? $(".modal__footer [data-cancel-action]", dialog)
      : $("[data-confirm-action]", dialog);
    initialFocus?.focus();
  });
}

function requestDiscard(afterDiscard = () => {}) {
  const confirmationDialog = $("#action-confirm-dialog");
  if (confirmationDialog.open) return;
  const productDialog = $("#product-dialog");
  const reopen = productDialog.open;
  const restoreFocus = document.activeElement;
  state.pendingDiscard = { reopen, restoreFocus };
  if (reopen) productDialog.close("suspend");
  openConfirmation({
    title: "Perubahan belum disimpan",
    description: "Data produk atau gambar memiliki perubahan yang belum disimpan. Pilih Tetap Mengedit untuk melanjutkan, atau Buang Perubahan untuk membatalkan semuanya.",
    confirmLabel: "Buang Perubahan",
    cancelLabel: "Tetap Mengedit",
    destructive: true,
    focusCancel: true,
    run: () => {
      state.pendingDiscard = null;
      discardProductForm();
      afterDiscard();
    },
  });
}

function openProductForm(productId = null) {
  try {
    const data = products.list({ page: 1, pageSize: 50 });
    state.categories = data.categories;
    state.units = data.units;
    populateSelect("#product-category", data.categories, "category_id", "name");
    populateSelect("#product-unit", data.units, "unit_id", "name");
    const product = productId ? data.items.find((item) => item.product_id === productId) ?? repository.load().products.find((item) => item.product_id === productId) : null;
    if (productId && !product) throw new Error("Produk tidak ditemukan.");
    state.currentProductId = product?.product_id ?? null;
    clearImageDraft();
    state.hasStoredImage = false;
    const form = $("#product-form");
    form.reset();
    clearFieldErrors();
    $("#product-form-error").hidden = true;
    $("#product-dialog-title").textContent = product ? "Edit produk" : "Tambah produk";
    $("#product-dialog-description").textContent = product
      ? "Perbarui identitas dan harga dasar. Histori produk dan data stok tidak diubah dari formulir ini."
      : "Isi identitas dan harga dasar produk. Data stok dikelola terpisah dan tidak dapat diedit dari formulir ini.";
    $("#product-save-button").textContent = product ? "Simpan perubahan" : "Simpan produk";
    if (product) {
      form.elements.name.value = product.name;
      form.elements.sku.value = product.sku;
      form.elements.barcode.value = product.barcode ?? "";
      form.elements.category_id.value = product.category_id;
      form.elements.unit_id.value = product.unit_id;
      form.elements.base_price_idr.value = String(product.base_price_idr);
      form.elements.expiry_policy.value = product.expiry_policy;
    }
    const canManageImages = isAdmin();
    $("#product-image-controls").hidden = !canManageImages;
    $("#product-image-readonly").hidden = canManageImages;
    $("#product-image-file").disabled = !canManageImages;
    $("#product-image-remove").hidden = true;
    $("#product-image-status").textContent = "";
    setImageError("");
    showProductImage(product?.product_id ?? null, product?.category_id ?? form.elements.category_id.value);
    state.dirty = false;
    state.initialFormSnapshot = captureFormSnapshot(form);
    $("#product-dialog").showModal();
    requestAnimationFrame(() => $("#product-name").focus());
  } catch (error) {
    showPageError(error);
  }
}

function closeProductForm() {
  if (state.dirty) {
    requestDiscard();
    return;
  }
  state.dirty = false;
  $("#product-dialog").close("discard");
}

function discardProductForm() {
  state.dirty = false;
  const dialog = $("#product-dialog");
  if (dialog.open) dialog.close("discard");
  else resetProductForm();
}

function resetProductForm() {
  $("#product-form")?.reset();
  clearFieldErrors();
  const error = $("#product-form-error");
  error.hidden = true;
  error.textContent = "";
  state.currentProductId = null;
  state.dirty = false;
  state.initialFormSnapshot = null;
  state.imageDraft = null;
  state.imageDeletePending = false;
  state.hasStoredImage = false;
  state.saving = false;
  revokeImagePreview();
  state.imageRequest += 1;
}

function isAdmin() {
  return state.authService?.getSession?.()?.user?.role === "HQ_ADMIN";
}

function syncProductImagePermissions() {
  const admin = isAdmin();
  const controls = $("#product-image-controls");
  const readonly = $("#product-image-readonly");
  const input = $("#product-image-file");
  if (controls) controls.hidden = !admin;
  if (readonly) readonly.hidden = admin;
  if (input) input.disabled = !admin;
  if (!admin && $("#product-dialog")?.open) {
    $("#product-dialog").close("discard");
    resetProductForm();
  }
}

function revokeImagePreview() {
  if (!state.imagePreviewUrl) return;
  try { URL.revokeObjectURL(state.imagePreviewUrl); } catch { /* Preview cleanup is best effort. */ }
  state.imagePreviewUrl = null;
}

function clearImageDraft() {
  state.imageDraft = null;
  state.imageDeletePending = false;
  revokeImagePreview();
  const input = $("#product-image-file");
  if (input) input.value = "";
}

function setImageError(message) {
  const error = $("#product-image-error");
  error.textContent = message || "";
  error.hidden = !message;
}

function applyProductImage(display) {
  const image = $("#product-image-preview");
  const caption = $("#product-image-caption");
  if (!image || !display) return;
  image.onerror = () => {
    if (display.source !== "uploaded") return;
    const fallback = state.imageService?.invalidateDisplay(state.currentProductId, $("#product-category")?.value) ?? { src: "assets/images/products/placeholder.svg", caption: "Ilustrasi demo · bukan foto produk" };
    state.hasStoredImage = true;
    image.classList.remove("product-image-preview--uploaded");
    image.onerror = null;
    image.src = fallback.src;
    caption.textContent = "Ilustrasi demo · gambar tersimpan tidak dapat dibaca";
    $("#product-image-remove").hidden = false;
    setImageError("Gambar tersimpan tidak dapat ditampilkan. Anda dapat menggantinya atau menghapusnya.");
  };
  image.alt = display.source === "uploaded" ? "Preview gambar produk" : "Ilustrasi demo untuk gambar produk";
  image.classList.toggle("product-image-preview--uploaded", display.source === "uploaded");
  image.src = display.src;
  caption.textContent = display.caption;
  if (display.stored !== undefined) state.hasStoredImage = Boolean(display.stored);
  const remove = $("#product-image-remove");
  remove.hidden = !isAdmin() || (!state.hasStoredImage && !state.imageDraft);
  remove.textContent = state.imageDeletePending ? "Batalkan penghapusan" : "Hapus gambar";
}

async function showProductImage(productId, categoryId = null) {
  const request = ++state.imageRequest;
  state.hasStoredImage = false;
  applyProductImage(state.imageService?.fallback(productId, categoryId) ?? {
    src: "assets/images/products/placeholder.svg",
    source: "placeholder",
    caption: "Ilustrasi demo · bukan foto produk",
    stored: false,
  });
  if (!productId || !state.imageService) return;
  const display = await state.imageService.getDisplayImage(productId, categoryId);
  if (request !== state.imageRequest || state.currentProductId !== productId || !$("#product-dialog")?.open) return;
  applyProductImage(display);
  if (display.corrupt) setImageError("Gambar tersimpan tidak dapat dibaca. Anda dapat menggantinya atau menghapusnya.");
}

async function onProductImageSelected(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  if (!isAdmin() || !state.imageService) {
    input.value = "";
    setImageError("Aksi gambar hanya tersedia untuk Admin Pusat.");
    return;
  }
  setImageError("");
  const request = ++state.imageRequest;
  try {
    const prepared = await state.imageService.prepareUpload(file);
    if (request !== state.imageRequest || !$("#product-dialog")?.open) return;
    const previewUrl = URL.createObjectURL(prepared.blob);
    revokeImagePreview();
    state.imagePreviewUrl = previewUrl;
    state.imageDraft = prepared;
    state.imageDeletePending = false;
    applyProductImage({ src: previewUrl, source: "uploaded", caption: "Preview · belum disimpan" });
    $("#product-image-status").textContent = `Preview siap · ${Math.ceil(prepared.processed_size_bytes / 1024)} KB setelah pemrosesan`;
    markDirty();
  } catch (error) {
    input.value = "";
    setImageError(error.message || "Gambar gagal diproses.");
    $("#product-image-error").focus();
  }
}

function stageProductImageRemoval() {
  if (!isAdmin()) {
    setImageError("Aksi gambar hanya tersedia untuk Admin Pusat.");
    return;
  }
  if (state.imageDeletePending) {
    state.imageDeletePending = false;
    $("#product-image-status").textContent = "Penghapusan gambar dibatalkan.";
    void showProductImage(state.currentProductId);
    markDirty();
    return;
  }
  if (state.imageDraft) {
    clearImageDraft();
    if (state.hasStoredImage) void showProductImage(state.currentProductId);
    else applyProductImage(state.imageService.fallback(state.currentProductId, $("#product-category")?.value));
    $("#product-image-status").textContent = "Upload yang belum disimpan dibatalkan.";
    markDirty();
    return;
  }
  if (!state.hasStoredImage) return;
  state.imageDeletePending = true;
  applyProductImage(state.imageService.fallback(state.currentProductId, $("#product-category")?.value));
  $("#product-image-caption").textContent = "Ilustrasi demo · gambar dihapus saat disimpan";
  $("#product-image-status").textContent = "Penghapusan diterapkan saat produk disimpan.";
  markDirty();
}

function markDirty() {
  state.dirty = state.initialFormSnapshot !== captureFormSnapshot() || Boolean(state.imageDraft) || state.imageDeletePending;
  clearFieldErrors();
  const error = $("#product-form-error");
  error.hidden = true;
  error.textContent = "";
}

function captureFormSnapshot(form = $("#product-form")) {
  if (!form) return null;
  const values = Object.fromEntries(new FormData(form).entries());
  const rawPrice = String(values.base_price_idr ?? "").trim();
  const normalizedPrice = /^\d+$/.test(rawPrice) && Number.isSafeInteger(Number(rawPrice))
    ? String(Number(rawPrice))
    : rawPrice;
  return JSON.stringify([
    String(values.name ?? "").trim(),
    String(values.sku ?? "").trim().toLocaleLowerCase("id-ID"),
    String(values.barcode ?? "").trim(),
    String(values.category_id ?? ""),
    String(values.unit_id ?? ""),
    normalizedPrice,
    String(values.expiry_policy ?? ""),
  ]);
}

function clearFieldErrors() {
  $$(".field-error", $("#product-form")).forEach((element) => { element.textContent = ""; });
  $$("#product-form [aria-invalid='true']").forEach((element) => element.removeAttribute("aria-invalid"));
}

async function onProductSubmit(event) {
  event.preventDefault();
  if (state.saving) return;
  const fieldsChanged = state.initialFormSnapshot !== captureFormSnapshot();
  const imageChanged = Boolean(state.imageDraft) || state.imageDeletePending;
  if (state.currentProductId && !fieldsChanged && !imageChanged) {
    $("#product-dialog").close("unchanged");
    return;
  }
  clearFieldErrors();
  setImageError("");
  const formData = new FormData(event.currentTarget);
  const input = Object.fromEntries(formData.entries());
  const isEditing = Boolean(state.currentProductId);
  if (imageChanged && !isAdmin()) {
    setImageError("Aksi gambar hanya tersedia untuk Admin Pusat.");
    $("#product-image-error").focus();
    return;
  }
  state.saving = true;
  const saveButton = $("#product-save-button");
  saveButton.disabled = true;
  saveButton.textContent = "Menyimpan…";
  let record;
  let productChanged = !isEditing;
  try {
    if (!isEditing || fieldsChanged) {
      record = isEditing
        ? products.update(state.currentProductId, input)
        : products.create(input);
      state.currentProductId = record.product_id;
      state.initialFormSnapshot = captureFormSnapshot();
      productChanged = true;
      state.page = 1;
      render();
    } else {
      record = readProduct(state.currentProductId);
    }

    if (state.imageDraft) {
      await state.imageService.save(record.product_id, state.imageDraft);
      state.hasStoredImage = true;
      state.imageDraft = null;
      revokeImagePreview();
    } else if (state.imageDeletePending) {
      await state.imageService.remove(record.product_id);
      state.hasStoredImage = false;
      state.imageDeletePending = false;
    }

    state.dirty = false;
    $("#product-dialog").close("saved");
    render();
    showToast(imageChanged
      ? (productChanged ? `Produk ${record.name} dan gambar produk berhasil disimpan.` : "Gambar produk berhasil disimpan.")
      : `Produk ${record.name} berhasil ${isEditing ? "diperbarui" : "ditambahkan"}.`, "success");
    requestAnimationFrame(() => $(`[data-edit-product="${CSS.escape(record.product_id)}"]`)?.focus());
  } catch (error) {
    if (error instanceof ProductValidationError) {
      for (const [field, message] of Object.entries(error.fieldErrors)) {
        const control = $(`#product-form [name="${field}"]`);
        const fieldMessage = $(`#error-${field}`);
        control?.setAttribute("aria-invalid", "true");
        if (fieldMessage) fieldMessage.textContent = message;
      }
      const firstInvalid = $("#product-form [aria-invalid='true']");
      firstInvalid?.focus();
      $("#product-form-error").textContent = "Ada kolom yang perlu diperbaiki. Periksa pesan di bawah setiap kolom.";
      $("#product-form-error").hidden = false;
      return;
    }
    if (imageChanged && state.currentProductId && record) {
      state.initialFormSnapshot = captureFormSnapshot();
      state.dirty = Boolean(state.imageDraft) || state.imageDeletePending;
      setImageError(`${error.message || "Gambar gagal disimpan."} ${productChanged ? "Data produk sudah tersimpan; coba ulangi aksi gambar." : "Data produk tetap tidak berubah."}`);
      $("#product-image-error").focus();
      render();
      return;
    }
    $("#product-form-error").textContent = error.message || "Produk gagal disimpan.";
    $("#product-form-error").hidden = false;
    $("#product-form-error").focus();
  } finally {
    state.saving = false;
    saveButton.disabled = false;
    saveButton.textContent = state.currentProductId ? "Simpan perubahan" : "Simpan produk";
  }
}

function populateSelect(selector, records, valueKey, labelKey) {
  const select = $(selector);
  const initial = select.firstElementChild.cloneNode(true);
  select.replaceChildren(initial);
  for (const record of records) {
    const option = document.createElement("option");
    option.value = record[valueKey];
    option.textContent = record[labelKey];
    select.append(option);
  }
}

function render() {
  try {
    const result = products.list(state);
    state.categories = result.categories;
    state.units = result.units;
    syncCategoryFilter(result.categories);
    const categoryNames = new Map(result.categories.map((category) => [category.category_id, category.name]));
    const unitNames = new Map(result.units.map((unit) => [unit.unit_id, unit.name]));
    renderRows(result.items, categoryNames, unitNames);
    renderPagination(result);
    $("#product-result-count").textContent = `${result.total} ${result.total === 1 ? "produk" : "produk"} ditemukan`;
    const empty = result.total === 0;
    $("#product-empty-state").hidden = !empty;
    $(".product-table").hidden = empty;
    if (empty && !result.total && !state.search && state.categoryId === "all" && state.status === "all") {
      $("[data-empty-title]").textContent = "Belum ada produk";
      $("[data-empty-description]").textContent = "Tambahkan produk demo untuk mengisi katalog. Tidak ada stok yang dibuat dari halaman ini.";
      $("[data-clear-product-filters]").textContent = "Tambah produk";
    } else {
      $("[data-empty-title]").textContent = "Tidak ada produk yang cocok";
      $("[data-empty-description]").textContent = "Coba ubah kata pencarian atau filter, atau tambahkan produk demo.";
      $("[data-clear-product-filters]").textContent = "Hapus filter";
    }
    updateSortIndicators();
    $("#products-storage-error").hidden = true;
    $(".product-toolbar").hidden = false;
    $(".product-list-card").hidden = false;
  } catch (error) {
    showPageError(error);
  }
}

function renderRows(items, categoryNames, unitNames) {
  const body = $("#product-table-body");
  const fragment = document.createDocumentFragment();
  for (const product of items) {
    const row = document.createElement("tr");
    const productCell = document.createElement("td");
    productCell.dataset.label = "Produk";
    productCell.className = "product-cell";
    const imageFigure = document.createElement("figure");
    imageFigure.className = "product-thumbnail";
    const image = document.createElement("img");
    image.className = "product-thumbnail__image";
    image.width = 64;
    image.height = 64;
    image.loading = "lazy";
    image.decoding = "async";
    image.alt = `${product.name} · ilustrasi demo`;
    image.src = state.imageService?.fallback(product.product_id, product.category_id).src ?? "assets/images/products/placeholder.svg";
    const caption = document.createElement("figcaption");
    caption.textContent = "Ilustrasi";
    imageFigure.append(image, caption);
    const productName = document.createElement("strong");
    productName.textContent = product.name;
    const productInfo = document.createElement("div");
    productInfo.className = "product-cell__info";
    productInfo.append(productName);
    productCell.append(imageFigure, productInfo);
    loadRowProductImage(image, caption, product);

    const skuCell = document.createElement("td");
    skuCell.dataset.label = "SKU / Barcode";
    skuCell.className = "product-code-cell";
    const sku = document.createElement("strong");
    sku.textContent = product.sku;
    const barcode = document.createElement("span");
    barcode.textContent = product.barcode || "Barcode belum diisi";
    skuCell.append(sku, barcode);

    const categoryCell = document.createElement("td");
    categoryCell.dataset.label = "Kategori / Satuan";
    categoryCell.className = "product-code-cell";
    const category = document.createElement("strong");
    category.textContent = categoryNames.get(product.category_id) ?? "Kategori tidak tersedia";
    const unit = document.createElement("span");
    unit.textContent = unitNames.get(product.unit_id) ?? "Satuan tidak tersedia";
    categoryCell.append(category, unit);
    if (product.age_restricted === true) {
      const restriction = document.createElement("span");
      restriction.className = "badge badge--warning";
      restriction.textContent = "Dibatasi usia";
      restriction.title = "Penanda katalog demo saja; verifikasi usia belum tersedia.";
      categoryCell.append(restriction);
    }

    const priceCell = document.createElement("td");
    priceCell.dataset.label = "Harga dasar";
    priceCell.className = "product-price-cell";
    priceCell.textContent = `Rp${currency.format(product.base_price_idr)}`;

    const statusCell = document.createElement("td");
    statusCell.dataset.label = "Kedaluwarsa / Status";
    statusCell.className = "product-status-cell";
    const expiry = document.createElement("span");
    expiry.className = "product-expiry";
    expiry.textContent = expiryNames[product.expiry_policy];
    const badge = document.createElement("span");
    badge.className = `badge ${product.status === "active" ? "badge--success" : "badge--neutral"}`;
    badge.textContent = product.status === "active" ? "Aktif" : "Nonaktif";
    statusCell.append(expiry, badge);

    const actions = document.createElement("td");
    actions.dataset.label = "Aksi";
    actions.className = "product-actions-cell";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "button button--quiet product-action-button";
    edit.dataset.editProduct = product.product_id;
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", `Edit ${product.name}`);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = `button button--quiet product-action-button${product.status === "active" ? " product-action-button--danger" : ""}`;
    toggle.dataset.toggleProductStatus = product.product_id;
    toggle.textContent = product.status === "active" ? "Nonaktifkan" : "Aktifkan";
    toggle.setAttribute("aria-label", `${toggle.textContent} ${product.name}`);
    actions.append(edit, toggle);
    row.append(productCell, skuCell, categoryCell, priceCell, statusCell, actions);
    fragment.append(row);
  }
  body.replaceChildren(fragment);
}

async function loadRowProductImage(image, caption, product) {
  if (!state.imageService) return;
  const display = await state.imageService.getDisplayImage(product.product_id, product.category_id);
  if (!image.isConnected) return;
  image.onerror = () => {
    if (display.source !== "uploaded") return;
    const fallback = state.imageService.invalidateDisplay(product.product_id, product.category_id);
    image.onerror = null;
    image.src = fallback.src;
    image.alt = `${product.name} · ilustrasi demo`;
    caption.textContent = "Ilustrasi";
  };
  image.src = display.src;
  image.alt = `${product.name} · ${display.caption}`;
  caption.textContent = display.source === "uploaded" ? "Gambar produk" : "Ilustrasi";
  caption.title = display.source === "uploaded" ? "Gambar produk yang diunggah" : "Ilustrasi demo · bukan foto produk";
}

function renderPagination(result) {
  const start = result.total ? (result.page - 1) * result.pageSize + 1 : 0;
  const end = Math.min(result.page * result.pageSize, result.total);
  $("#product-page-summary").textContent = `${start}–${end} dari ${result.total} produk`;
  $("[data-product-page='previous']").disabled = result.page <= 1;
  $("[data-product-page='next']").disabled = result.page >= result.pageCount;
}

function syncCategoryFilter(categories) {
  const select = $("#product-category-filter");
  const selected = state.categoryId;
  const first = select.firstElementChild.cloneNode(true);
  select.replaceChildren(first);
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.category_id;
    option.textContent = category.name;
    select.append(option);
  });
  select.value = selected;
}

function updateSortIndicators() {
  $$("[data-product-sort]").forEach((button) => {
    const active = button.dataset.productSort === state.sortBy;
    button.closest("th").setAttribute("aria-sort", active ? (state.direction === "asc" ? "ascending" : "descending") : "none");
    button.querySelector("span").textContent = active ? (state.direction === "asc" ? "↑" : "↓") : "↕";
  });
}

function readProduct(productId) {
  try {
    return repository.load().products.find((product) => product.product_id === productId) ?? null;
  } catch (error) {
    showPageError(error);
    return null;
  }
}

function showPageError(error) {
  $("#products-storage-error").hidden = false;
  $("[data-products-error-message]").textContent = error.message || "Penyimpanan browser mengalami kendala.";
  $(".product-toolbar").hidden = true;
  $(".product-list-card").hidden = true;
}

function onStorageChange(event) {
  if (event.key === DEMO_STORAGE_KEY) render();
}

function onBeforeUnload(event) {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
}

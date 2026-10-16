import { createLocalStorageRepository } from "../repositories/local-storage-repository.js";
import { createInventoryRepository } from "../repositories/inventory-repository.js";
import { PricingService } from "../services/pricing-service.js";
import { InventoryService } from "../services/inventory-service.js";
import { DEMO_CASHIER_ID, PosService } from "../services/pos-service.js";
import { setCashierBranchContext, showToast } from "../components.js";

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

function formatMoney(value) {
  return money.format(Number(value) || 0).replace(/\s/g, "");
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function isTypingTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function initializePosPage({ repository = createLocalStorageRepository(), now = () => new Date(), authService = null, administrationService = null, productImageService = null } = {}) {
  const page = document.querySelector("#pos[data-page-view]");
  if (!page) return null;
  const inventoryRepository = createInventoryRepository({ repository });
  const pricingService = new PricingService({ repository });
  const initialUser = authService?.getSession()?.user ?? null;
  let cashierId = initialUser?.user_id ?? DEMO_CASHIER_ID;
  let branchScopeId = initialUser?.role === "CASHIER" ? initialUser.branch_id : null;
  let inventoryService = new InventoryService({ repository: inventoryRepository, now, actorId: cashierId });
  let posService = new PosService({ repository, pricingService, inventoryService, now, cashierId, branchScopeId, receiptFooterProvider: () => administrationService?.getReceiptFooter() ?? "" });
  const cart = new Map();
  const branchSelect = page.querySelector("#pos-branch-select");
  const branchSelectError = page.querySelector("#pos-catalog-error");
  const searchInput = page.querySelector("#pos-product-search");
  const categoryFilter = page.querySelector("#pos-category-filter");
  const clearFiltersButton = page.querySelector("#pos-clear-filters");
  const productList = page.querySelector("#pos-product-list");
  const productEmpty = page.querySelector("#pos-product-empty");
  const productCount = page.querySelector("#pos-product-count");
  const cartList = page.querySelector("#pos-cart-list");
  const cartEmpty = page.querySelector("#pos-cart-empty");
  const cartCount = page.querySelector("#pos-cart-count");
  const mobileCartToggle = page.querySelector("#pos-mobile-cart-toggle");
  const checkoutContent = page.querySelector("#pos-checkout-content");
  const cartBackdrop = page.querySelector("#pos-cart-backdrop");
  const checkoutPanel = page.querySelector(".pos-checkout");
  const shiftState = page.querySelector("#pos-shift-state");
  const openShiftButton = page.querySelector("#pos-open-shift");
  const checkoutButton = page.querySelector("#pos-checkout-submit");
  const previewButton = page.querySelector("#pos-preview-receipt");
  const cashInput = page.querySelector("#pos-cash-received");
  const checkoutError = page.querySelector("#pos-checkout-error");
  const shiftDialog = document.querySelector("#pos-shift-dialog");
  const shiftForm = document.querySelector("#pos-shift-form");
  const shiftError = document.querySelector("#pos-shift-error");
  const receiptDialog = document.querySelector("#pos-receipt-dialog");
  const clearDialog = document.querySelector("#pos-clear-dialog");
  const receiptPrintButton = document.querySelector("#pos-print-receipt");
  let workspace = null;
  let categories = [];
  let currentQuote = null;
  let currentInventory = null;
  let productIndex = new Map();
  let submitting = false;
  let receiptCompleted = false;
  let cartExpanded = false;
  const dialogOpeners = new WeakMap();

  const setError = (node, message) => {
    if (!node) return;
    node.textContent = message || "";
    node.hidden = !message;
  };

  const showDialog = (dialog) => {
    if (!dialog || dialog.open || typeof dialog.showModal !== "function") return;
    dialogOpeners.set(dialog, document.activeElement);
    dialog.showModal();
  };

  const canReceiveFocus = (target) => target instanceof HTMLElement
    && target.isConnected
    && !target.hidden
    && !target.matches(":disabled")
    && target.getClientRects().length > 0;

  function restoreDialogFocus(dialog) {
    const opener = dialogOpeners.get(dialog);
    dialogOpeners.delete(dialog);
    if (document.querySelector("dialog[open]")) return;
    requestAnimationFrame(() => {
      if (document.querySelector("dialog[open]")) return;
      const cartIsModal = cartExpanded && window.matchMedia("(max-width: 1100px)").matches;
      const target = cartIsModal
        ? (canReceiveFocus(opener) && checkoutPanel.contains(opener) ? opener : mobileCartToggle)
        : (canReceiveFocus(opener) ? opener : openShiftButton);
      if (canReceiveFocus(target)) target.focus({ preventScroll: true });
    });
  }

  function fillBranches() {
    if (!branchSelect) return;
    branchSelect.replaceChildren();
    const branches = branchScopeId
      ? workspace.branches.filter((branch) => branch.branch_id === branchScopeId)
      : workspace.branches;
    for (const branch of branches) {
      const option = document.createElement("option");
      option.value = branch.branch_id;
      option.textContent = branch.name;
      branchSelect.append(option);
    }
    branchSelect.value = branches.find((branch) => branch.branch_id === branchScopeId)?.branch_id
      ?? branches.find((branch) => branch.branch_id === "BR-JKT-01")?.branch_id
      ?? branches[0]?.branch_id ?? "";
  }

  function fillCategories() {
    if (!categoryFilter) return;
    const selectedCategory = categoryFilter.value;
    categoryFilter.replaceChildren();
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "Semua kategori";
    categoryFilter.append(allOption);
    for (const category of categories) {
      const option = document.createElement("option");
      option.value = category.category_id;
      option.textContent = category.name;
      categoryFilter.append(option);
    }
    categoryFilter.value = categories.some((category) => category.category_id === selectedCategory) ? selectedCategory : "";
  }

  function updateWorkspace() {
    try {
      workspace = posService.getWorkspace();
      categories = repository.load().categories.filter((category) => category.status === "active");
      fillCategories();
      fillBranches();
      if (workspace.branchScopeMismatch) {
        branchSelect.disabled = true;
        currentQuote = null;
        currentInventory = null;
        checkoutButton.disabled = true;
        openShiftButton.disabled = true;
        shiftState.replaceChildren();
        shiftState.append(element("span", "badge badge--critical", "Shift di luar cabang"));
        shiftState.append(element("span", "pos-shift-detail", `Shift ${workspace.branchScopeMismatch.shift_id} berada di ${workspace.branchScopeMismatch.branch_id}; sesi ini hanya untuk ${branchScopeId}.`));
        setError(branchSelectError, "Shift cabang lain tidak dapat dipakai, ditutup, atau diganti dari sesi kasir ini.");
        return false;
      }
      if (workspace.shift) branchSelect.value = workspace.shift.branch_id;
      branchSelect.disabled = Boolean(branchScopeId || workspace.shift);
      const branchId = workspace.shift?.branch_id ?? branchSelect.value;
      const branch = workspace.branches.find((item) => item.branch_id === branchId);
      if (!authService || authService.getSession()?.user?.role === "CASHIER") {
        setCashierBranchContext(branch ?? null);
      }
      currentInventory = branch
        ? inventoryService.getWorkspace({
          warehouseId: workspace.shift?.warehouse_id ?? repository.load().warehouses.find((warehouse) => warehouse.branch_id === branchId && warehouse.status === "active")?.warehouse_id,
          effectiveDate: workspace.businessDate,
        })
        : null;
      productIndex = new Map(workspace.products.map((product) => [product.product_id, product]));
      if (workspace.shift) {
        shiftState.replaceChildren();
        const badge = element("span", "badge badge--success", "Shift aktif");
        const detail = element("span", "pos-shift-detail", `${branch?.name ?? branchId} · Kas awal ${formatMoney(workspace.shift.opening_cash_idr)} · Ekspektasi ${formatMoney(workspace.shift.expected_cash_idr)}`);
        shiftState.append(badge, detail);
        openShiftButton.textContent = "Shift aktif";
        openShiftButton.disabled = true;
      } else {
        shiftState.replaceChildren();
        shiftState.append(element("span", "badge badge--warning", "Shift belum dibuka"));
        shiftState.append(element("span", "pos-shift-detail", "Checkout tunai hanya tersedia pada shift aktif."));
        openShiftButton.textContent = "Buka shift";
        openShiftButton.disabled = false;
      }
      setError(branchSelectError, "");
      return true;
    } catch (error) {
      setError(branchSelectError, error.message || "Data kasir demo gagal dimuat.");
      currentInventory = null;
      return false;
    }
  }

  function syncAuthActor() {
    const nextUser = authService?.getSession()?.user ?? null;
    const nextCashierId = nextUser?.user_id ?? DEMO_CASHIER_ID;
    const nextBranchScope = nextUser?.role === "CASHIER" ? nextUser.branch_id : null;
    if (nextCashierId === cashierId && nextBranchScope === branchScopeId) return;
    cashierId = nextCashierId;
    branchScopeId = nextBranchScope;
    inventoryService = new InventoryService({ repository: inventoryRepository, now, actorId: cashierId });
    posService = new PosService({ repository, pricingService, inventoryService, now, cashierId, branchScopeId, receiptFooterProvider: () => administrationService?.getReceiptFooter() ?? "" });
    cart.clear();
    currentQuote = null;
    currentInventory = null;
    branchSelect.replaceChildren();
    render();
  }

  function availableQuantity(productId) {
    return currentInventory?.batches
      .filter((batch) => batch.product_id === productId)
      .reduce((sum, batch) => sum + batch.sellableQuantity, 0) ?? 0;
  }

  function searchMatches(product, query) {
    if (!query) return true;
    return [product.name, product.sku, product.barcode]
      .some((value) => String(value ?? "").toLocaleLowerCase("id-ID").includes(query));
  }

  function visibleProducts(query = String(searchInput.value).trim().toLocaleLowerCase("id-ID")) {
    const categoryId = categoryFilter?.value ?? "";
    return workspace.products.filter((product) => searchMatches(product, query)
      && (!categoryId || product.category_id === categoryId));
  }

  function renderProducts() {
    if (!workspace) return;
    productList.replaceChildren();
    const query = String(searchInput.value).trim().toLocaleLowerCase("id-ID");
    const results = visibleProducts(query);
    productCount.textContent = `${number.format(results.length)} produk`;
    for (const product of results) {
      const stock = availableQuantity(product.product_id);
      const article = element("article", "pos-product-card");
      const imageFigure = element("figure", "pos-product-card__image");
      const image = element("img");
      image.width = 320;
      image.height = 180;
      image.loading = "lazy";
      image.decoding = "async";
      image.alt = product.name;
      image.src = productImageService?.fallback(product.product_id, product.category_id).src ?? "assets/images/products/placeholder.svg";
      imageFigure.append(image);
      loadCatalogProductImage(image, product);
      const identity = element("div", "pos-product-card__identity");
      identity.append(element("h3", "", product.name));
      if (product.age_restricted === true) {
        const restriction = element("span", "badge badge--warning", "Kategori dibatasi usia");
        restriction.title = "Penanda katalog demo saja; verifikasi usia belum tersedia.";
        identity.append(restriction);
      }
      const details = element("div", "pos-product-card__details");
      const metadata = element("div", "pos-product-card__meta");
      metadata.append(element("span", "pos-product-card__sku", product.sku));
      metadata.append(element("span", "pos-product-card__barcode", `Barcode ${product.barcode || "belum diisi"}`));
      try {
        const quote = pricingService.resolvePrice({ productId: product.product_id, branchId: branchSelect.value, effectiveDate: workspace.businessDate });
        details.append(element("strong", "pos-product-card__price", formatMoney(quote.regularPriceIdr)));
        metadata.append(element("span", "pos-product-card__regional", `Penyesuaian wilayah ${quote.adjustmentPercent}%`));
      } catch (error) {
        details.append(element("span", "pos-product-card__price pos-product-card__price--error", "Aturan harga tidak tersedia"));
      }
      const addButton = element("button", "button button--secondary pos-add-button", stock > 0 ? "Tambah" : "Stok habis");
      addButton.type = "button";
      addButton.dataset.posAdd = product.product_id;
      addButton.disabled = stock <= 0;
      const stockBadge = element("span", stock > 0 ? "pos-stock-label" : "pos-stock-label pos-stock-label--empty", `${number.format(stock)} unit layak jual`);
      const footer = element("div", "pos-product-card__footer");
      footer.append(stockBadge, addButton);
      article.append(imageFigure, identity, details, footer, metadata);
      productList.append(article);
    }
    productEmpty.hidden = results.length > 0;
    const hasFilter = Boolean(query || categoryFilter?.value);
    clearFiltersButton.hidden = !hasFilter || results.length > 0;
    productEmpty.append(clearFiltersButton);
    if (results.length === 0 && categoryFilter?.value && !query) {
      productEmpty.querySelector("h3").textContent = "Belum ada produk di kategori ini";
      productEmpty.querySelector("p").textContent = "Pilih kategori lain atau tampilkan semua kategori.";
    } else {
      productEmpty.querySelector("h3").textContent = "Produk tidak ditemukan";
      productEmpty.querySelector("p").textContent = "Periksa nama, SKU, atau barcode yang Anda masukkan.";
    }
  }

  async function loadCatalogProductImage(image, product) {
    if (!productImageService) return;
    const display = await productImageService.getDisplayImage(product.product_id, product.category_id);
    if (!image.isConnected) return;
    image.onerror = () => {
      if (display.source !== "uploaded") return;
      const fallback = productImageService.invalidateDisplay(product.product_id, product.category_id);
      image.onerror = null;
      image.src = fallback.src;
      image.alt = product.name;
    };
    image.classList.toggle("pos-product-card__image--uploaded", display.source === "uploaded");
    image.src = display.src;
    image.alt = product.name;
  }

  function buildCurrentQuote() {
    if (!cart.size || !workspace) {
      currentQuote = null;
      return null;
    }
    const branchId = workspace.shift?.branch_id ?? branchSelect.value;
    try {
      currentQuote = posService.quoteCart({
        branchId,
        effectiveDate: workspace.businessDate,
        items: [...cart].map(([productId, quantity]) => ({ productId, quantity })),
      });
      setError(checkoutError, "");
      return currentQuote;
    } catch (error) {
      currentQuote = null;
      setError(checkoutError, error.message || "Pratinjau harga dan stok tidak dapat dihitung.");
      return null;
    }
  }

  function renderAllocations(line) {
    const list = element("ul", "pos-allocation-list");
    for (const allocation of line?.allocations ?? []) {
      const row = element("li", "");
      const promoSuffix = allocation.unit_discount_idr > 0 ? ` · diskon ${formatMoney(allocation.unit_discount_idr)}/unit` : " · reguler";
      row.textContent = `${number.format(allocation.allocated_quantity)} × ${allocation.lot_number}${allocation.expiry_date ? ` · exp. ${allocation.expiry_date}` : ""}${promoSuffix}`;
      list.append(row);
    }
    return list;
  }

  function renderCart(quote) {
    cartList.replaceChildren();
    let unitCount = 0;
    for (const [productId, quantity] of cart) {
      unitCount += quantity;
      const product = productIndex.get(productId);
      if (!product) continue;
      const line = quote?.lines.find((item) => item.product.product_id === productId) ?? null;
      const article = element("article", "pos-cart-line");
      const heading = element("div", "pos-cart-line__heading");
      const title = element("div", "pos-cart-line__title");
      title.append(element("strong", "", product.name));
      title.append(element("span", "", `${product.sku} · ${line ? formatMoney(line.regular_price_idr) : "Harga belum tervalidasi"} / unit`));
      const removeButton = element("button", "icon-button pos-remove-line", "×");
      removeButton.type = "button";
      removeButton.dataset.posRemove = productId;
      removeButton.setAttribute("aria-label", `Hapus ${product.name} dari keranjang`);
      heading.append(title, removeButton);
      const controls = element("div", "pos-cart-line__controls");
      const quantityControl = element("div", "pos-quantity-control");
      const decrement = element("button", "icon-button", "−");
      decrement.type = "button";
      decrement.dataset.posQuantity = "-1";
      decrement.dataset.posProduct = productId;
      decrement.setAttribute("aria-label", `Kurangi satu ${product.name}`);
      const quantityLabel = element("output", "", number.format(quantity));
      const increment = element("button", "icon-button", "+");
      increment.type = "button";
      increment.dataset.posQuantity = "1";
      increment.dataset.posProduct = productId;
      increment.setAttribute("aria-label", `Tambah satu ${product.name}`);
      quantityControl.append(decrement, quantityLabel, increment);
      controls.append(quantityControl);
      if (line) {
        controls.append(element("strong", "pos-cart-line__total", formatMoney(line.final_line_total_idr)));
        article.append(heading, controls, renderAllocations(line));
      } else {
        article.append(heading, controls);
      }
      cartList.append(article);
    }
    cartCount.textContent = `${number.format(unitCount)} unit`;
    page.querySelector("#pos-mobile-cart-count").textContent = `${number.format(unitCount)} unit dalam keranjang`;
    page.querySelector("#pos-mobile-cart-total").textContent = formatMoney(quote?.net_total_idr ?? 0);
    syncCartDisclosure();
    page.querySelector("#pos-clear-cart").disabled = cart.size === 0;
    cartEmpty.hidden = cart.size > 0;
    cartList.hidden = cart.size === 0;
    const hasQuote = Boolean(quote);
    page.querySelector("#pos-total-block").hidden = !hasQuote;
    page.querySelector("#pos-payment").hidden = cart.size === 0;
    previewButton.disabled = !hasQuote;
    previewButton.textContent = "Pratinjau struk";
    if (hasQuote) {
      page.querySelector("#pos-subtotal").textContent = formatMoney(quote.gross_total_idr);
      page.querySelector("#pos-discount").textContent = `−${formatMoney(quote.discount_total_idr)}`;
      page.querySelector("#pos-total").textContent = formatMoney(quote.net_total_idr);
    }
    updateCashFeedback(quote);
  }

  function syncCartDisclosure() {
    if (!mobileCartToggle || !checkoutContent) return;
    const isMobileLayout = window.matchMedia("(max-width: 1100px)").matches;
    mobileCartToggle.hidden = !isMobileLayout;
    if (!isMobileLayout) {
      cartExpanded = false;
      checkoutContent.hidden = false;
      cartBackdrop.hidden = true;
      checkoutPanel.classList.remove("is-expanded");
      checkoutPanel.removeAttribute("role");
      checkoutPanel.removeAttribute("aria-modal");
      mobileCartToggle.setAttribute("aria-expanded", "false");
      page.querySelector("#pos-mobile-cart-action").textContent = "Buka keranjang";
      document.body.classList.remove("is-pos-cart-open");
      return;
    }
    checkoutContent.hidden = !cartExpanded;
    cartBackdrop.hidden = !cartExpanded;
    checkoutPanel.classList.toggle("is-expanded", cartExpanded);
    if (cartExpanded) {
      checkoutPanel.setAttribute("role", "dialog");
      checkoutPanel.setAttribute("aria-modal", "true");
      document.body.classList.add("is-pos-cart-open");
    } else {
      checkoutPanel.removeAttribute("role");
      checkoutPanel.removeAttribute("aria-modal");
      document.body.classList.remove("is-pos-cart-open");
    }
    mobileCartToggle.setAttribute("aria-expanded", String(cartExpanded));
    page.querySelector("#pos-mobile-cart-action").textContent = cartExpanded ? "Tutup keranjang" : "Buka keranjang";
    mobileCartToggle.setAttribute("aria-label", `${cartExpanded ? "Tutup" : "Buka"} keranjang, ${page.querySelector("#pos-mobile-cart-count").textContent}, total ${page.querySelector("#pos-mobile-cart-total").textContent}`);
  }

  function closeCartDrawer({ restoreFocus = true } = {}) {
    if (!cartExpanded) return;
    cartExpanded = false;
    syncCartDisclosure();
    if (restoreFocus && !mobileCartToggle.hidden) mobileCartToggle.focus({ preventScroll: true });
  }

  function trapCartFocus(event) {
    const focusable = [...checkoutPanel.querySelectorAll(
      'a[href], button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])',
    )].filter((node) => node.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      mobileCartToggle.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || !checkoutPanel.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !checkoutPanel.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  function updateCashFeedback(quote = currentQuote) {
    const amount = Number(cashInput.value);
    const validTender = Number.isSafeInteger(amount) && amount >= 0;
    const delta = validTender && quote ? amount - quote.net_total_idr : 0;
    const change = page.querySelector("#pos-change");
    change.textContent = validTender && quote
      ? (delta >= 0 ? formatMoney(delta) : `Kurang ${formatMoney(Math.abs(delta))}`)
      : formatMoney(0);
    change.classList.toggle("is-short", Boolean(quote && validTender && delta < 0));
    const canCheckout = Boolean(quote && workspace?.shift && validTender && delta >= 0 && !submitting);
    checkoutButton.disabled = !canCheckout;
    checkoutButton.textContent = submitting
      ? "Menyimpan transaksi…"
      : !workspace?.shift ? "Checkout perlu shift aktif" : "Bayar tunai & selesaikan";
  }

  function render() {
    if (!updateWorkspace()) return;
    renderProducts();
    const quote = buildCurrentQuote();
    renderCart(quote);
  }

  function renderReceipt(quote, payment = null, sale = null) {
    const branchName = sale?.branch_id
      ? workspace?.branches.find((branch) => branch.branch_id === sale.branch_id)?.name ?? sale.branch_id
      : quote.branch.name;
    page.ownerDocument.querySelector("#pos-receipt-branch").textContent = branchName;
    page.ownerDocument.querySelector("#pos-receipt-number").textContent = sale?.transaction_number ?? "Nomor transaksi dibuat setelah pembayaran tersimpan";
    const status = page.ownerDocument.querySelector("#pos-receipt-status");
    status.textContent = sale ? "LUNAS · TUNAI SIMULASI" : "Pratinjau — Belum Dibayar";
    status.classList.toggle("is-paid", Boolean(sale));
    const itemsContainer = page.ownerDocument.querySelector("#pos-receipt-items");
    itemsContainer.replaceChildren();
    const lines = sale?.items ?? quote.lines.map((line) => ({
      product_id: line.product.product_id,
      name_snapshot: line.product.name,
      quantity: line.quantity,
      regular_unit_price_idr: line.regular_price_idr,
      regular_line_total_idr: line.regular_line_total_idr,
      discount_total_idr: line.discount_total_idr,
      final_line_total_idr: line.final_line_total_idr,
      allocations: line.allocations.map((allocation) => ({
        lot_number_snapshot: allocation.lot_number,
        allocated_quantity: allocation.allocated_quantity,
        unit_discount_idr: allocation.unit_discount_idr,
        final_unit_price_idr: allocation.final_unit_price_idr,
      })),
    }));
    for (const line of lines) {
      const row = element("div", "pos-receipt-item");
      const title = element("div", "pos-receipt-item__heading");
      title.append(element("strong", "", `${number.format(line.quantity)} × ${line.name_snapshot}`));
      title.append(element("strong", "", formatMoney(line.final_line_total_idr)));
      row.append(title);
      const detail = element("ul", "");
      for (const allocation of line.allocations) {
        detail.append(element("li", "", `${number.format(allocation.allocated_quantity)} × ${allocation.lot_number_snapshot} · ${formatMoney(allocation.final_unit_price_idr)}/unit${allocation.unit_discount_idr ? ` · diskon ${formatMoney(allocation.unit_discount_idr)}` : ""}`));
      }
      row.append(detail);
      itemsContainer.append(row);
    }
    const gross = sale?.gross_total_idr ?? quote.gross_total_idr;
    const discount = sale?.discount_total_idr ?? quote.discount_total_idr;
    const net = sale?.net_total_idr ?? quote.net_total_idr;
    page.ownerDocument.querySelector("#pos-receipt-gross").textContent = formatMoney(gross);
    page.ownerDocument.querySelector("#pos-receipt-discount").textContent = `−${formatMoney(discount)}`;
    page.ownerDocument.querySelector("#pos-receipt-net").textContent = formatMoney(net);
    page.ownerDocument.querySelector("#pos-receipt-tender").textContent = payment ? formatMoney(payment.received_amount_idr) : "— · belum dibayar";
    page.ownerDocument.querySelector("#pos-receipt-change").textContent = payment ? formatMoney(payment.change_idr) : "—";
    receiptCompleted = Boolean(sale);
    receiptDialog.dataset.receiptState = receiptCompleted ? "completed" : "preview";
    receiptPrintButton.hidden = !receiptCompleted;
    receiptPrintButton.disabled = !receiptCompleted;
    const footer = page.ownerDocument.querySelector("#pos-receipt-footer");
    footer.replaceChildren();
    footer.append(page.ownerDocument.createTextNode(
      receiptCompleted
        ? "Terima kasih telah berbelanja."
        : "Pratinjau saja. Belum ada pembayaran atau transaksi yang disimpan.",
    ));
    footer.append(page.ownerDocument.createElement("br"));
    footer.append(page.ownerDocument.createTextNode(
      receiptCompleted
        ? "Transaksi ini tercatat sebagai simulasi lokal."
        : "Stok, pembayaran, ledger, dan kas shift belum berubah.",
    ));
    const customFooter = sale
      ? sale.receipt_footer_snapshot
      : administrationService?.getReceiptFooter?.();
    if (customFooter) {
      footer.append(page.ownerDocument.createElement("br"));
      footer.append(page.ownerDocument.createTextNode(customFooter));
    }
  }

  function openReceiptPreview() {
    if (!currentQuote) return;
    renderReceipt(currentQuote);
    showDialog(receiptDialog);
  }

  function addProduct(productId) {
    const product = productIndex.get(productId);
    if (!product) return;
    const current = cart.get(productId) ?? 0;
    if (current + 1 > availableQuantity(productId)) {
      showToast("Jumlah melebihi stok layak jual pada cabang dan tanggal ini.", "warning");
      return;
    }
    cart.set(productId, current + 1);
    render();
  }

  productList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pos-add]");
    if (button) addProduct(button.dataset.posAdd);
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const query = searchInput.value.trim().toLocaleLowerCase("id-ID");
    if (!query) return;
    const matches = visibleProducts(query);
    if (matches.length === 1 && availableQuantity(matches[0].product_id) > (cart.get(matches[0].product_id) ?? 0)) {
      event.preventDefault();
      addProduct(matches[0].product_id);
      searchInput.select();
    }
  });
  searchInput.addEventListener("input", renderProducts);
  categoryFilter.addEventListener("change", renderProducts);
  clearFiltersButton.addEventListener("click", () => {
    searchInput.value = "";
    categoryFilter.value = "";
    renderProducts();
    searchInput.focus();
  });
  mobileCartToggle.addEventListener("click", () => {
    if (cartExpanded) {
      closeCartDrawer();
      return;
    }
    cartExpanded = true;
    syncCartDisclosure();
    mobileCartToggle.focus({ preventScroll: true });
  });
  cartBackdrop.addEventListener("click", () => closeCartDrawer());
  window.addEventListener("resize", syncCartDisclosure, { passive: true });
  branchSelect.addEventListener("change", render);
  cashInput.addEventListener("input", () => updateCashFeedback());
  cartList.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-pos-remove]");
    if (remove) {
      cart.delete(remove.dataset.posRemove);
      render();
      return;
    }
    const quantityButton = event.target.closest("[data-pos-quantity]");
    if (!quantityButton) return;
    const productId = quantityButton.dataset.posProduct;
    const nextQuantity = (cart.get(productId) ?? 0) + Number(quantityButton.dataset.posQuantity);
    if (nextQuantity <= 0) cart.delete(productId);
    else cart.set(productId, nextQuantity);
    render();
  });
  openShiftButton.addEventListener("click", () => {
    setError(shiftError, "");
    showDialog(shiftDialog);
  });
  shiftForm.addEventListener("submit", (event) => {
    event.preventDefault();
    setError(shiftError, "");
    try {
      posService.openShift({ branchId: branchSelect.value, openingCashIdr: shiftForm.elements.opening_cash_idr.value });
      dialogOpeners.set(shiftDialog, cashInput);
      shiftDialog.close();
      render();
      showToast("Shift kasir demo berhasil dibuka.", "success");
      cashInput.focus({ preventScroll: true });
    } catch (error) {
      setError(shiftError, error.message || "Shift tidak dapat dibuka.");
      shiftError.focus();
    }
  });
  previewButton.addEventListener("click", openReceiptPreview);
  checkoutButton.addEventListener("click", () => {
    if (submitting || !currentQuote || !workspace?.shift) return;
    submitting = true;
    updateCashFeedback();
    try {
      const result = posService.checkout({
        branchId: workspace.shift.branch_id,
        items: [...cart].map(([productId, quantity]) => ({ productId, quantity })),
        tenderedAmountIdr: cashInput.value,
        idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `POS-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        expectedFingerprint: currentQuote.checkoutFingerprint,
      });
      renderReceipt(currentQuote, result.payment, result.sale);
      cart.clear();
      cashInput.value = "";
      render();
      showDialog(receiptDialog);
      showToast("Transaksi tunai tersimpan bersama mutasi batch dan kas shift.", "success");
    } catch (error) {
      setError(checkoutError, error.message || "Checkout gagal. Tidak ada transaksi yang disimpan.");
      showToast(error.message || "Checkout gagal. Tidak ada transaksi yang disimpan.", "error");
    } finally {
      submitting = false;
      updateCashFeedback();
    }
  });
  document.querySelectorAll("[data-close-pos-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });
  [shiftDialog, receiptDialog, clearDialog].filter(Boolean).forEach((dialog) => {
    dialog.addEventListener("close", () => restoreDialogFocus(dialog));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
  document.querySelector("#pos-clear-confirm").addEventListener("click", () => {
    cart.clear();
    cashInput.value = "";
    clearDialog.close();
    render();
    showToast("Keranjang dikosongkan. Stok tidak berubah.", "info");
  });
  page.querySelector("#pos-clear-cart")?.addEventListener("click", () => showDialog(clearDialog));
  receiptPrintButton.addEventListener("click", () => {
    if (!receiptCompleted || receiptDialog.dataset.receiptState !== "completed") {
      showToast("Hanya struk transaksi selesai yang dapat dicetak.", "warning");
      return;
    }
    window.print();
  });
  document.addEventListener("keydown", (event) => {
    // Native modal dialogs own keyboard focus while open; the drawer handler must not intercept them.
    if (document.querySelector("dialog[open]")) return;
    if (event.key === "Escape" && cartExpanded && window.matchMedia("(max-width: 1100px)").matches) {
      event.preventDefault();
      closeCartDrawer();
      return;
    }
    if (event.key === "Tab" && cartExpanded && window.matchMedia("(max-width: 1100px)").matches) {
      trapCartFocus(event);
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (event.key === "F4" && !page.hidden) {
      event.preventDefault();
      searchInput.focus();
    } else if (event.key === "F2" && !page.hidden) {
      event.preventDefault();
      if (!workspace?.shift) showDialog(shiftDialog);
      else cashInput.focus();
    } else if (event.ctrlKey && event.key === "Backspace" && !page.hidden && cart.size) {
      event.preventDefault();
      showDialog(clearDialog);
    }
  });

  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#pos") render();
    else closeCartDrawer({ restoreFocus: false });
  });
  document.addEventListener("app:authchange", syncAuthActor);
  render();
  return Object.freeze({ service: posService, pricingService, inventoryService, refresh: render });
}

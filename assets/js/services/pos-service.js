import { DEMO_REFERENCE_DATE } from "../data/demo-seed.js";
import { PricingService } from "./pricing-service.js";
import { InventoryService } from "./inventory-service.js";

export const DEMO_CASHIER_ID = "DEMO-CASHIER-001";
export const DEMO_BATCH_DISCOUNTS = Object.freeze({
  "BAT-SNK-A": Object.freeze({
    product_id: "PRD-001",
    lot_number: "SNK-A",
    promotion_id: "PROMO-SNK-A-1000",
    promotion_name: "Diskon batch SNK-A",
    unit_discount_idr: 1000,
  }),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix) {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 14)
    ?? Math.random().toString(36).slice(2, 16);
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${random.toUpperCase()}`;
}

function timestampNow(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new PosError("POS_CLOCK_INVALID", "Waktu kasir demo tidak valid.");
  return date.toISOString();
}

function businessDate(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isValidDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function activeShiftFor(state, cashierId) {
  return (state.cashShifts ?? []).find((shift) => shift.cashier_id === cashierId && shift.status === "active") ?? null;
}

function expectedCashFor(state, shiftId) {
  const shift = state.cashShifts?.find((item) => item.shift_id === shiftId);
  if (!shift) return null;
  let expected = shift.opening_cash_idr;
  for (const movement of (state.cashMovements ?? []).filter((item) => item.shift_id === shiftId)) {
    expected += movement.amount_idr;
    if (!Number.isSafeInteger(expected) || expected < 0) {
      throw new PosError("SHIFT_CASH_UNSAFE", "Saldo ekspektasi kas shift melampaui batas nominal aman.");
    }
  }
  return expected;
}

function prepareShiftClosing(state, { shiftId, physicalCashIdr, cashierId, branchScopeId = null }) {
  const requestedShift = (state.cashShifts ?? []).find((shift) => shift.shift_id === shiftId);
  if (!requestedShift) throw new PosError("SHIFT_NOT_FOUND", "Shift yang akan ditutup tidak ditemukan.");
  if (requestedShift.cashier_id !== cashierId) throw new PosError("SHIFT_SCOPE_MISMATCH", "Kasir demo hanya dapat menutup shift miliknya sendiri.");
  if (branchScopeId && requestedShift.branch_id !== branchScopeId) throw new PosError("SHIFT_BRANCH_SCOPE_MISMATCH", "Sesi kasir demo terikat ke cabang lain.");
  if (requestedShift.status === "closed") throw new PosError("SHIFT_ALREADY_CLOSED", "Shift ini sudah ditutup dan histori rekonsiliasi tidak dapat diubah.");
  const activeShift = activeShiftFor(state, cashierId);
  if (!activeShift || activeShift.shift_id !== requestedShift.shift_id) {
    throw new PosError("SHIFT_NOT_ACTIVE", "Hanya shift aktif kasir demo yang dapat ditutup.");
  }
  const emptyPhysicalCash = physicalCashIdr === null || physicalCashIdr === undefined || String(physicalCashIdr).trim() === "";
  const physicalCash = Number(physicalCashIdr);
  if (emptyPhysicalCash || !Number.isSafeInteger(physicalCash) || physicalCash < 0) {
    throw new PosError("SHIFT_CLOSING_CASH_INVALID", "Kas fisik harus berupa integer rupiah nonnegatif.", {
      physicalCashIdr: "Masukkan jumlah kas fisik dalam rupiah bulat, nol atau lebih.",
    });
  }
  const expectedCash = expectedCashFor(state, activeShift.shift_id);
  const difference = physicalCash - expectedCash;
  if (!Number.isSafeInteger(difference)) throw new PosError("SHIFT_CASH_UNSAFE", "Selisih kas melampaui batas nominal aman.");
  return { activeShift, physicalCash, expectedCash, difference };
}

function cartFingerprint(quote) {
  return JSON.stringify({
    branchId: quote.branch.branch_id,
    effectiveDate: quote.effectiveDate,
    lines: quote.lines.map((line) => ({
      productId: line.product.product_id,
      quantity: line.quantity,
      ruleId: line.rule.price_rule_id,
      ruleVersion: line.rule.version,
      regularPriceIdr: line.regular_price_idr,
      allocations: line.allocations.map((allocation) => [allocation.inventory_batch_id, allocation.allocated_quantity]),
      lineDiscountIdr: line.discount_total_idr,
    })),
  });
}

function assertCollection(state, key) {
  if (!Array.isArray(state[key])) state[key] = [];
}

export class PosError extends Error {
  constructor(code, message, fieldErrors = {}, details = {}, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "PosError";
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.details = details;
  }
}

export class PosService {
  constructor({ repository, pricingService = null, inventoryService = null, now = () => new Date(), idFactory = makeId, cashierId = DEMO_CASHIER_ID, branchScopeId = null, receiptFooterProvider = () => "", simulationDatasetId = null } = {}) {
    if (!repository || typeof repository.load !== "function" || typeof repository.commit !== "function") {
      throw new TypeError("PosService memerlukan repository snapshot yang mendukung load dan commit.");
    }
    this.repository = repository;
    this.pricingService = pricingService ?? new PricingService({ repository, clock: () => timestampNow(now), idFactory });
    this.inventoryService = inventoryService ?? new InventoryService({ repository, now, idFactory, actorId: cashierId });
    this.now = now;
    this.idFactory = idFactory;
    this.cashierId = cashierId;
    this.branchScopeId = branchScopeId;
    this.receiptFooterProvider = receiptFooterProvider;
    this.simulationDatasetId = simulationDatasetId;
  }

  getWorkspace() {
    const state = this.repository.load();
    const activeShift = activeShiftFor(state, this.cashierId);
    const branchScopeMismatch = activeShift && this.branchScopeId && activeShift.branch_id !== this.branchScopeId
      ? { shift_id: activeShift.shift_id, branch_id: activeShift.branch_id }
      : null;
    const shift = branchScopeMismatch ? null : activeShift;
    return {
      branches: state.branches.filter((branch) => branch.status === "active" && (!this.branchScopeId || branch.branch_id === this.branchScopeId)).map((branch) => ({ ...branch })),
      products: state.products.filter((product) => product.status === "active").map((product) => ({ ...product })),
      shift: shift ? { ...shift, expected_cash_idr: expectedCashFor(state, shift.shift_id) } : null,
      branchScopeMismatch,
      businessDate: businessDate(timestampNow(this.now)),
      timezone: state.meta.timezone,
    };
  }

  getShiftHistory({ branchId = "all", cashierId = this.cashierId } = {}) {
    const state = this.repository.load();
    const effectiveBranchId = this.branchScopeId ?? branchId;
    const branchById = new Map(state.branches.map((branch) => [branch.branch_id, branch]));
    const salesByShift = new Map();
    for (const sale of state.sales ?? []) {
      const entries = salesByShift.get(sale.shift_id) ?? [];
      entries.push(sale);
      salesByShift.set(sale.shift_id, entries);
    }
    return (state.cashShifts ?? [])
      .filter((shift) => shift.cashier_id === cashierId && (effectiveBranchId === "all" || shift.branch_id === effectiveBranchId))
      .map((shift) => {
        const movements = (state.cashMovements ?? []).filter((movement) => movement.shift_id === shift.shift_id);
        return {
          ...shift,
          branch_name: branchById.get(shift.branch_id)?.name ?? shift.branch_id,
          confirmed_cash_movement_idr: movements.reduce((sum, movement) => sum + movement.amount_idr, 0),
          confirmed_cash_movement_count: movements.length,
          transaction_count: (salesByShift.get(shift.shift_id) ?? []).length,
          expected_cash_idr: expectedCashFor(state, shift.shift_id),
        };
      })
      .sort((left, right) => Date.parse(right.closed_at ?? right.opened_at) - Date.parse(left.closed_at ?? left.opened_at));
  }

  previewShiftClose({ shiftId, physicalCashIdr, cashierId = this.cashierId } = {}) {
    const state = this.repository.load();
    const { activeShift, physicalCash, expectedCash, difference } = prepareShiftClosing(state, { shiftId, physicalCashIdr, cashierId, branchScopeId: this.branchScopeId });
    return {
      shift_id: activeShift.shift_id,
      branch_id: activeShift.branch_id,
      physical_cash_idr: physicalCash,
      expected_cash_idr: expectedCash,
      cash_difference_idr: difference,
    };
  }

  closeShift({ shiftId, physicalCashIdr, cashierId = this.cashierId, previewExpectedCashIdr, previewDifferenceIdr } = {}) {
    const state = this.repository.load();
    const { activeShift, physicalCash, expectedCash, difference } = prepareShiftClosing(state, { shiftId, physicalCashIdr, cashierId, branchScopeId: this.branchScopeId });
    if ((previewExpectedCashIdr !== undefined && previewExpectedCashIdr !== expectedCash)
      || (previewDifferenceIdr !== undefined && previewDifferenceIdr !== difference)) {
      throw new PosError("SHIFT_CLOSING_PREVIEW_STALE", "Saldo shift berubah setelah pratinjau. Tutup pratinjau dan periksa kembali angkanya.");
    }
    const closedAt = timestampNow(this.now);
    if (Date.parse(closedAt) < Date.parse(activeShift.opened_at)) {
      throw new PosError("SHIFT_CLOCK_INVALID", "Waktu penutupan tidak boleh mendahului waktu buka shift.");
    }

    const next = clone(state);
    const nextShift = next.cashShifts.find((shift) => shift.shift_id === activeShift.shift_id);
    Object.assign(nextShift, {
      status: "closed",
      closed_at: closedAt,
      closed_by: cashierId,
      closing_cash_idr: physicalCash,
      expected_cash_idr: expectedCash,
      cash_difference_idr: difference,
    });
    this.#commit(next);
    return { ...nextShift };
  }

  openShift({ branchId, openingCashIdr, cashierId = this.cashierId } = {}) {
    const state = this.repository.load();
    const amount = Number(openingCashIdr);
    if (this.branchScopeId && branchId !== this.branchScopeId) {
      throw new PosError("SHIFT_BRANCH_SCOPE_MISMATCH", "Sesi kasir demo hanya dapat membuka shift pada cabang yang ditugaskan.");
    }
    if (activeShiftFor(state, cashierId)) {
      throw new PosError("SHIFT_ALREADY_ACTIVE", "Kasir demo sudah memiliki shift aktif.");
    }
    if (!state.branches.some((branch) => branch.branch_id === branchId && branch.status === "active")) {
      throw new PosError("SHIFT_BRANCH_INVALID", "Pilih cabang aktif untuk membuka shift.", { branchId: "Pilih cabang aktif." });
    }
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new PosError("SHIFT_OPENING_CASH_INVALID", "Saldo awal kas harus berupa integer rupiah nonnegatif.", { openingCashIdr: "Masukkan saldo awal rupiah bulat, nol atau lebih." });
    }
    const branchWarehouse = state.warehouses.find((warehouse) => warehouse.branch_id === branchId && warehouse.warehouse_type === "BRANCH" && warehouse.status === "active");
    if (!branchWarehouse) throw new PosError("SHIFT_WAREHOUSE_MISSING", "Gudang cabang aktif untuk POS tidak ditemukan.");
    const timestamp = timestampNow(this.now);
    const shiftId = this.idFactory("SHIFT");
    const shift = {
      shift_id: shiftId,
      cashier_id: cashierId,
      branch_id: branchId,
      warehouse_id: branchWarehouse.warehouse_id,
      opening_cash_idr: amount,
      opened_at: timestamp,
      status: "active",
      ...(this.simulationDatasetId ? { simulation_dataset_id: String(this.simulationDatasetId) } : {}),
    };
    const next = clone(state);
    ["cashShifts", "sales", "payments", "cashMovements"].forEach((key) => assertCollection(next, key));
    next.cashShifts.push(shift);
    this.#commit(next);
    return { ...shift, expected_cash_idr: amount };
  }

  quoteCart({ branchId, items, effectiveDate = null } = {}) {
    if (this.branchScopeId && branchId !== this.branchScopeId) {
      throw new PosError("POS_BRANCH_SCOPE_MISMATCH", "Sesi kasir demo hanya dapat melihat harga pada cabang yang ditugaskan.");
    }
    const state = this.repository.load();
    const timestamp = timestampNow(this.now);
    const date = String(effectiveDate ?? businessDate(timestamp));
    const quote = this.#buildQuote(state, { branchId, items, effectiveDate: date });
    const shift = activeShiftFor(state, this.cashierId);
    quote.shift = shift ? { ...shift, expected_cash_idr: expectedCashFor(state, shift.shift_id) } : null;
    quote.checkoutFingerprint = cartFingerprint(quote);
    return quote;
  }

  checkout({ branchId, items, tenderedAmountIdr, idempotencyKey, expectedFingerprint, cashierId = this.cashierId } = {}) {
    if (this.branchScopeId && branchId !== this.branchScopeId) {
      throw new PosError("POS_BRANCH_SCOPE_MISMATCH", "Sesi kasir demo hanya dapat checkout pada cabang yang ditugaskan.");
    }
    const key = String(idempotencyKey ?? "").trim();
    if (!key || key.length > 160) throw new PosError("POS_IDEMPOTENCY_KEY_INVALID", "Kunci checkout unik wajib tersedia.");
    const tendered = Number(tenderedAmountIdr);
    if (!Number.isSafeInteger(tendered) || tendered < 0) {
      throw new PosError("POS_CASH_INVALID", "Uang tunai diterima harus berupa integer rupiah nonnegatif.", { tenderedAmountIdr: "Masukkan nominal rupiah bulat." });
    }

    const state = this.repository.load();
    const priorSale = (state.sales ?? []).find((sale) => sale.idempotency_key === key);
    const idempotencyFingerprint = JSON.stringify({ expectedFingerprint: String(expectedFingerprint ?? ""), tendered });
    if (priorSale) {
      const activeShift = activeShiftFor(state, cashierId);
      if (!activeShift) throw new PosError("SHIFT_REQUIRED", "Shift transaksi tersebut sudah ditutup; checkout ulang ditolak.");
      if (activeShift.branch_id !== branchId || priorSale.branch_id !== branchId || priorSale.shift_id !== activeShift.shift_id) {
        throw new PosError("SHIFT_BRANCH_MISMATCH", "Checkout ulang harus memakai cabang dan shift aktif yang sama dengan transaksi asal.");
      }
      if (priorSale.idempotency_fingerprint !== idempotencyFingerprint) {
        throw new PosError("POS_IDEMPOTENCY_CONFLICT", "Kunci checkout ini sudah digunakan untuk isi keranjang atau nominal tunai yang berbeda.");
      }
      const payment = (state.payments ?? []).find((item) => item.sale_id === priorSale.sale_id);
      return { sale: clone(priorSale), payment: payment ? clone(payment) : null, isDuplicate: true };
    }

    const timestamp = timestampNow(this.now);
    const effectiveDate = businessDate(timestamp);
    const shift = activeShiftFor(state, cashierId);
    if (!shift) throw new PosError("SHIFT_REQUIRED", "Buka shift kasir sebelum menyelesaikan transaksi tunai.");
    if (shift.branch_id !== branchId) throw new PosError("SHIFT_BRANCH_MISMATCH", "Cabang keranjang harus sama dengan cabang shift aktif.");

    let quote;
    try {
      quote = this.#buildQuote(state, { branchId, items, effectiveDate });
    } catch (error) {
      throw this.#asPosError(error);
    }
    quote.checkoutFingerprint = cartFingerprint(quote);
    if (String(expectedFingerprint ?? "") !== quote.checkoutFingerprint) {
      throw new PosError("POS_QUOTE_STALE", "Harga, aturan, atau alokasi batch berubah. Tinjau ulang keranjang sebelum checkout.");
    }
    if (tendered < quote.net_total_idr) {
      throw new PosError("POS_CASH_INSUFFICIENT", `Uang tunai kurang. Total yang harus dibayar ${quote.net_total_idr} rupiah.`, {
        tenderedAmountIdr: "Nominal tunai belum mencukupi total transaksi.",
      }, { netTotalIdr: quote.net_total_idr });
    }

    const next = clone(state);
    ["cashShifts", "sales", "payments", "cashMovements"].forEach((collection) => assertCollection(next, collection));
    const saleId = this.idFactory("SALE");
    const transactionSuffix = saleId.split("-").slice(1).join("").replace(/[^A-Z0-9]/gi, "").slice(-16).toUpperCase();
    const transactionNumber = `TRX-${effectiveDate.replaceAll("-", "")}-${transactionSuffix}`;
    const existingIds = new Set(next.sales.map((sale) => sale.sale_id));
    if (existingIds.has(saleId) || next.sales.some((sale) => sale.transaction_number === transactionNumber)) {
      throw new PosError("POS_TRANSACTION_ID_CONFLICT", "ID transaksi sudah digunakan. Muat ulang dan coba kembali.");
    }

    const itemsSnapshot = quote.lines.map((line) => ({
      sale_item_id: this.idFactory("ITEM"),
      product_id: line.product.product_id,
      sku_snapshot: line.product.sku,
      name_snapshot: line.product.name,
      category_id: line.product.category_id,
      quantity: line.quantity,
      base_price_snapshot_idr: line.base_price_idr,
      regional_adjustment_percent: line.adjustment_percent,
      price_rule_snapshot: clone(line.rule),
      regular_unit_price_idr: line.regular_price_idr,
      regular_line_total_idr: line.regular_line_total_idr,
      discount_total_idr: line.discount_total_idr,
      final_line_total_idr: line.final_line_total_idr,
      allocations: line.allocations.map((allocation) => ({
        allocation_id: this.idFactory("ALLOC"),
        inventory_batch_id: allocation.inventory_batch_id,
        lot_number_snapshot: allocation.lot_number,
        expiry_date_snapshot: allocation.expiry_date,
        rotation_policy_snapshot: allocation.rotation_policy,
        allocated_quantity: allocation.allocated_quantity,
        regular_unit_price_idr: line.regular_price_idr,
        unit_discount_idr: allocation.unit_discount_idr,
        final_unit_price_idr: allocation.final_unit_price_idr,
        promotion_snapshot: allocation.promotion ? clone(allocation.promotion) : null,
      })),
    }));
    const sale = {
      sale_id: saleId,
      transaction_number: transactionNumber,
      idempotency_key: key,
      idempotency_fingerprint: idempotencyFingerprint,
      branch_id: branchId,
      warehouse_id: shift.warehouse_id,
      cashier_id: cashierId,
      shift_id: shift.shift_id,
      status: "completed",
      currency: "IDR",
      effective_date: effectiveDate,
      created_at: timestamp,
      gross_total_idr: quote.gross_total_idr,
      discount_total_idr: quote.discount_total_idr,
      net_total_idr: quote.net_total_idr,
      items: itemsSnapshot,
      receipt_footer_snapshot: String(this.receiptFooterProvider?.() ?? "").trim().slice(0, 120),
      ...(this.simulationDatasetId ? { simulation_dataset_id: String(this.simulationDatasetId) } : {}),
    };
    const payment = {
      payment_id: this.idFactory("PAY"),
      sale_id: saleId,
      method: "CASH",
      channel: "SIMULATION",
      amount_idr: quote.net_total_idr,
      received_amount_idr: tendered,
      change_idr: tendered - quote.net_total_idr,
      status: "confirmed",
      confirmed_at: timestamp,
    };
    const cashMovement = {
      cash_movement_id: this.idFactory("CASH"),
      shift_id: shift.shift_id,
      sale_id: saleId,
      movement_type: "CASH_SALE_NET",
      amount_idr: quote.net_total_idr,
      occurred_at: timestamp,
    };
    const expectedCashAfterSale = expectedCashFor(state, shift.shift_id) + cashMovement.amount_idr;
    if (!Number.isSafeInteger(expectedCashAfterSale) || expectedCashAfterSale < 0) {
      throw new PosError("SHIFT_CASH_UNSAFE", "Transaksi ini akan membuat saldo ekspektasi kas melampaui batas aman.");
    }

    const batchById = new Map(state.inventoryBatches.map((batch) => [batch.inventory_batch_id, batch]));
    for (const line of itemsSnapshot) {
      for (const allocation of line.allocations) {
        const batch = batchById.get(allocation.inventory_batch_id);
        if (!batch) throw new PosError("POS_BATCH_NOT_FOUND", "Batch alokasi tidak tersedia pada snapshot checkout.");
        next.stockMovements.push({
          movement_id: this.idFactory("MOV"),
          inventory_batch_id: batch.inventory_batch_id,
          warehouse_id: batch.warehouse_id,
          stock_location_id: batch.stock_location_id,
          stock_bucket: "AVAILABLE",
          quantity_delta: -allocation.allocated_quantity,
          movement_type: "SALE",
          reference_type: "SALE_TRANSACTION",
          reference_id: saleId,
          reason: `Penjualan tunai simulasi ${transactionNumber}`,
          actor_id: cashierId,
          occurred_at: timestamp,
          effective_date: effectiveDate,
        });
      }
    }
    next.sales.push(sale);
    next.payments.push(payment);
    next.cashMovements.push(cashMovement);
    try {
      this.#commit(next);
    } catch (error) {
      throw this.#asPosError(error, "POS_COMMIT_FAILED");
    }
    return {
      sale: clone(sale),
      payment: clone(payment),
      cash_shift: { ...shift, expected_cash_idr: expectedCashAfterSale },
      isDuplicate: false,
    };
  }

  #buildQuote(state, { branchId, items, effectiveDate }) {
    if (!isValidDateOnly(effectiveDate)) throw new PosError("POS_DATE_INVALID", "Tanggal transaksi harus berupa tanggal YYYY-MM-DD yang valid.");
    const branch = state.branches.find((item) => item.branch_id === branchId && item.status === "active");
    if (!branch) throw new PosError("POS_BRANCH_INVALID", "Cabang POS aktif tidak ditemukan.", { branchId: "Pilih cabang aktif." });
    const warehouse = state.warehouses.find((item) => item.branch_id === branchId && item.warehouse_type === "BRANCH" && item.status === "active");
    if (!warehouse) throw new PosError("POS_WAREHOUSE_MISSING", "Gudang aktif untuk cabang POS tidak ditemukan.");
    if (!Array.isArray(items) || items.length === 0) throw new PosError("POS_CART_EMPTY", "Keranjang masih kosong.");
    const seenProducts = new Set();
    const lines = items.map((entry) => {
      const productId = String(entry?.productId ?? entry?.product_id ?? "").trim();
      const quantity = Number(entry?.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new PosError("POS_QUANTITY_INVALID", "Kuantitas setiap produk harus berupa integer positif.", { quantity: "Masukkan jumlah unit bulat yang lebih besar dari nol." });
      }
      if (seenProducts.has(productId)) throw new PosError("POS_DUPLICATE_CART_LINE", "Setiap produk hanya boleh muncul sekali di keranjang.");
      seenProducts.add(productId);
      let price;
      let plan;
      try {
        price = this.pricingService.resolvePrice({ productId, branchId, effectiveDate, state });
        plan = this.inventoryService.planAllocation({ state, warehouseId: warehouse.warehouse_id, productId, quantity, effectiveDate });
      } catch (error) {
        throw this.#asPosError(error);
      }
      const regularLineTotal = price.regularPriceIdr * quantity;
      if (!Number.isSafeInteger(regularLineTotal)) throw new PosError("POS_TOTAL_UNSAFE", "Total baris melebihi nominal rupiah aman.");
      let discountTotal = 0;
      const allocations = plan.allocations.map((allocation) => {
        const promo = DEMO_BATCH_DISCOUNTS[allocation.inventory_batch_id];
        const applicablePromo = promo
          && promo.product_id === productId
          && promo.lot_number === allocation.lot_number
          ? promo : null;
        const unitDiscount = applicablePromo ? applicablePromo.unit_discount_idr : 0;
        if (unitDiscount > price.regularPriceIdr) throw new PosError("POS_DISCOUNT_UNSAFE", "Diskon batch melebihi harga reguler produk.");
        const discountForAllocation = unitDiscount * allocation.allocated_quantity;
        if (!Number.isSafeInteger(discountForAllocation)) throw new PosError("POS_TOTAL_UNSAFE", "Nilai diskon melebihi nominal rupiah aman.");
        discountTotal += discountForAllocation;
        return {
          ...allocation,
          unit_discount_idr: unitDiscount,
          final_unit_price_idr: price.regularPriceIdr - unitDiscount,
          promotion: applicablePromo ? {
            promotion_id: applicablePromo.promotion_id,
            name: applicablePromo.promotion_name,
            unit_discount_idr: applicablePromo.unit_discount_idr,
          } : null,
        };
      });
      const finalLineTotal = regularLineTotal - discountTotal;
      if (!Number.isSafeInteger(finalLineTotal) || finalLineTotal < 0) throw new PosError("POS_TOTAL_UNSAFE", "Total setelah diskon tidak valid.");
      return {
        product: { ...price.product },
        quantity,
        base_price_idr: price.basePriceIdr,
        adjustment_percent: price.adjustmentPercent,
        regular_price_idr: price.regularPriceIdr,
        regular_line_total_idr: regularLineTotal,
        discount_total_idr: discountTotal,
        final_line_total_idr: finalLineTotal,
        rule: { ...price.rule },
        allocations,
      };
    });
    const grossTotal = lines.reduce((sum, line) => sum + line.regular_line_total_idr, 0);
    const discountTotal = lines.reduce((sum, line) => sum + line.discount_total_idr, 0);
    const netTotal = grossTotal - discountTotal;
    if (![grossTotal, discountTotal, netTotal].every(Number.isSafeInteger) || netTotal < 0) {
      throw new PosError("POS_TOTAL_UNSAFE", "Ringkasan transaksi melebihi nominal rupiah aman.");
    }
    return {
      branch: { branch_id: branch.branch_id, name: branch.name, region_id: branch.region_id },
      warehouse: { warehouse_id: warehouse.warehouse_id, name: warehouse.name },
      effectiveDate,
      lines,
      gross_total_idr: grossTotal,
      discount_total_idr: discountTotal,
      net_total_idr: netTotal,
      isPreview: true,
      paymentStatus: "unpaid",
    };
  }

  #asPosError(error, fallbackCode = "POS_VALIDATION_FAILED") {
    if (error instanceof PosError) return error;
    return new PosError(error?.code ?? fallbackCode, error?.message ?? "Transaksi tidak dapat diproses.", error?.fieldErrors ?? {}, error?.details ?? {}, error);
  }

  #commit(next) {
    try {
      this.repository.commit(next);
    } catch (error) {
      throw this.#asPosError(error, "POS_COMMIT_FAILED");
    }
  }
}

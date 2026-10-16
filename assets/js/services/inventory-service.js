import { PHYSICAL_STOCK_BUCKETS, ROTATION_POLICIES, STOCK_BUCKETS } from "../data/inventory-seed.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isValidDateOnly(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isValidTimestamp(value) {
  return typeof value === "string" && TIMESTAMP_PATTERN.test(value) && isValidDateOnly(value.slice(0, 10)) && !Number.isNaN(Date.parse(value));
}

function bucketKey(batchId, bucket) {
  return `${batchId}::${bucket}`;
}

function businessDate(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function movementEffectiveDate(movement) {
  return movement.effective_date ?? businessDate(movement.occurred_at);
}

function balancesFor(state, effectiveDate = null) {
  const balances = new Map();
  for (const movement of state.stockMovements) {
    if (effectiveDate && movementEffectiveDate(movement) > effectiveDate) continue;
    const key = bucketKey(movement.inventory_batch_id, movement.stock_bucket);
    balances.set(key, (balances.get(key) ?? 0) + movement.quantity_delta);
  }
  return balances;
}

function eligibleBatches(state, warehouseId, productId, effectiveDate, balances) {
  return state.inventoryBatches
    .filter((batch) => batch.warehouse_id === warehouseId && batch.product_id === productId)
    .map((batch) => ({
      ...batch,
      available: balances.get(bucketKey(batch.inventory_batch_id, "AVAILABLE")) ?? 0,
    }))
    .filter((batch) => batch.available > 0
      && businessDate(batch.received_at) <= effectiveDate
      && (!batch.expiry_date || batch.expiry_date > effectiveDate));
}

function validateRotationPolicies(candidates, fieldErrors = {}) {
  const policies = new Set(candidates.map((batch) => batch.rotation_policy));
  if (policies.size > 1) {
    throw new InventoryError("INVENTORY_ROTATION_POLICY_MIXED", "Batch layak jual untuk produk dan gudang ini memakai kebijakan rotasi berbeda. Samakan konfigurasi sebelum menambah saldo layak jual atau melakukan simulasi.", fieldErrors);
  }
  return policies.values().next().value ?? null;
}

export function planInventoryAllocation({ state, warehouseId, productId, quantity, effectiveDate } = {}) {
  const qty = Number(quantity);
  if (!Number.isSafeInteger(qty) || qty <= 0) {
    throw new InventoryError("INVENTORY_QUANTITY_INVALID", "Jumlah simulasi harus berupa bilangan bulat positif.", { quantity: "Masukkan jumlah unit bulat yang lebih besar dari 0." });
  }
  const date = String(effectiveDate ?? state?.meta?.reference_date ?? "");
  if (!state || !isValidDateOnly(date)) throw new InventoryError("INVENTORY_DATE_INVALID", "Tanggal simulasi harus berupa tanggal kalender yang valid.", { effectiveDate: "Masukkan tanggal YYYY-MM-DD yang valid." });
  if (!state.warehouses.some((item) => item.warehouse_id === warehouseId && item.status === "active")) {
    throw new InventoryError("INVENTORY_WAREHOUSE_NOT_FOUND", "Gudang aktif untuk simulasi tidak ditemukan.", { warehouseId: "Pilih gudang yang tersedia." });
  }
  const product = state.products.find((item) => item.product_id === productId && item.status === "active");
  if (!product) throw new InventoryError("INVENTORY_PRODUCT_NOT_FOUND", "Produk aktif untuk simulasi tidak ditemukan.", { productId: "Pilih produk aktif." });

  const balances = balancesFor(state, date);
  const candidates = eligibleBatches(state, warehouseId, productId, date, balances);
  const rotationPolicy = validateRotationPolicies(candidates);
  if (rotationPolicy === "FEFO" && candidates.some((batch) => !batch.expiry_date)) {
    throw new InventoryError("INVENTORY_ROTATION_POLICY_INVALID", "FEFO memerlukan tanggal kedaluwarsa pada setiap batch yang dialokasikan.");
  }
  if (rotationPolicy === "FEFO") {
    candidates.sort((left, right) => left.expiry_date.localeCompare(right.expiry_date)
      || left.received_at.localeCompare(right.received_at)
      || left.inventory_batch_id.localeCompare(right.inventory_batch_id));
  } else if (rotationPolicy === "FIFO") {
    candidates.sort((left, right) => left.received_at.localeCompare(right.received_at)
      || left.inventory_batch_id.localeCompare(right.inventory_batch_id));
  }
  const eligibleQuantity = candidates.reduce((sum, batch) => sum + batch.available, 0);
  if (eligibleQuantity < qty) {
    throw new InventoryError("INVENTORY_STOCK_INSUFFICIENT", `Stok layak jual tidak cukup. Tersedia ${eligibleQuantity} unit pada gudang dan tanggal simulasi ini.`, {
      details: { eligibleQuantity, requestedQuantity: qty },
    });
  }
  let remaining = qty;
  const allocations = [];
  for (const batch of candidates) {
    if (remaining === 0) break;
    const allocated = Math.min(batch.available, remaining);
    allocations.push({ inventory_batch_id: batch.inventory_batch_id, lot_number: batch.lot_number, expiry_date: batch.expiry_date, rotation_policy: batch.rotation_policy, allocated_quantity: allocated });
    remaining -= allocated;
  }
  return {
    product: { product_id: product.product_id, sku: product.sku, name: product.name },
    warehouse: { ...state.warehouses.find((item) => item.warehouse_id === warehouseId) },
    effectiveDate: date,
    rotationPolicy,
    requestedQuantity: qty,
    allocatedQuantity: qty,
    allocations,
    isSimulation: true,
  };
}

function validateAvailableIncreaseRotation({ state, batch, effectiveDate, balances, nextAvailable, field }) {
  if (nextAvailable <= 0
    || businessDate(batch.received_at) > effectiveDate
    || (batch.expiry_date && batch.expiry_date <= effectiveDate)) return;

  const candidates = eligibleBatches(state, batch.warehouse_id, batch.product_id, effectiveDate, balances)
    .filter((candidate) => candidate.inventory_batch_id !== batch.inventory_batch_id);
  candidates.push({ ...batch, available: nextAvailable });
  validateRotationPolicies(candidates, {
    [field]: "Penambahan saldo akan mencampur kebijakan FEFO/FIFO pada batch layak jual produk dan gudang ini.",
  });
}

function sumBuckets(balances, batchId, buckets) {
  return buckets.reduce((sum, bucket) => sum + (balances.get(bucketKey(batchId, bucket)) ?? 0), 0);
}

function requireReason(value) {
  const reason = String(value ?? "").trim();
  if (!reason) throw new InventoryError("INVENTORY_REASON_REQUIRED", "Alasan wajib diisi sebelum stok dicatat atau disesuaikan.", { reason: "Masukkan alasan perubahan stok." });
  if (reason.length > 240) throw new InventoryError("INVENTORY_REASON_TOO_LONG", "Alasan maksimal 240 karakter.", { reason: "Gunakan maksimal 240 karakter." });
  return reason;
}

function timestampNow(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new InventoryError("INVENTORY_TIMESTAMP_INVALID", "Waktu pencatatan stok tidak valid.");
  return date.toISOString();
}

function makeId(prefix) {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 12)
    ?? Math.random().toString(36).slice(2, 14);
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${random.toUpperCase()}`;
}

export class InventoryError extends Error {
  constructor(code, message, fieldErrors = {}) {
    super(message);
    this.name = "InventoryError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export class InventoryService {
  constructor({ repository, now = () => new Date(), idFactory = makeId, actorId = "DEMO-WAREHOUSE-USER" } = {}) {
    if (!repository || typeof repository.load !== "function" || typeof repository.commit !== "function") {
      throw new TypeError("InventoryService membutuhkan inventory repository.");
    }
    this.repository = repository;
    this.now = now;
    this.idFactory = idFactory;
    this.actorId = actorId;
  }

  getWorkspace({ warehouseId = "all", productId = "all", bucket = "all", effectiveDate = null } = {}) {
    const state = this.repository.load();
    const date = String(effectiveDate ?? businessDate(timestampNow(this.now)));
    if (!isValidDateOnly(date)) throw new InventoryError("INVENTORY_DATE_INVALID", "Tanggal saldo harus berupa tanggal kalender yang valid.");
    const balances = balancesFor(state, date);
    const warehousesById = new Map(state.warehouses.map((item) => [item.warehouse_id, item]));
    const locationsById = new Map(state.stockLocations.map((item) => [item.stock_location_id, item]));
    const productsById = new Map(state.products.map((item) => [item.product_id, item]));
    const allBatches = state.inventoryBatches.map((batch) => {
      const stockBalances = Object.fromEntries(STOCK_BUCKETS.map((key) => [key, balances.get(bucketKey(batch.inventory_batch_id, key)) ?? 0]));
      const isExpiredByDate = Boolean(batch.expiry_date && batch.expiry_date <= date);
      const sellableQuantity = isExpiredByDate ? 0 : stockBalances.AVAILABLE;
      return {
        ...batch,
        product: productsById.get(batch.product_id),
        warehouse: warehousesById.get(batch.warehouse_id),
        location: locationsById.get(batch.stock_location_id),
        balances: stockBalances,
        physicalQuantity: PHYSICAL_STOCK_BUCKETS.reduce((sum, key) => sum + stockBalances[key], 0),
        sellableQuantity,
        expiryState: isExpiredByDate ? "expired-by-date" : "within-date",
      };
    });
    const matchesFilters = (item) => (
      (warehouseId === "all" || item.warehouse_id === warehouseId)
      && (productId === "all" || item.product_id === productId)
      && (bucket === "all" || item.balances[bucket] > 0)
    );
    const filteredBatches = allBatches.filter(matchesFilters);
    const visibleBatchIds = new Set(filteredBatches.map((item) => item.inventory_batch_id));
    const summaryBatches = allBatches.filter((item) => warehouseId === "all" || item.warehouse_id === warehouseId)
      .filter((item) => productId === "all" || item.product_id === productId);
    const summary = {
      physical: summaryBatches.reduce((sum, item) => sum + item.physicalQuantity, 0),
      sellable: summaryBatches.reduce((sum, item) => sum + item.sellableQuantity, 0),
      quarantine: summaryBatches.reduce((sum, item) => sum + item.balances.QUARANTINE, 0),
      damaged: summaryBatches.reduce((sum, item) => sum + item.balances.DAMAGED, 0),
      expired: summaryBatches.reduce((sum, item) => sum + item.balances.EXPIRED
        + (item.expiryState === "expired-by-date" ? item.balances.AVAILABLE : 0), 0),
      inTransit: summaryBatches.reduce((sum, item) => sum + item.balances.IN_TRANSIT, 0),
    };
    const movements = state.stockMovements
      .filter((item) => visibleBatchIds.has(item.inventory_batch_id))
      .filter((item) => movementEffectiveDate(item) <= date)
      .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at) || right.movement_id.localeCompare(left.movement_id))
      .map((item) => ({
        ...item,
        effective_date: movementEffectiveDate(item),
        batch: allBatches.find((batch) => batch.inventory_batch_id === item.inventory_batch_id),
      }));
    return {
      effectiveDate: date,
      warehouses: state.warehouses.map((item) => ({ ...item })),
      branches: state.branches.map((item) => ({ ...item })),
      stockLocations: state.stockLocations.map((item) => ({ ...item })),
      products: state.products.map((item) => ({ ...item })),
      batches: filteredBatches,
      movements,
      summary,
    };
  }

  getBatchBalances(inventoryBatchId, state = this.repository.load()) {
    const balances = balancesFor(state);
    return Object.fromEntries(STOCK_BUCKETS.map((bucket) => [bucket, balances.get(bucketKey(inventoryBatchId, bucket)) ?? 0]));
  }

  validateAvailableRotation({ warehouseId, productId, effectiveDate, state = this.repository.load() } = {}) {
    const date = String(effectiveDate ?? state?.meta?.reference_date ?? "");
    if (!isValidDateOnly(date)) throw new InventoryError("INVENTORY_DATE_INVALID", "Tanggal validasi rotasi harus berupa tanggal kalender yang valid.", { effectiveDate: "Masukkan tanggal YYYY-MM-DD yang valid." });
    const candidates = eligibleBatches(state, warehouseId, productId, date, balancesFor(state, date));
    const rotationPolicy = validateRotationPolicies(candidates);
    if (rotationPolicy === "FEFO" && candidates.some((batch) => !batch.expiry_date)) {
      throw new InventoryError("INVENTORY_ROTATION_POLICY_INVALID", "FEFO memerlukan tanggal kedaluwarsa pada setiap batch layak jual.");
    }
    return rotationPolicy;
  }

  planAllocation({ warehouseId, productId, quantity, effectiveDate, state = this.repository.load() } = {}) {
    return planInventoryAllocation({ state, warehouseId, productId, quantity, effectiveDate });
  }

  simulateAllocation({ warehouseId, productId, quantity, effectiveDate } = {}) {
    return this.planAllocation({ warehouseId, productId, quantity, effectiveDate });
  }

  recordOpeningStock({ productId, warehouseId, stockLocationId, lotNumber, receivedAt, expiryDate = "", rotationPolicy, quantities = {}, reason, actorId = this.actorId } = {}) {
    const state = this.repository.load();
    const trimmedReason = requireReason(reason);
    const fieldErrors = {};
    const product = state.products.find((item) => item.product_id === productId && item.status === "active");
    const warehouse = state.warehouses.find((item) => item.warehouse_id === warehouseId && item.status === "active");
    const location = state.stockLocations.find((item) => item.stock_location_id === stockLocationId && item.warehouse_id === warehouseId && item.status === "active");
    const lot = String(lotNumber ?? "").trim();
    const validExpiry = expiryDate === "" || expiryDate === null || isValidDateOnly(expiryDate);
    if (!product) fieldErrors.productId = "Pilih produk aktif.";
    if (!warehouse) fieldErrors.warehouseId = "Pilih gudang aktif.";
    if (!location) fieldErrors.stockLocationId = "Pilih lokasi pada gudang yang dipilih.";
    if (!lot || lot.length > 80) fieldErrors.lotNumber = "Nomor lot wajib diisi (maksimal 80 karakter).";
    if (!isValidTimestamp(receivedAt)) fieldErrors.receivedAt = "Tanggal penerimaan tidak valid.";
    if (!validExpiry) fieldErrors.expiryDate = "Tanggal kedaluwarsa tidak valid.";
    if (!ROTATION_POLICIES.includes(rotationPolicy)) fieldErrors.rotationPolicy = "Pilih kebijakan FEFO atau FIFO secara eksplisit.";
    const normalizedExpiry = expiryDate || null;
    if (product?.expiry_policy === "required" && !normalizedExpiry) fieldErrors.expiryDate = "Produk ini mewajibkan tanggal kedaluwarsa per batch.";
    if (rotationPolicy === "FEFO" && !normalizedExpiry) fieldErrors.expiryDate = "Kebijakan rotasi FEFO memerlukan tanggal kedaluwarsa.";
    if (product?.expiry_policy === "not_required" && normalizedExpiry) {
      fieldErrors.expiryDate = "Produk ini ditandai tidak menggunakan tanggal kedaluwarsa.";
    }
    const quantitiesByBucket = {};
    for (const bucket of PHYSICAL_STOCK_BUCKETS) {
      const raw = quantities[bucket] ?? 0;
      const amount = raw === "" ? 0 : Number(raw);
      if (!Number.isSafeInteger(amount) || amount < 0) fieldErrors[`quantity_${bucket}`] = "Jumlah harus berupa integer nol atau lebih.";
      quantitiesByBucket[bucket] = amount;
    }
    if (Object.hasOwn(quantities, "IN_TRANSIT")) fieldErrors.quantities = "Stok in-transit hanya dapat dibuat melalui alur distribusi.";
    if (Object.values(quantitiesByBucket).every((amount) => Number.isSafeInteger(amount))
      && Object.values(quantitiesByBucket).reduce((sum, amount) => sum + amount, 0) <= 0) {
      fieldErrors.quantities = "Catat sedikitnya satu unit saldo awal.";
    }
    if (Object.keys(fieldErrors).length) throw new InventoryError("INVENTORY_OPENING_INVALID", "Periksa kembali data batch dan saldo awal.", fieldErrors);

    const timestamp = timestampNow(this.now);
    const effectiveDate = businessDate(timestamp);
    if (businessDate(receivedAt) > effectiveDate) {
      throw new InventoryError("INVENTORY_RECEIPT_DATE_FUTURE", "Tanggal penerimaan tidak boleh melewati tanggal pencatatan stok.", { receivedAt: "Gunakan tanggal penerimaan hari ini atau tanggal sebelumnya." });
    }
    if (quantitiesByBucket.AVAILABLE > 0 && normalizedExpiry && normalizedExpiry <= effectiveDate) {
      throw new InventoryError("INVENTORY_BATCH_EXPIRED", "Batch yang kedaluwarsa pada atau sebelum tanggal efektif stok tidak dapat dicatat sebagai layak jual.", { AVAILABLE: "Gunakan kondisi kedaluwarsa untuk batch ini." });
    }
    if (quantitiesByBucket.EXPIRED > 0 && (!normalizedExpiry || normalizedExpiry > effectiveDate)) {
      throw new InventoryError("INVENTORY_EXPIRED_DATE_MISMATCH", "Saldo kedaluwarsa hanya dapat dicatat untuk batch dengan tanggal kedaluwarsa pada atau sebelum tanggal efektif stok.", { EXPIRED: "Pastikan tanggal kedaluwarsa batch sudah lewat." });
    }
    const duplicateLot = state.inventoryBatches.some((batch) => batch.product_id === productId
      && batch.warehouse_id === warehouseId
      && batch.stock_location_id === stockLocationId
      && batch.lot_number.trim().toLocaleLowerCase("id-ID") === lot.toLocaleLowerCase("id-ID"));
    if (duplicateLot) throw new InventoryError("INVENTORY_BATCH_DUPLICATE", "Nomor lot ini sudah tercatat untuk produk pada lokasi tersebut.", { lotNumber: "Gunakan nomor lot yang unik." });

    const currentBalances = balancesFor(state, effectiveDate);
    const existingCandidates = eligibleBatches(state, warehouseId, productId, effectiveDate, currentBalances);
    const incomingIsCandidate = quantitiesByBucket.AVAILABLE > 0
      && businessDate(receivedAt) <= effectiveDate
      && (!normalizedExpiry || normalizedExpiry > effectiveDate);
    if (incomingIsCandidate) {
      validateRotationPolicies([...existingCandidates, {
        rotation_policy: rotationPolicy,
      }]);
    }
    const batchId = this.idFactory("BAT");
    const referenceId = this.idFactory("OPEN");
    const batch = {
      inventory_batch_id: batchId,
      product_id: productId,
      warehouse_id: warehouseId,
      stock_location_id: stockLocationId,
      lot_number: lot,
      received_at: receivedAt,
      expiry_date: normalizedExpiry,
      rotation_policy: rotationPolicy,
      created_at: timestamp,
    };
    const movements = PHYSICAL_STOCK_BUCKETS
      .filter((bucket) => quantitiesByBucket[bucket] > 0)
      .map((bucket) => ({
        movement_id: this.idFactory("MOV"),
        inventory_batch_id: batchId,
        warehouse_id: warehouseId,
        stock_location_id: stockLocationId,
        stock_bucket: bucket,
        quantity_delta: quantitiesByBucket[bucket],
        movement_type: "OPENING_BALANCE",
        reference_type: "INITIAL_STOCK_RECORD",
        reference_id: referenceId,
        reason: trimmedReason,
        actor_id: actorId,
        occurred_at: timestamp,
        effective_date: effectiveDate,
      }));
    const next = clone(state);
    next.inventoryBatches.push(batch);
    next.stockMovements.push(...movements);
    this.repository.commit(next);
    return { batch: { ...batch }, movements: clone(movements) };
  }

  adjustStock({ inventoryBatchId, bucket, delta, reason, actorId = this.actorId } = {}) {
    const state = this.repository.load();
    const trimmedReason = requireReason(reason);
    const amount = Number(delta);
    if (!Number.isSafeInteger(amount) || amount === 0) {
      throw new InventoryError("INVENTORY_QUANTITY_INVALID", "Penyesuaian harus berupa integer bukan nol.", { delta: "Masukkan perubahan unit bulat, positif atau negatif." });
    }
    if (!PHYSICAL_STOCK_BUCKETS.includes(bucket)) {
      throw new InventoryError("INVENTORY_BUCKET_INVALID", "Mutasi manual hanya berlaku untuk kondisi stok fisik. Stok transit dikelola oleh alur distribusi.", { bucket: "Pilih kondisi stok fisik." });
    }
    const batch = state.inventoryBatches.find((item) => item.inventory_batch_id === inventoryBatchId);
    if (!batch) throw new InventoryError("INVENTORY_BATCH_NOT_FOUND", "Batch stok tidak ditemukan.", { inventoryBatchId: "Pilih batch yang tersedia." });
    const currentBalance = this.getBatchBalances(inventoryBatchId, state)[bucket];
    const nextBalance = currentBalance + amount;
    if (!Number.isSafeInteger(nextBalance) || nextBalance < 0) {
      throw new InventoryError("INVENTORY_NEGATIVE_BALANCE", `Saldo ${bucket} saat ini ${currentBalance}; penyesuaian tidak boleh menghasilkan saldo negatif atau overflow.`, { delta: "Jumlah melebihi saldo yang tersedia." });
    }
    const timestamp = timestampNow(this.now);
    const effectiveDate = businessDate(timestamp);
    if (amount > 0 && bucket === "AVAILABLE" && batch.expiry_date && batch.expiry_date <= effectiveDate) {
      throw new InventoryError("INVENTORY_BATCH_EXPIRED", "Batch kedaluwarsa tidak dapat ditambah ke saldo layak jual.", { bucket: "Pilih kondisi kedaluwarsa." });
    }
    if (amount > 0 && bucket === "EXPIRED" && (!batch.expiry_date || batch.expiry_date > effectiveDate)) {
      throw new InventoryError("INVENTORY_EXPIRED_DATE_MISMATCH", "Batch ini belum kedaluwarsa pada tanggal efektif stok.", { bucket: "Saldo kedaluwarsa tidak sesuai tanggal batch." });
    }
    if (amount > 0 && bucket === "AVAILABLE") {
      const effectiveBalances = balancesFor(state, effectiveDate);
      const availableAsOfDate = effectiveBalances.get(bucketKey(batch.inventory_batch_id, "AVAILABLE")) ?? 0;
      validateAvailableIncreaseRotation({
        state,
        batch,
        effectiveDate,
        balances: effectiveBalances,
        nextAvailable: availableAsOfDate + amount,
        field: "bucket",
      });
    }
    const referenceId = this.idFactory("ADJ");
    const movement = {
      movement_id: this.idFactory("MOV"),
      inventory_batch_id: batch.inventory_batch_id,
      warehouse_id: batch.warehouse_id,
      stock_location_id: bucket === "IN_TRANSIT" ? null : batch.stock_location_id,
      stock_bucket: bucket,
      quantity_delta: amount,
      movement_type: "ADJUSTMENT",
      reference_type: "STOCK_ADJUSTMENT",
      reference_id: referenceId,
      reason: trimmedReason,
      actor_id: actorId,
      occurred_at: timestamp,
      effective_date: effectiveDate,
    };
    const next = clone(state);
    next.stockMovements.push(movement);
    this.repository.commit(next);
    return { movement: { ...movement }, balance: nextBalance };
  }

  transferStock({ inventoryBatchId, fromBucket, toBucket, quantity, reason, actorId = this.actorId } = {}) {
    const state = this.repository.load();
    const trimmedReason = requireReason(reason);
    const amount = Number(quantity);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new InventoryError("INVENTORY_QUANTITY_INVALID", "Jumlah pindah kondisi harus berupa bilangan bulat positif.", { delta: "Masukkan jumlah unit bulat yang lebih besar dari 0." });
    }
    if (!PHYSICAL_STOCK_BUCKETS.includes(fromBucket) || !PHYSICAL_STOCK_BUCKETS.includes(toBucket) || fromBucket === toBucket) {
      throw new InventoryError("INVENTORY_TRANSFER_INVALID", "Pilih dua kondisi stok fisik yang berbeda.", {
        bucket: "Pilih kondisi asal stok fisik.",
        destinationBucket: "Pilih kondisi tujuan yang berbeda.",
      });
    }
    const batch = state.inventoryBatches.find((item) => item.inventory_batch_id === inventoryBatchId);
    if (!batch) throw new InventoryError("INVENTORY_BATCH_NOT_FOUND", "Batch stok tidak ditemukan.", { inventoryBatchId: "Pilih batch yang tersedia." });
    const balances = this.getBatchBalances(inventoryBatchId, state);
    const nextSource = balances[fromBucket] - amount;
    const nextDestination = balances[toBucket] + amount;
    if (!Number.isSafeInteger(nextSource) || nextSource < 0) {
      throw new InventoryError("INVENTORY_NEGATIVE_BALANCE", `Saldo ${fromBucket} saat ini ${balances[fromBucket]}; pindah kondisi melebihi unit yang tersedia.`, { delta: "Jumlah melebihi saldo kondisi asal." });
    }
    if (!Number.isSafeInteger(nextDestination) || nextDestination < 0) {
      throw new InventoryError("INVENTORY_BALANCE_UNSAFE", `Saldo ${toBucket} tidak dapat ditambah dengan aman.`, { delta: "Jumlah melebihi batas penyimpanan yang aman." });
    }
    const timestamp = timestampNow(this.now);
    const effectiveDate = businessDate(timestamp);
    if (toBucket === "AVAILABLE" && batch.expiry_date && batch.expiry_date <= effectiveDate) {
      throw new InventoryError("INVENTORY_BATCH_EXPIRED", "Batch kedaluwarsa tidak dapat dipindahkan ke saldo layak jual.", { destinationBucket: "Pilih kondisi kedaluwarsa atau karantina." });
    }
    if (toBucket === "EXPIRED" && (!batch.expiry_date || batch.expiry_date > effectiveDate)) {
      throw new InventoryError("INVENTORY_EXPIRED_DATE_MISMATCH", "Batch ini belum kedaluwarsa pada tanggal efektif stok.", { destinationBucket: "Saldo kedaluwarsa tidak sesuai tanggal batch." });
    }
    if (toBucket === "AVAILABLE") {
      const effectiveBalances = balancesFor(state, effectiveDate);
      const availableAsOfDate = effectiveBalances.get(bucketKey(batch.inventory_batch_id, "AVAILABLE")) ?? 0;
      validateAvailableIncreaseRotation({
        state,
        batch,
        effectiveDate,
        balances: effectiveBalances,
        nextAvailable: availableAsOfDate + amount,
        field: "destinationBucket",
      });
    }

    const referenceId = this.idFactory("TRF");
    const createMovement = (bucket, quantityDelta) => ({
      movement_id: this.idFactory("MOV"),
      inventory_batch_id: batch.inventory_batch_id,
      warehouse_id: batch.warehouse_id,
      stock_location_id: batch.stock_location_id,
      stock_bucket: bucket,
      quantity_delta: quantityDelta,
      movement_type: "CONDITION_TRANSFER",
      reference_type: "STOCK_CONDITION_TRANSFER",
      reference_id: referenceId,
      reason: trimmedReason,
      actor_id: actorId,
      occurred_at: timestamp,
      effective_date: effectiveDate,
    });
    const movements = [createMovement(fromBucket, -amount), createMovement(toBucket, amount)];
    const next = clone(state);
    next.stockMovements.push(...movements);
    this.repository.commit(next);
    return {
      movements: clone(movements),
      balances: { [fromBucket]: nextSource, [toBucket]: nextDestination },
      physicalQuantity: PHYSICAL_STOCK_BUCKETS.reduce((sum, bucket) => sum + (bucket === fromBucket ? nextSource : bucket === toBucket ? nextDestination : balances[bucket]), 0),
    };
  }
}

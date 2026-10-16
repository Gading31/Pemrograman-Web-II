import { createDemoSeed, DEMO_REFERENCE_DATE, DEMO_SCHEMA_VERSION } from "../data/demo-seed.js";
import {
  BRANCH_EXPANSION_MIGRATION_ID,
  EXPANSION_BRANCHES,
  EXPANSION_REGIONS,
  EXPANSION_STOCK_LOCATIONS,
  EXPANSION_WAREHOUSES,
} from "../data/branch-expansion.js";
import { createInventorySeed, INVENTORY_COLLECTION_KEYS, PHYSICAL_STOCK_BUCKETS, ROTATION_POLICIES, STOCK_BUCKETS } from "../data/inventory-seed.js";
import {
  CATALOG_EXPANSION_CATEGORIES,
  CATALOG_EXPANSION_MIGRATION_ID,
  CATALOG_EXPANSION_IDENTITY_META_KEY,
  createCanonicalProductExpansion,
  createCatalogExpansionIdentityManifest,
  createCatalogExpansionPricingRules,
} from "../data/catalog-expansion.js";

export const DEMO_STORAGE_KEY = "nusantara-pos-demo-state";
const POS_COLLECTION_KEYS = Object.freeze(["cashShifts", "sales", "payments", "cashMovements"]);
const DISTRIBUTION_COLLECTION_KEYS = Object.freeze(["stockRequests", "stockTransfers", "distributionReceipts", "distributionEvents"]);
const CATALOG_COLLECTION_KEYS = Object.freeze(["categories", "products", "pricingRules"]);

export class RepositoryError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "RepositoryError";
    this.code = code;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertCollectionIds(collection, key, label) {
  if (!Array.isArray(collection)) {
    throw new RepositoryError("STORAGE_DATA_INVALID", `Daftar ${label} pada penyimpanan demo tidak valid.`);
  }
  const ids = new Set();
  for (const record of collection) {
    if (!record || typeof record !== "object" || typeof record[key] !== "string" || !record[key].trim()) {
      throw new RepositoryError("STORAGE_DATA_INVALID", `Ada data ${label} tanpa ID yang valid.`);
    }
    if (ids.has(record[key])) {
      throw new RepositoryError("STORAGE_DATA_INVALID", `ID ${label} ganda pada penyimpanan demo.`);
    }
    ids.add(record[key]);
  }
  return ids;
}

function isValidDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function priceRulePeriodsOverlap(left, right) {
  const leftEndsAfterRightStarts = left.valid_until === null || right.valid_from <= left.valid_until;
  const rightEndsAfterLeftStarts = right.valid_until === null || left.valid_from <= right.valid_until;
  return leftEndsAfterRightStarts && rightEndsAfterLeftStarts;
}

function branchExpansionMigrationPreservesExisting(previous, next, { allowInventoryMigration = false, allowDistributionMigration = false, allowCatalogMigration = false } = {}) {
  const before = clone(previous);
  const after = clone(next);
  const ignoredCollections = [
    ...(allowInventoryMigration ? INVENTORY_COLLECTION_KEYS : []),
    ...(allowDistributionMigration ? DISTRIBUTION_COLLECTION_KEYS : []),
    ...(allowCatalogMigration ? ["categories", "products"] : []),
  ];
  ignoredCollections.forEach((key) => { delete before[key]; delete after[key]; });

  if (!allowInventoryMigration && INVENTORY_COLLECTION_KEYS.every((key) => Object.hasOwn(previous, key))) {
    assertCollectionPrefix(previous.warehouses, next.warehouses, "warehouse_id", "Gudang", "BRANCH_EXPANSION_APPEND_ONLY");
    assertCollectionPrefix(previous.stockLocations, next.stockLocations, "stock_location_id", "Lokasi stok", "BRANCH_EXPANSION_APPEND_ONLY");
    assertCollectionPrefix(previous.inventoryBatches, next.inventoryBatches, "inventory_batch_id", "Batch stok", "BRANCH_EXPANSION_APPEND_ONLY");
    assertCollectionPrefix(previous.stockMovements, next.stockMovements, "movement_id", "Ledger mutasi", "BRANCH_EXPANSION_APPEND_ONLY");
    if (previous.inventoryBatches.length !== next.inventoryBatches.length || previous.stockMovements.length !== next.stockMovements.length) {
      throw new RepositoryError("BRANCH_EXPANSION_STOCK_CHANGED", "Migrasi ekspansi cabang tidak boleh menambah atau mengubah batch maupun ledger stok.");
    }
    INVENTORY_COLLECTION_KEYS.forEach((key) => { delete before[key]; delete after[key]; });
  }

  const migrationKey = "applied_migrations";
  if (before.meta && after.meta) {
    if (Object.hasOwn(before.meta, migrationKey)) delete before.meta[migrationKey];
    if (Object.hasOwn(after.meta, migrationKey)) delete after.meta[migrationKey];
  }
  for (const [key, idField, label] of [
    ["regions", "region_id", "Wilayah"],
    ["branches", "branch_id", "Cabang"],
    ["pricingRules", "price_rule_id", "Aturan harga"],
  ]) {
    assertCollectionPrefix(previous[key], next[key], idField, label, "BRANCH_EXPANSION_APPEND_ONLY");
    delete before[key];
    delete after[key];
  }
  if (!sameRecord(before, after)) {
    throw new RepositoryError("BRANCH_EXPANSION_CORE_CHANGED", "Migrasi cabang hanya boleh menambahkan wilayah, cabang, aturan harga, gudang/lokasi baru, dan koleksi migrasi yang kosong.");
  }
}

function assertCatalogMigrationPreservesExisting(previous, next, {
  allowBranchExpansion = false,
  allowInventoryMigration = false,
  allowDistributionMigration = false,
  allowCatalogMigration = false,
} = {}) {
  const before = clone(previous);
  const after = clone(next);
  const appendOnlyCollections = [
    ...(allowBranchExpansion ? [["regions", "region_id", "Wilayah"], ["branches", "branch_id", "Cabang"]] : []),
    ["categories", "category_id", "Kategori"],
    ["products", "product_id", "Produk"],
    ["pricingRules", "price_rule_id", "Aturan harga"],
  ];
  for (const [key, idField, label] of appendOnlyCollections) {
    assertCollectionPrefix(previous[key], next[key], idField, label, "CATALOG_MIGRATION_APPEND_ONLY");
    delete before[key];
    delete after[key];
  }
  if (before.meta && after.meta) {
    delete before.meta.applied_migrations;
    delete after.meta.applied_migrations;
    if (allowCatalogMigration) {
      delete before.meta[CATALOG_EXPANSION_IDENTITY_META_KEY];
      delete after.meta[CATALOG_EXPANSION_IDENTITY_META_KEY];
    }
  }
  for (const key of [
    ...(allowBranchExpansion ? ["warehouses", "stockLocations"] : []),
    ...(allowInventoryMigration ? INVENTORY_COLLECTION_KEYS : []),
    ...(allowDistributionMigration ? DISTRIBUTION_COLLECTION_KEYS : []),
  ]) {
    delete before[key];
    delete after[key];
  }
  if (!sameRecord(before, after)) {
    throw new RepositoryError("CATALOG_MIGRATION_CORE_CHANGED", "Migrasi katalog hanya boleh menambahkan kategori, produk, aturan harga, dan marker migrasi. Data operasional existing tidak diubah.");
  }
}

function mergeMissingRecords(existing, candidates, key) {
  const next = [...existing];
  const ids = new Set(existing.map((record) => record[key]));
  for (const record of candidates) {
    if (ids.has(record[key])) continue;
    next.push(clone(record));
    ids.add(record[key]);
  }
  return next;
}

function branchExpansionStructureIssues(state) {
  const issues = [];
  const findRecord = (collection, key, id) => Array.isArray(collection)
    ? collection.find((record) => record?.[key] === id)
    : undefined;

  for (const expected of EXPANSION_REGIONS) {
    const region = findRecord(state.regions, "region_id", expected.region_id);
    if (!region) issues.push(`wilayah ${expected.region_id} tidak tersedia`);
    else if (region.organization_id !== expected.organization_id) issues.push(`wilayah ${expected.region_id} mengacu ke organisasi yang salah`);
  }
  for (const expected of EXPANSION_BRANCHES) {
    const branch = findRecord(state.branches, "branch_id", expected.branch_id);
    if (!branch) issues.push(`cabang ${expected.branch_id} tidak tersedia`);
    else if (branch.region_id !== expected.region_id) issues.push(`cabang ${expected.branch_id} tidak terhubung ke wilayah ${expected.region_id}`);
  }
  for (const expected of EXPANSION_WAREHOUSES) {
    const warehouse = findRecord(state.warehouses, "warehouse_id", expected.warehouse_id);
    if (!warehouse) issues.push(`gudang ${expected.warehouse_id} tidak tersedia`);
    else if (warehouse.organization_id !== expected.organization_id
      || warehouse.branch_id !== expected.branch_id
      || warehouse.warehouse_type !== expected.warehouse_type) {
      issues.push(`relasi gudang ${expected.warehouse_id} tidak sesuai dengan cabang ${expected.branch_id}`);
    }
  }
  for (const expected of EXPANSION_STOCK_LOCATIONS) {
    const location = findRecord(state.stockLocations, "stock_location_id", expected.stock_location_id);
    if (!location) issues.push(`lokasi stok ${expected.stock_location_id} tidak tersedia`);
    else if (location.warehouse_id !== expected.warehouse_id) {
      issues.push(`lokasi stok ${expected.stock_location_id} tidak terhubung ke gudang ${expected.warehouse_id}`);
    }
  }
  return issues;
}

function hasCompleteBranchExpansionStructure(state) {
  return branchExpansionStructureIssues(state).length === 0;
}

function catalogExpansionStructureIssues(state) {
  const issues = [];
  const categoryIds = new Set((state.categories ?? []).map((category) => category.category_id));
  const productIds = new Set((state.products ?? []).map((product) => product.product_id));
  for (const category of CATALOG_EXPANSION_CATEGORIES) {
    if (!categoryIds.has(category.category_id)) issues.push(`kategori ${category.category_id} tidak tersedia`);
  }
  for (const product of createCanonicalProductExpansion()) {
    if (!productIds.has(product.product_id)) issues.push(`produk ${product.product_id} tidak tersedia`);
  }
  return issues;
}

function assertCatalogExpansionIdentityConflicts(state) {
  const categories = Array.isArray(state.categories) ? state.categories : [];
  const products = Array.isArray(state.products) ? state.products : [];
  const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase("id-ID");

  for (const expected of CATALOG_EXPANSION_CATEGORIES) {
    const expectedCode = normalize(expected.code);
    const byId = categories.find((category) => category.category_id === expected.category_id);
    if (byId && normalize(byId.code) !== expectedCode) {
      throw new RepositoryError(
        "CATALOG_MIGRATION_CONFLICT",
        `ID kategori ${expected.category_id} sudah dipakai dengan kode ${byId.code || "(kosong)"}; katalog menyiapkan kode ${expected.code}. Selesaikan benturan secara manual. Data tidak ditulis.`,
      );
    }
    const byCode = categories.find((category) => normalize(category.code) === expectedCode);
    if (byCode && byCode.category_id !== expected.category_id) {
      throw new RepositoryError(
        "CATALOG_MIGRATION_CONFLICT",
        `Kode kategori ${expected.code} sudah dipakai ID ${byCode.category_id}; migrasi menyiapkan ID ${expected.category_id}. Selesaikan benturan secara manual. Data tidak ditulis.`,
      );
    }
  }

  for (const expected of createCanonicalProductExpansion(state.organization.organization_id, state.meta?.seeded_at ?? "2026-10-12T00:00:00+07:00")) {
    const expectedSku = normalize(expected.sku);
    const expectedBarcode = String(expected.barcode ?? "").trim();
    const byId = products.find((product) => product.product_id === expected.product_id);
    if (byId && (normalize(byId.sku) !== expectedSku || String(byId.barcode ?? "").trim() !== expectedBarcode)) {
      throw new RepositoryError(
        "CATALOG_MIGRATION_CONFLICT",
        `ID produk ${expected.product_id} sudah dipakai identitas lain (SKU ${byId.sku || "(kosong)"}, barcode ${byId.barcode || "(kosong)"}); katalog menyiapkan SKU ${expected.sku} dan barcode ${expected.barcode}. Selesaikan benturan secara manual. Data tidak ditulis.`,
      );
    }
    const bySku = products.find((product) => normalize(product.sku) === expectedSku);
    if (bySku && bySku.product_id !== expected.product_id) {
      throw new RepositoryError(
        "CATALOG_MIGRATION_CONFLICT",
        `SKU ${expected.sku} untuk ${expected.product_id} sudah dipakai produk ${bySku.product_id}. Selesaikan benturan secara manual. Data tidak ditulis.`,
      );
    }
    const byBarcode = products.find((product) => String(product.barcode ?? "").trim() === expectedBarcode);
    if (byBarcode && byBarcode.product_id !== expected.product_id) {
      throw new RepositoryError(
        "CATALOG_MIGRATION_CONFLICT",
        `Barcode ${expected.barcode} untuk ${expected.product_id} sudah dipakai produk ${byBarcode.product_id}. Selesaikan benturan secara manual. Data tidak ditulis.`,
      );
    }
  }
}

function validateCatalogExpansionMarker(state) {
  if (!state.meta?.applied_migrations?.includes(CATALOG_EXPANSION_MIGRATION_ID)) return;
  const issues = catalogExpansionStructureIssues(state);
  const identityManifest = state.meta?.[CATALOG_EXPANSION_IDENTITY_META_KEY];
  if (identityManifest !== undefined
    && !sameRecord(identityManifest, createCatalogExpansionIdentityManifest(state.organization?.organization_id))) {
    issues.push(`manifest identitas ${CATALOG_EXPANSION_IDENTITY_META_KEY} tidak sesuai dengan katalog kanonis`);
  }
  if (issues.length > 0) {
    throw new RepositoryError(
      "CATALOG_EXPANSION_MARKER_INCONSISTENT",
      `Penanda migrasi ${CATALOG_EXPANSION_MIGRATION_ID} menyatakan selesai, tetapi katalog kanonis tidak lengkap: ${issues.slice(0, 8).join("; ")}. Data demo tidak diubah.`,
    );
  }
}

function validateBranchExpansionMarker(state) {
  if (!state.meta?.applied_migrations?.includes(BRANCH_EXPANSION_MIGRATION_ID)) return;
  const issues = branchExpansionStructureIssues(state);
  if (issues.length > 0) {
    throw new RepositoryError(
      "BRANCH_EXPANSION_MARKER_INCONSISTENT",
      `Penanda migrasi ${BRANCH_EXPANSION_MIGRATION_ID} menyatakan selesai, tetapi struktur wilayah/cabang/gudang/lokasi atau relasinya tidak lengkap: ${issues.join("; ")}. Data demo tidak diubah.`,
    );
  }
}

function applyBranchExpansion(state) {
  const next = clone(state);
  const expandedSeed = createDemoSeed();
  next.regions = mergeMissingRecords(next.regions, EXPANSION_REGIONS, "region_id");
  next.branches = mergeMissingRecords(next.branches, EXPANSION_BRANCHES, "branch_id");

  const knownRuleIds = new Set(next.pricingRules.map((rule) => rule.price_rule_id));
  for (const rule of expandedSeed.pricingRules.filter((item) => EXPANSION_REGIONS.some((region) => region.region_id === item.region_id))) {
    if (knownRuleIds.has(rule.price_rule_id)) continue;
    const overlapsExisting = next.pricingRules.some((existing) => existing.region_id === rule.region_id
      && existing.category_id === rule.category_id
      && priceRulePeriodsOverlap(existing, rule));
    if (!overlapsExisting) {
      next.pricingRules.push(clone(rule));
      knownRuleIds.add(rule.price_rule_id);
    }
  }

  const hasInventory = INVENTORY_COLLECTION_KEYS.every((key) => Object.hasOwn(next, key));
  if (!hasInventory) Object.assign(next, createInventorySeed());
  else {
    next.warehouses = mergeMissingRecords(next.warehouses, EXPANSION_WAREHOUSES, "warehouse_id");
    next.stockLocations = mergeMissingRecords(next.stockLocations, EXPANSION_STOCK_LOCATIONS, "stock_location_id");
  }

  if (!DISTRIBUTION_COLLECTION_KEYS.every((key) => Object.hasOwn(next, key))) {
    Object.assign(next, { stockRequests: [], stockTransfers: [], distributionReceipts: [], distributionEvents: [] });
  }
  const applied = next.meta.applied_migrations ?? [];
  if (!Array.isArray(applied) || applied.some((item) => typeof item !== "string")) {
    throw new RepositoryError("STORAGE_DATA_INVALID", "Daftar migrasi demo tersimpan tidak valid.");
  }
  next.meta = {
    ...next.meta,
    applied_migrations: applied.includes(BRANCH_EXPANSION_MIGRATION_ID)
      ? [...applied]
      : [...applied, BRANCH_EXPANSION_MIGRATION_ID],
  };
  return next;
}

function addOneDayBefore(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function applyCatalogExpansion(state) {
  // Check identity collisions before adding any seed rows. A matching ID alone
  // is not enough to claim a user's record as a canonical catalog product.
  assertCatalogExpansionIdentityConflicts(state);
  const next = clone(state);
  const categoryIds = new Set(next.categories.map((category) => category.category_id));
  const categoryCodes = new Set(next.categories.map((category) => String(category.code ?? "").toLocaleLowerCase("id-ID")));
  for (const category of CATALOG_EXPANSION_CATEGORIES) {
    if (categoryIds.has(category.category_id)) continue;
    const code = category.code.toLocaleLowerCase("id-ID");
    if (categoryCodes.has(code)) {
      throw new RepositoryError("CATALOG_MIGRATION_CONFLICT", `Kode kategori ${category.code} sudah digunakan record lain. Migrasi tidak mengubah katalog.`);
    }
    next.categories.push(clone(category));
    categoryIds.add(category.category_id);
    categoryCodes.add(code);
  }

  const skus = new Set(next.products.map((product) => product.sku.trim().toLocaleLowerCase("id-ID")));
  const barcodes = new Set(next.products.map((product) => String(product.barcode ?? "").trim()).filter(Boolean));
  const productIds = new Set(next.products.map((product) => product.product_id));
  for (const product of createCanonicalProductExpansion(state.organization.organization_id, state.meta?.seeded_at ?? "2026-10-12T00:00:00+07:00")) {
    if (productIds.has(product.product_id)) continue;
    const sku = product.sku.trim().toLocaleLowerCase("id-ID");
    if (skus.has(sku) || (product.barcode && barcodes.has(product.barcode))) {
      throw new RepositoryError("CATALOG_MIGRATION_CONFLICT", `SKU atau barcode untuk ${product.product_id} sudah digunakan record lain. Migrasi tidak mengubah katalog.`);
    }
    next.products.push(clone(product));
    productIds.add(product.product_id);
    skus.add(sku);
    if (product.barcode) barcodes.add(product.barcode);
  }

  const rulesByPair = new Map();
  for (const rule of next.pricingRules) {
    const pair = `${rule.region_id}::${rule.category_id}`;
    const scoped = rulesByPair.get(pair) ?? [];
    scoped.push(rule);
    rulesByPair.set(pair, scoped);
  }
  const knownRuleIds = new Set(next.pricingRules.map((rule) => rule.price_rule_id));
  const candidates = createCatalogExpansionPricingRules(DEMO_REFERENCE_DATE);
  for (const candidate of candidates) {
    if (knownRuleIds.has(candidate.price_rule_id)) continue;
    const pair = `${candidate.region_id}::${candidate.category_id}`;
    const existing = rulesByPair.get(pair) ?? [];
    const activeAtReference = existing.find((rule) => rule.status === "active" && ruleCoversDate(rule, DEMO_REFERENCE_DATE));
    if (activeAtReference) continue;
    const periodAtReference = existing.find((rule) => rule.valid_from <= DEMO_REFERENCE_DATE
      && (rule.valid_until === null || DEMO_REFERENCE_DATE <= rule.valid_until));
    if (periodAtReference) {
      throw new RepositoryError("CATALOG_MIGRATION_CONFLICT", `Aturan harga ${pair} tidak aktif pada tanggal demo dan bertabrakan dengan periode yang sudah dikonfigurasi. Aturan existing dipertahankan.`);
    }
    const nextFutureStart = existing
      .filter((rule) => rule.valid_from > DEMO_REFERENCE_DATE)
      .map((rule) => rule.valid_from)
      .sort()[0];
    const append = { ...candidate, valid_until: nextFutureStart ? addOneDayBefore(nextFutureStart) : null };
    if (append.valid_until !== null && append.valid_until < append.valid_from) {
      throw new RepositoryError("CATALOG_MIGRATION_CONFLICT", `Tidak tersedia periode awal untuk aturan ${pair}; tidak ada aturan harga yang diubah.`);
    }
    next.pricingRules.push(append);
    knownRuleIds.add(append.price_rule_id);
    rulesByPair.set(pair, [...existing, append]);
  }

  const applied = next.meta.applied_migrations ?? [];
  if (!applied.includes(CATALOG_EXPANSION_MIGRATION_ID)) {
    next.meta = { ...next.meta, applied_migrations: [...applied, CATALOG_EXPANSION_MIGRATION_ID] };
  }
  next.meta[CATALOG_EXPANSION_IDENTITY_META_KEY] = createCatalogExpansionIdentityManifest(next.organization.organization_id);
  return next;
}

function ruleCoversDate(rule, date) {
  return rule.valid_from <= date && (rule.valid_until === null || date <= rule.valid_until);
}

function isTimestampWithOffset(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && isValidDateOnly(value.slice(0, 10))
    && !Number.isNaN(Date.parse(value));
}

function jakartaBusinessDate(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validateInventoryState(state, productIds, branchIds) {
  const presentCollections = INVENTORY_COLLECTION_KEYS.filter((key) => Object.hasOwn(state, key));
  if (presentCollections.length === 0) return false;
  if (presentCollections.length !== INVENTORY_COLLECTION_KEYS.length) {
    throw new RepositoryError("STORAGE_DATA_INVALID", "Koleksi persediaan pada penyimpanan demo tidak lengkap.");
  }

  const warehouseIds = assertCollectionIds(state.warehouses, "warehouse_id", "gudang");
  const locationIds = assertCollectionIds(state.stockLocations, "stock_location_id", "lokasi stok");
  const batchIds = assertCollectionIds(state.inventoryBatches, "inventory_batch_id", "batch stok");
  assertCollectionIds(state.stockMovements, "movement_id", "mutasi stok");
  if (!warehouseIds.has("WH-HQ-01")) {
    throw new RepositoryError("STORAGE_DATA_INVALID", "Gudang pusat kanonis demo tidak tersedia.");
  }
  const warehousesById = new Map(state.warehouses.map((warehouse) => [warehouse.warehouse_id, warehouse]));
  const branchWarehouseCounts = new Map();
  for (const warehouse of state.warehouses) {
    if (warehouse.organization_id !== state.organization.organization_id
      || !["CENTRAL", "BRANCH"].includes(warehouse.warehouse_type)
      || !["active", "inactive"].includes(warehouse.status)
      || (warehouse.warehouse_type === "CENTRAL" && warehouse.branch_id !== null)
      || (warehouse.warehouse_type === "BRANCH" && !branchIds.has(warehouse.branch_id))
      || (warehouse.warehouse_id === "WH-HQ-01" && warehouse.warehouse_type !== "CENTRAL")) {
      throw new RepositoryError("STORAGE_DATA_INVALID", "Gudang memiliki tipe, organisasi, atau cakupan cabang yang tidak valid.");
    }
    if (warehouse.warehouse_type === "BRANCH") {
      branchWarehouseCounts.set(warehouse.branch_id, (branchWarehouseCounts.get(warehouse.branch_id) ?? 0) + 1);
    }
  }
  if (state.branches.some((branch) => !branchWarehouseCounts.has(branch.branch_id))) {
    throw new RepositoryError("STORAGE_WAREHOUSE_MISSING", "Setiap cabang harus memiliki sedikitnya satu gudang cabang.");
  }

  const locationsById = new Map(state.stockLocations.map((location) => [location.stock_location_id, location]));
  const locationsByWarehouse = new Set();
  const locationCodeKeys = new Set();
  for (const location of state.stockLocations) {
    if (!warehouseIds.has(location.warehouse_id)
      || typeof location.code !== "string" || !location.code.trim()
      || typeof location.name !== "string" || !location.name.trim()
      || !["active", "inactive"].includes(location.status)) {
      throw new RepositoryError("STORAGE_DATA_INVALID", "Lokasi stok mengacu ke gudang atau data yang tidak valid.");
    }
    const locationCodeKey = `${location.warehouse_id}::${location.code.trim().toLocaleLowerCase("id-ID")}`;
    if (locationCodeKeys.has(locationCodeKey)) throw new RepositoryError("STORAGE_DATA_INVALID", "Kode lokasi harus unik dalam gudang yang sama.");
    locationCodeKeys.add(locationCodeKey);
    if (location.status === "active") locationsByWarehouse.add(location.warehouse_id);
  }
  if (state.warehouses.some((warehouse) => warehouse.status === "active" && !locationsByWarehouse.has(warehouse.warehouse_id))) {
    throw new RepositoryError("STORAGE_LOCATION_MISSING", "Setiap gudang aktif harus memiliki sedikitnya satu lokasi stok aktif.");
  }

  const productsById = new Map(state.products.map((product) => [product.product_id, product]));
  const batchesById = new Map(state.inventoryBatches.map((batch) => [batch.inventory_batch_id, batch]));
  const batchKeys = new Set();
  for (const batch of state.inventoryBatches) {
    const product = productsById.get(batch.product_id);
    const location = locationsById.get(batch.stock_location_id);
    if (!productIds.has(batch.product_id)
      || !warehouseIds.has(batch.warehouse_id)
      || !location
      || location.warehouse_id !== batch.warehouse_id
      || typeof batch.lot_number !== "string" || !batch.lot_number.trim()
      || !isTimestampWithOffset(batch.received_at)
      || (batch.expiry_date !== null && !isValidDateOnly(batch.expiry_date))
      || !ROTATION_POLICIES.includes(batch.rotation_policy)
      || (batch.rotation_policy === "FEFO" && !batch.expiry_date)
      || (product?.expiry_policy === "required" && !batch.expiry_date)
      || !isTimestampWithOffset(batch.created_at)) {
      throw new RepositoryError("STORAGE_DATA_INVALID", "Batch memiliki data atau relasi produk, gudang, lokasi, atau rotasi yang tidak valid.");
    }
    const batchKey = `${batch.product_id}::${batch.warehouse_id}::${batch.stock_location_id}::${batch.lot_number.trim().toLocaleLowerCase("id-ID")}`;
    if (batchKeys.has(batchKey)) throw new RepositoryError("INVENTORY_BATCH_DUPLICATE", "Nomor lot produk harus unik di lokasi gudang yang sama.");
    batchKeys.add(batchKey);
  }

  const balances = new Map();
  const conditionTransfers = new Map();
  for (const movement of state.stockMovements) {
    const batch = batchesById.get(movement.inventory_batch_id);
    const location = movement.stock_location_id === null ? null : locationsById.get(movement.stock_location_id);
    if (!batch
      || !warehouseIds.has(movement.warehouse_id)
      || batch.warehouse_id !== movement.warehouse_id
      || !STOCK_BUCKETS.includes(movement.stock_bucket)
      || !Number.isSafeInteger(movement.quantity_delta)
      || movement.quantity_delta === 0
      || !["OPENING_BALANCE", "ADJUSTMENT", "CONDITION_TRANSFER", "SALE", "DISTRIBUTION_DISPATCH", "DISTRIBUTION_RECEIPT", "DISTRIBUTION_RECONCILIATION"].includes(movement.movement_type)
      || typeof movement.reference_type !== "string" || !movement.reference_type.trim()
      || typeof movement.reference_id !== "string" || !movement.reference_id.trim()
      || typeof movement.reason !== "string" || !movement.reason.trim()
      || typeof movement.actor_id !== "string" || !movement.actor_id.trim()
      || !isTimestampWithOffset(movement.occurred_at)
      || (movement.effective_date !== undefined && !isValidDateOnly(movement.effective_date))
      || (movement.stock_bucket === "IN_TRANSIT" && (movement.stock_location_id !== null || !["OPENING_BALANCE", "DISTRIBUTION_DISPATCH", "DISTRIBUTION_RECEIPT", "DISTRIBUTION_RECONCILIATION"].includes(movement.movement_type)))
      || (movement.movement_type === "CONDITION_TRANSFER" && (movement.reference_type !== "STOCK_CONDITION_TRANSFER" || !PHYSICAL_STOCK_BUCKETS.includes(movement.stock_bucket)))
      || (movement.movement_type === "SALE" && (movement.reference_type !== "SALE_TRANSACTION" || movement.stock_bucket !== "AVAILABLE" || movement.quantity_delta >= 0))
      || (movement.movement_type === "DISTRIBUTION_DISPATCH" && (movement.reference_type !== "STOCK_TRANSFER_DISPATCH" || !["AVAILABLE", "IN_TRANSIT"].includes(movement.stock_bucket) || (movement.stock_bucket === "AVAILABLE" ? movement.quantity_delta >= 0 : movement.quantity_delta <= 0)))
      || (movement.movement_type === "DISTRIBUTION_RECEIPT" && (movement.reference_type !== "STOCK_TRANSFER_RECEIPT" || (movement.stock_bucket === "IN_TRANSIT" ? movement.quantity_delta >= 0 : !PHYSICAL_STOCK_BUCKETS.includes(movement.stock_bucket) || movement.quantity_delta <= 0)))
      || (movement.movement_type === "DISTRIBUTION_RECONCILIATION" && (movement.reference_type !== "STOCK_TRANSFER_RECONCILIATION" || movement.stock_bucket !== "IN_TRANSIT" || movement.quantity_delta >= 0))
      || (movement.movement_type !== "SALE" && movement.reference_type === "SALE_TRANSACTION")
      || (movement.stock_bucket !== "IN_TRANSIT" && (!location || location.warehouse_id !== movement.warehouse_id || batch.stock_location_id !== location.stock_location_id))) {
      throw new RepositoryError("STORAGE_DATA_INVALID", "Mutasi stok memiliki relasi, bucket, atau catatan audit yang tidak valid.");
    }
    const key = `${movement.inventory_batch_id}::${movement.stock_bucket}`;
    const balance = (balances.get(key) ?? 0) + movement.quantity_delta;
    if (!Number.isSafeInteger(balance) || balance < 0) {
      throw new RepositoryError("INVENTORY_NEGATIVE_BALANCE", "Saldo bucket persediaan tidak boleh negatif atau melebihi batas aman.");
    }
    balances.set(key, balance);
    if (movement.movement_type === "CONDITION_TRANSFER") {
      const transfer = conditionTransfers.get(movement.reference_id) ?? [];
      transfer.push(movement);
      conditionTransfers.set(movement.reference_id, transfer);
    }
  }
  for (const transfer of conditionTransfers.values()) {
    const [outgoing, incoming] = transfer;
    if (transfer.length !== 2
      || outgoing.inventory_batch_id !== incoming.inventory_batch_id
      || outgoing.stock_bucket === incoming.stock_bucket
      || outgoing.quantity_delta >= 0
      || incoming.quantity_delta <= 0
      || outgoing.quantity_delta + incoming.quantity_delta !== 0
      || outgoing.occurred_at !== incoming.occurred_at
      || outgoing.effective_date !== incoming.effective_date
      || outgoing.actor_id !== incoming.actor_id
      || outgoing.reason !== incoming.reason) {
      throw new RepositoryError("INVENTORY_TRANSFER_INVALID", "Mutasi pindah kondisi harus berupa sepasang saldo keluar dan masuk yang seimbang.");
    }
  }
  return true;
}

function validatePosState(state, branchIds, productIds) {
  const present = POS_COLLECTION_KEYS.filter((key) => Object.hasOwn(state, key));
  if (present.length === 0) return false;
  if (present.length !== POS_COLLECTION_KEYS.length) {
    throw new RepositoryError("STORAGE_DATA_INVALID", "Koleksi transaksi dan kasir pada penyimpanan demo tidak lengkap.");
  }

  const shiftIds = assertCollectionIds(state.cashShifts, "shift_id", "shift kasir");
  const saleIds = assertCollectionIds(state.sales, "sale_id", "transaksi");
  const paymentIds = assertCollectionIds(state.payments, "payment_id", "pembayaran");
  const cashMovementIds = assertCollectionIds(state.cashMovements, "cash_movement_id", "mutasi kas shift");
  const warehouseById = new Map(state.warehouses.map((warehouse) => [warehouse.warehouse_id, warehouse]));
  const branchesById = new Map(state.branches.map((branch) => [branch.branch_id, branch]));
  const productById = new Map(state.products.map((product) => [product.product_id, product]));
  const categoryIds = new Set(state.categories.map((category) => category.category_id));
  const batchById = new Map(state.inventoryBatches.map((batch) => [batch.inventory_batch_id, batch]));
  const shiftsById = new Map(state.cashShifts.map((shift) => [shift.shift_id, shift]));
  const saleById = new Map(state.sales.map((sale) => [sale.sale_id, sale]));
  const uniqueCashiers = new Set();

  for (const shift of state.cashShifts) {
    const warehouse = warehouseById.get(shift.warehouse_id);
    if (!branchIds.has(shift.branch_id)
      || !warehouse
      || warehouse.branch_id !== shift.branch_id
      || warehouse.warehouse_type !== "BRANCH"
      || typeof shift.cashier_id !== "string" || !shift.cashier_id.trim()
      || (shift.simulation_dataset_id !== undefined && (typeof shift.simulation_dataset_id !== "string" || !shift.simulation_dataset_id.trim()))
      || !Number.isSafeInteger(shift.opening_cash_idr) || shift.opening_cash_idr < 0
      || !["active", "closed"].includes(shift.status)
      || !isTimestampWithOffset(shift.opened_at)) {
      throw new RepositoryError("STORAGE_DATA_INVALID", "Shift kasir memiliki cabang, gudang, saldo awal, status, atau waktu yang tidak valid.");
    }
    if (shift.status === "active") {
      if (["closed_at", "closed_by", "closing_cash_idr", "expected_cash_idr", "cash_difference_idr"].some((key) => Object.hasOwn(shift, key))) {
        throw new RepositoryError("SHIFT_CLOSE_INVALID", "Shift aktif tidak boleh memuat snapshot penutupan.");
      }
      if (uniqueCashiers.has(shift.cashier_id)) throw new RepositoryError("SHIFT_ALREADY_ACTIVE", "Satu kasir tidak boleh memiliki lebih dari satu shift aktif.");
      uniqueCashiers.add(shift.cashier_id);
    } else if (!isTimestampWithOffset(shift.closed_at)
      || Date.parse(shift.closed_at) < Date.parse(shift.opened_at)
      || typeof shift.closed_by !== "string" || !shift.closed_by.trim()
      || !Number.isSafeInteger(shift.closing_cash_idr) || shift.closing_cash_idr < 0
      || !Number.isSafeInteger(shift.expected_cash_idr) || shift.expected_cash_idr < 0
      || !Number.isSafeInteger(shift.cash_difference_idr)
      || shift.cash_difference_idr !== shift.closing_cash_idr - shift.expected_cash_idr) {
      throw new RepositoryError("SHIFT_CLOSE_INVALID", "Snapshot penutupan shift tidak valid.");
    }
  }

  const transactionNumbers = new Set();
  const idempotencyKeys = new Set();
  const itemIds = new Set();
  const expectedStockBySaleBatch = new Map();
  for (const sale of state.sales) {
    const shift = shiftsById.get(sale.shift_id);
    const warehouse = warehouseById.get(sale.warehouse_id);
    if (!shift
      || shift.branch_id !== sale.branch_id
      || shift.warehouse_id !== sale.warehouse_id
      || shift.cashier_id !== sale.cashier_id
      || !branchIds.has(sale.branch_id)
      || !warehouse || warehouse.branch_id !== sale.branch_id
      || sale.status !== "completed"
      || sale.currency !== "IDR"
      || !isValidDateOnly(sale.effective_date)
      || !isTimestampWithOffset(sale.created_at)
      || typeof sale.transaction_number !== "string" || !sale.transaction_number.trim()
      || typeof sale.idempotency_key !== "string" || !sale.idempotency_key.trim()
      || typeof sale.idempotency_fingerprint !== "string"
      || !Number.isSafeInteger(sale.gross_total_idr) || sale.gross_total_idr < 0
      || !Number.isSafeInteger(sale.discount_total_idr) || sale.discount_total_idr < 0
      || !Number.isSafeInteger(sale.net_total_idr) || sale.net_total_idr < 0
      || sale.gross_total_idr - sale.discount_total_idr !== sale.net_total_idr
      || (sale.receipt_footer_snapshot !== undefined && (typeof sale.receipt_footer_snapshot !== "string" || sale.receipt_footer_snapshot.length > 120))
      || (sale.simulation_dataset_id !== undefined && (typeof sale.simulation_dataset_id !== "string" || !sale.simulation_dataset_id.trim()))
      || !Array.isArray(sale.items) || sale.items.length === 0) {
      throw new RepositoryError("SALE_DATA_INVALID", "Transaksi completed memiliki snapshot, shift, tanggal, atau total yang tidak valid.");
    }
    if (shift.status === "closed" && Date.parse(sale.created_at) > Date.parse(shift.closed_at)) {
      throw new RepositoryError("SHIFT_CLOSED", "Transaksi baru tidak dapat ditautkan ke shift yang sudah ditutup.");
    }
    if (transactionNumbers.has(sale.transaction_number) || idempotencyKeys.has(sale.idempotency_key)) {
      throw new RepositoryError("SALE_DUPLICATE", "Nomor transaksi dan kunci checkout harus unik.");
    }
    transactionNumbers.add(sale.transaction_number);
    idempotencyKeys.add(sale.idempotency_key);

    let grossTotal = 0;
    let discountTotal = 0;
    for (const item of sale.items) {
      const product = productById.get(item.product_id);
      const regularUnit = item.regular_unit_price_idr;
      const quantity = item.quantity;
      const expectedRegular = Number.isSafeInteger(item.base_price_snapshot_idr)
        ? Math.round(item.base_price_snapshot_idr * (1 + item.regional_adjustment_percent / 100)) : Number.NaN;
      const ruleSnapshot = item.price_rule_snapshot;
      const saleBranch = branchesById.get(sale.branch_id);
      if (!productIds.has(item.product_id)
        || !product
        || !categoryIds.has(item.category_id)
        || typeof item.sku_snapshot !== "string" || !item.sku_snapshot.trim()
        || typeof item.name_snapshot !== "string" || !item.name_snapshot.trim()
        || !Number.isSafeInteger(quantity) || quantity <= 0
        || !Number.isSafeInteger(item.base_price_snapshot_idr) || item.base_price_snapshot_idr < 0
        || !Number.isFinite(item.regional_adjustment_percent)
        || !Number.isSafeInteger(expectedRegular) || expectedRegular < 0
        || !Number.isSafeInteger(regularUnit) || regularUnit < 0 || regularUnit !== expectedRegular
        || !ruleSnapshot || typeof ruleSnapshot.price_rule_id !== "string"
        || ruleSnapshot.region_id !== saleBranch?.region_id
        || ruleSnapshot.category_id !== item.category_id
        || ruleSnapshot.adjustment_percent !== item.regional_adjustment_percent
        || ruleSnapshot.status !== "active"
        || !isValidDateOnly(ruleSnapshot.valid_from)
        || (ruleSnapshot.valid_until !== null && !isValidDateOnly(ruleSnapshot.valid_until))
        || ruleSnapshot.valid_from > sale.effective_date
        || (ruleSnapshot.valid_until !== null && sale.effective_date > ruleSnapshot.valid_until)
        || !Number.isInteger(ruleSnapshot.version) || ruleSnapshot.version < 1
        || !Array.isArray(item.allocations) || item.allocations.length === 0
        || !Number.isSafeInteger(item.regular_line_total_idr) || item.regular_line_total_idr !== regularUnit * quantity
        || !Number.isSafeInteger(item.discount_total_idr) || item.discount_total_idr < 0
        || !Number.isSafeInteger(item.final_line_total_idr) || item.final_line_total_idr < 0
        || item.final_line_total_idr !== item.regular_line_total_idr - item.discount_total_idr) {
        throw new RepositoryError("SALE_ITEM_INVALID", "Snapshot item transaksi atau harga regional tidak valid.");
      }
      if (itemIds.has(item.sale_item_id) || typeof item.sale_item_id !== "string" || !item.sale_item_id.trim()) {
        throw new RepositoryError("SALE_ITEM_DUPLICATE", "ID item transaksi harus unik.");
      }
      itemIds.add(item.sale_item_id);
      let allocatedQuantity = 0;
      let allocationDiscount = 0;
      for (const allocation of item.allocations) {
        const batch = batchById.get(allocation.inventory_batch_id);
        if (!batch
          || batch.product_id !== item.product_id
          || batch.warehouse_id !== sale.warehouse_id
          || allocation.lot_number_snapshot !== batch.lot_number
          || allocation.expiry_date_snapshot !== batch.expiry_date
          || allocation.rotation_policy_snapshot !== batch.rotation_policy
          || jakartaBusinessDate(batch.received_at) > sale.effective_date
          || (batch.expiry_date !== null && batch.expiry_date <= sale.effective_date)
          || !Number.isSafeInteger(allocation.allocated_quantity) || allocation.allocated_quantity <= 0
          || allocation.regular_unit_price_idr !== regularUnit
          || !Number.isSafeInteger(allocation.unit_discount_idr) || allocation.unit_discount_idr < 0 || allocation.unit_discount_idr > regularUnit
          || allocation.final_unit_price_idr !== regularUnit - allocation.unit_discount_idr
          || typeof allocation.allocation_id !== "string" || !allocation.allocation_id.trim()) {
          throw new RepositoryError("SALE_ALLOCATION_INVALID", "Snapshot alokasi batch dan harga final transaksi tidak valid.");
        }
        const batchKey = `${sale.sale_id}::${batch.inventory_batch_id}`;
        expectedStockBySaleBatch.set(batchKey, (expectedStockBySaleBatch.get(batchKey) ?? 0) + allocation.allocated_quantity);
        allocatedQuantity += allocation.allocated_quantity;
        allocationDiscount += allocation.unit_discount_idr * allocation.allocated_quantity;
      }
      if (allocatedQuantity !== quantity || allocationDiscount !== item.discount_total_idr) {
        throw new RepositoryError("SALE_ALLOCATION_TOTAL_MISMATCH", "Jumlah alokasi dan diskon batch harus sama dengan snapshot item transaksi.");
      }
      grossTotal += item.regular_line_total_idr;
      discountTotal += item.discount_total_idr;
    }
    if (grossTotal !== sale.gross_total_idr || discountTotal !== sale.discount_total_idr) {
      throw new RepositoryError("SALE_TOTAL_MISMATCH", "Total item tidak sama dengan ringkasan transaksi.");
    }
  }

  const paymentsBySale = new Map();
  for (const payment of state.payments) {
    const sale = saleById.get(payment.sale_id);
    if (!sale
      || payment.method !== "CASH"
      || payment.channel !== "SIMULATION"
      || payment.status !== "confirmed"
      || !Number.isSafeInteger(payment.amount_idr) || payment.amount_idr !== sale.net_total_idr
      || !Number.isSafeInteger(payment.received_amount_idr) || payment.received_amount_idr < payment.amount_idr
      || !Number.isSafeInteger(payment.change_idr) || payment.change_idr !== payment.received_amount_idr - payment.amount_idr
      || !isTimestampWithOffset(payment.confirmed_at)) {
      throw new RepositoryError("PAYMENT_DATA_INVALID", "Pembayaran tunai simulasi harus terkonfirmasi dan sama dengan total transaksi.");
    }
    if (paymentsBySale.has(payment.sale_id)) throw new RepositoryError("PAYMENT_DUPLICATE", "Transaksi hanya boleh memiliki satu pembayaran tunai pada milestone ini.");
    paymentsBySale.set(payment.sale_id, payment);
  }
  if (state.sales.some((sale) => !paymentsBySale.has(sale.sale_id)) || state.payments.length !== state.sales.length) {
    throw new RepositoryError("PAYMENT_MISSING", "Setiap transaksi completed wajib memiliki tepat satu pembayaran tunai.");
  }

  const cashBySale = new Map();
  const cashByShift = new Map(state.cashShifts.map((shift) => [shift.shift_id, shift.opening_cash_idr]));
  for (const movement of state.cashMovements) {
    const sale = saleById.get(movement.sale_id);
    if (!sale
      || movement.shift_id !== sale.shift_id
      || movement.movement_type !== "CASH_SALE_NET"
      || !Number.isSafeInteger(movement.amount_idr) || movement.amount_idr !== sale.net_total_idr
      || !isTimestampWithOffset(movement.occurred_at)
      || movement.occurred_at !== sale.created_at) {
      throw new RepositoryError("CASH_MOVEMENT_INVALID", "Dampak kas shift harus merujuk satu transaksi tunai dengan nominal neto.");
    }
    if (cashBySale.has(movement.sale_id)) throw new RepositoryError("CASH_MOVEMENT_DUPLICATE", "Dampak kas transaksi sudah tercatat lebih dari sekali.");
    cashBySale.set(movement.sale_id, movement);
    const expectedCash = (cashByShift.get(movement.shift_id) ?? 0) + movement.amount_idr;
    if (!Number.isSafeInteger(expectedCash) || expectedCash < 0) {
      throw new RepositoryError("SHIFT_CASH_UNSAFE", "Saldo kas shift melampaui batas integer rupiah yang aman.");
    }
    cashByShift.set(movement.shift_id, expectedCash);
  }
  if (state.sales.some((sale) => !cashBySale.has(sale.sale_id)) || state.cashMovements.length !== state.sales.length) {
    throw new RepositoryError("CASH_MOVEMENT_MISSING", "Setiap transaksi tunai wajib memiliki satu dampak kas shift.");
  }
  for (const shift of state.cashShifts.filter((item) => item.status === "closed")) {
    if (shift.expected_cash_idr !== cashByShift.get(shift.shift_id)
      || state.cashMovements.some((movement) => movement.shift_id === shift.shift_id && Date.parse(movement.occurred_at) > Date.parse(shift.closed_at))) {
      throw new RepositoryError("SHIFT_CLOSE_INVALID", "Saldo penutupan harus mencerminkan mutasi kas terkonfirmasi sampai waktu tutup.");
    }
  }

  const ledgerBySaleBatch = new Map();
  for (const movement of state.stockMovements.filter((item) => item.movement_type === "SALE")) {
    const sale = saleById.get(movement.reference_id);
    if (!sale
      || movement.actor_id !== sale.cashier_id
      || movement.effective_date !== sale.effective_date
      || movement.occurred_at !== sale.created_at
      || movement.warehouse_id !== sale.warehouse_id) {
      throw new RepositoryError("SALE_LEDGER_INVALID", "Mutasi penjualan harus merujuk transaksi, tanggal, gudang, dan kasir yang sama.");
    }
    const key = `${sale.sale_id}::${movement.inventory_batch_id}`;
    ledgerBySaleBatch.set(key, (ledgerBySaleBatch.get(key) ?? 0) - movement.quantity_delta);
  }
  const expectedKeys = new Set(expectedStockBySaleBatch.keys());
  const ledgerKeys = new Set(ledgerBySaleBatch.keys());
  if (expectedKeys.size !== ledgerKeys.size
    || [...expectedKeys].some((key) => ledgerBySaleBatch.get(key) !== expectedStockBySaleBatch.get(key))) {
    throw new RepositoryError("SALE_LEDGER_MISMATCH", "Alokasi transaksi harus sama persis dengan pengurangan ledger persediaan.");
  }
  return true;
}

function validateDistributionState(state, productIds, branchIds) {
  const present = DISTRIBUTION_COLLECTION_KEYS.filter((key) => Object.hasOwn(state, key));
  if (present.length === 0) return false;
  if (present.length !== DISTRIBUTION_COLLECTION_KEYS.length) {
    throw new RepositoryError("DISTRIBUTION_COLLECTIONS_INVALID", "Koleksi distribusi demo tidak lengkap.");
  }
  if (!Array.isArray(state.inventoryBatches) || !Array.isArray(state.warehouses) || !Array.isArray(state.stockLocations)) {
    if (DISTRIBUTION_COLLECTION_KEYS.every((key) => Array.isArray(state[key]) && state[key].length === 0)) return true;
    throw new RepositoryError("DISTRIBUTION_INVENTORY_MISSING", "Data distribusi tidak dapat ada sebelum koleksi persediaan dimigrasikan.");
  }

  const requestIds = assertCollectionIds(state.stockRequests, "request_id", "permintaan distribusi");
  const transferIds = assertCollectionIds(state.stockTransfers, "transfer_id", "draft transfer");
  const receiptIds = assertCollectionIds(state.distributionReceipts, "receipt_id", "penerimaan distribusi");
  const eventIds = assertCollectionIds(state.distributionEvents, "event_id", "riwayat distribusi");
  const requests = new Map(state.stockRequests.map((item) => [item.request_id, item]));
  const transfers = new Map(state.stockTransfers.map((item) => [item.transfer_id, item]));
  const batches = new Map(state.inventoryBatches.map((item) => [item.inventory_batch_id, item]));
  const locations = new Map(state.stockLocations.map((item) => [item.stock_location_id, item]));
  const branches = new Map(state.branches.map((item) => [item.branch_id, item]));
  const warehouses = new Map(state.warehouses.map((item) => [item.warehouse_id, item]));
  const requestLineIds = new Set();
  const transferLineIds = new Set();
  const allowedStatuses = new Set(["requested", "approved", "partially_approved", "rejected", "allocated", "replaced", "shipped", "in_transit", "partially_received", "received", "reconciled"]);

  for (const request of state.stockRequests) {
    const branch = branches.get(request.branch_id);
    const source = warehouses.get(request.source_warehouse_id);
    const destination = warehouses.get(request.destination_warehouse_id);
    if (request.organization_id !== state.organization.organization_id
      || !branch || branch.status !== "active"
      || !source || source.warehouse_type !== "CENTRAL" || source.status !== "active"
      || !destination || destination.warehouse_type !== "BRANCH" || destination.branch_id !== request.branch_id
      || !Array.isArray(request.items) || !request.items.length
      || !isTimestampWithOffset(request.created_at)
      || typeof request.created_by !== "string" || !request.created_by.trim()
      || typeof request.branch_name_snapshot !== "string" || !request.branch_name_snapshot.trim()) {
      throw new RepositoryError("DISTRIBUTION_REQUEST_INVALID", "Permintaan distribusi memiliki organisasi, cabang, gudang, atau audit yang tidak valid.");
    }
    for (const line of request.items) {
      if (!productIds.has(line.product_id)
        || typeof line.sku_snapshot !== "string" || !line.sku_snapshot.trim()
        || typeof line.product_name_snapshot !== "string" || !line.product_name_snapshot.trim()
        || typeof line.unit_id_snapshot !== "string" || !line.unit_id_snapshot.trim()
        || !Number.isSafeInteger(line.requested_quantity) || line.requested_quantity <= 0
        || typeof line.request_line_id !== "string" || !line.request_line_id.trim()
        || requestLineIds.has(line.request_line_id)) {
        throw new RepositoryError("DISTRIBUTION_REQUEST_LINE_INVALID", "Baris permintaan harus merujuk produk dan kuantitas integer positif yang unik.");
      }
      requestLineIds.add(line.request_line_id);
    }
  }

  for (const transfer of state.stockTransfers) {
    const request = requests.get(transfer.request_id);
    const source = warehouses.get(transfer.source_warehouse_id);
    const destination = warehouses.get(transfer.destination_warehouse_id);
    if (!request
      || transfer.source_warehouse_id !== request.source_warehouse_id
      || transfer.destination_warehouse_id !== request.destination_warehouse_id
      || transfer.destination_branch_id !== request.branch_id
      || transfer.destination_branch_name_snapshot !== request.branch_name_snapshot
      || !source || source.warehouse_type !== "CENTRAL"
      || !destination || destination.warehouse_type !== "BRANCH" || destination.branch_id !== request.branch_id
      || !Array.isArray(transfer.lines) || !transfer.lines.length
      || !isTimestampWithOffset(transfer.created_at)
      || typeof transfer.created_by !== "string" || !transfer.created_by.trim()) {
      throw new RepositoryError("DISTRIBUTION_TRANSFER_INVALID", "Draft distribusi tidak cocok dengan permintaan atau scope gudang.");
    }
    for (const line of transfer.lines) {
      const requestLine = request.items.find((item) => item.request_line_id === line.request_line_id);
      const sourceBatch = batches.get(line.source_batch_id);
      const sourceLocation = locations.get(line.source_stock_location_id);
      const destinationLocation = locations.get(line.destination_stock_location_id);
      if (!requestLine || line.product_id !== requestLine.product_id
        || !sourceBatch || sourceBatch.warehouse_id !== transfer.source_warehouse_id || sourceBatch.product_id !== line.product_id
        || sourceBatch.lot_number !== line.lot_number_snapshot || sourceBatch.expiry_date !== line.expiry_date_snapshot
        || sourceBatch.rotation_policy !== line.rotation_policy_snapshot || sourceBatch.stock_location_id !== line.source_stock_location_id
        || !sourceLocation || sourceLocation.warehouse_id !== transfer.source_warehouse_id
        || !destinationLocation || destinationLocation.warehouse_id !== transfer.destination_warehouse_id
        || !Number.isSafeInteger(line.allocated_quantity) || line.allocated_quantity <= 0
        || typeof line.transfer_line_id !== "string" || !line.transfer_line_id.trim()
        || transferLineIds.has(line.transfer_line_id)) {
        throw new RepositoryError("DISTRIBUTION_TRANSFER_LINE_INVALID", "Alokasi draft harus menautkan snapshot batch dan lokasi sumber/tujuan yang konsisten.");
      }
      transferLineIds.add(line.transfer_line_id);
    }
  }

  const eventStatuses = new Map();
  for (const event of state.distributionEvents) {
    const isRequest = event.document_type === "request" && requests.has(event.document_id);
    const isTransfer = event.document_type === "transfer" && transfers.has(event.document_id);
    if ((!isRequest && !isTransfer)
      || !isTimestampWithOffset(event.occurred_at)
      || !isValidDateOnly(event.effective_date)
      || typeof event.actor_id !== "string" || !event.actor_id.trim()
      || typeof event.reason !== "string" || !event.reason.trim()
      || !event.details || typeof event.details !== "object" || Array.isArray(event.details)
      || !allowedStatuses.has(event.to_status)
      || (event.from_status !== null && !allowedStatuses.has(event.from_status))) {
      throw new RepositoryError("DISTRIBUTION_EVENT_INVALID", "Riwayat status distribusi memiliki aktor, tanggal, atau referensi yang tidak valid.");
    }
    const key = `${event.document_type}::${event.document_id}`;
    const current = eventStatuses.get(key) ?? null;
    if ((current === null && event.from_status !== null) || (current !== null && event.from_status !== current)) {
      throw new RepositoryError("DISTRIBUTION_HISTORY_INVALID", "Urutan status distribusi tidak konsisten dengan riwayat sebelumnya.");
    }
    const allowedInitial = event.document_type === "request" ? event.event_type === "REQUESTED" && event.to_status === "requested"
      : event.event_type === "ALLOCATED" && event.to_status === "allocated";
    const isInformationalSameStatus = event.event_type === "DISCREPANCY_RESOLVED" && event.from_status === event.to_status;
    const requestTransition = event.document_type !== "request" || new Set([
      "requested->approved", "requested->partially_approved", "requested->rejected",
      "approved->allocated", "partially_approved->allocated", "allocated->shipped",
      "shipped->partially_received", "partially_received->partially_received",
      "shipped->received", "partially_received->received", "partially_received->reconciled",
      "partially_received->partially_received",
    ]).has(`${event.from_status}->${event.to_status}`)
      || (event.document_type === "request" && event.event_type === "REALLOCATED" && event.from_status === "allocated" && event.to_status === "allocated");
    const transferTransition = event.document_type !== "transfer" || new Set([
      "allocated->in_transit", "in_transit->partially_received", "partially_received->partially_received",
      "in_transit->received", "partially_received->received", "partially_received->reconciled",
      "partially_received->partially_received",
    ]).has(`${event.from_status}->${event.to_status}`) || isInformationalSameStatus
      || (event.document_type === "transfer" && event.event_type === "DRAFT_REPLACED" && event.from_status === "allocated" && event.to_status === "replaced");
    if ((!current && !allowedInitial) || (current && !requestTransition) || (current && !transferTransition)) {
      throw new RepositoryError("DISTRIBUTION_TRANSITION_INVALID", "Riwayat distribusi memuat transisi status yang tidak diizinkan.");
    }
    if ((event.event_type === "REALLOCATED" && (event.document_type !== "request" || event.from_status !== "allocated" || event.to_status !== "allocated"
      || typeof event.details.previous_transfer_id !== "string" || typeof event.details.replacement_transfer_id !== "string"))
      || (event.event_type === "DRAFT_REPLACED" && (event.document_type !== "transfer" || event.from_status !== "allocated" || event.to_status !== "replaced"
        || typeof event.details.replacement_transfer_id !== "string"))) {
      throw new RepositoryError("DISTRIBUTION_REALLOCATION_INVALID", "Riwayat alokasi ulang tidak memiliki referensi draft pengganti yang valid.");
    }
    if (event.event_type === "REALLOCATED") {
      const previous = transfers.get(event.details.previous_transfer_id);
      const replacement = transfers.get(event.details.replacement_transfer_id);
      if (!previous || !replacement || previous.request_id !== event.document_id || replacement.request_id !== event.document_id
        || previous.transfer_id === replacement.transfer_id) {
        throw new RepositoryError("DISTRIBUTION_REALLOCATION_INVALID", "Alokasi ulang harus menautkan dua draft berbeda pada permintaan yang sama.");
      }
    }
    if (event.event_type === "DRAFT_REPLACED") {
      const previous = transfers.get(event.document_id);
      const replacement = transfers.get(event.details.replacement_transfer_id);
      if (!previous || !replacement || previous.request_id !== replacement.request_id || previous.transfer_id === replacement.transfer_id) {
        throw new RepositoryError("DISTRIBUTION_REALLOCATION_INVALID", "Draft pengganti harus berada pada permintaan yang sama dengan draft yang diganti.");
      }
    }
    if (event.event_type === "APPROVED" || event.event_type === "PARTIALLY_APPROVED") {
      const request = requests.get(event.document_id);
      if (event.document_type !== "request" || !Array.isArray(event.details.approved_lines)
        || event.details.approved_lines.length !== request.items.length
        || event.details.approved_lines.some((approved) => {
          const requested = request.items.find((line) => line.request_line_id === approved.request_line_id);
          return !requested || !Number.isSafeInteger(approved.approved_quantity) || approved.approved_quantity < 0
            || approved.approved_quantity > requested.requested_quantity
            || approved.rejected_quantity !== requested.requested_quantity - approved.approved_quantity;
        })
        || !event.details.approved_lines.some((line) => line.approved_quantity > 0)) {
        throw new RepositoryError("DISTRIBUTION_APPROVAL_INVALID", "Snapshot persetujuan kuantitas distribusi tidak valid.");
      }
    }
    eventStatuses.set(key, event.to_status);
  }

  for (const request of state.stockRequests) {
    if (!state.distributionEvents.some((event) => event.document_type === "request" && event.document_id === request.request_id && event.event_type === "REQUESTED")) {
      throw new RepositoryError("DISTRIBUTION_HISTORY_MISSING", "Permintaan distribusi wajib memiliki event pembentukan.");
    }
    const relatedTransfers = state.stockTransfers.filter((transfer) => transfer.request_id === request.request_id);
    const activeTransfers = relatedTransfers.filter((transfer) => eventStatuses.get(`transfer::${transfer.transfer_id}`) !== "replaced");
    if (activeTransfers.length > 1 || (relatedTransfers.length > 0 && activeTransfers.length !== 1)) {
      throw new RepositoryError("DISTRIBUTION_REALLOCATION_INVALID", "Satu permintaan hanya boleh memiliki satu draft transfer aktif; draft lama harus tercatat sebagai diganti.");
    }
  }
  for (const transfer of state.stockTransfers) {
    if (!state.distributionEvents.some((event) => event.document_type === "transfer" && event.document_id === transfer.transfer_id && event.event_type === "ALLOCATED")) {
      throw new RepositoryError("DISTRIBUTION_HISTORY_MISSING", "Draft distribusi wajib memiliki event alokasi.");
    }
  }

  const receiptLineIds = new Set();
  for (const receipt of state.distributionReceipts) {
    const transfer = transfers.get(receipt.transfer_id);
    if (!transfer || !isTimestampWithOffset(receipt.received_at) || !isValidDateOnly(receipt.effective_date)
      || typeof receipt.received_by !== "string" || !receipt.received_by.trim()
      || typeof receipt.reason !== "string" || !receipt.reason.trim()
      || !Array.isArray(receipt.lines) || !receipt.lines.length) {
      throw new RepositoryError("DISTRIBUTION_RECEIPT_INVALID", "Catatan penerimaan harus memiliki transfer, waktu, aktor, alasan, dan baris.");
    }
    const event = state.distributionEvents.find((item) => item.document_type === "transfer" && item.document_id === transfer.transfer_id && item.event_type !== "ALLOCATED" && item.details.receipt_id === receipt.receipt_id);
    if (!event) throw new RepositoryError("DISTRIBUTION_RECEIPT_HISTORY_MISSING", "Penerimaan harus dicatat dalam riwayat transfer.");
    for (const line of receipt.lines) {
      const transferLine = transfer.lines.find((item) => item.transfer_line_id === line.transfer_line_id);
      const sourceBatch = batches.get(line.source_batch_id);
      const destinationBatch = batches.get(line.destination_batch_id);
      if (!transferLine || line.source_batch_id !== transferLine.source_batch_id
        || line.product_id !== transferLine.product_id || line.lot_number_snapshot !== transferLine.lot_number_snapshot
        || line.shipped_quantity !== transferLine.allocated_quantity
        || !sourceBatch || sourceBatch.warehouse_id !== transfer.source_warehouse_id
        || !destinationBatch || destinationBatch.warehouse_id !== transfer.destination_warehouse_id
        || destinationBatch.product_id !== transferLine.product_id
        || destinationBatch.lot_number !== transferLine.lot_number_snapshot
        || destinationBatch.expiry_date !== transferLine.expiry_date_snapshot
        || destinationBatch.rotation_policy !== transferLine.rotation_policy_snapshot
        || !PHYSICAL_STOCK_BUCKETS.includes(line.condition_bucket)
        || !Number.isSafeInteger(line.received_quantity) || line.received_quantity <= 0
        || !Number.isSafeInteger(line.short_quantity) || line.short_quantity < 0
        || line.received_quantity + line.short_quantity > transferLine.allocated_quantity
        || (line.condition_bucket === "AVAILABLE" && destinationBatch.expiry_date !== null && destinationBatch.expiry_date <= receipt.effective_date)
        || (line.short_quantity > 0 && (typeof line.discrepancy_reason !== "string" || !line.discrepancy_reason.trim()))
        || receiptLineIds.has(`${receipt.receipt_id}::${line.transfer_line_id}`)) {
        throw new RepositoryError("DISTRIBUTION_RECEIPT_LINE_INVALID", "Penerimaan batch tidak sesuai snapshot pengiriman atau tidak mencatat selisih.");
      }
      receiptLineIds.add(`${receipt.receipt_id}::${line.transfer_line_id}`);
    }
    const ledger = state.stockMovements.filter((movement) => movement.movement_type === "DISTRIBUTION_RECEIPT" && movement.reference_id === receipt.receipt_id);
    if (ledger.length !== receipt.lines.length * 2) throw new RepositoryError("DISTRIBUTION_RECEIPT_LEDGER_MISMATCH", "Penerimaan harus menyeimbangkan transit dan stok tujuan pada ledger.");
    for (const line of receipt.lines) {
      const pair = ledger.filter((movement) => movement.inventory_batch_id === line.source_batch_id || movement.inventory_batch_id === line.destination_batch_id);
      const outgoing = pair.find((movement) => movement.stock_bucket === "IN_TRANSIT" && movement.quantity_delta < 0 && movement.inventory_batch_id === line.source_batch_id);
      const incoming = pair.find((movement) => movement.stock_bucket === line.condition_bucket && movement.quantity_delta > 0 && movement.inventory_batch_id === line.destination_batch_id);
      if (pair.length !== 2 || !outgoing || !incoming || -outgoing.quantity_delta !== line.received_quantity
        || incoming.quantity_delta !== line.received_quantity || outgoing.occurred_at !== receipt.received_at
        || incoming.occurred_at !== receipt.received_at || outgoing.actor_id !== receipt.received_by || incoming.actor_id !== receipt.received_by) {
        throw new RepositoryError("DISTRIBUTION_RECEIPT_LEDGER_MISMATCH", "Mutasi penerimaan tidak cocok dengan jumlah, batch, atau aktor pada dokumen.");
      }
    }
  }

  for (const transfer of state.stockTransfers) {
    const shippedEvent = state.distributionEvents.find((event) => event.document_type === "transfer" && event.document_id === transfer.transfer_id && event.event_type === "SHIPPED");
    const dispatchLedger = state.stockMovements.filter((movement) => movement.movement_type === "DISTRIBUTION_DISPATCH" && movement.reference_id === transfer.transfer_id);
    if (shippedEvent) {
      if (dispatchLedger.length !== transfer.lines.length * 2) throw new RepositoryError("DISTRIBUTION_DISPATCH_LEDGER_MISMATCH", "Dispatch harus mengurangi AVAILABLE dan menambah IN_TRANSIT untuk setiap batch dalam satu commit.");
      for (const line of transfer.lines) {
        const pair = dispatchLedger.filter((movement) => movement.inventory_batch_id === line.source_batch_id);
        const outgoing = pair.find((movement) => movement.stock_bucket === "AVAILABLE" && movement.quantity_delta < 0);
        const incoming = pair.find((movement) => movement.stock_bucket === "IN_TRANSIT" && movement.quantity_delta > 0);
        if (pair.length !== 2 || !outgoing || !incoming || -outgoing.quantity_delta !== line.allocated_quantity
          || incoming.quantity_delta !== line.allocated_quantity || outgoing.occurred_at !== shippedEvent.occurred_at
          || incoming.occurred_at !== shippedEvent.occurred_at
          || outgoing.actor_id !== shippedEvent.actor_id || incoming.actor_id !== shippedEvent.actor_id
          || outgoing.reason !== shippedEvent.reason || incoming.reason !== shippedEvent.reason) {
          throw new RepositoryError("DISTRIBUTION_DISPATCH_LEDGER_MISMATCH", "Kuantitas dispatch tidak cocok dengan snapshot alokasi draft.");
        }
      }
    } else if (dispatchLedger.length) {
      throw new RepositoryError("DISTRIBUTION_DISPATCH_HISTORY_MISSING", "Ledger dispatch tidak boleh ada tanpa event pengiriman.");
    }
  }

  for (const movement of state.stockMovements.filter((item) => item.movement_type === "DISTRIBUTION_RECONCILIATION")) {
    const event = state.distributionEvents.find((item) => item.document_type === "transfer" && item.event_type === "DISCREPANCY_RECONCILED" && item.details.reference_id === movement.reference_id);
    const transfer = event ? transfers.get(event.document_id) : null;
    const line = transfer?.lines.find((item) => item.transfer_line_id === event.details.transfer_line_id);
    if (!event || !line || event.details.resolved_quantity !== -movement.quantity_delta
      || movement.inventory_batch_id !== line.source_batch_id || movement.warehouse_id !== transfer.source_warehouse_id
      || movement.actor_id !== event.actor_id || movement.occurred_at !== event.occurred_at || movement.reason !== event.reason) {
      throw new RepositoryError("DISTRIBUTION_RECONCILIATION_INVALID", "Koreksi sisa transit harus memiliki event rekonsiliasi yang merujuk baris batch.");
    }
  }
  if (state.stockMovements.some((movement) => movement.movement_type === "DISTRIBUTION_DISPATCH" && !transferIds.has(movement.reference_id))
    || state.stockMovements.some((movement) => movement.movement_type === "DISTRIBUTION_RECEIPT" && !receiptIds.has(movement.reference_id))) {
    throw new RepositoryError("DISTRIBUTION_LEDGER_ORPHAN", "Mutasi distribusi harus selalu merujuk dokumen transfer atau penerimaan yang tersimpan.");
  }
  return true;
}

function assertPosAppendOnly(previous, next) {
  const oldKeys = POS_COLLECTION_KEYS.filter((key) => Object.hasOwn(previous, key));
  const newKeys = POS_COLLECTION_KEYS.filter((key) => Object.hasOwn(next, key));
  if (oldKeys.length === 0 && (newKeys.length === 0 || newKeys.length === POS_COLLECTION_KEYS.length)) return;
  if (oldKeys.length !== POS_COLLECTION_KEYS.length || newKeys.length !== POS_COLLECTION_KEYS.length) {
    throw new RepositoryError("POS_COLLECTIONS_APPEND_ONLY", "Mutasi transaksi tidak boleh menghapus atau menghilangkan koleksi kasir.");
  }
  assertShiftCollectionPrefix(previous.cashShifts, next.cashShifts);
  assertCollectionPrefix(previous.sales, next.sales, "sale_id", "Transaksi");
  assertCollectionPrefix(previous.payments, next.payments, "payment_id", "Pembayaran");
  assertCollectionPrefix(previous.cashMovements, next.cashMovements, "cash_movement_id", "Mutasi kas");
}

function assertShiftCollectionPrefix(previous, next) {
  if (!Array.isArray(previous) || !Array.isArray(next) || next.length < previous.length) {
    throw new RepositoryError("POS_COLLECTIONS_APPEND_ONLY", "Shift kasir yang sudah tersimpan tidak boleh dihapus.");
  }
  const closureFields = ["closed_at", "closed_by", "closing_cash_idr", "expected_cash_idr", "cash_difference_idr"];
  for (let index = 0; index < previous.length; index += 1) {
    const before = previous[index];
    const after = next[index];
    if (sameRecord(before, after)) continue;
    const beforeClosure = before.status === "active" && after.status === "closed";
    const unchangedRecord = { ...after };
    closureFields.forEach((field) => delete unchangedRecord[field]);
    unchangedRecord.status = "active";
    if (!beforeClosure
      || closureFields.some((field) => !Object.hasOwn(after, field))
      || !sameRecord(before, unchangedRecord)) {
      throw new RepositoryError("POS_COLLECTIONS_APPEND_ONLY", "Histori shift hanya boleh berubah satu kali melalui penutupan; shift tertutup tidak dapat diubah.");
    }
  }
}

function sameRecord(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertCollectionPrefix(previous, next, key, label, errorCode = "INVENTORY_LEDGER_APPEND_ONLY") {
  if (!Array.isArray(previous) || !Array.isArray(next) || next.length < previous.length) {
    throw new RepositoryError(errorCode, `${label} yang sudah tersimpan tidak boleh dihapus.`);
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (!sameRecord(previous[index], next[index])) {
      throw new RepositoryError(errorCode, `${label} yang sudah tersimpan tidak boleh diubah atau diurut ulang.`);
    }
  }
}

function assertInventoryAppendOnly(previous, next, { allowMigration = false, allowDistributionMigration = false, allowCatalogMigration = false } = {}) {
  const oldKeys = INVENTORY_COLLECTION_KEYS.filter((key) => Object.hasOwn(previous, key));
  const newKeys = INVENTORY_COLLECTION_KEYS.filter((key) => Object.hasOwn(next, key));
  if (oldKeys.length === 0 && newKeys.length === INVENTORY_COLLECTION_KEYS.length && allowMigration) {
    branchExpansionMigrationPreservesExisting(previous, next, { allowInventoryMigration: true, allowDistributionMigration, allowCatalogMigration });
    return;
  }
  if (oldKeys.length !== INVENTORY_COLLECTION_KEYS.length || newKeys.length !== INVENTORY_COLLECTION_KEYS.length) {
    throw new RepositoryError("INVENTORY_LEDGER_APPEND_ONLY", "Mutasi snapshot tidak boleh menghapus atau menghilangkan koleksi persediaan.");
  }
  assertCollectionPrefix(previous.warehouses, next.warehouses, "warehouse_id", "Gudang");
  assertCollectionPrefix(previous.stockLocations, next.stockLocations, "stock_location_id", "Lokasi");
  assertCollectionPrefix(previous.inventoryBatches, next.inventoryBatches, "inventory_batch_id", "Batch");
  assertCollectionPrefix(previous.stockMovements, next.stockMovements, "movement_id", "Ledger mutasi");
}

function assertDistributionAppendOnly(previous, next, { allowMigration = false, allowInventoryMigration = false, allowCatalogMigration = false } = {}) {
  const oldKeys = DISTRIBUTION_COLLECTION_KEYS.filter((key) => Object.hasOwn(previous, key));
  const newKeys = DISTRIBUTION_COLLECTION_KEYS.filter((key) => Object.hasOwn(next, key));
  if (oldKeys.length === 0 && newKeys.length === DISTRIBUTION_COLLECTION_KEYS.length && allowMigration) {
    branchExpansionMigrationPreservesExisting(previous, next, { allowInventoryMigration, allowDistributionMigration: true, allowCatalogMigration });
    return;
  }
  if (oldKeys.length !== DISTRIBUTION_COLLECTION_KEYS.length || newKeys.length !== DISTRIBUTION_COLLECTION_KEYS.length) {
    throw new RepositoryError("DISTRIBUTION_COLLECTIONS_APPEND_ONLY", "Koleksi distribusi tersimpan tidak boleh dihapus atau dihilangkan.");
  }
  assertCollectionPrefix(previous.stockRequests, next.stockRequests, "request_id", "Permintaan distribusi", "DISTRIBUTION_HISTORY_APPEND_ONLY");
  assertCollectionPrefix(previous.stockTransfers, next.stockTransfers, "transfer_id", "Draft distribusi", "DISTRIBUTION_HISTORY_APPEND_ONLY");
  assertCollectionPrefix(previous.distributionReceipts, next.distributionReceipts, "receipt_id", "Penerimaan distribusi", "DISTRIBUTION_HISTORY_APPEND_ONLY");
  assertCollectionPrefix(previous.distributionEvents, next.distributionEvents, "event_id", "Riwayat distribusi", "DISTRIBUTION_HISTORY_APPEND_ONLY");
}

export function validateDemoState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new RepositoryError("STORAGE_DATA_INVALID", "Struktur penyimpanan demo tidak valid.");
  }
  if (state.schema_version !== DEMO_SCHEMA_VERSION) {
    throw new RepositoryError("STORAGE_SCHEMA_UNSUPPORTED", "Versi data demo tidak didukung. Reset demo untuk membuat data versi terbaru.");
  }
  const organizationId = state.organization?.organization_id;
  if (typeof organizationId !== "string" || !organizationId.trim()) {
    throw new RepositoryError("STORAGE_DATA_INVALID", "Organisasi pada penyimpanan demo tidak valid.");
  }
  if (state.meta?.applied_migrations !== undefined
    && (!Array.isArray(state.meta.applied_migrations)
      || new Set(state.meta.applied_migrations).size !== state.meta.applied_migrations.length
      || state.meta.applied_migrations.some((migrationId) => typeof migrationId !== "string" || !migrationId.trim()))) {
    throw new RepositoryError("STORAGE_DATA_INVALID", "Riwayat migrasi demo tidak valid.");
  }
  validateBranchExpansionMarker(state);

  const regionIds = assertCollectionIds(state.regions, "region_id", "wilayah");
  const branchIds = assertCollectionIds(state.branches, "branch_id", "cabang");
  const categoryIds = assertCollectionIds(state.categories, "category_id", "kategori");
  const unitIds = assertCollectionIds(state.units, "unit_id", "satuan");
  assertCollectionIds(state.pricingRules, "price_rule_id", "aturan harga");
  const productIds = assertCollectionIds(state.products, "product_id", "produk");
  validateCatalogExpansionMarker(state);
  const skus = new Set();
  const barcodes = new Set();
  const rulesByPair = new Map();
  const expectedRegions = ["REG-JKT", "REG-BDG"];
  const expectedBranches = ["BR-JKT-01", "BR-BDG-01"];
  const expectedCategories = ["CAT-SNACK", "CAT-MINUMAN", "CAT-MAKANAN", "CAT-SEMBAKO"];
  const expectedUnits = ["UNIT-BUNGKUS", "UNIT-BOTOL", "UNIT-KOTAK", "UNIT-KARUNG", "UNIT-PCS"];
  const expectedProducts = ["PRD-001", "PRD-002", "PRD-003", "PRD-004", "PRD-005", "PRD-006"];

  if (organizationId !== "ORG-001"
    || state.organization.name !== "Minimarket Nusantara"
    || state.units.length !== 5
    || expectedRegions.some((id) => !regionIds.has(id))
    || expectedBranches.some((id) => !branchIds.has(id))
    || expectedCategories.some((id) => !categoryIds.has(id))
    || expectedUnits.some((id) => !unitIds.has(id))
    || expectedProducts.some((id) => !productIds.has(id))) {
    throw new RepositoryError("STORAGE_DATA_INVALID", "Data organisasi, cabang, atau produk kanonis pada seed demo tidak lengkap.");
  }

  if (!state.regions.every((region) => region.organization_id === organizationId)) {
    throw new RepositoryError("STORAGE_DATA_INVALID", "Wilayah mengacu ke organisasi yang tidak valid.");
  }
  const regionCodes = new Set();
  for (const region of state.regions) {
    const code = typeof region.code === "string" ? region.code.trim().toLocaleLowerCase("id-ID") : "";
    if (!code || typeof region.name !== "string" || !region.name.trim() || !["active", "inactive"].includes(region.status) || regionCodes.has(code)) {
      throw new RepositoryError("STORAGE_DATA_INVALID", "Kode, nama, atau status wilayah tidak valid atau duplikat.");
    }
    regionCodes.add(code);
  }
  const expectedBranchRegions = new Map([
    ["BR-JKT-01", "REG-JKT"], ["BR-BDG-01", "REG-BDG"],
    ...EXPANSION_BRANCHES.map((branch) => [branch.branch_id, branch.region_id]),
  ]);
  const branchCodes = new Set();
  if (!state.branches.every((branch) => {
    const code = typeof branch.code === "string" ? branch.code.trim().toLocaleLowerCase("id-ID") : "";
    const expectedRegionId = expectedBranchRegions.get(branch.branch_id);
    if (!code || typeof branch.name !== "string" || !branch.name.trim() || !["active", "inactive"].includes(branch.status)
      || branchCodes.has(code) || !regionIds.has(branch.region_id) || (expectedRegionId && expectedRegionId !== branch.region_id)) return false;
    branchCodes.add(code);
    return true;
  })) {
    throw new RepositoryError("STORAGE_DATA_INVALID", "Cabang mengacu ke wilayah yang tidak tersedia.");
  }
  if (!state.categories.every((category) => category.organization_id === organizationId)) {
    throw new RepositoryError("STORAGE_DATA_INVALID", "Kategori mengacu ke organisasi yang tidak valid.");
  }
  const categoryCodes = new Set();
  for (const category of state.categories) {
    const code = typeof category.code === "string" ? category.code.trim().toLocaleLowerCase("id-ID") : "";
    if (!code || typeof category.name !== "string" || !category.name.trim() || !["active", "inactive"].includes(category.status) || categoryCodes.has(code)) {
      throw new RepositoryError("STORAGE_DATA_INVALID", "Kode, nama, atau status kategori tidak valid atau duplikat.");
    }
    categoryCodes.add(code);
  }
  if (!state.units.every((unit) => unit.organization_id === organizationId)) {
    throw new RepositoryError("STORAGE_DATA_INVALID", "Satuan mengacu ke organisasi yang tidak valid.");
  }
  for (const rule of state.pricingRules) {
    const pair = `${rule.region_id}::${rule.category_id}`;
    if (!regionIds.has(rule.region_id)
      || !categoryIds.has(rule.category_id)
      || !Number.isFinite(rule.adjustment_percent)
      || !Number.isInteger(rule.version)
      || rule.version < 1
      || !isValidDateOnly(rule.valid_from)
      || (rule.valid_until !== null && !isValidDateOnly(rule.valid_until))
      || !["active", "inactive"].includes(rule.status)) {
      throw new RepositoryError("STORAGE_DATA_INVALID", "Ada aturan harga demo dengan relasi atau nilai yang tidak valid.");
    }
    if (rule.valid_until !== null && rule.valid_until < rule.valid_from) {
      throw new RepositoryError("PRICE_RULE_INVALID_DATE", "Tanggal akhir aturan harga tidak boleh mendahului tanggal mulai.");
    }
    const scopedRules = rulesByPair.get(pair) ?? [];
    for (const existingRule of scopedRules) {
      if (priceRulePeriodsOverlap(existingRule, rule)) {
        throw new RepositoryError("PRICE_RULE_OVERLAP", "Periode aturan harga untuk wilayah dan kategori yang sama tidak boleh bertumpang tindih.");
      }
    }
    scopedRules.push(rule);
    rulesByPair.set(pair, scopedRules);
  }

  for (const product of state.products) {
    if (!productIds.has(product.product_id)
      || product.organization_id !== organizationId
      || !categoryIds.has(product.category_id)
      || !unitIds.has(product.unit_id)
      || typeof product.name !== "string"
      || !product.name.trim()
      || typeof product.sku !== "string"
      || !product.sku.trim()
      || !Number.isSafeInteger(product.base_price_idr)
      || product.base_price_idr < 0
      || typeof product.barcode !== "string"
      || !["required", "optional", "not_required"].includes(product.expiry_policy)
      || !["active", "inactive"].includes(product.status)) {
      throw new RepositoryError("STORAGE_DATA_INVALID", "Ada produk dengan data atau relasi yang tidak valid.");
    }
    if ((product.age_restricted !== undefined && typeof product.age_restricted !== "boolean")
      || (product.category_id === "CAT-ROKOK-TEMBAKAU" && product.age_restricted !== true)) {
      throw new RepositoryError("STORAGE_DATA_INVALID", "Produk kategori Rokok & Tembakau harus ditandai pembatasan usia.");
    }
    const skuKey = product.sku.trim().toLocaleLowerCase("id-ID");
    if (skus.has(skuKey)) {
      throw new RepositoryError("STORAGE_DATA_INVALID", "SKU ganda pada penyimpanan demo.");
    }
    skus.add(skuKey);
    const barcode = typeof product.barcode === "string" ? product.barcode.trim() : "";
    if (barcode) {
      if (barcodes.has(barcode)) {
        throw new RepositoryError("STORAGE_DATA_INVALID", "Barcode ganda pada penyimpanan demo.");
      }
      barcodes.add(barcode);
    }

  }

  for (const regionId of regionIds) {
    for (const categoryId of categoryIds) {
      const pair = `${regionId}::${categoryId}`;
      const activeAtReferenceDate = (rulesByPair.get(pair) ?? []).filter((rule) => (
        rule.status === "active" && ruleCoversDate(rule, DEMO_REFERENCE_DATE)
      ));
      if (activeAtReferenceDate.length === 0) {
        throw new RepositoryError("PRICE_RULE_MISSING", `Aturan harga aktif untuk ${pair} tidak tersedia pada tanggal demo.`);
      }
      if (activeAtReferenceDate.length > 1) {
        throw new RepositoryError("PRICE_RULE_OVERLAP", `Lebih dari satu aturan harga aktif untuk ${pair} pada tanggal demo.`);
      }
    }
  }

  const productsByCategory = new Map();
  for (const product of state.products) {
    const categoryProducts = productsByCategory.get(product.category_id) ?? [];
    categoryProducts.push(product);
    productsByCategory.set(product.category_id, categoryProducts);
  }
  for (const rule of state.pricingRules) {
    for (const product of productsByCategory.get(rule.category_id) ?? []) {
      const adjustedPrice = product.base_price_idr * (1 + rule.adjustment_percent / 100);
      const roundedPrice = Math.round(adjustedPrice);
      if (!Number.isFinite(adjustedPrice)
        || adjustedPrice < 0
        || !Number.isSafeInteger(roundedPrice)
        || roundedPrice < 0) {
        throw new RepositoryError("PRICE_RULE_UNSAFE", "Penyesuaian aturan harga menghasilkan nominal negatif atau tidak aman.");
      }
    }
  }

  validateInventoryState(state, productIds, branchIds);
  validatePosState(state, branchIds, productIds);
  validateDistributionState(state, productIds, branchIds);

  return true;
}

export function createLocalStorageRepository(storage = null) {
  let storageHandle = storage;
  const getStorage = () => {
    if (storageHandle) return storageHandle;
    try {
      storageHandle = window.localStorage;
      return storageHandle;
    } catch (error) {
      throw new RepositoryError("STORAGE_READ_FAILED", "Penyimpanan lokal browser tidak dapat diakses.", error);
    }
  };

  const persist = (state, options = {}) => {
    validateDemoState(state);
    const storageRef = getStorage();
    if (!options.allowReset) {
      let currentSerialized;
      try {
        currentSerialized = storageRef.getItem(DEMO_STORAGE_KEY);
      } catch (error) {
        throw new RepositoryError("STORAGE_READ_FAILED", "Data demo tersimpan tidak dapat diperiksa sebelum perubahan.", error);
      }
      if (currentSerialized !== null) {
        let currentState;
        try {
          currentState = JSON.parse(currentSerialized);
          validateDemoState(currentState);
        } catch (error) {
          if (error instanceof RepositoryError) throw error;
          throw new RepositoryError("STORAGE_PARSE_FAILED", "Data demo tersimpan rusak dan tidak dapat ditimpa tanpa reset eksplisit.", error);
        }
        assertInventoryAppendOnly(currentState, state, {
          allowMigration: options.allowMigration,
          allowDistributionMigration: options.allowDistributionMigration,
          allowCatalogMigration: options.allowCatalogMigration,
        });
        assertPosAppendOnly(currentState, state);
        assertDistributionAppendOnly(currentState, state, {
          allowMigration: options.allowDistributionMigration,
          allowInventoryMigration: options.allowMigration,
          allowCatalogMigration: options.allowCatalogMigration,
        });
        if (options.allowCatalogMigration) {
          assertCatalogMigrationPreservesExisting(currentState, state, {
            allowBranchExpansion: options.allowBranchExpansion,
            allowInventoryMigration: options.allowMigration,
            allowDistributionMigration: options.allowDistributionMigration,
            allowCatalogMigration: options.allowCatalogMigration,
          });
        }
      }
    }
    const serialized = JSON.stringify(state);
    try {
      storageRef.setItem(DEMO_STORAGE_KEY, serialized);
    } catch (error) {
      throw new RepositoryError("STORAGE_COMMIT_FAILED", "Perubahan gagal disimpan. Periksa ruang penyimpanan browser lalu coba lagi.", error);
    }
    return clone(state);
  };

  const commit = (state) => persist(state);

  return Object.freeze({
    load() {
      let serialized;
      try {
        serialized = getStorage().getItem(DEMO_STORAGE_KEY);
      } catch (error) {
        if (error instanceof RepositoryError) throw error;
        throw new RepositoryError("STORAGE_READ_FAILED", "Data demo tidak dapat dibaca dari penyimpanan browser.", error);
      }
      if (serialized === null) return persist(createDemoSeed(), { allowReset: true });

      let state;
      try {
        state = JSON.parse(serialized);
      } catch (error) {
        throw new RepositoryError("STORAGE_PARSE_FAILED", "Data demo rusak dan tidak dapat dibaca. Gunakan Reset Data Demo untuk membuat ulang.", error);
      }
      validateDemoState(state);
      const hasInventory = INVENTORY_COLLECTION_KEYS.every((key) => Object.hasOwn(state, key));
      const hasAnyInventory = INVENTORY_COLLECTION_KEYS.some((key) => Object.hasOwn(state, key));
      const hasDistribution = DISTRIBUTION_COLLECTION_KEYS.every((key) => Object.hasOwn(state, key));
      const hasAnyDistribution = DISTRIBUTION_COLLECTION_KEYS.some((key) => Object.hasOwn(state, key));
      if (!hasInventory && hasAnyInventory) throw new RepositoryError("STORAGE_DATA_INVALID", "Koleksi persediaan pada penyimpanan demo tidak lengkap.");
      if (!hasDistribution && hasAnyDistribution) throw new RepositoryError("STORAGE_DATA_INVALID", "Koleksi distribusi pada penyimpanan demo tidak lengkap.");

      const migrationApplied = state.meta?.applied_migrations?.includes(BRANCH_EXPANSION_MIGRATION_ID) ?? false;
      const branchExpansionNeeded = !migrationApplied && !hasCompleteBranchExpansionStructure(state);
      const catalogMigrationApplied = state.meta?.applied_migrations?.includes(CATALOG_EXPANSION_MIGRATION_ID) ?? false;
      const catalogExpansionNeeded = !catalogMigrationApplied;
      const inventoryMigrationNeeded = !hasInventory && !hasAnyInventory;
      const distributionMigrationNeeded = !hasDistribution && !hasAnyDistribution;
      if (!branchExpansionNeeded && !catalogExpansionNeeded && !inventoryMigrationNeeded && !distributionMigrationNeeded) return clone(state);

      let next = branchExpansionNeeded ? applyBranchExpansion(state) : clone(state);
      if (inventoryMigrationNeeded && branchExpansionNeeded === false) Object.assign(next, createInventorySeed());
      if (distributionMigrationNeeded) Object.assign(next, { stockRequests: [], stockTransfers: [], distributionReceipts: [], distributionEvents: [] });
      if (catalogExpansionNeeded) next = applyCatalogExpansion(next);
      if (!next.meta.applied_migrations?.includes(BRANCH_EXPANSION_MIGRATION_ID)) {
        next.meta = { ...next.meta, applied_migrations: [...(next.meta.applied_migrations ?? []), BRANCH_EXPANSION_MIGRATION_ID] };
      }
      validateDemoState(next);
      return persist(next, {
        allowMigration: inventoryMigrationNeeded,
        allowDistributionMigration: distributionMigrationNeeded,
        allowCatalogMigration: catalogExpansionNeeded,
        allowBranchExpansion: branchExpansionNeeded,
      });
    },
    commit,
    reset() {
      return persist(createDemoSeed(), { allowReset: true });
    },
  });
}


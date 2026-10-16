import { createLocalStorageRepository } from "../repositories/local-storage-repository.js";
import {
  CATALOG_COVERAGE_STOCK_MARKER,
  CATALOG_COVERAGE_STOCK_MANIFEST,
  CATALOG_COVERAGE_STOCK_VERSION,
  createBranchDemoStockRows,
  createCatalogBranchDemoStockRows,
  createCatalogCoverageStockRows,
  DEMO_STOCK_PROVISIONING_VERSION,
} from "../data/inventory-seed.js";
import { createInventoryRepository } from "../repositories/inventory-repository.js";
import { InventoryService } from "./inventory-service.js";
import {
  CATALOG_EXPANSION_CATEGORIES,
  CATALOG_DEMO_STOCK_PROVISIONING_VERSION,
  CATALOG_EXPANSION_IDENTITY_META_KEY,
  CATALOG_EXPANSION_MIGRATION_ID,
  createCanonicalProductExpansion,
  createCatalogExpansionIdentityManifest,
} from "../data/catalog-expansion.js";

export class DemoStockProvisioningError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "DemoStockProvisioningError";
    this.code = code;
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const sameRecord = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function confirmationToken(state, groups) {
  const payload = JSON.stringify({
    markers: groups.map(({ key, markerKey, version, inspected, manifest }) => ({
      key, markerKey, version, alreadyProvisioned: inspected.alreadyProvisioned,
      absent: inspected.absent.map((index) => key === "coverage" ? manifest.inventory_batch_ids[index] : index),
      effectiveDate: manifest?.effective_date ?? null,
    })),
    productState: state.products.map((product) => [product.product_id, product.status, product.expiry_policy]),
    batchCount: state.inventoryBatches.length,
    movementIds: state.stockMovements.map((movement) => movement.movement_id),
  });
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) hash = Math.imul(hash ^ payload.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function assertAdmin(role) {
  if (role !== "HQ_ADMIN") {
    throw new DemoStockProvisioningError("DEMO_STOCK_PROVISIONING_FORBIDDEN", "Provisioning stok demo hanya tersedia untuk sesi Admin Pusat.");
  }
}

function inspectProvisioningState(state, rows, markerKey, version) {
  const batches = new Map((state.inventoryBatches ?? []).map((item) => [item.inventory_batch_id, item]));
  const movements = new Map((state.stockMovements ?? []).map((item) => [item.movement_id, item]));
  const present = [];
  const absent = [];
  const conflicts = [];

  for (let index = 0; index < rows.inventoryBatches.length; index += 1) {
    const expectedBatch = rows.inventoryBatches[index];
    const expectedMovement = rows.stockMovements[index];
    const batch = batches.get(expectedBatch.inventory_batch_id);
    const movement = movements.get(expectedMovement.movement_id);
    if (!batch && !movement) {
      absent.push(index);
      continue;
    }
    if (batch && movement && sameRecord(batch, expectedBatch) && sameRecord(movement, expectedMovement)) {
      present.push(index);
      continue;
    }
    conflicts.push(expectedBatch.inventory_batch_id);
  }

  const marker = state.meta?.[markerKey];
  if (marker && marker !== version) {
    throw new DemoStockProvisioningError("DEMO_STOCK_PROVISIONING_VERSION_UNSUPPORTED", "Versi provisioning stok " + marker + " berbeda dari versi yang didukung.");
  }
  if (conflicts.length) {
    throw new DemoStockProvisioningError("DEMO_STOCK_PROVISIONING_CONFLICT", "Sebagian record stok demo sudah ada atau berbeda (" + conflicts.slice(0, 4).join(", ") + "). Tidak ada record yang diubah; periksa ledger sebelum melanjutkan.");
  }
  if (marker === version) {
    if (absent.length || present.length !== rows.inventoryBatches.length) {
      throw new DemoStockProvisioningError("DEMO_STOCK_PROVISIONING_MARKER_INCONSISTENT", "Penanda provisioning menyatakan stok demo selesai, tetapi batch atau movement ledger tidak lengkap. Data tidak diperbaiki otomatis.");
    }
    return { alreadyProvisioned: true, absent: [], present };
  }
  if (present.length && absent.length) {
    throw new DemoStockProvisioningError("DEMO_STOCK_PROVISIONING_PARTIAL", "Sebagian stok demo sudah ada tanpa penanda provisioning lengkap. Tidak ada stok yang ditambahkan; periksa batch dan ledger terlebih dahulu.");
  }
  return { alreadyProvisioned: false, absent, present };
}

function assertCatalogStockTargets(state, rows) {
  const appliedMigrations = state.meta?.applied_migrations ?? [];
  if (!appliedMigrations.includes(CATALOG_EXPANSION_MIGRATION_ID)) {
    throw new DemoStockProvisioningError(
      "DEMO_STOCK_CATALOG_NOT_MIGRATED",
      "Stok katalog tidak dapat diprovisikan sebelum migrasi katalog selesai dan tervalidasi.",
    );
  }

  const canonicalProducts = createCanonicalProductExpansion(state.organization.organization_id, state.meta?.seeded_at);
  const canonicalProductById = new Map(canonicalProducts.map((product) => [product.product_id, product]));
  const canonicalProductIds = new Set([
    ...canonicalProductById.keys(),
    ...Array.from({ length: 6 }, (_, index) => `PRD-${String(index + 1).padStart(3, "0")}`),
  ]);
  const categories = new Set((state.categories ?? []).map((category) => category.category_id));
  const categoriesById = new Map((state.categories ?? []).map((category) => [category.category_id, category]));
  const products = new Map((state.products ?? []).map((product) => [product.product_id, product]));
  const targetIds = new Set(rows.inventoryBatches.map((batch) => batch.product_id));
  const expectedManifest = createCatalogExpansionIdentityManifest(state.organization.organization_id);
  const recordedManifest = state.meta?.[CATALOG_EXPANSION_IDENTITY_META_KEY];
  if (recordedManifest !== undefined && !sameRecord(recordedManifest, expectedManifest)) {
    throw new DemoStockProvisioningError(
      "DEMO_STOCK_CATALOG_IDENTITY_UNVERIFIED",
      "Provenance identitas katalog tidak cocok dengan seed kanonis. Provisioning dihentikan; periksa data katalog secara manual.",
    );
  }

  // Older states may carry the catalog migration marker without provenance.
  // In that case require live identity to match before provisioning; otherwise
  // a user-created PRD-007 could receive seed demo stock after the old migration.
  if (recordedManifest === undefined) {
    const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase("id-ID");
    for (const expected of CATALOG_EXPANSION_CATEGORIES) {
      const category = categoriesById.get(expected.category_id);
      if (!category || normalize(category.code) !== normalize(expected.code)) {
        throw new DemoStockProvisioningError(
          "DEMO_STOCK_CATALOG_IDENTITY_UNVERIFIED",
          `Identitas kategori ${expected.category_id} belum dapat diverifikasi. Provisioning dihentikan; Admin perlu meninjau kode kategori secara manual.`,
        );
      }
    }
    for (const productId of targetIds) {
      const product = products.get(productId);
      const expected = canonicalProductById.get(productId);
      if (!expected) continue;
      if (!product || !expected || normalize(product.sku) !== normalize(expected.sku)
        || String(product.barcode ?? "").trim() !== String(expected.barcode ?? "").trim()) {
        throw new DemoStockProvisioningError(
          "DEMO_STOCK_CATALOG_IDENTITY_UNVERIFIED",
          `Identitas ${productId} belum dapat diverifikasi pada state migrasi lama. Provisioning dihentikan agar stok tidak ditempelkan ke produk lain; periksa SKU dan barcode secara manual.`,
        );
      }
    }
  }

  for (const productId of targetIds) {
    const product = products.get(productId);
    if (!canonicalProductIds.has(productId) || !product || !categories.has(product.category_id)
      || product.organization_id !== state.organization.organization_id) {
      throw new DemoStockProvisioningError(
        "DEMO_STOCK_CATALOG_TARGET_INVALID",
        `Target stok katalog ${productId} tidak terhubung ke produk katalog yang tervalidasi. Tidak ada batch atau ledger yang ditambahkan. Periksa migrasi dan referensi produk secara manual.`,
      );
    }
  }
}

function validDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function businessDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new DemoStockProvisioningError("DEMO_STOCK_CLOCK_INVALID", "Tanggal provisioning stok tidak valid.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getCoverageRowsForState(state, provisioningDate = state.meta.reference_date) {
  const marker = state.meta?.[CATALOG_COVERAGE_STOCK_MARKER];
  const storedManifest = state.meta?.[CATALOG_COVERAGE_STOCK_MANIFEST];
  const effectiveDate = marker === undefined ? provisioningDate : storedManifest?.effective_date;
  const recordedAt = marker === undefined ? `${provisioningDate}T00:00:00+07:00` : storedManifest?.recorded_at;
  if (!validDateOnly(effectiveDate) || typeof recordedAt !== "string" || !Number.isFinite(Date.parse(recordedAt))) {
    throw new DemoStockProvisioningError("DEMO_STOCK_COVERAGE_MARKER_INCONSISTENT", "Tanggal efektif atau waktu pencatatan manifest stok katalog tidak valid.");
  }
  const allRows = createCatalogCoverageStockRows(state.products ?? [], { effectiveDate, recordedAt });
  const batchesById = new Map((state.inventoryBatches ?? []).map((batch) => [batch.inventory_batch_id, batch]));
  const movementsById = new Map((state.stockMovements ?? []).map((movement) => [movement.movement_id, movement]));
  const manifest = storedManifest;
  if (marker !== undefined && marker !== CATALOG_COVERAGE_STOCK_VERSION) {
    throw new DemoStockProvisioningError("DEMO_STOCK_PROVISIONING_VERSION_UNSUPPORTED", `Versi cakupan stok katalog ${marker} tidak didukung.`);
  }
  if (marker !== undefined) {
    const ids = manifest?.version === CATALOG_COVERAGE_STOCK_VERSION && Array.isArray(manifest.inventory_batch_ids)
      ? manifest.inventory_batch_ids
      : null;
    if (!ids || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) {
      throw new DemoStockProvisioningError("DEMO_STOCK_COVERAGE_MARKER_INCONSISTENT", "Penanda cakupan stok ada tetapi manifest batch tidak lengkap atau tidak valid. Data tidak diperbaiki otomatis.");
    }
    const rowsById = new Map(allRows.inventoryBatches.map((batch, index) => [batch.inventory_batch_id, index]));
    const indexes = ids.map((id) => rowsById.get(id));
    if (indexes.some((index) => index === undefined)) {
      throw new DemoStockProvisioningError("DEMO_STOCK_COVERAGE_MARKER_INCONSISTENT", "Manifest cakupan stok memuat ID batch yang bukan bagian dari seed kanonis.");
    }
    const expectedIdSet = new Set(ids);
    const extraSeedBatches = [...batchesById.keys()].filter((id) => id.startsWith("BAT-COVER-") && !expectedIdSet.has(id));
    if (extraSeedBatches.length) {
      throw new DemoStockProvisioningError("DEMO_STOCK_COVERAGE_MARKER_INCONSISTENT", `Ditemukan batch cakupan tanpa manifest (${extraSeedBatches.slice(0, 3).join(", ")}). Data tidak diubah.`);
    }
    return {
      rows: {
        inventoryBatches: indexes.map((index) => allRows.inventoryBatches[index]),
        stockMovements: indexes.map((index) => allRows.stockMovements[index]),
      },
      manifest: { version: CATALOG_COVERAGE_STOCK_VERSION, inventory_batch_ids: ids, effective_date: effectiveDate, recorded_at: recordedAt },
    };
  }
  if (manifest !== undefined) {
    throw new DemoStockProvisioningError("DEMO_STOCK_COVERAGE_MARKER_INCONSISTENT", "Manifest cakupan stok tidak mempunyai penanda provisioning yang cocok.");
  }

  const existingSeedRows = allRows.inventoryBatches.filter((batch) => batchesById.has(batch.inventory_batch_id)
    || movementsById.has(`MOV-COVER-${batch.inventory_batch_id.slice("BAT-COVER-".length)}`));
  if (existingSeedRows.length) {
    throw new DemoStockProvisioningError("DEMO_STOCK_PROVISIONING_PARTIAL", "Record batch cakupan sudah ada tanpa marker. Periksa ledger secara manual sebelum provisioning; tidak ada data yang diubah.");
  }

  const branchStock = new Map();
  const virtualRepository = { load: () => state, commit() { throw new Error("Read-only stock coverage audit"); } };
  const inventory = new InventoryService({ repository: createInventoryRepository({ repository: virtualRepository }), now: () => new Date("2026-10-12T12:00:00+07:00") });
  for (const warehouse of state.warehouses.filter((item) => item.warehouse_type === "BRANCH" && item.status === "active")) {
    const workspace = inventory.getWorkspace({ warehouseId: warehouse.warehouse_id, effectiveDate: provisioningDate });
    const balances = new Map();
    for (const batch of workspace.batches) balances.set(batch.product_id, (balances.get(batch.product_id) ?? 0) + batch.sellableQuantity);
    branchStock.set(warehouse.branch_id, balances);
  }

  const activeProducts = new Set(state.products.filter((product) => product.status === "active").map((product) => product.product_id));
  const candidates = [];
  for (let index = 0; index < allRows.inventoryBatches.length; index += 1) {
    const batch = allRows.inventoryBatches[index];
    if (!activeProducts.has(batch.product_id)) continue;
    const branchId = state.warehouses.find((item) => item.warehouse_id === batch.warehouse_id)?.branch_id;
    const sellable = branchStock.get(branchId)?.get(batch.product_id) ?? 0;
    if (sellable > 0) continue;
    if (batch.product_id === "PRD-001" && branchId === "BR-JKT-01") {
      throw new DemoStockProvisioningError("DEMO_STOCK_CANONICAL_GUARD", "Stok PRD-001 Jakarta berada di bawah saldo sellable kanonis. Provisioning katalog dihentikan tanpa menambah atau mengubah SNK-A/SNK-B/SNK-X.");
    }
    candidates.push(index);
  }
  return {
    rows: {
      inventoryBatches: candidates.map((index) => allRows.inventoryBatches[index]),
      stockMovements: candidates.map((index) => allRows.stockMovements[index]),
    },
    manifest: { version: CATALOG_COVERAGE_STOCK_VERSION, inventory_batch_ids: candidates.map((index) => allRows.inventoryBatches[index].inventory_batch_id), effective_date: effectiveDate, recorded_at: recordedAt },
  };
}

function getProvisioningGroups(state, provisioningDate) {
  const coverage = getCoverageRowsForState(state, provisioningDate);
  return [
    { key: "base", markerKey: "demo_stock_provisioning_version", version: DEMO_STOCK_PROVISIONING_VERSION, rows: createBranchDemoStockRows() },
    { key: "catalog", markerKey: "catalog_demo_stock_provisioning_version", version: CATALOG_DEMO_STOCK_PROVISIONING_VERSION, rows: createCatalogBranchDemoStockRows() },
    { key: "coverage", markerKey: CATALOG_COVERAGE_STOCK_MARKER, version: CATALOG_COVERAGE_STOCK_VERSION, rows: coverage.rows, manifest: coverage.manifest },
  ].map((group) => ({ ...group, inspected: inspectProvisioningState(state, group.rows, group.markerKey, group.version) }));
}

export class DemoStockProvisioningService {
  constructor({ repository = createLocalStorageRepository(), now = () => new Date() } = {}) {
    this.repository = repository;
    this.now = now;
  }

  preview({ role } = {}) {
    assertAdmin(role);
    const state = this.repository.load();
    // Validate stable product IDs/FKs; SKU, name, price, and category may be
    // legitimately edited after migration and are intentionally not frozen.
    const groups = getProvisioningGroups(state, businessDate(this.now()));
    assertCatalogStockTargets(state, {
      inventoryBatches: groups.flatMap((group) => group.rows.inventoryBatches),
    });
    const alreadyProvisioned = groups.every((group) => group.inspected.alreadyProvisioned);
    const branchById = new Map(state.branches.map((branch) => [branch.branch_id, branch]));
    const warehouses = new Map(state.warehouses.map((warehouse) => [warehouse.warehouse_id, warehouse]));
    const branchSummaries = new Map();
    const additions = [];
    const groupCounts = {};
    for (const group of groups) {
      const absent = group.inspected.alreadyProvisioned ? [] : group.inspected.absent;
      groupCounts[group.key] = absent.length;
      for (const index of absent) additions.push({ group, index });
      group.rows.inventoryBatches.forEach((batch, index) => {
        if (!absent.includes(index)) return;
        const warehouse = warehouses.get(batch.warehouse_id);
        const branchId = warehouse?.branch_id ?? "unknown";
        const branch = branchById.get(branchId);
        const summary = branchSummaries.get(branchId) ?? { branchId, branchName: branch?.name ?? branchId, productCount: 0, units: 0 };
        const movement = group.rows.stockMovements[index];
        summary.productCount += 1;
        summary.units += movement?.quantity_delta ?? 0;
        branchSummaries.set(branchId, summary);
      });
    }
    const addedUnits = additions.reduce((sum, { group, index }) => sum + group.rows.stockMovements[index].quantity_delta, 0);
    return {
      confirmationToken: confirmationToken(state, groups),
      version: DEMO_STOCK_PROVISIONING_VERSION,
      catalogVersion: CATALOG_DEMO_STOCK_PROVISIONING_VERSION,
      alreadyProvisioned,
      baseAlreadyProvisioned: groups.find((group) => group.key === "base").inspected.alreadyProvisioned,
      catalogAlreadyProvisioned: groups.find((group) => group.key === "catalog").inspected.alreadyProvisioned,
      coverageAlreadyProvisioned: groups.find((group) => group.key === "coverage").inspected.alreadyProvisioned,
      batchCount: additions.length,
      movementCount: additions.length,
      totalUnits: addedUnits,
      baseBatchCount: groupCounts.base,
      catalogBatchCount: groupCounts.catalog,
      coverageBatchCount: groupCounts.coverage,
      branchSummaries: [...branchSummaries.values()],
      effects: [
        "Menambahkan saldo melalui batch dan opening movement ledger dalam satu commit.",
        "Tidak membuat transaksi, shift, pembayaran, atau distribusi.",
        "Tidak mengubah produk, aturan harga, batch, movement, akun, atau histori yang sudah ada.",
        "Stok kategori Rokok & Tembakau disiapkan sebagai saldo simulasi; aplikasi belum memverifikasi usia pembeli.",
      ],
    };
  }

  provision({ role, confirmed = false, expectedPreviewToken } = {}) {
    assertAdmin(role);
    if (!confirmed) {
      throw new DemoStockProvisioningError("DEMO_STOCK_PROVISIONING_CONFIRMATION_REQUIRED", "Konfirmasikan dampak provisioning stok demo sebelum menyimpan.");
    }
    const state = this.repository.load();
    const groups = getProvisioningGroups(state, businessDate(this.now()));
    if (expectedPreviewToken !== undefined && confirmationToken(state, groups) !== expectedPreviewToken) {
      throw new DemoStockProvisioningError("DEMO_STOCK_PREVIEW_STALE", "Stok, batch, atau katalog berubah setelah pratinjau. Buka pratinjau kembali sebelum konfirmasi.");
    }
    assertCatalogStockTargets(state, {
      inventoryBatches: groups.flatMap((group) => group.rows.inventoryBatches),
    });
    if (groups.every((group) => group.inspected.alreadyProvisioned)) return { alreadyProvisioned: true, addedBatchCount: 0, addedMovementCount: 0, addedUnits: 0 };

    const next = clone(state);
    let addedBatchCount = 0;
    let addedUnits = 0;
    for (const group of groups) {
      const absent = group.inspected.alreadyProvisioned ? [] : group.inspected.absent;
      next.inventoryBatches.push(...absent.map((index) => group.rows.inventoryBatches[index]));
      next.stockMovements.push(...absent.map((index) => group.rows.stockMovements[index]));
      addedBatchCount += absent.length;
      addedUnits += absent.reduce((sum, index) => sum + group.rows.stockMovements[index].quantity_delta, 0);
      next.meta[group.markerKey] = group.version;
      if (group.key === "coverage") next.meta[CATALOG_COVERAGE_STOCK_MANIFEST] = group.manifest;
    }
    this.repository.commit(next);
    return {
      alreadyProvisioned: false,
      addedBatchCount,
      addedMovementCount: addedBatchCount,
      addedUnits,
    };
  }
}

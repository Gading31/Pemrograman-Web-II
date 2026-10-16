import { EXPANSION_STOCK_LOCATIONS, EXPANSION_WAREHOUSES } from "./branch-expansion.js";
import { CATALOG_DEMO_STOCK_PROVISIONING_VERSION } from "./catalog-expansion.js";

const REFERENCE_DATE = "2026-10-12";
const SEEDED_AT = "2026-10-12T00:00:00+07:00";
const PROVISIONING_RECORDED_AT = "2026-10-12T08:00:00+07:00";

export const DEMO_STOCK_PROVISIONING_VERSION = "demo-stock-five-branches-v1";
export const CATALOG_COVERAGE_STOCK_VERSION = "catalog-stock-60x5-v1";
export const CATALOG_COVERAGE_STOCK_MARKER = "catalog_coverage_stock_version";
export const CATALOG_COVERAGE_STOCK_MANIFEST = "catalog_coverage_stock_manifest_v1";

const BRANCH_STOCK_TARGETS = Object.freeze([
  { branchId: "BR-JKT-01", warehouseId: "WH-JKT-01", locationId: "LOC-JKT-01", code: "JKT" },
  { branchId: "BR-BDG-01", warehouseId: "WH-BDG-01", locationId: "LOC-BDG-01", code: "BDG" },
  { branchId: "BR-MDN-01", warehouseId: "WH-MDN-01", locationId: "LOC-MDN-01", code: "MDN" },
  { branchId: "BR-SBY-01", warehouseId: "WH-SBY-01", locationId: "LOC-SBY-01", code: "SBY" },
  { branchId: "BR-MKS-01", warehouseId: "WH-MKS-01", locationId: "LOC-MKS-01", code: "MKS" },
]);

const DEMO_PRODUCT_STOCK = Object.freeze([
  { productId: "PRD-001", quantity: 12, rotationPolicy: "FEFO", expiryDate: "2027-02-15" },
  { productId: "PRD-002", quantity: 24, rotationPolicy: "FIFO", expiryDate: null },
  { productId: "PRD-003", quantity: 18, rotationPolicy: "FEFO", expiryDate: "2027-01-31" },
  { productId: "PRD-004", quantity: 12, rotationPolicy: "FEFO", expiryDate: "2027-03-31" },
  { productId: "PRD-005", quantity: 8, rotationPolicy: "FIFO", expiryDate: null },
  { productId: "PRD-006", quantity: 10, rotationPolicy: "FIFO", expiryDate: null },
]);

const CATALOG_BRANCH_PRODUCT_STOCK = Object.freeze([
  { productId: "PRD-007", quantity: 14, rotationPolicy: "FEFO", expiryDate: "2027-02-15" },
  { productId: "PRD-014", quantity: 12, rotationPolicy: "FEFO", expiryDate: "2027-01-31" },
  { productId: "PRD-022", quantity: 10, rotationPolicy: "FEFO", expiryDate: "2027-03-31" },
  { productId: "PRD-028", quantity: 9, rotationPolicy: "FIFO", expiryDate: null },
  { productId: "PRD-050", quantity: 8, rotationPolicy: "FEFO", expiryDate: "2027-08-31" },
  { productId: "PRD-058", quantity: 7, rotationPolicy: "FIFO", expiryDate: null },
]);

export function createBranchDemoStockRows() {
  const inventoryBatches = [];
  const stockMovements = [];
  for (const branch of BRANCH_STOCK_TARGETS) {
    for (const product of DEMO_PRODUCT_STOCK) {
      // Jakarta and Bandung keep their canonical PRD-001 opening batches unchanged.
      if (product.productId === "PRD-001" && ["BR-JKT-01", "BR-BDG-01"].includes(branch.branchId)) continue;
      const sku = product.productId.slice(4);
      const batchId = `BAT-DEMO-${branch.code}-${sku}`;
      const movementId = `MOV-DEMO-${branch.code}-${sku}`;
      inventoryBatches.push({
        inventory_batch_id: batchId,
        product_id: product.productId,
        warehouse_id: branch.warehouseId,
        stock_location_id: branch.locationId,
        lot_number: `DEMO-${branch.code}-${sku}`,
        received_at: "2026-10-10T09:00:00+07:00",
        expiry_date: product.expiryDate,
        rotation_policy: product.rotationPolicy,
        created_at: SEEDED_AT,
      });
      stockMovements.push({
        movement_id: movementId,
        inventory_batch_id: batchId,
        warehouse_id: branch.warehouseId,
        stock_location_id: branch.locationId,
        stock_bucket: "AVAILABLE",
        quantity_delta: product.quantity,
        movement_type: "OPENING_BALANCE",
        reference_type: "DEMO_STOCK_PROVISIONING",
        reference_id: DEMO_STOCK_PROVISIONING_VERSION,
        reason: "Saldo awal stok demonstrasi cabang; bukan transaksi atau pengiriman.",
        actor_id: "SYSTEM-DEMO",
        occurred_at: PROVISIONING_RECORDED_AT,
        effective_date: REFERENCE_DATE,
      });
    }
  }
  return { inventoryBatches, stockMovements };
}

export function createCatalogBranchDemoStockRows() {
  const inventoryBatches = [];
  const stockMovements = [];
  for (const branch of BRANCH_STOCK_TARGETS) {
    for (const product of CATALOG_BRANCH_PRODUCT_STOCK) {
      const sku = product.productId.slice(4);
      const batchId = `BAT-CAT-${branch.code}-${sku}`;
      inventoryBatches.push({
        inventory_batch_id: batchId,
        product_id: product.productId,
        warehouse_id: branch.warehouseId,
        stock_location_id: branch.locationId,
        lot_number: `CAT-${branch.code}-${sku}`,
        received_at: "2026-10-10T09:00:00+07:00",
        expiry_date: product.expiryDate,
        rotation_policy: product.rotationPolicy,
        created_at: SEEDED_AT,
      });
      stockMovements.push({
        movement_id: `MOV-CAT-${branch.code}-${sku}`,
        inventory_batch_id: batchId,
        warehouse_id: branch.warehouseId,
        stock_location_id: branch.locationId,
        stock_bucket: "AVAILABLE",
        quantity_delta: product.quantity,
        movement_type: "OPENING_BALANCE",
        reference_type: "DEMO_STOCK_PROVISIONING",
        reference_id: CATALOG_DEMO_STOCK_PROVISIONING_VERSION,
        reason: "Opening stok demonstrasi katalog lintas kategori; bukan transaksi atau pengiriman.",
        actor_id: "SYSTEM-DEMO",
        occurred_at: PROVISIONING_RECORDED_AT,
        effective_date: REFERENCE_DATE,
      });
    }
  }
  return { inventoryBatches, stockMovements };
}

const BASE_STOCKED_PRODUCT_IDS = new Set([
  ...DEMO_PRODUCT_STOCK.map((item) => item.productId),
  ...CATALOG_BRANCH_PRODUCT_STOCK.map((item) => item.productId),
]);

function canonicalBranchStockPairs() {
  const pairs = new Set();
  for (const branch of BRANCH_STOCK_TARGETS) {
    for (const productId of BASE_STOCKED_PRODUCT_IDS) pairs.add(`${branch.branchId}::${productId}`);
    // PRD-001 Jakarta/Bandung are canonical lots and stay untouched.
    if (branch.branchId === "BR-JKT-01" || branch.branchId === "BR-BDG-01") pairs.add(`${branch.branchId}::PRD-001`);
  }
  return pairs;
}

export function createCatalogCoverageStockRows(products = [], { effectiveDate = REFERENCE_DATE, recordedAt = PROVISIONING_RECORDED_AT } = {}) {
  const coveragePairsAlreadySeeded = canonicalBranchStockPairs();
  const inventoryBatches = [];
  const stockMovements = [];
  const expirableDates = ["2027-01-28", "2027-02-28", "2027-03-28", "2027-04-28", "2027-05-28", "2027-06-28", "2027-07-28", "2027-08-28", "2027-09-28", "2027-10-28", "2027-11-28", "2027-12-28"];

  for (const [branchIndex, branch] of BRANCH_STOCK_TARGETS.entries()) {
    for (const product of products) {
      const productNumber = Number(product.product_id?.match(/^PRD-(\d{3})$/)?.[1]);
      if (!Number.isInteger(productNumber) || coveragePairsAlreadySeeded.has(`${branch.branchId}::${product.product_id}`)) continue;
      const suffix = String(productNumber).padStart(3, "0");
      const batchId = `BAT-COVER-${branch.code}-${suffix}`;
      const movementId = `MOV-COVER-${branch.code}-${suffix}`;
      const requiresExpiry = product.expiry_policy === "required";
      const expiryDate = requiresExpiry
        ? expirableDates[(productNumber * 3 + branchIndex) % expirableDates.length]
        : null;
      const rotationPolicy = requiresExpiry ? "FEFO" : "FIFO";
      const quantity = 10 + ((productNumber * 13 + branchIndex * 7) % 31);
      inventoryBatches.push({
        inventory_batch_id: batchId,
        product_id: product.product_id,
        warehouse_id: branch.warehouseId,
        stock_location_id: branch.locationId,
        lot_number: `COVER-${branch.code}-${suffix}`,
        received_at: `${effectiveDate}T00:00:00+07:00`,
        expiry_date: expiryDate,
        rotation_policy: rotationPolicy,
        created_at: recordedAt,
      });
      stockMovements.push({
        movement_id: movementId,
        inventory_batch_id: batchId,
        warehouse_id: branch.warehouseId,
        stock_location_id: branch.locationId,
        stock_bucket: "AVAILABLE",
        quantity_delta: quantity,
        movement_type: "OPENING_BALANCE",
        reference_type: "DEMO_STOCK_PROVISIONING",
        reference_id: CATALOG_COVERAGE_STOCK_VERSION,
        reason: "Saldo awal stok presentasi untuk melengkapi katalog cabang; bukan shipment atau transaksi penjualan.",
        actor_id: "SYSTEM-DEMO",
        occurred_at: recordedAt,
        effective_date: effectiveDate,
      });
    }
  }
  return { inventoryBatches, stockMovements };
}

export const STOCK_BUCKETS = Object.freeze(["AVAILABLE", "QUARANTINE", "DAMAGED", "EXPIRED", "IN_TRANSIT"]);
export const PHYSICAL_STOCK_BUCKETS = Object.freeze(["AVAILABLE", "QUARANTINE", "DAMAGED", "EXPIRED"]);
export const ROTATION_POLICIES = Object.freeze(["FEFO", "FIFO"]);
export const INVENTORY_COLLECTION_KEYS = Object.freeze(["warehouses", "stockLocations", "inventoryBatches", "stockMovements"]);

export function createInventorySeed({ includeMultiBranchDemoStock = false, includeCatalogDemoStock = false } = {}) {
  const warehouses = [
    { warehouse_id: "WH-HQ-01", organization_id: "ORG-001", branch_id: null, warehouse_type: "CENTRAL", name: "Gudang Pusat", status: "active" },
    { warehouse_id: "WH-JKT-01", organization_id: "ORG-001", branch_id: "BR-JKT-01", warehouse_type: "BRANCH", name: "Gudang Jakarta", status: "active" },
    { warehouse_id: "WH-BDG-01", organization_id: "ORG-001", branch_id: "BR-BDG-01", warehouse_type: "BRANCH", name: "Gudang Bandung", status: "active" },
    ...EXPANSION_WAREHOUSES.map((warehouse) => ({ ...warehouse })),
  ];
  const stockLocations = [
    { stock_location_id: "LOC-HQ-01", warehouse_id: "WH-HQ-01", code: "HQ-MAIN", name: "Area penyimpanan utama", status: "active" },
    { stock_location_id: "LOC-JKT-01", warehouse_id: "WH-JKT-01", code: "JKT-SHELF", name: "Rak penjualan utama", status: "active" },
    { stock_location_id: "LOC-BDG-01", warehouse_id: "WH-BDG-01", code: "BDG-SHELF", name: "Rak penjualan utama", status: "active" },
    ...EXPANSION_STOCK_LOCATIONS.map((location) => ({ ...location })),
  ];
  const inventoryBatches = [
    { inventory_batch_id: "BAT-SNK-A", product_id: "PRD-001", warehouse_id: "WH-JKT-01", stock_location_id: "LOC-JKT-01", lot_number: "SNK-A", received_at: "2026-10-01T09:00:00+07:00", expiry_date: "2026-11-05", rotation_policy: "FEFO", created_at: SEEDED_AT },
    { inventory_batch_id: "BAT-SNK-B", product_id: "PRD-001", warehouse_id: "WH-JKT-01", stock_location_id: "LOC-JKT-01", lot_number: "SNK-B", received_at: "2026-10-05T09:00:00+07:00", expiry_date: "2026-12-15", rotation_policy: "FEFO", created_at: SEEDED_AT },
    { inventory_batch_id: "BAT-SNK-X", product_id: "PRD-001", warehouse_id: "WH-JKT-01", stock_location_id: "LOC-JKT-01", lot_number: "SNK-X", received_at: "2026-09-20T09:00:00+07:00", expiry_date: "2026-09-30", rotation_policy: "FEFO", created_at: SEEDED_AT },
    { inventory_batch_id: "BAT-SNK-HQ", product_id: "PRD-001", warehouse_id: "WH-HQ-01", stock_location_id: "LOC-HQ-01", lot_number: "SNK-HQ", received_at: "2026-10-01T09:00:00+07:00", expiry_date: "2027-03-15", rotation_policy: "FEFO", created_at: SEEDED_AT },
    { inventory_batch_id: "BAT-SNK-BDG", product_id: "PRD-001", warehouse_id: "WH-BDG-01", stock_location_id: "LOC-BDG-01", lot_number: "SNK-BDG", received_at: "2026-10-01T09:00:00+07:00", expiry_date: "2027-01-15", rotation_policy: "FEFO", created_at: SEEDED_AT },
  ];
  const openingRows = [
    ["BAT-SNK-A", "WH-JKT-01", "LOC-JKT-01", "AVAILABLE", 5],
    ["BAT-SNK-B", "WH-JKT-01", "LOC-JKT-01", "AVAILABLE", 10],
    ["BAT-SNK-X", "WH-JKT-01", "LOC-JKT-01", "EXPIRED", 2],
    ["BAT-SNK-HQ", "WH-HQ-01", "LOC-HQ-01", "AVAILABLE", 40],
    ["BAT-SNK-BDG", "WH-BDG-01", "LOC-BDG-01", "AVAILABLE", 8],
  ];
  const stockMovements = openingRows.map(([batchId, warehouseId, locationId, bucket, quantity], index) => ({
    movement_id: `MOV-OPEN-${index + 1}`,
    inventory_batch_id: batchId,
    warehouse_id: warehouseId,
    stock_location_id: locationId,
    stock_bucket: bucket,
    quantity_delta: quantity,
    movement_type: "OPENING_BALANCE",
    reference_type: "DEMO_SEED",
    reference_id: "SEED-M4-2026-10-12",
    reason: "Saldo awal demo sesuai data kanonis.",
    actor_id: "SYSTEM-DEMO",
    occurred_at: SEEDED_AT,
  }));

  if (includeMultiBranchDemoStock) {
    const additional = createBranchDemoStockRows();
    inventoryBatches.push(...additional.inventoryBatches);
    stockMovements.push(...additional.stockMovements);
  }

  if (includeCatalogDemoStock) {
    const additional = createCatalogBranchDemoStockRows();
    inventoryBatches.push(...additional.inventoryBatches);
    stockMovements.push(...additional.stockMovements);
  }

  return { warehouses, stockLocations, inventoryBatches, stockMovements };
}


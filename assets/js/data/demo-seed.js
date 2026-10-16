import { createInventorySeed, DEMO_STOCK_PROVISIONING_VERSION } from "./inventory-seed.js";
import { BRANCH_EXPANSION_MIGRATION_ID, EXPANSION_BRANCHES, EXPANSION_REGIONS, createExpansionPricingRules } from "./branch-expansion.js";
import {
  CATALOG_DEMO_STOCK_PROVISIONING_VERSION,
  CATALOG_EXPANSION_CATEGORIES,
  CATALOG_EXPANSION_MIGRATION_ID,
  CATALOG_EXPANSION_IDENTITY_META_KEY,
  createCanonicalProductExpansion,
  createCatalogExpansionIdentityManifest,
  createCatalogExpansionPricingRules,
} from "./catalog-expansion.js";

export const DEMO_SCHEMA_VERSION = "pos-demo-v1";
export const DEMO_REFERENCE_DATE = "2026-10-12";

const seededAt = "2026-10-12T00:00:00+07:00";

function withEan13CheckDigit(prefix) {
  const digits = String(prefix).split("").map(Number);
  if (digits.length !== 12 || digits.some((digit) => !Number.isInteger(digit))) {
    throw new TypeError("Barcode demo harus memiliki 12 digit sebelum digit pemeriksa.");
  }
  const weightedSum = digits.reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 1 : 3), 0);
  return `${prefix}${(10 - (weightedSum % 10)) % 10}`;
}

export function createDemoSeed() {
  const organizationId = "ORG-001";
  const categories = [
    { category_id: "CAT-SNACK", organization_id: organizationId, code: "SNACK", name: "Snack", status: "active" },
    { category_id: "CAT-MINUMAN", organization_id: organizationId, code: "MINUMAN", name: "Minuman", status: "active" },
    { category_id: "CAT-MAKANAN", organization_id: organizationId, code: "MAKANAN", name: "Makanan", status: "active" },
    { category_id: "CAT-SEMBAKO", organization_id: organizationId, code: "SEMBAKO", name: "Sembako", status: "active" },
    ...CATALOG_EXPANSION_CATEGORIES.map((category) => ({ ...category })),
  ];
  const units = [
    { unit_id: "UNIT-BUNGKUS", organization_id: organizationId, code: "BUNGKUS", name: "Bungkus" },
    { unit_id: "UNIT-BOTOL", organization_id: organizationId, code: "BOTOL", name: "Botol" },
    { unit_id: "UNIT-KOTAK", organization_id: organizationId, code: "KOTAK", name: "Kotak" },
    { unit_id: "UNIT-KARUNG", organization_id: organizationId, code: "KARUNG", name: "Karung" },
    { unit_id: "UNIT-PCS", organization_id: organizationId, code: "PCS", name: "Pcs" },
  ];
  const rates = {
    "REG-JKT": { "CAT-SNACK": 10, "CAT-MINUMAN": 5, "CAT-MAKANAN": 5, "CAT-SEMBAKO": 3 },
    "REG-BDG": { "CAT-SNACK": 5, "CAT-MINUMAN": 4, "CAT-MAKANAN": 4, "CAT-SEMBAKO": 2 },
  };
  const pricingRules = Object.entries(rates).flatMap(([regionId, categoryRates]) => Object.entries(categoryRates).map(([categoryId, adjustmentPercent]) => ({
    price_rule_id: `PRC-${regionId.slice(4)}-${categoryId.slice(4)}`,
    region_id: regionId,
    category_id: categoryId,
    adjustment_percent: adjustmentPercent,
    valid_from: DEMO_REFERENCE_DATE,
    valid_until: null,
    status: "active",
    version: 1,
  }))).concat(createExpansionPricingRules(DEMO_REFERENCE_DATE), createCatalogExpansionPricingRules(DEMO_REFERENCE_DATE));
  const products = [
    { product_id: "PRD-001", sku: "PRD-001", barcode: withEan13CheckDigit("200000000001"), name: "Keripik Kentang Original", category_id: "CAT-SNACK", unit_id: "UNIT-BUNGKUS", base_price_idr: 10000, expiry_policy: "required" },
    { product_id: "PRD-002", sku: "PRD-002", barcode: withEan13CheckDigit("200000000002"), name: "Air Mineral 600 ml", category_id: "CAT-MINUMAN", unit_id: "UNIT-BOTOL", base_price_idr: 5000, expiry_policy: "optional" },
    { product_id: "PRD-003", sku: "PRD-003", barcode: withEan13CheckDigit("200000000003"), name: "Mie Instan Goreng", category_id: "CAT-MAKANAN", unit_id: "UNIT-BUNGKUS", base_price_idr: 3000, expiry_policy: "required" },
    { product_id: "PRD-004", sku: "PRD-004", barcode: withEan13CheckDigit("200000000004"), name: "Susu UHT 250 ml", category_id: "CAT-MINUMAN", unit_id: "UNIT-KOTAK", base_price_idr: 8000, expiry_policy: "required" },
    { product_id: "PRD-005", sku: "PRD-005", barcode: withEan13CheckDigit("200000000005"), name: "Beras Premium 5 kg", category_id: "CAT-SEMBAKO", unit_id: "UNIT-KARUNG", base_price_idr: 75000, expiry_policy: "optional" },
    { product_id: "PRD-006", sku: "PRD-006", barcode: withEan13CheckDigit("200000000006"), name: "Minyak Goreng 1 L", category_id: "CAT-SEMBAKO", unit_id: "UNIT-PCS", base_price_idr: 18000, expiry_policy: "optional" },
  ].map((product) => ({
    ...product,
    organization_id: organizationId,
    status: "active",
    created_at: seededAt,
    updated_at: seededAt,
  })).concat(createCanonicalProductExpansion(organizationId, seededAt));

  return {
    schema_version: DEMO_SCHEMA_VERSION,
    meta: {
      reference_date: DEMO_REFERENCE_DATE,
      timezone: "Asia/Jakarta",
      seeded_at: seededAt,
      applied_migrations: [BRANCH_EXPANSION_MIGRATION_ID, CATALOG_EXPANSION_MIGRATION_ID],
      [CATALOG_EXPANSION_IDENTITY_META_KEY]: createCatalogExpansionIdentityManifest(organizationId),
      demo_stock_provisioning_version: DEMO_STOCK_PROVISIONING_VERSION,
      catalog_demo_stock_provisioning_version: CATALOG_DEMO_STOCK_PROVISIONING_VERSION,
    },
    organization: {
      organization_id: organizationId,
      name: "Minimarket Nusantara",
      status: "active",
    },
    regions: [
      { region_id: "REG-JKT", organization_id: organizationId, code: "JKT", name: "Wilayah Jakarta", status: "active" },
      { region_id: "REG-BDG", organization_id: organizationId, code: "BDG", name: "Wilayah Bandung", status: "active" },
      ...EXPANSION_REGIONS.map((region) => ({ ...region })),
    ],
    branches: [
      { branch_id: "BR-JKT-01", region_id: "REG-JKT", code: "JKT-01", name: "Cabang Jakarta Pusat", status: "active" },
      { branch_id: "BR-BDG-01", region_id: "REG-BDG", code: "BDG-01", name: "Cabang Bandung Kota", status: "active" },
      ...EXPANSION_BRANCHES.map((branch) => ({ ...branch })),
    ],
    categories,
    units,
    pricingRules,
    products,
    ...createInventorySeed({ includeMultiBranchDemoStock: true, includeCatalogDemoStock: true }),
    stockRequests: [],
    stockTransfers: [],
    distributionReceipts: [],
    distributionEvents: [],
  };
}

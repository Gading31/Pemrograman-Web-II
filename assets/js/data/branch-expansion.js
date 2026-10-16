export const BRANCH_EXPANSION_MIGRATION_ID = "branch-expansion-5-v1";

export const EXPANSION_REGIONS = Object.freeze([
  { region_id: "REG-MDN", organization_id: "ORG-001", code: "MDN", name: "Sumatera Utara", status: "active" },
  { region_id: "REG-SBY", organization_id: "ORG-001", code: "SBY", name: "Jawa Timur", status: "active" },
  { region_id: "REG-MKS", organization_id: "ORG-001", code: "MKS", name: "Sulawesi Selatan", status: "active" },
]);

export const EXPANSION_BRANCHES = Object.freeze([
  { branch_id: "BR-MDN-01", region_id: "REG-MDN", code: "MDN-01", name: "Cabang Medan", status: "active" },
  { branch_id: "BR-SBY-01", region_id: "REG-SBY", code: "SBY-01", name: "Cabang Surabaya", status: "active" },
  { branch_id: "BR-MKS-01", region_id: "REG-MKS", code: "MKS-01", name: "Cabang Makassar", status: "active" },
]);

export const EXPANSION_RATES = Object.freeze({
  "REG-MDN": Object.freeze({ "CAT-SNACK": 7, "CAT-MINUMAN": 4, "CAT-MAKANAN": 3, "CAT-SEMBAKO": 2 }),
  "REG-SBY": Object.freeze({ "CAT-SNACK": 8, "CAT-MINUMAN": 5, "CAT-MAKANAN": 4, "CAT-SEMBAKO": 3 }),
  "REG-MKS": Object.freeze({ "CAT-SNACK": 9, "CAT-MINUMAN": 6, "CAT-MAKANAN": 5, "CAT-SEMBAKO": 4 }),
});

export const EXPANSION_WAREHOUSES = Object.freeze([
  { warehouse_id: "WH-MDN-01", organization_id: "ORG-001", branch_id: "BR-MDN-01", warehouse_type: "BRANCH", name: "Gudang Medan", status: "active" },
  { warehouse_id: "WH-SBY-01", organization_id: "ORG-001", branch_id: "BR-SBY-01", warehouse_type: "BRANCH", name: "Gudang Surabaya", status: "active" },
  { warehouse_id: "WH-MKS-01", organization_id: "ORG-001", branch_id: "BR-MKS-01", warehouse_type: "BRANCH", name: "Gudang Makassar", status: "active" },
]);

export const EXPANSION_STOCK_LOCATIONS = Object.freeze([
  { stock_location_id: "LOC-MDN-01", warehouse_id: "WH-MDN-01", code: "MDN-SHELF", name: "Rak penjualan utama", status: "active" },
  { stock_location_id: "LOC-SBY-01", warehouse_id: "WH-SBY-01", code: "SBY-SHELF", name: "Rak penjualan utama", status: "active" },
  { stock_location_id: "LOC-MKS-01", warehouse_id: "WH-MKS-01", code: "MKS-SHELF", name: "Rak penjualan utama", status: "active" },
]);

export function createExpansionPricingRules(referenceDate) {
  return Object.entries(EXPANSION_RATES).flatMap(([regionId, rates]) => Object.entries(rates).map(([categoryId, adjustmentPercent]) => ({
    price_rule_id: `PRC-${regionId.slice(4)}-${categoryId.slice(4)}`,
    region_id: regionId,
    category_id: categoryId,
    adjustment_percent: adjustmentPercent,
    valid_from: referenceDate,
    valid_until: null,
    status: "active",
    version: 1,
    configuration_source: "SIMULATION_NOT_MARKET_DATA",
  })));
}

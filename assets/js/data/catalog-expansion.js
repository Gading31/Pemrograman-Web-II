export const CATALOG_EXPANSION_MIGRATION_ID = "catalog-expansion-60-v1";
export const CATALOG_DEMO_STOCK_PROVISIONING_VERSION = "catalog-stock-five-branches-v1";
export const CATALOG_EXPANSION_IDENTITY_META_KEY = "catalog_expansion_identity_v1";

export const CATALOG_EXPANSION_CATEGORIES = Object.freeze([
  { category_id: "CAT-ROKOK-TEMBAKAU", organization_id: "ORG-001", code: "ROKOK-TEMBAKAU", name: "Rokok & Tembakau", status: "active", age_restricted: true },
  { category_id: "CAT-PERAWATAN-DIRI", organization_id: "ORG-001", code: "PERAWATAN-DIRI", name: "Perawatan Diri", status: "active" },
  { category_id: "CAT-KEBERSIHAN-RUMAH", organization_id: "ORG-001", code: "KEBERSIHAN-RUMAH", name: "Kebersihan Rumah", status: "active" },
  { category_id: "CAT-BUMBU-BAHAN-MASAK", organization_id: "ORG-001", code: "BUMBU-BAHAN-MASAK", name: "Bumbu & Bahan Masak", status: "active" },
  { category_id: "CAT-PERLENGKAPAN-BAYI", organization_id: "ORG-001", code: "PERLENGKAPAN-BAYI", name: "Perlengkapan Bayi", status: "active" },
  { category_id: "CAT-KEBUTUHAN-RUMAH-TANGGA", organization_id: "ORG-001", code: "KEBUTUHAN-RUMAH-TANGGA", name: "Kebutuhan Rumah Tangga", status: "active" },
]);

export const CATALOG_EXPANSION_RATES = Object.freeze({
  "REG-JKT": Object.freeze({ "CAT-ROKOK-TEMBAKAU": 6, "CAT-PERAWATAN-DIRI": 5, "CAT-KEBERSIHAN-RUMAH": 5, "CAT-BUMBU-BAHAN-MASAK": 4, "CAT-PERLENGKAPAN-BAYI": 6, "CAT-KEBUTUHAN-RUMAH-TANGGA": 4 }),
  "REG-BDG": Object.freeze({ "CAT-ROKOK-TEMBAKAU": 5, "CAT-PERAWATAN-DIRI": 4, "CAT-KEBERSIHAN-RUMAH": 4, "CAT-BUMBU-BAHAN-MASAK": 3, "CAT-PERLENGKAPAN-BAYI": 5, "CAT-KEBUTUHAN-RUMAH-TANGGA": 3 }),
  "REG-MDN": Object.freeze({ "CAT-ROKOK-TEMBAKAU": 4, "CAT-PERAWATAN-DIRI": 4, "CAT-KEBERSIHAN-RUMAH": 4, "CAT-BUMBU-BAHAN-MASAK": 3, "CAT-PERLENGKAPAN-BAYI": 5, "CAT-KEBUTUHAN-RUMAH-TANGGA": 3 }),
  "REG-SBY": Object.freeze({ "CAT-ROKOK-TEMBAKAU": 5, "CAT-PERAWATAN-DIRI": 5, "CAT-KEBERSIHAN-RUMAH": 4, "CAT-BUMBU-BAHAN-MASAK": 3, "CAT-PERLENGKAPAN-BAYI": 5, "CAT-KEBUTUHAN-RUMAH-TANGGA": 4 }),
  "REG-MKS": Object.freeze({ "CAT-ROKOK-TEMBAKAU": 6, "CAT-PERAWATAN-DIRI": 5, "CAT-KEBERSIHAN-RUMAH": 5, "CAT-BUMBU-BAHAN-MASAK": 4, "CAT-PERLENGKAPAN-BAYI": 6, "CAT-KEBUTUHAN-RUMAH-TANGGA": 4 }),
});

export function createCatalogExpansionPricingRules(referenceDate) {
  return Object.entries(CATALOG_EXPANSION_RATES).flatMap(([regionId, rates]) => Object.entries(rates).map(([categoryId, adjustmentPercent]) => ({
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

const NEW_PRODUCT_ROWS = Object.freeze([
  ["Keripik Singkong Gurih 70 g", "CAT-SNACK", "UNIT-BUNGKUS", 6500, "required"],
  ["Kacang Panggang 100 g", "CAT-SNACK", "UNIT-BUNGKUS", 9500, "required"],
  ["Biskuit Gandum 120 g", "CAT-SNACK", "UNIT-BUNGKUS", 8500, "required"],
  ["Wafer Cokelat 20 g", "CAT-SNACK", "UNIT-BUNGKUS", 2000, "required"],
  ["Popcorn Asin 80 g", "CAT-SNACK", "UNIT-BUNGKUS", 7000, "required"],
  ["Kerupuk Ikan 150 g", "CAT-SNACK", "UNIT-BUNGKUS", 11000, "required"],
  ["Permen Buah 100 g", "CAT-SNACK", "UNIT-BUNGKUS", 6000, "required"],
  ["Teh Melati 350 ml", "CAT-MINUMAN", "UNIT-BOTOL", 4500, "required"],
  ["Susu Kedelai 250 ml", "CAT-MINUMAN", "UNIT-KOTAK", 6500, "required"],
  ["Jus Jambu 250 ml", "CAT-MINUMAN", "UNIT-KOTAK", 7000, "required"],
  ["Minuman Isotonik 500 ml", "CAT-MINUMAN", "UNIT-BOTOL", 7500, "optional"],
  ["Kopi Susu 220 ml", "CAT-MINUMAN", "UNIT-KOTAK", 9000, "required"],
  ["Sirup Jeruk 500 ml", "CAT-MINUMAN", "UNIT-BOTOL", 17000, "optional"],
  ["Teh Hijau 450 ml", "CAT-MINUMAN", "UNIT-BOTOL", 6000, "required"],
  ["Air Kelapa 330 ml", "CAT-MINUMAN", "UNIT-KOTAK", 8500, "required"],
  ["Roti Tawar 350 g", "CAT-MAKANAN", "UNIT-BUNGKUS", 14000, "required"],
  ["Sarden Saus Tomat 155 g", "CAT-MAKANAN", "UNIT-KOTAK", 12500, "required"],
  ["Bubur Instan Sayur 25 g", "CAT-MAKANAN", "UNIT-BUNGKUS", 3500, "required"],
  ["Pasta Kering 250 g", "CAT-MAKANAN", "UNIT-BUNGKUS", 12000, "required"],
  ["Sup Krim Instan 50 g", "CAT-MAKANAN", "UNIT-BUNGKUS", 5500, "required"],
  ["Sereal Sarapan 200 g", "CAT-MAKANAN", "UNIT-KOTAK", 18500, "required"],
  ["Gula Pasir 1 kg", "CAT-SEMBAKO", "UNIT-PCS", 17000, "optional"],
  ["Telur Ayam 10 butir", "CAT-SEMBAKO", "UNIT-KOTAK", 26000, "required"],
  ["Tepung Terigu 1 kg", "CAT-SEMBAKO", "UNIT-PCS", 14500, "optional"],
  ["Garam Halus 500 g", "CAT-SEMBAKO", "UNIT-PCS", 5000, "optional"],
  ["Margarin 200 g", "CAT-SEMBAKO", "UNIT-KOTAK", 9500, "required"],
  ["Kacang Hijau 500 g", "CAT-SEMBAKO", "UNIT-PCS", 16000, "optional"],
  ["Produk Tembakau Filter Kemasan", "CAT-ROKOK-TEMBAKAU", "UNIT-BUNGKUS", 30000, "not_required", true],
  ["Produk Tembakau Filter Slim Kemasan", "CAT-ROKOK-TEMBAKAU", "UNIT-BUNGKUS", 31000, "not_required", true],
  ["Produk Tembakau Non-Filter Kemasan", "CAT-ROKOK-TEMBAKAU", "UNIT-BUNGKUS", 26000, "not_required", true],
  ["Tembakau Iris Kemasan", "CAT-ROKOK-TEMBAKAU", "UNIT-BUNGKUS", 24000, "not_required", true],
  ["Cerutu Kecil Kemasan", "CAT-ROKOK-TEMBAKAU", "UNIT-BUNGKUS", 18000, "not_required", true],
  ["Sabun Mandi 80 g", "CAT-PERAWATAN-DIRI", "UNIT-PCS", 4500, "optional"],
  ["Sampo Sachet 12 ml", "CAT-PERAWATAN-DIRI", "UNIT-BUNGKUS", 1000, "optional"],
  ["Pasta Gigi 120 g", "CAT-PERAWATAN-DIRI", "UNIT-PCS", 12500, "optional"],
  ["Sikat Gigi Dewasa", "CAT-PERAWATAN-DIRI", "UNIT-PCS", 8000, "not_required"],
  ["Deodoran Roll-On 50 ml", "CAT-PERAWATAN-DIRI", "UNIT-BOTOL", 18000, "optional"],
  ["Pembalut Harian 10 lembar", "CAT-PERAWATAN-DIRI", "UNIT-BUNGKUS", 9500, "optional"],
  ["Deterjen Bubuk 800 g", "CAT-KEBERSIHAN-RUMAH", "UNIT-PCS", 18500, "optional"],
  ["Sabun Cuci Piring 450 ml", "CAT-KEBERSIHAN-RUMAH", "UNIT-BOTOL", 12000, "optional"],
  ["Pembersih Lantai 800 ml", "CAT-KEBERSIHAN-RUMAH", "UNIT-BOTOL", 16500, "optional"],
  ["Spons Cuci Piring", "CAT-KEBERSIHAN-RUMAH", "UNIT-PCS", 3500, "not_required"],
  ["Kantong Sampah 10 lembar", "CAT-KEBERSIHAN-RUMAH", "UNIT-BUNGKUS", 7000, "not_required"],
  ["Kecap Manis 135 ml", "CAT-BUMBU-BAHAN-MASAK", "UNIT-BOTOL", 6500, "required"],
  ["Saus Sambal 135 ml", "CAT-BUMBU-BAHAN-MASAK", "UNIT-BOTOL", 7000, "required"],
  ["Kaldu Bubuk 100 g", "CAT-BUMBU-BAHAN-MASAK", "UNIT-BUNGKUS", 6500, "required"],
  ["Bubuk Kunyit 50 g", "CAT-BUMBU-BAHAN-MASAK", "UNIT-BUNGKUS", 4500, "required"],
  ["Lada Bubuk 50 g", "CAT-BUMBU-BAHAN-MASAK", "UNIT-BUNGKUS", 7000, "required"],
  ["Popok Bayi Ukuran M 10 lembar", "CAT-PERLENGKAPAN-BAYI", "UNIT-BUNGKUS", 22000, "optional"],
  ["Tisu Basah Bayi 50 lembar", "CAT-PERLENGKAPAN-BAYI", "UNIT-BUNGKUS", 14500, "optional"],
  ["Bedak Bayi 100 g", "CAT-PERLENGKAPAN-BAYI", "UNIT-PCS", 17500, "optional"],
  ["Baterai AA 2 buah", "CAT-KEBUTUHAN-RUMAH-TANGGA", "UNIT-BUNGKUS", 12000, "not_required"],
  ["Lampu LED 5 watt", "CAT-KEBUTUHAN-RUMAH-TANGGA", "UNIT-PCS", 18000, "not_required"],
  ["Tisu Wajah 200 lembar", "CAT-KEBUTUHAN-RUMAH-TANGGA", "UNIT-KOTAK", 11000, "not_required"],
]);

function ean13(prefix) {
  const digits = String(prefix).split("").map(Number);
  const sum = digits.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return `${prefix}${(10 - (sum % 10)) % 10}`;
}

export function createCanonicalProductExpansion(organizationId = "ORG-001", seededAt = "2026-10-12T00:00:00+07:00") {
  return NEW_PRODUCT_ROWS.map(([name, category_id, unit_id, base_price_idr, expiry_policy, ageRestricted], index) => {
    const number = index + 7;
    return {
      product_id: `PRD-${String(number).padStart(3, "0")}`,
      sku: `PRD-${String(number).padStart(3, "0")}`,
      barcode: ean13(`200000000${String(number).padStart(3, "0")}`),
      name,
      category_id,
      unit_id,
      base_price_idr,
      expiry_policy,
      ...(ageRestricted ? { age_restricted: true } : {}),
      organization_id: organizationId,
      status: "active",
      created_at: seededAt,
      updated_at: seededAt,
    };
  });
}

// Immutable provenance for the seed identities. Live product fields remain
// editable after migration; provisioning can still verify that stable IDs
// originated from the canonical seed instead of a colliding user record.
export function createCatalogExpansionIdentityManifest(organizationId = "ORG-001") {
  return {
    version: 1,
    categories: CATALOG_EXPANSION_CATEGORIES.map(({ category_id, code, organization_id }) => ({
      category_id,
      code,
      organization_id,
    })),
    products: createCanonicalProductExpansion(organizationId).map(({ product_id, sku, barcode, organization_id }) => ({
      product_id,
      sku,
      barcode,
      organization_id,
    })),
  };
}

export const CANONICAL_CATEGORY_COUNTS = Object.freeze({
  "CAT-SNACK": 8,
  "CAT-MINUMAN": 10,
  "CAT-MAKANAN": 7,
  "CAT-SEMBAKO": 8,
  "CAT-ROKOK-TEMBAKAU": 5,
  "CAT-PERAWATAN-DIRI": 6,
  "CAT-KEBERSIHAN-RUMAH": 5,
  "CAT-BUMBU-BAHAN-MASAK": 5,
  "CAT-PERLENGKAPAN-BAYI": 3,
  "CAT-KEBUTUHAN-RUMAH-TANGGA": 3,
});

import { DEMO_REFERENCE_DATE } from "../data/demo-seed.js";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class PricingError extends Error {
  constructor(code, message, fieldErrors = {}, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "PricingError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isValidDateOnly(value) {
  if (typeof value !== "string" || !DATE_ONLY_PATTERN.test(value) || value.startsWith("0000")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function periodsOverlap(left, right) {
  const leftEndsAfterRightStarts = left.valid_until === null || right.valid_from <= left.valid_until;
  const rightEndsAfterLeftStarts = right.valid_until === null || left.valid_from <= right.valid_until;
  return leftEndsAfterRightStarts && rightEndsAfterLeftStarts;
}

function coversDate(rule, date) {
  return rule.valid_from <= date && (rule.valid_until === null || date <= rule.valid_until);
}

function roundIDR(basePriceIdr, adjustmentPercent) {
  const unrounded = basePriceIdr * (1 + adjustmentPercent / 100);
  const rounded = Math.round(unrounded);
  if (!Number.isFinite(unrounded) || unrounded < 0 || !Number.isSafeInteger(rounded) || rounded < 0) {
    throw new PricingError("PRICE_RULE_UNSAFE", "Perhitungan menghasilkan harga negatif atau nominal rupiah yang tidak aman.");
  }
  return rounded;
}

function validationError(fieldErrors) {
  return new PricingError("PRICING_VALIDATION_FAILED", "Periksa kembali aturan harga regional.", fieldErrors);
}

export class PricingService {
  constructor({ repository, clock = () => new Date().toISOString(), idFactory = () => globalThis.crypto?.randomUUID?.() ?? `PRC-${Date.now()}-${Math.random().toString(16).slice(2)}` }) {
    if (!repository) throw new TypeError("PricingService memerlukan repository.");
    this.repository = repository;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  listRules({ search = "", regionId = "all", categoryId = "all", status = "all" } = {}) {
    const state = this.repository.load();
    const regionNames = new Map(state.regions.map((region) => [region.region_id, region.name]));
    const categoryNames = new Map(state.categories.map((category) => [category.category_id, category.name]));
    const query = String(search).trim().toLocaleLowerCase("id-ID");
    const items = state.pricingRules
      .filter((rule) => regionId === "all" || rule.region_id === regionId)
      .filter((rule) => categoryId === "all" || rule.category_id === categoryId)
      .filter((rule) => status === "all" || rule.status === status)
      .filter((rule) => !query || [
        rule.price_rule_id,
        regionNames.get(rule.region_id),
        rule.region_id,
        categoryNames.get(rule.category_id),
        rule.category_id,
        String(rule.adjustment_percent),
        rule.valid_from,
        rule.valid_until ?? "tanpa batas",
        rule.status,
      ].some((value) => String(value ?? "").toLocaleLowerCase("id-ID").includes(query)))
      .sort((left, right) => (
        String(regionNames.get(left.region_id) ?? "").localeCompare(String(regionNames.get(right.region_id) ?? ""), "id")
        || String(categoryNames.get(left.category_id) ?? "").localeCompare(String(categoryNames.get(right.category_id) ?? ""), "id")
        || left.valid_from.localeCompare(right.valid_from)
      ));

    const coveredPairs = new Set(state.pricingRules
      .filter((rule) => rule.status === "active" && coversDate(rule, DEMO_REFERENCE_DATE))
      .map((rule) => `${rule.region_id}::${rule.category_id}`));
    const expectedPairs = state.regions.length * state.categories.length;

    return {
      items: items.map((rule) => ({ ...rule })),
      total: items.length,
      coverage: { covered: coveredPairs.size, total: expectedPairs, referenceDate: DEMO_REFERENCE_DATE },
      regions: state.regions.map((region) => ({ ...region })),
      categories: state.categories.map((category) => ({ ...category })),
      branches: state.branches.map((branch) => ({ ...branch })),
      products: state.products.map((product) => ({ ...product })),
    };
  }

  createRule(input) {
    const state = this.repository.load();
    const normalized = this.#validateRule(input, state);
    const ruleId = this.idFactory();
    if (state.pricingRules.some((rule) => rule.price_rule_id === ruleId)) {
      throw new PricingError("PRICE_RULE_ID_CONFLICT", "ID aturan harga sudah digunakan. Coba simpan kembali.");
    }
    const record = { price_rule_id: ruleId, ...normalized, version: 1 };
    const next = clone(state);
    next.pricingRules.push(record);
    this.#commit(next);
    return { ...record };
  }

  updateRule(ruleId, input) {
    const state = this.repository.load();
    const index = state.pricingRules.findIndex((rule) => rule.price_rule_id === ruleId);
    if (index < 0) throw new PricingError("PRICE_RULE_NOT_FOUND", "Aturan harga tidak ditemukan.");
    const current = state.pricingRules[index];
    const normalized = this.#validateRule(input, state, ruleId);
    const sameValues = current.region_id === normalized.region_id
      && current.category_id === normalized.category_id
      && current.adjustment_percent === normalized.adjustment_percent
      && current.valid_from === normalized.valid_from
      && current.valid_until === normalized.valid_until
      && current.status === normalized.status;
    if (sameValues) return { ...current };

    const next = clone(state);
    next.pricingRules[index] = { ...current, ...normalized, version: current.version + 1 };
    this.#commit(next);
    return { ...next.pricingRules[index] };
  }

  resolvePrice({ productId, branchId, effectiveDate, state: snapshot = null }) {
    const state = snapshot ?? this.repository.load();
    if (!isValidDateOnly(effectiveDate)) {
      throw new PricingError("INVALID_EFFECTIVE_DATE", "Tanggal simulasi harus valid dengan format YYYY-MM-DD.", {
        effectiveDate: "Masukkan tanggal kalender yang valid.",
      });
    }
    const product = state.products.find((item) => item.product_id === productId && item.status === "active");
    if (!product) throw new PricingError("PRODUCT_NOT_FOUND", "Produk aktif tidak ditemukan.");
    const branch = state.branches.find((item) => item.branch_id === branchId && item.status === "active");
    if (!branch) throw new PricingError("BRANCH_NOT_FOUND", "Cabang aktif tidak ditemukan.");
    const region = state.regions.find((item) => item.region_id === branch.region_id);
    if (!region) throw new PricingError("REGION_NOT_FOUND", "Wilayah cabang tidak ditemukan.");

    const rule = state.pricingRules.find((item) => (
      item.region_id === region.region_id
      && item.category_id === product.category_id
      && item.status === "active"
      && coversDate(item, effectiveDate)
    ));
    if (!rule) {
      throw new PricingError("PRICE_RULE_MISSING", `Aturan harga aktif untuk ${region.name} · ${product.category_id} tidak tersedia pada ${effectiveDate}.`);
    }

    return {
      product: { product_id: product.product_id, sku: product.sku, name: product.name, category_id: product.category_id },
      branch: { branch_id: branch.branch_id, name: branch.name, region_id: branch.region_id },
      region: { region_id: region.region_id, name: region.name },
      effectiveDate,
      basePriceIdr: product.base_price_idr,
      adjustmentPercent: rule.adjustment_percent,
      regularPriceIdr: roundIDR(product.base_price_idr, rule.adjustment_percent),
      rule: { ...rule },
    };
  }

  #validateRule(input = {}, state, excludeRuleId = null) {
    const fieldErrors = {};
    const regionId = String(input.region_id ?? "").trim();
    const categoryId = String(input.category_id ?? "").trim();
    const rawAdjustment = String(input.adjustment_percent ?? "").trim();
    const adjustmentPercent = rawAdjustment === "" ? Number.NaN : Number(rawAdjustment);
    const validFrom = String(input.valid_from ?? "").trim();
    const rawValidUntil = String(input.valid_until ?? "").trim();
    const validUntil = rawValidUntil || null;
    const status = String(input.status ?? "").trim();

    if (!state.regions.some((region) => region.region_id === regionId)) fieldErrors.region_id = "Pilih wilayah yang tersedia.";
    if (!state.categories.some((category) => category.category_id === categoryId)) fieldErrors.category_id = "Pilih kategori yang tersedia.";
    if (!Number.isFinite(adjustmentPercent)) fieldErrors.adjustment_percent = "Penyesuaian harus berupa angka persen yang valid.";
    if (!isValidDateOnly(validFrom)) fieldErrors.valid_from = "Tanggal mulai wajib memakai tanggal valid berformat YYYY-MM-DD.";
    if (validUntil !== null && !isValidDateOnly(validUntil)) fieldErrors.valid_until = "Tanggal akhir harus kosong atau tanggal valid berformat YYYY-MM-DD.";
    if (validUntil && isValidDateOnly(validFrom) && isValidDateOnly(validUntil) && validUntil < validFrom) {
      fieldErrors.valid_until = "Tanggal akhir tidak boleh mendahului tanggal mulai.";
    }
    if (!["active", "inactive"].includes(status)) fieldErrors.status = "Pilih status aturan yang tersedia.";
    if (Object.keys(fieldErrors).length) throw validationError(fieldErrors);

    const candidate = {
      region_id: regionId,
      category_id: categoryId,
      adjustment_percent: adjustmentPercent,
      valid_from: validFrom,
      valid_until: validUntil,
      status,
    };
    const overlap = state.pricingRules.some((rule) => (
      rule.price_rule_id !== excludeRuleId
      && rule.region_id === regionId
      && rule.category_id === categoryId
      && periodsOverlap(rule, candidate)
    ));
    if (overlap) {
      throw new PricingError("PRICE_RULE_OVERLAP", "Periode aturan untuk wilayah dan kategori ini bertumpang tindih dengan aturan tersimpan.", {
        valid_from: "Pilih periode yang tidak beririsan dengan aturan lain pada kombinasi ini.",
        valid_until: "Periksa kembali tanggal akhir periode.",
      });
    }

    for (const product of state.products.filter((item) => item.category_id === categoryId)) {
      roundIDR(product.base_price_idr, adjustmentPercent);
    }
    return candidate;
  }

  #commit(next) {
    try {
      this.repository.commit(next);
    } catch (error) {
      if (["PRICE_RULE_MISSING", "PRICE_RULE_OVERLAP", "PRICE_RULE_UNSAFE", "PRICE_RULE_INVALID_DATE"].includes(error.code)) {
        throw new PricingError(error.code, error.message, {}, error);
      }
      throw error;
    }
  }
}

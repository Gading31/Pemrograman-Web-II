import { RepositoryError } from "../repositories/local-storage-repository.js";

const EXPIRY_POLICIES = new Set(["required", "optional", "not_required"]);

export class ProductValidationError extends Error {
  constructor(fieldErrors) {
    super("Periksa kembali data produk.");
    this.name = "ProductValidationError";
    this.code = "PRODUCT_VALIDATION_FAILED";
    this.fieldErrors = fieldErrors;
  }
}

export class ProductService {
  constructor({ repository, clock = () => new Date().toISOString(), idFactory = () => globalThis.crypto?.randomUUID?.() ?? `PRD-${Date.now()}-${Math.random().toString(16).slice(2)}` }) {
    if (!repository) throw new TypeError("ProductService memerlukan repository.");
    this.repository = repository;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  list(options = {}) {
    const state = this.repository.load();
    const search = String(options.search ?? "").trim().toLocaleLowerCase("id-ID");
    const status = options.status ?? "all";
    const categoryId = options.categoryId ?? "all";
    const sortBy = options.sortBy ?? "name";
    const direction = options.direction === "desc" ? -1 : 1;
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(options.pageSize, 10) || 5));
    let products = state.products.filter((product) => {
      const matchesSearch = !search || [product.name, product.sku, product.barcode]
        .some((value) => String(value ?? "").toLocaleLowerCase("id-ID").includes(search));
      const matchesStatus = status === "all" || product.status === status;
      const matchesCategory = categoryId === "all" || product.category_id === categoryId;
      return matchesSearch && matchesStatus && matchesCategory;
    });

    const categoryNames = new Map(state.categories.map((category) => [category.category_id, category.name]));
    const collator = new Intl.Collator("id", { sensitivity: "base", numeric: true });
    products.sort((left, right) => {
      let result;
      if (sortBy === "sku") result = collator.compare(left.sku, right.sku);
      else if (sortBy === "category") result = collator.compare(categoryNames.get(left.category_id) ?? "", categoryNames.get(right.category_id) ?? "");
      else if (sortBy === "price") result = left.base_price_idr - right.base_price_idr;
      else if (sortBy === "status") result = collator.compare(left.status, right.status);
      else result = collator.compare(left.name, right.name);
      return result * direction || collator.compare(left.sku, right.sku);
    });

    const total = products.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, Math.max(1, Number.parseInt(options.page, 10) || 1));
    const start = (page - 1) * pageSize;
    return {
      items: products.slice(start, start + pageSize),
      total,
      page,
      pageCount,
      pageSize,
      categories: state.categories.map((category) => ({ ...category })),
      units: state.units.map((unit) => ({ ...unit })),
    };
  }

  create(input) {
    const state = this.repository.load();
    const product = this.#validate(input, state);
    const timestamp = this.clock();
    const next = cloneState(state);
    const record = {
      product_id: this.idFactory(),
      organization_id: state.organization.organization_id,
      ...product,
      status: "active",
      created_at: timestamp,
      updated_at: timestamp,
    };
    next.products.push(record);
    this.repository.commit(next);
    return { ...record };
  }

  update(productId, input) {
    const state = this.repository.load();
    const index = state.products.findIndex((product) => product.product_id === productId);
    if (index < 0) throw new RepositoryError("PRODUCT_NOT_FOUND", "Produk tidak ditemukan.");
    const product = this.#validate(input, state, productId);
    const next = cloneState(state);
    next.products[index] = { ...next.products[index], ...product, updated_at: this.clock() };
    this.repository.commit(next);
    return { ...next.products[index] };
  }

  setActive(productId, active) {
    const state = this.repository.load();
    const index = state.products.findIndex((product) => product.product_id === productId);
    if (index < 0) throw new RepositoryError("PRODUCT_NOT_FOUND", "Produk tidak ditemukan.");
    const next = cloneState(state);
    next.products[index] = {
      ...next.products[index],
      status: active ? "active" : "inactive",
      updated_at: this.clock(),
    };
    this.repository.commit(next);
    return { ...next.products[index] };
  }

  #validate(input = {}, state, excludeProductId = null) {
    const fieldErrors = {};
    const name = String(input.name ?? "").trim();
    const sku = String(input.sku ?? "").trim().toUpperCase();
    const barcode = String(input.barcode ?? "").trim();
    const categoryId = String(input.category_id ?? "");
    const unitId = String(input.unit_id ?? "");
    const rawPrice = String(input.base_price_idr ?? "").trim();
    const price = /^\d+$/.test(rawPrice) ? Number(rawPrice) : Number.NaN;
    const expiryPolicy = String(input.expiry_policy ?? "");

    if (!name) fieldErrors.name = "Nama produk wajib diisi.";
    if (!sku) fieldErrors.sku = "SKU wajib diisi.";
    else if (state.products.some((product) => product.product_id !== excludeProductId && product.sku.trim().toLocaleLowerCase("id-ID") === sku.toLocaleLowerCase("id-ID"))) {
      fieldErrors.sku = "SKU sudah digunakan produk lain.";
    }
    if (barcode && state.products.some((product) => product.product_id !== excludeProductId && String(product.barcode ?? "").trim() === barcode)) {
      fieldErrors.barcode = "Barcode sudah digunakan produk lain.";
    }
    if (!state.categories.some((category) => category.category_id === categoryId && category.status === "active")) {
      fieldErrors.category_id = "Pilih kategori yang tersedia.";
    }
    if (!state.units.some((unit) => unit.unit_id === unitId)) {
      fieldErrors.unit_id = "Pilih satuan yang tersedia.";
    }
    if (!Number.isSafeInteger(price) || price < 0) {
      fieldErrors.base_price_idr = "Harga dasar harus berupa integer rupiah nol atau lebih.";
    }
    if (!EXPIRY_POLICIES.has(expiryPolicy)) {
      fieldErrors.expiry_policy = "Pilih kebijakan kedaluwarsa yang tersedia.";
    }

    if (Object.keys(fieldErrors).length) throw new ProductValidationError(fieldErrors);
    return {
      name,
      sku,
      barcode,
      category_id: categoryId,
      unit_id: unitId,
      base_price_idr: price,
      expiry_policy: expiryPolicy,
      age_restricted: categoryId === "CAT-ROKOK-TEMBAKAU",
    };
  }
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

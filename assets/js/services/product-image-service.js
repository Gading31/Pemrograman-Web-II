import { createProductImageRepository } from "../repositories/product-image-repository.js";

export const PRODUCT_IMAGE_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_DIMENSION = 800;
export const PRODUCT_IMAGE_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

const PRODUCT_PLACEHOLDERS = Object.freeze({
  "PRD-001": "assets/images/products/prd-001.svg",
  "PRD-002": "assets/images/products/prd-002.svg",
  "PRD-003": "assets/images/products/prd-003.svg",
  "PRD-004": "assets/images/products/prd-004.svg",
  "PRD-005": "assets/images/products/prd-005.svg",
  "PRD-006": "assets/images/products/prd-006.svg",
});
const GENERIC_PLACEHOLDER = "assets/images/products/placeholder.svg";
const CATEGORY_PLACEHOLDERS = Object.freeze({
  "CAT-ROKOK-TEMBAKAU": "assets/images/products/category-tobacco.svg",
  "CAT-PERAWATAN-DIRI": "assets/images/products/category-personal-care.svg",
  "CAT-KEBERSIHAN-RUMAH": "assets/images/products/category-cleaning.svg",
  "CAT-BUMBU-BAHAN-MASAK": "assets/images/products/category-seasoning.svg",
  "CAT-PERLENGKAPAN-BAYI": "assets/images/products/category-baby.svg",
  "CAT-KEBUTUHAN-RUMAH-TANGGA": "assets/images/products/category-household.svg",
});

export class ProductImageError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "ProductImageError";
    this.code = code;
  }
}

function hasSignature(mimeType, bytes) {
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (mimeType === "image/webp") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

async function validateFile(file) {
  if (!file || typeof file.size !== "number" || typeof file.type !== "string") {
    throw new ProductImageError("PRODUCT_IMAGE_FILE_INVALID", "Pilih berkas gambar yang valid.");
  }
  if (file.size <= 0) throw new ProductImageError("PRODUCT_IMAGE_EMPTY", "Berkas gambar kosong.");
  if (file.size > PRODUCT_IMAGE_MAX_UPLOAD_BYTES) throw new ProductImageError("PRODUCT_IMAGE_TOO_LARGE", "Ukuran gambar harus maksimal 2 MB sebelum diproses.");
  if (!PRODUCT_IMAGE_MIME_TYPES.includes(file.type.toLowerCase())) {
    throw new ProductImageError("PRODUCT_IMAGE_TYPE_INVALID", "Format gambar harus JPG, PNG, atau WebP.");
  }
  let header;
  try { header = new Uint8Array(await file.slice(0, 12).arrayBuffer()); }
  catch (error) { throw new ProductImageError("PRODUCT_IMAGE_READ_FAILED", "Berkas gambar tidak dapat dibaca.", error); }
  if (!hasSignature(file.type.toLowerCase(), header)) {
    throw new ProductImageError("PRODUCT_IMAGE_CONTENT_INVALID", "Isi berkas tidak cocok dengan format gambar yang dipilih.");
  }
}

async function compressInBrowser(file) {
  if (typeof globalThis.createImageBitmap !== "function" || typeof document === "undefined") {
    throw new ProductImageError("PRODUCT_IMAGE_PROCESSING_UNAVAILABLE", "Browser ini tidak dapat memproses gambar. Coba browser modern lalu ulangi.");
  }
  let bitmap;
  try { bitmap = await globalThis.createImageBitmap(file); }
  catch (error) { throw new ProductImageError("PRODUCT_IMAGE_DECODE_FAILED", "Gambar rusak atau formatnya tidak dapat dibaca.", error); }
  try {
    const { width, height } = bitmap;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 48_000_000) {
      throw new ProductImageError("PRODUCT_IMAGE_DIMENSIONS_INVALID", "Dimensi gambar tidak valid atau terlalu besar untuk diproses.");
    }
    const scale = Math.min(1, PRODUCT_IMAGE_MAX_DIMENSION / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new ProductImageError("PRODUCT_IMAGE_PROCESSING_FAILED", "Canvas pemrosesan gambar tidak tersedia.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const toBlob = (type, quality) => new Promise((resolve, reject) => {
      try { canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Hasil kompresi kosong.")), type, quality); }
      catch (error) { reject(error); }
    });
    let output;
    try {
      for (const quality of [0.84, 0.72, 0.6, 0.5]) {
        output = await toBlob("image/webp", quality);
        if (output.type === "image/webp" && output.size <= PRODUCT_IMAGE_MAX_UPLOAD_BYTES) break;
      }
      if (!output || output.type !== "image/webp") output = await toBlob("image/png");
    } catch (error) {
      throw new ProductImageError("PRODUCT_IMAGE_PROCESSING_FAILED", "Gambar gagal di-resize atau dikompres.", error);
    }
    if (!output?.size || output.size > PRODUCT_IMAGE_MAX_UPLOAD_BYTES) {
      throw new ProductImageError("PRODUCT_IMAGE_OUTPUT_TOO_LARGE", "Hasil pemrosesan gambar masih melebihi 2 MB.");
    }
    return { blob: output, mime_type: output.type, width: canvas.width, height: canvas.height };
  } finally { bitmap.close?.(); }
}

function isUsableImageRecord(record) {
  return Boolean(record && record.blob && Number.isFinite(record.blob.size) && record.blob.size > 0
    && record.blob.size <= PRODUCT_IMAGE_MAX_UPLOAD_BYTES
    && PRODUCT_IMAGE_MIME_TYPES.includes(record.mime_type)
    && record.blob.type === record.mime_type
    && Number.isSafeInteger(record.width) && record.width > 0 && record.width <= PRODUCT_IMAGE_MAX_DIMENSION
    && Number.isSafeInteger(record.height) && record.height > 0 && record.height <= PRODUCT_IMAGE_MAX_DIMENSION);
}

export class ProductImageService {
  constructor({ repository = createProductImageRepository(), imageProcessor = compressInBrowser, now = () => new Date(), objectUrls = globalThis.URL } = {}) {
    this.repository = repository;
    this.imageProcessor = imageProcessor;
    this.now = now;
    this.objectUrls = objectUrls;
    this.displayCache = new Map();
  }

  fallback(productId, categoryId = null) {
    return { src: PRODUCT_PLACEHOLDERS[productId] ?? CATEGORY_PLACEHOLDERS[categoryId] ?? GENERIC_PLACEHOLDER, source: "placeholder", caption: "Ilustrasi demo · bukan foto produk", stored: false };
  }

  async prepareUpload(file) {
    await validateFile(file);
    let processed;
    try { processed = await this.imageProcessor(file); }
    catch (error) {
      if (error instanceof ProductImageError) throw error;
      throw new ProductImageError("PRODUCT_IMAGE_DECODE_FAILED", "Gambar gagal dibaca atau diproses. Coba berkas lain.", error);
    }
    const outputMime = processed?.mime_type ?? processed?.blob?.type;
    if (!processed?.blob || !PRODUCT_IMAGE_MIME_TYPES.includes(outputMime) || processed.blob.type !== outputMime
      || !Number.isSafeInteger(processed.width) || processed.width < 1
      || !Number.isSafeInteger(processed.height) || processed.height < 1) {
      throw new ProductImageError("PRODUCT_IMAGE_PROCESSING_FAILED", "Hasil pemrosesan gambar tidak valid.");
    }
    if (processed.width > PRODUCT_IMAGE_MAX_DIMENSION || processed.height > PRODUCT_IMAGE_MAX_DIMENSION) {
      throw new ProductImageError("PRODUCT_IMAGE_DIMENSIONS_INVALID", "Gambar hasil pemrosesan harus berukuran maksimal 800 × 800 piksel.");
    }
    if (!processed.blob.size || processed.blob.size > PRODUCT_IMAGE_MAX_UPLOAD_BYTES) {
      throw new ProductImageError("PRODUCT_IMAGE_OUTPUT_TOO_LARGE", "Hasil pemrosesan gambar masih melebihi 2 MB.");
    }
    return {
      blob: processed.blob,
      mime_type: outputMime,
      width: processed.width,
      height: processed.height,
      original_size_bytes: file.size,
      processed_size_bytes: processed.blob.size,
    };
  }

  async save(productId, prepared) {
    if (typeof productId !== "string" || !productId.trim()) throw new ProductImageError("PRODUCT_IMAGE_KEY_INVALID", "ID produk untuk gambar tidak valid.");
    if (!prepared?.blob || !PRODUCT_IMAGE_MIME_TYPES.includes(prepared.mime_type) || prepared.blob.type !== prepared.mime_type
      || !Number.isSafeInteger(prepared.width) || prepared.width < 1 || prepared.width > PRODUCT_IMAGE_MAX_DIMENSION
      || !Number.isSafeInteger(prepared.height) || prepared.height < 1 || prepared.height > PRODUCT_IMAGE_MAX_DIMENSION
      || prepared.blob.size <= 0 || prepared.blob.size > PRODUCT_IMAGE_MAX_UPLOAD_BYTES) {
      throw new ProductImageError("PRODUCT_IMAGE_PROCESSING_FAILED", "Gambar produk belum siap disimpan.");
    }
    const record = {
      product_id: productId,
      blob: prepared.blob,
      mime_type: prepared.mime_type,
      width: prepared.width,
      height: prepared.height,
      original_size_bytes: prepared.original_size_bytes,
      processed_size_bytes: prepared.processed_size_bytes ?? prepared.blob.size,
      updated_at: this.now().toISOString(),
    };
    try { await this.repository.put(record); }
    catch (error) { throw new ProductImageError("PRODUCT_IMAGE_STORAGE_FAILED", "Gambar gagal disimpan di IndexedDB. Data produk tetap tersimpan tanpa perubahan gambar.", error); }
    this.#revoke(productId);
    return { product_id: productId, mime_type: record.mime_type, width: record.width, height: record.height, updated_at: record.updated_at };
  }

  async remove(productId) {
    try { await this.repository.delete(productId); }
    catch (error) { throw new ProductImageError("PRODUCT_IMAGE_DELETE_FAILED", "Gambar gagal dihapus dari IndexedDB. Perubahan gambar tidak diterapkan.", error); }
    this.#revoke(productId);
  }

  async getDisplayImage(productId, categoryId = null) {
    try {
      const record = await this.repository.get(productId);
      if (!record) return this.fallback(productId, categoryId);
      if (!isUsableImageRecord(record)) return { ...this.fallback(productId, categoryId), stored: true, corrupt: true, caption: "Ilustrasi demo · gambar tersimpan tidak dapat dibaca" };
      const cached = this.displayCache.get(productId);
      if (cached?.updated_at === record.updated_at && cached.src) return cached;
      this.#revoke(productId);
      if (typeof this.objectUrls?.createObjectURL !== "function") return { ...this.fallback(productId, categoryId), stored: true, corrupt: true };
      const image = { src: this.objectUrls.createObjectURL(record.blob), source: "uploaded", caption: "Gambar produk", updated_at: record.updated_at, stored: true };
      this.displayCache.set(productId, image);
      return image;
    } catch { return this.fallback(productId, categoryId); }
  }

  invalidateDisplay(productId, categoryId = null) {
    this.#revoke(productId);
    return this.fallback(productId, categoryId);
  }

  #revoke(productId) {
    const cached = this.displayCache.get(productId);
    if (cached?.source === "uploaded") {
      try { this.objectUrls?.revokeObjectURL?.(cached.src); } catch { /* URL usang hanya berdampak pada preview. */ }
    }
    this.displayCache.delete(productId);
  }
}

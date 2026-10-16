export const PRODUCT_IMAGE_DATABASE = "nusantara-pos-product-images-v1";
export const PRODUCT_IMAGE_STORE = "images";

export class ProductImageRepositoryError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "ProductImageRepositoryError";
    this.code = code;
  }
}

export function createProductImageRepository({ indexedDBFactory = () => globalThis.indexedDB, databaseName = PRODUCT_IMAGE_DATABASE } = {}) {
  let databasePromise = null;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      let factory;
      try { factory = typeof indexedDBFactory === "function" ? indexedDBFactory() : indexedDBFactory; }
      catch (error) { reject(new ProductImageRepositoryError("PRODUCT_IMAGE_STORAGE_UNAVAILABLE", "Penyimpanan gambar produk tidak tersedia di browser ini.", error)); return; }
      if (!factory?.open) {
        reject(new ProductImageRepositoryError("PRODUCT_IMAGE_STORAGE_UNAVAILABLE", "Browser tidak menyediakan IndexedDB untuk menyimpan gambar."));
        return;
      }
      let request;
      try { request = factory.open(databaseName, 1); }
      catch (error) { reject(new ProductImageRepositoryError("PRODUCT_IMAGE_OPEN_FAILED", "Database gambar produk gagal dibuka.", error)); return; }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(PRODUCT_IMAGE_STORE)) {
          database.createObjectStore(PRODUCT_IMAGE_STORE, { keyPath: "product_id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new ProductImageRepositoryError("PRODUCT_IMAGE_OPEN_FAILED", "Database gambar produk gagal dibuka.", request.error));
      request.onblocked = () => reject(new ProductImageRepositoryError("PRODUCT_IMAGE_OPEN_BLOCKED", "Database gambar sedang dipakai tab lain. Tutup tab lama lalu coba lagi."));
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  }

  async function transact(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof ProductImageRepositoryError ? error : new ProductImageRepositoryError("PRODUCT_IMAGE_TRANSACTION_FAILED", "Gambar produk gagal dibaca atau disimpan.", error));
      };
      try {
        transaction = database.transaction(PRODUCT_IMAGE_STORE, mode);
        const request = operation(transaction.objectStore(PRODUCT_IMAGE_STORE));
        if (request) {
          request.onsuccess = () => { result = request.result; };
          request.onerror = () => fail(request.error);
        }
        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        transaction.onerror = () => fail(transaction.error);
        transaction.onabort = () => fail(transaction.error);
      } catch (error) { fail(error); }
    });
  }

  return Object.freeze({
    get(productId) {
      if (typeof productId !== "string" || !productId.trim()) return Promise.reject(new ProductImageRepositoryError("PRODUCT_IMAGE_KEY_INVALID", "ID produk untuk gambar tidak valid."));
      return transact("readonly", (store) => store.get(productId));
    },
    put(record) {
      if (!record || typeof record.product_id !== "string" || !record.product_id.trim()) return Promise.reject(new ProductImageRepositoryError("PRODUCT_IMAGE_KEY_INVALID", "ID produk untuk gambar tidak valid."));
      return transact("readwrite", (store) => store.put(record));
    },
    delete(productId) {
      if (typeof productId !== "string" || !productId.trim()) return Promise.reject(new ProductImageRepositoryError("PRODUCT_IMAGE_KEY_INVALID", "ID produk untuk gambar tidak valid."));
      return transact("readwrite", (store) => store.delete(productId));
    },
  });
}

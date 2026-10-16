import { createDemoSeed, DEMO_REFERENCE_DATE } from "./demo-seed.js";
import {
  CATALOG_COVERAGE_STOCK_MANIFEST,
  CATALOG_COVERAGE_STOCK_MARKER,
  CATALOG_COVERAGE_STOCK_VERSION,
  createCatalogCoverageStockRows,
} from "./inventory-seed.js";
import { ADMINISTRATION_STORAGE_KEY, createAdministrationRepository } from "../repositories/administration-repository.js";
import { createLocalStorageRepository } from "../repositories/local-storage-repository.js";
import { inspectPresentationCashierDirectory, PRESENTATION_SALES_VERSION, PresentationTransactionProvisioningService } from "../services/presentation-transaction-provisioning-service.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const INSTALLATION_TIMESTAMP = "2026-10-12T08:00:00+07:00";
const FIXED_PRESENTATION_NOW = new Date("2026-10-16T12:00:00+07:00");
const DEMO_STORAGE_KEY = "nusantara-pos-demo-state";

function memoryStorage(initial = null) {
  const values = new Map(initial ? Object.entries(initial) : []);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

export function createPresentationStockSeed() {
  const state = createDemoSeed();
  const coverage = createCatalogCoverageStockRows(state.products, {
    effectiveDate: DEMO_REFERENCE_DATE,
    recordedAt: INSTALLATION_TIMESTAMP,
  });
  state.inventoryBatches.push(...coverage.inventoryBatches);
  state.stockMovements.push(...coverage.stockMovements);
  state.meta[CATALOG_COVERAGE_STOCK_MARKER] = CATALOG_COVERAGE_STOCK_VERSION;
  state.meta[CATALOG_COVERAGE_STOCK_MANIFEST] = {
    version: CATALOG_COVERAGE_STOCK_VERSION,
    inventory_batch_ids: coverage.inventoryBatches.map((batch) => batch.inventory_batch_id),
    effective_date: DEMO_REFERENCE_DATE,
    recorded_at: INSTALLATION_TIMESTAMP,
  };
  return state;
}

export function createPresentationDemoSeed({
  administrationRepository = createAdministrationRepository(memoryStorage()),
  administrationDirectoryExists = false,
  now = FIXED_PRESENTATION_NOW,
} = {}) {
  const state = createPresentationStockSeed();
  const directory = administrationRepository.load();
  const unavailable = inspectPresentationCashierDirectory({ load: () => directory }).filter((entry) => !entry.available);
  if (administrationDirectoryExists && unavailable.length > 0) {
    state.meta.presentation_sales_seed_notice = {
      code: "PRESENTATION_CASHIER_DIRECTORY_UNAVAILABLE",
      cashier_issues: unavailable.map(({ branchId, reasons }) => ({ branch_id: branchId, reasons })),
      message: "Riwayat transaksi presentasi belum dibuat karena direktori kasir yang tersimpan memerlukan pemeriksaan manual. Periksa status, role, dan penugasan akun di Pengguna & Akses; setelah sesuai, gunakan Pratinjau transaksi pada halaman Persediaan. Akun tidak diubah otomatis.",
    };
    return state;
  }

  state.meta.presentation_installation_seed = PRESENTATION_SALES_VERSION;
  let currentState = clone(state);
  const repository = {
    load: () => clone(currentState),
    commit(next) {
      currentState = clone(next);
      return clone(currentState);
    },
  };
  new PresentationTransactionProvisioningService({
    repository,
    administrationRepository,
    now: () => now,
  }).provision({ role: "HQ_ADMIN", confirmed: true });
  return repository.load();
}

export function createFreshProfileSeed({ storage, now = () => new Date() } = {}) {
  if (!storage || typeof storage.getItem !== "function") throw new TypeError("Seed profil baru membutuhkan penyimpanan lokal yang dapat dibaca.");
  let existingDemoState;
  let administrationDirectoryExists;
  try {
    existingDemoState = storage.getItem(DEMO_STORAGE_KEY);
    administrationDirectoryExists = storage.getItem(ADMINISTRATION_STORAGE_KEY) !== null;
  } catch (error) {
    throw new Error("Penyimpanan lokal tidak dapat diperiksa; seed demo tidak ditulis.", { cause: error });
  }
  if (existingDemoState !== null) return null;
  return createPresentationDemoSeed({
    administrationRepository: createAdministrationRepository(storage),
    administrationDirectoryExists,
    now: now(),
  });
}

export function seedFreshPresentationProfile(options = {}) {
  const seed = createFreshProfileSeed(options);
  if (seed !== null) createLocalStorageRepository(options.storage).commit(seed);
  return seed;
}

export { DEMO_STORAGE_KEY, memoryStorage as createPresentationMemoryStorage };

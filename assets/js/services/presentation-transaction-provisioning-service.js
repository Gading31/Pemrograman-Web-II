import { DEMO_ACCOUNTS } from "../data/demo-accounts.js";
import { DEMO_REFERENCE_DATE } from "../data/demo-seed.js";
import { createAdministrationRepository } from "../repositories/administration-repository.js";
import { validateDemoState } from "../repositories/local-storage-repository.js";
import { PosService } from "./pos-service.js";

export const PRESENTATION_SALES_VERSION = "presentation-sales-five-branches-100-v1";
export const PRESENTATION_SALES_MARKER = "presentation_sales_dataset_version";
export const PRESENTATION_SALES_MANIFEST = "presentation_sales_dataset_manifest_v1";
export const PRESENTATION_SALES_COUNT = 100;
export const PRESENTATION_SALES_PER_BRANCH = 20;

const BRANCHES = Object.freeze([
  { branchId: "BR-JKT-01", code: "JKT", cashierId: "DEMO-CASHIER-001" },
  { branchId: "BR-BDG-01", code: "BDG", cashierId: "DEMO-CASHIER-BDG-001" },
  { branchId: "BR-MDN-01", code: "MDN", cashierId: "DEMO-CASHIER-MDN-001" },
  { branchId: "BR-SBY-01", code: "SBY", cashierId: "DEMO-CASHIER-SBY-001" },
  { branchId: "BR-MKS-01", code: "MKS", cashierId: "DEMO-CASHIER-MKS-001" },
]);
const DEMO_CASHIER_IDS = new Set(DEMO_ACCOUNTS.filter((user) => user.role === "CASHIER").map((user) => user.user_id));
const clone = (value) => JSON.parse(JSON.stringify(value));

function confirmationToken(state, window, accountState) {
  const payload = JSON.stringify({
    window,
    state,
    accounts: accountState.users.filter((user) => DEMO_CASHIER_IDS.has(user.user_id)).map((user) => [user.user_id, user.username, user.display_name, user.role, user.status, user.branch_id, user.auth_version ?? 1]),
  });
  return hashToken(payload);
}

function hashToken(payload) {
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) hash = Math.imul(hash ^ payload.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class PresentationSalesProvisioningError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "PresentationSalesProvisioningError";
    this.code = code;
  }
}

function dateOnlyInJakarta(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_CLOCK_INVALID", "Tanggal dataset simulasi tidak valid.");
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function timestampAt(date, millisecondsOfDay) {
  const normalized = Math.max(0, Math.min(86_399_999, Math.trunc(millisecondsOfDay)));
  const hour = Math.floor(normalized / 3_600_000);
  const minute = Math.floor((normalized % 3_600_000) / 60_000);
  const second = Math.floor((normalized % 60_000) / 1000);
  const millisecond = normalized % 1000;
  return new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.${String(millisecond).padStart(3, "0")}+07:00`);
}

function jakartaDayStart(date) {
  return timestampAt(date, 0).getTime();
}

function jakartaDayEnd(date) {
  return jakartaDayStart(addDays(date, 1)) - 1;
}

function ledgerDate(movement) {
  return movement.effective_date ?? dateOnlyInJakarta(movement.occurred_at);
}

function buildExistingSchedules(state, branches, dates, now) {
  const branchCapacity = new Map();
  for (const branch of branches) {
    const warehouseIds = new Set(state.warehouses.filter((warehouse) => warehouse.branch_id === branch.branchId).map((warehouse) => warehouse.warehouse_id));
    for (const date of dates) {
      const startOfDay = jakartaDayStart(date);
      const endOfDay = jakartaDayEnd(date);
      const end = Math.min(endOfDay, now.getTime());
      const priorMovements = state.stockMovements.filter((movement) => warehouseIds.has(movement.warehouse_id) && ledgerDate(movement) <= date);
      const latestMovementAt = priorMovements.reduce((latest, movement) => Math.max(latest, Date.parse(movement.occurred_at)), startOfDay);
      const span = end - latestMovementAt;
      const capacity = span >= 0 ? Math.max(0, Math.floor(span / 1000) - 2) : 0;
      branchCapacity.set(`${branch.branchId}|${date}`, { start: latestMovementAt, end, capacity });
    }
  }

  const schedules = [];
  for (const branch of branches) {
    let remaining = PRESENTATION_SALES_PER_BRANCH;
    let transactionOffset = 0;
    for (const date of dates) {
      if (remaining === 0) break;
      const range = branchCapacity.get(`${branch.branchId}|${date}`);
      const count = Math.min(remaining, range.capacity);
      if (!count) continue;
      const spacing = Math.floor((range.end - range.start) / (count + 2));
      const at = (position) => new Date(range.start + spacing * position);
      schedules.push({
        branchId: branch.branchId,
        date,
        saleCount: count,
        transactionOffset,
        openAt: at(1).toISOString(),
        saleAt: Array.from({ length: count }, (_, index) => at(index + 2).toISOString()),
        closeAt: at(count + 2).toISOString(),
      });
      transactionOffset += count;
      remaining -= count;
    }
    if (remaining > 0) {
      throw new PresentationSalesProvisioningError("PRESENTATION_SALES_TIME_RANGE", `Tidak tersedia rentang waktu kronologis yang aman untuk menempatkan 20 transaksi dan menutup shift ${branch.branchId} sebelum waktu provisioning. Coba kembali setelah tersedia waktu operasional yang cukup.`);
    }
  }
  return schedules.sort((left, right) => left.date.localeCompare(right.date) || branches.findIndex((branch) => branch.branchId === left.branchId) - branches.findIndex((branch) => branch.branchId === right.branchId));
}

function buildCleanSchedules(state, branches, dates, now) {
  const dailyCount = Math.floor(PRESENTATION_SALES_PER_BRANCH / dates.length);
  let remainder = PRESENTATION_SALES_PER_BRANCH % dates.length;
  const schedules = [];
  for (const branch of branches) {
    const warehouseIds = new Set(state.warehouses.filter((warehouse) => warehouse.branch_id === branch.branchId).map((warehouse) => warehouse.warehouse_id));
    let transactionOffset = 0;
    for (const date of dates) {
      const count = dailyCount + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      if (!count) continue;
      const priorMovements = state.stockMovements.filter((movement) => warehouseIds.has(movement.warehouse_id) && ledgerDate(movement) <= date);
      const latestMovementAt = priorMovements.reduce((latest, movement) => Math.max(latest, Date.parse(movement.occurred_at)), jakartaDayStart(date));
      let openAt = timestampAt(date, 9 * 60 * 60 * 1000);
      let spacing = 5 * 60 * 1000;
      let saleAt = Array.from({ length: count }, (_, index) => new Date(openAt.getTime() + spacing * (index + 1)).toISOString());
      let closeAt = new Date(openAt.getTime() + spacing * (count + 2)).toISOString();
      if (openAt.getTime() <= latestMovementAt || Date.parse(closeAt) > now.getTime()) {
        const start = Math.max(jakartaDayStart(date), latestMovementAt);
        const end = Math.min(jakartaDayEnd(date), now.getTime());
        spacing = Math.floor((end - start) / (count + 2));
        if (spacing < 1) {
          throw new PresentationSalesProvisioningError("PRESENTATION_SALES_TIME_RANGE", `Tidak tersedia rentang kronologis yang aman untuk seed transaksi ${date} di ${branch.branchId}. Seed tidak ditulis.`);
        }
        openAt = new Date(start + spacing);
        saleAt = Array.from({ length: count }, (_, index) => new Date(start + spacing * (index + 2)).toISOString());
        closeAt = new Date(start + spacing * (count + 2)).toISOString();
      }
      if (Date.parse(closeAt) > now.getTime() || Date.parse(closeAt) > jakartaDayEnd(date)) {
        throw new PresentationSalesProvisioningError("PRESENTATION_SALES_TIME_RANGE", `Waktu penutupan shift seed ${branch.branchId} pada ${date} melampaui waktu provisioning. Seed tidak ditulis.`);
      }
      schedules.push({ branchId: branch.branchId, date, saleCount: count, transactionOffset, openAt: openAt.toISOString(), saleAt, closeAt });
      transactionOffset += count;
    }
    remainder = PRESENTATION_SALES_PER_BRANCH % dates.length;
  }
  return schedules;
}

function expectedSeedWindows(today, coverageManifest, isCleanPresentationSeed) {
  if (isCleanPresentationSeed) return { from: DEMO_REFERENCE_DATE, to: "2026-10-16" };
  const stockDate = coverageManifest?.effective_date;
  if (!stockDate || stockDate > today) {
    throw new PresentationSalesProvisioningError("PRESENTATION_SALES_STOCK_DATE_INVALID", "Tanggal efektif stok presentasi tidak tersedia atau berada di masa depan.");
  }
  // Existing profiles receive newly provisioned inventory on the current business
  // date. Never backdate generated sales before that stock becomes available.
  const earliestAllowed = addDays(today, -4);
  const from = stockDate > earliestAllowed ? stockDate : earliestAllowed;
  return { from, to: today };
}

function scheduleDates(from, to) {
  const result = [];
  for (let date = from; date <= to; date = addDays(date, 1)) result.push(date);
  if (!result.length || result.length > 5) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_RANGE_INVALID", "Rentang transaksi presentasi harus mencakup satu sampai lima hari.");
  return result;
}

export function inspectPresentationCashierDirectory(administrationRepository) {
  const state = administrationRepository.load();
  return BRANCHES.map((branch) => {
    const account = state.users.find((user) => user.user_id === branch.cashierId);
    const reasons = [];
    if (!account) reasons.push("akun belum tersedia");
    else {
      if (account.status !== "active") reasons.push("akun tidak aktif");
      if (account.role !== "CASHIER") reasons.push("role akun bukan Kasir");
      if (account.branch_id !== branch.branchId) reasons.push(`penugasan akun berada di ${account.branch_id ?? "tanpa cabang"}`);
    }
    return { branchId: branch.branchId, cashierId: branch.cashierId, available: reasons.length === 0, reasons };
  });
}

function accountForBranch(administrationRepository, branch) {
  const availability = inspectPresentationCashierDirectory(administrationRepository).find((entry) => entry.branchId === branch.branchId);
  const account = administrationRepository.load().users.find((user) => user.user_id === branch.cashierId);
  if (!availability?.available) {
    throw new PresentationSalesProvisioningError("PRESENTATION_CASHIER_UNAVAILABLE", `Kasir demo untuk ${branch.branchId} ${availability?.reasons.join("; ") ?? "tidak tersedia"}. Admin perlu memeriksa akun secara manual; akun tidak diubah otomatis.`);
  }
  return account;
}

function stateHasCoverage(state) {
  const manifest = state.meta?.catalog_coverage_stock_manifest_v1;
  if (state.meta?.catalog_coverage_stock_version !== "catalog-stock-60x5-v1"
    || manifest?.version !== "catalog-stock-60x5-v1"
    || !Array.isArray(manifest.inventory_batch_ids)) {
    throw new PresentationSalesProvisioningError("PRESENTATION_SALES_STOCK_REQUIRED", "Siapkan dan konfirmasi stok katalog semua cabang sebelum menambahkan transaksi simulasi.");
  }
  return manifest;
}

function activeShiftConflict(state, cashierIds) {
  return (state.cashShifts ?? []).find((shift) => cashierIds.has(shift.cashier_id) && shift.status === "active");
}

function isCanonicalSeedWindow(state, manifest, window) {
  return state.meta?.presentation_installation_seed === PRESENTATION_SALES_VERSION
    && manifest.effective_date === DEMO_REFERENCE_DATE
    && window.from === DEMO_REFERENCE_DATE && window.to === "2026-10-16";
}

export class PresentationTransactionProvisioningService {
  constructor({
    repository,
    administrationRepository = createAdministrationRepository(),
    now = () => new Date(),
  } = {}) {
    if (!repository || typeof repository.load !== "function" || typeof repository.commit !== "function") {
      throw new TypeError("Provisioning transaksi presentasi membutuhkan repository demo.");
    }
    this.repository = repository;
    this.administrationRepository = administrationRepository;
    this.now = now;
    this.previewPlans = new Map();
  }

  #prepare({ role, planOverride = null } = {}) {
    if (role !== "HQ_ADMIN") throw new PresentationSalesProvisioningError("PRESENTATION_SALES_FORBIDDEN", "Penyiapan transaksi simulasi hanya tersedia untuk Admin Pusat.");
    const state = this.repository.load();
    const marker = state.meta?.[PRESENTATION_SALES_MARKER];
    const manifest = state.meta?.[PRESENTATION_SALES_MANIFEST];
    if (marker !== undefined && marker !== PRESENTATION_SALES_VERSION) {
      throw new PresentationSalesProvisioningError("PRESENTATION_SALES_VERSION_UNSUPPORTED", `Versi dataset transaksi ${marker} tidak didukung.`);
    }
    if (marker !== undefined) {
      const ids = manifest?.version === PRESENTATION_SALES_VERSION && Array.isArray(manifest.sale_ids) ? manifest.sale_ids : null;
      const idSet = ids && new Set(ids);
      const sales = (state.sales ?? []).filter((sale) => sale.simulation_dataset_id === PRESENTATION_SALES_VERSION);
      const shifts = (state.cashShifts ?? []).filter((shift) => shift.simulation_dataset_id === PRESENTATION_SALES_VERSION);
      if (!ids || ids.length !== PRESENTATION_SALES_COUNT || idSet.size !== ids.length
        || sales.length !== PRESENTATION_SALES_COUNT || ids.some((id) => !sales.some((sale) => sale.sale_id === id))
        || !Array.isArray(manifest.shift_ids) || shifts.length !== manifest.shift_ids.length
        || manifest.shift_ids.some((id) => !shifts.some((shift) => shift.shift_id === id && shift.status === "closed"))) {
        throw new PresentationSalesProvisioningError("PRESENTATION_SALES_MARKER_INCONSISTENT", "Penanda transaksi simulasi tidak sesuai dengan histori penjualan atau shift. Data tidak diperbaiki otomatis.");
      }
      return { state, alreadyProvisioned: true, manifest, window: { from: manifest.date_from, to: manifest.date_to }, branches: BRANCHES };
    }
    if (manifest !== undefined) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_MARKER_INCONSISTENT", "Manifest transaksi simulasi tidak memiliki penanda versi yang cocok.");
    const coverageManifest = stateHasCoverage(state);
    const provisioningNow = this.now();
    const now = provisioningNow instanceof Date ? new Date(provisioningNow) : new Date(provisioningNow);
    if (Number.isNaN(now.valueOf())) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_CLOCK_INVALID", "Waktu provisioning tidak valid; tidak ada transaksi yang dibuat.");
    const today = dateOnlyInJakarta(now);
    const cleanSeed = state.meta?.presentation_installation_seed === PRESENTATION_SALES_VERSION;
    const proposedWindow = expectedSeedWindows(today, coverageManifest, cleanSeed);
    const latestMovementAt = state.stockMovements.reduce((latest, movement) => Math.max(latest, Date.parse(movement.occurred_at)), 0);
    if (latestMovementAt > now.getTime()) {
      throw new PresentationSalesProvisioningError("PRESENTATION_SALES_LEDGER_FUTURE", "Ledger stok memuat waktu pencatatan setelah waktu provisioning. Periksa kronologi data sebelum menambahkan transaksi simulasi.");
    }
    const latestMovementDate = latestMovementAt ? dateOnlyInJakarta(new Date(latestMovementAt)) : proposedWindow.from;
    const candidateWindow = {
      from: latestMovementDate > proposedWindow.from ? latestMovementDate : proposedWindow.from,
      to: proposedWindow.to,
    };
    if (candidateWindow.from > candidateWindow.to) {
      throw new PresentationSalesProvisioningError("PRESENTATION_SALES_TIME_RANGE", "Tidak ada tanggal setelah pencatatan stok yang masih aman untuk transaksi simulasi.");
    }
    const candidateDates = scheduleDates(candidateWindow.from, candidateWindow.to);
    const cashierIds = new Set();
    for (const branch of BRANCHES) {
      const cashier = accountForBranch(this.administrationRepository, branch);
      cashierIds.add(cashier.user_id);
    }
    const accountState = this.administrationRepository.load();
    const baseToken = confirmationToken(state, candidateWindow, accountState);
    let schedule;
    if (planOverride) {
      if (planOverride.baseToken !== baseToken
        || planOverride.baseWindow.from !== candidateWindow.from || planOverride.baseWindow.to !== candidateWindow.to) {
        throw new PresentationSalesProvisioningError("PRESENTATION_SALES_PREVIEW_STALE", "State atau cakupan tanggal berubah sejak pratinjau. Tinjau ulang sebelum konfirmasi.");
      }
      schedule = clone(planOverride.schedule);
      const scheduledDates = new Set(schedule.map((entry) => entry.date));
      if (schedule.some((entry) => !BRANCHES.some((branch) => branch.branchId === entry.branchId)
        || !candidateDates.includes(entry.date)
        || !Number.isSafeInteger(entry.saleCount) || entry.saleCount < 1
        || entry.saleAt.length !== entry.saleCount
        || [entry.openAt, ...entry.saleAt, entry.closeAt].some((value) => Date.parse(value) > now.getTime()))) {
        throw new PresentationSalesProvisioningError("PRESENTATION_SALES_PREVIEW_STALE", "Jadwal pada pratinjau tidak lagi valid terhadap waktu saat ini.");
      }
      for (const entry of schedule) {
        const branch = BRANCHES.find((item) => item.branchId === entry.branchId);
        const warehouseIds = new Set(state.warehouses.filter((warehouse) => warehouse.branch_id === branch.branchId).map((warehouse) => warehouse.warehouse_id));
        const priorMovements = state.stockMovements.filter((movement) => warehouseIds.has(movement.warehouse_id) && ledgerDate(movement) <= entry.date);
        const latestMovementAt = priorMovements.reduce((latest, movement) => Math.max(latest, Date.parse(movement.occurred_at)), jakartaDayStart(entry.date));
        const eventTimes = [entry.openAt, ...entry.saleAt, entry.closeAt].map(Date.parse);
        if (eventTimes[0] <= latestMovementAt || eventTimes.some((value, index) => index > 0 && value <= eventTimes[index - 1])
          || eventTimes.at(-1) > Math.min(jakartaDayEnd(entry.date), now.getTime())) {
          throw new PresentationSalesProvisioningError("PRESENTATION_SALES_PREVIEW_STALE", "Urutan ledger, shift, transaksi, atau waktu pada pratinjau sudah tidak aman. Buka pratinjau kembali.");
        }
      }
      for (const branch of BRANCHES) {
        const branchSchedules = schedule.filter((entry) => entry.branchId === branch.branchId);
        if (branchSchedules.reduce((sum, entry) => sum + entry.saleCount, 0) !== PRESENTATION_SALES_PER_BRANCH) {
          throw new PresentationSalesProvisioningError("PRESENTATION_SALES_PREVIEW_STALE", "Jumlah transaksi dalam pratinjau berubah; buka pratinjau kembali.");
        }
      }
      if (!scheduledDates.size) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_PREVIEW_STALE", "Jadwal transaksi pada pratinjau kosong.");
    } else {
      schedule = cleanSeed ? buildCleanSchedules(state, BRANCHES, candidateDates, now) : buildExistingSchedules(state, BRANCHES, candidateDates, now);
    }
    const scheduledDates = [...new Set(schedule.map((entry) => entry.date))].sort();
    const window = { from: scheduledDates[0], to: scheduledDates.at(-1) };
    const dates = scheduledDates;
    const expectedSales = [];
    const expectedShifts = [];
    for (const entry of schedule) {
      const branch = BRANCHES.find((item) => item.branchId === entry.branchId);
      expectedShifts.push("SHIFT-SIM-" + branch.code + "-" + entry.date.replaceAll("-", "") + "-00-001");
      for (let index = 0; index < entry.saleCount; index += 1) expectedSales.push({ branch, date: entry.date, index });
    }
    const existingShift = activeShiftConflict(state, cashierIds);
    if (existingShift) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_ACTIVE_SHIFT", `Kasir ${existingShift.cashier_id} masih memiliki shift aktif. Tutup shift tersebut secara manual sebelum provisioning; histori tidak diubah.`);
    const usedIds = new Set((state.sales ?? []).map((sale) => sale.sale_id));
    const usedNumbers = new Set((state.sales ?? []).map((sale) => sale.transaction_number));
    const usedKeys = new Set((state.sales ?? []).map((sale) => sale.idempotency_key));
    const usedShiftIds = new Set((state.cashShifts ?? []).map((shift) => shift.shift_id));
    for (const entry of expectedSales) {
      const idempotencyKey = `PRESENTATION-SALE-${entry.branch.code}-${entry.date.replaceAll("-", "")}-${String(entry.index + 1).padStart(2, "0")}`;
      if (usedKeys.has(idempotencyKey)) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_ID_CONFLICT", `Kunci transaksi presentasi ${idempotencyKey} sudah dipakai histori lain.`);
    }
    for (const shiftId of expectedShifts) {
      if (usedShiftIds.has(shiftId)) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_ID_CONFLICT", `ID shift presentasi ${shiftId} sudah digunakan.`);
    }
    const targetBranches = new Set(BRANCHES.map((branch) => branch.branchId));
    const canonicalJktStock = state.inventoryBatches.some((batch) => batch.product_id === "PRD-001" && batch.warehouse_id === "WH-JKT-01");
    if (!canonicalJktStock) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_CANONICAL_STOCK_MISSING", "Batch kanonis PRD-001 Jakarta tidak tersedia; transaksi presentasi tidak dibuat agar fixture Rp61.000 tetap dapat diverifikasi.");
    for (const branch of BRANCHES) {
      if (!targetBranches.has(branch.branchId)) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_BRANCH_INVALID", "Cabang target transaksi simulasi tidak valid.");
      const allActiveProducts = state.products.filter((product) => product.status === "active");
      const branchProducts = allActiveProducts.filter((product) => product.age_restricted !== true && product.category_id !== "CAT-ROKOK-TEMBAKAU");
      if (!branchProducts.length) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_CATALOG_EMPTY", `Tidak ada produk aktif yang dapat dipakai untuk transaksi simulasi pada ${branch.branchId}.`);
      const warehouse = state.warehouses.find((item) => item.branch_id === branch.branchId && item.status === "active");
      const batchStock = new Map();
      const businessDate = (value) => {
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
        const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        return fields.year + "-" + fields.month + "-" + fields.day;
      };
      for (const batch of state.inventoryBatches.filter((item) => item.warehouse_id === warehouse?.warehouse_id)) {
        const movements = state.stockMovements.filter((item) => item.inventory_batch_id === batch.inventory_batch_id && item.stock_bucket === "AVAILABLE" && (item.effective_date ?? businessDate(item.occurred_at)) <= window.to);
        const balance = movements.reduce((sum, movement) => sum + movement.quantity_delta, 0);
        const sellable = batch.expiry_date && batch.expiry_date <= window.to ? 0 : balance;
        if (sellable > 0) batchStock.set(batch.product_id, (batchStock.get(batch.product_id) ?? 0) + sellable);
      }
      if (allActiveProducts.some((product) => !batchStock.has(product.product_id))) {
        const missing = allActiveProducts.filter((product) => !batchStock.has(product.product_id)).map((product) => product.sku).slice(0, 5).join(", ");
        throw new PresentationSalesProvisioningError("PRESENTATION_SALES_STOCK_INCOMPLETE", `Stok layak jual belum tersedia untuk sebagian katalog ${branch.branchId} (${missing}). Selesaikan provisioning stok terlebih dahulu.`);
      }
      const possibleSales = expectedSales.filter((entry) => entry.branch.branchId === branch.branchId);
      for (const entry of possibleSales) {
        const candidateSaleId = `SALE-SIM-${branch.code}-${entry.date.replaceAll("-", "")}-${String(entry.index + 1).padStart(2, "0")}-001`;
        if (usedIds.has(candidateSaleId)) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_ID_CONFLICT", `ID transaksi presentasi ${candidateSaleId} sudah digunakan.`);
        const expectedNumberSuffix = candidateSaleId.split("-").slice(1).join("").replace(/[^A-Z0-9]/gi, "").slice(-16).toUpperCase();
        const expectedTransactionNumber = "TRX-" + entry.date.replaceAll("-", "") + "-" + expectedNumberSuffix;
        if (usedNumbers.has(expectedTransactionNumber)) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_ID_CONFLICT", "Nomor transaksi " + expectedTransactionNumber + " sudah digunakan.");
      }
    }
    const previewToken = hashToken(JSON.stringify({ baseToken, schedule }));
    return {
      state,
      alreadyProvisioned: false,
      manifest: coverageManifest,
      window,
      dates,
      candidateWindow,
      baseToken,
      confirmationToken: previewToken,
      schedule,
      expectedSales,
      expectedShifts,
    };
  }

  preview(options = {}) {
    const prepared = this.#prepare(options);
    if (!prepared.alreadyProvisioned) {
      this.previewPlans.set(prepared.confirmationToken, {
        baseToken: prepared.baseToken,
        baseWindow: prepared.candidateWindow,
        schedule: clone(prepared.schedule),
      });
      while (this.previewPlans.size > 8) this.previewPlans.delete(this.previewPlans.keys().next().value);
    }
    return {
      alreadyProvisioned: prepared.alreadyProvisioned,
      transactionCount: prepared.alreadyProvisioned ? PRESENTATION_SALES_COUNT : prepared.expectedSales.length,
      transactionsPerBranch: BRANCHES.map((branch) => ({ branchId: branch.branchId, count: PRESENTATION_SALES_PER_BRANCH })),
      branchCount: BRANCHES.length,
      shiftCount: prepared.alreadyProvisioned ? prepared.manifest.shift_ids.length : prepared.expectedShifts.length,
      estimatedUnits: prepared.alreadyProvisioned ? (prepared.manifest.estimated_units ?? 0) : 345,
      dateFrom: prepared.window.from,
      dateTo: prepared.window.to,
      confirmationToken: prepared.confirmationToken,
      excludedProduct: "PRD-001 Jakarta",
      effects: [
        "Membuat snapshot transaksi, pembayaran tunai simulasi, movement pengurangan stok, dan shift tutup melalui PosService.",
        "Tidak mengubah akun, password, distribusi, atau transaksi manual yang sudah ada.",
        "Tidak mengubah batch SNK-A, SNK-B, atau SNK-X Jakarta; PRD-001 Jakarta dikecualikan dari generator.",
      ],
    };
  }

  provision({ role, confirmed = false, expectedDateFrom, expectedDateTo, expectedPreviewToken } = {}) {
    if (!confirmed) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_CONFIRMATION_REQUIRED", "Konfirmasikan penambahan transaksi simulasi sebelum menyimpan.");
    const planOverride = expectedPreviewToken === undefined ? null : this.previewPlans.get(expectedPreviewToken);
    if (expectedPreviewToken !== undefined && !planOverride) {
      throw new PresentationSalesProvisioningError("PRESENTATION_SALES_PREVIEW_STALE", "Pratinjau tidak lagi tersedia pada sesi ini. Buka pratinjau kembali sebelum konfirmasi.");
    }
    const prepared = this.#prepare({ role, planOverride });
    if (expectedDateFrom !== undefined && (prepared.window.from !== expectedDateFrom || prepared.window.to !== expectedDateTo)) {
      throw new PresentationSalesProvisioningError("PRESENTATION_SALES_PREVIEW_STALE", "Rentang tanggal transaksi berubah sejak pratinjau. Tutup dialog dan tinjau dampak terbaru.");
    }
    if (expectedPreviewToken !== undefined && prepared.confirmationToken !== expectedPreviewToken) {
      throw new PresentationSalesProvisioningError("PRESENTATION_SALES_PREVIEW_STALE", "Stok, harga, akun, atau histori berubah setelah pratinjau. Buka pratinjau kembali sebelum konfirmasi.");
    }
    if (prepared.alreadyProvisioned) return { alreadyProvisioned: true, addedTransactionCount: 0, addedShiftCount: 0, state: prepared.state };
    let currentState = clone(prepared.state);
    let context = { branchCode: "", date: "", ordinal: 0, at: new Date(0), prefixCounts: new Map() };
    const memoryRepository = {
      load: () => clone(currentState),
      commit: (next) => {
        currentState = clone(next);
        return clone(currentState);
      },
    };
    const ids = {
      sales: [],
      shifts: [],
    };
    for (const plan of prepared.schedule) {
        const { date, saleCount, transactionOffset } = plan;
        const branch = BRANCHES.find((item) => item.branchId === plan.branchId);
        const cashier = accountForBranch(this.administrationRepository, branch);
        context = { branchCode: branch.code, date, ordinal: 0, at: new Date(plan.openAt), prefixCounts: new Map() };
        const pos = new PosService({
          repository: memoryRepository,
          now: () => new Date(context.at),
          idFactory: (prefix) => {
            const sequence = (context.prefixCounts.get(prefix) ?? 0) + 1;
            context.prefixCounts.set(prefix, sequence);
            const dateKey = context.date.replaceAll("-", "");
            const ordinal = String(context.ordinal).padStart(2, "0");
            return `${prefix}-SIM-${context.branchCode}-${dateKey}-${ordinal}-${String(sequence).padStart(3, "0")}`;
          },
          cashierId: cashier.user_id,
          branchScopeId: branch.branchId,
          simulationDatasetId: PRESENTATION_SALES_VERSION,
        });
        context.at = new Date(plan.openAt);
        context.prefixCounts = new Map();
        const shift = pos.openShift({ branchId: branch.branchId, openingCashIdr: 200000, cashierId: cashier.user_id });
        ids.shifts.push(shift.shift_id);
        let productCursor = (BRANCHES.indexOf(branch) * 13) % 60;
        for (let ordinal = 1; ordinal <= saleCount; ordinal += 1) {
          context.ordinal = ordinal;
          context.at = new Date(plan.saleAt[ordinal - 1]);
          context.prefixCounts = new Map();
          const transactionIndex = transactionOffset + ordinal - 1;
          const requestedLineCount = 1 + (transactionIndex % 6);
          const items = [];
          const selected = new Set();
          const current = memoryRepository.load();
          const warehouse = current.warehouses.find((item) => item.branch_id === branch.branchId && item.status === "active");
          const balances = new Map();
        for (const movement of current.stockMovements) {
            const movementDate = movement.effective_date ?? dateOnlyInJakarta(movement.occurred_at);
            if (movement.warehouse_id === warehouse?.warehouse_id && movement.stock_bucket === "AVAILABLE" && movementDate <= date) {
              balances.set(movement.inventory_batch_id, (balances.get(movement.inventory_batch_id) ?? 0) + movement.quantity_delta);
            }
          }
          const sellableProductIds = new Set(current.inventoryBatches.filter((batch) => batch.warehouse_id === warehouse?.warehouse_id
            && (!batch.expiry_date || batch.expiry_date > date)
            && (balances.get(batch.inventory_batch_id) ?? 0) > 0).map((batch) => batch.product_id));
          const products = current.products.filter((product) => product.status === "active"
            && product.age_restricted !== true && product.category_id !== "CAT-ROKOK-TEMBAKAU"
            && sellableProductIds.has(product.product_id)
            && !(branch.branchId === "BR-JKT-01" && product.product_id === "PRD-001"))
            .sort((left, right) => left.product_id.localeCompare(right.product_id, "en", { numeric: true }));
          if (!products.length) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_STOCK_EXHAUSTED", `Tidak ada stok layak jual untuk membuat transaksi ${branch.branchId} pada ${date}.`);
          const lineCount = Math.min(requestedLineCount, products.length);
          while (items.length < lineCount) {
            const product = products[productCursor % products.length];
            productCursor += 1;
            if (selected.has(product.product_id)) continue;
            selected.add(product.product_id);
            const quantity = transactionIndex % 9 === 0 && items.length === 0 ? 2 : 1;
            items.push({ productId: product.product_id, quantity });
          }
          const quote = pos.quoteCart({ branchId: branch.branchId, items });
          const tender = Math.ceil(quote.net_total_idr / 10000) * 10000;
          const key = `PRESENTATION-SALE-${branch.code}-${date.replaceAll("-", "")}-${String(ordinal).padStart(2, "0")}`;
          const result = pos.checkout({
            branchId: branch.branchId,
            items,
            tenderedAmountIdr: tender,
            idempotencyKey: key,
            expectedFingerprint: quote.checkoutFingerprint,
            cashierId: cashier.user_id,
          });
          if (result.isDuplicate) throw new PresentationSalesProvisioningError("PRESENTATION_SALES_DUPLICATE", `Checkout simulasi ${key} menemukan transaksi yang sudah ada.`);
          ids.sales.push(result.sale.sale_id);
        }
        context.at = new Date(plan.closeAt);
        const closePreview = pos.previewShiftClose({ shiftId: shift.shift_id, physicalCashIdr: currentState.cashShifts.find((item) => item.shift_id === shift.shift_id).opening_cash_idr + currentState.cashMovements.filter((movement) => movement.shift_id === shift.shift_id).reduce((sum, movement) => sum + movement.amount_idr, 0), cashierId: cashier.user_id });
        pos.closeShift({
          shiftId: shift.shift_id,
          physicalCashIdr: closePreview.expected_cash_idr,
          cashierId: cashier.user_id,
          previewExpectedCashIdr: closePreview.expected_cash_idr,
          previewDifferenceIdr: closePreview.cash_difference_idr,
        });
    }
    delete currentState.meta.presentation_sales_seed_notice;
    currentState.meta[PRESENTATION_SALES_MARKER] = PRESENTATION_SALES_VERSION;
    currentState.meta[PRESENTATION_SALES_MANIFEST] = {
      version: PRESENTATION_SALES_VERSION,
      sale_ids: ids.sales,
      shift_ids: ids.shifts,
      date_from: prepared.window.from,
      date_to: prepared.window.to,
      transaction_count: ids.sales.length,
      estimated_units: ids.sales.reduce((total, saleId) => {
        const sale = currentState.sales.find((item) => item.sale_id === saleId);
        return total + (sale?.items ?? []).reduce((sum, item) => sum + item.quantity, 0);
      }, 0),
      generated_at: prepared.schedule.reduce((latest, entry) => entry.closeAt > latest ? entry.closeAt : latest, prepared.schedule[0].closeAt),
    };
    try {
      validateDemoState(currentState);
      this.repository.commit(currentState);
      if (expectedPreviewToken !== undefined) this.previewPlans.delete(expectedPreviewToken);
    } catch (error) {
      throw new PresentationSalesProvisioningError("PRESENTATION_SALES_COMMIT_FAILED", "Dataset transaksi gagal disimpan. Periksa kapasitas penyimpanan; state sebelumnya tetap dipertahankan.", error);
    }
    return { alreadyProvisioned: false, addedTransactionCount: ids.sales.length, addedShiftCount: ids.shifts.length, state: currentState };
  }
}

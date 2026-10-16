import { createInventoryRepository } from "../repositories/inventory-repository.js";
import { InventoryService } from "./inventory-service.js";

const TIME_ZONE = "Asia/Jakarta";

export class ReportingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReportingError";
    this.code = code;
  }
}

function validDateOnly(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function safeAdd(left, right) {
  const sum = left + Number(right ?? 0);
  if (!Number.isSafeInteger(sum)) throw new ReportingError("REPORT_TOTAL_UNSAFE", "Total laporan melampaui batas integer aman.");
  return sum;
}

function blankMetrics() {
  return { grossSalesIdr: 0, discountIdr: 0, netSalesIdr: 0, transactionCount: 0, unitsSold: 0 };
}

function addSale(metrics, sale) {
  metrics.grossSalesIdr = safeAdd(metrics.grossSalesIdr, sale.gross_total_idr);
  metrics.discountIdr = safeAdd(metrics.discountIdr, sale.discount_total_idr);
  metrics.netSalesIdr = safeAdd(metrics.netSalesIdr, sale.net_total_idr);
  metrics.transactionCount = safeAdd(metrics.transactionCount, 1);
  for (const item of sale.items ?? []) metrics.unitsSold = safeAdd(metrics.unitsSold, item.quantity);
  return metrics;
}

function compare(left, right) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), "id-ID", { numeric: true, sensitivity: "base" });
}

function sorted(rows, sortBy, direction = "desc") {
  const sign = direction === "asc" ? 1 : -1;
  return rows.sort((a, b) => compare(a[sortBy], b[sortBy]) * sign || compare(a.label, b.label));
}

function csvCell(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  let text = String(value ?? "");
  // Spreadsheet formula injection protection for text snapshots and labels.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function serializeReportCsv(headers, rows) {
  return [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n");
}

function emptyAggregate(label, key) {
  return { key, label, ...blankMetrics() };
}

export class ReportingService {
  constructor({ repository, inventoryService = null } = {}) {
    if (!repository || typeof repository.load !== "function" || typeof repository.commit !== "function") {
      throw new TypeError("ReportingService membutuhkan repository demo yang mendukung load dan commit.");
    }
    this.repository = repository;
    this.inventoryService = inventoryService ?? new InventoryService({
      repository: createInventoryRepository({ repository }),
    });
  }

  getReferenceDate() {
    return this.repository.load().meta.reference_date;
  }

  getReport({ branchId = "all", dateFrom = "", dateTo = "" } = {}) {
    if (!validDateOnly(dateFrom) || !validDateOnly(dateTo)) {
      throw new ReportingError("REPORT_DATE_INVALID", "Tanggal laporan harus berupa tanggal kalender YYYY-MM-DD yang valid.");
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new ReportingError("REPORT_RANGE_INVALID", "Tanggal awal tidak boleh lebih besar dari tanggal akhir.");
    }

    const state = this.repository.load();
    const branches = state.branches ?? [];
    if (branchId !== "all" && !branches.some((branch) => branch.branch_id === branchId)) {
      throw new ReportingError("REPORT_BRANCH_INVALID", "Cabang laporan tidak ditemukan.");
    }
    const branchById = new Map(branches.map((branch) => [branch.branch_id, branch]));
    const sales = (state.sales ?? []).filter((sale) => sale.status === "completed"
      && (branchId === "all" || sale.branch_id === branchId)
      && (!dateFrom || sale.effective_date >= dateFrom)
      && (!dateTo || sale.effective_date <= dateTo));

    const summary = sales.reduce(addSale, blankMetrics());
    const daily = new Map();
    const products = new Map();
    const byBranch = new Map();
    for (const sale of sales) {
      const day = daily.get(sale.effective_date) ?? emptyAggregate(sale.effective_date, sale.effective_date);
      addSale(day, sale);
      daily.set(sale.effective_date, day);

      const branch = branchById.get(sale.branch_id);
      const branchRow = byBranch.get(sale.branch_id) ?? emptyAggregate(branch?.name ?? sale.branch_id, sale.branch_id);
      addSale(branchRow, sale);
      byBranch.set(sale.branch_id, branchRow);

      for (const item of sale.items ?? []) {
        const productKey = `${item.product_id ?? item.sku_snapshot}\u0000${item.sku_snapshot}\u0000${item.name_snapshot}`;
        const product = products.get(productKey) ?? {
          ...emptyAggregate(item.name_snapshot, productKey),
          productId: item.product_id ?? "",
          sku: item.sku_snapshot ?? "",
          name: item.name_snapshot ?? "Produk snapshot",
          grossSalesIdr: 0,
          discountIdr: 0,
          netSalesIdr: 0,
          transactionCount: 0,
          unitsSold: 0,
        };
        product.grossSalesIdr = safeAdd(product.grossSalesIdr, item.regular_line_total_idr);
        product.discountIdr = safeAdd(product.discountIdr, item.discount_total_idr);
        product.netSalesIdr = safeAdd(product.netSalesIdr, item.final_line_total_idr);
        product.unitsSold = safeAdd(product.unitsSold, item.quantity);
        product.transactionCount = safeAdd(product.transactionCount, 1);
        products.set(productKey, product);
      }
    }

    const matchedSaleIds = new Set(sales.map((sale) => sale.sale_id));
    const cashMovements = (state.cashMovements ?? []).filter((movement) => matchedSaleIds.has(movement.sale_id));
    const cashMovementSummary = {
      confirmedCount: cashMovements.length,
      netCashIdr: cashMovements.reduce((total, movement) => safeAdd(total, movement.amount_idr), 0),
    };

    const coverageReferenceDate = state.meta?.catalog_coverage_stock_manifest_v1?.effective_date;
    const stockReferenceDate = coverageReferenceDate && coverageReferenceDate > state.meta.reference_date
      ? coverageReferenceDate
      : state.meta.reference_date;
    const stockBranches = branches.filter((branch) => branch.status === "active"
      && (branchId === "all" || branch.branch_id === branchId));
    const stockByBranch = stockBranches.map((branch) => {
      const warehouse = (state.warehouses ?? []).find((item) => item.branch_id === branch.branch_id
        && item.warehouse_type === "BRANCH" && item.status === "active");
      const workspace = warehouse
        ? this.inventoryService.getWorkspace({ warehouseId: warehouse.warehouse_id, effectiveDate: stockReferenceDate })
        : { summary: { physical: 0, sellable: 0, quarantine: 0, damaged: 0, expired: 0, inTransit: 0 } };
      return { branchId: branch.branch_id, branchName: branch.name, warehouseId: warehouse?.warehouse_id ?? "", ...workspace.summary };
    });
    const stockSummary = stockByBranch.reduce((total, row) => {
      for (const key of ["physical", "sellable", "quarantine", "damaged", "expired", "inTransit"]) total[key] = safeAdd(total[key] ?? 0, row[key] ?? 0);
      return total;
    }, { physical: 0, sellable: 0, quarantine: 0, damaged: 0, expired: 0, inTransit: 0 });

    return {
      timezone: TIME_ZONE,
      filters: { branchId, dateFrom, dateTo },
      summary,
      dailyRows: sorted([...daily.values()], "key", "asc"),
      productRows: sorted([...products.values()], "name", "asc"),
      branchRows: sorted([...byBranch.values()], "label", "asc"),
      sales: sales.map((sale) => ({
        saleId: sale.sale_id,
        transactionNumber: sale.transaction_number,
        branchId: sale.branch_id,
        branchName: branchById.get(sale.branch_id)?.name ?? sale.branch_id,
        effectiveDate: sale.effective_date,
        grossSalesIdr: sale.gross_total_idr,
        discountIdr: sale.discount_total_idr,
        netSalesIdr: sale.net_total_idr,
        unitsSold: (sale.items ?? []).reduce((total, item) => safeAdd(total, item.quantity), 0),
        itemSnapshots: (sale.items ?? []).map((item) => ({ ...item })),
      })),
      cashMovementSummary,
      stockReferenceDate,
      stockSummary,
      stockByBranch,
    };
  }

  exportCsv({ groupBy = "day", sortBy = "netSalesIdr", sortDirection = "desc", ...filters } = {}) {
    const report = this.getReport(filters);
    const definitions = {
      day: {
        headers: ["Tanggal Efektif", "Transaksi", "Unit", "Omzet Kotor (IDR)", "Diskon (IDR)", "Omzet Bersih (IDR)"],
        rows: report.dailyRows.map((row) => [row.label, row.transactionCount, row.unitsSold, row.grossSalesIdr, row.discountIdr, row.netSalesIdr]),
        sortKey: { date: "key", name: "key", transactions: "transactionCount", units: "unitsSold", net: "netSalesIdr", gross: "grossSalesIdr" },
      },
      product: {
        headers: ["SKU Snapshot", "Nama Produk Snapshot", "Transaksi-Baris", "Unit", "Omzet Kotor (IDR)", "Diskon (IDR)", "Omzet Bersih (IDR)"],
        rows: report.productRows.map((row) => [row.sku, row.name, row.transactionCount, row.unitsSold, row.grossSalesIdr, row.discountIdr, row.netSalesIdr]),
        sortKey: { name: "name", transactions: "transactionCount", units: "unitsSold", net: "netSalesIdr", gross: "grossSalesIdr" },
      },
      branch: {
        headers: ["Cabang", "Transaksi", "Unit", "Omzet Kotor (IDR)", "Diskon (IDR)", "Omzet Bersih (IDR)"],
        rows: report.branchRows.map((row) => [row.label, row.transactionCount, row.unitsSold, row.grossSalesIdr, row.discountIdr, row.netSalesIdr]),
        sortKey: { name: "label", transactions: "transactionCount", units: "unitsSold", net: "netSalesIdr", gross: "grossSalesIdr" },
      },
    };
    const definition = definitions[groupBy] ?? definitions.day;
    const key = definition.sortKey[sortBy] ?? "netSalesIdr";
    const sourceRows = groupBy === "product" ? report.productRows : groupBy === "branch" ? report.branchRows : report.dailyRows;
    const direction = sortDirection === "asc" ? "asc" : "desc";
    const ordered = sorted([...sourceRows], key, direction);
    const rows = ordered.map((record) => {
      if (groupBy === "product") return [record.sku, record.name, record.transactionCount, record.unitsSold, record.grossSalesIdr, record.discountIdr, record.netSalesIdr];
      if (groupBy === "branch") return [record.label, record.transactionCount, record.unitsSold, record.grossSalesIdr, record.discountIdr, record.netSalesIdr];
      return [record.label, record.transactionCount, record.unitsSold, record.grossSalesIdr, record.discountIdr, record.netSalesIdr];
    });
    return `\uFEFF${serializeReportCsv(definition.headers, rows)}`;
  }
}

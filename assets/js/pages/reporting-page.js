import { createLocalStorageRepository } from "../repositories/local-storage-repository.js";
import { ReportingError, ReportingService } from "../services/reporting-service.js";
import { showToast } from "../components.js";

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" });
export const DASHBOARD_DAILY_TREND_MAX_DAYS = 366;
const millisecondsPerDay = 24 * 60 * 60 * 1000;

function formatMoney(value) { return money.format(value).replace(/\s/g, ""); }
function displayDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.valueOf()) ? value : dateFormatter.format(date);
}
function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function node(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}
function inValidRange(from, to) { return !(from && to && from > to); }
export function buildDashboardTrendDates({ dateFrom, dateTo, observedDates = [], fallbackDate = "" }) {
  const sortedObservedDates = [...observedDates].sort();
  const firstObserved = sortedObservedDates[0];
  const lastObserved = sortedObservedDates.at(-1);
  const start = dateFrom || (dateTo ? (firstObserved && firstObserved < dateTo ? firstObserved : dateTo) : firstObserved || fallbackDate);
  const end = dateTo || (dateFrom ? (lastObserved && lastObserved > dateFrom ? lastObserved : dateFrom) : lastObserved || fallbackDate);
  if (!start || !end || start > end) return { dates: [], truncated: false, selectedDayCount: 0 };

  const startTime = Date.parse(`${start}T12:00:00.000Z`);
  const endTime = Date.parse(`${end}T12:00:00.000Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return { dates: [], truncated: false, selectedDayCount: 0 };
  }
  const selectedDayCount = Math.floor((endTime - startTime) / millisecondsPerDay) + 1;
  const truncated = selectedDayCount > DASHBOARD_DAILY_TREND_MAX_DAYS;
  const boundedStart = truncated ? addDays(end, -(DASHBOARD_DAILY_TREND_MAX_DAYS - 1)) : start;

  const dates = [];
  const renderedDayCount = Math.min(selectedDayCount, DASHBOARD_DAILY_TREND_MAX_DAYS);
  for (let offset = 0; offset < renderedDayCount; offset += 1) dates.push(addDays(boundedStart, offset));
  return { dates, truncated, selectedDayCount };
}
function safeSort(rows, key, direction) {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = left[key] ?? "";
    const b = right[key] ?? "";
    const result = typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), "id-ID", { numeric: true, sensitivity: "base" });
    return result * factor;
  });
}

export function initializeReportingPages({ repository = createLocalStorageRepository(), service = null } = {}) {
  const dashboard = document.querySelector('#overview[data-page-view="overview"]');
  const reports = document.querySelector('#reports[data-page-view="reports"]');
  if (!dashboard || !reports) return null;
  const reporting = service ?? new ReportingService({ repository });
  const state = repository.load();
  const allSales = reporting.getReport().sales;
  const latestEffectiveDate = allSales.reduce((latest, sale) => sale.effectiveDate > latest ? sale.effectiveDate : latest, state.meta.reference_date);
  const defaultFrom = addDays(latestEffectiveDate, -6);

  function fillBranches(select) {
    for (const branch of state.branches.filter((item) => item.status === "active")) {
      const option = node("option", "", branch.name);
      option.value = branch.branch_id;
      select.append(option);
    }
  }

  const dashboardBranch = dashboard.querySelector("#dashboard-branch");
  const dashboardFrom = dashboard.querySelector("#dashboard-date-from");
  const dashboardTo = dashboard.querySelector("#dashboard-date-to");
  const dashboardError = dashboard.querySelector("#dashboard-date-error");
  fillBranches(dashboardBranch);
  dashboardFrom.value = defaultFrom;
  dashboardTo.value = latestEffectiveDate;

  const reportBranch = reports.querySelector("#report-branch");
  const reportFrom = reports.querySelector("#report-date-from");
  const reportTo = reports.querySelector("#report-date-to");
  const reportGroup = reports.querySelector("#report-group");
  const reportSort = reports.querySelector("#report-sort");
  const reportError = reports.querySelector("#report-date-error");
  fillBranches(reportBranch);
  reportFrom.value = defaultFrom;
  reportTo.value = latestEffectiveDate;

  function showSummary(prefix, summary) {
    const container = prefix === "dashboard" ? dashboard : reports;
    container.querySelector(`#${prefix}-gross`).textContent = formatMoney(summary.grossSalesIdr);
    container.querySelector(`#${prefix}-discount`).textContent = formatMoney(summary.discountIdr);
    container.querySelector(`#${prefix}-net`).textContent = formatMoney(summary.netSalesIdr);
    container.querySelector(`#${prefix}-transactions`).textContent = integer.format(summary.transactionCount);
    container.querySelector(`#${prefix}-units`).textContent = integer.format(summary.unitsSold);
  }

  function clearDashboardSales() {
    showSummary("dashboard", { grossSalesIdr: 0, discountIdr: 0, netSalesIdr: 0, transactionCount: 0, unitsSold: 0 });
    const trend = dashboard.querySelector("#dashboard-trend");
    trend.replaceChildren();
    trend.setAttribute("aria-label", "Grafik tidak tersedia karena rentang tanggal tidak valid.");
    const trendRangeNote = dashboard.querySelector("#dashboard-trend-range-note");
    trendRangeNote.hidden = true;
    trendRangeNote.textContent = "";
    dashboard.querySelector("#dashboard-sales-empty").hidden = true;
    dashboard.querySelector("#dashboard-recent-empty").hidden = true;
    dashboard.querySelector("#dashboard-recent-body").replaceChildren();
  }

  function showDashboard() {
    const valid = inValidRange(dashboardFrom.value, dashboardTo.value);
    dashboardFrom.setAttribute("aria-invalid", String(!valid));
    dashboardTo.setAttribute("aria-invalid", String(!valid));
    dashboardError.hidden = valid;
    dashboardError.textContent = valid ? "" : "Tanggal awal tidak boleh lebih besar dari tanggal akhir.";
    if (!valid) {
      clearDashboardSales();
      return;
    }
    try {
      const result = reporting.getReport({ branchId: dashboardBranch.value, dateFrom: dashboardFrom.value, dateTo: dashboardTo.value });
      showSummary("dashboard", result.summary);
      const trend = dashboard.querySelector("#dashboard-trend");
      trend.replaceChildren();
      const dayMap = new Map(result.dailyRows.map((row) => [row.key, row.netSalesIdr]));
      const trendWindow = buildDashboardTrendDates({
        dateFrom: dashboardFrom.value,
        dateTo: dashboardTo.value,
        observedDates: result.dailyRows.map((row) => row.key),
        fallbackDate: latestEffectiveDate,
      });
      const { dates, truncated, selectedDayCount } = trendWindow;
      const trendRangeNote = dashboard.querySelector("#dashboard-trend-range-note");
      trendRangeNote.hidden = !truncated;
      trendRangeNote.textContent = truncated
        ? `Grafik harian menampilkan ${integer.format(DASHBOARD_DAILY_TREND_MAX_DAYS)} hari terakhir dari ${integer.format(selectedDayCount)} hari terpilih. KPI, Laporan, dan ekspor CSV tetap menggunakan seluruh rentang.`
        : "";
      const max = dates.reduce((currentMax, date) => Math.max(currentMax, dayMap.get(date) ?? 0), 0);
      const trendDescription = truncated
        ? `Tren omzet bersih harian, ${DASHBOARD_DAILY_TREND_MAX_DAYS} hari terakhir dari ${selectedDayCount} hari terpilih`
        : `Tren omzet bersih harian untuk ${dates.length} hari pada rentang terpilih`;
      trend.setAttribute("aria-label", `${trendDescription}: ${dates.map((date) => `${displayDate(date)} ${formatMoney(dayMap.get(date) ?? 0)}`).join("; ")}`);
      for (const date of dates) {
        const value = dayMap.get(date) ?? 0;
        const item = node("div", "report-chart__item");
        const amount = node("strong", "", formatMoney(value));
        const track = node("span", "report-chart__track");
        const bar = node("span", "report-chart__bar");
        bar.style.width = `${max ? Math.max(2, (value / max) * 100) : 0}%`;
        if (!value) bar.style.width = "0%";
        track.append(bar);
        item.append(node("span", "report-chart__date", displayDate(date)), track, amount);
        trend.append(item);
      }
      dashboard.querySelector("#dashboard-sales-empty").hidden = result.summary.transactionCount > 0;
      dashboard.querySelector("#dashboard-recent-empty").hidden = result.sales.length > 0;
      const recentBody = dashboard.querySelector("#dashboard-recent-body");
      recentBody.replaceChildren();
      result.sales.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.transactionNumber.localeCompare(a.transactionNumber))
        .slice(0, 5).forEach((sale) => {
          const row = node("tr");
          row.append(node("th", "", sale.transactionNumber), node("td", "", displayDate(sale.effectiveDate)), node("td", "", sale.branchName), node("td", "", integer.format(sale.unitsSold)), node("td", "report-money", formatMoney(sale.netSalesIdr)));
          recentBody.append(row);
        });
      dashboard.querySelector("#dashboard-stock-date").textContent = `Stok per ${displayDate(result.stockReferenceDate)} · Asia/Jakarta`;
      dashboard.querySelector("#dashboard-stock-sellable").textContent = integer.format(result.stockSummary.sellable);
      dashboard.querySelector("#dashboard-stock-physical").textContent = integer.format(result.stockSummary.physical);
      dashboard.querySelector("#dashboard-stock-held").textContent = integer.format(result.stockSummary.quarantine + result.stockSummary.damaged);
      dashboard.querySelector("#dashboard-stock-expired").textContent = integer.format(result.stockSummary.expired);
    } catch (error) {
      clearDashboardSales();
      showToast(error.message || "Dashboard tidak dapat dimuat.", "error");
    }
  }

  function rowsFor(result, group) {
    if (group === "product") return result.productRows;
    if (group === "branch") return result.branchRows;
    return result.dailyRows;
  }

  function renderReport() {
    const valid = inValidRange(reportFrom.value, reportTo.value);
    reportFrom.setAttribute("aria-invalid", String(!valid));
    reportTo.setAttribute("aria-invalid", String(!valid));
    reportError.hidden = valid;
    reportError.textContent = valid ? "" : "Tanggal awal tidak boleh lebih besar dari tanggal akhir.";
    const tableHead = reports.querySelector("#report-table-head");
    const tableBody = reports.querySelector("#report-table-body");
    tableHead.replaceChildren();
    tableBody.replaceChildren();
    if (!valid) {
      showSummary("report", { grossSalesIdr: 0, discountIdr: 0, netSalesIdr: 0, transactionCount: 0, unitsSold: 0 });
      reports.querySelector("#report-empty").hidden = true;
      reports.querySelector("#report-row-count").textContent = "Rentang tidak valid";
      return;
    }
    try {
      const result = reporting.getReport({ branchId: reportBranch.value, dateFrom: reportFrom.value, dateTo: reportTo.value });
      showSummary("report", result.summary);
      const group = reportGroup.value;
      const [sortName, sortDirection] = reportSort.value.split(":");
      const numericSort = { net: "netSalesIdr", transactions: "transactionCount", units: "unitsSold" };
      const sortKey = numericSort[sortName] ?? (group === "day" ? "key" : group === "product" ? "name" : "label");
      const rows = safeSort(rowsFor(result, group), sortKey, sortDirection);
      const headers = group === "product"
        ? ["Produk", "Baris transaksi", "Unit", "Omzet kotor", "Diskon", "Omzet bersih"]
        : group === "branch"
          ? ["Cabang", "Transaksi", "Unit", "Omzet kotor", "Diskon", "Omzet bersih"]
          : ["Tanggal efektif", "Transaksi", "Unit", "Omzet kotor", "Diskon", "Omzet bersih"];
      const headerRow = node("tr");
      headers.forEach((label) => headerRow.append(node("th", "", label)));
      tableHead.append(headerRow);
      for (const record of rows) {
        const row = node("tr");
        const first = group === "day" ? displayDate(record.label)
          : group === "branch" ? record.label
            : `${record.name} · ${record.sku}`;
        const values = group === "product"
          ? [first, integer.format(record.transactionCount), integer.format(record.unitsSold), formatMoney(record.grossSalesIdr), formatMoney(record.discountIdr), formatMoney(record.netSalesIdr)]
          : [first, integer.format(record.transactionCount), integer.format(record.unitsSold), formatMoney(record.grossSalesIdr), formatMoney(record.discountIdr), formatMoney(record.netSalesIdr)];
        values.forEach((value, index) => row.append(node(index > 1 ? "td" : "th", index > 2 ? "report-money" : "", value)));
        tableBody.append(row);
      }
      reports.querySelector("#report-table-title").textContent = `Rekap per ${group === "day" ? "hari" : group === "product" ? "produk" : "cabang"}`;
      reports.querySelector("#report-row-count").textContent = `${integer.format(rows.length)} baris`;
      reports.querySelector("#report-empty").hidden = result.summary.transactionCount > 0;
      reports.querySelector("#report-source-note").textContent = `Mutasi kas terkonfirmasi ${formatMoney(result.cashMovementSummary.netCashIdr)} dalam ${integer.format(result.cashMovementSummary.confirmedCount)} catatan disajikan terpisah dan tidak ditambahkan ke omzet. Stok Dashboard memakai tanggal acuan ${displayDate(result.stockReferenceDate)} · Asia/Jakarta, independen dari rentang laporan. Retur/refund tidak termasuk lingkup laporan ini.`;
    } catch (error) {
      reports.querySelector("#report-empty").hidden = true;
      reports.querySelector("#report-row-count").textContent = "Laporan gagal dimuat";
      showToast(error.message || "Laporan tidak dapat dimuat.", "error");
    }
  }

  function exportReport() {
    if (!inValidRange(reportFrom.value, reportTo.value)) {
      showToast("Perbaiki rentang tanggal sebelum mengekspor laporan.", "warning");
      reportFrom.focus();
      return;
    }
    try {
      const [sort, direction] = reportSort.value.split(":");
      const csv = reporting.exportCsv({ branchId: reportBranch.value, dateFrom: reportFrom.value, dateTo: reportTo.value, groupBy: reportGroup.value, sortBy: sort, sortDirection: direction });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = node("a");
      link.href = url;
      link.download = `laporan-penjualan-${reportFrom.value || "semua"}-${reportTo.value || "semua"}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("CSV laporan berhasil disiapkan sesuai filter aktif.", "success");
    } catch (error) {
      showToast(error.message || "CSV gagal dibuat.", "error");
    }
  }

  [dashboardBranch, dashboardFrom, dashboardTo].forEach((input) => input.addEventListener("change", showDashboard));
  [reportBranch, reportFrom, reportTo, reportGroup, reportSort].forEach((input) => input.addEventListener("change", renderReport));
  reports.querySelector("#report-export").addEventListener("click", exportReport);
  document.addEventListener("app:routechange", (event) => {
    if (event.detail?.route === "overview") showDashboard();
    if (event.detail?.route === "reports") renderReport();
  });
  showDashboard();
  renderReport();
  return { service: reporting, refresh: () => { showDashboard(); renderReport(); } };
}

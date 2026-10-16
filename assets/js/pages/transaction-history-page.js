import { createLocalStorageRepository } from "../repositories/local-storage-repository.js";
import { TransactionService } from "../services/transaction-service.js";
import { showToast } from "../components.js";

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

function formatMoney(value) { return money.format(value).replace(/\s/g, ""); }
function formatDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "—" : dateTime.format(parsed);
}
function node(tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined && text !== null) item.textContent = text;
  return item;
}
function moneyRow(container, label, value) {
  const row = node("div", "m6-detail-total");
  row.append(node("dt", "", label), node("dd", "", formatMoney(value)));
  container.append(row);
}

export function isDateRangeValid(dateFrom, dateTo) {
  return !(dateFrom && dateTo && dateFrom > dateTo);
}

export function initializeTransactionHistoryPage({ repository = createLocalStorageRepository(), authService = null } = {}) {
  const page = document.querySelector("#transactions[data-page-view]");
  if (!page) return null;
  const service = new TransactionService({ repository });
  let branchScopeId = authService?.getSession()?.user?.role === "CASHIER"
    ? authService.getSession().user.branch_id
    : null;
  const search = page.querySelector("#transaction-search");
  const branch = page.querySelector("#transaction-branch");
  const from = page.querySelector("#transaction-date-from");
  const to = page.querySelector("#transaction-date-to");
  const status = page.querySelector("#transaction-status");
  const sort = page.querySelector("#transaction-sort");
  const body = page.querySelector("#transaction-table-body");
  const count = page.querySelector("#transaction-count");
  const empty = page.querySelector("#transaction-empty");
  const dateError = page.querySelector("#transaction-date-error");
  const detailDialog = document.querySelector("#transaction-detail-dialog");
  const detailContent = document.querySelector("#transaction-detail-content");
  const reprintButton = document.querySelector("#transaction-reprint");
  const receiptDialog = document.querySelector("#transaction-receipt-dialog");
  let currentPage = 1;
  let currentDetail = null;
  let lastPageCount = 0;

  function fillBranches() {
    branch.replaceChildren();
    if (!branchScopeId) {
      const allBranches = node("option", "", "Semua cabang");
      allBranches.value = "all";
      branch.append(allBranches);
    }
    const state = repository.load();
    for (const item of state.branches.filter((candidate) => !branchScopeId || candidate.branch_id === branchScopeId)) {
      const option = node("option", "", item.name);
      option.value = item.branch_id;
      branch.append(option);
    }
    branch.value = branchScopeId ?? "all";
    branch.disabled = Boolean(branchScopeId);
  }

  function getQuery() {
    const [sortBy, sortDirection] = sort.value.split(":");
    return { query: search.value, branchId: branchScopeId ?? branch.value, dateFrom: from.value, dateTo: to.value, status: status.value, sortBy, sortDirection, page: currentPage, pageSize: 10 };
  }

  function render() {
    body.replaceChildren();
    const validDateRange = isDateRangeValid(from.value, to.value);
    from.setAttribute("aria-invalid", String(!validDateRange));
    to.setAttribute("aria-invalid", String(!validDateRange));
    dateError.hidden = validDateRange;
    if (!validDateRange) {
      lastPageCount = 0;
      count.textContent = "Rentang tanggal tidak valid";
      dateError.textContent = "Tanggal awal tidak boleh lebih besar dari tanggal akhir.";
      empty.hidden = false;
      empty.querySelector("h3").textContent = "Rentang tanggal tidak valid";
      empty.querySelector("p").textContent = "Perbaiki tanggal mulai atau tanggal akhir untuk melihat riwayat.";
      page.querySelector("#transaction-page-label").textContent = "Rentang tanggal tidak valid";
      page.querySelector("#transaction-page-prev").disabled = true;
      page.querySelector("#transaction-page-next").disabled = true;
      return;
    }
    dateError.textContent = "";
    try {
      const result = service.list(getQuery());
      lastPageCount = result.pageCount;
      count.textContent = `${integer.format(result.total)} transaksi ditemukan`;
      empty.hidden = result.total > 0;
      empty.querySelector("h3").textContent = "Tidak ada transaksi";
      empty.querySelector("p").textContent = "Ubah pencarian atau filter. Transaksi selesai akan muncul di sini.";
      for (const { sale, payment, branch: saleBranch } of result.rows) {
        const row = node("tr");
        const idCell = node("td", "m6-transaction-id");
        idCell.append(node("strong", "", sale.transaction_number), node("small", "", `${formatDate(sale.created_at)} · ${sale.effective_date}`));
        if (sale.simulation_dataset_id) idCell.append(node("span", "badge badge--neutral", "Simulasi presentasi"));
        const itemCell = node("td", "m6-transaction-items");
        itemCell.append(node("strong", "", sale.items.map((item) => item.name_snapshot).join(", ")));
        itemCell.append(node("small", "", sale.items.map((item) => `${item.sku_snapshot} × ${integer.format(item.quantity)}`).join(" · ")));
        row.append(idCell, node("td", "", saleBranch?.name ?? sale.branch_id), itemCell, node("td", "m6-money", formatMoney(sale.net_total_idr)), node("td", "", payment?.status === "confirmed" ? "Tunai · terkonfirmasi" : "Pembayaran tidak tersedia"));
        const statusCell = node("td");
        statusCell.append(node("span", sale.status === "completed" ? "badge badge--success" : "badge badge--neutral", sale.status));
        statusCell.querySelector(".badge").textContent = sale.status === "completed" ? "Selesai" : sale.status;
        row.append(statusCell);
        const actionCell = node("td");
        const detailButton = node("button", "button button--quiet m6-detail-button", "Detail");
        detailButton.type = "button";
        detailButton.dataset.transactionId = sale.sale_id;
        detailButton.setAttribute("aria-label", `Buka detail ${sale.transaction_number}`);
        actionCell.append(detailButton);
        row.append(actionCell);
        body.append(row);
      }
      page.querySelector("#transaction-page-label").textContent = result.total
        ? `Halaman ${result.page} dari ${result.pageCount}`
        : "Halaman 0 dari 0";
      page.querySelector("#transaction-page-prev").disabled = result.page <= 1;
      page.querySelector("#transaction-page-next").disabled = result.pageCount === 0 || result.page >= result.pageCount;
    } catch (error) {
      lastPageCount = 0;
      count.textContent = "Data transaksi tidak dapat dibaca";
      empty.hidden = false;
      empty.querySelector("h3").textContent = "Riwayat gagal dimuat";
      empty.querySelector("p").textContent = error.message || "Repository demo tidak dapat dibaca.";
      showToast("Riwayat transaksi gagal dimuat dari penyimpanan lokal.", "error");
    }
  }

  function renderDetail(detail) {
    const { sale, payment, branch: saleBranch, shift } = detail;
    detailContent.replaceChildren();
    const overview = node("dl", "m6-detail-grid");
    const pair = (label, value) => {
      const box = node("div");
      box.append(node("dt", "", label), node("dd", "", value));
      overview.append(box);
    };
    pair("Cabang", saleBranch?.name ?? sale.branch_id);
    pair("Nomor transaksi", sale.transaction_number);
    if (sale.simulation_dataset_id) pair("Asal data", "Transaksi simulasi untuk demonstrasi; bukan penjualan nyata.");
    pair("Waktu / tanggal efektif", `${formatDate(sale.created_at)} · ${sale.effective_date} (Asia/Jakarta)`);
    pair("Kasir / shift", `${sale.cashier_id} · ${shift?.shift_id ?? sale.shift_id}`);
    pair("Status transaksi", sale.status === "completed" ? "Selesai" : sale.status);
    detailContent.append(overview);

    const itemHeading = node("h3", "m6-detail-section-title", "Nilai item saat transaksi");
    detailContent.append(itemHeading);
    for (const item of sale.items) {
      const card = node("article", "m6-line-snapshot");
      const header = node("div", "m6-line-snapshot__heading");
      header.append(node("strong", "", `${item.name_snapshot} · ${item.sku_snapshot}`), node("strong", "", formatMoney(item.final_line_total_idr)));
      card.append(header);
      const facts = node("dl", "m6-detail-grid m6-detail-grid--compact");
      const fields = [
        ["Kuantitas", `${integer.format(item.quantity)} unit`],
        ["Harga dasar saat transaksi", formatMoney(item.base_price_snapshot_idr)],
        ["Aturan regional", `${item.price_rule_snapshot.price_rule_id} · v${item.price_rule_snapshot.version} · periode ${item.price_rule_snapshot.valid_from} s.d. ${item.price_rule_snapshot.valid_until ?? "tanpa batas"}`],
        ["Penyesuaian regional", `${item.regional_adjustment_percent}% · harga reguler ${formatMoney(item.regular_unit_price_idr)}/unit`],
        ["Subtotal / diskon", `${formatMoney(item.regular_line_total_idr)} / −${formatMoney(item.discount_total_idr)}`],
      ];
      for (const [label, value] of fields) {
        const part = node("div");
        part.append(node("dt", "", label), node("dd", "", value));
        facts.append(part);
      }
      card.append(facts);
      const batches = node("ul", "m6-allocation-list");
      for (const allocation of item.allocations) {
        batches.append(node("li", "", `${allocation.lot_number_snapshot} · ${integer.format(allocation.allocated_quantity)} unit · kedaluwarsa ${allocation.expiry_date_snapshot ?? "tidak berlaku"} · ${formatMoney(allocation.final_unit_price_idr)}/unit · diskon ${formatMoney(allocation.unit_discount_idr)}/unit`));
      }
      card.append(node("strong", "m6-inline-label", "Alokasi batch"), batches);
      detailContent.append(card);
    }

    const totals = node("dl", "m6-detail-totals");
    moneyRow(totals, "Harga reguler / gross", sale.gross_total_idr);
    moneyRow(totals, "Diskon saat transaksi", -sale.discount_total_idr);
    moneyRow(totals, "Total dibayar", sale.net_total_idr);
    if (payment) {
      moneyRow(totals, "Pembayaran tunai terkonfirmasi", payment.amount_idr);
      moneyRow(totals, "Tunai diterima", payment.received_amount_idr);
      moneyRow(totals, "Kembalian", payment.change_idr);
    }
    detailContent.append(totals);
    reprintButton.hidden = !(sale.status === "completed" && payment?.status === "confirmed");
  }

  function openReceipt() {
    if (!currentDetail || currentDetail.sale.status !== "completed" || currentDetail.payment?.status !== "confirmed") {
      showToast("Cetak ulang hanya tersedia untuk transaksi selesai dengan pembayaran terkonfirmasi.", "warning");
      return;
    }
    const { sale, payment, branch: saleBranch } = currentDetail;
    document.querySelector("#transaction-receipt-branch").textContent = saleBranch?.name ?? sale.branch_id;
    document.querySelector("#transaction-receipt-number").textContent = `${sale.transaction_number} · ${formatDate(sale.created_at)}`;
    document.querySelector("#transaction-receipt-status").textContent = sale.simulation_dataset_id
      ? "LUNAS · TUNAI SIMULASI · DATA PRESENTASI"
      : "LUNAS · TUNAI SIMULASI";
    const receiptItems = document.querySelector("#transaction-receipt-items");
    receiptItems.replaceChildren();
    for (const item of sale.items) {
      const row = node("div", "pos-receipt-item");
      const heading = node("div", "pos-receipt-item__heading");
      heading.append(node("strong", "", `${integer.format(item.quantity)} × ${item.name_snapshot}`), node("strong", "", formatMoney(item.final_line_total_idr)));
      row.append(heading);
      const allocations = node("ul");
      for (const allocation of item.allocations) allocations.append(node("li", "", `${integer.format(allocation.allocated_quantity)} × ${allocation.lot_number_snapshot} · ${formatMoney(allocation.final_unit_price_idr)}/unit${allocation.unit_discount_idr ? ` · diskon ${formatMoney(allocation.unit_discount_idr)}` : ""}`));
      row.append(allocations);
      receiptItems.append(row);
    }
    document.querySelector("#transaction-receipt-gross").textContent = formatMoney(sale.gross_total_idr);
    document.querySelector("#transaction-receipt-discount").textContent = `−${formatMoney(sale.discount_total_idr)}`;
    document.querySelector("#transaction-receipt-net").textContent = formatMoney(sale.net_total_idr);
    document.querySelector("#transaction-receipt-tender").textContent = formatMoney(payment.received_amount_idr);
    document.querySelector("#transaction-receipt-change").textContent = formatMoney(payment.change_idr);
    receiptDialog.dataset.receiptState = "completed";
    detailDialog.close();
    receiptDialog.showModal();
  }

  fillBranches();
  [search, branch, from, to, status, sort].forEach((control) => control.addEventListener(control === search ? "input" : "change", () => { currentPage = 1; render(); }));
  page.querySelector("#transaction-page-prev").addEventListener("click", () => { currentPage = Math.max(1, currentPage - 1); render(); });
  page.querySelector("#transaction-page-next").addEventListener("click", () => { currentPage = Math.min(lastPageCount, currentPage + 1); render(); });
  page.querySelector("#transaction-clear-filters").addEventListener("click", () => {
    search.value = ""; branch.value = branchScopeId ?? "all"; from.value = ""; to.value = ""; status.value = "all"; sort.value = "created_at:desc"; currentPage = 1; render();
  });
  body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-transaction-id]");
    if (!button) return;
    currentDetail = service.getDetail(button.dataset.transactionId);
    if (!currentDetail) { showToast("Data transaksi tidak ditemukan.", "error"); return; }
    renderDetail(currentDetail);
    detailDialog.showModal();
  });
  reprintButton.addEventListener("click", openReceipt);
  document.querySelector("#transaction-print-confirm").addEventListener("click", () => {
    if (receiptDialog.dataset.receiptState !== "completed" || currentDetail?.sale.status !== "completed") {
      showToast("Hanya struk transaksi selesai yang dapat dicetak.", "warning");
      return;
    }
    window.print();
  });
  document.querySelectorAll("[data-close-transaction-dialog]").forEach((button) => button.addEventListener("click", () => detailDialog.close()));
  document.querySelectorAll("[data-close-transaction-receipt]").forEach((button) => button.addEventListener("click", () => receiptDialog.close()));
  [detailDialog, receiptDialog].forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
  receiptDialog.addEventListener("close", () => { receiptDialog.dataset.receiptState = "none"; });
  window.addEventListener("hashchange", () => { if (window.location.hash === "#transactions") render(); });
  document.addEventListener("app:authchange", () => {
    const session = authService?.getSession();
    branchScopeId = session?.user?.role === "CASHIER" ? session.user.branch_id : null;
    fillBranches();
    currentPage = 1;
    render();
  });
  render();
  return { service, render, getCurrentDetail: () => currentDetail };
}

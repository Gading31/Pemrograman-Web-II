import { showToast } from "../components.js";
import { createDistributionRepository } from "../repositories/distribution-repository.js";
import { createInventoryRepository } from "../repositories/inventory-repository.js";
import { createLocalStorageRepository } from "../repositories/local-storage-repository.js";
import { DistributionError, DistributionService } from "../services/distribution-service.js";
import { InventoryService } from "../services/inventory-service.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const integer = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const statusLabels = {
  requested: "Diminta", approved: "Disetujui", partially_approved: "Disetujui sebagian", rejected: "Ditolak",
  allocated: "Draft alokasi", replaced: "Draft diganti", shipped: "Dikirim", in_transit: "Dalam transit", partially_received: "Diterima sebagian",
  received: "Diterima", reconciled: "Direkonsiliasi",
};
const bucketLabels = { AVAILABLE: "Layak jual", QUARANTINE: "Karantina", DAMAGED: "Rusak", EXPIRED: "Kedaluwarsa" };
const rootRepository = createLocalStorageRepository();
const inventoryService = new InventoryService({ repository: createInventoryRepository({ repository: rootRepository }) });
const service = new DistributionService({ repository: createDistributionRepository({ repository: rootRepository }), inventoryService });
const viewState = { workspace: null, selectedRequestId: null, busy: false, authService: null };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
function actor() {
  const user = viewState.authService?.getSession()?.user;
  const branches = viewState.workspace?.branches ?? [];
  if (user?.role === "CASHIER") {
    const branch = branches.find((item) => item.branch_id === user.branch_id);
    return branch ? { type: "branch", branchId: branch.branch_id, actorId: user.user_id, label: user.display_name } : { type: "branch", branchId: user.branch_id, actorId: user.user_id, label: user.display_name };
  }
  const selectedValue = $("#distribution-actor")?.value ?? "hq";
  const selectedBranch = branches.find((branch) => `branch-${branch.branch_id}` === selectedValue);
  const selected = selectedBranch
    ? { type: "branch", branchId: selectedBranch.branch_id, actorId: `DEMO-${selectedBranch.branch_id}`, label: `Petugas ${selectedBranch.name}` }
    : { type: "hq", branchId: null, actorId: "DEMO-HQ-001", label: "Admin Pusat (HQ)" };
  return user?.role === "HQ_ADMIN" && selected.type === "hq"
    ? { ...selected, actorId: user.user_id, label: user.display_name }
    : selected;
}
function dateTime(value) {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value));
}
function formatQuantity(value) { return integer.format(value ?? 0); }
function statusClass(status) {
  if (["received", "reconciled", "approved"].includes(status)) return "badge--success";
  if (["partially_received", "partially_approved", "in_transit", "shipped"].includes(status)) return "badge--warning";
  if (status === "rejected") return "badge--critical";
  return "badge--neutral";
}

function ensureRequestLine() {
  const container = $("#distribution-request-lines");
  const index = container.children.length;
  const options = (viewState.workspace?.products ?? []).filter((product) => product.status === "active")
    .map((product) => `<option value="${escapeHtml(product.product_id)}">${escapeHtml(product.sku)} · ${escapeHtml(product.name)}</option>`).join("");
  const row = document.createElement("div");
  row.className = "distribution-request-line";
  row.innerHTML = `<label class="field"><span class="field__label">Produk</span><select class="select-control" data-request-product aria-label="Produk pada baris ${index + 1}" required>${options}</select></label><label class="field"><span class="field__label">Jumlah unit</span><input class="form-control" data-request-quantity type="number" min="1" step="1" inputmode="numeric" value="1" aria-label="Jumlah unit baris ${index + 1}" required /></label><button class="icon-button distribution-remove-line" type="button" data-remove-request-line aria-label="Hapus baris produk ${index + 1}" title="Hapus baris">×</button>`;
  container.append(row);
}

function syncBranchOptions() {
  const branches = viewState.workspace?.branches ?? [];
  const requestBranch = $("#distribution-request-branch");
  const filterBranch = $("#distribution-filter-branch");
  const currentActor = actor();
  const actorSelector = $("#distribution-actor");
  actorSelector.disabled = viewState.authService?.getSession()?.user?.role === "CASHIER";
  const selectedActor = actorSelector.value || "hq";
  actorSelector.replaceChildren(
    ...branches.map((branch) => new Option(`Petugas ${branch.name}`, `branch-${branch.branch_id}`)),
    new Option("Admin Pusat (HQ)", "hq"),
  );
  actorSelector.value = [...actorSelector.options].some((option) => option.value === selectedActor) ? selectedActor : "hq";
  const currentFilter = filterBranch.value || "all";
  requestBranch.replaceChildren();
  const allowed = currentActor.type === "hq" ? branches : branches.filter((branch) => branch.branch_id === currentActor.branchId);
  allowed.forEach((branch) => {
    const option = document.createElement("option"); option.value = branch.branch_id; option.textContent = branch.name; requestBranch.append(option);
  });
  filterBranch.replaceChildren(new Option("Semua cabang", "all"));
  branches.forEach((branch) => filterBranch.add(new Option(branch.name, branch.branch_id)));
  filterBranch.value = [...filterBranch.options].some((option) => option.value === currentFilter) ? currentFilter : "all";
  $("#distribution-request-panel").hidden = currentActor.type === "hq";
  if (!$("#distribution-request-lines").children.length) ensureRequestLine();
}

function renderStockSummary() {
  const batches = viewState.workspace?.inventory?.batches ?? [];
  const effectiveDate = viewState.workspace?.inventory?.effectiveDate;
  if (effectiveDate) $("#distribution-stock-date").textContent = `Saldo ledger WH-HQ-01 · tanggal efektif ${effectiveDate} (Asia/Jakarta)`;
  const byProduct = new Map();
  for (const batch of batches) {
    const product = batch.product;
    if (!product) continue;
    const record = byProduct.get(product.product_id) ?? { product, quantity: 0 };
    record.quantity += batch.sellableQuantity;
    byProduct.set(product.product_id, record);
  }
  $("#distribution-stock-summary").innerHTML = byProduct.size
    ? [...byProduct.values()].map(({ product, quantity }) => `<div class="distribution-stock-item"><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)} · layak jual</small></span><b>${formatQuantity(quantity)} unit</b></div>`).join("")
    : `<div class="distribution-stock-empty">Belum ada stok layak jual pada gudang pusat.</div>`;
}

function renderList() {
  const currentActor = actor();
  const workspace = viewState.workspace;
  const filterBranch = $("#distribution-filter-branch").value || "all";
  const branchId = currentActor.type === "branch" ? currentActor.branchId : filterBranch;
  const requests = service.getWorkspace({
    branchId, status: $("#distribution-filter-status").value || "all", search: $("#distribution-search").value,
  }).requests.sort((left, right) => right.created_at.localeCompare(left.created_at));
  const body = $("#distribution-table-body");
  $("#distribution-count").textContent = `${formatQuantity(requests.length)} permintaan sesuai filter`;
  $("#distribution-empty").hidden = requests.length > 0;
  body.innerHTML = requests.map((request) => {
    const productLabels = request.items.map((item) => `${escapeHtml(item.sku_snapshot)} · ${formatQuantity(item.requested_quantity)} unit`).join("<br>");
    return `<tr><td class="distribution-document"><strong>${escapeHtml(request.request_id)}</strong><small>${dateTime(request.created_at)}</small></td><td>${escapeHtml(request.branch_name_snapshot)}</td><td class="distribution-products">${productLabels}</td><td><span class="badge ${statusClass(request.displayStatus)}">${statusLabels[request.displayStatus] ?? escapeHtml(request.displayStatus)}</span></td><td><button class="button button--secondary distribution-detail-button" type="button" data-distribution-open="${escapeHtml(request.request_id)}">Detail</button></td></tr>`;
  }).join("");
  if (viewState.selectedRequestId && !requests.some((item) => item.request_id === viewState.selectedRequestId)) {
    viewState.selectedRequestId = null;
  }
  renderDetail();
}

function latestApproval(request) {
  return [...(request.statusHistory ?? [])].reverse().find((event) => ["APPROVED", "PARTIALLY_APPROVED"].includes(event.event_type));
}

function renderApprovalForm(request) {
  const approval = latestApproval(request);
  const approvedByLine = new Map((approval?.details?.approved_lines ?? []).map((line) => [line.request_line_id, line.approved_quantity]));
  const lines = request.items.map((item) => `<label class="distribution-approval-line"><span><strong>${escapeHtml(item.product_name_snapshot)}</strong><small>${formatQuantity(item.requested_quantity)} unit diminta</small></span><input class="form-control" data-approve-line="${escapeHtml(item.request_line_id)}" type="number" min="0" max="${item.requested_quantity}" step="1" value="${approvedByLine.get(item.request_line_id) ?? item.requested_quantity}" aria-label="Jumlah disetujui ${escapeHtml(item.product_name_snapshot)}" /></label>`).join("");
  return `<form class="distribution-action-form" data-distribution-action="approve"><h3>Tinjau jumlah per produk</h3>${lines}<label class="field"><span class="field__label">Alasan keputusan</span><textarea class="form-control" name="reason" rows="2" maxlength="240" required placeholder="Catat dasar persetujuan atau alasan penolakan"></textarea></label><div class="distribution-action-buttons"><button class="button button--primary" name="decision" value="approve" type="submit">Setujui jumlah</button><button class="button button--secondary" name="decision" value="reject" type="submit">Tolak permintaan</button></div></form>`;
}

function renderAllocationForm() {
  return `<form class="distribution-action-form" data-distribution-action="allocate"><h3>Draft alokasi batch</h3><p>Inventory Service memilih lot layak jual menurut FEFO/FIFO. Draft ini belum memindahkan saldo.</p><label class="field"><span class="field__label">Catatan alokasi</span><textarea class="form-control" name="reason" rows="2" maxlength="240" required placeholder="Contoh: alokasi FEFO untuk permintaan yang disetujui"></textarea></label><button class="button button--primary" type="submit">Buat draft alokasi</button></form>`;
}

function renderReallocationForm(transfer) {
  return `<form class="distribution-action-form" data-distribution-action="reallocate"><h3>Alokasikan ulang draft</h3><p>Gunakan setelah dispatch menolak draft karena stok berubah. Alokasi dihitung ulang dari stok pusat terkini; draft lama tetap tercatat sebagai diganti.</p><label class="field"><span class="field__label">Alasan alokasi ulang</span><textarea class="form-control" name="reason" rows="2" maxlength="240" required placeholder="Contoh: draft ${escapeHtml(transfer.transfer_id)} stale setelah saldo berubah"></textarea></label><button class="button button--secondary" type="submit">Alokasikan Ulang</button></form>`;
}

function renderDispatchForm() {
  return `<form class="distribution-action-form" data-distribution-action="dispatch"><h3>Dispatch dari gudang pusat</h3><p>Konfirmasi pengiriman mengurangi saldo layak jual sumber dan menambah bucket transit dalam satu commit.</p><label class="field"><span class="field__label">Catatan pengiriman</span><textarea class="form-control" name="reason" rows="2" maxlength="240" required placeholder="Contoh: kendaraan demo berangkat ke cabang"></textarea></label><button class="button button--primary" type="submit">Catat dispatch</button></form>`;
}

function renderReceiptForm(transfer) {
  const currentActor = actor();
  if (currentActor.type !== "branch" || currentActor.branchId !== transfer.destination_branch_id) return `<p class="distribution-role-hint">Penerimaan hanya ditampilkan pada konteks demo cabang tujuan (${escapeHtml(transfer.destination_branch_name_snapshot)}).</p>`;
  const lines = transfer.lines.filter((line) => line.in_transit_quantity > 0).map((line) => `<div class="distribution-receipt-line"><div><strong>${escapeHtml(line.product_name_snapshot)}</strong><small>${escapeHtml(line.lot_number_snapshot)} · ${formatQuantity(line.in_transit_quantity)} unit masih transit</small></div><label class="field"><span class="field__label">Jumlah diterima</span><input class="form-control" data-receive-line="${escapeHtml(line.transfer_line_id)}" type="number" min="0" max="${line.in_transit_quantity}" step="1" inputmode="numeric" value="${line.in_transit_quantity}" required /></label><label class="field"><span class="field__label">Kondisi</span><select class="select-control" data-receive-condition="${escapeHtml(line.transfer_line_id)}"><option value="AVAILABLE">Layak jual</option><option value="QUARANTINE">Karantina</option><option value="DAMAGED">Rusak</option><option value="EXPIRED">Kedaluwarsa</option></select></label><label class="field distribution-reason-field"><span class="field__label">Alasan selisih (jika ada)</span><input class="form-control" data-receive-discrepancy="${escapeHtml(line.transfer_line_id)}" maxlength="240" placeholder="Wajib bila jumlah kurang" /></label></div>`).join("");
  return `<form class="distribution-action-form" data-distribution-action="receive"><h3>Catat penerimaan cabang</h3><p>Saldo tujuan baru bertambah setelah penerimaan dikonfirmasi. Barang rusak, karantina, dan kedaluwarsa masuk ke kondisi masing-masing.</p>${lines}<label class="field"><span class="field__label">Catatan penerimaan</span><textarea class="form-control" name="reason" rows="2" maxlength="240" required placeholder="Catat kondisi barang saat diterima"></textarea></label><button class="button button--primary" type="submit">Simpan penerimaan</button></form>`;
}

function renderReconcileForm(transfer) {
  const lines = transfer.lines.filter((line) => line.in_transit_quantity > 0);
  if (!lines.length) return "";
  return `<form class="distribution-action-form distribution-reconcile-form" data-distribution-action="reconcile"><h3>Rekonsiliasi selisih transit</h3><p>Koreksi mengurangi transit hanya setelah selisih dipastikan dan alasan dicatat.</p><label class="field"><span class="field__label">Batch dengan selisih</span><select class="select-control" name="transfer_line_id">${lines.map((line) => `<option value="${escapeHtml(line.transfer_line_id)}">${escapeHtml(line.lot_number_snapshot)} · ${formatQuantity(line.in_transit_quantity)} unit</option>`).join("")}</select></label><label class="field"><span class="field__label">Jumlah yang direkonsiliasi</span><input class="form-control" name="quantity" type="number" min="1" max="${Math.max(...lines.map((line) => line.in_transit_quantity))}" step="1" value="${Math.max(...lines.map((line) => line.in_transit_quantity))}" required /></label><label class="field"><span class="field__label">Alasan rekonsiliasi</span><textarea class="form-control" name="reason" rows="2" maxlength="240" required placeholder="Jelaskan hasil pemeriksaan selisih"></textarea></label><button class="button button--secondary" type="submit">Simpan rekonsiliasi</button></form>`;
}

function renderDetail() {
  const detail = $("#distribution-detail-card");
  const request = viewState.workspace?.requests.find((item) => item.request_id === viewState.selectedRequestId);
  detail.hidden = !request;
  if (!request) return;
  $("#distribution-detail-title").textContent = `Permintaan ${request.request_id}`;
  $("#distribution-detail-summary").textContent = `${request.branch_name_snapshot} · dibuat ${dateTime(request.created_at)} oleh aktor demo ${request.created_by}.`;
  const workflowStatus = request.status;
  const status = request.displayStatus;
  const statusBadge = $("#distribution-detail-status");
  statusBadge.className = `badge ${statusClass(status)}`;
  statusBadge.textContent = statusLabels[status] ?? status;
  const transferHistory = viewState.workspace.transfers.filter((item) => item.request_id === request.request_id);
  const transfer = transferHistory.at(-1) ?? null;
  const approval = latestApproval(request);
  const approved = new Map((approval?.details?.approved_lines ?? []).map((line) => [line.request_line_id, line.approved_quantity]));
  const requestRows = request.items.map((line) => `<tr><td>${escapeHtml(line.sku_snapshot)}<small>${escapeHtml(line.product_name_snapshot)}</small></td><td>${formatQuantity(line.requested_quantity)}</td><td>${approved.has(line.request_line_id) ? formatQuantity(approved.get(line.request_line_id)) : "—"}</td></tr>`).join("");
  const allocationRows = transfer?.lines.map((line) => `<tr><td>${escapeHtml(line.sku_snapshot)}<small>${escapeHtml(line.product_name_snapshot)}</small></td><td>${escapeHtml(line.lot_number_snapshot)}<small>${line.expiry_date_snapshot ? `Exp. ${escapeHtml(line.expiry_date_snapshot)}` : "Tanpa expiry"}</small></td><td>${escapeHtml(line.rotation_policy_snapshot)}</td><td>${formatQuantity(line.allocated_quantity)}</td><td>${formatQuantity(line.received_quantity)}</td><td>${formatQuantity(line.in_transit_quantity)}</td></tr>`).join("") ?? "";
  const receiptHistory = transfer?.receipts.flatMap((receipt) => receipt.lines.map((line) => `<div class="distribution-receipt-record"><strong>${dateTime(receipt.received_at)} · ${escapeHtml(receipt.received_by)}</strong><span>${escapeHtml(line.lot_number_snapshot)}: ${formatQuantity(line.received_quantity)} unit · ${bucketLabels[line.condition_bucket]}</span>${line.short_quantity > 0 ? `<small class="distribution-discrepancy">Selisih tercatat setelah kejadian ini: ${formatQuantity(line.short_quantity)} unit · ${escapeHtml(line.discrepancy_reason)}</small>` : ""}</div>`)).join("") ?? "";
  const timelineSeen = new Set();
  const timelineEvents = [...request.statusHistory, ...transferHistory.flatMap((item) => item.statusHistory)].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).filter((event) => {
    const replacementId = ["REALLOCATED", "DRAFT_REPLACED"].includes(event.event_type)
      ? event.details?.replacement_transfer_id ?? "" : "";
    const key = `${event.event_type}::${event.occurred_at}::${event.actor_id}::${event.reason}::${replacementId}`;
    if (timelineSeen.has(key)) return false;
    timelineSeen.add(key);
    return true;
  });
  const history = timelineEvents.map((event) => {
    const label = event.event_type === "REALLOCATED" ? "Alokasi ulang dibuat"
      : event.event_type === "DRAFT_REPLACED" ? "Draft alokasi diganti"
        : event.event_type === "DISCREPANCY_RECONCILED" ? "Selisih direkonsiliasi"
      : event.event_type === "DISCREPANCY_RESOLVED" ? "Selisih diselesaikan"
        : statusLabels[event.to_status] ?? event.event_type;
    return `<li><span class="distribution-timeline-dot" aria-hidden="true"></span><div><strong>${escapeHtml(label)}</strong><small>${dateTime(event.occurred_at)} · ${escapeHtml(event.actor_id)}</small><p>${escapeHtml(event.reason)}</p></div></li>`;
  }).join("");
  const currentActor = actor();
  let actions = "";
  if (workflowStatus === "requested" && currentActor.type === "hq") actions = renderApprovalForm(request);
  else if (["approved", "partially_approved"].includes(workflowStatus) && currentActor.type === "hq") actions = renderAllocationForm();
  else if (transfer?.status === "allocated" && currentActor.type === "hq") actions = `${renderDispatchForm()}${renderReallocationForm(transfer)}`;
  else if (["in_transit", "partially_received"].includes(transfer?.status) && transfer) {
    actions = `${renderReceiptForm(transfer)}${currentActor.type === "hq" ? renderReconcileForm(transfer) : ""}`;
  }
  const timelineList = history || `<li><span class="distribution-timeline-dot" aria-hidden="true"></span><div><strong>Diminta</strong><small>${dateTime(request.created_at)} · ${escapeHtml(request.created_by)}</small><p>Permintaan stok cabang dibuat.</p></div></li>`;
  $("#distribution-detail-content").innerHTML = `<div class="distribution-detail-grid"><section><h3>Ringkasan kuantitas</h3><div class="distribution-table-wrap"><table class="distribution-table distribution-detail-table"><thead><tr><th>Produk</th><th>Diminta</th><th>Disetujui</th></tr></thead><tbody>${requestRows}</tbody></table></div></section>${transfer ? `<section><h3>Batch &amp; pergerakan</h3><p class="distribution-detail-subtitle">${escapeHtml(transfer.transfer_id)} · ${statusLabels[transfer.status] ?? transfer.status}</p>${transfer.openDiscrepancyQuantity > 0 ? `<p class="distribution-open-discrepancy" role="status">${formatQuantity(transfer.openDiscrepancyQuantity)} unit masih tercatat di transit; selisih belum direkonsiliasi.</p>` : ""}<div class="distribution-table-wrap"><table class="distribution-table distribution-detail-table"><thead><tr><th>Produk</th><th>Batch</th><th>Rotasi</th><th>Dialokasikan</th><th>Diterima</th><th>Transit</th></tr></thead><tbody>${allocationRows}</tbody></table></div></section>` : ""}</div>${receiptHistory ? `<section class="distribution-receipts"><h3>Riwayat penerimaan &amp; selisih</h3>${receiptHistory}</section>` : ""}<section class="distribution-timeline-section"><h3>Riwayat status &amp; aktor</h3><ol class="distribution-timeline">${timelineList}</ol></section>${actions ? `<section class="distribution-actions">${actions}</section>` : `<p class="distribution-role-hint">Tidak ada aksi pada status atau konteks aktor ini. Ganti aktor demo untuk melanjutkan alur yang sesuai.</p>`}`;
}

function loadWorkspace() {
  try {
    viewState.workspace = service.getWorkspace();
    syncBranchOptions();
    renderStockSummary();
    renderList();
  } catch (error) {
    showToast(error?.message || "Data distribusi tidak dapat dibaca dari penyimpanan demo.", "error");
  }
}

function formData(form) { return new FormData(form); }

async function submitAction(form, event) {
  event.preventDefault();
  if (viewState.busy) return;
  const action = form.dataset.distributionAction;
  const id = viewState.selectedRequestId;
  const request = viewState.workspace?.requests.find((item) => item.request_id === id);
  const transfer = [...(viewState.workspace?.transfers ?? [])].reverse().find((item) => item.request_id === id);
  if (!request) return;
  const data = formData(form);
  const common = { actorId: actor().actorId, reason: data.get("reason") };
  const submitter = event.submitter;
  try {
    viewState.busy = true;
    $$("button, input, select, textarea", form).forEach((control) => { control.disabled = true; });
    if (action === "approve") {
      if (submitter?.value === "reject") service.rejectRequest({ requestId: id, ...common });
      else {
        const approvedQuantities = Object.fromEntries($$("[data-approve-line]", form).map((input) => [input.dataset.approveLine, input.value]));
        service.approveRequest({ requestId: id, approvedQuantities, ...common });
      }
    } else if (action === "allocate") {
      service.allocateRequest({ requestId: id, ...common });
    } else if (action === "reallocate" && transfer) {
      service.reallocateTransfer({ requestId: id, transferId: transfer.transfer_id, ...common });
    } else if (action === "dispatch" && transfer) {
      service.dispatchTransfer({ transferId: transfer.transfer_id, ...common });
    } else if (action === "receive" && transfer) {
      const lines = $$("[data-receive-line]", form).map((input) => ({
        transferLineId: input.dataset.receiveLine,
        quantity: input.value,
        conditionBucket: $$('[data-receive-condition]', form).find((control) => control.dataset.receiveCondition === input.dataset.receiveLine)?.value,
        discrepancyReason: $$('[data-receive-discrepancy]', form).find((control) => control.dataset.receiveDiscrepancy === input.dataset.receiveLine)?.value,
      }));
      service.receiveTransfer({ transferId: transfer.transfer_id, lines, ...common });
    } else if (action === "reconcile" && transfer) {
      service.reconcileShortage({ transferId: transfer.transfer_id, transferLineId: data.get("transfer_line_id"), quantity: data.get("quantity"), ...common });
    }
    showToast("Kejadian distribusi tersimpan pada repository demo dan ledger terkait.", "success");
    loadWorkspace();
  } catch (error) {
    const message = error instanceof DistributionError || error?.message ? error.message : "Perubahan distribusi gagal disimpan.";
    showToast(`${message} Data tersimpan tidak berubah.`, "error");
  } finally {
    viewState.busy = false;
    $$("button, input, select, textarea", form).forEach((control) => { control.disabled = false; });
  }
}

export function initializeDistributionPage({ authService = null } = {}) {
  const page = $("#distribution[data-page-view]");
  if (!page) return;
  viewState.authService = authService;
  if (authService?.getSession()?.user?.role === "HQ_ADMIN") $("#distribution-actor").value = "hq";
  $("#distribution-request-lines").replaceChildren();
  $("#distribution-add-line").addEventListener("click", ensureRequestLine);
  $("#distribution-request-lines").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-request-line]");
    if (!remove) return;
    const rows = $$(".distribution-request-line", $("#distribution-request-lines"));
    if (rows.length === 1) { showToast("Permintaan harus memiliki sedikitnya satu produk.", "warning"); return; }
    remove.closest(".distribution-request-line").remove();
  });
  $("#distribution-actor").addEventListener("change", () => { viewState.selectedRequestId = null; loadWorkspace(); });
  ["#distribution-search", "#distribution-filter-branch", "#distribution-filter-status"].forEach((selector) => $(selector).addEventListener(selector === "#distribution-search" ? "input" : "change", renderList));
  $("#distribution-table-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-distribution-open]");
    if (!button) return;
    viewState.selectedRequestId = button.dataset.distributionOpen;
    renderDetail();
    $("#distribution-detail-card").scrollIntoView({ behavior: "smooth", block: "start" });
    $("#distribution-detail-title").focus?.({ preventScroll: true });
  });
  $("#distribution-request-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const currentActor = actor();
    if (currentActor.type !== "branch") return;
    const items = $$(".distribution-request-line", $("#distribution-request-lines")).map((row) => ({
      productId: $("[data-request-product]", row).value,
      quantity: $("[data-request-quantity]", row).value,
    }));
    try {
      $("#distribution-request-error").hidden = true;
      const request = service.createRequest({ branchId: $("#distribution-request-branch").value, items, reason: $("#distribution-request-reason").value, actorId: currentActor.actorId });
      viewState.selectedRequestId = request.request_id;
      event.currentTarget.reset();
      $("#distribution-request-lines").replaceChildren();
      ensureRequestLine();
      showToast(`Permintaan ${request.request_id} berhasil dicatat. Saldo gudang belum berubah.`, "success");
      loadWorkspace();
    } catch (error) {
      const errorPanel = $("#distribution-request-error");
      errorPanel.hidden = false;
      errorPanel.textContent = error?.message || "Permintaan gagal disimpan.";
      errorPanel.focus();
    }
  });
  $("#distribution-detail-content").addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-distribution-action]");
    if (form) submitAction(form, event);
  });
  document.addEventListener("app:routechange", (event) => { if (event.detail?.route === "distribution") loadWorkspace(); });
  document.addEventListener("app:authchange", () => {
    if (authService?.getSession()?.user?.role === "HQ_ADMIN") $("#distribution-actor").value = "hq";
    loadWorkspace();
  });
  loadWorkspace();
}

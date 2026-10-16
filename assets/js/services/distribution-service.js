const PHYSICAL_BUCKETS = Object.freeze(["AVAILABLE", "QUARANTINE", "DAMAGED", "EXPIRED"]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function toTimestamp(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new DistributionError("DISTRIBUTION_TIME_INVALID", "Waktu kejadian distribusi tidak valid.");
  return parsed.toISOString();
}

function jakartaDate(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function requireReason(value, field = "reason") {
  const reason = String(value ?? "").trim();
  if (!reason) throw new DistributionError("DISTRIBUTION_REASON_REQUIRED", "Alasan wajib diisi untuk mencatat kejadian distribusi.", { [field]: "Masukkan alasan yang dapat ditinjau." });
  if (reason.length > 240) throw new DistributionError("DISTRIBUTION_REASON_TOO_LONG", "Alasan maksimal 240 karakter.", { [field]: "Gunakan maksimal 240 karakter." });
  return reason;
}

function requireDemoActor(actorId, expected, action) {
  const value = String(actorId ?? "").trim();
  if (value !== expected) throw new DistributionError("DISTRIBUTION_ACTOR_SCOPE", `Aksi ${action} harus dilakukan dari konteks aktor demo ${expected}.`);
  return value;
}

function requireQuantity(value, field = "quantity", { allowZero = false } = {}) {
  if (value === "" || value === null || value === undefined) {
    throw new DistributionError("DISTRIBUTION_QUANTITY_INVALID", "Jumlah harus diisi sebagai integer.", { [field]: "Masukkan jumlah unit bulat." });
  }
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || (allowZero ? quantity < 0 : quantity <= 0)) {
    throw new DistributionError("DISTRIBUTION_QUANTITY_INVALID", allowZero ? "Jumlah harus berupa integer nol atau lebih." : "Jumlah harus berupa integer positif.", { [field]: allowZero ? "Masukkan jumlah unit bulat nol atau lebih." : "Masukkan jumlah unit bulat lebih besar dari nol." });
  }
  return quantity;
}

function eventFor(service, { documentType, documentId, eventType, fromStatus = null, toStatus, actorId, reason, timestamp, details = {} }) {
  return {
    event_id: service.idFactory("DIST-EVT"), document_type: documentType, document_id: documentId,
    event_type: eventType, from_status: fromStatus, to_status: toStatus, occurred_at: timestamp,
    effective_date: jakartaDate(timestamp), actor_id: actorId, reason, details: clone(details),
  };
}

function latestEvent(state, type, id) {
  return [...state.distributionEvents].reverse().find((event) => event.document_type === type && event.document_id === id) ?? null;
}

function statusOf(state, type, id) { return latestEvent(state, type, id)?.to_status ?? null; }

function warehouseForBranch(state, branchId) {
  const branch = state.branches.find((item) => item.branch_id === branchId && item.status === "active");
  const warehouse = state.warehouses.find((item) => item.branch_id === branchId && item.warehouse_type === "BRANCH" && item.status === "active");
  return branch && warehouse ? { branch, warehouse } : null;
}

function receivedForLine(state, transferId, transferLineId) {
  return state.distributionReceipts
    .filter((receipt) => receipt.transfer_id === transferId)
    .flatMap((receipt) => receipt.lines)
    .filter((line) => line.transfer_line_id === transferLineId)
    .reduce((sum, line) => sum + line.received_quantity, 0);
}

function reconciledForLine(state, transferId, transferLineId) {
  return state.distributionEvents
    .filter((event) => event.document_type === "transfer" && event.document_id === transferId && event.event_type === "DISCREPANCY_RECONCILED" && event.details.transfer_line_id === transferLineId)
    .reduce((sum, event) => sum + event.details.resolved_quantity, 0);
}

function outstandingForLine(state, transfer, transferLine) {
  const wasShipped = state.distributionEvents.some((event) => event.document_type === "transfer" && event.document_id === transfer.transfer_id && event.event_type === "SHIPPED");
  if (!wasShipped) return 0;
  return Math.max(0, transferLine.allocated_quantity
    - receivedForLine(state, transfer.transfer_id, transferLine.transfer_line_id)
    - reconciledForLine(state, transfer.transfer_id, transferLine.transfer_line_id));
}

function makeDistributionMovement(service, { batchId, warehouseId, locationId, bucket, delta, movementType, referenceType, referenceId, reason, actorId, timestamp }) {
  return {
    movement_id: service.idFactory("MOV"), inventory_batch_id: batchId, warehouse_id: warehouseId,
    stock_location_id: bucket === "IN_TRANSIT" ? null : locationId, stock_bucket: bucket,
    quantity_delta: delta, movement_type: movementType, reference_type: referenceType,
    reference_id: referenceId, reason, actor_id: actorId, occurred_at: timestamp,
    effective_date: jakartaDate(timestamp),
  };
}

export class DistributionError extends Error {
  constructor(code, message, fieldErrors = {}) {
    super(message);
    this.name = "DistributionError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export class DistributionService {
  constructor({ repository, inventoryService, now = () => new Date(), idFactory = null } = {}) {
    if (!repository || typeof repository.load !== "function" || typeof repository.commit !== "function") throw new TypeError("DistributionService membutuhkan distribution repository.");
    if (!inventoryService || typeof inventoryService.planAllocation !== "function" || typeof inventoryService.getBatchBalances !== "function"
      || typeof inventoryService.validateAvailableRotation !== "function") throw new TypeError("DistributionService membutuhkan Inventory Service untuk alokasi, saldo, dan validasi rotasi.");
    this.repository = repository;
    this.inventoryService = inventoryService;
    this.now = now;
    let counter = 0;
    this.idFactory = idFactory ?? ((prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${(++counter).toString(36).toUpperCase()}`);
  }

  getWorkspace({ branchId = "all", status = "all", search = "" } = {}) {
    const state = this.repository.load();
    const requests = state.stockRequests.map((request) => ({
      ...clone(request), status: statusOf(state, "request", request.request_id),
      statusHistory: state.distributionEvents.filter((event) => event.document_type === "request" && event.document_id === request.request_id).map(clone),
      transfer: [...state.stockTransfers].reverse().find((item) => item.request_id === request.request_id) ?? null,
    })).map((request) => {
      request.transferStatus = request.transfer ? statusOf(state, "transfer", request.transfer.transfer_id) : null;
      request.displayStatus = request.transferStatus === "in_transit" ? "in_transit" : request.transferStatus ?? request.status;
      return request;
    });
    const query = String(search).trim().toLocaleLowerCase("id-ID");
    const filteredRequests = requests
      .filter((request) => branchId === "all" || request.branch_id === branchId)
      .filter((request) => status === "all" || request.displayStatus === status || request.status === status)
      .filter((request) => !query || [request.request_id, request.branch_name_snapshot, ...request.items.flatMap((item) => [item.sku_snapshot, item.product_name_snapshot])].join(" ").toLocaleLowerCase("id-ID").includes(query));
    const transfers = state.stockTransfers.map((transfer) => {
      const lines = transfer.lines.map((line) => {
        const inTransit = outstandingForLine(state, transfer, line);
        return { ...clone(line), received_quantity: receivedForLine(state, transfer.transfer_id, line.transfer_line_id), in_transit_quantity: inTransit };
      });
      return {
        ...clone(transfer), status: statusOf(state, "transfer", transfer.transfer_id), lines,
        statusHistory: state.distributionEvents.filter((event) => event.document_type === "transfer" && event.document_id === transfer.transfer_id).map(clone),
        receipts: state.distributionReceipts.filter((receipt) => receipt.transfer_id === transfer.transfer_id).map(clone),
        openDiscrepancyQuantity: lines.reduce((sum, line) => sum + line.in_transit_quantity, 0),
      };
    });
    return {
      isSimulation: true,
      actorNotice: "Aktor HQ/cabang hanya simulasi antarmuka; tidak ada RBAC atau sinkronisasi produksi.",
      warehouses: state.warehouses.map(clone), branches: state.branches.map(clone),
      products: state.products.map(clone), requests: filteredRequests,
      transfers: transfers.filter((transfer) => branchId === "all" || transfer.destination_branch_id === branchId),
      receipts: state.distributionReceipts.map(clone), events: state.distributionEvents.map(clone),
      inventory: this.inventoryService.getWorkspace({ warehouseId: "WH-HQ-01" }),
    };
  }

  createRequest({ branchId, items, reason, actorId = null } = {}) {
    const state = this.repository.load();
    const trimmedReason = requireReason(reason);
    const destination = warehouseForBranch(state, branchId);
    if (!destination) throw new DistributionError("DISTRIBUTION_BRANCH_INVALID", "Pilih cabang aktif yang memiliki gudang tujuan.", { branchId: "Pilih cabang aktif." });
    const requestActor = requireDemoActor(actorId ?? `DEMO-${branchId}`, `DEMO-${branchId}`, "permintaan cabang");
    const source = state.warehouses.find((item) => item.warehouse_id === "WH-HQ-01" && item.warehouse_type === "CENTRAL" && item.status === "active");
    if (!source) throw new DistributionError("DISTRIBUTION_SOURCE_INVALID", "Gudang pusat aktif tidak ditemukan.");
    if (!Array.isArray(items) || items.length === 0) throw new DistributionError("DISTRIBUTION_ITEMS_REQUIRED", "Permintaan harus memuat sedikitnya satu produk.", { items: "Tambahkan produk yang diminta." });
    const seenProducts = new Set();
    const requestItems = items.map((item) => {
      const product = state.products.find((record) => record.product_id === item.productId && record.status === "active");
      const quantity = requireQuantity(item.quantity, "quantity");
      if (!product) throw new DistributionError("DISTRIBUTION_PRODUCT_INVALID", "Produk harus aktif untuk diminta.", { productId: "Pilih produk aktif." });
      if (seenProducts.has(product.product_id)) throw new DistributionError("DISTRIBUTION_PRODUCT_DUPLICATE", "Satu produk hanya boleh muncul satu kali dalam permintaan.", { productId: "Gabungkan jumlah produk ini." });
      seenProducts.add(product.product_id);
      return {
        request_line_id: this.idFactory("DREQ-LINE"), product_id: product.product_id,
        sku_snapshot: product.sku, product_name_snapshot: product.name, unit_id_snapshot: product.unit_id,
        requested_quantity: quantity,
      };
    });
    const timestamp = toTimestamp(this.now());
    const requestId = this.idFactory("DREQ");
    const request = {
      request_id: requestId, organization_id: state.organization.organization_id,
      source_warehouse_id: source.warehouse_id, destination_warehouse_id: destination.warehouse.warehouse_id,
      branch_id: destination.branch.branch_id, branch_name_snapshot: destination.branch.name,
      items: requestItems, created_at: timestamp, created_by: requestActor,
    };
    const next = clone(state);
    next.stockRequests.push(request);
    next.distributionEvents.push(eventFor(this, { documentType: "request", documentId: requestId, eventType: "REQUESTED", toStatus: "requested", actorId: requestActor, reason: trimmedReason, timestamp, details: { item_count: requestItems.length } }));
    this.repository.commit(next);
    return clone(request);
  }

  approveRequest({ requestId, approvedQuantities = null, reason, actorId = "DEMO-HQ-001" } = {}) {
    const state = this.repository.load();
    const request = state.stockRequests.find((item) => item.request_id === requestId);
    if (!request) throw new DistributionError("DISTRIBUTION_REQUEST_NOT_FOUND", "Permintaan distribusi tidak ditemukan.");
    const current = statusOf(state, "request", requestId);
    if (current !== "requested") throw new DistributionError("DISTRIBUTION_TRANSITION_INVALID", `Permintaan berstatus ${current}; hanya permintaan requested dapat disetujui.`);
    requireDemoActor(actorId, "DEMO-HQ-001", "persetujuan pusat");
    const trimmedReason = requireReason(reason);
    const lines = request.items.map((item) => {
      const value = approvedQuantities?.[item.request_line_id] ?? item.requested_quantity;
      const quantity = requireQuantity(value, "approvedQuantity", { allowZero: true });
      if (quantity > item.requested_quantity) throw new DistributionError("DISTRIBUTION_APPROVAL_EXCEEDS_REQUEST", "Jumlah persetujuan tidak boleh melebihi permintaan.", { approvedQuantity: "Kurangi jumlah persetujuan." });
      return { request_line_id: item.request_line_id, approved_quantity: quantity, rejected_quantity: item.requested_quantity - quantity };
    });
    if (!lines.some((line) => line.approved_quantity > 0)) throw new DistributionError("DISTRIBUTION_APPROVAL_EMPTY", "Gunakan aksi penolakan bila tidak ada jumlah yang disetujui.");
    const toStatus = lines.every((line) => line.rejected_quantity === 0) ? "approved" : "partially_approved";
    const timestamp = toTimestamp(this.now());
    const next = clone(state);
    next.distributionEvents.push(eventFor(this, { documentType: "request", documentId: requestId, eventType: toStatus === "approved" ? "APPROVED" : "PARTIALLY_APPROVED", fromStatus: current, toStatus, actorId, reason: trimmedReason, timestamp, details: { approved_lines: lines } }));
    this.repository.commit(next);
    return { requestId, status: toStatus, lines };
  }

  rejectRequest({ requestId, reason, actorId = "DEMO-HQ-001" } = {}) {
    const state = this.repository.load();
    const request = state.stockRequests.find((item) => item.request_id === requestId);
    if (!request) throw new DistributionError("DISTRIBUTION_REQUEST_NOT_FOUND", "Permintaan distribusi tidak ditemukan.");
    const current = statusOf(state, "request", requestId);
    if (current !== "requested") throw new DistributionError("DISTRIBUTION_TRANSITION_INVALID", `Permintaan berstatus ${current}; penolakan hanya dapat dilakukan pada status requested.`);
    requireDemoActor(actorId, "DEMO-HQ-001", "penolakan pusat");
    const timestamp = toTimestamp(this.now());
    const trimmedReason = requireReason(reason);
    const next = clone(state);
    next.distributionEvents.push(eventFor(this, { documentType: "request", documentId: requestId, eventType: "REJECTED", fromStatus: current, toStatus: "rejected", actorId, reason: trimmedReason, timestamp }));
    this.repository.commit(next);
    return { requestId, status: "rejected" };
  }

  allocateRequest({ requestId, reason, actorId = "DEMO-HQ-001", effectiveDate = null, reallocateTransferId = null } = {}) {
    const state = this.repository.load();
    const request = state.stockRequests.find((item) => item.request_id === requestId);
    if (!request) throw new DistributionError("DISTRIBUTION_REQUEST_NOT_FOUND", "Permintaan distribusi tidak ditemukan.");
    const requestStatus = statusOf(state, "request", requestId);
    const previousTransfer = [...state.stockTransfers].reverse().find((item) => item.request_id === requestId) ?? null;
    const isReallocation = Boolean(reallocateTransferId);
    if (isReallocation) {
      if (requestStatus !== "allocated" || !previousTransfer || previousTransfer.transfer_id !== reallocateTransferId
        || statusOf(state, "transfer", reallocateTransferId) !== "allocated") {
        throw new DistributionError("DISTRIBUTION_REALLOCATION_INVALID", "Alokasi ulang hanya tersedia untuk draft aktif yang belum dikirim.");
      }
    } else if (!new Set(["approved", "partially_approved"]).has(requestStatus)) {
      throw new DistributionError("DISTRIBUTION_TRANSITION_INVALID", `Permintaan berstatus ${requestStatus}; alokasi hanya tersedia setelah persetujuan.`);
    }
    requireDemoActor(actorId, "DEMO-HQ-001", "alokasi pusat");
    if (!isReallocation && state.stockTransfers.some((item) => item.request_id === requestId)) throw new DistributionError("DISTRIBUTION_TRANSFER_EXISTS", "Draft alokasi untuk permintaan ini sudah dibuat.");
    const approval = [...state.distributionEvents].reverse().find((item) => item.document_type === "request" && item.document_id === requestId && ["APPROVED", "PARTIALLY_APPROVED"].includes(item.event_type));
    if (!approval) throw new DistributionError("DISTRIBUTION_APPROVAL_MISSING", "Snapshot persetujuan untuk permintaan ini tidak ditemukan.");
    const trimmedReason = requireReason(reason);
    const targetLocation = state.stockLocations.find((item) => item.warehouse_id === request.destination_warehouse_id && item.status === "active");
    if (!targetLocation) throw new DistributionError("DISTRIBUTION_DESTINATION_LOCATION_MISSING", "Lokasi stok aktif pada gudang cabang tidak ditemukan.");
    const timestamp = toTimestamp(this.now());
    const allocationDate = effectiveDate ?? jakartaDate(timestamp);
    const transferId = this.idFactory("TRF");
    const transferLines = [];
    for (const approvalLine of approval.details.approved_lines) {
      if (approvalLine.approved_quantity <= 0) continue;
      const requestLine = request.items.find((item) => item.request_line_id === approvalLine.request_line_id);
      const allocation = this.inventoryService.planAllocation({
        state, warehouseId: request.source_warehouse_id, productId: requestLine.product_id,
        quantity: approvalLine.approved_quantity, effectiveDate: allocationDate,
      });
      allocation.allocations.forEach((part) => {
        const sourceBatch = state.inventoryBatches.find((batch) => batch.inventory_batch_id === part.inventory_batch_id);
        transferLines.push({
          transfer_line_id: this.idFactory("TRF-LINE"), request_line_id: requestLine.request_line_id,
          product_id: requestLine.product_id, sku_snapshot: requestLine.sku_snapshot,
          product_name_snapshot: requestLine.product_name_snapshot,
          source_batch_id: part.inventory_batch_id, source_stock_location_id: sourceBatch.stock_location_id,
          destination_stock_location_id: targetLocation.stock_location_id,
          lot_number_snapshot: part.lot_number, expiry_date_snapshot: part.expiry_date,
          rotation_policy_snapshot: part.rotation_policy, allocated_quantity: part.allocated_quantity,
        });
      });
    }
    const transfer = {
      transfer_id: transferId, request_id: requestId,
      source_warehouse_id: request.source_warehouse_id,
      destination_warehouse_id: request.destination_warehouse_id,
      destination_branch_id: request.branch_id, destination_branch_name_snapshot: request.branch_name_snapshot,
      lines: transferLines, created_at: timestamp, created_by: actorId,
    };
    const next = clone(state);
    if (isReallocation) {
      next.distributionEvents.push(eventFor(this, { documentType: "transfer", documentId: previousTransfer.transfer_id, eventType: "DRAFT_REPLACED", fromStatus: "allocated", toStatus: "replaced", actorId, reason: trimmedReason, timestamp, details: { replacement_transfer_id: transferId } }));
      next.distributionEvents.push(eventFor(this, { documentType: "request", documentId: requestId, eventType: "REALLOCATED", fromStatus: "allocated", toStatus: "allocated", actorId, reason: trimmedReason, timestamp, details: { previous_transfer_id: previousTransfer.transfer_id, replacement_transfer_id: transferId } }));
    }
    next.stockTransfers.push(transfer);
    if (!isReallocation) next.distributionEvents.push(eventFor(this, { documentType: "request", documentId: requestId, eventType: "ALLOCATED", fromStatus: requestStatus, toStatus: "allocated", actorId, reason: trimmedReason, timestamp, details: { transfer_id: transferId } }));
    next.distributionEvents.push(eventFor(this, { documentType: "transfer", documentId: transferId, eventType: "ALLOCATED", toStatus: "allocated", actorId, reason: trimmedReason, timestamp, details: { line_count: transferLines.length } }));
    this.repository.commit(next);
    return clone(transfer);
  }

  reallocateTransfer({ requestId, transferId, reason, actorId = "DEMO-HQ-001", effectiveDate = null } = {}) {
    return this.allocateRequest({ requestId, reallocateTransferId: transferId, reason, actorId, effectiveDate });
  }

  dispatchTransfer({ transferId, reason, actorId = "DEMO-HQ-001" } = {}) {
    const state = this.repository.load();
    const transfer = state.stockTransfers.find((item) => item.transfer_id === transferId);
    if (!transfer) throw new DistributionError("DISTRIBUTION_TRANSFER_NOT_FOUND", "Draft distribusi tidak ditemukan.");
    const current = statusOf(state, "transfer", transferId);
    if (current !== "allocated") throw new DistributionError("DISTRIBUTION_TRANSITION_INVALID", `Distribusi berstatus ${current}; pengiriman hanya dapat dilakukan satu kali dari draft allocated.`);
    requireDemoActor(actorId, "DEMO-HQ-001", "dispatch pusat");
    const trimmedReason = requireReason(reason);
    const branch = state.branches.find((item) => item.branch_id === transfer.destination_branch_id && item.status === "active");
    const destinationWarehouse = state.warehouses.find((item) => item.warehouse_id === transfer.destination_warehouse_id && item.branch_id === transfer.destination_branch_id && item.status === "active");
    if (!branch || !destinationWarehouse) throw new DistributionError("DISTRIBUTION_DESTINATION_INACTIVE", "Cabang atau gudang tujuan tidak aktif; pengiriman ditolak.");
    const timestamp = toTimestamp(this.now());
    const effectiveDate = jakartaDate(timestamp);
    const expectedAllocations = new Map();
    for (const line of transfer.lines) expectedAllocations.set(line.product_id, (expectedAllocations.get(line.product_id) ?? 0) + line.allocated_quantity);
    const movements = [];
    for (const [productId, quantity] of expectedAllocations) {
      const product = state.products.find((item) => item.product_id === productId && item.status === "active");
      if (!product) throw new DistributionError("DISTRIBUTION_PRODUCT_INACTIVE", "Produk pada draft sudah tidak aktif; pengiriman ditolak.");
      const latest = this.inventoryService.planAllocation({ state, warehouseId: transfer.source_warehouse_id, productId, quantity, effectiveDate });
      const planned = latest.allocations.map((item) => `${item.inventory_batch_id}:${item.allocated_quantity}`).sort();
      const drafted = transfer.lines.filter((item) => item.product_id === productId).map((item) => `${item.source_batch_id}:${item.allocated_quantity}`).sort();
      if (planned.length !== drafted.length || planned.some((value, index) => value !== drafted[index])) {
        throw new DistributionError("DISTRIBUTION_ALLOCATION_STALE", "Stok atau urutan FEFO/FIFO berubah sejak draft dibuat. Gunakan aksi Alokasikan Ulang setelah meninjau saldo gudang pusat.");
      }
    }
    for (const line of transfer.lines) {
      const batch = state.inventoryBatches.find((item) => item.inventory_batch_id === line.source_batch_id);
      const balances = this.inventoryService.getBatchBalances(line.source_batch_id, state);
      if (!batch || batch.warehouse_id !== transfer.source_warehouse_id || balances.AVAILABLE < line.allocated_quantity) throw new DistributionError("DISTRIBUTION_STOCK_INSUFFICIENT", "Saldo batch sumber berubah; pengiriman akan menghasilkan saldo tidak valid.");
      if (line.expiry_date_snapshot && line.expiry_date_snapshot <= effectiveDate) throw new DistributionError("DISTRIBUTION_BATCH_EXPIRED", "Batch sudah kedaluwarsa dan tidak dapat dikirim sebagai persediaan layak jual.");
      movements.push(makeDistributionMovement(this, { batchId: line.source_batch_id, warehouseId: transfer.source_warehouse_id, locationId: line.source_stock_location_id, bucket: "AVAILABLE", delta: -line.allocated_quantity, movementType: "DISTRIBUTION_DISPATCH", referenceType: "STOCK_TRANSFER_DISPATCH", referenceId: transferId, reason: trimmedReason, actorId, timestamp }));
      movements.push(makeDistributionMovement(this, { batchId: line.source_batch_id, warehouseId: transfer.source_warehouse_id, locationId: null, bucket: "IN_TRANSIT", delta: line.allocated_quantity, movementType: "DISTRIBUTION_DISPATCH", referenceType: "STOCK_TRANSFER_DISPATCH", referenceId: transferId, reason: trimmedReason, actorId, timestamp }));
    }
    const next = clone(state);
    next.stockMovements.push(...movements);
    next.distributionEvents.push(eventFor(this, { documentType: "transfer", documentId: transferId, eventType: "SHIPPED", fromStatus: current, toStatus: "in_transit", actorId, reason: trimmedReason, timestamp, details: { shipped_quantity: transfer.lines.reduce((sum, line) => sum + line.allocated_quantity, 0) } }));
    next.distributionEvents.push(eventFor(this, { documentType: "request", documentId: transfer.request_id, eventType: "SHIPPED", fromStatus: statusOf(state, "request", transfer.request_id), toStatus: "shipped", actorId, reason: trimmedReason, timestamp, details: { transfer_id: transferId } }));
    this.repository.commit(next);
    return { transferId, movementCount: movements.length, status: "in_transit" };
  }

  receiveTransfer({ transferId, lines, reason, actorId = null } = {}) {
    const state = this.repository.load();
    const transfer = state.stockTransfers.find((item) => item.transfer_id === transferId);
    if (!transfer) throw new DistributionError("DISTRIBUTION_TRANSFER_NOT_FOUND", "Pengiriman tidak ditemukan.");
    const current = statusOf(state, "transfer", transferId);
    if (!new Set(["in_transit", "partially_received"]).has(current)) throw new DistributionError("DISTRIBUTION_TRANSITION_INVALID", `Distribusi berstatus ${current}; penerimaan tidak dapat dicatat ulang.`);
    const receiverActor = requireDemoActor(actorId ?? `DEMO-${transfer.destination_branch_id}`, `DEMO-${transfer.destination_branch_id}`, "penerimaan cabang");
    const branch = state.branches.find((item) => item.branch_id === transfer.destination_branch_id && item.status === "active");
    const destinationWarehouse = state.warehouses.find((item) => item.warehouse_id === transfer.destination_warehouse_id && item.branch_id === transfer.destination_branch_id && item.status === "active");
    if (!branch || !destinationWarehouse) throw new DistributionError("DISTRIBUTION_DESTINATION_INACTIVE", "Cabang atau gudang tujuan tidak aktif; penerimaan ditolak.");
    const trimmedReason = requireReason(reason);
    if (!Array.isArray(lines) || !lines.length) throw new DistributionError("DISTRIBUTION_RECEIPT_LINES_REQUIRED", "Masukkan jumlah yang benar-benar diterima.");
    const timestamp = toTimestamp(this.now());
    const effectiveDate = jakartaDate(timestamp);
    const incomingById = new Map();
    for (const input of lines) {
      if (incomingById.has(input.transferLineId)) throw new DistributionError("DISTRIBUTION_RECEIPT_DUPLICATE_LINE", "Baris batch yang sama hanya boleh dicatat satu kali per penerimaan.");
      const transferLine = transfer.lines.find((item) => item.transfer_line_id === input.transferLineId);
      if (!transferLine) throw new DistributionError("DISTRIBUTION_RECEIPT_LINE_INVALID", "Batch penerimaan tidak cocok dengan dokumen pengiriman.");
      const receivedQuantity = requireQuantity(input.quantity, "quantity", { allowZero: true });
      const bucket = input.conditionBucket;
      if (!PHYSICAL_BUCKETS.includes(bucket)) throw new DistributionError("DISTRIBUTION_RECEIPT_CONDITION_INVALID", "Pilih kondisi barang yang diterima.", { conditionBucket: "Pilih kondisi stok tujuan." });
      const availableTransit = outstandingForLine(state, transfer, transferLine);
      if (receivedQuantity > availableTransit) throw new DistributionError("DISTRIBUTION_RECEIPT_EXCEEDS_TRANSIT", `Penerimaan ${receivedQuantity} melebihi stok batch yang masih transit (${availableTransit}).`);
      if (receivedQuantity > 0 && bucket === "AVAILABLE" && transferLine.expiry_date_snapshot && transferLine.expiry_date_snapshot <= effectiveDate) {
        throw new DistributionError("DISTRIBUTION_BATCH_EXPIRED", "Batch kedaluwarsa tidak dapat diterima sebagai layak jual. Pilih kondisi Kedaluwarsa.");
      }
      incomingById.set(input.transferLineId, { transferLine, receivedQuantity, bucket, discrepancyReason: input.discrepancyReason });
    }
    if (![...incomingById.values()].some((line) => line.receivedQuantity > 0)) throw new DistributionError("DISTRIBUTION_RECEIPT_EMPTY", "Catat sedikitnya satu unit yang diterima.");

    const receiptId = this.idFactory("RCV-DIST");
    const receiptLines = [];
    const movements = [];
    const pendingBatches = [];
    for (const { transferLine, receivedQuantity, bucket, discrepancyReason: inputDiscrepancyReason } of incomingById.values()) {
      if (receivedQuantity <= 0) continue;
      const existingDestinationBatchId = state.distributionReceipts
        .flatMap((receipt) => receipt.lines)
        .find((line) => line.transfer_line_id === transferLine.transfer_line_id)?.destination_batch_id ?? null;
      let destinationBatch = existingDestinationBatchId ? state.inventoryBatches.find((item) => item.inventory_batch_id === existingDestinationBatchId) : null;
      if (!destinationBatch) {
        destinationBatch = state.inventoryBatches.find((batch) => batch.warehouse_id === transfer.destination_warehouse_id
          && batch.stock_location_id === transferLine.destination_stock_location_id
          && batch.product_id === transferLine.product_id
          && batch.lot_number.toLocaleLowerCase("id-ID") === transferLine.lot_number_snapshot.toLocaleLowerCase("id-ID"));
        if (destinationBatch && (destinationBatch.expiry_date !== transferLine.expiry_date_snapshot || destinationBatch.rotation_policy !== transferLine.rotation_policy_snapshot)) {
          throw new DistributionError("DISTRIBUTION_DESTINATION_BATCH_CONFLICT", "Nomor lot sudah digunakan dengan tanggal kedaluwarsa atau rotasi yang berbeda di gudang cabang.");
        }
      }
      if (!destinationBatch) {
        destinationBatch = {
          inventory_batch_id: this.idFactory("BAT"), product_id: transferLine.product_id,
          warehouse_id: transfer.destination_warehouse_id, stock_location_id: transferLine.destination_stock_location_id,
          lot_number: transferLine.lot_number_snapshot, received_at: timestamp,
          expiry_date: transferLine.expiry_date_snapshot, rotation_policy: transferLine.rotation_policy_snapshot,
          created_at: timestamp,
        };
      }
      const outstandingBefore = outstandingForLine(state, transfer, transferLine);
      const shortQuantity = outstandingBefore - receivedQuantity;
      const discrepancyReason = shortQuantity > 0 ? requireReason(inputDiscrepancyReason || trimmedReason, "discrepancyReason") : "";
      const receiptLine = {
        transfer_line_id: transferLine.transfer_line_id, source_batch_id: transferLine.source_batch_id,
        destination_batch_id: destinationBatch.inventory_batch_id, product_id: transferLine.product_id,
        lot_number_snapshot: transferLine.lot_number_snapshot, shipped_quantity: transferLine.allocated_quantity,
        received_quantity: receivedQuantity, condition_bucket: bucket,
        short_quantity: shortQuantity, discrepancy_reason: discrepancyReason,
      };
      receiptLines.push(receiptLine);
      movements.push(makeDistributionMovement(this, { batchId: transferLine.source_batch_id, warehouseId: transfer.source_warehouse_id, locationId: null, bucket: "IN_TRANSIT", delta: -receivedQuantity, movementType: "DISTRIBUTION_RECEIPT", referenceType: "STOCK_TRANSFER_RECEIPT", referenceId: receiptId, reason: trimmedReason, actorId: receiverActor, timestamp }));
      movements.push(makeDistributionMovement(this, { batchId: destinationBatch.inventory_batch_id, warehouseId: transfer.destination_warehouse_id, locationId: transferLine.destination_stock_location_id, bucket, delta: receivedQuantity, movementType: "DISTRIBUTION_RECEIPT", referenceType: "STOCK_TRANSFER_RECEIPT", referenceId: receiptId, reason: trimmedReason, actorId: receiverActor, timestamp }));
      if (!existingDestinationBatchId && !state.inventoryBatches.some((batch) => batch.inventory_batch_id === destinationBatch.inventory_batch_id)) {
        pendingBatches.push(destinationBatch);
      }
    }
    const receipt = { receipt_id: receiptId, transfer_id: transferId, received_at: timestamp, effective_date: effectiveDate, received_by: receiverActor, reason: trimmedReason, lines: receiptLines };
    const next = clone(state);
    next.inventoryBatches.push(...pendingBatches);
    next.distributionReceipts.push(receipt);
    next.stockMovements.push(...movements);
    const productsReceivingAvailable = new Set(receiptLines
      .filter((line) => line.condition_bucket === "AVAILABLE" && line.received_quantity > 0)
      .map((line) => line.product_id));
    for (const productId of productsReceivingAvailable) {
      try {
        this.inventoryService.validateAvailableRotation({ state: next, warehouseId: transfer.destination_warehouse_id, productId, effectiveDate });
      } catch (error) {
        if (error?.code === "INVENTORY_ROTATION_POLICY_MIXED") {
          throw new DistributionError("DISTRIBUTION_ROTATION_POLICY_MIXED", "Penerimaan ditolak: batch layak jual di gudang cabang akan mencampur kebijakan FEFO/FIFO.");
        }
        throw error;
      }
    }
    const allOutstanding = transfer.lines.reduce((sum, line) => {
      const fromThisReceipt = receiptLines.find((receiptLine) => receiptLine.transfer_line_id === line.transfer_line_id)?.received_quantity ?? 0;
      return sum + outstandingForLine(state, transfer, line) - fromThisReceipt;
    }, 0);
    const toStatus = allOutstanding === 0 ? "received" : "partially_received";
    next.distributionEvents.push(eventFor(this, { documentType: "transfer", documentId: transferId, eventType: toStatus === "received" ? "RECEIVED" : "PARTIALLY_RECEIVED", fromStatus: current, toStatus, actorId: receiverActor, reason: trimmedReason, timestamp, details: { receipt_id: receiptId, received_quantity: receiptLines.reduce((sum, line) => sum + line.received_quantity, 0), remaining_in_transit: allOutstanding } }));
    next.distributionEvents.push(eventFor(this, { documentType: "request", documentId: transfer.request_id, eventType: toStatus === "received" ? "RECEIVED" : "PARTIALLY_RECEIVED", fromStatus: statusOf(state, "request", transfer.request_id), toStatus, actorId: receiverActor, reason: trimmedReason, timestamp, details: { transfer_id: transferId, receipt_id: receiptId, remaining_in_transit: allOutstanding } }));
    const receivedNowByLine = new Map(receiptLines.map((line) => [line.transfer_line_id, line.received_quantity]));
    for (const line of transfer.lines) {
      const receivedNow = receivedNowByLine.get(line.transfer_line_id) ?? 0;
      const outstandingBefore = outstandingForLine(state, transfer, line);
      if (receivedNow > 0 && outstandingBefore > 0 && receivedNow >= outstandingBefore) {
        next.distributionEvents.push(eventFor(this, { documentType: "transfer", documentId: transferId, eventType: "DISCREPANCY_RESOLVED", fromStatus: toStatus, toStatus, actorId: receiverActor, reason: trimmedReason, timestamp, details: { transfer_line_id: line.transfer_line_id, resolved_quantity: outstandingBefore, resolution: "received_later" } }));
      }
    }
    this.repository.commit(next);
    return { receiptId, status: toStatus, receipt: clone(receipt), remainingInTransit: allOutstanding };
  }

  reconcileShortage({ transferId, transferLineId = null, quantity, reason, actorId = "DEMO-HQ-001" } = {}) {
    const state = this.repository.load();
    const transfer = state.stockTransfers.find((item) => item.transfer_id === transferId);
    if (!transfer) throw new DistributionError("DISTRIBUTION_TRANSFER_NOT_FOUND", "Distribusi tidak ditemukan.");
    const current = statusOf(state, "transfer", transferId);
    if (current !== "partially_received") throw new DistributionError("DISTRIBUTION_TRANSITION_INVALID", "Rekonsiliasi selisih hanya tersedia saat masih ada stok in-transit.");
    requireDemoActor(actorId, "DEMO-HQ-001", "rekonsiliasi pusat");
    const line = transfer.lines.find((item) => item.transfer_line_id === transferLineId);
    if (!line) throw new DistributionError("DISTRIBUTION_RECEIPT_LINE_INVALID", "Pilih baris batch dengan selisih transit.");
    const amount = requireQuantity(quantity);
    const balance = outstandingForLine(state, transfer, line);
    if (amount > balance) throw new DistributionError("DISTRIBUTION_RECONCILE_EXCEEDS_TRANSIT", `Kuantitas selisih melebihi sisa transit ${balance} unit.`);
    const trimmedReason = requireReason(reason);
    const timestamp = toTimestamp(this.now());
    const referenceId = this.idFactory("DIST-REC");
    const movement = makeDistributionMovement(this, { batchId: line.source_batch_id, warehouseId: transfer.source_warehouse_id, locationId: null, bucket: "IN_TRANSIT", delta: -amount, movementType: "DISTRIBUTION_RECONCILIATION", referenceType: "STOCK_TRANSFER_RECONCILIATION", referenceId, reason: trimmedReason, actorId, timestamp });
    const outstandingAfter = transfer.lines.reduce((sum, transferLine) => sum + outstandingForLine(state, transfer, transferLine) - (transferLine.transfer_line_id === line.transfer_line_id ? amount : 0), 0);
    const toStatus = outstandingAfter === 0 ? "reconciled" : "partially_received";
    const next = clone(state);
    next.stockMovements.push(movement);
    next.distributionEvents.push(eventFor(this, { documentType: "transfer", documentId: transferId, eventType: "DISCREPANCY_RECONCILED", fromStatus: current, toStatus, actorId, reason: trimmedReason, timestamp, details: { reference_id: referenceId, transfer_line_id: line.transfer_line_id, resolved_quantity: amount, resolution: "shortage_writeoff", remaining_in_transit: outstandingAfter } }));
    next.distributionEvents.push(eventFor(this, { documentType: "request", documentId: transfer.request_id, eventType: "RECONCILED", fromStatus: statusOf(state, "request", transfer.request_id), toStatus, actorId, reason: trimmedReason, timestamp, details: { transfer_id: transferId, remaining_in_transit: outstandingAfter } }));
    this.repository.commit(next);
    return { transferId, status: toStatus, remainingInTransit: outstandingAfter, movement: clone(movement) };
  }
}

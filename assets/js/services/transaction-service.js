function normalizeSearch(value) {
  return String(value ?? "").trim().toLocaleLowerCase("id-ID");
}

function compareValues(left, right) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), "id-ID", { numeric: true, sensitivity: "base" });
}

export class TransactionService {
  constructor({ repository } = {}) {
    if (!repository || typeof repository.load !== "function") {
      throw new TypeError("TransactionService memerlukan repository demo yang mendukung load.");
    }
    this.repository = repository;
  }

  list({
    query = "",
    branchId = "all",
    dateFrom = "",
    dateTo = "",
    status = "all",
    sortBy = "created_at",
    sortDirection = "desc",
    page = 1,
    pageSize = 10,
  } = {}) {
    const state = this.repository.load();
    const search = normalizeSearch(query);
    const branchById = new Map(state.branches.map((branch) => [branch.branch_id, branch]));
    const paymentsBySale = new Map((state.payments ?? []).map((payment) => [payment.sale_id, payment]));
    const allowedSort = new Set(["created_at", "transaction_number", "net_total_idr", "status"]);
    const sortField = allowedSort.has(sortBy) ? sortBy : "created_at";
    const direction = sortDirection === "asc" ? 1 : -1;
    const normalizedPageSize = Math.min(100, Math.max(1, Math.trunc(Number(pageSize) || 10)));
    const normalizedPage = Math.max(1, Math.trunc(Number(page) || 1));

    const rows = (state.sales ?? []).filter((sale) => {
      if (branchId !== "all" && sale.branch_id !== branchId) return false;
      if (dateFrom && sale.effective_date < dateFrom) return false;
      if (dateTo && sale.effective_date > dateTo) return false;
      if (status !== "all" && sale.status !== status) return false;
      if (!search) return true;
      return [sale.transaction_number, ...sale.items.flatMap((item) => [item.sku_snapshot, item.name_snapshot])]
        .some((value) => normalizeSearch(value).includes(search));
    }).map((sale) => ({
      sale: { ...sale, items: sale.items.map((item) => ({
        ...item,
        allocations: item.allocations.map((allocation) => ({ ...allocation })),
      })) },
      payment: paymentsBySale.get(sale.sale_id) ? { ...paymentsBySale.get(sale.sale_id) } : null,
      branch: { ...branchById.get(sale.branch_id) },
    }));

    rows.sort((left, right) => {
      const compared = compareValues(left.sale[sortField], right.sale[sortField]);
      return compared === 0
        ? compareValues(left.sale.transaction_number, right.sale.transaction_number) * direction
        : compared * direction;
    });
    const total = rows.length;
    const pageCount = Math.ceil(total / normalizedPageSize);
    const currentPage = Math.min(normalizedPage, Math.max(1, pageCount));
    const offset = (currentPage - 1) * normalizedPageSize;
    return {
      rows: rows.slice(offset, offset + normalizedPageSize),
      total,
      page: currentPage,
      pageSize: normalizedPageSize,
      pageCount,
    };
  }

  getDetail(saleId) {
    const state = this.repository.load();
    const sale = (state.sales ?? []).find((record) => record.sale_id === saleId);
    if (!sale) return null;
    return {
      sale: {
        ...sale,
        items: sale.items.map((item) => ({
          ...item,
          price_rule_snapshot: { ...item.price_rule_snapshot },
          allocations: item.allocations.map((allocation) => ({ ...allocation })),
        })),
      },
      payment: (state.payments ?? []).find((payment) => payment.sale_id === saleId) ?? null,
      shift: (state.cashShifts ?? []).find((shift) => shift.shift_id === sale.shift_id) ?? null,
      branch: state.branches.find((branch) => branch.branch_id === sale.branch_id) ?? null,
      cashMovement: (state.cashMovements ?? []).find((movement) => movement.sale_id === saleId) ?? null,
    };
  }
}

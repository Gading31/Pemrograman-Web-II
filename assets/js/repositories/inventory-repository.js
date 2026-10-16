export function createInventoryRepository({ repository }) {
  if (!repository || typeof repository.load !== "function" || typeof repository.commit !== "function") {
    throw new TypeError("Inventory repository membutuhkan repository snapshot yang mendukung load dan commit.");
  }

  return Object.freeze({
    load() {
      return repository.load();
    },
    commit(state) {
      return repository.commit(state);
    },
    listWarehouses(state = repository.load()) {
      return state.warehouses.map((item) => ({ ...item }));
    },
    listLocations(warehouseId = "all", state = repository.load()) {
      return state.stockLocations
        .filter((item) => warehouseId === "all" || item.warehouse_id === warehouseId)
        .map((item) => ({ ...item }));
    },
    listBatches(filters = {}, state = repository.load()) {
      return state.inventoryBatches
        .filter((item) => filters.warehouseId === undefined || filters.warehouseId === "all" || item.warehouse_id === filters.warehouseId)
        .filter((item) => filters.productId === undefined || filters.productId === "all" || item.product_id === filters.productId)
        .map((item) => ({ ...item }));
    },
    listMovements(filters = {}, state = repository.load()) {
      const batchIds = filters.batchIds ? new Set(filters.batchIds) : null;
      return state.stockMovements
        .filter((item) => filters.warehouseId === undefined || filters.warehouseId === "all" || item.warehouse_id === filters.warehouseId)
        .filter((item) => !batchIds || batchIds.has(item.inventory_batch_id))
        .map((item) => ({ ...item }));
    },
  });
}

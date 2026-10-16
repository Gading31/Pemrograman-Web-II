export function createDistributionRepository({ repository } = {}) {
  if (!repository || typeof repository.load !== "function" || typeof repository.commit !== "function") {
    throw new TypeError("Distribution repository membutuhkan repository snapshot yang mendukung load dan commit.");
  }

  return Object.freeze({
    load() { return repository.load(); },
    commit(state) { return repository.commit(state); },
    listRequests(state = repository.load()) { return state.stockRequests.map((item) => structuredClone(item)); },
    listTransfers(state = repository.load()) { return state.stockTransfers.map((item) => structuredClone(item)); },
    listReceipts(state = repository.load()) { return state.distributionReceipts.map((item) => structuredClone(item)); },
    listEvents(state = repository.load()) { return state.distributionEvents.map((item) => structuredClone(item)); },
  });
}

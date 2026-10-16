export const SESSION_STORAGE_KEY = "nusantara-pos-demo-session-v1";

export class SessionRepositoryError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "SessionRepositoryError";
    this.code = code;
  }
}

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch (error) {
    throw new SessionRepositoryError("SESSION_STORAGE_UNAVAILABLE", "Penyimpanan sesi demo tidak tersedia.", error);
  }
}

export function createSessionRepository(storage = null) {
  return Object.freeze({
    load() {
      let raw;
      try {
        raw = resolveStorage(storage).getItem(SESSION_STORAGE_KEY);
      } catch (error) {
        if (error instanceof SessionRepositoryError) throw error;
        throw new SessionRepositoryError("SESSION_READ_FAILED", "Sesi demo tidak dapat dibaca.", error);
      }
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch (error) {
        throw new SessionRepositoryError("SESSION_DATA_INVALID", "Sesi demo tersimpan tidak valid.", error);
      }
    },
    save(session) {
      try {
        resolveStorage(storage).setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      } catch (error) {
        if (error instanceof SessionRepositoryError) throw error;
        throw new SessionRepositoryError("SESSION_WRITE_FAILED", "Sesi demo tidak dapat disimpan.", error);
      }
    },
    clear() {
      try {
        resolveStorage(storage).removeItem(SESSION_STORAGE_KEY);
      } catch (error) {
        if (error instanceof SessionRepositoryError) throw error;
        throw new SessionRepositoryError("SESSION_CLEAR_FAILED", "Sesi demo tidak dapat dihapus.", error);
      }
    },
  });
}

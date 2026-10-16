import { DEMO_ACCOUNTS } from "../data/demo-accounts.js";

export const ADMINISTRATION_STORAGE_KEY = "nusantara-pos-administration-v1";
export const ADMINISTRATION_SCHEMA_VERSION = 1;

export class AdministrationRepositoryError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "AdministrationRepositoryError";
    this.code = code;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function initialState() {
  return {
    schema_version: ADMINISTRATION_SCHEMA_VERSION,
    users: DEMO_ACCOUNTS.map((account) => ({ ...account, status: "active", auth_version: 1 })),
    organization_settings: {
      organization_id: "ORG-001",
      display_name: "Minimarket Nusantara",
      contact_email: "",
      contact_phone: "",
      receipt_footer: "",
    },
  };
}

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch (error) {
    throw new AdministrationRepositoryError("ADMIN_STORAGE_UNAVAILABLE", "Penyimpanan administrasi demo tidak tersedia.", error);
  }
}

function validateState(state) {
  if (!state || state.schema_version !== ADMINISTRATION_SCHEMA_VERSION
    || !Array.isArray(state.users) || !state.organization_settings
    || state.organization_settings.organization_id !== "ORG-001") {
    throw new AdministrationRepositoryError("ADMIN_DATA_INVALID", "Data administrasi demo tidak sesuai versi dan struktur yang didukung.");
  }
  const ids = new Set();
  const usernames = new Set();
  for (const user of state.users) {
    if (!user || typeof user.user_id !== "string" || !user.user_id.trim()
      || ids.has(user.user_id)
      || typeof user.username !== "string" || !user.username.trim()
      || usernames.has(user.username.trim().toLocaleLowerCase("id-ID"))
      || typeof user.display_name !== "string" || !user.display_name.trim()
      || !["HQ_ADMIN", "CASHIER"].includes(user.role)
      || !["active", "inactive"].includes(user.status)
      || (user.role === "HQ_ADMIN" && user.branch_id !== null)
      || (user.role === "CASHIER" && !["BR-JKT-01", "BR-BDG-01", "BR-MDN-01", "BR-SBY-01", "BR-MKS-01"].includes(user.branch_id))
      || (user.auth_version !== undefined && (!Number.isSafeInteger(user.auth_version) || user.auth_version < 1))
      || typeof user.password !== "string" || !user.password) {
      throw new AdministrationRepositoryError("ADMIN_DATA_INVALID", "Data akun simulasi memiliki identitas, role, cabang, atau status yang tidak valid.");
    }
    ids.add(user.user_id);
    usernames.add(user.username.trim().toLocaleLowerCase("id-ID"));
  }
  if (!state.users.some((user) => user.role === "HQ_ADMIN" && user.status === "active")) {
    throw new AdministrationRepositoryError("ADMIN_LAST_ADMIN_REQUIRED", "Minimal satu akun Admin Pusat aktif harus tersedia.");
  }
  const settings = state.organization_settings;
  if (typeof settings.display_name !== "string" || !settings.display_name.trim()
    || typeof settings.contact_email !== "string" || typeof settings.contact_phone !== "string"
    || typeof settings.receipt_footer !== "string" || settings.receipt_footer.length > 120) {
    throw new AdministrationRepositoryError("ADMIN_DATA_INVALID", "Pengaturan organisasi atau footer struk tidak valid.");
  }
  return true;
}

// One directory is shared by AdministrationService and AuthService. It is not a second login mechanism.
export function createAdministrationRepository(storage = null) {
  return Object.freeze({
    load() {
      let raw;
      try {
        raw = resolveStorage(storage).getItem(ADMINISTRATION_STORAGE_KEY);
      } catch (error) {
        if (error instanceof AdministrationRepositoryError) throw error;
        throw new AdministrationRepositoryError("ADMIN_READ_FAILED", "Direktori pengguna dan pengaturan tidak dapat dibaca.", error);
      }
      if (raw === null) return initialState();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new AdministrationRepositoryError("ADMIN_DATA_INVALID", "Direktori pengguna dan pengaturan tersimpan tidak dapat dibaca.", error);
      }
      validateState(parsed);
      return clone(parsed);
    },
    commit(nextState) {
      validateState(nextState);
      const snapshot = clone(nextState);
      try {
        resolveStorage(storage).setItem(ADMINISTRATION_STORAGE_KEY, JSON.stringify(snapshot));
      } catch (error) {
        if (error instanceof AdministrationRepositoryError) throw error;
        throw new AdministrationRepositoryError("ADMIN_WRITE_FAILED", "Perubahan administrasi gagal disimpan. Tidak ada perubahan yang diterapkan.", error);
      }
      return clone(snapshot);
    },
  });
}

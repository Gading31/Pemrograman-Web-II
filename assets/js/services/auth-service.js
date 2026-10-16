import { DEMO_ACCOUNTS } from "../data/demo-accounts.js";
import { createSessionRepository, SessionRepositoryError } from "../repositories/session-repository.js";

export const AUTH_SESSION_VERSION = 1;

export class AuthError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "AuthError";
    this.code = code;
  }
}

function copy(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

function publicUser(account) {
  return {
    user_id: account.user_id,
    username: account.username,
    display_name: account.display_name,
    role: account.role,
    role_label: account.role_label,
    branch_id: account.branch_id,
    auth_version: account.auth_version ?? 1,
  };
}

export class AuthService {
  constructor({ sessionRepository = createSessionRepository(), userRepository = null, accounts = DEMO_ACCOUNTS, now = () => new Date() } = {}) {
    this.sessionRepository = sessionRepository;
    this.userRepository = userRepository;
    this.accounts = accounts;
    this.now = now;
    this.session = null;
  }

  #accounts() {
    if (this.userRepository) return this.userRepository.load().users;
    return this.accounts ?? [];
  }

  getDemoAccounts() {
    return this.#accounts().map(({ user_id, username, display_name, role, role_label, branch_id, status }) => ({
      user_id, username, display_name, role, role_label, branch_id, status: status ?? "active",
    }));
  }

  getDemoPresentationCredentials(userId) {
    try {
      const account = this.#accounts().find((entry) => entry.user_id === userId && (entry.status ?? "active") === "active");
      return account ? { user_id: account.user_id, username: account.username, password: account.password, display_name: account.display_name, role_label: account.role_label } : null;
    } catch { return null; }
  }

  login({ username, password } = {}) {
    const normalizedUsername = String(username ?? "").trim().toLocaleLowerCase("id-ID");
    let account;
    try {
      account = this.#accounts().find((entry) => entry.username.toLocaleLowerCase("id-ID") === normalizedUsername);
    } catch (error) {
      throw new AuthError("AUTH_DIRECTORY_UNAVAILABLE", "Direktori akun simulasi tidak dapat dibaca.", error);
    }
    if (!account || (account.status ?? "active") !== "active" || typeof password !== "string" || password !== account.password) {
      throw new AuthError("AUTH_INVALID_CREDENTIALS", "Nama pengguna atau kata sandi tidak cocok.");
    }

    const session = {
      version: AUTH_SESSION_VERSION,
      user: publicUser(account),
      issued_at: this.now().toISOString(),
    };
    try {
      this.sessionRepository.save(session);
    } catch (error) {
      throw new AuthError("AUTH_SESSION_SAVE_FAILED", "Sesi gagal disimpan. Periksa izin penyimpanan browser lalu coba lagi.", error);
    }
    this.session = session;
    return copy(session);
  }

  restoreSession() {
    let saved;
    try {
      saved = this.sessionRepository.load();
    } catch (error) {
      if (!(error instanceof SessionRepositoryError)) throw error;
      this.session = null;
      return null;
    }
    if (!saved || saved.version !== AUTH_SESSION_VERSION || typeof saved.issued_at !== "string") {
      this.session = null;
      return null;
    }

    let account;
    try { account = this.#accounts().find((entry) => entry.user_id === saved.user?.user_id); }
    catch { account = null; }
    if (!account || (account.status ?? "active") !== "active" || saved.user?.role !== account.role || saved.user?.branch_id !== account.branch_id
      || (saved.user?.auth_version ?? 1) !== (account.auth_version ?? 1)) {
      this.session = null;
      try { this.sessionRepository.clear(); } catch { /* Data sesi tetap ditolak pada pemuatan berikutnya. */ }
      return null;
    }

    this.session = { version: AUTH_SESSION_VERSION, user: publicUser(account), issued_at: saved.issued_at };
    return copy(this.session);
  }

  getSession() {
    if (this.session) {
      let account;
      try { account = this.#accounts().find((entry) => entry.user_id === this.session.user.user_id); }
      catch { account = null; }
      if (!account || (account.status ?? "active") !== "active"
        || account.role !== this.session.user.role || account.branch_id !== this.session.user.branch_id
        || (account.auth_version ?? 1) !== (this.session.user.auth_version ?? 1)) {
        this.session = null;
        try { this.sessionRepository.clear(); } catch { /* Guard tetap menolak sesi dalam memori. */ }
        return null;
      }
      this.session.user = publicUser(account);
    }
    return copy(this.session);
  }

  refreshSession() {
    const current = this.getSession();
    if (!current) return null;
    const refreshed = { ...current, user: { ...current.user } };
    try { this.sessionRepository.save(refreshed); } catch { /* Sesi aktif tetap tervalidasi dari direktori saat ini. */ }
    this.session = refreshed;
    return copy(refreshed);
  }

  logout() {
    this.session = null;
    try {
      this.sessionRepository.clear();
    } catch (error) {
      throw new AuthError("AUTH_LOGOUT_FAILED", "Sesi tidak dapat dihapus dari penyimpanan browser.", error);
    }
  }
}

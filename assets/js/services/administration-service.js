import { createLocalStorageRepository } from "../repositories/local-storage-repository.js";
import { createAdministrationRepository } from "../repositories/administration-repository.js";
import { MULTI_BRANCH_DEMO_CASHIERS } from "../data/demo-accounts.js";

export const ADMIN_ROLE_LABELS = Object.freeze({ HQ_ADMIN: "Admin Pusat", CASHIER: "Kasir" });
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/i;

export class AdministrationError extends Error {
  constructor(code, message, fieldErrors = {}, cause) {
    super(message, { cause });
    this.name = "AdministrationError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

function clean(value) { return String(value ?? "").trim(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function publicUser(user) {
  const { password: _password, ...safe } = user;
  return { ...safe, role_label: ADMIN_ROLE_LABELS[user.role] };
}

function normalizedUserInput(input, branchIds) {
  const displayName = clean(input?.display_name);
  const username = clean(input?.username);
  const role = input?.role;
  const status = input?.status ?? "active";
  const branchId = input?.branch_id || null;
  const password = typeof input?.password === "string" ? input.password : "";
  const fieldErrors = {};
  if (!displayName) fieldErrors.display_name = "Nama pengguna wajib diisi.";
  else if (displayName.length > 80) fieldErrors.display_name = "Nama pengguna maksimal 80 karakter.";
  if (!USERNAME_PATTERN.test(username)) fieldErrors.username = "Gunakan 3–40 karakter: huruf, angka, titik, garis bawah, atau tanda hubung.";
  if (!Object.hasOwn(ADMIN_ROLE_LABELS, role)) fieldErrors.role = "Pilih role yang tersedia.";
  if (!["active", "inactive"].includes(status)) fieldErrors.status = "Pilih status akun yang valid.";
  if (role === "HQ_ADMIN" && branchId !== null) fieldErrors.branch_id = "Admin Pusat tidak ditugaskan ke satu cabang.";
  if (role === "CASHIER" && (!branchId || !branchIds.has(branchId))) fieldErrors.branch_id = "Pilih salah satu cabang aktif yang tersedia.";
  if (input?.requirePassword && (password.trim().length < 8 || password.length > 128)) fieldErrors.password = "Kata sandi simulasi harus 8–128 karakter.";
  if (Object.keys(fieldErrors).length) throw new AdministrationError("ADMIN_VALIDATION_FAILED", "Periksa kembali data pengguna.", fieldErrors);
  return { display_name: displayName, username: username.toLocaleLowerCase("id-ID"), role, role_label: ADMIN_ROLE_LABELS[role], branch_id: role === "HQ_ADMIN" ? null : branchId, status, ...(input?.requirePassword ? { password } : {}) };
}

function sensitiveChanges(current, next) {
  const changes = [];
  for (const [field, label] of [["username", "Username login"], ["role", "Role"], ["branch_id", "Penugasan cabang"], ["status", "Status akun"]]) {
    if (current[field] !== next[field]) changes.push({ field, label, before: current[field], after: next[field] });
  }
  return changes;
}

export class AdministrationService {
  constructor({ repository = createAdministrationRepository(), workspaceRepository = createLocalStorageRepository(), idFactory = null } = {}) {
    this.repository = repository;
    this.workspaceRepository = workspaceRepository;
    this.idFactory = idFactory ?? ((prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 14)}`);
  }

  #branchIds() {
    let branches;
    try { branches = this.workspaceRepository.load().branches; }
    catch (error) { throw new AdministrationError("ADMIN_WORKSPACE_UNAVAILABLE", "Cabang canonical tidak dapat dibaca dari repository demo.", {}, error); }
    return new Set((branches ?? []).filter((branch) => branch.status === "active").map((branch) => branch.branch_id));
  }

  listUsers(filters = {}) {
    const state = this.repository.load();
    const search = clean(filters.search).toLocaleLowerCase("id-ID");
    const role = filters.role ?? "all";
    const status = filters.status ?? "all";
    const branchId = filters.branch_id ?? "all";
    const branches = this.workspaceRepository.load().branches;
    const branchNames = new Map(branches.map((branch) => [branch.branch_id, branch.name]));
    return state.users
      .filter((user) => (!search || `${user.username} ${user.display_name}`.toLocaleLowerCase("id-ID").includes(search))
        && (role === "all" || user.role === role)
        && (status === "all" || user.status === status)
        && (branchId === "all" || user.branch_id === branchId))
      .sort((a, b) => a.display_name.localeCompare(b.display_name, "id-ID"))
      .map((user) => ({ ...publicUser(user), branch_name: user.branch_id ? branchNames.get(user.branch_id) ?? "Cabang tidak tersedia" : "Seluruh cabang" }));
  }

  getUser(userId) {
    const user = this.repository.load().users.find((item) => item.user_id === userId);
    return user ? publicUser(user) : null;
  }

  getAccountsForAuthentication() {
    return this.repository.load().users.map((user) => ({ ...user }));
  }

  previewBranchCashierProvisioning({ actorRole } = {}) {
    if (actorRole !== "HQ_ADMIN") throw new AdministrationError("ADMIN_FORBIDDEN", "Penyiapan akun kasir cabang hanya tersedia untuk Admin Pusat.");
    const state = this.repository.load();
    const workspace = this.workspaceRepository.load();
    const usernames = new Map(state.users.map((user) => [user.username.trim().toLocaleLowerCase("id-ID"), user]));
    const usersById = new Map(state.users.map((user) => [user.user_id, user]));
    const branchesById = new Map(workspace.branches.map((branch) => [branch.branch_id, branch]));
    const accounts = MULTI_BRANCH_DEMO_CASHIERS.map((candidate) => {
      const existingById = usersById.get(candidate.user_id);
      const existingByUsername = usernames.get(candidate.username.toLocaleLowerCase("id-ID"));
      const branch = branchesById.get(candidate.branch_id);
      const existingAssignment = existingById
        ?? (existingByUsername?.role === "CASHIER" && existingByUsername.branch_id === candidate.branch_id ? existingByUsername : null);
      let status;
      let reason;
      if (!branch || branch.status !== "active") {
        status = "branch-unavailable";
        reason = "Cabang tujuan tidak aktif atau tidak tersedia. Akun tidak ditambahkan.";
      } else if (existingAssignment && (existingAssignment.role !== "CASHIER" || existingAssignment.branch_id !== candidate.branch_id)) {
        status = "assignment-mismatch";
        const assignedBranch = branchesById.get(existingAssignment.branch_id)?.name ?? existingAssignment.branch_id ?? "belum ditugaskan";
        const activeState = existingAssignment.status === "active" ? "aktif" : "nonaktif";
        reason = `Akun ${activeState} saat ini ditugaskan ke ${assignedBranch} dengan role ${existingAssignment.role}; targetnya ${branch.name}. Selesaikan manual. Akun tidak dipindah atau diaktifkan.`;
      } else if (existingAssignment && existingAssignment.status !== "active") {
        status = "inactive";
        reason = "Akun pada cabang ini berstatus nonaktif. Aktifkan secara manual bila sesuai; provisioning tidak mengubah status.";
      } else if (existingAssignment) {
        status = "active-correct";
        reason = existingAssignment.user_id === candidate.user_id
          ? "Akun aktif sudah ditugaskan ke cabang yang sesuai. Perubahan profil, username, dan password Admin tetap dipertahankan."
          : "Username sudah digunakan oleh akun kasir aktif pada cabang yang sesuai. Akun duplikat tidak dibuat.";
      } else if (existingByUsername) {
        status = "username-conflict";
        const conflictBranch = branchesById.get(existingByUsername.branch_id)?.name ?? existingByUsername.branch_id ?? "tanpa cabang";
        reason = `Username digunakan akun lain (${existingByUsername.display_name}, ${conflictBranch}). Selesaikan konflik manual; akun dan password tidak diubah.`;
      } else {
        status = "will-add";
        reason = "Akun belum tersedia. Akun demo baru akan ditambahkan setelah konfirmasi.";
      }
      return {
        user_id: candidate.user_id,
        username: candidate.username,
        display_name: candidate.display_name,
        branch_id: candidate.branch_id,
        branch_name: branch?.name ?? candidate.branch_id,
        status,
        reason,
        existing_display_name: existingAssignment?.display_name ?? existingByUsername?.display_name ?? "",
      };
    });
    return {
      accounts,
      toAdd: accounts.filter((account) => account.status === "will-add").length,
      canProvision: accounts.every((account) => ["active-correct", "will-add"].includes(account.status)),
      effects: [
        "Akun baru ditambahkan ke direktori yang sama dengan AuthService.",
        "Akun aktif yang sudah sesuai dipertahankan; akun nonaktif, penugasan berbeda, dan konflik harus diselesaikan manual.",
        "Provisioning tidak mengaktifkan atau memindahkan akun, dan tidak menimpa profil, username, atau password.",
        "Transaksi, shift, stok, dan ledger tidak disentuh.",
      ],
    };
  }

  provisionBranchCashiers({ actorRole, confirmed = false } = {}) {
    if (actorRole !== "HQ_ADMIN") throw new AdministrationError("ADMIN_FORBIDDEN", "Penyiapan akun kasir cabang hanya tersedia untuk Admin Pusat.");
    if (!confirmed) throw new AdministrationError("ADMIN_BRANCH_CASHIER_CONFIRMATION_REQUIRED", "Konfirmasikan daftar akun demo sebelum menambahkannya.");
    const preview = this.previewBranchCashierProvisioning({ actorRole });
    if (!preview.canProvision) {
      throw new AdministrationError("ADMIN_BRANCH_CASHIER_CONFLICT", "Ada akun nonaktif, penugasan berbeda, konflik username, atau cabang tidak tersedia. Selesaikan ketidaksesuaian secara manual; tidak ada data akun yang diubah.", {}, { preview });
    }
    const accountsToAdd = preview.accounts.filter((account) => account.status === "will-add");
    if (!accountsToAdd.length) return { addedCount: 0, existingCount: preview.accounts.length, users: [] };
    const state = this.repository.load();
    const next = clone(state);
    const candidateById = new Map(MULTI_BRANCH_DEMO_CASHIERS.map((account) => [account.user_id, account]));
    const newUsers = accountsToAdd.map(({ user_id }) => ({
      ...candidateById.get(user_id),
      status: "active",
      auth_version: 1,
    }));
    next.users.push(...newUsers);
    this.repository.commit(next);
    return { addedCount: newUsers.length, existingCount: preview.accounts.length - newUsers.length, users: newUsers.map(publicUser) };
  }

  createUser(input) {
    const state = this.repository.load();
    const nextUser = normalizedUserInput({ ...input, requirePassword: true }, this.#branchIds());
    if (state.users.some((user) => user.username.toLocaleLowerCase("id-ID") === nextUser.username.toLocaleLowerCase("id-ID"))) {
      throw new AdministrationError("ADMIN_USERNAME_DUPLICATE", "Nama pengguna sudah digunakan (pencocokan tidak membedakan huruf besar/kecil).", { username: "Pilih nama pengguna yang unik." });
    }
    const next = clone(state);
    const newUser = { user_id: this.idFactory("USER"), ...nextUser, auth_version: 1 };
    next.users.push(newUser);
    this.repository.commit(next);
    return publicUser(newUser);
  }

  previewSensitiveChanges(userId, input) {
    const current = this.repository.load().users.find((user) => user.user_id === userId);
    if (!current) throw new AdministrationError("ADMIN_USER_NOT_FOUND", "Pengguna tidak ditemukan.");
    const nextUser = normalizedUserInput(input, this.#branchIds());
    if (this.repository.load().users.some((user) => user.user_id !== userId && user.username.toLocaleLowerCase("id-ID") === nextUser.username.toLocaleLowerCase("id-ID"))) {
      throw new AdministrationError("ADMIN_USERNAME_DUPLICATE", "Nama pengguna sudah digunakan.", { username: "Pilih nama pengguna yang unik." });
    }
    return sensitiveChanges(current, nextUser).map((change) => ({ ...change }));
  }

  updateUser(userId, input, { confirmedSensitive = false } = {}) {
    const state = this.repository.load();
    const index = state.users.findIndex((user) => user.user_id === userId);
    if (index < 0) throw new AdministrationError("ADMIN_USER_NOT_FOUND", "Pengguna tidak ditemukan.");
    const current = state.users[index];
    const nextUser = normalizedUserInput(input, this.#branchIds());
    if (state.users.some((user) => user.user_id !== userId && user.username.toLocaleLowerCase("id-ID") === nextUser.username.toLocaleLowerCase("id-ID"))) {
      throw new AdministrationError("ADMIN_USERNAME_DUPLICATE", "Nama pengguna sudah digunakan.", { username: "Pilih nama pengguna yang unik." });
    }
    const changes = sensitiveChanges(current, nextUser);
    if (changes.length && !confirmedSensitive) {
      throw new AdministrationError("ADMIN_CONFIRMATION_REQUIRED", "Konfirmasikan perubahan role, cabang, atau status sebelum disimpan.", {}, { changes });
    }
    const assignmentWillBeRevoked = current.role !== nextUser.role || current.branch_id !== nextUser.branch_id
      || (current.status === "active" && nextUser.status === "inactive");
    if (assignmentWillBeRevoked && this.workspaceRepository.load().cashShifts?.some((shift) => shift.cashier_id === userId && shift.status === "active")) {
      throw new AdministrationError("ADMIN_USER_ACTIVE_SHIFT", "Tutup shift aktif pengguna sebelum mengubah role, cabang, atau menonaktifkan akun.");
    }
    const activeAdmins = state.users.filter((user) => user.user_id !== userId && user.role === "HQ_ADMIN" && user.status === "active").length
      + (nextUser.role === "HQ_ADMIN" && nextUser.status === "active" ? 1 : 0);
    if (activeAdmins < 1) throw new AdministrationError("ADMIN_LAST_ADMIN_REQUIRED", "Admin Pusat aktif terakhir tidak dapat dipindah role atau dinonaktifkan.");
    const next = clone(state);
    next.users[index] = { ...current, ...nextUser };
    this.repository.commit(next);
    return { user: publicUser(next.users[index]), sensitiveChanges: changes };
  }

  resetDemoPassword(userId, password, { confirmed = false } = {}) {
    const state = this.repository.load();
    const index = state.users.findIndex((user) => user.user_id === userId);
    if (index < 0) throw new AdministrationError("ADMIN_USER_NOT_FOUND", "Pengguna tidak ditemukan.");
    if (typeof password !== "string" || password.trim().length < 8 || password.length > 128) {
      throw new AdministrationError("ADMIN_PASSWORD_INVALID", "Kata sandi demo baru harus 8–128 karakter.", { password: "Gunakan minimal 8 karakter dan maksimal 128 karakter." });
    }
    if (!confirmed) {
      throw new AdministrationError("ADMIN_PASSWORD_RESET_CONFIRMATION_REQUIRED", "Konfirmasikan reset kata sandi demo sebelum disimpan.");
    }
    const currentVersion = state.users[index].auth_version ?? 1;
    if (currentVersion >= Number.MAX_SAFE_INTEGER) {
      throw new AdministrationError("ADMIN_PASSWORD_VERSION_EXHAUSTED", "Versi kredensial akun tidak dapat dinaikkan lagi.");
    }
    const next = clone(state);
    next.users[index] = { ...next.users[index], password, auth_version: currentVersion + 1 };
    this.repository.commit(next);
    return publicUser(next.users[index]);
  }

  deleteUser() {
    throw new AdministrationError("ADMIN_USER_DELETE_FORBIDDEN", "Akun dinonaktifkan agar relasi pengguna dan histori transaksi tetap utuh; penghapusan permanen tidak tersedia.");
  }

  getSettings() {
    const state = this.repository.load();
    const workspace = this.workspaceRepository.load();
    return {
      organization: { ...workspace.organization, ...state.organization_settings },
      timezone: workspace.meta?.timezone ?? "Asia/Jakarta",
      branches: workspace.branches.map((branch) => ({ ...branch, region_name: workspace.regions.find((region) => region.region_id === branch.region_id)?.name ?? "Wilayah" })),
      settings: { ...state.organization_settings },
    };
  }

  saveSettings(input) {
    const state = this.repository.load();
    const displayName = clean(input?.display_name);
    const contactEmail = clean(input?.contact_email);
    const contactPhone = clean(input?.contact_phone);
    const receiptFooter = String(input?.receipt_footer ?? "").trim();
    const errors = {};
    if (!displayName || displayName.length > 100) errors.display_name = "Nama organisasi wajib diisi (maksimal 100 karakter).";
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) errors.contact_email = "Masukkan alamat email yang valid.";
    if (contactPhone.length > 32) errors.contact_phone = "Nomor kontak maksimal 32 karakter.";
    if (receiptFooter.length > 120) errors.receipt_footer = "Footer struk maksimal 120 karakter.";
    if (Object.keys(errors).length) throw new AdministrationError("ADMIN_SETTINGS_INVALID", "Periksa data pengaturan.", errors);
    const next = clone(state);
    next.organization_settings = {
      organization_id: "ORG-001",
      display_name: displayName,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      receipt_footer: receiptFooter,
    };
    this.repository.commit(next);
    return this.getSettings();
  }

  getReceiptFooter() {
    return this.repository.load().organization_settings.receipt_footer;
  }
}

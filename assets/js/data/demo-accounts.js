// Kredensial ini hanya untuk presentasi frontend lokal, bukan rahasia atau akun produksi.
export const MULTI_BRANCH_DEMO_CASHIERS = Object.freeze([
  Object.freeze({
    user_id: "DEMO-CASHIER-BDG-001",
    username: "kasir.bdg",
    password: "demo-bandung-2026",
    display_name: "Kasir Bandung",
    role: "CASHIER",
    role_label: "Kasir",
    branch_id: "BR-BDG-01",
  }),
  Object.freeze({
    user_id: "DEMO-CASHIER-MDN-001",
    username: "kasir.mdn",
    password: "demo-medan-2026",
    display_name: "Kasir Medan",
    role: "CASHIER",
    role_label: "Kasir",
    branch_id: "BR-MDN-01",
  }),
  Object.freeze({
    user_id: "DEMO-CASHIER-SBY-001",
    username: "kasir.sby",
    password: "demo-surabaya-2026",
    display_name: "Kasir Surabaya",
    role: "CASHIER",
    role_label: "Kasir",
    branch_id: "BR-SBY-01",
  }),
  Object.freeze({
    user_id: "DEMO-CASHIER-MKS-001",
    username: "kasir.mks",
    password: "demo-makassar-2026",
    display_name: "Kasir Makassar",
    role: "CASHIER",
    role_label: "Kasir",
    branch_id: "BR-MKS-01",
  }),
]);

export const DEMO_ACCOUNTS = Object.freeze([
  Object.freeze({
    user_id: "DEMO-HQ-001",
    username: "admin.pusat",
    password: "demo-admin-2026",
    display_name: "Admin Pusat",
    role: "HQ_ADMIN",
    role_label: "Admin Pusat",
    branch_id: null,
  }),
  Object.freeze({
    user_id: "DEMO-CASHIER-001",
    username: "kasir.jkt",
    password: "demo-kasir-2026",
    display_name: "Kasir Jakarta",
    role: "CASHIER",
    role_label: "Kasir",
    branch_id: "BR-JKT-01",
  }),
  ...MULTI_BRANCH_DEMO_CASHIERS,
]);

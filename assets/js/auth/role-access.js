export const APP_ROUTE_ACCESS = Object.freeze({
  overview: Object.freeze(["HQ_ADMIN"]),
  reports: Object.freeze(["HQ_ADMIN"]),
  products: Object.freeze(["HQ_ADMIN"]),
  pricing: Object.freeze(["HQ_ADMIN"]),
  inventory: Object.freeze(["HQ_ADMIN"]),
  distribution: Object.freeze(["HQ_ADMIN"]),
  users: Object.freeze(["HQ_ADMIN"]),
  settings: Object.freeze(["HQ_ADMIN"]),
  transactions: Object.freeze(["HQ_ADMIN", "CASHIER"]),
  shifts: Object.freeze(["CASHIER"]),
  pos: Object.freeze(["CASHIER"]),
});

export const ROLE_HOME_ROUTE = Object.freeze({ HQ_ADMIN: "overview", CASHIER: "pos" });
export const ROUTE_LABELS = Object.freeze({
  overview: "Dashboard",
  reports: "Laporan",
  products: "Master Produk",
  pricing: "Harga Regional",
  inventory: "Persediaan & Batch",
  distribution: "Distribusi",
  transactions: "Riwayat Transaksi",
  users: "Pengguna & Akses",
  settings: "Pengaturan",
  shifts: "Shift & Rekonsiliasi",
  pos: "Kasir / POS",
});

const DEMO_ROUTES = new Set([...Object.keys(APP_ROUTE_ACCESS), "login", "access-denied"]);

export function canAccessRoute(session, route) {
  if (!session) return route === "login";
  if (route === "access-denied") return true;
  return Boolean(APP_ROUTE_ACCESS[route]?.includes(session.user?.role));
}

export function hasPermission(session, permission) {
  const role = session?.user?.role;
  const permissions = {
    HQ_ADMIN: new Set(["workspace:manage", "reports:view", "distribution:hq", "transactions:view-all", "users:manage", "settings:manage"]),
    CASHIER: new Set(["pos:checkout", "shift:manage-own", "transactions:view-own-branch"]),
  };
  return permissions[role]?.has(permission) ?? false;
}

export function landingRoute(session) {
  return ROLE_HOME_ROUTE[session?.user?.role] ?? "login";
}

export function resolveRoute(requestedRoute, session) {
  const requested = String(requestedRoute ?? "").trim();
  if (!session) {
    return {
      route: "login",
      returnTo: requested && DEMO_ROUTES.has(requested) && !["login", "access-denied"].includes(requested) ? requested : null,
      deniedRoute: null,
    };
  }
  if (requested === "login") return { route: landingRoute(session), returnTo: null, deniedRoute: null };
  if (requested === "access-denied") return { route: "access-denied", returnTo: null, deniedRoute: null };
  if (canAccessRoute(session, requested)) return { route: requested, returnTo: null, deniedRoute: null };
  if (DEMO_ROUTES.has(requested)) return { route: "access-denied", returnTo: null, deniedRoute: requested };
  return { route: landingRoute(session), returnTo: null, deniedRoute: null };
}

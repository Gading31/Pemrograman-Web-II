const PAGE_TEMPLATE_ROUTES = Object.freeze([
  "overview",
  "reports",
  "products",
  "pricing",
  "inventory",
  "pos",
  "transactions",
  "shifts",
  "distribution",
  "users",
  "settings",
  "login",
  "access-denied",
]);

const LIVE_SERVER_INJECTION_MARKER = "<!-- Code injected by live-server -->";

export function removeLiveServerReloadInjection(source) {
  const markerIndex = source.indexOf(LIVE_SERVER_INJECTION_MARKER);
  if (markerIndex < 0) return source;

  const scriptStart = source.indexOf("<script", markerIndex + LIVE_SERVER_INJECTION_MARKER.length);
  const scriptEnd = scriptStart < 0 ? -1 : source.indexOf("</script>", scriptStart);
  if (scriptStart < 0 || scriptEnd < 0) return source;

  // Live Server inserts this hook into HTML fragments before their first closing
  // tag. Remove only its marked script so the fragment parser receives the view.
  return `${source.slice(0, markerIndex)}${source.slice(scriptEnd + "</script>".length)}`;
}

async function fetchPageTemplate(route) {
  const url = new URL(`../../pages/${route}.html`, import.meta.url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Template halaman ${route} gagal dimuat (${response.status}).`);
  }

  const template = document.createElement("template");
  template.innerHTML = removeLiveServerReloadInjection((await response.text()).trim());
  const roots = [...template.content.children];
  if (roots.length !== 1 || roots[0].dataset.pageView !== route) {
    throw new Error(`Struktur template halaman ${route} tidak valid.`);
  }
  return template.content;
}

export async function loadPageTemplates() {
  const mount = document.querySelector("[data-page-template-root]");
  if (!mount) throw new Error("Tempat pemuatan template halaman tidak ditemukan.");

  const fragments = await Promise.all(PAGE_TEMPLATE_ROUTES.map(fetchPageTemplate));
  for (const fragment of fragments) mount.append(fragment);
  mount.setAttribute("aria-busy", "false");
  return PAGE_TEMPLATE_ROUTES;
}

const STORAGE_KEY = "nusantara-pos-theme";
const THEMES = new Set(["dark", "light"]);

function readSavedTheme() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return THEMES.has(saved) ? saved : null;
  } catch {
    return null;
  }
}

function preferredTheme() {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme, persist = true) {
  const nextTheme = THEMES.has(theme) ? theme : "dark";
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;

  document.querySelectorAll("[data-theme-toggle]").forEach((toggle) => {
    const targetLabel = nextTheme === "dark" ? "Ganti ke tema terang" : "Ganti ke tema gelap";
    toggle.setAttribute("aria-label", targetLabel);
    toggle.setAttribute("title", targetLabel);
    toggle.setAttribute("aria-pressed", String(nextTheme === "dark"));
  });

  document.dispatchEvent(new CustomEvent("app:themechange", { detail: { theme: nextTheme } }));

  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, nextTheme);
    } catch {
      // Tema tetap berlaku sampai halaman ditutup jika penyimpanan browser dibatasi.
    }
  }
}

export function initializeTheme() {
  const initialTheme = readSavedTheme() ?? preferredTheme();
  applyTheme(initialTheme, false);

  document.querySelectorAll("[data-theme-toggle]").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const currentTheme = document.documentElement.dataset.theme;
      applyTheme(currentTheme === "dark" ? "light" : "dark");
    });
  });
}

export function setTheme(theme) {
  if (!THEMES.has(theme)) throw new TypeError("Tema harus dark atau light.");
  applyTheme(theme, true);
  return theme;
}

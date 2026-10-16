import { initializeComponents } from "./components.js";
import { initializeNavigation } from "./navigation.js";
import { initializeTheme } from "./theme.js";
import { initializeProductsPage } from "./pages/products-page.js";
import { initializePricingPage } from "./pages/pricing-page.js";
import { initializeInventoryPage } from "./pages/inventory-page.js";
import { initializePosPage } from "./pages/pos-page.js";
import { initializeTransactionHistoryPage } from "./pages/transaction-history-page.js";
import { initializeShiftReconciliationPage } from "./pages/shift-reconciliation-page.js";
import { initializeReportingPages } from "./pages/reporting-page.js";
import { initializeDistributionPage } from "./pages/distribution-page.js";
import { initializeLoginPage } from "./pages/login-page.js";
import { initializeUsersPage } from "./pages/users-page.js";
import { initializeSettingsPage } from "./pages/settings-page.js";
import { AuthService } from "./services/auth-service.js";
import { AdministrationService } from "./services/administration-service.js";
import { createAdministrationRepository } from "./repositories/administration-repository.js";
import { createProductImageRepository } from "./repositories/product-image-repository.js";
import { ProductImageService } from "./services/product-image-service.js";
import { setTheme } from "./theme.js";
import { loadPageTemplates } from "./page-template-loader.js";
import { seedFreshPresentationProfile as writeFreshPresentationProfile } from "./data/presentation-seed.js";

function showStartupError(error) {
  console.error("Inisialisasi halaman gagal.", error);
  const mount = document.querySelector("[data-page-template-root]");
  if (!mount) return;
  mount.setAttribute("aria-busy", "false");
  mount.innerHTML = '<div class="page-content" role="alert"><h1>Halaman belum dapat dimuat</h1><p>Template aplikasi gagal dimuat. Muat ulang halaman atau jalankan melalui server lokal.</p></div>';
}

function seedFreshPresentationProfile() {
  writeFreshPresentationProfile({ storage: window.localStorage, now: () => new Date() });
}

async function startApplication() {
  await loadPageTemplates();
  initializeTheme();
  initializeComponents();
  seedFreshPresentationProfile();
  const administrationRepository = createAdministrationRepository();
  const administrationService = new AdministrationService({ repository: administrationRepository });
  const authService = new AuthService({ userRepository: administrationRepository });
  const productImageService = new ProductImageService({ repository: createProductImageRepository() });
  const session = authService.restoreSession();
  const navigation = initializeNavigation({ authService });
  let businessModulesInitialized = false;

  const initializeBusinessModules = () => {
    if (businessModulesInitialized) return;
    businessModulesInitialized = true;
    initializeProductsPage({ productImageService, authService });
    initializePricingPage();
    initializeInventoryPage({ authService });
    initializePosPage({ authService, administrationService, productImageService });
    initializeTransactionHistoryPage({ authService });
    initializeShiftReconciliationPage({ authService });
    initializeReportingPages();
    initializeDistributionPage({ authService });
    initializeUsersPage({ administrationService, authService });
    initializeSettingsPage({ administrationService, authService, setTheme });
  };

  initializeLoginPage({
    authService,
    onAuthenticated: (nextSession) => {
      document.dispatchEvent(new CustomEvent("app:authchange", { detail: { session: nextSession } }));
      initializeBusinessModules();
      navigation.navigate(navigation.getPostLoginRoute(nextSession));
    },
    onLogout: () => {
      document.dispatchEvent(new CustomEvent("app:authchange", { detail: { session: null } }));
      navigation.navigate("login");
    },
  });

  if (session) initializeBusinessModules();
}

startApplication().catch(showStartupError);

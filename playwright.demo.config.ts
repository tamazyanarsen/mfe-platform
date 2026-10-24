import { defineConfig, devices } from "@playwright/test";

// Демо-стенд так, как его отдаёт GitHub Pages: один статический сайт под префиксом пути.
// Перед запуском нужна сборка: `bun run test:e2e:demo` делает её сама.
export default defineConfig({
  testDir: "e2e-demo",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  use: { baseURL: "http://localhost:4173/mfe-platform/", ...devices["Desktop Chrome"] },
  webServer: {
    command: "bun run scripts/serve-demo.ts",
    url: "http://localhost:4173/mfe-platform/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

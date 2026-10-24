import { defineConfig, devices } from "@playwright/test";

// Сквозные тесты production-сборки: то, чего нет в dev — SRI-хеши, запечатанные манифесты.
// Перед запуском нужна сборка: `bun run test:e2e:prod` делает её сама.
const preview = (app: string, url: string) => ({
  command: `bun run --cwd apps/${app} preview`,
  url,
  reuseExistingServer: false,
  timeout: 60_000,
});

export default defineConfig({
  testDir: "e2e-prod",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  use: { baseURL: "http://localhost:3000", ...devices["Desktop Chrome"] },
  webServer: [
    preview("mfe-accounts", "http://localhost:3001/mf-manifest.json"),
    preview("mfe-payments", "http://localhost:3002/mf-manifest.json"),
    preview("mfe-legacy-react", "http://localhost:3003/mf-manifest.json"),
    preview("mfe-probe", "http://localhost:3004/mf-manifest.json"),
    preview("host", "http://localhost:3000"),
  ],
});

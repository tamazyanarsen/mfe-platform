import { defineConfig, devices } from "@playwright/test";

const server = (app: string, url: string) => ({
  command: `bun run --cwd apps/${app} dev`,
  url,
  // Чужой сервер на порту (забытый preview, старый dev) молча подменил бы проверяемый код.
  reuseExistingServer: false,
  timeout: 60_000,
});

export default defineConfig({
  testDir: "e2e",
  // *.spec.ts подхватил бы bun test, поэтому у сквозных тестов своё расширение.
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  use: { baseURL: "http://localhost:3000", ...devices["Desktop Chrome"] },
  webServer: [
    server("mfe-accounts", "http://localhost:3001/mf-manifest.json"),
    server("mfe-payments", "http://localhost:3002/mf-manifest.json"),
    server("mfe-legacy-react", "http://localhost:3003/mf-manifest.json"),
    server("host", "http://localhost:3000"),
  ],
});

/**
 * Эксперимент «общий core или копия», часть «размер»: сколько JavaScript скачивает страница обзора (оба ремоута
 * рядом) при изолированных копиях @rwcjs/core и при общем синглтоне.
 *
 *   bun run experiments/r4/measure.ts
 *
 * Собирает стенд в обоих режимах, поднимает `rsbuild preview`, открывает страницу в Chromium
 * и суммирует тела JS-ответов по источникам. Плюс проверяет, что страница работает.
 */
import { chromium } from "@playwright/test";
import { killTree } from "../../scripts/kill-tree";

const root = `${import.meta.dir}/../..`;
const APPS = ["mfe-accounts", "mfe-payments", "host"] as const;
const ORIGINS: Record<string, string> = {
  "http://localhost:3000": "host",
  "http://localhost:3001": "accounts",
  "http://localhost:3002": "payments",
};

const run = (cmd: string[], cwd: string, env: Record<string, string>) => {
  const result = Bun.spawnSync(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(`${cmd.join(" ")} in ${cwd}: ${result.stderr.toString()}`);
};

const waitFor = async (url: string) => {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await Bun.sleep(200);
  }
  throw new Error(`${url} did not start`);
};

const measure = async (mode: "isolated" | "shared") => {
  const env = { MFE_SHARE_CORE: mode === "shared" ? "1" : "0" };
  for (const app of APPS) run(["bun", "run", "build"], `${root}/apps/${app}`, env);

  const servers = APPS.map((app) =>
    Bun.spawn(["bun", "run", "preview"], {
      cwd: `${root}/apps/${app}`,
      env: { ...process.env, ...env },
      stdout: "ignore",
      stderr: "ignore",
    }),
  );
  try {
    await Promise.all(
      [
        "http://localhost:3000",
        "http://localhost:3001/mf-manifest.json",
        "http://localhost:3002/mf-manifest.json",
      ].map(waitFor),
    );
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const bytes: Record<string, number> = { host: 0, accounts: 0, payments: 0 };
    const pending: Promise<void>[] = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      const owner = ORIGINS[url.origin];
      if (!owner || !url.pathname.endsWith(".js")) return;
      pending.push(
        response.body().then(
          (body) => {
            bytes[owner] = (bytes[owner] ?? 0) + body.length;
          },
          () => {},
        ),
      );
    });
    await page.goto("http://localhost:3000/");
    await page.locator("mfe-accounts h2").waitFor();
    await page.locator("mfe-payments h2").waitFor();
    await page.waitForLoadState("networkidle");
    await Promise.all(pending);
    const works = await page.evaluate(
      () =>
        Boolean(customElements.get("rwc-button-v0-1")) &&
        Boolean(customElements.get("rwc-button-v0-2")),
    );
    await browser.close();
    return { mode, bytes, total: Object.values(bytes).reduce((a, b) => a + b, 0), works };
  } finally {
    await Promise.all(servers.map(killTree));
  }
};

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
for (const mode of ["isolated", "shared"] as const) {
  const { bytes, total, works } = await measure(mode);
  console.log(
    `${mode.padEnd(8)}  host ${kb(bytes.host ?? 0)}  accounts ${kb(bytes.accounts ?? 0)}  payments ${kb(bytes.payments ?? 0)}  total ${kb(total)}  (page works: ${works})`,
  );
}

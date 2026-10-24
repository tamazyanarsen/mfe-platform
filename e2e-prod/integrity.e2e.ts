import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const dist = (app: string, file: string) =>
  readFileSync(join(import.meta.dirname, "..", "apps", app, "dist", file), "utf8");

/** Хеш манифеста из сборки — то, что вносится в конфигурацию хоста при выкладке. */
const manifestIntegrity = (app: string) => dist(app, "mf-manifest.json.integrity").trim();

const remoteEntryOf = (app: string) =>
  JSON.parse(dist(app, "mf-manifest.json")).metaData.remoteEntry.name as string;

/** Конфигурация хоста с integrity для accounts. */
const pinAccounts = (page: Page, integrity = manifestIntegrity("mfe-accounts")) =>
  page.route("**/platform.config.json", async (route) => {
    const config = await (await route.fetch()).json();
    for (const remote of config.remotes) {
      if (remote.name === "accounts") remote.integrity = integrity;
    }
    await route.fulfill({ json: config });
  });

/** Подменяет ответ: тот же файл с вредной добавкой. */
const tamper = (page: Page, pattern: string | RegExp) =>
  page.route(pattern, async (route) => {
    try {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}\n;window.__pwned = true;` });
    } catch {
      // Страница закрылась, пока рантайм MF повторял загрузку: ответ уже никому не нужен.
    }
  });

/** Записывает каждый вставленный на страницу скрипт: MF удаляет их после загрузки. */
const recordScripts = (page: Page) =>
  page.addInitScript(() => {
    const scripts: Array<{ src: string; integrity: string }> = [];
    Object.assign(window, { __scripts: scripts });
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLScriptElement && node.src) {
            scripts.push({ src: node.src, integrity: node.getAttribute("integrity") ?? "" });
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });

const accountsHeading = (page: Page) => page.getByRole("heading", { name: "Счета" });
const pwned = (page: Page) =>
  page.evaluate(() => (window as { __pwned?: boolean }).__pwned === true);
const platformEvents = (page: Page, type: string) =>
  page.evaluate(
    (wanted) =>
      (window as unknown as { mfe: { events(): Array<{ type: string; name: string }> } }).mfe
        .events()
        .filter((event) => event.type === wanted),
    type,
  );

test("каждый скрипт проверенного ремоута грузится с integrity из его манифеста", async ({
  page,
}) => {
  await recordScripts(page);
  await pinAccounts(page);
  await page.goto("/accounts");
  await expect(accountsHeading(page)).toBeVisible();

  const scripts = await page.evaluate(
    () => (window as unknown as { __scripts: Array<{ src: string; integrity: string }> }).__scripts,
  );
  const accounts = scripts.filter(({ src }) => src.startsWith("http://localhost:3001/"));
  expect(accounts.map(({ src }) => src)).toContainEqual(
    `http://localhost:3001/${remoteEntryOf("mfe-accounts")}`,
  );
  expect(accounts.length).toBeGreaterThan(3);
  for (const { integrity } of accounts) expect(integrity).toMatch(/^sha384-/);
  // Ремоут без integrity в конфигурации грузится как раньше.
  const payments = scripts.filter(({ src }) => src.startsWith("http://localhost:3002/"));
  for (const { integrity } of payments) expect(integrity).toBe("");
  expect(await platformEvents(page, "integrity:denied")).toEqual([]);
});

test("подменённый remoteEntry не исполняется", async ({ page }) => {
  await pinAccounts(page);
  await tamper(page, `**/${remoteEntryOf("mfe-accounts")}`);
  await page.goto("/accounts");
  // Без remoteEntry не загружается и ./manifest: маршрута ремоута нет.
  await expect(page.getByTestId("not-found")).toBeVisible();
  expect(await pwned(page)).toBe(false);
});

test("подменённый чанк ремоута не исполняется", async ({ page }) => {
  await pinAccounts(page);
  await tamper(page, /localhost:3001\/static\/js\/async\/__federation_expose_entry/);
  await page.goto("/accounts");
  await expect(page.getByRole("alert")).toContainText("Модуль недоступен");
  expect(await pwned(page)).toBe(false);
});

test("подменённый манифест отклоняется, событие уходит в транспорт, остальные работают", async ({
  page,
}) => {
  await pinAccounts(page);
  await page.route("http://localhost:3001/mf-manifest.json", async (route) => {
    const response = await route.fetch();
    const manifest = await response.json();
    manifest.metaData.remoteEntry.name = "static/js/evil.js";
    await route.fulfill({ response, json: manifest });
  });

  await page.goto("/accounts");
  await expect(page.getByTestId("not-found")).toBeVisible();
  await expect
    .poll(() => platformEvents(page, "integrity:denied"))
    .toContainEqual(expect.objectContaining({ name: "accounts" }));

  await page.locator("header nav").getByRole("link", { name: "Платежи" }).click();
  await expect(page.getByRole("heading", { name: "Платежи" })).toBeVisible();
});

test("неверный хеш в конфигурации — ремоут не грузится", async ({ page }) => {
  await pinAccounts(
    page,
    "sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );
  await page.goto("/accounts");
  await expect(page.getByTestId("not-found")).toBeVisible();
});

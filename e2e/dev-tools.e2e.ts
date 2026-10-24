import { expect, type Page, test } from "@playwright/test";

const shellNav = (page: Page) => page.locator("header nav");
const paymentsHeading = (page: Page) => page.getByRole("heading", { name: "Платежи" });
const accountsHeading = (page: Page) => page.getByRole("heading", { name: "Счета" });

/** Отмечает окно: если отметка пропала, страница перезагружалась. */
const markWindow = (page: Page) => page.evaluate(() => Object.assign(window, { __noReload: true }));
const sameWindow = (page: Page) =>
  page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload === true);

test.describe("конфигурация при запуске", () => {
  test("хост читает platform.config.json при запуске: правка файла видна без пересборки", async ({
    page,
  }) => {
    await page.route("**/platform.config.json", async (route) => {
      const config = await (await route.fetch()).json();
      config.nav = config.nav.filter((item: { href: string }) => item.href !== "/legacy");
      await route.fulfill({ json: config });
    });
    await page.goto("/accounts");
    await expect(accountsHeading(page)).toBeVisible();
    await expect(shellNav(page).getByRole("link")).toHaveText(["Обзор", "Счета", "Платежи"]);
  });

  test("конфигурация недоступна — понятная ошибка вместо белого экрана", async ({ page }) => {
    await page.route("**/platform.config.json", (route) => route.fulfill({ status: 500 }));
    await page.goto("/accounts");
    await expect(page.getByRole("alert")).toContainText("Конфигурация платформы недоступна");
  });
});

test.describe("подмена ремоута", () => {
  test("локальный адрес подменяет ремоут, подмена видна в шапке и переживает переходы", async ({
    page,
  }) => {
    // Другой адрес того же dev-сервера: так видно, что ремоут берётся по подменённому адресу.
    const local = "http://localhost:3002/mf-manifest.json?local=1";
    const overridden = page.waitForRequest(local);
    await page.goto(`/accounts?mfe-override=${encodeURIComponent(`payments=${local}`)}`);
    await overridden;
    await expect(page.getByTestId("override-badge")).toHaveText("override: payments");

    await shellNav(page).getByRole("link", { name: "Платежи" }).click();
    await expect(paymentsHeading(page)).toBeVisible();

    // Подмена запомнена на вкладку: перезагрузка без параметра её сохраняет, reset снимает.
    await page.goto("/payments");
    await expect(page.getByTestId("override-badge")).toBeVisible();
    await page.goto("/payments?mfe-override=reset");
    await expect(paymentsHeading(page)).toBeVisible();
    await expect(page.getByTestId("override-badge")).toHaveCount(0);
  });

  test("чужой адрес не подменяет ремоут", async ({ page }) => {
    const foreign: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname === "evil.example") foreign.push(request.url());
    });
    await page.goto(
      `/payments?mfe-override=${encodeURIComponent("payments=https://evil.example/mf-manifest.json")}`,
    );
    await expect(paymentsHeading(page)).toBeVisible();
    await expect(page.getByTestId("override-badge")).toHaveCount(0);
    expect(foreign).toEqual([]);
  });
});

test("кнопка «Повторить» загружает упавший ремоут заново", async ({ page }) => {
  const entryChunk = /localhost:3002\/.*__federation_expose_entry/;
  await page.route(entryChunk, (route) => route.fulfill({ status: 503, body: "" }));
  await page.goto("/payments");
  await expect(page.getByRole("alert")).toContainText("Модуль недоступен");

  await page.unroute(entryChunk);
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(paymentsHeading(page)).toBeVisible();
});

test("обычная ссылка внутри ремоута ведёт через хост, без перезагрузки", async ({ page }) => {
  await page.goto("/accounts");
  await expect(accountsHeading(page)).toBeVisible();
  await markWindow(page);
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/payments";
    link.textContent = "Обычная ссылка на платежи";
    document.querySelector("mfe-accounts")?.shadowRoot?.append(link);
  });

  await page.getByRole("link", { name: "Обычная ссылка на платежи" }).click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(paymentsHeading(page)).toBeVisible();
  expect(await sameWindow(page)).toBe(true);
});

test("наведение на пункт меню заранее загружает код ремоута", async ({ page }) => {
  await page.goto("/accounts");
  await expect(accountsHeading(page)).toBeVisible();
  const prefetch = page.waitForRequest(
    (request) =>
      request.url().startsWith("http://localhost:3002/") &&
      request.url().includes("__federation_expose_entry"),
  );
  await shellNav(page).getByRole("link", { name: "Платежи" }).hover();
  await prefetch;
  // Предзагрузка не монтирует ремоут: страница по-прежнему счета.
  await expect(accountsHeading(page)).toBeVisible();
});

test.describe("панель отладки", () => {
  test("?mfe-devtools открывает панель: ремоуты, версии кита, ошибки", async ({ page }) => {
    await page.goto("/?mfe-devtools");
    const panel = page.getByRole("dialog", { name: "MFE devtools" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("accounts");
    await expect(panel).toContainText("payments");
    await expect(panel.locator('[data-state="ready"]')).toHaveCount(2);
    await expect(panel).toContainText("@rwcjs/ui");
    await expect(panel).toContainText("v0-1");
    await expect(panel).toContainText("v0-2");
  });

  test("Alt+Shift+D открывает и закрывает панель", async ({ page }) => {
    await page.goto("/accounts");
    await expect(accountsHeading(page)).toBeVisible();
    const panel = page.getByRole("dialog", { name: "MFE devtools" });
    await expect(panel).toHaveCount(0);
    await page.keyboard.press("Alt+Shift+KeyD");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("accounts");
    await page.keyboard.press("Alt+Shift+KeyD");
    await expect(panel).toHaveCount(0);
  });
});

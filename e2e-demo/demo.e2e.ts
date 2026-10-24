import { expect, type Page, test } from "@playwright/test";

/**
 * Демо на статическом хостинге: хост под /mfe-platform/, ремоуты в /mfe-platform/remotes/,
 * проверка целостности включена для всех ремоутов.
 */
const shellNav = (page: Page) => page.locator("header nav");

const collectErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
};

test("обзор, переходы и кнопка «назад» под префиксом пути", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("./");
  const overview = page.getByTestId("overview");
  await expect(overview.getByRole("heading", { name: "Счета" })).toBeVisible();
  await expect(overview.getByRole("heading", { name: "Платежи" })).toBeVisible();

  // Внутренняя ссылка ремоута на обзоре ведёт в его раздел — с префиксом хоста.
  await overview.getByRole("link", { name: "Текущий счёт" }).click();
  await expect(page).toHaveURL(/\/mfe-platform\/accounts\/40817810000000000001$/);
  await expect(page.getByTestId("account-details")).toContainText("125430.17 RUB");

  // Переход в чужой ремоут по событию platform:navigate: путь приложения + префикс.
  await shellNav(page).getByRole("link", { name: "Отчёты" }).click();
  await expect(page).toHaveURL(/\/mfe-platform\/legacy$/);
  await expect(shellNav(page).getByRole("link", { name: "Отчёты" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("button", { name: "К платежам" }).click();
  await expect(page).toHaveURL(/\/mfe-platform\/payments$/);
  await expect(page.getByRole("heading", { name: "Платежи" })).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("legacy-stack")).toHaveText("Ремоут на React");
  await page.goBack();
  await expect(page.getByTestId("account-details")).toBeVisible();

  expect(errors).toEqual([]);
});

test("прямая ссылка на раздел открывается через 404.html", async ({ page }) => {
  const errors = collectErrors(page);
  const response = await page.goto("payments/new");
  // Так отвечает GitHub Pages: статус 404, но страница — хост.
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId("payment-form")).toBeVisible();
  // В ошибках только сам ответ 404 на документ.
  expect(errors.filter((error) => !error.includes("404"))).toEqual([]);
});

test("код ремоутов проверяется по хешам из конфигурации", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script" && request.url().includes("/remotes/")) {
      scripts.push(request.url());
    }
  });
  await page.goto("./");
  await expect(page.getByTestId("overview").getByRole("heading", { name: "Счета" })).toBeVisible();
  const config = await (await page.request.get("platform.config.json")).json();
  for (const remote of config.remotes) expect(remote.integrity).toMatch(/^sha384-/);
  expect(scripts.length).toBeGreaterThan(0);
  const denied = await page.evaluate(() =>
    (window as unknown as { mfe: { events(): Array<{ type: string }> } }).mfe
      .events()
      .filter(({ type }) => type === "integrity:denied"),
  );
  expect(denied).toEqual([]);
});

test("неизвестный раздел — «Страница не найдена», панель отладки по ?mfe-devtools", async ({
  page,
}) => {
  await page.goto("nowhere");
  await expect(page.getByTestId("not-found")).toBeVisible();
  await page.goto("./?mfe-devtools");
  await expect(page.getByRole("dialog")).toBeVisible();
});

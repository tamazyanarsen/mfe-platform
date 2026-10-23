import { expect, type Page, test } from "@playwright/test";

const accountsHeading = (page: Page) => page.getByRole("heading", { name: "Счета" });
const paymentsHeading = (page: Page) => page.getByRole("heading", { name: "Платежи" });
const shellNav = (page: Page) => page.locator("header nav");

/** Запросы за кодом ремоута: чанк экспонированного ./entry, не манифест. */
const trackEntryRequests = (page: Page, port: number) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith(`http://localhost:${port}/`) && url.includes("__federation_expose_entry")) {
      requests.push(url);
    }
  });
  return requests;
};

test("переходы между ремоутами кнопками назад-вперёд не ломают ни один", async ({ page }) => {
  await page.goto("/accounts");
  await expect(accountsHeading(page)).toBeVisible();

  // Внутренняя навигация ремоута счетов.
  await page.getByRole("link", { name: "Текущий счёт" }).click();
  await expect(page).toHaveURL(/\/accounts\/40817810000000000001$/);
  await expect(page.getByTestId("account-details")).toContainText("125430.17 RUB");

  // Хост переводит на другой ремоут.
  await shellNav(page).getByRole("link", { name: "Платежи" }).click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(paymentsHeading(page)).toBeVisible();

  // Внутренняя навигация ремоута платежей.
  await page.getByRole("link", { name: "Создать" }).click();
  await expect(page).toHaveURL(/\/payments\/new$/);
  await expect(page.getByTestId("payment-form")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(paymentsHeading(page)).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/accounts\/40817810000000000001$/);
  await expect(page.getByTestId("account-details")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(accountsHeading(page)).toBeVisible();

  await page.goForward();
  await page.goForward();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(paymentsHeading(page)).toBeVisible();

  await page.goForward();
  await expect(page.getByTestId("payment-form")).toBeVisible();

  // После всех переходов оба ремоута продолжают навигировать.
  await page.getByRole("link", { name: "Список" }).click();
  await expect(paymentsHeading(page)).toBeVisible();
  await page.getByRole("button", { name: "К счетам" }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await page.getByRole("link", { name: "Валютный счёт" }).click();
  await expect(page.getByTestId("account-details")).toContainText("2300.00 USD");
});

test("внутренняя навигация не перемонтирует ремоут", async ({ page }) => {
  await page.goto("/payments");
  await expect(paymentsHeading(page)).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { first: Element | null }).first = document.querySelector("mfe-payments");
  });
  await page.getByRole("link", { name: "Создать" }).click();
  await page.goBack();
  await expect(paymentsHeading(page)).toBeVisible();
  const same = await page.evaluate(
    () =>
      (window as unknown as { first: Element | null }).first ===
      document.querySelector("mfe-payments"),
  );
  expect(same).toBe(true);
});

test("код второго ремоута грузится только при первом переходе на него", async ({ page }) => {
  const paymentsCode = trackEntryRequests(page, 3002);
  await page.goto("/accounts");
  await expect(accountsHeading(page)).toBeVisible();
  // Манифест платежей уже загружен (ссылка в навигации работает), а код — нет.
  expect(paymentsCode).toHaveLength(0);

  await page.getByRole("button", { name: "Новый платёж" }).click();
  await expect(page).toHaveURL(/\/payments\/new$/);
  await expect(page.getByTestId("payment-form")).toBeVisible();
  expect(paymentsCode).toHaveLength(1);

  await page.goBack();
  await expect(accountsHeading(page)).toBeVisible();
  await page.goForward();
  await expect(page.getByTestId("payment-form")).toBeVisible();
  expect(paymentsCode).toHaveLength(1);
});

test("404 за кодом ремоута: fallback хоста, URL консистентен, остальное работает", async ({
  page,
}) => {
  await page.route(/localhost:3002\/.*__federation_expose_entry/, (route) =>
    route.fulfill({ status: 404, body: "not found" }),
  );
  await page.goto("/accounts");
  await expect(accountsHeading(page)).toBeVisible();

  await shellNav(page).getByRole("link", { name: "Платежи" }).click();
  await expect(page.getByRole("alert")).toContainText("Модуль недоступен");
  await expect(page).toHaveURL(/\/payments$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(accountsHeading(page)).toBeVisible();
});

test("ремоут, чей remoteEntry отдаёт 404: его маршрут даёт fallback хоста", async ({ page }) => {
  await page.route("http://localhost:3002/**", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/payments/new");
  await expect(page).toHaveURL(/\/payments\/new$/);
  await expect(page.getByTestId("not-found")).toBeVisible();

  await shellNav(page).getByRole("link", { name: "Счета" }).click();
  await expect(accountsHeading(page)).toBeVisible();
  await expect(page.getByTestId("not-found")).toBeHidden();
});

test("глубокая ссылка открывает внутренний маршрут ремоута", async ({ page }) => {
  await page.goto("/accounts/40817840000000000002");
  await expect(page.getByTestId("account-details")).toContainText("Валютный счёт");
});

import { expect, type Page, test } from "@playwright/test";

const shellNav = (page: Page) => page.locator("header nav");
const paymentsHeading = (page: Page) => page.getByRole("heading", { name: "Платежи" });
const accountsHeading = (page: Page) => page.getByRole("heading", { name: "Счета" });

test("ремоут, недоступный при старте, догружается без перезагрузки страницы", async ({ page }) => {
  const manifest = "http://localhost:3002/mf-manifest.json";
  await page.route(manifest, (route) => route.fulfill({ status: 503, body: "" }));
  await page.goto("/accounts");
  await expect(accountsHeading(page)).toBeVisible();
  await page.evaluate(() => Object.assign(window, { __noReload: true }));

  // Ремоут поднялся; пользователь идёт в его раздел — хост пробует манифест снова.
  await page.unroute(manifest);
  await shellNav(page).getByRole("link", { name: "Платежи" }).click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(paymentsHeading(page)).toBeVisible();
  expect(await page.evaluate(() => (window as { __noReload?: boolean }).__noReload)).toBe(true);
});

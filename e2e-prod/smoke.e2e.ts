import { expect, test } from "@playwright/test";

/**
 * Production-сборка целиком: ремоуты без своего рантайма MF (берут у хоста), с SRI-хешами,
 * минифицированные. Всё, что dev-стенд не проверяет.
 */
test("обзор, React-ремоут и переходы работают в production-сборке", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  const overview = page.getByTestId("overview");
  await expect(overview.getByRole("heading", { name: "Счета" })).toBeVisible();
  await expect(overview.getByRole("heading", { name: "Платежи" })).toBeVisible();

  await page.locator("header nav").getByRole("link", { name: "Отчёты" }).click();
  await expect(page.getByTestId("legacy-stack")).toHaveText("Ремоут на React");
  await page.getByRole("button", { name: "К платежам" }).click();
  await expect(page.getByRole("heading", { name: "Платежи" })).toBeVisible();

  expect(errors).toEqual([]);
});

import { expect, test } from "@playwright/test";

test("хост показывает контент ремоута", async ({ page }) => {
  await page.goto("/accounts");
  await expect(page.getByRole("heading", { name: "Счета" })).toBeVisible();
  await expect(page.getByTestId("account")).toHaveCount(2);
});

test("недоступный ремоут даёт видимую ошибку, а не белый экран", async ({ page }) => {
  // Для браузера остановленный dev-сервер ремоута и оборванное соединение неотличимы.
  await page.route("http://localhost:3001/**", (route) => route.abort("connectionrefused"));
  await page.goto("/accounts");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("MFE platform")).toBeVisible();
});

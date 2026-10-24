import { expect, type Page, test } from "@playwright/test";

/** Ремоут на React монтируется тем же <mfe-outlet>, без ветвления «если React» в хосте. */

const liveRoots = (page: Page) =>
  page.evaluate(
    () =>
      (globalThis as unknown as Record<symbol, Set<unknown> | undefined>)[
        Symbol.for("mfe-platform.react-roots")
      ]?.size ?? 0,
  );

test("React-ремоут монтируется, получает состояние платформы и навигирует через хост", async ({
  page,
}) => {
  // Состояние из стора хоста доходит до React-пропсов.
  await page.goto("/");
  await page
    .locator("mfe-accounts")
    .getByTestId("account")
    .first()
    .getByRole("button", { name: "Выбрать" })
    .click();

  await page.locator("header nav").getByRole("link", { name: "Отчёты" }).click();
  await expect(page).toHaveURL(/\/legacy$/);
  const legacy = page.locator("mfe-legacy-react");
  await expect(legacy.getByRole("heading", { name: "Отчёты" })).toBeVisible();
  await expect(legacy.getByTestId("legacy-selected")).toHaveText("Счёт: Текущий счёт");
  expect(await page.locator("mfe-outlet").first().getAttribute("remote")).toBe("legacy");

  // Состояние React внутри ремоута работает.
  await legacy.getByRole("button", { name: "Обороты за месяц" }).click();
  await expect(legacy.getByTestId("legacy-opened")).toHaveText("Открыт отчёт: turnover");

  // Колбэк React превращается в platform:navigate, историю пишет хост.
  await legacy.getByRole("button", { name: "К платежам" }).click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(page.getByRole("heading", { name: "Платежи" })).toBeVisible();
  await page.goBack();
  await expect(legacy.getByRole("heading", { name: "Отчёты" })).toBeVisible();
});

test("размонтирование не оставляет React-рутов", async ({ page }) => {
  await page.goto("/legacy");
  await expect(
    page.locator("mfe-legacy-react").getByRole("heading", { name: "Отчёты" }),
  ).toBeVisible();
  expect(await liveRoots(page)).toBe(1);

  await page.locator("header nav").getByRole("link", { name: "Счета" }).click();
  await expect(page.getByRole("heading", { name: "Счета" })).toBeVisible();
  await expect(page.locator("mfe-legacy-react")).toHaveCount(0);
  await expect.poll(() => liveRoots(page)).toBe(0);

  // Повторный заход создаёт ровно один новый рут.
  await page.goBack();
  await expect(
    page.locator("mfe-legacy-react").getByRole("heading", { name: "Отчёты" }),
  ).toBeVisible();
  expect(await liveRoots(page)).toBe(1);
});

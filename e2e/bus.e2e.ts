import { expect, test } from "@playwright/test";

/** Общий стор хоста и типизированная шина между ремоутами. */

test("выбор счёта в одном ремоуте виден в другом: событие шины и состояние стора", async ({
  page,
}) => {
  await page.goto("/");
  const accounts = page.locator("mfe-accounts");
  const payments = page.locator("mfe-payments");
  await expect(payments.getByTestId("debit-account")).toHaveText("Счёт списания: не выбран");

  await accounts.getByTestId("account").nth(1).getByRole("button", { name: "Выбрать" }).click();

  // Разовое событие — через подписку ремоута на шину.
  await expect(payments.getByTestId("payments-notice")).toHaveText("Выбран счёт: Валютный счёт");
  // Состояние — из стора хоста, свойством platform.
  await expect(payments.getByTestId("debit-account")).toHaveText("Счёт списания: Валютный счёт");
  await expect(accounts.getByTestId("account").nth(1)).toHaveClass(/selected/);

  // Состояние переживает перемонтирование: новый элемент получает его сразу.
  await page.locator("header nav").getByRole("link", { name: "Платежи" }).click();
  await expect(page.getByTestId("debit-account")).toHaveText("Счёт списания: Валютный счёт");
});

test("утечки: размонтированный ремоут не слушает шину, элемент собирается GC", async ({ page }) => {
  await page.goto("/payments");
  await expect(page.getByRole("heading", { name: "Платежи" })).toBeVisible();

  type Mfe = {
    bus: { listenerCount(topic: string): number; publish(topic: string, payload: unknown): void };
  };
  const count = () =>
    page.evaluate(() =>
      (window as unknown as { mfe: Mfe }).mfe.bus.listenerCount("account:selected"),
    );
  // Хост сам слушает account:selected; ремоут платежей — ещё одна подписка.
  const hostOnly = (await count()) - 1;
  expect(hostOnly).toBeGreaterThanOrEqual(1);

  await page.evaluate(() => {
    const element = document.querySelector("mfe-payments");
    (window as unknown as { ref: WeakRef<Element> }).ref = new WeakRef(element as Element);
  });

  await page.locator("header nav").getByRole("link", { name: "Счета" }).click();
  await expect(page.getByRole("heading", { name: "Счета" })).toBeVisible();
  await expect(page.locator("mfe-payments")).toHaveCount(0);

  // Подписка снята, публикация до отключённого ремоута не доходит.
  await expect.poll(count).toBe(hostOnly);
  await page.evaluate(() =>
    (window as unknown as { mfe: Mfe }).mfe.bus.publish("account:selected", {
      accountId: "x",
      title: "x",
    }),
  );

  const cdp = await page.context().newCDPSession(page);
  await expect
    .poll(async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      return page.evaluate(
        () => (window as unknown as { ref: WeakRef<Element> }).ref.deref() === undefined,
      );
    })
    .toBe(true);
});

import { expect, type Page, test } from "@playwright/test";

/** A4 платформы и K1 кита: две версии @rwcjs/ui на одной странице, в двух реальных ремоутах. */

const overview = async (page: Page) => {
  await page.goto("/");
  const accounts = page.locator("mfe-accounts");
  const payments = page.locator("mfe-payments");
  await expect(accounts.getByRole("heading", { name: "Счета" })).toBeVisible();
  await expect(payments.getByRole("heading", { name: "Платежи" })).toBeVisible();
  return { accounts, payments };
};

test("оба набора тегов зарегистрированы, у каждого ремоута свой", async ({ page }) => {
  const { accounts, payments } = await overview(page);
  await expect(accounts.getByTestId("kit-version")).toHaveText("kit 0.2.0-next.0");
  await expect(payments.getByTestId("kit-version")).toHaveText("kit 0.1.0");

  const tags = await page.evaluate(() => ({
    v01: Boolean(customElements.get("rwc-button-v0-1")),
    v02: Boolean(customElements.get("rwc-button-v0-2")),
    plain: Boolean(customElements.get("rwc-button")),
    distinct: customElements.get("rwc-button-v0-1") !== customElements.get("rwc-button-v0-2"),
    inAccounts: [
      ...(document.querySelector("mfe-accounts")?.shadowRoot?.querySelectorAll("*") ?? []),
    ]
      .map((el) => el.localName)
      .filter((name) => name.startsWith("rwc-")),
    inPayments: [
      ...(document.querySelector("mfe-payments")?.shadowRoot?.querySelectorAll("*") ?? []),
    ]
      .map((el) => el.localName)
      .filter((name) => name.startsWith("rwc-")),
  }));
  expect(tags).toMatchObject({ v01: true, v02: true, plain: false, distinct: true });
  expect(tags.inAccounts.length).toBeGreaterThan(0);
  expect(tags.inPayments.length).toBeGreaterThan(0);
  expect(tags.inAccounts.every((name) => name.endsWith("-v0-2"))).toBe(true);
  expect(tags.inPayments.every((name) => name.endsWith("-v0-1"))).toBe(true);
});

test("таблица учёта реестра: кто какую версию кита использует", async ({ page }) => {
  await overview(page);
  const records = await page.evaluate(() =>
    (
      window as unknown as {
        mfe: {
          registry: {
            records(): Array<{
              kit: string;
              postfix: string;
              version: string;
              consumers: Map<string, string>;
            }>;
          };
        };
      }
    ).mfe.registry
      .records()
      .map((r) => ({
        kit: r.kit,
        postfix: r.postfix,
        version: r.version,
        consumers: [...r.consumers],
      }))
      .sort((a, b) => a.postfix.localeCompare(b.postfix)),
  );
  expect(records).toEqual([
    { kit: "@rwcjs/ui", postfix: "v0-1", version: "0.1.0", consumers: [["payments", "0.1.0"]] },
    {
      kit: "@rwcjs/ui",
      postfix: "v0-2",
      version: "0.2.0-next.0",
      consumers: [["accounts", "0.2.0-next.0"]],
    },
  ]);
});

test("поведение версий различается: id подсказок (исправление 0.1.1)", async ({ page }) => {
  const { accounts, payments } = await overview(page);
  // В 0.1.0 id подсказки — rwc-tooltip-N без постфикса, в новой линии — от фактического тега.
  const describedBy = async (host: ReturnType<Page["locator"]>) =>
    host.locator("[aria-describedby]").first().getAttribute("aria-describedby");
  await expect.poll(() => describedBy(payments)).toMatch(/^rwc-tooltip-\d+$/);
  await expect.poll(() => describedBy(accounts)).toMatch(/^rwc-tooltip-v0-2-\d+$/);
});

test("формы двух версий кита работают независимо", async ({ page }) => {
  const { accounts, payments } = await overview(page);

  await accounts.getByTestId("accounts-form").locator("input").fill("100.00");
  const paymentsInputs = payments.getByTestId("payments-form").locator("input");
  await paymentsInputs.nth(0).fill("250.50");
  await paymentsInputs.nth(1).fill("ООО Ромашка");

  await payments.getByRole("button", { name: "Отправить" }).click();
  await expect(payments.getByTestId("payments-form-result")).toHaveText(
    "amount=250.50&to=ООО Ромашка",
  );
  await expect(accounts.getByTestId("accounts-form-result")).toHaveText("");

  await accounts.getByRole("button", { name: "Пополнить" }).click();
  await expect(accounts.getByTestId("accounts-form-result")).toHaveText("amount=100.00");
  await expect(payments.getByTestId("payments-form-result")).toHaveText(
    "amount=250.50&to=ООО Ромашка",
  );
});

test("из обзора ссылка ремоута ведёт на его страницу", async ({ page }) => {
  const { accounts } = await overview(page);
  await accounts.getByRole("link", { name: "Валютный счёт" }).click();
  await expect(page).toHaveURL(/\/accounts\/40817840000000000002$/);
  await expect(page.getByTestId("overview")).toBeHidden();
  await expect(page.getByTestId("account-details")).toContainText("2300.00 USD");
  await page.goBack();
  await expect(page.getByTestId("overview")).toBeVisible();
});

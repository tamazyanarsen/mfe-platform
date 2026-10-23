import { expect, test } from "@playwright/test";

/** A6: падение ремоута при отрисовке остаётся внутри его outlet и попадает в буфер событий. */

type PlatformEvent = {
  type: string;
  name: string;
  version?: string;
  mountId?: string;
  route?: string;
  contractVersion?: number;
  extra?: Record<string, unknown>;
  timings?: Record<string, number>;
  error?: { message: string };
  details?: Record<string, unknown>;
};

const events = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { mfe: { events(): PlatformEvent[] } }).mfe.events());

test("ремоут с исключением при отрисовке: fallback, соседний работает, событие со всеми полями", async ({
  page,
}) => {
  // Ломаем отрисовку payments снаружи, не трогая код ремоута: его connectedCallback бросает.
  await page.addInitScript(() => {
    const define = customElements.define.bind(customElements);
    customElements.define = (name, ctor, options) => {
      let component = ctor;
      if (name === "mfe-payments") {
        component = class extends (ctor as typeof HTMLElement) {
          connectedCallback() {
            throw new Error("payments exploded while rendering");
          }
        };
      }
      define(name, component, options);
    };
  });
  const uncaught: string[] = [];
  page.on("pageerror", (error) => uncaught.push(error.message));

  await page.goto("/");
  const overview = page.getByTestId("overview");
  await expect(overview.locator("mfe-outlet[remote=payments]").getByRole("alert")).toContainText(
    "Модуль недоступен",
  );
  // Соседний ремоут работает и отвечает на действия.
  const accounts = page.locator("mfe-accounts");
  await expect(accounts.getByRole("heading", { name: "Счета" })).toBeVisible();
  await accounts.getByRole("link", { name: "Текущий счёт" }).click();
  await expect(page.getByTestId("account-details")).toBeVisible();

  const error = (await events(page)).find((e) => e.type === "mount:error");
  expect(error).toMatchObject({
    name: "payments",
    version: "0.1.0",
    route: "/",
    contractVersion: 1,
    extra: { team: "payments", owner: "payments-team@bank.example" },
    error: { message: "payments exploded while rendering" },
    details: { phase: "render" },
  });
  expect(error?.mountId).toMatch(/^payments-/);
  // Ошибка ушла в транспорт, а не всплыла необработанной.
  expect(uncaught).toEqual([]);
});

test("метрики монтирования: время загрузки кода и время до первого кадра", async ({ page }) => {
  await page.goto("/accounts");
  await expect(page.getByRole("heading", { name: "Счета" })).toBeVisible();
  await expect
    .poll(async () => (await events(page)).find((e) => e.type === "mount:ready")?.timings)
    .toMatchObject({ codeLoad: expect.any(Number), firstFrame: expect.any(Number) });
  const kinds = (await events(page)).map((e) => e.type);
  expect(kinds).toEqual(
    expect.arrayContaining(["mount:start", "mount:code-loaded", "mount:ready", "register:ok"]),
  );
});

import { expect, type Page, test } from "@playwright/test";

const shellNav = (page: Page) => page.locator("header nav");
const paymentsHeading = (page: Page) => page.getByRole("heading", { name: "Платежи" });
const accountsHeading = (page: Page) => page.getByRole("heading", { name: "Счета" });

test.describe("права на общий стор", () => {
  /** Просьба изменить стор с элемента ремоута — так её отправляет ремоут. */
  const patchFrom = (page: Page, tag: string, patch: Record<string, unknown>) =>
    page.evaluate(
      ([selector, detail]) =>
        document
          .querySelector(selector as string)
          ?.dispatchEvent(
            new CustomEvent("platform:patch", { detail, bubbles: true, composed: true }),
          ),
      [tag, patch] as const,
    );

  test("ремоут меняет тему, но не сессию; запрет виден в событиях", async ({ page }) => {
    await page.goto("/accounts");
    await expect(accountsHeading(page)).toBeVisible();

    await patchFrom(page, "mfe-accounts", {
      theme: "dark",
      session: { userId: "u-2", name: "Мэллори" },
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("header .user")).toHaveText("Анна Иванова");
    const store = await page.evaluate(() => {
      const { mfe } = window as unknown as {
        mfe: {
          store: { get(): { session: { name: string } } };
          events(): { type: string; name: string }[];
        };
      };
      return {
        session: mfe.store.get().session.name,
        denied: mfe.events().filter((event) => event.type === "store:denied"),
      };
    });
    expect(store.session).toBe("Анна Иванова");
    expect(store.denied).toEqual([expect.objectContaining({ name: "accounts" })]);
  });

  test("право из storeAccess в конфигурации разрешает ремоуту менять сессию", async ({ page }) => {
    await page.route("**/platform.config.json", async (route) => {
      const config = await (await route.fetch()).json();
      config.storeAccess = { "*": ["selected", "theme", "locale"], accounts: ["session"] };
      await route.fulfill({ json: config });
    });
    await page.goto("/accounts");
    await expect(accountsHeading(page)).toBeVisible();
    await patchFrom(page, "mfe-accounts", { session: { userId: "u-2", name: "Борис" } });
    const name = await page.evaluate(
      () =>
        (
          window as unknown as { mfe: { store: { get(): { session: { name: string } } } } }
        ).mfe.store.get().session.name,
    );
    expect(name).toBe("Борис");
  });

  test("анонимная просьба через шину тоже не меняет сессию", async ({ page }) => {
    await page.goto("/accounts");
    await expect(accountsHeading(page)).toBeVisible();
    const session = await page.evaluate(() => {
      const { mfe } = window as unknown as {
        mfe: {
          bus: { publish(topic: string, payload: unknown): void };
          store: { get(): { session: { name: string }; locale: string } };
        };
      };
      mfe.bus.publish("store:patch", { session: { userId: "x", name: "x" }, locale: "en-US" });
      return { name: mfe.store.get().session.name, locale: mfe.store.get().locale };
    });
    expect(session).toEqual({ name: "Анна Иванова", locale: "en-US" });
  });
});

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

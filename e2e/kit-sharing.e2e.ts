import { expect, type Page, test } from "@playwright/test";

/**
 * Два ремоута на одной линии кита (`@rwcjs/ui` 0.1): payments и тестовый probe. Кит и его
 * core делятся по линии совместимости, поэтому второй ремоут получает тот же экземпляр кита:
 * реестр отмечает его как `reused`, а не как конфликт двух сборок.
 */
const PROBE = "probe=http://localhost:3004/mf-manifest.json";

interface KitRecord {
  kit: string;
  postfix: string;
  consumers: Array<[string, string]>;
}

const kitRecords = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        mfe: {
          registry: {
            records(): Array<{ kit: string; postfix: string; consumers: Map<string, string> }>;
          };
        };
      }
    ).mfe.registry
      .records()
      .map(({ kit, postfix, consumers }) => ({ kit, postfix, consumers: [...consumers] })),
  ) as Promise<KitRecord[]>;

const registerEvents = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        mfe: { events(): Array<{ type: string; name: string; details?: { reused?: boolean } }> };
      }
    ).mfe
      .events()
      .filter((event) => event.type.startsWith("register:")),
  );

test("ремоуты одной линии кита делят один его экземпляр", async ({ page }) => {
  await page.goto(`/payments?mfe-override=${encodeURIComponent(PROBE)}`);
  await expect(page.getByRole("heading", { name: "Платежи" })).toBeVisible();

  await page.locator("header nav").getByRole("link", { name: "probe (override)" }).click();
  await expect(page.getByTestId("probe-button")).toBeVisible();

  const line = (await kitRecords(page)).find((record) => record.postfix === "v0-1");
  expect(line?.consumers.map(([consumer]) => consumer).sort()).toEqual(["payments", "probe"]);

  const events = await registerEvents(page);
  expect(events.map((event) => event.type)).not.toContain("register:denied");
  expect(events.find((event) => event.details?.reused)?.type).toBe("register:ok");
});

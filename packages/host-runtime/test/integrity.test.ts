import { describe, expect, test } from "bun:test";
import {
  computeIntegrity,
  createIntegrityPlugin,
  IntegrityError,
  isIntegrity,
  validateRemoteEntries,
} from "../src";

const BASE = "https://cdn.bank.example/accounts/";
const MANIFEST_URL = `${BASE}mf-manifest.json`;
const ENTRY_URL = `${BASE}static/js/accounts.abc.js`;
const CHUNK_URL = `${BASE}static/js/async/entry.def.js`;
const CSS_URL = `${BASE}static/css/entry.css`;

/** Запечатанный сборкой манифест: таблица хешей всех файлов ремоута. */
const sealedManifest = (
  table: Record<string, string> = {
    "static/js/accounts.abc.js": "sha384-ENTRY",
    "static/js/async/entry.def.js": "sha384-CHUNK",
    "static/css/entry.css": "sha384-STYLE",
  },
  metaData: Record<string, unknown> = {},
) =>
  JSON.stringify({
    name: "accounts",
    metaData: {
      publicPath: BASE,
      remoteEntry: { name: "static/js/accounts.abc.js", path: "" },
      integrity: table,
      ...metaData,
    },
  });

const serve = (body: string) =>
  (async () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as (url: string, init: RequestInit) => Promise<Response>;

/** Плагин, которому конфигурация доверяет манифест `pinnedBody`, а сеть отдаёт `servedBody`. */
const setup = async (pinnedBody: string, servedBody = pinnedBody) => {
  const integrity = await computeIntegrity(new TextEncoder().encode(pinnedBody));
  const violations: string[] = [];
  const plugin = createIntegrityPlugin({
    remotes: [{ name: "accounts", entry: MANIFEST_URL, integrity }],
    fetchImpl: serve(servedBody),
    onViolation: (remote, message) => violations.push(`${remote}: ${message}`),
  });
  return { plugin, violations };
};

describe("computeIntegrity", () => {
  test("совпадает с эталонными SRI-хешами", async () => {
    const abc = new TextEncoder().encode("abc");
    expect(await computeIntegrity(abc)).toBe(
      "sha384-ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn",
    );
    expect(await computeIntegrity(abc, "sha256")).toBe(
      "sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",
    );
  });

  test("isIntegrity и проверка конфигурации", () => {
    expect(
      isIntegrity("sha384-ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn"),
    ).toBe(true);
    expect(isIntegrity("md5-abc")).toBe(false);
    expect(
      validateRemoteEntries([{ name: "accounts", entry: MANIFEST_URL, integrity: "md5-abc" }]),
    ).toEqual(['remotes[0].integrity must be an SRI hash like "sha384-…"']);
  });
});

describe("createIntegrityPlugin", () => {
  test("ремоут без integrity не трогается", () => {
    const plugin = createIntegrityPlugin({ remotes: [{ name: "accounts", entry: MANIFEST_URL }] });
    expect(plugin.fetch(MANIFEST_URL, {})).toBeUndefined();
    expect(plugin.createScript({ url: ENTRY_URL })).toBeUndefined();
  });

  test("верный манифест: remoteEntry, чанки и стили получают integrity из таблицы", async () => {
    const body = sealedManifest();
    const { plugin, violations } = await setup(body);

    const response = await plugin.fetch(MANIFEST_URL, {});
    expect(await response?.text()).toBe(body);

    const entry = plugin.createScript({ url: ENTRY_URL, attrs: { "data-webpack": "accounts" } });
    expect(entry?.getAttribute("integrity")).toBe("sha384-ENTRY");
    expect(entry?.getAttribute("crossorigin")).toBe("anonymous");
    expect(entry?.getAttribute("data-webpack")).toBe("accounts");
    expect(entry?.src).toBe(ENTRY_URL);
    expect(plugin.createScript({ url: CHUNK_URL })?.getAttribute("integrity")).toBe("sha384-CHUNK");

    const style = plugin.createLink({ url: CSS_URL, attrs: { rel: "stylesheet" } });
    expect(style?.getAttribute("integrity")).toBe("sha384-STYLE");
    expect(style?.getAttribute("rel")).toBe("stylesheet");

    // Скрипты с других адресов плагин не трогает.
    expect(plugin.createScript({ url: "https://cdn.bank.example/payments/x.js" })).toBeUndefined();
    expect(violations).toEqual([]);
  });

  test("файл с адреса проверенного ремоута, которого нет в таблице, блокируется", async () => {
    const { plugin, violations } = await setup(sealedManifest());
    await plugin.fetch(MANIFEST_URL, {});

    const script = plugin.createScript({ url: `${BASE}static/js/evil.js` });
    expect(script?.getAttribute("integrity")).toMatch(/^sha384-A+$/);
    expect(violations).toEqual([
      `accounts: ${BASE}static/js/evil.js is not in the manifest integrity table`,
    ]);
  });

  test("подменённый манифест — IntegrityError и нарушение, скрипты ремоута не размечаются", async () => {
    const original = sealedManifest();
    const { plugin, violations } = await setup(
      original,
      original.replace("sha384-CHUNK", "sha384-EVIL"),
    );

    expect(plugin.fetch(MANIFEST_URL, {})).rejects.toBeInstanceOf(IntegrityError);
    await Promise.resolve().then(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(violations[0]).toContain("mf-manifest.json integrity mismatch");
    expect(plugin.createScript({ url: CHUNK_URL })).toBeUndefined();
  });

  test("манифест без хеша remoteEntry рвёт цепочку — тоже ошибка", async () => {
    const { plugin } = await setup(
      sealedManifest({ "static/js/async/entry.def.js": "sha384-CHUNK" }),
    );
    expect(plugin.fetch(MANIFEST_URL, {})).rejects.toThrow("no remoteEntry integrity");
  });

  test("publicPath auto и путь remoteEntry считаются от адреса манифеста", async () => {
    const body = sealedManifest(
      { "static/js/accounts.abc.js": "sha384-BBBB" },
      { publicPath: "auto", remoteEntry: { name: "accounts.abc.js", path: "static/js" } },
    );
    const { plugin } = await setup(body);
    await plugin.fetch(MANIFEST_URL, {});
    expect(plugin.createScript({ url: ENTRY_URL })?.getAttribute("integrity")).toBe("sha384-BBBB");
  });
});

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  applyRemoteOverrides,
  loadJsonConfig,
  type OverrideStorage,
  type RemoteEntry,
  validateRemoteEntries,
} from "../src";

describe("validateRemoteEntries", () => {
  test("валидный список", () => {
    expect(
      validateRemoteEntries([
        { name: "accounts", entry: "http://localhost:3001/mf-manifest.json" },
        { name: "payments", entry: "/remotes/payments/mf-manifest.json" },
      ]),
    ).toEqual([]);
  });

  test("перечисляет все проблемы с указанием места", () => {
    expect(
      validateRemoteEntries([
        { name: "accounts", entry: "http://localhost:3001/mf-manifest.json" },
        { name: "accounts", entry: "http://localhost:3002/mf-manifest.json" },
        { name: "1bad", entry: 42 },
        null,
      ]),
    ).toEqual([
      'remotes[1].name "accounts" is duplicated',
      "remotes[2].name must be an identifier",
      "remotes[2].entry must be a URL",
      "remotes[3] must be an object",
    ]);
    expect(validateRemoteEntries({})).toEqual(["remotes must be an array"]);
  });
});

describe("loadJsonConfig", () => {
  const respond = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  test("возвращает конфигурацию, прошедшую проверку", async () => {
    const config = await loadJsonConfig<{ remotes: RemoteEntry[] }>(
      "/platform.config.json",
      () => [],
      respond(200, { remotes: [] }),
    );
    expect(config).toEqual({ remotes: [] });
  });

  test("HTTP-ошибка и невалидная конфигурация — исключение с причиной", async () => {
    expect(loadJsonConfig("/c.json", () => [], respond(404, {}))).rejects.toThrow("HTTP 404");
    expect(
      loadJsonConfig("/c.json", () => ["remotes must be an array"], respond(200, {})),
    ).rejects.toThrow("remotes must be an array");
  });
});

describe("applyRemoteOverrides", () => {
  const remotes: RemoteEntry[] = [
    { name: "accounts", entry: "https://cdn.bank.example/accounts/mf-manifest.json" },
    { name: "payments", entry: "https://cdn.bank.example/payments/mf-manifest.json" },
  ];
  const memoryStorage = (): OverrideStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
  };
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  afterEach(() => warn.mockClear());

  test("без параметра ничего не меняется", () => {
    const result = applyRemoteOverrides(remotes, { search: "", storage: memoryStorage() });
    expect(result.remotes).toEqual(remotes);
    expect(result.overridden).toEqual([]);
  });

  test("локальный адрес подменяет ремоут и запоминается на вкладку", () => {
    const storage = memoryStorage();
    const search = "?mfe-override=payments=http://localhost:3002/mf-manifest.json";
    const first = applyRemoteOverrides(remotes, { search, storage });
    expect(first.remotes[1]).toEqual({
      name: "payments",
      entry: "http://localhost:3002/mf-manifest.json",
    });
    expect(first.remotes[0]).toEqual(remotes[0] as RemoteEntry);
    expect(first.overridden).toEqual([
      { name: "payments", entry: "http://localhost:3002/mf-manifest.json", added: false },
    ]);

    // Следующая загрузка страницы без параметра помнит подмену.
    const second = applyRemoteOverrides(remotes, { search: "", storage });
    expect(second.overridden).toHaveLength(1);

    const reset = applyRemoteOverrides(remotes, { search: "?mfe-override=reset", storage });
    expect(reset.overridden).toEqual([]);
    expect(storage.data.size).toBe(0);
  });

  test.each([
    ["payments=https://evil.example/mf-manifest.json"],
    ["payments=javascript:alert(1)"],
    ["payments=not a url"],
  ])("адрес %p не разрешён — подмены нет, есть предупреждение", (param) => {
    const result = applyRemoteOverrides(remotes, {
      search: `?mfe-override=${encodeURIComponent(param)}`,
      storage: memoryStorage(),
    });
    expect(result.remotes).toEqual(remotes);
    expect(warn).toHaveBeenCalled();
  });

  test("ремоут, которого нет в конфигурации, добавляется в конец и запоминается", () => {
    const storage = memoryStorage();
    const search = "?mfe-override=cards=http://localhost:3009/mf-manifest.json";
    const result = applyRemoteOverrides(remotes, { search, storage });

    expect(result.remotes).toEqual([
      ...remotes,
      { name: "cards", entry: "http://localhost:3009/mf-manifest.json" },
    ]);
    expect(result.overridden).toEqual([
      { name: "cards", entry: "http://localhost:3009/mf-manifest.json", added: true },
    ]);
    expect(applyRemoteOverrides(remotes, { search: "", storage }).remotes).toHaveLength(3);
  });

  test("новый ремоут: только локальный адрес и имя-идентификатор", () => {
    const result = applyRemoteOverrides(remotes, {
      search: [
        "?mfe-override=cards=https://evil.example/mf-manifest.json",
        "mfe-override=credit-cards=http://localhost:3009/mf-manifest.json",
        "mfe-override=payments",
      ].join("&"),
      storage: memoryStorage(),
    });
    expect(result.remotes).toEqual(remotes);
    expect(result.overridden).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  test("allowNew: false — подменяются только ремоуты из конфигурации", () => {
    const result = applyRemoteOverrides(remotes, {
      search: "?mfe-override=cards=http://localhost:3009/mf-manifest.json",
      storage: memoryStorage(),
      allowNew: false,
    });
    expect(result.remotes).toEqual(remotes);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("свой список разрешённых адресов", () => {
    const result = applyRemoteOverrides(remotes, {
      search: "?mfe-override=accounts=https://stage.bank.example/accounts/mf-manifest.json",
      storage: null,
      allow: (url) => url.hostname === "stage.bank.example",
    });
    expect(result.overridden).toEqual([
      {
        name: "accounts",
        entry: "https://stage.bank.example/accounts/mf-manifest.json",
        added: false,
      },
    ]);
  });

  test("недоступное хранилище не ломает подмену", () => {
    const broken: OverrideStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    };
    const result = applyRemoteOverrides(remotes, {
      search: "?mfe-override=accounts=http://127.0.0.1:3001/mf-manifest.json",
      storage: broken,
    });
    expect(result.overridden).toHaveLength(1);
  });
});

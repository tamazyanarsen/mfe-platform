import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { CONTRACT_VERSION, navigateEvent, type RemoteManifest } from "@mfe/contract";
import {
  createHostRouter,
  createRouteTable,
  type HostRouter,
  normalizeBase,
  type RouteMatch,
  stripBase,
  withBase,
} from "../src";

const manifest = (name: string, routes: string[]): RemoteManifest => ({
  contractVersion: CONTRACT_VERSION,
  name,
  tag: `mfe-${name}`,
  routes,
});

const table = createRouteTable([
  manifest("accounts", ["/accounts", "/accounts/*"]),
  manifest("payments", ["/payments/*"]),
  manifest("cards", ["/accounts/cards/*"]),
  manifest("home", ["/"]),
]);

describe("createRouteTable", () => {
  test.each([
    ["/accounts", "accounts", "/accounts"],
    ["/accounts/", "accounts", "/accounts"],
    ["/accounts/42", "accounts", "/accounts"],
    ["/accounts/cards/1", "cards", "/accounts/cards"],
    ["/payments", "payments", "/payments"],
    ["/payments/new", "payments", "/payments"],
    ["/", "home", "/"],
  ])("%s → %s", (path, remote, basename) => {
    expect(table.resolve(path)).toMatchObject({ remote, basename });
  });

  test("префикс не совпадает с соседним именем и чужие пути не находятся", () => {
    expect(table.resolve("/accountsx")).toBeNull();
    expect(table.resolve("/unknown")).toBeNull();
  });

  test("два ремоута на одном маршруте — конфликт виден, побеждает первый", () => {
    const conflicting = createRouteTable([
      manifest("accounts", ["/accounts/*"]),
      manifest("accounts-next", ["/accounts/*", "/next"]),
    ]);
    expect(conflicting.conflicts).toEqual([
      { pattern: "/accounts/*", remotes: ["accounts", "accounts-next"] },
    ]);
    expect(conflicting.resolve("/accounts/1")?.remote).toBe("accounts");
    expect(table.conflicts).toEqual([]);
  });
});

describe("createHostRouter", () => {
  let router: HostRouter | null = null;
  const seen: Array<[string | null, string]> = [];

  const start = () => {
    router = createHostRouter({
      table,
      onRoute: (match: RouteMatch | null, path) => seen.push([match?.remote ?? null, path]),
    }).start();
    return router;
  };

  afterEach(() => {
    router?.dispose();
    router = null;
    seen.length = 0;
    history.replaceState(null, "", "/");
  });

  test("сообщает маршрут при старте и при навигации", () => {
    history.replaceState(null, "", "/accounts/1");
    const r = start();
    r.navigate("/payments/new");
    expect(location.pathname).toBe("/payments/new");
    expect(seen).toEqual([
      ["accounts", "/accounts/1"],
      ["payments", "/payments/new"],
    ]);
  });

  test("навигация будит роутеры ремоутов через popstate", () => {
    const r = start();
    let popstates = 0;
    const listener = () => popstates++;
    addEventListener("popstate", listener);
    r.navigate("/accounts");
    removeEventListener("popstate", listener);
    expect(popstates).toBe(1);
  });

  test("ремоут просит хост навигировать событием platform:navigate", () => {
    start();
    const remote = document.createElement("div");
    document.body.append(remote);
    remote.dispatchEvent(navigateEvent("/payments", { replace: true }));
    expect(location.pathname).toBe("/payments");
    expect(seen.at(-1)).toEqual(["payments", "/payments"]);
    remote.remove();
  });

  test("onRoute может редиректить через сам роутер", () => {
    const r: HostRouter = createHostRouter({
      table,
      onRoute: (match, path) => {
        if (path === "/") return r.navigate("/accounts", { replace: true });
        seen.push([match?.remote ?? null, path]);
      },
    });
    router = r.start();
    expect(location.pathname).toBe("/accounts");
    expect(seen.at(-1)).toEqual(["accounts", "/accounts"]);
  });

  test("переход на тот же адрес ничего не делает, после dispose событий нет", () => {
    history.replaceState(null, "", "/accounts");
    const r = start();
    r.navigate("/accounts");
    expect(seen).toHaveLength(1);
    r.dispose();
    document.dispatchEvent(navigateEvent("/payments"));
    expect(location.pathname).toBe("/accounts");
  });
});

describe("навигация наружу", () => {
  afterEach(() => history.replaceState(null, "", "/"));

  test.each([
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["vbscript:msgbox(1)"],
  ])("platform:navigate на %p не исполняется", (to) => {
    const router = createHostRouter({ table, onRoute: () => {} }).start();
    const assign = spyOn(location, "assign").mockImplementation(() => {});
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    document.dispatchEvent(navigateEvent(to));
    expect(assign).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(location.pathname).toBe("/");
    assign.mockRestore();
    warn.mockRestore();
    router.dispose();
  });

  test("внешний http-адрес открывается полной загрузкой", () => {
    const router = createHostRouter({ table, onRoute: () => {} }).start();
    const assign = spyOn(location, "assign").mockImplementation(() => {});
    router.navigate("https://bank.example/help");
    expect(assign).toHaveBeenCalledWith("https://bank.example/help");
    assign.mockRestore();
    router.dispose();
  });
});

describe("наблюдение за историей", () => {
  test("pushState ремоута пересчитывает маршрут хоста, dispose возвращает историю", () => {
    const seen: Array<string | null> = [];
    const original = history.pushState;
    const router = createHostRouter({
      table,
      onRoute: (match) => seen.push(match?.remote ?? null),
    }).start();

    // Так навигирует роутер ремоута внутри своего basename.
    history.pushState(null, "", "/payments/new");
    expect(seen).toEqual(["home", "payments"]);
    expect(router.current?.remote).toBe("payments");

    router.dispose();
    expect(history.pushState).toBe(original);
    history.replaceState(null, "", "/");
  });
});

describe("префикс пути хоста", () => {
  test.each([
    ["", ""],
    ["/", ""],
    ["/mfe-platform/", "/mfe-platform"],
    ["business", "/business"],
  ])("normalizeBase(%p) → %p", (raw, base) => {
    expect(normalizeBase(raw)).toBe(base);
  });

  test("withBase добавляет префикс только к путям приложения", () => {
    expect(withBase("/b", "/accounts")).toBe("/b/accounts");
    expect(withBase("/b", "/")).toBe("/b/");
    expect(withBase("/b", "/b/accounts")).toBe("/b/accounts");
    expect(withBase("/b", "//cdn.example/x")).toBe("//cdn.example/x");
    expect(withBase("/b", "https://example.com/")).toBe("https://example.com/");
    expect(withBase("", "/accounts")).toBe("/accounts");
  });

  test("stripBase снимает префикс, адрес вне префикса — null", () => {
    expect(stripBase("/b", "/b")).toBe("/");
    expect(stripBase("/b", "/b/")).toBe("/");
    expect(stripBase("/b", "/b/accounts/1")).toBe("/accounts/1");
    expect(stripBase("/b", "/bx/accounts")).toBeNull();
    expect(stripBase("/b", "/accounts")).toBeNull();
    expect(stripBase("", "/accounts")).toBe("/accounts");
  });

  describe("роутер под префиксом", () => {
    let router: HostRouter | null = null;
    const seen: Array<[string | null, string]> = [];
    const start = () => {
      router = createHostRouter({
        table,
        base: "/bank/",
        onRoute: (match, path) => seen.push([match?.remote ?? null, path]),
      }).start();
      return router;
    };

    afterEach(() => {
      router?.dispose();
      router = null;
      seen.length = 0;
      history.replaceState(null, "", "/");
    });

    test("маршрут ищется по пути без префикса, навигация добавляет префикс", () => {
      history.replaceState(null, "", "/bank/accounts/1");
      const r = start();
      r.navigate("/payments/new");
      expect(location.pathname).toBe("/bank/payments/new");
      expect(seen).toEqual([
        ["accounts", "/accounts/1"],
        ["payments", "/payments/new"],
      ]);
      expect(r.base).toBe("/bank");
      expect(r.href("/accounts")).toBe("/bank/accounts");
      expect(r.appPath("/bank/accounts")).toBe("/accounts");
    });

    test("platform:navigate ремоута — путь приложения, префикс добавляет хост", () => {
      start();
      document.dispatchEvent(navigateEvent("/payments"));
      expect(location.pathname).toBe("/bank/payments");
      expect(seen.at(-1)).toEqual(["payments", "/payments"]);
    });

    test('корень хоста — путь приложения "/", адрес вне префикса не находит ремоут', () => {
      history.replaceState(null, "", "/bank/");
      start();
      expect(seen.at(-1)).toEqual(["home", "/"]);
      history.pushState(null, "", "/accounts");
      expect(seen.at(-1)).toEqual([null, "/accounts"]);
    });
  });
});

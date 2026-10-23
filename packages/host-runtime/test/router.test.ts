import { afterEach, describe, expect, test } from "bun:test";
import { CONTRACT_VERSION, navigateEvent, type RemoteManifest } from "@mfe/contract";
import { createHostRouter, createRouteTable, type HostRouter, type RouteMatch } from "../src";

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

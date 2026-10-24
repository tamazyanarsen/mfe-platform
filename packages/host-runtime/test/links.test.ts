import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CONTRACT_VERSION, type RemoteManifest, type RemoteModule } from "@mfe-platform/contract";
import {
  createHostRouter,
  createPrefetcher,
  createRouteTable,
  type HostRouter,
  interceptLinks,
  type RemoteLoader,
} from "../src";

const manifest = (name: string): RemoteManifest => ({
  contractVersion: CONTRACT_VERSION,
  name,
  tag: `mfe-${name}`,
  routes: [`/${name}`, `/${name}/*`],
});
const table = createRouteTable([manifest("accounts"), manifest("payments")]);

describe("createPrefetcher", () => {
  test("грузит код ремоута один раз и только для известного маршрута", async () => {
    const calls: string[] = [];
    const loader: RemoteLoader = {
      loadManifest: async (name) => manifest(name),
      loadModule: async (name) => {
        calls.push(name);
        return { manifest: manifest(name), register() {} } satisfies RemoteModule;
      },
    };
    const prefetch = createPrefetcher({ table, loader });
    await prefetch("/payments/new");
    await prefetch("/payments");
    await prefetch("/unknown");
    expect(calls).toEqual(["payments"]);
  });

  test("упавшая предзагрузка не бросает и повторяется при следующем наведении", async () => {
    let attempts = 0;
    const loader: RemoteLoader = {
      loadManifest: async (name) => manifest(name),
      loadModule: async () => {
        attempts++;
        throw new Error("offline");
      },
    };
    const prefetch = createPrefetcher({ table, loader });
    await prefetch("/accounts");
    await prefetch("/accounts");
    expect(attempts).toBe(2);
  });
});

describe("interceptLinks", () => {
  let router: HostRouter;
  let dispose = () => {};
  const prefetched: string[] = [];
  const seen: Array<string | null> = [];

  beforeEach(() => {
    history.replaceState(null, "", "/accounts");
    router = createHostRouter({
      table,
      onRoute: (match) => seen.push(match?.remote ?? null),
    }).start();
    dispose = interceptLinks({ router, prefetch: (path) => prefetched.push(path) });
    seen.length = 0;
  });

  afterEach(() => {
    dispose();
    router.dispose();
    document.body.replaceChildren();
    prefetched.length = 0;
    history.replaceState(null, "", "/");
  });

  const link = (href: string, attributes: Record<string, string> = {}) => {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.textContent = href;
    for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value);
    document.body.append(anchor);
    return anchor;
  };
  /**
   * Клик, после которого happy-dom не переходит по ссылке сам: последний обработчик на window
   * запоминает, отменил ли переход хост, и отменяет его в любом случае.
   */
  const click = (target: Element, init: MouseEventInit = {}) => {
    let prevented = false;
    const last = (event: Event) => {
      prevented = event.defaultPrevented;
      event.preventDefault();
    };
    addEventListener("click", last, { once: true });
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, ...init }),
    );
    return { defaultPrevented: prevented };
  };

  test("обычная ссылка ведёт через роутер хоста", () => {
    const event = click(link("/payments/new?from=accounts"));
    expect(event.defaultPrevented).toBe(true);
    expect(location.pathname + location.search).toBe("/payments/new?from=accounts");
    expect(seen).toEqual(["payments"]);
  });

  test("ссылка из shadow DOM ремоута тоже перехватывается", () => {
    const remote = document.createElement("div");
    document.body.append(remote);
    const shadow = remote.attachShadow({ mode: "open" });
    const anchor = document.createElement("a");
    anchor.href = "/payments";
    const label = document.createElement("span");
    anchor.append(label);
    shadow.append(anchor);

    expect(click(label).defaultPrevented).toBe(true);
    expect(location.pathname).toBe("/payments");
  });

  test.each([
    [{ target: "_blank" }],
    [{ download: "" }],
    [{ rel: "noopener external" }],
    [{ "data-mfe-reload": "" }],
  ])("ссылка с %p остаётся браузеру", (attributes) => {
    expect(click(link("/payments", attributes)).defaultPrevented).toBe(false);
    expect(location.pathname).toBe("/accounts");
  });

  test("модификаторы, средняя кнопка, чужой origin и якорь остаются браузеру", () => {
    expect(click(link("/payments"), { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(click(link("/payments"), { button: 1 }).defaultPrevented).toBe(false);
    expect(click(link("https://bank.example/payments")).defaultPrevented).toBe(false);
    expect(click(link("#details")).defaultPrevented).toBe(false);
    expect(location.pathname).toBe("/accounts");
  });

  test("ссылку, уже обработанную роутером ремоута, хост не трогает", () => {
    const anchor = link("/payments");
    anchor.addEventListener("click", (event) => event.preventDefault());
    click(anchor);
    expect(location.pathname).toBe("/accounts");
    expect(seen).toEqual([]);
  });

  test("наведение и фокус на внутренней ссылке запускают предзагрузку", () => {
    link("/payments").dispatchEvent(new Event("pointerover", { bubbles: true }));
    link("https://bank.example/x").dispatchEvent(new Event("pointerover", { bubbles: true }));
    link("/accounts/1").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(prefetched).toEqual(["/payments", "/accounts/1"]);
  });

  test("после отключения клики не перехватываются", () => {
    dispose();
    expect(click(link("/payments")).defaultPrevented).toBe(false);
  });
});

describe("interceptLinks под префиксом пути", () => {
  afterEach(() => {
    document.body.replaceChildren();
    history.replaceState(null, "", "/");
  });

  test("ссылка с префиксом ведёт без двойного префикса, предзагрузка — по пути приложения", () => {
    history.replaceState(null, "", "/bank/accounts");
    const router = createHostRouter({ table, base: "/bank", onRoute: () => {} }).start();
    const prefetched: string[] = [];
    const dispose = interceptLinks({ router, prefetch: (path) => prefetched.push(path) });

    const anchor = document.createElement("a");
    anchor.href = "/bank/payments";
    document.body.append(anchor);
    anchor.dispatchEvent(new Event("pointerover", { bubbles: true }));
    addEventListener("click", (event) => event.preventDefault(), { once: true });
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(prefetched).toEqual(["/payments"]);
    expect(location.pathname).toBe("/bank/payments");
    dispose();
    router.dispose();
  });
});

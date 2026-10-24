import { afterEach, describe, expect, test } from "bun:test";
import { CONTRACT_VERSION, type RemoteManifest } from "@mfe/contract";
import {
  createHostRouter,
  createManifestSet,
  createRouteTable,
  type HostRouter,
  type RemoteLoader,
} from "../src";

const manifest = (name: string, overrides: Partial<RemoteManifest> = {}): RemoteManifest => ({
  contractVersion: CONTRACT_VERSION,
  name,
  tag: `mfe-${name}`,
  routes: [`/${name}`, `/${name}/*`],
  ...overrides,
});

/** Загрузчик, у которого ремоут из `down` недоступен, пока его оттуда не уберут. */
const flakyLoader = (down: Set<string>, broken: Set<string> = new Set()) => {
  const calls: string[] = [];
  const loader: RemoteLoader = {
    loadManifest: async (name) => {
      calls.push(name);
      if (down.has(name)) throw new Error(`${name} is down`);
      return broken.has(name) ? manifest(name, { tag: "NoDash" }) : manifest(name);
    },
    loadModule: async () => {
      throw new Error("not used");
    },
  };
  return { loader, calls };
};

const quiet = () => {};

describe("createManifestSet", () => {
  test("упавший и невалидный манифесты не мешают остальным", async () => {
    const errors: string[] = [];
    const { loader } = flakyLoader(new Set(["payments"]), new Set(["legacy"]));
    const set = createManifestSet({
      loader,
      names: ["accounts", "payments", "legacy"],
      onError: (name) => errors.push(name),
    });
    await set.load();

    expect(set.manifests().map((m) => m.name)).toEqual(["accounts"]);
    expect(set.failed()).toEqual(["payments", "legacy"]);
    expect(errors).toEqual(["payments", "legacy"]);
  });

  test("retryFailed догружает поднявшийся ремоут и не трогает загруженные", async () => {
    const down = new Set(["payments"]);
    const { loader, calls } = flakyLoader(down);
    let clock = 0;
    const set = createManifestSet({
      loader,
      names: ["accounts", "payments"],
      onError: quiet,
      now: () => clock,
    });
    await set.load();
    expect(await set.retryFailed()).toBe(false);

    down.clear();
    // Раньше интервала повтор не идёт в сеть.
    clock = 1000;
    expect(await set.retryFailed()).toBe(false);
    clock = 5000;
    expect(await set.retryFailed()).toBe(true);

    expect(set.manifests().map((m) => m.name)).toEqual(["accounts", "payments"]);
    expect(set.failed()).toEqual([]);
    expect(calls).toEqual(["accounts", "payments", "payments", "payments"]);
    clock = 20_000;
    expect(await set.retryFailed()).toBe(false);
  });

  test("одновременные повторы — один запрос", async () => {
    const { loader, calls } = flakyLoader(new Set(["payments"]));
    const set = createManifestSet({ loader, names: ["payments"], onError: quiet });
    await set.load();
    const [first, second] = await Promise.all([set.retryFailed(), set.retryFailed()]);
    expect([first, second]).toEqual([false, false]);
    expect(calls).toEqual(["payments", "payments"]);
  });
});

describe("HostRouter.replaceTable", () => {
  let router: HostRouter | null = null;
  afterEach(() => {
    router?.dispose();
    history.replaceState(null, "", "/");
  });

  test("новая таблица применяется сразу: чужой путь становится маршрутом ремоута", () => {
    history.replaceState(null, "", "/payments/new");
    const seen: Array<string | null> = [];
    router = createHostRouter({
      table: createRouteTable([manifest("accounts")]),
      onRoute: (match) => seen.push(match?.remote ?? null),
    }).start();

    router.replaceTable(createRouteTable([manifest("accounts"), manifest("payments")]));
    expect(seen).toEqual([null, "payments"]);
    expect(router.current?.remote).toBe("payments");
  });

  test("до start() новая таблица только запоминается", () => {
    const seen: Array<string | null> = [];
    router = createHostRouter({
      table: createRouteTable([]),
      onRoute: (m) => seen.push(m?.remote ?? null),
    });
    router.replaceTable(createRouteTable([manifest("accounts")]));
    expect(seen).toEqual([]);
    history.replaceState(null, "", "/accounts");
    router.start();
    expect(seen).toEqual(["accounts"]);
  });
});

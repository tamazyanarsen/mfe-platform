import { afterEach, describe, expect, test } from "bun:test";
import {
  CONTRACT_VERSION,
  type ObservabilityTransport,
  type PlatformEvent,
  type PolicyHook,
  type RemoteManifest,
  type RemoteModule,
} from "@mfe/contract";
import {
  combineTransports,
  createMemoryTransport,
  defineMfeOutlet,
  type MemoryTransport,
  type MfeOutletElement,
  type OutletOptions,
  type RemoteLoader,
  whenOutletSettles,
} from "../src";

// Каждый тест объявляет outlet под своим тегом: customElements нельзя очистить между тестами.
let tagCounter = 0;
const uniqueTag = (base: string) => `${base}-${++tagCounter}`;

/** Ремоут без rwc и без React: голый HTMLElement и манифест. */
const fakeRemote = (name: string, overrides: Partial<RemoteManifest> = {}) => {
  const manifest: RemoteManifest = {
    contractVersion: CONTRACT_VERSION,
    name,
    tag: uniqueTag(`fake-${name}`),
    routes: [`/${name}`],
    extra: { team: "core", owner: "alice" },
    ...overrides,
  };
  let registerCalls = 0;
  const module: RemoteModule = {
    manifest,
    register() {
      registerCalls++;
      if (customElements.get(manifest.tag)) return;
      customElements.define(
        manifest.tag,
        class extends HTMLElement {
          greeting = "";
          connectedCallback() {
            this.textContent = `hello from ${name}${this.greeting ? `, ${this.greeting}` : ""}`;
          }
        },
      );
    },
  };
  return { manifest, module, registerCalls: () => registerCalls };
};

const memoryLoader = (...remotes: ReturnType<typeof fakeRemote>[]) => {
  const calls: string[] = [];
  const byName = new Map(remotes.map((remote) => [remote.manifest.name, remote]));
  const find = (name: string) => {
    const remote = byName.get(name);
    if (!remote) throw new Error(`unknown remote ${name}`);
    return remote;
  };
  const loader: RemoteLoader = {
    loadManifest: async (name) => {
      calls.push(`manifest:${name}`);
      return find(name).manifest;
    },
    loadModule: async (name) => {
      calls.push(`module:${name}`);
      return find(name).module;
    },
  };
  return { loader, calls };
};

const mount = async (options: OutletOptions, remote: string, props?: Record<string, unknown>) => {
  const tag = defineMfeOutlet(options, uniqueTag("test-outlet"));
  const outlet = document.createElement(tag) as MfeOutletElement;
  if (props) outlet.props = props;
  outlet.remote = remote;
  document.body.append(outlet);
  const state = await whenOutletSettles(outlet);
  return { outlet, state };
};

afterEach(() => {
  document.body.replaceChildren();
});

/** Ждёт событие в транспорте: mount:ready уходит после первого кадра. */
const eventOf = async (transport: MemoryTransport, type: PlatformEvent["type"]) => {
  for (let i = 0; i < 50; i++) {
    const found = transport.events().find((event) => event.type === type);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`no ${type} event`);
};

describe("<mfe-outlet>", () => {
  test("монтирует ремоут без rwc и React, не зная его внутренностей", async () => {
    const remote = fakeRemote("accounts");
    const { loader } = memoryLoader(remote);
    const { outlet, state } = await mount(
      { loader, transport: createMemoryTransport() },
      "accounts",
      {
        greeting: "world",
      },
    );

    expect(state).toBe("ready");
    expect(outlet.getAttribute("state")).toBe("ready");
    expect(outlet.remoteElement?.localName).toBe(remote.manifest.tag);
    expect(outlet.textContent).toBe("hello from accounts, world");
  });

  test("register() идемпотентна: второй outlet того же ремоута не падает", async () => {
    const remote = fakeRemote("payments");
    const { loader } = memoryLoader(remote);
    const options = { loader, transport: createMemoryTransport() };
    await mount(options, "payments");
    const second = await mount(options, "payments");

    expect(second.state).toBe("ready");
    expect(remote.registerCalls()).toBe(2);
  });

  test("свойства из props доходят до элемента ремоута и обновляются", async () => {
    const remote = fakeRemote("profile");
    const { loader } = memoryLoader(remote);
    const { outlet } = await mount({ loader, transport: createMemoryTransport() }, "profile", {
      greeting: "a",
    });
    outlet.props = { greeting: "b" };
    expect((outlet.remoteElement as HTMLElement & { greeting: string }).greeting).toBe("b");
  });

  test("внешний PolicyHook запрещает монтирование — outlet показывает запрет", async () => {
    const remote = fakeRemote("legacy");
    const { loader, calls } = memoryLoader(remote);
    const transport = createMemoryTransport();
    const onlyOwned: PolicyHook = {
      beforeMount: ({ manifest }) =>
        manifest.extra?.owner === "nobody"
          ? { allow: true }
          : { allow: false, reason: "remote is not owned by the platform team" },
    };
    const { outlet, state } = await mount({ loader, transport, policies: [onlyOwned] }, "legacy");

    expect(state).toBe("denied");
    expect(outlet.querySelector("[role=alert]")?.textContent).toContain(
      "remote is not owned by the platform team",
    );
    expect(outlet.remoteElement).toBeNull();
    // Тяжёлый код запрещённого ремоута даже не загружается.
    expect(calls).toEqual(["manifest:legacy"]);
    expect(remote.registerCalls()).toBe(0);
    expect(transport.events().map((e) => e.type)).toEqual(["mount:start", "mount:denied"]);
  });

  test("ошибка загрузки остаётся внутри outlet и уходит в транспорт", async () => {
    const transport = createMemoryTransport();
    const loader: RemoteLoader = {
      loadManifest: () => Promise.reject(new Error("Failed to fetch")),
      loadModule: () => Promise.reject(new Error("unreachable")),
    };
    const { outlet, state } = await mount({ loader, transport }, "broken");

    expect(state).toBe("error");
    expect(outlet.querySelector("[role=alert]")).not.toBeNull();
    const [, error] = transport.events();
    expect(error).toMatchObject({
      type: "mount:error",
      name: "broken",
      error: { message: "Failed to fetch" },
    });
  });

  test("несовместимая версия контракта и кривой манифест — ошибка, а не монтирование", async () => {
    const future = fakeRemote("future", { contractVersion: CONTRACT_VERSION + 1 });
    const invalid = fakeRemote("invalid", { tag: "NoDash" });
    const { loader } = memoryLoader(future, invalid);
    const options = { loader, transport: createMemoryTransport() };

    expect((await mount(options, "future")).state).toBe("error");
    expect((await mount(options, "invalid")).state).toBe("error");
    expect(future.registerCalls() + invalid.registerCalls()).toBe(0);
  });

  test("смена remote во время загрузки: ответ старой загрузки игнорируется", async () => {
    const slow = fakeRemote("slow");
    const fast = fakeRemote("fast");
    let releaseSlow = () => {};
    const loader: RemoteLoader = {
      loadManifest: async (name) => {
        if (name === "slow") await new Promise<void>((resolve) => (releaseSlow = resolve));
        return (name === "slow" ? slow : fast).manifest;
      },
      loadModule: async (name) => (name === "slow" ? slow : fast).module,
    };
    const tag = defineMfeOutlet(
      { loader, transport: createMemoryTransport() },
      uniqueTag("test-outlet"),
    );
    const outlet = document.createElement(tag) as MfeOutletElement;
    outlet.remote = "slow";
    document.body.append(outlet);
    outlet.remote = "fast";
    await whenOutletSettles(outlet);
    releaseSlow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(outlet.remoteElement?.localName).toBe(fast.manifest.tag);
    expect(slow.registerCalls()).toBe(0);
  });

  test("manifest.extra проносится в события насквозь", async () => {
    const remote = fakeRemote("billing", { extra: { costCenter: "CC-42" } });
    const { loader } = memoryLoader(remote);
    const transport = createMemoryTransport();
    await mount({ loader, transport }, "billing");
    const ready = await eventOf(transport, "mount:ready");
    expect(ready?.extra).toEqual({ costCenter: "CC-42" });
    expect(ready?.mountId).toBeString();
  });
});

describe("A6: изоляция ошибок и наблюдаемость", () => {
  /** Ремоут, который падает при отрисовке. */
  const crashingRemote = (name: string) => {
    const remote = fakeRemote(name, { version: "1.4.2", extra: { team: "cards" } });
    const module: RemoteModule = {
      manifest: remote.manifest,
      register() {
        if (customElements.get(remote.manifest.tag)) return;
        customElements.define(
          remote.manifest.tag,
          class extends HTMLElement {
            connectedCallback() {
              throw new Error(`${name} exploded while rendering`);
            }
          },
        );
      },
    };
    return { ...remote, module };
  };

  test("исключение при отрисовке: fallback, соседний ремоут работает, событие со всеми полями", async () => {
    history.replaceState(null, "", "/cards/7");
    const broken = crashingRemote("cards");
    const healthy = fakeRemote("accounts");
    const { loader } = memoryLoader(broken, healthy);
    const transport = createMemoryTransport();
    const options = { loader, transport };

    const [crashed, neighbour] = await Promise.all([
      mount(options, "cards"),
      mount(options, "accounts"),
    ]);

    expect(crashed.state).toBe("error");
    expect(crashed.outlet.querySelector("[role=alert]")).not.toBeNull();
    expect(crashed.outlet.remoteElement).toBeNull();
    expect(neighbour.state).toBe("ready");
    expect(neighbour.outlet.textContent).toBe("hello from accounts");

    const error = await eventOf(transport, "mount:error");
    expect(error).toMatchObject({
      type: "mount:error",
      name: "cards",
      version: "1.4.2",
      mountId: crashed.outlet.mountId,
      route: "/cards/7",
      contractVersion: CONTRACT_VERSION,
      extra: { team: "cards" },
      error: { message: "cards exploded while rendering" },
      details: { phase: "render" },
    });
    history.replaceState(null, "", "/");
  });

  test("mount:ready несёт время загрузки кода и время до первого кадра", async () => {
    const { loader } = memoryLoader(fakeRemote("timed"));
    const transport = createMemoryTransport();
    await mount({ loader, transport }, "timed");
    const ready = await eventOf(transport, "mount:ready");
    expect(ready.timings?.codeLoad).toBeNumber();
    expect(ready.timings?.firstFrame).toBeGreaterThanOrEqual(ready.timings?.codeLoad ?? 0);
  });

  test("подменённый транспорт получает те же события — внешний коллектор подключится без форка", async () => {
    const received: PlatformEvent[] = [];
    const collector: ObservabilityTransport = { send: (event) => received.push(event) };
    const buffer = createMemoryTransport();
    const { loader } = memoryLoader(crashingRemote("loans"), fakeRemote("deposits"));
    const options = { loader, transport: combineTransports(buffer, collector) };

    await mount(options, "loans");
    await mount(options, "deposits");
    await eventOf(buffer, "mount:ready");

    expect(received).toEqual(buffer.events());
    expect(received.map((e) => e.type)).toContain("mount:error");
  });

  test("падение транспорта не роняет монтирование", async () => {
    const broken: ObservabilityTransport = {
      send() {
        throw new Error("collector is down");
      },
    };
    const { loader } = memoryLoader(fakeRemote("resilient"));
    const { state } = await mount(
      { loader, transport: combineTransports(broken, createMemoryTransport()) },
      "resilient",
    );
    expect(state).toBe("ready");
  });
});

import {
  CONTRACT_VERSION,
  type PlatformEvent,
  type RemoteManifest,
  type RemoteModule,
  validateManifest,
} from "@mfe/contract";
import {
  createMemoryTransport,
  defineMfeOutlet,
  type MemoryTransport,
  type MfeOutletElement,
  type OutletOptions,
  type OutletState,
  type RemoteLoader,
  whenOutletSettles,
} from "@mfe/host-runtime";

/**
 * Помощники для тестов ремоута: смонтировать его так, как это сделает хост, и проверить
 * контракт без хоста, Module Federation и сети. Работают в любом DOM-окружении тестов
 * (happy-dom, jsdom, браузер).
 */

export interface MemoryLoader extends RemoteLoader {
  /** Журнал обращений: "manifest:accounts", "module:accounts". */
  readonly calls: readonly string[];
}

/** Загрузчик в памяти: ремоуты отдаются по `manifest.name`. */
export const createMemoryLoader = (...modules: readonly RemoteModule[]): MemoryLoader => {
  const calls: string[] = [];
  const byName = new Map(modules.map((module) => [module.manifest.name, module]));
  const find = (name: string) => {
    const module = byName.get(name);
    if (!module) throw new Error(`[mfe/testing] unknown remote "${name}"`);
    return module;
  };
  return {
    calls,
    loadManifest: async (name) => {
      calls.push(`manifest:${name}`);
      return find(name).manifest;
    },
    loadModule: async (name) => {
      calls.push(`module:${name}`);
      return find(name);
    },
  };
};

// customElements не очищается: у каждого монтирования свой тег outlet.
const COUNTER_KEY = Symbol.for("mfe-platform.testing.outlets");
const nextOutletTag = () => {
  const scope = globalThis as unknown as Record<symbol, number | undefined>;
  scope[COUNTER_KEY] = (scope[COUNTER_KEY] ?? 0) + 1;
  return `mfe-test-outlet-${scope[COUNTER_KEY]}`;
};

export interface MountRemoteOptions {
  /** Входные свойства, как их передаёт хост: `{ platform: {...} }`. */
  readonly props?: Readonly<Record<string, unknown>>;
  readonly basename?: string;
  /** Куда вставить outlet. По умолчанию — document.body. */
  readonly container?: Element;
  /** Политики, версии контракта, fallback — как у хоста. */
  readonly outlet?: Omit<OutletOptions, "loader" | "transport">;
}

export interface MountedRemote {
  readonly outlet: MfeOutletElement;
  readonly state: OutletState;
  /** Элемент ремоута, если монтирование удалось. */
  readonly element: HTMLElement | null;
  /** События монтирования: mount:start, mount:ready, mount:error… */
  readonly events: MemoryTransport;
  /** Убирает outlet со страницы — элемент ремоута получает disconnectedCallback. */
  unmount(): void;
}

/** Монтирует ремоут через настоящий `<mfe-outlet>` и ждёт ready, error или denied. */
export const mountRemote = async (
  module: RemoteModule,
  { props, basename, container = document.body, outlet: outletOptions }: MountRemoteOptions = {},
): Promise<MountedRemote> => {
  const events = createMemoryTransport();
  const tag = defineMfeOutlet(
    { ...outletOptions, loader: createMemoryLoader(module), transport: events },
    nextOutletTag(),
  );
  const outlet = document.createElement(tag) as MfeOutletElement;
  if (props) outlet.props = props;
  if (basename !== undefined) outlet.basename = basename;
  outlet.remote = module.manifest.name;
  container.append(outlet);
  const state = await whenOutletSettles(outlet);
  return { outlet, state, element: outlet.remoteElement, events, unmount: () => outlet.remove() };
};

export interface CheckRemoteOptions {
  /** Экспорт `./manifest` ремоута: должен совпадать с манифестом из `./entry`. */
  readonly manifest?: RemoteManifest;
  /** Версии контракта, которые поддерживает хост. По умолчанию — текущая. */
  readonly contractVersions?: readonly number[];
  /** Свойства для пробного монтирования. */
  readonly props?: Readonly<Record<string, unknown>>;
}

const errorOf = (events: readonly PlatformEvent[]) =>
  events.find((event) => event.type === "mount:error")?.error?.message;

/**
 * Проверяет ремоут на соответствие контракту и возвращает список проблем; пустой список —
 * ремоут подключится к хосту. Удобно в CI ремоута:
 *
 *   expect(await checkRemote(entry, { manifest })).toEqual([]);
 */
export const checkRemote = async (
  module: RemoteModule,
  { manifest, contractVersions = [CONTRACT_VERSION], props }: CheckRemoteOptions = {},
): Promise<string[]> => {
  const problems = validateManifest(module.manifest).map((problem) => `manifest: ${problem}`);
  if (problems.length > 0) return problems;
  const { tag, name, contractVersion } = module.manifest;

  if (manifest) {
    for (const key of ["name", "tag", "contractVersion"] as const) {
      if (manifest[key] !== module.manifest[key]) {
        problems.push(`./manifest and ./entry disagree on ${key}`);
      }
    }
  }
  if (!contractVersions.includes(contractVersion)) {
    problems.push(`contract version ${contractVersion} is not supported by the host`);
  }

  try {
    await module.register();
    await module.register();
  } catch (error) {
    problems.push(`register() must be idempotent: ${(error as Error).message}`);
    return problems;
  }
  if (!customElements.get(tag)) {
    problems.push(`register() did not define <${tag}>`);
    return problems;
  }

  const mounted = await mountRemote(module, {
    ...(props ? { props } : {}),
    basename: `/${name}`,
    outlet: { contractVersions },
  });
  if (mounted.state !== "ready") {
    problems.push(`mount failed: ${errorOf(mounted.events.events()) ?? mounted.state}`);
  }
  mounted.unmount();
  return problems;
};

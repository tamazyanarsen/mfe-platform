import { REMOTE_EXPOSES, type RemoteManifest, type RemoteModule } from "@mfe-platform/contract";

/**
 * Как хост достаёт ремоут по имени. Интерфейс не знает о сборщике: Module Federation —
 * одна из реализаций, в тестах — объект в памяти.
 */
export interface RemoteLoader {
  /** Лёгкий статический манифест, без тяжёлого кода ремоута. */
  loadManifest(name: string): Promise<RemoteManifest>;
  /** Модуль с `register()`; тяжёлый код грузится здесь. */
  loadModule(name: string): Promise<RemoteModule>;
}

/** Сигнатура `loadRemote` из рантайма Module Federation. */
export type LoadRemote = <T>(id: string) => Promise<T | null | undefined>;

const exposeId = (name: string, expose: string) => `${name}/${expose.replace(/^\.\//, "")}`;

/**
 * Загрузчик поверх Module Federation. Ремоут экспонирует `./manifest` с именованным
 * экспортом `manifest` и `./entry`, чьи экспорты `manifest` и `register` и есть
 * `RemoteModule`. Результаты кешируются; упавшая загрузка повторяется при следующем вызове.
 */
export const createFederationLoader = (loadRemote: LoadRemote): RemoteLoader => {
  const cache = new Map<string, Promise<unknown>>();
  const load = <T>(id: string): Promise<T> => {
    let pending = cache.get(id);
    if (!pending) {
      pending = loadRemote<T>(id).then((module) => {
        if (module == null) throw new Error(`remote module "${id}" is empty`);
        return module;
      });
      pending.catch(() => cache.delete(id));
      cache.set(id, pending);
    }
    return pending as Promise<T>;
  };

  return {
    loadManifest: async (name) =>
      (await load<{ manifest: RemoteManifest }>(exposeId(name, REMOTE_EXPOSES.manifest))).manifest,
    loadModule: (name) => load<RemoteModule>(exposeId(name, REMOTE_EXPOSES.entry)),
  };
};

import { type RemoteManifest, validateManifest } from "@mfe/contract";
import type { RemoteLoader } from "./loader";

/**
 * Манифесты всех ремоутов хоста. Недоступный при старте ремоут не должен выпадать до
 * перезагрузки страницы: `retryFailed()` пробует снова, и маршруты ремоута появляются, как
 * только он поднялся.
 */
export interface ManifestSet {
  /** Загружает манифесты всех ремоутов; падение одного не мешает остальным. */
  load(): Promise<void>;
  /** Загруженные и валидные манифесты в порядке конфигурации. */
  manifests(): RemoteManifest[];
  /** Ремоуты, чей манифест не загрузился или не прошёл проверку. */
  failed(): string[];
  /**
   * Повторяет загрузку упавших манифестов, не чаще раза в `retryIntervalMs`. Возвращает
   * true, если появился хотя бы один новый манифест.
   */
  retryFailed(): Promise<boolean>;
}

export interface ManifestSetOptions {
  readonly loader: RemoteLoader;
  readonly names: readonly string[];
  /** Минимальный интервал между повторами: недоступный ремоут не долбят на каждом переходе. */
  readonly retryIntervalMs?: number;
  /** Сообщение о неудаче; по умолчанию — console.error. */
  readonly onError?: (name: string, error: unknown) => void;
  /** Часы; подменяются в тестах. */
  readonly now?: () => number;
}

export const createManifestSet = ({
  loader,
  names,
  retryIntervalMs = 5000,
  onError = (name, error) => console.error(`[mfe] manifest of "${name}" is unavailable`, error),
  now = Date.now,
}: ManifestSetOptions): ManifestSet => {
  const loaded = new Map<string, RemoteManifest>();
  let lastRetry = Number.NEGATIVE_INFINITY;
  let pending: Promise<boolean> | null = null;

  const loadSome = async (batch: readonly string[]) => {
    const results = await Promise.allSettled(batch.map((name) => loader.loadManifest(name)));
    let added = false;
    results.forEach((result, index) => {
      const name = batch[index] as string;
      if (result.status === "rejected") {
        onError(name, result.reason);
        return;
      }
      const problems = validateManifest(result.value);
      if (problems.length > 0) {
        onError(name, new Error(problems.join("; ")));
        return;
      }
      loaded.set(name, result.value);
      added = true;
    });
    return added;
  };

  const failed = () => names.filter((name) => !loaded.has(name));

  return {
    load: async () => {
      await loadSome(names);
    },
    manifests: () => names.flatMap((name) => loaded.get(name) ?? []),
    failed,
    retryFailed() {
      if (pending) return pending;
      const batch = failed();
      if (batch.length === 0 || now() - lastRetry < retryIntervalMs) return Promise.resolve(false);
      lastRetry = now();
      pending = loadSome(batch).finally(() => {
        pending = null;
      });
      return pending;
    },
  };
};

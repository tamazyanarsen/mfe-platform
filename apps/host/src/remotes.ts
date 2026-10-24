import {
  loadJsonConfig,
  type RemoteEntry,
  type StoreAccess,
  validateRemoteEntries,
  validateStoreAccess,
} from "@mfe/host-runtime";

/**
 * Конфигурация хоста: какие ремоуты есть, где их MF-манифесты, что в навигации и на обзоре.
 * Файл `public/platform.config.json` читается при запуске: новый ремоут или новый адрес —
 * это выкладка файла, без пересборки и без изменений в коде хоста.
 */
export interface PlatformConfig {
  readonly remotes: readonly RemoteEntry[];
  readonly nav: ReadonlyArray<{ readonly href: string; readonly title: string }>;
  /** Ремоуты на странице обзора; basename — их собственный, ссылки ведут на их страницы. */
  readonly overview: ReadonlyArray<{ readonly remote: string; readonly basename: string }>;
  /** Какие поля общего стора какой ремоут может менять; по умолчанию — DEFAULT_STORE_ACCESS. */
  readonly storeAccess?: StoreAccess;
}

export const CONFIG_URL = "/platform.config.json";

const isList = (value: unknown, keys: readonly string[]) =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      keys.every((key) => typeof (item as Record<string, unknown>)[key] === "string"),
  );

export const validatePlatformConfig = (value: unknown): string[] => {
  if (typeof value !== "object" || value === null) return ["config is not an object"];
  const config = value as Record<string, unknown>;
  const problems = validateRemoteEntries(config.remotes);
  if (!isList(config.nav, ["href", "title"])) problems.push("nav must be a list of {href, title}");
  if (!isList(config.overview, ["remote", "basename"])) {
    problems.push("overview must be a list of {remote, basename}");
  }
  if (config.storeAccess !== undefined) problems.push(...validateStoreAccess(config.storeAccess));
  return problems;
};

export const loadPlatformConfig = () =>
  loadJsonConfig<PlatformConfig>(CONFIG_URL, validatePlatformConfig);

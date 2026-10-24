/**
 * Контракт между хостом и ремоутом. Ничего специфичного для rwc, React или сборщика:
 * ремоут — это манифест плюс функция, регистрирующая кастомный элемент.
 */
export const CONTRACT_VERSION = 1;

export interface RemoteManifest {
  readonly contractVersion: number;
  /** Имя ремоута, под которым его знает хост: "accounts". */
  readonly name: string;
  /** Версия сборки ремоута — для наблюдаемости. Необязательна. */
  readonly version?: string;
  /** Фактический тег, уже версионированный. */
  readonly tag: string;
  /** Паттерны путей, которые ремоут берёт на себя. */
  readonly routes: readonly string[];
  /** semver-диапазоны пакетов, от которых зависит ремоут. */
  readonly requires?: { readonly [pkg: string]: string };
  /** Произвольные данные потребителя. Ядро не читает и не валидирует. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface RemoteModule {
  readonly manifest: RemoteManifest;
  /** Регистрирует кастомный элемент. Идемпотентна: повторный вызов — no-op. */
  register(): Promise<void> | void;
}

/**
 * Что ремоут экспонирует наружу. Манифест — отдельный лёгкий модуль: хост строит по нему
 * таблицу маршрутов, не загружая тяжёлый код ремоута.
 */
export const REMOTE_EXPOSES = {
  manifest: "./manifest",
  entry: "./entry",
} as const;

const TAG_RE = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;
/** Точный путь "/accounts" или префикс "/accounts/*"; "*" — только в конце, после "/". */
const ROUTE_RE = /^\/[^*]*$|^\/(?:[^*]*\/)?\*$/;

/**
 * Проверяет форму манифеста. Возвращает список проблем; пустой список — манифест валиден.
 * `extra` не проверяется: это данные потребителя.
 */
export const validateManifest = (value: unknown): string[] => {
  if (typeof value !== "object" || value === null) return ["manifest is not an object"];
  const manifest = value as Record<string, unknown>;
  const problems: string[] = [];

  if (!Number.isInteger(manifest.contractVersion) || (manifest.contractVersion as number) < 1) {
    problems.push("contractVersion must be a positive integer");
  }
  if (typeof manifest.name !== "string" || manifest.name === "") {
    problems.push("name must be a non-empty string");
  }
  if (manifest.version !== undefined && typeof manifest.version !== "string") {
    problems.push("version must be a string");
  }
  if (typeof manifest.tag !== "string" || !TAG_RE.test(manifest.tag)) {
    problems.push("tag must be a valid custom element name");
  }
  if (!Array.isArray(manifest.routes) || manifest.routes.some((r) => typeof r !== "string")) {
    problems.push("routes must be an array of strings");
  } else if (manifest.routes.some((route: string) => !ROUTE_RE.test(route))) {
    problems.push('routes must be paths starting with "/", wildcard only as a trailing "/*"');
  }
  if (manifest.requires !== undefined) {
    const requires = manifest.requires;
    if (
      typeof requires !== "object" ||
      requires === null ||
      Object.values(requires).some((range) => typeof range !== "string")
    ) {
      problems.push("requires must map package names to version ranges");
    }
  }
  return problems;
};

export const isRemoteManifest = (value: unknown): value is RemoteManifest =>
  validateManifest(value).length === 0;

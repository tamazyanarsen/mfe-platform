/**
 * Где хост берёт ремоуты. Конфигурация читается при запуске, а не при сборке: новый ремоут
 * или новый адрес — это выкладка JSON-файла, без пересборки хоста.
 */
export interface RemoteEntry {
  /** Имя ремоута и его контейнера Module Federation: "accounts". */
  readonly name: string;
  /** Адрес `mf-manifest.json` ремоута. */
  readonly entry: string;
}

// Имя ремоута — имя контейнера Module Federation, то есть JS-идентификатор.
const NAME_RE = /^[A-Za-z_$][\w$]*$/;

/** Подходит ли строка как имя ремоута (оно же имя контейнера Module Federation). */
export const isRemoteName = (value: unknown): value is string =>
  typeof value === "string" && NAME_RE.test(value);

/** Проверяет список ремоутов. Возвращает проблемы; пустой список — всё в порядке. */
export const validateRemoteEntries = (value: unknown): string[] => {
  if (!Array.isArray(value)) return ["remotes must be an array"];
  const problems: string[] = [];
  const seen = new Set<string>();
  value.forEach((item: unknown, index) => {
    const at = `remotes[${index}]`;
    if (typeof item !== "object" || item === null) {
      problems.push(`${at} must be an object`);
      return;
    }
    const { name, entry } = item as Record<string, unknown>;
    if (!isRemoteName(name)) {
      problems.push(`${at}.name must be an identifier`);
    } else if (seen.has(name)) {
      problems.push(`${at}.name "${name}" is duplicated`);
    } else {
      seen.add(name);
    }
    if (typeof entry !== "string" || !URL.canParse(entry, "http://localhost/")) {
      problems.push(`${at}.entry must be a URL`);
    }
  });
  return problems;
};

/**
 * Загружает JSON-конфигурацию хоста. `validate` возвращает список проблем; если он не
 * пуст, загрузка падает с перечнем всех проблем сразу.
 */
export const loadJsonConfig = async <T>(
  url: string,
  validate: (value: unknown) => string[],
  fetchImpl: typeof fetch = fetch,
): Promise<T> => {
  // no-cache: файл меняют выкладкой, и браузер должен перепроверить его при каждом запуске.
  const response = await fetchImpl(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`[mfe] ${url}: HTTP ${response.status}`);
  const value: unknown = await response.json();
  const problems = validate(value);
  if (problems.length > 0) throw new Error(`[mfe] ${url}: ${problems.join("; ")}`);
  return value as T;
};

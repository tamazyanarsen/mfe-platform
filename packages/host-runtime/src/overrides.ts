import { isRemoteName, type RemoteEntry } from "./config";

/**
 * Подмена адреса ремоута для разработки: открыть стенд или прод и подставить свой локальный
 * ремоут, не трогая остальные.
 *
 *   ?mfe-override=payments=http://localhost:3002/mf-manifest.json
 *   ?mfe-override=reset            — снять все подмены
 *
 * Параметр можно повторять. Подмены запоминаются в sessionStorage и живут, пока открыта
 * вкладка, — внутренняя навигация параметр не сохраняет.
 *
 * Ремоут, которого ещё нет в конфигурации, подмена добавляет: так новый ремоут
 * разрабатывают прямо в стенде, до того как его внесли в конфигурацию.
 *
 * Подмена грузит чужой код на страницу, поэтому по умолчанию разрешены только адреса на
 * этой машине (localhost, 127.0.0.1, [::1]). Остальные отбрасываются с предупреждением.
 */
export const OVERRIDE_PARAM = "mfe-override";
const STORAGE_KEY = "mfe-platform.overrides";

export type OverrideStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface OverrideOptions {
  /** Строка запроса страницы. По умолчанию — `location.search`. */
  readonly search?: string;
  /** Где помнить подмены между переходами. `null` — не помнить. */
  readonly storage?: OverrideStorage | null;
  /** Какие адреса разрешены. По умолчанию — только локальная машина. */
  readonly allow?: (url: URL) => boolean;
  /** Разрешить добавлять ремоуты, которых нет в конфигурации. По умолчанию — да. */
  readonly allowNew?: boolean;
}

export interface OverrideEntry extends RemoteEntry {
  /** Ремоута не было в конфигурации — подмена его добавила. */
  readonly added: boolean;
}

export interface OverrideResult {
  /** Конфигурация с подменами; добавленные ремоуты — в конце. */
  readonly remotes: readonly RemoteEntry[];
  /** Применённые подмены — их стоит показать, чтобы разработчик не забыл о них. */
  readonly overridden: readonly OverrideEntry[];
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const allowLocalhost = (url: URL): boolean =>
  (url.protocol === "http:" || url.protocol === "https:") && LOCAL_HOSTS.has(url.hostname);

const defaultStorage = (): OverrideStorage | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    // Хранилище бывает недоступно: приватный режим, запрет сайта, sandbox-iframe.
    return null;
  }
};

const readStored = (storage: OverrideStorage | null): Record<string, string> => {
  try {
    const value: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
    return typeof value === "object" && value !== null ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
};

const writeStored = (storage: OverrideStorage | null, value: Record<string, string>) => {
  try {
    if (Object.keys(value).length === 0) storage?.removeItem(STORAGE_KEY);
    else storage?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Не запомнили — подмена работает до перезагрузки, этого достаточно.
  }
};

export const applyRemoteOverrides = (
  remotes: readonly RemoteEntry[],
  {
    search = globalThis.location?.search ?? "",
    storage = defaultStorage(),
    allow = allowLocalhost,
    allowNew = true,
  }: OverrideOptions = {},
): OverrideResult => {
  const known = new Set(remotes.map(({ name }) => name));
  const params = new URLSearchParams(search).getAll(OVERRIDE_PARAM);
  let requested = readStored(storage);

  for (const param of params) {
    if (param === "reset" || param === "") {
      requested = {};
      continue;
    }
    const split = param.indexOf("=");
    const name = param.slice(0, split);
    const entry = param.slice(split + 1);
    if (split < 1 || !entry) {
      console.warn(`[mfe] override "${param}" must look like name=url`);
    } else {
      requested[name] = entry;
    }
  }

  const accepted: Record<string, string> = {};
  for (const [name, entry] of Object.entries(requested)) {
    if (typeof entry !== "string") continue;
    if (!known.has(name)) {
      if (!allowNew) {
        console.warn(`[mfe] override for unknown remote "${name}" is ignored`);
        continue;
      }
      if (!isRemoteName(name)) {
        console.warn(`[mfe] override name "${name}" must be an identifier`);
        continue;
      }
    }
    const url = URL.canParse(entry) ? new URL(entry) : null;
    if (url && allow(url)) accepted[name] = url.href;
    else console.warn(`[mfe] override ${name}=${entry} is not allowed`);
  }
  writeStored(storage, accepted);

  const added = Object.keys(accepted).filter((name) => !known.has(name));
  return {
    remotes: [
      ...remotes.map((remote) =>
        accepted[remote.name]
          ? { name: remote.name, entry: accepted[remote.name] as string }
          : remote,
      ),
      ...added.map((name) => ({ name, entry: accepted[name] as string })),
    ],
    overridden: Object.entries(accepted).map(([name, entry]) => ({
      name,
      entry,
      added: !known.has(name),
    })),
  };
};

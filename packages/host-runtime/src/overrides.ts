import type { RemoteEntry } from "./config";

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
}

export interface OverrideResult {
  readonly remotes: readonly RemoteEntry[];
  /** Применённые подмены — их стоит показать, чтобы разработчик не забыл о них. */
  readonly overridden: readonly RemoteEntry[];
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
    } else if (!known.has(name)) {
      console.warn(`[mfe] override for unknown remote "${name}" is ignored`);
    } else {
      requested[name] = entry;
    }
  }

  const accepted: Record<string, string> = {};
  for (const [name, entry] of Object.entries(requested)) {
    if (!known.has(name) || typeof entry !== "string") continue;
    const url = URL.canParse(entry) ? new URL(entry) : null;
    if (url && allow(url)) accepted[name] = url.href;
    else console.warn(`[mfe] override ${name}=${entry} is not allowed`);
  }
  writeStored(storage, accepted);

  return {
    remotes: remotes.map((remote) =>
      accepted[remote.name]
        ? { name: remote.name, entry: accepted[remote.name] as string }
        : remote,
    ),
    overridden: Object.entries(accepted).map(([name, entry]) => ({ name, entry })),
  };
};

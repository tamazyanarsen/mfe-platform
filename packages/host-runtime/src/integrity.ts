import type { RemoteEntry } from "./config";

/**
 * Проверка целостности кода ремоутов: подменённый на CDN или по дороге файл не исполняется.
 *
 * Цепочка хешей начинается в конфигурации хоста:
 *
 *   remotes[].integrity  ──► mf-manifest.json ремоута (проверяется здесь, в fetch)
 *   mf-manifest.json: metaData.integrity  ──► remoteEntry и каждый чанк (атрибут integrity)
 *
 * Хеши пишет сборка ремоута (config/integrity.ts); `mf-manifest.json.integrity` вносится в
 * конфигурацию хоста при выкладке. Скрипт с адреса проверенного ремоута, которого нет в
 * таблице хешей, блокируется. Ремоут без `integrity` в конфигурации грузится как раньше.
 *
 * Результат — плагин рантайма Module Federation: `registerPlugins([createIntegrityPlugin(...)])`.
 * Ядро не зависит от пакетов MF, поэтому типы плагина описаны здесь структурно.
 */

const SRI_RE = /^(sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/;

export const isIntegrity = (value: unknown): value is string =>
  typeof value === "string" && SRI_RE.test(value);

const ALGORITHMS = { sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" } as const;

/** Хеш в формате SRI: `sha384-<base64>`. */
export const computeIntegrity = async (
  data: ArrayBuffer | Uint8Array<ArrayBuffer>,
  algorithm: keyof typeof ALGORITHMS = "sha384",
): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest(ALGORITHMS[algorithm], data));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `${algorithm}-${btoa(binary)}`;
};

export class IntegrityError extends Error {
  override readonly name = "IntegrityError";
}

/** Хеш, которому не соответствует ни один файл: браузер откажется исполнять скрипт. */
const BLOCKED = `sha384-${"A".repeat(64)}`;

/** Плагин рантайма Module Federation — та часть интерфейса, что нужна здесь. */
export interface IntegrityPlugin {
  readonly name: string;
  fetch(url: string, init: RequestInit): Promise<Response> | undefined;
  createScript(args: {
    url: string;
    attrs?: Record<string, unknown>;
  }): HTMLScriptElement | undefined;
  createLink(args: { url: string; attrs?: Record<string, unknown> }): HTMLLinkElement | undefined;
}

export interface IntegrityOptions {
  /** Ремоуты из конфигурации; проверяются те, у кого задан `integrity`. */
  readonly remotes: ReadonlyArray<RemoteEntry & { readonly integrity?: string }>;
  /** Нарушение: подменённый манифест или файл не из таблицы хешей. */
  readonly onViolation?: (remote: string, message: string) => void;
  readonly fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

interface SealedManifest {
  readonly metaData?: {
    readonly publicPath?: string;
    readonly remoteEntry?: { readonly name?: string; readonly path?: string };
    readonly integrity?: Readonly<Record<string, string>>;
  };
}

const href = (url: string) => new URL(url, location.href).href;

/** Атрибуты, которые просит рантайм MF (rel, type, свои data-*), — до integrity. */
const setAttrs = (element: Element, attrs: Record<string, unknown> = {}) => {
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) element.setAttribute(name, String(value));
  }
};

export const createIntegrityPlugin = ({
  remotes,
  onViolation = (remote, message) => console.error(`[mfe] integrity: ${remote}: ${message}`),
  fetchImpl = (url, init) => fetch(url, init),
}: IntegrityOptions): IntegrityPlugin => {
  const pinned = new Map<string, { name: string; integrity: string }>();
  for (const { name, entry, integrity } of remotes) {
    if (integrity) pinned.set(href(entry), { name, integrity });
  }
  /** URL файла ремоута → его хеш из проверенного манифеста. */
  const files = new Map<string, string>();
  /** Адреса проверенных ремоутов: файл оттуда без хеша — подмена или ошибка выкладки. */
  const sealed: Array<{ base: string; name: string }> = [];

  const fail = (name: string, message: string): never => {
    onViolation(name, message);
    throw new IntegrityError(`[mfe] ${name}: ${message}`);
  };

  const verifyManifest = async (
    url: string,
    init: RequestInit,
    name: string,
    integrity: string,
  ) => {
    const response = await fetchImpl(url, init);
    if (!response.ok) throw new Error(`[mfe] ${name}: manifest HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const algorithm = integrity.slice(0, integrity.indexOf("-")) as keyof typeof ALGORITHMS;
    const actual = await computeIntegrity(bytes, algorithm);
    if (actual !== integrity) fail(name, `mf-manifest.json integrity mismatch (got ${actual})`);

    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as SealedManifest;
    const table = manifest.metaData?.integrity ?? {};
    const entry = manifest.metaData?.remoteEntry;
    const entryPath = entry?.name
      ? `${entry.path ? `${entry.path.replace(/^\/+|\/+$/g, "")}/` : ""}${entry.name}`
      : "";
    // Без хеша remoteEntry цепочка рвётся: проверенный манифест не защитил бы код.
    if (!isIntegrity(table[entryPath])) fail(name, "manifest has no remoteEntry integrity");

    const publicPath = manifest.metaData?.publicPath;
    const base = new URL(publicPath && publicPath !== "auto" ? publicPath : ".", url).href;
    for (const [path, hash] of Object.entries(table)) {
      if (isIntegrity(hash)) files.set(new URL(path, base).href, hash);
    }
    sealed.push({ base, name });
    return new Response(bytes, { status: response.status, headers: response.headers });
  };

  /** Хеш для файла ремоута; BLOCKED — файл с адреса проверенного ремоута не из таблицы. */
  const integrityOf = (url: string): string | undefined => {
    const target = href(url);
    const known = files.get(target);
    if (known) return known;
    const owner = sealed.find(({ base }) => target.startsWith(base));
    if (!owner) return undefined;
    onViolation(owner.name, `${target} is not in the manifest integrity table`);
    return BLOCKED;
  };

  return {
    name: "mfe-integrity",
    fetch(url, init) {
      const remote = pinned.get(href(url));
      return remote ? verifyManifest(url, init, remote.name, remote.integrity) : undefined;
    },
    createScript({ url, attrs }) {
      const integrity = integrityOf(url);
      if (!integrity) return undefined;
      const script = document.createElement("script");
      setAttrs(script, attrs);
      script.src = url;
      script.setAttribute("integrity", integrity);
      // SRI для файла с другого origin работает только с CORS-запросом.
      script.setAttribute("crossorigin", "anonymous");
      return script;
    },
    createLink({ url, attrs }) {
      const integrity = integrityOf(url);
      if (!integrity) return undefined;
      const link = document.createElement("link");
      setAttrs(link, attrs);
      link.href = url;
      link.setAttribute("integrity", integrity);
      link.setAttribute("crossorigin", "anonymous");
      return link;
    },
  };
};

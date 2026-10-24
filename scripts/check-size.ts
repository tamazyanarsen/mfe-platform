import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/**
 * Бюджет размера ремоутов. Считается то, что хост загружает для ремоута: remoteEntry,
 * модули `./manifest` и `./entry` с их чанками и общие зависимости — по `dist/mf-manifest.json`.
 * Страница самостоятельного запуска (`index.html` и её чанки) в бюджет не входит.
 *
 * Бюджет задаётся в package.json ремоута, в килобайтах после gzip:
 *
 *   "mfe": { "sizeBudget": { "gzipKb": 120 } }
 *
 * Запуск после сборки: `bun run build && bun run check:size`.
 */

interface MfAssets {
  readonly js: { readonly sync: readonly string[]; readonly async: readonly string[] };
  readonly css: { readonly sync: readonly string[]; readonly async: readonly string[] };
}

interface MfManifest {
  readonly metaData: { readonly remoteEntry: { readonly name: string; readonly path: string } };
  readonly exposes: ReadonlyArray<{ readonly assets: MfAssets }>;
  readonly shared: ReadonlyArray<{ readonly assets: MfAssets }>;
}

export interface RemoteSize {
  readonly app: string;
  readonly files: number;
  readonly rawBytes: number;
  readonly gzipBytes: number;
  /** Бюджет в байтах после gzip; undefined — бюджет не задан. */
  readonly budgetBytes?: number;
}

const assetsOf = ({ js, css }: MfAssets) => [...js.sync, ...js.async, ...css.sync, ...css.async];

/** Файлы, которые хост загружает для ремоута, — по его mf-manifest.json. */
export const remoteFiles = (manifest: MfManifest): string[] => {
  const { name, path } = manifest.metaData.remoteEntry;
  return [
    ...new Set([
      path ? `${path.replace(/\/$/, "")}/${name}` : name,
      ...manifest.exposes.flatMap(({ assets }) => assetsOf(assets)),
      ...manifest.shared.flatMap(({ assets }) => assetsOf(assets)),
    ]),
  ];
};

export const measureRemote = (appDir: string, app: string): RemoteSize | null => {
  const manifestPath = join(appDir, "dist", "mf-manifest.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as MfManifest;
  // Хост тоже собирается с Module Federation, но ничего не экспонирует: он не ремоут.
  if (!manifest.metaData.remoteEntry.name || manifest.exposes.length === 0) return null;
  let rawBytes = 0;
  let gzipBytes = 0;
  const files = remoteFiles(manifest);
  for (const file of files) {
    const content = readFileSync(join(appDir, "dist", file));
    rawBytes += content.byteLength;
    gzipBytes += gzipSync(content, { level: 9 }).byteLength;
  }
  const pkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
  const budgetKb: unknown = pkg.mfe?.sizeBudget?.gzipKb;
  return {
    app,
    files: files.length,
    rawBytes,
    gzipBytes,
    ...(typeof budgetKb === "number" ? { budgetBytes: budgetKb * 1024 } : {}),
  };
};

export const measureAll = (root: string): RemoteSize[] => {
  const appsDir = join(root, "apps");
  return readdirSync(appsDir)
    .sort()
    .flatMap((app) => measureRemote(join(appsDir, app), app) ?? []);
};

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

if (import.meta.main) {
  const sizes = measureAll(join(import.meta.dir, ".."));
  if (sizes.length === 0) {
    console.error("[check-size] no built remotes: run `bun run build` first");
    process.exit(1);
  }
  let failed = false;
  for (const size of sizes) {
    const over = size.budgetBytes !== undefined && size.gzipBytes > size.budgetBytes;
    failed ||= over;
    const budget = size.budgetBytes === undefined ? "no budget" : `budget ${kb(size.budgetBytes)}`;
    console.log(
      `${over ? "✗" : "✓"} ${size.app.padEnd(20)} ${kb(size.gzipBytes).padStart(9)} gzip` +
        `  ${kb(size.rawBytes).padStart(9)} raw  ${String(size.files).padStart(2)} files  ${budget}`,
    );
  }
  if (failed) {
    console.error("[check-size] some remotes are over budget");
    process.exit(1);
  }
}

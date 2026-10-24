import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { RsbuildPlugin } from "@rsbuild/core";

/**
 * Целостность кода ремоута — цепочка хешей от конфигурации хоста до последнего чанка:
 *
 *   platform.config.json: remotes[].integrity  ──► mf-manifest.json
 *   mf-manifest.json: metaData.integrity  ──► remoteEntry и каждый чанк ремоута
 *
 * После production-сборки плагин считает хеш каждого JS- и CSS-файла ремоута, дописывает
 * таблицу в mf-manifest.json и кладёт рядом `mf-manifest.json.integrity` — хеш итогового
 * манифеста, который вносится в конфигурацию хоста при выкладке. Хост проверяет манифест и
 * ставит integrity на каждый скрипт ремоута (createIntegrityPlugin в @mfe/host-runtime).
 *
 * SRI сборщика здесь не помогает: чанки ремоутов загружает рантайм Module Federation хоста,
 * а не рантайм ремоута с его хешами.
 */
export const INTEGRITY_FILE = "mf-manifest.json.integrity";

export const sri = (
  content: Buffer | string,
  algorithm: "sha256" | "sha384" | "sha512" = "sha384",
) => `${algorithm}-${createHash(algorithm).update(content).digest("base64")}`;

interface MfManifestFile {
  metaData: {
    remoteEntry: { name: string; path: string };
    integrity?: Record<string, string>;
  };
}

const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        return statSync(path).isDirectory() ? walk(path) : [path];
      })
    : [];

/** Дописывает хеши файлов ремоута в манифест и возвращает хеш итогового манифеста. */
export const sealManifest = (distDir: string): string | null => {
  const manifestPath = join(distDir, "mf-manifest.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as MfManifestFile;
  if (!manifest.metaData.remoteEntry.name) return null;

  const files = walk(distDir)
    .filter((file) => /\.(m?js|css)$/.test(file))
    .map((file) => relative(distDir, file).replaceAll("\\", "/"))
    .sort();
  manifest.metaData.integrity = Object.fromEntries(
    files.map((file) => [file, sri(readFileSync(join(distDir, file)))]),
  );

  const sealed = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, sealed);
  const integrity = sri(sealed);
  writeFileSync(join(distDir, INTEGRITY_FILE), `${integrity}\n`);
  return integrity;
};

export const pluginIntegrity = (): RsbuildPlugin => ({
  name: "mfe:integrity",
  setup(api) {
    api.onAfterBuild(() => {
      const integrity = sealManifest(api.context.distPath);
      if (integrity) api.logger.info(`[mfe] mf-manifest.json integrity: ${integrity}`);
    });
  },
});

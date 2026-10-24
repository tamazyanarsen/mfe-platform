import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { defineConfig, type RsbuildConfig } from "@rsbuild/core";

export interface RemoteConfig {
  /** Имя контейнера MF; совпадает с `manifest.name`. */
  readonly name: string;
  readonly port: number;
  /** Киты, версии которых ремоут сообщает реестру платформы: `__MFE_KIT_VERSIONS__`. */
  readonly kits?: readonly string[];
  readonly extend?: RsbuildConfig;
}

/** Версия установленного пакета — та, с которой ремоут действительно собран. */
const installedVersion = (pkg: string): string =>
  JSON.parse(readFileSync(join(process.cwd(), "node_modules", pkg, "package.json"), "utf8"))
    .version;

/**
 * Общая сборка ремоута: экспонирует `./manifest` и `./entry` по контракту
 * (REMOTE_EXPOSES) и ничего не шарит — у ремоута своя копия рантайма.
 */
export const defineRemoteConfig = ({ name, port, kits = [], extend = {} }: RemoteConfig) =>
  defineConfig({
    ...extend,
    source: {
      ...extend.source,
      define: {
        __MFE_REMOTE_VERSION__: JSON.stringify(
          JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version ?? "0.0.0",
        ),
        __MFE_KIT_VERSIONS__: JSON.stringify(
          Object.fromEntries(kits.map((kit) => [kit, installedVersion(kit)])),
        ),
        ...extend.source?.define,
      },
    },
    plugins: [
      pluginModuleFederation({
        name,
        exposes: { "./manifest": "./src/manifest.ts", "./entry": "./src/entry.ts" },
        // По умолчанию ничего не шарится. MFE_SHARE_CORE=1 — режим эксперимента
        // (experiments/r4), решение и цифры — в docs/architecture.md.
        shared:
          process.env.MFE_SHARE_CORE === "1"
            ? { "@rwcjs/core": { singleton: true, requiredVersion: "^3.2.0" } }
            : {},
        dts: false,
      }),
      ...(extend.plugins ?? []),
    ],
    // Одна копия rwc внутри ремоута: адаптеры платформы и киты берут core ремоута, а не
    // свою. Две копии в одном бандле ломают владение эффектами и контекст.
    resolve: {
      ...extend.resolve,
      dedupe: [
        ...(existsSync(join(process.cwd(), "node_modules/@rwcjs/core")) ? ["@rwcjs/core"] : []),
        ...(extend.resolve?.dedupe ?? []),
      ],
    },
    // Код ремоута забирает хост с другого origin; доверяем только локальным хостам стенда.
    server: { port, strictPort: true, cors: { origin: /^http:\/\/localhost:\d+$/ } },
    dev: { assetPrefix: `http://localhost:${port}/` },
    output: { assetPrefix: `http://localhost:${port}/` },
    html: { title: `${name} (standalone)` },
  });

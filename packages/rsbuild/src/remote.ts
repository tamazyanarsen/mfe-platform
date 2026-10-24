import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { defineConfig, type RsbuildConfig } from "@rsbuild/core";
import { pluginIntegrity } from "./integrity";
import { sharedByLine } from "./shared";

export interface RemoteConfig {
  /** Имя контейнера MF; совпадает с `manifest.name`. */
  readonly name: string;
  readonly port: number;
  /** Киты, версии которых ремоут сообщает реестру платформы: `__MFE_KIT_VERSIONS__`. */
  readonly kits?: readonly string[];
  /**
   * Брать рантайм Module Federation у хоста, а не везти свой (около 17 KB gzip на ремоут).
   * Только в production-сборке: в dev ремоут открывается и без хоста. Цена — ремоуты
   * зависят от рантайма MF хоста, поэтому мажор `@module-federation/*` у хоста и ремоутов
   * должен совпадать. По умолчанию включено.
   */
  readonly sharedRuntime?: boolean;
  /**
   * Делить киты из `kits` (и `@rwcjs/core`) с другими ремоутами той же линии
   * совместимости: один экземпляр кита вместо конфликта двух сборок. По умолчанию включено.
   */
  readonly shareKits?: boolean;
  /**
   * Откуда грузятся файлы production-сборки. По умолчанию "auto": рантайм MF берёт адрес
   * каталога манифеста, поэтому одна сборка работает на любом CDN и под любым путём.
   * Переменная окружения MFE_PUBLIC_PATH переопределяет значение.
   */
  readonly publicPath?: string;
  readonly extend?: RsbuildConfig;
}

/** Версия установленного пакета — та, с которой ремоут действительно собран. */
const installedVersion = (pkg: string): string =>
  JSON.parse(readFileSync(join(process.cwd(), "node_modules", pkg, "package.json"), "utf8"))
    .version;

const isInstalled = (pkg: string) =>
  existsSync(join(process.cwd(), "node_modules", pkg, "package.json"));

/**
 * Общая сборка ремоута: экспонирует `./manifest` и `./entry` по контракту
 * (REMOTE_EXPOSES). Делится только совместимое: киты и их фреймворк — по линиям
 * совместимости, рантайм MF — с хостом в production. Остальное у ремоута своё.
 */
export const defineRemoteConfig = ({
  name,
  port,
  kits = [],
  sharedRuntime = true,
  shareKits = true,
  publicPath = "auto",
  extend = {},
}: RemoteConfig) =>
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
        // Киты и их фреймворк делятся по линиям совместимости (shared.ts): ремоуты
        // на одной линии кита получают один его экземпляр. MFE_SHARE_CORE=1 — режим
        // эксперимента с singleton-core (experiments/singleton-core), цифры — в docs/architecture.md.
        shared:
          process.env.MFE_SHARE_CORE === "1"
            ? { "@rwcjs/core": { singleton: true, requiredVersion: "^3.2.0" } }
            : shareKits && kits.length > 0
              ? sharedByLine(
                  Object.fromEntries(
                    [...kits, ...(isInstalled("@rwcjs/core") ? ["@rwcjs/core"] : [])].map((pkg) => [
                      pkg,
                      installedVersion(pkg),
                    ]),
                  ),
                )
              : {},
        dts: false,
        experiments: {
          externalRuntime: sharedRuntime && process.env.NODE_ENV === "production",
        },
      }),
      pluginIntegrity(),
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
    output: { assetPrefix: process.env.MFE_PUBLIC_PATH ?? publicPath },
    html: { title: `${name} (standalone)` },
    // SRI для чанков в production-сборке: remoteEntry проверяет хеш каждого чанка, который
    // грузит. Сам remoteEntry закрывает pluginIntegrity (integrity.ts).
    security: { ...extend.security, sri: { enable: "auto", algorithm: "sha384" } },
  });

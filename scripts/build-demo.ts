import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { CONFIG_PATH } from "./create-remote";

/**
 * Демо-стенд одним статическим сайтом: хост под префиксом пути, ремоуты рядом.
 *
 *   bun run build:demo                    # .demo/ для https://<user>.github.io/mfe-platform/
 *   MFE_DEMO_BASE=/ bun run build:demo    # для корня сайта
 *
 *   .demo/                 хост, собранный с server.base = MFE_DEMO_BASE
 *   .demo/remotes/<name>/  production-сборка ремоута (publicPath auto)
 *   .demo/platform.config.json  адреса ремоутов и хеши их манифестов
 *   .demo/404.html         копия index.html: GitHub Pages отдаёт её на любой путь SPA
 *
 * Ремоуты те же, что в конфигурации хоста; проверка целостности включена для всех.
 */
const ROOT = join(import.meta.dir, "..");
export const DEMO_DIR = join(ROOT, ".demo");

export const demoBase = (raw = process.env.MFE_DEMO_BASE ?? "/mfe-platform/") =>
  `/${raw.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");

const build = (app: string, env: Record<string, string> = {}) => {
  const result = spawnSync("bun", ["run", "build"], {
    cwd: join(ROOT, "apps", app),
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production", ...env },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`build of apps/${app} failed`);
};

/** Каталог приложения в apps/, чья сборка — контейнер MF с этим именем. */
const appOf = (remote: string) => {
  const app = readdirSync(join(ROOT, "apps")).find((dir) => {
    const config = join(ROOT, "apps", dir, "rsbuild.config.ts");
    return existsSync(config) && readFileSync(config, "utf8").includes(`name: "${remote}"`);
  });
  if (!app) throw new Error(`no app in apps/ builds remote "${remote}"`);
  return app;
};

if (import.meta.main) {
  const base = demoBase();
  const hostConfig = JSON.parse(readFileSync(join(ROOT, CONFIG_PATH), "utf8"));
  const remotes: Array<{ name: string }> = hostConfig.remotes;

  for (const { name } of remotes) build(appOf(name));
  build("host", { MFE_BASE: base });

  rmSync(DEMO_DIR, { recursive: true, force: true });
  cpSync(join(ROOT, "apps", "host", "dist"), DEMO_DIR, { recursive: true });
  const entries = remotes.map(({ name }) => {
    const dist = join(ROOT, "apps", appOf(name), "dist");
    cpSync(dist, join(DEMO_DIR, "remotes", name), { recursive: true });
    return {
      name,
      entry: `${base}remotes/${name}/mf-manifest.json`,
      integrity: readFileSync(join(dist, "mf-manifest.json.integrity"), "utf8").trim(),
    };
  });
  writeFileSync(
    join(DEMO_DIR, "platform.config.json"),
    `${JSON.stringify({ ...hostConfig, remotes: entries }, null, 2)}\n`,
  );
  copyFileSync(join(DEMO_DIR, "index.html"), join(DEMO_DIR, "404.html"));
  // Без .nojekyll GitHub Pages пропускает файлы и каталоги, начинающиеся с "_".
  writeFileSync(join(DEMO_DIR, ".nojekyll"), "");
  console.log(
    `demo: .demo/ for base ${base}, remotes: ${entries.map(({ name }) => name).join(", ")}`,
  );
}

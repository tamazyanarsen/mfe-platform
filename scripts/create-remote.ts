import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";

/**
 * Новый ремоут одной командой: каркас по шаблону, запись в конфигурации хоста, пункт
 * навигации.
 *
 *   bun run create:remote cards --template rwc --title "Карты" [--port 3004] [--no-nav]
 *
 * Шаблоны лежат в templates/: общая часть (манифест, тест контракта) и по одному каталогу
 * на стек — vanilla, rwc, react.
 */
export const TEMPLATES = ["vanilla", "rwc", "react"] as const;
export type Template = (typeof TEMPLATES)[number];

export interface CreateRemoteOptions {
  /** Корень репозитория. */
  readonly root: string;
  /** Имя ремоута: "cards", "credit_cards". */
  readonly name: string;
  readonly template?: Template;
  /** Порт dev-сервера; по умолчанию — следующий свободный после портов из конфигурации. */
  readonly port?: number;
  /** Заголовок для навигации и страницы. */
  readonly title?: string;
  /** Добавить пункт навигации хоста. */
  readonly nav?: boolean;
  /** Каталог шаблонов; по умолчанию — templates/ рядом со скриптами. */
  readonly templatesDir?: string;
}

export interface CreatedRemote {
  readonly dir: string;
  readonly port: number;
  readonly files: readonly string[];
}

interface HostConfig {
  remotes: Array<{ name: string; entry: string }>;
  nav: Array<{ href: string; title: string }>;
  overview: Array<{ remote: string; basename: string }>;
}

// Имя — это и имя контейнера Module Federation, а он должен быть JS-идентификатором.
const NAME_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
export const CONFIG_PATH = "apps/host/public/platform.config.json";

const pascal = (name: string) =>
  name
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const nextPort = (config: HostConfig) => {
  const ports = config.remotes
    .map(({ entry }) => (URL.canParse(entry) ? Number(new URL(entry).port) : 0))
    .filter((port) => port > 0);
  return Math.max(3000, ...ports) + 1;
};

export const createRemote = ({
  root,
  name,
  template = "vanilla",
  port,
  title,
  nav = true,
  templatesDir = join(import.meta.dir, "..", "templates"),
}: CreateRemoteOptions): CreatedRemote => {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `name "${name}" must be a lowercase identifier: letters, digits and underscores`,
    );
  }
  if (!TEMPLATES.includes(template)) {
    throw new Error(`unknown template "${template}", use one of: ${TEMPLATES.join(", ")}`);
  }
  const dir = join(root, "apps", `mfe-${name}`);
  if (existsSync(dir)) throw new Error(`${relative(root, dir)} already exists`);

  const configPath = join(root, CONFIG_PATH);
  const config = JSON.parse(readFileSync(configPath, "utf8")) as HostConfig;
  if (config.remotes.some((remote) => remote.name === name)) {
    throw new Error(`remote "${name}" is already in ${CONFIG_PATH}`);
  }
  const devPort = port ?? nextPort(config);
  const caption = title ?? pascal(name);

  const values: Record<string, string> = {
    __NAME__: name,
    __TAG__: `mfe-${name.replaceAll("_", "-")}`,
    __PORT__: String(devPort),
    __TITLE__: caption,
    __CLASS__: pascal(name),
    __CAMEL__: name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase()),
    __TEMPLATE__: template,
  };
  const fill = (text: string) => text.replace(/__[A-Z]+__/g, (key) => values[key] ?? key);

  const files: string[] = [];
  for (const source of [
    join(templatesDir, "remote-common"),
    join(templatesDir, `remote-${template}`),
  ]) {
    for (const file of walk(source)) {
      const target = join(dir, relative(source, file).replace(/\.tmpl$/, ""));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, fill(readFileSync(file, "utf8")));
      files.push(relative(dir, target).replaceAll("\\", "/"));
    }
  }

  config.remotes.push({ name, entry: `http://localhost:${devPort}/mf-manifest.json` });
  if (nav) config.nav.push({ href: `/${name}`, title: caption });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  return { dir, port: devPort, files: files.sort() };
};

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      template: { type: "string", short: "t", default: "vanilla" },
      port: { type: "string", short: "p" },
      title: { type: "string" },
      "no-nav": { type: "boolean", default: false },
    },
  });
  const [name] = positionals;
  if (!name) {
    console.error(
      `usage: bun run create:remote <name> [--template ${TEMPLATES.join("|")}] [--port 3004] [--title "Карты"] [--no-nav]`,
    );
    process.exit(1);
  }
  try {
    const created = createRemote({
      root: join(import.meta.dir, ".."),
      name,
      template: values.template as Template,
      nav: !values["no-nav"],
      ...(values.port ? { port: Number(values.port) } : {}),
      ...(values.title ? { title: values.title } : {}),
    });
    console.log(`created apps/mfe-${name} (${values.template}), dev port ${created.port}`);
    console.log("next: bun install && bun run dev");
  } catch (error) {
    console.error(`[create-remote] ${(error as Error).message}`);
    process.exit(1);
  }
}

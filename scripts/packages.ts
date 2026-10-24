import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

/**
 * Пакеты платформы для npm.
 *
 *   bun run packages:pack               # собрать в .npm/<пакет> и упаковать в .npm/tarballs
 *   bun run packages:publish --dry-run  # то же и npm publish каждого пакета
 *
 * В монорепозитории пакеты отдают исходники TypeScript (exports → ./src/index.ts). Для npm
 * каждый собирается отдельно: JS — Bun.build (зависимости остаются внешними), типы — tsc,
 * package.json — без private, devDependencies и workspace:*. Версия у всех пакетов одна.
 */
export const ROOT = join(import.meta.dir, "..");
export const OUT = join(ROOT, ".npm");
const REPOSITORY = "https://github.com/tamazyanarsen/mfe-platform";

/** Пакеты, которые собираются для Node (инструменты сборки), а не для браузера. */
const NODE_PACKAGES = new Set(["rsbuild"]);

export const DESCRIPTIONS: Record<string, string> = {
  contract: "Host–remote contract of the MFE platform: manifest, navigation, bus topics",
  "host-runtime": "Host runtime of the MFE platform: <mfe-outlet>, router, loader, integrity",
  registry: "Versioned custom element registration: several UI kit versions on one page",
  bus: "Typed event bus and store shared between micro-frontends",
  "adapter-rwc": "rwc adapter for MFE platform remotes",
  "adapter-react": "React adapter: a React component as an MFE platform remote",
  testing: "Test a micro-frontend without a host: mountRemote, checkRemote",
  devtools: "On-page debug panel for the MFE platform",
  rsbuild: "Rsbuild config for MFE platform remotes: shared modules, integrity hashes",
};

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  exports: Record<string, string | Record<string, string>>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  sideEffects?: boolean;
  [key: string]: unknown;
}

export interface Pkg {
  readonly dir: string;
  readonly json: PackageJson;
}

const run = (command: string, args: string[], cwd = ROOT) => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
};

/** Пакеты из packages/ в порядке зависимостей: сначала те, от кого зависят другие. */
export const listPackages = (): Pkg[] => {
  const all = readdirSync(join(ROOT, "packages"))
    .filter((dir) => existsSync(join(ROOT, "packages", dir, "package.json")))
    .map((dir) => ({
      dir,
      json: JSON.parse(
        readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"),
      ) as PackageJson,
    }));
  const byName = new Map(all.map((pkg) => [pkg.json.name, pkg]));
  const ordered: Pkg[] = [];
  const visit = (pkg: Pkg) => {
    if (ordered.includes(pkg)) return;
    for (const name of Object.keys(pkg.json.dependencies ?? {})) {
      const dependency = byName.get(name);
      if (dependency) visit(dependency);
    }
    ordered.push(pkg);
  };
  for (const pkg of all.sort((a, b) => a.dir.localeCompare(b.dir))) visit(pkg);
  return ordered;
};

/** package.json для npm: внутренние зависимости — на ту же версию, без dev-полей. */
export const publishedJson = (pkg: Pkg, version: string, internal: ReadonlySet<string>) => {
  const { json } = pkg;
  const pin = (deps?: Record<string, string>) =>
    deps &&
    Object.fromEntries(
      Object.entries(deps).map(([name, range]) => [
        name,
        internal.has(name) || range.startsWith("workspace:") ? `^${version}` : range,
      ]),
    );
  const exports: Record<string, unknown> = {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
  };
  for (const [subpath, target] of Object.entries(json.exports)) {
    if (subpath !== ".") exports[subpath] = target;
  }
  const extraFiles = Object.values(json.exports)
    .flatMap((target) => (typeof target === "string" ? [target] : Object.values(target)))
    .filter((target) => !target.startsWith("./src/"))
    .map((target) => target.replace(/^\.\//, ""));
  return {
    name: json.name,
    version,
    description: DESCRIPTIONS[pkg.dir] ?? "",
    license: json.license,
    type: "module",
    keywords: ["micro-frontends", "module-federation", "custom-elements", "mfe"],
    homepage: `${REPOSITORY}#readme`,
    repository: { type: "git", url: `git+${REPOSITORY}.git`, directory: `packages/${pkg.dir}` },
    bugs: `${REPOSITORY}/issues`,
    sideEffects: json.sideEffects ?? false,
    exports,
    types: "./dist/index.d.ts",
    files: ["dist", ...extraFiles],
    ...(json.dependencies ? { dependencies: pin(json.dependencies) } : {}),
    ...(json.peerDependencies ? { peerDependencies: json.peerDependencies } : {}),
    publishConfig: { access: "public" },
  };
};

const readme = (pkg: Pkg) => `# ${pkg.json.name}

${DESCRIPTIONS[pkg.dir] ?? ""}.

Part of [MFE platform](${REPOSITORY}) — micro-frontends on Module Federation where every
remote is a custom element, several UI kit versions live on one page, and remote code is
checked against hashes from the host configuration.

Documentation: [${REPOSITORY}](${REPOSITORY}) ·
[English](${REPOSITORY}/blob/main/README.en.md) · [Русский](${REPOSITORY}/blob/main/README.md)

License: Apache-2.0
`;

/** Версия релиза: одна на все пакеты, из package.json контракта. */
export const releaseVersion = (packages: readonly Pkg[]) => {
  const versions = new Set(packages.map((pkg) => pkg.json.version));
  if (versions.size !== 1) {
    throw new Error(`packages must share one version, found: ${[...versions].join(", ")}`);
  }
  return [...versions][0] as string;
};

export const pack = async () => {
  const packages = listPackages();
  const version = releaseVersion(packages);
  const internal = new Set(packages.map((pkg) => pkg.json.name));
  rmSync(OUT, { recursive: true, force: true });

  // Типы всех пакетов одним проходом tsc: импорты между пакетами в .d.ts остаются по имени.
  const typesDir = join(OUT, "types");
  const tsconfig = join(OUT, "tsconfig.types.json");
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    tsconfig,
    JSON.stringify({
      extends: "../tsconfig.json",
      include: ["../packages/*/src", "../packages/rsbuild/env.d.ts"],
      compilerOptions: {
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        rootDir: "../packages",
        outDir: "types",
      },
    }),
  );
  run("bunx", ["tsc", "-p", relative(ROOT, tsconfig)]);

  for (const pkg of packages) {
    const out = join(OUT, pkg.dir);
    const result = await Bun.build({
      entrypoints: [join(ROOT, "packages", pkg.dir, "src", "index.ts")],
      outdir: join(out, "dist"),
      target: NODE_PACKAGES.has(pkg.dir) ? "node" : "browser",
      format: "esm",
      packages: "external",
      sourcemap: "linked",
    });
    if (!result.success) throw new AggregateError(result.logs, `build of ${pkg.json.name} failed`);

    const types = join(typesDir, pkg.dir, "src");
    for (const file of readdirSync(types)) copyFileSync(join(types, file), join(out, "dist", file));
    const json = publishedJson(pkg, version, internal);
    for (const file of json.files.filter((file) => file !== "dist")) {
      copyFileSync(join(ROOT, "packages", pkg.dir, file), join(out, file));
    }
    writeFileSync(join(out, "package.json"), `${JSON.stringify(json, null, 2)}\n`);
    writeFileSync(join(out, "README.md"), readme(pkg));
    copyFileSync(join(ROOT, "LICENSE"), join(out, "LICENSE"));
  }

  const tarballs = join(OUT, "tarballs");
  mkdirSync(tarballs, { recursive: true });
  for (const pkg of packages) {
    run("npm", ["pack", "--silent", "--pack-destination", tarballs], join(OUT, pkg.dir));
  }
  return { packages, version, tarballs };
};

if (import.meta.main) {
  const [command = "pack", ...flags] = Bun.argv.slice(2);
  if (command !== "pack" && command !== "publish") {
    console.error("usage: bun run scripts/packages.ts pack | publish [--dry-run] [--provenance]");
    process.exit(1);
  }
  const { packages, version } = await pack();
  console.log(`packed ${packages.length} packages, version ${version}`);
  if (command === "publish") {
    for (const pkg of packages) {
      run("npm", ["publish", ...flags], join(OUT, pkg.dir));
    }
  }
}

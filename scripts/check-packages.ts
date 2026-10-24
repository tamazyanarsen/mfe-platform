import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OUT, pack } from "./packages";

/**
 * Пакеты глазами потребителя: собранные архивы ставятся в отдельный проект без
 * монорепозитория, и там проверяется, что
 *   1. каждый импорт в dist объявлен в dependencies или peerDependencies пакета;
 *   2. типы находятся и проходят tsc со strict и без skipLibCheck для наших .d.ts;
 *   3. браузерные пакеты собираются бандлером, а @mfe-platform/rsbuild загружается в Node.
 */
const { packages, tarballs } = await pack();

const run = (command: string, args: string[], cwd: string) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

const problems: string[] = [];

// 1. Импорты против объявленных зависимостей.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const bare = (specifier: string) =>
  !specifier.startsWith(".") && !specifier.startsWith("node:") && !specifier.startsWith("/");
const packageName = (specifier: string) =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : (specifier.split("/")[0] ?? "");
for (const pkg of packages) {
  const dir = join(OUT, pkg.dir);
  const json = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const declared = new Set([
    ...Object.keys(json.dependencies ?? {}),
    ...Object.keys(json.peerDependencies ?? {}),
  ]);
  for (const file of readdirSync(join(dir, "dist")).filter((file) => /\.(js|d\.ts)$/.test(file))) {
    const code = readFileSync(join(dir, "dist", file), "utf8");
    const specifiers = file.endsWith(".d.ts")
      ? [...code.matchAll(/(?:from\s+|import\()\s*["']([^"']+)["']/g)].map(
          (match) => match[1] ?? "",
        )
      : transpiler.scanImports(code).map(({ path }) => path);
    for (const specifier of specifiers.filter(bare)) {
      if (!declared.has(packageName(specifier))) {
        problems.push(`${json.name}: dist/${file} imports "${specifier}", not in dependencies`);
      }
    }
  }
}

// 2–3. Проект-потребитель.
const consumer = mkdtempSync(join(tmpdir(), "mfe-consumer-"));
try {
  const tgz = readdirSync(tarballs);
  const dependency = (name: string) => {
    const file = tgz.find((file) => file.startsWith(`${name.slice(1).replace("/", "-")}-`));
    if (!file) throw new Error(`no tarball for ${name}`);
    return `file:${join(tarballs, file).replaceAll("\\", "/")}`;
  };
  const names = packages.map((pkg) => pkg.json.name);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "consumer",
      private: true,
      type: "module",
      dependencies: {
        ...Object.fromEntries(names.map((name) => [name, dependency(name)])),
        "@module-federation/rsbuild-plugin": "^2.9.2",
        "@rsbuild/core": "^2.2.14",
        "@rwcjs/core": "^3.3.1",
        react: "^19.2.0",
        "react-dom": "^19.2.0",
      },
      devDependencies: {
        "@types/react": "^19.2.0",
        "@types/react-dom": "^19.2.0",
        typescript: "^5.9.0",
      },
      // Внутренние зависимости — из тех же архивов, а не из реестра npm.
      overrides: Object.fromEntries(names.map((name) => [name, dependency(name)])),
    }),
  );
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        types: [],
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        exactOptionalPropertyTypes: true,
      },
      include: ["src"],
    }),
  );
  mkdirSync(join(consumer, "src"));
  writeFileSync(
    join(consumer, "src", "browser.ts"),
    `/// <reference types="@mfe-platform/rsbuild/env" />
import { defineReactElement } from "@mfe-platform/adapter-react";
import { useKit } from "@mfe-platform/adapter-rwc";
import { createBus, createStore } from "@mfe-platform/bus";
import { CONTRACT_VERSION, navigateEvent, type RemoteManifest } from "@mfe-platform/contract";
import { createDevtools } from "@mfe-platform/devtools";
import { createHostRouter, createRouteTable, defineMfeOutlet } from "@mfe-platform/host-runtime";
import { getPlatformRegistry } from "@mfe-platform/registry";
import { checkRemote, createMemoryLoader } from "@mfe-platform/testing";

const manifest: RemoteManifest = {
  contractVersion: CONTRACT_VERSION,
  name: "cards",
  tag: "mfe-cards",
  routes: ["/cards/*"],
};
const versions: Readonly<Record<string, string>> = __MFE_KIT_VERSIONS__;
export const used = [
  defineReactElement, useKit, createBus, createStore, navigateEvent, createDevtools,
  createHostRouter, createRouteTable(manifest ? [manifest] : []), defineMfeOutlet,
  getPlatformRegistry, checkRemote, createMemoryLoader, versions,
];
`,
  );
  writeFileSync(
    join(consumer, "src", "node.ts"),
    `import { defineRemoteConfig, sharedByLine } from "@mfe-platform/rsbuild";
export const config = defineRemoteConfig({ name: "cards", port: 3005 });
export const shared = sharedByLine({ "@rwcjs/ui": "0.1.0" });
`,
  );

  const install = run("bun", ["install"], consumer);
  if (!install.ok) problems.push(`consumer install failed:\n${install.output}`);
  else {
    const types = run("bunx", ["tsc", "-p", "tsconfig.json"], consumer);
    // Ошибки в типах чужих пакетов — не наши; наши .d.ts и код потребителя должны быть чистыми.
    const ours = types.output.split("\n").filter((line) => /@mfe-platform|^src[\\/]/.test(line));
    if (ours.length > 0) problems.push(`tsc in consumer:\n${ours.join("\n")}`);

    const bundle = await Bun.build({
      entrypoints: [join(consumer, "src", "browser.ts")],
      target: "browser",
      root: consumer,
    });
    if (!bundle.success) problems.push(`bundle in consumer: ${bundle.logs.join("\n")}`);

    writeFileSync(
      join(consumer, "node.mjs"),
      `import("@mfe-platform/rsbuild").then((m) => {
  if (typeof m.defineRemoteConfig !== "function") process.exit(2);
});
`,
    );
    const node = run("node", ["node.mjs"], consumer);
    if (!node.ok) problems.push(`@mfe-platform/rsbuild in Node:\n${node.output}`);
  }
} finally {
  rmSync(consumer, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`[check-packages]\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`packages ok: ${packages.map((pkg) => pkg.json.name).join(", ")}`);

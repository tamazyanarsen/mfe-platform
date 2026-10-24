import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Архитектурные границы репозитория (docs/architecture.md, раздел 1).
 *
 * 1. Ядро платформы не зависит ни от одного UI-фреймворка: ни rwc, ни React.
 * 2. Ядро не знает об адаптерах и приложениях — зависимость только в обратную сторону.
 */
export const CORE_PACKAGES = ["contract", "host-runtime", "registry", "bus"] as const;

const FRAMEWORKS = [/^@rwcjs\//, /^react$/, /^react\//, /^react-dom(\/|$)/];
// Ядро не знает и о сборке: @mfe-platform/rsbuild — инструмент ремоутов, а не рантайм.
const INTERNAL_NON_CORE = [/^@mfe-platform\/adapter-/, /^@mfe-platform\/rsbuild$/];

export interface Violation {
  readonly file: string;
  readonly specifier: string;
  readonly rule: string;
}

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
// import x from "a"; export * from "a"; import("a"); require("a"); import "a";
const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'`]([^"'`]+)["'`]/gm;

const walk = (dir: string): string[] => {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    if (name === "node_modules" || name === "dist") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
};

const dependencyNames = (packageJson: string): string[] => {
  const json = JSON.parse(readFileSync(packageJson, "utf8")) as Record<string, unknown>;
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap(
    (field) => Object.keys((json[field] as Record<string, string> | undefined) ?? {}),
  );
};

const specifiersOf = (file: string): string[] => {
  if (file.endsWith("package.json")) return dependencyNames(file);
  if (!SOURCE_EXT.test(file)) return [];
  return [...readFileSync(file, "utf8").matchAll(IMPORT_RE)].map((match) => match[1] as string);
};

const listDirs = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
  } catch {
    return [];
  }
};

export const checkBoundaries = (root: string): Violation[] => {
  const violations: Violation[] = [];
  const scan = (dir: string, rules: ReadonlyArray<readonly [string, readonly RegExp[]]>) => {
    for (const file of walk(dir)) {
      for (const specifier of specifiersOf(file)) {
        for (const [rule, patterns] of rules) {
          if (patterns.some((pattern) => pattern.test(specifier))) {
            violations.push({ file: relative(root, file).replaceAll("\\", "/"), specifier, rule });
          }
        }
      }
    }
  };

  for (const name of listDirs(join(root, "packages"))) {
    if (!(CORE_PACKAGES as readonly string[]).includes(name)) continue;
    scan(join(root, "packages", name), [
      ["core package depends on a UI framework", FRAMEWORKS],
      ["core package depends on an adapter", INTERNAL_NON_CORE],
    ]);
  }
  return violations;
};

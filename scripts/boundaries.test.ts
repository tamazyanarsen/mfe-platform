import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { checkBoundaries } from "./boundaries";

let root = "";

const file = (path: string, content: string) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
};

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

const fixture = () => {
  root = mkdtempSync(join(tmpdir(), "boundaries-"));
  file("packages/contract/package.json", "{}");
  file("packages/contract/src/index.ts", "export const CONTRACT_VERSION = 1;\n");
};

describe("checkBoundaries", () => {
  test("реальный репозиторий чист", () => {
    expect(checkBoundaries(resolve(import.meta.dir, ".."))).toEqual([]);
  });

  test("импорт @rwcjs/* в ядре — нарушение", () => {
    fixture();
    file("packages/registry/src/index.ts", 'import { signal } from "@rwcjs/core";\n');
    expect(checkBoundaries(root)).toEqual([
      {
        file: "packages/registry/src/index.ts",
        specifier: "@rwcjs/core",
        rule: "core package depends on a UI framework",
      },
    ]);
  });

  test("динамический импорт и зависимость в package.json тоже ловятся", () => {
    fixture();
    file("packages/bus/src/lazy.ts", 'export const load = () => import("react-dom/client");\n');
    file("packages/host-runtime/package.json", '{ "peerDependencies": { "@rwcjs/ui": "*" } }');
    expect(
      checkBoundaries(root)
        .map((v) => v.specifier)
        .sort(),
    ).toEqual(["@rwcjs/ui", "react-dom/client"]);
  });

  test("ядро не импортирует адаптеры", () => {
    fixture();
    file("packages/contract/src/x.ts", 'export * from "@mfe/adapter-rwc";\n');
    expect(checkBoundaries(root)).toHaveLength(1);
  });

  test("адаптер и приложение могут зависеть от фреймворка", () => {
    fixture();
    file("packages/adapter-rwc/src/index.ts", 'import "@rwcjs/core";\n');
    file("apps/host/src/main.ts", 'import { createRoot } from "react-dom/client";\n');
    expect(checkBoundaries(root)).toEqual([]);
  });
});

describe("имя тега строит только кит", () => {
  test("в исходниках платформы нет второго места, где постфикс склеивается с тегом", () => {
    const repo = resolve(import.meta.dir, "..");
    const glob = new Bun.Glob("{packages,apps}/*/src/**/*.ts");
    const offenders = [...glob.scanSync({ cwd: repo })].filter((file) =>
      /-\$\{\s*postfix\s*\}|\+\s*["'`]-["'`]\s*\+\s*postfix/.test(
        readFileSync(join(repo, file), "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { DESCRIPTIONS, listPackages, publishedJson, releaseVersion } from "./packages";

describe("пакеты для npm", () => {
  const packages = listPackages();
  const names = packages.map((pkg) => pkg.json.name);

  test("у каждого пакета есть описание и одна общая версия", () => {
    for (const pkg of packages) expect(DESCRIPTIONS[pkg.dir]).toBeTruthy();
    expect(releaseVersion(packages)).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("зависимость публикуется раньше того, кто от неё зависит", () => {
    for (const [index, pkg] of packages.entries()) {
      for (const dependency of Object.keys(pkg.json.dependencies ?? {})) {
        if (names.includes(dependency)) expect(names.indexOf(dependency)).toBeLessThan(index);
      }
    }
  });

  test("package.json без workspace:*, private и devDependencies, exports — на dist", () => {
    const pkg = packages.find((pkg) => pkg.dir === "testing");
    if (!pkg) throw new Error("no testing package");
    const json = publishedJson(pkg, "1.2.3", new Set(names));
    expect(json.dependencies).toEqual({
      "@mfe-platform/contract": "^1.2.3",
      "@mfe-platform/host-runtime": "^1.2.3",
    });
    expect(json).not.toHaveProperty("private");
    expect(json).not.toHaveProperty("devDependencies");
    expect(json.exports["."]).toEqual({ types: "./dist/index.d.ts", import: "./dist/index.js" });
    expect(json.repository.directory).toBe("packages/testing");
  });

  test("дополнительные exports попадают в files: типы глобальных констант rsbuild", () => {
    const pkg = packages.find((pkg) => pkg.dir === "rsbuild");
    if (!pkg) throw new Error("no rsbuild package");
    const json = publishedJson(pkg, "1.2.3", new Set(names));
    expect(json.exports["./env"]).toEqual({ types: "./env.d.ts" });
    expect(json.files).toEqual(["dist", "env.d.ts"]);
    expect(json.peerDependencies).toHaveProperty("@rsbuild/core");
  });

  test("разные версии пакетов — ошибка", () => {
    const [first, second] = packages;
    if (!first || !second) throw new Error("need two packages");
    expect(() =>
      releaseVersion([first, { ...second, json: { ...second.json, version: "9.9.9" } }]),
    ).toThrow("one version");
  });
});

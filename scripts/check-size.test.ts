import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { measureAll, remoteFiles } from "./check-size";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mfe-size-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const assets = (sync: string[] = [], async: string[] = []) => ({
  js: { sync, async },
  css: { sync: [], async: [] },
});

const write = (path: string, content: string | Uint8Array) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};

/** Собранный ремоут: remoteEntry, чанки экспонированных модулей и страница самостоятельного запуска. */
const remote = (app: string, budgetKb?: number) => {
  write(
    `apps/${app}/package.json`,
    JSON.stringify(
      budgetKb ? { name: app, mfe: { sizeBudget: { gzipKb: budgetKb } } } : { name: app },
    ),
  );
  write(
    `apps/${app}/dist/mf-manifest.json`,
    JSON.stringify({
      metaData: { remoteEntry: { name: "static/js/remote.js", path: "" } },
      exposes: [
        { assets: assets(["static/js/async/manifest.js"]) },
        {
          assets: assets(
            ["static/js/vendor.js", "static/js/async/entry.js"],
            ["static/js/async/lazy.js"],
          ),
        },
      ],
      shared: [],
    }),
  );
  // Несжимаемые данные: размер после gzip близок к исходному, и бюджет проверяется предсказуемо.
  const noise = (size: number) => crypto.getRandomValues(new Uint8Array(size));
  write(`apps/${app}/dist/static/js/remote.js`, noise(10 * 1024));
  write(`apps/${app}/dist/static/js/async/manifest.js`, "export const manifest = {};");
  write(`apps/${app}/dist/static/js/vendor.js`, noise(20 * 1024));
  write(`apps/${app}/dist/static/js/async/entry.js`, "export const register = () => {};");
  write(`apps/${app}/dist/static/js/async/lazy.js`, "export default 1;");
  // Страница самостоятельного запуска хост не грузит: в бюджет не входит.
  write(`apps/${app}/dist/static/js/index.js`, noise(500 * 1024));
};

describe("check-size", () => {
  test("в бюджет входят remoteEntry и чанки экспонированных модулей, без страницы запуска", () => {
    remote("mfe-cards", 100);
    const [size] = measureAll(root);
    expect(size?.app).toBe("mfe-cards");
    expect(size?.files).toBe(5);
    expect(size?.rawBytes).toBeGreaterThan(30 * 1024);
    expect(size?.rawBytes).toBeLessThan(31 * 1024);
    expect(size?.budgetBytes).toBe(100 * 1024);
  });

  test("превышение бюджета видно, ремоут без бюджета и хост — без ошибки", () => {
    remote("mfe-big", 10);
    remote("mfe-free");
    write(
      "apps/host/dist/mf-manifest.json",
      JSON.stringify({
        metaData: { remoteEntry: { name: "", path: "" } },
        exposes: [],
        shared: [],
      }),
    );
    write("apps/host/package.json", "{}");

    const sizes = measureAll(root);
    expect(sizes.map((size) => size.app)).toEqual(["mfe-big", "mfe-free"]);
    const [big, free] = sizes;
    expect((big?.gzipBytes ?? 0) > (big?.budgetBytes ?? 0)).toBe(true);
    expect(free?.budgetBytes).toBeUndefined();
  });

  test("remoteFiles учитывает путь remoteEntry и не дублирует общие чанки", () => {
    expect(
      remoteFiles({
        metaData: { remoteEntry: { name: "remote.js", path: "static/" } },
        exposes: [{ assets: assets(["a.js"]) }, { assets: assets(["a.js", "b.js"]) }],
        shared: [{ assets: assets(["c.js"]) }],
      }),
    ).toEqual(["static/remote.js", "a.js", "b.js", "c.js"]);
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_PATH, createRemote, TEMPLATES } from "./create-remote";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mfe-create-"));
  mkdirSync(join(root, "apps/host/public"), { recursive: true });
  writeFileSync(
    join(root, CONFIG_PATH),
    JSON.stringify({
      remotes: [
        { name: "accounts", entry: "http://localhost:3001/mf-manifest.json" },
        { name: "payments", entry: "http://localhost:3002/mf-manifest.json" },
      ],
      nav: [{ href: "/", title: "Обзор" }],
      overview: [],
    }),
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const read = (path: string) => readFileSync(join(root, path), "utf8");
const config = () => JSON.parse(read(CONFIG_PATH));

describe("createRemote", () => {
  test.each(TEMPLATES)("шаблон %s: каркас без незаполненных мест", (template) => {
    const created = createRemote({ root, name: "credit_cards", template, title: "Карты" });

    expect(created.port).toBe(3003);
    expect(created.files).toEqual(
      expect.arrayContaining([
        "README.md",
        "package.json",
        "rsbuild.config.ts",
        "src/entry.ts",
        "src/manifest.ts",
        "test/contract.test.ts",
      ]),
    );
    for (const file of created.files) {
      expect(read(`apps/mfe-credit_cards/${file}`)).not.toMatch(/__[A-Z]+__/);
    }
    expect(JSON.parse(read("apps/mfe-credit_cards/package.json")).name).toBe(
      "@mfe-app/credit_cards",
    );
    const manifest = read("apps/mfe-credit_cards/src/manifest.ts");
    expect(manifest).toContain('tag: "mfe-credit-cards"');
    expect(manifest).toContain('routes: ["/credit_cards", "/credit_cards/*"]');
    expect(read("apps/mfe-credit_cards/rsbuild.config.ts")).toContain("port: 3003");
  });

  test("порт по умолчанию не занят и ремоутом вне конфигурации хоста", () => {
    mkdirSync(join(root, "apps/mfe-probe"), { recursive: true });
    writeFileSync(
      join(root, "apps/mfe-probe/rsbuild.config.ts"),
      'export default defineRemoteConfig({ name: "probe", port: 3007 });',
    );
    expect(createRemote({ root, name: "cards" }).port).toBe(3008);
  });

  test("ремоут и пункт навигации попадают в конфигурацию хоста", () => {
    createRemote({ root, name: "cards", port: 3010, title: "Карты" });
    expect(config().remotes.at(-1)).toEqual({
      name: "cards",
      entry: "http://localhost:3010/mf-manifest.json",
    });
    expect(config().nav.at(-1)).toEqual({ href: "/cards", title: "Карты" });
  });

  test("--no-nav не трогает навигацию", () => {
    createRemote({ root, name: "widgets", nav: false });
    expect(config().nav).toHaveLength(1);
  });

  test("кривое имя, занятое имя и неизвестный шаблон — ошибка без изменений", () => {
    expect(() => createRemote({ root, name: "Cards" })).toThrow("lowercase identifier");
    expect(() => createRemote({ root, name: "accounts" })).toThrow("already in");
    expect(() => createRemote({ root, name: "cards", template: "vue" as never })).toThrow(
      "unknown template",
    );
    createRemote({ root, name: "cards" });
    expect(() => createRemote({ root, name: "cards" })).toThrow("already exists");
    expect(config().remotes).toHaveLength(3);
  });
});

describe("create:remote из командной строки", () => {
  const cli = (...args: string[]) =>
    Bun.spawnSync(["bun", "run", join(import.meta.dir, "create-remote.ts"), ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

  test("без имени — подсказка и код ошибки", () => {
    const result = cli();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("usage: bun run create:remote <name>");
  });

  test("кривое имя — ошибка без изменений в репозитории", () => {
    const result = cli("Bad-Name");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("must be a lowercase identifier");
  });
});

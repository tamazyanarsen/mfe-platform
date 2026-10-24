import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RemoteModule } from "@mfe/contract";
import { checkRemote } from "@mfe/testing";

// Сборка подставляет версию кита, с которой собран ремоут; тест делает то же до импорта.
const installed = (pkg: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "../node_modules", pkg, "package.json"), "utf8"))
    .version as string;
Object.assign(globalThis, { __MFE_KIT_VERSIONS__: { "@rwcjs/ui": installed("@rwcjs/ui") } });

const entry: RemoteModule = await import("../src/entry");
const { manifest } = await import("../src/manifest");

test("probe соответствует контракту платформы", async () => {
  expect(await checkRemote(entry, { manifest })).toEqual([]);
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeIntegrity } from "../packages/host-runtime/src";
import { INTEGRITY_FILE, sealManifest, sri } from "./integrity";

let dist = "";
beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), "mfe-seal-"));
  mkdirSync(join(dist, "static/js/async"), { recursive: true });
  mkdirSync(join(dist, "static/css"), { recursive: true });
});
afterEach(() => rmSync(dist, { recursive: true, force: true }));

const write = (path: string, content: string) => writeFileSync(join(dist, path), content);
const sha384 = (content: string) =>
  `sha384-${createHash("sha384").update(content).digest("base64")}`;

describe("sealManifest", () => {
  test("хеш каждого JS и CSS ремоута — в манифесте, хеш манифеста — в отдельном файле", async () => {
    write("static/js/remote.js", "console.log('remote');");
    write("static/js/async/entry.js", "export const register = () => {};");
    write("static/css/entry.css", "body{}");
    write("index.html", "<html></html>");
    write(
      "mf-manifest.json",
      JSON.stringify({ metaData: { remoteEntry: { name: "static/js/remote.js", path: "" } } }),
    );

    const integrity = sealManifest(dist);
    const sealed = readFileSync(join(dist, "mf-manifest.json"));
    const manifest = JSON.parse(sealed.toString());

    expect(manifest.metaData.integrity).toEqual({
      "static/css/entry.css": sha384("body{}"),
      "static/js/async/entry.js": sha384("export const register = () => {};"),
      "static/js/remote.js": sha384("console.log('remote');"),
    });
    expect(integrity).toBe(sri(sealed));
    expect(readFileSync(join(dist, INTEGRITY_FILE), "utf8").trim()).toBe(integrity ?? "");
    // Хост считает хеш через WebCrypto — результат тот же, что у сборки.
    expect(await computeIntegrity(new Uint8Array(sealed))).toBe(integrity ?? "");
  });

  test("хост без remoteEntry и сборка без манифеста — пропускаются", () => {
    write(
      "mf-manifest.json",
      JSON.stringify({ metaData: { remoteEntry: { name: "", path: "" } } }),
    );
    expect(sealManifest(dist)).toBeNull();
    rmSync(join(dist, "mf-manifest.json"));
    expect(sealManifest(dist)).toBeNull();
  });
});

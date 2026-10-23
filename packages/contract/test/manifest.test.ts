import { describe, expect, test } from "bun:test";
import { CONTRACT_VERSION, decideMount, type PolicyHook, validateManifest } from "../src";

const valid = {
  contractVersion: CONTRACT_VERSION,
  name: "accounts",
  tag: "mfe-accounts-v2",
  routes: ["/accounts/*"],
  requires: { "@rwcjs/ui": "^0.1.0" },
  extra: { anything: { goes: [1, 2, 3] } },
};

describe("validateManifest", () => {
  test("валидный манифест", () => {
    expect(validateManifest(valid)).toEqual([]);
  });

  test("extra не проверяется", () => {
    expect(validateManifest({ ...valid, extra: "даже строка" })).toEqual([]);
  });

  test("перечисляет все проблемы", () => {
    expect(
      validateManifest({
        contractVersion: 0,
        name: "",
        tag: "Accounts",
        routes: [1],
        requires: { a: 1 },
      }),
    ).toHaveLength(5);
    expect(validateManifest(null)).toEqual(["manifest is not an object"]);
  });
});

describe("decideMount", () => {
  const context = { manifest: valid, mountId: "m1" };

  test("без хуков — разрешено", async () => {
    expect(await decideMount([], context)).toEqual({ allow: true });
  });

  test("первый запрет побеждает, хук без метода не мешает", async () => {
    const hooks: PolicyHook[] = [
      {},
      { beforeMount: () => ({ allow: true }) },
      { beforeMount: async () => ({ allow: false, reason: "first" }) },
      { beforeMount: () => ({ allow: false, reason: "second" }) },
    ];
    expect(await decideMount(hooks, context)).toEqual({ allow: false, reason: "first" });
  });
});

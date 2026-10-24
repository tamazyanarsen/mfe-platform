import { describe, expect, test } from "bun:test";
import { CONTRACT_VERSION, type RemoteManifest } from "@mfe-platform/contract";
import { createFederationLoader, type LoadRemote } from "../src";

const manifest: RemoteManifest = {
  contractVersion: CONTRACT_VERSION,
  name: "accounts",
  tag: "mfe-accounts",
  routes: ["/accounts/*"],
};

/** loadRemote рантайма MF: отвечает по id из таблицы, считает обращения. */
const federation = (modules: Record<string, () => unknown>) => {
  const calls: string[] = [];
  const loadRemote = (async (id: string) => {
    calls.push(id);
    const factory = modules[id];
    if (!factory) throw new Error(`no ${id}`);
    return factory();
  }) as LoadRemote;
  return { loadRemote, calls };
};

describe("createFederationLoader", () => {
  test("манифест — из ./manifest, модуль с register() — из ./entry", async () => {
    const register = () => {};
    const { loadRemote, calls } = federation({
      "accounts/manifest": () => ({ manifest }),
      "accounts/entry": () => ({ manifest, register }),
    });
    const loader = createFederationLoader(loadRemote);

    expect(await loader.loadManifest("accounts")).toBe(manifest);
    expect((await loader.loadModule("accounts")).register).toBe(register);
    expect(calls).toEqual(["accounts/manifest", "accounts/entry"]);
  });

  test("успешные загрузки кешируются: повторный вызов не идёт в рантайм MF", async () => {
    const { loadRemote, calls } = federation({ "accounts/manifest": () => ({ manifest }) });
    const loader = createFederationLoader(loadRemote);
    await Promise.all([loader.loadManifest("accounts"), loader.loadManifest("accounts")]);
    await loader.loadManifest("accounts");
    expect(calls).toEqual(["accounts/manifest"]);
  });

  test("упавшая загрузка не кешируется: следующий вызов пробует снова", async () => {
    let up = false;
    const { loadRemote, calls } = federation({
      "accounts/entry": () => {
        if (!up) throw new Error("chunk 503");
        return { manifest, register() {} };
      },
    });
    const loader = createFederationLoader(loadRemote);

    expect(loader.loadModule("accounts")).rejects.toThrow("chunk 503");
    await new Promise((resolve) => setTimeout(resolve, 0));
    up = true;
    expect((await loader.loadModule("accounts")).manifest).toBe(manifest);
    expect(calls).toEqual(["accounts/entry", "accounts/entry"]);
  });

  test("пустой модуль от рантайма MF — понятная ошибка", async () => {
    const { loadRemote } = federation({ "accounts/entry": () => undefined });
    const loader = createFederationLoader(loadRemote);
    expect(loader.loadModule("accounts")).rejects.toThrow(
      'remote module "accounts/entry" is empty',
    );
  });
});

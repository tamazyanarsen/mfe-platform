import { afterEach, describe, expect, test } from "bun:test";
import { CONTRACT_VERSION, type RemoteManifest, type RemoteModule } from "@mfe-platform/contract";
import { checkRemote, createMemoryLoader, mountRemote } from "../src";

let counter = 0;

/** Ремоут-образец; `broken` портит одну из частей контракта. */
const sampleRemote = (
  broken?: "render" | "register" | "define" | "manifest",
  overrides: Partial<RemoteManifest> = {},
): RemoteModule => {
  const tag = `sample-remote-${++counter}`;
  const manifest: RemoteManifest = {
    contractVersion: CONTRACT_VERSION,
    name: `sample${counter}`,
    tag: broken === "manifest" ? "NoDash" : tag,
    routes: [`/sample${counter}/*`],
    ...overrides,
  };
  return {
    manifest,
    register() {
      if (broken === "define") return;
      if (customElements.get(tag)) {
        if (broken === "register") throw new Error("already defined");
        return;
      }
      customElements.define(
        tag,
        class extends HTMLElement {
          platform: unknown = null;
          connectedCallback() {
            if (broken === "render") throw new Error("render exploded");
            this.textContent = `basename=${this.getAttribute("basename")}`;
          }
        },
      );
    },
  };
};

afterEach(() => document.body.replaceChildren());

describe("mountRemote", () => {
  test("монтирует ремоут через настоящий outlet и отдаёт элемент и события", async () => {
    const remote = sampleRemote();
    const mounted = await mountRemote(remote, {
      basename: "/accounts",
      props: { platform: { theme: "dark" } },
    });

    expect(mounted.state).toBe("ready");
    expect(mounted.element?.textContent).toBe("basename=/accounts");
    expect((mounted.element as HTMLElement & { platform: unknown }).platform).toEqual({
      theme: "dark",
    });
    expect(mounted.events.events().map((event) => event.type)).toContain("mount:start");

    mounted.unmount();
    expect(mounted.outlet.isConnected).toBe(false);
  });

  test("ошибка отрисовки — состояние error, а не исключение в тесте", async () => {
    const mounted = await mountRemote(sampleRemote("render"));
    expect(mounted.state).toBe("error");
    expect(mounted.element).toBeNull();
  });
});

describe("createMemoryLoader", () => {
  test("отдаёт ремоуты по имени и ведёт журнал", async () => {
    const remote = sampleRemote();
    const loader = createMemoryLoader(remote);
    await loader.loadManifest(remote.manifest.name);
    await loader.loadModule(remote.manifest.name);
    expect(loader.calls).toEqual([
      `manifest:${remote.manifest.name}`,
      `module:${remote.manifest.name}`,
    ]);
    expect(loader.loadModule("unknown")).rejects.toThrow('unknown remote "unknown"');
  });
});

describe("checkRemote", () => {
  test("исправный ремоут — без проблем", async () => {
    const remote = sampleRemote();
    expect(await checkRemote(remote, { manifest: remote.manifest })).toEqual([]);
  });

  test.each([
    ["manifest", "manifest: tag must be a valid custom element name"],
    ["register", "register() must be idempotent: already defined"],
    ["define", "register() did not define"],
    ["render", "mount failed: render exploded"],
  ] as const)("сломан %s → %p", async (broken, problem) => {
    const problems = await checkRemote(sampleRemote(broken));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(problem);
  });

  test("./manifest и ./entry расходятся, версия контракта не поддерживается", async () => {
    const remote = sampleRemote(undefined, { contractVersion: CONTRACT_VERSION + 1 });
    const problems = await checkRemote(remote, {
      manifest: { ...remote.manifest, tag: "other-tag" },
    });
    expect(problems).toContain("./manifest and ./entry disagree on tag");
    expect(problems).toContain(
      `contract version ${CONTRACT_VERSION + 1} is not supported by the host`,
    );
  });
});

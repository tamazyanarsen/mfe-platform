import { afterEach, describe, expect, test } from "bun:test";
import type { PlatformEvent } from "@mfe/contract";
import type { KitRecord } from "@mfe/registry";
import { createDevtools, type Devtools } from "../src";

const event = (type: PlatformEvent["type"], name: string, extra: Partial<PlatformEvent> = {}) =>
  ({ type, name, time: Date.now(), ...extra }) as PlatformEvent;

const kits: KitRecord[] = [
  {
    kit: "@rwcjs/ui",
    postfix: "v0-2",
    version: "0.2.0",
    controlTag: "rwc-button-v0-2",
    consumers: new Map([["accounts", "0.2.0"]]),
  },
];

let devtools: Devtools | null = null;
const create = (options: Parameters<typeof createDevtools>[0] = {}) => {
  devtools = createDevtools({ registry: { records: () => kits }, ...options });
  return devtools;
};

afterEach(() => {
  devtools?.dispose();
  devtools = null;
});

const panelText = (tools: Devtools) => tools.element.shadowRoot?.textContent ?? "";
const tick = () => new Promise((resolve) => queueMicrotask(() => resolve(undefined)));

describe("createDevtools", () => {
  test("состояние ремоутов собирается из событий монтирования", () => {
    const tools = create();
    const { send } = tools.transport;
    send(event("mount:start", "accounts", { version: "1.2.0", route: "/accounts" }));
    send(event("mount:code-loaded", "accounts", { timings: { codeLoad: 40 } }));
    send(event("mount:ready", "accounts", { timings: { codeLoad: 40, firstFrame: 95 } }));
    send(event("mount:start", "payments"));
    send(event("mount:error", "payments", { error: { message: "chunk 404" } }));
    send(event("mount:start", "legacy"));
    send(event("mount:denied", "legacy", { reason: "frozen" }));

    expect(tools.remotes()).toEqual([
      {
        name: "accounts",
        state: "ready",
        version: "1.2.0",
        route: "/accounts",
        codeLoad: 40,
        firstFrame: 95,
        mounts: 1,
        errors: 0,
      },
      { name: "payments", state: "error", mounts: 1, errors: 1, message: "chunk 404" },
      { name: "legacy", state: "denied", mounts: 1, errors: 1, message: "frozen" },
    ]);
    expect(tools.errors().map((error) => error.message)).toEqual(["frozen", "chunk 404"]);
  });

  test("повторное монтирование сбрасывает время и ошибку прошлого раза", () => {
    const tools = create();
    tools.transport.send(event("mount:start", "payments"));
    tools.transport.send(event("mount:error", "payments", { error: { message: "offline" } }));
    tools.transport.send(event("mount:start", "payments"));

    expect(tools.remotes()[0]).toEqual({
      name: "payments",
      state: "loading",
      mounts: 2,
      errors: 1,
    });
  });

  test("панель показывает ремоуты, киты, подмены и ошибки и обновляется по событиям", async () => {
    const tools = create({
      overrides: [{ name: "payments", entry: "http://localhost:3002/mf-manifest.json" }],
    });
    tools.open();
    expect(tools.isOpen).toBe(true);
    expect(panelText(tools)).toContain("no remotes mounted yet");
    expect(panelText(tools)).toContain("v0-2");
    expect(panelText(tools)).toContain("accounts@0.2.0");
    expect(panelText(tools)).toContain("http://localhost:3002/mf-manifest.json");

    tools.transport.send(event("mount:start", "accounts"));
    tools.transport.send(event("mount:error", "accounts", { error: { message: "<img onerror>" } }));
    await tick();

    expect(panelText(tools)).toContain("accounts");
    // Данные ремоута — только текст, никакой разметки.
    expect(panelText(tools)).toContain("<img onerror>");
    expect(tools.element.shadowRoot?.querySelector("img")).toBeNull();
  });

  test("Alt+Shift+D и кнопка закрытия переключают панель, dispose снимает сочетание", () => {
    const tools = create();
    const press = () =>
      dispatchEvent(new KeyboardEvent("keydown", { altKey: true, shiftKey: true, code: "KeyD" }));

    press();
    expect(tools.isOpen).toBe(true);
    tools.element.shadowRoot?.querySelector("button")?.click();
    expect(tools.isOpen).toBe(false);
    press();
    expect(tools.isOpen).toBe(true);

    tools.dispose();
    expect(tools.isOpen).toBe(false);
    press();
    expect(tools.isOpen).toBe(false);
  });

  test("hotkey: null — сочетания нет", () => {
    const tools = create({ hotkey: null });
    dispatchEvent(new KeyboardEvent("keydown", { altKey: true, shiftKey: true, code: "KeyD" }));
    expect(tools.isOpen).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import type { PlatformEvent } from "@mfe-platform/contract";
import { createTagRegistry, getPlatformRegistry, postfixFor } from "../src";

describe("postfixFor", () => {
  test.each([
    ["2.0.0", "v2"],
    ["2.14.3", "v2"],
    ["10.0.0-rc.1", "v10"],
    ["0.1.2", "v0-1"],
    ["0.2.0", "v0-2"],
  ])("%s → %s", (version, postfix) => {
    expect(postfixFor("@rwcjs/ui", version)).toBe(postfix);
  });

  test("не-semver — ошибка", () => {
    expect(() => postfixFor("@rwcjs/ui", "latest")).toThrow();
  });
});

/** Кит без rwc: реестр о фреймворке ничего не знает. */
const plainKit = (base: string) => {
  const Control = class extends HTMLElement {};
  let calls = 0;
  return {
    Control,
    calls: () => calls,
    register: (postfix: string) => {
      calls++;
      const tag = `${base}-${postfix}`;
      if (!customElements.get(tag)) customElements.define(tag, Control);
      return tag;
    },
  };
};

describe("createTagRegistry", () => {
  test("регистрация, повторное использование и учёт", () => {
    const registry = createTagRegistry();
    const events: PlatformEvent[] = [];
    registry.setTransport({ send: (event) => events.push(event) });
    const kit = plainKit("plain-a");

    const first = registry.registerKit({
      kit: "plain",
      version: "3.1.0",
      consumer: "accounts",
      control: kit.Control,
      register: kit.register,
    });
    const second = registry.registerKit({
      kit: "plain",
      version: "3.2.0",
      consumer: "cards",
      control: kit.Control,
      register: kit.register,
    });

    expect(first).toEqual({ status: "registered", postfix: "v3", tag: "plain-a-v3" });
    expect(second).toEqual({ status: "reused", postfix: "v3", tag: "plain-a-v3" });
    expect(kit.calls()).toBe(1);
    expect(events.map((e) => e.type)).toEqual(["register:ok", "register:ok"]);
    expect(events[1]?.details).toMatchObject({ reused: true, consumer: "cards" });
  });

  test("политика проверяет и того, кто переиспользует уже зарегистрированный набор", () => {
    const registry = createTagRegistry();
    registry.use({
      beforeRegister: ({ consumer }) =>
        consumer === "legacy" ? { allow: false, reason: "legacy is frozen" } : { allow: true },
    });
    const kit = plainKit("plain-b");
    const request = {
      kit: "plain",
      version: "4.0.0",
      control: kit.Control,
      register: kit.register,
    };

    expect(registry.registerKit({ ...request, consumer: "accounts" }).status).toBe("registered");
    expect(registry.registerKit({ ...request, consumer: "legacy" })).toEqual({
      status: "denied",
      postfix: "v4",
      reason: "legacy is frozen",
    });
    expect([...(registry.records()[0]?.consumers.keys() ?? [])]).toEqual(["accounts"]);
  });

  test("реестр платформы один на страницу, даже если копий пакета несколько", () => {
    expect(getPlatformRegistry()).toBe(getPlatformRegistry());
  });
});

describe("createTagRegistry: края", () => {
  test("кит, который не зарегистрировал контрольный тег, — конфликт, а не учёт", () => {
    const registry = createTagRegistry();
    const result = registry.registerKit({
      kit: "broken",
      version: "1.0.0",
      consumer: "accounts",
      register: () => undefined,
    });
    expect(result).toMatchObject({ status: "conflict", postfix: "v1" });
    expect(registry.records()).toEqual([]);
  });

  test("отключённая политика больше не запрещает", () => {
    const registry = createTagRegistry();
    const kit = plainKit("plain-c");
    const off = registry.use({ beforeRegister: () => ({ allow: false, reason: "frozen" }) });
    const request = {
      kit: "plain",
      version: "5.0.0",
      consumer: "accounts",
      control: kit.Control,
      register: kit.register,
    };
    expect(registry.registerKit(request).status).toBe("denied");
    off();
    expect(registry.registerKit(request).status).toBe("registered");
  });

  test("records() отдаёт копию: учёт снаружи не испортить", () => {
    const registry = createTagRegistry();
    const kit = plainKit("plain-d");
    registry.registerKit({
      kit: "plain",
      version: "6.0.0",
      consumer: "accounts",
      control: kit.Control,
      register: kit.register,
    });
    const [record] = registry.records();
    const consumers = record?.consumers as Map<string, string> | undefined;
    consumers?.set("intruder", "1");
    expect([...(registry.records()[0]?.consumers.keys() ?? [])]).toEqual(["accounts"]);
  });
});

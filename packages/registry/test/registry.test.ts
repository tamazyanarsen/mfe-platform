import { describe, expect, test } from "bun:test";
import type { PlatformEvent } from "@mfe/contract";
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

  test("реестр платформы один на страницу, даже если копий пакета несколько", () => {
    expect(getPlatformRegistry()).toBe(getPlatformRegistry());
  });
});

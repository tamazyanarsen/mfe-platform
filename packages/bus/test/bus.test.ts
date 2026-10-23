import { describe, expect, test } from "bun:test";
import type { PlatformTopics } from "@mfe/contract";
import { createBus, createStore, createSubscriptions } from "../src";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createBus", () => {
  test("публикация доходит до подписчика, отписка работает", () => {
    const bus = createBus<PlatformTopics>(new EventTarget());
    const seen: string[] = [];
    const off = bus.subscribe("account:selected", ({ accountId }) => seen.push(accountId));
    bus.publish("account:selected", { accountId: "1", title: "a" });
    off();
    off();
    bus.publish("account:selected", { accountId: "2", title: "b" });
    expect(seen).toEqual(["1"]);
    expect(bus.listenerCount("account:selected")).toBe(0);
  });

  test("типы тем проверяет компилятор", () => {
    const bus = createBus<PlatformTopics>(new EventTarget());
    // @ts-expect-error: у темы account:selected другая нагрузка
    bus.publish("account:selected", { id: 1 });
    // @ts-expect-error: такой темы нет
    bus.subscribe("no:such-topic", () => {});
  });

  test("две копии шины на одном узле видят друг друга", () => {
    const node = new EventTarget();
    const a = createBus<PlatformTopics>(node);
    const b = createBus<PlatformTopics>(node);
    let got = "";
    b.subscribe("account:selected", ({ title }) => {
      got = title;
    });
    a.publish("account:selected", { accountId: "1", title: "из другого ремоута" });
    expect(got).toBe("из другого ремоута");
  });
});

describe("утечки: подписка живёт ровно столько, сколько элемент", () => {
  let tagCounter = 0;

  test("смонтировать, подписать, размонтировать, опубликовать — обработчик не вызван, ссылок нет", async () => {
    const node = new EventTarget();
    const bus = createBus<PlatformTopics>(node);
    let calls = 0;

    const tag = `bus-leak-${++tagCounter}`;
    customElements.define(
      tag,
      class extends HTMLElement {
        #subs = createSubscriptions();
        connectedCallback() {
          this.#subs = createSubscriptions();
          bus.subscribe("account:selected", () => calls++, this.#subs);
        }
        disconnectedCallback() {
          this.#subs.dispose();
        }
      },
    );

    let element: HTMLElement | null = document.createElement(tag);
    const ref = new WeakRef(element);
    document.body.append(element);
    bus.publish("account:selected", { accountId: "1", title: "a" });
    expect(calls).toBe(1);

    element.remove();
    element = null;
    bus.publish("account:selected", { accountId: "2", title: "b" });
    expect(calls).toBe(1);
    expect(bus.listenerCount("account:selected")).toBe(0);

    await flush();
    Bun.gc(true);
    await flush();
    Bun.gc(true);
    expect(ref.deref()).toBeUndefined();
  });
});

describe("createStore", () => {
  test("равные значения не будят подписчиков", () => {
    const store = createStore({ theme: "light", locale: "ru" });
    const seen: string[] = [];
    store.subscribe((state) => seen.push(state.theme));
    store.set({ theme: "light" });
    store.set({ theme: "dark" });
    expect(seen).toEqual(["dark"]);
    expect(store.get()).toEqual({ theme: "dark", locale: "ru" });
  });
});

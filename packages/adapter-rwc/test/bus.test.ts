import { describe, expect, test } from "bun:test";
import { createBus } from "@mfe-platform/bus";
import type { PlatformTopics } from "@mfe-platform/contract";
import { createRoot, defineComponent, span, useCustomComponent } from "@rwcjs/core";
import { subscribeInRender } from "../src";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("subscribeInRender", () => {
  // Сборку мусора проверяет e2e/bus.e2e.ts в Chromium: happy-dom удерживает любой элемент
  // с shadow root, даже без rwc, так что здесь проверяется только отписка.
  test("подписка компонента rwc снимается при отключении", async () => {
    const bus = createBus<PlatformTopics>(new EventTarget());
    let calls = 0;

    class Listener extends defineComponent({ props: {} }) {
      render() {
        subscribeInRender(bus, "account:selected", () => calls++);
        return span("слушаю");
      }
    }
    const listener = useCustomComponent(Listener, "bus-rwc-listener");

    const element = createRoot(() => listener());
    document.body.append(element);
    await flush();
    bus.publish("account:selected", { accountId: "1", title: "a" });
    expect(calls).toBe(1);
    expect(bus.listenerCount("account:selected")).toBe(1);

    element.remove();
    // Разбор компонента rwc — на микрозадаче после отключения.
    await flush();
    bus.publish("account:selected", { accountId: "2", title: "b" });
    expect(calls).toBe(1);
    expect(bus.listenerCount("account:selected")).toBe(0);
  });
});

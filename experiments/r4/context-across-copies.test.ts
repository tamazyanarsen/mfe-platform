import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Эксперимент: доходит ли provide/inject rwc через границу двух ремоутов.
 * У изолированных ремоутов — две копии @rwcjs/core; у общего синглтона — одна.
 * Копию моделируем загрузкой того же dist из другой папки: это другой экземпляр модуля.
 */
type Core = typeof import("@rwcjs/core");

const coreEntry = Bun.resolveSync(
  "@rwcjs/core",
  join(import.meta.dir, "../../packages/adapter-rwc"),
);
let copyDir = "";
let coreA: Core;
let coreB: Core;

beforeAll(async () => {
  copyDir = mkdtempSync(join(tmpdir(), "rwc-core-copy-"));
  cpSync(dirname(coreEntry), copyDir, { recursive: true });
  coreA = await import(coreEntry);
  coreB = await import(join(copyDir, "index.js"));
});

afterAll(() => rmSync(copyDir, { recursive: true, force: true }));

let counter = 0;

/** Провайдер из копии `provider`, потребитель из копии `consumer` внутри него. */
const mountPair = async (provider: Core, consumer: Core, { sharedKey = false } = {}) => {
  const id = ++counter;
  const providerTheme = provider.createContext<string>("theme", "default");
  // Обычно ключ — объект своей копии, и потребитель в другом ремоуте создаёт свой.
  // sharedKey моделирует ключ из общего пакета, который оба ремоута получают одним объектом.
  const consumerTheme =
    provider === consumer || sharedKey
      ? providerTheme
      : consumer.createContext<string>("theme", "default");

  let seen = "";
  class Child extends consumer.defineComponent({ props: {} }) {
    render() {
      const theme = this.inject(consumerTheme);
      seen = theme();
      return consumer.span(theme);
    }
  }
  const child = consumer.useCustomComponent(Child, `r4-child-${id}`);

  class Parent extends provider.defineComponent({ props: {} }) {
    render() {
      this.provide(providerTheme, "dark");
      return provider.div({}, child());
    }
  }
  const parent = provider.useCustomComponent(Parent, `r4-parent-${id}`);

  document.body.append(provider.createRoot(() => parent()));
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.body.replaceChildren();
  return seen;
};

describe("provide/inject между ремоутами", () => {
  test("одна копия core (общий синглтон) — контекст доходит", async () => {
    expect(await mountPair(coreA, coreA)).toBe("dark");
  });

  test("две копии core (изоляция по умолчанию) — потребитель видит только своё значение по умолчанию", async () => {
    expect(coreA.createContext).not.toBe(coreB.createContext);
    expect(await mountPair(coreA, coreB)).toBe("default");
  });

  test("две копии core и даже общий объект ключа — контекст не доходит", async () => {
    // Провайдеры хранятся внутри экземпляра core, а не на ключе: общий ключ не помогает.
    expect(await mountPair(coreA, coreB, { sharedKey: true })).toBe("default");
  });
});

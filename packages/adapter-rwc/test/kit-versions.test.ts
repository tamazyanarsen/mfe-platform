import { describe, expect, mock, test } from "bun:test";
import { createTagRegistry } from "@mfe/registry";
import {
  button,
  type CustomTagName,
  configCustomComponent,
  css,
  defineComponent,
  slot,
} from "@rwcjs/core";
import { useKit } from "../src";

/**
 * Формы двух версий кита проверяются в e2e: happy-dom не умеет ElementInternals.
 *
 * Две «сборки» кита — два вызова makeKit: у каждой свои классы, как у двух бандлов
 * разных версий. Отличаются токеном и поведением кнопки.
 */
let kitCounter = 0;
const makeKit = (variant: { accent: string; label: (text: string) => string }) => {
  // Каждый тест берёт своё базовое имя: customElements не очищается между тестами.
  const base = `kit${++kitCounter}-button` as CustomTagName;

  class Button extends defineComponent({
    props: {},
    styles: css`:host { --kit-accent: ${variant.accent} }`,
  }) {
    render() {
      return button({ ".textContent": variant.label(this.textContent ?? "") }, slot());
    }
  }

  const [kitButton, registerButton] = configCustomComponent(Button, base);
  const registerAll = mock((options?: { postfix?: string }) => {
    registerButton(options);
  });
  return { Button, kitButton, registerAll, base };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useKit: версии кита через реестр платформы", () => {
  test("две версии кита на странице — два набора тегов, свои токены и поведение", async () => {
    const registry = createTagRegistry();
    const v1 = makeKit({ accent: "#1d4ed8", label: (t) => t.toUpperCase() });
    const v2 = makeKit({ accent: "#047857", label: (t) => t });

    const payments = useKit({
      name: "kit",
      version: "1.7.3",
      consumer: "payments",
      kit: v1,
      control: v1.Button,
      registry,
    });
    const accounts = useKit({
      name: "kit",
      version: "2.0.1",
      consumer: "accounts",
      kit: v2,
      control: v2.Button,
      registry,
    });

    expect(payments).toEqual({ status: "registered", postfix: "v1", tag: `${v1.base}-v1` });
    expect(accounts).toEqual({ status: "registered", postfix: "v2", tag: `${v2.base}-v2` });
    expect(customElements.get(payments.tag)).toBe(v1.Button);
    expect(customElements.get(accounts.tag)).toBe(v2.Button);

    // Фабрики в коде ремоутов не меняются, а теги — разные.
    const old = v1.kitButton({}, "pay");
    const next = v2.kitButton({}, "open");
    document.body.append(old, next);
    await flush();
    expect(old.localName).toBe(payments.tag);
    expect(next.localName).toBe(accounts.tag);
    expect(v1.Button.styles).toContain("#1d4ed8");
    expect(v2.Button.styles).toContain("#047857");
    expect(old.shadowRoot?.querySelector("button")?.textContent).toBe("PAY");
    expect(next.shadowRoot?.querySelector("button")?.textContent).toBe("open");
    document.body.replaceChildren();
  });

  test("третий ремоут на том же мажоре не регистрирует ничего нового", () => {
    const registry = createTagRegistry();
    const v2 = makeKit({ accent: "green", label: (t) => t });
    useKit({
      name: "kit",
      version: "2.0.1",
      consumer: "accounts",
      kit: v2,
      control: v2.Button,
      registry,
    });
    const before = v2.registerAll.mock.calls.length;

    // Та же сборка кита (в стенде — общий модуль Module Federation), другая патч-версия.
    const cards = useKit({
      name: "kit",
      version: "2.3.0",
      consumer: "cards",
      kit: v2,
      control: v2.Button,
      registry,
    });

    expect(cards.status).toBe("reused");
    expect(v2.registerAll.mock.calls.length).toBe(before);
    const [record] = registry.records();
    expect(record?.postfix).toBe("v2");
    expect([...(record?.consumers ?? [])]).toEqual([
      ["accounts", "2.0.1"],
      ["cards", "2.3.0"],
    ]);
  });

  test("другая сборка с тем же постфиксом — явный конфликт, а не сломанные фабрики", () => {
    const registry = createTagRegistry();
    const first = makeKit({ accent: "a", label: (t) => t });
    const rogue = { ...makeKit({ accent: "b", label: (t) => t }), base: first.base };
    useKit({
      name: "kit",
      version: "2.0.0",
      consumer: "accounts",
      kit: first,
      control: first.Button,
      registry,
    });

    expect(() =>
      useKit({
        name: "kit",
        version: "2.1.0",
        consumer: "rogue",
        kit: rogue,
        control: rogue.Button,
        registry,
      }),
    ).toThrow(/another build/);
    expect(rogue.registerAll).not.toHaveBeenCalled();
  });

  test("политика регистрации может запретить версию кита", () => {
    const registry = createTagRegistry();
    registry.use({
      beforeRegister: ({ postfix }) =>
        postfix === "v1"
          ? { allow: false, reason: "kit v1 is past end of support" }
          : { allow: true },
    });
    const v1 = makeKit({ accent: "a", label: (t) => t });

    expect(() =>
      useKit({
        name: "kit",
        version: "1.9.0",
        consumer: "payments",
        kit: v1,
        control: v1.Button,
        registry,
      }),
    ).toThrow(/end of support/);
    expect(v1.registerAll).not.toHaveBeenCalled();
    expect(registry.records()).toEqual([]);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement, useEffect } from "react";
import { liveReactRoots, registerReactElement } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanups = 0;

interface GreetingProps {
  greeting?: string;
  userName?: string;
  onNavigate?: (detail: { to: string }) => void;
}

const Greeting = ({ greeting = "hello", userName = "nobody", onNavigate }: GreetingProps) => {
  useEffect(() => () => void cleanups++, []);
  return createElement(
    "button",
    { type: "button", onClick: () => onNavigate?.({ to: "/accounts" }) },
    `${greeting}, ${userName}`,
  );
};

let counter = 0;
const define = () => {
  const tag = `react-remote-${++counter}`;
  registerReactElement(tag, Greeting as never, {
    props: ["greeting", "userName"],
    events: { onNavigate: "platform:navigate" },
  });
  return tag;
};

const text = (element: Element) => element.shadowRoot?.textContent ?? "";

afterEach(() => {
  document.body.replaceChildren();
});

describe("adapter-react", () => {
  test("свойства, выставленные до подключения, становятся пропсами", async () => {
    const element = document.createElement(define()) as HTMLElement & GreetingProps;
    element.greeting = "привет";
    await act(async () => {
      document.body.append(element);
    });
    expect(text(element)).toBe("привет, nobody");
  });

  test("смена свойства и атрибута перерисовывает", async () => {
    const element = document.createElement(define()) as HTMLElement & GreetingProps;
    await act(async () => {
      document.body.append(element);
    });
    await act(async () => {
      element.greeting = "hi";
      element.setAttribute("user-name", "Анна");
    });
    expect(text(element)).toBe("hi, Анна");
    expect(element.userName).toBe("Анна");
  });

  test("колбэк-пропс превращается в CustomEvent, который всплывает", async () => {
    const element = document.createElement(define());
    const seen: unknown[] = [];
    document.body.addEventListener("platform:navigate", (event) =>
      seen.push((event as CustomEvent).detail),
    );
    await act(async () => {
      document.body.append(element);
    });
    const button = element.shadowRoot?.querySelector("button");
    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
    });
    expect(seen).toEqual([{ to: "/accounts" }]);
  });

  test("размонтирование не оставляет React-рутов", async () => {
    const before = liveReactRoots().size;
    const cleanupsBefore = cleanups;
    const element = document.createElement(define());
    await act(async () => {
      document.body.append(element);
    });
    expect(liveReactRoots().size).toBe(before + 1);

    await act(async () => {
      element.remove();
      await Promise.resolve();
    });
    expect(liveReactRoots().size).toBe(before);
    expect(cleanups).toBe(cleanupsBefore + 1);
  });

  test("перенос в том же такте не пересоздаёт дерево", async () => {
    const element = document.createElement(define());
    const other = document.createElement("div");
    document.body.append(other);
    await act(async () => {
      document.body.append(element);
    });
    const cleanupsBefore = cleanups;
    await act(async () => {
      other.append(element);
      await Promise.resolve();
    });
    expect(cleanups).toBe(cleanupsBefore);
    expect(text(element)).toBe("hello, nobody");
  });

  test("повторная регистрация того же тега — no-op", () => {
    const tag = define();
    expect(() =>
      registerReactElement(tag, Greeting as never, { props: ["greeting"] }),
    ).not.toThrow();
  });
});

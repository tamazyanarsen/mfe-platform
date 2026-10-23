import { type ComponentType, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Обёртка-кастомный-элемент для ремоута на React (A7). Для платформы React-ремоут ничем не
 * отличается от любого другого: элемент, свойства на вход, CustomEvent на выход.
 *
 * - `connectedCallback` — `createRoot().render()`, `disconnectedCallback` — `unmount()`;
 * - перечисленные свойства и атрибуты становятся пропсами, их смена перерисовывает;
 * - колбэки из `events` превращаются в CustomEvent на элементе (всплывают через shadow DOM).
 */
export interface ReactElementOptions {
  /** Свойства элемента, которые уходят в пропсы. Атрибут — kebab-case имени. */
  readonly props?: readonly string[];
  /** Колбэк-пропс → тип события: `{ onNavigate: "platform:navigate" }`. */
  readonly events?: Readonly<Record<string, string>>;
  /** Рендер в shadow root (по умолчанию) или прямо в элемент. */
  readonly shadow?: boolean;
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

/** Живые React-руты всех обёрток на странице — для диагностики и тестов на утечки. */
const ROOTS_KEY = Symbol.for("mfe-platform.react-roots");
export const liveReactRoots = (): Set<Root> => {
  const scope = globalThis as unknown as Record<symbol, Set<Root> | undefined>;
  scope[ROOTS_KEY] ??= new Set();
  return scope[ROOTS_KEY];
};

export const defineReactElement = <Props extends object>(
  Component: ComponentType<Props>,
  { props = [], events = {}, shadow = true }: ReactElementOptions = {},
): CustomElementConstructor => {
  const attributeToProp = new Map(props.map((prop) => [kebab(prop), prop]));

  class ReactRemoteElement extends HTMLElement {
    static observedAttributes = [...attributeToProp.keys()];

    #root: Root | null = null;
    #values: Record<string, unknown> = {};

    constructor() {
      super();
      // Свойства, выставленные до апгрейда элемента, не теряются.
      for (const prop of props) {
        if (Object.hasOwn(this, prop)) {
          const value = (this as unknown as Record<string, unknown>)[prop];
          delete (this as unknown as Record<string, unknown>)[prop];
          this.#values[prop] = value;
        }
      }
    }

    connectedCallback() {
      if (!this.#root) {
        const container = shadow ? (this.shadowRoot ?? this.attachShadow({ mode: "open" })) : this;
        this.#root = createRoot(container);
        liveReactRoots().add(this.#root);
      }
      this.#render();
    }

    disconnectedCallback() {
      // На микрозадаче: перенос элемента в том же такте не должен пересоздавать дерево.
      queueMicrotask(() => {
        if (this.isConnected || !this.#root) return;
        const root = this.#root;
        this.#root = null;
        root.unmount();
        liveReactRoots().delete(root);
      });
    }

    attributeChangedCallback(name: string, _previous: string | null, next: string | null) {
      const prop = attributeToProp.get(name);
      if (prop) this.#set(prop, next ?? undefined);
    }

    #set(prop: string, value: unknown) {
      if (Object.is(this.#values[prop], value)) return;
      this.#values[prop] = value;
      this.#render();
    }

    #render() {
      if (!this.#root) return;
      const callbacks = Object.fromEntries(
        Object.entries(events).map(([callback, type]) => [
          callback,
          (detail?: unknown) =>
            this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })),
        ]),
      );
      this.#root.render(createElement(Component, { ...this.#values, ...callbacks } as Props));
    }

    static {
      for (const prop of props) {
        Object.defineProperty(ReactRemoteElement.prototype, prop, {
          configurable: true,
          enumerable: true,
          get(this: ReactRemoteElement) {
            return this.#values[prop];
          },
          set(this: ReactRemoteElement, value: unknown) {
            this.#set(prop, value);
          },
        });
      }
    }
  }

  return ReactRemoteElement;
};

/** Регистрирует обёртку под тегом. Идемпотентна, как требует контракт `register()`. */
export const registerReactElement = (
  tag: string,
  Component: ComponentType<never>,
  options?: ReactElementOptions,
): void => {
  if (customElements.get(tag)) return;
  customElements.define(tag, defineReactElement(Component, options));
};

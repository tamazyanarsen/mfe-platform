import type { PlatformTopics } from "@mfe/contract";

/**
 * Типизированная шина поверх CustomEvent на общем узле. Узел по умолчанию — `document`:
 * у каждого ремоута своя копия этого пакета (Р4), а `document` у всех один.
 */
export interface Bus<Topics> {
  publish<K extends keyof Topics & string>(topic: K, payload: Topics[K]): void;
  /**
   * Подписка до вызова возвращённой функции или до `signal.abort()`. Элементы отписываются
   * в `disconnectedCallback` — для этого удобен `createSubscriptions`.
   */
  subscribe<K extends keyof Topics & string>(
    topic: K,
    handler: (payload: Topics[K]) => void,
    options?: { readonly signal?: AbortSignal },
  ): () => void;
  /** Сколько подписчиков у темы сейчас — для диагностики и тестов на утечки. */
  listenerCount(topic: keyof Topics & string): number;
}

const PREFIX = "mfe-bus:";

/** Счётчики подписчиков по узлам — общие для всех копий пакета на странице. */
const COUNTS_KEY = Symbol.for("mfe-platform.bus.counts");
type Counts = WeakMap<EventTarget, Map<string, number>>;
const countsOf = (target: EventTarget): Map<string, number> => {
  const scope = globalThis as unknown as Record<symbol, Counts | undefined>;
  scope[COUNTS_KEY] ??= new WeakMap();
  const existing = scope[COUNTS_KEY].get(target);
  if (existing) return existing;
  const counts = new Map<string, number>();
  scope[COUNTS_KEY].set(target, counts);
  return counts;
};

export const createBus = <Topics = PlatformTopics>(target: EventTarget = document): Bus<Topics> => {
  const counts = countsOf(target);
  return {
    publish(topic, payload) {
      target.dispatchEvent(new CustomEvent(PREFIX + topic, { detail: payload }));
    },
    subscribe(topic, handler, { signal } = {}) {
      if (signal?.aborted) return () => {};
      const type = PREFIX + topic;
      const listener = (event: Event) => handler((event as CustomEvent).detail);
      let active = true;
      const unsubscribe = () => {
        if (!active) return;
        active = false;
        target.removeEventListener(type, listener);
        signal?.removeEventListener("abort", unsubscribe);
        counts.set(topic, (counts.get(topic) ?? 1) - 1);
      };
      target.addEventListener(type, listener);
      signal?.addEventListener("abort", unsubscribe, { once: true });
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
      return unsubscribe;
    },
    listenerCount: (topic) => counts.get(topic) ?? 0,
  };
};

/**
 * Подписки, живущие ровно столько, сколько подключён элемент:
 *
 *   connectedCallback()    { this.#subs = createSubscriptions(); bus.subscribe(..., this.#subs) }
 *   disconnectedCallback() { this.#subs.dispose() }
 */
export const createSubscriptions = () => {
  const controller = new AbortController();
  return { signal: controller.signal, dispose: () => controller.abort() };
};

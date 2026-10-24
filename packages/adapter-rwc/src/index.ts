import type { Bus } from "@mfe-platform/bus";
import {
  getPlatformRegistry,
  type KitRegistrationResult,
  type TagRegistry,
} from "@mfe-platform/registry";
import { effect, onCleanup, untracked } from "@rwcjs/core";

/** Кит на rwc: регистрирует все свои компоненты с постфиксом (`@rwcjs/ui` и совместимые). */
export interface RwcKit {
  registerAll(options?: { postfix?: string }): void;
}

/** Компонент rwc: после регистрации класс знает свой тег. */
export type RwcComponentClass = CustomElementConstructor & { renderTagName?: string };

export interface UseKitOptions {
  /** Имя пакета кита: "@rwcjs/ui". */
  readonly name: string;
  /** Версия сборки кита, с которой собран ремоут. */
  readonly version: string;
  /** Имя ремоута — для учёта и политик. */
  readonly consumer: string;
  readonly kit: RwcKit;
  /** Контрольный компонент кита, например `Button` из `@rwcjs/ui`. */
  readonly control: RwcComponentClass;
  /** По умолчанию — реестр платформы на странице. */
  readonly registry?: TagRegistry;
}

/**
 * Регистрирует кит ремоута через реестр платформы: постфикс выбирает реестр, теги
 * создаёт кит, результат попадает в учёт. Ремоут вызывает это, а не `registerAll`
 * напрямую — иначе учёт и политики обходятся.
 *
 * Запрет политики или конфликт сборок — исключение: `register()` ремоута падает,
 * и `<mfe-outlet>` показывает fallback вместо полуработающего ремоута.
 */
export const useKit = ({
  name,
  version,
  consumer,
  kit,
  control,
  registry = getPlatformRegistry(),
}: UseKitOptions): KitRegistrationResult & { status: "registered" | "reused" } => {
  const result = registry.registerKit({
    kit: name,
    version,
    consumer,
    control,
    register: (postfix) => {
      kit.registerAll({ postfix });
      return control.renderTagName;
    },
  });
  if (result.status === "denied" || result.status === "conflict") {
    throw new Error(`[mfe] ${consumer}: ${name}@${version} — ${result.reason}`);
  }
  return result;
};

/**
 * Подписка на шину из `render()` компонента rwc: живёт, пока жив компонент, и снимается
 * вместе с его эффектами при отключении от DOM.
 */
export const subscribeInRender = <Topics, K extends keyof Topics & string>(
  bus: Bus<Topics>,
  topic: K,
  handler: (payload: Topics[K]) => void,
): void => {
  effect(() => {
    const unsubscribe = bus.subscribe(topic, (payload) => untracked(() => handler(payload)));
    onCleanup(unsubscribe);
  });
};

import config from "../platform.config.json";

/**
 * Конфигурация хоста: какие ремоуты есть, где их MF-манифесты, что в навигации и на обзоре.
 * Новый ремоут подключается здесь, без изменений в коде хоста.
 */
export interface PlatformConfig {
  readonly remotes: ReadonlyArray<{ readonly name: string; readonly entry: string }>;
  readonly nav: ReadonlyArray<{ readonly href: string; readonly title: string }>;
  /** Ремоуты на странице обзора; basename — их собственный, ссылки ведут на их страницы. */
  readonly overview: ReadonlyArray<{ readonly remote: string; readonly basename: string }>;
}

export const { remotes: REMOTES, nav: NAV, overview: OVERVIEW }: PlatformConfig = config;

/**
 * Навигация: историю браузера пишет только хост. Ремоут внутри своего `basename`
 * навигирует сам, а на чужой маршрут просит хост событием `platform:navigate`.
 */
export const NAVIGATE_EVENT = "platform:navigate";

export interface NavigateDetail {
  /** Абсолютный путь приложения: "/payments/new?from=accounts". */
  readonly to: string;
  readonly replace?: boolean;
}

/** Событие-просьба к хосту. Всплывает и пересекает shadow DOM. */
export const navigateEvent = (to: string, options: { replace?: boolean } = {}) =>
  new CustomEvent<NavigateDetail>(NAVIGATE_EVENT, {
    detail: { to, ...(options.replace ? { replace: true } : {}) },
    bubbles: true,
    composed: true,
  });

/** Атрибут, которым хост передаёт ремоуту префикс его маршрутов. */
export const BASENAME_ATTRIBUTE = "basename";

/**
 * Путь внутри маршрутов ремоута: "/accounts/42" при basename "/accounts" → "/42". null —
 * адрес вне basename: так бывает, когда хост показывает ремоут не на его странице (обзор).
 * Тогда ремоут показывает стартовую страницу, а не сопоставляет чужой путь своим маршрутам.
 */
export const pathInBasename = (basename: string, pathname = location.pathname): string | null => {
  const base = basename.replace(/\/+$/, "");
  if (base === "") return pathname;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  return pathname.slice(base.length) || "/";
};

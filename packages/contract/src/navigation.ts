/**
 * Навигация (Р3): историю браузера пишет только хост. Ремоут внутри своего `basename`
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

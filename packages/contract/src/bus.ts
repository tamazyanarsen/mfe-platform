/**
 * Межмодульное взаимодействие. Темы и нагрузки — типы: несовместимую публикацию
 * ловит компилятор. Потребитель добавляет свои темы слиянием деклараций:
 *
 *   declare module "@mfe-platform/contract" {
 *     interface PlatformTopics { "cards:blocked": { cardId: string } }
 *   }
 */
export interface PlatformTopics {
  /**
   * Анонимная просьба изменить общее состояние: хост не знает, от кого она, и применяет
   * только поля, открытые всем ремоутам. Поля с правами — через `patchEvent` с элемента.
   */
  "store:patch": Partial<PlatformState>;
  /** Пользователь выбрал счёт — его может показать любой ремоут. */
  "account:selected": { readonly accountId: string; readonly title: string };
}

/** Событие-просьба изменить общее состояние, отправленное с элемента ремоута. */
export const PATCH_EVENT = "platform:patch";

/**
 * Просьба к хосту изменить общее состояние: `element.dispatchEvent(patchEvent({ theme }))`.
 * Хост узнаёт по outlet, какой ремоут просит, и применяет только разрешённые ему поля.
 * Всплывает и пересекает shadow DOM.
 */
export const patchEvent = (patch: Partial<PlatformState>) =>
  new CustomEvent<Partial<PlatformState>>(PATCH_EVENT, {
    detail: patch,
    bubbles: true,
    composed: true,
  });

/**
 * Общее состояние платформы. Живёт в хосте; ремоут получает его свойством `platform`
 * на своём элементе (PLATFORM_PROP) и просит изменений событием `patchEvent`.
 */
export interface PlatformState {
  readonly session: { readonly userId: string; readonly name: string } | null;
  /** Выбранный продукт или счёт. */
  readonly selected: { readonly accountId: string; readonly title: string } | null;
  readonly theme: "light" | "dark";
  readonly locale: string;
}

/** Свойство элемента ремоута, в которое хост пишет PlatformState. */
export const PLATFORM_PROP = "platform";

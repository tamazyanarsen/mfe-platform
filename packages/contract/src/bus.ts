/**
 * Межмодульное взаимодействие (A5). Темы и нагрузки — типы: несовместимую публикацию
 * ловит компилятор. Потребитель добавляет свои темы слиянием деклараций:
 *
 *   declare module "@mfe/contract" {
 *     interface PlatformTopics { "cards:blocked": { cardId: string } }
 *   }
 */
export interface PlatformTopics {
  /** Ремоут просит хост изменить общее состояние. */
  "store:patch": Partial<PlatformState>;
  /** Пользователь выбрал счёт — его может показать любой ремоут. */
  "account:selected": { readonly accountId: string; readonly title: string };
}

/**
 * Общее состояние платформы. Живёт в хосте; ремоут получает его свойством `platform`
 * на своём элементе (PLATFORM_PROP) и просит изменений темой `store:patch`.
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

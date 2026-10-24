import { type ObservabilityTransport, PATCH_EVENT, type PlatformState } from "@mfe/contract";

/**
 * Права ремоутов на общее состояние: какой ремоут какие поля стора может менять.
 * Ключ — имя ремоута или `"*"` (все ремоуты и анонимные просьбы через шину), значение —
 * поля. Права складываются: ремоут получает свои поля и поля `"*"`.
 *
 *   { "*": ["selected", "theme", "locale"], "auth": ["session"] }
 *
 * Это защита от ошибок и незаметной связности, а не граница безопасности: ремоуты работают
 * на одной странице, и код ремоута может отправить событие с чужого элемента.
 */
export type StoreAccess = Readonly<Record<string, readonly string[]>>;

/** По умолчанию сессию не меняет никто из ремоутов, остальное — все. */
export const DEFAULT_STORE_ACCESS: StoreAccess = { "*": ["selected", "theme", "locale"] };

export interface FilteredPatch<State> {
  readonly allowed: Partial<State>;
  /** Поля, которые ремоуту менять нельзя. */
  readonly denied: readonly string[];
}

/** Оставляет в patch только поля, разрешённые ремоуту; `remote: null` — анонимная просьба. */
export const filterPatch = <State extends object = PlatformState>(
  access: StoreAccess,
  remote: string | null,
  patch: Partial<State>,
): FilteredPatch<State> => {
  const writable = new Set([...(access["*"] ?? []), ...((remote && access[remote]) || [])]);
  const allowed: Partial<State> = {};
  const denied: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (writable.has(key)) (allowed as Record<string, unknown>)[key] = value;
    else denied.push(key);
  }
  return { allowed, denied };
};

/** Проверяет форму прав из конфигурации хоста. */
export const validateStoreAccess = (value: unknown): string[] => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["storeAccess must map remote names to lists of fields"];
  }
  return Object.entries(value).flatMap(([remote, fields]) =>
    Array.isArray(fields) && fields.every((field) => typeof field === "string")
      ? []
      : [`storeAccess["${remote}"] must be a list of field names`],
  );
};

export interface StorePatchOptions<State> {
  readonly access: StoreAccess;
  /** Тег outlet: по нему хост узнаёт, из какого ремоута пришло событие. */
  readonly outletTag: string;
  /** Применяет разрешённую часть изменения к стору. */
  readonly apply: (patch: Partial<State>, remote: string | null) => void;
  readonly transport?: ObservabilityTransport;
  /** Где слушать события. По умолчанию — document. */
  readonly root?: EventTarget;
}

const remoteOf = (event: Event, outletTag: string): string | null => {
  for (const node of event.composedPath()) {
    if (node instanceof Element && node.localName === outletTag) {
      return node.getAttribute("remote") || null;
    }
  }
  return null;
};

/**
 * Слушает `platform:patch` от элементов ремоутов, определяет ремоут по outlet, применяет
 * разрешённые поля и сообщает о запрещённых событием `store:denied`. Возвращает функцию
 * отключения.
 */
export const listenStorePatches = <State extends object = PlatformState>({
  access,
  outletTag,
  apply,
  transport,
  root = document,
}: StorePatchOptions<State>): (() => void) => {
  const onPatch = (event: Event) => {
    const patch = (event as CustomEvent<Partial<State>>).detail;
    if (typeof patch !== "object" || patch === null) return;
    event.stopPropagation();
    const remote = remoteOf(event, outletTag);
    const { allowed, denied } = filterPatch(access, remote, patch);
    if (denied.length > 0) {
      const name = remote ?? "unknown";
      const reason = `${name} may not change ${denied.join(", ")}`;
      console.warn(`[mfe] store patch denied: ${reason}`);
      transport?.send({
        type: "store:denied",
        time: Date.now(),
        name,
        reason,
        details: { fields: denied },
      });
    }
    if (Object.keys(allowed).length > 0) apply(allowed, remote);
  };
  root.addEventListener(PATCH_EVENT, onPatch);
  return () => root.removeEventListener(PATCH_EVENT, onPatch);
};

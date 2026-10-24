import type { RemoteManifest } from "./manifest";

/**
 * Точки расширения платформы. Ядро объявляет механизм и реализации
 * по умолчанию; внешний код подключается через эти интерфейсы, не меняя ядро.
 */

// ---------------------------------------------------------------- наблюдаемость

export type PlatformEventType =
  | "mount:start"
  | "mount:code-loaded"
  | "mount:ready"
  | "mount:error"
  | "mount:denied"
  | "register:ok"
  | "register:denied"
  | "store:denied"
  | "integrity:denied";

export interface PlatformEvent {
  readonly type: PlatformEventType;
  /** Время события, `Date.now()`. */
  readonly time: number;
  /** Имя ремоута или кита. */
  readonly name: string;
  readonly mountId?: string;
  readonly version?: string;
  readonly route?: string;
  readonly contractVersion?: number;
  /** `manifest.extra` как есть: метаданные потребителя. */
  readonly extra?: Readonly<Record<string, unknown>>;
  /** Длительности в миллисекундах. */
  readonly timings?: Readonly<Record<string, number>>;
  readonly error?: { readonly message: string; readonly stack?: string };
  readonly reason?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Приёмник событий. Ядро везёт консоль и буфер в памяти; другие реализации — снаружи. */
export interface ObservabilityTransport {
  send(event: PlatformEvent): void;
}

// ---------------------------------------------------------------- политики

export type PolicyDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string };

export interface MountContext {
  readonly manifest: RemoteManifest;
  readonly mountId: string;
  readonly route?: string;
}

export interface RegisterContext {
  /** Имя кита или пакета, чьи теги регистрируются. */
  readonly kit: string;
  readonly version: string;
  readonly postfix: string;
  /** Кто регистрирует: имя ремоута. */
  readonly consumer: string;
}

/**
 * Точка, где внешний код может запретить операцию. Ядро не везёт ни одной политики —
 * только механизм: отсутствующий метод означает «разрешено».
 */
export interface PolicyHook {
  beforeMount?(context: MountContext): PolicyDecision | Promise<PolicyDecision>;
  beforeRegister?(context: RegisterContext): PolicyDecision;
}

export const ALLOW: PolicyDecision = { allow: true };

/** Первый запрет побеждает; без хуков — разрешено. */
export const decideMount = async (
  hooks: readonly PolicyHook[],
  context: MountContext,
): Promise<PolicyDecision> => {
  for (const hook of hooks) {
    const decision = (await hook.beforeMount?.(context)) ?? ALLOW;
    if (!decision.allow) return decision;
  }
  return ALLOW;
};

export const decideRegister = (
  hooks: readonly PolicyHook[],
  context: RegisterContext,
): PolicyDecision => {
  for (const hook of hooks) {
    const decision = hook.beforeRegister?.(context) ?? ALLOW;
    if (!decision.allow) return decision;
  }
  return ALLOW;
};

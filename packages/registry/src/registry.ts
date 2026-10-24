import {
  decideRegister,
  type ObservabilityTransport,
  type PolicyHook,
  type RegisterContext,
} from "@mfe/contract";
import { postfixFor } from "./postfix";

/**
 * Версионирующий реестр тегов. Теги создаёт сам кит (`registerAll({ postfix })`), реестр
 * решает, какой постфикс, ведёт учёт и применяет политики. Имя тега реестр не строит —
 * берёт то, что вернул кит.
 */
export interface KitRegistrationRequest {
  /** Имя пакета кита: "@rwcjs/ui". */
  readonly kit: string;
  /** Версия сборки кита, которую везёт потребитель. */
  readonly version: string;
  /** Кто регистрирует: имя ремоута. */
  readonly consumer: string;
  /**
   * Регистрирует весь кит с постфиксом и возвращает фактический тег контрольного
   * компонента — или undefined, если кит его не зарегистрировал.
   */
  readonly register: (postfix: string) => string | undefined;
  /**
   * Класс контрольного компонента этой сборки. Если тег уже занят другим классом, на
   * странице другая сборка кита с тем же постфиксом — это конфликт, а не повторное
   * использование: фабрики этой сборки работать не будут.
   */
  readonly control?: CustomElementConstructor;
}

export type KitRegistrationResult =
  | { readonly status: "registered" | "reused"; readonly postfix: string; readonly tag: string }
  | { readonly status: "denied"; readonly postfix: string; readonly reason: string }
  | { readonly status: "conflict"; readonly postfix: string; readonly reason: string };

export interface KitRecord {
  readonly kit: string;
  readonly postfix: string;
  /** Версия, которая создала набор тегов. */
  readonly version: string;
  readonly controlTag: string;
  /** Потребитель → версия кита, которую он везёт. */
  readonly consumers: ReadonlyMap<string, string>;
}

export interface TagRegistry {
  registerKit(request: KitRegistrationRequest): KitRegistrationResult;
  /** Таблица учёта: кит → постфикс → кто использует. */
  records(): KitRecord[];
  /** Подключает политику регистрации. Возвращает функцию отключения. */
  use(policy: PolicyHook): () => void;
  /** Куда отправлять события регистрации. */
  setTransport(transport: ObservabilityTransport | null): void;
}

interface MutableRecord {
  kit: string;
  postfix: string;
  version: string;
  controlTag: string;
  consumers: Map<string, string>;
}

export const createTagRegistry = (): TagRegistry => {
  const records = new Map<string, MutableRecord>();
  const policies = new Set<PolicyHook>();
  let transport: ObservabilityTransport | null = null;

  const emit = (
    type: "register:ok" | "register:denied",
    context: RegisterContext,
    details: Record<string, unknown>,
  ) =>
    transport?.send({
      type,
      time: Date.now(),
      name: context.kit,
      version: context.version,
      details: { postfix: context.postfix, consumer: context.consumer, ...details },
      ...(typeof details.reason === "string" ? { reason: details.reason } : {}),
    });

  const registerKit = (request: KitRegistrationRequest): KitRegistrationResult => {
    const { kit, version, consumer, control } = request;
    const postfix = postfixFor(kit, version);
    const context: RegisterContext = { kit, version, postfix, consumer };
    const key = `${kit}@${postfix}`;
    const existing = records.get(key);

    const conflict = (reason: string): KitRegistrationResult => {
      emit("register:denied", context, { reason, conflict: true });
      return { status: "conflict", postfix, reason };
    };

    if (existing && customElements.get(existing.controlTag)) {
      if (control && customElements.get(existing.controlTag) !== control) {
        return conflict(
          `${kit} ${postfix} is already registered by another build (${existing.version}); ` +
            `share one build of the kit between remotes on the same ${postfix}`,
        );
      }
      existing.consumers.set(consumer, version);
      emit("register:ok", context, { reused: true, tag: existing.controlTag });
      return { status: "reused", postfix, tag: existing.controlTag };
    }

    const decision = decideRegister([...policies], context);
    if (!decision.allow) {
      emit("register:denied", context, { reason: decision.reason });
      return { status: "denied", postfix, reason: decision.reason };
    }

    const tag = request.register(postfix);
    if (!tag || !customElements.get(tag) || (control && customElements.get(tag) !== control)) {
      return conflict(
        `${kit} ${postfix} could not register its tags: they are taken by another build of the kit`,
      );
    }
    records.set(key, {
      kit,
      postfix,
      version,
      controlTag: tag,
      consumers: new Map([[consumer, version]]),
    });
    emit("register:ok", context, { reused: false, tag });
    return { status: "registered", postfix, tag };
  };

  return {
    registerKit,
    records: () =>
      [...records.values()].map((record) => ({ ...record, consumers: new Map(record.consumers) })),
    use(policy) {
      policies.add(policy);
      return () => policies.delete(policy);
    },
    setTransport(next) {
      transport = next;
    },
  };
};

/**
 * Реестр платформы — один на страницу. У каждого ремоута своя копия этого пакета,
 * поэтому экземпляр живёт в глобальном неймспейсе платформы, а не в модуле.
 */
const GLOBAL_KEY = Symbol.for("mfe-platform.registry");

export const getPlatformRegistry = (): TagRegistry => {
  const scope = globalThis as unknown as Record<symbol, TagRegistry | undefined>;
  scope[GLOBAL_KEY] ??= createTagRegistry();
  return scope[GLOBAL_KEY];
};

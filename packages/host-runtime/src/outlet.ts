import {
  CONTRACT_VERSION,
  decideMount,
  type ObservabilityTransport,
  type PlatformEvent,
  type PolicyHook,
  type RemoteManifest,
  validateManifest,
} from "@mfe-platform/contract";
import type { RemoteLoader } from "./loader";
import { consoleTransport } from "./transports";

export type OutletState = "idle" | "loading" | "ready" | "error" | "denied";

export interface FallbackContext {
  readonly state: "loading" | "error" | "denied";
  readonly remote: string;
  /** Текст ошибки или причина запрета. */
  readonly message?: string;
  /** Только для `error`: повторить загрузку — то же, что `outlet.retry()`. */
  readonly retry?: () => void;
}

export interface OutletOptions {
  readonly loader: RemoteLoader;
  /** Политики монтирования. Ядро не везёт ни одной. */
  readonly policies?: readonly PolicyHook[];
  readonly transport?: ObservabilityTransport;
  /** Версии контракта, которые понимает хост. */
  readonly contractVersions?: readonly number[];
  /** Своё содержимое для состояний загрузки, ошибки и запрета. */
  readonly renderFallback?: (context: FallbackContext) => Node;
}

/** Событие на outlet при каждой смене состояния; не всплывает. */
export const OUTLET_STATE_EVENT = "mfe-outlet-state";

export interface OutletStateDetail {
  readonly state: OutletState;
  readonly remote: string;
  readonly mountId?: string;
}

export type MfeOutletElement = HTMLElement & {
  remote: string;
  basename: string;
  /** Вход ремоута: ключи пишутся свойствами на его элемент. */
  props: Readonly<Record<string, unknown>>;
  readonly state: OutletState;
  readonly mountId: string | undefined;
  /** Элемент ремоута, когда он смонтирован. */
  readonly remoteElement: HTMLElement | null;
  /** После ошибки загружает ремоут заново; в остальных состояниях ничего не делает. */
  retry(): void;
};

const defaultFallback = ({ state, remote, message, retry }: FallbackContext): Node => {
  const element = document.createElement("div");
  element.setAttribute("role", state === "loading" ? "status" : "alert");
  element.textContent =
    state === "loading"
      ? `Loading ${remote}…`
      : state === "denied"
        ? `${remote} is not allowed here: ${message ?? ""}`
        : `${remote} is unavailable`;
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Retry";
    button.addEventListener("click", retry);
    element.append(" ", button);
  }
  return element;
};

const errorInfo = (error: unknown) =>
  error instanceof Error
    ? { message: error.message, ...(error.stack ? { stack: error.stack } : {}) }
    : { message: String(error) };

let mountCounter = 0;
const nextMountId = (remote: string) =>
  `${remote}-${Date.now().toString(36)}-${(++mountCounter).toString(36)}`;

/**
 * Объявляет загрузчик ремоутов под тегом `tag`. Элемент грузит ремоут по атрибуту
 * `remote`, проверяет манифест и политики, вызывает `register()` и монтирует элемент
 * `manifest.tag`. Падение загрузки остаётся внутри outlet: показывается fallback.
 *
 * Shadow DOM у outlet нет: ремоут живёт в light DOM, события из него всплывают как есть.
 */
export const defineMfeOutlet = (options: OutletOptions, tag = "mfe-outlet"): string => {
  const existing = customElements.get(tag);
  if (existing) return tag;

  const transport = options.transport ?? consoleTransport;
  const policies = options.policies ?? [];
  const contractVersions = options.contractVersions ?? [CONTRACT_VERSION];
  const renderFallback = options.renderFallback ?? defaultFallback;

  class MfeOutlet extends HTMLElement {
    static observedAttributes = ["remote", "basename"];

    #state: OutletState = "idle";
    #props: Readonly<Record<string, unknown>> = {};
    #remoteElement: HTMLElement | null = null;
    #mountId: string | undefined;
    /** Номер текущей загрузки: ответы устаревших загрузок игнорируются. */
    #generation = 0;
    #loaded: string | null = null;

    get remote(): string {
      return this.getAttribute("remote") ?? "";
    }

    set remote(value: string) {
      this.setAttribute("remote", value);
    }

    /** Префикс маршрутов ремоута; уходит ему атрибутом `basename`. */
    get basename(): string {
      return this.getAttribute("basename") ?? "";
    }

    set basename(value: string) {
      this.setAttribute("basename", value);
    }

    get props(): Readonly<Record<string, unknown>> {
      return this.#props;
    }

    set props(value: Readonly<Record<string, unknown>>) {
      this.#props = value;
      if (this.#remoteElement) applyProps(this.#remoteElement, value);
    }

    get state(): OutletState {
      return this.#state;
    }

    get mountId(): string | undefined {
      return this.#mountId;
    }

    get remoteElement(): HTMLElement | null {
      return this.#remoteElement;
    }

    retry() {
      if (this.#state === "error" && this.remote && this.isConnected) void this.#mount(this.remote);
    }

    connectedCallback() {
      if (this.remote && this.#loaded !== this.remote) void this.#mount(this.remote);
    }

    attributeChangedCallback(name: string, previous: string | null, next: string | null) {
      if (previous === next) return;
      if (name === "basename") {
        if (this.#remoteElement) setBasename(this.#remoteElement, next);
        return;
      }
      if (!this.isConnected) {
        // Смонтируется при подключении; снятый remote убирает ремоут сразу, иначе при
        // возвращении в DOM outlet показал бы старый.
        if (!next && this.#loaded !== null) this.#reset();
        return;
      }
      if (next) void this.#mount(next);
      else this.#reset();
    }

    #reset() {
      this.#generation++;
      this.#loaded = null;
      this.#remoteElement = null;
      this.#mountId = undefined;
      this.replaceChildren();
      this.#setState("idle", "");
    }

    async #mount(remote: string) {
      const generation = ++this.#generation;
      const stale = () => generation !== this.#generation;
      const mountId = nextMountId(remote);
      const started = performance.now();
      let manifest: RemoteManifest | undefined;

      this.#loaded = remote;
      this.#mountId = mountId;
      this.#remoteElement = null;
      this.replaceChildren(renderFallback({ state: "loading", remote }));
      this.#setState("loading", remote);

      const route = location.pathname;
      const emit = (event: Omit<PlatformEvent, "time" | "name" | "mountId" | "route">) =>
        transport.send({
          time: Date.now(),
          name: remote,
          mountId,
          route,
          ...(manifest
            ? {
                contractVersion: manifest.contractVersion,
                ...(manifest.version ? { version: manifest.version } : {}),
                ...(manifest.extra ? { extra: manifest.extra } : {}),
              }
            : {}),
          ...event,
        });

      emit({ type: "mount:start" });

      try {
        const loadedManifest = await options.loader.loadManifest(remote);
        if (stale()) return;
        const problems = validateManifest(loadedManifest);
        if (problems.length > 0) {
          throw new Error(`invalid manifest of "${remote}": ${problems.join("; ")}`);
        }
        manifest = loadedManifest;
        if (!contractVersions.includes(manifest.contractVersion)) {
          throw new Error(
            `"${remote}" uses contract version ${manifest.contractVersion}, host supports ${contractVersions.join(", ")}`,
          );
        }

        const decision = await decideMount(policies, { manifest, mountId });
        if (stale()) return;
        if (!decision.allow) {
          this.replaceChildren(
            renderFallback({ state: "denied", remote, message: decision.reason }),
          );
          this.#setState("denied", remote);
          emit({ type: "mount:denied", reason: decision.reason });
          return;
        }

        const codeStarted = performance.now();
        const module = await options.loader.loadModule(remote);
        if (stale()) return;
        const codeLoaded = performance.now() - codeStarted;
        emit({ type: "mount:code-loaded", timings: { codeLoad: codeLoaded } });

        if (module.manifest.tag !== manifest.tag) {
          throw new Error(
            `"${remote}" entry declares tag "${module.manifest.tag}", manifest says "${manifest.tag}"`,
          );
        }
        await module.register();
        if (stale()) return;
        if (!customElements.get(manifest.tag)) {
          throw new Error(`"${remote}" register() did not define <${manifest.tag}>`);
        }

        const element = document.createElement(manifest.tag);
        setBasename(element, this.getAttribute("basename"));
        applyProps(element, this.#props);
        this.#remoteElement = element;
        const renderError = captureErrors(() => this.replaceChildren(element));
        if (renderError !== undefined) throw new RenderError(renderError);
        this.#setState("ready", remote);

        // Время до первого кадра с ремоутом: от решения показать его до отрисовки.
        const codeLoad = codeLoaded;
        afterNextFrame(() => {
          if (stale()) return;
          emit({
            type: "mount:ready",
            timings: { codeLoad, firstFrame: performance.now() - started },
          });
        });
      } catch (error) {
        if (stale()) return;
        this.#loaded = null;
        this.#remoteElement = null;
        const phase = error instanceof RenderError ? "render" : "load";
        const info = errorInfo(error instanceof RenderError ? error.cause : error);
        this.replaceChildren(
          renderFallback({
            state: "error",
            remote,
            message: info.message,
            retry: () => this.retry(),
          }),
        );
        this.#setState("error", remote);
        emit({ type: "mount:error", error: info, details: { phase } });
      }
    }

    #setState(state: OutletState, remote: string) {
      this.#state = state;
      this.setAttribute("state", state);
      const detail: OutletStateDetail = {
        state,
        remote,
        ...(this.#mountId ? { mountId: this.#mountId } : {}),
      };
      this.dispatchEvent(new CustomEvent(OUTLET_STATE_EVENT, { detail }));
    }
  }

  customElements.define(tag, MfeOutlet);
  return tag;
};

/** Исключение при отрисовке ремоута, а не при загрузке его кода. */
class RenderError extends Error {
  constructor(override readonly cause: unknown) {
    super("remote failed to render");
  }
}

/**
 * Выполняет вставку элемента и возвращает ошибку его отрисовки. Исключение из
 * connectedCallback браузер не пробрасывает вызывающему коду, а сообщает событием `error`
 * на window — ловим оба пути. Перехваченная ошибка не всплывает как «Uncaught»: она уходит
 * в транспорт наблюдаемости.
 */
const captureErrors = (insert: () => void): unknown => {
  let captured: unknown;
  const onError = (event: ErrorEvent) => {
    if (captured !== undefined) return;
    captured = event.error ?? new Error(event.message);
    event.preventDefault();
  };
  addEventListener("error", onError);
  try {
    insert();
  } catch (error) {
    captured ??= error;
  } finally {
    removeEventListener("error", onError);
  }
  return captured;
};

const afterNextFrame = (callback: () => void) =>
  requestAnimationFrame(() => requestAnimationFrame(callback));

const setBasename = (element: HTMLElement, basename: string | null) => {
  if (basename === null) element.removeAttribute("basename");
  else element.setAttribute("basename", basename);
};

const applyProps = (element: HTMLElement, props: Readonly<Record<string, unknown>>) => {
  for (const [key, value] of Object.entries(props)) {
    (element as unknown as Record<string, unknown>)[key] = value;
  }
};

/** Ждёт, пока outlet придёт в одно из состояний. Удобно в тестах и при оркестрации. */
export const whenOutletSettles = (
  outlet: MfeOutletElement,
  states: readonly OutletState[] = ["ready", "error", "denied"],
): Promise<OutletState> =>
  states.includes(outlet.state)
    ? Promise.resolve(outlet.state)
    : new Promise((resolve) => {
        const listener = (event: Event) => {
          const { state } = (event as CustomEvent<OutletStateDetail>).detail;
          if (!states.includes(state)) return;
          outlet.removeEventListener(OUTLET_STATE_EVENT, listener);
          resolve(state);
        };
        outlet.addEventListener(OUTLET_STATE_EVENT, listener);
      });

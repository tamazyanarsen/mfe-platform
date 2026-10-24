import type { ObservabilityTransport, PlatformEvent } from "@mfe-platform/contract";
import { getPlatformRegistry, type KitRecord } from "@mfe-platform/registry";

/**
 * Панель отладки платформы прямо на странице: какие ремоуты смонтированы, их версии,
 * состояния и время загрузки, какие версии UI-кита зарегистрированы и кем, последние ошибки,
 * действующие подмены адресов. Данные берутся из событий ядра и реестра — сети нет.
 *
 * Подключение — как ещё один транспорт наблюдаемости:
 *
 *   const devtools = createDevtools();
 *   defineMfeOutlet({ loader, transport: combineTransports(consoleTransport, devtools.transport) });
 *
 * Открывается `devtools.open()` или сочетанием Alt+Shift+D.
 */

export type RemoteStateName = "loading" | "ready" | "error" | "denied";

export interface RemoteStatus {
  readonly name: string;
  readonly state: RemoteStateName;
  readonly version?: string;
  readonly route?: string;
  /** Загрузка кода последнего монтирования, мс. */
  readonly codeLoad?: number;
  /** От решения показать ремоут до первого кадра, мс. */
  readonly firstFrame?: number;
  readonly mounts: number;
  readonly errors: number;
  /** Последняя ошибка или причина запрета. */
  readonly message?: string;
}

export interface DevtoolsError {
  readonly time: number;
  readonly name: string;
  readonly message: string;
}

export interface DevtoolsOptions {
  /** Откуда брать учёт китов. По умолчанию — реестр платформы на странице. */
  readonly registry?: { records(): KitRecord[] };
  /** Действующие подмены адресов ремоутов — показываются отдельным блоком. */
  readonly overrides?: ReadonlyArray<{
    readonly name: string;
    readonly entry: string;
    /** Ремоута нет в конфигурации — подмена его добавила. */
    readonly added?: boolean;
  }>;
  /** Сочетание клавиш для открытия; `null` — без сочетания. По умолчанию Alt+Shift+D. */
  readonly hotkey?: ((event: KeyboardEvent) => boolean) | null;
  /** Тег элемента панели. */
  readonly tag?: string;
}

export interface Devtools {
  /** Транспорт наблюдаемости, из которого панель узнаёт о ремоутах. */
  readonly transport: ObservabilityTransport;
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  toggle(): void;
  remotes(): RemoteStatus[];
  errors(): DevtoolsError[];
  /** Закрывает панель и снимает сочетание клавиш. */
  dispose(): void;
}

const MAX_ERRORS = 20;

const defaultHotkey = (event: KeyboardEvent) =>
  event.altKey && event.shiftKey && event.code === "KeyD";

const STYLES = `
  :host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
    width: min(640px, calc(100vw - 32px)); max-height: 60vh; overflow: auto;
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #e5e7eb;
    background: #111827; border: 1px solid #374151; border-radius: 8px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.3) }
  header { display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px; border-bottom: 1px solid #374151; font-weight: 600 }
  button { font: inherit; color: inherit; background: none; border: 1px solid #4b5563;
    border-radius: 4px; cursor: pointer; padding: 0 6px }
  section { padding: 8px 12px }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af;
    margin: 0 0 4px }
  table { width: 100%; border-collapse: collapse }
  th, td { text-align: left; padding: 2px 8px 2px 0; vertical-align: top }
  th { color: #9ca3af; font-weight: 400 }
  [data-state="ready"] { color: #34d399 } [data-state="loading"] { color: #fbbf24 }
  [data-state="error"], [data-state="denied"] { color: #f87171 }
  .empty { color: #6b7280 }
`;

/** Элемент с текстом: данные вставляются только как текст, не как разметка. */
const el = (tag: string, text?: string | number, attrs: Record<string, string> = {}) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
};

const ms = (value: number | undefined) => (value === undefined ? "—" : `${Math.round(value)} ms`);

const table = (headers: readonly string[], rows: ReadonlyArray<readonly Node[]>) => {
  const result = el("table");
  const head = el("tr");
  for (const header of headers) head.append(el("th", header));
  result.append(head);
  for (const cells of rows) {
    const row = el("tr");
    for (const cell of cells) {
      const td = el("td");
      td.append(cell);
      row.append(td);
    }
    result.append(row);
  }
  return result;
};

const text = (value: string | number) => document.createTextNode(String(value));

export const createDevtools = ({
  registry = getPlatformRegistry(),
  overrides = [],
  hotkey = defaultHotkey,
  tag = "mfe-devtools",
}: DevtoolsOptions = {}): Devtools => {
  const remotes = new Map<string, RemoteStatus>();
  const errors: DevtoolsError[] = [];

  if (!customElements.get(tag)) customElements.define(tag, class extends HTMLElement {});
  const element = document.createElement(tag);
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", "MFE devtools");
  const shadow = element.attachShadow({ mode: "open" });

  const update = (name: string, patch: Partial<RemoteStatus>) => {
    const current: RemoteStatus = remotes.get(name) ?? {
      name,
      state: "loading",
      mounts: 0,
      errors: 0,
    };
    remotes.set(name, { ...current, ...patch });
  };

  const apply = (event: PlatformEvent) => {
    const base = {
      ...(event.version ? { version: event.version } : {}),
      ...(event.route ? { route: event.route } : {}),
    };
    const current = remotes.get(event.name);
    switch (event.type) {
      case "mount:start": {
        const {
          codeLoad: _codeLoad,
          firstFrame: _firstFrame,
          message: _message,
          ...rest
        } = current ?? { name: event.name, state: "loading" as const, mounts: 0, errors: 0 };
        remotes.set(event.name, { ...rest, ...base, state: "loading", mounts: rest.mounts + 1 });
        return;
      }
      case "mount:code-loaded":
        update(event.name, { ...base, ...pick(event.timings?.codeLoad, "codeLoad") });
        return;
      case "mount:ready":
        update(event.name, {
          ...base,
          state: "ready",
          ...pick(event.timings?.codeLoad, "codeLoad"),
          ...pick(event.timings?.firstFrame, "firstFrame"),
        });
        return;
      case "mount:error":
      case "mount:denied": {
        const message = event.error?.message ?? event.reason ?? event.type;
        update(event.name, {
          ...base,
          state: event.type === "mount:error" ? "error" : "denied",
          errors: (current?.errors ?? 0) + 1,
          message,
        });
        errors.unshift({ time: event.time, name: event.name, message });
        errors.length = Math.min(errors.length, MAX_ERRORS);
        return;
      }
      case "register:denied":
      case "store:denied":
      case "integrity:denied":
        errors.unshift({ time: event.time, name: event.name, message: event.reason ?? "denied" });
        errors.length = Math.min(errors.length, MAX_ERRORS);
        return;
      default:
        return;
    }
  };

  const render = () => {
    const header = el("header", "MFE devtools");
    const close = el("button", "×", { type: "button", "aria-label": "Close" });
    close.addEventListener("click", () => devtools.close());
    header.append(close);

    const remoteRows = [...remotes.values()].map((remote) => [
      text(remote.name),
      el("span", remote.state, { "data-state": remote.state }),
      text(remote.version ?? "—"),
      text(ms(remote.codeLoad)),
      text(ms(remote.firstFrame)),
      text(`${remote.mounts} / ${remote.errors}`),
    ]);
    const kitRows = registry
      .records()
      .map((record) => [
        text(record.kit),
        text(record.postfix),
        text(record.version),
        text([...record.consumers].map(([consumer, v]) => `${consumer}@${v}`).join(", ")),
      ]);

    const section = (title: string, body: Node | null, empty: string) => {
      const node = el("section");
      node.append(el("h2", title), body ?? el("div", empty, { class: "empty" }));
      return node;
    };

    shadow.replaceChildren(
      el("style", STYLES),
      header,
      section(
        "Remotes",
        remoteRows.length
          ? table(
              ["name", "state", "version", "code", "first frame", "mounts / errors"],
              remoteRows,
            )
          : null,
        "no remotes mounted yet",
      ),
      section(
        "UI kits",
        kitRows.length ? table(["kit", "postfix", "version", "consumers"], kitRows) : null,
        "no kits registered",
      ),
      ...(overrides.length
        ? [
            section(
              "Overrides",
              table(
                ["remote", "entry"],
                overrides.map(({ name, entry, added }) => [
                  text(added ? `${name} (new)` : name),
                  text(entry),
                ]),
              ),
              "",
            ),
          ]
        : []),
      section(
        "Recent errors",
        errors.length
          ? table(
              ["time", "name", "message"],
              errors.map((error) => [
                text(new Date(error.time).toLocaleTimeString()),
                text(error.name),
                text(error.message),
              ]),
            )
          : null,
        "no errors",
      ),
    );
  };

  // Несколько событий подряд — одна перерисовка.
  let scheduled = false;
  const scheduleRender = () => {
    if (scheduled || !element.isConnected) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (element.isConnected) render();
    });
  };

  const onKey = (event: KeyboardEvent) => {
    if (hotkey?.(event)) {
      event.preventDefault();
      devtools.toggle();
    }
  };
  if (hotkey) addEventListener("keydown", onKey);

  const devtools: Devtools = {
    transport: {
      send(event) {
        apply(event);
        scheduleRender();
      },
    },
    element,
    get isOpen() {
      return element.isConnected;
    },
    open() {
      if (element.isConnected) return;
      render();
      document.body.append(element);
    },
    close() {
      element.remove();
    },
    toggle() {
      if (element.isConnected) devtools.close();
      else devtools.open();
    },
    remotes: () => [...remotes.values()],
    errors: () => [...errors],
    dispose() {
      devtools.close();
      removeEventListener("keydown", onKey);
    },
  };
  return devtools;
};

const pick = <K extends string>(value: number | undefined, key: K) =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, number>>;

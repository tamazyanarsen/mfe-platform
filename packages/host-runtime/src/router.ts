import { NAVIGATE_EVENT, type NavigateDetail, type RemoteManifest } from "@mfe/contract";

/**
 * Роутер хоста: таблица маршрутов из манифестов и единственный владелец истории.
 *
 * Паттерны манифеста — точные пути ("/accounts") и префиксы ("/accounts/*"). Внутренние
 * параметры ремоут разбирает своим роутером относительно `basename`.
 */
export interface RouteMatch {
  readonly remote: string;
  /** Префикс маршрутов ремоута: паттерн без хвоста "/*". */
  readonly basename: string;
  readonly pattern: string;
}

interface RouteEntry extends RouteMatch {
  readonly prefix: boolean;
}

const normalize = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);

export interface RouteConflict {
  readonly pattern: string;
  /** Ремоуты в порядке манифестов; маршрут достаётся первому. */
  readonly remotes: readonly string[];
}

export interface RouteTable {
  resolve(path: string): RouteMatch | null;
  readonly entries: readonly RouteMatch[];
  /** Паттерны, которые заявили несколько ремоутов. */
  readonly conflicts: readonly RouteConflict[];
}

export const createRouteTable = (manifests: readonly RemoteManifest[]): RouteTable => {
  const entries: RouteEntry[] = manifests.flatMap((manifest) =>
    manifest.routes.map((pattern) => {
      const prefix = pattern.endsWith("/*");
      const basename = normalize(prefix ? pattern.slice(0, -2) || "/" : pattern);
      return { remote: manifest.name, basename, pattern, prefix };
    }),
  );
  const owners = new Map<string, string[]>();
  for (const { pattern, remote } of entries) {
    const remotes = owners.get(pattern) ?? [];
    if (!remotes.includes(remote)) remotes.push(remote);
    owners.set(pattern, remotes);
  }
  const conflicts = [...owners]
    .filter(([, remotes]) => remotes.length > 1)
    .map(([pattern, remotes]) => ({ pattern, remotes }));

  // Самый длинный префикс побеждает; точное совпадение — раньше префиксного той же длины.
  // Сортировка устойчивая: при конфликте маршрут остаётся за ремоутом, чей манифест раньше.
  entries.sort(
    (a, b) => b.basename.length - a.basename.length || Number(a.prefix) - Number(b.prefix),
  );

  return {
    entries,
    conflicts,
    resolve(rawPath) {
      const path = normalize(rawPath);
      const entry = entries.find(({ basename, prefix }) =>
        prefix
          ? path === basename || path.startsWith(basename === "/" ? "/" : `${basename}/`)
          : path === basename,
      );
      return entry
        ? { remote: entry.remote, basename: entry.basename, pattern: entry.pattern }
        : null;
    },
  };
};

export interface HostRouterOptions {
  readonly table: RouteTable;
  /** Вызывается при старте и после каждой смены адреса; `match` — null для чужого пути. */
  readonly onRoute: (match: RouteMatch | null, path: string) => void;
  /** Где слушать `platform:navigate`. По умолчанию — document. */
  readonly eventTarget?: EventTarget;
}

export interface HostRouter {
  /**
   * Подписывается на историю и сообщает текущий маршрут. Отдельно от создания, чтобы
   * `onRoute` мог обращаться к уже созданному роутеру (например, редиректить).
   */
  start(): HostRouter;
  navigate(to: string, options?: { replace?: boolean }): void;
  readonly current: RouteMatch | null;
  dispose(): void;
}

export const createHostRouter = ({
  table,
  onRoute,
  eventTarget = document,
}: HostRouterOptions): HostRouter => {
  let current: RouteMatch | null = null;

  const sync = () => {
    const path = location.pathname;
    current = table.resolve(path);
    onRoute(current, path);
  };

  /** Пока хост пишет историю сам, перехваченные pushState/replaceState не синхронизируют. */
  let writing = false;

  const navigate = (to: string, { replace = false } = {}) => {
    const url = new URL(to, location.href);
    if (url.origin !== location.origin) {
      // Наружу — только http(s): `javascript:` и `data:` из события ремоута исполнились бы
      // в контексте хоста.
      if (url.protocol === "http:" || url.protocol === "https:") location.assign(url.href);
      else console.warn(`[mfe] navigation to "${url.protocol}" URL is blocked`);
      return;
    }
    if (url.href === location.href) return;
    writing = true;
    try {
      if (replace) history.replaceState(history.state, "", url.href);
      else history.pushState(null, "", url.href);
    } finally {
      writing = false;
    }
    // Роутеры ремоутов узнают о смене адреса так же, как о кнопке «назад»: из popstate.
    // Хост слушает то же событие, поэтому sync вызовется ровно один раз.
    dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  };

  const onNavigate = (event: Event) => {
    const detail = (event as CustomEvent<NavigateDetail>).detail;
    if (!detail || typeof detail.to !== "string") return;
    event.stopPropagation();
    navigate(detail.to, detail.replace ? { replace: true } : {});
  };

  /**
   * Роутер ремоута внутри своего basename пишет историю сам. Хост перехватывает эти
   * записи и пересчитывает маршрут: иначе переход из ремоута, показанного не на своей
   * странице (обзор), оставил бы хост на старом маршруте.
   */
  type HistoryWrite = History["pushState"];
  const patched: Array<
    [key: "pushState" | "replaceState", wrapper: HistoryWrite, original: HistoryWrite]
  > = [];
  const observeHistory = () => {
    for (const key of ["pushState", "replaceState"] as const) {
      const original = history[key];
      const wrapper: HistoryWrite = function (this: History, ...args) {
        original.apply(this, args);
        if (!writing) sync();
      };
      history[key] = wrapper;
      patched.push([key, wrapper, original]);
    }
    return () => {
      for (const [key, wrapper, original] of patched.splice(0)) {
        // Если поверх нас кто-то обернул историю ещё раз, его обёртку не трогаем.
        if (history[key] === wrapper) history[key] = original;
      }
    };
  };

  let started = false;
  let unobserve = () => {};

  const router: HostRouter = {
    start() {
      if (started) return router;
      started = true;
      addEventListener("popstate", sync);
      eventTarget.addEventListener(NAVIGATE_EVENT, onNavigate);
      unobserve = observeHistory();
      sync();
      return router;
    },
    navigate,
    get current() {
      return current;
    },
    dispose() {
      started = false;
      unobserve();
      removeEventListener("popstate", sync);
      eventTarget.removeEventListener(NAVIGATE_EVENT, onNavigate);
    },
  };
  return router;
};

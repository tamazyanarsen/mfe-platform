import type { RemoteLoader } from "./loader";
import type { HostRouter, RouteTable } from "./router";

/**
 * Предзагрузка кода ремоута: вызвать, когда переход на `path` вероятен (наведение на ссылку).
 * Код загружается один раз, `register()` не вызывается — элемент создаст outlet при переходе.
 * Ошибки глотаются: упавшая предзагрузка не должна мешать обычной загрузке.
 */
export const createPrefetcher = ({
  table,
  loader,
}: {
  /** Таблица маршрутов или функция, отдающая текущую, если таблица меняется. */
  table: RouteTable | (() => RouteTable);
  loader: RemoteLoader;
}) => {
  const started = new Set<string>();
  const current = typeof table === "function" ? table : () => table;
  return (path: string): Promise<void> => {
    const remote = current().resolve(path)?.remote;
    if (!remote || started.has(remote)) return Promise.resolve();
    started.add(remote);
    return loader.loadModule(remote).then(
      () => {},
      () => {
        // Следующее наведение попробует снова: загрузчик не кеширует упавшие загрузки.
        started.delete(remote);
      },
    );
  };
};

export interface InterceptLinksOptions {
  readonly router: HostRouter;
  /** Где слушать клики. По умолчанию — document: ловятся и ссылки из shadow DOM ремоутов. */
  readonly root?: EventTarget;
  /** Вызывается при наведении и фокусе на внутренней ссылке. */
  readonly prefetch?: (path: string) => unknown;
}

const anchorOf = (event: Event): HTMLAnchorElement | null => {
  // composedPath видит сквозь shadow DOM: event.target на document уже перенацелен на хост.
  for (const node of event.composedPath()) {
    if (node instanceof HTMLAnchorElement && node.hasAttribute("href")) return node;
  }
  return null;
};

/** Ссылка, переход по которой хост может сделать сам, без перезагрузки страницы. */
const internalUrl = (anchor: HTMLAnchorElement): URL | null => {
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  const rel = (anchor.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
  if (rel.includes("external") || anchor.hasAttribute("data-mfe-reload")) return null;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin) return null;
  return url;
};

/**
 * Обычные `<a href>` внутри ремоутов и хоста ведут через роутер хоста, без перезагрузки.
 * Не трогает ссылки, которые уже обработал роутер ремоута (`preventDefault`), клики с
 * модификаторами, `target`, `download`, `rel="external"`, `data-mfe-reload`, чужой origin и
 * переходы по якорю на той же странице.
 *
 * Возвращает функцию отключения.
 */
export const interceptLinks = ({
  router,
  root = document,
  prefetch,
}: InterceptLinksOptions): (() => void) => {
  const onClick = (event: Event) => {
    const mouse = event as MouseEvent;
    if (mouse.defaultPrevented || mouse.button !== 0) return;
    if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return;
    const anchor = anchorOf(event);
    const url = anchor && internalUrl(anchor);
    if (!url) return;
    // Якорь на той же странице прокручивает браузер.
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    event.preventDefault();
    router.navigate(url.pathname + url.search + url.hash);
  };

  const onIntent = (event: Event) => {
    const anchor = anchorOf(event);
    const url = anchor && internalUrl(anchor);
    if (url) prefetch?.(url.pathname);
  };

  root.addEventListener("click", onClick);
  if (prefetch) {
    root.addEventListener("pointerover", onIntent);
    root.addEventListener("focusin", onIntent);
  }
  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("pointerover", onIntent);
    root.removeEventListener("focusin", onIntent);
  };
};

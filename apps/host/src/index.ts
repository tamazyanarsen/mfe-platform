import "./styles.css";
import { createBus, createStore } from "@mfe-platform/bus";
import { PLATFORM_PROP, type PlatformState } from "@mfe-platform/contract";
import { createDevtools } from "@mfe-platform/devtools";
import {
  applyRemoteOverrides,
  combineTransports,
  consoleTransport,
  createFederationLoader,
  createHostRouter,
  createIntegrityPlugin,
  createManifestSet,
  createMemoryTransport,
  createPrefetcher,
  createRouteTable,
  DEFAULT_STORE_ACCESS,
  defineMfeOutlet,
  type FallbackContext,
  filterPatch,
  interceptLinks,
  listenStorePatches,
  type MfeOutletElement,
  normalizeBase,
  type RouteMatch,
  withBase,
} from "@mfe-platform/host-runtime";
import { getPlatformRegistry } from "@mfe-platform/registry";
import { loadRemote, registerPlugins, registerRemotes } from "@module-federation/enhanced/runtime";
import { loadPlatformConfig, type PlatformConfig } from "./remotes";

// ---------------------------------------------------------------- конфигурация

// Префикс пути хоста (server.base в rsbuild.config.ts). Конфигурация, манифесты и навигация
// ремоутов работают с путями приложения ("/accounts"), префикс добавляет хост.
const base = normalizeBase(import.meta.env.BASE_URL);
const href = (path: string) => withBase(base, path);

let config: PlatformConfig;
try {
  config = await loadPlatformConfig();
} catch (error) {
  const alert = document.createElement("div");
  alert.className = "status status-error";
  alert.setAttribute("role", "alert");
  alert.textContent = "Конфигурация платформы недоступна. Попробуйте обновить страницу позже.";
  document.body.append(alert);
  throw error;
}

// Подмена адресов ремоутов для разработки: ?mfe-override=payments=http://localhost:3002/...
const { remotes, overridden } = applyRemoteOverrides(config.remotes);

const fallback = ({ state, remote, message, retry }: FallbackContext): Node => {
  const element = document.createElement("div");
  element.className = `status status-${state}`;
  element.setAttribute("role", state === "loading" ? "status" : "alert");
  element.textContent =
    state === "loading"
      ? "Загрузка модуля…"
      : state === "denied"
        ? `Модуль «${remote}» запрещён: ${message}`
        : "Модуль недоступен.";
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Повторить";
    button.addEventListener("click", retry);
    element.append(" ", button);
  }
  return element;
};

// ---------------------------------------------------------------- наблюдаемость

// Наблюдаемость по умолчанию: консоль и кольцевой буфер в памяти (наружу ничего). Панель
// отладки включена в dev-сборке; на стенде и в проде — параметром ?mfe-devtools.
const DEVTOOLS_KEY = "mfe-platform.devtools";
const devtoolsRequested = new URLSearchParams(location.search).has("mfe-devtools");
const devtoolsEnabled = (() => {
  try {
    if (devtoolsRequested) sessionStorage.setItem(DEVTOOLS_KEY, "1");
    return import.meta.env.DEV || sessionStorage.getItem(DEVTOOLS_KEY) === "1";
  } catch {
    return import.meta.env.DEV || devtoolsRequested;
  }
})();
const devtools = devtoolsEnabled ? createDevtools({ overrides: overridden }) : null;

const events = createMemoryTransport(500);
const transport = combineTransports(
  consoleTransport,
  events,
  ...(devtools ? [devtools.transport] : []),
);

// Ремоуты с integrity в конфигурации проверяются: манифест, remoteEntry и их чанки.
registerPlugins([
  createIntegrityPlugin({
    remotes,
    onViolation: (remote, reason) => {
      console.error(`[host] integrity: ${remote}: ${reason}`);
      transport.send({ type: "integrity:denied", time: Date.now(), name: remote, reason });
    },
  }),
]);
registerRemotes(remotes.map(({ name, entry }) => ({ name, entry })));
const loader = createFederationLoader(loadRemote);
const outletTag = defineMfeOutlet({ loader, renderFallback: fallback, transport });

// ---------------------------------------------------------------- общее состояние

// Стор живёт в хосте. Ремоуты получают состояние свойством `platform` своего элемента и
// просят изменений событием platform:patch со своего элемента — без общего рантайма и без
// привязки к фреймворку. Что какой ремоут может менять — storeAccess в конфигурации.
const store = createStore<PlatformState>({
  session: { userId: "u-1", name: "Анна Иванова" },
  selected: null,
  theme: "light",
  locale: "ru-RU",
});
const storeAccess = config.storeAccess ?? DEFAULT_STORE_ACCESS;
listenStorePatches<PlatformState>({
  access: storeAccess,
  outletTag,
  apply: (patch) => store.set(patch),
  transport,
});

const bus = createBus();
// Просьба через шину анонимна: хост не знает, от кого она, и применяет только общие поля.
bus.subscribe("store:patch", (patch) => {
  const { allowed, denied } = filterPatch(storeAccess, null, patch);
  if (denied.length > 0) {
    const reason = `store:patch on the bus may not change ${denied.join(", ")}`;
    console.warn(`[host] ${reason}`);
    transport.send({ type: "store:denied", time: Date.now(), name: "bus", reason });
  }
  store.set(allowed);
});
bus.subscribe("account:selected", (selected) => store.set({ selected }));

const outlets = new Set<MfeOutletElement>();
const platformProps = () => ({ [PLATFORM_PROP]: store.get() });
store.subscribe((state) => {
  document.documentElement.dataset.theme = state.theme;
  for (const outlet of outlets) outlet.props = platformProps();
});

// Диагностика из консоли браузера: mfe.events() — события монтирования, mfe.registry —
// учёт китов, mfe.store и mfe.bus — общее состояние и шина, mfe.devtools — панель.
const registry = getPlatformRegistry();
registry.setTransport(transport);
Object.assign(window, { mfe: { events: events.events, registry, store, bus, devtools } });

const createOutlet = (remote?: string, basename?: string) => {
  const outlet = document.createElement(outletTag) as MfeOutletElement;
  outlet.props = platformProps();
  if (basename) outlet.basename = basename;
  if (remote) outlet.remote = remote;
  outlets.add(outlet);
  return outlet;
};

// ---------------------------------------------------------------- разметка оболочки

const header = document.createElement("header");
header.className = "shell-header";
const brand = document.createElement("span");
brand.textContent = "MFE platform";
const nav = document.createElement("nav");
for (const { href: path, title } of config.nav) {
  const link = document.createElement("a");
  link.href = href(path);
  link.dataset.path = path;
  link.textContent = title;
  nav.append(link);
}
const themeToggle = document.createElement("button");
themeToggle.type = "button";
themeToggle.className = "theme-toggle";
themeToggle.textContent = "Тема";
themeToggle.addEventListener("click", () =>
  store.set({ theme: store.get().theme === "light" ? "dark" : "light" }),
);
const user = document.createElement("span");
user.className = "user";
user.textContent = store.get().session?.name ?? "";
header.append(brand, nav, user, themeToggle);

// Подмена видна всегда: забытая подмена — частая причина «у меня работает, у вас нет».
if (overridden.length > 0) {
  const badge = document.createElement("span");
  badge.className = "override-badge";
  badge.dataset.testid = "override-badge";
  badge.textContent = `override: ${overridden
    .map(({ name, added }) => (added ? `+${name}` : name))
    .join(", ")}`;
  badge.title = overridden.map(({ name, entry }) => `${name} → ${entry}`).join("\n");
  header.append(badge);
}

const main = document.createElement("main");
main.className = "page";
const routed = createOutlet();
const overview = document.createElement("section");
overview.className = "overview";
overview.dataset.testid = "overview";
const notFound = document.createElement("section");
notFound.setAttribute("role", "alert");
notFound.dataset.testid = "not-found";
notFound.textContent = "Страница не найдена";
main.append(routed, overview, notFound);

document.body.append(header, main);
if (devtools && devtoolsRequested) devtools.open();

// ---------------------------------------------------------------- страницы

type Page = { kind: "overview" } | { kind: "remote"; match: RouteMatch } | { kind: "not-found" };

const show = (page: Page) => {
  routed.hidden = page.kind !== "remote";
  overview.hidden = page.kind !== "overview";
  notFound.hidden = page.kind !== "not-found";

  if (page.kind === "remote") {
    // basename раньше remote: новый ремоут создаётся уже с правильным префиксом.
    routed.basename = href(page.match.basename);
    routed.remote = page.match.remote;
  } else {
    routed.removeAttribute("remote");
  }

  // Обзор — страница хоста: ремоуты рядом, каждый со своим basename. Уходя со страницы,
  // ремоуты размонтируются.
  if (page.kind === "overview" && overview.childElementCount === 0) {
    overview.append(
      ...config.overview.map(({ remote, basename }) => createOutlet(remote, href(basename))),
    );
  } else if (page.kind !== "overview") {
    for (const outlet of overview.children) outlets.delete(outlet as MfeOutletElement);
    overview.replaceChildren();
  }
};

// ---------------------------------------------------------------- маршруты

// Манифесты грузятся заранее, код ремоутов — при первом попадании на их маршрут (или при
// наведении на ссылку). Недоступный или кривой манифест не ломает остальные маршруты, а
// недоступный при старте ремоут догружается, когда пользователь идёт на неизвестный путь.
const manifests = createManifestSet({
  loader,
  names: remotes.map(({ name }) => name),
  onError: (name, error) => console.error(`[host] manifest of "${name}" is unavailable`, error),
});
await manifests.load();

const overrideLinks = new Set<string>();
const buildTable = () => {
  const next = createRouteTable(manifests.manifests());
  for (const { pattern, remotes: claimed } of next.conflicts) {
    console.warn(
      `[host] route "${pattern}" is claimed by ${claimed.join(", ")}; using ${claimed[0]}`,
    );
  }
  // Ремоуту, добавленному подменой, нет места в навигации из конфигурации: временный пункт
  // ведёт на его первый маршрут.
  const pending = overridden.filter((entry) => entry.added && !overrideLinks.has(entry.name));
  for (const { name } of pending) {
    const route = next.entries.find((entry) => entry.remote === name);
    if (!route) continue;
    const link = document.createElement("a");
    link.href = href(route.basename);
    link.dataset.path = route.basename;
    link.textContent = `${name} (override)`;
    link.dataset.override = "";
    nav.append(link);
    overrideLinks.add(name);
  }
  return next;
};
let table = buildTable();

const retryMissingRemotes = async () => {
  if (!(await manifests.retryFailed())) return;
  table = buildTable();
  router.replaceTable(table);
};

const router = createHostRouter({
  table,
  base,
  onRoute(match, path) {
    for (const link of nav.querySelectorAll("a")) {
      const target = link.dataset.path ?? link.pathname;
      const active =
        target === "/" ? path === "/" : path === target || path.startsWith(`${target}/`);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    show(
      path === "/"
        ? { kind: "overview" }
        : match
          ? { kind: "remote", match }
          : { kind: "not-found" },
    );
    if (!match && path !== "/") void retryMissingRemotes();
  },
});

// Обычные ссылки хоста и ремоутов — через роутер, без перезагрузки; наведение на ссылку
// заранее загружает код ремоута.
interceptLinks({ router, prefetch: createPrefetcher({ table: () => table, loader }) });

router.start();

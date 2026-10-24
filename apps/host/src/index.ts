import "./styles.css";
import { createBus, createStore } from "@mfe/bus";
import { PLATFORM_PROP, type PlatformState, type RemoteManifest } from "@mfe/contract";
import {
  combineTransports,
  consoleTransport,
  createFederationLoader,
  createHostRouter,
  createMemoryTransport,
  createRouteTable,
  defineMfeOutlet,
  type FallbackContext,
  type MfeOutletElement,
  type RouteMatch,
} from "@mfe/host-runtime";
import { getPlatformRegistry } from "@mfe/registry";
import { loadRemote, registerRemotes } from "@module-federation/enhanced/runtime";
import { NAV, OVERVIEW, REMOTES } from "./remotes";

const fallback = ({ state, remote, message }: FallbackContext): Node => {
  const element = document.createElement("div");
  element.className = `status status-${state}`;
  element.setAttribute("role", state === "loading" ? "status" : "alert");
  element.textContent =
    state === "loading"
      ? "Загрузка модуля…"
      : state === "denied"
        ? `Модуль «${remote}» запрещён: ${message}`
        : "Модуль недоступен. Попробуйте обновить страницу позже.";
  return element;
};

registerRemotes(REMOTES.map(({ name, entry }) => ({ name, entry })));
const loader = createFederationLoader(loadRemote);
// Наблюдаемость по умолчанию: консоль и кольцевой буфер в памяти (наружу ничего).
const events = createMemoryTransport(500);
const outletTag = defineMfeOutlet({
  loader,
  renderFallback: fallback,
  transport: combineTransports(consoleTransport, events),
});

// ---------------------------------------------------------------- общее состояние

// Стор живёт в хосте. Ремоуты получают состояние свойством `platform` своего элемента и
// просят изменений через шину — без общего рантайма и без привязки к фреймворку.
const store = createStore<PlatformState>({
  session: { userId: "u-1", name: "Анна Иванова" },
  selected: null,
  theme: "light",
  locale: "ru-RU",
});
const bus = createBus();
bus.subscribe("store:patch", (patch) => store.set(patch));
bus.subscribe("account:selected", (selected) => store.set({ selected }));

const outlets = new Set<MfeOutletElement>();
const platformProps = () => ({ [PLATFORM_PROP]: store.get() });
store.subscribe((state) => {
  document.documentElement.dataset.theme = state.theme;
  for (const outlet of outlets) outlet.props = platformProps();
});

// Диагностика из консоли браузера: mfe.events() — события монтирования, mfe.registry —
// учёт китов, mfe.store и mfe.bus — общее состояние и шина.
const registry = getPlatformRegistry();
registry.setTransport(combineTransports(consoleTransport, events));
Object.assign(window, { mfe: { events: events.events, registry, store, bus } });

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
for (const { href, title } of NAV) {
  const link = document.createElement("a");
  link.href = href;
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

// ---------------------------------------------------------------- страницы

type Page = { kind: "overview" } | { kind: "remote"; match: RouteMatch } | { kind: "not-found" };

const show = (page: Page) => {
  routed.hidden = page.kind !== "remote";
  overview.hidden = page.kind !== "overview";
  notFound.hidden = page.kind !== "not-found";

  if (page.kind === "remote") {
    // basename раньше remote: новый ремоут создаётся уже с правильным префиксом.
    routed.basename = page.match.basename;
    routed.remote = page.match.remote;
  } else {
    routed.removeAttribute("remote");
  }

  // Обзор — страница хоста: ремоуты рядом, каждый со своим basename. Уходя со страницы,
  // ремоуты размонтируются.
  if (page.kind === "overview" && overview.childElementCount === 0) {
    overview.append(...OVERVIEW.map(({ remote, basename }) => createOutlet(remote, basename)));
  } else if (page.kind !== "overview") {
    for (const outlet of overview.children) outlets.delete(outlet as MfeOutletElement);
    overview.replaceChildren();
  }
};

// ---------------------------------------------------------------- маршруты

// Манифесты грузятся заранее, код ремоутов — при первом попадании на их маршрут.
const manifests = (
  await Promise.allSettled(REMOTES.map(({ name }) => loader.loadManifest(name)))
).flatMap((result, index): RemoteManifest[] => {
  if (result.status === "fulfilled") return [result.value];
  console.error(`[host] manifest of "${REMOTES[index]?.name}" is unavailable`, result.reason);
  return [];
});

const table = createRouteTable(manifests);
for (const { pattern, remotes } of table.conflicts) {
  console.warn(
    `[host] route "${pattern}" is claimed by ${remotes.join(", ")}; using ${remotes[0]}`,
  );
}

const router = createHostRouter({
  table,
  onRoute(match, path) {
    for (const link of nav.querySelectorAll("a")) {
      const active =
        link.pathname === "/"
          ? path === "/"
          : path === link.pathname || path.startsWith(`${link.pathname}/`);
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
  },
});

nav.addEventListener("click", (event) => {
  const link = (event.target as Element).closest("a");
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  router.navigate(link.pathname);
});

router.start();

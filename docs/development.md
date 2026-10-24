# Разработка на платформе

[English](en/development.md) · Русский

Как завести новый ремоут, проверить его без хоста, подставить свой локальный ремоут в стенд
или прод и разобраться, что происходит на странице. Контракт ремоута —
[contract.md](contract.md), схемы — [architecture.md](architecture.md).

## Новый ремоут одной командой

```bash
bun run create:remote cards --template rwc --title "Карты"
bun install
bun run dev
```

| Параметр | По умолчанию | Что делает |
| --- | --- | --- |
| `<name>` | — | имя ремоута: строчные буквы, цифры и `_` (`cards`, `credit_cards`) |
| `--template` | `vanilla` | `vanilla` — голый кастомный элемент, `rwc` — компонент rwc, `react` — React через `@mfe-platform/adapter-react` |
| `--port` | следующий за занятыми | порт dev-сервера |
| `--title` | имя в PascalCase | заголовок страницы и пункта навигации |
| `--no-nav` | — | не добавлять пункт навигации (ремоут-виджет) |

Генератор создаёт `apps/mfe-<name>/` (манифест, entry, представление, rsbuild-конфиг,
тест контракта, README) и добавляет ремоут и пункт навигации в
`apps/host/public/platform.config.json`. `bun run dev` находит приложения в `apps/` сам.

Имя ремоута — это и имя контейнера Module Federation, поэтому оно должно быть
JS-идентификатором: дефис не подходит. Тег элемента генератор строит с дефисом
(`credit_cards` → `<mfe-credit-cards>`).

Шаблоны лежат в `templates/`. `bun run check:templates` генерирует каждый, ставит, прогоняет
его тест и собирает, а потом возвращает репозиторий как был; та же проверка идёт в CI.

## Тест контракта: `@mfe-platform/testing`

Ремоут проверяется так же, как его проверит хост, — без хоста, Module Federation и сети:

```ts
import { expect, test } from "bun:test";
import { checkRemote, mountRemote } from "@mfe-platform/testing";
import * as entry from "../src/entry";
import { manifest } from "../src/manifest";

test("ремоут соответствует контракту платформы", async () => {
  expect(await checkRemote(entry, { manifest })).toEqual([]);
});

test("показывает выбранный счёт", async () => {
  const { element, unmount } = await mountRemote(entry, {
    basename: "/cards",
    props: { platform: { selected: { accountId: "1", title: "Текущий счёт" } } },
  });
  expect(element?.shadowRoot?.textContent).toContain("Текущий счёт");
  unmount();
});
```

`checkRemote` возвращает список проблем; пустой список — ремоут подключится:

- манифест проходит `validateManifest`;
- `./manifest` и `./entry` согласны в `name`, `tag`, `contractVersion`;
- версию контракта поддерживает хост;
- `register()` идемпотентна и регистрирует `manifest.tag`;
- элемент монтируется в настоящий `<mfe-outlet>` без ошибки.

`mountRemote` монтирует ремоут через `<mfe-outlet>` и возвращает элемент, состояние outlet и
события монтирования. `createMemoryLoader` — загрузчик в памяти для своих сценариев.

Тестам нужен DOM: в этом репозитории happy-dom подключается в `scripts/test-setup.ts`. Там же
заглушка `attachInternals`, которой нет в happy-dom: без неё формовые компоненты UI-кита
не создаются. Поведение форм проверяют e2e в браузере.

## Подмена ремоута

Открыть стенд или прод и подставить свой локальный ремоут, не трогая остальные:

```
https://platform.bank.example/payments?mfe-override=payments=http://localhost:3002/mf-manifest.json
```

- Параметр можно повторять — по одному на ремоут.
- Подмена запоминается на вкладку (`sessionStorage`) и переживает переходы и перезагрузки.
- `?mfe-override=reset` снимает все подмены.
- Действующие подмены видны в шапке хоста значком `override: payments` и в панели отладки.

Подмена грузит чужой код на страницу, поэтому разрешены только адреса этой машины:
`localhost`, `127.0.0.1`, `[::1]`. Остальные отбрасываются с предупреждением в консоли.
Хост может задать свой список: `applyRemoteOverrides(remotes, { allow: (url) => ... })`.
### Новый ремоут, которого ещё нет в конфигурации

Подмена с незнакомым именем добавляет ремоут: новый ремоут разрабатывают прямо в стенде или
проде, до того как его внесли в `platform.config.json`.

```
https://platform.bank.example/?mfe-override=cards=http://localhost:3004/mf-manifest.json
```

- Хост загружает манифест нового ремоута вместе с остальными, и его маршруты
  (`/cards`, `/cards/*`) работают как обычные.
- В навигации появляется временный пункт `cards (override)`, ведущий на первый маршрут
  ремоута; в значке подмены он отмечен плюсом: `override: +cards`.
- Действуют те же ограничения: только локальные адреса, имя — JS-идентификатор.
- Хост, которому это не нужно, отключает добавление: `applyRemoteOverrides(remotes, { allowNew: false })`.

## Панель отладки: `@mfe-platform/devtools`

Панель на странице показывает:

- ремоуты: состояние, версию, время загрузки кода и до первого кадра, число монтирований и ошибок;
- версии UI-кита: постфикс, версию, кто использует;
- действующие подмены;
- последние ошибки монтирования и запреты регистрации.

Открывается сочетанием **Alt+Shift+D**. В dev-сборке хоста панель включена всегда, на стенде
и в проде — параметром `?mfe-devtools` (запоминается на вкладку). Данные берутся из событий
ядра и реестра на странице, сети нет.

Подключение в своём хосте — как ещё один транспорт наблюдаемости:

```ts
import { createDevtools } from "@mfe-platform/devtools";

const devtools = createDevtools({ overrides });
defineMfeOutlet({ loader, transport: combineTransports(consoleTransport, devtools.transport) });
getPlatformRegistry().setTransport(devtools.transport);
```

Из консоли браузера: `mfe.events()`, `mfe.registry.records()`, `mfe.devtools.open()`.

## Конфигурация хоста при запуске

Хост читает `platform.config.json` при каждом запуске (`cache: no-cache`), а не при сборке.
Новый ремоут, новый адрес или пункт навигации — это выкладка одного JSON-файла рядом с хостом,
без пересборки.

```json
{
  "remotes": [{ "name": "accounts", "entry": "https://cdn.bank.example/accounts/mf-manifest.json" }],
  "nav": [{ "href": "/accounts", "title": "Счета" }],
  "overview": [{ "remote": "accounts", "basename": "/accounts" }]
}
```

Файл проверяется при загрузке (`validateRemoteEntries` из `@mfe-platform/host-runtime` и проверка
хоста): при ошибке хост показывает сообщение вместо пустой страницы, а в консоли — все
проблемы сразу. Манифест ремоута, который не прошёл `validateManifest`, в таблицу маршрутов
не попадает; остальные ремоуты работают.

## Ссылки, предзагрузка и повтор

- **Ссылки.** Обычные `<a href="/payments">` в хосте и в ремоутах — в том числе внутри shadow
  DOM — ведут через роутер хоста, без перезагрузки страницы. Браузеру остаются ссылки с
  `target`, `download`, `rel="external"`, `data-mfe-reload`, на чужой origin, клики с
  модификаторами и якоря на той же странице. Ссылки, которые уже обработал роутер ремоута
  (`preventDefault`), хост не трогает.
- **Предзагрузка.** Наведение или фокус на внутренней ссылке заранее загружает код ремоута,
  чей маршрут она открывает. `register()` при этом не вызывается.
- **Повтор.** Если ремоут не загрузился, в fallback есть кнопка «Повторить»; программно —
  `outlet.retry()`. Каждая попытка — новое монтирование со своим `mountId`.

## Целостность кода ремоутов

Подменённый на CDN или по дороге файл ремоута не исполняется: хост проверяет цепочку хешей
от своей конфигурации до каждого чанка.

1. Production-сборка ремоута (`bun run build`) дописывает в `dist/mf-manifest.json` хеши всех
   JS- и CSS-файлов и кладёт рядом `dist/mf-manifest.json.integrity` — хеш самого манифеста.
2. При выкладке этот хеш вносится в конфигурацию хоста:

   ```json
   { "name": "accounts", "entry": "https://cdn.bank.example/accounts/mf-manifest.json",
     "integrity": "sha384-…" }
   ```

3. Хост (`createIntegrityPlugin` из `@mfe-platform/host-runtime`) проверяет манифест по этому хешу и
   ставит `integrity` и `crossorigin="anonymous"` на remoteEntry и каждый чанк. Файл с адреса
   проверенного ремоута, которого нет в таблице хешей, блокируется. Нарушение — событие
   `integrity:denied` в транспорте и в панели отладки.

Что нужно от инфраструктуры:

- **CORS на CDN ремоута.** SRI для файла с другого origin работает только с CORS-запросом:
  сервер ремоута должен отдавать `Access-Control-Allow-Origin` для адреса хоста.
- **Хеш меняется с каждой сборкой.** Выкладка ремоута с проверкой — это новый файл и новая
  запись в конфигурации хоста. Без `integrity` ремоут грузится как раньше, так что проверку
  можно включать по одному ремоуту.
- **CSP хоста.** Рекомендуется `script-src` со списком адресов ремоутов; inline-скриптов
  платформа не добавляет.

Проверка в браузере — `bun run test:e2e:prod`: production-сборка, подменённые манифест,
remoteEntry и чанк.

## Права на общий стор

Ремоут просит изменить общее состояние событием со своего элемента:

```ts
import { patchEvent } from "@mfe-platform/contract";

this.dispatchEvent(patchEvent({ theme: "dark" }));
```

Хост узнаёт по outlet, какой это ремоут, и применяет только разрешённые ему поля. Права —
в `platform.config.json`:

```json
"storeAccess": { "*": ["selected", "theme", "locale"], "auth": ["session"] }
```

`"*"` — поля, открытые всем ремоутам; права складываются. Без `storeAccess` действует
`DEFAULT_STORE_ACCESS`: всем открыто всё, кроме `session`. Запрещённые поля отбрасываются,
событие `store:denied` уходит в транспорт. Тема `store:patch` на шине анонимна и получает
только поля `"*"`.

## Бюджет размера

`bun run check:size` после сборки считает для каждого ремоута то, что хост для него
загружает (по `mf-manifest.json`: remoteEntry, чанки `./manifest` и `./entry`, общие модули),
и сравнивает с бюджетом из `package.json` ремоута:

```json
"mfe": { "sizeBudget": { "gzipKb": 50 } }
```

Ремоут сверх бюджета роняет CI. Шаблоны `create:remote` приходят с бюджетом, и
`check:templates` проверяет и его.

## Общие модули

`defineRemoteConfig` из `@mfe-platform/rsbuild` решает, что ремоут делит с другими:

| Опция | По умолчанию | Что делает |
| --- | --- | --- |
| `sharedRuntime` | `true` | в production ремоут берёт рантайм Module Federation у хоста (около 17,6 KB gzip экономии); в dev везёт свой и открывается без хоста |
| `shareKits` | `true` | киты из `kits` и `@rwcjs/core` делятся с ремоутами той же линии совместимости — один экземпляр кита вместо конфликта сборок |

Singleton нет: несовместимые версии у каждого ремоута свои. С общим рантаймом мажор
`@module-federation/*` у хоста и ремоутов должен совпадать.

## Проверка production-сборки

`bun run test:e2e:prod` собирает всё и гоняет `e2e-prod/` на preview-серверах: целостность,
общий кит, общий рантайм — то, чего нет в dev. `apps/mfe-probe` — тестовый ремоут на той же
линии кита, что payments; в конфигурацию хоста он не входит, тесты подключают его подменой.

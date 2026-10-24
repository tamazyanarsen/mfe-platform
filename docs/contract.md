# Контракт ремоута

[English](en/contract.md) · Русский

Версия контракта: `CONTRACT_VERSION = 1` (`@mfe-platform/contract`). Контракт не знает ни о rwc, ни
о React, ни о сборщике.

## Что ремоут экспонирует

| Модуль | Экспорты | Когда грузится |
| --- | --- | --- |
| `./manifest` | `manifest: RemoteManifest` | заранее, хост строит по нему таблицу маршрутов |
| `./entry` | `manifest`, `register()` | при первом переходе на маршрут ремоута |

`./manifest` должен быть лёгким: никаких импортов фреймворка и UI-кита. Имена модулей —
`REMOTE_EXPOSES` в `@mfe-platform/contract`.

```ts
export interface RemoteManifest {
  readonly contractVersion: number;  // CONTRACT_VERSION, с которой собран ремоут
  readonly name: string;             // имя контейнера MF, JS-идентификатор: "accounts"
  readonly version?: string;         // версия сборки ремоута, для наблюдаемости
  readonly tag: string;              // фактический тег элемента
  readonly routes: readonly string[];// "/accounts" и "/accounts/*"
  readonly requires?: { readonly [pkg: string]: string };  // semver-диапазоны
  readonly extra?: Readonly<Record<string, unknown>>;      // данные потребителя
}

export interface RemoteModule {
  readonly manifest: RemoteManifest;
  register(): Promise<void> | void;  // идемпотентна
}
```

- **`name` — JS-идентификатор** (`credit_cards`, не `credit-cards`): это и имя контейнера
  Module Federation, а MF требует идентификатор.
- **`register()` идемпотентна.** Второй вызов — no-op, не исключение. После неё
  `customElements.get(manifest.tag)` должен вернуть класс.
- **`tag` в `./manifest` и в `./entry` совпадает** — иначе хост показывает ошибку.
- **`extra` ядро не читает и не валидирует**, только проносит в события наблюдаемости.
  Сюда кладут владельца, команду, центр затрат.
- **Маршруты** — точные пути и префиксы `/*`, всегда с ведущим `/`; другие паттерны манифест
  не пройдут проверку. Самый длинный префикс побеждает. Если один паттерн заявили два ремоута,
  он достаётся тому, кто раньше в конфигурации, и хост пишет предупреждение в консоль.

## Элемент ремоута

Хост создаёт элемент `manifest.tag` внутри `<mfe-outlet>` (light DOM, без shadow root у
outlet) и передаёт ему:

| Вход | Как | Что |
| --- | --- | --- |
| `basename` | атрибут | префикс маршрутов ремоута: `/accounts` |
| `platform` | свойство (`PLATFORM_PROP`) | `PlatformState`: сессия, выбранный счёт, тема, локаль |

Выход — `CustomEvent` с `bubbles: true, composed: true`.

## Навигация

Историю браузера пишет только хост.

- Внутри своего `basename` ремоут навигирует своим роутером.
- Адрес может быть вне `basename`: хост показывает ремоут не на его странице (обзор). Тогда
  ремоут показывает стартовую страницу, а не сопоставляет чужой путь своим маршрутам:
  `pathInBasename(basename)` из `@mfe-platform/contract` возвращает `null`.
- Маршруты манифеста и `navigateEvent` — пути приложения (`/payments`). Если хост развёрнут
  под префиксом (`bank.ru/business/`), префикс добавляет хост, а `basename` ремоута уже
  содержит его (`/business/payments`).
- На чужой маршрут — событием: `element.dispatchEvent(navigateEvent("/payments/new"))`
  (тип `platform:navigate`, `detail: { to, replace? }`).

- Обычная ссылка `<a href="/payments">` тоже работает: хост перехватывает клик и переходит
  без перезагрузки, в том числе по ссылке внутри shadow DOM. Ссылку, которую уже обработал
  роутер ремоута (`preventDefault`), хост не трогает. Полная перезагрузка — `rel="external"`
  или `data-mfe-reload`.
- Наружу хост переходит только по `http(s)`: `javascript:` и `data:` в `platform:navigate`
  блокируются.

Хост замечает `pushState`/`replaceState` роутеров ремоутов и пересчитывает маршрут, а после
своей навигации рассылает `popstate`, чтобы роутеры ремоутов увидели новый адрес.

## Шина и общее состояние

- Состояние живёт в хосте и приходит свойством `platform`. Изменения ремоут просит
  событием со своего элемента: `this.dispatchEvent(patchEvent({ theme: "dark" }))`
  (`platform:patch`). Хост узнаёт по outlet, какой это ремоут, и применяет только поля,
  разрешённые ему в `storeAccess` конфигурации хоста; по умолчанию сессию не меняет никто.
  Запрещённые поля отбрасываются, а в транспорт уходит событие `store:denied`.
- Тема `store:patch` на шине тоже работает, но она анонимна: хост применяет из неё только
  поля, открытые всем ремоутам (`"*"` в `storeAccess`).
- Права на стор — защита от ошибок и незаметной связности, а не граница безопасности: код
  ремоутов работает на одной странице.
- Шина (`@mfe-platform/bus`): `publish(topic, payload)` / `subscribe(topic, handler, { signal })`
  поверх `CustomEvent` на `document`. Темы и нагрузки — интерфейс `PlatformTopics`;
  свои темы добавляются слиянием деклараций.
- Подписка живёт, пока подключён элемент: `createSubscriptions()` в обычном кастомном
  элементе, `subscribeInRender()` из `@mfe-platform/adapter-rwc` в компоненте rwc.

## Версии UI-кита

Ремоут регистрирует кит через реестр, а не напрямую:

```ts
import { useKit } from "@mfe-platform/adapter-rwc";
import * as ui from "@rwcjs/ui";

useKit({ name: "@rwcjs/ui", version: "0.2.0", consumer: manifest.name, kit: ui, control: ui.Button });
```

Постфикс — линия совместимости: `v<major>`, для 0.x — `v0-<minor>`. Ремоуты на одной
линии получают один экземпляр кита: `defineRemoteConfig` делит киты из `kits` и
`@rwcjs/core` через Module Federation по той же линии (`^version`, не singleton), и реестр
отмечает второго потребителя как `reused`. Несовместимые версии у каждого ремоута свои.
Если ремоут собран без общего кита (`shareKits: false`), другая сборка того же постфикса —
конфликт, и `register()` ремоута падает с понятным сообщением.

## Точки расширения

| Точка | Где | Для чего |
| --- | --- | --- |
| `ObservabilityTransport` | `defineMfeOutlet({ transport })`, `registry.setTransport()` | куда уходят события |
| `PolicyHook.beforeMount` | `defineMfeOutlet({ policies })` | запретить монтирование |
| `PolicyHook.beforeRegister` | `registry.use(policy)` | запретить регистрацию версии кита |
| `manifest.extra` | манифест ремоута | метаданные ремоута (команда, владелец) без смены схемы |

## События наблюдаемости

| Событие | Когда |
| --- | --- |
| `mount:start`, `mount:code-loaded`, `mount:ready` | этапы монтирования, с `timings` |
| `mount:error`, `mount:denied` | ошибка загрузки или отрисовки, запрет политики |
| `register:ok`, `register:denied` | регистрация версии кита, в том числе `reused` |
| `store:denied` | ремоут попросил поле стора, на которое у него нет прав |
| `integrity:denied` | манифест или файл ремоута не прошёл проверку целостности |

## Состояния `<mfe-outlet>`

`idle` → `loading` → `ready` | `error` | `denied`. Состояние отражается атрибутом `state`
и событием `mfe-outlet-state`. Ошибки загрузки и исключения при отрисовке остаются внутри
outlet: показывается fallback, событие `mount:error` уходит в транспорт с полями `name`,
`version`, `mountId`, `route`, `contractVersion`, `extra`, `details.phase`.

После ошибки `outlet.retry()` загружает ремоут заново; тот же вызов получает fallback как
`retry` в `FallbackContext` — хост рисует по нему кнопку «Повторить».

## Проверка контракта

`checkRemote` из `@mfe-platform/testing` проверяет ремоут так же, как хост, — без хоста и сети:
манифест, согласие `./manifest` и `./entry`, версию контракта, идемпотентность `register()`
и монтирование в настоящий `<mfe-outlet>`. Подробно — [development.md](development.md#тест-контракта-mfetesting).

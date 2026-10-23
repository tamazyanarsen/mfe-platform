# Контракт ремоута

Версия контракта: `CONTRACT_VERSION = 1` (`@mfe/contract`). Контракт не знает ни о rwc, ни
о React, ни о сборщике.

## Что ремоут экспонирует

| Модуль | Экспорты | Когда грузится |
| --- | --- | --- |
| `./manifest` | `manifest: RemoteManifest` | заранее, хост строит по нему таблицу маршрутов |
| `./entry` | `manifest`, `register()` | при первом переходе на маршрут ремоута |

`./manifest` должен быть лёгким: никаких импортов фреймворка и UI-кита. Имена модулей —
`REMOTE_EXPOSES` в `@mfe/contract`.

```ts
export interface RemoteManifest {
  readonly contractVersion: number;  // CONTRACT_VERSION, с которой собран ремоут
  readonly name: string;             // имя контейнера MF: "accounts"
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

- **`register()` идемпотентна.** Второй вызов — no-op, не исключение. После неё
  `customElements.get(manifest.tag)` должен вернуть класс.
- **`tag` в `./manifest` и в `./entry` совпадает** — иначе хост показывает ошибку.
- **`extra` ядро не читает и не валидирует**, только проносит в события наблюдаемости.
  Сюда кладут владельца, команду, центр затрат.
- **Маршруты** — точные пути и префиксы `/*`. Самый длинный префикс побеждает.

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
- На чужой маршрут — событием: `element.dispatchEvent(navigateEvent("/payments/new"))`
  (тип `platform:navigate`, `detail: { to, replace? }`).

Хост замечает `pushState`/`replaceState` роутеров ремоутов и пересчитывает маршрут, а после
своей навигации рассылает `popstate`, чтобы роутеры ремоутов увидели новый адрес.

## Шина и общее состояние

- Состояние живёт в хосте и приходит свойством `platform`. Изменения ремоут просит темой
  `store:patch`.
- Шина (`@mfe/bus`): `publish(topic, payload)` / `subscribe(topic, handler, { signal })`
  поверх `CustomEvent` на `document`. Темы и нагрузки — интерфейс `PlatformTopics`;
  свои темы добавляются слиянием деклараций.
- Подписка живёт, пока подключён элемент: `createSubscriptions()` в обычном кастомном
  элементе, `subscribeInRender()` из `@mfe/adapter-rwc` в компоненте rwc.

## Версии UI-кита

Ремоут регистрирует кит через реестр, а не напрямую:

```ts
import { useKit } from "@mfe/adapter-rwc";
import * as ui from "@rwcjs/ui";

useKit({ name: "@rwcjs/ui", version: "0.2.0", consumer: manifest.name, kit: ui, control: ui.Button });
```

Постфикс — линия совместимости: `v<major>`, для 0.x — `v0-<minor>`. Ремоуты на одной
линии должны делить один экземпляр кита (общий модуль MF); другая сборка с тем же
постфиксом — конфликт, и `register()` ремоута падает с понятным сообщением.

## Точки расширения

| Точка | Где | Для чего |
| --- | --- | --- |
| `ObservabilityTransport` | `defineMfeOutlet({ transport })`, `registry.setTransport()` | куда уходят события |
| `PolicyHook.beforeMount` | `defineMfeOutlet({ policies })` | запретить монтирование |
| `PolicyHook.beforeRegister` | `registry.use(policy)` | запретить регистрацию версии кита |
| `manifest.extra` | манифест ремоута | governance-данные без смены схемы |

## Состояния `<mfe-outlet>`

`idle` → `loading` → `ready` | `error` | `denied`. Состояние отражается атрибутом `state`
и событием `mfe-outlet-state`. Ошибки загрузки и исключения при отрисовке остаются внутри
outlet: показывается fallback, событие `mount:error` уходит в транспорт с полями `name`,
`version`, `mountId`, `route`, `contractVersion`, `extra`, `details.phase`.

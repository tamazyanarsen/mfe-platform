# Перевод существующей сборки Module Federation на контракт

[English](en/migration.md) · Русский

Типичная исходная точка: хост на Module Federation со статическими `remotes`, ремоуты
экспонируют компоненты фреймворка, хост монтирует их сам (часто через `bridge-react`).

## 1. Ремоут: экспонировать манифест и entry

Добавьте два модуля и оставьте старые `exposes`, пока хост не переедет.

```ts
// src/manifest.ts — без импортов фреймворка
import { CONTRACT_VERSION, type RemoteManifest } from "@mfe/contract";

export const manifest: RemoteManifest = {
  contractVersion: CONTRACT_VERSION,
  name: "billing",
  tag: "mfe-billing",
  routes: ["/billing", "/billing/*"],
  extra: { team: "billing" },
};
```

```ts
// src/entry.ts — React
import { registerReactElement } from "@mfe/adapter-react";
import { App } from "./App";
export { manifest } from "./manifest";

export const register = () =>
  registerReactElement("mfe-billing", App, {
    props: ["basename", "platform"],
    events: { onNavigate: "platform:navigate" },
  });
```

```ts
// rsbuild.config.ts / module-federation.config.ts
exposes: {
  "./manifest": "./src/manifest.ts",
  "./entry": "./src/entry.ts",
  "./App": "./src/App.tsx", // старый expose — до переезда хоста
},
```

Для ремоута на rwc `register()` вызывает `registerXxx()` из `configCustomComponent`, а кит
регистрирует через `useKit` из `@mfe/adapter-rwc`.

## 2. Ремоут: роутер относительно `basename`

Хост передаёт префикс атрибутом `basename`. Роутер ремоута поднимается относительно него
(`createRouter(routes, { base })` в `@rwcjs/router`, `<BrowserRouter basename>` в React Router).
Переходы на чужие маршруты — событием `platform:navigate`, а не `history.pushState`.

## 3. Хост: заменить ручное монтирование на `<mfe-outlet>`

```ts
import { createFederationLoader, createHostRouter, createRouteTable, defineMfeOutlet } from "@mfe/host-runtime";
import { loadRemote, registerRemotes } from "@module-federation/enhanced/runtime";

registerRemotes([{ name: "billing", entry: "https://cdn.bank.local/billing/mf-manifest.json" }]);
const loader = createFederationLoader(loadRemote);
const tag = defineMfeOutlet({ loader });

const manifests = await Promise.all(["billing"].map(loader.loadManifest));
const outlet = document.createElement(tag);
createHostRouter({
  table: createRouteTable(manifests),
  onRoute: (match) => {
    if (match) {
      outlet.basename = match.basename;
      outlet.remote = match.remote;
    }
  },
}).start();
```

Статические `remotes` в конфиге сборки хоста больше не нужны: ремоуты регистрируются в
рантайме, адреса — в конфигурации хоста. Удобнее держать её в JSON-файле рядом с хостом и
читать при запуске — тогда новый адрес не требует пересборки:

```ts
import { loadJsonConfig, type RemoteEntry, validateRemoteEntries } from "@mfe/host-runtime";

const remotes = await loadJsonConfig<RemoteEntry[]>("/remotes.json", validateRemoteEntries);
registerRemotes(remotes);
```

Имя ремоута — имя контейнера MF, JS-идентификатор: если старые контейнеры называются через
дефис, переименуйте их до перевода.

## 4. Shared-зависимости

Singleton-зависимостей нет: фреймворк делится только между ремоутами с совместимыми
версиями, а несовместимые везут свою копию — команды обновляются независимо. Если раньше
фреймворк был синглтоном, перед отказом от этого проверьте, не передают ли ремоуты друг
другу контекст фреймворка (`provide`/`inject`, React Context) — через границу ремоутов с
разными копиями он не работает. Общее состояние переносится в стор хоста и свойство
`platform`, изменения — событием `patchEvent`. Что делится и почему —
[architecture.md](architecture.md#что-делится-а-что-нет).

## 5. Проверить ремоут

Добавьте в CI ремоута тест контракта — он ловит расхождения до того, как их увидит хост:

```ts
import { checkRemote } from "@mfe/testing";
import * as entry from "../src/entry";
import { manifest } from "../src/manifest";

expect(await checkRemote(entry, { manifest })).toEqual([]);
```

Во время перевода удобно подставить переведённый ремоут в работающий стенд:
`?mfe-override=billing=http://localhost:3005/mf-manifest.json` — подробно в
[development.md](development.md#подмена-ремоута).

## 6. Удалить старое

Когда хост монтирует все ремоуты через `<mfe-outlet>`, уберите старые `exposes` и
`bridge-react`.

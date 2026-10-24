# Архитектура

Схемы — Mermaid: GitHub рисует их прямо в этом файле, а правятся они как текст рядом с кодом.
Подробности контракта — [contract.md](contract.md). Принципы и принятые решения — в
[разделе 9](#9-принципы-и-решения).

## 1. Пакеты и зависимости

Кто кого импортирует на этапе сборки. Стрелки идут только от внешних слоёв к ядру. CI
(`scripts/check-boundaries.ts`) проверяет два правила: ядро не знает UI-фреймворков и не знает
адаптеров и приложений.

```mermaid
flowchart BT
  subgraph core["Ядро — без UI-фреймворков"]
    contract["@mfe/contract<br/><small>типы, манифест, навигация,<br/>темы шины, точки расширения</small>"]
    runtime["@mfe/host-runtime<br/><small>#lt;mfe-outlet#gt;, загрузчик MF,<br/>роутер, транспорты</small>"]
    registry["@mfe/registry<br/><small>версионированные теги</small>"]
    bus["@mfe/bus<br/><small>шина и стор</small>"]
  end

  subgraph adapters["Адаптеры"]
    arwc["@mfe/adapter-rwc"]
    areact["@mfe/adapter-react"]
  end

  subgraph apps["Приложения"]
    host["apps/host"]
    acc["apps/mfe-accounts<br/><small>rwc, @rwcjs/ui 0.2</small>"]
    pay["apps/mfe-payments<br/><small>rwc, @rwcjs/ui 0.1</small>"]
    leg["apps/mfe-legacy-react<br/><small>React</small>"]
  end

  rwc[("@rwcjs/core, @rwcjs/ui")]
  react[("react, react-dom")]
  mf[("@module-federation")]

  runtime --> contract
  registry --> contract
  bus --> contract

  arwc --> registry
  arwc --> bus
  arwc -. peer .-> rwc
  areact --> react

  host --> runtime
  host --> registry
  host --> bus
  host --> mf

  acc --> arwc
  acc --> bus
  acc --> contract
  pay --> arwc
  pay --> bus
  pay --> contract
  leg --> areact
  leg --> contract
```

## 2. Что работает на странице

Один документ, один хост, ремоуты с отдельных адресов. У каждого ремоута своя копия пакетов
ядра (Module Federation ничего не шарит), поэтому общие объекты живут не в модулях, а в
общих для всех копий местах: `document` для шины и `Symbol.for(...)` в `globalThis` для реестра.

```mermaid
flowchart LR
  subgraph servers["Серверы (dev)"]
    s0["host :3000"]
    s1["accounts :3001<br/>mf-manifest.json"]
    s2["payments :3002<br/>mf-manifest.json"]
    s3["legacy :3003<br/>mf-manifest.json"]
  end

  subgraph page["Страница браузера"]
    direction TB
    subgraph hostbox["Хост"]
      cfg["platform.config.json<br/><small>remotes, nav, overview</small>"]
      router["HostRouter<br/><small>единственный владелец history</small>"]
      store["Store#lt;PlatformState#gt;<br/><small>session, selected, theme, locale</small>"]
      loader["FederationLoader"]
      tr["Транспорты<br/><small>console + memory → mfe.events()</small>"]
    end

    subgraph outlets["#lt;mfe-outlet#gt; × N"]
      o1["outlet remote=accounts"]
      o2["outlet remote=payments"]
      o3["outlet remote=legacy"]
    end

    e1["#lt;mfe-accounts#gt;"]
    e2["#lt;mfe-payments#gt;"]
    e3["#lt;mfe-legacy-react#gt;<br/><small>React в shadow root</small>"]

    doc{{"document<br/><small>шина: CustomEvent mfe-bus:*<br/>platform:navigate</small>"}}
    reg{{"globalThis[mfe-platform.registry]<br/><small>учёт китов и постфиксов</small>"}}
  end

  cfg --> loader
  loader -- "./manifest, ./entry" --> s1 & s2 & s3
  router -- "remote, basename" --> o1 & o2 & o3
  store -- "props.platform" --> o1 & o2 & o3
  o1 --> e1
  o2 --> e2
  o3 --> e3
  o1 & o2 & o3 -- "события монтирования" --> tr

  e1 & e2 -- "useKit()" --> reg
  reg -- "register:*" --> tr
  e1 & e2 & e3 <--> doc
  doc -- "store:patch, account:selected" --> store
  doc -- "platform:navigate" --> router
```

Каналы между хостом и ремоутом, полностью:

| Направление | Канал | Что передаётся |
| --- | --- | --- |
| хост → ремоут | атрибут `basename` | префикс маршрутов ремоута |
| хост → ремоут | свойство `platform` | `PlatformState` целиком, при каждом изменении стора |
| ремоут → хост | `CustomEvent("platform:navigate")` | просьба перейти на чужой маршрут |
| ремоут → хост | шина, `store:patch` | просьба изменить общее состояние |
| ремоут ↔ ремоут | шина, свои темы (`account:selected`, …) | доменные события |
| ремоут → реестр | `useKit()` | регистрация кита, получение постфикса |
| ядро → наружу | `ObservabilityTransport` | события `mount:*`, `register:*` |

Прямых вызовов между ремоутами нет: ремоут не знает, кто ещё на странице.

## 3. Старт и первый переход

Манифесты грузятся сразу, они лёгкие и без фреймворка. Код ремоута грузится при первом
попадании на его маршрут.

```mermaid
sequenceDiagram
  autonumber
  participant B as Браузер
  participant H as Хост
  participant L as FederationLoader
  participant R as Сервер ремоута
  participant Rt as HostRouter
  participant O as mfe-outlet

  B->>H: загрузка index
  H->>L: registerRemotes(platform.config.remotes)
  par для каждого ремоута
    H->>L: loadManifest(name)
    L->>R: mf-manifest.json + ./manifest
    R-->>L: { name, tag, routes, requires, extra }
  end
  Note over H: Упавший манифест логируется и пропускается,<br/>остальные работают
  H->>Rt: createRouteTable(manifests), start()
  Rt->>H: onRoute(match, path)
  H->>O: basename = "/payments", remote = "payments"
  Note over O: дальше — монтирование (раздел 4)
```

## 4. Монтирование ремоута в `<mfe-outlet>`

```mermaid
sequenceDiagram
  autonumber
  participant O as mfe-outlet
  participant L as Loader
  participant P as PolicyHook[]
  participant M as Модуль ремоута (./entry)
  participant Reg as Реестр
  participant T as Транспорт

  O->>T: mount:start
  O->>O: fallback «Загрузка…»
  O->>L: loadManifest(remote) — из кеша
  O->>O: validateManifest, contractVersion ∈ поддерживаемых
  O->>P: beforeMount({ manifest, mountId })
  alt запрет
    P-->>O: { allow: false, reason }
    O->>T: mount:denied
  else разрешено
    O->>L: loadModule(remote)
    L-->>M: тяжёлый код
    O->>T: mount:code-loaded { codeLoad }
    O->>O: module.manifest.tag == manifest.tag
    O->>M: register()
    M->>Reg: useKit({ kit, version, consumer })
    Reg-->>M: postfix "v0-1" → теги rwc-*-v0-1
    M->>M: customElements.define(manifest.tag)
    O->>O: createElement(tag), basename, props, вставка
    O->>T: mount:ready { codeLoad, firstFrame }
  end
  Note over O,T: Любое исключение на загрузке или отрисовке → fallback «Модуль недоступен»<br/>и mount:error { phase: load | render }. Остальная страница работает.
```

Состояния outlet (атрибут `state` и событие `mfe-outlet-state`):

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> loading: remote задан
  loading --> ready: элемент отрисован
  loading --> denied: политика запретила
  loading --> error: загрузка, контракт, register() или render упали
  ready --> loading: сменили remote
  error --> loading: сменили remote / повторный заход
  denied --> loading: сменили remote
  ready --> idle: remote снят
  error --> idle: remote снят
  denied --> idle: remote снят
```

Если `remote` меняется во время загрузки, ответ старой загрузки отбрасывается
(счётчик `generation`), поэтому быстрая навигация не монтирует не тот ремоут.

## 5. Сценарий: три демо-ремоута взаимодействуют

Страница обзора: accounts и payments рядом. Пользователь выбирает счёт в accounts, payments
показывает его как счёт списания, потом переход в legacy-отчёты.

```mermaid
sequenceDiagram
  autonumber
  actor U as Пользователь
  participant A as mfe-accounts (rwc, ui 0.2)
  participant D as document (шина)
  participant H as Хост (store)
  participant P as mfe-payments (rwc, ui 0.1)
  participant Rt as HostRouter
  participant Lg as mfe-legacy-react

  U->>A: клик по счёту
  A->>D: publish("account:selected", { accountId, title })
  D->>H: подписка хоста
  H->>H: store.set({ selected })
  H-->>A: props.platform (подсветка выбранного)
  H-->>P: props.platform → «Счёт списания: …»

  U->>P: «К счетам»
  P->>D: dispatchEvent(navigateEvent("/accounts"))
  D->>Rt: platform:navigate
  Rt->>Rt: history.pushState + popstate
  Rt->>H: onRoute → outlet.remote = "accounts"

  U->>H: пункт меню «Отчёты»
  H->>Rt: navigate("/legacy")
  Rt->>H: onRoute → outlet.remote = "legacy"
  H-->>Lg: монтирование, props.platform
  Lg->>Lg: показывает selected.title из того же стора
```

## 6. Несколько версий UI-кита на одной странице

Реестр выбирает постфикс по линии совместимости версии, кит регистрирует теги сам.

```mermaid
flowchart LR
  A["accounts<br/>@rwcjs/ui 0.2.0-next"] -- "useKit()" --> R
  P["payments<br/>@rwcjs/ui 0.1.0"] -- "useKit()" --> R
  X["будущий ремоут<br/>@rwcjs/ui 0.1.x"] -. "useKit()" .-> R

  R{"Реестр<br/>postfixFor(kit, version)<br/>+ beforeRegister"}

  R -- "v0-2: registered" --> T2["rwc-button-v0-2, …"]
  R -- "v0-1: registered" --> T1["rwc-button-v0-1, …"]
  R -. "v0-1: reused<br/>(тот же класс)<br/>conflict<br/>(другая сборка)" .-> T1

  R --> rec[("records():<br/>@rwcjs/ui v0-2 → accounts<br/>@rwcjs/ui v0-1 → payments")]
```

`denied` или `conflict` превращается в исключение из `register()` — outlet показывает
fallback вместо полуработающего ремоута.

## 7. Точки расширения

Интерфейсы объявлены в `@mfe/contract`. Ядро везёт реализации по умолчанию; свои
подключаются параметрами, без форка.

```mermaid
flowchart LR
  subgraph core["Ядро"]
    outlet["#lt;mfe-outlet#gt;"]
    reg["Реестр"]
    man["RemoteManifest.extra"]
  end

  subgraph ext["Интерфейсы"]
    OT["ObservabilityTransport.send()"]
    PH["PolicyHook<br/>beforeMount / beforeRegister"]
    EX["extra: Record#lt;string, unknown#gt;"]
  end

  subgraph impl["Реализации"]
    deft["по умолчанию:<br/>console + memory"]
    nopol["по умолчанию:<br/>политик нет, всё разрешено"]
    own["свои: приёмник событий,<br/>правила, метаданные"]
  end

  outlet --> OT
  reg --> OT
  outlet --> PH
  reg --> PH
  man --> EX
  OT --> deft
  PH --> nopol
  OT -.-> own
  PH -.-> own
  EX -.-> own
```

## 8. Подключение нового ремоута

Код хоста не меняется — только конфигурация.

```mermaid
flowchart TB
  subgraph team["Команда ремоута"]
    a1["manifest.ts<br/>name, tag, routes, requires, extra"]
    a2["entry.ts<br/>manifest + идемпотентная register()"]
    a3["rsbuild.config.ts<br/>defineRemoteConfig({ name, port, kits })"]
    a4["деплой → mf-manifest.json по адресу"]
    a1 --> a2 --> a3 --> a4
  end

  subgraph platform["Хост"]
    b1["platform.config.json<br/>remotes += { name, entry }<br/>nav / overview — по желанию"]
    b2["таблица маршрутов строится<br/>из нового манифеста при старте"]
    b1 --> b2
  end

  a4 --> b1
```

## 9. Принципы и решения

**Граница ремоута — кастомный элемент.** Атрибуты и свойства на вход, `CustomEvent` на выход.
Прямых импортов между ремоутами нет. Бриджа под конкретный фреймворк нет: адаптер нужен
только тому, кто сам не кастомный элемент (React).

**Историю браузера пишет только хост.** Внутри своего `basename` ремоут навигирует сам, на
чужой маршрут — просит событием. Два роутера, пишущих в одну историю, — самый частый способ
сломать такую платформу.

**Имена тегов строит кит, а не платформа.** Реестр выбирает постфикс, ведёт учёт и применяет
политики; второго места, где склеивается имя тега, нет (это проверяет тест).

**Ядро не зависит от UI-фреймворков и не ходит в сеть.** Единственные запросы — за кодом
ремоутов по адресам из конфигурации.

### Почему ремоуты ничего не шарят

Замер (`experiments/r4/measure.ts`): страница обзора с двумя ремоутами на rwc.

| Режим | host | accounts | payments | Всего |
| --- | ---: | ---: | ---: | ---: |
| Изоляция (по умолчанию) | 127.5 KB | 209.1 KB | 209.0 KB | **545.7 KB** |
| Общий синглтон `@rwcjs/core` (`MFE_SHARE_CORE=1`) | 129.2 KB | 196.0 KB | 217.8 KB | **543.0 KB** |

Общий core экономит 1.2% JS страницы, но привязывает все ремоуты к одному мажору фреймворка:
обновление снова становится общим релизом всех команд. Основной вес ремоута — рантайм Module
Federation (около 118 KB), а не фреймворк. `provide`/`inject` через границу ремоутов с
разными копиями core не работает, поэтому общее состояние раздаётся свойствами и событиями.

### Версии контракта

Хост поддерживает текущий мажор контракта и предыдущий (N и N−1). Ремоут на N−1 продолжает
монтироваться, ремоут на неизвестной версии получает `mount:error` и fallback. Поддержка N−1
снимается только в мажорном релизе `host-runtime`. Сейчас контракт один (`1`), окно
задаётся параметром `contractVersions` у `defineMfeOutlet`.

### Тема и локаль

Приходят в составе `PlatformState` свойством `platform`, отдельных атрибутов нет: один
канал, типизированный, и значение есть уже при первой отрисовке. Для CSS хост дополнительно
ставит `data-theme` на `<html>`.

### Shadow DOM у `<mfe-outlet>`

Нет. Изоляцию стилей выбирает сам ремоут на своём элементе (React-адаптер по умолчанию рендерит
в shadow root). Outlet в light DOM не мешает всплытию событий ремоута, а хост стилизует
свой fallback обычным CSS. Общие `customElements` и `document` shadow root у outlet всё равно
не изолировал бы.

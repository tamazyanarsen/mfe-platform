# Architecture

English · [Русский](../architecture.md)

The diagrams are Mermaid: GitHub renders them right in this file, and they are edited as text next to the code.
Contract details — [contract.md](contract.md), tools for teams —
[development.md](development.md). Principles and decisions taken — in
[section 9](#9-principles-and-decisions).

## 1. Packages and dependencies

Who imports whom at build time. Arrows go only from outer layers to the core. CI
(`scripts/check-boundaries.ts`) checks two rules: the core knows nothing about UI frameworks and nothing about
adapters and applications.

```mermaid
flowchart BT
  subgraph core["Core — no UI frameworks"]
    contract["@mfe-platform/contract<br/><small>types, manifest, navigation,<br/>bus topics, extension points</small>"]
    runtime["@mfe-platform/host-runtime<br/><small>#lt;mfe-outlet#gt;, MF loader,<br/>router, transports</small>"]
    registry["@mfe-platform/registry<br/><small>versioned tags</small>"]
    bus["@mfe-platform/bus<br/><small>bus and store</small>"]
  end

  subgraph adapters["Adapters and tools"]
    arwc["@mfe-platform/adapter-rwc"]
    areact["@mfe-platform/adapter-react"]
    testing["@mfe-platform/testing<br/><small>mountRemote, checkRemote</small>"]
    devtools["@mfe-platform/devtools<br/><small>debug panel</small>"]
  end

  subgraph apps["Applications"]
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
  testing --> runtime
  devtools --> registry

  host --> runtime
  host --> registry
  host --> bus
  host --> mf
  host --> devtools

  acc --> arwc
  acc --> bus
  acc --> contract
  pay --> arwc
  pay --> bus
  pay --> contract
  leg --> areact
  leg --> contract
  acc & pay & leg -. "tests" .-> testing
```

## 2. What runs on the page

One document, one host, remotes from separate URLs. Each remote has its own copy of the core
packages (Module Federation shares nothing), so shared objects live not in modules but in
places common to all copies: `document` for the bus and `Symbol.for(...)` in `globalThis` for the registry.

```mermaid
flowchart LR
  subgraph servers["Servers (dev)"]
    s0["host :3000"]
    s1["accounts :3001<br/>mf-manifest.json"]
    s2["payments :3002<br/>mf-manifest.json"]
    s3["legacy :3003<br/>mf-manifest.json"]
  end

  subgraph page["Browser page"]
    direction TB
    subgraph hostbox["Host"]
      cfg["platform.config.json<br/><small>read at startup:<br/>remotes, nav, overview</small>"]
      ovr["?mfe-override<br/><small>URL override,<br/>localhost only</small>"]
      links["interceptLinks<br/><small>links + prefetch</small>"]
      router["HostRouter<br/><small>sole owner of history</small>"]
      store["Store#lt;PlatformState#gt;<br/><small>session, selected, theme, locale</small>"]
      loader["FederationLoader"]
      tr["Transports<br/><small>console + memory → mfe.events()</small>"]
      dt["@mfe-platform/devtools<br/><small>Alt+Shift+D</small>"]
    end

    subgraph outlets["#lt;mfe-outlet#gt; × N"]
      o1["outlet remote=accounts"]
      o2["outlet remote=payments"]
      o3["outlet remote=legacy"]
    end

    e1["#lt;mfe-accounts#gt;"]
    e2["#lt;mfe-payments#gt;"]
    e3["#lt;mfe-legacy-react#gt;<br/><small>React in a shadow root</small>"]

    doc{{"document<br/><small>bus: CustomEvent mfe-bus:*<br/>platform:navigate</small>"}}
    reg{{"globalThis[mfe-platform.registry]<br/><small>tracking of kits and postfixes</small>"}}
  end

  s0 -- "platform.config.json" --> cfg
  cfg --> ovr --> loader
  loader -- "./manifest, ./entry" --> s1 & s2 & s3
  router -- "remote, basename" --> o1 & o2 & o3
  store -- "props.platform" --> o1 & o2 & o3
  o1 --> e1
  o2 --> e2
  o3 --> e3
  o1 & o2 & o3 -- "mount events" --> tr
  tr --> dt
  links -- "navigate()" --> router
  links -- "loadModule() on hover" --> loader
  e1 & e2 & e3 -- "click on #lt;a href#gt;" --> links

  e1 & e2 -- "useKit()" --> reg
  reg -- "register:*" --> tr
  e1 & e2 & e3 <--> doc
  doc -- "store:patch, account:selected" --> store
  doc -- "platform:navigate" --> router
```

The channels between the host and a remote, in full:

| Direction | Channel | What is passed |
| --- | --- | --- |
| host → remote | `basename` attribute | the remote's route prefix |
| host → remote | `platform` property | the whole `PlatformState`, on every store change |
| remote → host | `CustomEvent("platform:navigate")` | a request to go to another remote's route |
| remote → host | plain `<a href>` link | navigation through the host router, without a reload |
| remote → host | bus, `store:patch` | a request to change shared state |
| remote ↔ remote | bus, custom topics (`account:selected`, …) | domain events |
| remote → registry | `useKit()` | kit registration, getting a postfix |
| core → outside | `ObservabilityTransport` | `mount:*`, `register:*` events |

There are no direct calls between remotes: a remote does not know who else is on the page.

## 3. Startup and first navigation

Manifests are loaded right away; they are lightweight and framework-free. A remote's code is loaded the first
time its route is hit.

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant H as Host
  participant L as FederationLoader
  participant R as Remote server
  participant Rt as HostRouter
  participant O as mfe-outlet

  B->>H: load index
  H->>B: fetch /platform.config.json (no-cache)
  Note over H: File missing or invalid →<br/>error message instead of a blank page
  H->>H: applyRemoteOverrides(remotes) — ?mfe-override
  H->>L: registerPlugins(createIntegrityPlugin) + registerRemotes(remotes)
  par for each remote
    H->>L: loadManifest(name)
    L->>R: mf-manifest.json + ./manifest
    Note over L: integrity from the configuration — check of the<br/>manifest hash, integrity on scripts
    R-->>L: { name, tag, routes, requires, extra }
  end
  Note over H: A failed or invalid manifest is logged<br/>and skipped, the rest keep working
  H->>Rt: createRouteTable(manifests), start()
  H->>H: interceptLinks({ router, prefetch })
  Rt->>H: onRoute(match, path)
  H->>O: basename = "/payments", remote = "payments"
  Note over O: next — mounting (section 4)
```

Hovering or focusing a link calls `prefetch(path)`: the remote's code is loaded in advance, and
following the link takes it from the loader cache.

If a remote's manifest failed to load at startup, navigating to an unknown path tries it again
(`createManifestSet().retryFailed()`, at most once every 5 seconds). Once the manifest appears, the host
replaces the route table (`router.replaceTable`), and the remote opens without a reload.

## 4. Mounting a remote in `<mfe-outlet>`

```mermaid
sequenceDiagram
  autonumber
  participant O as mfe-outlet
  participant L as Loader
  participant P as PolicyHook[]
  participant M as Remote module (./entry)
  participant Reg as Registry
  participant T as Transport

  O->>T: mount:start
  O->>O: fallback «Loading…»
  O->>L: loadManifest(remote) — from cache
  O->>O: validateManifest, contractVersion ∈ supported
  O->>P: beforeMount({ manifest, mountId })
  alt denied
    P-->>O: { allow: false, reason }
    O->>T: mount:denied
  else allowed
    O->>L: loadModule(remote)
    L-->>M: heavy code
    O->>T: mount:code-loaded { codeLoad }
    O->>O: module.manifest.tag == manifest.tag
    O->>M: register()
    M->>Reg: useKit({ kit, version, consumer })
    Reg-->>M: postfix "v0-1" → tags rwc-*-v0-1
    M->>M: customElements.define(manifest.tag)
    O->>O: createElement(tag), basename, props, insert
    O->>T: mount:ready { codeLoad, firstFrame }
  end
  Note over O,T: Any exception during load or render → fallback «Module unavailable»<br/>and mount:error { phase: load | render }. The rest of the page keeps working.
```

Outlet states (the `state` attribute and the `mfe-outlet-state` event):

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> loading: remote set
  loading --> ready: element rendered
  loading --> denied: policy denied
  loading --> error: load, contract, register() or render failed
  ready --> loading: remote changed
  error --> loading: retry() or new remote
  denied --> loading: remote changed
  ready --> idle: remote unset
  error --> idle: remote unset
  denied --> idle: remote unset
```

If `remote` changes during loading, the response of the old load is discarded
(the `generation` counter), so fast navigation does not mount the wrong remote.

After an error the fallback receives `retry`, and the outlet has a `retry()` method: loading
is repeated with a new `mountId`. The loader does not cache failed loads, so the retry
really goes to the network.

## 5. Scenario: three demo remotes interact

The overview page: accounts and payments side by side. The user selects an account in accounts, payments
shows it as the debit account, then the user navigates to the legacy reports.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant A as mfe-accounts (rwc, ui 0.2)
  participant D as document (bus)
  participant H as Host (store)
  participant P as mfe-payments (rwc, ui 0.1)
  participant Rt as HostRouter
  participant Lg as mfe-legacy-react

  U->>A: click on an account
  A->>D: publish("account:selected", { accountId, title })
  D->>H: host subscription
  H->>H: store.set({ selected })
  H-->>A: props.platform (highlight the selected one)
  H-->>P: props.platform → «Debit account: …»

  U->>P: «To accounts»
  P->>D: dispatchEvent(navigateEvent("/accounts"))
  D->>Rt: platform:navigate
  Rt->>Rt: history.pushState + popstate
  Rt->>H: onRoute → outlet.remote = "accounts"

  U->>H: menu item «Reports»
  H->>Rt: navigate("/legacy")
  Rt->>H: onRoute → outlet.remote = "legacy"
  H-->>Lg: mounting, props.platform
  Lg->>Lg: shows selected.title from the same store
```

## 6. Several UI kit versions on one page

The registry picks a postfix by the version's compatibility line; the kit registers the tags itself.

```mermaid
flowchart LR
  A["accounts<br/>@rwcjs/ui 0.2.0-next"] -- "useKit()" --> R
  P["payments<br/>@rwcjs/ui 0.1.0"] -- "useKit()" --> R
  X["probe (test)<br/>@rwcjs/ui 0.1.0"] -- "useKit()" --> R

  R{"Registry<br/>postfixFor(kit, version)<br/>+ beforeRegister"}

  R -- "v0-2: registered" --> T2["rwc-button-v0-2, …"]
  R -- "v0-1: registered" --> T1["rwc-button-v0-1, …"]
  R -- "v0-1: reused<br/>(shared kit instance)" --> T1

  R --> rec[("records():<br/>@rwcjs/ui v0-2 → accounts<br/>@rwcjs/ui v0-1 → payments, probe")]
```

payments and probe are built with `@rwcjs/ui` of the same line, so Module Federation gives both
one instance of the kit and of `@rwcjs/core` (modules shared by compatibility line), and the registry
marks the second consumer as `reused`. accounts on the 0.2 line gets its own instance.
Without a shared kit, two builds with the same postfix would result in `conflict`.

`denied` or `conflict` becomes an exception from `register()` — the outlet shows a
fallback instead of a half-working remote.

## 7. Extension points

The interfaces are declared in `@mfe-platform/contract`. The core ships default implementations; your own
are plugged in through parameters, without a fork.

```mermaid
flowchart LR
  subgraph core["Core"]
    outlet["#lt;mfe-outlet#gt;"]
    reg["Registry"]
    man["RemoteManifest.extra"]
  end

  subgraph ext["Interfaces"]
    OT["ObservabilityTransport.send()"]
    PH["PolicyHook<br/>beforeMount / beforeRegister"]
    EX["extra: Record#lt;string, unknown#gt;"]
  end

  subgraph impl["Implementations"]
    deft["default:<br/>console + memory"]
    nopol["default:<br/>no policies, everything allowed"]
    own["your own: event sink,<br/>rules, metadata"]
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

## 8. Adding a new remote

The host code and its build do not change — only the JSON configuration file.

```mermaid
flowchart TB
  subgraph team["Remote team"]
    a0["bun run create:remote cards<br/>--template vanilla | rwc | react"]
    a1["manifest.ts<br/>name, tag, routes, requires, extra"]
    a2["entry.ts<br/>manifest + idempotent register()"]
    a3["test/contract.test.ts<br/>checkRemote from @mfe-platform/testing"]
    a5["development on the staging environment:<br/>?mfe-override=cards=http://localhost:3004/…"]
    a4["deploy → mf-manifest.json at a URL"]
    a0 --> a1 --> a2 --> a3 --> a5 --> a4
  end

  subgraph platform["Host"]
    b1["public/platform.config.json<br/>remotes += { name, entry }<br/>nav / overview — optional"]
    b2["on the next page load<br/>the route table is built<br/>from the new manifest"]
    b1 --> b2
  end

  a4 --> b1
```

Details on the generator, tests, override and the debug panel — [development.md](development.md).

## 9. Principles and decisions

**The remote boundary is a custom element.** Attributes and properties in, `CustomEvent` out.
There are no direct imports between remotes. There is no bridge for a specific framework: an adapter is needed
only by something that is not a custom element itself (React).

**Only the host writes browser history.** Within its own `basename` a remote navigates by itself; for
another remote's route it asks with an event. Two routers writing to one history are the most common way
to break a platform like this.

**Tag names are built by the kit, not by the platform.** The registry picks the postfix, keeps track and applies
policies; there is no second place where a tag name is assembled (a test checks this).

**The core does not depend on UI frameworks and does not go to the network.** The only requests are for
the configuration and for remote code at the URLs from the configuration.

**A remote name is a JS identifier.** It is also the Module Federation container name, and MF requires
an identifier: `credit_cards`, not `credit-cards`. `validateManifest` and the configuration
check reject other names.

### What is shared and what is not

There is one rule: only compatible code is shared, and there is no singleton anywhere. A singleton would tie all
remotes to one version, and an upgrade would become a joint release of all teams again.

| What | How | Why |
| --- | --- | --- |
| Module Federation runtime | in production remotes take it from the host (`sharedRuntime`) | it is platform infrastructure; about 17.6 KB gzip saved on each remote |
| UI kit and `@rwcjs/core` | a shared instance for remotes of one line (`^version`) | one line — the same tags; without this, two builds of the kit conflict |
| React | each remote has its own copy | isolation matters more than size; there are usually few React remotes on a page |
| Everything else | the remote's own | independent upgrades |

The cost of the shared runtime: the major version of `@module-federation/*` must match in the host and the remotes. In dev
a remote ships the runtime itself and opens without a host.

Why not a singleton core — measurement (`experiments/singleton-core/measure.ts`, before the shared MF runtime):

| Mode | host | accounts | payments | Total |
| --- | ---: | ---: | ---: | ---: |
| Isolation | 127.5 KB | 209.1 KB | 209.0 KB | **545.7 KB** |
| Singleton `@rwcjs/core` (`MFE_SHARE_CORE=1`) | 129.2 KB | 196.0 KB | 217.8 KB | **543.0 KB** |

A singleton saved 1.2% of the page's JS, while most of a remote's weight came from the MF runtime — so that is what
was made shared. `provide`/`inject` across the boundary of remotes with different copies of core does not work,
so shared state is distributed through properties and events.

### Remote code integrity

A bank needs a file replaced on the CDN or in transit not to be executed. The chain of hashes
starts in the host configuration: `remotes[].integrity` is the hash of `mf-manifest.json`, and the
manifest holds the hashes of remoteEntry and of every chunk (the remote build writes them). The host checks the
manifest and sets `integrity` on every remote script; a file from the URL of a checked remote
that is not in the table is blocked. The bundler's SRI did not help here: remote chunks are loaded by
the host's MF runtime, not by the remote's runtime.

### Permissions on the shared store

A remote requests changes with an event from its own element, and the host knows from the outlet who is asking.
Permissions are in the host configuration; by default no one changes the session. This is protection against mistakes and
hidden coupling, not a security boundary: remote code runs on the same page and
could dispatch an event from another element. Integrity protects against malicious code.

### Contract versions

The host supports the current contract major version and the previous one (N and N−1). A remote on N−1 keeps
mounting; a remote on an unknown version gets `mount:error` and a fallback. Support for N−1
is dropped only in a major release of `host-runtime`. Right now there is one contract (`1`); the window
is set by the `contractVersions` parameter of `defineMfeOutlet`.

### Theme and locale

They come as part of `PlatformState` in the `platform` property; there are no separate attributes: one
channel, typed, and the value is already there at the first render. For CSS the host additionally
sets `data-theme` on `<html>`.

### Remote override only for local URLs

`?mfe-override` loads code onto the page from a URL taken from the page URL. If any URL were allowed, a link
with the parameter would become a way to run someone else's code in the host's context. So by default
only `localhost`, `127.0.0.1` and `[::1]` are allowed: an override is useful to a developer on their
machine and useless to an attacker. The host can extend the list (for example, with staging environment URLs).

For the same reason an override may also add a remote that is not in the configuration: the new remote
still loads only from the local machine. A host that does not need this passes `allowNew: false`.

### Link interception

The host intercepts clicks on `<a>` on `document`, after the remotes' handlers. If a remote's router
has already handled the link (`preventDefault`), the host leaves it alone. Links that must
reload the page (a download, another application on the same domain) are marked with
`rel="external"` or `data-mfe-reload`.

### Shadow DOM on `<mfe-outlet>`

No. The remote chooses style isolation itself on its own element (the React adapter renders
into a shadow root by default). An outlet in light DOM does not interfere with the bubbling of the remote's events, and the host styles
its fallback with plain CSS. A shadow root on the outlet would not isolate the shared `customElements` and `document`
anyway.

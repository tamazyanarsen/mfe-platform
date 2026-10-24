# Remote contract

English · [Русский](../contract.md)

Contract version: `CONTRACT_VERSION = 1` (`@mfe/contract`). The contract knows nothing about rwc,
React, or the bundler.

## What a remote exposes

| Module | Exports | When it is loaded |
| --- | --- | --- |
| `./manifest` | `manifest: RemoteManifest` | in advance, the host builds the route table from it |
| `./entry` | `manifest`, `register()` | on the first navigation to the remote's route |

`./manifest` must be lightweight: no framework or UI kit imports. The module names are
`REMOTE_EXPOSES` in `@mfe/contract`.

```ts
export interface RemoteManifest {
  readonly contractVersion: number;  // CONTRACT_VERSION the remote was built with
  readonly name: string;             // MF container name, a JS identifier: "accounts"
  readonly version?: string;         // remote build version, for observability
  readonly tag: string;              // actual element tag
  readonly routes: readonly string[];// "/accounts" and "/accounts/*"
  readonly requires?: { readonly [pkg: string]: string };  // semver ranges
  readonly extra?: Readonly<Record<string, unknown>>;      // consumer data
}

export interface RemoteModule {
  readonly manifest: RemoteManifest;
  register(): Promise<void> | void;  // idempotent
}
```

- **`name` is a JS identifier** (`credit_cards`, not `credit-cards`): it is also the Module
  Federation container name, and MF requires an identifier.
- **`register()` is idempotent.** A second call is a no-op, not an exception. After it,
  `customElements.get(manifest.tag)` must return the class.
- **`tag` in `./manifest` and in `./entry` match** — otherwise the host shows an error.
- **The core does not read or validate `extra`**, it only carries it into observability events.
  This is where the owner, team, and cost center go.
- **Routes** are exact paths and `/*` prefixes, always with a leading `/`; with other patterns the manifest
  fails validation. The longest prefix wins. If two remotes claim the same pattern,
  it goes to the one that comes first in the configuration, and the host writes a warning to the console.

## Remote element

The host creates the `manifest.tag` element inside `<mfe-outlet>` (light DOM, no shadow root on the
outlet) and passes it:

| Input | How | What |
| --- | --- | --- |
| `basename` | attribute | the remote's route prefix: `/accounts` |
| `platform` | property (`PLATFORM_PROP`) | `PlatformState`: session, selected account, theme, locale |

Output is a `CustomEvent` with `bubbles: true, composed: true`.

## Navigation

Only the host writes browser history.

- Within its own `basename` a remote navigates with its own router.
- For another remote's route — with an event: `element.dispatchEvent(navigateEvent("/payments/new"))`
  (type `platform:navigate`, `detail: { to, replace? }`).

- A plain `<a href="/payments">` link also works: the host intercepts the click and navigates
  without a reload, including for a link inside shadow DOM. A link already handled by
  the remote's router (`preventDefault`) is left alone by the host. A full reload — `rel="external"`
  or `data-mfe-reload`.
- The host navigates outside only via `http(s)`: `javascript:` and `data:` in `platform:navigate`
  are blocked.

The host notices `pushState`/`replaceState` from remote routers and recomputes the route, and after
its own navigation it dispatches `popstate` so that remote routers see the new URL.

## Bus and shared state

- State lives in the host and arrives in the `platform` property. A remote requests changes
  with an event from its own element: `this.dispatchEvent(patchEvent({ theme: "dark" }))`
  (`platform:patch`). The host learns from the outlet which remote it is and applies only the fields
  allowed to it in `storeAccess` of the host configuration; by default no one changes the session.
  Denied fields are dropped, and a `store:denied` event goes to the transport.
- The `store:patch` topic on the bus also works, but it is anonymous: from it the host applies only
  the fields open to all remotes (`"*"` in `storeAccess`).
- Store permissions are protection against mistakes and hidden coupling, not a security boundary: remote
  code runs on the same page.
- The bus (`@mfe/bus`): `publish(topic, payload)` / `subscribe(topic, handler, { signal })`
  on top of `CustomEvent` on `document`. Topics and payloads are the `PlatformTopics` interface;
  custom topics are added through declaration merging.
- A subscription lives while the element is connected: `createSubscriptions()` in a plain custom
  element, `subscribeInRender()` from `@mfe/adapter-rwc` in an rwc component.

## UI kit versions

A remote registers the kit through the registry, not directly:

```ts
import { useKit } from "@mfe/adapter-rwc";
import * as ui from "@rwcjs/ui";

useKit({ name: "@rwcjs/ui", version: "0.2.0", consumer: manifest.name, kit: ui, control: ui.Button });
```

The postfix is the compatibility line: `v<major>`, for 0.x — `v0-<minor>`. Remotes on the same
line get one kit instance: `defineRemoteConfig` shares the kits from `kits` and
`@rwcjs/core` through Module Federation by the same line (`^version`, not a singleton), and the registry
marks the second consumer as `reused`. Each remote has its own copy of incompatible versions.
If a remote is built without a shared kit (`shareKits: false`), a different build with the same postfix is a
conflict, and the remote's `register()` fails with a clear message.

## Extension points

| Point | Where | What for |
| --- | --- | --- |
| `ObservabilityTransport` | `defineMfeOutlet({ transport })`, `registry.setTransport()` | where events go |
| `PolicyHook.beforeMount` | `defineMfeOutlet({ policies })` | deny mounting |
| `PolicyHook.beforeRegister` | `registry.use(policy)` | deny registration of a kit version |
| `manifest.extra` | remote manifest | remote metadata (team, owner) without a schema change |

## Observability events

| Event | When |
| --- | --- |
| `mount:start`, `mount:code-loaded`, `mount:ready` | mounting stages, with `timings` |
| `mount:error`, `mount:denied` | load or render error, policy denial |
| `register:ok`, `register:denied` | registration of a kit version, including `reused` |
| `store:denied` | a remote requested a store field it has no permission for |
| `integrity:denied` | a remote's manifest or file failed the integrity check |

## `<mfe-outlet>` states

`idle` → `loading` → `ready` | `error` | `denied`. The state is reflected in the `state` attribute
and the `mfe-outlet-state` event. Load errors and render exceptions stay inside the
outlet: a fallback is shown, and a `mount:error` event goes to the transport with the fields `name`,
`version`, `mountId`, `route`, `contractVersion`, `extra`, `details.phase`.

After an error `outlet.retry()` loads the remote again; the fallback receives the same call as
`retry` in `FallbackContext` — the host renders the «Повторить» (Retry) button from it.

## Contract check

`checkRemote` from `@mfe/testing` checks a remote the same way the host does — without a host or network:
the manifest, agreement between `./manifest` and `./entry`, the contract version, idempotency of `register()`
and mounting into a real `<mfe-outlet>`. Details — [development.md](development.md#contract-test-mfetesting).

# Developing on the platform

English · [Русский](../development.md)

How to create a new remote, check it without a host, plug your local remote into the staging environment
or production, and figure out what is happening on the page. The remote contract —
[contract.md](contract.md), diagrams — [architecture.md](architecture.md).

## A new remote with one command

```bash
bun run create:remote cards --template rwc --title "Карты"
bun install
bun run dev
```

| Parameter | Default | What it does |
| --- | --- | --- |
| `<name>` | — | remote name: lowercase letters, digits and `_` (`cards`, `credit_cards`) |
| `--template` | `vanilla` | `vanilla` — a bare custom element, `rwc` — an rwc component, `react` — React via `@mfe/adapter-react` |
| `--port` | the next one after those in use | dev server port |
| `--title` | name in PascalCase | page title and navigation item title |
| `--no-nav` | — | do not add a navigation item (widget remote) |

The generator creates `apps/mfe-<name>/` (manifest, entry, view, rsbuild config,
contract test, README) and adds the remote and a navigation item to
`apps/host/public/platform.config.json`. `bun run dev` finds the applications in `apps/` by itself.

The remote name is also the Module Federation container name, so it must be a
JS identifier: a hyphen is not allowed. The generator builds the element tag with a hyphen
(`credit_cards` → `<mfe-credit-cards>`).

The templates live in `templates/`. `bun run check:templates` generates each one, installs it, runs
its test and builds it, and then restores the repository to how it was; the same check runs in CI.

## Contract test: `@mfe/testing`

A remote is checked the same way the host will check it — without a host, Module Federation, or network:

```ts
import { expect, test } from "bun:test";
import { checkRemote, mountRemote } from "@mfe/testing";
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

`checkRemote` returns a list of problems; an empty list means the remote will plug in:

- the manifest passes `validateManifest`;
- `./manifest` and `./entry` agree on `name`, `tag`, `contractVersion`;
- the host supports the contract version;
- `register()` is idempotent and registers `manifest.tag`;
- the element mounts into a real `<mfe-outlet>` without an error.

`mountRemote` mounts a remote through `<mfe-outlet>` and returns the element, the outlet state and
the mount events. `createMemoryLoader` is an in-memory loader for your own scenarios.

Tests need a DOM: in this repository happy-dom is set up in `scripts/test-setup.ts`. The same file has
a stub for `attachInternals`, which happy-dom lacks: without it the UI kit's form components
cannot be created. Form behavior is checked by e2e tests in the browser.

## Remote override

Open the staging environment or production and plug in your local remote without touching the others:

```
https://platform.bank.example/payments?mfe-override=payments=http://localhost:3002/mf-manifest.json
```

- The parameter can be repeated — one per remote.
- The override is remembered per tab (`sessionStorage`) and survives navigation and reloads.
- `?mfe-override=reset` removes all overrides.
- Active overrides are shown in the host header with an `override: payments` badge and in the debug panel.

An override loads foreign code onto the page, so only addresses of this machine are allowed:
`localhost`, `127.0.0.1`, `[::1]`. Others are discarded with a warning in the console.
The host can set its own list: `applyRemoteOverrides(remotes, { allow: (url) => ... })`.
### A new remote that is not in the configuration yet

An override with an unknown name adds the remote: a new remote is developed right on the staging
environment or in production, before it is added to `platform.config.json`.

```
https://platform.bank.example/?mfe-override=cards=http://localhost:3004/mf-manifest.json
```

- The host loads the new remote's manifest together with the others, and its routes
  (`/cards`, `/cards/*`) work as usual.
- A temporary `cards (override)` item appears in the navigation and leads to the remote's first
  route; the override badge marks it with a plus: `override: +cards`.
- The same restrictions apply: local addresses only, the name must be a JS identifier.
- A host that does not need this turns it off: `applyRemoteOverrides(remotes, { allowNew: false })`.

## Debug panel: `@mfe/devtools`

The on-page panel shows:

- remotes: state, version, code load time and time to first frame, number of mounts and errors;
- UI kit versions: postfix, version, who uses it;
- active overrides;
- recent mount errors and registration denials.

It opens with **Alt+Shift+D**. In the host dev build the panel is always enabled; on the staging environment
and in production — with the `?mfe-devtools` parameter (remembered per tab). The data comes from core
and registry events on the page; there is no network.

Hooking it up in your own host — as one more observability transport:

```ts
import { createDevtools } from "@mfe/devtools";

const devtools = createDevtools({ overrides });
defineMfeOutlet({ loader, transport: combineTransports(consoleTransport, devtools.transport) });
getPlatformRegistry().setTransport(devtools.transport);
```

From the browser console: `mfe.events()`, `mfe.registry.records()`, `mfe.devtools.open()`.

## Host configuration at startup

The host reads `platform.config.json` on every startup (`cache: no-cache`), not at build time.
A new remote, a new URL or a navigation item is a deployment of one JSON file next to the host,
without a rebuild.

```json
{
  "remotes": [{ "name": "accounts", "entry": "https://cdn.bank.example/accounts/mf-manifest.json" }],
  "nav": [{ "href": "/accounts", "title": "Счета" }],
  "overview": [{ "remote": "accounts", "basename": "/accounts" }]
}
```

The file is validated on load (`validateRemoteEntries` from `@mfe/host-runtime` and the host's
own check): on an error the host shows a message instead of a blank page, and the console lists all
problems at once. A remote manifest that fails `validateManifest` does not get into the route table;
the other remotes keep working.

## Links, prefetch and retry

- **Links.** Plain `<a href="/payments">` links in the host and in remotes — including inside shadow
  DOM — go through the host router, without a page reload. Left to the browser are links with
  `target`, `download`, `rel="external"`, `data-mfe-reload`, to another origin, clicks with
  modifier keys, and anchors on the same page. Links already handled by a remote's router
  (`preventDefault`) are left alone by the host.
- **Prefetch.** Hovering or focusing an internal link loads in advance the code of the remote
  whose route it opens. `register()` is not called at that point.
- **Retry.** If a remote fails to load, the fallback has a «Повторить» (Retry) button; programmatically —
  `outlet.retry()`. Each attempt is a new mount with its own `mountId`.

## Remote code integrity

A remote file replaced on the CDN or in transit is not executed: the host checks a chain of hashes
from its configuration to every chunk.

1. The remote's production build (`bun run build`) adds to `dist/mf-manifest.json` the hashes of all
   JS and CSS files and puts `dist/mf-manifest.json.integrity` next to it — the hash of the manifest itself.
2. On deployment this hash is added to the host configuration:

   ```json
   { "name": "accounts", "entry": "https://cdn.bank.example/accounts/mf-manifest.json",
     "integrity": "sha384-…" }
   ```

3. The host (`createIntegrityPlugin` from `@mfe/host-runtime`) checks the manifest against this hash and
   sets `integrity` and `crossorigin="anonymous"` on remoteEntry and every chunk. A file from the URL
   of a checked remote that is not in the hash table is blocked. A violation is an
   `integrity:denied` event in the transport and in the debug panel.

What is needed from the infrastructure:

- **CORS on the remote's CDN.** SRI for a file from another origin works only with a CORS request:
  the remote's server must send `Access-Control-Allow-Origin` for the host's address.
- **The hash changes with every build.** Deploying a checked remote means a new file and a new
  entry in the host configuration. Without `integrity` a remote loads as before, so the check
  can be enabled one remote at a time.
- **Host CSP.** `script-src` with the list of remote addresses is recommended; the platform
  adds no inline scripts.

Checking in the browser — `bun run test:e2e:prod`: a production build, with a replaced manifest,
remoteEntry and chunk.

## Permissions on the shared store

A remote requests a change to shared state with an event from its own element:

```ts
import { patchEvent } from "@mfe/contract";

this.dispatchEvent(patchEvent({ theme: "dark" }));
```

The host learns from the outlet which remote it is and applies only the fields allowed to it. Permissions are
in `platform.config.json`:

```json
"storeAccess": { "*": ["selected", "theme", "locale"], "auth": ["session"] }
```

`"*"` is the fields open to all remotes; permissions add up. Without `storeAccess`,
`DEFAULT_STORE_ACCESS` applies: everything except `session` is open to everyone. Denied fields are dropped,
and a `store:denied` event goes to the transport. The `store:patch` topic on the bus is anonymous and gets
only the `"*"` fields.

## Size budget

After the build, `bun run check:size` computes for each remote what the host loads for it
(from `mf-manifest.json`: remoteEntry, the `./manifest` and `./entry` chunks, shared modules),
and compares it with the budget from the remote's `package.json`:

```json
"mfe": { "sizeBudget": { "gzipKb": 50 } }
```

A remote over budget fails CI. The `create:remote` templates come with a budget, and
`check:templates` checks it too.

## Shared modules

`defineRemoteConfig` (config/rsbuild-remote.ts) decides what a remote shares with others:

| Option | Default | What it does |
| --- | --- | --- |
| `sharedRuntime` | `true` | in production the remote takes the Module Federation runtime from the host (about 17.6 KB gzip saved); in dev it ships its own and opens without a host |
| `shareKits` | `true` | the kits from `kits` and `@rwcjs/core` are shared with remotes on the same compatibility line — one kit instance instead of a conflict between builds |

There is no singleton: each remote has its own copy of incompatible versions. With the shared runtime the major version of
`@module-federation/*` must match in the host and the remotes.

## Checking the production build

`bun run test:e2e:prod` builds everything and runs `e2e-prod/` on preview servers: integrity,
the shared kit, the shared runtime — what dev does not have. `apps/mfe-probe` is a test remote on the same
kit line as payments; it is not in the host configuration, the tests plug it in with an override.

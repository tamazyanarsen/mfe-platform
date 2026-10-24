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
Only a remote that is already in the configuration can be overridden.

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

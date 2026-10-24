# MFE platform

English · [Русский](README.md)

A platform for applications built from many independent micro-frontends: each remote is deployed
separately, teams update versions independently, and the host assembles them into one application.

- **A contract instead of a bridge.** A remote is a custom element plus a manifest and an idempotent
  `register()`. The host mounts any remote the same way: rwc, React, anything else.
- **Several UI kit versions on one page.** The registry assigns a tag postfix by the kit's
  compatibility line (`rwc-button-v0-1` next to `rwc-button-v0-2`), keeps track of who uses which
  version, and applies policies.
- **The host owns history.** The route table is built from manifests before remote code is
  loaded; code is loaded on the first navigation or in advance, when a link is hovered. Plain
  links in remotes work without a page reload.
- **A failing remote does not bring down the page.** A load or render error stays inside
  `<mfe-outlet>`, an event goes to the observability transport, and the «Повторить» (Retry) button
  loads the remote again.
- **Configuration at startup.** The list of remotes, navigation and the overview are a JSON file next to the host:
  a new remote is added by deploying the file, without rebuilding the host.
- **Tools for teams.** A new remote with one command, a contract test without a host, overriding a
  remote with a local one right on the staging environment or in production, an on-page debug panel.
- **No network.** The runtime makes no requests other than loading remote code and configuration from
  your URLs: no telemetry, no CDN, no fonts.

The core (`contract`, `host-runtime`, `registry`, `bus`) does not depend on any UI framework —
this is checked in CI. rwc and React plug in as equal adapters.

How this beats the usual "React host + Module Federation with shared React" setup, and where the
usual setup is the better deal — [docs/en/comparison.md](docs/en/comparison.md).

## Extension

The core is extended without a fork through three points: `ObservabilityTransport` (where mount
and registration events go), `PolicyHook` (denying a mount or the registration of a kit version)
and `manifest.extra` (arbitrary remote metadata). Details — [docs/en/contract.md](docs/en/contract.md).

## Quick start

You need [bun](https://bun.sh) 1.4+ and Node.js 20.19+ or 22.12+ (a Rsbuild requirement).

```bash
bun install
bun run dev
```

Open <http://localhost:3000>. On the overview page two rwc remotes with different UI kit versions
run side by side; the navigation has a React remote. **Alt+Shift+D** opens the debug
panel: remotes, load time, kit versions, errors. In the browser console:

```js
mfe.events()              // mount events: load time, errors, manifest.extra
mfe.registry.records()    // which kit versions are registered and by whom
```

A new remote:

```bash
bun run create:remote cards --template rwc --title "Карты"   # vanilla | rwc | react
bun install && bun run dev                                   # http://localhost:3000/cards
```

Checks:

```bash
bun run ci                          # package boundaries, lint, types, unit tests, build
bun run check:templates             # create:remote templates are generated, tested, built
bunx playwright install chromium    # once
bun run test:e2e                    # end-to-end tests of the demo setup
```

## Structure

```
apps/
  host/               shell: routing, store; public/platform.config.json — remotes and navigation
  mfe-accounts/       rwc remote, @rwcjs/ui 0.2.0-next
  mfe-payments/       rwc remote, @rwcjs/ui 0.1.0
  mfe-legacy-react/   React remote
packages/
  contract/           contract types, manifest, navigation, bus topics, extension points
  host-runtime/       <mfe-outlet>, MF loader, router, links, configuration, overrides, transports
  registry/           versioned tag registration
  bus/                typed bus and store
  adapter-rwc/        kit registration through the registry, bus subscriptions from render()
  adapter-react/      wrapper custom element for a React component
  testing/            mountRemote, checkRemote — remote tests without a host
  devtools/           on-page debug panel
templates/            create:remote templates: vanilla, rwc, react
docs/                 architecture, contract, development, migration
```

## Adding a remote

1. The remote exposes two modules through Module Federation: `./manifest` (lightweight, no
   framework) and `./entry` (`manifest` + `register()`). The easiest way to start is
   `bun run create:remote`. Details — [docs/en/contract.md](docs/en/contract.md).
2. The host learns about it from `apps/host/public/platform.config.json`: the name and the URL of
   `mf-manifest.json`, and optionally a navigation item and a place on the overview page. The file is read
   at startup: neither the host code nor its build changes.

Moving an existing Module Federation setup to the contract — [docs/en/migration.md](docs/en/migration.md).

## Documents

- [docs/en/comparison.md](docs/en/comparison.md) — how the platform differs from the usual "React host + MF" setup: benefits, costs, when to choose what
- [docs/en/architecture.md](docs/en/architecture.md) — diagrams: packages, the page, mounting, remote interaction
- [docs/en/contract.md](docs/en/contract.md) — the remote contract
- [docs/en/development.md](docs/en/development.md) — new remote, tests, override, debug panel
- [docs/en/migration.md](docs/en/migration.md) — migrating an existing MF setup

## License

[Apache-2.0](LICENSE).

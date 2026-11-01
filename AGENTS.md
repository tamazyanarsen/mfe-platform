# AGENTS.md

Micro-frontend platform: a host composes independently deployed remotes into one application.
A remote is a custom element + manifest + idempotent `register()`; the host owns history, routing
and shared state. Core has no UI-framework dependency; rwc and React are peer adapters.

This file is a map and a rulebook, not a copy of the docs: details live in `docs/`. Update it when
commands, structure or invariants change. If it disagrees with code or tests, code wins — fix the
file.

## Read per task

| Task | Document |
| --- | --- |
| Understand the system: packages, page lifecycle, mounting, decisions | `docs/architecture.md` |
| Remote contract: exports, element, navigation, bus, kit versions | `docs/contract.md` |
| New remote, tests, overrides, devtools, integrity, store, size, release | `docs/development.md` |
| Move an existing MF build onto the contract | `docs/migration.md` |
| Differences from "React host + MF with shared React", when to pick what | `docs/comparison.md` |
| User-facing overview, package install, structure | `README.md` |

Docs and `README.md` are Russian (canonical); `docs/en/` and `README.en.md` are mirrors. Change
behavior — update both languages, and `README` when the change is user-visible.

## Stack

- Bun 1.4+ is the package manager and runner; Rsbuild needs Node 20.19+ or 22.12+. Never
  npm/pnpm/yarn. Lockfile `bun.lock`; CI installs with `--frozen-lockfile`.
- TypeScript strict, Rsbuild + Module Federation 2.x, Biome, `bun:test`, Playwright.
- Workspaces: `packages/*`, `apps/*`, `experiments`. Packages export TS sources
  (`exports: "./src/index.ts"`) and are not built locally; only apps produce `dist`.
- npm artifacts are built by `scripts/packages.ts` into `.npm/` (gitignored).

## Commands (repo root)

| Command | What it does |
| --- | --- |
| `bun install` | Install deps; also needed after `create:remote`. |
| `bun run dev` | All apps: host 3000, accounts 3001, payments 3002, legacy 3003, probe 3004. Ctrl+C stops everything. |
| `bun run ci` | Full gate: boundaries → lint → typecheck → unit → build → size. |
| `bun run lint` | Biome check; autofix: `bunx biome check --write .`. |
| `bun run typecheck` | `tsc --noEmit` for the whole repo. |
| `bun test` / `bun test path/to/file.test.ts` | Unit tests; filter by path. |
| `bun run test:e2e` | Playwright against the dev stand. Needs `bunx playwright install chromium` once; `bun run dev` must be stopped. |
| `bun run test:e2e:prod` | Build + preview: integrity, shared kit and runtime. |
| `bun run test:e2e:demo` | Demo as on GitHub Pages: host under `/mfe-platform/`. |
| `bun run build` | Builds `apps/*` only; required before `check:size`. |
| `bun run check:size` | gzip budget per remote from `package.json` → `mfe.sizeBudget`. |
| `bun run check:boundaries` | Core must not import frameworks, adapters or `@mfe-platform/rsbuild`. |
| `bun run check:templates` | Generates, installs, tests and builds every template; slow, temporarily mutates the repo and restores it. |
| `bun run check:packages` | Packs into `.npm/`, installs into a clean project, checks imports and types. |
| `bun run create:remote <name> --template rwc\|react\|vanilla --title "…"` | New remote + nav entry in `platform.config.json`. |
| `bun run build:demo` / `bun run serve:demo` | Static demo stand in `.demo/`. |

Single e2e: `bunx playwright test e2e/routing.e2e.ts` (dev servers must be stopped).

## Repo map

The main wiring file is `apps/host/src/index.ts`; a package's public surface is its `src/index.ts`.

| Path | What is inside |
| --- | --- |
| `apps/host/` | Shell: routing, store, bus, devtools; `public/platform.config.json` — runtime config. |
| `apps/mfe-accounts/` | rwc remote, `@rwcjs/ui` 0.2.0-next from `vendor/*.tgz`. |
| `apps/mfe-payments/` | rwc remote, kit 0.1.0 from npm. |
| `apps/mfe-legacy-react/` | React remote via `@mfe-platform/adapter-react`. |
| `apps/mfe-probe/` | e2e-only remote on payments' kit line; not in the host config. |
| `packages/contract/` | Types, manifest + validation, navigation, bus, extension points. |
| `packages/host-runtime/` | `<mfe-outlet>`, MF loader, router, links/prefetch, config, overrides, integrity, store access, transports. |
| `packages/registry/` | Versioned kit tag registration. |
| `packages/bus/` | Typed bus and store. |
| `packages/adapter-rwc/` | Kit registration via `useKit`, bus subscriptions in `render()`. |
| `packages/adapter-react/` | Custom-element wrapper for a React component. |
| `packages/testing/` | `mountRemote`, `checkRemote`, `createMemoryLoader` — remote tests without a host. |
| `packages/devtools/` | On-page debug panel (`Alt+Shift+D`). |
| `packages/rsbuild/` | `defineRemoteConfig`: exposes, shared modules, integrity hashes. |
| `templates/` | `create:remote` templates (vanilla, rwc, react), `.tmpl` suffix. |
| `scripts/` | `dev`, `create-remote`, checks, package packing, demo. |
| `e2e/`, `e2e-prod/`, `e2e-demo/` | Playwright, `*.e2e.ts` files. |
| `experiments/singleton-core/` | Measurement, not production code. |
| `vendor/` | Kit tgz for accounts; rebuilt from `grid-and-kit` (`pack:kit-next`). |

## Where to add code

- New host capability → `packages/host-runtime/src/`, export from `index.ts`, unit test.
- Contract change → `packages/contract/` + `CONTRACT_VERSION` and validation + `docs/contract.md`
  + `docs/migration.md` in both languages. Check `CONTRACT_VERSION` for the current value;
  breaking changes only with a migration.
- New framework adapter → `packages/adapter-<name>/` + `templates/remote-<name>/` + e2e.
  Never touch core.
- New remote → `bun run create:remote`, not by hand; then `bun install` and a size budget in
  `package.json`.
- Change the shape of a remote → `templates/` and `bun run check:templates`, otherwise templates
  drift from code.
- Host config schema → `packages/host-runtime/src/config.ts` + validation in
  `apps/host/src/remotes.ts` + `docs/development.md`.
- New CI check → `scripts/*.ts` + `*.test.ts` + script in `package.json` (`ci`) +
  `.github/workflows/ci.yml` + this file.

## Invariants

1. **Boundaries.** `contract`, `host-runtime`, `registry`, `bus` must not import rwc, React,
   adapters or `@mfe-platform/rsbuild`. Enforced in CI.
2. **Remote contract.** Exactly `./manifest` (lightweight, no framework) and `./entry` (`manifest`
   + `register()`) are exposed. `register()` is idempotent and registers `manifest.tag`; `name` is a
   JS identifier (`credit_cards`, not `credit-cards`); `tag` matches across both modules.
3. **Host owns history.** A remote routes inside its `basename` with its own router and asks for
   cross-remote navigation via `navigateEvent`. Never call `history.pushState` for another remote's
   route. The host intercepts links, including inside shadow DOM; foreign origins, `target` and
   `download` are left alone.
4. **Kit versions coexist.** Versioned tags (`rwc-button-v0-1`) come from the registry; kits are
   registered via `useKit`. No singleton: only a compatible kit line and the MF runtime (production)
   are shared. React stays isolated per remote.
5. **Remote failures stay contained.** Errors and denials remain inside `<mfe-outlet>`
   (`error`/`denied`, "Retry", `retry()`), and the event goes to the transport.
6. **No network beyond what is needed.** Only config and remote code from configured addresses:
   no telemetry, no third-party CDN, no fonts.
7. **Runtime config, not build-time.** `platform.config.json` is fetched with `no-cache`; remote
   addresses are never hardcoded in host code or builds.
8. **Integrity.** A production remote build appends hashes to `mf-manifest.json` and writes
   `.integrity`; the hash changes on every build. Asset URLs use `publicPath: "auto"` — never a
   hardcoded `localhost`.
9. **Shared state.** Only `patchEvent` + `storeAccess` from config. By default everything except
   `session` is open (`DEFAULT_STORE_ACCESS` lists `selected`, `theme`, `locale`); config
   `storeAccess` replaces these rights entirely instead of merging. The `store:patch` topic is
   anonymous and gets only `"*"` fields.
10. **Open core.** No "available in pro" stubs, artificial limits or license branches.
11. **Public API.** All `@mfe-platform/*` share one version; breaking changes go through
    `CHANGELOG.md` and a tag release. Avoid breaking exports and types.

## Conventions

- Docs and comments are Russian; identifiers and code are English.
- Conventional Commits with a Russian subject (`feat: …`, `fix: …`, `chore: …`); one concern per
  commit.
- Biome: double quotes, 2 spaces, width 100; Markdown is not formatted.
- Strict TS: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`
  (use `import type`), `readonly` in public types, Russian JSDoc on exported API.
- Unit tests: `bun:test`, `*.test.ts`, Russian test names, table cases via `test.each`. DOM via
  happy-dom from `scripts/test-setup.ts`; form behavior is covered only by e2e.
- E2E: `*.e2e.ts` (otherwise `bun test` picks them up); Playwright starts its own servers and
  never reuses foreign ones (`reuseExistingServer: false`).

## Traps

- `bun run build` builds apps only; `check:size` is meaningless without a build.
- happy-dom lacks `attachInternals` — stubbed in `test-setup.ts`; verify forms and the UI kit in a
  browser.
- `apps/mfe-accounts` installs the kit from `vendor/rwcjs-ui-0.2.0-next.0.tgz`. Install or build
  failures around `@rwcjs/ui` usually mean a stale tgz: rebuild it in `grid-and-kit`
  (`pack:kit-next`) and copy it into `vendor/`.
- `check:templates` is slow and temporarily edits `apps/`, `platform.config.json`, `bun.lock`; do
  not run it in parallel with `dev`, tests or edits.
- `check:packages` writes to `.npm/` (gitignored) and installs tarballs into a clean project in a
  temp dir; no manual cleanup needed.
- The demo lives under a path prefix: config and nav paths omit the prefix; `withBase` and
  `router.href()` add it. A host under a prefix is built with `MFE_BASE`, the demo with
  `MFE_DEMO_BASE`.
- Do not edit generated files or artifacts: `node_modules/`, `dist/`, `.npm/`, `.demo/`,
  `test-results/`, `playwright-report/`.
- `articles/` and `.claude/plans` are gitignored — do not commit them or treat them as repo content.
- Line endings are LF (`.gitattributes`); do not introduce CRLF.

## Done when

1. You read the doc from the table above instead of the whole repo.
2. Code and a unit test for the new behavior; docs updated in both languages, `README` when
   user-visible; `AGENTS.md` when commands or structure changed.
3. `bun run ci` is green (or you state what was skipped and why).
4. Page behavior → `bun run test:e2e`; integrity, shared runtime or kit → `test:e2e:prod`; path
   prefix and config → `test:e2e:demo`.
5. Your report lists the commands you ran and what remains unverified.

## Context

- Personal plan and current tasks: `.claude/plans/NEXT.md` if present (gitignored, not a source of
  truth).
- Strategy and decisions: `../plans/mfe-platform/` (outside the repo).
- Branch `main`; releases are tags `v<version>` after bumping every package; the demo workflow
  (`pages.yml`) rebuilds on every push to `main`.

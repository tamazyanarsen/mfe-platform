# Moving an existing Module Federation setup to the contract

English · [Русский](../migration.md)

A typical starting point: a Module Federation host with static `remotes`, remotes
expose framework components, and the host mounts them itself (often via `bridge-react`).

## 1. Remote: expose the manifest and entry

Add two modules and keep the old `exposes` until the host has moved over.

```ts
// src/manifest.ts — no framework imports
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
  "./App": "./src/App.tsx", // old expose — until the host has moved over
},
```

For an rwc remote, `register()` calls `registerXxx()` from `configCustomComponent`, and registers the kit
through `useKit` from `@mfe/adapter-rwc`.

## 2. Remote: router relative to `basename`

The host passes the prefix in the `basename` attribute. The remote's router is set up relative to it
(`createRouter(routes, { base })` in `@rwcjs/router`, `<BrowserRouter basename>` in React Router).
Navigation to other remotes' routes goes through the `platform:navigate` event, not `history.pushState`.

## 3. Host: replace manual mounting with `<mfe-outlet>`

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

Static `remotes` in the host build config are no longer needed: remotes are registered at
runtime, and the URLs live in the host configuration. It is convenient to keep it in a JSON file next to the host and
read it at startup — then a new URL does not require a rebuild:

```ts
import { loadJsonConfig, type RemoteEntry, validateRemoteEntries } from "@mfe/host-runtime";

const remotes = await loadJsonConfig<RemoteEntry[]>("/remotes.json", validateRemoteEntries);
registerRemotes(remotes);
```

A remote name is the MF container name, a JS identifier: if the old containers are named with
hyphens, rename them before the migration.

## 4. Shared dependencies

By default nothing is shared: each remote ships its own copy of the framework, and teams
upgrade it independently. If the framework used to be a singleton, before giving that up
check whether remotes pass framework context to each other (`provide`/`inject`,
React Context) — across the remote boundary it only works with a shared copy. Shared state
moves to the host store and the `platform` property. Numbers — in [architecture.md](architecture.md#why-remotes-share-nothing).

## 5. Check the remote

Add the contract test to the remote's CI — it catches mismatches before the host sees them:

```ts
import { checkRemote } from "@mfe/testing";
import * as entry from "../src/entry";
import { manifest } from "../src/manifest";

expect(await checkRemote(entry, { manifest })).toEqual([]);
```

During the migration it is convenient to plug the migrated remote into a running staging environment:
`?mfe-override=billing=http://localhost:3005/mf-manifest.json` — details in
[development.md](development.md#remote-override).

## 6. Remove the old parts

Once the host mounts all remotes through `<mfe-outlet>`, remove the old `exposes` and
`bridge-react`.

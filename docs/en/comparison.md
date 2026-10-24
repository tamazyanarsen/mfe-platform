# How the platform differs from the usual setup

English · [Русский](../comparison.md)

This document is for people choosing how to build an application out of many micro-frontends:
where the platform pays off, and where the usual setup is simpler and cheaper. How the platform
works — [architecture.md](architecture.md).

## The usual setup

This is how an application built by many teams is most often organized, in fintech and elsewhere:

- **A React host** with React Router. Section routes are declared in the host.
- **Module Federation with static `remotes`** in the host's build config.
- **Remotes export React components** (`./App`, `./Widget`). The host imports them via
  `React.lazy` and renders them inside its own tree: directly in a route or through `bridge-react`.
- **`react`, `react-dom`, the router, the design system, sometimes Redux** are declared as `shared`
  singletons: one copy on the page for everyone.
- **Shared state** is React Context or a shared Redux store that the host passes down.
- **Errors** are caught by an Error Boundary, if the host team remembered to add one.

With two or three teams that release together, this works well. Problems start when there are
many teams and they move at different speeds.

## Where the usual setup runs into limits

### One React version for everyone

A singleton `react` means one version for the whole page. Moving from React 18 to 19 (or
changing the router or state manager) becomes a joint release of all teams: nobody upgrades
until the last team is ready. The more remotes, the harder it is to agree.

**In the platform** every remote ships its own framework. A team upgrades React, rwc or anything
else at its own pace. A remote does not even have to be React: the host mounts any custom element
the same way.

### One design system version

The design system is also made a singleton, otherwise two copies conflict on the page: styles,
global registrations, custom elements with the same name. So a major UI kit upgrade is again a
joint release. The "everyone ships their own" alternative breaks on `customElements.define`: the
same tag cannot be registered twice.

**In the platform** several kit versions live on one page: the registry gives tags a postfix by
compatibility line (`rwc-button-v0-1` next to `rwc-button-v0-2`), tracks which remote uses which
version, and can forbid an outdated version with a policy. A kit migration goes team by team, not
on a single day.

### An implicit contract

In the usual setup the host–remote contract is the props of the exported component, a set of
shared context providers and the versions of shared dependencies. Nothing states what a remote
needs from the host. Incompatibilities show up at runtime: "Invalid hook call" from two copies of
React, a missing context, a failed lazy import.

**In the platform** the contract is explicit and small: a manifest (name, tag, routes, contract
version, dependencies) and an idempotent `register()`. The host checks the manifest and the
contract version before loading code, and `checkRemote` from `@mfe/testing` checks the same thing
in the remote's CI, without a host.

### The host knows everyone and is rebuilt for each of them

Static `remotes`, routes in the host's code and type imports from remotes mean that a new remote
or a new section is a host release. The host team becomes a bottleneck.

**In the platform** the host knows nothing about remotes at build time. Routes come from the
manifests, addresses from `platform.config.json`, which is read at startup. A new remote is a
deployment of a JSON file.

### Two routers on one history

A remote's nested router and the host's router write to the same `history`. Typical symptoms:
double navigations, the back button going to the wrong place, a remote not noticing an address
change after a host navigation.

**In the platform** only the host writes history. A remote navigates inside its `basename`, asks
for another remote's route with a `platform:navigate` event, and the host intercepts plain links
itself. The host notices `pushState` from remote routers and dispatches `popstate` after its own
navigations.

### A remote crashes

Without an Error Boundary, or with one in the wrong place, a failed lazy import or a render
exception brings down the whole host tree — that is, the whole page. Usually nothing is reported
beyond an error in the user's console.

**In the platform** each remote is mounted in its own `<mfe-outlet>`. A load or render error stays
inside it: a fallback with a «Повторить» (Retry) button is shown, neighbouring remotes keep
working, and a `mount:error` event with `mountId`, version, route and team metadata goes to the
observability transport.

### Shared state through context

React Context and a shared Redux only work with one copy of the libraries on the page, which again
ties all teams to the same versions. Coupling grows unnoticed: a remote starts reading other
teams' store slices.

**In the platform** shared state lives in the host and reaches the remote as the `platform`
property; the remote requests changes through a typed bus. This works with any framework and any
versions, and bus topics are described by types — the compiler catches an incompatible publish.

### Who ships what

In the usual setup questions like "which design system versions are in production", "which remote
fails most often", "how long does the payments section take to load" have to be answered by hand.

**In the platform** the registry tracks kit versions per remote, the outlet sends mount events
with load times, and `manifest.extra` carries team metadata (owner, team) into every event. The
debug panel shows this right on the page.

### Bank network requirements

The platform core makes no network requests other than loading code and configuration from your
addresses. Navigation to other origins is allowed only over `http(s)`. The development override
works only with local machine addresses. This does not replace an audit, but it removes the typical
security team questions about a front-end runtime.

## Summary table

| | Usual setup (React + MF, shared singleton) | Platform |
| --- | --- | --- |
| Framework upgrade | joint release of all teams | each team at its own pace |
| Remote framework | React only, same version | any: rwc, React, no framework |
| Several UI kit versions on a page | no, or conflicts | yes, with tracking and policies |
| Host ↔ remote contract | implicit: props, contexts, shared versions | explicit manifest, contract version, CI check |
| New remote or section | host release | deployment of a JSON config |
| Browser history | host and remotes write together | only the host writes |
| A remote crashes | takes the page down without an Error Boundary | stays in the outlet, with retry and an event |
| Shared state | Context / Redux, shared library versions | `platform` property and a typed bus |
| Observability | do it yourself | mount events, kit version tracking, panel |
| Local development against staging | usually not provided | `?mfe-override`, including for a new remote |

## Where the usual setup is better

The platform is not free. An honest account of what it costs:

- **Size.** Every remote ships its own framework. For React that is about 218 KB (69 KB gzip) per
  React remote on the page; with a shared singleton, React loads once. With five React remotes on
  one page at the same time, the difference is noticeable. The Module Federation runtime (about
  118 KB, 33 KB gzip per container) is present in both setups.
- **No shared context.** React Context, shared hooks and providers do not cross the remote
  boundary. Everything shared goes through the `platform` property and the bus, which means more
  explicit code.
- **Custom elements.** A remote is a custom element, and those have their own quirks: shadow DOM
  and styles, forms via `ElementInternals`, accessibility across the shadow boundary. The React
  adapter hides most of this, but not all.
- **No SSR.** The platform targets client-side applications. If you need server-side rendering, it
  does not fit.
- **Maturity.** The usual setup is described in hundreds of articles and known to developers on the
  market. The platform is young and has to be learned.
- **One team — extra complexity.** If one team releases all remotes in one release cycle,
  independent versions are not needed, and a monolith or MF with shared React is simpler.

## When to choose what

| Situation | Better choice |
| --- | --- |
| One or two teams, a shared release cycle, everything on React | a monolith or the usual MF setup |
| Many teams, different release paces, framework and UI kit upgrades block everyone | the platform |
| Legacy code on another framework must sit next to new code | the platform |
| You must prove which versions are in production and who owns them | the platform |
| You need SSR or SEO for public pages | the usual setup with an SSR framework |
| Many React remotes on one page, every kilobyte matters | the usual setup with shared React |

Moving from the usual setup can be done gradually, remote by remote —
[migration.md](migration.md).

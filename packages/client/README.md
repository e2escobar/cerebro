# @cerebro/client

Reads feature flags from Cerebro. Keeps them in memory, refreshes in the
background with a conditional request, validates what arrives against a
generated manifest, and tells you when something changes.

Three entry points, one install:

| | |
|---|---|
| `@cerebro/client` | The core. Works anywhere `fetch` does — Node, Bun, Deno, browsers. |
| `@cerebro/client/react` | `CerebroProvider` and hooks. |
| `@cerebro/client/next` | Server-side reads and snapshot injection for the App Router. |

```bash
npm add @cerebro/client
```

## Node

```ts
import { createClient } from "@cerebro/client";

const flags = createClient({
  apiKey: process.env.CEREBRO_SERVER_KEY!,   // cbr_checkout_prod_… — a server key
  baseUrl: "https://flags.internal",
});

await flags.ready();

if (flags.get("new-checkout")) {
  renderNewCheckout();
}
```

The key decides everything. A `cbr_checkout_prod_…` key returns the `checkout`
application's production values — nothing in your code names an application or
an environment, so the same build runs everywhere.

`ready()` resolves after the first payload lands. Call it once at startup — after
that `get()` is synchronous and never blocks.

## React

```tsx
import { CerebroProvider, useFlag } from "@cerebro/client/react";
import { manifest } from "./cerebro.manifest";

<CerebroProvider
  apiKey={process.env.NEXT_PUBLIC_CEREBRO_CLIENT_KEY}
  baseUrl="https://flags.internal"
  manifest={manifest}
>
  <App />
</CerebroProvider>;

function Checkout() {
  const enabled = useFlag("new-checkout");     // boolean, per the manifest
  return enabled ? <Rebuilt /> : <Legacy />;
}
```

Use a **client** key in the browser. Client keys are public, so they only ever
receive flags marked client-safe in the dashboard.

| | |
|---|---|
| `useFlag(key)` / `useFlag(key, fallback)` | The current value, narrowed per key. |
| `useFlags()` | Every flag this key can see. |
| `useFlagsReady()` | Whether real values have arrived. |
| `useCerebroSnapshot()` | Values, config version and readiness together. |
| `useCerebroClient()` | The client itself, for anything the hooks do not cover. |

The provider builds its client once and closes it on unmount. It does not
rebuild when `apiKey` or `baseUrl` change — remount it with a different `key`
if you need to switch environments at runtime.

Subscription goes through `useSyncExternalStore`, so reads are concurrent-safe
and correct under server rendering.

## Next.js

```tsx
// app/layout.tsx — a server component
import { CerebroFlags } from "@cerebro/client/next";
import { manifest } from "@/cerebro.manifest";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <CerebroFlags manifest={manifest}>{children}</CerebroFlags>
      </body>
    </html>
  );
}
```

```tsx
// any server component
import { flag } from "@cerebro/client/next";

if (await flag("new-checkout")) { … }
```

```tsx
// any client component
"use client";
import { useFlag } from "@cerebro/client/react";

const enabled = useFlag("new-checkout");
```

`CerebroFlags` fetches on the server and hands the values to the client
provider as a prop, which React serializes into the RSC payload. The first
paint already has the right flags — no flash, and no client-side request before
it. There is no `<script>` to inject; the Pages Router gets the same result by
passing `snapshot` through `pageProps`.

`getFlagSnapshot()` and `flag()` are wrapped in React's `cache()`, so one render
makes one request however many components ask.

| Variable | |
|---|---|
| `CEREBRO_URL` | Where the evaluation API lives. |
| `CEREBRO_SERVER_KEY` | Used by `flag()` in server components. Never sent to the browser. |
| `CEREBRO_CLIENT_KEY` | Public. What the browser polls with. |

**Two keys, on purpose.** A server key's payload contains flags that are not
client-safe, and serializing that into the page publishes them. The key's kind
is not recoverable at runtime — `cbr_<app>_<env>_<32>` does not encode it — so
`CerebroFlags` refuses to poll without a client key, and when it has only a
server key it filters the snapshot through the manifest's `clientSafe` field
before handing it over. Pass `expose="all"` to opt out, when every flag in the
application is public anyway.

Reads use `cache: "no-store"` by default. A flag read that Next quietly caches
for the life of a static page is a kill switch that does not switch. Pass
`revalidate` to opt into the Data Cache instead — with the caveat that a flip
is then up to that many seconds late.

## Typed flag keys, and validating what arrives

`cerebro-codegen` reads your management API and writes one file that is both a
runtime manifest and a set of types.

```bash
npx cerebro-codegen \
  --app checkout \
  --url https://flags.internal \
  --email you@example.com \
  --password ... \
  --out src/cerebro.manifest.ts
```

```ts
// src/cerebro.manifest.ts — generated
import type { FlagManifest, InferFlagMap } from "@cerebro/client";

export const manifest = {
  version: 1,
  application: "checkout",
  generatedAt: "2026-08-03T10:00:00.000Z",
  source: "https://flags.internal",
  flags: {
    /** Ship the rebuilt checkout funnel. */
    "new-checkout": { type: "boolean", default: false, clientSafe: true },
    /** Hard cap on cart size. */
    "max-cart-items": { type: "number", default: 20, clientSafe: true },
  },
} as const satisfies FlagManifest;

declare module "@cerebro/client" {
  interface FlagMap extends InferFlagMap<typeof manifest> {}
}
```

The types are derived from the value, so there is one source of truth rather
than a table of types that can drift from the table of defaults beside it.
Importing `manifest` to pass to the client is what applies the augmentation —
there is no second file to remember.

```ts
const enabled: boolean = flags.get("new-checkout");   // ✓
const limit: number = flags.get("max-cart-items");    // ✓
const wrong: string = flags.get("new-checkout");      // ✗ compile error
flags.get("no-such-flag");                            // ✗ compile error
```

Re-run codegen when flags are added or removed. Archived flags are left out.
`CEREBRO_URL`, `CEREBRO_EMAIL`, `CEREBRO_PASSWORD` and `CEREBRO_APP` work
instead of the flags. It signs in as a user — an SDK key is not enough, because
flag metadata lives behind the management API. `--format dts` emits types only,
for a JavaScript project with no use for the runtime half.

### What gets validated

Pass the manifest and every payload is checked against it before it is used.

| | development | production |
|---|---|---|
| **wrong type** | throws `ManifestMismatchError` at the payload, `FlagTypeError` at the read | reported to `onError`, warned once, the flag falls back |
| **flag in the payload but not the manifest** | warned once — the manifest is stale | warned once |
| **flag in the manifest but not the payload** | warned once — normally just not promoted here | warned once |

Only a wrong type is ever fatal. A flag missing from the payload is the normal
result of the promotion pipeline, and of client-safe filtering: throwing on it
would break every staging environment.

When a type is wrong, only that key is affected — it keeps the last value that
did validate, or falls back. Rejecting a whole payload over one bad flag would
freeze every other flag in it.

Development is detected from `NODE_ENV`, then from a localhost hostname, and
anything unrecognised is treated as production — being quiet where it should
have shouted is cheaper than throwing inside someone's render. Override it with
`mode`, or set `strict` to `"throw"`, `"warn"` or `"off"` directly.

## Absent flags, and what a read falls back to

A flag is missing from the payload when it belongs to another application, is
not promoted to that environment, is archived, or — for a client key — is not
marked client-safe. A read resolves in this order:

1. the live value, if it matches its declared type
2. `defaults[key]`, if you passed one
3. the manifest default — what the server itself serves when the flag is off
4. the `fallback` argument to `get()` / `useFlag()`
5. otherwise it throws `FlagNotFoundError`

The manifest default sits above the call-site fallback deliberately: it is the
flag's real configured value, not a literal typed at the call site.

With no manifest and no defaults this collapses to "the value, or the fallback,
or throw" — so an absent flag is still loud when nothing else can answer.

```ts
flags.get("new-checkout", false);
```

## Freshness

The client polls `GET /v1/flags` every `pollInterval` (30 seconds by default)
with `If-None-Match`. An unchanged payload costs a `304` and no work. A change
propagates within one interval, so a kill switch takes effect in seconds without
a deploy.

The request sets `cache: "no-store"`: the response carries
`Cache-Control: max-age=30`, and a browser cache satisfying a poll from disk
would hide a flip for a whole interval. The conditional request is ours to make.

Requires the evaluation API to expose `ETag` and `X-Config-Version` through
CORS. Cerebro does; a proxy in front of it must not strip them, or every poll
silently becomes a full download.

## API

| Member | |
|---|---|
| `get(key)` / `get(key, fallback)` | Current value. |
| `getAll()` | Every flag this key can see. |
| `ready()` / `isReady()` | First-payload state. |
| `refresh()` | Fetch now, off-schedule. |
| `onChange(fn)` | Value changes. Returns an unsubscribe function. |
| `subscribe(fn)` / `getSnapshot()` / `getServerSnapshot()` | The `useSyncExternalStore` triple. |
| `version()` | The environment's config version. |
| `start()` / `close()` | Control polling. `createClient` starts automatically unless `autoStart: false`. |

Options: `apiKey`, `baseUrl`, `pollInterval`, `autoStart`, `onError`, `fetch`,
`snapshot`, `manifest`, `defaults`, `strict`, `mode`.

`onError` receives background refresh failures; polling continues, and the last
known values stay in place. A network blip never empties your flags.

`validateSnapshot(values, manifest)` is exported on its own, for a test or a
startup healthcheck that wants the answer without a client.

## Licence

MIT.

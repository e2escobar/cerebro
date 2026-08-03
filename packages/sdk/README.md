# @cerebro/sdk

Reads feature flags from Cerebro. Keeps them in memory, refreshes in the
background with a conditional request, and tells you when something changes.

Works anywhere `fetch` does — Node, Bun, Deno, browsers.

## Install

```bash
bun add @cerebro/sdk
```

## Node

```ts
import { createClient } from "@cerebro/sdk";

const flags = createClient({
  apiKey: process.env.CEREBRO_KEY!,     // cbr_prod_…  — a server key
  baseUrl: "https://flags.internal",
});

await flags.ready();

if (flags.get("new-checkout")) {
  renderNewCheckout();
}

const limit = flags.get("max-cart-items");
```

The key decides everything. A `cbr_checkout_prod_…` key returns the `checkout`
application's production values — nothing in your code names an application or
an environment, so the same build runs everywhere.

`ready()` resolves after the first payload lands. Call it once at startup — after
that `get()` is synchronous and never blocks.

## Browser

Use a **client** key. Client keys are public, so they only ever receive flags
marked client-safe in the dashboard.

```ts
import { createClient } from "@cerebro/sdk";

const flags = createClient({
  apiKey: "cbr_prod_your_client_key",
  baseUrl: "https://flags.internal",
  pollInterval: 60_000,
});

flags.onChange((changes) => {
  for (const change of changes) {
    console.log(`${change.key}: ${String(change.previous)} → ${String(change.current)}`);
  }
  rerender();
});

await flags.ready();
```

Always `flags.close()` when tearing down — in a React effect, return it as the
cleanup function.

## Typed flag keys

`cerebro-codegen` reads your management API and writes the flag keys and their
types, so `get()` returns the right type per key.

```bash
bunx cerebro-codegen \
  --app checkout \
  --url https://flags.internal \
  --email you@example.com \
  --password ... \
  --out src/cerebro-flags.d.ts
```

`--app` names the application to generate for — the same one your SDK key
resolves to. It can be omitted when only one application exists.

`CEREBRO_URL`, `CEREBRO_EMAIL` and `CEREBRO_PASSWORD` work instead of the flags.
It signs in as a user — an SDK key is not enough, because flag metadata lives
behind the management API.

Import the generated file once, anywhere in your project:

```ts
import "./cerebro-flags";
```

From then on:

```ts
const enabled: boolean = flags.get("new-checkout");   // ✓
const limit: number = flags.get("max-cart-items");    // ✓
const wrong: string = flags.get("new-checkout");      // ✗ compile error
flags.get("no-such-flag");                            // ✗ compile error
```

Re-run codegen when flags are added or removed. Archived flags are left out.

## Absent flags

A flag is missing from the payload when it belongs to another application, is
not promoted to that environment, is archived, or — for a client key — is not
marked client-safe. That is usually a
configuration mistake, so `get()` throws `FlagNotFoundError` rather than
returning `undefined`. Pass a fallback when absence is expected:

```ts
flags.get("new-checkout", false);
```

Present flags always hold a value of their declared type, so you never handle
`undefined` for a flag that is actually promoted.

## Freshness

The client polls `GET /v1/flags` every `pollInterval` (30 seconds by default)
with `If-None-Match`. An unchanged payload costs a `304` and no work. A change
propagates within one interval, so a kill switch takes effect in seconds without
a deploy.

## API

| Member | Description |
|---|---|
| `get(key)` / `get(key, fallback)` | Current value. Throws when absent unless a fallback is given. |
| `getAll()` | Every flag this key can see. |
| `ready()` | Resolves after the first successful load. |
| `isReady()` | Whether the first payload has arrived. |
| `refresh()` | Fetch now, off-schedule. |
| `onChange(fn)` | Subscribe to changes; returns an unsubscribe function. |
| `version()` | The environment's config version. |
| `start()` / `close()` | Control polling. `createClient` starts automatically unless `autoStart: false`. |

Options: `apiKey`, `baseUrl`, `pollInterval`, `autoStart`, `onError`, `fetch`.

`onError` receives background refresh failures; polling continues, and the last
known values stay in place. A network blip never empties your flags.

/**
 * With the generated manifest in scope, `get()` narrows per key.
 *
 * Compiled by `bun run typecheck`. The negative cases are asserted with
 * `@ts-expect-error`, which fails the build if the error stops happening — so
 * this file breaks in both directions.
 */

import { createClient } from "@cerebro/client";
import "./cerebro.manifest";

const client = createClient({
  apiKey: "cbr_dev_example",
  baseUrl: "http://localhost:3011",
  autoStart: false,
});

// Each key resolves to its declared type.
const newCheckout: boolean = client.get("new-checkout");
const maxCartItems: number = client.get("max-cart-items");
const bannerCopy: string = client.get("banner-copy");
const pricingRules: unknown = client.get("pricing-rules");

// @ts-expect-error a boolean flag is not a string
const wrongBoolean: string = client.get("new-checkout");

// @ts-expect-error a number flag is not a boolean
const wrongNumber: boolean = client.get("max-cart-items");

// @ts-expect-error a string flag is not a number
const wrongString: number = client.get("banner-copy");

// @ts-expect-error unknown keys are not in the generated map
client.get("no-such-flag");

// @ts-expect-error the fallback must match the flag's declared type
client.get("max-cart-items", "fifty");

// A fallback of the right type is fine.
const withFallback: number = client.get("max-cart-items", 10);

export const checked = {
  newCheckout,
  maxCartItems,
  bannerCopy,
  pricingRules,
  wrongBoolean,
  wrongNumber,
  wrongString,
  withFallback,
};

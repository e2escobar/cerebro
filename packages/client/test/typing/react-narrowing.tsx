/**
 * The augmentation has to cross the subpath boundary: the manifest declares it
 * on `"@cerebro/client"`, and `useFlag` lives in `"@cerebro/client/react"`.
 *
 * Every negative assertion here is paired with a positive one on purpose. A
 * `@ts-expect-error` alone would still be satisfied if the seam broke and the
 * type collapsed to `unknown` — `unknown` is not assignable to `string` either.
 * The positive assignments are the ones that actually fail in that case.
 */

import { useFlag, useFlags, useFlagsReady } from "@cerebro/client/react";
import "./cerebro.manifest";

export function Narrowed() {
  // Positive: each of these fails if the seam breaks and the type is `unknown`.
  const newCheckout: boolean = useFlag("new-checkout");
  const maxCartItems: number = useFlag("max-cart-items");
  const bannerCopy: string = useFlag("banner-copy");
  const withFallback: number = useFlag("max-cart-items", 10);

  // Negative.
  // @ts-expect-error a boolean flag is not a string
  const wrongBoolean: string = useFlag("new-checkout");
  // @ts-expect-error a number flag is not a boolean
  const wrongNumber: boolean = useFlag("max-cart-items");
  // @ts-expect-error unknown keys are not in the generated map
  useFlag("no-such-flag");
  // @ts-expect-error the fallback must match the flag's declared type
  useFlag("max-cart-items", "fifty");

  const all: Readonly<Record<string, unknown>> = useFlags();
  const ready: boolean = useFlagsReady();

  return (
    <span>
      {String(newCheckout)}
      {maxCartItems}
      {bannerCopy}
      {withFallback}
      {String(wrongBoolean)}
      {String(wrongNumber)}
      {String(all)}
      {String(ready)}
    </span>
  );
}

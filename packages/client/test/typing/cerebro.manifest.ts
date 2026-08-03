/**
 * A hand-written stand-in for `cerebro-codegen` output, so the narrowing checks
 * do not need a running server. `scripts/codegen-check.sh` verifies the real
 * generator produces this shape.
 */

import type { FlagManifest, InferFlagMap } from "@cerebro/client";

export const manifest = {
  version: 1,
  application: "checkout",
  generatedAt: "2026-08-03T00:00:00.000Z",
  flags: {
    "banner-copy": { type: "string", default: "" },
    "max-cart-items": { type: "number", default: 20 },
    "new-checkout": { type: "boolean", default: false },
    "pricing-rules": { type: "json", default: null },
  },
} as const satisfies FlagManifest;

declare module "@cerebro/client" {
  // Declaration merging needs an interface, and the members come from the
  // manifest — so the body is empty on purpose. The generator emits this same
  // line, so a consumer's lint does not trip on generated code either.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface FlagMap extends InferFlagMap<typeof manifest> {}
}

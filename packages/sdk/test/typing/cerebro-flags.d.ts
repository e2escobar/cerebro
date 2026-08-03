// Hand-written stand-in for cerebro-codegen output, so the narrowing check
// does not need a running server. scripts/codegen-check.sh verifies the real
// generator produces the same shape.
import "../../src/index.ts";

declare module "../../src/index.ts" {
  interface FlagMap {
    "new-checkout": boolean;
    "max-cart-items": number;
    "banner-copy": string;
    "pricing-rules": unknown;
  }
}

/**
 * The generated-manifest seam, proved against `dist/` exactly as a consumer
 * sees it — resolved through node_modules and the exports map, with no `paths`
 * mapping to smooth it over (tsconfig.dist.json).
 *
 * This is the check that source-level typechecking cannot make: if the
 * declaration build ever inlines `FlagMap` into the subpath entries instead of
 * importing it, every narrowing quietly degrades to `unknown` and nothing else
 * in the repo notices.
 *
 * Compiled by `bun run typecheck:dist`, after `bun run build`. It lives in
 * `test/packaged/` rather than `test/dist/` because the repo gitignores any
 * directory called `dist`, which would have quietly excluded it from the repo.
 */

import { createClient, type FlagManifest, type InferFlagMap } from "@cerebro/client";
import { flag } from "@cerebro/client/next";
import { useFlag } from "@cerebro/client/react";

// Exported, exactly as the generated file exports it.
export const manifest = {
  version: 1,
  application: "checkout",
  generatedAt: "2026-08-03T00:00:00.000Z",
  flags: {
    "new-checkout": { type: "boolean", default: false },
    "max-cart-items": { type: "number", default: 20 },
  },
} as const satisfies FlagManifest;

declare module "@cerebro/client" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface FlagMap extends InferFlagMap<typeof manifest> {}
}

const client = createClient({ apiKey: "cbr_dev_x", baseUrl: "http://flags.test", autoStart: false });

// The root entry narrows.
const fromRoot: boolean = client.get("new-checkout");
// @ts-expect-error a boolean flag is not a string
const wrongAtRoot: string = client.get("new-checkout");

// And so do both subpaths. These positive assignments are the load-bearing
// ones: were the seam broken the types would be `unknown`, which is not
// assignable to `number` — while the negative assertions below would still be
// satisfied, because `unknown` is not assignable to `boolean` either.
const fromReact: number = useFlag("max-cart-items");
// @ts-expect-error a number flag is not a boolean
const wrongInReact: boolean = useFlag("max-cart-items");

const fromNext: Promise<boolean> = flag("new-checkout");
// @ts-expect-error a boolean flag is not a string
const wrongInNext: Promise<string> = flag("new-checkout");

export { fromRoot, wrongAtRoot, fromReact, wrongInReact, fromNext, wrongInNext };

/**
 * Next.js App Router support — server side.
 *
 * There is deliberately no `"use client"` here: this entry fetches with a
 * server key and must stay out of the browser bundle. It reaches the provider
 * through `"@cerebro/client/react"`, which the build keeps external so the
 * client boundary survives.
 */

export { CerebroFlags, type CerebroFlagsProps } from "./flags";
export {
  createServerFlags,
  flag,
  getFlagSnapshot,
  onlyClientSafe,
  type ServerFlags,
  type ServerFlagsOptions,
} from "./server";

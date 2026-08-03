"use client";

/**
 * React bindings.
 *
 * Types come from `"@cerebro/client"` by package name rather than relatively,
 * so the generated manifest's `declare module "@cerebro/client"` narrows the
 * hooks as well as `get()`.
 */

export { CerebroContext } from "./context";
export {
  useCerebroClient,
  useCerebroSnapshot,
  useFlag,
  useFlags,
  useFlagsReady,
} from "./hooks";
export { CerebroProvider, type CerebroProviderProps } from "./provider";

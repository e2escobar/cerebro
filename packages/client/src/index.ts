/**
 * Cerebro's client library — the framework-agnostic core.
 *
 * `@cerebro/client/react` adds a provider and hooks; `@cerebro/client/next`
 * adds server-side snapshot loading for the App Router. Both import their types
 * from this entry, so a generated manifest augments all three at once.
 */

export { createClient } from "./core/client";
export {
  defaultStrictModeFor,
  detectMode,
  resetWarnings,
  type Mode,
  type StrictMode,
} from "./core/env";
export { FlagNotFoundError, FlagTypeError, ManifestMismatchError } from "./core/errors";
export {
  hasIssues,
  matchesType,
  validateSnapshot,
  type FlagManifest,
  type FlagManifestEntry,
  type FlagTypeName,
  type InferFlagMap,
  type JsonValue,
  type SnapshotIssues,
  type TypeMismatch,
} from "./core/manifest";
export { resolveFlag, type ResolveInput } from "./core/resolve";
export { EMPTY_SNAPSHOT, toSnapshot, type Snapshot } from "./core/store";
export type {
  CerebroClient,
  ChangeListener,
  ClientOptions,
  FlagChange,
  FlagKey,
  FlagMap,
  FlagValue,
} from "./core/types";

import type { Mode, StrictMode } from "./env";
import type { FlagManifest } from "./manifest";
import type { Snapshot } from "./store";

/**
 * The flag map seam.
 *
 * `cerebro-codegen` augments `FlagMap` with your application's keys and their
 * declared types, so `get()` and `useFlag()` narrow per key. Until then `get()`
 * accepts any string and returns `unknown`.
 *
 * This interface is declared exactly once, in the root entry. Every other entry
 * imports it from `"@cerebro/client"` rather than relatively, so a consumer's
 * `declare module "@cerebro/client"` reaches all three.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FlagMap {}

export type FlagKey = keyof FlagMap extends never ? string : keyof FlagMap;
export type FlagValue<K> = K extends keyof FlagMap ? FlagMap[K] : unknown;

export interface FlagChange {
  key: string;
  previous: unknown;
  current: unknown;
}

export type ChangeListener = (changes: FlagChange[]) => void;

export interface ClientOptions {
  /**
   * An environment-scoped SDK key. The environment comes from the key.
   * Optional only for a client that never fetches — one built from a server
   * snapshot, or from defaults alone, with `autoStart: false`.
   */
  apiKey?: string;
  /** Where the evaluation API lives, e.g. `https://flags.internal`. */
  baseUrl?: string;
  /** How often to re-check, in milliseconds. Defaults to 30 seconds. */
  pollInterval?: number;
  /** Set false to control refreshing yourself with `refresh()`. */
  autoStart?: boolean;
  /** Called when a background refresh fails. Polling continues regardless. */
  onError?: (error: Error) => void;
  fetch?: typeof globalThis.fetch;

  /**
   * Values already resolved elsewhere — normally server-rendered. Seeds
   * `getServerSnapshot()`, so the first client render matches the HTML.
   */
  snapshot?: Snapshot | Readonly<Record<string, unknown>>;
  /** The generated manifest. Without it there is nothing to validate against. */
  manifest?: FlagManifest;
  /** Local values used when the payload has no answer. Beat manifest defaults. */
  defaults?: Readonly<Record<string, unknown>>;
  /** What to do about a wrong type. Defaults to "throw" in dev, "warn" in prod. */
  strict?: StrictMode;
  /** Override the development/production guess that `strict` is derived from. */
  mode?: Mode;
}

export interface CerebroClient {
  /**
   * The current value. Throws if the flag is absent in this environment,
   * unless a fallback is supplied — an absent flag is a configuration
   * mistake worth hearing about, not a silent undefined.
   */
  get<K extends FlagKey>(key: K): FlagValue<K>;
  get<K extends FlagKey>(key: K, fallback: FlagValue<K>): FlagValue<K>;
  /**
   * `get()` against a snapshot you already hold rather than the live one. The
   * hooks use this so a value can never disagree with the snapshot React just
   * rendered, and so the manifest, defaults and strictness stay the client's
   * business rather than something the provider has to pass around.
   */
  resolveFrom<K extends FlagKey>(snapshot: Snapshot, key: K): FlagValue<K>;
  resolveFrom<K extends FlagKey>(
    snapshot: Snapshot,
    key: K,
    fallback: FlagValue<K>,
  ): FlagValue<K>;
  /** Every flag this key can see, as a plain object. */
  getAll(): Readonly<Record<string, unknown>>;
  /** True once the first payload has arrived. */
  isReady(): boolean;
  /** Resolves after the first successful load. */
  ready(): Promise<void>;
  /** Fetch now, regardless of the polling schedule. */
  refresh(): Promise<void>;
  /** Subscribe to value changes. Returns an unsubscribe function. */
  onChange(listener: ChangeListener): () => void;
  /** The environment's config version, or null before the first load. */
  version(): number | null;
  start(): void;
  /** Stop polling. Always call this when tearing down. */
  close(): void;

  /**
   * The `useSyncExternalStore` triple.
   *
   * `onChange` cannot serve this: it reports value *changes*, and deliberately
   * stays silent on the first payload because there is nothing to compare it
   * to. A hook wired to it would never learn that loading finished. `subscribe`
   * fires on every transition, including `ready` turning true.
   */
  subscribe(onStoreChange: () => void): () => void;
  /** Identity-stable — a new object only when something actually changed. */
  getSnapshot(): Snapshot;
  /** The construction-time snapshot, frozen. Never replaced. */
  getServerSnapshot(): Snapshot;
}

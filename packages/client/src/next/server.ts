import {
  EMPTY_SNAPSHOT,
  defaultStrictModeFor,
  resolveFlag,
  toSnapshot,
  type FlagKey,
  type FlagManifest,
  type FlagValue,
  type Mode,
  type Snapshot,
  type StrictMode,
} from "@cerebro/client";
import { cache } from "react";

// Server-only, so Node's globals are a given — but typed narrowly all the same,
// because this file is compiled with the browser-shaped library config.
declare const process: { env: Record<string, string | undefined> };

export interface ServerFlagsOptions {
  /** Defaults to `CEREBRO_URL`. */
  baseUrl?: string;
  /** Defaults to `CEREBRO_SERVER_KEY`, then `CEREBRO_CLIENT_KEY`. */
  apiKey?: string;
  manifest?: FlagManifest;
  defaults?: Readonly<Record<string, unknown>>;
  strict?: StrictMode;
  mode?: Mode;
  /**
   * Seconds to keep the payload in Next's Data Cache. Omitted means
   * `cache: "no-store"` — a flag read that Next quietly caches for the life of
   * a static page is a kill switch that does not switch.
   */
  revalidate?: number;
  /** Cache tags, so `revalidateTag` can push a change through. */
  tags?: string[];
  onError?: (error: Error) => void;
  fetch?: typeof globalThis.fetch;
}

export interface ServerFlags {
  /** The environment's values, fetched once per request. */
  getSnapshot(): Promise<Snapshot>;
  flag<K extends FlagKey>(key: K): Promise<FlagValue<K>>;
  flag<K extends FlagKey>(key: K, fallback: FlagValue<K>): Promise<FlagValue<K>>;
}

type NextRequestInit = RequestInit & {
  next?: { revalidate?: number; tags?: string[] };
};

/**
 * Reads flags on the server, for React Server Components.
 *
 * The fetch is wrapped in React's `cache()`, so however many components ask,
 * one render makes one request. `cache()` memoizes on arguments, which is why
 * the memoized function takes none and the configuration is closed over here.
 */
export function createServerFlags(options: ServerFlagsOptions = {}): ServerFlags {
  const { manifest, defaults, strict, mode, onError } = options;

  const load = cache(async (): Promise<Snapshot> => {
    const baseUrl = options.baseUrl ?? process.env.CEREBRO_URL;
    const apiKey =
      options.apiKey ?? process.env.CEREBRO_SERVER_KEY ?? process.env.CEREBRO_CLIENT_KEY;

    if (!baseUrl || !apiKey) return EMPTY_SNAPSHOT;

    const init: NextRequestInit =
      options.revalidate === undefined
        ? { cache: "no-store" }
        : { next: { revalidate: options.revalidate, tags: options.tags ?? ["cerebro-flags"] } };

    try {
      const fetchImpl = options.fetch ?? globalThis.fetch;
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/v1/flags`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (response.status === 401) {
        throw new Error("Cerebro rejected this SDK key. It may have been revoked.");
      }
      if (!response.ok) throw new Error(`Cerebro returned ${response.status}`);

      const values = (await response.json()) as Record<string, unknown>;
      const version = response.headers.get("x-config-version");

      return toSnapshot({
        values,
        invalid: {},
        version: version === null ? null : Number(version),
        ready: true,
      });
    } catch (error) {
      // A page must still render when the flag service is down. Every flag
      // falls back to its local or manifest default instead.
      onError?.(error instanceof Error ? error : new Error(String(error)));
      return EMPTY_SNAPSHOT;
    }
  });

  return {
    getSnapshot: load,
    async flag<K extends FlagKey>(
      key: K,
      ...fallback: [FlagValue<K>] | []
    ): Promise<FlagValue<K>> {
      const snapshot = await load();
      return resolveFlag(
        {
          values: snapshot.values,
          invalid: snapshot.invalid,
          manifest,
          defaults,
          strict: strict ?? defaultStrictModeFor(mode),
        },
        key as string,
        fallback,
      ) as FlagValue<K>;
    },
  };
}

const shared = createServerFlags();

/** The environment's values, using `CEREBRO_URL` and `CEREBRO_SERVER_KEY`. */
export const getFlagSnapshot: () => Promise<Snapshot> = shared.getSnapshot;

/** Read one flag from a server component. */
export const flag: ServerFlags["flag"] = shared.flag;

/**
 * Drops everything a client key would never have received.
 *
 * A server key's payload contains flags that are not marked client-safe, and
 * serializing that into the page publishes them. The key's kind is not
 * recoverable at runtime — `cbr_<app>_<env>_<32>` does not encode it — so the
 * manifest is the only thing that can tell them apart.
 */
export function onlyClientSafe(
  values: Readonly<Record<string, unknown>>,
  manifest: FlagManifest,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (manifest.flags[key]?.clientSafe !== false) safe[key] = value;
  }
  return safe;
}

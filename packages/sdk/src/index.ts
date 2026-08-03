/**
 * Cerebro SDK.
 *
 * Reads flags from the evaluation API, keeps them in memory, and refreshes in
 * the background with a conditional request so an unchanged payload costs a
 * 304 (spec §9). Works in Node, Bun and the browser — `fetch` is all it needs.
 */

/**
 * Augmented by `cerebro-codegen`, which emits the flag keys and their declared
 * types. Until then `get()` accepts any string and returns `unknown`.
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
  /** An environment-scoped SDK key. The environment comes from the key. */
  apiKey: string;
  /** Where the evaluation API lives, e.g. `https://flags.internal`. */
  baseUrl: string;
  /** How often to re-check, in milliseconds. Defaults to 30 seconds. */
  pollInterval?: number;
  /** Set false to control refreshing yourself with `refresh()`. */
  autoStart?: boolean;
  /** Called when a background refresh fails. Polling continues regardless. */
  onError?: (error: Error) => void;
  fetch?: typeof globalThis.fetch;
}

export class FlagNotFoundError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(
      `Flag '${key}' is not available in this environment. It is either not promoted here, archived, or — for a client key — not marked client-safe.`,
    );
    this.name = "FlagNotFoundError";
    this.key = key;
  }
}

export interface CerebroClient {
  /**
   * The current value. Throws if the flag is absent in this environment,
   * unless a fallback is supplied — an absent flag is a configuration
   * mistake worth hearing about, not a silent undefined.
   */
  get<K extends FlagKey>(key: K): FlagValue<K>;
  get<K extends FlagKey>(key: K, fallback: FlagValue<K>): FlagValue<K>;
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
}

export function createClient(options: ClientOptions): CerebroClient {
  const {
    apiKey,
    baseUrl,
    pollInterval = 30_000,
    autoStart = true,
    onError,
    fetch: fetchImpl = globalThis.fetch,
  } = options;

  if (!apiKey) throw new Error("createClient needs an apiKey");
  if (!baseUrl) throw new Error("createClient needs a baseUrl");

  const endpoint = `${baseUrl.replace(/\/$/, "")}/v1/flags`;
  const listeners = new Set<ChangeListener>();

  let flags: Record<string, unknown> = {};
  let etag: string | null = null;
  let configVersion: number | null = null;
  let loaded = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  let resolveReady: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  function diff(next: Record<string, unknown>): FlagChange[] {
    const changes: FlagChange[] = [];
    for (const key of new Set([...Object.keys(flags), ...Object.keys(next)])) {
      const previous = flags[key];
      const current = next[key];
      if (JSON.stringify(previous) !== JSON.stringify(current)) {
        changes.push({ key, previous, current });
      }
    }
    return changes;
  }

  async function refresh(): Promise<void> {
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    if (etag) headers["If-None-Match"] = etag;

    const response = await fetchImpl(endpoint, { headers });

    if (response.status === 304) return;

    if (response.status === 401) {
      throw new Error("Cerebro rejected this SDK key. It may have been revoked.");
    }
    if (!response.ok) {
      throw new Error(`Cerebro returned ${response.status} for ${endpoint}`);
    }

    const next = (await response.json()) as Record<string, unknown>;
    const changes = loaded ? diff(next) : [];

    flags = next;
    etag = response.headers.get("etag");
    const version = response.headers.get("x-config-version");
    configVersion = version === null ? null : Number(version);

    if (!loaded) {
      loaded = true;
      resolveReady();
    }

    if (changes.length > 0) {
      for (const listener of listeners) {
        try {
          listener(changes);
        } catch (error) {
          onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
  }

  function tick(): void {
    refresh().catch((error: unknown) => {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    });
  }

  const client: CerebroClient = {
    get<K extends FlagKey>(key: K, ...fallback: [FlagValue<K>] | []): FlagValue<K> {
      const stored = flags[key as string];
      if (stored === undefined) {
        if (fallback.length > 0) return fallback[0] as FlagValue<K>;
        throw new FlagNotFoundError(key as string);
      }
      return stored as FlagValue<K>;
    },

    getAll: () => ({ ...flags }),
    isReady: () => loaded,
    ready: () => readyPromise,
    refresh,
    version: () => configVersion,

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start() {
      if (timer !== null) return;
      tick();
      timer = setInterval(tick, pollInterval);
      // Never hold a Node process open just to poll for flags.
      (timer as unknown as { unref?: () => void }).unref?.();
    },

    close() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      listeners.clear();
    },
  };

  if (autoStart) client.start();

  return client;
}

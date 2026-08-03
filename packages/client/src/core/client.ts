import { defaultStrictModeFor, warnOnce } from "./env";
import { ManifestMismatchError } from "./errors";
import { resolveFlag } from "./resolve";
import { EMPTY_SNAPSHOT, freezeSnapshot, sanitize, toSnapshot, type Snapshot } from "./store";
import type {
  CerebroClient,
  ChangeListener,
  ClientOptions,
  FlagChange,
  FlagKey,
  FlagValue,
} from "./types";

/**
 * Reads flags from the evaluation API, keeps them in memory, and refreshes in
 * the background with a conditional request so an unchanged payload costs a
 * 304 (spec §9). Works in Node, Bun and the browser — `fetch` is all it needs.
 *
 * A client can also be built with no key at all, from a server snapshot or from
 * defaults: that is what the React provider does during SSR, where fetching
 * would be both pointless and wrong.
 */
export function createClient(options: ClientOptions): CerebroClient {
  const {
    apiKey,
    baseUrl,
    pollInterval = 30_000,
    autoStart = true,
    onError,
    fetch: fetchImpl = globalThis.fetch,
    manifest,
    defaults,
    mode,
    strict = defaultStrictModeFor(mode),
  } = options;

  const offline = options.snapshot !== undefined || defaults !== undefined;
  // An offline client is a real use — SSR, tests, a page rendered from a
  // snapshot — but it must be an explicit one, or a missing environment
  // variable would quietly become an app that serves nothing but defaults.
  if (!apiKey && !(offline && !autoStart)) throw new Error("createClient needs an apiKey");
  if (!baseUrl && !(offline && !autoStart)) throw new Error("createClient needs a baseUrl");

  const endpoint = baseUrl ? `${baseUrl.replace(/\/$/, "")}/v1/flags` : null;
  const listeners = new Set<ChangeListener>();
  const storeListeners = new Set<() => void>();

  const serverSnapshot = seed(toSnapshot(options.snapshot));
  let snapshot: Snapshot = serverSnapshot;
  let etag: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  let resolveReady: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  if (snapshot.ready) resolveReady!();

  /** Runs the construction-time values through the manifest too — a bad server
   *  snapshot deserves the same scrutiny as a bad payload. */
  function seed(initial: Snapshot): Snapshot {
    if (initial === EMPTY_SNAPSHOT) return initial;
    const { values, invalid } = sanitize(initial.values, {}, manifest);
    return freezeSnapshot({ ...initial, values, invalid });
  }

  function publish(next: Snapshot): void {
    snapshot = next;
    for (const listener of storeListeners) listener();
  }

  function diff(next: Readonly<Record<string, unknown>>): FlagChange[] {
    const changes: FlagChange[] = [];
    const current = snapshot.values;
    for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
      const previous = current[key];
      const value = next[key];
      if (JSON.stringify(previous) !== JSON.stringify(value)) {
        changes.push({ key, previous, current: value });
      }
    }
    return changes;
  }

  function report(issues: ReturnType<typeof sanitize>["issues"]): void {
    if (issues === null) return;

    if (issues.unknownKeys.length > 0) {
      warnOnce(
        `unknown:${issues.unknownKeys.join(",")}`,
        `The payload has flags the manifest does not know about (${issues.unknownKeys.join(", ")}). Re-run cerebro-codegen.`,
      );
    }
    // Absent is the normal state of a flag that has not been promoted here, or
    // that a client key cannot see — worth saying once, never worth throwing.
    if (issues.missingKeys.length > 0) {
      warnOnce(
        `missing:${issues.missingKeys.join(",")}`,
        `The manifest lists flags this key does not receive (${issues.missingKeys.join(", ")}). They will resolve to their manifest defaults.`,
      );
    }
  }

  async function refresh(): Promise<void> {
    if (endpoint === null || !apiKey) return;

    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    if (etag) headers["If-None-Match"] = etag;

    // The evaluation API sends `Cache-Control: public, max-age=30`, which is
    // also the default poll interval — so a browser's HTTP cache could satisfy
    // a poll without revalidating, and a flag flip would go unseen for a whole
    // interval. We run our own conditional request; the shared cache stays out.
    const response = await fetchImpl(endpoint, { headers, cache: "no-store" });

    if (response.status === 304) return;

    if (response.status === 401) {
      throw new Error("Cerebro rejected this SDK key. It may have been revoked.");
    }
    if (!response.ok) {
      throw new Error(`Cerebro returned ${response.status} for ${endpoint}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const { values, invalid, issues } = sanitize(payload, snapshot.values, manifest);
    const changes = snapshot.ready ? diff(values) : [];

    const version = response.headers.get("x-config-version");
    const nextVersion = version === null ? null : Number(version);
    const wasReady = snapshot.ready;

    etag = response.headers.get("etag");

    if (changes.length > 0 || !wasReady || nextVersion !== snapshot.version) {
      publish(freezeSnapshot({ values, invalid, version: nextVersion, ready: true }));
    }

    if (!wasReady) resolveReady();

    report(issues);

    if (changes.length > 0) {
      for (const listener of listeners) {
        try {
          listener(changes);
        } catch (error) {
          onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }

    if (issues !== null && issues.typeMismatches.length > 0) {
      const error = new ManifestMismatchError(issues.typeMismatches);
      if (strict === "throw") throw error;
      if (strict === "warn") {
        onError?.(error);
        warnOnce(`mismatch:${issues.typeMismatches.map((m) => m.key).join(",")}`, error.message);
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
      return client.resolveFrom(snapshot, key, ...(fallback as [FlagValue<K>]));
    },

    resolveFrom<K extends FlagKey>(
      from: Snapshot,
      key: K,
      ...fallback: [FlagValue<K>] | []
    ): FlagValue<K> {
      return resolveFlag(
        { values: from.values, invalid: from.invalid, manifest, defaults, strict },
        key as string,
        fallback,
      ) as FlagValue<K>;
    },

    getAll: () => ({ ...snapshot.values }),
    isReady: () => snapshot.ready,
    ready: () => readyPromise,
    refresh,
    version: () => snapshot.version,

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    subscribe(onStoreChange) {
      storeListeners.add(onStoreChange);
      return () => storeListeners.delete(onStoreChange);
    },

    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,

    start() {
      if (timer !== null || endpoint === null) return;
      tick();
      timer = setInterval(tick, pollInterval);
      // Never hold a Node process open just to poll for flags.
      (timer as unknown as { unref?: () => void }).unref?.();
    },

    close() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      listeners.clear();
      storeListeners.clear();
    },
  };

  if (autoStart) client.start();

  return client;
}

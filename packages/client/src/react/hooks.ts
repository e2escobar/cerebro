"use client";

import type { CerebroClient, FlagKey, FlagValue, Snapshot } from "@cerebro/client";
import { useContext, useSyncExternalStore } from "react";
import { CerebroContext } from "./context";

export function useCerebroClient(): CerebroClient {
  const client = useContext(CerebroContext);
  if (client === null) {
    throw new Error(
      "No Cerebro client in context. Wrap the tree in <CerebroProvider>, or <CerebroFlags> if you are using the App Router.",
    );
  }
  return client;
}

/**
 * The whole current snapshot.
 *
 * The key is selected during render rather than inside `getSnapshot`: a
 * per-key selector would be a new closure on every render, resubscribing each
 * time, and returning a derived object trips React's "getSnapshot should be
 * cached" warning. Rendering more often than strictly necessary costs nothing
 * here — flags change on the order of once a day.
 */
export function useCerebroSnapshot(): Snapshot {
  const client = useCerebroClient();
  return useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    // Required, or React throws during renderToString — which is the whole
    // server-rendering path.
    client.getServerSnapshot,
  );
}

export function useFlag<K extends FlagKey>(key: K): FlagValue<K>;
export function useFlag<K extends FlagKey>(key: K, fallback: FlagValue<K>): FlagValue<K>;
export function useFlag<K extends FlagKey>(
  key: K,
  ...fallback: [FlagValue<K>] | []
): FlagValue<K> {
  const client = useCerebroClient();
  const snapshot = useCerebroSnapshot();
  return client.resolveFrom(snapshot, key, ...(fallback as [FlagValue<K>]));
}

/** Every flag this key can see. */
export function useFlags(): Readonly<Record<string, unknown>> {
  return useCerebroSnapshot().values;
}

/** Whether real values have arrived — from the network or from the server. */
export function useFlagsReady(): boolean {
  return useCerebroSnapshot().ready;
}

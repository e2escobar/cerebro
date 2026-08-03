"use client";

import { createClient, type CerebroClient, type ClientOptions } from "@cerebro/client";
import { useEffect, useRef, type ReactNode } from "react";
import { CerebroContext } from "./context";

export interface CerebroProviderProps extends ClientOptions {
  children: ReactNode;
  /**
   * Use a client you built yourself. The provider will not close it — that
   * would clear listeners the rest of your app registered.
   */
  client?: CerebroClient;
  /**
   * Whether to poll in the background. Defaults to off when a `snapshot` was
   * supplied: in Next the server re-fetches on navigation and revalidation, and
   * a poller that overwrites server-rendered values half a minute later is
   * rarely what anyone wanted.
   */
  poll?: boolean;
}

/**
 * Makes flags available to the tree.
 *
 * The client is built once, on first render, and never rebuilt — changing
 * `apiKey` or `baseUrl` afterwards has no effect. Remount the provider with a
 * different `key` if you need to switch environments at runtime.
 */
export function CerebroProvider({
  children,
  client: injected,
  poll,
  ...options
}: CerebroProviderProps) {
  // A ref rather than useMemo: useMemo is a performance hint, not a promise,
  // and a second client would mean a second poller and a second cache.
  const created = useRef<CerebroClient | null>(null);
  if (injected === undefined && created.current === null) {
    // Never fetch during render. StrictMode invokes render twice, and on the
    // server there is nothing to fetch for.
    created.current = createClient({ ...options, autoStart: false });
  }

  const client = injected ?? (created.current as CerebroClient);
  const shouldPoll = poll ?? (options.snapshot === undefined && options.apiKey !== undefined);

  useEffect(() => {
    if (shouldPoll) client.start();
    return () => {
      if (injected === undefined) client.close();
    };
  }, [client, injected, shouldPoll]);

  return <CerebroContext.Provider value={client}>{children}</CerebroContext.Provider>;
}

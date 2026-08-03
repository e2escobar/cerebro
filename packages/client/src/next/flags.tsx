import { toSnapshot, type Snapshot } from "@cerebro/client";
import { CerebroProvider } from "@cerebro/client/react";
import type { ReactNode } from "react";
import { createServerFlags, onlyClientSafe, type ServerFlagsOptions } from "./server";

declare const process: { env: Record<string, string | undefined> };

export interface CerebroFlagsProps extends ServerFlagsOptions {
  children: ReactNode;
  /** The public key the browser polls with. Defaults to `CEREBRO_CLIENT_KEY`. */
  clientKey?: string;
  /** Set false for a snapshot-only provider that never polls. */
  poll?: boolean;
  pollInterval?: number;
  /**
   * `"client-safe"` (the default) keeps flags the manifest marks
   * `clientSafe: false` out of the page. `"all"` sends everything the key
   * received — only correct when that key is itself a client key.
   */
  expose?: "client-safe" | "all";
}

/**
 * Loads flags on the server and hands them to the client provider.
 *
 * No `<script>` injection: `CerebroProvider` is a client component receiving a
 * plain-JSON prop, so React serializes the snapshot into the RSC payload for
 * the initial HTML and for every navigation after it. The Pages Router gets the
 * same result by passing `snapshot` through `pageProps`.
 */
export async function CerebroFlags({
  children,
  clientKey,
  poll,
  pollInterval,
  expose = "client-safe",
  ...options
}: CerebroFlagsProps) {
  const publicKey = clientKey ?? process.env.CEREBRO_CLIENT_KEY;
  const shouldPoll = poll ?? true;

  if (shouldPoll && !publicKey) {
    throw new Error(
      "CerebroFlags needs a client SDK key (CEREBRO_CLIENT_KEY) to keep flags fresh in the browser. " +
        "A server key must never reach the browser — it can read flags that are not marked client-safe. " +
        "Pass poll={false} for a snapshot-only provider.",
    );
  }

  // Fetch with the client key whenever there is one: the server then applies
  // the client-safe filter itself, which is the authoritative answer.
  const fetchedWithClientKey = publicKey !== undefined;
  const flags = createServerFlags({
    ...options,
    apiKey: publicKey ?? options.apiKey,
  });

  const loaded = await flags.getSnapshot();
  const snapshot = fetchedWithClientKey
    ? loaded
    : narrowToClientSafe(loaded, options.manifest, expose);

  return (
    <CerebroProvider
      snapshot={snapshot}
      manifest={options.manifest}
      defaults={options.defaults}
      strict={options.strict}
      mode={options.mode}
      apiKey={publicKey}
      baseUrl={options.baseUrl ?? process.env.CEREBRO_URL}
      pollInterval={pollInterval}
      poll={shouldPoll}
    >
      {children}
    </CerebroProvider>
  );
}

function narrowToClientSafe(
  snapshot: Snapshot,
  manifest: ServerFlagsOptions["manifest"],
  expose: "client-safe" | "all",
): Snapshot {
  if (expose === "all") return snapshot;

  if (manifest === undefined) {
    throw new Error(
      "CerebroFlags was given a server key and no manifest, so it cannot tell which flags are safe to send to the browser. " +
        "Pass the generated manifest, use a client key, or set expose=\"all\" if every flag here is public.",
    );
  }

  return toSnapshot({
    ...snapshot,
    values: onlyClientSafe(snapshot.values, manifest),
  });
}

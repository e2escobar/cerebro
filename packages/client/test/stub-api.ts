/** A stand-in for the evaluation API — no network, no database. */

export interface Stub {
  fetch: typeof globalThis.fetch;
  calls: { ifNoneMatch: string | null }[];
  setPayload: (payload: Record<string, unknown>, version: number) => void;
}

export const TEST_KEY = "cbr_dev_test";

export function stubApi(initial: Record<string, unknown>, version = 1): Stub {
  let payload = initial;
  let currentVersion = version;
  const calls: { ifNoneMatch: string | null }[] = [];

  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const ifNoneMatch = headers.get("If-None-Match");
    calls.push({ ifNoneMatch });

    if (headers.get("Authorization") !== `Bearer ${TEST_KEY}`) {
      return Promise.resolve(new Response("{}", { status: 401 }));
    }

    const etag = `W/"dev-${currentVersion}"`;
    if (ifNoneMatch === etag) {
      return Promise.resolve(new Response(null, { status: 304, headers: { ETag: etag } }));
    }

    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { ETag: etag, "X-Config-Version": String(currentVersion) },
      }),
    );
  }) as typeof globalThis.fetch;

  return {
    fetch: fetchImpl,
    calls,
    setPayload(next, nextVersion) {
      payload = next;
      currentVersion = nextVersion;
    },
  };
}

/** A fetch that always fails, for the offline paths. */
export function unreachable(): typeof globalThis.fetch {
  return ((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.reject(new Error("network down"))) as typeof globalThis.fetch;
}

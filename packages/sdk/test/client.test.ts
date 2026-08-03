import { afterEach, describe, expect, test } from "bun:test";
import { createClient, FlagNotFoundError, type CerebroClient } from "../src/index.ts";

/** The SDK against a stubbed evaluation API — no network, no database. */

interface Stub {
  fetch: typeof globalThis.fetch;
  calls: { ifNoneMatch: string | null }[];
  setPayload: (payload: Record<string, unknown>, version: number) => void;
}

function stubApi(initial: Record<string, unknown>, version = 1): Stub {
  let payload = initial;
  let currentVersion = version;
  const calls: { ifNoneMatch: string | null }[] = [];

  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const ifNoneMatch = headers.get("If-None-Match");
    calls.push({ ifNoneMatch });

    if (headers.get("Authorization") !== "Bearer cbr_dev_test") {
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

let client: CerebroClient | null = null;

afterEach(() => {
  client?.close();
  client = null;
});

describe("createClient", () => {
  test("loads the payload and exposes values by key", async () => {
    const api = stubApi({ "new-checkout": true, "max-cart-items": 50 });
    client = createClient({ apiKey: "cbr_dev_test", baseUrl: "http://flags.test", fetch: api.fetch });

    await client.ready();

    expect(client.isReady()).toBe(true);
    expect(client.get("new-checkout")).toBe(true);
    expect(client.get("max-cart-items")).toBe(50);
    expect(client.getAll()).toEqual({ "new-checkout": true, "max-cart-items": 50 });
    expect(client.version()).toBe(1);
  });

  test("throws for a flag that is absent here, unless given a fallback", async () => {
    const api = stubApi({ "new-checkout": true });
    client = createClient({ apiKey: "cbr_dev_test", baseUrl: "http://flags.test", fetch: api.fetch });
    await client.ready();

    expect(() => client!.get("not-promoted-here")).toThrow(FlagNotFoundError);
    expect(client.get("not-promoted-here", "fallback")).toBe("fallback");
    // A falsy stored value is still a value, not an absence.
    expect(client.get("new-checkout", false)).toBe(true);
  });

  test("sends If-None-Match once it has an ETag", async () => {
    const api = stubApi({ a: 1 });
    client = createClient({
      apiKey: "cbr_dev_test",
      baseUrl: "http://flags.test",
      fetch: api.fetch,
      autoStart: false,
    });

    await client.refresh();
    await client.refresh();

    expect(api.calls[0]?.ifNoneMatch).toBeNull();
    expect(api.calls[1]?.ifNoneMatch).toBe('W/"dev-1"');
  });

  test("a 304 leaves values and listeners alone", async () => {
    const api = stubApi({ a: 1 });
    client = createClient({
      apiKey: "cbr_dev_test",
      baseUrl: "http://flags.test",
      fetch: api.fetch,
      autoStart: false,
    });

    let notifications = 0;
    client.onChange(() => notifications++);

    await client.refresh();
    await client.refresh();

    expect(client.get("a")).toBe(1);
    expect(notifications).toBe(0);
  });

  test("reports exactly what changed", async () => {
    const api = stubApi({ "new-checkout": false, keep: "same" });
    client = createClient({
      apiKey: "cbr_dev_test",
      baseUrl: "http://flags.test",
      fetch: api.fetch,
      autoStart: false,
    });

    const seen: { key: string; previous: unknown; current: unknown }[] = [];
    client.onChange((changes) => seen.push(...changes));

    await client.refresh();
    api.setPayload({ "new-checkout": true, keep: "same", added: 3 }, 2);
    await client.refresh();

    expect(seen).toEqual([
      { key: "new-checkout", previous: false, current: true },
      { key: "added", previous: undefined, current: 3 },
    ]);
    expect(client.version()).toBe(2);
  });

  test("a removed flag is reported and then absent", async () => {
    const api = stubApi({ doomed: true });
    client = createClient({
      apiKey: "cbr_dev_test",
      baseUrl: "http://flags.test",
      fetch: api.fetch,
      autoStart: false,
    });

    await client.refresh();
    api.setPayload({}, 2);
    await client.refresh();

    expect(() => client!.get("doomed")).toThrow(FlagNotFoundError);
  });

  test("unsubscribing stops notifications", async () => {
    const api = stubApi({ a: 1 });
    client = createClient({
      apiKey: "cbr_dev_test",
      baseUrl: "http://flags.test",
      fetch: api.fetch,
      autoStart: false,
    });

    let count = 0;
    const unsubscribe = client.onChange(() => count++);
    await client.refresh();

    unsubscribe();
    api.setPayload({ a: 2 }, 2);
    await client.refresh();

    expect(count).toBe(0);
    expect(client.get("a")).toBe(2);
  });

  test("a rejected key surfaces a clear error", async () => {
    const api = stubApi({});
    client = createClient({
      apiKey: "wrong-key",
      baseUrl: "http://flags.test",
      fetch: api.fetch,
      autoStart: false,
    });

    expect(client.refresh()).rejects.toThrow(/revoked/);
  });

  test("refuses to be created without a key or base url", () => {
    expect(() => createClient({ apiKey: "", baseUrl: "http://x" })).toThrow(/apiKey/);
    expect(() => createClient({ apiKey: "k", baseUrl: "" })).toThrow(/baseUrl/);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { createClient, type CerebroClient, type FlagManifest } from "../src/index";
import { stubApi, TEST_KEY, unreachable } from "./stub-api";

/**
 * The contract `useSyncExternalStore` relies on, asserted without a renderer:
 * after a change the subscriber fires and `getSnapshot()` returns a *different*
 * object, and between changes it returns the same one.
 */

const manifest: FlagManifest = {
  version: 1,
  application: "checkout",
  generatedAt: "2026-08-03T00:00:00.000Z",
  flags: {
    "new-checkout": { type: "boolean", default: false },
    "max-cart-items": { type: "number", default: 20 },
  },
};

let client: CerebroClient | null = null;

afterEach(() => {
  client?.close();
  client = null;
});

function offline(options: Parameters<typeof createClient>[0] = {}): CerebroClient {
  return createClient({ autoStart: false, ...options });
}

describe("the store triple", () => {
  test("subscribers hear about the first payload", async () => {
    // The regression this exists for: onChange stays silent on the first load,
    // because there is nothing to diff against. A hook wired to onChange would
    // never learn that loading had finished.
    const api = stubApi({ "new-checkout": true });
    client = createClient({
      apiKey: TEST_KEY,
      baseUrl: "http://flags.test",
      fetch: api.fetch,
      autoStart: false,
    });

    let storeNotifications = 0;
    let changeNotifications = 0;
    client.subscribe(() => storeNotifications++);
    client.onChange(() => changeNotifications++);

    await client.refresh();

    expect(storeNotifications).toBe(1);
    expect(changeNotifications).toBe(0);
    expect(client.getSnapshot().ready).toBe(true);
  });

  test("the snapshot keeps its identity when nothing changed", async () => {
    const api = stubApi({ a: 1 });
    client = createClient({
      apiKey: TEST_KEY,
      baseUrl: "http://flags.test",
      fetch: api.fetch,
      autoStart: false,
    });

    await client.refresh();
    const first = client.getSnapshot();

    await client.refresh(); // a 304 — same ETag
    expect(client.getSnapshot()).toBe(first);

    api.setPayload({ a: 2 }, 2);
    await client.refresh();
    expect(client.getSnapshot()).not.toBe(first);
    expect(client.getSnapshot().values).toEqual({ a: 2 });
  });

  test("getServerSnapshot never moves, so hydration matches the HTML", async () => {
    const api = stubApi({ "new-checkout": true });
    client = createClient({
      apiKey: TEST_KEY,
      baseUrl: "http://flags.test",
      fetch: api.fetch,
      autoStart: false,
      snapshot: { "new-checkout": false },
    });

    const server = client.getServerSnapshot();
    expect(server.values).toEqual({ "new-checkout": false });

    await client.refresh();

    expect(client.getSnapshot().values).toEqual({ "new-checkout": true });
    expect(client.getServerSnapshot()).toBe(server);
    expect(server.values).toEqual({ "new-checkout": false });
  });

  test("unsubscribing stops store notifications", async () => {
    const api = stubApi({ a: 1 });
    client = createClient({
      apiKey: TEST_KEY,
      baseUrl: "http://flags.test",
      fetch: api.fetch,
      autoStart: false,
    });

    let count = 0;
    const unsubscribe = client.subscribe(() => count++);
    await client.refresh();
    expect(count).toBe(1);

    unsubscribe();
    api.setPayload({ a: 2 }, 2);
    await client.refresh();

    expect(count).toBe(1);
  });
});

describe("a client with no network", () => {
  test("serves a server snapshot before anything is fetched", () => {
    client = offline({ snapshot: { "new-checkout": true }, manifest });

    expect(client.isReady()).toBe(true);
    expect(client.get("new-checkout")).toBe(true);
    expect(client.get("max-cart-items")).toBe(20); // the manifest default
  });

  test("resolves everything from defaults when the API is unreachable", async () => {
    const errors: Error[] = [];
    client = createClient({
      apiKey: TEST_KEY,
      baseUrl: "http://flags.test",
      fetch: unreachable(),
      autoStart: false,
      manifest,
      defaults: { "max-cart-items": 5 },
      onError: (error) => errors.push(error),
    });

    await expect(client.refresh()).rejects.toThrow(/network down/);

    // A blip must not empty the flags — every one still resolves.
    expect(client.get("max-cart-items")).toBe(5);
    expect(client.get("new-checkout")).toBe(false);
  });

  test("still refuses to be created without a key when it is meant to fetch", () => {
    expect(() => createClient({ baseUrl: "http://x" })).toThrow(/apiKey/);
    expect(() => createClient({ apiKey: "k" })).toThrow(/baseUrl/);
    // Offline is allowed, but only when it is unambiguous.
    expect(() => createClient({ snapshot: { a: 1 } })).toThrow(/apiKey/);
    expect(() => createClient({ snapshot: { a: 1 }, autoStart: false })).not.toThrow();
  });
});

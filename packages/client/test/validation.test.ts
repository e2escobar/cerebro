import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  FlagTypeError,
  ManifestMismatchError,
  createClient,
  detectMode,
  resetWarnings,
  type CerebroClient,
  type FlagManifest,
} from "../src/index";
import { stubApi, TEST_KEY } from "./stub-api";

/** What the client does when the payload disagrees with the manifest. */

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

beforeEach(() => {
  resetWarnings();
});

afterEach(() => {
  client?.close();
  client = null;
});

function connect(api: ReturnType<typeof stubApi>, extra: Record<string, unknown> = {}) {
  return createClient({
    apiKey: TEST_KEY,
    baseUrl: "http://flags.test",
    fetch: api.fetch,
    autoStart: false,
    manifest,
    ...extra,
  });
}

describe("a payload that disagrees with the manifest", () => {
  test("is rejected loudly in development", async () => {
    const api = stubApi({ "new-checkout": true, "max-cart-items": "fifty" });
    client = connect(api, { strict: "throw" });

    await expect(client.refresh()).rejects.toThrow(ManifestMismatchError);
  });

  test("is reported and survived in production", async () => {
    const api = stubApi({ "new-checkout": true, "max-cart-items": "fifty" });
    const errors: Error[] = [];
    client = connect(api, { strict: "warn", onError: (error: Error) => errors.push(error) });

    await client.refresh();

    expect(errors[0]).toBeInstanceOf(ManifestMismatchError);
    // The bad flag falls back, and — the point of quarantining per key rather
    // than rejecting the payload — every other flag still applies.
    expect(client.get("max-cart-items")).toBe(20);
    expect(client.get("new-checkout")).toBe(true);
  });

  test("keeps the last value that did validate", async () => {
    const api = stubApi({ "max-cart-items": 50 });
    client = connect(api, { strict: "warn" });

    await client.refresh();
    expect(client.get("max-cart-items")).toBe(50);

    api.setPayload({ "max-cart-items": "fifty" }, 2);
    await client.refresh();

    // Not the manifest default — the last good value is a better answer.
    expect(client.get("max-cart-items")).toBe(50);
  });

  test("throws again at the read, where the caller is, in development", async () => {
    const api = stubApi({ "max-cart-items": "fifty" });
    client = connect(api, { strict: "throw" });

    await expect(client.refresh()).rejects.toThrow(ManifestMismatchError);

    // Having complained once at the boundary is not enough: if the app carried
    // on, the component that reads the flag should hear about it too, rather
    // than being handed a default that looks like a real value.
    let caught: unknown;
    try {
      client.get("max-cart-items");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FlagTypeError);
    expect((caught as FlagTypeError).key).toBe("max-cart-items");
    expect((caught as FlagTypeError).expected).toBe("number");
    expect((caught as FlagTypeError).received).toBe("string");
  });

  test("but serves the last good value rather than throwing, when it has one", async () => {
    const api = stubApi({ "max-cart-items": 50 });
    client = connect(api, { strict: "throw" });
    await client.refresh();

    api.setPayload({ "max-cart-items": "fifty" }, 2);
    await expect(client.refresh()).rejects.toThrow(ManifestMismatchError);

    // A known-good value beats an exception, even in development.
    expect(client.get("max-cart-items")).toBe(50);
  });

  test("a flag the manifest does not know about is still readable", async () => {
    const api = stubApi({ "new-checkout": true, "legacy-flag": 1 });
    client = connect(api, { strict: "throw" });

    await client.refresh();

    // A stale manifest is a warning, never fatal — the value is real.
    expect(client.get("legacy-flag")).toBe(1);
  });

  test("a flag that is not promoted here resolves to its manifest default", async () => {
    const api = stubApi({ "new-checkout": true });
    client = connect(api, { strict: "throw" });

    await client.refresh();

    // Absence is the normal outcome of the promotion pipeline. Throwing here
    // would make every staging environment unusable.
    expect(client.get("max-cart-items")).toBe(20);
  });

  test("validates a server snapshot too, not just what it fetched", () => {
    client = createClient({
      autoStart: false,
      manifest,
      strict: "warn",
      snapshot: { "max-cart-items": "fifty" },
    });

    expect(client.get("max-cart-items")).toBe(20);
  });
});

describe("detectMode", () => {
  test("takes an explicit answer over anything it could infer", () => {
    expect(detectMode("production")).toBe("production");
    expect(detectMode("development")).toBe("development");
  });

  test("reads NODE_ENV when there is no explicit answer", () => {
    // bun test sets NODE_ENV=test, which is a development-shaped environment.
    expect(detectMode()).toBe("development");
  });
});

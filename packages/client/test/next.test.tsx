import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FlagManifest } from "../src/index";
import { CerebroFlags, createServerFlags, onlyClientSafe } from "../src/next/index";
import { useFlag } from "../src/react/index";
import { stubApi, TEST_KEY, unreachable } from "./stub-api";

/**
 * `CerebroFlags` is an async server component, so it is called directly and
 * the element it returns is rendered — which is what Next does, minus the
 * flight serialization.
 */

const manifest: FlagManifest = {
  version: 1,
  application: "checkout",
  generatedAt: "2026-08-03T00:00:00.000Z",
  flags: {
    "new-checkout": { type: "boolean", default: false, clientSafe: true },
    "internal-metrics": { type: "number", default: 0, clientSafe: false },
  },
};

function Probe() {
  return <span>{String(useFlag("new-checkout"))}</span>;
}

describe("server-side reads", () => {
  test("flag() resolves from the payload", async () => {
    const api = stubApi({ "new-checkout": true, "internal-metrics": 42 });
    const flags = createServerFlags({
      baseUrl: "http://flags.test",
      apiKey: TEST_KEY,
      fetch: api.fetch,
      manifest,
    });

    expect(await flags.flag("new-checkout")).toBe(true);
    expect(await flags.flag("internal-metrics")).toBe(42);
  });

  test("renders from defaults when the service is unreachable", async () => {
    const errors: Error[] = [];
    const flags = createServerFlags({
      baseUrl: "http://flags.test",
      apiKey: TEST_KEY,
      fetch: unreachable(),
      manifest,
      defaults: { "new-checkout": true },
      onError: (error) => errors.push(error),
    });

    // A page still renders when the flag service is down.
    expect(await flags.flag("new-checkout")).toBe(true);
    expect(await flags.flag("internal-metrics")).toBe(0);
    expect(errors[0]?.message).toMatch(/network down/);
  });

  test("with no configuration at all it serves manifest defaults", async () => {
    const flags = createServerFlags({ manifest });
    expect(await flags.flag("new-checkout")).toBe(false);
  });
});

describe("onlyClientSafe", () => {
  test("drops what the manifest marks as not client-safe", () => {
    const safe = onlyClientSafe({ "new-checkout": true, "internal-metrics": 42 }, manifest);
    expect(safe).toEqual({ "new-checkout": true });
  });

  test("keeps flags the manifest says nothing about", () => {
    // A manifest generated before clientSafe existed should not blank the app.
    const older: FlagManifest = {
      ...manifest,
      flags: { "new-checkout": { type: "boolean", default: false } },
    };
    expect(onlyClientSafe({ "new-checkout": true }, older)).toEqual({ "new-checkout": true });
  });
});

describe("CerebroFlags", () => {
  test("renders the snapshot into the tree", async () => {
    const api = stubApi({ "new-checkout": true });
    const element = await CerebroFlags({
      children: <Probe />,
      baseUrl: "http://flags.test",
      clientKey: TEST_KEY,
      fetch: api.fetch,
      manifest,
    });

    expect(renderToStaticMarkup(element)).toBe("<span>true</span>");
  });

  test("refuses to poll without a client key", async () => {
    // The key's kind is not recoverable at runtime, so this is the only place
    // the mistake can be caught.
    await expect(
      CerebroFlags({
        children: <Probe />,
        baseUrl: "http://flags.test",
        apiKey: "cbr_checkout_prod_server_key",
        manifest,
      }),
    ).rejects.toThrow(/client SDK key/);
  });

  test("keeps a server key's private flags out of the rendered page", async () => {
    const api = stubApi({ "new-checkout": true, "internal-metrics": 99 });

    const element = await CerebroFlags({
      children: <Probe />,
      baseUrl: "http://flags.test",
      apiKey: TEST_KEY,
      poll: false,
      manifest,
      fetch: api.fetch,
    });

    // The snapshot is a prop on the client provider, so anything left in it
    // would be serialized into the page.
    const props = (element.props as { snapshot: { values: Record<string, unknown> } }).snapshot;
    expect(props.values).toEqual({ "new-checkout": true });
    expect(JSON.stringify(props.values)).not.toContain("99");
  });

  test("will not guess which flags are private without a manifest", async () => {
    const api = stubApi({ "new-checkout": true, "internal-metrics": 99 });

    await expect(
      CerebroFlags({
        children: <Probe />,
        baseUrl: "http://flags.test",
        apiKey: TEST_KEY,
        poll: false,
        fetch: api.fetch,
      }),
    ).rejects.toThrow(/cannot tell which flags are safe/);
  });
});
